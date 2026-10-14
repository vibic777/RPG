'use strict';
// Инвентарь на сервере: все действия проверяются здесь по общим правилам shared/inventory.js
// и сохраняются в файле персонажа. Клиент только присылает действия.
const crypto = require('crypto');
const { EventEmitter } = require('events');
const Inv = require('../shared/inventory');
const Items = require('../shared/items');
const config = require('./config');
const auth = require('./auth');
const characters = require('./characters');
const worlds = require('./worlds');
const realtime = require('./realtime');
const chat = require('./chat');
const ground = require('./ground');
const M = require('../shared/movement');
const { HttpError } = auth;

const events = new EventEmitter(); // 'changed' (accountId, record) — после любого изменения инвентаря

Inv.setUidGenerator(() => crypto.randomBytes(6).toString('hex'));

// Настройки и проверка стартового набора: ошибка в нём — ошибка запуска
function configure(game) {
  Inv.configure(game);
  const kit = Inv.parseKit(game.startingKit);
  if (kit.errors.length) throw new Error('Настройка game.startingKit: ' + kit.errors.join('; '));
}

// Новый персонаж или персонаж, созданный до появления инвентаря, получает стартовый набор
characters.addMigration((ch) => {
  const fresh = Inv.ensure(ch);
  if (fresh) Inv.applyKit(ch);
  return fresh;
});

const locOf = (v) => (v && typeof v === 'object' ? { c: v.c, i: v.i, s: v.s } : null);
const intOrNull = (v) => (v == null ? undefined : v);

// Действия, не требующие мира: перемещение, надеть/снять, использовать, панель 1–0
const ACTIONS = {
  autoLoot: (ch, a) => {
    if (!a.modes || ['all', 'needed', 'best'].some((k) => typeof a.modes[k] !== 'boolean')) return 'Неверные режимы автолута.';
    ch.autoLoot = Object.fromEntries(['all', 'needed', 'best'].map((k) => [k, a.modes[k]]));
    return null;
  },
  autoUse: (ch, a) => {
    const AU = require('./autouse');
    if (!a.modes || typeof a.modes !== 'object' || AU.KINDS.some((k) => a.modes[k] !== undefined && typeof a.modes[k] !== 'boolean')) return 'Неверные режимы автопомощи.';
    ch.autoUse = Object.fromEntries(AU.KINDS.map((k) => [k, Boolean(a.modes[k])]));
    return null;
  },
  sort: (ch, a) => Inv.sortCells(ch, typeof a.mode === 'string' ? a.mode : 'logical', a.dir === undefined ? undefined : a.dir),
  move: (ch, a) => Inv.move(ch, locOf(a.from), locOf(a.to), intOrNull(a.count)),
  equip: (ch, a) => Inv.equip(ch, locOf(a.from), typeof a.slot === 'string' ? a.slot : undefined),
  unequip: (ch, a) => Inv.unequip(ch, locOf(a.from)),
  use: (ch, a, c) => Inv.use(ch, locOf(a.from), { client: c || null }),
  hotbar: (ch, a) => Inv.setHotbar(ch, a.key, a.item === null || a.item === undefined ? null : String(a.item)),
  hotkey: (ch, a, c) => Inv.hotkey(ch, a.key, { client: c || null }),
};

// Изменить инвентарь персонажа: fn(ch) возвращает текст ошибки или null (и может вернуть данные через ctx)
function mutate(account, charId, fn) {
  const { record, result } = characters.update(account, charId, (ch) => {
    Inv.ensure(ch);
    const live=clientOf(account.id,charId), flightBefore=Boolean(live&&!live.veh&&!live.mount&&require('./levels').airborne(live)&&Items.setEffects(ch).fly);
    const err = fn(ch);
    if(!err&&flightBefore&&!Items.setEffects(ch).fly)throw new HttpError(400,'Сначала приземлитесь: нельзя снять последнюю лётную экипировку в воздухе.');
    if (err) throw new HttpError(400, err);
    return err;
  });
  events.emit('changed', account.id, record);
  return { record, result };
}

// Выполнить действие (REST или WebSocket без мира-специфичных действий)
function act(account, charId, action, client = null) {
  const a = action && typeof action === 'object' ? action : {};
  const fn = ACTIONS[a.type];
  if (!fn) throw new HttpError(400, ['drop', 'pickup'].includes(a.type) ? 'Выбросить и поднять предметы можно только в мире.' : 'Неизвестное действие с инвентарём.');
  return mutate(account, charId, (ch) => fn(ch, a, client)).record;
}

