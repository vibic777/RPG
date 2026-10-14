'use strict';
// Игровые события (GDD §13): хранятся в data/events.json, срабатывают по расписанию или командой администратора.
// Ядро для панели ГМ (шаг 8): список, создание, запуск, удаление; типы событий регистрируют другие модули
// (server/combat.js: superboss — супер-босс со свитой, boss — главарь банды, horde — орда зомби; announce — объявление).
//
// Событие: { id, type, worldId (null — все миры, где есть игроки), at (время следующего запуска, мс),
//   everyMin (0 — один раз), text?, enemy?, status: 'scheduled' | 'done' | 'cancelled', createdBy, createdAt,
//   runs, lastRunAt, lastResult }
// Разовое событие ждёт, пока в мире (в любом мире для worldId = null) будут игроки — тогда срабатывает.
const crypto = require('crypto');
const config = require('./config');
const { JsonFile, registerSchema } = require('./store');
const { HttpError } = require('./auth');

registerSchema('events', 1);
const file = new JsonFile('events.json', { events: [] }, { kind: 'events' });
const types = new Map(); // type → { label, run(event, room) → строка-результат | null (не удалось) }
let roomsProvider = () => new Map();
let logger = () => {};
let timer = null;

// opts.rooms(ev, rooms) — свои миры для события (например, где сейчас адресат); opts.duration — событие длится durationMin
function registerType(type, label, run, opts = {}) { types.set(type, { label, run, ...opts }); }
function setRooms(fn) { roomsProvider = fn; }
function setLogger(fn) { logger = fn; }
const cfg = () => config.get();

function list() { return file.get().events; }
function find(id) {
  const e = list().find((x) => x.id === id || x.id.startsWith(String(id || '-')));
  if (!e) throw new HttpError(404, `Событие «${id}» не найдено.`);
  return e;
}

// Создать событие. input: { type, worldId?, inMin? | at?, everyMin?, text?, enemy? }
function add(admin, input = {}) {
  const type = String(input.type || '');
  if (!types.has(type)) throw new HttpError(400, `Неизвестный тип события «${type}». Типы: ${[...types.keys()].join(', ')}.`);
  const everyMin = input.everyMin === undefined || input.everyMin === null || input.everyMin === '' ? 0 : Number(input.everyMin);
  if (!Number.isFinite(everyMin) || everyMin < 0 || (everyMin > 0 && everyMin < cfg().eventMinIntervalMin)) {
    throw new HttpError(400, `Повтор — 0 (один раз) или не чаще раза в ${cfg().eventMinIntervalMin} мин.`);
  }
  let at;
  if (input.at !== undefined) at = typeof input.at === 'string' ? Date.parse(input.at) : Number(input.at);
  else {
    const inMin = input.inMin === undefined || input.inMin === '' ? 0 : Number(input.inMin);
    if (!Number.isFinite(inMin) || inMin < 0) throw new HttpError(400, 'Через сколько минут — число ≥ 0.');
    at = Date.now() + inMin * 60000;
  }
  if (!Number.isFinite(at)) throw new HttpError(400, 'Неверное время события.');
  const db = file.get();
  if (db.events.filter((e) => e.status === 'scheduled').length >= cfg().eventMaxScheduled) throw new HttpError(409, `Запланировано слишком много событий (предел ${cfg().eventMaxScheduled}).`);
  const text = input.text ? String(input.text).slice(0, cfg().chatMaxLength) : '';
  if ((type === 'announce' || type === 'message') && !text.trim()) throw new HttpError(400, 'Для сообщения нужен текст.');
  const t = types.get(type);
  let durationMin = 0;
  if (t.duration) {
    durationMin = Number(input.durationMin);
    if (!Number.isFinite(durationMin) || durationMin <= 0 || durationMin > cfg().eventMaxDurationMin) throw new HttpError(400, `Длительность — от 0 до ${cfg().eventMaxDurationMin} мин.`);
  }
  const target = input.target ? String(input.target).slice(0, 40) : null;
  if (t.needsTarget && !target) throw new HttpError(400, 'Укажите адресата.');
  const ev = {
    id: crypto.randomBytes(4).toString('hex'), type, worldId: input.worldId || null, at, everyMin, text, enemy: input.enemy ? String(input.enemy).slice(0, 40) : null,
    durationMin, target,
    status: 'scheduled', createdBy: admin ? admin.username : 'server', createdAt: Date.now(), runs: 0, lastRunAt: null, lastResult: null,
  };
  db.events.push(ev);
  // храним только последние завершённые
  const done = db.events.filter((e) => e.status !== 'scheduled');
  if (done.length > cfg().eventHistory) { const drop = new Set(done.slice(0, done.length - cfg().eventHistory)); db.events = db.events.filter((e) => !drop.has(e)); }
  file.save();
  if (admin) logger(admin, 'event-add', { event: ev.id, type, worldId: ev.worldId, at: new Date(at).toISOString(), everyMin });
  return ev;
}

