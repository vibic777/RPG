'use strict';
// Панель администратора (ГМ), серверная часть: игроки, режим бога, телепорт, персонажи, спавн, сообщения, журнал, мир.
// Каждый вызов делает сам администратор (роль проверяет маршрут /api/admin/* и WS-обработчик), всё пишется в журнал.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const auth = require('./auth');
const realtime = require('./realtime');
const characters = require('./characters');
const worlds = require('./worlds');
const chat = require('./chat');
const M = require('../shared/movement');
const { HttpError } = auth;
const { CLOSE } = require('../shared/protocol');
const { JsonFile } = require('./store');
const logger = require('./logger');
const loggingFile = new JsonFile('server-logging.json', config.get().logging);
logger.configure(loggingFile.get());

const G = () => config.get().game;
const round2 = (v) => Math.round(v * 100) / 100;

// Игрок в сети по имени аккаунта (или null)
function onlineClient(username) {
  const a = auth.findAccount(username);
  const c = realtime.byAccount.get(a.id);
  return c && c.room ? c : null;
}
function requireOnline(username) {
  const c = onlineClient(username);
  if (!c) throw new HttpError(409, `Игрок «${username}» сейчас не в мире.`);
  return c;
}
function selfClient(admin) {
  const c = realtime.byAccount.get(admin.id);
  if (!c || !c.room) throw new HttpError(409, 'Войдите в мир, чтобы использовать это действие.');
  return c;
}

// ---------- Игроки ----------
function players() {
  return auth.listAccounts().map((a) => {
    const c = realtime.byAccount.get(a.id);
    const online = c && c.room ? {
      worldId: c.room.worldId, levelKey: c.room.key==='ground'?null:c.room.key, z: require('./levels').zOf(c.room, c), worldName: c.room.world.name, character: c.character.name, characterId: c.character.id,
      level: c.character.level || 1, x: round2(c.pos.x), y: round2(c.pos.y), since: c.joinedAt, god: realtime.godOf(a.id),
    } : null;
    return { ...a, online };
  }).sort((x, y) => Boolean(y.online) - Boolean(x.online) || x.username.localeCompare(y.username));
}

function kick(admin, username, reason) {
  const c = requireOnline(username);
  if (c.account.id === admin.id) throw new HttpError(400, 'Нельзя выгнать самого себя.');
  const why = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : '';
  auth.logAdmin(admin, 'kick', { target: c.account.username, worldId: c.room.id, reason: why || null });
  realtime.leaveRoom(c, 'kicked');
  realtime.kick(c, CLOSE.KICKED, 'Администратор отключил вас от мира' + (why ? `: ${why}` : '.') + ' Войти снова можно сразу.');
  return { ok: true };
}

// Телепорт. body: { username?, to?: имя аккаунта, x?, y? }
//   { username, to }   — игрока username к игроку to (оба в одном мире)
//   { to }             — себя к игроку to;  { username } — игрока к себе («призвать»)
//   { x, y }           — себя в точку (username — другого игрока в точку); сквозь препятствия, если включён полёт
//   { level, x?, y? }  — на вертикальный уровень (шаг 13): 'ground', ключ уровня («b0.2») или z (−5…+5)
function teleport(admin, body = {}) {
  const self = realtime.byAccount.get(admin.id);
  const who = body.username ? requireOnline(body.username) : selfClient(admin);
  if (body.level !== undefined && body.level !== null && body.level !== '') {
    const num = (v) => (v === undefined || v === null || v === '' ? NaN : Number(v));
    const r = require('./levels').adminTeleport(admin, who, body.level, num(body.x), num(body.y));
    if (who !== self) chat.tell(who, 'Администратор переместил вас на другой уровень.');
    return r;
  }
  let x, y;
  if (Number.isFinite(Number(body.x)) && Number.isFinite(Number(body.y)) && body.x !== null && body.y !== null && body.to === undefined) {
    x = Number(body.x); y = Number(body.y);
    const map = who.room.map;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) throw new HttpError(400, 'Точка за краем карты.');
    const fly = realtime.godOf(admin.id).fly && who === self;
    const drive = require('./vehicles').driveOf(who); // за рулём (шаг 14) — по правилам местности машины (лодка — на воду)
    map.drive = drive;
    let bad;
    try { bad = M.validatePosition(map, { x, y }); } finally { map.drive = null; }
    if (!fly && bad) throw new HttpError(400, 'Туда не пройти — включите полёт в режиме бога, чтобы переместиться сквозь препятствия.');
  } else {
    const dest = body.to ? requireOnline(body.to) : selfClient(admin);
    if (dest === who) throw new HttpError(400, 'Игрок уже здесь.');
    if (dest.room.worldId !== who.room.worldId) throw new HttpError(409, `Игроки в разных мирах («${who.room.world.name}» и «${dest.room.world.name}»).`);
    if (dest.room !== who.room) { // тот же мир, другой уровень (шаг 13)
      const err = realtime.changeLevel(who, dest.room.key || (dest.room.level ? dest.room.level.key : 'ground'), Math.floor(dest.pos.x), Math.floor(dest.pos.y));
      if (err) throw new HttpError(409, err);
      auth.logAdmin(admin, 'teleport', { target: who.account.username, worldId: who.room.id, x: round2(who.pos.x), y: round2(who.pos.y), to: body.to || null });
      if (who !== self) chat.tell(who, 'Администратор переместил вас.');
      return { username: who.account.username, x: who.pos.x, y: who.pos.y };
    }
    const p = realtime.freeSpawn(dest.room, { x: Math.floor(dest.pos.x), y: Math.floor(dest.pos.y) });
    x = p.x; y = p.y;
  }
  realtime.teleport(who, x, y);
  auth.logAdmin(admin, 'teleport', { target: who.account.username, worldId: who.room.id, x: round2(x), y: round2(y), to: body.to || null });
  if (who !== self) chat.tell(who, 'Администратор переместил вас.');
  return { username: who.account.username, x: who.pos.x, y: who.pos.y };
}

