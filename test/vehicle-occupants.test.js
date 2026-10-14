'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const Vehicles = require('../shared/vehicles');

test('every vehicle hides local and remote occupants until they exit', async () => {
  globalThis.window = { Vehicles };
  globalThis.document = { querySelector: () => null };
  const ui = await import(pathToFileURL(path.join(__dirname, '../client/js/game/vehicles-ui.js')).href);
  const hero = { x: 10, y: 10 }, other = { x: 10, y: 10 };
  ui.vehAttach({ you: 'me', hero: () => hero, others: () => new Map([['other', other]]), map: () => ({}) });
  for (const def of Vehicles.LIST) {
    const v = { id: 'v', def: def.id, x: 10, y: 10, seats: ['me', 'other'] };
    ui.vehOnWelcome({ vehicles: [v] });
    ui.vehOnMessage({ t: 'veh-seat', id: v.id, seat: 0, def: def.id, v });
    ui.vehScene({});
    assert.equal(hero.vehicleHidden, true, `${def.id}: local occupant`);
    assert.equal(other.vehicleHidden, true, `${def.id}: remote occupant`);
    assert.equal(hero.ride, null);
    assert.equal(other.ride, null);
    ui.vehOnMessage({ t: 'veh-seat', id: null });
    ui.vehOnMessage({ t: 'veh-upd', v: { ...v, seats: [] } });
    ui.vehScene({});
    assert.equal(hero.vehicleHidden, false, `${def.id}: local exit`);
    assert.equal(other.vehicleHidden, false, `${def.id}: remote exit`);
  }
});

test('companions disappear from the scene inside vehicles and reappear on exit', async () => {
  globalThis.window = { Items: { setEffects: () => ({}) }, Enemies: { get: () => ({ look: { size: 1 } }) } };
  globalThis.document = { querySelector: () => null };
  const ui = await import(pathToFileURL(path.join(__dirname, '../client/js/game/companions-ui.js')).href);
  ui.compAttach({ you: 'me', map: {}, character: () => ({}) });
  ui.compOnWelcome({ comps: [{ id: 'comp', owner: 'me', def: 'human', x: 10, y: 10, hp: 100 }] });
  for (const def of Vehicles.LIST) {
    ui.compOnState([['comp', 10, 10, 100, 8]]);
    assert.equal(ui.compScene({}, null, performance.now()).enemies.length, 0, `${def.id}: boarded`);
    ui.compOnState([['comp', 10, 10, 100, 0]]);
    assert.equal(ui.compScene({}, null, performance.now()).enemies.length, 1, `${def.id}: exited`);
  }
  ui.compDetach();
});
