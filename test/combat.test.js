'use strict';
// Правила боя (shared/combat.js): урон, защита и типы урона, криты, профили оружия, опыт и уровни,
// распределение очков, штраф за смерть, расчёт показателей героя, детерминированная добыча.
const test = require('node:test');
const assert = require('node:assert/strict');
const Combat = require('../shared/combat');
const Rules = require('../shared/character-rules');
const Items = require('../shared/items');
const Enemies = require('../shared/enemies');
const config = require('../server/config');

const DEF = config.DEFAULTS.game;
Combat.configure(DEF);
Rules.configure(DEF);
Enemies.configure(DEF);
const stats = (o = {}) => ({ strength: 1, magic: 1, intellect: 1, stealth: 1, persuasion: 1, hacking: 1, engineering: 1, builder: 1, suggestion: 1, taming: 1, companions: 1, ...o });
const fixed = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };

test('профили: кулаки, ближний бой, выстрел, конус, бросок, установка', () => {
  const fists = Combat.profile(null);
  assert.equal(fists.kind, 'melee');
  assert.deepEqual(fists.damage, [DEF.unarmedDamageMin, DEF.unarmedDamageMax]);
  assert.equal(Combat.profile(Items.get('knife_rusty')).kind, 'melee');
  assert.equal(Combat.profile(Items.get('bow_crude')).kind, 'ranged');
  assert.equal(Combat.profile(Items.get('bow_crude')).ammo, 'ammo_arrow');
  assert.equal(Combat.profile(Items.get('flamer_torch')).kind, 'cone');
  assert.equal(Combat.profile(Items.get('star_steel')).kind, 'thrown');
  assert.equal(Combat.profile(Items.get('disc_crescent')).kind, 'thrown');
  assert.equal(Combat.profile(Items.get('mine_clapper')).kind, 'place');
  assert.equal(Combat.profile(Items.get('turret_watchman')).kind, 'place');
  // у каждого оружия каталога есть способ атаки
  for (const it of Items.ITEMS.filter((x) => x.weapon)) {
    const p = Combat.profile(it);
    assert.ok(Combat.KIND_NAMES[p.kind], `${it.id}: ${p.kind}`);
    if (p.kind === 'ranged' || p.kind === 'thrown') assert.ok(p.proj > 0, it.id);
  }
});

test('урон: разброс, бонус Силы в ближнем бою, крит от Скрытности', () => {
  const prof = Combat.profile(Items.get('knife_rusty'));
  const [a, b] = prof.damage;
  const low = Combat.rollDamage(prof, stats(), fixed(0, 0.99));
  assert.equal(low.crit, false);
  assert.ok(Math.abs(low.amount - a * (1 + DEF.meleeBonusPerStrength)) < 1e-9);
  const strong = Combat.rollDamage(prof, stats({ strength: 6 }), fixed(1 - 1e-12, 0.99));
  assert.ok(Math.abs(strong.amount - b * (1 + 6 * DEF.meleeBonusPerStrength)) < 1e-6);
  const crit = Combat.rollDamage(prof, stats(), fixed(0, 0));
  assert.equal(crit.crit, true);
  assert.ok(Math.abs(crit.amount - low.amount * DEF.critMultiplier) < 1e-9);
  assert.ok(Combat.critChance(stats({ stealth: 5 })) > Combat.critChance(stats()));
  assert.equal(Combat.critChance(stats({ stealth: 1000 })), DEF.critMax);
  // дальний бой Силой не усиливается
  const bow = Combat.profile(Items.get('bow_crude'));
  assert.equal(Combat.statBonus(bow, stats({ strength: 10 })), 1);
  // энергетическое оружие — Интеллект
  const laser = Combat.profile(Items.ITEMS.find((i) => i.weapon && i.weapon.damageType === 'energy' && !i.placeable));
  assert.ok(Combat.statBonus(laser, stats({ intellect: 5 })) > 1);
});

