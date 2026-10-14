'use strict';
// База, строительство и добыча в мире (данные — shared/building.js).
// База принадлежит аккаунту и хранится отдельно от мира: data/bases/<accountId>.json (server/bases.js).
// base.placed = { worldId, x, y, r, at } — участок в мире; base.structures — сооружения с координатами
// относительно флага (x, y — смещение), поэтому базу можно перенести в другой мир (флагом базы или «Новой игрой+»).
// В комнате мира: room.bld = { bases: Map id → база, pieces: Map id → сооружение, tiles: Map клетка → { floor, main, roof },
// nodes: Map клетка → { uses, until } }; room.map.blocks — слой непроходимости для поиска пути (стены, двери).
const crypto = require('crypto');
const realtime = require('./realtime');
const chat = require('./chat');
const config = require('./config');
const bases = require('./bases');
const ground = require('./ground');
const inventory = require('./inventory');
const survival = require('./survival');
const Settlements = require('../shared/settlements');
const B = require('../shared/building');
const Inv = require('../shared/inventory');
const Items = require('../shared/items');
const Crafting = require('../shared/crafting');
const WorldGen = require('../shared/worldgen');
const Rules = require('../shared/character-rules');

const G = () => config.get().game;
const round2 = (v) => Math.round(v * 100) / 100;
const pid = () => 'p' + crypto.randomBytes(4).toString('hex');

// ---------- Состояние комнаты ----------
function stateOf(room) {
  if (!room.bld) {
    room.bld = { bases: new Map(), pieces: new Map(), tiles: new Map(), nodes: new Map(), cd: new Map(), dirty: new Set(), nextSave: 0, nextSpike: 0 };
    room.map.blocks = room.map.blocks || new Map();
    room.map.blocks.clear();
    room.map.walkways = new Map();
    let list = [];
    try { list = bases.placedIn(room.id); } catch (e) { console.warn('[building] не удалось загрузить базы:', e.message); }
    for (const b of list) loadBase(room, b, false);
  }
  return room.bld;
}

const idx = (room, x, y) => y * room.map.width + x;
const hasAccess = (base, accountId) => Boolean(base && accountId && (base.ownerId === accountId || (base.allow || []).includes(accountId)));
const publicBase = (b) => ({ id: b.id, owner: b.ownerId, ownerName: b.ownerName || '', name: b.name, x: b.placed.x, y: b.placed.y, r: b.placed.r, allow: (b.allow || []).map((id) => ({ id, name: (b.allowNames || {})[id] || '' })) });
const publicPiece = (p) => ({ id: p.id, base: p.base, owner: p.owner, type: p.type, x: p.x, y: p.y, rot: p.rot, hp: Math.ceil(p.hp), max: p.max, locked: p.locked ? 1 : 0, n: p.items ? p.items.filter(Boolean).length : undefined });

function tileOf(room, x, y) {
  const st = room.bld, k = idx(room, x, y);
  let t = st.tiles.get(k);
  if (!t) { t = { floor: null, main: null, roof: null }; st.tiles.set(k, t); }
  return t;
}
function at(room, x, y, layer) { const t = room.bld.tiles.get(idx(room, x, y)); return t ? t[layer] : null; }

function indexPiece(room, p) {
  const st = room.bld, def = B.get(p.type), base = st.bases.get(p.base);
  room.map.walkways ||= new Map();
  if(B.get(p.type).battlements || p.type==='stairs') room.map.walkways.set(idx(room, p.x, p.y),p.id);
  st.pieces.set(p.id, p);
  tileOf(room, p.x, p.y)[def.layer] = p;
  if ((def.layer === 'main' || def.layer === 'floor') && def.block) room.map.blocks.set(idx(room, p.x, p.y), { block: def.block, get locked() { return p.locked; }, owner: base.ownerId, allow: base.allow, pid: p.id });
}
function unindexPiece(room, p) {
  const st = room.bld, def = B.get(p.type);
  const walkKey=idx(room, p.x, p.y);
  if(room.map.walkways?.get(walkKey)===p.id)room.map.walkways.delete(walkKey);
  st.pieces.delete(p.id);
  const t = st.tiles.get(idx(room, p.x, p.y));
  if (t && t[def.layer] === p) t[def.layer] = null;
  const bl = room.map.blocks.get(idx(room, p.x, p.y));
  if (bl && bl.pid === p.id) room.map.blocks.delete(idx(room, p.x, p.y));
}

