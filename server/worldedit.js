'use strict';
// Стройка чит-панели (шаг 21): объекты в мире (props) и скрытые объекты мира (hidden), по комнате (поверхность и каждый уровень отдельно).
// room.props = { list: Map id → prop, hidden: Set клеток }. Сохраняются в состоянии мира (server/combat.js snapshotState / restoreState),
// новым игрокам — в welcome, остальным — prop-add / prop-remove / prop-hide. Ресурсные точки добавляются в карту точек (Building.nodes),
// так что добываются как обычные; скрытая клетка убирает и рисунок объекта мира, и ресурсную точку на ней.
const crypto = require('crypto');
const realtime = require('./realtime');
const config = require('./config');
const W = require('../shared/worldedit');
const B = require('../shared/building');
const Enemies = require('../shared/enemies');
const WorldGen = require('../shared/worldgen');

const round2 = (v) => Math.round(v * 100) / 100;
const newId = () => 'w' + crypto.randomBytes(4).toString('hex');
const settings = { natureTreeRespawnSec: 300, natureTreeHp: 36, natureRockHp: 180 };
W.configure(config.get().game);
for (const k of Object.keys(settings)) if (Number.isFinite(config.get().game[k])) settings[k] = config.get().game[k];

function stateOf(room) {
  if (!room.props) room.props = { list: new Map(), hidden: new Set(), removedNodes: new Map(), treeRespawn: new Map(), terrain: new Map(), hp: new Map() };
  room.props.treeRespawn = room.props.treeRespawn || new Map();
  room.props.terrain = room.props.terrain || new Map();
  room.props.hp = room.props.hp || new Map();
  return room.props;
}
const idx = (room, x, y) => Math.floor(y) * room.map.width + Math.floor(x);
const publicProp = (p) => ({ id: p.id, k: p.k, key: p.key, x: p.x, y: p.y, rot: p.rot || 0, ...(p.lvl ? { lvl: p.lvl } : {}) });

function addNode(room, p) { B.nodes(room.map).set(idx(room, p.x, p.y), p.key); }
function dropNode(room, k) { const m = B.nodes(room.map); if (m.has(k)) { const st = stateOf(room); if (!st.removedNodes.has(k)) st.removedNodes.set(k, m.get(k)); m.delete(k); } }

