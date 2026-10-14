'use strict';
// Бестиарий (shared/enemies.js), ИИ врагов (server/ai.js) и появление (server/spawner.js) — без сети, на тестовой карте.
const test = require('node:test');
const assert = require('node:assert/strict');
const Enemies = require('../shared/enemies');
const Items = require('../shared/items');
const WorldGen = require('../shared/worldgen');
const Combat = require('../shared/combat');
const M = require('../shared/movement');
const config = require('../server/config');
const AI = require('../server/ai');
const Spawner = require('../server/spawner');

const G = { ...config.DEFAULTS.game };
Enemies.configure(G);
M.configure(G);

// Тестовая карта: вся — пустошь, при желании — полоса гор
function fakeMap(w = 80, h = 80, spawn = { x: 5, y: 5 }) {
  return { width: w, height: h, tiles: new Uint8Array(w * h).fill(WorldGen.B.WASTE ?? 3), region: null, spawn, settlements: [] };
}
function makeEnemy(defId, x, y, level = 1) {
  const def = Enemies.get(defId);
  const st = Enemies.statsAt(def, level);
  return { id: defId + '-' + x + '-' + y, def, level, x, y, home: { x, y }, hp: st.maxHp, maxHp: st.maxHp, damage: st.damage, state: 'idle', target: null, path: [], dots: [], stunUntil: 0, speedMul: 1 };
}
function ctxFor(map, players, enemies, game = G) {
  const attacks = [];
  const ctx = {
    map, grid: M.gridFromWorld(map), game, now: 1000000, rnd: Combat.rng(1), players, enemies,
    isSafe: (x, y) => Spawner.isSafe(map, x, y, game),
    attack: (e, t) => attacks.push([e.id, t.id]),
  };
  ctx.attacks = attacks;
  return ctx;
}
// прогнать ИИ n тиков по dt секунд
function run(ctx, n, dt = 0.05) {
  for (let i = 0; i < n; i++) {
    ctx.now += dt * 1000;
    for (const e of ctx.enemies) AI.think(ctx, e, dt);
  }
}

test('бестиарий: данные корректны, все семейства заполнены, главари со свитой, супер-босс, летающий дракон', () => {
  assert.deepEqual(Enemies.validate(), []);
  assert.ok(Enemies.ENEMIES.length >= 26);
  const fam = new Set(Enemies.ENEMIES.map((e) => e.family));
  for (const f of Object.keys(Enemies.FAMILIES)) { assert.ok(fam.has(f), f); assert.ok(!Enemies.FAMILIES[f].later, f); }
  // киборги: ближний и дальний бой, уязвимы к ЭМИ
  const cy = Enemies.ENEMIES.filter((e) => e.family === 'cyborg' && !e.boss);
  assert.deepEqual(new Set(cy.map((e) => e.attack.kind)), new Set(['melee', 'ranged']));
  assert.ok(cy.every((e) => e.tags.includes('cyborg')));
  assert.ok(Enemies.ENEMIES.filter((e) => e.family === 'alien').length >= 1);
  // дракон: сильный, летает, одиночка, приручить пока нельзя
  const dr = Enemies.get('dragon_fire');
  assert.ok(dr.fly && dr.tameable && dr.behaviour === 'loner' && dr.hp >= 5 * Enemies.get('bear').hp);
  // главари банд: по одному на банду (рейдеры, мутанты), свита из своих, добыча богаче обычной
  const bosses = Enemies.ENEMIES.filter((e) => e.boss && e.spawn);
  assert.deepEqual(bosses.map((e) => e.family).sort(), ['cyborg', 'human', 'mage', 'mutant']); // главари банд (шаг 16 — киборги и ниндзя)
  for (const b of bosses) {
    assert.ok(b.guards.length && b.guards.every((g) => Enemies.get(g).family === b.family), b.id);
    assert.ok(Enemies.LOOT[b.loot].rolls[0] > Enemies.LOOT.raider_rich.rolls[0]);
  }
  const sup = Enemies.get('boss_super');
  assert.ok(sup.boss && sup.spawn === false && sup.hp > Math.max(...bosses.map((b) => b.hp)) * 3);
  // таблица добычи с повышенной редкостью даёт редкие вещи чаще
  const rare = (t) => { let k = 0; const rnd = Combat.rng(7); for (let i = 0; i < 300; i++) for (const x of Enemies.rollLoot(t, 20, rnd)) { const it = Items.get(x.id); if (it.rarity !== 'common' && it.rarity !== 'uncommon' && !it.stackable) k++; } return k; };
  assert.ok(rare('boss_gang') > rare('raider_rich'));
  // все виды поведения используются, степени мутантов идут по силе
  for (const b of Object.keys(Enemies.BEHAVIOURS)) assert.ok(Enemies.ENEMIES.some((e) => e.behaviour === b), b);
  const hp = ['mutant_irradiated', 'mutant_slasher', 'mutant_brute'].map((id) => Enemies.get(id).hp);
  assert.ok(hp[0] < hp[1] && hp[1] < hp[2]);
  // сломанные данные ловятся
  const e = Enemies.ENEMIES[0];
  const saved = e.loot;
  e.loot = 'nope';
  assert.ok(Enemies.validate().some((m) => m.includes('nope')));
  e.loot = saved;
});

