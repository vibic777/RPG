'use strict';
// Крафт по WebSocket: рецепт без станка, атомарное списание материалов, нехватка, станок рядом (верстак базы, костёр),
// изучение рецепта свитком, требования к характеристикам, очередь (предел, отмена с возвратом), выдача готового,
// очередь сохраняется у героя, выдача рецептов администратором.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');
const WorldGen = require('../shared/worldgen');
const B = require('../shared/building');

const params = (o = {}) => ({ name: 'Пустошь', seed: 'base-1', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false, ...o });
const RULES = { baseRadius: 5, baseMinSpawnDist: 4, baseMinSettlementDist: 2 };
const set = (o) => Object.entries({ survivalFoodPerMin: 0, survivalWaterPerMin: 0, survivalRestPerMin: 0, chatRateCount: 100, ...RULES, ...o }).flatMap(([k, v]) => ['--set', `game.${k}=${v}`]);
B.configure(RULES);
function claimSpot(map) {
  const ok = (x, y) => WorldGen.isWalkable(map, x, y) && !B.nodeAt(map, x, y);
  for (let y = 8; y < map.height - 8; y++) for (let x = 8; x < map.width - 8; x++) {
    if (B.canClaim(map, x, y, [], 5)) continue;
    let good = true;
    for (let dy = -2; dy <= 2 && good; dy++) for (let dx = -2; dx <= 2 && good; dx++) if (!ok(x + dx, y + dy)) good = false;
    if (good) return { x, y };
  }
  throw new Error('нет места под базу');
}
async function give(b, token, item, count = 1) {
  const r = await api(b, 'POST', '/api/admin/items/give', { username: 'admin', item, count }, token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
}
const countIn = (m, id) => m.inventory.cells.reduce((a, x) => a + (x && x.id === id ? x.n : 0), 0);
const lastInv = (c) => [...c.messages].reverse().find((m) => m.t === 'inv');
async function use(c, id) {
  await sleep(150);
  const inv = lastInv(c);
  c.send({ t: 'inv', a: { type: 'use', from: { c: 'cell', i: inv.inventory.cells.findIndex((x) => x && x.id === id) } } });
}
const craft = (c, recipe, n = 1) => c.send({ t: 'craft', recipe, n });
const rej = async (c, re) => assert.match((await c.next('craft-reject')).message, re);

test('WS крафт: без станка, атомарное списание, нехватка, станок, свиток, требования, очередь, отмена, выдача, сохранение', async (t) => {
  const s = await startServer(set({ craftTimeFactor: 0.1, craftQueueMax: 2 }));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  const A = await joinWorld(b, admin, w.id);
  assert.ok(A.welcome.craft.known.includes('planks') && !A.welcome.craft.known.includes('medkit'));
  assert.deepEqual(A.welcome.craft.queue, []);
  // нехватка — ничего не списано
  await give(b, admin.token, 'wood', 3);
  craft(A, 'planks', 2);
  await rej(A, /Не хватает: Древесина 3\/4/);
  await sleep(100);
  assert.equal(countIn(lastInv(A), 'wood'), 3);
  // заказ: материалы списаны сразу, готовое приходит через время рецепта × craftTimeFactor
  craft(A, 'planks', 1);
  const q = await A.next((m) => m.t === 'craft' && m.queue.length === 1);
  assert.equal(q.queue[0].r, 'planks');
  await A.next((m) => m.t === 'inv' && countIn(m, 'wood') === 1);
  await A.next((m) => m.t === 'inv' && countIn(m, 'planks') === 2, 3000);
  await A.next((m) => m.t === 'craft' && m.queue.length === 0);
  // станок: топор лесоруба — верстак
  await give(b, admin.token, 'scrap_metal', 4);
  await give(b, admin.token, 'wood', 20);
  craft(A, 'axe_wood');
  await rej(A, /Нужен станок рядом: Верстак/);
  // не изучен → свиток → изучен; требование характеристики
  craft(A, 'medkit');
  await rej(A, /не изучен/);
  await give(b, admin.token, 'scroll_medkit');
  await use(A, 'scroll_medkit');
  const learned = await A.next((m) => m.t === 'craft' && m.known.includes('medkit'));
  assert.ok(learned);
  await use(A, 'scroll_medkit').catch(() => {});
  // верстак на базе
  const map = WorldGen.generate({ ...w });
  const spot = claimSpot(map);
  await api(b, 'POST', '/api/admin/teleport', { x: spot.x + 0.5, y: spot.y + 0.5 }, admin.token);
  await give(b, admin.token, 'base_flag');
  await use(A, 'base_flag');
  await A.next('bld-base');
  A.send({ t: 'build', a: 'place', type: 'workbench', x: spot.x + 1, y: spot.y });
  await A.next((m) => m.t === 'bld-add' && m.p.type === 'workbench');
  await sleep(100);
  craft(A, 'axe_wood');
  const q2 = await A.next((m) => m.t === 'craft' && m.queue.length === 1);
  assert.ok(q2.stations.includes('workbench'));
  // предел очереди (2) и отмена с возвратом материалов
  craft(A, 'club_plain');
  await A.next((m) => m.t === 'craft' && m.queue.length === 2);
  craft(A, 'club_plain');
  await rej(A, /В очереди уже 2/);
  await sleep(100);
  const woodBefore = countIn(lastInv(A), 'wood');
  const last = [...A.messages].reverse().find((m) => m.t === 'craft' && m.queue.length === 2).queue[1];
  A.send({ t: 'craft', a: 'cancel', id: last.id });
  await A.next((m) => m.t === 'inv' && countIn(m, 'wood') === woodBefore + 2);
  await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'axe_wood'), 3000);
  // костёр — станок «огонь»
  await give(b, admin.token, 'meat_raw');
  craft(A, 'cook_meat');
  await rej(A, /Костёр/);
  await give(b, admin.token, 'campfire');
  await use(A, 'campfire');
  await A.next('fire-add');
  craft(A, 'cook_meat');
  await A.next((m) => m.t === 'inv' && countIn(m, 'meat_roast') === 1, 3000);
  // администратор выдаёт рецепт; очередь сохраняется у героя
  assert.equal((await api(b, 'POST', '/api/admin/recipes/give', { username: 'admin', recipe: 'nope' }, admin.token)).status, 400);
  assert.equal((await api(b, 'POST', '/api/admin/recipes/give', { username: 'admin', recipe: 'build_forge' }, admin.token)).status, 200);
  await A.next((m) => m.t === 'craft' && m.known.includes('build_forge'));
  assert.equal((await api(b, 'POST', '/api/admin/characters/edit', { username: 'admin', characterId: admin.characterId, stats: { builder: 1 } }, admin.token)).status, 200);
  await give(b, admin.token, 'stone', 8);
  await sleep(150);
  A.send({ t: 'build', a: 'place', type: 'forge', x: spot.x - 1, y: spot.y });
  assert.match((await A.next('bld-reject')).message, /нужно .+ 3/);
  craft(A, 'planks', 5);
  await A.next((m) => m.t === 'craft' && m.queue.length === 1);
  A.close();
  await sleep(400);
  const dir = path.join(s.dataDir, 'characters');
  const ch = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.json'))), 'utf8')).characters[0];
  assert.equal(ch.craft.length, 1); assert.equal(ch.craft[0].n, 5);
  assert.ok(ch.recipes.includes('medkit') && ch.recipes.includes('build_forge'));
});
