'use strict';
const config = require('./config');
const realtime = require('./realtime');
const Spawner = require('./spawner');

function set(values) {
  const cfg = config.get().game;
  const respawn = values.enemyRespawnSec == null ? cfg.enemyRespawnSec : Number(values.enemyRespawnSec);
  const population = values.enemyPopulation == null ? cfg.enemyPopulation : Number(values.enemyPopulation);
  if (!Number.isInteger(respawn) || respawn < 0 || respawn > 65536) throw new Error('Таймер появления: целое число от 0 до 65536 секунд.');
  if (!Number.isInteger(population) || population < 0 || population > 250) throw new Error('Цель численности врагов: целое число от 0 до 250.');
  cfg.enemyRespawnSec = respawn;
  cfg.enemyPopulation = population;
  for (const room of realtime.rooms.values()) {
    const state = room.combat && room.combat.spawn;
    if (state) {
      state.populationTarget = Spawner.populationTarget(room.world, cfg);
      Spawner.updateRespawnTimers(state, Date.now(), respawn);
    }
    room.broadcast({ t: 'spawn-settings', enemyRespawnSec: respawn, enemyPopulation: population, populationTarget: state ? state.populationTarget : null });
  }
  return { enemyRespawnSec: respawn, enemyPopulation: population };
}

realtime.use({ welcome: () => ({ enemyRespawnSec: config.get().game.enemyRespawnSec, enemyPopulation: config.get().game.enemyPopulation }), handlers: { 'spawn-settings': (c, msg) => {
  try { set(msg); }
  catch (e) { realtime.send(c, { t: 'spawn-settings-error', message: e.message }); }
} } });

module.exports = { set };