// Поставить базу в комнату: флаг + сооружения (те, что не помещаются в этом мире, пропускаются)
function loadBase(room, b, announce = true) {
  const st = room.bld;
  b.allow = Array.isArray(b.allow) ? b.allow : [];
  b.placed.r = b.placed.r || B.settings.baseRadius;
  st.bases.set(b.id, b);
  const flag = { id: 'flag-' + b.id.slice(0, 8), base: b.id, owner: b.ownerId, type: 'flag', x: b.placed.x, y: b.placed.y, rot: 0, hp: B.maxHp(B.get('flag')), max: B.maxHp(B.get('flag')), locked: false };
  indexPiece(room, flag);
  let skipped = 0;
  for (const s of b.structures || []) {
    const def = B.get(s.type);
    const x = b.placed.x + s.x, y = b.placed.y + s.y;
    if (!def || def.fixed || B.canPlace(room.map, b.placed, def, x, y, (xx, yy, l) => at(room, xx, yy, l))) { skipped++; continue; }
    const max = B.maxHp(def);
    const p = { id: s.id || pid(), base: b.id, owner: b.ownerId, type: def.id, x, y, rot: s.rot || 0, hp: Math.max(1, Math.min(max, s.hp || max)), max, locked: Boolean(s.data && s.data.locked) };
    if (def.storage) p.items = Array.from({ length: def.storage }, (_, i) => (s.data && Array.isArray(s.data.items) && s.data.items[i]) || null);
    indexPiece(room, p);
  }
  if (announce) {
    room.broadcast({ t: 'bld-base', base: publicBase(b) });
    for (const p of st.pieces.values()) if (p.base === b.id) room.broadcast({ t: 'bld-add', p: publicPiece(p) });
  }
  return skipped;
}
function unloadBase(room, baseId) {
  const st = stateOf(room);
  for (const p of [...st.pieces.values()]) if (p.base === baseId) unindexPiece(room, p);
  st.bases.delete(baseId);
  room.broadcast({ t: 'bld-base-remove', id: baseId });
}

// Записать сооружения базы обратно в файл аккаунта
function saveBase(room, baseId) {
  const st = room.bld, b = st.bases.get(baseId);
  if (!b) return;
  b.structures = [...st.pieces.values()].filter((p) => p.base === baseId && p.type !== 'flag').map((p) => ({
    id: p.id, type: p.type, x: p.x - b.placed.x, y: p.y - b.placed.y, rot: p.rot, hp: Math.ceil(p.hp), tier: 1,
    data: { ...(p.locked ? { locked: true } : {}), ...(p.items ? { items: p.items } : {}) },
  }));
  b.updatedAt = Date.now();
  try { bases.saveOf(b.ownerId); } catch (e) { console.warn('[building] не удалось сохранить базу:', e.message); }
  st.dirty.delete(baseId);
}
const saveDirty = (room) => { if (room.bld) for (const id of [...room.bld.dirty]) saveBase(room, id); };

// ---------- Объявить базу (флаг базы) ----------
function myBaseHere(room, accountId) { for (const b of stateOf(room).bases.values()) if (b.ownerId === accountId) return b; return null; }

function claim(room, c, at = null) { // at — точка флага (чит-панель); иначе — под героем
  if (room.level) return 'Базу можно объявить только на поверхности (не в подземелье и не на высоте).';
  const st = stateOf(room);
  if (myBaseHere(room, c.account.id)) return 'У вас уже есть база в этом мире (одна на аккаунт).';
  const x = Math.floor(at ? at.x : c.pos.x), y = Math.floor(at ? at.y : c.pos.y), r = B.settings.baseRadius;
  const others = [...st.bases.values()].map((b) => ({ x: b.placed.x, y: b.placed.y, r: b.placed.r }));
  const err = B.canClaim(room.map, x, y, others, r);
  if (err) return err;
  // свободная (свёрнутая) база аккаунта, иначе новая, иначе переносим базу из другого мира
  const mine = bases.listOf(c.account.id);
  let b = mine.find((x2) => !x2.placed) || bases.createFor(c.account.id, `База ${c.character.name}`) || mine[0];
  if (!b) return 'Нельзя создать базу: предел баз на аккаунт — 0 (настройка maxBasesPerAccount).';
  if (b.placed && b.placed.worldId !== room.id) {
    const other = realtime.rooms.get(b.placed.worldId);
    if (other && other.bld) { saveDirty(other); unloadBase(other, b.id); }
  }
  b.placed = { worldId: room.id, x, y, r, at: Date.now() };
  b.ownerName = c.character.name;
  bases.saveOf(c.account.id);
  const skipped = loadBase(room, b);
  if (skipped) saveBase(room, b.id);
  chat.tell(c, `База «${b.name}» основана: участок радиусом ${r} клеток. Нажмите B — режим строительства.${skipped ? ` Не поместилось сооружений: ${skipped}.` : ''}`);
  return null;
}

