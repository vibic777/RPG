'use strict';
// Магия на сервере без сети: чтение заклинаний (проверки маны, отката, дальности, читы), время чтения и прерывание,
// эффекты всех видов, кража у мага, дар убитого мага, призыв голема, враги-маги колдуют сами. Комната и клиент — заглушки.
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../server/config');
const combat = require('../server/combat');
const Srv = require('../server/magic');
const Comp = require('../server/companions');
const Spawner = require('../server/spawner');
const Magic = require('../shared/magic');
const Enemies = require('../shared/enemies');
const WorldGen = require('../shared/worldgen');
const M = require('../shared/movement');

// Погибший спутник и убитый враг оставляют вещи на земле (server/ground.js): данные — во временной папке, id мира — UUID
const DATA = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'rpg-test-'));
config.load({ overrides: { dataDir: DATA } });
process.on('exit', () => require('node:fs').rmSync(DATA, { recursive: true, force: true }));
const G = config.get().game;
G.stunChance = 0;
function makeRoom() {
  const W = 40, H = 40, tiles = new Uint8Array(W * H).fill(WorldGen.B.WASTE);
  for (let y = 0; y < H; y++) for (let x = 30; x < W; x++) tiles[y * W + x] = WorldGen.B.WATER;
  const map = { width: W, height: H, tiles, region: null, spawn: { x: 5, y: 5 }, settlements: [], lairs: [], depots: [] };
  const room = { id: require('node:crypto').randomUUID(), map, players: new Map(), world: {}, sent: [], broadcast(m) { this.sent.push(m); }, broadcastAbout() {}, savePlayer() {} };
  room.combat = { enemies: new Map(), projectiles: [], traps: new Map(), turrets: new Map(), fx: [], spawn: Spawner.createState(), nextSpawnAt: 0 };
  room.grid = M.gridFromWorld(map);
  return room;
}
let n = 0;
function makeClient(room, spells = [], stats = {}) {
  const msgs = [], id = 'acc' + ++n;
  const c = {
    account: { id, username: 'u' + n }, ws: { readyState: 1, send: (s) => msgs.push(JSON.parse(s)) }, msgs, room, pos: { x: 10.5, y: 10.5 }, cb: {},
    character: { id: 'ch' + n, name: 'Маг' + n, level: 12, xp: 0, stats: { magic: 8, intellect: 4, stealth: 3, suggestion: 3, companions: 2, strength: 2 }, spells: [...spells], companions: [], vitals: { hp: 50, mp: 500, stamina: 50 }, inventory: { cells: [], equipment: {}, hotbar: [] } },
  };
  Object.assign(c.character.stats, stats);
  room.players.set(id, c);
  return c;
}
function addEnemy(room, def, x, y, hp = 500, extra = {}) {
  const d = Enemies.get(def);
  const e = { id: 'e' + Math.random().toString(16).slice(2, 8), def: d, level: 5, x, y, home: { x, y }, hp, maxHp: hp, damage: [5, 6], defense: 0, xp: 5, state: 'idle', target: null, path: [], repathAt: 0, nextAttack: 0, dots: [], hitBy: new Map(), speedMul: 1, stunUntil: 0, immobileUntil: 0, ...extra };
  room.combat.enemies.set(e.id, e);
  return e;
}
const rejects = (c) => c.msgs.filter((m) => m.t === 'cast-reject').map((m) => m.message);
const fxs = (room, k) => room.combat.fx.filter((f) => f.k === k);
const noCd = (c) => { c.cb.spellCd = {}; c.cb.gcdUntil = 0; };

