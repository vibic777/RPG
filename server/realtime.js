'use strict';
// Реальное время (WebSocket на том же порту): вход в мир, до N игроков в мире,
// серверное движение (клиент присылает намерения — путь или направление, сервер двигает героя
// общим кодом shared/movement.js, проверяет каждый шаг и рассылает позиции с частотой тиков).
const { WebSocketServer } = require('ws');
const auth = require('./auth');
const characters = require('./characters');
const worlds = require('./worlds');
const config = require('./config');
const logger = require('./logger');
const M = require('../shared/movement');
const WorldGen = require('../shared/worldgen');
const P = require('../shared/protocol');
const Inv = require('../shared/inventory');
const Items = require('../shared/items');
const Levels = require('../shared/levels');
const NetFilter = require('./netfilter');

// ---------- Шаг 20: защита от сбоев ----------
// Ошибка в обработчике или расширении — в журнал (одинаковые — не чаще раза в 10 с), счётчик для оверлея и ГМ
const errStats = { count: 0, last: null, lastAt: 0, seen: new Map() };
function reportError(where, err) {
  errStats.count++;
  errStats.last = where + ': ' + (err && err.message ? err.message : String(err));
  errStats.lastAt = Date.now();
  const key = where + '|' + (err && err.message);
  if (Date.now() - (errStats.seen.get(key) || 0) < 10000) return;
  errStats.seen.set(key, Date.now());
  if (errStats.seen.size > 200) errStats.seen.clear();
  console.error(`[сбой] ${where}:`, err && err.stack ? err.stack : err);
}
function guard(where, fn) {
  try { return fn(); } catch (err) { if (!cfg().crashSafe) throw err; reportError(where, err); return undefined; }
}

const { CLOSE } = P;
const rooms = new Map(); // id комнаты -> Room: мир поверхности — id мира; уровень (шаг 13) — «<id мира>~<ключ уровня>»
const clients = new Set(); // все соединения
const byAccount = new Map(); // accountId -> Client в мире (одно активное соединение на аккаунт)
// расширения (чат, инвентарь, бой): { onJoin, onLeave, beforeLeave, onSave, welcome, handlers, tick, stateExtra, playerState, publicExtra, onDestroy, viewRadius, viewPlayers }
const plugins = [];
let wss = null;
let timers = [];

const cfg = () => config.get();

// Режим бога администратора (в памяти, по аккаунту — переживает переподключение, но не перезапуск сервера):
// invisible — не виден игрокам и врагам, invulnerable — не получает урона, fly — телепорт щелчком по карте сквозь препятствия
// infinite — бесконечные выносливость и мана; бесконечные патроны и флаги транспорта переключаются отдельно
// freeBuild — стройка без ресурсов и чертежей, speed — множитель скорости (1…game.cheatSpeedMax)
const NO_GOD = Object.freeze({ invisible: false, invulnerable: false, fly: false, noclip: false, infinite: false, infiniteAmmo: false, infiniteMoney: false, superAttack: false, instantMagic: false, vehicleInvulnerable: false, vehicleFuel: false, vehicleParts: false, vehicleAmmo: false, freeBuild: false, nofog: false, speed: 1 }); // nofog — без тумана войны (шаг 22)
const god = new Map();
const godOf = (accountId) => god.get(accountId) || NO_GOD;
const visibleTo = (viewer, c) => viewer === c || !(godOf(c.account.id).invisible || Items.setEffects(c.character).invisible) || viewer.account.role === 'admin';
const round2 = (v) => Math.round(v * 100) / 100;

function send(client, msg) {
  if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
}

// Закрыть соединение: сначала сообщение с понятной причиной, затем код закрытия
function kick(client, code, message) {
  if (client.closing) return;
  client.closing = true;
  send(client, { t: 'kicked', code, message: message || P.CLOSE_TEXT[code] || '' });
  try { client.ws.close(code, 'rm-' + code); } catch { /* уже закрыто */ }
  // если клиент не ответил на закрытие — разорвать
  setTimeout(() => { try { client.ws.terminate(); } catch { /* ignore */ } }, 2000).unref();
}

// ---------- Комната (мир с игроками) ----------

