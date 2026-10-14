'use strict';
// Базы героев: data/bases/<accountId>.json — отдельно от миров и персонажей (GDD §8: «база сохраняется отдельно
// и может быть поставлена в точке размещения в любом мире»; §11: новую игру можно начать с сохранённой базой).
// Сейчас это слот и формат; строительство (сооружения, склад, турели базы) наполнит его на шаге строительства.
//
// Формат базы (версия схемы файла — поле _v, вид 'bases'):
// {
//   id, name, ownerId, createdAt, updatedAt,
//   placed: null | { worldId, x, y, at },  // где стоит сейчас; null — «свёрнута», переносится в любой мир
//   size: { w, h },                          // участок в клетках относительно точки размещения
//   structures: [ { id, type, x, y, rot, hp, tier, data } ],  // сооружения, координаты — внутри участка
//   storage: [ { id, count, ... } ],         // склад: предметы в том же виде, что в инвентаре
//   turrets: [ { item, x, y, tier, mode } ], // стационарные турели базы
//   stash: []                                 // контейнер-уменьшитель (GDD §8.1): объекты, живые и неживые
// }
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { JsonFile, registerSchema, dataPath } = require('./store');
const config = require('./config');
const { HttpError } = require('./auth');

registerSchema('bases', 1);
const files = new Map();
function fileFor(accountId) {
  if (!/^[0-9a-f-]{36}$/.test(accountId)) throw new HttpError(400, 'Некорректный аккаунт.');
  if (!files.has(accountId)) files.set(accountId, new JsonFile(`bases/${accountId}.json`, { bases: [] }, { kind: 'bases' }));
  return files.get(accountId);
}
const G = () => config.get().game;

function blank(ownerId, name) {
  const now = Date.now();
  return { id: crypto.randomUUID(), name, ownerId, createdAt: now, updatedAt: now, placed: null, size: { w: G().baseSize, h: G().baseSize }, structures: [], storage: [], turrets: [], stash: [] };
}

function cleanName(name) {
  const n = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  if (n.length < 1 || n.length > 32) throw new HttpError(400, 'Название базы — от 1 до 32 символов.');
  return n;
}

function list(account) { return fileFor(account.id).get().bases; }

function get(account, id) {
  const b = list(account).find((x) => x.id === id);
  if (!b) throw new HttpError(404, 'База не найдена.');
  return b;
}

function create(account, input = {}) {
  const f = fileFor(account.id);
  const db = f.get();
  if (db.bases.length >= G().maxBasesPerAccount) throw new HttpError(409, `Баз на аккаунт — не больше ${G().maxBasesPerAccount}.`);
  const b = blank(account.id, cleanName(input.name || 'База'));
  db.bases.push(b);
  f.save();
  return b;
}

function rename(account, id, name) {
  const f = fileFor(account.id);
  const b = get(account, id);
  b.name = cleanName(name);
  b.updatedAt = Date.now();
  f.save();
  return b;
}

// Проверка базы из чужого источника (импорт): известные поля, разумные размеры
function validate(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'База — не объект.';
  for (const k of ['structures', 'storage', 'turrets', 'stash']) if (b[k] !== undefined && !Array.isArray(b[k])) return `База: поле ${k} должно быть списком.`;
  if ((b.structures || []).length > G().baseMaxStructures) return 'База: слишком много сооружений.';
  return null;
}

// ---------- Для строительства (server/building.js) ----------
const ID_RE = /^[0-9a-f-]{36}$/;
function accountIds() {
  try { return fs.readdirSync(path.join(dataPath(), 'bases')).map((n) => n.replace(/\.json$/, '')).filter((id) => ID_RE.test(id)); } catch { return []; }
}
const listOf = (accountId) => fileFor(accountId).get().bases;
const saveOf = (accountId) => fileFor(accountId).save();
// Все базы, поставленные в мире
function placedIn(worldId) {
  const out = [];
  for (const id of accountIds()) for (const b of listOf(id)) if (b.placed && b.placed.worldId === worldId) out.push(b);
  return out;
}
function all() { return accountIds().flatMap((id) => listOf(id)); }
function findById(id) { return all().find((b) => b.id === id) || null; }
// Создать базу для аккаунта по id (флаг базы в мире)
function createFor(accountId, name) {
  const f = fileFor(accountId), db = f.get();
  if (db.bases.length >= G().maxBasesPerAccount) return null;
  const b = blank(accountId, cleanName(name || 'База'));
  db.bases.push(b);
  f.save();
  return b;
}
function removeById(accountId, id) {
  const f = fileFor(accountId), db = f.get();
  const i = db.bases.findIndex((b) => b.id === id);
  if (i < 0) return null;
  const [b] = db.bases.splice(i, 1);
  f.save();
  return b;
}

module.exports = { list, get, create, rename, validate, blank, placedIn, all, findById, listOf, saveOf, createFor, removeById };
