'use strict';
// Спутники на сервере без сети: приказы ИИ (следовать, охранять, атаковать цель, стойка, бегство), ранение → спасение / потеря,
// доля опыта, верховой дракон (скорость, полёт над водой), дыхание. Комната и клиент — заглушки.
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../server/config');
const Srv = require('../server/companions');
const combat = require('../server/combat');
const Spawner = require('../server/spawner');
const C = require('../shared/companions');
const Enemies = require('../shared/enemies');
const WorldGen = require('../shared/worldgen');
const M = require('../shared/movement');

// Погибший спутник и убитый враг оставляют вещи на земле (server/ground.js): данные — во временной папке, id мира — UUID
const DATA = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'rpg-test-'));
config.load({ overrides: { dataDir: DATA } });
process.on('exit', () => require('node:fs').rmSync(DATA, { recursive: true, force: true }));
const G = config.get().game;
// Карта 40×40: пустошь, справа озеро (x ≥ 30)
function makeRoom() {
  const W = 40, H = 40, tiles = new Uint8Array(W * H).fill(WorldGen.B.WASTE);
  for (let y = 0; y < H; y++) for (let x = 30; x < W; x++) tiles[y * W + x] = WorldGen.B.WATER;
  const map = { width: W, height: H, tiles, region: null, spawn: { x: 5, y: 5 }, settlements: [], lairs: [], depots: [] };
  const room = { id: require('node:crypto').randomUUID(), map, players: new Map(), world: {}, sent: [], broadcast(m) { this.sent.push(m); } };
  room.combat = { enemies: new Map(), projectiles: [], traps: new Map(), turrets: new Map(), fx: [], spawn: Spawner.createState(), nextSpawnAt: 0 };
  room.grid = M.gridFromWorld(map);
  return room;
}
function makeClient(room, stats = {}) {
  const msgs = [];
  const c = {
    account: { id: 'acc1' }, ws: { readyState: 1, send: (s) => msgs.push(JSON.parse(s)) }, msgs, room, pos: { x: 10.5, y: 10.5 }, cb: {},
    character: { id: 'ch1', name: 'Алиса', level: 5, xp: 0, stats: { companions: 3, taming: 3, ...stats }, companions: [], vitals: { hp: 100, mp: 50, stamina: 50 }, inventory: { cells: [], equipment: {} } },
  };
  room.players.set(c.account.id, c);
  return c;
}
function addComp(room, c, def, level = 3, extra = {}) {
  const rec = { ...C.makeRecord(Enemies.get(def), level, 'tame', 'c' + Math.random().toString(16).slice(2, 8)), ...extra };
  c.character.companions.push(rec);
  const ent = Srv.spawnEnt(room, c, rec, { x: c.pos.x + 1, y: c.pos.y });
  return { rec, ent };
}
function addEnemy(room, def, x, y, hp = 99999) {
  const d = Enemies.get(def);
  const e = { id: 'e' + Math.random().toString(16).slice(2, 8), def: d, level: 3, x, y, home: { x, y }, hp, maxHp: hp, damage: [1, 2], defense: 0, xp: 5, state: 'idle', target: null, path: [], repathAt: 0, nextAttack: 0, dots: [], hitBy: new Map(), speedMul: 1, stunUntil: 0, immobileUntil: 0 };
  room.combat.enemies.set(e.id, e);
  return e;
}
let clock = Date.now(); // общее время имитации для всех прогонов
function run(room, ent, sec, step = 0.1) { for (let t = 0; t < sec; t += step) { clock += step * 1000; Srv.stepEnt(room, ent, step, clock); } return clock; }

