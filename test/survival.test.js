'use strict';
// Правила выживания (shared/survival.js): тики шкал, пороги и эффекты, еда/вода, порча, радиация, режим мира.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/survival');
const WorldGen = require('../shared/worldgen');

const hero = (sv = {}) => { const ch = { vitals: { hp: 50, stamina: 50, mp: 10 }, survival: { food: 100, water: 100, rest: 100, rad: 0, ...sv } }; S.ensure(ch); return ch; };
const on = { on: true, mul: 1, now: 1e12 };

test('шкалы: старый герой получает полные шкалы, значения ограничены', () => {
  const ch = { vitals: {} };
  S.ensure(ch);
  assert.deepEqual([ch.survival.food, ch.survival.water, ch.survival.rest, ch.survival.rad], [100, 100, 100, 0]);
  const b = { survival: { food: 250, water: -5, rest: 'x', rad: 900 } };
  S.ensure(b);
  assert.deepEqual([b.survival.food, b.survival.water, b.survival.rest, b.survival.rad], [100, 0, 100, 100]);
});

test('тик: шкалы падают со скоростью из настроек, бег сушит быстрее, сложность множит', () => {
  const a = hero();
  S.tick(a, 60, on);
  assert.equal(+a.survival.food.toFixed(3), 100 - S.settings.survivalFoodPerMin);
  assert.equal(+a.survival.water.toFixed(3), +(100 - S.settings.survivalWaterPerMin).toFixed(3));
  assert.equal(+a.survival.rest.toFixed(3), +(100 - S.settings.survivalRestPerMin).toFixed(3));
  const b = hero();
  S.tick(b, 60, { ...on, running: true });
  assert.ok(b.survival.water < a.survival.water);
  const c = hero();
  S.tick(c, 60, { ...on, mul: 2 });
  assert.equal(+c.survival.food.toFixed(3), 100 - 2 * S.settings.survivalFoodPerMin);
});

test('тик: выключенное выживание не меняет шкалы и снимает эффекты', () => {
  const a = hero({ food: 0, water: 0 });
  S.tick(a, 600, { on: false });
  assert.equal(a.survival.food, 0);
  assert.equal(a.survival.off, true);
  const e = S.effects(a);
  assert.equal(e.hpDrain, 0);
  assert.equal(e.staMax, 1);
});

test('пороги: предупреждения при пересечении low / critical / empty', () => {
  const a = hero({ food: S.settings.survivalLow + 0.01, water: S.settings.survivalCritical + 0.01, rest: 0.001 });
  const ev = S.tick(a, 5, on);
  assert.deepEqual(ev.map((x) => x.k + ':' + x.level).sort(), ['food:low', 'rest:empty', 'water:critical']);
  assert.deepEqual(S.tick(a, 1, on), []); // повторно не предупреждает
});

test('эффекты: голод останавливает здоровье, ноль — медленно убывает; не убивает', () => {
  assert.equal(S.effects(hero()).hpRegen, 1);
  assert.equal(S.effects(hero({ food: 20 })).hpRegen, 0);
  assert.equal(S.effects(hero({ food: 20 })).hpDrain, 0);
  const e = S.effects(hero({ food: 0 }));
  assert.ok(e.hpDrain > 0);
  assert.equal(S.drainHp(5, e.hpDrain, 1000), 1);
  const was = S.settings.survivalCanKill;
  S.settings.survivalCanKill = true;
  try { assert.equal(S.drainHp(5, e.hpDrain, 1000), 0); } finally { S.settings.survivalCanKill = was; }
});

test('эффекты: жажда уменьшает выносливость, усталость — ману, изнеможение — штраф', () => {
  const t = S.effects(hero({ water: 20 }));
  assert.equal(t.staMax, S.settings.survivalThirstStaminaMaxLow);
  assert.ok(t.staRegen < 1);
  assert.equal(S.effects(hero({ water: 0 })).staMax, S.settings.survivalThirstStaminaMaxZero);
  assert.equal(S.effects(hero({ rest: 20 })).mpRegen, S.settings.survivalTiredMpRegen);
  assert.equal(S.effects(hero({ rest: 5 })).penalty, 0);
  assert.equal(S.effects(hero({ rest: 0 })).penalty, S.settings.survivalExhaustedPenalty);
});