// Перенести базу в новый мир (Новая игра+): ищем место по спирали от точки появления
function placeInWorld(base, worldId, map) {
  const r = B.settings.baseRadius, sp = map.spawn || { x: map.width / 2, y: map.height / 2 };
  const d0 = B.settings.baseMinSpawnDist + r + 1;
  for (let d = d0; d < Math.max(map.width, map.height); d += 2) {
    for (let a = 0; a < 16; a++) {
      const x = Math.floor(sp.x + Math.cos((a / 16) * Math.PI * 2) * d), y = Math.floor(sp.y + Math.sin((a / 16) * Math.PI * 2) * d);
      if (!B.canClaim(map, x, y, [], r)) {
        base.placed = { worldId, x, y, r, at: Date.now() };
        bases.saveOf(base.ownerId);
        return base.placed;
      }
    }
  }
  return null;
}

// Перенести базу в другой мир (НИ+): снять из старого мира, если он загружен
function moveToWorld(base, worldId, map) {
  const old = base.placed && realtime.rooms.get(base.placed.worldId);
  if (old && old.bld && old.bld.bases.has(base.id)) { saveDirty(old); unloadBase(old, base.id); }
  return placeInWorld(base, worldId, map);
}

// ---------- Строительство ----------
function takeCost(c, cost, verb) {
  inventory.mutate(c.account, c.character.id, (ch) => {
    const miss = Object.entries(cost).filter(([id, n]) => Crafting.haveCount(ch, id) < n).map(([id, n]) => `${Items.get(id).name} ${Crafting.haveCount(ch, id)}/${n}`);
    if (miss.length) return `${verb}: не хватает — ${miss.join(', ')}.`;
    for (const [id, n] of Object.entries(cost)) Inv.takeById(ch, id, n);
    return null;
  });
}
// Выдать предметы в сумку; что не влезло — на землю под ноги
function giveOrDrop(room, c, items, who) {
  const rest = [];
  try {
    inventory.mutate(c.account, c.character.id, (ch) => {
      for (const x of items) { const err = Inv.add(ch, x.id, x.n, x.dur, x.extra || null); if (err) rest.push(x); }
      return null;
    });
  } catch { rest.push(...items); }
  dropAt(room, rest, c.pos, who || c.character.name);
  return rest.length;
}
function dropAt(room, items, pos, who) {
  for (const x of items) {
    if (!x || ground.isFull(room.id)) continue;
    const g = ground.add(room.id, { id: x.id, n: x.n, dur: x.dur, ...(x.extra || {}), ...(x.made ? { made: x.made } : {}) }, { x: round2(pos.x + (Math.random() - 0.5)), y: round2(pos.y + (Math.random() - 0.5)) }, who);
    room.broadcast({ t: 'ground-add', item: g });
  }
}
const costList = (cost) => Object.entries(cost).map(([id, n]) => ({ id, n }));

function occupied(room, x, y) {
  for (const c of room.players.values()) if (Math.floor(c.pos.x) === x && Math.floor(c.pos.y) === y) return true;
  const cs = room.combat;
  if (cs) for (const e of cs.enemies.values()) if (!e.dead && Math.floor(e.x) === x && Math.floor(e.y) === y) return true;
  return false;
}
const near = (c, x, y, r) => Math.hypot(c.pos.x - (x + 0.5), c.pos.y - (y + 0.5)) <= r;

function place(room, c, type, x, y, rot) {
  const def = B.get(String(type || ''));
  if (!def || def.fixed) return 'Неизвестная постройка.';
  const base = myBaseHere(room, c.account.id) || [...stateOf(room).bases.values()].find((b) => hasAccess(b, c.account.id) && Math.hypot(b.placed.x - x, b.placed.y - y) <= b.placed.r);
  if (!base) return 'Сначала объявите базу: используйте флаг базы (рецепт «Флаг базы»).';
  const free = realtime.godOf(c.account.id).freeBuild; // чит «стройка без ресурсов» (шаг 20)
  if (def.learn && !free && !Crafting.known(c.character).has(def.learn)) return `«${def.name}»: нужен чертёж (свиток «${Crafting.get(def.learn).name}»).`;
  if (def.learn && !free) for (const [s, v] of Object.entries(Crafting.get(def.learn).req || {})) if (((c.character.stats || {})[s] || 0) < v) return `«${def.name}»: нужно ${(Rules.STATS.find((x) => x.id === s) || { label: s }).label} ${v}.`;
  x = Number(x); y = Number(y);
  const err = B.canPlace(room.map, base.placed, def, x, y, (xx, yy, l) => at(room, xx, yy, l));
  if (err) return err;
  if (!near(c, x, y, B.settings.buildRange)) return 'Слишком далеко — подойдите ближе.';
  if (def.block && occupied(room, x, y)) return 'На клетке кто-то стоит.';
  if ([...room.bld.pieces.values()].filter((p) => p.base === base.id).length >= B.settings.buildMaxPerBase) return `На базе уже ${B.settings.buildMaxPerBase} сооружений — больше нельзя.`;
  if (!free) takeCost(c, def.cost, `«${def.name}»`);
  const previous = at(room,x,y,def.layer);
  if(previous && def.id === 'bridge' && previous.type === 'moat') { unindexPiece(room,previous); room.broadcast({t:'bld-remove',id:previous.id}); }
  const max = B.maxHp(def);
  const p = { id: pid(), base: base.id, owner: base.ownerId, type: def.id, x, y, rot: ((Number(rot) || 0) % 4 + 4) % 4, hp: max, max, locked: false };
  if (def.storage) p.items = Array(def.storage).fill(null);
  indexPiece(room, p);
  room.broadcast({ t: 'bld-add', p: publicPiece(p) });
  saveBase(room, base.id);
  return null;
}

