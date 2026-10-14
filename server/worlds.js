'use strict';
// Миры: data/worlds/<id>.json — параметры генерации (сама карта воссоздаётся по сиду).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JsonFile, dataPath } = require('./store');
const worldstate = require('./worldstate');
const characters = require('./characters');
const bases = require('./bases');
const ngplus = require('./ngplus');
const config = require('./config');
const WorldGen = require('../shared/worldgen');
const Difficulty = require('../shared/difficulty');
require('../shared/settlements'); // застройка поселений (шаг 15) — дополнение к генерации карты
const { HttpError } = require('./auth');

const files = new Map();
const worldsDir = () => path.join(dataPath(), 'worlds');
const ID_RE = /^[0-9a-f-]{36}$/;

function fileFor(id) {
  if (!ID_RE.test(id)) throw new HttpError(404, 'Мир не найден.');
  if (!files.has(id)) files.set(id, new JsonFile(`worlds/${id}.json`, null, { kind: 'world' }));
  return files.get(id);
}

function load(id) {
  const w = fileFor(id).get();
  if (!w) throw new HttpError(404, 'Мир не найден.');
  return w;
}

function allWorlds() {
  let names = [];
  try { names = fs.readdirSync(worldsDir()).filter((n) => n.endsWith('.json')); } catch { /* папки ещё нет */ }
  return names.map((n) => n.slice(0, -5)).filter((id) => ID_RE.test(id)).map((id) => fileFor(id).get()).filter(Boolean);
}

// Доступ: владелец и участники (присоединились по коду приглашения)
const isOwner = (account, w) => w.ownerId === account.id;
const isMember = (account, w) => (w.members || []).some((m) => m.id === account.id);
function canAccess(account, w) {
  return isOwner(account, w) || isMember(account, w);
}

// Сколько игроков сейчас в мире — сообщает модуль реального времени
let onlineProvider = () => 0;
function setOnlineProvider(fn) { onlineProvider = fn; }
// Обработчики событий миров (удаление, закрытие) — для отключения игроков
const listeners = { removed: [], closed: [] };
function on(event, fn) { listeners[event].push(fn); }
const emit = (event, ...args) => listeners[event].forEach((fn) => fn(...args));

// Представление мира для конкретного аккаунта: код приглашения видит только владелец
function view(account, w) {
  const own = isOwner(account, w);
  const out = { ...w, own, open: Boolean(w.open), members: (w.members || []).map((m) => ({ id: m.id, username: m.username })),
    difficulty:w.difficulty||config.get().game.difficulty||'normal',maxPlayers: Math.min(8,config.get().game.maxPlayers),pvp:false, online: onlineProvider(w.id) };
  delete out._v; // служебная версия файла
  if (!own) delete out.inviteCode;
  else out.inviteCode = w.inviteCode || null;
  return out;
}

function list(account) {
  return allWorlds().filter((w) => canAccess(account, w)).sort((a, b) => b.createdAt - a.createdAt).map((w) => view(account, w));
}

// Внутренняя запись мира (для сервера)
function get(account, id) {
  const w = load(id);
  if (!canAccess(account, w)) throw new HttpError(404, 'Мир не найден.');
  return w;
}

function getView(account, id) {
  return view(account, get(account, id));
}

// Можно ли войти в мир прямо сейчас (закрытый мир — только владельцу)
function entryError(account, w) {
  if (!canAccess(account, w)) return 'Мир не найден или у вас нет доступа.';
  if (!isOwner(account, w) && !w.open) return 'Мир закрыт владельцем.';
  return null;
}

// ---------- Совместный доступ ----------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих символов (0/O, 1/I)
const codeLength = () => Math.max(4, Math.min(16, Math.round(config.get().game.inviteCodeLength)));
const normalizeCode = (code) => String(code || '').toUpperCase().replace(/[\s-]/g, '');

function newInviteCode() {
  const taken = new Set(allWorlds().map((w) => w.inviteCode).filter(Boolean));
  for (;;) {
    const bytes = crypto.randomBytes(codeLength());
    const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    if (!taken.has(code)) return code;
  }
}

function saveWorld(w) {
  const f = fileFor(w.id);
  f.data = w;
  f.save();
}

// Владелец открывает / закрывает мир и управляет кодом приглашения.
// input: { open?: boolean, invite?: 'new' | 'remove' }
function share(account, id, input = {}) {
  const w = get(account, id);
  if (!isOwner(account, w)) throw new HttpError(403, 'Менять доступ может только владелец мира.');
  if (input.open !== undefined) {
    if (typeof input.open !== 'boolean') throw new HttpError(400, 'Поле open должно быть true или false.');
    w.open = input.open;
  }
  if (input.invite !== undefined) {
    if (input.invite === 'new') w.inviteCode = newInviteCode();
    else if (input.invite === 'remove') w.inviteCode = null;
    else throw new HttpError(400, 'Поле invite: «new» или «remove».');
  }
  saveWorld(w);
  if (!w.open) emit('closed', w);
  return view(account, w);
}

