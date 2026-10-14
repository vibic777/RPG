'use strict';
// Вертикальные уровни на сервере (шаг 13): переходы через входы и выходы (решает сервер), заселение уровней врагами
// и тайниками (детерминированная карта из shared/levels.js, сложность и добыча растут с глубиной, босс на самом дне),
// дыхание под водой (шкала «Воздух», акваланг, баллоны, удушье), плавание (выносливость), падение с высоты,
// полёт на драконе на воздушных уровнях +6…+10 (высота героя в мире поверхности), телепорт администратора на уровень.
// Каждый уровень — отдельная комната realtime («<id мира>~<ключ>»): свои игроки, враги, предметы, спутники и сохранение.
const Levels = require('../shared/levels');
const Enemies = require('../shared/enemies');
const Items = require('../shared/items');
const Inv = require('../shared/inventory');
const WorldGen = require('../shared/worldgen');
const M = require('../shared/movement');
const config = require('./config');
const realtime = require('./realtime');
const worlds = require('./worlds');
const ground = require('./ground');
const chat = require('./chat');
const auth = require('./auth');
const Difficulty = require('../shared/difficulty');

const combat = () => require('./combat');
const companions = () => require('./companions');
const vehicles = () => require('./vehicles');
const G = () => config.get().game;
const round2 = (v) => Math.round(v * 100) / 100;

// Состояние героя: воздух, высота полёта, плавание
function lvOf(c) { return c.lvl || (c.lvl = { breath: NaN, alt: 0, swim: false, sent: '', sentAt: 0 }); }
const airborne = (c) => Boolean(c && c.lvl && c.lvl.alt > 0);
// В подлодке под водой (alt −1…−5, server/vehicles.js altitude)
const submerged = (c) => Boolean(c && c.lvl && c.lvl.alt < 0);
function scubaOn(ch) {
  const f = ch && ch.inventory && ch.inventory.equipment && ch.inventory.equipment.face;
  const it = f && Items.get(f.id);
  return Boolean(it && it.scuba && (f.dur === undefined || f.dur > 0));
}
// Высота героя: lvOf(c).alt — прямо z (+1…+5 — среди домов и деревьев, +6…+10 — над ними; < 0 — подлодка под водой)
const zOf = (room, c) => (room.level ? room.level.z : (airborne(c) || submerged(c) ? c.lvl.alt : 0));

function publicLevel(room) {
  const l = room.level||room.region;
  return l ? { key: l.key, z: l.z, type: l.type, typeName: l.typeName, name: l.name, n: l.n, depth: l.depth, surfaceRegion:Boolean(l.surfaceRegion),regionKey:l.regionKey, underwater: l.underwater ? 1 : 0, high: l.high ? 1 : 0 } : null;
}