function pieceFor(room, c, id, needOwner) {
  const p = stateOf(room).pieces.get(String(id || ''));
  if (!p) return { error: 'Постройка не найдена.' };
  const base = room.bld.bases.get(p.base);
  if (needOwner ? base.ownerId !== c.account.id : !hasAccess(base, c.account.id)) return { error: needOwner ? 'Это может только хозяин базы.' : 'Нет доступа к этой базе.' };
  if (!near(c, p.x, p.y, B.settings.buildRange)) return { error: 'Слишком далеко — подойдите ближе.' };
  return { p, base, def: B.get(p.type) };
}

function repair(room, c, id) {
  const r = pieceFor(room, c, id, false);
  if (r.error) return r.error;
  if (r.p.hp >= r.p.max) return `«${r.def.name}» цела.`;
  takeCost(c, B.repairCost(r.def, r.p.hp, r.p.max), 'Ремонт');
  r.p.hp = r.p.max;
  room.broadcast({ t: 'bld-upd', id: r.p.id, hp: r.p.max, locked: r.p.locked ? 1 : 0 });
  saveBase(room, r.base.id);
  return null;
}

// Снести (и разрушение врагами — refund = false): содержимое сундука падает на землю
function removePiece(room, p, refundTo) {
  const def = B.get(p.type);
  unindexPiece(room, p);
  room.broadcast({ t: 'bld-remove', id: p.id });
  if (p.items) dropAt(room, p.items.filter(Boolean).map((x) => ({ id: x.id, n: x.n, dur: x.dur, made: x.made })), { x: p.x + 0.5, y: p.y + 0.5 }, def.name);
  if (refundTo) giveOrDrop(room, refundTo, costList(B.refund(def)));
  room.bld.dirty.add(p.base);
}
function demolish(room, c, id) {
  const r = pieceFor(room, c, id, true);
  if (r.error) return r.error;
  if (r.def.fixed) return 'Флаг базы не сносится (базу можно свернуть в панели администратора или перенести флагом в другой мир).';
  removePiece(room, r.p, c);
  saveBase(room, r.base.id);
  return null;
}
function lock(room, c, id) {
  const r = pieceFor(room, c, id, true);
  if (r.error) return r.error;
  if (r.def.block !== 'door') return 'Запираются только двери и ворота.';
  r.p.locked = !r.p.locked;
  room.broadcast({ t: 'bld-upd', id: r.p.id, hp: Math.ceil(r.p.hp), locked: r.p.locked ? 1 : 0 });
  saveBase(room, r.base.id);
  chat.tell(c, `${r.def.name}: ${r.p.locked ? 'заперта — проходят только хозяин и допущенные' : 'открыта для всех игроков'}.`);
  return null;
}
function rotate(room, c, id) {
  const r = pieceFor(room, c, id, true);
  if (r.error) return r.error;
  r.p.rot = (r.p.rot + 1) % 4;
  room.broadcast({ t: 'bld-add', p: publicPiece(r.p) });
  saveBase(room, r.base.id);
  return null;
}
function setBed(room, c, id) {
  const r = pieceFor(room, c, id, false);
  if (r.error) return r.error;
  if (!r.def.bed) return 'Это не кровать.';
  inventory.mutate(c.account, c.character.id, (ch) => { ch.beds = { ...(ch.beds || {}), [room.id]: r.p.id }; return null; });
  chat.tell(c, 'Кровать назначена: после смерти вы возродитесь здесь.');
  return null;
}
// Точка возрождения у кровати (server/combat.js respawnPoint) или null
function bedPoint(room, c) {
  const id = c.character.beds && c.character.beds[room.id];
  const p = id && stateOf(room).pieces.get(id);
  if (!p || !hasAccess(room.bld.bases.get(p.base), c.account.id)) return null;
  return { x: p.x + 0.5, y: p.y + 0.5 };
}
function allow(room, c, name, on) {
  const b = myBaseHere(room, c.account.id);
  if (!b) return 'У вас нет базы в этом мире.';
  const target = [...room.players.values()].find((x) => x.character.name.toLowerCase() === String(name || '').trim().toLowerCase());
  if (on !== false && !target) return `Игрок «${name}» не найден в этом мире.`;
  if (target && target.account.id === b.ownerId) return 'Хозяин и так имеет доступ.';
  b.allowNames = b.allowNames || {};
  if (on === false) {
    const id = target ? target.account.id : Object.keys(b.allowNames).find((k) => b.allowNames[k].toLowerCase() === String(name).trim().toLowerCase());
    const i = b.allow.indexOf(id);
    if (i < 0) return 'Этого игрока нет в списке допущенных.';
    b.allow.splice(i, 1); delete b.allowNames[id];
  } else if (!b.allow.includes(target.account.id)) { b.allow.push(target.account.id); b.allowNames[target.account.id] = target.character.name; }
  bases.saveOf(b.ownerId);
  room.broadcast({ t: 'bld-base', base: publicBase(b) });
  return null;
}

