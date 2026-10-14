'use strict';
// Панель ГМ (server/admin.js): роль проверяется на каждом /api/admin/*, игроки, выгнать, роль, телепорт, режим бога.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');

const params = { name: 'Панель', seed: 'gm-1', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false };
const readLog = (s) => fs.readFileSync(path.join(s.dataDir, 'admin-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

async function setup(args = []) {
  const s = await startServer(['--set', 'game.chatRateCount=50', ...args]);
  const admin = await newPlayer(s.base, 'admin', 'Алиса');
  const bob = await newPlayer(s.base, 'bob', 'Боб');
  const w = (await api(s.base, 'POST', '/api/worlds', params, admin.token)).data.world;
  const code = (await api(s.base, 'POST', `/api/worlds/${w.id}/share`, { open: true, invite: 'new' }, admin.token)).data.world.inviteCode;
  await api(s.base, 'POST', '/api/worlds/join', { code }, bob.token);
  return { s, admin, bob, w };
}

test('панель ГМ: каждый /api/admin/* — только администратору (401 без входа, 403 игроку)', async (t) => {
  const { s, bob } = await setup();
  t.after(() => s.stop());
  // все маршруты администратора из server/index.js
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const routes = [...src.matchAll(/route\('(GET|POST|DELETE)', '(\/api\/admin\/[^']+)'/g)].map((m) => [m[1], m[2].replace(/:(\w+)/g, 'x')]);
  assert.ok(routes.length >= 15, `маршрутов администратора: ${routes.length}`);
  for (const [method, url] of routes) {
    const body = method === 'GET' ? undefined : {};
    assert.equal((await api(s.base, method, url, body)).status, 401, `${method} ${url} без входа`);
    assert.equal((await api(s.base, method, url, body, bob.token)).status, 403, `${method} ${url} игроку`);
  }
});

test('панель ГМ: список игроков, телепорт, выгнать, роль', async (t) => {
  const { s, admin, bob, w } = await setup();
  t.after(() => s.stop());
  const A = await joinWorld(s.base, admin, w.id);
  const B = await joinWorld(s.base, bob, w.id);
  let r = await api(s.base, 'GET', '/api/admin/players', undefined, admin.token);
  const pb = r.data.players.find((p) => p.username === 'bob');
  assert.equal(pb.online.worldId, w.id);
  assert.equal(pb.online.character, 'Боб');

  // призвать Боба к себе, затем себя — в точку
  r = await api(s.base, 'POST', '/api/admin/teleport', { username: 'bob' }, admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const tp = await B.next((m) => m.t === 'teleported' && m.id === B.welcome.you);
  assert.ok(Math.hypot(tp.x - A.welcome.players.find((p) => p.id === A.welcome.you).x, tp.y - A.welcome.players.find((p) => p.id === A.welcome.you).y) < 6);
  await A.next((m) => m.t === 'teleported' && m.id === B.welcome.you); // администратор тоже видит
  r = await api(s.base, 'POST', '/api/admin/teleport', { x: -5, y: 3 }, admin.token);
  assert.equal(r.status, 400, 'за краем карты');
  r = await api(s.base, 'POST', '/api/admin/teleport', { to: 'bob' }, admin.token);
  assert.equal(r.status, 200);
  assert.equal((await api(s.base, 'POST', '/api/admin/teleport', { to: 'nobody' }, admin.token)).status, 404);

  // роль: себя разжаловать нельзя; Боба — можно туда и обратно
  assert.equal((await api(s.base, 'POST', '/api/admin/role', { username: 'admin', role: 'player' }, admin.token)).status, 400);
  assert.equal((await api(s.base, 'POST', '/api/admin/role', { username: 'bob', role: 'god' }, admin.token)).status, 400);
  assert.equal((await api(s.base, 'POST', '/api/admin/role', { username: 'bob', role: 'admin' }, admin.token)).data.account.role, 'admin');
  assert.equal((await api(s.base, 'GET', '/api/admin/players', undefined, bob.token)).status, 200, 'новая роль действует сразу');
  await api(s.base, 'POST', '/api/admin/role', { username: 'bob', role: 'player' }, admin.token);
  assert.equal((await api(s.base, 'GET', '/api/admin/players', undefined, bob.token)).status, 403);

  // выгнать
  assert.equal((await api(s.base, 'POST', '/api/admin/kick', { username: 'admin' }, admin.token)).status, 400, 'себя нельзя');
  r = await api(s.base, 'POST', '/api/admin/kick', { username: 'bob', reason: 'проверка' }, admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await B.closed, 4009);
  await A.next((m) => m.t === 'leave' && m.id === B.welcome.you && m.reason === 'kicked');
  assert.equal((await api(s.base, 'POST', '/api/admin/kick', { username: 'bob' }, admin.token)).status, 409, 'уже не в мире');
  const B2 = await joinWorld(s.base, bob, w.id);
  assert.ok(B2.welcome, 'после «выгнать» можно войти снова');
  const acts = readLog(s).map((x) => x.action);
  for (const a of ['teleport', 'role', 'kick']) assert.ok(acts.includes(a), a);
  A.close(); B2.close();
});

test('режим бога: невидимость (игроки и враги не видят), неуязвимость, полёт — телепорт сквозь препятствия', async (t) => {
  const { s, admin, bob, w } = await setup();
  t.after(() => s.stop());
  const A = await joinWorld(s.base, admin, w.id);
  const B = await joinWorld(s.base, bob, w.id);
  const aid = A.welcome.you;
  // WS от игрока — отказ
  B.send({ t: 'gm', a: 'god', god: { invisible: true } });
  assert.match((await B.next('gm-err')).message, /администратор/i);
  A.send({ t: 'gm', a: 'god', god: { invisible: true, invulnerable: true } });
  // включены только запрошенные режимы; прочие (полёт, бесконечные патроны, техника, деньги…) выключены, скорость обычная
  const god = (await A.next('god')).god;
  assert.equal(god.speed, 1);
  assert.deepEqual(Object.keys(god).filter((k) => k !== 'speed' && god[k] !== false).sort(), ['invisible', 'invulnerable']);
  for (const k of ['fly', 'noclip', 'infinite', 'freeBuild', 'nofog']) assert.equal(god[k], false, k);
  await B.next((m) => m.t === 'leave' && m.id === aid && m.reason === 'hidden');
  B.drain();
  const st = await B.next('state');
  assert.ok(!st.players.some((p) => p.id === aid), 'невидимого нет в состоянии у игрока');
  const stA = await A.next('state');
  assert.ok(stA.players.some((p) => p.id === aid), 'себя администратор видит');
  // враг не нападает на невидимого, неуязвимый не получает урона
  A.send({ t: 'chat', text: '/spawn zombie 2' });
  await sleep(1500);
  const me = await A.next('me');
  assert.equal(me.hp, A.welcome.me.hp, 'здоровье не изменилось');
  // полёт: без него в воду нельзя, с ним — можно
  // клетка, куда пешком не пройти (вода, горы) — та же карта, что у сервера
  const WorldGen = require('../shared/worldgen');
  const map = WorldGen.generate({ ...w });
  let wall = null;
  for (let y = 0; y < map.height && !wall; y++) for (let x = 0; x < map.width && !wall; x++) if (!WorldGen.isWalkable(map, x, y)) wall = { x: x + 0.5, y: y + 0.5 };
  A.send({ t: 'gm', a: 'tp', ...wall });
  assert.match((await A.next('gm-err')).message, /полёт/, 'без полёта сквозь препятствия нельзя');
  A.send({ t: 'gm', a: 'tp', x: -1, y: -1 });
  assert.match((await A.next('gm-err')).message, /краем карты/);
  A.send({ t: 'gm', a: 'god', god: { invisible: false, fly: true } });
  await A.next((m) => m.t === 'god' && m.god.fly);
  const back = await B.next((m) => m.t === 'join' && m.player.id === aid);
  assert.equal(back.quiet, true);
  A.send({ t: 'gm', a: 'tp', ...wall });
  const tp = await A.next('teleported');
  assert.deepEqual([tp.x, tp.y], [wall.x, wall.y]);
  A.close(); B.close();
});

test('панель ГМ: правка героя — пределы (характеристики от 1, уровень, опыт, здоровье), в сети и вне сети, журнал', async (t) => {
  const { s, admin, bob, w } = await setup();
  t.after(() => s.stop());
  const edit = (body) => api(s.base, 'POST', '/api/admin/characters/edit', { username: 'bob', characterId: bob.characterId, ...body }, admin.token);
  let r = await api(s.base, 'GET', '/api/admin/accounts/bob/characters', undefined, admin.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.characters[0].name, 'Боб');
  assert.ok(r.data.characters[0].max.hp > 0 && r.data.characters[0].xpToNext > 0);
  assert.equal(r.data.characters[0].positions, undefined);
  // ошибки: ничего не меняется
  const maxLevel = (await api(s.base, 'GET', '/api/config')).data.game.maxLevel;
  assert.ok(maxLevel >= 99);
  for (const bad of [{ stats: { strength: 0 } }, { stats: { strength: -3 } }, { stats: { luck: 5 } }, { level: 0 }, { level: maxLevel + 1 }, { xp: -1 }, { xp: 1e9 }, { hp: 0 }, { hp: 1e6 }, { unspentPoints: -1 }, { deaths: 1.5 }]) {
    r = await edit(bad);
    assert.equal(r.status, 400, `должно отклоняться: ${JSON.stringify(bad)} → ${JSON.stringify(r.data)}`);
  }
  // вне сети
  r = await edit({ stats: { strength: 7 }, level: 5, unspentPoints: 3, deaths: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.character.stats.strength, r.data.character.level, r.data.character.unspentPoints, r.data.character.deaths, r.data.character.online], [7, 5, 3, 2, false]);
  // в сети: сразу приходят новые показатели
  const B = await joinWorld(s.base, bob, w.id);
  r = await edit({ level: 6, hp: 10, xp: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.character.online, true);
  const me = await B.next((m) => m.t === 'me' && m.lvl === 6);
  assert.deepEqual([me.hp, me.xp], [10, 1]);
  B.close();
  await B.closed;
  await sleep(200);
  const file = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'characters', (await api(s.base, 'GET', '/api/me', undefined, bob.token)).data.account.id + '.json'), 'utf8')).characters[0];
  assert.deepEqual([file.level, file.stats.strength], [6, 7]);
  const log = readLog(s).filter((x) => x.action === 'edit-character');
  assert.equal(log.length, 2);
  assert.deepEqual(log[0].changes.strength, [log[0].changes.strength[0], 7]);
});