test('защита: броня, сопротивления по типам урона, бронебойность, минимум 1', () => {
  assert.equal(Combat.mitigate(20, 'physical', 0, {}), 20);
  const k = DEF.armorK;
  assert.equal(Combat.mitigate(20, 'physical', k, {}), 10, 'броня K — вдвое меньше урона');
  // против огня броня работает слабее
  assert.ok(Combat.mitigate(20, 'fire', k, {}) > Combat.mitigate(20, 'physical', k, {}));
  // сопротивление типу
  assert.equal(Combat.mitigate(20, 'poison', 0, { poison: 0.5 }), 10);
  assert.equal(Combat.mitigate(20, 'poison', 0, { poison: 1 }), Math.round(20 * (1 - DEF.resistMax)), 'не выше resistMax');
  assert.equal(Combat.mitigate(20, 'fire', 0, { poison: 0.9 }), 20, 'сопротивление яду не защищает от огня');
  // бронебойность
  assert.ok(Combat.mitigate(20, 'physical', k, {}, ['armorPiercing']) > Combat.mitigate(20, 'physical', k, {}));
  assert.equal(Combat.mitigate(0.3, 'physical', 1000, {}), 1);
  assert.equal(Combat.mitigate(0, 'physical', 0, {}), 0);
});

test('защита героя: сумма надетого, сломанное не защищает', () => {
  const ch = { inventory: { equipment: { armor: { id: 'armor_tire', dur: 10 }, head: null } } };
  const armor = Items.get('armor_tire') || Items.ITEMS.find((i) => i.armor && i.armor.defense > 0);
  ch.inventory.equipment.armor.id = armor.id;
  assert.equal(Combat.heroDefense(ch).defense, armor.armor.defense);
  ch.inventory.equipment.armor.dur = 0;
  assert.equal(Combat.heroDefense(ch).defense, 0);
});

test('скорость атаки, выносливость, мана, заряды боеприпасов', () => {
  assert.equal(Combat.cooldownMs({ speed: 2 }), 500);
  assert.equal(Combat.staminaCost(Combat.profile(Items.get('knife_rusty'))), DEF.meleeStaminaCost);
  assert.equal(Combat.staminaCost(Combat.profile(Items.get('bow_crude'))), 0);
  const heavy = Items.ITEMS.find((i) => i.weapon && i.weapon.flags.includes('heavy') && Combat.profile(i).kind === 'melee');
  if (heavy) assert.equal(Combat.staminaCost(Combat.profile(heavy)), DEF.meleeStaminaCost * DEF.heavyStaminaFactor);
  assert.equal(Combat.roundsPerItem('ammo_9mm'), 1);
  assert.equal(Combat.roundsPerItem('ammo_cell'), 20);
  assert.equal(Combat.roundsPerItem('ammo_fuel'), 25);
});

test('опыт: кривая уровней, очки, лечение при новом уровне, предел уровня', () => {
  assert.equal(Combat.xpToNext(1), DEF.xpBase);
  assert.equal(Combat.xpToNext(4), Math.round(DEF.xpBase * Math.pow(4, DEF.xpExponent)));
  const ch = { level: 1, xp: 0, unspentPoints: 0, stats: stats({ strength: 3 }), vitals: { hp: 5, stamina: 1, mp: 0 } };
  let r = Combat.addXp(ch, 50);
  assert.deepEqual(r, { gained: 50, levels: 0 });
  r = Combat.addXp(ch, Combat.xpToNext(1) + Combat.xpToNext(2));
  assert.equal(r.levels, 2);
  assert.equal(ch.level, 3);
  assert.equal(ch.xp, 50);
  assert.equal(ch.unspentPoints, 2 * DEF.statPointsPerLevel);
  assert.equal(ch.vitals.hp, Rules.derive(ch.stats, 3).maxHp, 'новый уровень лечит');
  const top = { level: DEF.maxLevel - 1, xp: 0, unspentPoints: 0, stats: stats(), vitals: {} };
  Combat.addXp(top, 1e9);
  assert.equal(top.level, DEF.maxLevel);
  assert.ok(top.xp < Combat.xpToNext(DEF.maxLevel));
});

