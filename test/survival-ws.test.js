'use strict';
// Выживание по WebSocket: тики шкал и предупреждения, сохранение, еда и порча, костёр и готовка, отдых (Z) и безопасность,
// питьё из реки (G), радиация в воронке, правка шкал администратором, мир с выключенным выживанием.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');
const WorldGen = require('../shared/worldgen');
const S = require('../shared/survival');

const params = (o = {}) => ({ name: 'Пустошь', seed: 'surv-1', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false, ...o });
const set = (o) => Object.entries(o).flatMap(([k, v]) => ['--set', `game.${k}=${v}`]);

async function setup(args, world = {}) {
  const s = await startServer(args);
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params(world), admin.token)).data.world;
  const A = await joinWorld(b, admin, w.id);
  return { s, b, w, admin, A };
}
const charFile = (s) => { const dir = path.join(s.dataDir, 'characters'); return JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.json'))), 'utf8')).characters[0]; };
const sv = (c, pred, timeout = 4000) => c.next((m) => m.t === 'sv' && pred(m), timeout);
async function give(b, token, item, count = 1) {
  const r = await api(b, 'POST', '/api/admin/items/give', { username: 'admin', item, count }, token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
}
const has = (m, id) => m && m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === id);
async function use(c, id) {
  const last = [...c.messages].reverse().find((m) => m.t === 'inv' || m.t === 'inv-error');
  const inv = has(last, id) ? last : await c.next((m) => has(m, id));
  const i = inv.inventory.cells.findIndex((x) => x && x.id === id);
  c.send({ t: 'inv', a: { type: 'use', from: { c: 'cell', i } } });
}
const edit = (b, admin, body) => api(b, 'POST', '/api/admin/characters/edit', { username: 'admin', characterId: admin.characterId, ...body }, admin.token);
const tell = (c, re) => c.next((m) => m.t === 'chat' && re.test(m.m.text));

test('WS выживание: шкалы тикают, предупреждения, сохраняются при выходе', async (t) => {
  const { s, A } = await setup(set({ survivalFoodPerMin: 1500, survivalWaterPerMin: 0, survivalRestPerMin: 0 }));
  t.after(() => s.stop());
  assert.equal(A.welcome.sv.on, 1);
  assert.equal(A.welcome.sv.food, 100);
  const w = await A.next((m) => m.t === 'sv-warn' && m.k === 'food' && m.level === 'low', 6000);
  assert.match(w.text, /проголодались/);
  const m = await sv(A, (x) => x.food === 0, 6000);
  assert.ok(m.flags.includes('starving') && m.flags.includes('hungry'));
  assert.equal(m.water, 100);
  A.close();
  await sleep(300);
  const ch = charFile(s);
  assert.equal(ch.survival.food, 0);
  assert.equal(ch.survival.water, 100);
});

test('WS выживание: еда и порча, костёр и готовка, правка шкал администратором', async (t) => {
  const { s, b, A, admin } = await setup(set({ survivalFoodPerMin: 0, survivalWaterPerMin: 0, survivalRestPerMin: 0, survivalSpoilMin: 0.002, survivalSpoiledIllChance: 0 }));
  t.after(() => s.stop());
  assert.equal((await edit(b, admin, { food: 150 })).status, 400);
  assert.equal((await edit(b, admin, { food: 20, water: 40 })).status, 200);
  await sv(A, (x) => x.food === 20 && x.water === 40);
  await give(b, admin.token, 'meat_raw');
  await sleep(200); // испортилось
  await use(A, 'meat_raw');
  await tell(A, /испортилось/);
  await sv(A, (x) => x.food === 20 + Math.round(15 * S.settings.survivalSpoiledFactor) || x.food === 28);
  // костёр и готовка
  await give(b, admin.token, 'campfire');
  await use(A, 'campfire');
  const f = await A.next('fire-add');
  assert.ok(f.fire.id && f.fire.until > Date.now());
  await give(b, admin.token, 'meat_raw', 2);
  await use(A, 'meat_raw');
  const inv = await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'meat_roast'));
  assert.equal(inv.inventory.cells.find((x) => x && x.id === 'meat_roast').n, 2);
  assert.ok(!inv.inventory.cells.some((x) => x && x.id === 'meat_raw'));
  await give(b, admin.token, 'water_dirty');
  await use(A, 'water_dirty');
  await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'water_clean'));
  // чистая вода пьётся и поднимает шкалу
  await use(A, 'water_clean');
  await sv(A, (x) => x.water === 90);
});