// Поставить объект. Возвращает prop или бросает Error с текстом.
function place(room, k, key, x, y, rot = 0, lvl = 1) {
  const err = W.validProp(k, key);
  if (err) throw new Error(err);
  x = Number(x); y = Number(y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= room.map.width || y >= room.map.height) throw new Error('Точка за краем карты.');
  const st = stateOf(room);
  if (st.list.size >= W.settings.worldEditMaxProps) throw new Error(`В мире уже ${W.settings.worldEditMaxProps} объектов стройки (настройка game.worldEditMaxProps).`);
  const cell = k === 'bld' || k === 'node';
  const p = { id: newId(), k, key, x: cell ? Math.floor(x) : round2(x), y: cell ? Math.floor(y) : round2(y), rot: ((Math.floor(Number(rot)) || 0) % 4 + 4) % 4 };
  if (k === 'cache') p.lvl = Math.max(1, Math.min(50, Math.floor(Number(lvl)) || 1));
  st.list.set(p.id, p);
  if (k === 'node') { st.hidden.delete(idx(room, p.x, p.y)); addNode(room, p); }
  room.broadcast({ t: 'prop-add', prop: publicProp(p) });
  return p;
}
function remove(room, id) {
  const st = stateOf(room), p = st.list.get(id);
  if (!p) return null;
  st.list.delete(id);
  if (p.k === 'node') { const k = idx(room, p.x, p.y); const m = B.nodes(room.map); if (m.get(k) === p.key) m.delete(k); const orig = st.removedNodes.get(k); if (orig && !st.hidden.has(k)) m.set(k, orig); }
  room.broadcast({ t: 'prop-remove', id });
  return p;
}
// Ближайший объект стройки к точке (в пределах r клеток; здание — если точка внутри него)
function propAt(room, x, y, r = 0.9) {
  let best = null, bd = r;
  for (const p of stateOf(room).list.values()) {
    if (p.k === 'bld' && x >= p.x && y >= p.y && x < p.x + W.BLD_SIZE && y < p.y + W.BLD_SIZE) return p;
    const d = Math.hypot(p.x + (p.k === 'node' ? 0.5 : 0) - x, p.y + (p.k === 'node' ? 0.5 : 0) - y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
// Скрыть объект мира на клетке (дерево, скала, руина, ресурсная точка); show — вернуть
function hide(room, x, y, show = false) {
  const st = stateOf(room), k = idx(room, x, y);
  if (show) {
    if (!st.hidden.delete(k)) return false;
    const orig = st.removedNodes.get(k); if (orig) { B.nodes(room.map).set(k, orig); st.removedNodes.delete(k); }
  } else {
    if (st.hidden.has(k)) return false;
    st.hidden.add(k);
    dropNode(room, k);
  }
  room.broadcast({ t: 'prop-hide', i: k, on: show ? 0 : 1 });
  return true;
}
function terrainAt(room, i) { const st = stateOf(room); return st.terrain.has(i) ? st.terrain.get(i) : room.map.tiles[i]; }
function treeAt(room, i) { return terrainAt(room, i) === WorldGen.B.FOREST && !stateOf(room).hidden.has(i); }
function tileUpdate(room, i, tile) {
  room.map.tiles[i] = tile;
  stateOf(room).terrain.set(i, tile);
  room.broadcast({ t: 'terrain-upd', i, tile });
}
function hitNature(room, x, y, amount, owner, explosive = false) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= room.map.width || y >= room.map.height) return false;
  const i = y * room.map.width + x, st = stateOf(room), tile = terrainAt(room, i), biome = WorldGen.BIOMES[tile];
  const tree = tile === WorldGen.B.FOREST && !st.hidden.has(i);
  const rock = biome && !biome.walkable && [WorldGen.B.MOUNTAIN, WorldGen.B.WALL, WorldGen.B.LEDGE].includes(tile);
  if (!tree && !(rock && explosive)) return false;
  const hp = (st.hp.get(i) || (tree ? settings.natureTreeHp : settings.natureRockHp)) - Math.max(1, amount);
  if (hp > 0) { st.hp.set(i, hp); return true; }
  st.hp.delete(i);
  if (tree) {
    hide(room, x, y);
    st.treeRespawn.set(i, Date.now() + settings.natureTreeRespawnSec * 1000);
    const gi = require('./ground').add(room.id, { id: 'wood', n: 2 + Math.floor(Math.random() * 3) }, { x: x + 0.5, y: y + 0.5 }, owner || 'Природа');
    room.broadcast({ t: 'ground-add', item: gi });
  } else {
    tileUpdate(room, i, WorldGen.B.HILLS);
    const gi = require('./ground').add(room.id, { id: 'stone', n: 2 + Math.floor(Math.random() * 4) }, { x: x + 0.5, y: y + 0.5 }, owner || 'Обломки скалы');
    room.broadcast({ t: 'ground-add', item: gi });
  }
  return true;
}
function tickNature(room, now) {
  const st = stateOf(room);
  for (const [i, at] of st.treeRespawn) {
    if (now < at) continue;
    st.treeRespawn.delete(i);
    st.hidden.delete(i);
    const original = st.removedNodes.get(i);
    if (original) { require('../shared/building').nodes(room.map).set(i, original); st.removedNodes.delete(i); }
    room.broadcast({ t: 'prop-hide', i, on: 0 });
  }
}
function damagePiece(room, p, amount) { return require('./building').hitPiece(room, p, amount, true); }
// Открыть тайник: добыча на землю, тайник исчезает
function open(room, c, id) {
  const p = stateOf(room).list.get(String(id || ''));
  if (!p || p.k !== 'cache') return 'Тайник уже пуст.';
  if (Math.hypot(c.pos.x - p.x, c.pos.y - p.y) > W.settings.worldEditOpenRange + 0.5) return 'Подойдите ближе к тайнику.';
  remove(room, p.id);
  require('./combat').dropLoot(room, { def: { loot: p.key }, level: p.lvl || 1, x: p.x, y: p.y });
  return null;
}

const snapshot = (room) => (room.props ? { list: [...room.props.list.values()].map(publicProp), hidden: [...room.props.hidden], treeRespawn: [...room.props.treeRespawn], terrain: [...room.props.terrain] } : null);
function restore(room, data) {
  if (!data || typeof data !== 'object') return;
  const st = stateOf(room);
  for (const k of Array.isArray(data.hidden) ? data.hidden : []) if (Number.isInteger(k) && k >= 0 && k < room.map.width * room.map.height) { st.hidden.add(k); dropNode(room, k); }
  for (const row of Array.isArray(data.treeRespawn) ? data.treeRespawn : []) if (Array.isArray(row) && Number.isInteger(row[0]) && Number.isFinite(row[1]) && row[0] >= 0 && row[0] < room.map.width * room.map.height) st.treeRespawn.set(row[0], row[1]);
  for (const row of Array.isArray(data.terrain) ? data.terrain : []) if (Array.isArray(row) && Number.isInteger(row[0]) && Number.isInteger(row[1]) && row[0] >= 0 && row[0] < room.map.width * room.map.height) { st.terrain.set(row[0], row[1]); room.map.tiles[row[0]] = row[1]; }
  for (const x of Array.isArray(data.list) ? data.list : []) {
    if (!x || W.validProp(x.k, x.key) || !Number.isFinite(x.x) || !Number.isFinite(x.y)) continue;
    const p = { id: String(x.id || newId()).slice(0, 16), k: x.k, key: x.key, x: x.x, y: x.y, rot: ((x.rot | 0) % 4 + 4) % 4, ...(x.lvl ? { lvl: x.lvl | 0 } : {}) };
    st.list.set(p.id, p);
    if (p.k === 'node') addNode(room, p);
  }
}

realtime.use({
  welcome: (room) => { const st = stateOf(room); return { props: [...st.list.values()].map(publicProp), hidden: [...st.hidden] }; },
  tick: (room, _dt, now) => tickNature(room, now),
  handlers: {
    prop: (c, msg) => {
      if (!c.room || !msg || msg.a !== 'open') return;
      const err = open(c.room, c, msg.id);
      if (err) realtime.send(c, { t: 'prop-err', message: err });
    },
  },
});

module.exports = { stateOf, place, remove, propAt, hide, open, snapshot, restore, publicProp, hitNature, damagePiece, terrainAt, treeAt, LOOT: Enemies.LOOT };
