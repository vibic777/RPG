'use strict';
// Бой в реальном времени (сервер — единственный источник истины). Подключается к комнатам через realtime.use():
//   атаки игроков (проверка скорости, дальности, патронов, выносливости), снаряды, конусы, мины/ловушки, турели,
//   враги (ИИ server/ai.js, появление server/spawner.js), урон и защита (shared/combat.js), опыт, уровни, смерть,
//   добыча на землю, команды администратора /spawn /kill /heal /setlevel.
const crypto = require('crypto');
const Combat = require('../shared/combat');
const Enemies = require('../shared/enemies');
const Companions = require('../shared/companions');
const Items = require('../shared/items');
const Inv = require('../shared/inventory');
const Rules = require('../shared/character-rules');
const WorldGen = require('../shared/worldgen');
const M = require('../shared/movement');
const config = require('./config');
const auth = require('./auth');
const characters = require('./characters');
const realtime = require('./realtime');
const chat = require('./chat');
const ground = require('./ground');
const worldstate = require('./worldstate');
const ngplus = require('./ngplus');
const events = require('./events');
const inventory = require('./inventory');
const survival = require('./survival');
const Survival = require('../shared/survival');
const AI = require('./ai');
const Spawner = require('./spawner');
const Difficulty = require('../shared/difficulty');

const G = () => config.get().game;
const round2 = (v) => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const PLAYER_RADIUS = 0.3;
let rnd = Math.random; // тесты могут подменить: setRandom(Combat.rng(seed))
function setRandom(fn) { rnd = fn || Math.random; }

// ---------- Состояние комнаты и игрока ----------

function stateOf(room) {
  if (!room.combat) {
    room.combat = {
      enemies: new Map(), projectiles: [], traps: new Map(), turrets: new Map(), fx: [],
      spawn: Spawner.createState(), nextSpawnAt: 0,
    };
    room.grid = room.grid || M.gridFromWorld(room.map);
    room.combat.nextAutosaveAt = nextAutosave();
    let saved = null;
    try { saved = worldstate.load(room.id); if (saved) restoreState(room, saved); } catch (e) { console.warn('[combat] не удалось восстановить состояние мира:', e.message); }
    if (room.level) { try { levels().populate(room, saved); } catch (e) { console.warn('[combat] не удалось заселить уровень:', e.message); } }
  }
  return room.combat;
}

// ---------- Сохранение состояния мира ----------
// autosaveSec = 0 — без периодического автосохранения (остаются уход последнего игрока, остановка и кнопка «Сохранить»)
const nextAutosave = () => (config.get().autosaveSec > 0 ? Date.now() + config.get().autosaveSec * 1000 : Infinity);
// Живые враги (с уровнем, здоровьем, домом, участком, признаком орды), турели, мины и ловушки, таймер орд
function snapshotState(room) {
  const cs = stateOf(room);
  return {
    enemies: [...cs.enemies.values()].filter((e) => !e.dead).map((e) => ({
      def: e.def.id, level: e.level, difficultyBaseLevel: e.difficultyBaseLevel, x: round2(e.x), y: round2(e.y), home: { x: round2(e.home.x), y: round2(e.home.y) }, hp: Math.ceil(e.hp),
      area: e.area || null, horde: e.horde ? 1 : 0, ignoreSafe: e.ignoreSafe ? 1 : 0, equip: e.equip, bag: e.bag,
      personality:e.personality,disposition:e.disposition,followerOf:e.followerOf,guardOf:e.guardOf,
      ...(e.elite ? { elite: 1 } : {}), ...(e.god ? { god: 1 } : {}), ...(e.cheatSpeed ? { cheatSpeed: e.cheatSpeed } : {}),
    })),
    turrets: [...cs.turrets.values()].map((t) => ({ id: t.id, item: t.item, owner: t.owner, ownerName: t.ownerName, x: t.x, y: t.y, mag: t.mag, tier: t.tier, hp: t.hp, maxHp: t.maxHp, mode: t.mode, until: t.until })),
    traps: [...cs.traps.values()].map((t) => ({ id: t.id, item: t.item, owner: t.owner, ownerName: t.ownerName, x: t.x, y: t.y, armAt: t.armAt, until: t.until })),
    nextHordeAt: cs.spawn.nextHordeAt || 0,
    populationTarget: cs.spawn.populationTarget,
    orphanPending: cs.spawn.orphanPending || 0,
    orphanReadyAt: cs.spawn.orphanReadyAt || 0,
    corpses: room.corpses ? [...room.corpses.values()] : [],
    allies: companions().snapshotAllies(room),
    fires: survival.snapshotFires(room),
    nodes: building().snapshotNodes(room),
    cheatNpcs: settlements().snapshotCheat(room), // жители по читу (шаг 21)
    props: worldedit().snapshot(room), // объекты стройки и скрытые объекты мира (шаг 21)
    fog: require('./fog').snapshot(room), // общая разведанная карта (шаг 22)
    levelAt: room.levelAt || 0, // уровень (шаг 13): когда заселён врагами
  };
}
function restoreState(room, st) {
  const cs = room.combat, g = G(), now = Date.now();
  if (Number.isInteger(st.populationTarget) && st.populationTarget >= 0) cs.spawn.populationTarget = st.populationTarget;
  if (Number.isInteger(st.orphanPending) && st.orphanPending >= 0) cs.spawn.orphanPending = st.orphanPending;
  if (Number.isFinite(st.orphanReadyAt)) cs.spawn.orphanReadyAt = st.orphanReadyAt;
  require('./corpses').restore(room, st.corpses);
  companions().restoreAllies(room,st.allies);
  survival.restoreFires(room, st.fires);
  building().restoreNodes(room, st.nodes);
  settlements().restoreCheat(room, st.cheatNpcs);
  worldedit().restore(room, st.props);
  require('./fog').restore(room, st.fog);
  for (const x of st.enemies || []) {
    const def = Enemies.get(x.def);
    if (!def || !Number.isFinite(x.x) || !Number.isFinite(x.y)) continue;
    const e = spawnEnemy(room, def, x.level, x.x, x.y, x.area, { ignoreSafe: x.ignoreSafe, horde: x.horde, loadout: x.equip ? { equip: x.equip, bag: x.bag || [] } : null });
    if (Number.isFinite(x.difficultyBaseLevel)) e.difficultyBaseLevel = x.difficultyBaseLevel;
    if (x.home) e.home = { ...x.home };
    Object.assign(e,{personality:x.personality||e.personality,disposition:x.disposition||e.disposition,followerOf:x.followerOf||null,guardOf:x.guardOf||null});
    if(e.followerOf)e.state='follower';
    if (x.elite) makeElite(room, e);
    if (x.god) e.god = true;
    if (x.cheatSpeed > 0) e.cheatSpeed = Number(x.cheatSpeed);
    e.hp = Math.max(1, Math.min(e.maxHp, x.hp || e.maxHp));
    // враг снова занимает место на своём участке — появление не превысит предел
    if (x.area && /^\d+,\d+$/.test(x.area)) {
      let a = cs.spawn.areas.get(x.area);
      if (!a) {
        const [ax, ay] = x.area.split(',').map(Number);
        a = { key: x.area, ax, ay, cap: Spawner.areaCap(room.map, ax, ay, room.world, g), alive: new Set(), pending: [], lastActive: now };
        cs.spawn.areas.set(x.area, a);
      }
      a.alive.add(e.id);
    }
  }
  for (const x of st.turrets || []) {
    const it = Items.get(x.item);
    if (!it) continue;
    const base = Combat.profile(it), tier = Math.max(1, Math.min(g.turretMaxTier, x.tier || 1));
    cs.turrets.set(x.id, { ...x, tier, prof: turretProfile(base, tier), base, next: 0 });
  }
  for (const x of st.traps || []) {
    const it = Items.get(x.item);
    if (it) cs.traps.set(x.id, { ...x, prof: Combat.profile(it) });
  }
  if (st.nextHordeAt) cs.spawn.nextHordeAt = st.nextHordeAt;
  if (st.levelAt) room.levelAt = st.levelAt;
}
// Сохранить состояние мира сейчас (автосохранение, уход последнего игрока, остановка, кнопка «Сохранить»)
function saveWorldState(room) {
  if (!room.combat || room.removed) return 0;
  room.combat.nextAutosaveAt = nextAutosave();
  try { return worldstate.save(room.id, snapshotState(room)); } catch (e) { console.warn('[combat] не удалось сохранить состояние мира:', e.message); return 0; }
}

function cbOf(c) {
  if (!c.cb) {
    c.cb = {
      superCharge: 0, nextThrow: 'mainHand', last: { mainHand: 0, offHand: 0 }, reload: null, sprint: false, lastCombatAt: 0, stunUntil: 0, immobileUntil: 0, dots: [],
      dead: false, respawnAt: 0, dirty: false, meKey: '', invDirtyAt: 0, invSentAt: 0, rejects: 0,
    };
  }
  return c.cb;
}

const pvpOn = () => false; // все игроки — союзники против мира
const maxVitals = (ch) => survival.maxVitals(ch); // с учётом выживания (жажда, радиация)
const isSafeAt = (room, x, y) => !settlements().zoneAt(room, x, y) && Spawner.isSafe(room.map, x, y, G());

function fx(room, ev) { stateOf(room).fx.push(ev); }
function markDirty(c) { cbOf(c).dirty = true; }
function sendInv(c) {
  const cb = cbOf(c);
  cb.invDirtyAt = 0;
  cb.invSentAt = Date.now();
  inventory.events.emit('changed', c.account.id, c.character); // инвентарь игроку + внешний вид всем
}
function persist(c) {
  const cb = cbOf(c);
  try { characters.persist(c.account, c.character); cb.dirty = false; } catch (e) { console.warn('[combat] не удалось сохранить персонажа:', e.message); }
}

// Личные показатели героя: здоровье, выносливость, мана, опыт, патроны
function meOf(c) {
  const ch = c.character, cb = cbOf(c), max = maxVitals(ch), v = ch.vitals || max;
  const eq = ch.inventory.equipment;
  const mag = (s) => { const x = eq[s], it = x && Items.get(x.id); return it && it.weapon && it.weapon.ammo && it.weapon.magazine > 0 ? { n: x.mag || 0, max: it.weapon.magazine, ammo: it.weapon.ammo, have: Inv.rounds(ch, it.weapon.ammo) } : null; };
  return {
    hp: Math.ceil(v.hp), mhp: max.hp, st: Math.floor(v.stamina), mst: max.stamina, mp: Math.floor(v.mp), mmp: max.mp,
    xp: ch.xp || 0, next: Combat.xpToNext(ch.level || 1), lvl: ch.level || 1, pts: ch.unspentPoints || 0, deaths: ch.deaths || 0,
    mag: { main: mag('mainHand'), off: mag('offHand') },
    reload: cb.reload ? { slot: cb.reload.slot === 'offHand' ? 'off' : 'main', ms: Math.max(0, cb.reload.until - Date.now()), total: cb.reload.total } : null,
    superCharge: realtime.godOf(c.account.id).superAttack ? 100 : Math.floor(cb.superCharge || 0), sprint: cb.sprint ? 1 : 0, dead: cb.dead ? 1 : 0,
  };
}
function sendMe(c, force = false) {
  const me = meOf(c);
  const key = JSON.stringify({ ...me, reload: me.reload && { slot: me.reload.slot, total: me.reload.total } });
  const cb = cbOf(c);
  if (!force && key === cb.meKey) return;
  cb.meKey = key;
  realtime.send(c, { t: 'me', ...me });
}

// ---------- Враги ----------

function newEnemyId() { return 'e' + crypto.randomBytes(4).toString('hex'); }

function spawnEnemy(room, def, level, x, y, area = null, opts = {}) {
  level = Math.max(1, Math.min(G().maxEnemyLevel || 99, Math.floor(Number(level) || 1)));
  const cs = stateOf(room);
  const st = { ...Enemies.statsAt(def, level, room.world.difficulty||G().difficulty) };
  const difficultyBaseLevel = Math.max(1, Math.round(level / Difficulty.get(room.world.difficulty||G().difficulty).level));
  const nf = ngplus.enemyFactors(room.world); // мир «Новой игры+» легче
  st.maxHp = Math.max(1, Math.round(st.maxHp * nf.hp));
  if (nf.damage !== 1) st.damage = Array.isArray(st.damage) ? st.damage.map((d) => Math.max(1, Math.round(d * nf.damage))) : Math.max(1, Math.round(st.damage * nf.damage));
  const e = {
    id: newEnemyId(), def, level, difficultyBaseLevel, x, y, home: { x, y }, hp: st.maxHp, maxHp: st.maxHp, damage: st.damage, defense: st.defense, xp: st.xp,
    state: 'idle', target: null, path: [], repathAt: 0, nextAttack: 0, wanderAt: 0, stunUntil: 0, immobileUntil: 0, dots: [], area,
    hitBy: new Map(), speedMul: 1, ignoreSafe: Boolean(opts.ignoreSafe), horde: Boolean(opts.horde),
    guardOf:opts.guardOf||null,
    ...(opts.loadout || require('./actor-items').generate(def, level)),
  };
  const personality=require('./enemy-behaviour').profile(e);
  e.disposition=personality.neutral?'neutral':'hostile';
  cs.enemies.set(e.id, e);
  room.broadcast({ t: 'enemy-add', enemy: publicEnemy(e) });
  if (opts.target) { e.target = opts.target; e.state = 'chase'; }
  return e;
}
const publicEnemy = (e) => ({ id: e.id, type: e.def.id, lvl: e.level, x: round2(e.x), y: round2(e.y), hp: Math.ceil(e.hp), maxHp: e.maxHp,disposition:e.disposition, outfit: require('./actor-items').look(e.equip), ...(e.elite ? { elite: 1 } : {}) });
// Элита (чит-панель, шаг 21): здоровье ×2, урон ×1,5, опыт ×2
const ELITE = { hp: 2, damage: 1.5, xp: 2 };
function makeElite(room, e) {
  if (e.elite) return e;
  e.elite = true;
  e.maxHp = Math.round(e.maxHp * ELITE.hp); e.hp = e.maxHp;
  e.damage = Array.isArray(e.damage) ? e.damage.map((d) => Math.round(d * ELITE.damage)) : Math.round(e.damage * ELITE.damage);
  e.xp = Math.round((e.xp || 0) * ELITE.xp);
  room.broadcast({ t: 'enemy-add', enemy: publicEnemy(e) });
  return e;
}
function applyDifficulty(room) {
  if (!room.combat) return;
  for (const e of room.combat.enemies.values()) {
    const profile = Difficulty.get(room.world.difficulty||G().difficulty);
    e.level = Math.max(1, Math.min(G().maxEnemyLevel || 99, e.def.level[1], Math.max(e.def.level[0], Math.round((e.difficultyBaseLevel || e.level) * profile.level))));
    const st = Enemies.statsAt(e.def, e.level, room.world.difficulty||G().difficulty), nf = ngplus.enemyFactors(room.world), elite = e.elite ? ELITE : null;
    let maxHp = Math.max(1, Math.round(st.maxHp * nf.hp));
    let damage = Array.isArray(st.damage) ? st.damage.map(d => Math.max(1, Math.round(d * nf.damage))) : Math.max(1, Math.round(st.damage * nf.damage));
    if (elite) { maxHp = Math.round(maxHp * elite.hp); damage = damage.map(d => Math.round(d * elite.damage)); }
    const fraction = e.maxHp > 0 ? e.hp / e.maxHp : 1;
    e.maxHp = maxHp; e.hp = Math.max(1, Math.min(maxHp, Math.round(maxHp * fraction)));
    e.damage = damage; e.defense = st.defense; e.xp = Math.round(st.xp * (elite ? elite.xp : 1));
    room.broadcast({ t: 'enemy-add', enemy: publicEnemy(e) });
  }
}
// Пересчитать врага под уровень (чит-панель): статы по Enemies.statsAt, элита сохраняется
function setEnemyLevel(room, e, level) {
  const lv = Math.max(1, Math.min(G().maxEnemyLevel || 99, Math.floor(Number(level)) || 1));
  e.difficultyBaseLevel = Math.max(1, Math.round(lv / Difficulty.get(room.world.difficulty||G().difficulty).level));
  const st = Enemies.statsAt(e.def, lv, room.world.difficulty||G().difficulty), k = e.hp / e.maxHp, el = e.elite;
  Object.assign(e, { level: lv, maxHp: st.maxHp, damage: st.damage, defense: st.defense, xp: st.xp, elite: false });
  if (el) makeElite(room, e);
  e.hp = Math.max(1, Math.round(e.maxHp * k));
  room.broadcast({ t: 'enemy-add', enemy: publicEnemy(e) });
  return e;
}