test('ИИ спутника: следует за героем, охраняет место, атакует мою цель, пассивный не нападает сам, раненый бежит к герою', () => {
  const room = makeRoom(), c = makeClient(room);
  const { rec, ent } = addComp(room, c, 'wolf');
  // следовать: герой ушёл — спутник догоняет
  c.pos = { x: 20.5, y: 10.5 };
  run(room, ent, 4);
  assert.ok(Math.hypot(ent.x - c.pos.x, ent.y - c.pos.y) <= G.compFollowDist + 0.6, 'догнал героя');
  // охранять место: стоит у точки, даже когда герой уходит
  Srv.ACTS.order(room, c, { id: rec.id, order: 'guard', x: 15.5, y: 15.5 });
  c.pos = { x: 25.5, y: 5.5 };
  run(room, ent, 4);
  assert.ok(Math.hypot(ent.x - 15.5, ent.y - 15.5) < 1.5, 'у точки охраны');
  // пассивная стойка: враг рядом — не трогает
  Srv.ACTS.order(room, c, { id: rec.id, order: 'follow' });
  Srv.ACTS.stance(room, c, { id: 'all', stance: 'passive' });
  const e = addEnemy(room, 'zombie', c.pos.x + 2, c.pos.y + 2);
  run(room, ent, 5);
  assert.equal(e.hp, e.maxHp, 'пассивный не нападает');
  // атаковать мою цель — нападает даже в пассивной стойке
  Srv.ACTS.order(room, c, { id: rec.id, order: 'attack', target: e.id });
  run(room, ent, 5);
  assert.ok(e.hp < e.maxHp, 'атаковал цель');
  assert.equal(e.target, ent.id, 'враг злится на спутника');
  // агрессивная стойка: сам нападает на врагов рядом с героем
  const e2 = addEnemy(room, 'zombie', c.pos.x - 2, c.pos.y + 1);
  room.combat.enemies.delete(e.id);
  Srv.ACTS.stance(room, c, { id: rec.id, stance: 'aggressive' });
  run(room, ent, 5);
  assert.ok(e2.hp < e2.maxHp, 'агрессивный нападает сам');
  // мало здоровья — бежит к герою и не бьёт
  rec.hp = 1;
  const hp2 = e2.hp;
  ent.x = c.pos.x - 5; ent.y = c.pos.y; ent.path = [];
  run(room, ent, 3);
  assert.ok(Math.hypot(ent.x - c.pos.x, ent.y - c.pos.y) < 2, 'прибежал к герою');
  assert.equal(e2.hp, hp2);
  // враги видят спутника как цель
  assert.ok(Srv.aiTargets(room).some((t) => t.id === ent.id && t.companion));
});

test('ранение: окно спасения, «Спасти» рядом, иначе потеря (или в контейнер при compPermadeath=false)', () => {
  const room = makeRoom(), c = makeClient(room);
  const { rec, ent } = addComp(room, c, 'wolf');
  const e = addEnemy(room, 'zombie', 12, 12);
  Srv.hitByEnemy(room, ent, e, 1e6, 'physical');
  assert.ok(rec.down > Date.now() && rec.hp === 0, 'ранен');
  assert.ok(Srv.aiTargets(room).find((t) => t.id === ent.id).dead, 'враги его больше не бьют');
  c.pos = { x: ent.x + 5, y: ent.y };
  assert.match(Srv.ACTS.revive(room, c, { id: rec.id }), /Подойдите/);
  c.pos = { x: ent.x + 1, y: ent.y };
  assert.equal(Srv.ACTS.revive(room, c, { id: rec.id }), null);
  assert.ok(!rec.down && rec.hp > 0);
  // не спасли вовремя — погиб
  Srv.hitByEnemy(room, ent, e, 1e6, 'physical');
  Srv.stepEnt(room, ent, 0.1, rec.down + 10);
  assert.equal(c.character.companions.length, 0, 'потерян');
  assert.ok(!Srv.entOf(room, rec.id));
  // без окончательной смерти: с контейнером — в контейнер
  G.compPermadeath = false;
  try {
    c.character.inventory.cells.push({ id: 'shrinker', n: 1 });
    const b = addComp(room, c, 'boar');
    Srv.hitByEnemy(room, b.ent, e, 1e6, 'physical');
    Srv.stepEnt(room, b.ent, 0.1, b.rec.down + 10);
    assert.equal(c.character.companions.length, 1);
    assert.ok(!b.rec.out && b.rec.hp === 1 && !b.rec.down);
  } finally { G.compPermadeath = true; }
});

