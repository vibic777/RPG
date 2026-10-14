'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Items = require('../shared/items');
const Inv = require('../shared/inventory');
const Combat = require('../shared/combat');
const { startServer, api, newPlayer, joinWorld } = require('./helpers');

function hero() { const ch = { level: 99, stats: { strength: 20, magic: 20, intellect: 20 } }; Inv.ensure(ch); return ch; }
function equip(ch, id) { const it = Items.get(id); ch.inventory.equipment[Items.slotsFor(it)[0]] = { id, uid: id, n: 1, dur: it.durability }; }

test('комплекты: пороги 2/3/4/4+оружие накопительные, сломанные и дубли не считаются', () => {
  const ch = hero(), set = Items.SETS.find((s) => s.id === 'phoenix');
  equip(ch, set.items[0]); assert.equal(Items.setEffects(ch).hpRegen, 0);
  equip(ch, set.items[1]); assert.equal(Items.setEffects(ch).hpRegen, 2);
  equip(ch, set.items[2]); assert.equal(Items.setEffects(ch).hpRegen, 5);
  assert.equal(Items.setEffects(ch).defense, 10);
  equip(ch, set.items[3]); assert.equal(Items.setEffects(ch).hpPercent, 0.02);
  assert.equal(Items.setEffects(ch).storm, null);
  equip(ch, set.items[4]); assert.equal(Items.setEffects(ch).storm, 'fire');
  ch.inventory.equipment.offHand = { ...ch.inventory.equipment.mainHand, uid: 'second' };
  assert.equal(Items.setState(ch)[0].pieces, 5);
  ch.inventory.equipment.head.dur = 0;
  assert.equal(Items.setEffects(ch).hpPercent, 0);
  assert.equal(Items.setEffects(ch).storm, null);
  assert.equal(Items.setEffects(ch).hpRegen, 5);
});

test('комплекты: броня, невидимость, ранец активны только при нужном числе деталей', () => {
  for (const id of ['veil', 'sky', 'chaos']) {
    const ch = hero(), set = Items.SETS.find((s) => s.id === id);
    for (const item of set.items.slice(0, 4)) equip(ch, item);
    const effect = Items.setEffects(ch);
    assert.equal(Combat.heroDefense(ch).defense, 28 + effect.defense);
    assert.equal(effect.invisible, id === 'veil');
    assert.equal(effect.fly, id === 'sky');
    assert.equal(Boolean(Inv.look(ch).jetpack), id === 'sky');
    ch.inventory.equipment.feet = null;
    assert.equal(Items.setEffects(ch).fly, false);
    assert.equal(Items.setEffects(ch).invisible, false);
  }
});

test('добыча комплектов: отдельные вероятности брони и оружия', () => {
  assert.deepEqual(Items.rollSetLoot(() => 0.9), []);
  let values = [0.01, 0, 0, 0.9];
  assert.deepEqual(Items.rollSetLoot(() => values.shift()), [{ id: Items.SETS[0].items[0], n: 1 }]);
  // комплект без своего оружия — пятый предмет (клинок); кованые комплекты — оружие из своего списка (ещё один бросок)
  const at = (i) => (i + 0.5) / Items.SETS.length;
  values = [0.9, 0.001, at(2)];
  assert.ok(!Items.SETS[2].weapons);
  assert.deepEqual(Items.rollSetLoot(() => values.shift()), [{ id: Items.SETS[2].items[4], n: 1 }]);
  const forged = Items.SETS.findIndex((st) => st.weapons && st.weapons.length);
  values = [0.9, 0.001, at(forged), 0.5];
  const w = Items.SETS[forged].weapons[Math.floor(0.5 * Items.SETS[forged].weapons.length)];
  assert.deepEqual(Items.rollSetLoot(() => values.shift()), [{ id: w, n: 1 }]);
  assert.ok(Items.get(w) && Items.get(w).weapon, w);
});

test('автолут: приоритет ресурсов, только свои боеприпасы, лучшие предметы против экипировки', () => {
  const ch = hero(), needed = { needed: true }, best = { best: true };
  const gun = Items.ITEMS.find((it) => it.weapon && it.weapon.ammo);
  equip(ch, gun.id);
  assert.equal(Items.lootPriority(ch, Items.get(gun.weapon.ammo), needed), 3);
  const otherAmmo = Items.ITEMS.find((it) => it.category === 'ammo' && it.id !== gun.weapon.ammo);
  assert.equal(Items.lootPriority(ch, otherAmmo, needed), 0);
  assert.equal(Items.lootPriority(ch, Items.get('water_flask'), needed), 3);
  assert.equal(Items.lootPriority(ch, Items.get('ration'), needed), 3);
  equip(ch, 'set_phoenix_blade');
  assert.equal(Items.lootPriority(ch, Items.get('knife_rusty'), best), 0, 'пустая левая рука не делает слабый нож улучшением');
  equip(ch, 'armor_leather');
  assert.equal(Items.lootPriority(ch, Items.get('set_sky_armor'), best), 2);
  assert.equal(Items.lootPriority(ch, Items.get('set_sky_armor'), best, { dur: 0 }), 0);
  assert.equal(Items.lootPriority(ch, Items.get('knife_rusty'), { all: true }), 1);
});