function removeEnemy(room, e, dead) {
  const cs = stateOf(room);
  cs.enemies.delete(e.id);
  e.dead = true;
  if (dead) {
    const gear=require('./actor-items');
    e.harvest=gear.harvest(e.def,rnd);
    e.deathBody=require('./corpses').add(room,{kind:'creature',name:e.def.name,def:e.def.id,level:e.level,x:e.x,y:e.y,outfit:gear.look(e.equip),items:[...gear.belongings(e),...e.harvest].map(x=>({...x}))});
  }
  if (dead) Spawner.onKilled(cs.spawn, e, Date.now(), G()); else Spawner.onRemoved(cs.spawn, e);
  room.broadcast({ t: 'enemy-remove', id: e.id, dead: dead ? 1 : 0, corpse: 1 });
}

// Игроки глазами ИИ
function aiPlayers(room) {
  return [...room.players.values()].filter((c) => !realtime.godOf(c.account.id).invisible && !magic().hidden(c) && !levels().airborne(c) && !levels().submerged(c)).map((c) => ({ id: c.account.id, x: c.pos.x, y: c.pos.y, dead: cbOf(c).dead, radius: PLAYER_RADIUS, level: c.character.level || 1, name: c.character.name }));
}
// Строительство (server/building.js) подключается лениво: оно само зависит от боя (колья)
const building = () => require('./building');
// Спутники (server/companions.js) — тоже лениво: они зависят от боя
const companions = () => require('./companions');
// Магия (server/magic.js) — лениво: она зависит от боя
const magic = () => require('./magic');
const vehicles = () => require('./vehicles'); // транспорт (шаг 14): бортовое оружие, броня машины, скорость
const levels = () => require('./levels'); // вертикальные уровни (шаг 13): заселение, высота полёта
const settlements = () => require('./settlements'); // поселения (шаг 15): жители, стража, мирная зона
const worldedit = () => require('./worldedit'); // стройка чит-панели (шаг 21)
const factions = () => require('./factions'); // фракции (шаг 16)
const quests = () => require('./quests'); // задания (шаг 16)
// Путь сквозь постройки (для штурма базы): поиск без учёта слоя блоков
function breachPath(room, e, x, y) {
  room.map.ignoreBlocks = true;
  try { return M.findPath(room.grid, Math.floor(e.x), Math.floor(e.y), Math.floor(x), Math.floor(y), G().aiPathMaxNodes) || []; } finally { room.map.ignoreBlocks = false; }
}
function aiCtx(room, now, players = aiPlayers(room)) {
  const cs = stateOf(room);
  const turrets = [...cs.turrets.values()].map((t) => ({ id: t.id, x: t.x, y: t.y, dead: false, radius: G().turretRadius, level: 1, name: Items.get(t.item).name, turret: true }));
  return {
    map: room.map, grid: room.grid, game: G(), now, rnd, players: [...players, ...turrets, ...companions().aiTargets(room), ...settlements().aiTargets(room)], enemies: [...cs.enemies.values()],
    isSafe: (x, y) => isSafeAt(room, x, y),
    peaceful: (e, p) => factions().peaceful(room, e, p), // фракции (шаг 16): член дружественной банды не нападает первым
    attack: (e, t) => enemyAttack(room, e, t, now),
    breachPath: room.map.blocks && room.map.blocks.size ? (e, x, y) => breachPath(room, e, x, y) : null,
    blockAt: (x, y) => building().blockAt(room, x, y),
    hitPiece: (e, p) => {
      fx(room, { k: 'swing', o: 'e', id: e.id, x: round2(e.x), y: round2(e.y), a: round2(Math.atan2(p.y + 0.5 - e.y, p.x + 0.5 - e.x)), r: e.def.attack.range, f: 'claw' });
      const [lo, hi] = e.damage;
      building().hitPiece(room, p, lo + (hi - lo) * rnd());
    },
  };
}

// ---------- Урон ----------

// Кто враждебен атакующему: для игрока — враги (и другие игроки при PvP), для врага — игроки
function hostiles(room, owner) {
  const cs = stateOf(room);
  const out = [];
  if (owner.kind === 'c') {
    for (const e of cs.enemies.values()) if (require('./enemy-behaviour').hostile(e) && (!(e.hiddenUntil > Date.now())) && (e.target || owner.ent.target === e.id || !owner.c || !require('./factions').peacefulTo(owner.c, e))) out.push({ kind: 'e', ref: e, x: e.x, y: e.y, r: e.def.radius });
    return out;
  }
  if (owner.kind === 'p') {
    const now = Date.now();
    for (const e of cs.enemies.values()) if (require('./enemy-behaviour').hostile(e) && !(e.hiddenUntil > now)) out.push({ kind: 'e', ref: e, x: e.x, y: e.y, r: e.def.radius });
    if (pvpOn(room)) for (const c of room.players.values()) if (c.account.id !== owner.id && !cbOf(c).dead && !(owner.c && settlements().pvpBlocked(room, owner.c.pos, c.pos))) out.push({ kind: 'p', ref: c, x: c.pos.x, y: c.pos.y, r: PLAYER_RADIUS });
    out.push(...settlements().hostileNpcs(room, owner)); // житель поселения — только выбранный целью или напавший стражник
  } else {
    // под водой в подлодке (alt < 0) врагам не достать
    for (const c of room.players.values()) if (!cbOf(c).dead && !levels().submerged(c)) out.push({ kind: 'p', ref: c, x: c.pos.x, y: c.pos.y, r: PLAYER_RADIUS });
  }
  return out;
}

// Нанести удар цели. owner: { kind: 'p', c } | { kind: 'e', e }; prof — профиль атаки; factor — множитель (дробь, цепь)
function applyHit(room, owner, target, prof, factor = 1, opts = {}) {
  const now = Date.now();
  if (owner.kind === 'c') {
    if (target.kind !== 'e') return 0;
    const rolled=Combat.rollDamage({...prof,damage:prof.damage||[0,0],flags:prof.flags||[]},null,rnd),amount=rolled.amount*factor;
    const dealt = companionHit(room, owner.ent, target.ref, amount, prof.damageType, owner.c, prof.flags || [],rolled.crit);
    if (dealt > 0 && (prof.lifesteal || prof.flags?.includes('lifesteal') || owner.ent.vampirism?.until > now)) { const rec=require('../shared/companions').list(owner.c.character).find(r=>r.id===owner.id); if(rec)rec.hp=Math.min(require('../shared/companions').statsOf(rec).maxHp,rec.hp+dealt*((prof.lifesteal||0.06)+(owner.ent.vampirism?.until>now?owner.ent.vampirism.factor:0))); }
    if (!target.ref.dead) applyEffects(room, owner, target, prof, dealt, now);
    return dealt;
  }
  const g = G();
  const stats = owner.kind === 'p' ? owner.c.character.stats : null;
  let roll;
  if (owner.kind === 'p') { roll = Combat.rollDamage(prof, stats, rnd); roll.amount *= (1 - Survival.effects(owner.c.character).penalty) * magic().weakFactor(owner.c); }
  else {roll=Combat.rollDamage({...prof,damage:prof.damage||owner.e.damage,flags:prof.flags||[],stealthCrit:owner.e.hiddenUntil>now},null,rnd);if(owner.e.weakUntil>now)roll.amount*=owner.e.weakFactor||1;}
  const flags = prof.flags || [];
  let amount = flags.includes('nonLethal') ? 0 : roll.amount * factor;
  let dmg = 0;
  if (target.kind === 'n') return settlements().hurt(room, target.ref, amount, roll.type, owner); // житель поселения (шаг 15)
  if (target.kind === 'e') {
    const e = target.ref;
    if (e.dead || e.god) return 0; // e.god — бессмертие (чит-панель, шаг 21)
    if (flags.includes('emp') && (e.def.tags.includes('robot') || e.def.tags.includes('cyborg'))) amount *= g.empRobotFactor;
    if (prof.undead && e.def.family === 'zombie') amount *= prof.undead; // свет жжёт нежить
    dmg = amount > 0 ? Combat.mitigate(amount, roll.type, e.defense + magic().enemyDefense(e, now), e.def.resist, flags) : 0;
    dmg = magic().absorb(e, dmg, now); // щит мага
    e.hp -= dmg;
  if(dmg>0)e.hurtAt=Date.now();
    if (owner.kind === 'p' && dmg > 0) {
      const life = Items.setEffects(owner.c.character).lifesteal + (prof.lifesteal || (prof.flags.includes('lifesteal') ? 0.06 : 0)) + (cbOf(owner.c).vampirism?.until > now ? cbOf(owner.c).vampirism.factor : 0);
      if (life) { const v=owner.c.character.vitals;v.hp=Math.min(maxVitals(owner.c.character).hp,v.hp+Math.min(dmg,Math.max(0,e.hp+dmg))*life);markDirty(owner.c); }
    }
    if (dmg > 0 && owner.kind === 'p' && prof.mode && !prof.superAttack && !prof.charged) {
      prof.charged = true; const cb = cbOf(owner.c); cb.superCharge = Math.min(100, (cb.superCharge || 0) + (prof.mode === 'special' ? 18 : 12));
    }
    if (owner.kind === 'p') {
      e.hitBy.set(owner.c.account.id, (e.hitBy.get(owner.c.account.id) || 0) + dmg);
      factions().onHit(room, owner.c, e); // удар по члену дружественной фракции — обида
      // по врагу стреляла турель — он идёт разбивать её, а не хозяина
      const src = owner.turret && room.combat.turrets.has(owner.turret.id) ? owner.turret : null;
      AI.onDamaged(aiCtx(room, now), e, src ? { id: src.id, x: src.x, y: src.y } : { id: owner.c.account.id, x: owner.c.pos.x, y: owner.c.pos.y });
    }
    fx(room, { k: 'hit', t: 'e', id: e.id, n: dmg, c: roll.crit ? 1 : 0, d: roll.type });
  } else {
    const c = target.ref, cb = cbOf(c);
    if(owner.kind==='p'||owner.kind==='c')return 0;
    if (cb.dead) return 0;
    if (c.veh && amount > 0) { const soaked = vehicles().soak(room, c, amount, roll.type); if (soaked !== null) { cb.lastCombatAt = now; return 0; } } // удар принимает закрытая машина
    const def = Combat.heroDefense(c.character);
    dmg = amount > 0 ? Combat.mitigate(amount, roll.type, def.defense + magic().enemyDefense(cb, now), def.resist, flags) : 0;
    if (realtime.godOf(c.account.id).invulnerable) dmg = 0; // неуязвимый администратор
    dmg = magic().absorb(cb, dmg, now); // щит заклинания
    if (dmg > 0) magic().onHurt(c);
    c.character.vitals.hp -= dmg;
    if(owner.kind==='e'&&dmg>0){const caster=stateOf(room).enemies.get(owner.id),vamp=caster?.vampirism?.until>now?caster.vampirism.factor:0,factor=(prof.lifesteal||0)+vamp;if(caster&&factor)caster.hp=Math.min(caster.maxHp,caster.hp+Math.min(dmg,Math.max(0,c.character.vitals.hp+dmg))*factor);}
    cb.lastCombatAt = now;
    if (dmg > 0) wearArmor(c);
    markDirty(c);
    fx(room, { k: 'hit', t: 'p', id: c.account.id, n: dmg, c: roll.crit ? 1 : 0, d: roll.type });
  }
  applyEffects(room, owner, target, prof, dmg, now);
  if (target.kind === 'p' && dmg > 0) survival.stopRest(room, target.ref, 'Вас атаковали — вы вскакиваете!');
  // цепная молния
  if (flags.includes('chain') && !opts.chained) {
    const others = hostiles(room, owner.kind === 'p' ? { kind: 'p', id: owner.c.account.id } : { kind: 'e' })
      .filter((h) => h.ref !== target.ref && Math.hypot(h.x - tx(target), h.y - ty(target)) <= g.chainRange)
      .sort((a, b) => Math.hypot(a.x - tx(target), a.y - ty(target)) - Math.hypot(b.x - tx(target), b.y - ty(target)))
      .slice(0, g.chainTargets);
    for (const h of others) {
      fx(room, { k: 'chain', x: round2(tx(target)), y: round2(ty(target)), x2: round2(h.x), y2: round2(h.y) });
      applyHit(room, owner, h, prof, factor * g.chainFactor, { chained: true });
    }
  }
  checkDeath(room, owner, target);
  return dmg;
}
const tx = (t) => (t.ref.pos ? t.ref.pos.x : t.ref.x);
const ty = (t) => (t.ref.pos ? t.ref.pos.y : t.ref.y);

