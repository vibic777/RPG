'use strict';
// Шаг 13: вертикальные уровни — генерация, связность входов и выходов, сложность, дыхание, падение, плавание
const test = require('node:test');
const assert = require('node:assert');
const G = require('../shared/worldgen');
const M = require('../shared/movement');
const L = require('../shared/levels');
const E = require('../shared/enemies');

const mapOf = (seed, size = 'small') => G.generate({ seed, size, dragons: 2 });

test('уровни: входы на поверхности детерминированы и стоят на подходящих клетках', () => {
  const a = L.entrances(mapOf('lv-1')), b = L.entrances(mapOf('lv-1'));
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a.map((e) => [e.x, e.y]), L.entrances(mapOf('lv-2')).map((e) => [e.x, e.y]));
  const m = mapOf('lv-1');
  const types = new Set(L.entrances(m).map((e) => e.type));
  for (const t of Object.keys(L.TYPES)) if (!L.TYPES[t].house) assert.ok(types.has(t), 'есть вход типа ' + t); // дома — свои двери (shared/houses.js)
  for (const e of L.entrances(m)) {
    const t = G.tileAt(m, e.x, e.y);
    if (e.kind === 'dive') assert.strictEqual(t, G.B.WATER, e.id + ' — погружение с воды');
    else assert.ok(G.BIOMES[t].walkable, e.id + ' — вход на суше');
    if (!e.disabled) assert.ok(e.depth >= 1 && e.depth <= 5);
    assert.ok(L.KINDS[e.kind], 'известный вид входа ' + e.kind);
  }
  const lift = L.entrances(m).find((e) => e.kind === 'elevator');
  assert.ok(lift && lift.disabled, 'лифт — заготовка (обесточен)');
  assert.strictEqual(L.level(m, lift.id + '.1'), null);
  // поверхность от уровней не зависит: контрольная сумма прежняя
  assert.strictEqual(G.mapHash(m), G.mapHash(mapOf('lv-1')));
});

test('уровни: генерация детерминирована по сиду и id входа; неверные ключи отклоняются', () => {
  const m1 = mapOf('lv-det'), m2 = mapOf('lv-det');
  for (const e of L.entrances(m1).filter((x) => !x.disabled)) {
    for (let n = 1; n <= e.depth; n++) {
      const a = L.level(m1, `${e.id}.${n}`), b = L.level(m2, `${e.id}.${n}`);
      assert.deepStrictEqual(Buffer.from(a.tiles), Buffer.from(b.tiles), `${e.id}.${n}`);
      assert.deepStrictEqual(a.exits, b.exits);
      assert.deepStrictEqual(a.caches, b.caches);
      assert.strictEqual(a.z, e.dir * n);
      assert.ok(a.z >= L.Z_MIN && a.z <= L.GROUND_TOP && a.z !== 0);
      assert.ok(G.isWalkable(a, a.spawn.x, a.spawn.y), 'вход проходим');
      for (const p of [...a.exits, ...a.caches, ...a.spots]) assert.ok(G.isWalkable(a, p.x, p.y), 'точка проходима');
      // всё важное достижимо от входа
      const grid = M.gridFromWorld(a);
      for (const p of [...a.exits, ...a.caches]) assert.ok(M.findPath(grid, a.spawn.x, a.spawn.y, p.x, p.y), `${a.key}: путь к ${p.x},${p.y}`);
    }
  }
  const e = L.entrances(m1).find((x) => !x.disabled);
  for (const bad of ['', 'zz.1', `${e.id}.0`, `${e.id}.${e.depth + 1}`, `${e.id}.1x`, '../x.1']) assert.strictEqual(L.level(m1, bad), null, bad);
  // другой сид — другая карта уровня
  const other = mapOf('lv-det-2');
  const e2 = L.entrances(other).find((x) => x.type === e.type);
  assert.notDeepStrictEqual(Buffer.from(L.level(other, e2.id + '.1').tiles), Buffer.from(L.level(m1, e.id + '.1').tiles));
});

test('уровни: входы и выходы связаны в обе стороны', () => {
  const m = mapOf('lv-link');
  for (const e of L.entrances(m).filter((x) => !x.disabled)) {
    // поверхность → уровень 1 → назад на поверхность к тому же входу
    const p = L.nearbyPortal(m, null, e.x + 0.5, e.y + 0.5);
    assert.strictEqual(p.id, e.id);
    const t1 = L.portalTarget(m, p);
    assert.strictEqual(t1.key, e.id + '.1');
    const lv1 = L.level(m, t1.key);
    const back = L.nearbyPortal(m, lv1, t1.x + 0.5, t1.y + 0.5);
    assert.deepStrictEqual(L.portalTarget(m, back), { key: 'ground', x: e.x, y: e.y, z: 0 });
    for (let n = 1; n < e.depth; n++) { // вниз и снова вверх — в ту же точку
      const lv = L.level(m, `${e.id}.${n}`);
      const down = lv.exits.find((x) => x.kind === 'down' || x.kind === 'ladder' || x.kind === 'ramp');
      const t = L.portalTarget(m, { ...down, from: lv.key });
      assert.strictEqual(t.key, `${e.id}.${n + 1}`);
      const lvN = L.level(m, t.key);
      const up = L.nearbyPortal(m, lvN, t.x + 0.5, t.y + 0.5);
      assert.strictEqual(up.kind, 'up');
      const r = L.portalTarget(m, up);
      assert.deepStrictEqual([r.key, r.x, r.y], [lv.key, down.x, down.y]);
    }
    if (e.exit) { // затопленная пещера: тайный выход на сушу и обратно
      const lv = L.level(m, e.id + '.1');
      const secret = lv.exits.find((x) => x.secret);
      assert.deepStrictEqual(L.portalTarget(m, { ...secret, from: lv.key }), { key: 'ground', x: e.exit.x, y: e.exit.y, z: 0 });
      const dry = L.nearbyPortal(m, null, e.exit.x + 0.5, e.exit.y + 0.5);
      const t = L.portalTarget(m, dry);
      assert.deepStrictEqual([t.key, t.x, t.y], [lv.key, secret.x, secret.y]);
      assert.ok(G.BIOMES[G.tileAt(m, e.exit.x, e.exit.y)].walkable);
    }
  }
});

