'use strict';
// Приказы спутникам по WebSocket (shared/companions.js ORDERS): «ко мне», «войти в здание» (ждать в доме),
// возвращение в команду, когда хозяин входит туда же, «выйти» из дома (ждать у входа) и из машины.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');
const G = require('../shared/worldgen');
const L = require('../shared/levels');
const Hs = require('../shared/houses');
const C = require('../shared/companions');

const params = (o = {}) => ({ name: 'Приказы', seed: 'orders-1', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false, ...o });
const set = (o) => Object.entries({
  netDelta: false, survivalFoodPerMin: 0, survivalWaterPerMin: 0, survivalRestPerMin: 0, chatRateCount: 200, stunChance: 0, depotsPer256: 0,
  houseEnemyChance: 0, houseNeutralChance: 0, houseResidentChance: 0, ...o,
}).flatMap(([k, v]) => ['--set', `game.${k}=${v}`]);

test('приказы спутникам: новые приказы описаны и имеют клавиши, не занятые V / Shift+V', () => {
  for (const k of ['come', 'enter', 'exit']) { assert.ok(C.ORDERS[k], k); assert.ok(C.ORDER_KEYS[k], 'клавиша ' + k); }
  assert.ok(!Object.values(C.ORDER_KEYS).some((k) => /v/i.test(k)), 'V и Shift+V остаются за приказом по кругу и рацией');
  const rec = C.sanitize({ id: 'c1', def: 'wolf_mutant', level: 3, out: true, order: 'enter', wait: { key: 'h12.0', x: 3.5, y: 4.5, name: 'Дом: 1-й этаж' } });
  assert.equal(rec.order, 'enter');
  assert.deepEqual(rec.wait, { key: 'h12.0', x: 3.5, y: 4.5, name: 'Дом: 1-й этаж' }, 'ожидание переживает сохранение');
});