// Что отдавать клиенту
function view(ch) {
    return { inventory: ch.inventory, vitals: ch.vitals, autoLoot: ch.autoLoot || { all: false, needed: false, best: false }, autoUse: require('./autouse').modesOf(ch), summary: Inv.summary(ch), settings: { baseSlots: Inv.settings.baseSlots, maxInventorySlots: Inv.settings.maxInventorySlots } };
}

// ---------- В мире: WebSocket, предметы на земле ----------

const round2 = (v) => Math.round(v * 100) / 100;
const clientOf = (accountId, charId) => {
  const c = realtime.byAccount.get(accountId);
  return c && c.room && c.character && c.character.id === charId ? c : null;
};

// После любого изменения: обновить запись у подключённого игрока, прислать инвентарь, разослать внешний вид
events.on('changed', (accountId, record) => {
  const c = clientOf(accountId, record.id);
  if (!c) return;
  c.character = record;
  realtime.send(c, { t: 'inv', ...view(record) });
  const look = Inv.look(record);
  const key = JSON.stringify(look);
  if (key !== c.lookKey) {
    c.lookKey = key;
    c.room.broadcast({ t: 'look', id: c.account.id, look });
  }
});

function drop(c, a) {
  const room = c.room;
  if (ground.isFull(room.id)) throw new HttpError(400, `На земле в этом мире уже ${config.get().game.groundItemsMax} предметов — больше не поместится.`);
  let item = null;
  mutate(c.account, c.character.id, (ch) => {
    const r = Inv.removeAt(ch, locOf(a.from), intOrNull(a.count));
    if (r.error) return r.error;
    item = r.item;
    return null;
  });
  // перед героем (ближе к камере: +x +y), чуть вразброс, чтобы предметы не сливались и не прятались под героем;
  // на непроходимую клетку не кладём
  const gs = config.get().game;
  const off = () => gs.dropOffsetMin + Math.random() * Math.max(0, gs.dropOffsetMax - gs.dropOffsetMin);
  let pos = { x: round2(c.pos.x + off()), y: round2(c.pos.y + off()) };
  if (M.validatePosition(room.map, pos)) pos = { x: round2(c.pos.x), y: round2(c.pos.y) };
  const g = ground.add(room.id, item, pos, c.character.name);
  room.broadcast({ t: 'ground-add', item: g });
}

function pickup(c, a) {
  const room = c.room;
  const g = ground.find(room.id, String(a.gid || ''));
  if (!g) throw new HttpError(400, 'Этого предмета уже нет на земле.');
  if (Math.hypot(g.x - c.pos.x, g.y - c.pos.y) > Inv.settings.pickupRange) throw new HttpError(400, 'Слишком далеко — подойдите ближе.');
  mutate(c.account, c.character.id, (ch) => Inv.add(ch, g.id, g.n, g.dur, { ...(g.data || {}), ...(g.tier ? { tier: g.tier } : {}), ...(Number.isFinite(g.made) ? { made: g.made } : {}) }));
  ground.remove(room.id, g.gid);
  room.broadcast({ t: 'ground-remove', gid: g.gid, by: c.account.id });
}

function onInv(c, msg) {
  const a = msg && msg.a && typeof msg.a === 'object' ? msg.a : {};
  try {
    if (a.type === 'drop') drop(c, a);
    else if (a.type === 'pickup') pickup(c, a);
    else act(c.account, c.character.id, a, c);
  } catch (e) {
    realtime.send(c, { t: 'inv-error', message: e instanceof HttpError ? e.message : 'Ошибка инвентаря.', ...view(c.character) });
    if (!(e instanceof HttpError)) console.error(e);
  }
}

