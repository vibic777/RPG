'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../shared/movement');
const G = require('../shared/worldgen');

// Сетка из строк: '.' — проходимо, '#' — стена, '~' — медленно (стоимость 3)
function gridOf(rows) {
  const H = rows.length, W = rows[0].length;
  return {
    width: W, height: H,
    walkable: (x, y) => rows[y][x] !== '#',
    cost: (x, y) => (rows[y][x] === '~' ? 3 : 1),
    region: null,
  };
}
const valid = (grid, path, sx, sy) => {
  let px = sx, py = sy;
  for (const [x, y] of path) {
    assert.ok(Math.abs(x - px) <= 1 && Math.abs(y - py) <= 1, 'шаг на соседнюю клетку');
    assert.ok(grid.walkable(x, y), 'путь только по проходимым клеткам');
    if (x !== px && y !== py) assert.ok(grid.walkable(x, py) && grid.walkable(px, y), 'без срезания углов');
    px = x; py = y;
  }
};

test('A*: прямой путь и диагонали', () => {
  const g = gridOf(['.....', '.....', '.....']);
  const p = M.findPath(g, 0, 0, 4, 2);
  assert.deepEqual(p.at(-1), [4, 2]);
  assert.equal(p.length, 4, 'по диагонали короче');
  valid(g, p, 0, 0);
  assert.deepEqual(M.findPath(g, 2, 1, 2, 1), []);
});

test('A*: обход стены', () => {
  const g = gridOf([
    '.#...',
    '.#.#.',
    '.#.#.',
    '...#.',
  ]);
  const p = M.findPath(g, 0, 0, 4, 0);
  assert.ok(p);
  assert.deepEqual(p.at(-1), [4, 0]);
  valid(g, p, 0, 0);
  assert.ok(p.length >= 9);
});

test('A*: не срезает углы между стенами', () => {
  const g = gridOf(['.#', '#.']);
  assert.equal(M.findPath(g, 0, 0, 1, 1), null);
});

test('A*: недостижимая цель, стена, выход за карту', () => {
  const g = gridOf(['..#..', '..#..', '..#..']);
  assert.equal(M.findPath(g, 0, 0, 4, 0), null);
  assert.equal(M.findPath(g, 0, 0, 2, 1), null, 'цель — стена');
  assert.equal(M.findPath(g, 0, 0, 9, 9), null);
  assert.equal(M.findPath(g, -1, 0, 1, 1), null);
});

test('A*: учитывает стоимость местности', () => {
  const g = gridOf([
    '.....',
    '.~~~.',
    '.~~~.',
    '.~~~.',
    '.....',
  ]);
  const p = M.findPath(g, 2, 0, 2, 4);
  valid(g, p, 2, 0);
  assert.ok(p.every(([x, y]) => g.cost(x, y) === 1), 'обходит медленную местность');
});

test('A*: предел узлов', () => {
  const rows = Array.from({ length: 60 }, () => '.'.repeat(60));
  const g = gridOf(rows);
  assert.equal(M.findPath(g, 0, 0, 59, 59, 10), null);
  assert.ok(M.findPath(g, 0, 0, 59, 59, 100000));
});

test('A*: на сгенерированной карте путь до всех поселений', () => {
  const w = G.generate({ seed: 'path', size: 'medium' });
  const grid = M.gridFromWorld(w);
  for (const s of w.settlements) {
    const p = M.findPath(grid, w.spawn.x, w.spawn.y, s.x, s.y);
    assert.ok(p, `путь до «${s.name}»`);
    valid(grid, p, w.spawn.x, w.spawn.y);
  }
  // вода недостижима
  let water = null;
  for (let i = 0; i < w.tiles.length && !water; i++) if (w.tiles[i] === G.B.WATER) water = [i % w.width, Math.floor(i / w.width)];
  assert.equal(M.findPath(grid, w.spawn.x, w.spawn.y, water[0], water[1]), null);
});

