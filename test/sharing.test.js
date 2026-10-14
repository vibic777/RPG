'use strict';
// Совместный доступ к мирам: открыт/закрыт, код приглашения, присоединение, «чужой мир», выход.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api } = require('./helpers');

const worldParams = { name: 'Общий мир', seed: 'coop-1', size: 'small', enemyDensity: 'normal', hordeFrequency: 'rare', dragons: 1, scaleToLevel: false };

test('миры: открыть/закрыть, код приглашения, присоединение и выход', async (t) => {
  const s = await startServer(['--set', 'game.inviteCodeLength=6', '--set', 'game.maxWorldMembers=1']);
  t.after(() => s.stop());
  const b = s.base;
  const reg = async (name) => (await api(b, 'POST', '/api/register', { username: name, password: 'secret123' })).data.token;
  const owner = await reg('host');
  const guest = await reg('guest');
  const third = await reg('third');

  const w = (await api(b, 'POST', '/api/worlds', worldParams, owner)).data.world;
  assert.equal(w.open, false);
  assert.equal(w.inviteCode, null);
  assert.equal(w.own, true);
  assert.deepEqual(w.members, []);
  assert.equal(w.maxPlayers, 8);

  // только владелец меняет доступ; чужому мир «не найден»
  assert.equal((await api(b, 'POST', `/api/worlds/${w.id}/share`, { open: true }, guest)).status, 404);
  assert.equal((await api(b, 'POST', `/api/worlds/${w.id}/share`, { open: 'да' }, owner)).status, 400);
  assert.equal((await api(b, 'POST', `/api/worlds/${w.id}/share`, { invite: 'xxx' }, owner)).status, 400);

  // код создан, но мир закрыт — присоединиться нельзя
  let r = await api(b, 'POST', `/api/worlds/${w.id}/share`, { invite: 'new' }, owner);
  assert.equal(r.status, 200);
  const code = r.data.world.inviteCode;
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/, 'код из настроенной длины, без похожих символов');
  r = await api(b, 'POST', '/api/worlds/join', { code }, guest);
  assert.equal(r.status, 403);
  assert.match(r.data.error, /закрыт/);

  await api(b, 'POST', `/api/worlds/${w.id}/share`, { open: true }, owner);
  assert.equal((await api(b, 'POST', '/api/worlds/join', { code: 'NOPE00' }, guest)).status, 404);
  assert.equal((await api(b, 'POST', '/api/worlds/join', { code: '' }, guest)).status, 400);
  assert.equal((await api(b, 'POST', '/api/worlds/join', { code }, owner)).status, 400, 'к своему миру не присоединяются');
  // регистр и пробелы в коде не важны
  r = await api(b, 'POST', '/api/worlds/join', { code: ' ' + code.toLowerCase().slice(0, 3) + ' ' + code.slice(3) }, guest);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.world.own, false);
  assert.equal(r.data.world.inviteCode, undefined, 'гость не видит код приглашения');
  // повторное присоединение не дублирует участника
  assert.equal((await api(b, 'POST', '/api/worlds/join', { code }, guest)).status, 200);

  // предел участников (maxWorldMembers=1)
  r = await api(b, 'POST', '/api/worlds/join', { code }, third);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /максимальное/);

  // у гостя мир в списке как чужой; у владельца виден участник
  const gl = (await api(b, 'GET', '/api/worlds', undefined, guest)).data.worlds;
  assert.equal(gl.length, 1);
  assert.equal(gl[0].own, false);
  assert.equal(gl[0].ownerName, 'host');
  const ol = (await api(b, 'GET', '/api/worlds', undefined, owner)).data.worlds;
  assert.deepEqual(ol[0].members.map((m) => m.username), ['guest']);
  assert.equal((await api(b, 'GET', `/api/worlds/${w.id}`, undefined, guest)).status, 200);
  assert.equal((await api(b, 'GET', `/api/worlds/${w.id}`, undefined, third)).status, 404);

  // гость не может удалить чужой мир и менять доступ
  assert.equal((await api(b, 'DELETE', `/api/worlds/${w.id}`, undefined, guest)).status, 403);
  assert.equal((await api(b, 'POST', `/api/worlds/${w.id}/share`, { open: false }, guest)).status, 403);

  // новый код: старый перестаёт работать, участники остаются
  const code2 = (await api(b, 'POST', `/api/worlds/${w.id}/share`, { invite: 'new' }, owner)).data.world.inviteCode;
  assert.notEqual(code2, code);
  assert.equal((await api(b, 'POST', '/api/worlds/join', { code }, third)).status, 404);
  // убрать код
  r = await api(b, 'POST', `/api/worlds/${w.id}/share`, { invite: 'remove' }, owner);
  assert.equal(r.data.world.inviteCode, null);
  assert.equal((await api(b, 'POST', '/api/worlds/join', { code: code2 }, third)).status, 404);

  // владелец не «покидает» свой мир; гость покидает
  assert.equal((await api(b, 'POST', `/api/worlds/${w.id}/leave`, {}, owner)).status, 400);
  assert.equal((await api(b, 'POST', `/api/worlds/${w.id}/leave`, {}, guest)).status, 200);
  assert.deepEqual((await api(b, 'GET', '/api/worlds', undefined, guest)).data.worlds, []);
});
