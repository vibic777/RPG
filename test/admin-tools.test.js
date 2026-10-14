'use strict';
// Панель ГМ: спавн (враг, предмет; у себя, в точке, у игрока), личные и отложенные сообщения (хранятся, переживают
// перезапуск, доходят, когда адресат в мире), события «нападение дракона» и «двойной лут» (на время).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startServer, api, newPlayer, joinWorld, tmpDir, rmDir, sleep } = require('./helpers');

const params = { name: 'Инструменты', seed: 'gm-2', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false };
const ARGS = ['--set', 'game.chatRateCount=50', '--set', 'eventCheckSec=0.2', '--set', 'backupOnStart=false'];

async function setup(s) {
  const admin = await newPlayer(s.base, 'admin', 'Алиса');
  const bob = await newPlayer(s.base, 'bob', 'Боб');
  const w = (await api(s.base, 'POST', '/api/worlds', params, admin.token)).data.world;
  const code = (await api(s.base, 'POST', `/api/worlds/${w.id}/share`, { open: true, invite: 'new' }, admin.token)).data.world.inviteCode;
  await api(s.base, 'POST', '/api/worlds/join', { code }, bob.token);
  return { admin, bob, w };
}

test('спавн: враг у себя и у игрока (с атакой), предмет в точке, ошибки', async (t) => {
  const s = await startServer(ARGS);
  t.after(() => s.stop());
  const { admin, bob, w } = await setup(s);
  const spawn = (b) => api(s.base, 'POST', '/api/admin/spawn', b, admin.token);
  assert.equal((await spawn({ kind: 'enemy', id: 'zombie' })).status, 409, 'администратор не в мире');
  const A = await joinWorld(s.base, admin, w.id);
  const B = await joinWorld(s.base, bob, w.id);
  let r = await spawn({ kind: 'enemy', id: 'zombie', count: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.count, 2);
  r = await spawn({ kind: 'enemy', id: 'boss_raider', at: 'player', username: 'bob', attack: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await B.next((m) => m.t === 'enemy-add' && m.enemy.type === 'boss_raider');
  const me = A.welcome.players.find((p) => p.id === A.welcome.you);
  r = await spawn({ kind: 'item', id: 'ammo_9mm', count: 250, at: 'point', x: me.x, y: me.y });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.count, 250);
  const g1 = await A.next((m) => m.t === 'ground-add' && m.item.id === 'ammo_9mm');
  assert.ok(g1.item.n <= 200, 'стопками не больше предела');
  assert.equal((await spawn({ kind: 'item', id: 'no_such' })).status, 400);
  assert.equal((await spawn({ kind: 'enemy', id: 'zombie', count: 0 })).status, 400);
  assert.equal((await spawn({ kind: 'item', id: 'ammo_9mm', at: 'point', x: -4, y: 2 })).status, 400);
  assert.equal((await spawn({ kind: 'enemy', id: 'zombie', at: 'player', username: 'nobody' })).status, 404);
  A.close(); B.close();
});

test('сообщения: сразу, отложенное хранится и переживает перезапуск, доходит, когда адресат входит', async (t) => {
  const dir = tmpDir();
  t.after(() => rmDir(dir));
  const data = path.join(dir, 'data');
  const s1 = await startServer(['--data', data, ...ARGS]);
  const { admin, bob, w } = await setup(s1);
  const B = await joinWorld(s1.base, bob, w.id);
  let r = await api(s1.base, 'POST', '/api/admin/message', { username: 'bob', text: 'Привет, Боб' }, admin.token);
  assert.deepEqual(r.data, { delivered: true });
  const m = await B.next((x) => x.t === 'chat' && x.m.text === 'Привет, Боб');
  assert.equal(m.m.from.admin, true);
  B.close();
  await B.closed;
  // Боб вышел — сообщение ждёт; а это — отложенное на потом
  r = await api(s1.base, 'POST', '/api/admin/message', { username: 'bob', text: 'Ждал тебя' }, admin.token);
  assert.equal(r.data.delivered, false);
  assert.equal(r.data.event.type, 'message');
  r = await api(s1.base, 'POST', '/api/admin/message', { username: 'bob', text: 'Позже', inMin: 60 }, admin.token);
  assert.equal(r.data.delivered, false);
  assert.equal((await api(s1.base, 'POST', '/api/admin/message', { username: 'bob', text: '' }, admin.token)).status, 400);
  await new Promise((res) => { s1.proc.once('exit', res); s1.proc.kill(); });

  const s2 = await startServer(['--data', data, ...ARGS]);
  t.after(() => new Promise((res) => { s2.proc.once('exit', res); s2.proc.kill(); }));
  const tok = (await api(s2.base, 'POST', '/api/login', { username: 'bob', password: 'secret123' })).data.token;
  const B2 = await joinWorld(s2.base, { ...bob, token: tok }, w.id);
  await B2.next((x) => x.t === 'chat' && x.m.text === 'Ждал тебя', 5000);
  const atok = (await api(s2.base, 'POST', '/api/login', { username: 'admin', password: 'secret123' })).data.token;
  const evs = (await api(s2.base, 'GET', '/api/admin/events', undefined, atok)).data.events.filter((e) => e.type === 'message');
  assert.deepEqual(evs.map((e) => e.status).sort(), ['done', 'scheduled'], 'доставленное — done, «через 60 мин» ждёт');
  B2.close();
});

test('события: нападение дракона и двойной лут на время', async (t) => {
  const s = await startServer([...ARGS, '--set', 'game.lootChanceFactor=100']);
  t.after(() => s.stop());
  const { admin, w } = await setup(s);
  const A = await joinWorld(s.base, admin, w.id);
  const add = (b) => api(s.base, 'POST', '/api/admin/events', b, admin.token);
  let r = await add({ type: 'dragon', worldId: w.id, inMin: 60 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await api(s.base, 'POST', `/api/admin/events/${r.data.event.id}/run`, {}, admin.token);
  assert.equal(r.data.ran, true, JSON.stringify(r.data));
  await A.next((m) => m.t === 'enemy-add' && m.enemy.type === 'dragon_fire');
  assert.equal((await add({ type: 'doubleloot' })).status, 400, 'нужна длительность');
  r = await add({ type: 'doubleloot', worldId: w.id, durationMin: 10 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await A.next((m) => m.t === 'chat' && /Двойной лут/.test(m.m.text), 3000);
  const ev = (await api(s.base, 'GET', '/api/admin/events', undefined, admin.token)).data.events.find((e) => e.id === r.data.event.id);
  assert.equal(ev.status, 'done');
  assert.equal(ev.durationMin, 10);
  await sleep(50);
  A.close();
});

test('журнал: фильтры и страницы; мир: список, сохранить сейчас, резервная копия', async (t) => {
  const s = await startServer(ARGS);
  t.after(() => s.stop());
  const { admin, w } = await setup(s);
  for (let i = 0; i < 7; i++) await api(s.base, 'POST', '/api/admin/announce', { text: 'объявление ' + i }, admin.token);
  await api(s.base, 'POST', '/api/admin/ban', { username: 'bob', minutes: 5, reason: 'шум' }, admin.token);
  let r = await api(s.base, 'GET', '/api/admin/log?action=announce&size=3&page=2', undefined, admin.token);
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.total, r.data.pages, r.data.page, r.data.entries.length], [7, 3, 2, 3]);
  assert.equal(r.data.entries[0].text, 'объявление 3', 'новые первыми');
  assert.ok(r.data.actions.includes('ban'));
  r = await api(s.base, 'GET', '/api/admin/log?target=bob', undefined, admin.token);
  assert.deepEqual(r.data.entries.map((e) => e.action), ['ban']);
  r = await api(s.base, 'GET', '/api/admin/log?text=' + encodeURIComponent('шум'), undefined, admin.token);
  assert.equal(r.data.total, 1);

  r = await api(s.base, 'GET', '/api/admin/worlds', undefined, admin.token);
  const wr = r.data.worlds.find((x) => x.id === w.id);
  assert.deepEqual([wr.active, wr.online, wr.inviteCode], [false, 0, undefined]);
  assert.equal((await api(s.base, 'POST', `/api/admin/worlds/${w.id}/save`, {}, admin.token)).status, 409, 'пустой мир');
  const A = await joinWorld(s.base, admin, w.id);
  r = await api(s.base, 'POST', `/api/admin/worlds/${w.id}/save`, {}, admin.token);
  assert.equal(r.status, 200);
  assert.ok((await api(s.base, 'GET', '/api/admin/worlds', undefined, admin.token)).data.worlds.find((x) => x.id === w.id).stateSavedAt);
  r = await api(s.base, 'POST', '/api/admin/backups', { label: 'gm' }, admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await api(s.base, 'GET', '/api/admin/backups', undefined, admin.token);
  assert.ok(r.data.backups.some((b) => b.label === 'gm'));
  A.close();
});