function autoLootTick(room, dt, now) {
  if (now < (room.autoLootAt || 0)) return;
  room.autoLootAt = now + 600;
  const players = [...room.players.values()].filter(c => c.character.autoLoot && Object.values(c.character.autoLoot).some(Boolean) && !(c.cb && c.cb.dead) && c.ws.readyState === 1);
  if (!players.length) return;
  const ammunition = new Map();
  for (const c of players) {
    const types = new Set();
    if (c.character.autoLoot.needed) {
      const inspect = (x) => { const it = x && Items.get(x.id); if (it && it.weapon && it.weapon.ammo) types.add(it.weapon.ammo); };
      for (const x of c.character.inventory.cells) inspect(x);
      for (const x of Object.values(c.character.inventory.equipment)) inspect(x);
    }
    ammunition.set(c, types);
  }
  const priority = (c, g, ch = c.character) => Math.hypot(g.x - c.pos.x, g.y - c.pos.y) <= Inv.settings.pickupRange ? Items.lootPriority(ch, Items.get(g.id), c.character.autoLoot, g, ammunition.get(c)) : 0;
  const candidates = ground.list(room.id).map(g => ({ g, priority: Math.max(...players.map(c => priority(c, g))) }))
    .filter(x => x.priority > 0).sort((a,b) => b.priority - a.priority || String(a.g.gid).localeCompare(String(b.g.gid))).slice(0, 20 * players.length);
  const collected = new Map();
  let cursor = Math.max(0, players.findIndex(c => c.account.id === room.autoLootNext));
  for (const { g } of candidates) {
    for (let step = 0; step < players.length; step++) {
      const index = (cursor + step) % players.length, c = players[index];
      const entry = collected.get(c) || { ch: c.character, picked: [] };
      if (!priority(c, g, entry.ch) || entry.picked.length >= 20) continue;
      // Одна рабочая копия на игрока за проход; add сам откатывает отказ.
      if (!collected.has(c)) {
        entry.ch = structuredClone(c.character);
        collected.set(c, entry);
      }
      const extra = { ...(g.data || {}), ...(g.tier ? { tier: g.tier } : {}), ...(Number.isFinite(g.made) ? { made: g.made } : {}) };
      if (Inv.add(entry.ch, g.id, g.n, g.dur, extra)) continue;
      entry.picked.push(g);
      const item = Items.get(g.id);
      if (item && item.weapon && item.weapon.ammo) ammunition.get(c).add(item.weapon.ammo);
      cursor = (index + 1) % players.length;
      break;
    }
  }
  room.autoLootNext = players[cursor].account.id;
  for (const [c, { ch, picked }] of collected) {
    if (!picked.length) continue;
    characters.persist(c.account, ch);
    events.emit('changed', c.account.id, ch);
    for (const g of picked) { ground.remove(room.id, g.gid); room.broadcast({ t: 'ground-remove', gid: g.gid, by: c.account.id }); }
  }
}

realtime.use({
  name: 'автолут', tick: autoLootTick,
  welcome: (room, c) => {
    for (const gid of ground.purge(room.id)) room.broadcast({ t: 'ground-remove', gid });
    c.lookKey = JSON.stringify(Inv.look(c.character));
    return { inv: view(c.character), ground: ground.list(room.id) };
  },
  handlers: { inv: onInv },
});

// Исчезновение предметов на земле
let purgeTimer = null;
function startPurge() {
  clearInterval(purgeTimer);
  purgeTimer = setInterval(() => {
    for (const room of realtime.rooms.values()) {
      for (const gid of ground.purge(room.id)) room.broadcast({ t: 'ground-remove', gid });
    }
  }, Math.max(1, config.get().game.groundPurgeSec) * 1000);
  purgeTimer.unref();
}
startPurge();
worlds.on('removed', (w) => ground.removeWorld(w.id));

// ---------- Администратор: выдать / забрать предметы (заготовка для панели ГМ, этап 8) ----------

function findItem(q) {
  const s = String(q == null ? '' : q).trim().replace(/^"(.*)"$/, '$1').toLowerCase();
  if (!s) return null;
  return Items.ITEMS.find((i) => i.id === s) || Items.ITEMS.find((i) => i.name.toLowerCase() === s) || null;
}

function resolveTarget(username, character) {
  const acc = auth.findAccount(username);
  const list = characters.list(acc);
  let ch;
  if (character == null || character === '') {
    if (list.length !== 1) throw new HttpError(400, list.length ? `Укажите персонажа: ${list.map((c) => c.name).join(', ')}.` : 'У аккаунта нет персонажей.');
    ch = list[0];
  } else {
    const q = String(character).toLowerCase();
    ch = list.find((c) => c.id === character || c.name.toLowerCase() === q);
  }
  if (!ch) throw new HttpError(404, 'Персонаж не найден.');
  return { acc, ch };
}