class Room {
  constructor(world, level = null) {
    this.id = level ? `${world.id}~${level.key}` : world.id;
    this.worldId = world.id;
    this.key=level?.key||'ground';
    this.world = level?.surfaceRegion||level?.regionKey ? {...world,settlementNamespace:level.regionKey||level.key}:world;
    this.region = level?.surfaceRegion ? level : null;
    this.level = level?.surfaceRegion ? null : level; // surface regions use all surface systems
    this.map = level || worlds.getMap(world);
    if(!this.level)this.map.openGates=new Set(); // cached map geometry must not retain old gate state
    this.players = new Map(); // accountId -> Client
    this.tickNo = 0;
    this.lastTick = Date.now();
    const rate = Math.max(1, Math.min(60, cfg().game.tickRate));
    this.tickTimer = setInterval(() => this.tick(), 1000 / rate);
    this.saveTimer = setInterval(() => this.saveAll(), Math.max(2, cfg().game.savePositionSec) * 1000);
  }

  broadcast(msg, except) {
    const text = JSON.stringify(msg);
    for (const c of this.players.values()) if (c !== except && c.ws.readyState === 1) c.ws.send(text);
  }

  tick() {
    const t0 = process.hrtime.bigint();
    try { this.tickInner(); } catch (err) { // шаг 20: сбой тика не останавливает таймер и сервер
      if (!cfg().crashSafe) throw err;
      reportError('тик комнаты ' + this.id, err);
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const p = this.perf || (this.perf = { ms: 0, max: 0, n: 0 });
    p.ms = p.n ? p.ms * 0.9 + ms * 0.1 : ms; p.max = Math.max(ms, p.max * 0.995); p.n++; p.last = ms;
  }

  tickInner() {
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.tickNo++;
    for (const c of this.players.values()) guard('движение', () => stepPlayer(this, c, dt));
    for (const p of plugins) if (p.tick) guard(p.name || 'расширение', () => p.tick(this, dt, now));
    const state = {
      t: 'state', tick: this.tickNo, time: now,
      players: [...this.players.values()].map((c) => {
        const o = { id: c.account.id, x: round2(c.pos.x), y: round2(c.pos.y), m: c.moving ? 1 : 0 };
        for (const p of plugins) if (p.playerState) Object.assign(o, p.playerState(c));
        return o;
      }),
    };
    for (const p of plugins) if (p.stateExtra) guard(p.name || 'расширение', () => Object.assign(state, p.stateExtra(this)));
    for (const c of this.players.values()) {
      const invisible = Items.setEffects(c.character).invisible;
      if (invisible !== Boolean(c.setInvisible)) {
        c.setInvisible = invisible;
        for (const viewer of this.players.values()) if (viewer !== c && viewer.account.role !== 'admin') send(viewer, invisible || godOf(c.account.id).invisible ? { t: 'leave', id: c.account.id, name: c.character.name, reason: 'hidden' } : { t: 'join', player: publicPlayer(c), quiet: true });
      }
    }
    const hidden = [...this.players.values()].filter((c) => godOf(c.account.id).invisible || c.setInvisible);
    // невидимый администратор: остальные игроки (не администраторы) его не получают
    const hiddenIds = new Set(hidden.map((c) => c.account.id));
    const cutPlayers = hidden.length ? state.players.filter((o) => !hiddenIds.has(o.id)) : state.players;
    // шаг 20: каждому — только ближние и изменившиеся враги, жители и спутники (радиус интереса и дельта)
    const g = cfg().game, every = Math.max(1, Math.round((g.netKeyframeSec || 0) * Math.max(1, Math.min(60, g.tickRate))));
    for (const c of this.players.values()) {
      if (c.ws.readyState !== 1) continue;
      let out = { ...state, players: c.account.role === 'admin' ? state.players : cutPlayers };
      // шаг 22: туман войны — расширение может сузить радиус (viewRadius) и отсечь игроков (viewPlayers)
      let view = g.netViewRadius;
      for (const p of plugins) if (p.viewRadius) { const v = p.viewRadius(this, c); if (v > 0) view = view > 0 ? Math.min(view, v) : v; }
      for (const p of plugins) if (p.viewPlayers) out = { ...out, players: p.viewPlayers(this, c, out.players) };
      const seen = c.netSeen || (c.netSeen = { phase: Math.floor(Math.random() * every) });
      const keyframe = NetFilter.isKeyframe(this.tickNo, seen.phase, every);
      for (const k of NetFilter.LISTS) {
        if (!state[k]) continue;
        out[k] = NetFilter.filterRows(state[k], c.pos, seen[k] || (seen[k] = new Map()), { radius: k === 'cp' ? 0 : view, delta: g.netDelta, keyframe });
      }
      c.ws.send(JSON.stringify(out));
    }
  }

  // Сообщение о subject — только тем, кто его видит
  broadcastAbout(subject, msg, except) {
    const text = JSON.stringify(msg);
    for (const c of this.players.values()) if (c !== except && c.ws.readyState === 1 && visibleTo(c, subject)) c.ws.send(text);
  }

  savePlayer(c) {
    for (const p of plugins) if (p.onSave) p.onSave(this, c);
    // Посаженный герой визуально следует за транспортом. В лодке эта точка
    // находится на воде и не является допустимой пешей позицией для сохранения.
    // Позицию запишем при высадке на берег.
    if (c.veh) return;
    if (Math.abs(c.pos.x - c.savedPos.x) < 0.01 && Math.abs(c.pos.y - c.savedPos.y) < 0.01) return;
    try {
      characters.savePosition(c.account, c.character.id, this.world, this.map, { x: c.pos.x, y: c.pos.y, z: this.level ? this.level.z : 0, level: this.key==='ground'?null:this.key });
      c.savedPos = { ...c.pos };
    } catch (err) {
      console.warn('[realtime] не удалось сохранить позицию:', err.message);
    }
  }

  saveAll() { for (const c of this.players.values()) this.savePlayer(c); }

  // Полное сохранение: герои, позиции и состояние мира (кнопка «Сохранить», события). Возвращает время.
  saveWorld() {
    this.saveAll();
    for (const p of plugins) if (p.onSaveWorld) p.onSaveWorld(this);
    return Date.now();
  }

  destroy() {
    for (const p of plugins) if (p.onDestroy) p.onDestroy(this);
    clearInterval(this.tickTimer);
    clearInterval(this.saveTimer);
    rooms.delete(this.id);
    require('./worldstate').release(this.id);
    require('./ground').release(this.id);
    const regionKey=this.region?.key||this.level?.regionKey;
    if(regionKey&&!worldRooms(this.worldId).some(r=>(r.region?.key||r.level?.regionKey)===regionKey))Levels.releaseRegion(worlds.getMap(this.world),regionKey);
  }
}

// Движение героя на сервере за dt секунд (тот же код, что предсказывает клиент)
// c.speedMul — множитель скорости от боя (бег, 0 — оглушён, обездвижен или мёртв)
// Проходимость дверей зависит от того, кто идёт (room.map.actor — id аккаунта; null — враги)
// Верхом на летающем драконе (server/companions.js) — room.map.flyer: вода и горы проходимы
// За рулём (шаг 14, server/vehicles.js) — room.map.drive: проходимость и скорость по правилам местности машины
const companions = () => require('./companions');
const vehicles = () => require('./vehicles');
function asActor(room, id, fn, c = null) {
  room.map.actor = id;
  room.map.buildElevation = c && c.buildElevation || 0;
  room.map.flyer = Boolean(c && ((c.mount && companions().flying(c)) || Items.setEffects(c.character).fly && require('./levels').airborne(c) || (c.account && godOf(c.account.id).noclip)));
  room.map.swimmer = Boolean(c) && !room.map.flyer; // герои плавают (шаг 13), враги — нет
  room.map.drive = c && c.veh ? vehicles().driveOf(c) : null;
  try { return fn(); } finally { room.map.buildElevation=0; room.map.actor = null; room.map.flyer = false; room.map.swimmer = false; room.map.drive = null; }
}
function stepPlayer(room, c, dt) { return asActor(room, c.account.id, () => stepPlayerInner(room, c, dt), c); }
function stepPlayerInner(room, c, dt) {
  const from = c.pos;
  const mul = c.speedMul === undefined ? 1 : c.speedMul;
  let to = from;
  if (mul <= 0) { c.moving = false;c.surfaceVelocity={vx:0,vy:0}; return; }
  if (c.dir) {
    const step = M.speedAt(room.map, from.x, from.y, mul) * dt;
    to = M.moveWithCollision(room.map, from, c.dir.dx * step, c.dir.dy * step);
  } else if (c.path.length) {
    const r = M.followPath(room.map, from, c.path, dt, mul);
    to = r.pos;
    c.path = r.path;
  }
  const slippery=!c.veh&&!room.map.flyer&&require('./magic-fields').slippery(room,from);
  to=M.surfaceMove(room.map,from,to,c.surfaceVelocity||(c.surfaceVelocity={}),dt,slippery,M.speedAt(room.map,from.x,from.y,mul));
  if (to.x === from.x && to.y === from.y) { c.moving = false; return; }
  const err = M.validateStep(room.map, from, to, dt, mul);
  if (err) { // не должно случаться: защита от ошибок расчёта
    c.path = []; c.dir = null; c.moving = false;
    send(c, { t: 'reject', reason: err, x: from.x, y: from.y });
    return;
  }
  c.pos = { x: to.x, y: to.y };
  c.moving = true;
}

// Точка появления; если на ней уже стоит игрок — ближайшая свободная проходимая клетка рядом
function freeSpawn(room, point = room.map.spawn) {
  const { x: sx, y: sy } = point;
  const taken = (x, y) => [...room.players.values()].some((c) => Math.floor(c.pos.x) === x && Math.floor(c.pos.y) === y);
  const grid = room.grid || (room.grid = M.gridFromWorld(room.map));
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = sx + dx, y = sy + dy;
        if (!WorldGen.isWalkable(room.map, x, y) || taken(x, y)) continue;
        if (r && !M.findPath(grid, sx, sy, x, y, 200)) continue; // та же суша, без стен между
        return { x: x + 0.5, y: y + 0.5 };
      }
    }
  }
  return { x: sx + 0.5, y: sy + 0.5 };
}