test('показатели врага растут с уровнем', () => {
  const def = Enemies.get('wolf');
  const a = Enemies.statsAt(def, 1), b = Enemies.statsAt(def, 5);
  assert.equal(a.maxHp, def.hp);
  assert.ok(b.maxHp > a.maxHp && b.damage[1] > a.damage[1] && b.defense > a.defense && b.xp > a.xp);
});

test('ИИ: стоит → замечает героя → преследует → атакует', () => {
  const map = fakeMap();
  const e = makeEnemy('raider_thug', 40, 40);
  const hero = { id: 'h1', x: 46, y: 40, dead: false, radius: 0.3 };
  const ctx = ctxFor(map, [hero], [e]);
  run(ctx, 1);
  assert.equal(e.state, 'chase');
  assert.equal(e.target, 'h1');
  run(ctx, 60);
  assert.equal(e.state, 'attack');
  assert.ok(Math.hypot(e.x - hero.x, e.y - hero.y) <= e.def.attack.range + 0.3 + 1e-6);
  assert.ok(ctx.attacks.length >= 1);
  // скорость атак врага ограничена его данными
  const before = ctx.attacks.length;
  run(ctx, 20, 0.05); // 1 секунда
  assert.ok(ctx.attacks.length - before <= Math.ceil(e.def.attack.speed) + 1);
});

test('ИИ: наземные враги преследуют медленнее героя и сохраняют окно для отхода', () => {
  const map = fakeMap();
  const e = makeEnemy('wolf', 40, 40);
  const hero = { id: 'h1', x: 46, y: 40, dead: false, radius: 0.3 };
  const ctx = ctxFor(map, [hero], [e]);
  run(ctx, 1);
  const start = e.x;
  run(ctx, 20, 0.05);
  const enemyTravel = Math.hypot(e.x - start, e.y - 40);
  assert.ok(enemyTravel <= e.def.speed * G.enemySpeedFactor * 1.1, `за секунду волк прошёл ${enemyTravel.toFixed(2)} клетки`);
  assert.ok(G.enemySpeedFactor < 1, 'наземный враг медленнее своей базовой скорости');
  assert.ok(e.def.fly !== true, 'проверяется наземный враг');
});

