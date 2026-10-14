'use strict';
// Персонажи: data/characters/<accountId>.json — отдельно от миров.
const crypto = require('crypto');
const { JsonFile } = require('./store');
const Rules = require('../shared/character-rules');
const Movement = require('../shared/movement');
const { HttpError } = require('./auth');

const files = new Map();
function fileFor(accountId) {
  if (!/^[0-9a-f-]{36}$/.test(accountId)) throw new HttpError(400, 'Некорректный аккаунт.');
  if (!files.has(accountId)) files.set(accountId, new JsonFile(`characters/${accountId}.json`, { characters: [] }, { kind: 'characters' }));
  return files.get(accountId);
}

// Миграции записей (например, инвентарь для персонажей, созданных до его появления).
// fn(record) → true, если запись изменена; изменённый файл сохраняется.
const migrations = [];
function addMigration(fn) { migrations.push(fn); }
function migrate(f) {
  let changed = false;
  for (const c of f.get().characters) for (const m of migrations) if (m(c)) changed = true;
  if (changed) f.save();
}

function list(account) {
  const f = fileFor(account.id);
  migrate(f);
  return f.get().characters;
}

function get(account, id) {
  const c = list(account).find((x) => x.id === id);
  if (!c) throw new HttpError(404, 'Персонаж не найден.');
  return c;
}

function create(account, input) {
  const f = fileFor(account.id);
  const db = f.get();
  if (db.characters.length >= Rules.MAX_CHARACTERS) {
    throw new HttpError(400, `Не больше ${Rules.MAX_CHARACTERS} персонажей на аккаунт.`);
  }
  const res = Rules.validateNew(input);
  if (!res.ok) throw new HttpError(400, res.errors.join('\n'), { errors: res.errors });
  if (db.characters.some((c) => c.name.toLowerCase() === res.value.name.toLowerCase())) {
    throw new HttpError(409, 'У вас уже есть персонаж с таким именем.');
  }
  const record = Rules.createRecord(res.value, account.id, crypto.randomUUID(), Date.now());
  for (const m of migrations) m(record);
  db.characters.push(record);
  f.save();
  return record;
}

function remove(account, id) {
  const f = fileFor(account.id);
  const db = f.get();
  const i = db.characters.findIndex((x) => x.id === id);
  if (i < 0) throw new HttpError(404, 'Персонаж не найден.');
  const [removed] = db.characters.splice(i, 1);
  // «надгробие»: из файла экспорта удалённого героя можно восстановить, только если после экспорта он не менялся
  db.deleted = [...(db.deleted || []), { id: removed.id, updatedAt: removed.updatedAt || 0, deletedAt: Date.now() }].slice(-TOMBSTONES);
  f.save();
  return removed;
}
const TOMBSTONES = 200;

// Надгробие удалённого героя этого аккаунта (или null)
function tombstone(account, id) {
  return (fileFor(account.id).get().deleted || []).find((x) => x.id === id) || null;
}

// Добавить готовую проверенную запись (импорт из файла). opts.tombstone — снять надгробие с этим id.
function addRecord(account, record, opts = {}) {
  const f = fileFor(account.id);
  const db = f.get();
  if (db.characters.length >= Rules.MAX_CHARACTERS) throw new HttpError(400, `Не больше ${Rules.MAX_CHARACTERS} персонажей на аккаунт.`);
  if (db.characters.some((c) => c.name.toLowerCase() === record.name.toLowerCase())) {
    throw new HttpError(409, 'У вас уже есть персонаж с таким именем — укажите другое имя.', { nameTaken: true });
  }
  if (db.characters.some((c) => c.id === record.id)) throw new HttpError(409, 'Этот герой уже есть в вашем списке.');
  for (const m of migrations) m(record);
  db.characters.push(record);
  if (opts.tombstone) db.deleted = (db.deleted || []).filter((x) => x.id !== record.id);
  f.save();
  return record;
}

// Изменение персонажа «всё или ничего»: fn получает копию свежей записи и может бросить ошибку —
// тогда файл не меняется. Возвращает новую запись.
function update(account, id, fn) {
  const f = fileFor(account.id);
  migrate(f);
  const db = f.get();
  const i = db.characters.findIndex((x) => x.id === id);
  if (i < 0) throw new HttpError(404, 'Персонаж не найден.');
  const copy = structuredClone(db.characters[i]);
  const result = fn(copy);
  copy.updatedAt = Date.now();
  db.characters[i] = copy;
  f.save();
  return { record: copy, result };
}

// Последняя позиция героя в мире (проверяется по карте мира)
function savePosition(account, id, worldRecord, map, pos) {
  const f = fileFor(account.id);
  const c = get(account, id);
  const err = Movement.validatePosition(map, pos);
  if (err) throw new HttpError(400, err);
  // z и level — вертикальный уровень (шаг 13): ключ уровня из shared/levels.js или нет (поверхность)
  const level = require('./room-key').level(pos.level) ? pos.level : null;
  if (!level && pos.z !== undefined && pos.z !== 0) throw new HttpError(400, 'Позиция на другом уровне (не поверхности) сохраняется только сервером игры.');
  const p = { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100, z: level && Number.isInteger(pos.z) ? pos.z : 0, t: Date.now() };
  if (level) p.level = level;
  c.positions = c.positions || {};
  c.positions[worldRecord.id] = p;
  c.lastWorld = { worldId: worldRecord.id, ...p };
  c.updatedAt = p.t;
  f.save();
  return p;
}

// Сохранить живую запись персонажа (бой меняет её в памяти: здоровье, опыт, прочность, патроны в магазине).
// Если в файле другая копия записи — она заменяется, но позиции в мирах берутся из файла.
function persist(account, record) {
  const f = fileFor(account.id);
  const db = f.get();
  const i = db.characters.findIndex((x) => x.id === record.id);
  if (i < 0) return false;
  const old = db.characters[i];
  if (old !== record) {
    record.positions = old.positions;
    record.lastWorld = old.lastWorld;
    db.characters[i] = record;
  }
  record.updatedAt = Date.now();
  f.save();
  return true;
}

module.exports = { list, get, create, remove, update, savePosition, persist, addMigration, addRecord, tombstone };