function applyEffects(room, owner, target, prof, dmg, now) {
  const g = G();
  const flags = prof.flags || [];
  const ent = target.kind === 'e' ? target.ref : cbOf(target.ref);
  if (flags.includes('stun') && rnd() < g.stunChance) ent.stunUntil = now + g.stunSec * 1000;
  if (flags.includes('immobilize')) ent.immobileUntil = now + g.trapImmobilizeSec * 1000;
  const controlScale = prof.freezeSec && target.kind==='e' && target.ref.def.boss ? 0.4 : 1;
  if (prof.stunSec) ent.stunUntil = Math.max(ent.stunUntil || 0, now + prof.stunSec * controlScale * 1000); // оглушающее заклинание
  if (prof.rootSec) ent.immobileUntil = Math.max(ent.immobileUntil || 0, now + prof.rootSec * controlScale * 1000);
  if (prof.freezeSec) {ent.frozenUntil=now+prof.freezeSec*controlScale*1000;fx(room,{k:'status',t:target.kind,id:target.kind==='p'?target.ref.account.id:target.ref.id,f:'frozen',ms:prof.freezeSec*controlScale*1000});}
  else if (prof.rootSec) fx(room,{k:'status',t:target.kind,id:target.kind==='p'?target.ref.account.id:target.ref.id,f:/ice|frost|icicle/i.test(prof.fx||'')?'iceRoot':'roots',ms:prof.rootSec*1000}); // оковы льда
  const dots = { burn: g.dotBurnFactor, poison: g.dotPoisonFactor, bleed: g.dotBleedFactor };
  for (const [k, f] of Object.entries(dots)) {
    if (flags.includes(k) && dmg > 0) {
      ent.dots = (ent.dots || []).filter((d) => d.k !== k);
      if(k==='burn')fx(room,{k:'status',t:target.kind,id:target.kind==='p'?target.ref.account.id:target.ref.id,f:'burn',ms:g.dotDurationSec*1000});
      ent.dots.push({ k, perSec: Math.max(0.5, dmg * f), until: now + g.dotDurationSec * 1000, type: k === 'burn' ? 'fire' : k === 'poison' ? 'poison' : 'physical', acc: 0, owner });
    }
  }
  // притянуть к атакующему / отбросить
  const src = owner.kind === 'p' ? owner.c.pos : owner.kind === 'c' ? owner.ent : owner.e;
  if (flags.includes('pull')) {
    shove(room, target, src, -g.pullDistance, 1);
    bind(target, ent, owner, now);
  }
  if (flags.includes('knockback')) shove(room, target, src, g.knockbackDistance, 0);
}

// Лассо связывает цель: она не двигается и не атакует lassoHoldSec (+ за каждое очко Приручения выше 1; боссы — короче).
// Отметка lassoBy / lassoUntil — зацепка для приручения (этап спутников): связанного зверя можно будет приручить.
function bind(target, ent, owner, now) {
  const g = G();
  const taming = owner.kind === 'p' ? (owner.c.character.stats && owner.c.character.stats.taming) || 1 : 1;
  let sec = g.lassoHoldSec + Math.max(0, taming - 1) * g.lassoHoldPerTaming;
  if (target.kind === 'e' && target.ref.def.boss) sec *= g.lassoBossHoldFactor;
  if (sec <= 0) return;
  const until = now + sec * 1000;
  ent.stunUntil = Math.max(ent.stunUntil || 0, until);
  ent.immobileUntil = Math.max(ent.immobileUntil || 0, until);
  ent.boundUntil = until;
  if (target.kind === 'e') {
    target.ref.lassoBy = owner.kind === 'p' ? owner.c.account.id : null;
    target.ref.lassoUntil = until;
  }
}

// Сдвинуть цель от точки src на dist клеток (отрицательное — к точке, но не ближе minGap)
function shove(room, target, src, d, minGap) {
  const p = target.kind === 'e' ? target.ref : target.ref.pos;
  const dx = p.x - src.x, dy = p.y - src.y, len = Math.hypot(dx, dy) || 1;
  let move = d;
  if (d < 0) move = -Math.max(0, Math.min(-d, len - minGap));
  const steps = Math.ceil(Math.abs(move) / 0.25);
  let cx = p.x, cy = p.y;
  for (let i = 0; i < steps; i++) {
    const nx = cx + (dx / len) * (move / steps), ny = cy + (dy / len) * (move / steps);
    if (!M.posWalkable(room.map, nx, ny)) break;
    if (target.kind === 'e' && !target.ref.ignoreSafe && isSafeAt(room, nx, ny)) break;
    cx = nx; cy = ny;
  }
  if (target.kind === 'e') { target.ref.x = cx; target.ref.y = cy; target.ref.path = []; } else { target.ref.pos = { x: cx, y: cy }; target.ref.path = []; }
}

function checkDeath(room, owner, target) {
  if (target.kind === 'e') { if (target.ref.hp <= 0 && !target.ref.dead) killEnemy(room, target.ref, owner.kind === 'p' ? owner.c : null); }
  else if (target.ref.character.vitals.hp <= 0 && !cbOf(target.ref).dead) killPlayer(room, target.ref, owner);
}

// Износ брони героя при попадании
function wearArmor(c) {
  if (rnd() >= G().durabilityLossChance) return;
  const eq = c.character.inventory.equipment;
  const pieces = Object.values(eq).filter((x) => x && x.dur > 0 && (Items.get(x.id) || {}).armor);
  if (!pieces.length) return;
  const x = pieces[Math.floor(rnd() * pieces.length)];
  x.dur -= 1;
  if (x.dur === 0) chat.tell(c, `«${Items.get(x.id).name}» сломалось и больше не защищает. Почините его (ремонт появится вместе с крафтом).`);
  cbOf(c).invDirtyAt = cbOf(c).invDirtyAt || Date.now();
}

// ---------- Смерть врага: опыт и добыча ----------

// Урон от окружения (колья базы): без атакующего, опыт — героям рядом
function envDamage(room, e, amount) {
  if (e.dead || e.god) return 0;
  const dmg = Math.max(1, Math.round(amount));
  e.hp -= dmg;
  if(dmg>0)e.hurtAt=Date.now();
  fx(room, { k: 'hit', t: 'e', id: e.id, n: dmg, c: 0, d: 'physical' });
  if (e.hp <= 0 && !e.dead) killEnemy(room, e, null);
  return dmg;
}

// Удар спутника или дыхание верхового дракона (server/companions.js): attacker { id, x, y } — на кого злится враг,
// killer — хозяин (опыт и добыча как за своё убийство)
function companionHit(room, attacker, e, amount, type, killer, flags = [],crit=false) {
  if (!e || e.dead || e.god) return 0;
  const now = Date.now();
  let dmg = amount > 0 ? Combat.mitigate(amount, type, e.defense + magic().enemyDefense(e, now), e.def.resist, flags) : 0;
  dmg = magic().absorb(e, dmg, now);
  e.hp -= dmg;
  if(dmg>0)e.hurtAt=Date.now();
  const live = killer && room.players.get(killer.account.id) === killer ? killer : null;
  if (live) e.hitBy.set(live.account.id, (e.hitBy.get(live.account.id) || 0) + dmg);
  AI.onDamaged(aiCtx(room, Date.now()), e, attacker);
  fx(room, { k: 'hit', t: 'e', id: e.id, n: dmg, c:crit?1:0, d: type });
  if (e.hp <= 0 && !e.dead) killEnemy(room, e, live);
  return dmg;
}

function killEnemy(room, e, killer) {
  const g = G();
  removeEnemy(room, e, true);
  fx(room, { k: 'die', t: 'e', id: e.id, x: round2(e.x), y: round2(e.y) });
  // опыт делится между живыми героями рядом и теми, кто ранил врага
  const share = [...room.players.values()].filter((c) => !cbOf(c).dead && (e.hitBy.has(c.account.id) || Math.hypot(c.pos.x - e.x, c.pos.y - e.y) <= g.xpShareRadius));
  if (killer && !share.includes(killer) && !cbOf(killer).dead) share.push(killer);
  if (share.length) {
    const each = Math.ceil(e.xp / share.length);
    for (const c of share) grantXp(room, c, each);
  }
  factions().onKill(room, e, share); // репутация фракции убитого (шаг 16)
  quests().onKill(room, e, share); // цели заданий «убить» (шаг 16)
  if (killer && e.def.spells) magic().onMageKilled(room, killer, e); // сила убитого мага переходит к убийце
  dropLoot(room, e);
}

function grantXp(room, c, amount) {
  const r = Combat.addXp(c.character, amount);
  markDirty(c);
  companions().onOwnerXp(room, c, r.gained);
  fx(room, { k: 'xp', id: c.account.id, n: r.gained });
  if (r.levels) {
    fx(room, { k: 'levelup', id: c.account.id, lvl: c.character.level });
    chat.tell(c, `Новый уровень: ${c.character.level}! Свободных очков характеристик: ${c.character.unspentPoints}. Откройте окно героя (C).`);
    persist(c);
    room.broadcast({ t: 'level', id: c.account.id, level: c.character.level });
  }
  return r;
}

function dropLoot(room, e) {
  const g = G();
  const remaining = Math.max(0, g.groundItemsMax - ground.list(room.id).length);
  const rows = (e.deathBody ? [] : [...require('./actor-items').belongings(e),...(e.harvest||[])]).slice(0, remaining).map(item => ({ item, pos: { x: round2(e.x), y: round2(e.y) }, by: e.def.name }));
  const drops = Enemies.rollLoot(e.def.loot, e.level, rnd);
  drops.push(...Items.rollSetLoot(rnd, g.setArmorDropChance ?? 0.20, g.setWeaponDropChance ?? 0.04));
  // событие «двойной лут»: больше бросков
  if (events.active('doubleloot', room.id)) for (let i = 1; i < g.eventLootMultiplier; i++) drops.push(...Enemies.rollLoot(e.def.loot, e.level, rnd));
  for (const d of drops) {
    if (rows.length >= remaining) break;
    let pos = null;
    for (let t = 0; t < 6 && !pos; t++) {
      const p = { x: round2(e.x + (rnd() - 0.5) * 2 * g.lootScatter), y: round2(e.y + (rnd() - 0.5) * 2 * g.lootScatter) };
      if (!M.validatePosition(room.map, p)) pos = p;
    }
    pos = pos || { x: round2(e.x), y: round2(e.y) };
    const it = Items.get(d.id);
    rows.push({ item: { id: d.id, n: d.n, dur: it.durability || undefined, made: it.spoils ? Date.now() : undefined }, pos, by: e.def.name });
  }
  for (const item of ground.addMany(room.id, rows)) room.broadcast({ t: 'ground-add', item });
  return drops;
}

// ---------- Смерть героя ----------

function killPlayer(room, c, owner) {
  const g = G(), cb = cbOf(c), ch = c.character, now = Date.now();
  if (c.veh) { try { vehicles().exit(c, true); } catch (e) { console.warn('[combat] высадка погибшего:', e.message); } }
  cb.dead = true; cb.superCharge = 0;
  const hardcore = Difficulty.get(room.world.difficulty||g.difficulty).resetOnDeath;
  const corpse = require('./corpses').add(room, { kind: 'hero', x: c.pos.x, y: c.pos.y, appearance: ch.appearance, look: Inv.look(ch), player: c.account.id, ownerLocked: hardcore });
  cb.reload = null;
  cb.sprint = false;
  cb.dots = [];
  c.path = []; c.dir = null; c.speedMul = 0;
  const lost = Combat.deathPenalty(ch, rnd);
  cb.respawnAt = now + g.respawnSec * 1000;
  const deathDropChance = hardcore || g.deathDropItems ? 1 : Difficulty.get(room.world.difficulty||g.difficulty).deathDrop;
  if (deathDropChance > 0) {
    Inv.ensure(ch);
    const rows = [];
    const remaining = Math.max(0, g.groundItemsMax - ground.list(room.id).length);
    const candidates = [];
    for (let i = 0; i < ch.inventory.cells.length; i++) if (ch.inventory.cells[i]) candidates.push({ c: 'cell', i });
    if (!g.deathDropItems) for (const [s, x] of Object.entries(ch.inventory.equipment)) if (x && s !== 'underwear') candidates.push({ c: 'eq', s });
    for (const from of candidates) {
      if (rows.length >= remaining || rnd() >= deathDropChance) continue;
      const removed = Inv.removeAt(ch, from);
      if (removed.error) continue;
      if (corpse) corpse.items.push(removed.item);
      else rows.push({ item: removed.item, pos: { x: round2(c.pos.x), y: round2(c.pos.y) }, by: ch.name });
    }
    if (!corpse) for (const item of ground.addMany(room.id, rows)) room.broadcast({ t: 'ground-add', item });
    sendInv(c);
  }
  dropLoot(room, { x: c.pos.x, y: c.pos.y, level: Math.min(g.maxEnemyLevel || 99, ch.level || 1), def: { name: ch.name, loot: 'raider' } });
  const statDef = lost && Rules.STATS.find((s) => s.id === lost);
  const by = owner && owner.kind === 'e' ? owner.e.def.name : owner && owner.kind === 'p' ? owner.c.character.name : null;
  fx(room, { k: 'die', t: 'p', id: c.account.id, x: round2(c.pos.x), y: round2(c.pos.y) });
  realtime.send(c, { t: 'dead', stat: lost, statLabel: statDef ? statDef.label : null, respawnIn: g.respawnSec * 1000, deaths: ch.deaths, by, stats: ch.stats, hardcore: hardcore ? 1 : 0 });
  chat.system(room.id, `${ch.name} погибает${by ? ` (${by})` : ''}.`);
  persist(c);
  sendMe(c, true);
}

// Точка возрождения: последнее посещённое поселение этого мира или точка появления мира
function respawnPoint(room, c) {
  const bed = building().bedPoint(room, c);
  if (bed) return bed;
  const sid = c.character.lastSettlement && c.character.lastSettlement[room.id];
  const s = sid != null && (room.map.settlements || []).find((x) => x.id === sid);
  return s ? { x: s.x, y: s.y } : room.map.spawn;
}

function respawn(room, c, force = false) {
  const cb = cbOf(c), g = G();
  if (!cb.dead) return 'Вы живы.';
  if (!force && Date.now() < cb.respawnAt) return `Возродиться можно через ${Math.ceil((cb.respawnAt - Date.now()) / 1000)} с.`;
  const hardcore = Difficulty.get(room.world.difficulty||g.difficulty).resetOnDeath;
  if (hardcore) resetHardcoreCharacter(c);
  const p = realtime.freeSpawn(room, hardcore ? room.map.spawn : respawnPoint(room, c));
  const max = maxVitals(c.character);
  c.character.vitals = { hp: Math.max(1, Math.round(max.hp * g.respawnHpFraction)), stamina: max.stamina, mp: max.mp };
  cb.dead = false; cb.dots = []; cb.stunUntil = 0; cb.immobileUntil = 0;
  if (room.level && levels().respawnOut(c)) { survival.onRespawn(c.room, c); markDirty(c); sendMe(c, true); return null; } // с уровня — на поверхность у входа (шаг 13)
  c.pos = p; c.path = []; c.dir = null; c.speedMul = 1;
  room.broadcast({ t: 'respawned', id: c.account.id, x: round2(p.x), y: round2(p.y) });
  survival.onRespawn(room, c);
  markDirty(c);
  sendMe(c, true);
  return null;
}

