'use strict';
// Спутники (шаг 11): общие правила — места, шансы, виды существ, драконы по логову, склады в генерации мира
const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/companions');
const Enemies = require('../shared/enemies');
const Items = require('../shared/items');
const Crafting = require('../shared/crafting');
const WorldGen = require('../shared/worldgen');

test('места: «Напарники» 1…11 ограничивают всю команду — призванных, дракона и спящих в контейнере', () => {
  assert.equal(C.slots({ stats: { companions: 1 } }), 1);
  assert.equal(C.slots({ stats: { companions: 11 } }), 11);
  assert.equal(C.slots({ stats: { companions: 40 } }), 11);
  assert.equal(C.slots({ stats: {} }), 1);
  const ch = { stats: { companions: 3 }, companions: [{ out: true }, { out: false }, { out: true, kind: 'dragon' }] };
  assert.equal(C.outCount(ch), 2);
  assert.equal(C.freeSlots(ch), 0, 'спутник в контейнере тоже занимает место');
  assert.equal(C.freeSlots({ stats: { companions: 5 }, companions: ch.companions }), 2);
});

test('шанс приручения детерминирован: навык повышает, уровень цели понижает, раны и еда помогают, дракон — ×0.25', () => {
  const s = C.settings;
  const base = C.chance('tame', { stat: 3, level: 5, hpFrac: 1 });
  assert.equal(base, Math.round((s.compTameBase + 3 * s.compTamePerStat - 5 * s.compTameLevelPenalty) * 1000) / 1000);
  assert.equal(C.chance('tame', { stat: 3, level: 5, hpFrac: 1 }), base); // одинаковый ввод — одинаковый шанс
  assert.ok(C.chance('tame', { stat: 6, level: 5 }) > base);
  assert.ok(C.chance('tame', { stat: 3, level: 10 }) < base);
  assert.ok(C.chance('tame', { stat: 3, level: 5, hpFrac: 0.2 }) > base);
  assert.ok(C.chance('tame', { stat: 3, level: 5, food: true }) > base);
  assert.ok(C.chance('tame', { stat: 11, level: 20, dragon: true }) <= s.compChanceMax * s.compDragonFactor);
  assert.equal(C.chance('tame', { stat: 0, level: 99 }), s.compChanceMin);
  assert.equal(C.chance('tame', { stat: 99, level: 1 }), s.compChanceMax);
  assert.ok(C.chance('persuade', { stat: 3, level: 5, paid: true }) > C.chance('persuade', { stat: 3, level: 5 }));
  assert.ok(C.chance('persuade', { stat: 3, level: 5, reputation: 2 }) > C.chance('persuade', { stat: 3, level: 5 }));
  assert.ok(C.chance('hack', { stat: 8, level: 5 }) > C.chance('hack', { stat: 2, level: 5 }));
  assert.ok(C.chance('suggest', { stat: 8, level: 5 }) > 0);
  assert.equal(C.chance('nope', { stat: 8 }), 0);
  assert.equal(C.recruitCost(6), Math.ceil(6 * s.compRecruitGoldPerLevel));
  assert.ok(C.suggestSec(5) > C.suggestSec(1));
});

test('кого каким способом: звери и прочие существа — приручение, люди — договор/приручение/внушение, машины — взлом, боссы и зомби тоже', () => {
  assert.deepEqual(C.methodsFor(Enemies.get('wolf')), ['tame', 'suggest']);
  assert.deepEqual(C.methodsFor(Enemies.get('raider_thug')), ['persuade', 'tame', 'suggest']);
  assert.deepEqual(C.methodsFor(Enemies.get('walker_patrol')), ['hack']);
  assert.deepEqual(C.methodsFor(Enemies.get('cyborg_ripper')), ['hack', 'suggest']);
  assert.deepEqual(C.methodsFor(Enemies.get('dragon_fire')), ['tame']);
  assert.deepEqual(C.methodsFor(Enemies.get('zombie')), ['tame', 'suggest']);
  assert.deepEqual(C.methodsFor(Enemies.get('boss_raider')), ['persuade', 'tame', 'suggest']);
  assert.deepEqual(C.methodsFor(Enemies.get('alien_spitter')), ['tame', 'suggest']);
  // «Все виды существ, включая боссов, допускают получение в спутники» (справка)
  for (const e of Enemies.ENEMIES) assert.ok(C.methodsFor(e).length, e.id);
  assert.deepEqual(C.methodsFor(null), []);
});