// Все комнаты мира: поверхность и открытые уровни (шаг 13)
function worldRooms(worldId) { const out = []; for (const r of rooms.values()) if ((r.worldId || r.id) === worldId) out.push(r); return out; }
const worldPlayers = (worldId) => worldRooms(worldId).reduce((n, r) => n + r.players.size, 0);
// Комната уровня (создаётся по требованию); key 'ground' или null — поверхность
// who — кто входит (уровень врагов подстраивается под героев в мирах с подстройкой)
function roomFor(world, key, who = null) {
  const id = key && key !== 'ground' ? `${world.id}~${key}` : world.id;
  let room = rooms.get(id);
  if (room) return room;
  let level = null;
  if (id !== world.id) { level = Levels.level(worlds.getMap(world), key); if (!level) return null; }
  room = new Room(world, level);
  room.hintLevel = who && who.character ? who.character.level || 1 : 1;
  rooms.set(id, room);
  for (const p of plugins) if (p.onRoom) p.onRoom(room); // новая комната: заселить уровень (server/levels.js)
  return room;
}
// Сохранённая позиция героя в мире: { key, x, y } (key — 'ground' или ключ уровня)
function savedSpot(character, world) {
  const saved = character.positions && character.positions[world.id];
  if (!saved) return null;
  if (saved.level && Levels.parseKey(worlds.getMap(world), saved.level)) return { key: saved.level, x: saved.x, y: saved.y };
  return { key: 'ground', x: saved.x, y: saved.y };
}