function resetHardcoreCharacter(c) {
  const ch = c.character, stats = Object.fromEntries(Rules.STATS.map(s => [s.id, 1]));
  const comps = companions();
  if (c.room && c.room.comp) for (const ent of [...c.room.comp.ents.values()]) if (ent.owner === c.account.id) comps.removeEnt(c.room, ent.id);
  if (Object.hasOwn(stats, 'shops')) stats.shops = 1;
  ch.level = 1; ch.xp = 0; ch.stats = stats; ch.unspentPoints = Rules.START_POINTS; ch.spells = [];
  ch.companions = []; ch.shrinker = null; ch.family = []; ch.reputation = {}; ch.positions = {}; ch.lastWorld = null; ch.lastSettlement = {};
  ch.inventory = Inv.empty(); Inv.applyKit(ch, gStartingKit());
  const max = Rules.derive(stats, 1);
  ch.vitals = { hp: max.maxHp, stamina: max.maxStamina, mp: max.maxMp };
  if (typeof ch.survival === 'object') ch.survival = null;
  sendInv(c);
}
const gStartingKit = () => G().startingKit;

// ---------- Атака игрока ----------

function reject(c, reason, text) {
  const cb = cbOf(c);
  if (['cooldown', 'range'].includes(reason)) cb.rejects++;
  realtime.send(c, { t: 'atk-reject', reason, message: text });
  return reason;
}

// Какое оружие в слоте и его профиль (сломанное оружие — кулаки)
function weaponIn(c, slot) {
  const inst = c.character.inventory.equipment[slot];
  const it = inst && Items.get(inst.id);
  if (!it || !it.weapon) return { inst: null, item: null, prof: Combat.profile(null), broken: false };
  if (inst.dur === 0) return { inst, item: it, prof: Combat.profile(null), broken: true };
  return { inst, item: it, prof: Combat.profile(it), broken: false };
}

function onAtk(c, msg) {
  const room = c.room, cb = cbOf(c), now = Date.now(), g = G(), ch = c.character;
  let slot = msg.slot === 'off' ? 'offHand' : 'mainHand';
  if (cb.dead) return reject(c, 'dead', 'Вы погибли.');
  if (cb.stunUntil > now) return reject(c, 'stunned', 'Вы оглушены.');
  survival.stopRest(room, c, null); // атака — встать
  if (c.veh) { const vr = vehicles().attack(c, msg); if (vr !== undefined) return vr ? reject(c, 'vehicle', vr) : null; } // бортовое оружие (шаг 14)
  const mode = Object.hasOwn(Combat.ATTACK_MODES, msg.mode) ? msg.mode : 'normal';
  const god = realtime.godOf(c.account.id), superAttack = msg.super === true;
  if (superAttack && !god.superAttack && (cb.superCharge || 0) < 100) return reject(c, 'charge', 'Суперудар ещё не накоплен. Заряжайте его попаданиями.');
  const slots = mode === 'dualThrow' ? ['mainHand', 'offHand'] : [slot];
  const attacks = slots.map(hand => {
    const w = weaponIn(c, hand);
    return { ...w, slot: hand, prof: Combat.attackProfile(w.broken ? null : w.item, mode, superAttack) };
  });
  for (const a of attacks) {
    if (a.slot === 'offHand' && !a.item) return reject(c, 'no-weapon', 'Во второй руке нет оружия.');
    if (!a.prof) return reject(c, 'mode', 'Для этого режима нужно исправное метательное оружие в каждой используемой руке.');
  }
  const w = attacks[0], prof = w.prof;
  if (prof.kind === 'place') return placeItem(c, w.inst.id, msg.x, msg.y);
  if (prof.kind === 'melee' && levels().airborne(c)) return reject(c, 'range', 'В воздухе ближний бой невозможен — снизьтесь или стреляйте.');
  // скорость атаки: не чаще, чем позволяет оружие (с допуском на сеть)
  if (attacks.some(a => now - cb.last[a.slot] < Combat.cooldownMs(a.prof) * g.attackSpeedTolerance)) return reject(c, 'cooldown', 'Слишком быстро.');
  if (cb.reload) return reject(c, 'reload', 'Идёт перезарядка.');
  // цель
  let target = null, aim = null;
  if (msg.tk === 'e' && typeof msg.target === 'string') {
    const e = stateOf(room).enemies.get(msg.target);
    if (!e || e.dead) return reject(c, 'target', 'Цель уже недоступна.');
    target = { kind: 'e', ref: e, x: e.x, y: e.y, r: e.def.radius };
  } else if (msg.tk === 'p' && typeof msg.target === 'string') {
    const o = room.players.get(msg.target);
    if (!o || o === c || cbOf(o).dead) return reject(c, 'target', 'Цель уже недоступна.');
    if (!pvpOn(room)) return reject(c, 'pvp', 'В этом мире игроки не могут сражаться друг с другом (PvP выключен).');
    if (settlements().pvpBlocked(room, c.pos, o.pos)) return reject(c, 'pvp', 'Поселение — мирная зона: здесь игроки не сражаются.');
    target = { kind: 'p', ref: o, x: o.pos.x, y: o.pos.y, r: PLAYER_RADIUS };
  } else if (msg.tk === 'n' && typeof msg.target === 'string') { // житель поселения (шаг 15): нападение — преступление
    const n = settlements().entOf(room, msg.target);
    if (!n) return reject(c, 'target', 'Цель уже недоступна.');
    target = { kind: 'n', ref: n, x: n.x, y: n.y, r: n.radius };
  }
  if (target) aim = { x: target.x, y: target.y };
  else if (Number.isFinite(msg.x) && Number.isFinite(msg.y)) aim = { x: msg.x, y: msg.y };
  else return reject(c, 'target', 'Не указана цель.');
  if (aim.x === c.pos.x && aim.y === c.pos.y) aim = { x: aim.x + 0.01, y: aim.y };
  // дальность ближнего боя
  if (prof.kind === 'melee' && target && dist(c.pos, target) > prof.range + target.r + g.meleeRangeTolerance) return reject(c, 'range', 'Слишком далеко — подойдите ближе.');
  if(attacks.some(a=>a.prof.skyRain&&dist(c.pos,aim)>a.prof.range))return reject(c,'range','Область огненного залпа слишком далеко.');
  // Validate both hands before changing ammunition, vitals or cooldowns.
  const inf = god.infiniteAmmo;
  for (const a of attacks) {
    const p = a.prof, direct = p.ammo && !(p.magazine > 0);
    if (p.ammo && !inf && (direct ? !Inv.rounds(ch,p.ammo) : !((a.inst.mag || 0) > 0))) {
      if (!direct && Inv.rounds(ch,p.ammo)) { startReload(c,a.slot); return reject(c,'reload','Перезарядка…'); }
      return reject(c,'noammo',`Нет боеприпасов: «${Items.get(p.ammo).name}».`);
    }
  }
  const stCost = attacks.reduce((n,a)=>n+Combat.staminaCost(a.prof),0), mpCost = attacks.reduce((n,a)=>n+Combat.mpCost(a.prof),0);
  if (!god.infinite && ch.vitals.stamina < stCost) return reject(c,'stamina','Не хватает выносливости.');
  if (!god.infinite && ch.vitals.mp < mpCost) return reject(c,'mp','Не хватает маны.');
  cb.lastCombatAt = now;
  if (!god.infinite) { ch.vitals.stamina -= stCost; ch.vitals.mp -= mpCost; }
  if (superAttack && !god.superAttack) cb.superCharge = 0;
  if (mode === 'throw') cb.nextThrow = slot === 'mainHand' ? 'offHand' : 'mainHand';
  let invChanged = false;
  const owner = { kind: 'p', c, id: c.account.id, npc: target && target.kind === 'n' ? target.ref.id : null };
  const dir = { x: aim.x - c.pos.x, y: aim.y - c.pos.y };
  const stealthCrit=magic().hidden(c);for(const a of attacks)a.prof={...a.prof,stealthCrit};magic().onAttack(c);
  for (const a of attacks) {
    const p = a.prof;
    cb.last[a.slot] = now;
    if (p.ammo && !inf) {
      if (!p.magazine) { Inv.takeRounds(ch,p.ammo,1); invChanged = true; } else a.inst.mag -= 1;
    }
    if (p.skyRain) {
      require('./magic-fields').add(room,owner,{stealthCrit:p.stealthCrit,id:'weapon_fire_arrow_rain',type:'fire',fx:'fireArrowRain',radius:3,dur:3,pulse:1,damage:p.damage.map(n=>n/3),flags:p.flags.filter(f=>!['chain','area','explosive','stun'].includes(f)),superAttack:true},1,aim);
      fx(room,{k:'spell',o:'p',id:owner.id,s:'weapon_fire_arrow_rain',x:c.pos.x,y:c.pos.y});
    }
    else if (p.kind === 'melee') meleeStrike(room,owner,c.pos,dir,p,target);
    else if (p.kind === 'cone') coneStrike(room,owner,c.pos,dir,p,g.flameConeDeg);
    else {
      const ammo = p.ammo && Items.get(p.ammo);
      // любое метательное оружие (топорики, ножи, звёздочки, диски) не расходуется: видно в полёте и снова появляется в руке
      shoot(room,owner,c.pos,dir,p,{drop:p.kind==='thrown'?null:ammo && ammo.recoverable?ammo.id:null,hand:a.slot});
    }
    if (p.kind !== 'melee' && !p.flags.includes('silent')) AI.onNoise(aiCtx(room,now),c.pos.x,c.pos.y,{id:c.account.id},g.noiseRadius);
    if (a.inst && a.inst.dur > 0 && rnd() < g.durabilityLossChance) {
      a.inst.dur -= 1; cb.invDirtyAt = cb.invDirtyAt || now;
      if (!a.inst.dur) { chat.tell(c,`«${a.item.name}» сломалось.`); invChanged = true; }
    }
    if (p.ammo && p.magazine && a.inst.mag <= 0 && Inv.rounds(ch,p.ammo)) startReload(c,a.slot);
  }
  if (superAttack && !attacks.some(a=>a.prof.skyRain)) fx(room,{k:'boom',x:c.pos.x,y:c.pos.y,r:2,f:'holy'});
  markDirty(c);
  if (invChanged) sendInv(c);
  sendMe(c);
  return null;
}

function meleeStrike(room, owner, pos, dir, prof, target) {
  const g = G();
  const cleave = prof.flags.includes('cleave');
  fx(room, { k: 'swing', o: owner.kind, id: owner.id, x: round2(pos.x), y: round2(pos.y), a: round2(Math.atan2(dir.y, dir.x)), r: prof.range, f: prof.fx });
  const inArc = (h) => dist(pos, h) <= prof.range + h.r + g.meleeRangeTolerance && Combat.angleBetween(dir.x, dir.y, h.x - pos.x, h.y - pos.y) <= g.cleaveArcDeg / 2;
  const list = hostiles(room, owner);
  let hits = [];
  if (cleave) hits = list.filter(inArc);
  else if (target) hits = [list.find((h) => h.ref === target.ref)].filter(Boolean);
  else { const cand = list.filter(inArc).sort((a, b) => dist(pos, a) - dist(pos, b)); hits = cand.slice(0, 1); }
  for (const h of hits) applyHit(room, owner, h, prof);
  return hits.length;
}

function coneStrike(room, owner, pos, dir, prof, deg) {
  fx(room, { k: 'cone', o: owner.kind, id: owner.id, x: round2(pos.x), y: round2(pos.y), a: round2(Math.atan2(dir.y, dir.x)), r: prof.range, w: deg, f: prof.fx });
  const hits = hostiles(room, owner).filter((h) => dist(pos, h) <= prof.range + h.r && Combat.angleBetween(dir.x, dir.y, h.x - pos.x, h.y - pos.y) <= deg / 2);
  for (const h of hits) applyHit(room, owner, h, prof);
  return hits.length;
}

// Снаряды: сервер двигает их каждый тик и проверяет пересечение отрезка пути с целями
function shoot(room, owner, pos, dir, prof, opts = {}) {
  const g = G(), cs = stateOf(room);
  const base = Math.atan2(dir.y, dir.x);
  const angles = [base];
  if (prof.flags.includes('spread') && g.spreadPellets > 1) {
    const half = (g.spreadConeDeg / 2) * Math.PI / 180;
    for (let i = 1; i < g.spreadPellets; i++) angles.push(base - half + (2 * half * i) / g.spreadPellets);
  }
  angles.forEach((a, i) => {
    const p = {
      id: 'p' + crypto.randomBytes(3).toString('hex'), owner, prof, x: pos.x, y: pos.y, vx: Math.cos(a) * prof.proj, vy: Math.sin(a) * prof.proj,
      left: prof.range, factor: i === 0 ? 1 : g.spreadSecondaryFactor, drop: i === 0 ? opts.drop : null,
      // бортовое оружие техники (server/vehicles.js attack): mode — torpedo (только по воде) / bomb (падает в точку),
      // track — цель управляемой ракеты ('e:id' | 'p:id' | 'n:id'), air — выпущен с высоты (летит над деревьями и стенами)
      mode: opts.mode || null, track: opts.track || null, aim: opts.aim || null, air: opts.alt > 0, steerAt: 0,
    };
    if (opts.mode === 'bomb') p.left = Math.min(prof.range, opts.fall || prof.range);
    cs.projectiles.push(p);
    const shot = { k: 'shot', id: p.id, o: owner.kind, by: owner.id, x: round2(p.x), y: round2(p.y), a: round2(a), s: prof.proj, r: round2(p.left), f: prof.fx, item: prof.item, hand: opts.hand, super: Boolean(prof.superAttack) };
    if (opts.veh) Object.assign(shot, { veh: opts.veh, hp: opts.hp, h: opts.h, alt: opts.alt || 0, up: Boolean(opts.up) });
    fx(room, shot);
  });
}

