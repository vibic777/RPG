'use strict';
// Бортовое оружие и вертикаль техники по WebSocket: подлодка погружается до −N (настройка) и всплывает, мель поднимает её,
// под водой — только торпеды и ракеты, выйти нельзя; вертолёт — до +10; снаряды вылетают из своих установок (пилоны по очереди),
// управляемая ракета доворачивает к цели, торпеда только по воде и рвётся у берега, бомба — только в полёте;
// спутник доплывает до лодки на воде.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');
const G = require('../shared/worldgen');
const L = require('../shared/levels');
const V = require('../shared/vehicles');

const SEED = 'vehicles-ws-1';
const params = { name: 'Оружие техники', seed: SEED, size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false };
const set = (o) => Object.entries({
  netDelta: false, survivalFoodPerMin: 0, survivalWaterPerMin: 0, survivalRestPerMin: 0, chatRateCount: 200, stunChance: 0, depotsPer256: 0, respawnSec: 0, ...o,
}).flatMap(([k, v]) => ['--set', `game.${k}=${v}`]);
const ROAD = new Set([G.B.CITY, G.B.WASTE, G.B.SETTLEMENT]);
const shotOf = (c, pred = () => true) => c.next((m) => (m.t === 'fx' && m.ev.some((f) => f.k === 'shot' && pred(f))) || m.t === 'atk-reject', 4000)
  .then((m) => { if (m.t === 'atk-reject') throw new Error('отказ: ' + m.message); return m.ev.find((f) => f.k === 'shot' && pred(f)); });
const fxOf = (c, pred, ms = 5000) => c.next((m) => m.t === 'fx' && m.ev.some(pred), ms).then((m) => m.ev.find(pred));
const near = (a, b, eps = 0.03) => Math.hypot(a.x - b.x, a.y - b.y) <= eps;