// ---------- Заселение уровня ----------
// Новая комната уровня: враги по местам генератора, босс со свитой на самом дне, тайники (только при первом посещении).
// Уровень, зачищенный давно (game.levelRespawnMin), заселяется снова (без тайников).
function populate(room, saved) {
  const lv = room.level, g = G(), now = Date.now();
  if (!lv) return 0;
  const cs = combat().stateOf(room);
  const stale = saved && g.levelRespawnMin > 0 && now - (room.levelAt || 0) > g.levelRespawnMin * 60000 && cs.enemies.size < lv.spots.length;
  if (saved && !stale) return 0;
  room.levelAt = now;
  const rnd = combat().random;
  const type = Levels.TYPES[lv.type];
  const party = realtime.worldRooms(room.worldId).flatMap((r) => [...r.players.values()].map((c) => c.character.level || 1));
  const partyLevel = party.length ? Math.round(party.reduce((sum, level) => sum + level, 0) / party.length) : (room.hintLevel || 1);
  const base = Math.max(1, Math.round((party.length ? partyLevel + lv.n * Levels.settings.levelDepthEnemyBonus : lv.enemyLevel) * Difficulty.get(room.world.difficulty||g.difficulty).level));
  const pool = (lv.roof && type.roofEnemies ? type.roofEnemies : type.enemies).map((id) => Enemies.get(id)).filter(Boolean);
  const fits = pool.filter((d) => d.boss || d.level[0] <= base + 2);
  const pick = () => { const list = fits.length ? fits : pool; return list[Math.floor(rnd() * list.length)]; };
  const near = (p) => {
    for (let k = 0; k < 8; k++) {
      const x = p.x + 0.5 + (rnd() * 2 - 1) * 1.2, y = p.y + 0.5 + (rnd() * 2 - 1) * 1.2;
      if (WorldGen.isWalkable(room.map, Math.floor(x), Math.floor(y))) return { x: round2(x), y: round2(y) };
    }
    return { x: p.x + 0.5, y: p.y + 0.5 };
  };
  let made = 0;
  for (const spot of lv.spots) {
    const def = pick();
    if (!def) break;
    const n = Math.max(1, Math.min(3, def.group[0] + Math.floor(rnd() * (def.group[1] - def.group[0] + 1))));
    for (let i = 0; i < n; i++) {
      const p = near(spot);
      const enemyLevel = Math.max(def.level[0], base + Math.round(rnd() * 2 - 1));
      combat().spawnEnemy(room, def, enemyLevel, p.x, p.y, null, {});
      made++;
    }
  }
  if (lv.boss && type.boss) {
    const def = Enemies.get(type.boss);
    const lvl = Math.max(def.level[0], base + 2);
    combat().spawnEnemy(room, def, lvl, lv.boss.x + 0.5, lv.boss.y + 0.5, null, {});
    made++;
    const k = def.guards.length ? def.guardCount[0] + Math.floor(rnd() * (def.guardCount[1] - def.guardCount[0] + 1)) : 0;
    for (let i = 0; i < k; i++) {
      const gd = Enemies.get(def.guards[i % def.guards.length]);
      const p = near(lv.boss);
      combat().spawnEnemy(room, gd, Math.max(gd.level[0], base), p.x, p.y, null, {guardOf:'level-boss'});
      made++;
    }
  }
  // обитатели дома (shared/houses.js): мирные жильцы и нейтральные бродяги
  for (const r of lv.residents || []) {
    const def = Enemies.get(r.kind === 'resident' ? 'house_resident' : 'house_squatter');
    if (!def) continue;
    const p = near(r);
    combat().spawnEnemy(room, def, Math.max(1, base - (r.kind === 'resident' ? 2 : 0)), p.x, p.y, null, {});
    made++;
  }
  if (!saved) placeCaches(room, base);
  return made;
}

// Тайники: груды добычи в тупиках; чем глубже, тем больше бросков и выше уровень предметов
function placeCaches(room, base) {
  const lv = room.level, rnd = combat().random;
  const bonus = (Levels.TYPES[lv.type].lootBonus || 0) + Math.floor(lv.n / 2);
  let placed = 0;
  for (const cc of lv.caches) {
    for (let r = 0; r <= bonus; r++) {
      for (const d of Enemies.rollLoot('cache', base + lv.n * 2, rnd)) {
        if (ground.isFull(room.id)) return placed;
        const it = Items.get(d.id);
        ground.add(room.id, { id: d.id, n: d.n, dur: it.durability || undefined }, { x: round2(cc.x + 0.2 + rnd() * 0.6), y: round2(cc.y + 0.2 + rnd() * 0.6) }, lv.house ? 'Сундук' : 'Тайник', { permanent: true });
        placed++;
      }
    }
  }
  return placed;
}

