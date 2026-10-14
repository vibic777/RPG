'use strict';
// Шаг 14 по WebSocket: посадка и места, вождение (сервер двигает машину), седоки едут вместе, топливо и заправка,
// замок хозяина, таран, броня закрытой машины, бортовое оружие стрелка, ремонт обломков, лодка по воде,
// подлодка на подводный уровень, вертолёт на воздушный уровень, сохранение техники, панель ГМ.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');
const G = require('../shared/worldgen');
const L = require('../shared/levels');
const V = require('../shared/vehicles');

const SEED = 'vehicles-ws-1';
const params = (o = {}) => ({ name: 'Техника', seed: SEED, size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false, ...o });
const set = (o) => Object.entries({
  netDelta: false /* полные списки state в каждом тике: тест читает позиции из любого сообщения */, survivalFoodPerMin: 0, survivalWaterPerMin: 0, survivalRestPerMin: 0, chatRateCount: 200, stunChance: 0, depotsPer256: 0, respawnSec: 0, ...o,
}).flatMap(([k, v]) => ['--set', `game.${k}=${v}`]);
const ROAD = new Set([G.B.CITY, G.B.WASTE, G.B.SETTLEMENT]);

// Свежая позиция героя из состояния
async function posOf(c, id) {
  const since = Date.now();
  const m = await c.next((x) => x.t === 'state' && x.time >= since, 3000);
  return m.players.find((p) => p.id === id);
}
async function enemiesOf(c) {
  const since = Date.now();
  return (await c.next((x) => x.t === 'state' && x.time >= since, 3000)).e;
}
const vehUpd = (c, id, pred = () => true, what = '') => c.next((m) => m.t === 'veh-upd' && m.v.id === id && pred(m.v), 4000).then((m) => m.v).catch((e) => { throw new Error(`veh-upd ${what}: ${JSON.stringify(c.messages.filter((m) => m.t === 'veh-upd' || m.t === 'veh-reject' || m.t === 'chat').slice(-4))}`); });
const reject = (c, re) => c.next((m) => m.t === 'veh-reject', 4000).catch(() => { throw new Error('нет отказа ' + re); }).then((m) => { assert.match(m.message, re); return m; });

