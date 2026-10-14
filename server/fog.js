'use strict';
// Туман войны (шаг 22): разведанная карта героя — character.explored[worldId][ключ уровня] = RLE-строка (shared/fog.js).
// Сервер разведывает круг обзора при смене клетки героя (и раз в секунду — радиус меняется с сутками), сохраняет вместе с героем.
// game.fogShared — общая карта комнаты (уровня мира): своё разведанное сливается в неё при входе, новые клетки — fog-reveal остальным;
// хранится в состоянии мира (combat snapshot). game.fogServerCull (режим on) — враги, жители и чужие спутники вне обзора не отправляются.
const realtime = require('./realtime');
const characters = require('./characters');
const config = require('./config');
const Fog = require('../shared/fog');
const Art = require('../shared/art');

const G = () => config.get().game;
const keyOf = (room) => (room.key || (room.level ? room.level.key : 'ground'));
const zOf = (room) => (room.level ? room.level.z || 0 : 0);
const radiusFor = (room, now = Date.now()) => Fog.radiusAt({ phase: Art.dayPhase(now), z: zOf(room) });
const noFog = (c) => Fog.mode() === 'off' || Boolean(realtime.godOf(c.account.id).nofog);
const shared = () => Boolean(Fog.settings.fogShared);
function roomBits(room) {
  if (!room.fogBits || room.fogBits.length !== Math.ceil((room.map.width * room.map.height) / 8)) room.fogBits = Fog.create(room.map.width, room.map.height);
  return room.fogBits;
}
function stored(c, room) { return ((c.character.explored || {})[room.worldId] || {})[keyOf(room)]; }

// Состояние героя в комнате: { room, bits, dirty, cell, r, at }
function load(room, c) {
  Fog.configure(G());
  const { width: w, height: h } = room.map;
  let bits = Fog.decode(stored(c, room), w, h);
  if (shared()) {
    const rb = roomBits(room);
    const own = bits;
    if (Fog.or(rb, own)) for (const o of room.players.values()) if (o !== c && o.fog && o.fog.room === room) realtime.send(o, { t: 'fog-merge', explored: Fog.encode(rb, w, h) });
    bits = rb;
  }
  c.fog = { room, bits, dirty: false, cell: -1, r: 0, at: 0 };
  step(room, c, Date.now(), true);
  return c.fog;
}
// Разведать вокруг героя; true — есть новые клетки
function step(room, c, now, quiet) {
  const st = c.fog;
  if (!st || st.room !== room || !c.pos) return false;
  const { width: w, height: h } = room.map, cell = Math.floor(c.pos.y) * w + Math.floor(c.pos.x);
  if (now - st.at > 1000) { st.at = now; st.r = radiusFor(room, now); } else if (cell === st.cell) return false;
  st.cell = cell;
  const res = Fog.reveal(st.bits, w, h, c.pos.x, c.pos.y, st.r);
  if (!res.n) return false;
  st.dirty = true;
  if (shared() && !quiet && room.players.size > 1) {
    const msg = { t: 'fog-reveal', x: Math.round(c.pos.x * 100) / 100, y: Math.round(c.pos.y * 100) / 100, r: st.r };
    for (const o of room.players.values()) if (o !== c) realtime.send(o, msg);
  }
  return true;
}
function save(c, force) {
  const st = c.fog;
  if (!st || (!st.dirty && !force)) return false;
  const room = st.room;
  c.character.explored = c.character.explored || {};
  const per = (c.character.explored[room.worldId] = c.character.explored[room.worldId] || {});
  per[keyOf(room)] = Fog.encode(st.bits, room.map.width, room.map.height);
  st.dirty = false;
  try { characters.persist(c.account, c.character); } catch (e) { console.warn('[fog] не удалось сохранить разведанное:', e.message); }
  return true;
}
// Открыть всю карту уровня герою (чит, панель ГМ)
function revealAll(c) {
  const room = c.room;
  if (!room) return 0;
  if (!c.fog || c.fog.room !== room) load(room, c);
  const before = Fog.count(c.fog.bits);
  c.fog.bits.fill(255);
  c.fog.dirty = true;
  save(c);
  const msg = { t: 'fog-merge', explored: Fog.encode(c.fog.bits, room.map.width, room.map.height) };
  if (shared()) for (const o of room.players.values()) realtime.send(o, msg); else realtime.send(c, msg);
  return room.map.width * room.map.height - before;
}
const publicFog = (room, c) => ({ mode: Fog.mode(), z: zOf(room), radius: c.fog ? c.fog.r : radiusFor(room), shared: shared(), off: noFog(c), explored: c.fog ? Fog.encode(c.fog.bits, room.map.width, room.map.height) : '' });

function snapshot(room) { return shared() && room.fogBits ? Fog.encode(room.fogBits, room.map.width, room.map.height) : undefined; }
function restore(room, str) { if (typeof str === 'string' && str) room.fogBits = Fog.decode(str, room.map.width, room.map.height); }

realtime.use({
  name: 'туман войны',
  welcome: (room, c) => { load(room, c); return { fog: publicFog(room, c) }; },
  tick: (room, dt, now) => { if (Fog.mode() === 'off') return; for (const c of room.players.values()) step(room, c, now); },
  onSave: (room, c) => { save(c); },
  beforeLeave: (room, c) => { save(c); },
  onLeave: (room, c) => { if (c.fog && c.fog.room === room) c.fog = null; },
  // против читов: в режиме on враги, жители и чужие спутники — только в круге обзора (квадрат чуть больше)
  viewRadius: (room, c) => (Fog.mode() === 'on' && Fog.settings.fogServerCull && !noFog(c) && c.fog ? Math.ceil(c.fog.r) + 2 : 0),
  // чужие игроки вне обзора не отправляются, если разведка не общая (общая — союзники видны всегда)
  viewPlayers: (room, c, list) => {
    if (Fog.mode() !== 'on' || !Fog.settings.fogServerCull || shared() || noFog(c) || !c.fog) return list;
    const r = c.fog.r + 1;
    return list.filter((o) => o.id === c.account.id || Fog.visible(c.pos.x, c.pos.y, o.x, o.y, r));
  },
});

module.exports = { load, step, save, revealAll, radiusFor, publicFog, snapshot, restore, noFog };
