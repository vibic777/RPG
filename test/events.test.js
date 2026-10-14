'use strict';
// Игровые события (server/events.js): хранятся в data/events.json и переживают перезапуск, срабатывают по расписанию,
// команда /event и API администратора, супер-босс — событием, права.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, api, newPlayer, joinWorld, tmpDir, rmDir } = require('./helpers');

const params = { name: 'События', seed: 'ev-1', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false };
const say = (c, text) => c.send({ t: 'chat', text });
const ARGS = ['--set', 'eventCheckSec=0.2', '--set', 'game.chatRateCount=50', '--set', 'backupOnStart=false'];

test('события: запланированный супер-босс сохраняется, переживает перезапуск и появляется по расписанию', async (t) => {
  const dir = tmpDir();
  t.after(() => rmDir(dir));
  const data = path.join(dir, 'data');
  const s1 = await startServer(['--data', data, ...ARGS]);
  const admin = await newPlayer(s1.base, 'admin', 'Алиса');
  const w = (await api(s1.base, 'POST', '/api/worlds', params, admin.token)).data.world;
  // через API: через 0.05 мин (3 с) в этом мире
  let r = await api(s1.base, 'POST', '/api/admin/events', { type: 'superboss', worldId: w.id, inMin: 0.05 }, admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.event.id;
  const stored = JSON.parse(fs.readFileSync(path.join(data, 'events.json'), 'utf8'));
  assert.equal(stored._v, 1);
  assert.equal(stored.events[0].status, 'scheduled');
  await new Promise((res) => { s1.proc.once('exit', res); s1.proc.kill(); });

  const s2 = await startServer(['--data', data, ...ARGS]);
  t.after(() => new Promise((res) => { s2.proc.once('exit', res); s2.proc.kill(); }));
  const token = (await api(s2.base, 'POST', '/api/login', { username: 'admin', password: 'secret123' })).data.token;
  r = await api(s2.base, 'GET', '/api/admin/events', undefined, token);
  assert.equal(r.data.events.find((e) => e.id === id).status, 'scheduled', 'событие пережило перезапуск');
  assert.ok(r.data.types.some((x) => x.id === 'superboss'));
  const A = await joinWorld(s2.base, { ...admin, token }, w.id);
  const add = await A.next((m) => m.t === 'enemy-add' && m.enemy.type === 'boss_super', 8000);
  assert.ok(add.enemy.hp > 0);
  await A.next((m) => m.t === 'chat' && m.m.channel === 'system' && /Патриарх/.test(m.m.text));
  r = await api(s2.base, 'GET', '/api/admin/events', undefined, token);
  const ev = r.data.events.find((e) => e.id === id);
  assert.deepEqual([ev.status, ev.runs], ['done', 1]);
  const log = fs.readFileSync(path.join(data, 'admin-log.jsonl'), 'utf8');
  assert.match(log, /"event-add"/);
  A.close();
});

test('события: /event add/list/run/remove, повтор, права, ошибки', async (t) => {
  const s = await startServer(ARGS);
  t.after(() => s.stop());
  const admin = await newPlayer(s.base, 'admin', 'Алиса');
  const bob = await newPlayer(s.base, 'bob', 'Боб');
  const w = (await api(s.base, 'POST', '/api/worlds', params, admin.token)).data.world;
  const A = await joinWorld(s.base, admin, w.id);
  assert.equal((await api(s.base, 'GET', '/api/admin/events', undefined, bob.token)).status, 403);
  assert.equal((await api(s.base, 'POST', '/api/admin/events', { type: 'nope' }, admin.token)).status, 400);
  assert.equal((await api(s.base, 'POST', '/api/admin/events', { type: 'announce' }, admin.token)).status, 400, 'объявлению нужен текст');
  assert.equal((await api(s.base, 'POST', '/api/admin/events', { type: 'horde', everyMin: 0.1 }, admin.token)).status, 400, 'слишком частый повтор');

  say(A, '/event add announce 60 1 Привет всем');
  const m = await A.next((x) => x.t === 'chat' && /запланировано/.test(x.m.text));
  const id = /Событие (\w+)/.exec(m.m.text)[1];
  say(A, '/event list');
  await A.next((x) => x.t === 'chat' && x.m.text.includes(id) && /каждые 1 мин/.test(x.m.text));
  say(A, `/event run ${id}`);
  await A.next((x) => x.t === 'chat' && x.m.text === 'Привет всем');
  let ev = (await api(s.base, 'GET', '/api/admin/events', undefined, admin.token)).data.events.find((e) => e.id === id);
  assert.equal(ev.status, 'scheduled', 'повторяющееся остаётся в расписании');
  assert.equal(ev.runs, 1);
  assert.ok(ev.at > Date.now() + 30000, 'следующий запуск — через everyMin');
  say(A, `/event remove ${id}`);
  await A.next((x) => x.t === 'chat' && /отменено/.test(x.m.text));
  ev = (await api(s.base, 'GET', '/api/admin/events', undefined, admin.token)).data.events.find((e) => e.id === id);
  assert.equal(ev.status, 'cancelled');
  // главарь по API сразу
  const r = await api(s.base, 'POST', '/api/admin/events', { type: 'boss', enemy: 'boss_raider', inMin: 60 }, admin.token);
  const run = await api(s.base, 'POST', `/api/admin/events/${r.data.event.id}/run`, {}, admin.token);
  assert.equal(run.data.ran, true, JSON.stringify(run.data));
  await A.next((x) => x.t === 'enemy-add' && x.enemy.type === 'boss_raider');
  A.close();
});

test('события на время (двойной лут): действуют durationMin минут и только в своём мире', () => {
  const dir = tmpDir();
  const config = require('../server/config');
  config.load({ overrides: { dataDir: dir } });
  const events = require('../server/events');
  try {
    events.registerType('buff_test', 'Проверка', () => 'ок', { duration: true });
    events.setRooms(() => new Map([['w1', { id: 'w1', players: new Map([['a', {}]]) }]]));
    assert.throws(() => events.add(null, { type: 'buff_test', worldId: 'w1' }), /Длительность/);
    const ev = events.add(null, { type: 'buff_test', worldId: 'w1', durationMin: 2 });
    assert.equal(events.active('buff_test', 'w1'), false, 'ещё не сработало');
    const now = Date.now();
    assert.equal(events.run(ev, { now }).ran, true);
    assert.equal(events.active('buff_test', 'w1', now + 60000), true);
    assert.equal(events.active('buff_test', 'w2', now + 60000), false, 'другой мир');
    assert.equal(events.active('buff_test', 'w1', now + 121000), false, 'время вышло');
  } finally { rmDir(dir); }
});