test('WS автолут: выборочный сбор рядом, сохранение режима, неподходящий предмет остаётся', async (t) => {
  const s = await startServer(['--set', 'game.pickupRange=4']); t.after(() => s.stop());
  const p = await newPlayer(s.base, 'collector', 'Собиратель');
  const world = (await api(s.base, 'POST', '/api/worlds', { name: 'Сбор', seed: 'auto-loot', size: 'small', enemyDensity: 'normal', hordeFrequency: 'rare', dragons: 0, scaleToLevel: false }, p.token)).data.world;
  const c = await joinWorld(s.base, p, world.id);
  const cell = (id) => c.welcome.inv.inventory.cells.findIndex((x) => x && x.id === id);
  for (const id of ['ration', 'water_flask']) {
    c.send({ t: 'inv', a: { type: 'drop', from: { c: 'cell', i: cell(id) }, count: 1 } });
    await c.next((m) => m.t === 'ground-add' && m.item.id === id);
  }
  c.send({ t: 'inv', a: { type: 'drop', from: { c: 'eq', s: 'mainHand' } } });
  const knife = (await c.next((m) => m.t === 'ground-add' && m.item.id === 'knife_rusty')).item;
  c.send({ t: 'inv', a: { type: 'autoLoot', modes: { all: false, needed: true, best: false } } });
  const got = await c.next((m) => m.t === 'inv' && m.autoLoot.needed && ['ration', 'water_flask'].every((id) => m.inventory.cells.filter((x) => x && x.id === id).reduce((n, x) => n + x.n, 0) === 2));
  assert.equal(got.autoLoot.all, false);
  const file = path.join(s.dataDir, 'worlds', world.id + '.ground.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).items.map((g) => g.gid), [knife.gid]);
  await c.close();
  const again = await joinWorld(s.base, p, world.id);
  assert.deepEqual(again.welcome.inv.autoLoot, { all: false, needed: true, best: false });
  await again.close();
});

test('WS комплекты: невидимость для другого игрока, полёт; лётную деталь снимают только на земле, без неё не взлететь', async (t) => {
  const s = await startServer(); t.after(() => s.stop());
  const p = await newPlayer(s.base, 'setowner', 'Владелец'), observer = await newPlayer(s.base, 'observer', 'Наблюдатель');
  const world = (await api(s.base, 'POST', '/api/worlds', { name: 'Сеты', seed: 'set-effects', size: 'small', enemyDensity: 'normal', hordeFrequency: 'rare', dragons: 0, scaleToLevel: false }, p.token)).data.world;
  const shared = (await api(s.base, 'POST', `/api/worlds/${world.id}/share`, { open: true, invite: 'new' }, p.token)).data.world;
  await api(s.base, 'POST', '/api/worlds/join', { code: shared.inviteCode }, observer.token);
  const a = await joinWorld(s.base, p, world.id), b = await joinWorld(s.base, observer, world.id);
  async function wear(id) {
    const given = await api(s.base, 'POST', '/api/admin/items/give', { username: 'setowner', item: id }, p.token);
    assert.equal(given.status, 200, JSON.stringify(given.data));
    const inventory = (await a.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === id))).inventory;
    a.send({ t: 'inv', a: { type: 'equip', from: { c: 'cell', i: inventory.cells.findIndex((x) => x && x.id === id) } } });
    await a.next((m) => m.t === 'inv' && Object.values(m.inventory.equipment).some((x) => x && x.id === id));
  }
  const setOf = (id) => Items.SETS.find((st) => st.id === id); // «Призрак пустоши» — невидимость, «Небесный странник» — полёт
  for (const id of setOf('veil').items.slice(0, 4)) await wear(id);
  assert.equal((await b.next((m) => m.t === 'leave' && m.id === a.welcome.you)).reason, 'hidden');
  a.send({ t: 'inv', a: { type: 'unequip', from: { c: 'eq', s: 'feet' } } });
  await a.next((m) => m.t === 'inv' && !m.inventory.equipment.feet);
  await b.next((m) => m.t === 'join' && m.player.id === a.welcome.you);
  for (const id of setOf('sky').items.slice(0, 4)) await wear(id);
  a.send({ t: 'lvl-alt', d: 1 });
  assert.equal((await a.next((m) => m.t === 'lvl-alt' && m.alt === 1)).alt, 1);
  // в воздухе последнюю лётную деталь не снять — сначала посадка
  a.send({ t: 'inv', a: { type: 'unequip', from: { c: 'eq', s: 'feet' } } });
  assert.match((await a.next('inv-error')).message, /приземлитесь/);
  a.send({ t: 'lvl-alt', d: -1 });
  await a.next((m) => m.t === 'lvl-alt' && m.alt === 0);
  a.send({ t: 'inv', a: { type: 'unequip', from: { c: 'eq', s: 'feet' } } });
  await a.next((m) => m.t === 'inv' && !m.inventory.equipment.feet);
  a.send({ t: 'lvl-alt', d: 1 });
  assert.match((await a.next('lvl-reject')).message, /комплект/);
  await a.close(); await b.close();
});
