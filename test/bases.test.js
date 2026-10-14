'use strict';
// Слот базы (server/bases.js): отдельный файл data/bases/<аккаунт>.json с версией схемы, предел баз на аккаунт,
// название, чужую базу не видно.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, api, newPlayer } = require('./helpers');

test('базы: создание, формат, предел на аккаунт, переименование, отдельный файл', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const a = await newPlayer(s.base, 'alice');
  const b = await newPlayer(s.base, 'bob');
  let r = await api(s.base, 'GET', '/api/bases', undefined, a.token);
  assert.deepEqual([r.status, r.data.bases, r.data.max], [200, [], 1]);
  r = await api(s.base, 'POST', '/api/bases', { name: '  Убежище  ' }, a.token);
  assert.equal(r.status, 200);
  const base = r.data.base;
  assert.equal(base.name, 'Убежище');
  assert.equal(base.placed, null);
  for (const k of ['structures', 'storage', 'turrets', 'stash']) assert.deepEqual(base[k], []);
  assert.ok(base.size.w > 0 && base.size.h > 0);
  assert.equal((await api(s.base, 'POST', '/api/bases', {}, a.token)).status, 409, 'не больше maxBasesPerAccount');
  assert.equal((await api(s.base, 'POST', `/api/bases/${base.id}/name`, { name: '' }, a.token)).status, 400);
  assert.equal((await api(s.base, 'POST', `/api/bases/${base.id}/name`, { name: 'Форт' }, a.token)).data.base.name, 'Форт');
  assert.equal((await api(s.base, 'GET', `/api/bases/${base.id}`, undefined, b.token)).status, 404, 'чужая база не видна');
  const me = (await api(s.base, 'GET', '/api/me', undefined, a.token)).data.account;
  const file = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'bases', me.id + '.json'), 'utf8'));
  assert.equal(file._v, 1);
  assert.equal(file.bases[0].name, 'Форт');
});