test('ИИ: героя вне радиуса обнаружения не видит; мёртвого бросает', () => {
  const map = fakeMap();
  const e = makeEnemy('boar', 40, 40);
  const hero = { id: 'h1', x: 40 + e.def.aggro + 2, y: 40, dead: false };
  const ctx = ctxFor(map, [hero], [e]);
  run(ctx, 5);
  assert.notEqual(e.state, 'chase');
  hero.x = 43;
  run(ctx, 1);
  assert.equal(e.state, 'chase');
  hero.dead = true;
  run(ctx, 1);
  assert.equal(e.state, 'return');
  assert.equal(e.target, null);
});

test('ИИ: поводок — дальше leash не уходит, возвращается домой и лечится', () => {
  const map = fakeMap(120, 60);
  const e = makeEnemy('boar', 30, 30);
  const hero = { id: 'h1', x: 34, y: 30, dead: false };
  const ctx = ctxFor(map, [hero], [e]);
  run(ctx, 1);
  assert.equal(e.state, 'chase');
  // герой убегает далеко — враг гонится, но за поводок не уходит, возвращается и дома лечится
  e.hp = e.maxHp / 2;
  let maxAway = 0, sawReturn = false, home = null;
  for (let i = 0; i < 800 && !home; i++) {
    hero.x = Math.min(115, hero.x + 0.25);
    run(ctx, 1);
    maxAway = Math.max(maxAway, Math.hypot(e.x - 30, e.y - 30));
    if (e.state === 'return') sawReturn = true;
    if (sawReturn && e.state === 'idle') home = { x: e.x, y: e.y, hp: e.hp };
  }
  assert.ok(maxAway > 5, 'преследовал');
  assert.ok(maxAway <= AI.leashRadius(e) + 1, 'не дальше поводка');
  assert.ok(home, 'вернулся');
  assert.ok(Math.hypot(home.x - 30, home.y - 30) < 1.5, 'домой');
  assert.ok(home.hp < e.maxHp, 'возвращение домой не лечит мгновенно');
  AI.recover({...ctx,players:[],now:ctx.now+10000},e,10);assert.ok(e.hp>home.hp&&e.hp<e.maxHp,'медленное восстановление после отхода');
});

test('ИИ: стая — заметил один, нападают все рядом; одиночки не реагируют', () => {
  const map = fakeMap();
  const w1 = makeEnemy('wolf', 40, 40), w2 = makeEnemy('wolf', 44, 44), w3 = makeEnemy('wolf', 70, 70);
  const bear = makeEnemy('bear', 41, 43);
  const hero = { id: 'h1', x: 40 - 6, y: 40, dead: false };
  const ctx = ctxFor(map, [hero], [w1, w2, w3, bear]);
  AI.think(ctx, w1, 0.05);
  assert.equal(w1.target, 'h1');
  assert.equal(w2.target, 'h1', 'сородич рядом тоже нападает');
  assert.equal(w3.target, null, 'далёкий не слышит тревоги');
  assert.equal(bear.target, null, 'другое семейство — не стая');
});

test('ИИ: раненый зверь убегает, потом возвращается к бою или домой', () => {
  const map = fakeMap();
  const w = makeEnemy('bear', 40, 40);
  const hero = { id: 'h1', x: 42, y: 40, dead: false };
  const ctx = ctxFor(map, [hero], [w]);
  run(ctx, 1);
  w.hp = w.maxHp * w.def.fleeAt * 0.5;
  run(ctx, 1);
  assert.equal(w.state, 'flee');
  const d0 = Math.hypot(w.x - hero.x, w.y - hero.y);
  run(ctx, 20);
  assert.ok(Math.hypot(w.x - hero.x, w.y - hero.y) > d0, 'убегает от героя');
  run(ctx, (G.fleeRecoverSec + 1) * 20);
  assert.notEqual(w.state, 'flee');
});

