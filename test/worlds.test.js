'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../shared/worldgen');
const M = require('../shared/movement');
const { startServer, api, validCharacter } = require('./helpers');

const worldParams = (patch = {}) => ({
  name: 'Пустоши Севера', seed: 'north-1', size: 'small', enemyDensity: 'normal', hordeFrequency: 'rare', dragons: 2, scaleToLevel: false, ...patch,
});

test('миры: создание, список, доступ, удаление', async (t) => {
  const s = await startServer(['--set', 'game.maxWorlds=2']);
  t.after(() => s.stop());
  const b = s.base;
  const a = (await api(b, 'POST', '/api/register', { username: 'owner', password: 'secret123' })).data.token;
  const other = (await api(b, 'POST', '/api/register', { username: 'other', password: 'secret123' })).data.token;

  assert.equal((await api(b, 'GET', '/api/worlds')).status, 401);
  assert.deepEqual((await api(b, 'GET', '/api/worlds', undefined, a)).data.worlds, []);

  const c = await api(b, 'POST', '/api/worlds', worldParams(), a);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const w = c.data.world;
  assert.equal(w.ownerName, 'owner');
  assert.equal(w.width, 128);
  assert.equal(w.genVersion, G.GEN_VERSION);
  // клиент получит ту же карту по сиду
  const local = G.generate(w);
  assert.equal(G.mapHash(local), w.mapHash, 'контрольная сумма сервера совпадает с локальной генерацией');
  assert.deepEqual(w.spawn, local.spawn);
  assert.ok(fs.existsSync(path.join(s.dataDir, 'worlds', w.id + '.json')), 'мир хранится в data/worlds/');

  const bad = await api(b, 'POST', '/api/worlds', worldParams({ seed: 'с пробелом', dragons: 99 }), a);
  assert.equal(bad.status, 400);
  assert.equal(bad.data.errors.length, 2);

  assert.equal((await api(b, 'GET', '/api/worlds/' + w.id, undefined, a)).data.world.seed, 'north-1');
  assert.equal((await api(b, 'GET', '/api/worlds/' + w.id, undefined, other)).status, 404, 'чужой мир недоступен');
  assert.deepEqual((await api(b, 'GET', '/api/worlds', undefined, other)).data.worlds, []);
  assert.equal((await api(b, 'DELETE', '/api/worlds/' + w.id, undefined, other)).status, 404);
  assert.equal((await api(b, 'GET', '/api/worlds/../accounts', undefined, a)).status, 404);

  assert.equal((await api(b, 'POST', '/api/worlds', worldParams({ name: 'Второй' }), a)).status, 200);
  const over = await api(b, 'POST', '/api/worlds', worldParams({ name: 'Третий' }), a);
  assert.equal(over.status, 400);
  assert.match(over.data.error, /Не больше 2/);

  assert.equal((await api(b, 'DELETE', '/api/worlds/' + w.id, undefined, a)).status, 200);
  assert.equal((await api(b, 'GET', '/api/worlds/' + w.id, undefined, a)).status, 404);
  assert.equal((await api(b, 'GET', '/api/worlds', undefined, a)).data.worlds.length, 1);
});

test('миры: одинаковый сид у разных игроков — одинаковая карта', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const hashes = [];
  for (const u of ['player1', 'player2']) {
    const tok = (await api(s.base, 'POST', '/api/register', { username: u, password: 'secret123' })).data.token;
    hashes.push((await api(s.base, 'POST', '/api/worlds', worldParams({ seed: 'shared-seed' }), tok)).data.world.mapHash);
  }
  const tok = (await api(s.base, 'POST', '/api/login', { username: 'player1', password: 'secret123' })).data.token;
  hashes.push((await api(s.base, 'POST', '/api/worlds', worldParams({ seed: 'other-seed', name: 'Иной' }), tok)).data.world.mapHash);
  assert.equal(hashes[0], hashes[1]);
  assert.notEqual(hashes[0], hashes[2]);
});

