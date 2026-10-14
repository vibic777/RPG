'use strict';
// Магия: каталог заклинаний (6 школ ДД, круги, виды), свитки и книги, враги-маги, формулы силы и шансов, изучение и панель 1–0.
const test = require('node:test');
const assert = require('node:assert/strict');
const Magic = require('../shared/magic');
const Items = require('../shared/items');
const Enemies = require('../shared/enemies');
const Inv = require('../shared/inventory');
const Rules = require('../shared/character-rules');

test('каталог заклинаний: проверка данных, 7 школ (Тьма и Свет слиты в Тень, Воду и Электричество), у каждой несколько заклинаний и все три круга', () => {
  assert.deepEqual(Magic.validate({ enemies: (id) => Boolean(Enemies.get(id)), damageTypes: Object.keys(Items.DAMAGE_TYPES), stats: Rules.STATS.map((s) => s.id) }), []);
  assert.deepEqual(Object.keys(Magic.SCHOOLS), ['blood', 'water', 'fire', 'earth', 'air', 'shadow', 'electricity']);
  for (const sp of Magic.SPELLS) assert.ok(Magic.SCHOOLS[sp.school], sp.id + ': школа ' + sp.school);
  for (const sc of Object.keys(Magic.SCHOOLS)) {
    const list = Magic.bySchool(sc);
    assert.ok(list.length >= 4, sc);
    assert.deepEqual([...new Set(list.map((s) => s.tier))].sort(), [1, 2, 3], sc + ': круги');
    assert.ok(Rules.STATS.some((s) => s.id === Magic.SCHOOLS[sc].stat), sc + ': стат сродства');
  }
  // все виды из задания есть в каталоге
  const kinds = new Set(Magic.SPELLS.map((s) => s.kind));
  for (const k of ['bolt', 'aoe', 'chain', 'cone', 'heal', 'hot', 'buff', 'debuff', 'shield', 'summon', 'blink', 'step', 'stealth', 'fear', 'charm', 'cleanse']) assert.ok(kinds.has(k), k);
  for (const s of Magic.SPELLS) {
    for (const k of ['school', 'mp', 'cd', 'cast', 'range', 'req', 'level']) assert.ok(s[k] !== undefined, `${s.id}.${k}`);
    const lines = Magic.describe(s, { level: 7, stats: { magic: 5 } }).join(' ');
    assert.doesNotMatch(lines, /undefined|NaN/, s.id);
  }
  // ошибки ловятся
  const bad = Magic.SPELLS[0].mp; Magic.SPELLS[0].mp = -1;
  assert.ok(Magic.validate().some((e) => e.includes('fire_bolt')));
  Magic.SPELLS[0].mp = bad;
});

test('свитки и книги: предмет на каждое заклинание, 1-й круг — свиток, выше — книга; все выпадают у магов', () => {
  assert.deepEqual(Items.validateCatalogue(), []);
  assert.deepEqual(Enemies.validate(), []);
  const mageLoot = new Set(Enemies.LOOT.mage.entries.map((x) => x.item));
  for (const s of Magic.SPELLS) {
    const it = Items.get(Magic.itemId(s.id));
    assert.ok(it && it.teachesSpell === s.id, s.id);
    assert.match(it.name, s.tier === 1 ? /^Свиток/ : /^Книга/);
    assert.equal(it.icon.shape, s.tier === 1 ? 'scroll' : 'book');
    assert.ok(mageLoot.has(it.id), 'выпадает у магов: ' + it.id);
  }
});