function stepProjectiles(room, dt) {
  const cs = stateOf(room), g = G();
  const keep = [];
  for (const p of cs.projectiles) {
    if (p.track || (p.aim && p.prof.turn > 0)) steer(room, p, dt);
    const speed = Math.hypot(p.vx, p.vy);
    let travel = Math.min(p.left, speed * dt);
    let done = false;
    const x0 = p.x, y0 = p.y;
    const x1 = x0 + (p.vx / speed) * travel, y1 = y0 + (p.vy / speed) * travel;
    // первая цель на отрезке
    let best = null, bt = 2;
    const water = (x, y) => { const b = WorldGen.BIOMES[WorldGen.tileAt(room.map, Math.floor(x), Math.floor(y))]; return Boolean(b && (b.swim || b.underwater)); };
    // бомба падает: по пути никого не задевает; торпеда бьёт только тех, кто в воде
    if (p.mode !== 'bomb') for (const h of hostiles(room, p.owner.kind === 'p' || p.owner.kind === 'c' ? p.owner : { kind: 'e' })) {
      if (p.mode === 'torpedo' && !water(h.x, h.y)) continue;
      const t = Combat.segmentCircle(x0, y0, x1, y1, h.x, h.y, h.r + g.projectileRadius);
      if (t >= 0 && t < bt) { bt = t; best = h; }
    }
    // стена (горы) по пути
    let wallT = 2, wallCell = null;
    const steps = Math.max(1, Math.ceil(travel / 0.3));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const tx0 = Math.floor(x), ty0 = Math.floor(y), tile = WorldGen.tileAt(room.map, tx0, ty0);
      const nature = worldedit().treeAt(room, ty0 * room.map.width + tx0);
      const piece = building().blockAt(room, tx0, ty0);
      const out = x < 0 || y < 0 || x >= room.map.width || y >= room.map.height;
      if (p.mode === 'bomb' || p.air) { if (out) { wallT = (i - 1) / steps; wallCell = { x: tx0, y: ty0 }; break; } continue; } // сверху — над деревьями и стенами
      if (p.mode === 'torpedo' && !out && !water(x, y)) { wallT = (i - 1) / steps; wallCell = { x: tx0, y: ty0 }; break; } // торпеда — до берега
      if (nature || piece || WorldGen.BIOMES[tile].blocks || out) { wallT = (i - 1) / steps; wallCell = { x: tx0, y: ty0 }; break; }
    }
    if (best && bt <= wallT) {
      p.x = x0 + (x1 - x0) * bt; p.y = y0 + (y1 - y0) * bt;
      impact(room, p, best);
      done = true;
    } else if (wallT <= 1) {
      p.x = x0 + (x1 - x0) * wallT; p.y = y0 + (y1 - y0) * wallT;
      p.hitCell = wallCell;
      impact(room, p, null);
      done = true;
    } else {
      p.x = x1; p.y = y1;
      p.left -= travel;
      if (p.left <= 1e-6) { impact(room, p, null); done = true; }
    }
    if (!done) keep.push(p);
  }
  cs.projectiles = keep;
}

// Управляемая ракета: доворачивает к цели не быстрее prof.turn рад/с; клиенту — fx 'steer' с новым курсом
function steer(room, p, dt) {
  let goal = null;
  if (p.track) {
    const [kind, ...rest] = p.track.split(':'), id = rest.join(':');
    const h = hostiles(room, p.owner.kind === 'p' || p.owner.kind === 'c' ? p.owner : { kind: 'e' }).find((x) => x.kind === kind && (kind === 'p' ? x.ref.account.id : x.ref.id) === id);
    if (h) goal = { x: h.x, y: h.y }; else p.track = null; // цель пропала — летит прямо
  }
  if (!goal && p.aim) { if (Math.hypot(p.aim.x - p.x, p.aim.y - p.y) > 0.8) goal = p.aim; else p.aim = null; } // без цели — к точке прицела
  if (!goal) return;
  const speed = Math.hypot(p.vx, p.vy), cur = Math.atan2(p.vy, p.vx);
  const want = Math.atan2(goal.y - p.y, goal.x - p.x);
  const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
  const max = (p.prof.turn || 0) * dt;
  if (!(max > 0) || Math.abs(diff) < 1e-4) return;
  const a = cur + Math.max(-max, Math.min(max, diff));
  p.vx = Math.cos(a) * speed; p.vy = Math.sin(a) * speed;
  const now = Date.now();
  if (now - p.steerAt > 120) { p.steerAt = now; fx(room, { k: 'steer', id: p.id, x: round2(p.x), y: round2(p.y), a: round2(a), r: round2(p.left) }); }
}

function impact(room, p, hit) {
  const g = G();
  const flags = p.prof.flags || [];
  fx(room, { k: 'impact', id: p.id, x: round2(p.x), y: round2(p.y), f: p.prof.fx });
  const ix = p.hitCell ? p.hitCell.x : Math.floor(p.x), iy = p.hitCell ? p.hitCell.y : Math.floor(p.y), tile = WorldGen.tileAt(room.map, ix, iy);
  if (!(flags.includes('explosive') || flags.includes('area')) && tile === WorldGen.B.FOREST) worldedit().hitNature(room, ix, iy, ((p.prof.damage && p.prof.damage[0] + p.prof.damage[1]) || 12) / 2, p.owner.kind === 'p' ? p.owner.c.character.name : '');
  const piece = building().blockAt(room, ix, iy);
  if (piece) worldedit().damagePiece(room, piece, ((p.prof.damage && p.prof.damage[0] + p.prof.damage[1]) || 12) / 2);
  if (flags.includes('explosive') || flags.includes('area')) explode(room, p.owner, p, p.prof, p.factor);
  else if (hit) applyHit(room, p.owner, hit, p.prof, p.factor);
  // брошенный предмет или стрела остаются на земле (не всегда)
  if (p.drop && rnd() < g.thrownRecoverChance && !ground.isFull(room.id)) {
    let pos = { x: round2(p.x), y: round2(p.y) };
    if (M.validatePosition(room.map, pos)) pos = { x: round2(p.x - p.vx * 0.02), y: round2(p.y - p.vy * 0.02) };
    if (!M.validatePosition(room.map, pos)) {
      const gi = ground.add(room.id, { id: p.drop, n: 1 }, pos, p.owner.kind === 'p' ? p.owner.c.character.name : '');
      room.broadcast({ t: 'ground-add', item: gi });
    }
  }
}

function explode(room, owner, at, prof, factor = 1) {
  const g = G();
  const radius = prof.kind === 'place' ? prof.range : prof.blast > 0 ? prof.blast : g.explosionRadius; // мины и растяжки — радиус из данных предмета; бортовое оружие — prof.blast
  fx(room, { k: 'boom', x: round2(at.x), y: round2(at.y), r: radius, f: prof.fx });
  const ownerName = owner.kind === 'p' ? owner.c.character.name : '';
  for (let y = Math.floor(at.y - radius); y <= Math.ceil(at.y + radius); y++) for (let x = Math.floor(at.x - radius); x <= Math.ceil(at.x + radius); x++) {
    if (Math.hypot(x + 0.5 - at.x, y + 0.5 - at.y) > radius) continue;
    worldedit().hitNature(room, x, y, Math.max(1, prof.damage ? prof.damage[1] * factor : 30), ownerName, true);
    const piece = building().blockAt(room, x, y);
    if (piece) worldedit().damagePiece(room, piece, (prof.damage ? prof.damage[1] : 30) * factor);
  }
  const hits = hostiles(room, owner.kind === 'p' || owner.kind === 'c' ? owner : { kind: 'e' }).filter((h) => Math.hypot(h.x - at.x, h.y - at.y) <= radius + h.r);
  for (const h of hits) applyHit(room, owner, h, prof, factor);
  return hits.length;
}

// ---------- Перезарядка ----------

function startReload(c, slot) {
  const cb = cbOf(c), w = weaponIn(c, slot);
  if (!w.item || !w.prof.ammo || !(w.prof.magazine > 0)) return 'Это оружие не перезаряжается.';
  if (cb.reload) return 'Уже идёт перезарядка.';
  if ((w.inst.mag || 0) >= w.prof.magazine) return 'Магазин полон.';
  if (!Inv.rounds(c.character, w.prof.ammo)) return `Нет боеприпасов: «${Items.get(w.prof.ammo).name}».`;
  const total = Math.round(w.prof.reload * 1000);
  cb.reload = { slot, uid: w.inst.uid, until: Date.now() + total, total };
  fx(c.room, { k: 'reload', id: c.account.id, ms: total });
  sendMe(c, true);
  return null;
}

// Перезарядка закончилась: заряды берутся из сумки; остаток вскрытой ячейки / баллона не пропадает (Inv.takeRounds)
function finishReload(c) {
  const cb = cbOf(c), r = cb.reload;
  cb.reload = null;
  const w = weaponIn(c, r.slot);
  if (!w.inst || w.inst.uid !== r.uid || !w.prof.ammo) return 0;
  const need = w.prof.magazine - (w.inst.mag || 0);
  const took = need > 0 ? Inv.takeRounds(c.character, w.prof.ammo, need) : 0;
  w.inst.mag = (w.inst.mag || 0) + took;
  markDirty(c);
  sendInv(c);
  sendMe(c, true);
  return took;
}

function onReload(c, msg) {
  if (cbOf(c).dead) return;
  const slot = msg && msg.slot === 'off' ? 'offHand' : 'mainHand';
  const err = startReload(c, slot);
  if (err) realtime.send(c, { t: 'atk-reject', reason: 'reload', message: err });
}

// ---------- Мины, ловушки, турели ----------

function placeItem(c, id, x, y) {
  const room = c.room, cs = stateOf(room), g = G(), ch = c.character;
  const it = Items.get(String(id || ''));
  if (cbOf(c).dead) return reject(c, 'dead', 'Вы погибли.');
  if (!it || !it.placeable || !it.weapon) return reject(c, 'place', 'Этот предмет нельзя установить.');
  if (!Inv.count(ch, it.id)) return reject(c, 'place', `У вас нет «${it.name}».`);
  if (settlements().zoneAt(room, c.pos.x, c.pos.y)) return reject(c, 'place', 'Поселение — мирная зона: мины, ловушки и турели здесь ставить нельзя.');
  let pos = Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x - c.pos.x, y - c.pos.y) <= Inv.settings.pickupRange ? { x, y } : { x: c.pos.x, y: c.pos.y };
  if (M.validatePosition(room.map, pos)) pos = { x: c.pos.x, y: c.pos.y };
  pos = { x: round2(pos.x), y: round2(pos.y) };
  const prof = Combat.profile(it);
  if (it.weapon.class === 'turret') {
    // турель: заряжается боеприпасами владельца при установке; ставится лучшая из сумки (выше уровень, целее)
    const mine = [...cs.turrets.values()].filter((t) => t.owner === c.account.id);
    if (mine.length >= g.maxTurretsPerPlayer) return reject(c, 'place', `Не больше ${g.maxTurretsPerPlayer} турелей одновременно.`);
    const inst = ch.inventory.cells.filter((z) => z && z.id === it.id).sort((a, b) => (b.tier || 1) - (a.tier || 1) || (b.dur || 0) - (a.dur || 0))[0];
    if (!inst) return reject(c, 'place', `«${it.name}» должна лежать в сумке.`);
    const tier = Math.min(g.turretMaxTier, inst.tier || 1);
    const tprof = turretProfile(prof, tier);
    let mag = 0;
    if (prof.ammo) {
      mag = Inv.takeRounds(ch, prof.ammo, tprof.magazine);
      if (!mag) return reject(c, 'noammo', `Турели нужны боеприпасы: «${Items.get(prof.ammo).name}».`);
    }
    ch.inventory.cells[ch.inventory.cells.indexOf(inst)] = null;
    Inv.fitCells(ch);
    const maxHp = turretMaxHp(tier);
    const hp = Math.max(1, Math.round(maxHp * (it.durability ? (inst.dur ?? it.durability) / it.durability : 1)));
    const t = {
      id: 't' + crypto.randomBytes(3).toString('hex'), item: it.id, owner: c.account.id, ownerName: ch.name, x: pos.x, y: pos.y, mag,
      tier, hp, maxHp, mode: TURRET_MODES.includes(g.turretDefaultMode) ? g.turretDefaultMode : 'nearest',
      until: Date.now() + g.turretLifetimeSec * 1000, next: 0, prof: tprof, base: prof,
    };
    cs.turrets.set(t.id, t);
    room.broadcast({ t: 'turret-add', turret: publicTurret(t) });
  } else {
    const mine = [...cs.traps.values()].filter((t) => t.owner === c.account.id);
    if (mine.length >= g.maxTrapsPerPlayer) return reject(c, 'place', `Не больше ${g.maxTrapsPerPlayer} мин и ловушек одновременно.`);
    Inv.takeById(ch, it.id, 1);
    const t = { id: 'm' + crypto.randomBytes(3).toString('hex'), item: it.id, owner: c.account.id, ownerName: ch.name, x: pos.x, y: pos.y, armAt: Date.now() + g.trapArmSec * 1000, until: Date.now() + g.trapLifetimeMin * 60000, prof };
    cs.traps.set(t.id, t);
    room.broadcast({ t: 'trap-add', trap: publicTrap(t) });
  }
  markDirty(c);
  sendInv(c);
  sendMe(c);
  return null;
}
const publicTrap = (t) => ({ id: t.id, item: t.item, owner: t.owner, x: t.x, y: t.y, armAt: t.armAt });
const publicTurret = (t) => ({
  id: t.id, item: t.item, owner: t.owner, x: t.x, y: t.y, mag: t.mag, max: t.prof.magazine, tier: t.tier, hp: Math.ceil(t.hp), maxHp: t.maxHp, mode: t.mode,
});

// ---------- Турели: уровни, режим цели, прочность ----------
const TURRET_MODES = ['nearest', 'strongest', 'weakest'];
const turretMaxHp = (tier) => Math.round(G().turretHpBase * (1 + (tier - 1) * G().turretHpPerTier));
// Профиль турели с учётом уровня улучшения: урон, дальность, скорострельность и магазин растут
function turretProfile(prof, tier) {
  const g = G(), k = tier - 1;
  return {
    ...prof,
    damage: prof.damage.map((d) => d * (1 + k * g.turretTierDamage)),
    range: prof.range * (1 + k * g.turretTierRange),
    speed: prof.speed * (1 + k * g.turretTierFireRate),
    magazine: Math.round(prof.magazine * (1 + k * g.turretTierMagazine)),
  };
}
// Стоимость улучшения до следующего уровня: [{ id, n }]
function turretUpgradeCost(tier) {
  const g = G();
  return [[g.turretUpgradeItem, g.turretUpgradeCount], [g.turretUpgradeItem2, g.turretUpgradeCount2]]
    .filter(([id, n]) => id && n > 0).map(([id, n]) => ({ id, n: n * tier }));
}
// Сколько материала нужно на полный ремонт
const turretRepairCost = (t) => Math.ceil((t.maxHp - t.hp) / G().turretRepairHpPerItem);

