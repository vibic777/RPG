'use strict';
// Шаг 14: каталог техники, правила местности, движение по ним (shared/movement.js), топливо, таран, броня, ремонт,
// детерминированная брошенная техника в мире, предметы и рецепты транспорта.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../shared/vehicles');
const M = require('../shared/movement');
const G = require('../shared/worldgen');
const Items = require('../shared/items');
const Crafting = require('../shared/crafting');
const { B } = G;

test('каталог техники: поля, топливо-предметы, бортовое оружие, наборы и рецепты', () => {
  assert.deepEqual(V.validateCatalogue(Items), []);
  for (const id of ['bicycle', 'motorcycle', 'car', 'truck', 'apc', 'tank', 'boat', 'jetski', 'submarine', 'helicopter', 'plane']) assert.ok(V.get(id), id);
  for (const d of V.LIST) {
    assert.ok(d.name && d.desc && d.icon, d.id);
    if (d.fuel.type !== 'none') assert.ok(Items.get(d.fuel.type).rounds > 1, `${d.id}: топливо — заряды`);
  }
  assert.ok(V.get('submarine').sealed && V.get('submarine').terrain.depth);
  assert.ok(V.get('helicopter').vtol && !V.get('plane').vtol);
  assert.ok(V.get('truck').weapon && V.get('truck').gunner === 1);
  for (const it of Items.ITEMS.filter((x) => x.vehicle)) {
    assert.ok(V.get(it.vehicle), it.id);
    assert.ok(Crafting.get(it.id), `${it.id}: есть рецепт`);
  }
  assert.ok(Items.get('veh_parts') && Crafting.get('veh_parts'));
  assert.ok(Crafting.get('veh_kit_bicycle').start && Crafting.get('veh_kit_rowboat').start);
});

test('правила местности: суша, вода, дно, воздух; взлёт и посадка', () => {
  const car = V.get('car'), boat = V.get('boat'), sub = V.get('submarine'), plane = V.get('plane'), heli = V.get('helicopter'), apc = V.get('apc');
  assert.ok(V.canDrive(car, B.CITY) && V.canDrive(car, B.FOREST) && !V.canDrive(car, B.WATER) && !V.canDrive(car, B.MOUNTAIN));
  assert.ok(V.drive(car).speed(B.CITY) > V.drive(car).speed(B.FOREST), 'бездорожье медленнее');
  assert.ok(V.drive(V.get('tank')).speed(B.FOREST) > V.drive(car).speed(B.FOREST), 'танку бездорожье нипочём');
  assert.ok(V.canDrive(boat, B.WATER) && V.canDrive(boat, B.RIVER) && !V.canDrive(boat, B.CITY));
  assert.ok(V.canDrive(apc, B.WATER) && V.canDrive(apc, B.CITY), 'БТР плавает');
  assert.ok(V.canDrive(sub, B.SEABED) && V.canDrive(sub, B.WATER) && !V.canDrive(sub, B.FLOOR));
  assert.ok(!V.canDrive(plane, B.MOUNTAIN, 0) && V.canDrive(plane, B.MOUNTAIN, 2) && V.canDrive(plane, B.WATER, 1));
  assert.ok(!V.canDrive(plane, B.WATER, 0), 'на земле самолёт по воде не катится');
  assert.ok(V.canTakeOff(plane, B.CITY) && !V.canTakeOff(plane, B.FOREST));
  assert.ok(V.canTakeOff(heli, B.FOREST) && !V.canTakeOff(heli, B.WATER) && !V.canTakeOff(car, B.CITY));
});