test('враги-маги и драконы: по магу на каждую школу, ниндзя с дымом и теневым шагом, заклинания из каталога, голем — только призыв', () => {
  const mages = Enemies.ENEMIES.filter((e) => e.spells);
  const schools = new Set();
  for (const e of mages) {
    // колдуют маги и драконы своей стихии
    assert.ok(['mage', 'dragon'].includes(e.family), e.id);
    assert.equal(e.loot, e.family === 'dragon' ? 'dragon' : e.boss ? 'boss_gang' : 'mage'); // Мастер Безликий (шаг 16) — главарь клана Тени
    for (const id of e.spells) assert.ok(Magic.get(id), `${e.id}: ${id}`);
    for (const id of e.spells) schools.add(Magic.get(id).school);
  }
  assert.equal(schools.size, Object.keys(Magic.SCHOOLS).length, 'каждая школа есть у кого-то из врагов');
  for (const sc of Object.keys(Magic.SCHOOLS)) assert.ok(mages.some((e) => e.family === 'mage' && e.spells.some((id) => Magic.get(id).school === sc)), 'маг школы ' + sc);
  const ninja = Enemies.get('ninja');
  assert.ok(ninja.spells.includes('smoke') && ninja.spells.includes('shadow_step'));
  const golem = Enemies.get('golem_stone');
  assert.equal(golem.spawn, false);
  assert.equal(golem.tameable, false);
});

test('формулы: сила растёт от уровня, стата школы и силы убитых магов; шансы кражи и подчинения в пределах', () => {
  const s = Magic.get('fire_bolt');
  const base = Magic.power({ level: 1, stats: {} }, s);
  assert.equal(base, 1);
  assert.ok(Magic.power({ level: 10, stats: {} }, s) > base);
  assert.ok(Magic.power({ level: 1, stats: { magic: 5 } }, s) > base, 'огонь — от Магии');
  assert.equal(Magic.power({ level: 1, stats: { intellect: 5 } }, s), base, 'Интеллект огню не помогает');
  assert.ok(Magic.power({ level: 1, stats: { intellect: 5 } }, 'frost_bolt') > base, 'вода — от Интеллекта');
  assert.ok(Magic.power({ level: 1, stats: {}, magicPower: 3 }, s) > base);
  assert.equal(Magic.power({ level: 1, stats: {}, magicPower: 999 }, s), Magic.power({ level: 1, stats: {}, magicPower: Magic.settings.magicPowerMax }, s), 'предел силы');
  assert.ok(Magic.enemyPower(10) > Magic.enemyPower(1));
  const weak = Magic.stealChance({ level: 1, stats: {} }, 20), strong = Magic.stealChance({ level: 10, stats: { magic: 10, intellect: 6 } }, 5);
  assert.ok(weak >= Magic.settings.magicChanceMin && strong <= Magic.settings.magicChanceMax && strong > weak);
  assert.ok(Magic.charmChance({ level: 5, stats: { magic: 3, suggestion: 3 } }, 5, 0.2) > Magic.charmChance({ level: 5, stats: { magic: 3, suggestion: 3 } }, 5, 1));
});

test('изучение: требования (Магия, уровень, особые статы), повтор, забыть; заклинание на панели 1–0 только изученное', () => {
  const ch = { level: 1, stats: { magic: 1 }, inventory: null };
  Inv.ensure(ch);
  assert.equal(Magic.learn(ch, 'fire_bolt'), null);
  assert.match(Magic.learn(ch, 'fire_bolt'), /уже изучено/);
  assert.match(Magic.learn(ch, 'meteor'), /Магия 6/);
  ch.stats.magic = 6;
  assert.match(Magic.learn(ch, 'meteor'), /уровень 10/);
  assert.match(Magic.learn(ch, 'nope'), /Неизвестное/);
  ch.stats.magic = 3; ch.level = 5;
  assert.match(Magic.learn(ch, 'shadow_step'), /Скрытность 2/);
  assert.match(Inv.setHotbar(ch, 0, 'spell:heal'), /не изучено/);
  assert.equal(Inv.setHotbar(ch, 0, 'spell:fire_bolt'), null);
  assert.equal(ch.inventory.hotbar[0], 'spell:fire_bolt');
  assert.match(Inv.hotkey(ch, 0, {}), /заклинание/);
  Inv.ensure(ch);
  assert.equal(ch.inventory.hotbar[0], 'spell:fire_bolt', 'ensure не стирает заклинание с панели');
  assert.equal(Magic.fromHotbar('spell:fire_bolt'), 'fire_bolt');
  assert.equal(Magic.fromHotbar('medkit'), null);
  assert.equal(Magic.forget(ch, 'fire_bolt'), true);
  assert.deepEqual(Magic.known(ch), []);
  assert.equal(ch.inventory.hotbar[0], null, 'забытое уходит с панели');
});