test('чтение: проверки (не изучено, мана, откат, дальность, мёртв, мусор), время чтения, прерывание движением и уроном', () => {
  const room = makeRoom(), c = makeClient(room, ['fire_bolt', 'meteor', 'heal']);
  const e = addEnemy(room, 'zombie', 14.5, 10.5);
  assert.match(Srv.cast(c, { spell: 'lightning', target: e.id }), /не изучено/);
  assert.match(Srv.cast(c, { spell: 'zzz' }), /Неизвестное/);
  assert.match(Srv.cast(c, { spell: 'fire_bolt' }), /Выберите цель/);
  // мгновенный? нет — у огненной стрелы 0,4 с чтения
  const mp0 = c.character.vitals.mp;
  assert.equal(Srv.cast(c, { spell: 'fire_bolt', target: e.id }), null);
  assert.ok(c.cb.casting && c.cb.casting.spell === 'fire_bolt');
  assert.match(Srv.cast(c, { spell: 'heal' }), /уже читаете/);
  Srv.tick(room, 0.1, Date.now() + 500); // время вышло — стрела вылетела, мана потрачена, откат пошёл
  assert.equal(c.cb.casting, null);
  assert.equal(c.character.vitals.mp, mp0 - Magic.get('fire_bolt').mp);
  assert.equal(room.combat.projectiles.length, 1);
  assert.equal(room.combat.projectiles[0].prof.damageType, 'fire');
  c.cb.gcdUntil = 0;
  assert.match(Srv.cast(c, { spell: 'fire_bolt', target: e.id }), /ещё не готово/);
  noCd(c);
  // дальность
  const far = addEnemy(room, 'zombie', 28.5, 10.5);
  assert.match(Srv.cast(c, { spell: 'fire_bolt', target: far.id }), /далеко/);
  assert.match(Srv.cast(c, { spell: 'meteor', x: 28.5, y: 28.5 }), /далеко/);
  assert.match(Srv.cast(c, { spell: 'meteor', x: 'a', y: null }), /Укажите точку/);
  // мана
  c.character.vitals.mp = 3;
  assert.match(Srv.cast(c, { spell: 'fire_bolt', target: e.id }), /маны/);
  c.character.vitals.mp = 500;
  // прерывание движением
  assert.equal(Srv.cast(c, { spell: 'meteor', x: 14.5, y: 10.5 }), null);
  c.pos = { x: 11.5, y: 10.5 };
  Srv.tick(room, 0.1, Date.now());
  assert.equal(c.cb.casting, null, 'сдвинулся — прервано');
  assert.equal(c.character.vitals.mp, 500, 'мана не потрачена');
  // прерывание уроном
  noCd(c);
  assert.equal(Srv.cast(c, { spell: 'meteor', x: 14.5, y: 10.5 }), null);
  combat.applyHit(room, { kind: 'e', e, id: e.id }, { kind: 'p', ref: c, x: c.pos.x, y: c.pos.y, r: 0.35 }, { damage: [3, 3], damageType: 'physical', flags: [] });
  assert.equal(c.cb.casting, null, 'ранили — прервано');
  // мёртвый не колдует
  noCd(c); c.cb.dead = true;
  assert.match(Srv.cast(c, { spell: 'heal' }), /мертвы/);
  c.cb.dead = false;
  // нужные статы проверяются и при чтении (стат понизили после изучения)
  c.character.stats.magic = 0;
  assert.match(Srv.cast(c, { spell: 'heal' }), /Магия/);
});

