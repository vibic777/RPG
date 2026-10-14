'use strict';
const config = require('./config');
const realtime = require('./realtime');
const Difficulty = require('../shared/difficulty');
const {JsonFile} = require('./store');
const worlds = require('./worlds');
const persisted=new JsonFile('server-difficulty.json',{});
const previous=persisted.get();
if(Difficulty.MODES.some(x=>x.id===previous.difficulty)){config.get().game.difficulty=previous.difficulty;require('../shared/enemies').configure(config.get().game);}

function current(room = null) {
  const g = config.get().game;
  return { difficulty: room?.world?.difficulty || g.difficulty || 'normal', corpseLifetimeSec: g.corpseLifetimeSec, enemyRespawnSec: g.enemyRespawnSec,
    enemyPopulation: g.enemyPopulation, groundItemTtlSec: g.groundItemTtlSec ?? 7200,
    settlementNpcRespawnSec: g.settlementNpcRespawnSec ?? 300, questItemRespawnSec: g.questItemRespawnSec ?? 300 };
}
function set(values = {}, targetRoom = null) {
  const g = config.get().game, next = { ...current(targetRoom), ...values };
  if (!Difficulty.MODES.some(x => x.id === next.difficulty)) throw new Error('Выберите один из семи режимов сложности.');
  for (const [key, max, label] of [
    ['corpseLifetimeSec', 65536, 'Срок хранения трупов'], ['enemyRespawnSec', 65536, 'Таймер возрождения врагов'],
    ['groundItemTtlSec', 65536, 'Срок выпавших предметов'], ['enemyPopulation', 250, 'Целевая численность врагов'],
    ['settlementNpcRespawnSec', 65536, 'Возрождение жителей'], ['questItemRespawnSec', 65536, 'Возрождение сюжетных материалов'],
  ]) if (!Number.isInteger(Number(next[key])) || Number(next[key]) < 0 || Number(next[key]) > max) throw new Error(`${label}: целое число от 0 до ${max}.`);
  if(targetRoom){worlds.setDifficulty(targetRoom.world.id,next.difficulty);targetRoom.world.difficulty=next.difficulty;}
  else {
    for(const world of worlds.all())worlds.setDifficulty(world.id,next.difficulty);
    persisted.data={difficulty:next.difficulty};persisted.save();g.difficulty=next.difficulty;
  }
  g.groundItemTtlSec = Number(next.groundItemTtlSec);
  g.settlementNpcRespawnSec = Number(next.settlementNpcRespawnSec);
  g.questItemRespawnSec = Number(next.questItemRespawnSec);
  require('./corpses').setLifetime(Number(next.corpseLifetimeSec));
  require('./spawner-settings').set({ enemyRespawnSec: Number(next.enemyRespawnSec), enemyPopulation: Number(next.enemyPopulation) });
  require('../shared/enemies').configure(g);
  for (const room of realtime.rooms.values()) {
    if(!targetRoom||room.world.id===targetRoom.world.id){room.world.difficulty=next.difficulty;if(room.combat)require('./combat').applyDifficulty(room);}
    for (const gid of require('./ground').purge(room.id)) room.broadcast({ t: 'ground-remove', gid });
    room.broadcast({ t: 'difficulty-settings', ...current(room) });
  }
  return current(targetRoom);
}
realtime.use({ welcome: room => current(room), handlers: { 'difficulty-settings': (c, msg) => {
  try { set(msg,c.room); }
  catch (e) { realtime.send(c, { t: 'difficulty-settings-error', message: e.message }); }
} } });
module.exports = { current, set, MODES: Difficulty.MODES };