test('WS транспорт: места, вождение, топливо, замок, таран, броня, оружие, ремонт, лодка, подлодка, вертолёт, сохранение, ГМ', async (t) => {
  let stage = 'начало';
  process.on('exit', (code) => { if (code) console.error('этап:', stage); });
  const s = await startServer(set({}));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const bob = await newPlayer(b, 'bob', 'Боб');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  G.configure({ depotsPer256: 0 });
  L.configure({ depotsPer256: 0 });
  const map = G.generate({ ...w }); // как клиент: по записи мира (форма карты, водоёмы)
  assert.equal(G.mapHash(map), w.mapHash);
  const at = (x, y) => G.tileAt(map, x, y);
  const main = (x, y) => map.region[y * map.width + x] === map.mainRegion;
  // прямая дорога из 12 клеток
  let road = null;
  for (let y = 2; y < map.height - 2 && !road; y++) for (let x = 2; x < map.width - 14 && !road; x++) {
    let ok = true;
    for (let k = 0; k < 12 && ok; k++) ok = ROAD.has(at(x + k, y)) && ROAD.has(at(x + k, y - 1)) && ROAD.has(at(x + k, y + 1)) && main(x + k, y);
    if (ok) road = { x, y };
  }
  assert.ok(road, 'в мире есть прямая дорога');
  // берег: суша, к востоку 5 клеток воды
  let shore = null;
  for (let y = 2; y < map.height - 2 && !shore; y++) for (let x = 2; x < map.width - 8 && !shore; x++) {
    if (!G.BIOMES[at(x, y)].walkable || !main(x, y)) continue;
    let ok = true;
    for (let k = 1; k <= 5 && ok; k++) ok = at(x + k, y) === G.B.WATER;
    if (ok) shore = { x, y };
  }
  assert.ok(shore, 'есть берег');
  const sea = L.entrances(map).find((e) => e.type === 'underwater');
  assert.ok(sea, 'есть место погружения');

  const A = await joinWorld(b, admin, w.id);
  assert.ok(Array.isArray(A.welcome.vehicles) && A.welcome.vehicles.length >= 8, 'брошенная техника в приветствии');
  assert.deepEqual(A.welcome.vehicles.map((v) => v.id).sort(), V.worldSpawns(map).map((v) => v.id).sort());
  const code = (await api(b, 'POST', `/api/worlds/${w.id}/share`, { open: true, invite: 'new' }, admin.token)).data.world.inviteCode;
  assert.equal((await api(b, 'POST', '/api/worlds/join', { code }, bob.token)).status, 200);
  const Bc = await joinWorld(b, bob, w.id);
  const tp = async (body) => { const r = await api(b, 'POST', '/api/admin/teleport', body, admin.token); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  const spawnV = async (body) => { const r = await api(b, 'POST', '/api/admin/vehicles/spawn', body, admin.token); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.vehicle; };
  const give = (username, item, count = 1) => api(b, 'POST', '/api/admin/items/give', { username, item, count }, admin.token);
  const aId = A.welcome.you, bId = Bc.welcome.you;

  // ---- легковушка: вождение, седок, топливо ----
  stage = 'легковушка: вождение, седок, топливо';
  await tp({ x: road.x + 0.5, y: road.y + 0.5 });
  const car = await spawnV({ def: 'car', own: true });
  assert.equal(car.owner, aId);
  await tp({ username: 'bob', x: road.x + 0.5, y: road.y + 1.5 });
  A.send({ t: 'veh-enter', id: car.id });
  const seat = await A.next('veh-seat', 3000);
  assert.equal(seat.seat, 0);
  Bc.send({ t: 'veh-enter', id: car.id });
  assert.equal((await Bc.next('veh-seat', 3000)).seat, 1, 'Боб — пассажир');
  const p0 = await posOf(A, aId);
  A.send({ t: 'dir', dx: 1, dy: 0 });
  await sleep(600);
  A.send({ t: 'stop' });
  await sleep(150);
  const p1 = await posOf(A, aId);
  assert.ok(p1.x - p0.x > 3.2, `машина быстрее пешехода: ${p1.x - p0.x}`);
  assert.equal(p1.vh, car.id);
  const pb = (await posOf(Bc, bId));
  assert.ok(Math.abs(pb.x - p1.x) < 0.5 && Math.abs(pb.y - p1.y) < 0.5, 'седок едет вместе');
  const moved = await vehUpd(A, car.id, (v) => v.fuel < V.get('car').fuel.cap, 'fuel');
  assert.ok(moved.fuel < moved.cap, 'топливо тратится ' + JSON.stringify(moved));
  // пассажир не рулит
  Bc.send({ t: 'dir', dx: -1, dy: 0 });
  await sleep(300);
  const pb2 = await posOf(Bc, bId);
  assert.ok(Math.abs(pb2.x - p1.x) < 0.5, 'пассажир не двигает машину');
  // заправка
  await give('admin', 'fuel_gas', 1);
  A.send({ t: 'veh-refuel' });
  const full = await vehUpd(A, car.id, (v) => v.fuel >= v.cap, 'refuel');
  assert.ok(full.fuel >= full.cap - 1);
  // замок: Боб выходит и не может сесть снова
  A.send({ t: 'veh-lock' });
  await vehUpd(A, car.id, (v) => v.locked === 1, 'lock');
  Bc.send({ t: 'veh-exit' });
  assert.equal((await Bc.next('veh-seat', 3000)).id, null);
  Bc.send({ t: 'veh-enter', id: car.id });
  await reject(Bc, /заперта/);
  Bc.send({ t: 'veh-lock', id: car.id });
  await reject(Bc, /хозяин/);

  // ---- таран: враг на дороге ----
  stage = 'таран: враг на дороге';
  await tp({ x: road.x + 0.5, y: road.y + 0.5 });
  await sleep(200);
  let rammed = false;
  for (let tryN = 0; tryN < 4 && !rammed; tryN++) {
    const pa = await posOf(A, aId);
    const sp = await api(b, 'POST', '/api/admin/spawn', { kind: 'enemy', id: 'zombie', at: 'point', x: Math.floor(pa.x) + 5.5, y: Math.floor(pa.y) + 0.5 }, admin.token);
    assert.equal(sp.status, 200, JSON.stringify(sp.data));
    A.send({ t: 'dir', dx: 1, dy: 0 });
    await sleep(900);
    A.send({ t: 'stop' });
    const es = await enemiesOf(A);
    rammed = es.length === 0 || es.some((e) => e[3] < 100);
    if (!rammed) { await tp({ x: road.x + 0.5, y: road.y + 0.5 }); }
  }
  assert.ok(rammed, 'таран ранит врага');

  // ---- броня: зомби бьёт по машине, а не по Алисе ----
  stage = 'броня: зомби бьёт по машине, а не по Алисе';
  const hpBefore = (await vehUpd(A, car.id)).hp;
  const meBefore = (await api(b, 'GET', `/api/characters/${admin.characterId}`, undefined, admin.token)).data.character.vitals.hp;
  await api(b, 'POST', '/api/admin/spawn', { kind: 'enemy', id: 'zombie', count: 3, at: 'me', attack: true }, admin.token);
  const hit = await vehUpd(A, car.id, (v) => v.hp < hpBefore).catch(() => null);
  if (hit) {
    const meAfter = (await posOf(A, aId));
    assert.ok(meAfter, 'Алиса в мире');
    const ch = (await api(b, 'GET', `/api/characters/${admin.characterId}`, undefined, admin.token)).data.character;
    assert.ok(ch.vitals.hp >= meBefore - 0.01, 'удары принимает машина');
  }

  // ---- пикап: стрелок у пулемёта ----
  stage = 'пикап: стрелок у пулемёта';
  A.send({ t: 'veh-exit' });
  await A.next((m) => m.t === 'veh-seat' && m.id === null, 3000);
  const truck = await spawnV({ def: 'truck' });
  A.send({ t: 'veh-enter', id: truck.id });
  assert.equal((await A.next('veh-seat', 3000)).seat, 0);
  assert.equal((await vehUpd(A, truck.id, (v) => v.owner === aId)).owner, aId, 'первый водитель ничейной машины — хозяин');
  await tp({ username: 'bob', to: 'admin' });
  Bc.send({ t: 'veh-enter', id: truck.id });
  assert.equal((await Bc.next('veh-seat', 3000)).seat, 1, 'Боб — стрелок');
  const pa = await posOf(A, aId);
  Bc.send({ t: 'atk', slot: 'main', x: pa.x + 3, y: pa.y });
  assert.match((await Bc.next('atk-reject', 3000)).message, /боеприпас/i);
  await give('bob', require('../shared/items').get(V.get('truck').weapon.item).weapon.ammo, 30); // патроны бортового пулемёта пикапа (сейчас «Косилка», 5,56)
  await sleep(300);
  Bc.drain();
  Bc.send({ t: 'atk', slot: 'main', x: pa.x + 3, y: pa.y });
  const shot = await Bc.next((m) => (m.t === 'fx' && m.ev.some((f) => f.k === 'shot')) || m.t === 'atk-reject', 3000);
  assert.equal(shot.t, 'fx', JSON.stringify(shot));
  // водитель тоже управляет бортовым оружием: общий откат установки, свои патроны
  A.send({ t: 'atk', slot: 'main', x: pa.x + 3, y: pa.y });
  assert.match((await A.next('atk-reject', 3000)).message, /Слишком быстро|боеприпас/i);
  await give('admin', require('../shared/items').get(V.get('truck').weapon.item).weapon.ammo, 10);
  await sleep(1200);
  A.drain();
  A.send({ t: 'atk', slot: 'main', x: pa.x + 3, y: pa.y });
  const drv = await A.next((m) => (m.t === 'fx' && m.ev.some((f) => f.k === 'shot')) || m.t === 'atk-reject', 3000);
  assert.equal(drv.t, 'fx', JSON.stringify(drv));

  // ---- багажник пикапа ----
  stage = 'багажник';
  await give('admin', 'wood', 3);
  const cells = (await api(b, 'GET', `/api/characters/${admin.characterId}`, undefined, admin.token)).data.character.inventory.cells;
  const wi = cells.findIndex((x) => x && x.id === 'wood');
  A.send({ t: 'veh-cargo', id: truck.id, op: 'put', i: wi });
  const loaded = await vehUpd(A, truck.id, (v) => v.cargo.some((x) => x && x.id === 'wood'), 'cargo put');
  assert.equal(loaded.cargo.find((x) => x && x.id === 'wood').n, 3);
  A.send({ t: 'veh-cargo', id: truck.id, op: 'take', i: 0 });
  await vehUpd(A, truck.id, (v) => !v.cargo.some(Boolean), 'cargo take');
  const cells2 = (await api(b, 'GET', `/api/characters/${admin.characterId}`, undefined, admin.token)).data.character.inventory.cells;
  assert.ok(cells2.some((x) => x && x.id === 'wood' && x.n === 3), 'дерево вернулось в сумку');

  // ---- набор: велосипед ----
  stage = 'набор';
  A.send({ t: 'veh-exit' });
  await A.next((m) => m.t === 'veh-seat' && m.id === null, 3000);
  await give('admin', 'veh_kit_bicycle', 1);
  const cells3 = (await api(b, 'GET', `/api/characters/${admin.characterId}`, undefined, admin.token)).data.character.inventory.cells;
  A.send({ t: 'inv', a: { type: 'use', from: { c: 'cell', i: cells3.findIndex((x) => x && x.id === 'veh_kit_bicycle') } } });
  const bike = (await A.next((m) => m.t === 'veh-upd' && m.v.def === 'bicycle' && m.v.owner === aId, 4000)).v;
  assert.equal(bike.wreck, 0);

  // ---- обломок: ремонт автозапчастями ----
  stage = 'обломок: ремонт автозапчастями';
  const wreck = await spawnV({ def: 'car', wreck: true });
  A.send({ t: 'veh-enter', id: wreck.id });
  assert.equal((await A.next('veh-seat', 3000)).id, wreck.id, 'в обломок можно сесть и чинить его изнутри');
  A.send({ t: 'veh-repair', id: wreck.id });
  await reject(A, /Автозапчасти/);
  await give('admin', 'veh_parts', 5);
  A.send({ t: 'veh-repair', id: wreck.id });
  const fixed = await vehUpd(A, wreck.id, (v) => v.hp > wreck.hp);
  assert.ok(fixed.hp <= fixed.maxHp + 1, 'запчасти ремонтируют технику вплоть до полного запаса');
  assert.equal(fixed.wreck, 0);
  A.send({ t: 'veh-exit' });
  await A.next((m) => m.t === 'veh-seat' && m.id === null, 3000);

  // ---- лодка: по воде ----
  stage = 'лодка: по воде';
  await tp({ x: shore.x + 0.5, y: shore.y + 0.5 });
  const boat = await spawnV({ def: 'boat' });
  assert.equal(G.tileAt(map, Math.floor(boat.x), Math.floor(boat.y)), G.B.WATER, 'лодка на воде');
  A.send({ t: 'veh-enter', id: boat.id });
  assert.equal((await A.next('veh-seat', 3000)).id, boat.id);
  const deepBoatSpot=Array.from({length:5},(_,i)=>({x:shore.x+i+1.5,y:shore.y+.5,facingAngle:0})).find(p=>V.canPlaceBody(map,V.get('boat'),p));
  assert.ok(deepBoatSpot,'есть место для всего корпуса катера');
  await tp({ x: deepBoatSpot.x, y: deepBoatSpot.y });
  await sleep(150);
  A.send({ t: 'dir', dx: -1, dy: 0 });
  await sleep(700);
  A.send({ t: 'stop' });
  const pBoat = await posOf(A, aId);
  assert.equal(G.tileAt(map, Math.floor(pBoat.x), Math.floor(pBoat.y)), G.B.WATER, 'лодка не выезжает на сушу');
  A.send({ t: 'veh-exit' });
  await A.next((m) => m.t === 'veh-seat' && m.id === null, 3000);

  // ---- подлодка: вниз на подводный уровень, воздух не расходуется ----
  stage = 'подлодка: вниз на подводный уровень, воздух не расходуется';
  await tp({ x: sea.x + 0.5, y: sea.y + 0.5 }).catch(async () => { await api(b, 'POST', '/api/admin/god', { fly: true }, admin.token); return tp({ x: sea.x + 0.5, y: sea.y + 0.5 }); });
  const sub = await spawnV({ def: 'submarine' });
  A.send({ t: 'veh-enter', id: sub.id });
  assert.equal((await A.next('veh-seat', 3000)).id, sub.id);
  await tp({ x: sea.x + 0.5, y: sea.y + 0.5 });
  await sleep(150);
  A.send({ t: 'lvl-go' });
  const wl = await A.next('welcome', 5000);
  assert.ok(wl.level && wl.level.underwater, 'подлодка нырнула');
  assert.ok(wl.vehicles.some((v) => v.id === sub.id), 'подлодка на уровне');
  assert.equal((await A.next((m) => m.t === 'veh-seat' && m.id, 3000)).id, sub.id);
  await sleep(1500);
  const lv = await A.next((m) => m.t === 'lv' && m.u === 1, 3000);
  assert.equal(lv.b, lv.bm, 'в подлодке воздух не кончается');
  A.send({ t: 'lvl-go' }); // обратно на поверхность (прибыли к выходу)
  const up = await A.next('welcome', 5000);
  assert.equal(up.level, null);
  assert.equal((await A.next((m) => m.t === 'veh-seat' && m.id, 3000)).id, sub.id);
  const pSub = await posOf(A, aId);
  assert.ok(G.BIOMES[G.tileAt(map, Math.floor(pSub.x), Math.floor(pSub.y))].swim, 'всплыли на воде');
  A.send({ t: 'veh-exit' });
  await A.next((m) => m.t === 'veh-seat' && m.id === null, 3000);

  // ---- вертолёт: воздушный уровень ----
  stage = 'вертолёт: воздушный уровень';
  await tp({ x: road.x + 2.5, y: road.y + 0.5 });
  const heli = await spawnV({ def: 'helicopter' });
  A.send({ t: 'veh-enter', id: heli.id });
  await A.next('veh-seat', 3000);
  A.send({ t: 'lvl-alt', d: 1 });
  const air = await A.next((m) => m.t === 'lv' && m.alt === 1, 3000);
  assert.equal(air.z, 1, 'высота +1 — низкий полёт среди домов и деревьев');
  A.send({ t: 'veh-exit' });
  await reject(A, /посадите/);
  A.send({ t: 'lvl-alt', d: -1 });
  await A.next((m) => m.t === 'lv' && m.alt === 0, 3000);
  A.send({ t: 'veh-exit' });
  await A.next((m) => m.t === 'veh-seat' && m.id === null, 3000);

  // ---- ГМ: список, заправить, починить, убрать ----
  stage = 'ГМ: список, заправить, починить, убрать';
  const list = (await api(b, 'POST', '/api/admin/vehicles/list', { worldId: w.id }, admin.token)).data;
  assert.ok(list.vehicles.some((v) => v.id === heli.id) && list.catalogue.length === V.LIST.length);
  assert.equal((await api(b, 'POST', '/api/admin/vehicles/act', { id: wreck.id, op: 'repair' }, admin.token)).data.vehicle.hp, V.get('car').hp);
  assert.equal((await api(b, 'POST', '/api/admin/vehicles/act', { id: heli.id, op: 'remove' }, admin.token)).status, 200);
  await A.next((m) => m.t === 'veh-remove' && m.id === heli.id, 3000);
  assert.equal((await api(b, 'POST', '/api/admin/vehicles/spawn', { def: 'nonsense' }, admin.token)).status, 404);
  assert.equal((await api(b, 'POST', '/api/admin/vehicles/spawn', { def: 'car' }, bob.token)).status, 403);

  // ---- сохранение: все ушли — техника в файле; снова вошли — на месте ----
  stage = 'сохранение: все ушли — техника в файле; снова вошли — на месте';
  const savedCar = (await vehUpd(A, car.id).catch(() => null)) || car;
  await A.close(); await Bc.close();
  await sleep(500);
  const file = path.join(s.dataDir, 'worlds', `${w.id}.vehicles.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rec = (data.data || data).list.find((v) => v.id === car.id);
  assert.ok(rec && rec.owner === aId && rec.locked, 'хозяин и замок сохранены');
  assert.ok(!(data.data || data).list.some((v) => v.id === heli.id), 'убранная техника не сохраняется');
  const A2 = await joinWorld(b, admin, w.id);
  const back = A2.welcome.vehicles.find((v) => v.id === car.id);
  assert.ok(back && Math.abs(back.x - rec.x) < 0.01 && back.fuel === rec.fuel && back.locked === 1, 'после перезахода — из файла');
  assert.ok(savedCar);
  await A2.close();
});