test('эффекты: цепь, конус, область, лечение, восстановление, щит, защита, скорость, порча, скачок, теневой шаг, дым, страх, очищение', () => {
  const room = makeRoom(), c = makeClient(room, Magic.SPELLS.map((s) => s.id));
  const now = Date.now();
  const e1 = addEnemy(room, 'zombie', 13.5, 10.5), e2 = addEnemy(room, 'zombie', 14.5, 11.5);
  // цепная молния: цель и сосед
  Srv.cast(c, { spell: 'lightning', target: e1.id }); Srv.tick(room, 0.1, Date.now() + 400);
  assert.ok(e1.hp < 500 && e2.hp < 500, 'молния перескочила');
  // конус огня
  noCd(c); const h1 = e1.hp;
  assert.equal(Srv.cast(c, { spell: 'fire_breath', x: 13.5, y: 10.5 }), null);
  assert.ok(e1.hp < h1 && fxs(room, 'cone').length);
  // область вокруг себя (кольцо огня) и в точке (метеор оглушает)
  noCd(c); const h2 = e1.hp;
  Srv.cast(c, { spell: 'fire_nova' }); Srv.tick(room, 0.1, Date.now() + 700);
  assert.ok(e1.hp < h2, 'кольцо огня');
  noCd(c);
  Srv.cast(c, { spell: 'meteor', x: 14, y: 11 }); Srv.tick(room, 0.1, Date.now() + 2000);
  assert.ok(e1.stunUntil > now && e2.stunUntil > now, 'метеор оглушил');
  // лечение себя и союзника
  const ally = makeClient(room, []); ally.pos = { x: 12.5, y: 10.5 }; ally.character.vitals.hp = 10;
  noCd(c); Srv.cast(c, { spell: 'heal', target: ally.account.id }); Srv.tick(room, 0.1, Date.now() + 1100);
  assert.ok(ally.character.vitals.hp > 10, 'союзник вылечен');
  const far = makeClient(room, []); far.pos = { x: 28.5, y: 28.5 };
  noCd(c); assert.match(Srv.cast(c, { spell: 'heal', target: far.account.id }), /далеко/);
  // восстановление со временем
  noCd(c); c.character.vitals.hp = 10;
  Srv.cast(c, { spell: 'regen' }); Srv.tick(room, 0.1, Date.now() + 600);
  const hp = c.character.vitals.hp; Srv.tick(room, 1, Date.now() + 1600);
  assert.ok(c.character.vitals.hp > hp, 'здоровье растёт само');
  // щит поглощает урон
  noCd(c); c.character.vitals.hp = 50;
  Srv.cast(c, { spell: 'ice_shield' }); Srv.tick(room, 0.1, Date.now() + 400);
  assert.ok(c.cb.shield.amount > 40);
  c.cb.regen = null; c.character.vitals.hp = 50;
  combat.applyHit(room, { kind: 'e', e: { damage: [10, 10] }, id: 'x' }, { kind: 'p', ref: c, x: c.pos.x, y: c.pos.y, r: 0.35 }, { damage: [10, 10], damageType: 'magic', flags: [] });
  assert.equal(c.character.vitals.hp, 50, 'урон ушёл в щит');
  // каменная кожа (защита), попутный ветер (скорость)
  noCd(c); Srv.cast(c, { spell: 'stone_skin' }); Srv.tick(room, 0.1, Date.now() + 600);
  assert.ok(Srv.enemyDefense(c.cb) > 0);
  noCd(c); Srv.cast(c, { spell: 'haste' }); Srv.tick(room, 0.1, Date.now() + 400);
  assert.equal(Srv.speedFactor(c), Magic.get('haste').speed);
  // порча: враг бьёт слабее
  noCd(c); Srv.cast(c, { spell: 'weaken', target: e1.id }); Srv.tick(room, 0.1, Date.now() + 600);
  assert.equal(e1.weakFactor, 0.7); assert.ok(e1.weakUntil > now);
  // скачок: в воду нельзя, на сушу — можно
  noCd(c); assert.match(Srv.cast(c, { spell: 'blink', x: 31.5, y: 10.5 }), /далеко|вода/);
  c.pos = { x: 26.5, y: 20.5 }; noCd(c);
  assert.match(Srv.cast(c, { spell: 'blink', x: 31.5, y: 20.5 }), /вода/);
  noCd(c); assert.equal(Srv.cast(c, { spell: 'blink', x: 22.5, y: 20.5 }), null);
  assert.deepEqual(c.pos, { x: 22.5, y: 20.5 });
  // теневой шаг — за спину врага
  const e3 = addEnemy(room, 'zombie', 18.5, 20.5);
  noCd(c); assert.equal(Srv.cast(c, { spell: 'shadow_step', target: e3.id }), null);
  assert.ok(c.pos.x < e3.x && Math.hypot(c.pos.x - e3.x, c.pos.y - e3.y) < 1.5, 'за спиной');
  // дым: враг теряет цель, герой невидим для ИИ; атака снимает скрытность
  e3.target = c.account.id; e3.state = 'chase';
  noCd(c); Srv.cast(c, { spell: 'smoke' });
  assert.equal(e3.target, null); assert.ok(Srv.hidden(c));
  noCd(c); Srv.cast(c, { spell: 'fire_breath', x: e3.x, y: e3.y });
  assert.ok(!Srv.hidden(c), 'атака снимает дым');
  // страх: бегут (кроме боссов); дыхание огня выше может добить e3 (урон случаен) — пугаем свежего врага
  const scared = addEnemy(room, 'zombie', 18.5, 20.5);
  const boss = addEnemy(room, 'boss_super', 21.5, 21.5);
  noCd(c); Srv.cast(c, { spell: 'fear' }); Srv.tick(room, 0.1, Date.now() + 600);
  assert.equal(scared.state, 'flee'); assert.notEqual(boss.state, 'flee');
  // очищение: яд, оглушение, оковы
  c.cb.dots = [{ k: 'poison', perSec: 1, until: Date.now() + 5000 }]; c.cb.immobileUntil = Date.now() + 5000;
  noCd(c); Srv.cast(c, { spell: 'purify' }); Srv.tick(room, 0.1, Date.now() + 400);
  assert.deepEqual(c.cb.dots, []); assert.equal(c.cb.immobileUntil, 0);
  // ледяная стрела сковывает (оковы — rootSec)
  const e4 = addEnemy(room, 'zombie', 24.5, 20.5);
  combat.applyHit(room, { kind: 'p', c, id: c.account.id }, { kind: 'e', ref: e4, x: e4.x, y: e4.y, r: 0.4 }, { damage: [1, 1], damageType: 'magic', flags: ['magic'], rootSec: 2 });
  assert.ok(e4.immobileUntil > Date.now());
  // свет жжёт нежить сильнее
  const z = addEnemy(room, 'zombie', 24.5, 22.5, 1000), h = addEnemy(room, 'raider_thug', 24.5, 23.5, 1000);
  combat.setRandom(() => 0.5);
  combat.applyHit(room, { kind: 'p', c, id: c.account.id }, { kind: 'e', ref: z, x: z.x, y: z.y }, { damage: [20, 20], damageType: 'energy', flags: [], undead: 1.5 });
  combat.applyHit(room, { kind: 'p', c, id: c.account.id }, { kind: 'e', ref: h, x: h.x, y: h.y }, { damage: [20, 20], damageType: 'energy', flags: [], undead: 1.5 });
  combat.setRandom(Math.random);
  assert.ok(1000 - z.hp > (1000 - h.hp) * 1.2, 'нежить горит сильнее');
});