test('ИИ: стрелок стреляет издалека и отходит, если подойти вплотную', () => {
  const map = fakeMap();
  const g = makeEnemy('raider_gunner', 40, 40);
  const hero = { id: 'h1', x: 47, y: 40, dead: false };
  const ctx = ctxFor(map, [hero], [g]);
  run(ctx, 2);
  assert.equal(g.state, 'attack', 'стреляет с дистанции, не подходя');
  assert.ok(Math.hypot(g.x - 40, g.y - 40) < 0.5);
  hero.x = 41;
  run(ctx, 20);
  assert.ok(Math.hypot(g.x - hero.x, g.y - hero.y) > 1.5, 'отошёл');
});

test('ИИ: безопасная зона — враги не видят героя и не заходят туда', () => {
  const map = fakeMap(80, 80, { x: 10, y: 10 });
  const e = makeEnemy('raider_thug', 10.5 + G.spawnSafeRadius + 3, 10.5);
  const hero = { id: 'h1', x: 10.5 + G.spawnSafeRadius - 2, y: 10.5, dead: false };
  const ctx = ctxFor(map, [hero], [e]);
  run(ctx, 40);
  assert.equal(e.target, null);
  // принудительно натравить — всё равно останавливается на границе
  AI.engage(ctx, e, hero);
  run(ctx, 100);
  assert.ok(!Spawner.isSafe(map, e.x, e.y, G), 'в безопасную зону не вошёл');
  // враг администратора (ignoreSafe) зону не признаёт
  const a = makeEnemy('raider_thug', 10.5 + G.spawnSafeRadius + 3, 12);
  a.ignoreSafe = true;
  ctx.enemies.push(a);
  run(ctx, 1);
  assert.equal(a.target, 'h1');
});

test('ИИ: оглушённый враг не действует; расталкивание врагов', () => {
  const map = fakeMap();
  const e = makeEnemy('raider_thug', 40, 40);
  const hero = { id: 'h1', x: 44, y: 40, dead: false };
  const ctx = ctxFor(map, [hero], [e]);
  e.stunUntil = ctx.now + 10000;
  run(ctx, 10);
  assert.equal(e.state, 'idle');
  const a = makeEnemy('zombie', 20, 20), b = makeEnemy('zombie', 20.1, 20);
  AI.separate(ctxFor(map, [], [a, b]), [a, b]);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= G.enemySeparation - 1e-9);
});

// ---------- Появление ----------

function spawnCtx(map, world, players, game = G) {
  const list = [];
  let n = 0;
  return {
    map, world, game, now: 5000000, rnd: Combat.rng(42), players,
    count: () => list.length,
    spawn: (def, level, x, y, area, opts) => { const e = { id: 's' + (n++), def, level, x, y, area, opts }; list.push(e); return e; },
    despawn: (id) => { const i = list.findIndex((e) => e.id === id); if (i >= 0) list.splice(i, 1); return true; },
    announce: (t) => { list.announced = t; },
    list,
  };
}
const MAXG = Math.max(...Enemies.ENEMIES.map((x) => (x.guardCount ? x.guardCount[1] + 1 : x.group[1])));
const world = (o = {}) => ({ enemyDensity: 'normal', hordeFrequency: 'never', scaleToLevel: false, ...o });

test('появление: плотность мира, безопасная зона, расстояние до героев, предел', () => {
  const map = fakeMap(200, 200, { x: 100, y: 100 });
  const hero = { x: 100.5, y: 100.5, level: 1 };
  const counts = {};
  for (const d of ['none', 'low', 'normal', 'high']) {
    const ctx = spawnCtx(map, world({ enemyDensity: d }), [hero]);
    const st = Spawner.createState();
    for (let i = 0; i < 40; i++) { Spawner.step(ctx, st); ctx.now += 1000; }
    counts[d] = ctx.list.length;
    for (const e of ctx.list) {
      assert.ok(!Spawner.isSafe(map, e.x, e.y, G), 'не в безопасной зоне');
      assert.ok(Math.hypot(e.x - hero.x, e.y - hero.y) >= G.spawnMinPlayerDist - 1.5, 'не рядом с героем');
      assert.ok(WorldGen.isWalkable(map, Math.floor(e.x), Math.floor(e.y)));
    }
    // предел участков соблюдается
    for (const a of st.areas.values()) assert.ok(a.alive.size <= Math.max(a.cap, 0) + MAXG);
  }
  assert.equal(counts.none, 0);
  assert.ok(counts.low < counts.normal && counts.normal < counts.high, JSON.stringify(counts));
  // общий предел комнаты
  const ctx = spawnCtx(map, world({ enemyDensity: 'high' }), [hero], { ...G, maxEnemiesPerRoom: 5 });
  const st = Spawner.createState();
  for (let i = 0; i < 20; i++) Spawner.step(ctx, st);
  assert.ok(ctx.list.length <= 5 + MAXG);
});

