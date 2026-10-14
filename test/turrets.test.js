'use strict';
// Турели (server/combat.js, без сети): рост показателей с уровнем улучшения, выбор цели по режиму,
// стоимость улучшения, ремонт и улучшение владельцем, урон от врагов и разбитая турель на земле с уровнем.
const test = require('node:test');
const assert = require('node:assert/strict');
const { tmpDir, rmDir } = require('./helpers');
const config = require('../server/config');

const dir = tmpDir();
config.load({ overrides: { dataDir: dir } });
const G = config.get().game;
require('../shared/combat').configure(G);
require('../server/inventory').configure(G);
const CombatRules = require('../shared/combat');
const Items = require('../shared/items');
const Inv = require('../shared/inventory');
const Combat = require('../server/combat');
const ground = require('../server/ground');
test.after(() => rmDir(dir));

// Комната без сети: рассылки копятся в списке
function fakeRoom() {
  const sent = [];
  return { id: '00000000-0000-4000-8000-000000000001', grid: {}, players: new Map(), broadcast: (m) => sent.push(m), sent };
}
function fakeClient(room) {
  const out = [];
  const ch = { name: 'Тест', inventory: Inv.empty(), stats: {} };
  const c = { room, account: { id: 'acc1' }, character: ch, pos: { x: 5, y: 5 }, ws: { readyState: 1, send: (m) => out.push(JSON.parse(m)) }, out };
  room.players.set('acc1', c);
  return c;
}
function addTurret(room, over = {}) {
  const base = CombatRules.profile(Items.get('turret_watchman'));
  const t = { id: 't1', item: 'turret_watchman', owner: 'acc1', ownerName: 'Тест', x: 5, y: 5, mag: 10, tier: 1, hp: 150, maxHp: G.turretHpBase, mode: 'nearest', until: Date.now() + 1e6, next: 0, prof: base, base, ...over };
  Combat.stateOf(room).turrets.set(t.id, t);
  return t;
}

test('турели: уровень улучшения усиливает урон, дальность, скорострельность и магазин', () => {
  const base = CombatRules.profile(Items.get('turret_watchman'));
  const t1 = Combat.turretProfile(base, 1), t3 = Combat.turretProfile(base, 3);
  assert.deepEqual(t1.damage, base.damage);
  assert.ok(t3.damage[0] > base.damage[0] && t3.range > base.range && t3.speed > base.speed && t3.magazine > base.magazine);
  const cost = Combat.turretUpgradeCost(2);
  assert.deepEqual(cost.map((x) => x.id), [G.turretUpgradeItem, G.turretUpgradeItem2]);
  assert.equal(cost[0].n, G.turretUpgradeCount * 2); // дороже с каждым уровнем
});

test('турели: режимы цели — ближайший, самый здоровый, самый слабый', () => {
  const t = { x: 0, y: 0, mode: 'nearest' };
  const es = [{ id: 'a', x: 1, y: 0, hp: 50 }, { id: 'b', x: 5, y: 0, hp: 200 }, { id: 'c', x: 3, y: 0, hp: 10 }];
  assert.equal(Combat.turretTarget(t, es).id, 'a');
  assert.equal(Combat.turretTarget({ ...t, mode: 'strongest' }, es).id, 'b');
  assert.equal(Combat.turretTarget({ ...t, mode: 'weakest' }, es).id, 'c');
  assert.equal(Combat.turretTarget(t, []), null);
  assert.deepEqual(Combat.TURRET_MODES, ['nearest', 'strongest', 'weakest']);
});

test('турели: владелец меняет режим, чинит материалом и улучшает; чужому и издалека нельзя', () => {
  const room = fakeRoom();
  const c = fakeClient(room);
  const t = addTurret(room, { hp: 30 });
  Combat.onTurret(c, { id: 't1', a: 'mode', mode: 'weakest' });
  assert.equal(t.mode, 'weakest');
  assert.equal(room.sent.at(-1).t, 'turret-upd');
  // ремонт: без материала — отказ, с материалом — здоровье растёт, материал тратится
  assert.match(Combat.onTurret(c, { id: 't1', a: 'repair' }), /ремонта нужен/);
  Inv.add(c.character, G.turretRepairItem, 10);
  Combat.onTurret(c, { id: 't1', a: 'repair' });
  assert.equal(t.hp, t.maxHp);
  assert.equal(Inv.count(c.character, G.turretRepairItem), 10 - Math.ceil((G.turretHpBase - 30) / G.turretRepairHpPerItem));
  assert.match(Combat.onTurret(c, { id: 't1', a: 'repair' }), /цела/);
  // улучшение
  assert.match(Combat.onTurret(c, { id: 't1', a: 'upgrade' }), /не хватает/);
  Inv.add(c.character, G.turretUpgradeItem, 40);
  Inv.add(c.character, G.turretUpgradeItem2, 10);
  const before = Inv.count(c.character, G.turretUpgradeItem2);
  Combat.onTurret(c, { id: 't1', a: 'upgrade' });
  assert.equal(t.tier, 2);
  assert.ok(t.maxHp > G.turretHpBase && t.hp === t.maxHp);
  assert.ok(t.prof.damage[0] > t.base.damage[0]);
  assert.equal(Inv.count(c.character, G.turretUpgradeItem2), before - G.turretUpgradeCount2);
  // чужая турель и слишком далеко
  t.owner = 'acc2';
  assert.match(Combat.onTurret(c, { id: 't1', a: 'mode', mode: 'nearest' }), /чужая/);
  t.owner = 'acc1';
  c.pos = { x: 5 + G.turretInteractRange + 1, y: 5 };
  assert.match(Combat.onTurret(c, { id: 't1', a: 'mode', mode: 'nearest' }), /ближе/);
  assert.equal(c.out.at(-1).t, 'atk-reject');
});

test('турели: враги ранят турель броней, разбитая ложится на землю с уровнем улучшения', () => {
  const room = fakeRoom();
  fakeClient(room);
  const t = addTurret(room, { tier: 2, maxHp: 225, hp: 225 });
  const dealt = Combat.hitTurret(room, t, 20, 'physical');
  assert.ok(dealt > 0 && dealt < 20, 'броня турели гасит часть урона');
  assert.equal(room.sent.at(-1).t, 'turret-upd');
  Combat.hitTurret(room, t, 5000, 'physical');
  assert.ok(!Combat.stateOf(room).turrets.has('t1'));
  const rm = room.sent.find((m) => m.t === 'turret-remove');
  assert.equal(rm.destroyed, 1);
  const gi = room.sent.find((m) => m.t === 'ground-add').item;
  assert.equal(gi.id, 'turret_watchman');
  assert.equal(gi.tier, 2);
  assert.equal(gi.dur, 0);
  assert.ok(ground.list('00000000-0000-4000-8000-000000000001').some((g) => g.tier === 2));
  // подобранный предмет сохраняет уровень
  const ch = { inventory: Inv.empty() };
  Inv.add(ch, gi.id, 1, gi.dur, { tier: gi.tier });
  assert.equal(ch.inventory.cells.find(Boolean).tier, 2);
});