// Действия владельца с турелью рядом: mode (режим цели), repair, upgrade, fold (свернуть)
function onTurret(c, msg) {
  const room = c.room, cs = stateOf(room), g = G(), ch = c.character;
  const t = cs.turrets.get(String(msg && msg.id));
  const no = (text) => { realtime.send(c, { t: 'atk-reject', reason: 'turret', message: text }); return text; };
  if (!t) return no('Этой турели уже нет.');
  if (t.owner !== c.account.id) return no('Это чужая турель.');
  if (cbOf(c).dead) return no('Вы погибли.');
  if (Math.hypot(t.x - c.pos.x, t.y - c.pos.y) > g.turretInteractRange) return no('Подойдите к турели ближе.');
  switch (msg.a) {
    case 'mode':
      if (!TURRET_MODES.includes(msg.mode)) return no('Неизвестный режим.');
      t.mode = msg.mode;
      break;
    case 'repair': {
      const need = turretRepairCost(t);
      if (!need) return no('Турель цела.');
      const have = Inv.count(ch, g.turretRepairItem);
      if (!have) return no(`Для ремонта нужен «${Items.get(g.turretRepairItem).name}».`);
      const used = Inv.takeById(ch, g.turretRepairItem, Math.min(need, have));
      t.hp = Math.min(t.maxHp, t.hp + used * g.turretRepairHpPerItem);
      sendInv(c);
      break;
    }
    case 'upgrade': {
      if (t.tier >= g.turretMaxTier) return no('Турель уже улучшена до предела.');
      const cost = turretUpgradeCost(t.tier);
      const lack = cost.filter((x) => Inv.count(ch, x.id) < x.n);
      if (lack.length) return no('Для улучшения не хватает: ' + lack.map((x) => `${Items.get(x.id).name} × ${x.n - Inv.count(ch, x.id)}`).join(', ') + '.');
      for (const x of cost) Inv.takeById(ch, x.id, x.n);
      const frac = t.hp / t.maxHp;
      t.tier += 1;
      t.prof = turretProfile(t.base, t.tier);
      t.maxHp = turretMaxHp(t.tier);
      t.hp = Math.max(1, Math.round(t.maxHp * frac));
      sendInv(c);
      break;
    }
    case 'fold':
      foldTurret(room, t);
      return null;
    default:
      return no('Неизвестное действие.');
  }
  markDirty(c);
  room.broadcast({ t: 'turret-upd', turret: publicTurret(t) });
  return null;
}

// Выбор цели турелью по режиму
function turretTarget(t, enemies) {
  if (!enemies.length) return null;
  const d = (e) => Math.hypot(e.x - t.x, e.y - t.y);
  const key = { nearest: (e) => d(e), strongest: (e) => -e.hp, weakest: (e) => e.hp }[t.mode] || ((e) => d(e));
  return enemies.reduce((best, e) => (key(e) < key(best) || (key(e) === key(best) && d(e) < d(best)) ? e : best));
}

function stepTraps(room, now) {
  const cs = stateOf(room), g = G();
  for (const t of [...cs.traps.values()]) {
    if (now > t.until) { cs.traps.delete(t.id); room.broadcast({ t: 'trap-remove', id: t.id }); continue; }
    if (now < t.armAt) continue;
    const victim = [...cs.enemies.values()].find((e) => require('./enemy-behaviour').hostile(e) && Math.hypot(e.x - t.x, e.y - t.y) <= g.trapTriggerRadius + e.def.radius);
    if (!victim) continue;
    cs.traps.delete(t.id);
    room.broadcast({ t: 'trap-remove', id: t.id, fired: 1 });
    const c = room.players.get(t.owner);
    const owner = c ? { kind: 'p', c, id: t.owner } : { kind: 'p', c: null, id: t.owner, trapOnly: true };
    trapHit(room, owner, t, victim);
  }
}
function trapHit(room, owner, t, victim) {
  const prof = t.prof;
  // хозяин вышел из мира — урон всё равно наносится, опыт не начисляется
  const own = owner.c ? owner : { kind: 'p', c: fakeOwner(owner.id), id: owner.id };
  if (prof.flags.includes('area') || prof.flags.includes('explosive')) explode(room, own, t, prof);
  else applyHit(room, own, { kind: 'e', ref: victim, x: victim.x, y: victim.y, r: victim.def.radius }, prof);
}
const fakeOwner = (id) => ({ account: { id }, character: { stats: {}, name: '' }, pos: { x: 0, y: 0 }, cb: { dead: true } });

function stepTurrets(room, now) {
  const cs = stateOf(room), g = G();
  for (const t of [...cs.turrets.values()]) {
    if (now > t.until || (t.prof.ammo && t.mag <= 0) || !room.players.has(t.owner)) { foldTurret(room, t); continue; }
    if (now < t.next) continue;
    const e = turretTarget(t, [...cs.enemies.values()].filter((x) => require('./enemy-behaviour').hostile(x) && Math.hypot(x.x - t.x, x.y - t.y) <= t.prof.range));
    if (!e) continue;
    t.next = now + Combat.cooldownMs(t.prof);
    if (t.prof.ammo) t.mag -= 1;
    const owner = { kind: 'p', c: room.players.get(t.owner), id: t.owner, turret: t };
    const dir = { x: e.x - t.x, y: e.y - t.y };
    const look = Combat.CLASS_ATTACK[t.prof.damageType === 'energy' ? 'laser_gun' : 'rifle']; // снаряд турели — как у лазера или винтовки
    const prof = { ...t.prof, proj: look.proj, fx: look.fx };
    if (t.prof.damageType === 'fire') coneStrike(room, owner, t, dir, { ...prof, fx: 'flame' }, g.flameConeDeg);
    else shoot(room, owner, t, dir, prof);
  }
}
// Турель сворачивается обратно в предмет на земле (патроны кончились, истёк срок, хозяин ушёл, свернул сам или её разбили).
// Прочность предмета — доля оставшегося здоровья, уровень улучшения сохраняется; разбитая остаётся с минимальной прочностью.
function foldTurret(room, t, destroyed = false) {
  const cs = stateOf(room);
  cs.turrets.delete(t.id);
  room.broadcast({ t: 'turret-remove', id: t.id, destroyed: destroyed ? 1 : 0 });
  if (destroyed) fx(room, { k: 'boom', x: t.x, y: t.y, r: 0.8, f: 'turret' });
  const it = Items.get(t.item);
  const dur = it.durability ? Math.max(destroyed ? 0 : 1, Math.round((it.durability * Math.max(0, t.hp)) / t.maxHp)) : undefined;
  if (!ground.isFull(room.id)) {
    const gi = ground.add(room.id, { id: t.item, n: 1, dur, tier: t.tier }, { x: t.x, y: t.y }, t.ownerName);
    room.broadcast({ t: 'ground-add', item: gi });
  }
}

// Урон по турели (враги видят турели как цели)
function hitTurret(room, t, amount, type) {
  if (!room.combat.turrets.has(t.id)) return 0;
  const dmg = Combat.mitigate(amount, type, G().turretDefense, {}, []);
  t.hp -= dmg;
  fx(room, { k: 'hit', t: 't', id: t.id, n: dmg, d: type });
  if (t.hp <= 0) {
    const c = room.players.get(t.owner);
    if (c) chat.tell(c, `Вашу турель «${Items.get(t.item).name}» разбили. Подберите её и почините.`);
    foldTurret(room, t, true);
  } else room.broadcast({ t: 'turret-upd', turret: publicTurret(t) });
  return dmg;
}

// ---------- Атаки врагов ----------

function enemyAttack(room, e, target, now) {
  const a = e.def.attack;
  const comp = companions().entOf(room, target.id);
  if (comp) { // спутник игрока: удар или выстрел без полёта снаряда
    fx(room, { k: 'swing', o: 'e', id: e.id, x: round2(e.x), y: round2(e.y), a: round2(Math.atan2(comp.y - e.y, comp.x - e.x)), r: a.range, f: 'claw' });
    if (a.kind !== 'melee' || dist(e, comp) <= a.range + comp.radius + G().meleeRangeTolerance) {
      const [lo, hi] = e.damage;
      companions().hitByEnemy(room, comp, e, lo + (hi - lo) * rnd(), a.type);
    }
    return;
  }
  const npc = settlements().entOf(room, target.id);
  if (npc) { // житель поселения (шаг 15)
    fx(room, { k: 'swing', o: 'e', id: e.id, x: round2(e.x), y: round2(e.y), a: round2(Math.atan2(npc.y - e.y, npc.x - e.x)), r: a.range, f: 'claw' });
    if (a.kind !== 'melee' || dist(e, npc) <= a.range + npc.radius + G().meleeRangeTolerance) {
      const [lo, hi] = e.damage;
      settlements().hitByEnemy(room, npc, e, lo + (hi - lo) * rnd(), a.type);
    }
    return;
  }
  const tur = room.combat.turrets.get(target.id);
  if (tur) { // турель: ближний удар или выстрел
    fx(room, { k: 'swing', o: 'e', id: e.id, x: round2(e.x), y: round2(e.y), a: round2(Math.atan2(tur.y - e.y, tur.x - e.x)), r: a.range, f: 'claw' });
    if (a.kind !== 'melee' || dist(e, tur) <= a.range + G().turretRadius + G().meleeRangeTolerance) {
      const [lo, hi] = e.damage;
      hitTurret(room, tur, lo + (hi - lo) * rnd(), a.type);
    }
    return;
  }
  const c = room.players.get(target.id);
  if (!c || cbOf(c).dead) return;
  const prof = { kind: a.kind, damageType: a.type, flags: a.flags,freezeSec:a.freezeSec||0,rootSec:a.rootSec||0, range: a.range * 1.3, proj: a.proj || 20, fx: a.fx || 'claw' };
  const owner = { kind: 'e', e, id: e.id };
  if (a.kind === 'melee') {
    fx(room, { k: 'swing', o: 'e', id: e.id, x: round2(e.x), y: round2(e.y), a: round2(Math.atan2(c.pos.y - e.y, c.pos.x - e.x)), r: a.range, f: 'claw' });
    if (dist(e, c.pos) <= a.range + PLAYER_RADIUS + G().meleeRangeTolerance) applyHit(room, owner, { kind: 'p', ref: c, x: c.pos.x, y: c.pos.y, r: PLAYER_RADIUS }, prof);
  } else if(a.kind==='cone'){coneStrike(room,owner,e,{x:c.pos.x-e.x,y:c.pos.y-e.y},prof,50);
  } else {
    shoot(room, owner, e, { x: c.pos.x - e.x, y: c.pos.y - e.y }, prof);
  }
}

// Удар жителя поселения (стражник) по герою — по обычным правилам урона (броня, щиты, неуязвимость)
function npcHit(room, n, c, amount, type) {
  const owner = { kind: 'e', e: { id: n.id, damage: [amount, amount], def: { name: n.name }, x: n.x, y: n.y }, id: n.id };
  return applyHit(room, owner, { kind: 'p', ref: c, x: c.pos.x, y: c.pos.y, r: PLAYER_RADIUS }, { kind: 'melee', damageType: type || 'physical', flags: [] });
}

// Столкновение тяжёлой техники с игроком: использует обычную броню/щит и PvP правила мира.
function vehicleHitPlayer(room, v, def, c, amount) {
  if (!c || cbOf(c).dead || !pvpOn(room) || settlements().pvpBlocked(room, v, c.pos)) return 0;
  const attacker = { id: `vehicle:${v.id}`, damage: [amount, amount], def: { name: def.name }, x: v.x, y: v.y };
  const owner = { kind: 'e', e: attacker, id: attacker.id };
  return applyHit(room, owner, { kind: 'p', ref: c, x: c.pos.x, y: c.pos.y, r: PLAYER_RADIUS },
    { kind: 'melee', damageType: 'physical', flags: [] });
}

// ---------- Тик ----------

function stepDots(room, ent, isEnemy, dt, now) {
  if (!ent.dots || !ent.dots.length) return;
  ent.dots = ent.dots.filter((d) => d.until > now);
  for (const d of ent.dots) {
    d.acc += d.perSec * dt;
    if (d.acc < 1) continue;
    const n = Math.floor(d.acc);
    d.acc -= n;
    if (isEnemy) {
      if (ent.god) continue;
      ent.hp -= n;
      fx(room, { k: 'hit', t: 'e', id: ent.id, n, dot: d.k });
      if (ent.hp <= 0 && !ent.dead) killEnemy(room, ent, d.owner && ['p', 'c'].includes(d.owner.kind) && d.owner.c && room.players.get(d.owner.c.account.id) === d.owner.c ? d.owner.c : null);
    } else {
      const c = ent.client;
      if (realtime.godOf(c.account.id).invulnerable) continue;
      c.character.vitals.hp -= n;
      fx(room, { k: 'hit', t: 'p', id: c.account.id, n, dot: d.k });
      markDirty(c);
      if (c.character.vitals.hp <= 0 && !ent.dead) killPlayer(room, c, d.owner);
    }
    if (ent.dead) break;
  }
}

