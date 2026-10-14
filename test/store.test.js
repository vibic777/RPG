'use strict';
// Хранилище (server/store.js): атомарная запись, версии схемы и миграции, повреждённый файл, перечитывание при внешнем изменении.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpDir, rmDir } = require('./helpers');
const config = require('../server/config');

const dir = tmpDir();
config.load({ overrides: { dataDir: dir } });
const store = require('../server/store');
test.after(() => rmDir(dir));

test('хранилище: атомарная запись не оставляет временных файлов и не портит старый файл при ошибке', () => {
  const f = path.join(dir, 'a', 'x.json');
  store.writeAtomic(f, '{"a":1}');
  store.writeAtomic(f, '{"a":2}');
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":2}');
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['x.json'], 'временные файлы убраны');
  // сбой посреди записи (нельзя создать временный файл) — прежнее содержимое цело
  const bad = path.join(dir, 'a', 'x.json');
  fs.mkdirSync(`${bad}.${process.pid}.tmp`); // на месте временного файла — папка
  assert.throws(() => store.writeAtomic(bad, '{"a":3}'));
  assert.equal(fs.readFileSync(bad, 'utf8'), '{"a":2}');
  fs.rmdirSync(`${bad}.${process.pid}.tmp`);
});

test('хранилище: версия схемы и миграции применяются при чтении, файл пересохраняется', () => {
  store.registerSchema('demo', 3, {
    2: (d) => { d.items = d.list || []; delete d.list; },
    3: (d) => { for (const it of d.items) it.n = it.n ?? 1; },
  });
  const name = 'demo/old.json';
  fs.mkdirSync(path.join(dir, 'demo'), { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify({ list: [{ id: 'a' }, { id: 'b', n: 5 }] })); // файл без версии = 1
  const f = new store.JsonFile(name, { items: [] }, { kind: 'demo' });
  assert.deepEqual(f.get(), { items: [{ id: 'a', n: 1 }, { id: 'b', n: 5 }], _v: 3 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))._v, 3, 'сохранено в новой версии');
  // новый файл сразу получает текущую версию
  const g = new store.JsonFile('demo/new.json', { items: [] }, { kind: 'demo' });
  g.get(); g.save();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'demo/new.json'), 'utf8'))._v, 3);
  // файл новее сервера — понятная ошибка
  fs.writeFileSync(path.join(dir, 'demo/future.json'), JSON.stringify({ _v: 9, items: [] }));
  assert.throws(() => new store.JsonFile('demo/future.json', {}, { kind: 'demo' }).get(), /новее сервера/);
});

test('хранилище: повреждённый файл — ошибка с подсказкой про резервные копии; внешнее изменение перечитывается', () => {
  fs.writeFileSync(path.join(dir, 'broken.json'), '{"a":');
  assert.throws(() => new store.JsonFile('broken.json', {}).get(), /backup\.js/);
  const f = new store.JsonFile('ext.json', { a: 0 });
  f.get().a = 1; f.save();
  const t = new Date(Date.now() + 5000);
  fs.writeFileSync(path.join(dir, 'ext.json'), '{"a":7}');
  fs.utimesSync(path.join(dir, 'ext.json'), t, t);
  assert.equal(f.get().a, 7);
});
