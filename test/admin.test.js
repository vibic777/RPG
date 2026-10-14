'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, api, runCli, MAKE_ADMIN, sleep } = require('./helpers');

async function setup(t) {
  const s = await startServer();
  t.after(() => s.stop());
  const admin = (await api(s.base, 'POST', '/api/register', { username: 'admin', password: 'secret123' })).data.token;
  const player = (await api(s.base, 'POST', '/api/register', { username: 'player1', password: 'pass1234' })).data.token;
  return { s, b: s.base, admin, player };
}
const login = (b, username = 'player1', password = 'pass1234') => api(b, 'POST', '/api/login', { username, password });

test('роль администратора: доступ к админ-API', async (t) => {
  const { b, admin, player } = await setup(t);
  assert.equal((await api(b, 'GET', '/api/admin/accounts')).status, 401);
  assert.equal((await api(b, 'GET', '/api/admin/accounts', undefined, player)).status, 403);
  assert.equal((await api(b, 'POST', '/api/admin/ban', { username: 'admin' }, player)).status, 403);
  const list = await api(b, 'GET', '/api/admin/accounts', undefined, admin);
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.accounts.map((a) => [a.username, a.role]), [['admin', 'admin'], ['player1', 'player']]);
  assert.ok(list.data.accounts.every((a) => a.hash === undefined && a.salt === undefined));
});

test('make-admin: выдача и снятие роли, ошибки', async (t) => {
  const { s, b } = await setup(t);
  const data = ['--data', s.dataDir];
  let r = runCli(MAKE_ADMIN, ['player1', ...data]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.stdout, /роль теперь admin/);
  assert.equal((await login(b)).data.account.role, 'admin', 'сервер перечитывает accounts.json');
  r = runCli(MAKE_ADMIN, ['PLAYER1', '--revoke', ...data]);
  assert.equal(r.code, 0, r.out);
  assert.equal((await login(b)).data.account.role, 'player');
  assert.equal(runCli(MAKE_ADMIN, ['nobody', ...data]).code, 1);
  assert.equal(runCli(MAKE_ADMIN, [...data]).code, 2);
  assert.equal(runCli(MAKE_ADMIN, ['a', 'b', ...data]).code, 2);
});

test('бан: временный, бессрочный, истечение, разбан', async (t) => {
  const { s, b, admin, player } = await setup(t);

  await t.test('нельзя забанить себя и несуществующего', async () => {
    assert.equal((await api(b, 'POST', '/api/admin/ban', { username: 'ADMIN' }, admin)).status, 400);
    assert.equal((await api(b, 'POST', '/api/admin/ban', { username: 'ghost' }, admin)).status, 404);
  });

  await t.test('временный бан: причина и оставшееся время, сессии сброшены', async () => {
    const r = await api(b, 'POST', '/api/admin/ban', { username: 'player1', minutes: 90, reason: 'читерство' }, admin);
    assert.equal(r.status, 200);
    assert.equal(r.data.account.banned, true);
    assert.ok(r.data.account.bannedUntil > Date.now());
    assert.equal((await api(b, 'GET', '/api/me', undefined, player)).status, 401, 'старый токен больше не работает');
    const l = await login(b);
    assert.equal(l.status, 403);
    assert.match(l.data.error, /Причина: читерство/);
    assert.match(l.data.error, /До разблокировки: 1 ч 30 мин/);
    assert.equal(l.data.banReason, 'читерство');
  });

  await t.test('бессрочный бан', async () => {
    await api(b, 'POST', '/api/admin/ban', { username: 'player1', reason: 'оскорбления' }, admin);
    const l = await login(b);
    assert.equal(l.status, 403);
    assert.match(l.data.error, /бессрочно/);
    assert.equal(l.data.bannedUntil, null);
  });

  await t.test('истечение срока — вход открывается сам', async () => {
    await api(b, 'POST', '/api/admin/ban', { username: 'player1', minutes: 0.01 }, admin); // 0,6 с
    assert.equal((await login(b)).status, 403);
    await sleep(800);
    const l = await login(b);
    assert.equal(l.status, 200);
    assert.equal(l.data.account.banned, false);
  });

  await t.test('разбан', async () => {
    await api(b, 'POST', '/api/admin/ban', { username: 'player1' }, admin);
    assert.equal((await login(b)).status, 403);
    const u = await api(b, 'POST', '/api/admin/unban', { username: 'player1' }, admin);
    assert.equal(u.status, 200);
    assert.equal((await login(b)).status, 200);
  });

  await t.test('журнал действий администратора', async () => {
    const lines = fs.readFileSync(path.join(s.dataDir, 'admin-log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(lines.length >= 5);
    assert.deepEqual(lines.map((l) => l.action).slice(0, 2), ['ban', 'ban']);
    assert.equal(lines.at(-1).action, 'unban');
    assert.ok(lines.every((l) => l.admin === 'admin' && l.target === 'player1' && l.time));
  });
});