function remove(admin, id) {
  const ev = find(id);
  ev.status = 'cancelled';
  file.save();
  if (admin) logger(admin, 'event-remove', { event: ev.id, type: ev.type });
  return ev;
}

// Миры, где событие может сработать сейчас (с игроками)
function targetRooms(ev) {
  const rooms = roomsProvider();
  const t = types.get(ev.type);
  if (t && t.rooms) return t.rooms(ev, rooms);
  const out = [];
  for (const room of rooms.values()) if (room.players.size && (!ev.worldId || (room.worldId || room.id) === ev.worldId)) out.push(room); // все уровни мира (шаг 13)
  return out;
}

// Запустить событие. manual — командой администратора (срабатывает сразу, даже если время не пришло).
// Возвращает { ran, results } — ran: сработало ли хоть в одном мире.
function run(ev, { admin = null, now = Date.now() } = {}) {
  const t = types.get(ev.type);
  const rooms = targetRooms(ev);
  const results = [];
  for (const room of rooms) {
    try { const r = t.run(ev, room); if (r) results.push(r); } catch (e) { results.push(`ошибка: ${e.message}`); }
  }
  const ran = results.length > 0;
  if (ran) {
    ev.runs += 1;
    ev.lastRunAt = now;
    ev.lastResult = results.join('; ').slice(0, 300);
    if (ev.everyMin > 0) ev.at = now + ev.everyMin * 60000;
    else if (ev.status === 'scheduled') ev.status = 'done';
    file.save();
  }
  if (admin) logger(admin, 'event-run', { event: ev.id, type: ev.type, ran, result: ev.lastResult });
  return { ran, results };
}

// Проверка расписания (таймер eventCheckSec)
function check(now = Date.now()) {
  let n = 0;
  for (const ev of list()) {
    if (ev.status !== 'scheduled' || ev.at > now) continue;
    if (run(ev, { now }).ran) n++;
  }
  return n;
}

function start() {
  stop();
  if (cfg().eventCheckSec > 0) { timer = setInterval(() => { try { check(); } catch (e) { console.warn('[events]', e.message); } }, cfg().eventCheckSec * 1000); timer.unref(); }
}
function stop() { if (timer) clearInterval(timer); timer = null; }

// Действующее событие-«бафф» (например, двойной лут): сработало и ещё не кончилось, для этого мира или для всех
function active(type, worldId, now = Date.now()) {
  return list().some((e) => e.type === type && e.lastRunAt && e.durationMin && e.status !== 'cancelled'
    && now < e.lastRunAt + e.durationMin * 60000 && (!e.worldId || e.worldId === worldId));
}

const typeList = () => [...types.entries()].map(([id, t]) => ({ id, label: t.label, duration: Boolean(t.duration), needsTarget: Boolean(t.needsTarget) }));

module.exports = { active, registerType, setRooms, setLogger, list, find, add, remove, run, check, start, stop, types: typeList };