test('WS приказы спутникам: ко мне, войти в здание, выйти из дома и из машины', async (t) => {
  const s = await startServer(set({}));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  G.configure({ depotsPer256: 0 });
  Hs.configure({ houseEnemyChance: 0, houseNeutralChance: 0, houseResidentChance: 0 });
  const map = G.generate({ ...w });
  assert.equal(G.mapHash(map), w.mapHash);
  const sp = map.spawn;
  const house = Hs.list(map).slice().sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y))[0];
  assert.ok(house, 'в мире есть дома');
  const A = await joinWorld(b, admin, w.id);
  const tp = async (body) => { const r = await api(b, 'POST', '/api/admin/teleport', body, admin.token); assert.equal(r.status, 200, JSON.stringify(r.data)); };
  const order = (o) => A.send({ t: 'comp', a: 'order', id: 'all', order: o });
  const door = { x: house.door.x + 0.5, y: house.door.y + 0.5 };
  await tp(door);
  await A.next('teleported');
  const r = await api(b, 'POST', '/api/admin/companions/spawn', { username: 'admin', def: 'wolf_mutant', level: 5 }, admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cid = r.data.companion.id;
  await A.next((m) => m.t === 'comp-add' && m.comp.id === cid, 5000);
  const posOf = (m) => { const e = (m.cp || []).find((x) => x[0] === cid); return e ? { x: e[1], y: e[2], flags: e[4] } : null; };
  const hero = (m) => m.players.find((p) => p.id === A.welcome.you);
  let stage = '';
  t.after(() => { if (stage) console.log('этап: ' + stage); });

  // ---- «ко мне»: охраняет место, хозяин отошёл — по приказу прибегает ----
  stage = 'ко мне';
  order('guard');
  await sleep(300);
  let far = null;
  for (let r2 = 4; r2 <= 7 && !far; r2++) for (const [dx, dy] of [[r2, 0], [-r2, 0], [0, r2], [0, -r2]]) {
    const x = house.door.x + dx, y = house.door.y + dy;
    if (G.isWalkable(map, x, y)) { far = { x: x + 0.5, y: y + 0.5 }; break; }
  }
  assert.ok(far, 'рядом с домом есть свободная клетка');
  await tp(far);
  await A.next('teleported');
  await sleep(500);
  order('come');
  const near = await A.next((m) => m.t === 'state' && posOf(m) && hero(m) && Math.hypot(posOf(m).x - hero(m).x, posOf(m).y - hero(m).y) < 2.2, 10000);
  assert.ok(near, 'спутник прибежал');
  assert.ok(A.messages.some((m) => m.t === 'comp-list' && m.list.some((c) => c.id === cid && c.order === 'follow')), 'после «ко мне» — снова «следовать»');

  // ---- «войти в здание»: идёт к двери ближайшего дома и исчезает внутри, ждёт там ----
  stage = 'войти в здание';
  await tp(door);
  await A.next('teleported');
  await sleep(300);
  order('enter');
  await A.next((m) => m.t === 'comp-remove' && m.id === cid, 20000);
  const waiting = await A.next((m) => m.t === 'comp-list' && m.list.some((c) => c.id === cid && c.wait), 5000);
  assert.match(waiting.list.find((c) => c.id === cid).wait, new RegExp(house.name), 'ждёт в доме');

  // ---- хозяин входит в тот же дом — спутник снова в команде ----
  stage = 'хозяин входит в дом';
  A.drain();
  A.send({ t: 'lvl-go' });
  const w1 = await Promise.race([A.next('welcome', 8000), A.next('lvl-reject', 8000).then((m) => { throw new Error('отказ: ' + m.message); })]);
  assert.equal(w1.level.key, Hs.keyOf(house, 0), 'вошли в дом через дверь (U)');
  assert.equal(w1.level.type, 'house');
  await A.next((m) => m.t === 'comp-add' && m.comp.id === cid, 5000);
  await A.next((m) => m.t === 'comp-list' && m.list.some((c) => c.id === cid && !c.wait && c.order === 'follow'), 5000);

  // ---- «выйти» из здания: спутник уходит к двери и ждёт снаружи ----
  stage = 'выйти из здания';
  order('exit');
  await A.next((m) => m.t === 'comp-remove' && m.id === cid, 20000);
  const outside = await A.next((m) => m.t === 'comp-list' && m.list.some((c) => c.id === cid && c.wait), 5000);
  assert.match(outside.list.find((c) => c.id === cid).wait, /у входа/);
  // хозяин выходит — спутник ждёт у двери и снова в команде
  const lv = L.level(map, Hs.keyOf(house, 0));
  const ex = lv.exits.find((e) => e.kind === 'door');
  await tp({ level: Hs.keyOf(house, 0), x: ex.x, y: ex.y });
  await A.next('welcome', 5000).catch(() => null);
  A.send({ t: 'lvl-go' });
  const w2 = await A.next((m) => m.t === 'welcome' && !m.level, 8000);
  assert.ok(Math.hypot(w2.players.find((p) => p.id === w2.you).x - door.x, w2.players.find((p) => p.id === w2.you).y - door.y) < 2, 'вышли к двери');
  await A.next((m) => m.t === 'comp-add' && m.comp.id === cid, 5000);

  // ---- «ко мне» из другого места: спутник в доме, хозяин на улице — сразу рядом ----
  stage = 'ко мне из дома';
  order('enter');
  await A.next((m) => m.t === 'comp-remove' && m.id === cid, 20000);
  order('come');
  await A.next((m) => m.t === 'comp-add' && m.comp.id === cid, 5000);

  // ---- «выйти» из машины ----
  stage = 'выйти из машины';
  const car = (await api(b, 'POST', '/api/admin/vehicles/spawn', { def: 'car', x: far.x, y: far.y }, admin.token));
  assert.equal(car.status, 200, JSON.stringify(car.data));
  await tp(far);
  await A.next('teleported');
  order('board');
  await A.next((m) => m.t === 'veh-upd' && m.v.id === car.data.vehicle.id && m.v.companions.includes(cid), 12000);
  order('exit');
  await A.next((m) => m.t === 'veh-upd' && m.v.id === car.data.vehicle.id && !m.v.companions.includes(cid), 5000);
  await A.next((m) => m.t === 'state' && posOf(m) && !(posOf(m).flags & 8), 5000);
  stage = '';
});