function publicPlayer(c) {
  return {
    id: c.account.id, account: c.account.username, admin: c.account.role === 'admin',
    name: c.character.name, level: c.character.level, appearance: c.character.appearance,
    x: round2(c.pos.x), y: round2(c.pos.y), m: c.moving ? 1 : 0, look: Inv.look(c.character),
    ...Object.assign({}, ...plugins.map((p) => (p.publicExtra ? p.publicExtra(c) : {}))),
  };
}

// ---------- Сообщения клиента ----------

function onHello(client, msg) {
  const r = auth.resolveToken(msg.token);
  if (r.error === 'banned') return kick(client, CLOSE.BANNED, r.message);
  if (r.error) return kick(client, CLOSE.AUTH);
  const account = r.account;
  client.token = msg.token;

  let world, character;
  try { world = worlds.load(typeof msg.worldId === 'string' ? msg.worldId : ''); } catch { return kick(client, CLOSE.NO_ACCESS, 'Мир не найден.'); }
  const entryErr = worlds.entryError(account, world);
  if (entryErr) return kick(client, CLOSE.NO_ACCESS, entryErr);
  try { character = characters.get(account, typeof msg.characterId === 'string' ? msg.characterId : ''); } catch { return kick(client, CLOSE.NO_ACCESS, 'Персонаж не найден.'); }

  // тот же аккаунт уже в игре (другая вкладка / обрыв связи) — старое соединение закрывается
  const prev = byAccount.get(account.id);
  let startPos = null;
  if (prev && prev !== client) {
    if (prev.room && prev.room.worldId === world.id && prev.character.id === character.id) startPos = { ...prev.pos, key: prev.room.key||'ground' };
    leaveRoom(prev, 'replaced');
    kick(prev, CLOSE.REPLACED);
  }

  const isOwner = worlds.isOwner(account, world);
  if (cfg().game.requireOwnerOnline && !isOwner && !worldRooms(world.id).some((r) => [...r.players.values()].some((c) => worlds.isOwner(c.account, world)))) {
    return kick(client, CLOSE.HOST_OFFLINE, 'Владелец мира сейчас не в игре. Войти можно, когда он будет в мире.');
  }
  if (worldPlayers(world.id) >= Math.min(8,cfg().game.maxPlayers)) {
    return kick(client, CLOSE.FULL, `В мире нет свободных мест (предел — ${Math.min(8,cfg().game.maxPlayers)} игроков).`);
  }
  // уровень, на котором герой вышел (шаг 13); уровни выключены или ключ устарел — поверхность
  const spot = startPos || savedSpot(character, world) || { key: 'ground' };
  let room = (spot.key !== 'ground' && cfg().game.levelsEnabled !== false && roomFor(world, spot.key, { character })) || roomFor(world, 'ground');
  const pos = spot.x !== undefined && (room.key||'ground') === spot.key
    && !asActor(room, account.id, () => M.validatePosition(room.map, { x: spot.x, y: spot.y }), {}) ? { x: spot.x, y: spot.y } : freeSpawn(room);
  Object.assign(client, { account, character, world, isOwner, joinedAt: Date.now() });
  joinRoom(client, room, pos);
}