function stepPlayers(room, dt, now) {
  const g = G();
  for (const c of room.players.values()) {
    const cb = cbOf(c), ch = c.character, v = ch.vitals, max = maxVitals(ch);
    cb.client = c;
    if (cb.dead) { c.speedMul = 0; survival.step(room, c, dt, now, { dead: true }); continue; }
    if (cb.reload && now >= cb.reload.until) finishReload(c);
    // бег тратит выносливость
    const running = cb.sprint && c.moving && v.stamina > 0;
    // выживание: голод, жажда, усталость, радиация (server/survival.js); отдых (Z) ускоряет восстановление
    const inCombat = now - cb.lastCombatAt <= g.regenDelaySec * 1000;
    const sv = survival.step(room, c, dt, now, { running, enemies: stateOf(room).enemies, inCombat });
    const restK = survival.isResting(c) ? Survival.settings.survivalRestVitalsFactor : 1;
    Object.assign(max, maxVitals(ch)); // шкалы могли измениться (радиация, жажда)
    if (running) { v.stamina = Math.max(0, v.stamina - g.sprintStaminaPerSec * dt); if (v.stamina <= 0) cb.sprint = false; }
    else v.stamina = Math.min(max.stamina, v.stamina + g.staminaRegenPerSec * sv.staRegen * restK * dt);
    if (!inCombat&&v.hp<max.hp) {v.hp = Math.min(max.hp, v.hp + g.hpRegenPerSec * sv.hpRegen * restK * dt);markDirty(c);}
    v.mp = Math.min(max.mp, v.mp + g.mpRegenPerSec * sv.mpRegen * restK * dt);
    const set = Items.setEffects(ch);
    if ((set.hpRegen || set.hpPercent) && v.hp < max.hp || set.mpRegen && v.mp < max.mp) {
      v.hp = Math.min(max.hp, v.hp + (set.hpRegen + max.hp * set.hpPercent) * dt);
      v.mp = Math.min(max.mp, v.mp + set.mpRegen * dt);
      markDirty(c);
    }
    if (set.storm && now >= (cb.setStormAt || 0)) {
      const enemies = [...stateOf(room).enemies.values()].filter((e) => require('./enemy-behaviour').hostile(e) && !factions().peacefulTo(c, e));
      const target = enemies.filter((e) => Math.hypot(e.x - c.pos.x, e.y - c.pos.y) <= 7).sort((a, b) => Math.hypot(a.x - c.pos.x, a.y - c.pos.y) - Math.hypot(b.x - c.pos.x, b.y - c.pos.y))[0];
      if (target) {
        cb.setStormAt = now + 8000;
        const type = set.storm === 'random' ? ['fire', 'energy', 'electric'][Math.floor(rnd() * 3)] : set.storm;
        const fxKind = { fire: 'fireball', energy: 'frost', electric: 'spark', poison: 'shadow', magic:'magic', physical:'stone' }[type];
        fx(room, { k: 'boom', x: round2(target.x), y: round2(target.y), r: 2.5, f: fxKind });
        const prof = {stealthCrit:magic().hidden(c), kind: 'ranged', damage: [24, 36], damageType: type, flags: ['magic'], fx: fxKind };magic().onAttack(c);
        const at = { x: target.x, y: target.y };
        for (const e of enemies) if (!e.dead && Math.hypot(e.x - at.x, e.y - at.y) <= 2.5 + e.def.radius) applyHit(room, { kind: 'p', c, id: c.account.id }, { kind: 'e', ref: e, x: e.x, y: e.y, r: e.def.radius }, prof);
      }
    }
    v.hp = Math.min(v.hp, max.hp);
    v.stamina = Math.min(v.stamina, max.stamina);
    if (sv.hpDrain > 0) {
      v.hp = Survival.drainHp(v.hp, sv.hpDrain, dt);
      if (v.hp <= 0) { killPlayer(room, c, null); continue; }
    }
    c.speedMul = cb.stunUntil > now || cb.immobileUntil > now ? 0 : (running ? g.sprintMultiplier : 1) * (1 - sv.penalty) * companions().speedFactor(c) * magic().speedFactor(c, now);
    const vm = c.veh ? vehicles().speedMul(c) : null; // в машине (шаг 14): скорость машины, седок — 0
    if (vm !== null) c.speedMul = cb.stunUntil > now ? 0 : vm;
    const gd = realtime.godOf(c.account.id); // чит-панель (шаг 20): скорость и бесконечные шкалы
    if (gd.speed > 1 && c.speedMul > 0) c.speedMul *= gd.speed;
    if (gd.infinite) { v.stamina = max.stamina; v.mp = max.mp; }
    stepDots(room, cb, false, dt, now);
    // посещённое поселение — точка возрождения
    for (const s of room.map.settlements || []) {
      if (Math.hypot(c.pos.x - (s.x + 0.5), c.pos.y - (s.y + 0.5)) <= g.settlementVisitRadius) {
        ch.lastSettlement = ch.lastSettlement || {};
        if (ch.lastSettlement[room.id] !== s.id) { ch.lastSettlement[room.id] = s.id; markDirty(c); chat.tell(c, `Поселение «${s.name}» — теперь вы будете возрождаться здесь.`); }
      }
    }
    if (cb.invDirtyAt && now - cb.invSentAt >= g.combatInvSyncSec * 1000) sendInv(c);
  }
}

function tick(room, dt, now) {
  const cs = stateOf(room), g = G();
  if (now >= cs.nextAutosaveAt) { saveWorldState(room); for (const c of room.players.values()) if (cbOf(c).dirty) persist(c); }
  stepPlayers(room, dt, now);
  const players = aiPlayers(room);
  // появление врагов
  if (now >= cs.nextSpawnAt && !room.level) { // на уровнях враги заселяются генератором уровня (server/levels.js)
    cs.nextSpawnAt = now + g.spawnCheckSec * 1000;
    Spawner.step({
      map: room.map, world: room.world, game: g, now, rnd, players,
      count: () => cs.enemies.size,
      spawn: (def, level, x, y, area, opts) => spawnEnemy(room, def, level, x, y, area, opts),
      despawn: (id) => { const e = cs.enemies.get(id); if (!e) return true; if (e.target) return false; removeEnemy(room, e, false); return true; },
      announce: (text) => chat.system(room.id, text),
      countOf: (pred) => { let n = 0; for (const e of cs.enemies.values()) if (!e.dead && pred(e.def)) n++; return n; },
    }, cs.spawn);
  }
  // ИИ
  const ctx = aiCtx(room, now, players);
  // шаг 20: враг без цели, далёкий от всех игроков, «спит» — ИИ не считается (просыпается, когда игрок подойдёт)
  const sleepR = g.aiSleepRadius > 0 ? g.aiSleepRadius : 0;
  const heroes = sleepR ? [...room.players.values()].map((c) => c.pos) : null;
  let awake = 0;
  for (const e of ctx.enemies) {
    if (e.dead) continue;
    AI.recover(ctx,e,dt);
    if (sleepR && !e.target && (e.state === 'idle' || e.state === 'wander') && !(e.dots && e.dots.length) && !heroes.some((p) => Math.abs(p.x - e.x) <= sleepR && Math.abs(p.y - e.y) <= sleepR)) {
      if (e.path.length) e.path = [];
      continue;
    }
    awake++;
    e.speedMul = e.immobileUntil > now ? 0 : (Number(e.cheatSpeed) > 0 ? Number(e.cheatSpeed) : 1);
    stepDots(room, e, true, dt, now);
    if (e.dead) continue;
    if (e.def.spells && !e.def.boss && require('./enemy-behaviour').hostile(e) && e.state!=='flee' && magic().enemyThink(room, e, now, ctx)) continue; // боссы используют простую тактику прямой атаки
    const before={x:e.x,y:e.y};
    AI.think(ctx, e, dt);
    if(!e.def.fly){const locked=e.immobileUntil>now||e.stunUntil>now;if(locked)e.surfaceVelocity={vx:0,vy:0};else{const to=M.surfaceMove(ctx.map,before,e,e.surfaceVelocity||(e.surfaceVelocity={}),dt,require('./magic-fields').slippery(room,before));e.x=to.x;e.y=to.y;}}
  }
  cs.awake = awake;
  AI.separate(ctx, sleepR ? ctx.enemies.filter((e) => !e.dead && (e.target || e.path.length || heroes.some((p) => Math.abs(p.x - e.x) <= sleepR && Math.abs(p.y - e.y) <= sleepR))) : ctx.enemies);
  stepProjectiles(room, dt);
  stepTraps(room, now);
  stepTurrets(room, now);
  if (cs.fx.length) { room.broadcast({ t: 'fx', ev: cs.fx }); cs.fx = []; }
  for (const c of room.players.values()) sendMe(c);
}

// Позиции врагов в каждом сообщении state: [id, x, y, hp%, флаги] (1 — идёт, 2 — оглушён/обездвижен, 4 — убегает, 8 — в бою)
function stateExtra(room) {
  const cs = room.combat;
  if (!cs) return { e: [] };
  const now = Date.now();
  const e = [];
  for (const x of cs.enemies.values()) {
    const flags = (x.path.length ? 1 : 0) | (x.stunUntil > now || x.immobileUntil > now ? 2 : 0) | (x.state === 'flee' ? 4 : 0) | (x.target ? 8 : 0) | (x.boundUntil > now ? 16 : 0) | (x.hiddenUntil > now ? 32 : 0) | (x.casting ? 64 : 0) | (x.disposition==='neutral'?128:0) | (x.disposition==='follower'?256:0) | (x.disposition==='surrender'?512:0);
    e.push([x.id, round2(x.x), round2(x.y), Math.max(0, Math.ceil((x.hp / x.maxHp) * 100)), flags]);
  }
  return { e };
}

// ---------- Подключение к комнатам ----------

function onJoinWelcome(room, c) {
  const cs = stateOf(room), cb = cbOf(c), ch = c.character;
  // вышедший мёртвым (или после сбоя) — входит живым
  const max = maxVitals(ch);
  if (!ch.vitals || !(ch.vitals.hp > 0)) ch.vitals = { hp: Math.max(1, Math.round(max.hp * G().respawnHpFraction)), stamina: max.stamina, mp: max.mp };
  cb.dead = false;
  c.speedMul = 1;
  return {
    enemies: [...cs.enemies.values()].map(publicEnemy),
    traps: [...cs.traps.values()].map(publicTrap),
    turrets: [...cs.turrets.values()].map(publicTurret),
    me: meOf(c),
    pvp: pvpOn(room),
  };
}

realtime.use({
  welcome: onJoinWelcome,
  tick,
  stateExtra,
  playerState: (c) => { const ch = c.character, max = maxVitals(ch), cb = cbOf(c), now = Date.now(); return { h: Math.max(0, Math.ceil((ch.vitals.hp / max.hp) * 100)), d: cb.dead ? 1 : 0, st: cb.stunUntil > now || cb.immobileUntil > now ? 1 : 0 }; },
  publicExtra: (c) => { const ch = c.character, max = maxVitals(ch), cb = c.cb, now = Date.now(); return { h: Math.max(0, Math.ceil(((ch.vitals ? ch.vitals.hp : max.hp) / max.hp) * 100)), d: cb && cb.dead ? 1 : 0, st: cb && (cb.stunUntil > now || cb.immobileUntil > now) ? 1 : 0 }; },
  beforeLeave: (room, c) => {
    if (cbOf(c).dead) respawn(room, c, true);
    const cs = room.combat;
    if (cs) for (const t of [...cs.turrets.values()]) if (t.owner === c.account.id) foldTurret(room, t);
    persist(c);
  },
  onSave: (room, c) => { if (cbOf(c).dirty) persist(c); },
  onDestroy: (room) => { saveWorldState(room); },
  onSaveWorld: (room) => { for (const c of room.players.values()) persist(c); saveWorldState(room); },
  handlers: {
    atk: (c, msg) => { if(c.controlledComp)require('./companion-control').attack(c,msg);else onAtk(c, msg); },
    turret: (c, msg) => { onTurret(c, msg || {}); },
    reload: onReload,
    sprint: (c, msg) => { cbOf(c).sprint = Boolean(msg && msg.on) && !cbOf(c).dead; sendMe(c); },
    place: (c, msg) => { placeItem(c, msg && msg.item, msg && msg.x, msg && msg.y); },
    alloc: (c, msg) => {
      const err = Combat.allocate(c.character, String(msg && msg.stat), 1);
      if (err) return realtime.send(c, { t: 'atk-reject', reason: 'alloc', message: err });
      markDirty(c);
      persist(c);
      realtime.send(c, { t: 'stats', stats: c.character.stats, pts: c.character.unspentPoints });
      sendInv(c); // переносимый вес и показатели зависят от характеристик
      sendMe(c, true);
    },
    respawn: (c) => {
      const err = respawn(c.room, c);
      if (err) realtime.send(c, { t: 'atk-reject', reason: 'respawn', message: err });
    },
  },
});

// Вложить очки вне мира (REST): POST /api/characters/:id/stats { stat, count? }
function allocateRest(account, charId, body = {}) {
  const live = realtime.byAccount.get(account.id);
  const n = body.count == null ? 1 : body.count;
  if (live && live.room && live.character.id === charId) {
    const err = Combat.allocate(live.character, String(body.stat), n);
    if (err) throw new auth.HttpError(400, err);
    persist(live);
    sendMe(live, true);
    return live.character;
  }
  return characters.update(account, charId, (ch) => {
    const err = Combat.allocate(ch, String(body.stat), n);
    if (err) throw new auth.HttpError(400, err);
  }).record;
}

// Живой герой изменён снаружи (панель ГМ): сохранить и разослать новые показатели
function refreshPlayer(c, oldLevel) {
  persist(c);
  if ((c.character.level || 1) !== oldLevel) c.room.broadcast({ t: 'level', id: c.account.id, level: c.character.level });
  realtime.send(c, { t: 'stats', stats: c.character.stats, pts: c.character.unspentPoints });
  sendMe(c, true);
}

// ---------- Администратор: /spawn /kill /heal /setlevel (заготовка для панели ГМ, этап 8) ----------

function findEnemyDef(q) {
  const s = String(q || '').trim().replace(/^"(.*)"$/, '$1').toLowerCase();
  return Enemies.ENEMIES.find((e) => e.id === s) || Enemies.ENEMIES.find((e) => e.name.toLowerCase() === s) || null;
}

// Создать врагов рядом с героем (они видят героя даже в безопасной зоне); targetId — на кого сразу нападают
function adminSpawn(admin, room, near, query, count = 1, targetId = null) {
  const g = G();
  const def = findEnemyDef(query);
  if (!def) throw new auth.HttpError(400, `Неизвестный враг «${query}». Список — в справке «Враги».`);
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > g.adminSpawnMax) throw new auth.HttpError(400, `Количество — от 1 до ${g.adminSpawnMax}.`);
  const made = spawnGroup(room, near, def, n, targetId, 2.5, 4.5);
  auth.logAdmin(admin, 'spawn', { worldId: room.id, enemy: def.id, count: made.length, x: round2(near.x), y: round2(near.y) });
  return { enemy: def.id, name: def.name, count: made.length, ids: made.map((e) => e.id) };
}

// n врагов (главари — со свитой) на расстоянии rMin…rMax от точки, откуда они дойдут до неё; сразу идут на targetId
// opts (чит-панель, шаг 21): уровень врага ограничен maxEnemyLevel (статы по Enemies.statsAt), elite — элита
function spawnGroup(room, near, def, n, targetId, rMin, rMax, opts = {}) {
  const g = G();
  const made = [];
  const players = aiPlayers(room);
  stateOf(room);
  for (let i = 0; i < n; i++) {
    let pos = null;
    for (let t = 0; t < 30 && !pos; t++) {
      const a = rnd() * Math.PI * 2, r = rMin + rnd() * (rMax - rMin);
      const p = { x: near.x + Math.cos(a) * r, y: near.y + Math.sin(a) * r };
      // только туда, откуда враг дойдёт до героя (не за рекой)
      if (!M.validatePosition(room.map, p) && M.findPath(room.grid, Math.floor(p.x), Math.floor(p.y), Math.floor(near.x), Math.floor(near.y), 400)) pos = p;
    }
    if (!pos) break;
    const lv = Math.floor(Number(opts.level));
    const partyCap = players.length ? Math.min(g.maxEnemyLevel || 99, Math.max(...players.map((p) => p.level || 1))) : (g.maxEnemyLevel || 99);
    const generated = Spawner.levelFor({ game: g, world: room.world, rnd, players, map: room.map }, pos.x, pos.y, def);
    const level = lv >= 1 ? Math.min(g.maxEnemyLevel || 99, lv) : Math.min(partyCap, generated, g.maxEnemyLevel || 99);
    const boss = spawnEnemy(room, def, level, pos.x, pos.y, null, { ignoreSafe: true, target: targetId });
    if (opts.elite) makeElite(room, boss);
    made.push(boss);
    // босс приходит со свитой (меньшее число из guardCount)
    for (let k = 0; k < (def.guardCount ? def.guardCount[0] : 0); k++) {
      const gd = Enemies.get(def.guards[k % def.guards.length]);
      const gp = { x: pos.x + Math.cos(k * 2) * 1.2, y: pos.y + Math.sin(k * 2) * 1.2 };
      const guardLevel = Math.min(g.maxEnemyLevel || 99, gd.level[1], ...players.map((p) => p.level || 1));
      if (guardLevel >= gd.level[0]) spawnEnemy(room, gd, guardLevel, ...(M.validatePosition(room.map, gp) ? [pos.x, pos.y] : [gp.x, gp.y]), null, { ignoreSafe: true, target: targetId,guardOf:boss.id });
    }
  }
  return made;
}