// ---------- Урон от среды ----------
function hurt(room, c, dmg, why) {
  if (!(dmg > 0) || realtime.godOf(c.account.id).invulnerable) return false;
  const v = c.character.vitals;
  v.hp = Math.max(0, v.hp - dmg);
  combat().markDirty(c);
  if (v.hp <= 0) { combat().killPlayer(room, c, null); chat.tell(c, why); return true; }
  return false;
}
function fall(c, levels, text) {
  const room = c.room;
  if (!room || levels <= 0) return 0;
  const max = combat().maxVitals(c.character);
  const dmg = Levels.fallDamage(levels, max.hp);
  if (realtime.godOf(c.account.id).invulnerable) { chat.tell(c, `${text} Режим бога: без урона.`); return 0; }
  const died = hurt(room, c, dmg, `Падение с высоты ${levels} ур. оказалось смертельным.`);
  if (!died) chat.tell(c, `${text} Урон от падения: ${dmg}.`);
  combat().sendMe(c, true);
  return dmg;
}

// ---------- Тик: воздух, плавание ----------
function tick(room, dt, now) {
  const g = G();
  for (const c of room.players.values()) {
    const s = lvOf(c), ch = c.character, v = ch.vitals;
    if (!v) continue;
    if (combat().cbOf(c).dead) { s.alt=0;s.breath = Levels.breathMax(scubaOn(ch)); s.swim = false; sendLv(c, now); continue; }
    const max = combat().maxVitals(ch);
    const under = Boolean(room.level && room.level.underwater) && !vehicles().sealed(c); // в подлодке воздух не кончается
    let dmg = Levels.stepBreath(s, dt, { underwater: under, scuba: scubaOn(ch), maxHp: max.hp });
    const setFlight = Items.setEffects(ch).fly;
    if (s.alt > 0 && !setFlight && !(c.mount && companions().flying(c)) && !c.veh) { const point=landingPoint(c,32)||realtime.freeSpawn(room);s.alt=0;room.broadcast({t:'lvl-alt',id:c.account.id,alt:0});if(Math.hypot(point.x-c.pos.x,point.y-c.pos.y)>.1)realtime.teleport(c,point.x,point.y);chat.tell(c,'Лётное снаряжение больше не работает. Выполнена экстренная посадка на свободную сушу.'); }
    s.swim = !room.level && !airborne(c) && !c.veh && !(c.mount && companions().flying(c)) && M.isSwimming(room.map, c.pos.x, c.pos.y);
    if (s.swim) { // вплавь тратится выносливость (и перекрывается восстановление); без сил — тонет
      v.stamina = Math.max(0, v.stamina - (g.swimStaminaPerSec + g.staminaRegenPerSec) * dt);
      if (v.stamina <= 0) dmg += (max.hp * g.drownDamagePct / 100) * dt;
    }
    if (dmg > 0 && hurt(room, c, dmg, under ? 'Вы задохнулись под водой.' : 'Вы утонули.')) continue;
    sendLv(c, now);
  }
}
function sendLv(c, now = Date.now()) {
  const s = lvOf(c), room = c.room;
  const bm = Levels.breathMax(scubaOn(c.character));
  const msg = { t: 'lv', b: Math.round(Number.isFinite(s.breath) ? s.breath : bm), bm, u: room && room.level && room.level.underwater ? 1 : 0, sw: s.swim ? 1 : 0, alt: s.alt, z: room ? zOf(room, c) : 0 };
  const key = JSON.stringify(msg);
  if (key === s.sent && now - s.sentAt < 5000) return;
  s.sent = key; s.sentAt = now;
  realtime.send(c, msg);
}