// Войти в комнату (мир или уровень) на позицию pos: приветствие со всем состоянием, оповещение остальных
function joinRoom(client, room, pos, quiet = false) {
  const { account } = client;
  if (!quiet) logger.write('info', `[game] вход: ${account.username}/${client.character.name} в мир ${room.world.name} (${room.worldId})`);
  Object.assign(client, { room, pos: { x: pos.x, y: pos.y }, savedPos: quiet ? { x: -1, y: -1 } : { x: pos.x, y: pos.y }, path: [], dir: null, moving: false });
  client.netSeen=null;
  room.players.set(account.id, client);
  byAccount.set(account.id, client);
  const welcome = {
    t: 'welcome', v: P.VERSION, you: account.id, worldId: room.worldId, owner: client.isOwner, tickRate: Math.max(1, Math.min(60, cfg().game.tickRate)),
    time: Date.now(), players: [...room.players.values()].filter((c) => visibleTo(client, c)).map(publicPlayer), god: godOf(account.id),
  };
  for (const p of plugins) if (p.welcome) Object.assign(welcome, p.welcome(room, client));
  send(client, welcome);
  room.broadcastAbout(client, { t: 'join', player: publicPlayer(client), quiet, level: quiet ? 1 : 0 }, client);
  client.levelMove = quiet;
  try { for (const p of plugins) if (p.onJoin) p.onJoin(room, client); } finally { client.levelMove = false; }
  if (quiet) room.savePlayer(client); // после перехода уровень запоминается сразу
}

// Переход на другой уровень того же мира (решает сервер: server/levels.js проверяет вход, снаряжение и т. п.).
// key — 'ground' или ключ уровня; x, y — клетка прибытия. Возвращает текст ошибки или null.
function changeLevel(client, key, x, y) {
  const from = client.room;
  if (!from) return 'Герой не в мире.';
  const world = from.world;
  const target = roomFor(world, key, client);
  if (!target) return 'Такого уровня нет.';
  if (target === from) { teleport(client, x + 0.5, y + 0.5); return null; }
  const lim = cfg().game.levelMaxPlayers;
  if (lim > 0 && target.level && target.players.size >= lim) { if (!target.players.size) target.destroy(); return `На этом уровне уже ${lim} героев.`; }
  client.levelMove = true;
  try { leaveRoom(client, 'level'); } finally { client.levelMove = false; }
  byAccount.set(client.account.id, client);
  joinRoom(client, target, freeSpawn(target, { x, y }), true);
  return null;
}

// Путь по клеткам: [[x, y], ...]. Если начало пути отстаёт от серверной позиции (задержка сети),
// сервер достраивает короткий мостик поиском пути.
function onPath(client, msg) { return client.room ? asActor(client.room, client.account.id, () => onPathInner(client, msg), client) : onPathInner(client, msg); }
function onPathInner(client, msg) {
  if(client.controlledComp){const goal=Array.isArray(msg.path)&&msg.path.at(-1);if(goal)require("./companion-control").input(client,{action:"move",x:goal[0],y:goal[1]});return;}
  const room = client.room;
  let path = msg.path;
  if (Array.isArray(path) && path.length && Array.isArray(path[0]) && Number.isInteger(path[0][0]) && Number.isInteger(path[0][1])) {
    const cx = Math.floor(client.pos.x), cy = Math.floor(client.pos.y);
    const gap = Math.max(Math.abs(path[0][0] - cx), Math.abs(path[0][1] - cy));
    if (gap > 1 && gap <= cfg().game.pathStartTolerance) {
      const grid = room.map.drive ? M.gridFromWorld(room.map) : (room.grid || (room.grid = M.gridFromWorld(room.map)));
      const bridge = M.findPath(grid, cx, cy, path[0][0], path[0][1], 500);
      if (bridge) path = bridge.concat(path.slice(1));
    }
  }
  const err = M.validatePath(room.map, client.pos, path, cfg().game.maxPathLength);
  if (err) {
    send(client, { t: 'reject', reason: err, x: round2(client.pos.x), y: round2(client.pos.y) });
    return;
  }
  client.path = path.map((c) => [c[0], c[1]]);
  client.dir = null;
}

