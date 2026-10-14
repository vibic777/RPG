'use strict';
// Состояние мира между сеансами (server/worldstate.js): враги с уровнем и здоровьем, турели, мины, таймер орд
// переживают перезапуск сервера — и при корректной остановке, и после аварийной (по автосохранению).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, api, newPlayer, joinWorld, tmpDir, rmDir, sleep } = require('./helpers');

const params = { name: 'Память', seed: 'mem-1', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false };
const say = (c, text) => c.send({ t: 'chat', text });

// Без сети: снимок и восстановление в той же комнате
test('состояние мира: снимок и восстановление врагов, турелей, мин и занятых мест на участках', () => {
  const dir = tmpDir();
  const config = require('../server/config');
  config.load({ overrides: { dataDir: dir } });
  const G = config.get().game;
  require('../shared/combat').configure(G);
  const Enemies = require('../shared/enemies');
  const Combat = require('../server/combat');
  const worldstate = require('../server/worldstate');
  const WorldGen = require('../shared/worldgen');
  try {
    const world = { id: '00000000-0000-4000-8000-0000000000aa', seed: 'mem-1', size: 'small', enemyDensity: 'normal', hordeFrequency: 'never', dragons: 0, genVersion: WorldGen.GEN_VERSION };
    const map = WorldGen.generate(world);
    const room = { id: world.id, world, map, players: new Map(), broadcast: () => {} };
    const z = Combat.spawnEnemy(room, Enemies.get('zombie'), 4, 10.5, 12.25, '1,1', {});
    z.hp = 7;
    Combat.stateOf(room).spawn.areas.set('1,1', { key: '1,1', ax: 1, ay: 1, cap: 3, alive: new Set([z.id]), pending: [], lastActive: 0 });
    Combat.spawnEnemy(room, Enemies.get('boss_raider'), 9, 20, 20, null, { ignoreSafe: true });
    const until = Date.now() + 600000;
    Combat.stateOf(room).turrets.set('t1', { id: 't1', item: 'turret_watchman', owner: 'acc1', ownerName: 'Тест', x: 5, y: 5, mag: 3, tier: 2, hp: 99, maxHp: 150, mode: 'strongest', until, next: 0 });
    Combat.stateOf(room).traps.set('m1', { id: 'm1', item: 'mine_clapper', owner: 'acc1', ownerName: 'Тест', x: 6, y: 6, armAt: 1, until });
    Combat.stateOf(room).spawn.nextHordeAt = 12345;
    assert.ok(Combat.saveWorldState(room) > 0);
    assert.ok(fs.existsSync(path.join(dir, 'worlds', world.id + '.state.json')));
    assert.equal(worldstate.load(world.id)._v, 1);

    const room2 = { id: world.id, world, map, players: new Map(), broadcast: () => {} };
    const cs = Combat.stateOf(room2);
    const es = [...cs.enemies.values()];
    assert.equal(es.length, 2);
    const z2 = es.find((e) => e.def.id === 'zombie');
    assert.deepEqual([z2.level, z2.x, z2.y, z2.hp, z2.area], [4, 10.5, 12.25, 7, '1,1']);
    assert.ok(cs.spawn.areas.get('1,1').alive.has(z2.id), 'враг снова занимает место на участке');
    assert.ok(es.find((e) => e.def.id === 'boss_raider' && e.level === 9 && e.ignoreSafe));
    const t = cs.turrets.get('t1');
    assert.deepEqual([t.tier, t.mag, t.hp, t.mode, t.until], [2, 3, 99, 'strongest', until]);
    assert.ok(t.prof && t.base, 'показатели турели пересчитаны');
    assert.ok(cs.traps.get('m1').prof);
    assert.equal(cs.spawn.nextHordeAt, 12345);
    worldstate.remove(world.id);
    assert.equal(worldstate.load(world.id), null);
  } finally { rmDir(dir); }
});

async function boot(data, extra = []) {
  return startServer(['--data', data, ...extra], { ipc: true });
}
const stopGracefully = (s) => new Promise((res) => { s.proc.once('exit', res); s.proc.send('shutdown'); });
const hardKill = (s) => new Promise((res) => { s.proc.once('exit', res); s.proc.kill('SIGKILL'); });