test('отдых: сидя/во сне бодрость растёт, в опасности — медленнее', () => {
  const sit = hero({ rest: 10 }), sleep = hero({ rest: 10 }), unsafe = hero({ rest: 10 });
  S.tick(sit, 60, { ...on, rest: 'sit', safe: true });
  S.tick(sleep, 60, { ...on, rest: 'sleep', safe: true });
  S.tick(unsafe, 60, { ...on, rest: 'sleep', safe: false });
  assert.equal(+sit.survival.rest.toFixed(3), 10 + S.settings.survivalSitRestPerMin);
  assert.ok(sleep.survival.rest > sit.survival.rest);
  assert.ok(unsafe.survival.rest < sleep.survival.rest && unsafe.survival.rest > 10);
});

test('еда и вода: восстанавливают шкалы и показатели; полные — ошибка', () => {
  const ration = { name: 'Паёк', effect: { hp: 10, food: 30 } };
  const a = hero({ food: 50 });
  const r = S.consume(a, ration, null, { max: { hp: 100 }, now: on.now });
  assert.ok(!r.error);
  assert.equal(a.survival.food, 80);
  assert.equal(a.vitals.hp, 60);
  const full = hero();
  full.vitals.hp = 100;
  assert.ok(S.consume(full, ration, null, { max: { hp: 100 } }).error);
  // выключено: сытость не считается
  const b = hero({ food: 50 });
  b.vitals.hp = 100;
  assert.ok(S.consume(b, ration, null, { max: { hp: 100 }, on: false }).error);
});

test('грязная вода: шанс болезни; травы лечат; болезнь ускоряет голод', () => {
  const dirty = { name: 'Грязная вода', effect: { water: 30 }, ill: 0.5 };
  const a = hero({ water: 10 });
  const r = S.consume(a, dirty, null, { now: on.now, rnd: () => 0.1 });
  assert.equal(r.msgs.length, 1);
  assert.ok(a.survival.illUntil > on.now);
  assert.ok(S.effects(a, on.now).flags.includes('ill'));
  const b = hero({ water: 10 });
  S.consume(b, dirty, null, { now: on.now, rnd: () => 0.9 });
  assert.equal(b.survival.illUntil, 0);
  const ill = hero(), healthy = hero();
  ill.survival.illUntil = on.now + 1e6;
  S.tick(ill, 60, on); S.tick(healthy, 60, on);
  assert.ok(ill.survival.food < healthy.survival.food);
  const herbs = { name: 'Травы', effect: {}, cure: true };
  const c = S.consume(ill, herbs, null, { now: on.now });
  assert.ok(!c.error);
  assert.equal(ill.survival.illUntil, 0);
});

test('порча: сырое мясо портится через survivalSpoilMin, пользы меньше и шанс болезни', () => {
  const meat = { name: 'Сырое мясо', spoils: true, effect: { food: 20 } };
  const ms = S.settings.survivalSpoilMin * 60000;
  const fresh = { made: on.now - ms + 1000 }, old = { made: on.now - ms };
  assert.equal(S.isSpoiled(meat, fresh, on.now), false);
  assert.equal(S.isSpoiled(meat, old, on.now), true);
  assert.equal(S.spoilLeftMs(meat, fresh, on.now), 1000);
  assert.equal(S.isSpoiled({ name: 'x', effect: {} }, old, on.now), false);
  const a = hero({ food: 10 });
  const r = S.consume(a, meat, old, { now: on.now, rnd: () => 0.5 });
  assert.equal(a.survival.food, 10 + 20 * S.settings.survivalSpoiledFactor);
  assert.ok(a.survival.illUntil > on.now);
  assert.equal(r.msgs.length, 2);
});

test('радиация: копится в зоне, спадает вне; лучевая болезнь снижает здоровье; антирад', () => {
  const a = hero();
  S.tick(a, 60, { ...on, radLevel: 2 });
  assert.equal(+a.survival.rad.toFixed(3), 2 * S.settings.survivalRadPerMin);
  S.tick(a, 60, on);
  assert.ok(a.survival.rad < 2 * S.settings.survivalRadPerMin);
  const sick = hero({ rad: 100 });
  assert.equal(S.effects(sick).hpMax, 1 - S.settings.survivalRadMaxHpLoss);
  assert.ok(S.effects(sick).flags.includes('radsick'));
  const ev = S.tick(hero({ rad: S.settings.survivalRadSickAt - 0.01 }), 60, { ...on, radLevel: 1 });
  assert.deepEqual(ev.filter((x) => x.k === 'rad').map((x) => x.level), ['sick']);
  S.consume(sick, { name: 'Антирад', effect: { rad: -40 } }, null, {});
  assert.equal(sick.survival.rad, 60);
});