// Направление (клавиши): { dx, dy } в координатах клеток; (0, 0) — стоп
function onDir(client, msg) {
  if(client.controlledComp)return require("./companion-control").input(client,{...msg,action:"dir"});
  const dx = Number(msg.dx), dy = Number(msg.dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return send(client, { t: 'error', message: 'Некорректное направление.' });
  const len = Math.hypot(dx, dy);
  client.path = [];
  client.dir = len < 1e-6 ? null : { dx: dx / len, dy: dy / len };
}

const HANDLERS = {
  path: onPath,
  dir: onDir,
  stop: (client) => { if(client.controlledComp)return require('./companion-control').input(client,{action:'stop'});client.path = []; client.dir = null; },
  save: onSave,
  bye: (client) => { leaveRoom(client, 'bye'); try { client.ws.close(CLOSE.NORMAL, 'bye'); } catch { /* ignore */ } },
  perf: onPerf,
};

// Шаг 20: оверлей производительности (F8) — тик сервера, трафик этому клиенту, враги (бодрые / все), пинг по echo
function onPerf(client, msg) {
  const room = client.room, now = Date.now();
  const dt = Math.max(0.2, (now - (client.perfAt || client.joinedAt || now - 1000)) / 1000);
  const kbps = (client.bytesOut - (client.perfBytes || 0)) / 1024 / dt;
  client.perfAt = now; client.perfBytes = client.bytesOut;
  const p = room.perf || { ms: 0, max: 0 }, cs = room.combat;
  send(client, {
    t: 'perf', echo: typeof msg.echo === 'number' ? msg.echo : null, tickMs: Math.round(p.ms * 100) / 100, tickMax: Math.round(p.max * 100) / 100,
    rate: cfg().game.tickRate, players: room.players.size, enemies: cs ? cs.enemies.size : 0, awake: cs && cs.awake !== undefined ? cs.awake : null,
    kbps: Math.round(kbps * 10) / 10, errors: errStats.count, rooms: rooms.size, mem: Math.round(process.memoryUsage().rss / 1048576),
  });
}

// Кнопка «Сохранить» в меню Esc: владелец мира или администратор, не чаще game.manualSaveCooldownSec
function onSave(client) {
  const room = client.room;
  if (!room) return;
  if (!worlds.isOwner(client.account, room.world) && client.account.role !== 'admin') {
    return send(client, { t: 'saved', ok: false, message: 'Сохранять мир может только его владелец (мир и так сохраняется автоматически).' });
  }
  const now = Date.now(), wait = (room.lastManualSave || 0) + cfg().game.manualSaveCooldownSec * 1000 - now;
  if (wait > 0) return send(client, { t: 'saved', ok: false, message: `Мир только что сохранён — повторить можно через ${Math.ceil(wait / 1000)} с.` });
  room.lastManualSave = now;
  const at = room.saveWorld();
  send(client, { t: 'saved', ok: true, at, message: 'Игра сохранена.' });
}

function onMessage(client, data) {
  // защита от флуда
  const now = Date.now();
  if (now - client.msgWindow >= 1000) { client.msgWindow = now; client.msgCount = 0; }
  if (++client.msgCount > cfg().wsMaxMsgPerSec) {
    if (client.msgCount === cfg().wsMaxMsgPerSec + 1) send(client, { t: 'error', message: 'Слишком много сообщений — часть отброшена.' });
    return;
  }
  let msg;
  try { msg = JSON.parse(data); } catch { return send(client, { t: 'error', message: 'Некорректное сообщение.' }); }
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return send(client, { t: 'error', message: 'Некорректное сообщение.' });
  if (!client.room) {
    if (msg.t !== 'hello' || client.helloSeen) return kick(client, CLOSE.PROTOCOL, 'Сначала нужно приветствие (hello).');
    client.helloSeen = true;
    clearTimeout(client.authTimer);
    return onHello(client, msg);
  }
  const h = HANDLERS[msg.t] || plugins.map((p) => p.handlers && p.handlers[msg.t]).find(Boolean);
  if (!h) return send(client, { t: 'error', message: `Неизвестный тип сообщения: ${String(msg.t).slice(0, 20)}` });
  try { h(client, msg); } catch (err) { // шаг 20: сбой одного обработчика не роняет сервер
    if (!cfg().crashSafe) throw err;
    reportError('сообщение «' + String(msg.t).slice(0, 20) + '»', err);
    send(client, { t: 'error', message: 'Ошибка сервера при обработке действия — оно отменено. Подробности — в журнале сервера.' });
  }
}

// Уход игрока из мира: сохранить позицию, оповестить остальных
function leaveRoom(client, reason) {
  const room = client.room;
  if (!room) return;
  if (reason !== 'level') logger.write('info', `[game] выход: ${client.account.username}/${client.character.name} из мира ${room.world.name} (${room.worldId}), причина: ${reason}`);
  for (const p of plugins) if (p.beforeLeave) p.beforeLeave(room, client, reason);
  client.room = null;
  room.savePlayer(client);
  if (room.players.get(client.account.id) === client) room.players.delete(client.account.id);
  if (byAccount.get(client.account.id) === client) byAccount.delete(client.account.id);
  room.broadcastAbout(client, { t: 'leave', id: client.account.id, name: client.character.name, reason });
  for (const p of plugins) if (p.onLeave) p.onLeave(room, client, reason);
  if (!room.players.size) room.destroy();
  if (reason === 'level') return; // переход между уровнями — герой остаётся в мире
  // владелец ушёл, а гости могут быть только при нём (на любом уровне мира)
  if (cfg().game.requireOwnerOnline && worlds.isOwner(client.account, room.world)) {
    for (const r of worldRooms(room.worldId)) {
      for (const c of [...r.players.values()]) {
        leaveRoom(c, 'host-offline');
        kick(c, CLOSE.HOST_OFFLINE, 'Владелец покинул мир.');
      }
    }
  }
}

// ---------- Подключение к HTTP-серверу ----------

function attach(server) {
  const c = cfg();
  wss = new WebSocketServer({
    noServer: true, maxPayload: c.wsMaxPayloadKb * 1024,
    // шаг 20: сжатие длинных сообщений (welcome, списки); короткие state идут как есть
    perMessageDeflate: c.wsCompress ? { threshold: c.wsCompressThreshold, zlibDeflateOptions: { level: 1 }, serverNoContextTakeover: true, clientNoContextTakeover: true } : false,
  });
  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { /* ignore */ }
    if (pathname !== c.wsPath) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    const client = { ws, room: null, lastPong: Date.now(), msgWindow: 0, msgCount: 0, closing: false, bytesOut: 0 };
    const rawSend = ws.send.bind(ws); // учёт исходящего трафика (оверлей F8, замеры)
    ws.send = (data, ...rest) => { client.bytesOut += typeof data === 'string' ? Buffer.byteLength(data) : data.length || 0; return rawSend(data, ...rest); };
    clients.add(client);
    client.authTimer = setTimeout(() => kick(client, CLOSE.PROTOCOL, 'Нет приветствия от клиента.'), c.wsAuthTimeoutSec * 1000);
    ws.on('pong', () => { client.lastPong = Date.now(); });
    ws.on('message', (data, isBinary) => { if (!isBinary) onMessage(client, data.toString('utf8')); });
    ws.on('close', (code) => {
      clearTimeout(client.authTimer);
      clients.delete(client);
      leaveRoom(client, [1000, 1001, 1005].includes(code) ? 'bye' : 'disconnect'); // чистое закрытие (1001 — вкладка закрыта, 1005 — без кода)
    });
    ws.on('error', () => { /* закрытие обработает 'close' */ });
  });

  // Проверка живости соединений: молчит дольше wsPongTimeoutSec — обрываем (герой сразу уходит из мира)
  timers.push(setInterval(() => {
    const now = Date.now();
    for (const cl of clients) {
      if (now - cl.lastPong > cfg().wsPongTimeoutSec * 1000) { leaveRoom(cl, 'timeout'); cl.ws.terminate(); continue; }
      try { cl.ws.ping(); } catch { /* ignore */ }
    }
  }, c.wsPingSec * 1000));

  // Перепроверка сессий: бан (в т. ч. правкой файла), выход, истечение срока
  timers.push(setInterval(() => {
    for (const cl of clients) {
      if (!cl.room || cl.closing) continue;
      const r = auth.resolveToken(cl.token);
      if (r.error === 'banned') { leaveRoom(cl, 'banned'); kick(cl, CLOSE.BANNED, r.message); }
      else if (r.error) { leaveRoom(cl, 'auth'); kick(cl, CLOSE.AUTH); }
    }
  }, c.wsBanCheckSec * 1000));

  // Бан через API — отключить сразу
  auth.events.on('role', (account) => { if (account.role !== 'admin') god.delete(account.id); });
  auth.events.on('ban', (account) => {
    const cl = byAccount.get(account.id);
    if (cl) { leaveRoom(cl, 'banned'); kick(cl, CLOSE.BANNED, auth.banMessage(account)); }
  });
  // Мир закрыт — гости отключаются; мир удалён — отключаются все
  worlds.on('closed', (w) => {
    for (const room of worldRooms(w.id)) {
      for (const cl of [...room.players.values()]) {
        if (worlds.isOwner(cl.account, w)) continue;
        leaveRoom(cl, 'closed');
        kick(cl, CLOSE.NO_ACCESS, 'Владелец закрыл мир.');
      }
    }
  });
  worlds.on('removed', (w) => {
    for (const room of worldRooms(w.id)) {
      room.removed = true; // состояние удалённого мира не сохраняется
      for (const cl of [...room.players.values()]) { leaveRoom(cl, 'removed'); kick(cl, CLOSE.NO_ACCESS, 'Мир удалён владельцем.'); }
    }
  });
  worlds.setOnlineProvider((id) => worldPlayers(id));
  return wss;
}

