'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api } = require('./helpers');

test('аккаунты: регистрация, вход, сессии', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const b = s.base;

  const first = await api(b, 'POST', '/api/register', { username: 'Вальдемар', password: 'secret123' });
  assert.equal(first.status, 200);
  assert.equal(first.data.account.role, 'admin', 'первый аккаунт — администратор');
  assert.match(first.data.token, /^[0-9a-f]{64}$/);
  assert.equal(first.data.account.hash, undefined, 'хэш пароля не отдаётся клиенту');

  const second = await api(b, 'POST', '/api/register', { username: 'player1', password: 'pass1234' });
  assert.equal(second.status, 200);
  assert.equal(second.data.account.role, 'player');

  await t.test('дубликат имени (без учёта регистра)', async () => {
    const r = await api(b, 'POST', '/api/register', { username: 'PLAYER1', password: 'pass1234' });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /занято/);
  });

  await t.test('некорректные имя и пароль', async () => {
    for (const body of [{ username: 'ab', password: 'pass1234' }, { username: 'bad name!', password: 'pass1234' },
      { username: 'goodname', password: '123' }, { username: 42, password: 'pass1234' }, {}]) {
      const r = await api(b, 'POST', '/api/register', body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
  });

  await t.test('неверный пароль и неизвестный аккаунт', async () => {
    assert.equal((await api(b, 'POST', '/api/login', { username: 'player1', password: 'wrong123' })).status, 401);
    assert.equal((await api(b, 'POST', '/api/login', { username: 'nobody', password: 'wrong123' })).status, 401);
  });

  await t.test('вход, /api/me, выход', async () => {
    const l = await api(b, 'POST', '/api/login', { username: 'Player1', password: 'pass1234' });
    assert.equal(l.status, 200);
    const me = await api(b, 'GET', '/api/me', undefined, l.data.token);
    assert.equal(me.status, 200);
    assert.equal(me.data.account.username, 'player1');
    assert.equal((await api(b, 'GET', '/api/me')).status, 401);
    assert.equal((await api(b, 'GET', '/api/me', undefined, 'deadbeef')).status, 401);
    assert.equal((await api(b, 'POST', '/api/logout', {}, l.data.token)).status, 200);
    assert.equal((await api(b, 'GET', '/api/me', undefined, l.data.token)).status, 401);
  });

  await t.test('некорректный JSON и неизвестные маршруты', async () => {
    const r = await fetch(b + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    assert.equal(r.status, 400);
    assert.equal((await api(b, 'GET', '/api/nope')).status, 404);
    assert.equal((await api(b, 'GET', '/api/login')).status, 405);
  });

  await t.test('сессия переживает перезапуск сервера (хранится в data/)', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const sessions = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'sessions.json'), 'utf8'));
    const keys = Object.keys(sessions.sessions);
    assert.ok(keys.length > 0);
    assert.ok(!keys.includes(first.data.token), 'в файле хранится хэш токена, а не сам токен');
  });
});

test('защита от перебора паролей (loginFailLimit)', async (t) => {
  const s = await startServer(['--set', 'loginFailLimit=3']);
  t.after(() => s.stop());
  await api(s.base, 'POST', '/api/register', { username: 'victim', password: 'secret123' });
  for (let i = 0; i < 3; i++) {
    assert.equal((await api(s.base, 'POST', '/api/login', { username: 'victim', password: 'bad-pass' })).status, 401);
  }
  const blocked = await api(s.base, 'POST', '/api/login', { username: 'victim', password: 'secret123' });
  assert.equal(blocked.status, 429, 'после лимита блокируется даже верный пароль');
  assert.match(blocked.data.error, /Слишком много/);
});

test('настройки длины имени/пароля применяются и отдаются клиенту', async (t) => {
  const s = await startServer(['--set', 'passwordMin=10', '--set', 'game.startPoints=20']);
  t.after(() => s.stop());
  const cfg = await api(s.base, 'GET', '/api/config');
  assert.equal(cfg.data.auth.passwordMin, 10);
  assert.equal(cfg.data.game.startPoints, 20);
  const r = await api(s.base, 'POST', '/api/register', { username: 'shortpw', password: 'abcdef12' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /от 10/);
});