test('очки характеристик: вложить, нет очков, неизвестная характеристика', () => {
  const ch = { stats: stats(), unspentPoints: 2 };
  assert.equal(Combat.allocate(ch, 'strength'), null);
  assert.equal(ch.stats.strength, 2);
  assert.equal(ch.unspentPoints, 1);
  assert.match(Combat.allocate(ch, 'luck'), /Неизвестная/);
  assert.equal(Combat.allocate(ch, 'magic'), null);
  assert.match(Combat.allocate(ch, 'magic'), /Нет свободных очков/);
  assert.equal(ch.stats.magic, 2);
});

test('смерть: −1 случайной характеристике выше 1, никогда ниже 1, все по 1 — без потерь, счётчик смертей', () => {
  const ch = { level: 1, stats: stats({ strength: 3, taming: 2 }), deaths: 0, vitals: { hp: 10, stamina: 5, mp: 5 } };
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const c = structuredClone(ch);
    const lost = Combat.deathPenalty(c, Combat.rng(i));
    assert.ok(['strength', 'taming'].includes(lost), 'только характеристики выше 1');
    seen.add(lost);
    assert.equal(c.stats[lost], ch.stats[lost] - 1);
    assert.equal(c.deaths, 1);
    assert.equal(c.vitals.hp, 0);
  }
  assert.equal(seen.size, 2, 'выбор случаен');
  // многократные смерти — ни одна характеристика не падает ниже 1
  const many = structuredClone(ch);
  for (let i = 0; i < 10; i++) Combat.deathPenalty(many, Combat.rng(100 + i));
  assert.ok(Object.values(many.stats).every((v) => v >= 1));
  assert.equal(many.deaths, 10);
  // все характеристики по 1
  const ones = { level: 1, stats: stats(), deaths: 3, vitals: { hp: 1, stamina: 1, mp: 1 } };
  assert.equal(Combat.deathPenalty(ones, Math.random), null);
  assert.deepEqual(ones.stats, stats());
  assert.equal(ones.deaths, 4);
});

test('показатели героя зависят от настроек и уровня', () => {
  const s = stats({ strength: 4, magic: 3 });
  const d1 = Rules.derive(s, 1), d5 = Rules.derive(s, 5);
  assert.equal(d1.maxHp, DEF.hpBase + 4 * DEF.hpPerStrength);
  assert.equal(d5.maxHp - d1.maxHp, 4 * DEF.hpPerLevel);
  Rules.configure({ ...DEF, hpBase: 200 });
  assert.equal(Rules.derive(s, 1).maxHp, 200 + 4 * DEF.hpPerStrength);
  Rules.configure(DEF);
});

test('добыча: одинаковый сид — одинаковый результат, предметы из каталога', () => {
  for (const table of Object.keys(Enemies.LOOT)) {
    const a = Enemies.rollLoot(table, 5, Combat.rng('loot-' + table));
    const b = Enemies.rollLoot(table, 5, Combat.rng('loot-' + table));
    assert.deepEqual(a, b, table);
    for (const d of a) {
      const it = Items.get(d.id);
      assert.ok(it && !it.fixed, d.id);
      assert.ok(d.n >= 1 && (it.stackable || d.n === 1));
    }
  }
  // уровень ограничивает случайные предметы
  const r = Combat.rng(7);
  for (let i = 0; i < 200; i++) {
    const id = Enemies.pickItem({ category: 'weapon' }, 1, r);
    assert.ok(Items.get(id).level <= 1 + DEF.lootLevelSlack, id);
  }
  // множитель шанса: 0 — никогда ничего
  Enemies.configure({ ...DEF, lootChanceFactor: 0 });
  assert.deepEqual(Enemies.rollLoot('robot', 5, Combat.rng(1)), []);
  Enemies.configure(DEF);
});

test('геометрия: пересечение отрезка с кругом, угол', () => {
  assert.equal(Combat.segmentCircle(0, 0, 10, 0, 5, 0, 1), 0.4);
  assert.equal(Combat.segmentCircle(0, 0, 10, 0, 5, 3, 1), -1);
  assert.equal(Combat.segmentCircle(0, 0, 2, 0, 5, 0, 1), -1);
  assert.equal(Math.round(Combat.angleBetween(1, 0, 0, 1)), 90);
  assert.equal(Math.round(Combat.angleBetween(1, 0, 1, 0)), 0);
});
