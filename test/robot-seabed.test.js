'use strict';
// Роботы и дроны ходят по дну водоёмов и выходят на сушу (GDD «Плавание», ART.md «Плавание» — seabed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const WorldGen = require('../shared/worldgen');
globalThis.window = globalThis.window || {};
window.WorldGen = window.WorldGen || WorldGen;
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'client', 'js', 'game', f)).href);

test('роботы и дроны ходят по дну: вода для них проходима, выходят на сушу; рисунок — шаг по дну, не плавание', async () => {
  const Enemies = require('../shared/enemies');
  const M = require('../shared/movement');
  const ai = require('../server/ai');
  const B = WorldGen.B, tiles = new Uint8Array(10 * 5).fill(B.WATER);
  for (let y = 0; y < 5; y++) for(let x=0;x<10;x++) if(x<3||x>=7)tiles[y*10+x]=B.WASTE;
  const map = { width: 10, height: 5, tiles };
  const ctx = { map, grid: M.gridFromWorld(map), game: { aiPathMaxNodes: 500, enemySpeedFactor: 1 }, isSafe: () => false };
  const cross = (id) => { const e = { x: 1.5, y: 2.5, def: Enemies.get(id), path: [] }; e.path = ai.pathTo(ctx, e, 8.5, 2.5); for (let n = 0; n < 400 && e.path.length; n++) ai.moveAlong(ctx, e, 0.1); return e; };
  for (const id of ['walker_patrol', 'droid_repair', 'droid_protocol', 'drone_tracked', 'drone_service', 'boss_vault']) {
    assert.ok(Enemies.seabedWalker(Enemies.get(id)), id + ' — по дну');
    const e = cross(id);
    assert.ok(Math.abs(e.x - 8.5) < 0.05, id + ' перешёл по дну и вышел на берег');
  }
  assert.ok(Math.abs(cross('wolf').x - 1.5) < 0.05, 'обычный враг в воду не заходит');
  assert.equal(map.swimmer, undefined, 'флаг пловца возвращён');
  assert.ok(!Enemies.seabedWalker(Enemies.get('drone_quad')), 'летающий дрон летит');
  Enemies.configure({ robotsWalkSeabed: false });
  try { assert.ok(Math.abs(cross('walker_patrol').x - 1.5) < 0.05, 'настройка выключает хождение по дну'); } finally { Enemies.configure({ robotsWalkSeabed: true }); }
  assert.match(read('server/config.js'), /'game\.robotsWalkSeabed': '[^']*по дну/);

  const { swimModeAt, drawSwimming, isMachine } = await load('swim-art.js');
  const sea = { width: 2, height: 1, tiles: new Uint8Array([B.WASTE, B.WATER]) };
  const robot = (id, x = 1.5) => ({ x, y: 0.5, def: Enemies.get(id), look: Enemies.get(id).look });
  assert.equal(swimModeAt(sea, robot('walker_patrol')), 'seabed');
  assert.equal(swimModeAt(sea, robot('drone_tracked')), 'seabed');
  assert.equal(swimModeAt(sea, robot('walker_patrol', 0.5)), null, 'на суше — обычный шаг');
  assert.equal(swimModeAt({ ...sea, underwater: true }, robot('droid_repair')), 'seabed-deep');
  assert.equal(swimModeAt(sea, robot('drone_quad')), null, 'летающий дрон над водой летит');
  assert.equal(swimModeAt({ ...sea, underwater: true }, robot('drone_uav')), null, 'летающий дрон не ныряет');
  assert.equal(swimModeAt(sea, robot('wolf')), 'swim', 'звери плывут');
  assert.ok(isMachine(robot('droid_protocol')) && !isMachine(robot('wolf')));
  // рисунок: фигура рисуется один раз почти без утопания (шаг сохраняется), муть, пузыри, круги на поверхности
  const calls = [];
  const ctx2 = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  ctx2.globalAlpha = 1;
  const out = drawSwimming(ctx2, 'seabed', 100, 100, 20, 1234, { id: 'r1', moving: true }, (dy) => calls.push(dy), { creature: true });
  assert.equal(calls.length, 1, 'одна отрисовка — без среза по линии воды');
  assert.ok(calls[0] > 0 && calls[0] < 5, 'лишь чуть утопает в иле');
  assert.ok(out.silt === 3 && out.bubbles === 3 && out.ripples === 2);
  const deep = drawSwimming(ctx2, 'seabed-deep', 100, 100, 20, 1234, { id: 'r1' }, () => {}, { creature: true });
  assert.ok(deep.bubbles === 3 && deep.ripples === 0 && deep.silt === 1);
  assert.match(read('client/js/game/anime-figure.js'), /startsWith\('seabed'\)/, 'гуманоид-робот на дне шагает, а не гребёт');
  assert.match(read('client/js/help.js'), /идут по дну/);
});