// Режим бога: изменить флаги (только администратор). Невидимость сразу убирает / возвращает героя у остальных.
function setGod(client, flags) {
  const old = godOf(client.account.id);
  const next = { ...old };
  for (const k of Object.keys(NO_GOD)) if (k !== 'speed' && typeof flags[k] === 'boolean') next[k] = flags[k];
  if (flags.speed !== undefined && Number.isFinite(Number(flags.speed))) next.speed = Math.round(Math.max(1, Math.min(config.get().game.cheatSpeedMax || 5, Number(flags.speed))) * 10) / 10;
  if (Object.entries(next).some(([k, v]) => (k === 'speed' ? v !== 1 : Boolean(v)))) god.set(client.account.id, next); else god.delete(client.account.id);
  const room = client.room;
  if (room && next.invisible !== old.invisible) {
    const msg = next.invisible || Items.setEffects(client.character).invisible ? { t: 'leave', id: client.account.id, name: client.character.name, reason: 'hidden' } : { t: 'join', player: publicPlayer(client), quiet: true };
    const text = JSON.stringify(msg);
    for (const c of room.players.values()) if (c !== client && c.account.role !== 'admin' && c.ws.readyState === 1) c.ws.send(text);
  }
  if (next.instantMagic && client.cb) { client.cb.casting=null;client.cb.gcdUntil=0;client.cb.spellCd={}; }
  send(client, { t: 'god', god: next });
  return next;
}

