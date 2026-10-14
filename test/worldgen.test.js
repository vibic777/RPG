'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../shared/worldgen');

const params = (seed, size = 'small', dragons = 3) => ({ seed, size, dragons });

test('генерация: одинаковый сид — одинаковая карта', () => {
  const a = G.generate(params('ржавчина-42'));
  const b = G.generate(params('ржавчина-42'));
  assert.equal(G.mapHash(a), G.mapHash(b));
  assert.deepEqual(Buffer.from(a.tiles), Buffer.from(b.tiles));
  assert.deepEqual(a.settlements, b.settlements);
  assert.deepEqual(a.lairs, b.lairs);
  assert.deepEqual(a.spawn, b.spawn);
});

test('генерация: разные сиды — разные карты', () => {
  const hashes = new Set(['a', 'b', 'c', 'seed1', 'seed2'].map((s) => G.mapHash(G.generate(params(s)))));
  assert.equal(hashes.size, 5);
  const a = G.generate(params('a')), b = G.generate(params('b'));
  let diff = 0;
  for (let i = 0; i < a.tiles.length; i++) if (a.tiles[i] !== b.tiles[i]) diff++;
  assert.ok(diff > a.tiles.length * 0.3, `карты должны заметно отличаться (${diff})`);
});

test('генерация: контрольная сумма стабильна между версиями кода (регрессия)', () => {
  // Если алгоритм намеренно изменён — увеличьте GEN_VERSION и обновите ожидаемое значение.
  // Версия 3 — формы карты и водные профили (waterMode). Старые миры без waterMode получают genVersion 2:
  // клетки, точка появления, поселения и логова у них те же, что в версии 1 (сумма изменилась лишь от поля shape в mapHash).
  assert.equal(G.GEN_VERSION, 4);
  const legacy = G.generate({ seed: 'abc', size: 'small', dragons: 5 });
  assert.equal(legacy.genVersion, 2);
  assert.equal(legacy.shape, 'square');
  assert.equal(G.mapHash(legacy), '5f84603c');
  const sea = G.generate({ seed: 'abc', size: 'small', dragons: 5, shape: 'continent', waterMode: 'auto' });
  assert.equal(sea.genVersion, G.GEN_VERSION);
  assert.equal(G.mapHash(sea), '3221d511');
  assert.equal(G.mapHash(G.generate({ seed: 'abc', size: 'small', dragons: 5, shape: 'islands', waterMode: 'archipelago' })), 'edf09e2a');
});

test('генерация: все биомы, проходимая точка появления, поселения и логова', () => {
  for (const seed of ['alpha', 'beta', 'gamma']) {
    const w = G.generate({...params(seed, 'medium', 5),genVersion:G.GEN_VERSION});
    assert.equal(w.width, 256);
    assert.equal(w.tiles.length, 256 * 256);
    const present = new Set(w.tiles);
    for (const b of G.BIOMES.filter((x) => !x.level)) assert.ok(present.has(b.id), `${seed}: нет биома ${b.name}`);
    assert.ok(G.isWalkable(w, w.spawn.x, w.spawn.y), 'точка появления проходима');
    assert.equal(w.spawn.z, 0);
    assert.ok(w.settlements.length >= 3);
    for (const s of w.settlements) {
      assert.ok(G.isWalkable(w, s.x, s.y));
      assert.equal(w.region[s.y * w.width + s.x], w.region[w.spawn.y * w.width + w.spawn.x], 'поселение достижимо от точки появления');
      assert.equal(s.z, 0);
    }
    assert.equal(w.lairs.length, 5);
    assert.equal(w.z, 0, 'поле уровня для будущих 15 вертикальных уровней');
  }
});

test('генерация: край карты — вода, вне карты — непроходимо', () => {
  const w = G.generate(params('edge'));
  for (let i = 0; i < w.width; i++) {
    assert.equal(G.tileAt(w, i, 0), G.B.WATER);
    assert.equal(G.tileAt(w, 0, i), G.B.WATER);
  }
  assert.equal(G.isWalkable(w, -1, 5), false);
  assert.equal(G.isWalkable(w, w.width, 5), false);
});

test('параметры мира: проверка', () => {
  const ok = { name: 'Пустоши Севера', seed: 'abc-123', size: 'medium', enemyDensity: 'normal', hordeFrequency: 'rare', dragons: 3, scaleToLevel: true };
  assert.equal(G.validateParams(ok).ok, true);
  const bad = (patch) => G.validateParams({ ...ok, ...patch }).ok;
  assert.equal(bad({ name: 'Я' }), false);
  assert.equal(bad({ seed: '' }), false);
  assert.equal(bad({ seed: 'a b' }), false);
  assert.equal(bad({ seed: 'x'.repeat(33) }), false);
  assert.equal(bad({ size: 'gigantic' }), false);
  assert.equal(bad({ size: 'toString' }), false);
  assert.equal(bad({ enemyDensity: 'max' }), false);
  assert.equal(bad({ hordeFrequency: 1 }), false);
  assert.equal(bad({ dragons: -1 }), false);
  assert.equal(bad({ dragons: 1.5 }), false);
  assert.equal(bad({ dragons: G.settings.maxDragons + 1 }), false);
  assert.equal(G.validateParams({ ...ok, scaleToLevel: 'yes' }).ok, true, 'устаревшее поле не управляет новой автоподстройкой');
  assert.match(G.randomSeed(), /^[a-z0-9]{8}$/);
});

test('ГПСЧ и шум детерминированы и в диапазоне [0, 1)', () => {
  const r1 = G.mulberry32(123), r2 = G.mulberry32(123);
  for (let i = 0; i < 100; i++) { const v = r1(); assert.equal(v, r2()); assert.ok(v >= 0 && v < 1); }
  for (let i = 0; i < 200; i++) {
    const v = G.fbm(i * 0.37, i * 0.11, 7, 4);
    assert.ok(v >= 0 && v < 1);
    assert.equal(v, G.fbm(i * 0.37, i * 0.11, 7, 4));
  }
  assert.equal(G.hashString('abc'), G.hashString('abc'));
  assert.notEqual(G.hashString('abc'), G.hashString('abd'));
});