// ---------- Переходы ----------
// Войти в ближайший вход/выход (клавиша U). Возвращает текст ошибки или null.
function go(c) {
  const room = c.room, g = G();
  if (!room) return 'Вы не в мире.';
  if (!g.levelsEnabled) return 'Вертикальные уровни выключены на этом сервере.';
  if (combat().cbOf(c).dead) return 'Вы погибли.';
  if (airborne(c)) return 'Сначала снизьтесь до земли (PageDown).';
  const map = worlds.getMap(room.world);
  const p = Levels.nearbyPortal(map, room.level||room.region, c.pos.x, c.pos.y);
  if (!p) return 'Рядом нет входа или выхода — подойдите вплотную к метке на карте.';
  let t;
  if (p.kind === 'elevator') { // лифт (шаг 14): сразу на самый нижний уровень своего бункера
    if (!g.levelElevator) return 'Лифт обесточен (game.levelElevator = false). Ищите люк рядом.';
    const local=p.regionKey?require('../shared/regions').map(map,p.regionKey):map;
    const b = Levels.entranceById(local, p.of);
    t = b && Levels.arrival(map, { key: require('../shared/regions').qualify(p.regionKey||'ground',Levels.keyOf(b, b.depth)), at: 'up' });
  } else if (p.disabled) return 'Проход закрыт.';
  else t = Levels.portalTarget(map, p);
  if (!t) return 'Проход завален.';
  if (vehicles().inside(c)) return vehicles().throughPortal(c, p, t); // в машине (шаг 14): только подлодка под воду
  if (t.key !== 'ground') {
    const tl = Levels.level(map, t.key);
    if (tl.underwater && !Levels.canDive(tl.z, scubaOn(c.character))) return `Глубже ${Levels.settings.diveFreeDepth}-го подводного уровня без акваланга не нырнуть — наденьте акваланг (слот «Лицо»).`;
  }
  const fallLevels = p.kind === 'jump' && room.level ? room.level.z : 0;
  const err = realtime.changeLevel(c, t.key, t.x, t.y);
  if (err) return err;
  lvOf(c).sent = '';
  if (fallLevels > 0) fall(c, fallLevels, `Вы спрыгнули с высоты ${fallLevels}.`);
  return null;
}

// Возрождение погибшего на уровне — на поверхности у входа в подземелье (иначе под водой — снова удушье)
function respawnOut(c) {
  const room = c.room, root = worlds.getMap(room.world),map=room.level.regionKey?require('../shared/regions').map(root,room.level.regionKey):root;
  const ent = Levels.entranceById(map, room.level.entrance);
  const p = ent ? (ent.kind === 'dive' ? nearLand(map, ent) : ent) : map.spawn;
  const err = realtime.changeLevel(c, room.level.regionKey||'ground', p.x, p.y);
  if (err) return false;
  lvOf(c).breath = Levels.breathMax(scubaOn(c.character));
  chat.tell(c, 'Вас вынесли на поверхность к входу.');
  return true;
}
// Клетка суши рядом с местом погружения
function nearLand(map, e) {
  for (let r = 1; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (WorldGen.BIOMES[WorldGen.tileAt(map, e.x + dx, e.y + dy)].walkable) return { x: e.x + dx, y: e.y + dy };
  }
  return map.spawn;
}