test('появление: убитый враг возвращается через enemyRespawnSec; без героев участки пустеют', () => {
  const map = fakeMap(120, 120, { x: 5, y: 5 });
  const hero = { x: 60.5, y: 60.5, level: 1 };
  const game = { ...G, spawnMinPlayerDist: 2 };
  const ctx = spawnCtx(map, world(), [hero], game);
  const st = Spawner.createState();
  // за проверку появляется одна группа (нагрузка распределена по времени) — шагаем до насыщения
  for (let i = 0, last = -1; i < 2000 && last !== ctx.list.length; i++) { last = ctx.list.length; for (let k = 0; k < 20; k++) Spawner.step(ctx, st); }
  const full = ctx.list.length;
  assert.ok(full > 0);
  // убить одного
  const dead = ctx.list.pop();
  Spawner.onKilled(st, dead, ctx.now, game);
  Spawner.step(ctx, st);
  assert.equal(ctx.list.length, full - 1, 'сразу не возвращается');
  ctx.now += game.enemyRespawnSec * 1000 + 1;
  for (let i = 0; i < 5; i++) Spawner.step(ctx, st);
  assert.ok(ctx.list.length >= full - 1 + 1 - 0, 'вернулся после таймера');
  // герой ушёл
  ctx.players = [];
  ctx.now += game.despawnDelaySec * 1000 + 1;
  Spawner.step(ctx, st);
  assert.equal(ctx.list.length, 0);
  assert.equal(st.areas.size, 0);
});

test('появление: по биомам (в лесу — лесные звери, в пустыне — пустынные)', () => {
  for (const [biome, expect] of [['forest', 'forest'], ['desert', 'desert']]) {
    const map = fakeMap(100, 100, { x: 2, y: 2 });
    map.tiles.fill(WorldGen.BIOMES.find((b) => b.key === biome).id);
    const ctx = spawnCtx(map, world({ enemyDensity: 'high' }), [{ x: 50, y: 50, level: 3 }], { ...G, levelPerTiles: 5 });
    const st = Spawner.createState();
    for (let i = 0; i < 30; i++) Spawner.step(ctx, st);
    assert.ok(ctx.list.length > 0);
    for (const e of ctx.list) assert.ok(e.def.biomes[expect] > 0, `${e.def.id} в биоме ${biome}`);
  }
});

