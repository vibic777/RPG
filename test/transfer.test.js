'use strict';
// Экспорт / импорт героя (server/transfer.js): подпись сервера, защита от копий (герой существует, менялся после
// экспорта, повторный импорт), чужие и изменённые файлы (appearance / full / reject), строгая проверка записи.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, newPlayer } = require('./helpers');

const get = (s, url, tok) => api(s.base, 'GET', url, undefined, tok);
const post = (s, url, body, tok) => api(s.base, 'POST', url, body, tok);

test('импорт своего файла: возврат удалённого героя целиком, без копий', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const a = await newPlayer(s.base, 'alice', 'Алиса');
  const ex = await get(s, `/api/characters/${a.characterId}/export`, a.token);
  assert.equal(ex.status, 200);
  const file = ex.data;
  assert.equal(file.format, 'rust-magic-character');
  assert.match(file.sig, /^[0-9a-f]{64}$/);
  assert.equal(file.character.accountId, undefined, 'служебные поля не выгружаются');
  assert.ok(file.character.inventory && file.character.stats);

  let r = await post(s, '/api/characters/import', { file }, a.token);
  assert.equal(r.status, 409, 'герой ещё существует — копию сделать нельзя');
  await api(s.base, 'DELETE', `/api/characters/${a.characterId}`, undefined, a.token);
  r = await post(s, '/api/characters/import', { file }, a.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.mode, 'own');
  assert.equal(r.data.character.id, a.characterId, 'тот же герой');
  assert.deepEqual(r.data.character.inventory, file.character.inventory);
  await api(s.base, 'DELETE', `/api/characters/${a.characterId}`, undefined, a.token);
  // надгробие снято при импорте, новое — с более поздним updatedAt: старый файл второй раз не подходит
  r = await post(s, '/api/characters/import', { file }, a.token);
  assert.equal(r.status, 409, 'второй раз тот же файл не импортируется');
});

test('импорт: менялся после экспорта — отказ; изменённый и чужой файлы — только внешность; reject', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const a = await newPlayer(s.base, 'alice', 'Алиса');
  const b = await newPlayer(s.base, 'bob', 'Боб');
  const file = (await get(s, `/api/characters/${a.characterId}/export`, a.token)).data;
  await new Promise((r) => setTimeout(r, 5));
  await api(s.base, 'POST', `/api/characters/${a.characterId}/inventory`, { type: 'hotbar', key: 0, item: null }, a.token);
  await api(s.base, 'DELETE', `/api/characters/${a.characterId}`, undefined, a.token);
  let r = await post(s, '/api/characters/import', { file }, a.token);
  assert.equal(r.status, 409, 'менялся после экспорта');

  // изменённый файл (подкручен уровень) — подпись не сходится: только имя и внешность
  const cheat = structuredClone(file);
  cheat.character.level = 50;
  cheat.character.unspentPoints = 999;
  r = await post(s, '/api/characters/import', { file: cheat }, a.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.mode, 'appearance');
  assert.equal(r.data.character.level, 1);
  assert.deepEqual(r.data.character.appearance, file.character.appearance);
  assert.notEqual(r.data.character.id, file.character.id);

  // чужой аккаунт с верной подписью — тоже как чужой файл; имя можно сменить
  r = await post(s, '/api/characters/import', { file }, b.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, 'appearance');
  r = await post(s, '/api/characters/import', { file }, b.token);
  assert.equal(r.status, 409, 'имя занято');
  assert.equal(r.data.nameTaken ?? true, true);
  r = await post(s, '/api/characters/import', { file, name: 'Алиса Вторая' }, b.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.character.name, 'Алиса Вторая');

  assert.equal((await post(s, '/api/characters/import', { file: { format: 'x' } }, b.token)).status, 400);
  assert.equal((await post(s, '/api/characters/import', { file: { ...file, version: 99 } }, b.token)).status, 400);
});

test('импорт чужого файла в режиме full: строгая проверка уровня, очков, предметов; reject', async (t) => {
  const s = await startServer(['--set', 'characterImportForeign=full']);
  t.after(() => s.stop());
  const a = await newPlayer(s.base, 'alice', 'Алиса');
  const file = (await get(s, `/api/characters/${a.characterId}/export`, a.token)).data;
  const foreign = (patch) => { const f = structuredClone(file); delete f.sig; f.character.name = 'Гость'; patch(f.character); return f; };
  let r = await post(s, '/api/characters/import', { file: foreign(() => {}) }, a.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.mode, 'full');
  assert.deepEqual(r.data.character.inventory.cells.filter(Boolean).map((x) => x.id), file.character.inventory.cells.filter(Boolean).map((x) => x.id));
  const bad = [
    (c) => { c.level = 5; c.unspentPoints = 500; },
    (c) => { c.xp = 1e9; },
    (c) => { c.stats.strength = 999; },
    (c) => { c.inventory.cells[0] = { uid: 'zz', id: 'no_such_item', n: 1 }; },
    (c) => { c.inventory.cells[0] = { uid: 'zz', id: 'ammo_9mm', n: 100000 }; },
    (c) => { const x = c.inventory.cells.find(Boolean); c.inventory.cells[c.inventory.cells.length - 1] = { ...x }; },
    (c) => { c.inventory.equipment.head = { uid: 'hh', id: 'ammo_9mm', n: 1 }; },
  ];
  for (const [i, p] of bad.entries()) {
    r = await post(s, '/api/characters/import', { file: foreign((c) => { c.name = 'Жулик ' + 'абвгдежз'[i]; p(c); }) }, a.token);
    assert.equal(r.status, 400, `подделка №${i + 1} должна отклоняться: ${JSON.stringify(r.data)}`);
  }
  const s2 = await startServer(['--set', 'characterImportForeign=reject']);
  t.after(() => s2.stop());
  const c = await newPlayer(s2.base, 'carl');
  assert.equal((await post(s2, '/api/characters/import', { file }, c.token)).status, 403);
});