// Мгновенно переместить героя (администратор): у всех, кто его видит, — сообщение teleported
function teleport(client, x, y) {
  const room = client.room;
  if (!room) throw new Error('Игрок не в мире.');
  client.pos = { x: round2(x), y: round2(y) };
  client.path = []; client.dir = null; client.moving = false;client.surfaceVelocity={vx:0,vy:0};
  room.broadcastAbout(client, { t: 'teleported', id: client.account.id, x: client.pos.x, y: client.pos.y });
  send(client, { t: 'teleported', id: client.account.id, x: client.pos.x, y: client.pos.y });
  room.savePlayer(client);
}

// Корректное завершение: сохранить позиции, предупредить игроков (они переподключатся)
function shutdown() {
  for (const t of timers) clearInterval(t);
  timers = [];
  for (const cl of [...clients]) {
    if (cl.room) leaveRoom(cl, 'shutdown');
    kick(cl, CLOSE.SHUTDOWN);
  }
}

function use(plugin) { plugins.push(plugin); }

module.exports = { reportError, guard, errStats, attach, shutdown, use, rooms, byAccount, send, kick, publicPlayer, freeSpawn, leaveRoom, godOf, setGod, teleport, visibleTo, worldRooms, worldPlayers, roomFor, changeLevel, asActor };