test('уровни: по зоне (дальше от старта — сильнее) или подстройка под героев (макс./средний)', () => {
  const map = fakeMap(200, 200, { x: 0, y: 0 });
  assert.equal(Spawner.zoneLevel(map, 0, 0, G), 1);
  assert.ok(Spawner.zoneLevel(map, 150, 150, G) > Spawner.zoneLevel(map, 30, 30, G));
  assert.equal(Spawner.partyLevel([2, 8, 5], 'max'), 8);
  assert.equal(Spawner.partyLevel([2, 8, 5], 'avg'), 5);
  const def = Enemies.get('wolf');
  const base = { map, game: { ...G, scaleLevelSpread: 0 }, rnd: Combat.rng(3) };
  const scaled = Spawner.levelFor({ ...base, world: world({ scaleToLevel: true }), players: [{ level: 12 }, { level: 4 }] }, 5, 5, def);
  assert.equal(scaled, 4, 'уровень обычного врага ограничен собственным диапазоном вида');
  const avg = Spawner.levelFor({ ...base, game: { ...base.game, scaleMode: 'avg' }, world: world(), players: [{ level: 12 }, { level: 4 }] }, 5, 5, def);
  assert.equal(avg, 4);
  const capped = Spawner.levelFor({ ...base, world: world(), players: [{ level: 2 }] }, 5, 5, Enemies.get('mutant_slasher'));
  assert.equal(capped, 2, 'уровень обычного противника не превышает героя');
  assert.ok(!Spawner.candidates('waste', 2, true).some((e) => e.id === 'mutant_slasher'), 'виды выше уровня группы не появляются');
  const zone = Spawner.levelFor({ ...base, world: world(), players: [] }, 5, 5, def);
  assert.equal(zone, 1, 'без игроков — уровень зоны в пределах вида');
  const far = Spawner.levelFor({ ...base, world: world(), players: [] }, 190, 190, def);
  assert.equal(far, def.level[1], 'не выше максимума вида');
});

test('орды: приходят по таймеру частоты орд и идут на героя', () => {
  const map = fakeMap(200, 200, { x: 2, y: 2 });
  const hero = { id: 'h', name: 'Айра', x: 100, y: 100, level: 2 };
  assert.equal(Spawner.hordeIntervalMs(world({ hordeFrequency: 'never' }), G), 0);
  assert.ok(Spawner.hordeIntervalMs(world({ hordeFrequency: 'often' }), G) < Spawner.hordeIntervalMs(world({ hordeFrequency: 'rare' }), G));
  const ctx = spawnCtx(map, world({ hordeFrequency: 'often', enemyDensity: 'low' }), [hero]);
  const st = Spawner.createState();
  Spawner.stepHorde(ctx, st);
  assert.equal(ctx.list.length, 0, 'первая орда — не сразу');
  ctx.now = st.nextHordeAt + 1;
  const n = Spawner.stepHorde(ctx, st);
  assert.ok(n >= G.hordeSizeMin && n <= G.hordeSizeMax);
  assert.ok(ctx.list.every((e) => e.def.behaviour === 'horde' && e.opts.target === 'h' && e.opts.horde));
  assert.match(ctx.list.announced, /Орда/);
});