test('опыт: призванные спутники получают долю опыта героя и растут в уровне', () => {
  const room = makeRoom(), c = makeClient(room);
  const { rec } = addComp(room, c, 'wolf', 1);
  const stored = { ...C.makeRecord(Enemies.get('boar'), 1, 'tame', 'cS'), out: false };
  c.character.companions.push(stored);
  Srv.onOwnerXp(room, c, C.xpToNext(1) / G.compXpShare + 1);
  assert.equal(rec.level, 2);
  assert.equal(stored.level, 1, 'спрятанный не растёт');
});

test('контейнер и места: спрятать без контейнера нельзя, призвать сверх «Напарников» нельзя', () => {
  const room = makeRoom(), c = makeClient(room, { companions: 1 });
  const { rec } = addComp(room, c, 'wolf');
  assert.match(Srv.ACTS.store(room, c, { id: rec.id }), /контейнер/);
  c.character.inventory.cells.push({ id: 'shrinker', n: 1 });
  assert.equal(Srv.ACTS.store(room, c, { id: rec.id }), null);
  assert.ok(!rec.out && !Srv.entOf(room, rec.id));
  const b = addComp(room, c, 'boar');
  assert.match(Srv.ACTS.summon(room, c, { id: rec.id }), /места заняты/);
  Srv.ACTS.store(room, c, { id: b.rec.id });
  assert.equal(Srv.ACTS.summon(room, c, { id: rec.id }), null);
  assert.ok(rec.out && Srv.entOf(room, rec.id));
});

test('верховой дракон: сесть рядом, быстрее, летит над водой; слезть над водой нельзя; дыхание бьёт конусом', () => {
  const room = makeRoom(), c = makeClient(room);
  const w = addComp(room, c, 'wolf');
  assert.match(Srv.ACTS.mount(room, c, { id: w.rec.id }), /на лошадях и драконах/); // волк — не ездовой
  const { rec, ent } = addComp(room, c, 'dragon_ice', 12);
  ent.x = c.pos.x + 6;
  assert.match(Srv.ACTS.mount(room, c, { id: rec.id }), /Подойдите/);
  ent.x = c.pos.x + 1;
  assert.equal(Srv.ACTS.mount(room, c, { id: rec.id }), null);
  assert.equal(c.mount, rec.id);
  assert.equal(Srv.speedFactor(c), G.compMountSpeed);
  assert.equal(Srv.flying(c), true);
  assert.ok(c.msgs.some((m) => m.t === 'comp-mount' && m.fly === 1 && m.speed === G.compMountSpeed));
  // над водой: пешком нельзя, верхом — можно
  assert.equal(WorldGen.isWalkable(room.map, 32, 10), false);
  room.map.flyer = Srv.flying(c);
  assert.equal(WorldGen.isWalkable(room.map, 32, 10), true);
  assert.ok(M.speedAt(room.map, 32.5, 10.5, 1) > 0);
  room.map.flyer = false;
  c.pos = { x: 32.5, y: 10.5 };
  assert.match(Srv.ACTS.dismount(room, c, {}), /не приземлиться/);
  // дыхание: враг перед драконом ранен, позади — нет
  c.pos = { x: 20.5, y: 20.5 };
  const front = addEnemy(room, 'zombie', 23.5, 20.5), back = addEnemy(room, 'zombie', 17.5, 20.5);
  assert.equal(Srv.ACTS.breath(room, c, { x: 25, y: 20.5 }), null);
  assert.ok(front.hp < front.maxHp && back.hp === back.maxHp);
  assert.match(Srv.ACTS.breath(room, c, { x: 25, y: 20.5 }), /переводит дух/);
  assert.equal(Srv.ACTS.dismount(room, c, {}), null);
  assert.equal(c.mount, null);
  assert.equal(Srv.speedFactor(c), 1);
});