// Сундук: open | put { cell, n } | take { i, n }
function chest(room, c, msg) {
  const r = pieceFor(room, c, msg.id, false);
  if (r.error) return r.error;
  if (!r.p.items) return 'Это не сундук.';
  const items = r.p.items;
  if (msg.op === 'put') {
    const slot = items.indexOf(null);
    if (slot < 0) return 'Сундук полон.';
    let got = null;
    inventory.mutate(c.account, c.character.id, (ch) => {
      const x = Inv.removeAt(ch, { c: 'cell', i: Number(msg.cell) }, msg.n == null ? undefined : Number(msg.n));
      if (x.error) return x.error;
      got = x.item;
      return null;
    });
    items[slot] = got;
  } else if (msg.op === 'take') {
    const i = Number(msg.i), x = items[i];
    if (!x) return 'В этой ячейке пусто.';
    const it = Items.get(x.id);
    inventory.mutate(c.account, c.character.id, (ch) => Inv.add(ch, x.id, x.n, x.dur, it && !it.stackable ? Object.fromEntries(Object.entries(x).filter(([k]) => !['id', 'n', 'uid', 'dur'].includes(k))) : (x.made ? { made: x.made } : null)));
    items[i] = null;
  }
  if (msg.op === 'put' || msg.op === 'take') { saveBase(room, r.base.id); room.broadcast({ t: 'bld-upd', id: r.p.id, hp: Math.ceil(r.p.hp), locked: r.p.locked ? 1 : 0, n: items.filter(Boolean).length }); }
  realtime.send(c, { t: 'chest', id: r.p.id, items });
  return null;
}

// ---------- Урон постройкам (враги) и колья ----------
// Блок на клетке, который враг не может пройти (для ИИ) — сооружение или null
function blockAt(room, x, y) {
  const b = room.map.blocks && room.map.blocks.get(idx(room, x, y));
  if (!b || B.canPass(b, null)) return null;
  return room.bld && room.bld.pieces.get(b.pid);
}
function hitPiece(room, p, amount, direct = false) {
  if (!p || B.get(p.type).fixed || !room.bld.pieces.has(p.id)) return;
  p.hp -= Math.max(1, amount * (direct ? 1 : G().enemyPieceDamageFactor));
  if (p.hp <= 0) { removePiece(room, p, null); chat.system(room.id, `Враги разрушили: ${B.get(p.type).name}.`); return; }
  room.broadcast({ t: 'bld-upd', id: p.id, hp: Math.ceil(p.hp), locked: p.locked ? 1 : 0 });
  room.bld.dirty.add(p.base);
}
function stepSpikes(room, now) {
  const st = room.bld, cs = room.combat;
  if (!cs || now < st.nextSpike) return;
  st.nextSpike = now + B.settings.spikeIntervalSec * 1000;
  for (const p of st.pieces.values()) {
    if (!B.get(p.type).spikes) continue;
    for (const e of cs.enemies.values()) {
      if (e.dead || e.def.fly || Math.floor(e.x) !== p.x || Math.floor(e.y) !== p.y) continue;
      require('./combat').envDamage(room, e, B.settings.spikeDamage);
      hitPiece(room, p, B.settings.spikeDamage * 0.25);
    }
  }
}

// ---------- Постоянный костёр базы и станки для крафта ----------
function fireNear(room, pos, r) {
  for (const p of stateOf(room).pieces.values()) if (B.get(p.type).fire && Math.hypot(p.x + 0.5 - pos.x, p.y + 0.5 - pos.y) <= r) return { id: p.id, x: p.x + 0.5, y: p.y + 0.5, base: true };
  return null;
}
survival.setFireSource(fireNear);
// Станки рядом с героем (свои и доступные базы) + огонь (костёр или очаг)
function stationsNear(room, c) {
  const out = new Set(), r = Crafting.settings.craftStationRange;
  for (const p of stateOf(room).pieces.values()) {
    const def = B.get(p.type);
    if (def.station && hasAccess(room.bld.bases.get(p.base), c.account.id) && Math.hypot(p.x + 0.5 - c.pos.x, p.y + 0.5 - c.pos.y) <= r) out.add(def.station);
  }
  if (survival.nearFire(room, c.pos)) out.add('fire');
  if (!room.level) for (const st of Settlements.stationsAt(room.map, c.pos.x, c.pos.y, r)) out.add(st); // общие станки мастерской поселения (шаг 15)
  return out;
}