// Присоединиться к чужому миру по коду: мир появится в списке как «чужой»
function join(account, code) {
  const c = normalizeCode(code);
  if (!c) throw new HttpError(400, 'Введите код приглашения.');
  const w = allWorlds().find((x) => x.inviteCode && x.inviteCode === c);
  if (!w) throw new HttpError(404, 'Мир с таким кодом не найден. Проверьте код или попросите владельца создать новый.');
  if (isOwner(account, w)) throw new HttpError(400, 'Это ваш собственный мир.');
  if (!w.open) throw new HttpError(403, 'Мир закрыт владельцем. Попросите открыть его.');
  if (!isMember(account, w)) {
    w.members = w.members || [];
    if (w.members.length >= config.get().game.maxWorldMembers) throw new HttpError(400, 'В мире уже максимальное число участников.');
    w.members.push({ id: account.id, username: account.username, joinedAt: Date.now() });
    saveWorld(w);
  }
  return view(account, w);
}

// Участник убирает чужой мир из своего списка
function leave(account, id) {
  const w = get(account, id);
  if (isOwner(account, w)) throw new HttpError(400, 'Владелец не может покинуть свой мир — его можно только удалить.');
  w.members = (w.members || []).filter((m) => m.id !== account.id);
  saveWorld(w);
}

// ---------- Кэш сгенерированных карт ----------
const mapCache = new Map(); // id -> world map (LRU)
function getMap(w) {
  const key = w.id + ':' + w.genVersion;
  if (mapCache.has(key)) {
    const m = mapCache.get(key);
    mapCache.delete(key); mapCache.set(key, m);
    return m;
  }
  const m = WorldGen.generate(w);
  mapCache.set(key, m);
  while (mapCache.size > Math.max(1, config.get().worldCacheSize)) mapCache.delete(mapCache.keys().next().value);
  return m;
}

function create(account, input) {
  const difficulty=input?.difficulty??config.get().game.difficulty??'normal';
  if(!Difficulty.MODES.some(x=>x.id===difficulty))throw new HttpError(400,'Выберите сложность игры.');
  const res = WorldGen.validateParams(input);
  if (!res.ok) throw new HttpError(400, res.errors.join('\n'), { errors: res.errors });
  const own = allWorlds().filter((w) => w.ownerId === account.id);
  if (own.length >= WorldGen.settings.maxWorlds) throw new HttpError(400, `Не больше ${WorldGen.settings.maxWorlds} миров на аккаунт.`);
  const v = res.value;
  const w = {
    version: 1,
    id: crypto.randomUUID(),
    ownerId: account.id,
    ownerName: account.username,
    createdAt: Date.now(),
    genVersion: WorldGen.GEN_VERSION,
    ...v,
    difficulty,
    ...WorldGen.dimensions(WorldGen.settings.worldSizes[v.size],v.shape),
    levels: { min: 0, max: 0 }, // вертикальные уровни: планируется от -5 до +10
    open: false, // открыт ли мир для участников
    inviteCode: null, // код приглашения (видит только владелец)
    members: [], // присоединившиеся по коду: [{ id, username, joinedAt }]
  };
  // «Новая игра+»: герой с концовкой начинает новый мир со своей базой; враги слабее (server/ngplus.js)
  if (input && input.newGamePlus) {
    const ch = characters.get(account, typeof input.characterId === 'string' ? input.characterId : '');
    w.ngPlus = ngplus.worldInfo(ch, bases.list(account)[0] || null);
  }
  const map = WorldGen.generate(w);
  w.mapHash = WorldGen.mapHash(map);
  w.spawn = map.spawn;
  // база героя переезжает в новый мир (участок подальше от точки появления)
  if (w.ngPlus && w.ngPlus.baseId) {
    const base = bases.findById(w.ngPlus.baseId);
    const at = base ? require('./building').moveToWorld(base, w.id, map) : null;
    w.ngPlus.basePlaced = at ? { x: at.x, y: at.y } : null;
  }
  saveWorld(w);
  mapCache.set(w.id + ':' + w.genVersion, map);
  return view(account, w);
}

function remove(account, id) {
  const w = get(account, id);
  if (!isOwner(account, w)) throw new HttpError(403, 'Удалить мир может только владелец. Чтобы убрать мир из списка, покиньте его.');
  const file = fileFor(id).file;
  fs.unlinkSync(file);
  files.delete(id);
  worldstate.remove(id);
  mapCache.delete(w.id + ':' + w.genVersion);
  emit('removed', w);
}

function setDifficulty(id,difficulty){
  if(!Difficulty.MODES.some(x=>x.id===difficulty))throw new HttpError(400,'Неизвестная сложность.');
  const world=load(id);world.difficulty=difficulty;saveWorld(world);return world;
}
module.exports = {
  setDifficulty,
  all: allWorlds, list, get, getView, create, remove, getMap, load, share, join, leave, entryError, isOwner, canAccess,
  setOnlineProvider, on, normalizeCode,
};