function setGod(admin, flags = {}) {
  const c = selfClient(admin);
  const god = realtime.setGod(c, flags);
  auth.logAdmin(admin, 'god', { worldId: c.room.id, ...god });
  return { god };
}

// WS: { t: 'gm', a: 'god', god: {...} } и { t: 'gm', a: 'tp', x, y } (телепорт щелчком по карте)
function onGm(c, msg) {
  if (c.account.role !== 'admin') return realtime.send(c, { t: 'gm-err', message: 'Только администратор.' });
  try {
    if (msg.a === 'god') setGod(c.account, msg.god || {});
    else if (msg.a === 'tp') teleport(c.account, { x: msg.x, y: msg.y });
    else if (msg.a === 'tplevel') teleport(c.account, { level: msg.level });
    else throw new HttpError(400, 'Неизвестное действие.');
  } catch (e) {
    realtime.send(c, { t: 'gm-err', message: e instanceof HttpError ? e.message : 'Ошибка.' });
    if (!(e instanceof HttpError)) console.error(e);
  }
}
realtime.use({ handlers: { gm: onGm } });

module.exports = { players, kick, teleport, setGod, onlineClient, requireOnline, selfClient };

// ---------- Персонажи ----------
const Rules = require('../shared/character-rules');
const CombatRules = require('../shared/combat');
const InventoryRules = require('../shared/inventory');
const Survival = require('../shared/survival');
const isInt = (v) => Number.isInteger(v);

function accountCharacters(username) {
  const acc = auth.findAccount(username);
  const online = realtime.byAccount.get(acc.id);
  return {
    account: auth.publicAccount(acc),
    characters: characters.list(acc).map((ch) => {
      const isOnline = Boolean(online && online.room && online.character.id === ch.id);
      const live = isOnline ? online.character : ch;
      const d = Rules.derive(live.stats, live.level);
      const { positions, ...rest } = live;
      return { ...rest, worlds: Object.keys(positions || {}).length, online: isOnline, max: { hp: d.maxHp, stamina: d.maxStamina, mp: d.maxMp }, xpToNext: CombatRules.xpToNext(live.level || 1) };
    }),
  };
}

