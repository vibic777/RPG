'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Items = require('../shared/items');

test('каталог: проверка validateCatalogue без ошибок', () => {
  assert.deepEqual(Items.validateCatalogue(), []);
  assert.ok(Items.ITEMS.length >= 100, 'предметов достаточно для разнообразия');
});

test('каталог: у каждого предмета есть обязательные поля, id уникальны', () => {
  const ids = new Set();
  for (const it of Items.ITEMS) {
    for (const k of ['id', 'name', 'desc', 'category', 'weight', 'size', 'value', 'rarity', 'level', 'req', 'icon', 'stack', 'durability', 'stackable']) {
      assert.ok(k in it, `${it.id}: нет поля ${k}`);
    }
    assert.ok(!ids.has(it.id), 'повтор id ' + it.id);
    ids.add(it.id);
    assert.ok(Items.CATEGORIES[it.category], it.id);
    assert.ok(Items.RARITIES[it.rarity], it.id);
    assert.match(it.name, /[А-Яа-яЁё]/, `${it.id}: название на русском`);
    assert.equal(Items.get(it.id), it);
  }
  assert.equal(Items.get('нет_такого'), null);
});

test('каталог: все категории и все классы оружия представлены, по несколько предметов', () => {
  for (const c of Object.keys(Items.CATEGORIES)) assert.ok(Items.ITEMS.some((i) => i.category === c), 'категория ' + c);
  for (const [cls, def] of Object.entries(Items.WEAPON_CLASSES)) {
    const n = Items.ITEMS.filter((i) => i.weapon && i.weapon.class === cls).length;
    assert.ok(n >= 2, `класс ${cls} (${def.name}): ${n} предметов`);
    assert.ok(Items.WEAPON_GROUPS[def.group], cls);
  }
  for (const dt of Object.keys(Items.DAMAGE_TYPES)) assert.ok(Items.ITEMS.some((i) => i.weapon && i.weapon.damageType === dt), 'тип урона ' + dt);
});

test('каталог: характеристики оружия для боя', () => {
  for (const it of Items.ITEMS.filter((i) => i.category === 'weapon')) {
    const w = it.weapon;
    assert.ok(Items.DAMAGE_TYPES[w.damageType], it.id);
    assert.ok(w.damage[1] >= w.damage[0] && w.damage[0] >= 0, it.id);
    for (const k of ['speed', 'range', 'magazine', 'reload']) assert.equal(typeof w[k], 'number', `${it.id}.${k}`);
    assert.equal(typeof w.twoHanded, 'boolean');
    assert.ok(Array.isArray(w.flags));
    if (w.ammo) assert.equal(Items.get(w.ammo).category, 'ammo', `${it.id}: боеприпас ${w.ammo}`);
    if (it.placeable) assert.equal(it.slot, null, `${it.id}: размещаемое не надевается`);
    else assert.deepEqual(Items.slotsFor(it), w.twoHanded ? ['mainHand'] : ['mainHand', 'offHand'], it.id);
  }
  // каждый тип боеприпаса к чему-то подходит (топливо — к технике, шаг 14)
  const VS = require('../shared/vehicles');
  const fuels = new Set(VS.LIST.map((d) => d.fuel.type));
  const arms = new Set(Object.values(VS.ARMS).map((a) => a.profile && a.profile.ammo).filter(Boolean)); // бортовое оружие техники
  for (const a of Items.ITEMS.filter((i) => i.category === 'ammo')) {
    assert.ok(fuels.has(a.id) || arms.has(a.id) || Items.ITEMS.some((i) => i.weapon && i.weapon.ammo === a.id), 'боеприпас без оружия: ' + a.id);
  }
});

test('каталог: слои одежды, броня, рюкзаки, бельё', () => {
  const under = Items.get('underwear_base');
  assert.equal(under.fixed, true);
  assert.equal(under.weight, 0);
  assert.equal(Items.SLOTS.find((s) => s.id === 'underwear').fixed, true);
  for (const s of ['underwear', 'shirt', 'pants', 'outer', 'armor', 'head', 'face', 'hands', 'feet', 'back', 'belt', 'backpack', 'ring1', 'ring2', 'amulet', 'mainHand', 'offHand']) {
    assert.ok(Items.slotById(s), 'слот ' + s);
  }
  for (const s of Items.SLOTS.filter((x) => !x.fixed)) {
    assert.ok(Items.ITEMS.some((i) => Items.slotsFor(i).includes(s.id)), 'нет предметов для слота ' + s.id);
  }
  assert.ok(Items.get('armor_power').blocks.includes('outer'), 'силовая броня не совмещается с верхней одеждой');
  // базовые рюкзаки различаются вместимостью; варианты по материалу и школе (wear_*) повторяют свою основу
  const all = Items.ITEMS.filter((i) => i.category === 'backpack'), packs = all.filter((i) => !i.material);
  assert.ok(packs.length >= 3 && all.every((p) => p.slots > 0 && p.carry > 0));
  assert.ok(new Set(packs.map((p) => p.slots)).size === packs.length, 'рюкзаки разной вместимости');
  for (const v of all.filter((i) => i.material)) { const base = packs.find((p) => v.id.startsWith('wear_' + p.id + '_')); assert.ok(base && base.slots === v.slots && base.carry === v.carry, v.id); }
  for (const c of Items.ITEMS.filter((i) => i.category === 'consumable')) assert.ok(c.stackable && c.effect, c.id);
});

test('каталог: validateCatalogue ловит ошибки', () => {
  const it = Items.ITEMS[0];
  const saved = it.category;
  it.category = 'bogus';
  try { assert.ok(Items.validateCatalogue().some((e) => e.includes('категория'))); } finally { it.category = saved; }
  const w = Items.get('pistol_nail').weapon;
  const ammo = w.ammo;
  w.ammo = 'ammo_nope';
  try { assert.ok(Items.validateCatalogue().some((e) => e.includes('боеприпас'))); } finally { w.ammo = ammo; }
  assert.deepEqual(Items.validateCatalogue(), []);
});