test('WS выживание: отдых (Z) — сидя, со спальником — сон, враг рядом — небезопасно', async (t) => {
  const { s, b, A, admin } = await setup(set({ survivalFoodPerMin: 0, survivalWaterPerMin: 0, survivalRestPerMin: 0, survivalSitRestPerMin: 120, survivalSleepRestPerMin: 240 }));
  t.after(() => s.stop());
  await edit(b, admin, { rest: 10 });
  await sv(A, (x) => x.rest === 10);
  A.send({ t: 'rest' });
  await sv(A, (x) => x.resting === 'sit' && x.safe === 1);
  await sv(A, (x) => x.rest >= 13);
  await give(b, admin.token, 'bedroll');
  await sv(A, (x) => x.resting === 'sleep');
  A.send({ t: 'chat', text: '/spawn zombie' });
  await sv(A, (x) => x.resting && x.safe === 0);
  A.send({ t: 'rest', on: false });
  await sv(A, (x) => x.resting === null);
});

test('WS выживание: пить из реки (G), радиация в воронке', async (t) => {
  const { s, b, w, A, admin } = await setup(set({ survivalFoodPerMin: 0, survivalWaterPerMin: 0, survivalRestPerMin: 0, survivalDrinkIllChance: 0, survivalRadPerMin: 300, survivalDrinkCooldownSec: 0 }));
  t.after(() => s.stop());
  const map = WorldGen.generate({ ...w }); // карта сервера: по записи мира (форма, водоёмы)
  await edit(b, admin, { water: 50 });
  await sv(A, (x) => x.water === 50);
  // вдали от воды — отказ
  let far = null;
  for (let y = 2; y < map.height - 2 && !far; y++) for (let x = 2; x < map.width - 2 && !far; x++) if (WorldGen.isWalkable(map, x, y) && !S.nearWater(map, x + 0.5, y + 0.5, 4) && !S.radAt(map, x, y)) far = { x: x + 0.5, y: y + 0.5 };
  assert.equal((await api(b, 'POST', '/api/admin/teleport', { x: far.x, y: far.y }, admin.token)).status, 200);
  A.send({ t: 'drink' });
  assert.match((await A.next('sv-reject')).message, /нет воды/);
  let shore = null;
  for (let y = 1; y < map.height - 1 && !shore; y++) for (let x = 1; x < map.width - 1 && !shore; x++) {
    if (WorldGen.isWalkable(map, x, y) && WorldGen.tileAt(map, x + 1, y) <= WorldGen.B.RIVER && !S.radAt(map, x, y)) shore = { x: x + 0.5, y: y + 0.5 };
  }
  assert.equal((await api(b, 'POST', '/api/admin/teleport', shore, admin.token)).status, 200);
  await sleep(100);
  A.send({ t: 'drink' });
  await sv(A, (x) => x.water === 50 + S.settings.survivalDrinkWater);
  // воронка
  const c = S.craters(map)[0];
  assert.equal((await api(b, 'POST', '/api/admin/teleport', { x: c.x + 0.5, y: c.y + 0.5 }, admin.token)).status, 200);
  await sv(A, (x) => x.radHere === 3);
  await sv(A, (x) => x.rad >= S.settings.survivalRadSickAt && x.flags.includes('radsick'), 6000);
  assert.ok(A.messages.some((m) => m.t === 'sv-warn' && m.k === 'rad' && m.level === 'sick'));
  // антирадин
  await give(b, admin.token, 'antirad');
  const before = [...A.messages].reverse().find((m) => m.t === 'sv').rad;
  await use(A, 'antirad');
  await sv(A, (x) => x.rad < before - 20);
});

test('WS выживание: мир без выживания — шкалы стоят, отдых и питьё не нужны', async (t) => {
  const { s, b, A, admin } = await setup(set({ survivalFoodPerMin: 3000 }), { survival: false });
  t.after(() => s.stop());
  assert.equal(A.welcome.sv.on, 0);
  A.send({ t: 'rest' });
  assert.match((await A.next('sv-reject')).message, /выключено/);
  await sleep(600);
  const last = [...A.messages].reverse().find((m) => m.t === 'sv') || A.welcome.sv;
  assert.equal(last.food, 100);
  // еда при полном здоровье ничего не даёт (сытость не считается)
  await give(b, admin.token, 'ration');
  await use(A, 'ration');
  assert.match((await A.next('inv-error')).message, /ничего не даст/);
});