function parseCount(count, def = 1) {
  const n = count == null || count === '' ? def : Number(count);
  if (!Number.isSafeInteger(n) || n < 1 || n > Number.MAX_SAFE_INTEGER) throw new HttpError(400, `Количество — целое число от 1 до ${Number.MAX_SAFE_INTEGER}.`);
  return n;
}

function notify(accountId, charId, text) {
  const c = clientOf(accountId, charId);
  if (c) chat.tell(c, text);
}

// body: { username, character? (id или имя; можно не указывать, если персонаж один), item (id или название), count? }
function give(admin, body = {}) {
  const it = findItem(body.item);
  if (!it || it.fixed) throw new HttpError(400, `Неизвестный предмет «${body.item == null ? '' : body.item}».`);
  const n = parseCount(body.count);
  if (it.id !== 'caps' && n > Inv.settings.itemActionMax) throw new HttpError(400, `Количество — от 1 до ${Inv.settings.itemActionMax}.`);
  const { acc, ch } = resolveTarget(body.username, body.character);
  const { record } = mutate(acc, ch.id, (x) => Inv.add(x, it.id, n));
  auth.logAdmin(admin, 'give', { username: acc.username, character: record.name, characterId: record.id, item: it.id, count: n });
  notify(acc.id, record.id, `Администратор выдал вам: ${it.name} × ${n}.`);
  return { username: acc.username, character: record.name, item: it.id, name: it.name, count: n };
}

function take(admin, body = {}) {
  const it = findItem(body.item);
  if (!it) throw new HttpError(400, `Неизвестный предмет «${body.item == null ? '' : body.item}».`);
  if (it.fixed) throw new HttpError(400, `«${it.name}» забрать нельзя.`);
  const n = parseCount(body.count);
  if (it.id !== 'caps' && n > Inv.settings.itemActionMax) throw new HttpError(400, `Количество — от 1 до ${Inv.settings.itemActionMax}.`);
  const { acc, ch } = resolveTarget(body.username, body.character);
  let taken = 0;
  const { record } = mutate(acc, ch.id, (x) => {
    taken = Inv.takeById(x, it.id, n);
    return taken ? null : `У персонажа «${x.name}» нет «${it.name}».`;
  });
  auth.logAdmin(admin, 'take', { username: acc.username, character: record.name, characterId: record.id, item: it.id, count: taken });
  notify(acc.id, record.id, `Администратор забрал у вас: ${it.name} × ${taken}.`);
  return { username: acc.username, character: record.name, item: it.id, name: it.name, count: taken };
}

// /give <игрок> <предмет> [кол-во], /take <игрок> <предмет> [кол-во] — игрок в этом мире (имя героя или аккаунта)
function chatCommand(fn, verb) {
  return (c, rest) => {
    if (c.account.role !== 'admin') return chat.tell(c, 'Команда доступна только администратору.');
    const r = chat.parseTarget(c.room, rest);
    if (!r.target) return chat.tell(c, r.name ? `Игрок «${r.name}» не найден в этом мире.` : `Пример: /${verb} Имя knife_fang 2`);
    const m = /^(.*?)(?:\s+(\d+))?$/s.exec(r.text.trim());
    if (!m[1]) return chat.tell(c, `Какой предмет? Пример: /${verb} ${r.target.character.name.includes(' ') ? `"${r.target.character.name}"` : r.target.character.name} ration 3 (id или название предмета — см. справку «Оружие»).`);
    try {
      const res = fn(c.account, { username: r.target.account.username, character: r.target.character.id, item: m[1], count: m[2] });
      chat.tell(c, `${verb === 'give' ? 'Выдано' : 'Забрано'}: ${res.name} × ${res.count} — ${res.character}.`);
    } catch (e) { chat.tell(c, e.message); }
  };
}
chat.addCommand('give', ['выдать'], chatCommand(give, 'give'), '/give <игрок> <предмет> [кол-во] — выдать предмет');
chat.addCommand('take', ['забрать'], chatCommand(take, 'take'), '/take <игрок> <предмет> [кол-во] — забрать предмет');

module.exports = { configure, act, mutate, view, events, give, take, findItem, resolveTarget, notify, ACTIONS, Inv, Items };