test('уровни: сложность и добыча растут с глубиной, босс только на самом дне', () => {
  const m = mapOf('lv-diff', 'medium');
  const deep = L.entrances(m).filter((e) => e.dir < 0 && e.depth >= 3);
  assert.ok(deep.length);
  for (const e of deep) {
    let prev = null;
    for (let n = 1; n <= e.depth; n++) {
      const lv = L.level(m, `${e.id}.${n}`);
      if (prev) {
        assert.ok(lv.enemyLevel > prev.enemyLevel, 'уровень врагов растёт');
        assert.ok(lv.spots.length >= prev.spots.length, 'врагов не меньше');
        assert.ok(lv.caches.length >= prev.caches.length, 'тайников не меньше');
      }
      assert.strictEqual(Boolean(lv.boss), Boolean(L.TYPES[e.type].boss) && n === e.depth, `${lv.key}: босс`);
      prev = lv;
    }
  }
  for (const [k, t] of Object.entries(L.TYPES)) {
    for (const id of t.enemies) assert.ok(E.get(id), `${k}: враг ${id}`);
    if (t.boss) assert.ok(E.get(t.boss) && E.get(t.boss).boss, `${k}: босс ${t.boss}`);
  }
  assert.strictEqual(L.difficulty(m, { x: m.spawn.x, y: m.spawn.y }, 3) - L.difficulty(m, { x: m.spawn.x, y: m.spawn.y }, 1), 2 * L.settings.levelDepthEnemyBonus);
  // водные мутанты не появляются на поверхности
  for (const id of ['mutant_eel', 'crab_mutant', 'alien_drone', 'raider_sniper']) {
    assert.ok(Object.keys(E.get(id).biomes).every((b) => G.BIOMES.find((x) => x.key === b).level), id);
  }
});

test('уровни: дыхание, удушье, акваланг, падение, ныряние', () => {
  const st = {};
  assert.strictEqual(L.stepBreath(st, 1, { underwater: false }), 0);
  assert.strictEqual(st.breath, L.settings.breathSec);
  let dmg = 0;
  for (let i = 0; i < L.settings.breathSec; i++) dmg += L.stepBreath(st, 1, { underwater: true, maxHp: 100 });
  assert.strictEqual(dmg, 0, 'пока есть воздух — урона нет');
  assert.strictEqual(st.breath, 0);
  assert.strictEqual(L.stepBreath(st, 1, { underwater: true, maxHp: 100 }), L.settings.drownDamagePct, 'удушье');
  L.stepBreath(st, 1, { underwater: false });
  assert.strictEqual(st.breath, L.settings.breathRegenPerSec, 'на воздухе запас восстанавливается');
  const sc = {};
  L.stepBreath(sc, 0, { underwater: true, scuba: true });
  assert.strictEqual(sc.breath, L.settings.breathSec + L.settings.scubaBreathSec, 'акваланг — больше воздуха');
  assert.strictEqual(L.breathMax(true) > L.breathMax(false), true);
  assert.ok(L.canDive(-1, false));
  assert.ok(!L.canDive(-2, false));
  assert.ok(L.canDive(-5, true));
  assert.strictEqual(L.fallDamage(0, 100), 0);
  assert.strictEqual(L.fallDamage(2, 100), 2 * L.settings.fallDamagePct);
  assert.strictEqual(L.fallDamage(50, 100), 100, 'не больше макс. здоровья');
  assert.strictEqual(L.zName(0), 'Поверхность');
  assert.strictEqual(L.zName(-3), 'Глубина 3');
  assert.strictEqual(L.zName(4), 'Высота 4');
  assert.strictEqual(L.zName(7), 'Небо 2');
});

test('плавание: вода проходима только пловцу, медленно; острова не преграда', () => {
  const m = mapOf('lv-swim');
  let wx = -1, wy = -1;
  for (let i = 0; i < m.tiles.length && wx < 0; i++) if (m.tiles[i] === G.B.WATER) { wx = i % m.width; wy = (i / m.width) | 0; }
  assert.ok(!G.isWalkable(m, wx, wy));
  m.swimmer = true;
  assert.ok(G.isWalkable(m, wx, wy));
  assert.ok(!G.isWalkable(m, -1, 0), 'за край карты не уплыть');
  assert.strictEqual(M.speedAt(m, wx + 0.5, wy + 0.5), M.settings.heroSpeed * M.settings.swimSpeed);
  assert.ok(M.isSwimming(m, wx + 0.5, wy + 0.5));
  const mt = m.tiles.indexOf(G.B.MOUNTAIN);
  assert.ok(!G.isWalkable(m, mt % m.width, (mt / m.width) | 0), 'горы и вплавь непроходимы');
  m.swimmer = false;
});