test('драконы: четыре вида, вид по типу логова, все летают и приручаются', () => {
  for (const [lair, id] of Object.entries({ fire: 'dragon_fire', ice: 'dragon_ice', lava: 'dragon_lava', water: 'dragon_water' })) {
    assert.equal(C.dragonForLair(lair), id);
    const d = Enemies.get(id);
    assert.ok(d && d.fly && d.tameable && d.family === 'dragon', id);
  }
  assert.equal(C.dragonForLair('???'), 'dragon_fire');
  assert.equal(C.nearestLair({ lairs: [{ x: 0, y: 0, type: 'ice' }, { x: 50, y: 50, type: 'lava' }] }, 45, 40).type, 'lava');
  for (const t of WorldGen.DRAGON_TYPES) assert.ok(Enemies.get(C.dragonForLair(t.key)), t.key);
});

test('запись спутника: здоровье по уровню, опыт и уровни, снаряжение людей, проверка при импорте', () => {
  const rec = C.makeRecord(Enemies.get('raider_thug'), 3, 'persuade', 'c1');
  assert.equal(rec.kind, 'human');
  assert.equal(rec.hp, C.statsOf(rec).maxHp);
  assert.ok(C.canEquip(rec) && !C.eats(rec) && !C.canMount(rec));
  const dmg0 = C.statsOf(rec).damage[0];
  rec.equip.weapon = { id: 'pistol_nail', n: 1 };
  assert.ok(C.statsOf(rec).damage[0] > dmg0);
  const hp3 = C.statsOf(rec).maxHp;
  assert.equal(C.addXp(rec, C.xpToNext(3)), 1);
  assert.equal(rec.level, 4);
  assert.ok(C.statsOf(rec).maxHp > hp3);
  const dragon = C.makeRecord(Enemies.get('dragon_ice'), 12, 'tame', 'c2');
  assert.ok(C.canMount(dragon) && C.eats(dragon));
  assert.equal(C.sanitize({ def: 'nope' }), null);
  const s = C.sanitize({ id: 'x', def: 'wolf', level: 999, hp: 1e9, order: 'bad', equip: { weapon: { id: 'nope' } } });
  assert.equal(s.level, 40);
  assert.equal(s.order, 'follow');
  assert.equal(s.hp, C.statsOf(s).maxHp);
  assert.deepEqual(s.equip, {});
});

test('контейнер-уменьшитель: предмет, рецепт со свитком (редкая электроника + платина), без него — нет', () => {
  assert.ok(Items.get('shrinker') && Items.get('circuit_rare') && Items.get('dragon_charm'));
  const r = Crafting.RECIPES.find((x) => x.id === 'shrinker');
  assert.ok(r && r.in.circuit_rare > 0 && r.in.platinum > 0 && !r.start);
  assert.ok(Items.get('scroll_shrinker'));
  assert.ok(Enemies.LOOT.depot.entries.some((e) => e.item === 'scroll_shrinker'));
  const ch = { inventory: { cells: [{ id: 'wood', n: 1 }], equipment: {} } };
  assert.equal(C.hasShrinker(ch), false);
  ch.inventory.cells.push({ id: 'shrinker', n: 1 });
  assert.equal(C.hasShrinker(ch), true);
});

test('генерация мира: военные склады в главной области, вдали от точки появления; карта и контрольная сумма те же', () => {
  const m = WorldGen.generate({ seed: 'depot-test', size: 'medium', dragons: 2 });
  assert.ok(m.depots.length >= 1);
  for (const d of m.depots) {
    assert.equal(m.region[d.y * m.width + d.x], m.mainRegion);
    assert.ok(Math.hypot(d.x - m.spawn.x, d.y - m.spawn.y) >= 40);
  }
  const again = WorldGen.generate({ seed: 'depot-test', size: 'medium', dragons: 2 });
  assert.deepEqual(again.depots, m.depots);
  assert.equal(WorldGen.mapHash(again), WorldGen.mapHash(m));
});