test('призыв голема и подчинение: временные спутники; голем рассыпается, подчинение требует свободного места', () => {
  const room = makeRoom(), c = makeClient(room, ['summon_golem', 'charm']);
  assert.equal(Srv.cast(c, { spell: 'summon_golem' }), null);
  Srv.tick(room, 0.1, Date.now() + 2100);
  const rec = c.character.companions.find((r) => r.summoned);
  assert.ok(rec && rec.def === 'golem_stone' && rec.until > Date.now());
  const ent = Comp.stateOf(room).ents.get(rec.id);
  assert.ok(ent, 'голем в мире');
  Comp.stepEnt(room, ent, 0.1, rec.until + 1);
  assert.equal(c.character.companions.length, 0, 'чары выдохлись');
  assert.equal(Comp.stateOf(room).ents.size, 0);
  // подчинение: шанс 100 %
  Magic.settings.magicChanceMin = 1; Magic.settings.magicChanceMax = 1;
  const e = addEnemy(room, 'raider_thug', 12.5, 10.5, 40);
  noCd(c); assert.equal(Srv.cast(c, { spell: 'charm', target: e.id }), null);
  Srv.tick(room, 0.1, Date.now() + 1600);
  assert.ok(!room.combat.enemies.has(e.id), 'враг стал спутником');
  const ch = c.character.companions.find((r) => r.def === 'raider_thug');
  assert.ok(ch && ch.until > Date.now() && !ch.summoned);
  // мест нет (Напарники 2, но один занят; забьём второй)
  c.character.stats.companions = 1;
  const e2 = addEnemy(room, 'raider_thug', 12.5, 11.5, 40);
  noCd(c); Srv.cast(c, { spell: 'charm', target: e2.id }); Srv.tick(room, 0.1, Date.now() + 1600);
  assert.ok(rejects(c).some((m) => /Нет свободного места/.test(m)));
  // босс подчиняется по общим правилам (все существа, включая боссов, могут стать спутниками) — упирается только в места
  const before = rejects(c).filter((m) => /Нет свободного места/.test(m)).length;
  const b = addEnemy(room, 'boss_super', 13.5, 10.5);
  noCd(c); Srv.cast(c, { spell: 'charm', target: b.id }); Srv.tick(room, 0.1, Date.now() + 1600);
  assert.ok(!rejects(c).some((m) => /не поддаётся/.test(m)));
  assert.ok(rejects(c).filter((m) => /Нет свободного места/.test(m)).length > before && room.combat.enemies.has(b.id));
  c.character.stats.companions = 3;
  noCd(c); Srv.cast(c, { spell: 'charm', target: b.id }); Srv.tick(room, 0.1, Date.now() + 1600);
  assert.ok(!room.combat.enemies.has(b.id) && c.character.companions.some((r) => r.def === 'boss_super'), 'босс подчинён при свободном месте');
  Magic.settings.magicChanceMin = 0.03; Magic.settings.magicChanceMax = 0.9;
});