// Высота полёта верхом на драконе: d = +1 вверх, −1 вниз (воздушные уровни +6…+10 над поверхностью)
function landingPoint(c,range=0) {
  const room=c.room;if(!room)return null;
  return realtime.asActor(room,c.account.id,()=>{
    const cx=Math.floor(c.pos.x),cy=Math.floor(c.pos.y);
    for(let r=0;r<=range;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
      const x=cx+dx,y=cy+dy,k=y*room.map.width+x;
      if(x<0||y<0||x>=room.map.width||y>=room.map.height||room.map.walls?.has(k)||room.map.blocks?.get(k)?.block==='moat')continue;
      if(WorldGen.BIOMES[WorldGen.tileAt(room.map,x,y)].walkable&&WorldGen.isWalkable(room.map,x,y))return r?{x:x+.5,y:y+.5}:{...c.pos};
    }
    return null;
  },{...c,mount:null,veh:null,buildElevation:0,lvl:{...lvOf(c),alt:0}});
}
function land(c) {
  if(!c.room)return 'Вы не в мире.';
  if(c.veh)return 'Для транспорта используйте его панель посадки.';
  if(!airborne(c))return null;
  if(!landingPoint(c))return 'Нельзя приземлиться здесь: переместитесь над свободной сушей, вне стен, скал и рва.';
  lvOf(c).alt=0;c.path=[];c.dir=null;c.moving=false;
  c.room.broadcast({t:'lvl-alt',id:c.account.id,alt:0});sendLv(c);return null;
}
function altitude(c, d) {
  const room = c.room;
  if (!room) return 'Вы не в мире.';
  const va = vehicles().altitude(c, d); // летающая техника (шаг 14)
  if (va !== undefined) return va;
  if (room.level) return 'Подниматься в небо можно только над поверхностью.';
  if (!(c.mount && companions().flying(c)) && !Items.setEffects(c.character).fly) return 'Для полёта наденьте реактивный ранец, крылья или лётный комплект; можно сесть на летающего дракона.';
  const s = lvOf(c), top = Levels.airTop(G().airMaxAltitude);
  const next = Math.max(0, Math.min(top, s.alt + (d > 0 ? 1 : -1)));
  if (next === s.alt) return next ? 'Выше не подняться.' : null;
  if(next===0&&!landingPoint(c))return 'Для посадки переместитесь над свободной сушей.';
  if(c.cb?.dead)return 'Погибший герой не может взлететь.';
  if(next>0)c.buildElevation=0;
  s.alt = next;
  room.broadcast({ t: 'lvl-alt', id: c.account.id, alt: next });
  sendLv(c);
  return null;
}
// Слезть с дракона в воздухе: block — нельзя; fall — падение с уроном (только над сушей)
function dismountError(c) {
  if (!airborne(c)) return null;
  if (G().airDismount !== 'fall') return 'В воздухе с дракона не слезть — сначала снизьтесь (PageDown).';
  if (!WorldGen.BIOMES[WorldGen.tileAt(c.room.map, Math.floor(c.pos.x), Math.floor(c.pos.y))].walkable) return 'Внизу нет суши — прыгать некуда.';
  const levels = c.lvl.alt;
  c.lvl.alt = 0;
  c.room.broadcast({ t: 'lvl-alt', id: c.account.id, alt: 0 });
  fall(c, levels, `Вы спрыгнули с дракона с высоты ${levels}.`);
  return null;
}
// Дракон пропал из-под седла в воздухе (ранен, отпущен) — падение
function onUnmount(c) {
  if (!airborne(c) || !c.room) return;
  const levels = c.lvl.alt;
  c.lvl.alt = 0;
  c.room.broadcast({ t: 'lvl-alt', id: c.account.id, alt: 0 });
  fall(c, levels, `Дракон сбросил вас с высоты ${levels}.`);
}

// Баллон с воздухом (shared/inventory.js useHook)
function onUse(ch, inst, it, ctx, take) {
  if (!it.effect || !it.effect.air) return undefined;
  const c = ctx && ctx.client;
  if (!c || !c.room) return 'Баллон пригодится в мире — под водой.';
  if (!(c.room.level && c.room.level.underwater)) return 'Баллон с воздухом нужен под водой.';
  const s = lvOf(c), max = Levels.breathMax(scubaOn(ch));
  if (s.breath >= max - 0.5) return 'Воздуха и так полный запас.';
  s.breath = Math.min(max, (Number.isFinite(s.breath) ? s.breath : 0) + Levels.settings.airTankSec);
  take();
  s.sent = '';
  return null;
}
Inv.setUseHook(onUse, true);