// Проверить и применить правку к записи героя. Возвращает список ошибок (пустой — применено).
// Характеристики — от 1 до предела, уровень — 1…maxLevel, опыт — меньше порога уровня, здоровье — от 1 до максимума.
function applyEdit(ch, e) {
  const errs = [];
  const cheatStats = Boolean(e.cheat || (ch.cheat && ch.cheat.stats));
  const next = { stats: { ...ch.stats }, level: ch.level || 1, xp: ch.xp || 0, unspentPoints: ch.unspentPoints || 0, deaths: ch.deaths || 0 };
  if (e.stats !== undefined) {
    if (!e.stats || typeof e.stats !== 'object') errs.push('Характеристики — объект.');
    else for (const [id, v] of Object.entries(e.stats)) {
      const s = Rules.STATS.find((x) => x.id === id);
      if (!s) { errs.push(`Неизвестная характеристика «${id}».`); continue; }
      const cap = cheatStats ? 1000000 : Rules.statCap(id, false), n = Number(v);
      if (!isInt(n) || n < Rules.STAT_MIN || n > cap) errs.push(`«${s.label}»: целое от ${Rules.STAT_MIN} до ${Number.isFinite(cap) ? cap : '∞'}.`);
      else next.stats[id] = n;
    }
  }
  const maxLevel = CombatRules.settings.maxLevel;
  const num = (k, lo, hi, label) => {
    if (e[k] === undefined || e[k] === null || e[k] === '') return;
    const n = Number(e[k]);
    if (!isInt(n) || n < lo || n > hi) errs.push(`${label}: целое от ${lo} до ${hi}.`);
    else next[k] = n;
  };
  num('level', 1, maxLevel, 'Уровень');
  num('xp', 0, CombatRules.xpToNext(next.level) - 1, `Опыт (для уровня ${next.level})`);
  if (e.level !== undefined && e.xp === undefined && next.xp >= CombatRules.xpToNext(next.level)) next.xp = 0;
  num('unspentPoints', 0, G().adminMaxStatPoints, 'Свободные очки');
  num('deaths', 0, 1e9, 'Смерти');
  let slotBonus;
  if (e.inventorySlots !== undefined && e.inventorySlots !== null && e.inventorySlots !== '') {
    slotBonus = Number(e.inventorySlots);
    if (!Number.isInteger(slotBonus) || slotBonus < InventoryRules.settings.baseSlots || slotBonus > 65536) errs.push(`Навык «Инвентарь»: целое от ${InventoryRules.settings.baseSlots} до 65536.`);
  }
  const d = Rules.derive(next.stats, next.level);
  const cur = ch.vitals || { hp: d.maxHp, stamina: d.maxStamina, mp: d.maxMp };
  const vit = { hp: Math.min(cur.hp, d.maxHp), stamina: Math.min(cur.stamina, d.maxStamina), mp: Math.min(cur.mp, d.maxMp) };
  const vnum = (k, lo, hi, label) => {
    if (e[k] === undefined || e[k] === null || e[k] === '') return;
    const n = Number(e[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) errs.push(`${label}: от ${lo} до ${hi}.`);
    else vit[k] = Math.round(n);
  };
  vnum('hp', 1, d.maxHp, 'Здоровье');
  vnum('mp', 0, d.maxMp, 'Мана');
  vnum('stamina', 0, d.maxStamina, 'Выносливость');
  // шкалы выживания (0…100); ill: false — вылечить
  const sv = { ...Survival.ensure({ survival: ch.survival }) };
  for (const [k, label] of [['food', 'Сытость'], ['water', 'Вода'], ['rest', 'Бодрость'], ['rad', 'Радиация']]) {
    if (e[k] === undefined || e[k] === null || e[k] === '') continue;
    const n = Number(e[k]);
    if (!Number.isFinite(n) || n < 0 || n > 100) errs.push(`${label}: от 0 до 100.`);
    else sv[k] = Math.round(n);
  }
  if (e.ill === false) sv.illUntil = 0;
  if (errs.length) return errs;
  Object.assign(ch, next, { vitals: vit, survival: sv });
  ch.cheat = { ...(ch.cheat || {}) };
  if (e.cheat) ch.cheat.stats = true;
  else if (e.cheat === false) delete ch.cheat.stats;
  if (!Object.keys(ch.cheat).length) delete ch.cheat;
  if (slotBonus !== undefined) {
    const invErr = InventoryRules.setSlotBonus(ch, Math.max(0, slotBonus - InventoryRules.settings.baseSlots));
    if (invErr) return [invErr];
    const online = realtime.byAccount.get(ch.accountId);
    if (online && online.character === ch) require('./inventory').events.emit('changed', online.account.id, ch);
  }
  return [];
}

// body: { username, characterId, stats?, level?, xp?, hp?, mp?, stamina?, unspentPoints?, deaths?, food?, water?, rest?, rad?, ill? }
function editCharacter(admin, body = {}) {
  const acc = auth.findAccount(body.username);
  const id = String(body.characterId || '');
  const before = structuredClone(characters.get(acc, id));
  const c = realtime.byAccount.get(acc.id);
  const live = c && c.room && c.character.id === id ? c : null;
  const target = live ? live.character : null;
  let record;
  if (live) {
    const old = target.level || 1;
    const errs = applyEdit(target, body);
    if (errs.length) throw new HttpError(400, errs.join('\n'), { errors: errs });
    require('./combat').refreshPlayer(live, old);
    chat.tell(live, 'Администратор изменил вашего героя.');
    record = target;
  } else {
    record = characters.update(acc, id, (x) => {
      const errs = applyEdit(x, body);
      if (errs.length) throw new HttpError(400, errs.join('\n'), { errors: errs });
    }).record;
  }
  const changes = {};
  for (const k of ['level', 'xp', 'unspentPoints', 'deaths']) if (before[k] !== record[k]) changes[k] = [before[k], record[k]];
  if (before.inventory && record.inventory && before.inventory.cells.length !== record.inventory.cells.length) changes.inventorySlots = [before.inventory.cells.length, record.inventory.cells.length];
  for (const s of Rules.STATS) if (before.stats[s.id] !== record.stats[s.id]) changes[s.id] = [before.stats[s.id], record.stats[s.id]];
  auth.logAdmin(admin, 'edit-character', { target: acc.username, character: record.name, characterId: id, online: Boolean(live), changes });
  return { character: accountCharacters(acc.username).characters.find((x) => x.id === id) };
}

module.exports.accountCharacters = accountCharacters;
module.exports.editCharacter = editCharacter;
module.exports.applyEdit = applyEdit;

// ---------- Спавн ----------
const Items = require('../shared/items');
const Enemies = require('../shared/enemies');
const ground = require('./ground');

// Куда: { at: 'me' } | { at: 'player', username } | { at: 'point', x, y, worldId? }
function placeOf(admin, body) {
  if (body.at === 'player') { const c = requireOnline(body.username); return { room: c.room, x: c.pos.x, y: c.pos.y, target: c }; }
  if (body.at === 'point') {
    const self = realtime.byAccount.get(admin.id);
    const room = body.worldId ? realtime.rooms.get(body.worldId) : self && self.room;
    if (!room) throw new HttpError(409, 'Мир не активен (в нём никого нет) — спавн возможен только в мире с игроками.');
    const x = Number(body.x), y = Number(body.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || M.validatePosition(room.map, { x, y })) throw new HttpError(400, 'Сюда нельзя: точка за краем карты или непроходима.');
    return { room, x, y };
  }
  const c = selfClient(admin);
  return { room: c.room, x: c.pos.x, y: c.pos.y, target: null };
}

// body: { kind: 'enemy' | 'item', id, count?, at, username?, x?, y?, worldId?, attack? (враги сразу идут на цель-игрока) }
function spawn(admin, body = {}) {
  const p = placeOf(admin, body);
  const n = Number(body.count === undefined || body.count === '' ? 1 : body.count);
  if (body.kind === 'item') {
    const it = Items.get(String(body.id || ''));
    if (!it || it.fixed) throw new HttpError(400, `Неизвестный предмет «${body.id}».`);
    if (!isInt(n) || n < 1 || n > G().adminSpawnItemMax) throw new HttpError(400, `Количество — от 1 до ${G().adminSpawnItemMax}.`);
    let left = n, made = 0;
    while (left > 0 && !ground.isFull(p.room.id)) {
      const k = Math.min(left, it.stack || 1);
      const gi = ground.add(p.room.id, { id: it.id, n: k, dur: it.durability || undefined }, { x: round2(p.x + (Math.random() - 0.5)), y: round2(p.y + (Math.random() - 0.5)) }, 'Администратор');
      p.room.broadcast({ t: 'ground-add', item: gi });
      left -= k; made += k;
    }
    auth.logAdmin(admin, 'spawn-item', { worldId: p.room.id, item: it.id, count: made, x: round2(p.x), y: round2(p.y), at: body.at || 'me' });
    return { kind: 'item', id: it.id, name: it.name, count: made };
  }
  const def = Enemies.get(String(body.id || ''));
  if (!def) throw new HttpError(400, `Неизвестный враг «${body.id}».`);
  if (!isInt(n) || n < 1 || n > G().adminSpawnMax) throw new HttpError(400, `Количество — от 1 до ${G().adminSpawnMax}.`);
  const combat = require('./combat');
  const target = body.attack && p.target ? p.target.account.id : null;
  const made = combat.spawnGroup(p.room, { x: p.x, y: p.y }, def, n, target, body.at === 'point' ? 0.3 : 2.5, body.at === 'point' ? 2 : 4.5, { level: body.level, elite: Boolean(body.elite) });
  if (!made.length) throw new HttpError(400, 'Не нашлось места рядом с этой точкой.');
  auth.logAdmin(admin, 'spawn', { worldId: p.room.id, enemy: def.id, count: made.length, x: round2(p.x), y: round2(p.y), at: body.at || 'me' });
  return { kind: 'enemy', id: def.id, name: def.name, count: made.length, ids: made.map((e) => e.id), level: made[0].level };
}

// ---------- Сообщения ----------
// body: { username, text, inMin? } — сразу, если игрок в мире и inMin не задан; иначе — отложенное (событие message)
function message(admin, body = {}) {
  const acc = auth.findAccount(body.username);
  const inMin = Number(body.inMin || 0);
  const c = realtime.byAccount.get(acc.id);
  if (!inMin && c && c.room) {
    chat.adminMessage(admin.username, c, String(body.text || ''));
    auth.logAdmin(admin, 'message', { target: acc.username, text: String(body.text).slice(0, 300) });
    return { delivered: true };
  }
  const ev = require('./events').add(admin, { type: 'message', target: acc.username, text: body.text, inMin });
  return { delivered: false, event: ev };
}

module.exports.spawn = spawn;
module.exports.message = message;

// ---------- Журнал ----------
const { dataPath } = require('./store');
// q: { action?, admin?, target?, text?, page? (с 1), size? } — новые записи первыми
function log(q = {}) {
  let lines = [];
  try { lines = fs.readFileSync(path.join(dataPath(), 'admin-log.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { /* журнала ещё нет */ }
  const all = [];
  for (let i = lines.length - 1; i >= 0; i--) { try { all.push(JSON.parse(lines[i])); } catch { /* битая строка */ } }
  const low = (v) => String(v || '').toLowerCase();
  const action = low(q.action), who = low(q.admin), target = low(q.target), text = low(q.text);
  const hit = all.filter((e) => (!action || low(e.action) === action)
    && (!who || low(e.admin) === who)
    && (!target || [e.target, e.username].some((v) => low(v) === target))
    && (!text || low(JSON.stringify(e)).includes(text)));
  const size = Math.max(1, Math.min(G().adminLogPageMax, Number(q.size) || G().adminLogPageSize));
  const pages = Math.max(1, Math.ceil(hit.length / size));
  const page = Math.max(1, Math.min(pages, Number(q.page) || 1));
  return { entries: hit.slice((page - 1) * size, page * size), total: hit.length, page, pages, size, actions: [...new Set(all.map((e) => e.action))].sort() };
}

// ---------- Мир ----------
const backups = require('./backups');
function worldList() {
  return worlds.all().map((w) => {
    const room = realtime.rooms.get(w.id);
    let savedAt = null;
    try { savedAt = fs.statSync(path.join(dataPath(), 'worlds', w.id + '.state.json')).mtimeMs; } catch { /* ещё не сохранялся */ }
    const { inviteCode, _v, ...rest } = w;
    return { ...rest, members: (w.members || []).length, online: room ? room.players.size : 0, active: Boolean(room), stateSavedAt: savedAt,
      enemies: room && room.combat ? room.combat.enemies.size : null };
  });
}
function saveWorldNow(admin, id) {
  const room = realtime.rooms.get(id);
  if (!room) throw new HttpError(409, 'В мире сейчас никого нет — его состояние уже сохранено при уходе последнего игрока.');
  const at = room.saveWorld();
  auth.logAdmin(admin, 'save-world', { worldId: id });
  return { at };
}
function backupList() { return { backups: backups.list(), keep: config.get().backupKeep, dir: config.get().backupPath }; }
function backupCreate(admin, label) {
  const b = backups.create(typeof label === 'string' && label ? label : 'admin');
  auth.logAdmin(admin, 'backup', { id: b.id });
  return { backup: b };
}

function serverSettings(worldId = null) {
  const g = G();
  return { ...require('./difficulty-settings').current(worldId?{world:worlds.load(worldId)}:null), logging: logger.status() };
}
function setServerSettings(admin, body = {}) {
  try {
    let nextLogging=null;
    if (body.logging !== undefined) {
      const value=body.logging;
      if(!value||typeof value.enabled!=='boolean'||!value.levels||typeof value.levels!=='object')throw new Error('Настройки журнала заданы неверно.');
      const levels={};for(const name of logger.LEVELS){if(typeof value.levels[name]!=='boolean')throw new Error(`Для уровня журнала «${name}» выберите вкл. или выкл.`);levels[name]=value.levels[name];}
      nextLogging={...logger.status(),enabled:value.enabled,levels};
    }
    const settings = require('./difficulty-settings').set(body,body.worldId?{world:worlds.load(body.worldId)}:null);
    if(nextLogging){loggingFile.data=nextLogging;loggingFile.save();logger.configure(nextLogging);console.info('[logger] Настройки журнала изменены через панель администратора:',nextLogging);}
    const result={...settings,logging:logger.status()};
    auth.logAdmin(admin, 'server-settings', result);
    return { settings: result };
  } catch (e) { throw new HttpError(400, e.message); }
}

Object.assign(module.exports, { log, worldList, saveWorldNow, backupList, backupCreate, serverSettings, setServerSettings });