test('WS техника: погружение подлодки, высота авиации, оружие из установок, наведение, торпеды, бомбы', async (t) => {
  let stage = 'начало';
  process.on('exit', (code) => { if (code) console.error('этап:', stage); });
  const s = await startServer(set({ vehicleDiveMaxDepth: 4 }));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params, admin.token)).data.world;
  G.configure({ depotsPer256: 0 });
  L.configure({ depotsPer256: 0 });
  const map = G.generate({ ...w });
  const at = (x, y) => G.tileAt(map, x, y);
  const main = (x, y) => map.region[y * map.width + x] === map.mainRegion;
  let road = null;
  for (let y = 8; y < map.height - 8 && !road; y++) for (let x = 2; x < map.width - 14 && !road; x++) {
    let ok = true;
    for (let k = 0; k < 12 && ok; k++) ok = ROAD.has(at(x + k, y)) && ROAD.has(at(x + k, y - 1)) && ROAD.has(at(x + k, y + 1)) && main(x + k, y);
    if (ok) road = { x, y };
  }
  assert.ok(road, 'прямая дорога');
  let shore = null;
  for (let y = 2; y < map.height - 2 && !shore; y++) for (let x = 2; x < map.width - 8 && !shore; x++) {
    if (!G.BIOMES[at(x, y)].walkable || !main(x, y)) continue;
    let ok = true;
    for (let k = 1; k <= 5 && ok; k++) ok = at(x + k, y) === G.B.WATER;
    if (ok) shore = { x, y };
  }
  assert.ok(shore, 'берег');
  // открытое море: глубина 5 (дальше 5 клеток от суши)
  let deep = null;
  for (let y = 2; y < map.height - 2 && !deep; y++) for (let x = 2; x < map.width - 8 && !deep; x++) if (V.depthAt(map, x + 0.5, y + 0.5) === 5) deep = { x, y };
  assert.ok(deep, 'есть открытое море глубины 5');
  // мель: вода глубины 1
  let shallow = null;
  for (let y = 2; y < map.height - 2 && !shallow; y++) for (let x = 2; x < map.width - 2 && !shallow; x++) if (V.depthAt(map, x + 0.5, y + 0.5) === 1 && main(x, y) === false) shallow = { x, y };
  assert.ok(shallow, 'есть мель');

  const A = await joinWorld(b, admin, w.id);
  const aId = A.welcome.you;
  const tp = async (body) => { const r = await api(b, 'POST', '/api/admin/teleport', body, admin.token); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  const spawnV = async (body) => { const r = await api(b, 'POST', '/api/admin/vehicles/spawn', body, admin.token); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.vehicle; };
  const give = (item, count) => api(b, 'POST', '/api/admin/items/give', { username: 'admin', item, count }, admin.token);
  const board = async (v) => { A.send({ t: 'veh-enter', id: v.id }); const m = await A.next('veh-seat', 3000); assert.equal(m.id, v.id); return m; };
  const leave = async () => { A.send({ t: 'veh-exit' }); await A.next((m) => m.t === 'veh-seat' && m.id === null, 3000); };
  const last = new Map(); // состояние машины при появлении (до первого veh-upd)
  const state = async (id) => { const m = A.messages.filter((x) => x.t === 'veh-upd' && x.v.id === id).pop(); return m ? m.v : last.get(id); };
  for (const it of [['ammo_torpedo', 6], ['ammo_missile', 4], ['ammo_rocket', 8], ['ammo_bomb', 2], ['ammo_30mm', 40]]) assert.equal((await give(...it)).status, 200);
  await api(b, 'POST', '/api/admin/god', { fly: true }, admin.token);

  // ---- подлодка: погружение и всплытие ----
  stage = 'подлодка: погружение';
  await tp({ x: deep.x + 0.5, y: deep.y + 0.5 });
  const sub = await spawnV({ def: 'submarine', x: deep.x + 0.5, y: deep.y + 0.5 });
  last.set(sub.id, sub);
  await board(sub);
  await api(b, 'POST', '/api/admin/god', { fly: false }, admin.token);
  for (let d = 1; d <= 4; d++) {
    A.send({ t: 'lvl-alt', d: -1 });
    const lv = await A.next((m) => m.t === 'lv' && m.alt === -d, 3000);
    assert.equal(lv.z, -d, 'слой шага 13: глубина ' + d);
  }
  A.send({ t: 'lvl-alt', d: -1 });
  assert.match((await A.next('lvl-reject', 3000)).message, /Предельная глубина −4/, 'настройка vehicleDiveMaxDepth=4');
  A.send({ t: 'veh-exit' });
  assert.match((await A.next('veh-reject', 3000)).message, /всплыв/i, 'под водой не выйти');
  // оружие под водой: пушка — нет, торпеда и ракета — да, из своих аппаратов
  stage = 'подлодка: оружие под водой';
  const subDef = V.get('submarine');
  A.send({ t: 'atk', slot: 'main', vw: 'cannon', x: deep.x + 4.5, y: deep.y + 0.5 });
  assert.match((await A.next('atk-reject', 3000)).message, /из-под воды/);
  const sv = await state(sub.id);
  A.send({ t: 'atk', slot: 'main', vw: 'torpedo', x: sv.x + 6, y: sv.y });
  const torp = await shotOf(A, (f) => f.f === 'torpedo');
  const tMount = V.armsOf(subDef).find((g) => g.id === 'torpedo').mounts.find((m) => m.id === torp.hp);
  assert.ok(tMount, 'торпеда из аппарата ' + torp.hp);
  assert.ok(near(torp, V.mountWorld(subDef, sv, tMount)), `торпеда из своего аппарата: ${JSON.stringify(torp)} ${JSON.stringify(V.mountWorld(subDef, sv, tMount))}`);
  assert.equal(torp.alt, -4);
  await sleep(150);
  A.send({ t: 'atk', slot: 'main', vw: 'missile', x: sv.x + 6, y: sv.y });
  const msl = await shotOf(A, (f) => f.f === 'missile');
  assert.ok(/^missile\d$/.test(msl.hp) && near(msl, V.mountWorld(subDef, sv, V.armsOf(subDef).find((g) => g.id === 'missile').mounts.find((m) => m.id === msl.hp))), 'ракета из шахты');
  // мель поднимает подлодку
  stage = 'подлодка: мель';
  await api(b, 'POST', '/api/admin/god', { fly: true }, admin.token);
  await tp({ x: shallow.x + 0.5, y: shallow.y + 0.5 });
  const up1 = await A.next((m) => m.t === 'lv' && m.alt === -1, 4000);
  assert.equal(up1.z, -1, 'на мели — не глубже дна');
  await tp({ x: deep.x + 0.5, y: deep.y + 0.5 });
  await api(b, 'POST', '/api/admin/god', { fly: false }, admin.token);
  A.send({ t: 'lvl-alt', d: 1 });
  await A.next((m) => m.t === 'lv' && m.alt === 0, 3000);
  A.send({ t: 'lvl-alt', d: 1 });
  assert.match((await A.next('lvl-reject', 3000)).message, /на поверхности/);
  await leave();

  // ---- вертолёт: до +10, пилоны по очереди, наведение ракеты, торпеда не над сушей ----
  stage = 'вертолёт';
  await tp({ x: road.x + 2.5, y: road.y + 0.5 });
  const heli = await spawnV({ def: 'helicopter', x: road.x + 2.5, y: road.y + 0.5 });
  await board(heli);
  const hDef = V.get('helicopter');
  let hv = await state(heli.id);
  A.send({ t: 'atk', slot: 'main', vw: 'rockets', x: hv.x + 8, y: hv.y });
  const r0 = await shotOf(A, (f) => f.f === 'rocket');
  await sleep(450);
  A.send({ t: 'atk', slot: 'main', vw: 'rockets', x: hv.x + 8, y: hv.y });
  const r1 = await shotOf(A, (f) => f.f === 'rocket' && f.id !== r0.id);
  assert.notEqual(r0.hp, r1.hp, 'залп — с левого и правого пилона по очереди');
  for (const r of [r0, r1]) {
    const m = V.armsOf(hDef).find((g) => g.id === 'rockets').mounts.find((x) => x.id === r.hp);
    assert.ok(near(r, V.mountWorld(hDef, hv, m)), `ракета с пилона ${r.hp}`);
    assert.ok(r.h > 0, 'высота пилона передаётся клиенту');
  }
  // пушки под крыльями
  A.send({ t: 'atk', slot: 'main', vw: 'cannon', x: hv.x + 8, y: hv.y });
  const sh = await shotOf(A, (f) => f.f === 'shell');
  assert.ok(near(sh, V.mountWorld(hDef, hv, V.armsOf(hDef).find((g) => g.id === 'cannon').mounts.find((x) => x.id === sh.hp))), 'снаряд из ствола пушки');
  // сектор носового пулемёта: назад нельзя
  A.send({ t: 'atk', slot: 'main', vw: 'mg', x: hv.x - 6, y: hv.y + 0.2 });
  assert.match((await A.next('atk-reject', 3000)).message, /вне сектора/);
  // торпеда над сушей — нельзя
  A.send({ t: 'atk', slot: 'main', vw: 'torpedo', x: hv.x + 6, y: hv.y });
  assert.match((await A.next('atk-reject', 3000)).message, /по воде/);
  // управляемая ракета: стартует по курсу, доворачивает к врагу сбоку
  stage = 'вертолёт: наведение';
  const sp = await api(b, 'POST', '/api/admin/spawn', { kind: 'enemy', id: 'zombie', at: 'point', x: Math.floor(hv.x) + 3.5, y: Math.floor(hv.y) + 5.5 }, admin.token);
  assert.equal(sp.status, 200, JSON.stringify(sp.data));
  const zid = sp.data.ids[0];
  await sleep(200);
  A.send({ t: 'atk', slot: 'main', vw: 'missile', tk: 'e', target: zid });
  const gm = await shotOf(A, (f) => f.f === 'missile');
  assert.ok(Math.abs(gm.a) < 0.3, 'ракета сходит с направляющей по курсу: ' + gm.a);
  const steer = await fxOf(A, (f) => f.k === 'steer' && f.id === gm.id);
  assert.ok(steer.a > gm.a + 0.1, 'ракета доворачивает к цели (на юг): ' + steer.a);
  await fxOf(A, (f) => (f.k === 'hit' && f.t === 'e' && f.id === zid) || (f.k === 'impact' && f.id === gm.id), 5000);
  // высота — прямо z: +1…+5 среди домов и деревьев, +6…+10 — свободное небо
  stage = 'вертолёт: высота';
  for (let d = 1; d <= 10; d++) { A.send({ t: 'lvl-alt', d: 1 }); const lv = await A.next((m) => m.t === 'lv' && m.alt === d, 3000); assert.equal(lv.z, d); }
  A.send({ t: 'lvl-alt', d: 1 });
  assert.match((await A.next('lvl-reject', 3000)).message, /Выше не подняться/);
  hv = await state(heli.id);
  A.send({ t: 'atk', slot: 'main', vw: 'rockets', x: hv.x + 8, y: hv.y });
  const ra = await shotOf(A, (f) => f.f === 'rocket');
  assert.equal(ra.alt, 10, 'выстрел с высоты');
  for (let d = 9; d >= 1; d--) { A.send({ t: 'lvl-alt', d: -1 }); await A.next((m) => m.t === 'lv' && m.alt === d, 3000); }
  // низкий полёт (+1…+5): лес/дом/скалы выше машины — удар, урон и отброс; выше препятствия — пролетает
  stage = 'вертолёт: низкий полёт';
  const Hs = require('../shared/houses');
  let ob = null;
  for (let y = 3; y < map.height - 3 && !ob; y++) for (let x = 3; x < map.width - 3 && !ob; x++) {
    const h = Hs.obstacleZ(map, x, y);
    if (h >= 1 && h <= 4 && Hs.obstacleZ(map, x - 1, y) === 0 && Hs.obstacleZ(map, x - 2, y) === 0) ob = { x, y, h };
  }
  assert.ok(ob, 'есть препятствие для низкого полёта');
  await tp({ x: ob.x - 1.5, y: ob.y + 0.5 });
  await sleep(250);
  const hp0 = (await state(heli.id)).hp;
  A.send({ t: 'dir', dx: 1, dy: 0 });
  const hitMsg = await A.next((m) => m.t === 'chat' && /задел/.test(m.m.text), 4000);
  A.send({ t: 'stop' });
  assert.match(hitMsg.m.text, /поднимитесь выше/);
  await sleep(250);
  const hv1 = await state(heli.id);
  assert.ok(hv1.hp < hp0, `урон о препятствие: ${hp0} → ${hv1.hp}`);
  assert.ok(Math.floor(hv1.x) < ob.x, 'машину отбросило — внутрь препятствия не влетела');
  for (let d = 2; d <= ob.h + 1; d++) { A.send({ t: 'lvl-alt', d: 1 }); await A.next((m) => m.t === 'lv' && m.alt === d, 3000); }
  A.send({ t: 'dir', dx: 1, dy: 0 });
  await sleep(700);
  A.send({ t: 'stop' });
  await sleep(250);
  const hv2 = await state(heli.id);
  assert.ok(Math.floor(hv2.x) > ob.x - 1, `выше препятствия (+${ob.h + 1}) — пролетает: x=${hv2.x}`);
  assert.equal(hv2.hp, hv1.hp, 'над препятствием — без урона');
  for (let d = ob.h; d >= 0; d--) { A.send({ t: 'lvl-alt', d: -1 }); await A.next((m) => m.t === 'lv' && m.alt === d, 3000).catch(() => null); }
  await leave();

  // ---- самолёт: бомба только в полёте, падает в точку ----
  stage = 'самолёт: бомба';
  const plane = await spawnV({ def: 'plane', x: road.x + 6.5, y: road.y + 0.5 });
  await tp({ x: road.x + 6.5, y: road.y + 0.5 });
  await board(plane);
  let pv = await state(plane.id);
  A.send({ t: 'atk', slot: 'main', vw: 'bomb', x: pv.x + 3, y: pv.y });
  assert.match((await A.next('atk-reject', 3000)).message, /в полёте/);
  A.send({ t: 'lvl-alt', d: 1 });
  await A.next((m) => m.t === 'lv' && m.alt === 1, 3000);
  pv = await state(plane.id);
  A.send({ t: 'atk', slot: 'main', vw: 'bomb', x: pv.x + 3, y: pv.y });
  const bomb = await shotOf(A, (f) => f.f === 'bomb');
  const bm = V.mountWorld(V.get('plane'), pv, V.armsOf(V.get('plane')).find((g) => g.id === 'bomb').mounts.find((x) => x.id === bomb.hp));
  assert.ok(near(bomb, bm), 'бомба с подвески');
  assert.ok(Math.abs(bomb.r - Math.hypot(pv.x + 3 - bm.x, pv.y - bm.y)) < 0.05, 'бомба падает в точку прицела: ' + bomb.r);
  await fxOf(A, (f) => f.k === 'boom' && Math.hypot(f.x - pv.x - 3, f.y - pv.y) < 0.2, 4000);
  A.send({ t: 'lvl-alt', d: -1 });
  await A.next((m) => m.t === 'lv' && m.alt === 0, 3000);
  await leave();

  // ---- лодка: торпеда идёт по воде и рвётся у берега ----
  stage = 'лодка: торпеда у берега';
  await api(b, 'POST', '/api/admin/god', { fly: true }, admin.token);
  const boat = await spawnV({ def: 'boat', x: shore.x + 5.5, y: shore.y + 0.5 });
  await tp({ x: boat.x, y: boat.y });
  await board(boat);
  await api(b, 'POST', '/api/admin/god', { fly: false }, admin.token);
  A.send({ t: 'dir', dx: -1, dy: 0 }); // носом к берегу (на запад)
  await sleep(120);
  A.send({ t: 'stop' });
  await sleep(400);
  const bv = await state(boat.id);
  assert.ok(Math.abs(Math.abs(bv.facingAngle) - Math.PI) < 0.3, 'лодка смотрит на запад: ' + bv.facingAngle);
  A.send({ t: 'atk', slot: 'main', vw: 'torpedo', x: shore.x - 6, y: bv.y });
  const tf = await shotOf(A, (f) => f.f === 'torpedo');
  const imp = await fxOf(A, (f) => f.k === 'impact' && f.id === tf.id, 5000);
  assert.ok(imp.x >= shore.x + 1 - 0.35 && imp.x < bv.x, `торпеда остановилась у берега: ${imp.x} (берег ${shore.x + 1})`);
  assert.ok(G.BIOMES[G.tileAt(map, Math.floor(imp.x + 0.2), Math.floor(imp.y))].swim, 'точка взрыва — на воде');

  // ---- спутник доплывает до лодки (плавают все, кроме летунов) ----
  stage = 'спутник плывёт к лодке';
  const r = await api(b, 'POST', '/api/admin/companions/spawn', { username: 'admin', def: 'bear_mutant', level: 5 }, admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await sleep(400);
  A.send({ t: 'comp', a: 'order', id: 'all', order: 'board' });
  const withComp = await A.next((m) => m.t === 'veh-upd' && m.v.id === boat.id && m.v.companions.length > 0, 12000).catch(() => null);
  assert.ok(withComp, 'спутник доплыл до лодки и сел: ' + JSON.stringify(A.messages.filter((m) => m.t === 'comp-reject' || m.t === 'chat').slice(-3)));
  await leave();
});