// ---------- Администратор ----------
// Ключ уровня по z (−5…+5): первый вход с уровнем на такой глубине/высоте
function keyAtZ(map, z) {
  if (z === 0) return 'ground';
  const e = Levels.entrances(map).find((x) => !x.disabled && x.dir === Math.sign(z) && x.depth >= Math.abs(z));
  return e ? Levels.keyOf(e, Math.abs(z)) : null;
}
// Телепорт на уровень: level — 'ground', ключ уровня или число z; x, y — клетка (иначе вход уровня)
function adminTeleport(admin, who, level, x, y) {
  const room = who.room;
  if (!room) throw new auth.HttpError(409, 'Игрок не в мире.');
  const map = worlds.getMap(room.world);
  const raw = String(level).trim();
  const key = /^[-+]?\d+$/.test(raw) ? keyAtZ(map, Number(raw)) : raw === 'ground' || raw === '0' ? 'ground' : raw;
  if (!key) throw new auth.HttpError(404, `Уровня ${raw} в этом мире нет.`);
  let pt;
  if (key === 'ground') {
    const ent = room.level && Levels.entranceById(map, room.level.entrance);
    pt = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : ent ? { x: ent.x, y: ent.y } : map.spawn;
  } else {
    const lv = Levels.level(map, key);
    if (!lv) throw new auth.HttpError(404, `Уровня «${raw}» нет. Входы мира: ${Levels.entrances(map).filter((e) => !e.disabled).map((e) => `${e.id} (${Levels.TYPES[e.type].name}, ${e.depth})`).join(', ')}.`);
    pt = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : lv.spawn;
  }
  const err = realtime.changeLevel(who, key, Math.floor(pt.x), Math.floor(pt.y));
  if (err) throw new auth.HttpError(409, err);
  auth.logAdmin(admin, 'teleport-level', { target: who.account.username, worldId: room.worldId, level: key, x: round2(who.pos.x), y: round2(who.pos.y) });
  return { username: who.account.username, level: key, z: zOf(who.room, who), x: who.pos.x, y: who.pos.y };
}
chat.addCommand('level', ['уровень'], (c, rest) => {
  const arg = rest.trim();
  const room = c.room;
  const map = worlds.getMap(room.world);
  if (!arg || c.account.role !== 'admin') {
    const here = room.level ? `${room.level.name} (${Levels.zLabel(room.level.z)})` : airborne(c) ? `${Levels.zName(zOf(room, c))} (${Levels.zLabel(zOf(room, c))})` : 'Поверхность (0)';
    if (c.account.role !== 'admin' || !arg) return chat.tell(c, `Вы здесь: ${here}. Входов в мире: ${Levels.entrances(map).filter((e) => !e.disabled).length}.${c.account.role === 'admin' ? ' /level <z | ключ | ground> — телепорт на уровень.' : ''}`);
  }
  try {
    const r = adminTeleport(c.account, c, arg);
    chat.tell(c, `Телепорт: ${r.level === 'ground' ? 'поверхность' : r.level} (уровень ${Levels.zLabel(r.z)}).`);
  } catch (e) { chat.tell(c, e.message); }
}, '/level [z | ключ | ground] — где вы; администратору — телепорт на уровень');

// ---------- Подключение ----------
function safely(c, fn) {
  let err;
  try { err = fn(); } catch (e) { err = e.message || String(e); }
  if (err) realtime.send(c, { t: 'lvl-reject', message: err });
  return err;
}
realtime.use({
  onRoom: (room) => { if (room.level) combat().stateOf(room); }, // заселить уровень до приветствия героя
  welcome: (room, c) => {
    const s = lvOf(c);
    s.alt = 0; s.sent = '';
    return { level: publicLevel(room), z: zOf(room, c) };
  },
  onJoin: (room, c) => { sendLv(c); },
  beforeLeave: (room, c) => { const s = lvOf(c); s.alt = 0; },
  tick,
  playerState: (c) => (airborne(c) ? { a: c.lvl.alt } : {}),
  publicExtra: (c) => (airborne(c) ? { a: c.lvl.alt } : {}),
  handlers: {
    'lvl-land':c=>{if(c.room)safely(c,()=>land(c));},
    'lvl-go': (c) => { if (c.room) safely(c, () => go(c)); },
    'lvl-alt': (c, msg) => { if (c.room) safely(c, () => altitude(c, Number(msg && msg.d) > 0 ? 1 : -1)); },
  },
});

module.exports = { respawnOut, populate, placeCaches, airborne, submerged, scubaOn, zOf, go, altitude, dismountError, onUnmount, fall, tick, sendLv, adminTeleport, keyAtZ, publicLevel, lvOf };