test('движение: следование по пути, скольжение вдоль стен, проверки позиции и шага', () => {
  const w = G.generate({ seed: 'move', size: 'small' });
  const start = { x: w.spawn.x + 0.5, y: w.spawn.y + 0.5 };
  // следование по пути
  const target = w.settlements[0];
  const path = M.findPath(M.gridFromWorld(w), w.spawn.x, w.spawn.y, target.x, target.y);
  let st = { pos: start, path };
  for (let i = 0; i < 10000 && st.path.length; i++) st = M.followPath(w, st.pos, st.path, 0.1);
  assert.deepEqual(st.pos, { x: target.x + 0.5, y: target.y + 0.5 });
  // одна итерация не превышает скорость
  const one = M.followPath(w, start, path, 0.1);
  assert.ok(Math.hypot(one.pos.x - start.x, one.pos.y - start.y) <= M.settings.heroSpeed * 0.1 * 1.1 + 1e-9);
  // упор в воду: позиция остаётся проходимой
  let p = { ...start };
  for (let i = 0; i < 500; i++) p = M.moveWithCollision(w, p, -0.3, 0);
  assert.ok(M.posWalkable(w, p.x, p.y));
  // проверки
  assert.equal(M.validatePosition(w, start), null);
  assert.match(M.validatePosition(w, { x: 0.5, y: 0.5 }), /непроходим/);
  assert.match(M.validatePosition(w, { x: -3, y: 1 }), /вне карты/);
  assert.match(M.validatePosition(w, { x: 'a', y: 1 }), /Некорректные/);
  assert.equal(M.validatePosition(w, { ...start, z: 3 }), null); // шаг 13: уровни −5…+10
  assert.match(M.validatePosition(w, { ...start, z: 11 }), /Уровень вне/);
  assert.equal(M.validateStep(w, start, one.pos, 0.1), null);
  assert.match(M.validateStep(w, start, st.pos, 0.1) || '', /быстр/);
});

test('двоичная куча выдаёт элементы по возрастанию приоритета', () => {
  const h = new M.Heap();
  const vals = [5, 1, 9, 3, 7, 2, 8];
  for (const v of vals) h.push('v' + v, v);
  const out = [];
  while (h.size) out.push(h.pop());
  assert.deepEqual(out, vals.slice().sort((a, b) => a - b).map((v) => 'v' + v));
});

test('validatePath: принимает цепочку соседних проходимых клеток, отклоняет разрывы, стены и срезание углов', () => {
  // мир-заглушка 6x4: 0 — вода (непроходимо), 3 — пустошь
  const rows = [
    '......',
    '..#...',
    '..#...',
    '......',
  ];
  const world = { width: 6, height: 4, tiles: rows.join('').split('').map((ch) => (ch === '#' ? G.B.MOUNTAIN : G.B.WASTE)) };
  const from = { x: 0.5, y: 0.5 };
  assert.equal(M.validatePath(world, from, [[1, 0], [2, 0], [3, 0], [3, 1]]), null);
  assert.equal(M.validatePath(world, from, [[0, 0], [1, 1]]), null, 'первая клетка может совпадать с текущей');
  assert.match(M.validatePath(world, from, []), /Пустой/);
  assert.match(M.validatePath(world, from, [[3, 0]]), /Разрыв/);
  assert.match(M.validatePath(world, from, [[1, 0], [2, 1]]), /непроходим/);
  assert.match(M.validatePath(world, { x: 1.5, y: 0.5 }, [[1, 1], [2, 1]].slice(0, 1).concat([[1, 2], [2, 3]])), /угол/);
  assert.match(M.validatePath(world, from, [[1, 0.5]]), /Некорректная/);
  assert.match(M.validatePath(world, from, [[-1, 0]]), /край|непроходим/);
  assert.match(M.validatePath(world, from, new Array(10).fill([0, 0]), 5), /длинный/);
});
