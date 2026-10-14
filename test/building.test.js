'use strict';
// Строительство и крафт — общие правила: участок базы, размещение, проходимость стен и дверей (A*), возврат и ремонт,
// ресурсные точки и добыча, данные рецептов, проверка крафта, изучение рецептов.
const test = require('node:test');
const assert = require('node:assert/strict');
const WorldGen = require('../shared/worldgen');
const M = require('../shared/movement');
const B = require('../shared/building');
const C = require('../shared/crafting');
const Items = require('../shared/items');

// ровная карта-пустошь 40×40 с поселением в углу
function flat(n = 40) {
  const tiles = new Uint8Array(n * n).fill(WorldGen.B.WASTE);
  return { seed: 'flat', width: n, height: n, tiles, settlements: [{ id: 0, name: 'Хутор', x: 2, y: 2 }], spawn: { x: 3, y: 3 } };
}

test('участок базы: край, поселение, точка появления, чужая база', () => {
  const m = flat(80);
  assert.match(B.canClaim(m, 2, 40), /краю/);
  assert.match(B.canClaim(m, 20, 20), /поселению|появления/);
  assert.equal(B.canClaim(m, 50, 50), null);
  assert.match(B.canClaim(m, 55, 55, [{ x: 50, y: 50, r: 10 }]), /чужой базе/);
  const w = flat(80); w.tiles[50 * 80 + 50] = WorldGen.B.WATER;
  assert.match(B.canClaim(w, 50, 50), /нельзя/);
});

test('размещение: участок, занятость по слоям, фундамент под крышей', () => {
  const m = flat();
  const base = { x: 20, y: 20, r: 5 };
  const at0 = () => null;
  assert.equal(B.canPlace(m, base, B.get('wall_wood'), 22, 20, at0), null);
  assert.match(B.canPlace(m, base, B.get('wall_wood'), 30, 20, at0), /Вне участка/);
  assert.match(B.canPlace(m, null, B.get('wall_wood'), 22, 20, at0), /объявите базу/);
  const occ = (x, y, layer) => (layer === 'main' ? { type: 'wall_wood' } : null);
  assert.match(B.canPlace(m, base, B.get('wall_wood'), 22, 20, occ), /занята/);
  assert.equal(B.canPlace(m, base, B.get('foundation'), 22, 20, occ), null, 'пол — другой слой');
  assert.match(B.canPlace(m, base, B.get('roof'), 22, 20, at0), /фундамент/);
  assert.equal(B.canPlace(m, base, B.get('roof'), 22, 20, (x, y, l) => (l === 'floor' ? { type: 'foundation' } : null)), null);
  assert.match(B.canPlace(m, base, B.get('flag'), 22, 20, at0), /Неизвестная/);
});

test('проходимость: стена преграждает путь, дверь — только своим, незапертая — всем игрокам, враги — никогда', () => {
  const m = flat();
  m.blocks = new Map();
  // вертикальная стена x = 10 от y = 0 до 39 с дверью на y = 20
  for (let y = 0; y < 40; y++) m.blocks.set(y * 40 + 10, y === 20 ? { block: 'door', locked: true, owner: 'me', allow: ['friend'] } : { block: 1 });
  const grid = M.gridFromWorld(m);
  m.actor = null;
  assert.equal(M.findPath(grid, 5, 20, 15, 20), null, 'враг не проходит');
  m.actor = 'stranger';
  assert.equal(M.findPath(grid, 5, 20, 15, 20), null, 'чужой не проходит запертую дверь');
  m.actor = 'friend';
  const p = M.findPath(grid, 5, 20, 15, 20);
  assert.ok(p && p.some(([x, y]) => x === 10 && y === 20), 'допущенный — через дверь');
  m.actor = 'me';
  assert.ok(M.findPath(grid, 5, 20, 15, 20));
  m.blocks.get(20 * 40 + 10).locked = false;
  m.actor = 'stranger';
  assert.ok(M.findPath(grid, 5, 20, 15, 20), 'незапертая — всем игрокам');
  m.actor = null;
  assert.equal(M.findPath(grid, 5, 20, 15, 20), null, 'враги — никогда');
  // движение: шаг в стену не проходит
  assert.equal(M.validatePosition(m, { x: 10.5, y: 5.5 }), 'Позиция на непроходимой клетке.');
  const moved = M.moveWithCollision(m, { x: 9.6, y: 5.5 }, 0.8, 0);
  assert.ok(moved.x < 10);
});