test('радиация на карте: детерминирована, есть воронки, нет у поселений', () => {
  const params = { seed: 'rad-test', size: 'small' };
  const m1 = WorldGen.generate(params), m2 = WorldGen.generate(params);
  const g1 = S.radGrid(m1), g2 = S.radGrid(m2);
  assert.deepEqual(Array.from(g1), Array.from(g2));
  assert.ok(g1.some((v) => v === 3), 'в центре воронки уровень 3');
  for (const s of m1.settlements) assert.equal(S.radAt(m1, s.x + 0.5, s.y + 0.5), 0);
  const c = S.craters(m1)[0];
  assert.equal(S.radAt(m1, c.x + 0.5, c.y + 0.5), 3);
});

test('вода рядом: у реки/озера можно пить', () => {
  const m = { width: 4, height: 1, tiles: new Uint8Array([WorldGen.B.WATER, 3, 3, 3]) };
  assert.equal(S.nearWater(m, 1.5, 0.5, 1.6), true);
  assert.equal(S.nearWater(m, 3.5, 0.5, 1.6), false);
});

test('режим мира: по умолчанию включено, сложность множит, мир может выключить', () => {
  assert.deepEqual(S.worldMode({}), { on: true, mul: 1, difficulty: 'normal' });
  assert.equal(S.worldMode({ survivalDifficulty: 'hard' }).mul, S.settings.survivalDifficultyHard);
  assert.equal(S.worldMode({ survival: false }).on, false);
  const was = S.settings.survivalEnabled;
  S.settings.survivalEnabled = false;
  try { assert.equal(S.worldMode({}).on, false); } finally { S.settings.survivalEnabled = was; }
});

test('параметры мира: выживание по умолчанию включено, сложность проверяется', () => {
  const base = { name: 'Мир', seed: 's1', size: 'small', enemyDensity: 'normal', hordeFrequency: 'normal', dragons: 1, scaleToLevel: false };
  const r = WorldGen.validateParams(base);
  assert.ok(r.ok);
  assert.equal(r.value.survival, true);
  assert.equal(r.value.survivalDifficulty, 'normal');
  const off = WorldGen.validateParams({ ...base, survival: false, survivalDifficulty: 'brutal' });
  assert.ok(off.ok);
  assert.equal(off.value.survival, false);
  assert.equal(WorldGen.validateParams({ ...base, survivalDifficulty: 'insane' }).ok, false);
  assert.equal(WorldGen.validateParams({ ...base, survival: 'yes' }).ok, false);
});

test('предметы: новые расходуемые в каталоге, порча — метка made, стопка по самому старому', () => {
  const Items = require('../shared/items');
  const Inv = require('../shared/inventory');
  assert.deepEqual(Items.validateCatalogue(), []);
  for (const id of ['meat_raw', 'water_dirty', 'herbs', 'antirad', 'coffee', 'campfire', 'hide', 'bedroll']) assert.ok(Items.get(id), id);
  assert.equal(Items.get('meat_raw').cook, 'meat_roast');
  assert.equal(Items.get('water_dirty').cook, 'water_clean');
  const ch = { stats: { strength: 5, magic: 5, intellect: 5, stealth: 5, charisma: 5, taming: 5 }, level: 1, vitals: { hp: 10, stamina: 10, mp: 10 } };
  Inv.ensure(ch);
  assert.equal(Inv.add(ch, 'meat_raw', 1, undefined, { made: 1000 }), null);
  assert.equal(Inv.add(ch, 'meat_raw', 2, undefined, { made: 5000 }), null);
  const st = ch.inventory.cells.find((c) => c && c.id === 'meat_raw');
  assert.equal(st.n, 3);
  assert.equal(st.made, 1000);
  assert.ok(Number.isFinite(Inv.makeItem('meat_raw').made));
  assert.equal(Inv.makeItem('canned').made, undefined);
});

test('добыча: животные дают сырое мясо и шкуры', () => {
  const Enemies = require('../shared/enemies');
  const seen = new Set();
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 200; i++) for (const d of Enemies.rollLoot('animal', 1, rnd)) seen.add(d.id);
  assert.ok(seen.has('meat_raw') && seen.has('hide'));
});