// ---------- Добыча ----------
function nodeState(room, k) {
  const n = stateOf(room).nodes.get(k);
  if (n && n.until && Date.now() >= n.until) { room.bld.nodes.delete(k); room.broadcast({ t: 'node-upd', i: k, until: 0 }); return null; }
  return n || null;
}
function toolOf(ch) { const m = ch.inventory && ch.inventory.equipment && ch.inventory.equipment.mainHand; const it = m && Items.get(m.id); return (it && it.tool) || null; }
function gather(room, c, x, y) {
  x = Math.floor(Number(x)); y = Math.floor(Number(y));
  if (!Number.isInteger(x) || !Number.isInteger(y)) return 'Укажите клетку.';
  const kind = B.nodeAt(room.map, x, y);
  if (!kind) return 'Здесь нечего добывать.';
  if (!near(c, x, y, B.settings.gatherRange)) return 'Слишком далеко — подойдите ближе.';
  const st = stateOf(room), now = Date.now();
  if ((st.cd.get(c.account.id) || 0) > now) return 'Не так быстро.';
  const k = idx(room, x, y), n = nodeState(room, k);
  if (n && n.until) return `${B.NODES[kind].name}: пусто, восстановится через ${Math.ceil((n.until - now) / 60000)} мин.`;
  const y2 = B.gatherYield(kind, toolOf(c.character));
  if (y2.error) return y2.error;
  st.cd.set(c.account.id, now + B.settings.gatherCooldownSec * 1000);
  inventory.mutate(c.account, c.character.id, (ch) => { for (const it of y2.items) { const e = Inv.add(ch, it.id, it.n); if (e) return e; } return null; });
  const s = n || { uses: B.settings.gatherUses };
  s.uses -= 1;
  if (s.uses <= 0) { s.until = now + B.settings.gatherRespawnMin * 60000; room.broadcast({ t: 'node-upd', i: k, until: s.until }); }
  st.nodes.set(k, s);
  realtime.send(c, { t: 'gathered', x, y, kind, items: y2.items.map((it) => ({ id: it.id, n: it.n, name: Items.get(it.id).name })), left: Math.max(0, s.uses) });
  return null;
}
// Истощённые точки — в состоянии мира
const snapshotNodes = (room) => (room.bld ? [...room.bld.nodes.entries()].map(([k, v]) => [k, v.uses, v.until || 0]) : []);
function restoreNodes(room, list) {
  const st = stateOf(room), now = Date.now();
  for (const x of Array.isArray(list) ? list : []) if (Array.isArray(x) && Number.isInteger(x[0]) && (!x[2] || x[2] > now)) st.nodes.set(x[0], { uses: x[1], until: x[2] || 0 });
}

// ---------- Флаг базы: использование предмета ----------
function onUse(ch, inst, it, ctx, take) {
  if (!it.claim) return undefined;
  const c = ctx && ctx.client, room = c && c.room;
  if (!room) return 'Флаг базы ставится только в мире.';
  const err = claim(room, c);
  if (err) return err;
  take();
  return null;
}
Inv.setUseHook(onUse, true);

// ---------- Администратор ----------
function adminList() {
  return bases.all().map((b) => ({
    id: b.id, name: b.name, ownerId: b.ownerId, ownerName: b.ownerName || '', placed: b.placed ? { worldId: b.placed.worldId, x: b.placed.x, y: b.placed.y, r: b.placed.r } : null,
    structures: (b.structures || []).length, updatedAt: b.updatedAt,
  }));
}
function adminRemove(id) {
  const b = bases.findById(String(id || ''));
  if (!b) return null;
  const room = b.placed && realtime.rooms.get(b.placed.worldId);
  if (room && room.bld) unloadBase(room, b.id);
  bases.removeById(b.ownerId, b.id);
  return b;
}