test('снос и ремонт: частичный возврат и цена ремонта по урону', () => {
  const w = B.get('wall_wood');
  assert.deepEqual(B.refund(w), { wood: Math.floor(4 * B.settings.buildRefund) });
  assert.deepEqual(B.repairCost(w, B.maxHp(w), B.maxHp(w)), {});
  assert.deepEqual(B.repairCost(w, 0, B.maxHp(w)), { wood: Math.ceil(4 * B.settings.buildRepairFactor) });
});

test('сооружения: данные корректны, материалы существуют, чертежи — в рецептах', () => {
  for (const p of B.PIECES) {
    for (const id of Object.keys(p.cost)) assert.ok(Items.get(id), `${p.id}: ${id}`);
    if (p.learn) assert.equal(C.get(p.learn).piece, p.id);
    if (p.station) assert.ok(C.STATIONS[p.station], p.station);
    assert.ok(['floor', 'main', 'roof'].includes(p.layer));
  }
});

test('ресурсные точки: детерминированы, в лесу деревья, добыча с инструментом больше, валун — только киркой', () => {
  const map = WorldGen.generate({ seed: 'nodes-1', size: 'small' });
  const a = B.nodes(map), b = B.nodes(WorldGen.generate({ seed: 'nodes-1', size: 'small' }));
  assert.deepEqual([...a.entries()].slice(0, 50), [...b.entries()].slice(0, 50));
  const kinds = new Set(a.values());
  assert.ok(kinds.has('tree') && kinds.has('rock'));
  for (const [i, k] of a) if (k === 'tree') assert.equal(map.tiles[i], WorldGen.B.FOREST);
  const one = () => 0; // минимальный бросок
  assert.deepEqual(B.gatherYield('tree', null, one).items, [{ id: 'wood', n: 1 }]);
  assert.deepEqual(B.gatherYield('tree', 'axe', one).items, [{ id: 'wood', n: B.settings.gatherToolBonus }]);
  assert.match(B.gatherYield('rock', null, one).error, /кирка/);
  assert.ok(B.gatherYield('rock', 'pick', one).items.some((x) => x.id === 'stone'));
  assert.ok(B.gatherYield('ruin', null, () => 0.1).items.length >= 1);
});

test('рецепты: данные корректны, у изучаемых есть свиток', () => {
  assert.deepEqual(C.validate(), []);
  assert.deepEqual(Items.validateCatalogue(), []);
  assert.ok(C.startSet().includes('planks'));
  assert.ok(!C.startSet().includes('medkit'));
});

test('крафт: известен ли рецепт, характеристики, станок, материалы; изучение', () => {
  const ch = { stats: { intellect: 1, strength: 5 }, inventory: { cells: [{ id: 'wood', n: 3 }, { id: 'cloth', n: 1 }] } };
  assert.equal(C.check(ch, C.get('planks')), null);
  assert.match(C.check(ch, C.get('planks'), 2), /Не хватает: Древесина 3\/4/);
  assert.match(C.check(ch, C.get('base_flag')), /Не хватает/);
  assert.match(C.check(ch, C.get('medkit')), /не изучен/);
  assert.match(C.check(ch, C.get('axe_wood')), /Верстак/);
  assert.match(C.check(ch, C.get('cook_meat'), 1, { stations: new Set(['fire']) }), /Не хватает/);
  assert.equal(C.learn(ch, 'medkit'), null);
  assert.match(C.learn(ch, 'medkit'), /уже известен/);
  assert.match(C.learn(ch, 'nope'), /Неизвестный/);
  assert.match(C.check(ch, C.get('medkit'), 1, { stations: new Set(['chem']) }), /Интеллект|Нужно/);
  C.learn(ch, 'build_forge');
  assert.match(C.check(ch, C.get('build_forge')), /чертёж/);
});

test('свитки рецептов выпадают с врагов: каждый изучаемый рецепт есть в какой-то таблице добычи', () => {
  const E = require('../shared/enemies');
  const drops = new Set();
  for (const t of Object.values(E.LOOT)) for (const e of t.entries) if (e.item) drops.add(e.item);
  const missing = C.RECIPES.filter((r) => !r.start && !drops.has('scroll_' + r.id)).map((r) => r.id);
  assert.deepEqual(missing, []);
  for (const id of ['wood', 'plastic', 'gunpowder']) assert.ok(drops.has(id), id);
  assert.deepEqual(E.validate(), []);
});