// ---------- Игровые события (server/events.js): супер-босс, главарь, орда ----------
function eventVictim(room) {
  const alive = [...room.players.values()].filter((c) => !cbOf(c).dead);
  return alive.length ? alive[Math.floor(rnd() * alive.length)] : null;
}
function eventBoss(room, def, ev) {
  const c = eventVictim(room);
  if (!c) return null;
  const d = G().eventSpawnDist;
  const made = spawnGroup(room, c.pos, def, 1, c.account.id, d, d + 3);
  if (!made.length) return null;
  const e = made[0];
  chat.system(room.id, ev.text || `${def.name} (ур. ${e.level}) появился и идёт на ${c.character.name}!`);
  return `${def.name} в мире «${room.world.name}» (цель — ${c.character.name})`;
}
events.registerType('superboss', 'Супер-босс со свитой', (ev, room) => eventBoss(room, Enemies.get('boss_super'), ev));
events.registerType('boss', 'Главарь банды со свитой (enemy — какой)', (ev, room) => {
  const bosses = Enemies.ENEMIES.filter((e) => e.guards && e.spawn !== false);
  const def = (ev.enemy && findEnemyDef(ev.enemy)) || bosses[Math.floor(rnd() * bosses.length)];
  return def ? eventBoss(room, def, ev) : null;
});
events.registerType('horde', 'Орда зомби', (ev, room) => {
  const cs = stateOf(room), g = G();
  const n = Spawner.stepHorde({
    map: room.map, world: room.world, game: g, now: Date.now(), rnd, players: aiPlayers(room),
    count: () => cs.enemies.size,
    spawn: (def, level, x, y, area, opts) => spawnEnemy(room, def, level, x, y, area, opts),
    announce: (text) => chat.system(room.id, ev.text || text),
  }, cs.spawn, true);
  return n ? `орда (${n}) в мире «${room.world.name}»` : null;
});
events.registerType('dragon', 'Нападение дракона', (ev, room) => {
  // вид дракона — по случайному логову мира (без логов — огненный)
  const lairs = room.map.lairs || [];
  const lair = lairs.length ? lairs[Math.floor(rnd() * lairs.length)] : null;
  const def = (ev.enemy && findEnemyDef(ev.enemy)) || Enemies.get(Companions.dragonForLair(lair ? lair.type : 'fire'));
  return def ? eventBoss(room, def, { ...ev, text: ev.text || null }) : null;
});
events.registerType('doubleloot', 'Двойной лут (durationMin)', (ev, room) => {
  chat.system(room.id, ev.text || `Двойной лут! ${ev.durationMin} мин с врагов падает в ${G().eventLootMultiplier} раза больше добычи.`);
  return `двойной лут в «${room.world.name}» на ${ev.durationMin} мин`;
}, { duration: true });
events.registerType('message', 'Личное сообщение игроку (target, text) — дойдёт, когда он в мире', (ev, room) => {
  const c = [...room.players.values()].find((x) => x.account.username.toLowerCase() === String(ev.target).toLowerCase());
  if (!c) return null;
  chat.adminMessage(ev.createdBy, c, ev.text);
  return `сообщение для ${c.account.username}`;
}, { needsTarget: true, rooms: (ev, rooms) => [...rooms.values()].filter((r) => [...r.players.values()].some((x) => x.account.username.toLowerCase() === String(ev.target).toLowerCase())) });
events.registerType('announce', 'Объявление в чате (text)', (ev, room) => { chat.system(room.id, ev.text); return `объявление в «${room.world.name}»`; });
events.setRooms(() => realtime.rooms);
events.setLogger((admin, action, details) => auth.logAdmin(admin, action, details));

// /event — список, создание, запуск, отмена (заготовка панели ГМ)
const EVENT_HELP = '/event list · /event add <тип> [через_мин] [каждые_мин] [текст | враг | длительность | адресат текст] (в этом мире; тип all:<тип> — во всех) · /event run <id> · /event remove <id>';
chat.addCommand('event', ['событие'], adminOnly((c, rest) => {
  const [sub, ...args] = rest.trim().split(/\s+/);
  if (!sub || sub === 'list') {
    const act = events.list().filter((e) => e.status === 'scheduled');
    if (!act.length) return chat.tell(c, `Запланированных событий нет. Типы: ${events.types().map((t) => t.id).join(', ')}. ${EVENT_HELP}`);
    return chat.tell(c, act.map((e) => `${e.id}: ${e.type}${e.worldId ? '' : ' (все миры)'} · ${new Date(e.at).toLocaleString('ru-RU')}${e.everyMin ? ` · каждые ${e.everyMin} мин` : ''} · запусков ${e.runs}`).join('\n'));
  }
  if (sub === 'add') {
    let type = args[0] || '';
    const all = type.startsWith('all:');
    if (all) type = type.slice(4);
    // хвост команды: boss / dragon — какой враг, doubleloot — длительность (мин), message — адресат и текст, остальные — текст
    const tail = args.slice(3);
    const input = { type, worldId: all ? null : c.room.worldId, inMin: args[1], everyMin: args[2] };
    if (type === 'boss' || type === 'dragon') input.enemy = tail.join(' ') || null;
    else if (type === 'doubleloot') input.durationMin = tail[0];
    else if (type === 'message') { input.target = tail[0]; input.text = tail.slice(1).join(' '); input.worldId = null; }
    else input.text = tail.join(' ');
    const ev = events.add(c.account, input);
    return chat.tell(c, `Событие ${ev.id} (${ev.type}) запланировано на ${new Date(ev.at).toLocaleString('ru-RU')}${ev.everyMin ? `, повтор каждые ${ev.everyMin} мин` : ''}.`);
  }
  if (sub === 'run') {
    const ev = events.find(args[0]);
    const r = events.run(ev, { admin: c.account });
    return chat.tell(c, r.ran ? `Событие ${ev.id}: ${r.results.join('; ')}.` : `Событие ${ev.id} не сработало (нет игроков или не нашлось места).`);
  }
  if (sub === 'remove') { const ev = events.remove(c.account, args[0]); return chat.tell(c, `Событие ${ev.id} отменено.`); }
  chat.tell(c, EVENT_HELP);
}), '/event list|add|run|remove — игровые события (супер-босс, главарь, дракон, орда, двойной лут, объявление, сообщение)');

// Убрать врагов: в радиусе adminKillRadius от точки или всех (без опыта и добычи)
// credit — убить «как в бою» от имени этого игрока (опыт, добыча, задания, репутация фракций — шаг 16)
function adminKillEnemies(admin, room, near, all, credit = null) {
  const cs = stateOf(room), g = G();
  const list = [...cs.enemies.values()].filter((e) => !e.dead && (all || !near || Math.hypot(e.x - near.x, e.y - near.y) <= g.adminKillRadius));
  for (const e of list) {
    if (credit) { e.hitBy.set(credit.account.id, e.hp); killEnemy(room, e, credit); continue; }
    fx(room, { k: 'die', t: 'e', id: e.id, x: round2(e.x), y: round2(e.y) }); removeEnemy(room, e, false);
  }
  auth.logAdmin(admin, 'kill-enemies', { worldId: room.id, count: list.length, all: Boolean(all) });
  return list.length;
}
function adminKillPlayer(admin, room, c) {
  if (cbOf(c).dead) throw new auth.HttpError(400, `${c.character.name} уже мёртв.`);
  auth.logAdmin(admin, 'kill-player', { worldId: room.id, username: c.account.username, character: c.character.name });
  c.character.vitals.hp = 0;
  killPlayer(room, c, null);
}
function adminHeal(admin, room, c) {
  if (cbOf(c).dead) respawn(room, c, true);
  const max = maxVitals(c.character);
  c.character.vitals = { hp: max.hp, stamina: max.stamina, mp: max.mp };
  cbOf(c).dots = [];
  markDirty(c);
  sendMe(c, true);
  auth.logAdmin(admin, 'heal', { worldId: room.id, username: c.account.username, character: c.character.name });
}
function adminSetLevel(admin, room, c, level) {
  const g = G();
  const lv = Number(level);
  if (!Number.isInteger(lv) || lv < 1 || lv > g.maxLevel) throw new auth.HttpError(400, `Уровень — от 1 до ${g.maxLevel}.`);
  const ch = c.character, old = ch.level || 1;
  ch.level = lv;
  ch.xp = 0;
  ch.unspentPoints = Math.max(0, (ch.unspentPoints || 0) + (lv - old) * g.statPointsPerLevel);
  const max = maxVitals(ch);
  ch.vitals = { hp: max.hp, stamina: max.stamina, mp: max.mp };
  persist(c);
  room.broadcast({ t: 'level', id: c.account.id, level: lv });
  sendMe(c, true);
  auth.logAdmin(admin, 'setlevel', { worldId: room.id, username: c.account.username, character: ch.name, from: old, to: lv });
  return { from: old, to: lv, points: ch.unspentPoints };
}

function adminOnly(fn) {
  return (c, rest) => {
    if (c.account.role !== 'admin') return chat.tell(c, 'Команда доступна только администратору.');
    try { fn(c, rest); } catch (e) { chat.tell(c, e instanceof auth.HttpError ? e.message : 'Ошибка команды.'); if (!(e instanceof auth.HttpError)) console.error(e); }
  };
}
chat.addCommand('spawn', ['создать'], adminOnly((c, rest) => {
  const m = /^(.*?)(?:\s+(\d+))?$/s.exec(rest.trim());
  if (!m[1]) return chat.tell(c, 'Пример: /spawn wolf 3 (id или название врага — см. справку «Враги»).');
  const r = adminSpawn(c.account, c.room, c.pos, m[1], m[2] || 1, c.account.id); // сразу идут на администратора
  chat.tell(c, `Создано: ${r.name} × ${r.count}.`);
}), '/spawn <враг> [кол-во] — создать врагов рядом');
chat.addCommand('kill', ['убить'], adminOnly((c, rest) => {
  const arg = rest.trim();
  if (!arg || arg === 'all' || arg === 'все') {
    const n = adminKillEnemies(c.account, c.room, c.pos, Boolean(arg));
    return chat.tell(c, `Убрано врагов: ${n}.`);
  }
  const r = chat.parseTarget(c.room, arg);
  if (!r.target) return chat.tell(c, `Игрок «${r.name || arg}» не найден в этом мире.`);
  adminKillPlayer(c.account, c.room, r.target);
  chat.tell(c, `${r.target.character.name} убит.`);
}), '/kill [all | игрок] — убрать врагов рядом (all — всех) или убить игрока');
chat.addCommand('slay', ['сразить'], adminOnly((c, rest) => {
  const n = adminKillEnemies(c.account, c.room, c.pos, /^(all|все)$/.test(rest.trim()), c);
  chat.tell(c, `Сражено врагов: ${n} (засчитано вам: опыт, добыча, задания, репутация).`);
}), '/slay [all] — сразить врагов рядом от своего имени (опыт, добыча, цели заданий, репутация фракций)');
chat.addCommand('heal', ['вылечить'], adminOnly((c, rest) => {
  const target = rest.trim() ? chat.parseTarget(c.room, rest.trim()).target : c;
  if (!target) return chat.tell(c, `Игрок «${rest.trim()}» не найден в этом мире.`);
  adminHeal(c.account, c.room, target);
  chat.tell(c, `${target.character.name}: здоровье, выносливость и мана восстановлены.`);
}), '/heal [игрок] — полностью вылечить');
chat.addCommand('setlevel', ['уровень'], adminOnly((c, rest) => {
  const r = chat.parseTarget(c.room, rest);
  if (!r.target) return chat.tell(c, r.name ? `Игрок «${r.name}» не найден в этом мире.` : 'Пример: /setlevel Имя 5');
  const res = adminSetLevel(c.account, c.room, r.target, r.text.trim());
  chat.tell(c, `${r.target.character.name}: уровень ${res.from} → ${res.to}, свободных очков: ${res.points}.`);
}), '/setlevel <игрок> <уровень> — задать уровень');
// Концовка (шаг 16): сюжетная (shared/quests.js ENDINGS) — концовка мира для всех в нём; любая другая — только герою.
// В обоих случаях — markEnding, экран финала, игра продолжается, «Новая игра+» открыта.
function adminEnding(admin, room, c, endingId) {
  const id = endingId || 'test';
  const fresh = !(Array.isArray(c.character.endings) && c.character.endings.some((e) => e.id === id));
  if (require('../shared/quests').ENDINGS[id] && room.world) quests().ending(room, id, null, { admin: true });
  else quests().markEnding(room, c, id);
  auth.logAdmin(admin, 'ending', { worldId: room.id, username: c.account.username, character: c.character.name, ending: endingId || 'test' });
  return fresh;
}
chat.addCommand('ending', ['концовка'], adminOnly((c, rest) => {
  const r = chat.parseTarget(c.room, rest);
  if (!r.target) return chat.tell(c, r.name ? `Игрок «${r.name}» не найден в этом мире.` : 'Пример: /ending Имя [концовка]');
  const id = r.text.trim() || 'test';
  const fresh = adminEnding(c.account, c.room, r.target, id);
  chat.tell(c, `${r.target.character.name}: концовка «${id}» ${fresh ? 'отмечена' : 'уже была'} — доступна «Новая игра+».`);
  if (r.target !== c) chat.tell(r.target, `Отмечена концовка «${id}»: этим героем можно начать «Новую игру+» (создание мира).`);
}), '/ending <игрок> [концовка] — отметить концовку (открывает «Новую игру+»)');

module.exports = {
  onAtk, companionHit, npcHit, fx, random: () => rnd(), shoot, coneStrike, explode, hostiles, cbOf, sendMe, maxVitals, persist, aiCtx, markDirty,
  setRandom, stateOf, spawnEnemy, removeEnemy, killEnemy, envDamage, respawnPoint, killPlayer, respawn, applyHit, dropLoot, grantXp, startReload, placeItem, applyDifficulty,
  onTurret, turretProfile, turretTarget, turretUpgradeCost, hitTurret, vehicleHitPlayer, TURRET_MODES,
  saveWorldState, snapshotState,
  refreshPlayer, spawnGroup, makeElite, setEnemyLevel, publicEnemy, adminEnding, adminSpawn, adminKillEnemies, adminKillPlayer, adminHeal, adminSetLevel, allocateRest, findEnemyDef, pvpOn, meOf,
};