function climb(room,c,id) {
  const r=pieceFor(room,c,id,false);if(r.error)return r.error;
  if(r.p.type!=='stairs')return 'Подъём доступен по лестнице.';
  if(c.veh||c.mount||c.controlledComp)return 'Сначала вернитесь к управлению пешим героем.';
  if(!near(c,r.p.x,r.p.y,2))return 'Подойдите к лестнице.';
  if(!c.buildElevation&&![[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>B.get(at(room,r.p.x+dx,r.p.y+dy,'main')?.type)?.battlements))return 'Рядом с лестницей нужна крепостная стена или башня.';
  c.buildElevation=c.buildElevation?0:1;
  realtime.teleport(c,r.p.x+.5,r.p.y+.5);
  realtime.send(c,{t:'bld-height',height:c.buildElevation});return null;
}
function buildTemplate(room,c,id) {
  const template=B.TEMPLATES.find(t=>t.id===String(id));
  if(!template)return 'Неизвестный план здания.';
  const base=myBaseHere(room,c.account.id);
  if(!base)return 'Сначала установите флаг базы.';
  if(!near(c,base.placed.x,base.placed.y,B.settings.buildRange))return 'Подойдите к флагу: планы строятся вокруг него.';
  const free=realtime.godOf(c.account.id).freeBuild, pending=new Map(), plan=[], cost={};
  for(const q of B.templatePieces(template.id)) {
    const x=base.placed.x+q.x,y=base.placed.y+q.y,def=B.get(q.type);
    const getAt=(xx,yy,l)=>pending.get(xx+','+yy+','+l)||at(room,xx,yy,l);
    if(getAt(x,y,def.layer)?.type==='flag')continue;
    const err=B.canPlace(room.map,base.placed,def,x,y,getAt);if(err)return `${def.name}: ${err}`;
    if(def.block&&occupied(room,x,y))return 'Отведите персонажей от будущих стен и рва.';
    if(def.learn&&!free&&!Crafting.known(c.character).has(def.learn))return 'Изучите чертёж: '+Crafting.get(def.learn).name;
    if(def.learn&&!free)for(const [stat,n]of Object.entries(Crafting.get(def.learn).req||{}))if((c.character.stats?.[stat]||0)<n)return 'Для плана требуется '+((Rules.STATS.find(s=>s.id===stat)||{label:stat}).label)+' '+n;
    pending.set(x+','+y+','+def.layer,{type:def.id});plan.push({def,x,y});
    for(const [item,n]of Object.entries(def.cost))cost[item]=(cost[item]||0)+n;
  }
  if([...room.bld.pieces.values()].filter(p=>p.base===base.id).length+plan.length>B.settings.buildMaxPerBase)return 'План превышает лимит сооружений базы.';
  if(!free)takeCost(c,cost,'План '+template.name);
  for(const {def,x,y}of plan) {
    const p={id:pid(),base:base.id,owner:base.ownerId,type:def.id,x,y,rot:0,hp:B.maxHp(def),max:B.maxHp(def),locked:false};
    if(def.storage)p.items=Array(def.storage).fill(null);
    indexPiece(room,p);room.broadcast({t:'bld-add',p:publicPiece(p)});
  }
  saveBase(room,base.id);chat.tell(c,'Построено: '+template.name+'. Вход через дверь; мебель и станки ставятся в режиме B.');return null;
}
const ACTS = {
  climb:(room,c,m)=>climb(room,c,m.id),
  template: (room,c,m)=>buildTemplate(room,c,m.id),
  place: (room, c, m) => place(room, c, m.type, m.x, m.y, m.rot),
  repair: (room, c, m) => repair(room, c, m.id),
  demolish: (room, c, m) => demolish(room, c, m.id),
  lock: (room, c, m) => lock(room, c, m.id),
  rotate: (room, c, m) => rotate(room, c, m.id),
  bed: (room, c, m) => setBed(room, c, m.id),
  allow: (room, c, m) => allow(room, c, m.name, m.on),
  chest: (room, c, m) => chest(room, c, m),
};
function safely(c, fn) {
  let err;
  try { err = fn(); } catch (e) { err = e.message || String(e); }
  if (err) realtime.send(c, { t: 'bld-reject', message: err });
  return err;
}

realtime.use({
  publicExtra:c=>({be:c.buildElevation||0}),
  playerState:c=>({be:c.buildElevation||0}),
  beforeLeave:(room,c)=>{if(c.buildElevation){const stairs=[...stateOf(room).pieces.values()].filter(p=>p.type==='stairs'&&hasAccess(room.bld.bases.get(p.base),c.account.id)).sort((a,b)=>Math.hypot(a.x-c.pos.x,a.y-c.pos.y)-Math.hypot(b.x-c.pos.x,b.y-c.pos.y));if(stairs[0])c.pos={x:stairs[0].x+.5,y:stairs[0].y+.5};}c.buildElevation=0;},
  welcome: (room) => {
    const st = stateOf(room), now = Date.now();
    return { bld: { bases: [...st.bases.values()].map(publicBase), pieces: [...st.pieces.values()].map(publicPiece), nodes: [...st.nodes.entries()].filter(([, v]) => v.until > now).map(([k, v]) => [k, v.until]) } };
  },
  tick: (room, dt, now) => {
    const st = stateOf(room);
    stepSpikes(room, now);
    for(const c of room.players.values())if(c.buildElevation&&(c.veh||c.mount||c.cb?.dead||!room.map.walkways?.has(idx(room,Math.floor(c.pos.x),Math.floor(c.pos.y))))) {
      c.buildElevation=0;
      let point=null;
      for(let radius=0;radius<=4&&!point;radius++)for(let dy=-radius;dy<=radius&&!point;dy++)for(let dx=-radius;dx<=radius;dx++){
        const x=Math.floor(c.pos.x)+dx,y=Math.floor(c.pos.y)+dy;
        if(realtime.asActor(room,c.account.id,()=>WorldGen.isWalkable(room.map,x,y),c)){point={x:x+.5,y:y+.5};break;}
      }
      if(point)realtime.teleport(c,point.x,point.y);
      realtime.send(c,{t:'bld-height',height:0});
    }
    if (now >= st.nextSave) { st.nextSave = now + 5000; saveDirty(room); }
  },
  onSaveWorld: saveDirty,
  onDestroy: saveDirty,
  handlers: {
    build: (c, msg) => { const m = msg && typeof msg === 'object' ? msg : {}; const fn = ACTS[m.a]; safely(c, () => (fn ? fn(c.room, c, m) : 'Неизвестное действие строительства.')); },
    gather: (c, msg) => { safely(c, () => gather(c.room, c, msg && msg.x, msg && msg.y)); },
  },
});

// ---------- Чит-панель «Стройка» (шаг 21) ----------
// Деталь бесплатно (без ресурсов, чертежей и дальности) в точку: внутри доступной базы; базы в этом мире нет — она объявляется здесь.
function cheatPlace(room, c, type, x, y, rot) {
  const def = B.get(String(type || ''));
  if (!def) return 'Неизвестная постройка.';
  x = Math.floor(Number(x)); y = Math.floor(Number(y));
  if (!Number.isInteger(x) || !Number.isInteger(y)) return 'Укажите клетку.';
  const st = stateOf(room);
  if (def.fixed) return myBaseHere(room, c.account.id) ? 'У вас уже есть база в этом мире: флаг один на аккаунт.' : claim(room, c, { x, y });
  let base = [...st.bases.values()].find((b) => hasAccess(b, c.account.id) && Math.hypot(b.placed.x - x, b.placed.y - y) <= b.placed.r);
  if (!base) {
    if (myBaseHere(room, c.account.id)) return 'Точка вне вашей базы: детали ставятся только на участке базы (флаг — один на мир).';
    let err = null;
    for (const [dx, dy] of [[-2, 0], [0, -2], [2, 0], [0, 2]]) { err = claim(room, c, { x: x + dx, y: y + dy }); if (!err) break; } // флаг — рядом с деталью
    if (err) return `Нужна база, но объявить её здесь нельзя: ${err}`;
    base = myBaseHere(room, c.account.id);
  }
  const err = B.canPlace(room.map, base.placed, def, x, y, (xx, yy, l) => at(room, xx, yy, l));
  if (err) return err;
  if (def.block && occupied(room, x, y)) return 'На клетке кто-то стоит.';
  const previous=at(room,x,y,def.layer);
  if(previous && def.id==='bridge' && previous.type==='moat'){unindexPiece(room,previous);room.broadcast({t:'bld-remove',id:previous.id});}
  const max = B.maxHp(def);
  const p = { id: pid(), base: base.id, owner: base.ownerId, type: def.id, x, y, rot: ((Number(rot) || 0) % 4 + 4) % 4, hp: max, max, locked: false };
  if (def.storage) p.items = Array(def.storage).fill(null);
  indexPiece(room, p);
  room.broadcast({ t: 'bld-add', p: publicPiece(p) });
  saveBase(room, base.id);
  return null;
}
// Ластик: деталь на клетке (крыша → стена/мебель → пол) без возврата ресурсов; флаг — вся база. Возвращает название или null.
function cheatErase(room, x, y) {
  stateOf(room);
  for (const layer of ['roof', 'main', 'floor']) {
    const p = at(room, Math.floor(x), Math.floor(y), layer);
    if (!p) continue;
    const def = B.get(p.type);
    if (def.fixed) { const b = adminRemove(p.base); return b ? `база «${b.name}»` : null; }
    removePiece(room, p, null);
    saveBase(room, p.base);
    return def.name;
  }
  return null;
}
module.exports = { cheatPlace, cheatErase, stateOf, claim, place, repair, demolish, lock, allow, chest, gather, bedPoint, blockAt, hitPiece, stationsNear, fireNear, hasAccess, placeInWorld, moveToWorld, snapshotNodes, restoreNodes, saveDirty, adminList, adminRemove, publicPiece, toolOf };