test('позиция героя: сохранение по мирам и проверка', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const b = s.base;
  const a = (await api(b, 'POST', '/api/register', { username: 'hero', password: 'secret123' })).data.token;
  const other = (await api(b, 'POST', '/api/register', { username: 'thief', password: 'secret123' })).data.token;
  const ch = (await api(b, 'POST', '/api/characters', validCharacter(), a)).data.character;
  assert.deepEqual(ch.positions, {});
  const w1 = (await api(b, 'POST', '/api/worlds', worldParams(), a)).data.world;
  const w2 = (await api(b, 'POST', '/api/worlds', worldParams({ name: 'Юг', seed: 'south' }), a)).data.world;
  const map1 = G.generate(w1);

  // найдём проходимую клетку рядом с точкой появления
  const p1 = { worldId: w1.id, x: map1.spawn.x + 0.5, y: map1.spawn.y + 0.5, z: 0 };
  const r = await api(b, 'POST', `/api/characters/${ch.id}/position`, p1, a);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.position.x, p1.x);

  const p2 = { worldId: w2.id, x: w2.spawn.x + 0.5, y: w2.spawn.y + 0.5 };
  assert.equal((await api(b, 'POST', `/api/characters/${ch.id}/position`, p2, a)).status, 200);

  const saved = (await api(b, 'GET', '/api/characters/' + ch.id, undefined, a)).data.character;
  assert.deepEqual([saved.positions[w1.id].x, saved.positions[w1.id].y], [p1.x, p1.y]);
  assert.deepEqual([saved.positions[w2.id].x, saved.positions[w2.id].y], [p2.x, p2.y]);
  assert.equal(saved.lastWorld.worldId, w2.id);

  // ошибки
  let water = null;
  for (let i = 0; i < map1.tiles.length && !water; i++) if (!M.posWalkable(map1, i % map1.width, Math.floor(i / map1.width))) water = i;
  const bad = [
    [{ ...p1, x: (water % map1.width) + 0.5, y: Math.floor(water / map1.width) + 0.5 }, 400],
    [{ ...p1, x: -5 }, 400],
    [{ ...p1, x: 'abc' }, 400],
    [{ ...p1, z: 2 }, 400],
    [{ ...p1, worldId: 'nope' }, 404],
    [{ ...p1, worldId: undefined }, 404],
  ];
  for (const [body, code] of bad) {
    assert.equal((await api(b, 'POST', `/api/characters/${ch.id}/position`, body, a)).status, code, JSON.stringify(body));
  }
  // чужой персонаж / чужой мир
  assert.equal((await api(b, 'POST', `/api/characters/${ch.id}/position`, p1, other)).status, 404);
  assert.equal((await api(b, 'POST', '/api/characters/00000000-0000-0000-0000-000000000000/position', p1, a)).status, 404);
});

test('настройки игрового экрана приходят клиенту через /api/config и меняются флагом --set', async (t) => {
  const s = await startServer(['--set', 'game.zoomMax=3', '--set', 'game.renderChunkSize=24']);
  t.after(() => s.stop());
  const r = await api(s.base, 'GET', '/api/config');
  assert.equal(r.status, 200);
  const g = r.data.game;
  for (const k of ['tileWidth', 'zoomMin', 'zoomMax', 'zoomDefault', 'heroSpeed', 'savePositionSec',
    'renderChunkSize', 'renderCacheBelowZoom', 'renderCacheMaxChunks', 'worldSizes', 'maxDragons',
    'maxPlayers', 'tickRate', 'interpDelayMs', 'reconnectBaseMs', 'reconnectMaxMs', 'reconnectMaxAttempts', 'connTimeoutSec']) {
    assert.ok(g[k] !== undefined, 'нет настройки game.' + k);
  }
  assert.equal(r.data.net.wsPath, '/ws', 'клиент узнаёт путь WebSocket');
  assert.equal(g.zoomMax, 3);
  assert.equal(g.renderChunkSize, 24);
  assert.ok(g.zoomMin < g.zoomDefault && g.zoomDefault < g.zoomMax);
});