test('движение по правилам машины: столкновение с водой и стенами, скорость', () => {
  const W = 12, H = 3, tiles = new Uint8Array(W * H).fill(B.CITY);
  for (let y = 0; y < H; y++) { tiles[y * W + 6] = B.WATER; tiles[y * W + 9] = B.MOUNTAIN; }
  const map = { width: W, height: H, tiles, settlements: [], lairs: [] };
  const car = V.get('car'), boat = V.get('boat');
  map.drive = V.drive(car);
  const p = M.moveWithCollision(map, { x: 5.5, y: 1.5 }, 1, 0);
  assert.equal(p.x, 5.5, 'машина не заезжает в воду');
  const mul = V.speedMul(car, { hp: car.hp }, M.settings.heroSpeed);
  assert.ok(Math.abs(M.speedAt(map, 2.5, 1.5, mul) - car.speed) < 1e-9, 'скорость машины по дороге');
  assert.ok(!M.validateStep(map, { x: 1.5, y: 1.5 }, { x: 1.5 + car.speed * 0.1, y: 1.5 }, 0.1, mul), 'сервер пропускает шаг машины');
  assert.ok(M.validateStep(map, { x: 1.5, y: 1.5 }, { x: 1.5 + car.speed * 0.1, y: 1.5 }, 0.1, 1), 'пешком так быстро нельзя');
  // The entire boat must fit inside a basin, not a one-cell water stripe.
  const roomy={width:40,height:40,tiles:new Uint8Array(1600).fill(B.CITY)};
  for(let y=10;y<30;y++)for(let x=10;x<30;x++)roomy.tiles[y*40+x]=B.WATER;
  roomy.drive = V.drive(boat);
  assert.ok(M.posWalkable(roomy, 20.5, 20.5) && !M.posWalkable(roomy, 5.5, 5.5), 'лодка — только по воде');
  roomy.drive = V.drive(V.get('helicopter'), 1);
  roomy.tiles[20*40+20]=B.MOUNTAIN;
  assert.ok(M.posWalkable(roomy, 20.5, 20.5), 'вертолёт в воздухе — над горами');
  map.drive = null;
  assert.ok(!M.posWalkable(map, 6.5, 1.5), 'без машины — как обычно');
  // разбитая машина медленнее
  assert.ok(V.speedMul(car, { hp: car.hp * 0.2 }, 4) < V.speedMul(car, { hp: car.hp }, 4));
});

test('топливо, таран, броня, ремонт, обломки', () => {
  const car = V.get('car'), bike = V.get('bicycle'), tank = V.get('tank');
  assert.equal(V.fuelFor(bike, 100), 0);
  assert.ok(Math.abs(V.fuelFor(car, 10) - car.fuel.perTile * 10) < 1e-9);
  assert.equal(V.ramDamage(car, 1), 0, 'медленно — не таран');
  assert.ok(V.ramDamage(car, car.speed) > 0 && V.ramDamage(tank, tank.speed) > V.ramDamage(car, car.speed));
  assert.equal(V.ramDamage(V.get('helicopter'), 12), 0);
  assert.ok(V.armorCut(tank, 20) < V.armorCut(car, 20) && V.armorCut(tank, 20) > 0);
  const v = { hp: car.hp * 0.1, wreck: true };
  assert.ok(!V.drivable(car, v));
  assert.equal(V.repairNeed(car, v, 50), 2, '10% → 50%: две запчасти по 20%');
  v.hp = car.hp * 0.3;
  assert.ok(V.drivable(car, v));
  assert.equal(V.repairNeed(car, { hp: car.hp }, 100), 0);
});

test('брошенная техника в мире: детерминированно по сиду, по местности', () => {
  const m1 = G.generate({ seed: 'veh-1', size: 'small', dragons: 0 });
  const m2 = G.generate({ seed: 'veh-1', size: 'small', dragons: 0 });
  const a = V.worldSpawns(m1), b = V.worldSpawns(m2);
  assert.ok(a.length >= 8, 'техника есть');
  assert.deepEqual(a, b, 'одинаково на сервере и клиенте');
  for (const s of a) {
    const def = V.get(s.def), t = G.tileAt(m1, Math.floor(s.x), Math.floor(s.y));
    assert.ok(V.canDrive(def, t), `${s.id} ${s.def} стоит на подходящей клетке`);
    assert.ok(V.canPlaceBody(m1,def,s),s.id+': entire hull fits terrain');
    assert.ok(s.hp > 0 && s.hp <= def.hp);
    if (s.wreck) assert.equal(s.fuel, 0);
  }
  assert.ok(a.some((s) => s.wreck), 'в основном обломки');
  assert.notDeepEqual(V.worldSpawns(G.generate({ seed: 'veh-2', size: 'small', dragons: 0 })), a);
});