async function scenario(t, { autosave, stop }) {
  const dir = tmpDir();
  const data = path.join(dir, 'data');
  t.after(() => rmDir(dir));
  const extra = ['--set', `autosaveSec=${autosave}`, '--set', 'game.chatRateCount=50', '--set', 'backupOnStart=false'];
  const s1 = await boot(data, extra);
  const admin = await newPlayer(s1.base, 'admin', 'Алиса');
  const w = (await api(s1.base, 'POST', '/api/worlds', params, admin.token)).data.world;
  const A = await joinWorld(s1.base, admin, w.id);
  say(A, '/spawn zombie 2');
  say(A, '/spawn boss_raider');
  await A.next((m) => m.t === 'enemy-add' && m.enemy.type === 'boss_raider');
  await sleep(150);
  if (autosave) await sleep(autosave * 1000 + 700);
  await stop(s1);
  A.close();
  const s2 = await boot(data, extra);
  t.after(() => new Promise((res) => { s2.proc.once('exit', res); s2.proc.kill(); }));
  const login = await api(s2.base, 'POST', '/api/login', { username: 'admin', password: 'secret123' });
  const A2 = await joinWorld(s2.base, { ...admin, token: login.data.token }, w.id);
  const types = A2.welcome.enemies.map((e) => e.type).sort();
  assert.equal(types.filter((x) => x === 'zombie').length, 2, JSON.stringify(types));
  assert.ok(types.includes('boss_raider'), JSON.stringify(types));
  for (const e of A2.welcome.enemies) assert.ok(e.hp > 0 && e.hp <= e.maxHp);
  A2.close();
}

test('WS: враги (и босс) переживают корректную остановку сервера', async (t) => {
  await scenario(t, { autosave: 0, stop: stopGracefully });
});

test('WS: после аварийной остановки враги восстанавливаются из автосохранения (autosaveSec)', async (t) => {
  await scenario(t, { autosave: 1, stop: hardKill });
});

test('WS «Сохранить»: только владелец мира (или администратор), пауза между сохранениями, файл состояния записан', async (t) => {
  const s = await startServer(['--set', 'autosaveSec=0', '--set', 'game.manualSaveCooldownSec=60', '--set', 'game.chatRateCount=50']);
  t.after(() => s.stop());
  const admin = await newPlayer(s.base, 'admin', 'Алиса'); // первый аккаунт — администратор
  const owner = await newPlayer(s.base, 'owner', 'Олег');
  const guest = await newPlayer(s.base, 'guest', 'Гость');
  const w = (await api(s.base, 'POST', '/api/worlds', params, owner.token)).data.world;
  const code = (await api(s.base, 'POST', `/api/worlds/${w.id}/share`, { open: true, invite: 'new' }, owner.token)).data.world.inviteCode;
  await api(s.base, 'POST', '/api/worlds/join', { code }, guest.token);
  await api(s.base, 'POST', '/api/worlds/join', { code }, admin.token);
  const O = await joinWorld(s.base, owner, w.id);
  const Gc = await joinWorld(s.base, guest, w.id);
  assert.equal(O.welcome.owner, true);
  assert.equal(Gc.welcome.owner, false);
  const file = path.join(s.dataDir, 'worlds', w.id + '.state.json');
  Gc.send({ t: 'save' });
  assert.equal((await Gc.next('saved')).ok, false, 'гость не сохраняет');
  assert.ok(!fs.existsSync(file));
  O.send({ t: 'save' });
  const r = await O.next('saved');
  assert.equal(r.ok, true, r.message);
  assert.ok(fs.existsSync(file), 'состояние мира записано');
  O.send({ t: 'save' });
  assert.match((await O.next('saved')).message, /через \d+ с/);
  const A = await joinWorld(s.base, admin, w.id);
  A.send({ t: 'save' });
  assert.match((await A.next('saved')).message, /через/, 'администратор может, но пауза общая для мира');
  for (const c of [O, Gc, A]) c.close();
});