test('кража у живого мага (шанс, мана, откат, только у магов) и дар убитого мага (заклинание или сила)', () => {
  const room = makeRoom(), c = makeClient(room, []);
  const z = addEnemy(room, 'zombie', 12.5, 10.5);
  const mage = addEnemy(room, 'mage_fire', 13.5, 10.5);
  assert.match(Srv.ACTS.steal(room, c, { target: z.id }), /не владеет магией/);
  Magic.settings.magicChanceMin = 1; Magic.settings.magicChanceMax = 1;
  const mp = c.character.vitals.mp;
  assert.equal(Srv.ACTS.steal(room, c, { target: mage.id }), null);
  assert.equal(Magic.known(c.character).length, 1);
  assert.ok(mage.def.spells.includes(c.character.spells[0]));
  assert.equal(c.character.vitals.mp, mp - G.magicStealMpCost);
  assert.match(Srv.ACTS.steal(room, c, { target: mage.id }), /ещё не готова/);
  c.cb.stealAt = 0;
  mage.x = 25.5; assert.match(Srv.ACTS.steal(room, c, { target: mage.id }), /ближе/);
  mage.x = 13.5;
  // неудача — маг замечает вора
  Magic.settings.magicChanceMin = 0; Magic.settings.magicChanceMax = 0;
  c.cb.stealAt = 0;
  assert.match(Srv.ACTS.steal(room, c, { target: mage.id }), /не удалась/);
  assert.equal(mage.target, c.account.id);
  Magic.settings.magicChanceMin = 0.03; Magic.settings.magicChanceMax = 0.9;
  // дар убитого мага
  G.magicKillGrantChance = 1;
  const r1 = Srv.onMageKilled(room, c, mage);
  assert.ok(r1.spell && Magic.knows(c.character, r1.spell));
  G.magicKillGrantChance = 0;
  const r2 = Srv.onMageKilled(room, c, mage);
  assert.equal(r2.power, G.magicKillPowerBoost);
  G.magicKillGrantChance = 0.5;
  // убийство мага в бою вызывает дар
  const m2 = addEnemy(room, 'mage_water', 12.5, 11.5, 1);
  m2.def = { ...m2.def, loot: 'нет' }; // без добычи (в заглушке мира нет земли)
  const known = Magic.known(c.character).length, power = c.character.magicPower;
  combat.killEnemy(room, m2, c);
  assert.ok(Magic.known(c.character).length > known || c.character.magicPower > power, 'сила перешла');
});

test('враги-маги колдуют сами: огненная стрела, лечение при ранах, дым и теневой шаг ниндзя, порча на героя', () => {
  const room = makeRoom(), c = makeClient(room, []);
  const now = Date.now();
  const mage = addEnemy(room, 'mage_fire', 16.5, 10.5, 200, { state: 'chase', target: c.account.id, level: 8 });
  // огненная стрела: читается 0,4 с, потом летит снаряд
  mage.def = { ...mage.def, spells: ['fire_bolt'] };
  assert.equal(Srv.enemyThink(room, mage, now, null), true);
  assert.ok(mage.casting);
  Srv.enemyThink(room, mage, now + 500, null);
  assert.equal(room.combat.projectiles.length, 1);
  assert.equal(room.combat.projectiles[0].owner.kind, 'e');
  // ведьма лечится, когда ранена
  const witch = addEnemy(room, 'mage_water', 15.5, 12.5, 100, { state: 'chase', target: c.account.id });
  witch.hp = 30;
  Srv.enemyThink(room, witch, now, null);
  Srv.enemyThink(room, witch, now + 1100, null);
  assert.ok(witch.hp > 30, 'вылечилась');
  // ниндзя: ранен — дым (невидим для героя), издалека — теневой шаг за спину
  const ninja = addEnemy(room, 'ninja', 16.5, 14.5, 100, { state: 'chase', target: c.account.id });
  ninja.hp = 50; ninja.def = { ...ninja.def, spells: ['smoke'] };
  Srv.enemyThink(room, ninja, now, null);
  assert.ok(ninja.hiddenUntil > now);
  assert.ok(!combat.hostiles(room, { kind: 'p', id: c.account.id }).some((h) => h.ref === ninja), 'в дыму не попасть');
  ninja.def = { ...ninja.def, spells: ['shadow_step'] }; ninja.nextCastAt = 0;
  Srv.enemyThink(room, ninja, now + 2000, null);
  assert.ok(Math.hypot(ninja.x - c.pos.x, ninja.y - c.pos.y) < 1.5, 'шагнул к герою');
  // чернокнижник: порча — урон героя ослаблен
  const lock = addEnemy(room, 'mage_dark', 14.5, 8.5, 100, { state: 'chase', target: c.account.id });
  lock.def = { ...lock.def, spells: ['weaken'] };
  Srv.enemyThink(room, lock, now, null); Srv.enemyThink(room, lock, now + 600, null);
  assert.ok(c.cb.weakUntil > now); assert.equal(Srv.weakFactor(c), 0.7);
  // без цели не колдуют
  const idle = addEnemy(room, 'mage_air', 5.5, 5.5);
  assert.equal(Srv.enemyThink(room, idle, now, null), false);
  assert.equal(idle.casting, undefined);
});