test('появление: главарь приходит со свитой; супер-босс и драконы без логова сами не появляются', () => {
  const map = fakeMap(200, 200, { x: 100, y: 100 });
  const hero = { x: 100.5, y: 100.5, level: 20 };
  const ctx = spawnCtx(map, world({ enemyDensity: 'high', scaleToLevel: true }), [hero], { ...G, bossSpawnChance: 1, maxBossesPerRoom: 50 });
  ctx.countOf = (pred) => ctx.list.filter((e) => pred(e.def)).length;
  const st = Spawner.createState();
  for (let i = 0; i < 30; i++) { Spawner.step(ctx, st); ctx.now += 1000; }
  const bosses = ctx.list.filter((e) => e.def.boss);
  assert.ok(bosses.length > 0);
  assert.ok(!ctx.list.some((e) => e.def.id === 'boss_super' || e.def.family === 'dragon'));
  for (const b of bosses) {
    const guards = ctx.list.filter((e) => e.opts && e.opts.guardOf === b.id);
    assert.ok(guards.length >= b.def.guardCount[0] && guards.every((g) => b.def.guards.includes(g.def.id)), b.def.id);
  }
  assert.match(ctx.list.announced, /со свитой/);
  assert.ok(bosses.every((b) => Enemies.behaviourOf(b.def) === Enemies.BEHAVIOURS.brute), 'боссы используют простое поведение громилы');
  assert.ok(bosses.every((b) => b.def.speed * G.bossSpeedFactor < b.def.speed), 'боссы медленнее своей базовой скорости');
  assert.ok(ctx.list.filter((e) => e.opts && e.opts.guardOf).every((g) => g.level <= hero.level), 'свита не масштабируется до уровня босса');
  // предел главарей в мире
  const one = spawnCtx(map, world({ enemyDensity: 'high', scaleToLevel: true }), [hero], { ...G, bossSpawnChance: 1, maxBossesPerRoom: 1 });
  one.countOf = (pred) => one.list.filter((e) => pred(e.def)).length;
  const st1 = Spawner.createState();
  for (let i = 0; i < 30; i++) { Spawner.step(one, st1); one.now += 1000; }
  assert.equal(one.list.filter((e) => e.def.boss).length, 1);
  // супер-босса нет среди кандидатов ни в одном биоме
  for (const b of WorldGen.BIOMES) assert.ok(!Spawner.candidates(b.key, 99, true, true).some((e) => e.id === 'boss_super' || e.boss));
  // дракон — только у логова и не больше, чем логов
  const lairMap = { ...map, lairs: [{ x: 150, y: 150, type: 'fire' }] };
  const lctx = spawnCtx(lairMap, world(), [hero]);
  lctx.countOf = (pred) => lctx.list.filter((e) => pred(e.def)).length;
  assert.equal(Spawner.dragonOk(lctx, 100, 100), false);
  assert.equal(Spawner.dragonOk(lctx, 152, 148), 'fire');
  assert.ok(Spawner.candidates('hills', 99, true, true).some((e) => e.id === 'dragon_fire'));
  assert.ok(!Spawner.candidates('hills', 99, true, false).some((e) => e.id === 'dragon_fire'));
  // вид дракона — по типу логова
  assert.deepEqual(Spawner.candidates('hills', 99, true, 'ice').filter((e) => e.family === 'dragon').map((e) => e.id), ['dragon_ice']);
  assert.deepEqual(Spawner.candidates('desert', 99, true, 'lava').filter((e) => e.family === 'dragon').map((e) => e.id), ['dragon_lava']);
  assert.equal(Spawner.dragonOk(spawnCtx({ ...map, lairs: [{ x: 150, y: 150, type: 'water' }] }, world(), [hero]), 152, 148), 'water');
  lctx.list.push({ id: 'd1', def: Enemies.get('dragon_fire') });
  assert.equal(Spawner.dragonOk(lctx, 152, 148), false);
});

test('ИИ: дракон-одиночка не нападает первым, а раненый летит за героем через воду; зверь воду не переходит', () => {
  const map = fakeMap(60, 30, { x: 2, y: 2 });
  for (let y = 0; y < 30; y++) for (let x = 20; x < 26; x++) map.tiles[y * 60 + x] = WorldGen.B.WATER; // широкая река
  const hero = { id: 'h', x: 30.5, y: 15.5, dead: false, radius: 0.3, level: 20 };
  const dragon = makeEnemy('dragon_fire', 14.5, 15.5, 15);
  const bear = makeEnemy('bear', 14.5, 12.5, 5);
  const ctx = ctxFor(map, [hero], [dragon, bear]);
  assert.equal(AI.findTarget(ctx, { ...dragon, x: 29, y: 15.5 }), null, 'одиночка не замечает героя рядом');
  AI.onDamaged(ctx, dragon, hero);
  AI.onDamaged(ctx, bear, hero);
  run(ctx, 120, 0.05);
  assert.ok(dragon.x > 21, 'дракон вылетел за героем над рекой: x=' + dragon.x);
  assert.equal(WorldGen.isWalkable(map, Math.floor(dragon.x), Math.floor(dragon.y)), false, 'висит над водой');
  assert.ok(ctx.attacks.some(([id]) => id === dragon.id), 'и жжёт героя');
  assert.ok(bear.x < 20, 'медведь остался на своём берегу');
});
