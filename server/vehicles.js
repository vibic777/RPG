'use strict';
// Транспорт (шаг 14). Каталог и правила — shared/vehicles.js.
// Техника живёт в мире: data/worlds/<id мира>.vehicles.json — { spawned, list: [{ id, def, room ('ground' | ключ уровня),
//   x, y, hp, fuel, wreck, owner, ownerName, locked, cargo }] }. При первом входе в мир ставится брошенная техника
// (детерминированно по сиду), дальше всё хранится в файле: позиция, топливо, прочность, багажник, владелец.
// Вождение решает сервер: водитель (место 0) шлёт обычные намерения движения; на время его шага у карты стоит
// map.drive (правила местности машины, server/realtime.js asActor), скорость — множитель c.speedMul (server/combat.js).
// Седоки едут вместе (позиция = позиция машины), стрелок (def.gunner) стреляет бортовым оружием (профиль атаки шага 6),
// закрытая машина принимает удары на себя (броня), таран ранит врагов, удар о стену — машину.
// Подлодка ныряет через места погружения (server/levels.js go), летающая техника поднимается на воздушные уровни (altitude).
const crypto = require('crypto');
const realtime = require('./realtime');
const chat = require('./chat');
const config = require('./config');
const auth = require('./auth');
const worlds = require('./worlds');
const inventory = require('./inventory');
const { JsonFile, registerSchema } = require('./store');
const V = require('../shared/vehicles');
const Items = require('../shared/items');
const Inv = require('../shared/inventory');
const Combat = require('../shared/combat');
const WorldGen = require('../shared/worldgen');
const M = require('../shared/movement');
const Levels = require('../shared/levels');
const Houses = require('../shared/houses');

const VEHICLE_CATALOG_VERSION = 4;
registerSchema('vehicles', 1);
const G = () => config.get().game;
const combat = () => require('./combat');
const levels = () => require('./levels');
const building = () => require('./building');
const companions = () => require('./companions');
const round2 = (v) => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const segmentDistance = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
  const t = d2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
};
const newId = () => 'v' + crypto.randomBytes(4).toString('hex');
const ID_RE = /^[0-9a-f-]{36}$/;
const keyOfRoom = (room) => (room.key || (room.level ? room.level.key : 'ground'));

// ---------- Хранение ----------
const worldsState = new Map(); // id мира -> { file, list: Map id -> машина }
function stateFor(world) {
  let st = worldsState.get(world.id);
  if (st) return st;
  if (!ID_RE.test(world.id)) throw new Error('Некорректный мир.');
  const file = new JsonFile(`worlds/${world.id}.vehicles.json`, { spawned: false, list: [] }, { kind: 'vehicles' });
  const data = file.get() || { spawned: false, list: [] };
  st = { file, list: new Map(), spawnedRegions:new Set(data.spawnedRegions||[]), respawns: Array.isArray(data.respawns) ? data.respawns.filter((x) => x && Number.isFinite(x.x) && Number.isFinite(x.y) && Number.isFinite(x.at)).map((x) => ({ x: x.x, y: x.y, at: x.at })) : [] };
  for (const x of data.list || []) { const v = restore(x); if (v) { if ((data.catalogVersion || 0) < 3 && !v.owner) v.natural = true; st.list.set(v.id, v); } }
  if((data.catalogVersion||0)<4){
    for(const v of st.list.values())if(v.def==='submarine'){
      v.hp=Math.min(V.get(v.def).hp,v.hp*4800/500);
      if(v.room==='ground'){
        const map=worlds.getMap(world);
        if(!V.canPlaceBody(map,V.get(v.def),v)){const spot=V.findBerth(map,V.get(v.def),v);if(spot)Object.assign(v,spot);}
      }
    }
  }
  if (!data.spawned) {
    for (const s of V.worldSpawns(worlds.getMap(world))) {
      const def = V.get(s.def);
      st.list.set(s.id, blank(def, { id: s.id, x: s.x, y: s.y, hp: s.hp, fuel: s.fuel, wreck: s.wreck,facingAngle:s.facingAngle, natural: true }));
    }
  } else if ((data.catalogVersion || 0) < VEHICLE_CATALOG_VERSION) {
    const map = worlds.getMap(world);
    const spawned = V.worldSpawns(map);
    for (const s of spawned) {
      const def = V.get(s.def);
      const minGap = def.trailerLength || def.walker === 'elephant' ? 5 : 2.5;
      const occupied = [...st.list.values()].some((v) => v.room === 'ground' && dist(v, s) < minGap);
      if (!occupied) st.list.set(newId(), blank(def, { x: s.x, y: s.y, hp: s.hp, fuel: s.fuel, wreck: s.wreck,facingAngle:s.facingAngle, natural: true }));
    }
  }
  worldsState.set(world.id, st);
  if (!data.spawned || (data.catalogVersion || 0) < VEHICLE_CATALOG_VERSION) save(world.id);
  return st;
}
function blank(def, o = {}) {
  return {
    id: o.id || newId(), def: def.id, room: o.room || 'ground', x: round2(o.x), y: round2(o.y), hp: o.hp ?? def.hp, fuel: o.fuel ?? 0,
    wreck: Boolean(o.wreck), natural: Boolean(o.natural), owner: o.owner || null, ownerName: o.ownerName || '', locked: Boolean(o.locked),
    cargo: Array.isArray(o.cargo) ? o.cargo.slice(0, def.cargo) : [], seats: new Array(def.seats).fill(null), companions: Array.isArray(o.companions) ? o.companions.slice(0, 11) : [], turretDir: Number.isInteger(o.turretDir) ? ((o.turretDir % 8) + 8) % 8 : 0, rearTurretDir: Number.isInteger(o.rearTurretDir) ? ((o.rearTurretDir % 8) + 8) % 8 : 4, odometer:Number(o.odometer)||0,facingAngle: Number.isFinite(o.facingAngle) ? o.facingAngle : 0, alt: 0, dirty: false,
  };
}
function restore(x) {
  const def = x && V.get(x.def);
  if (!def || !Number.isFinite(x.x) || !Number.isFinite(x.y)) return null;
  return blank(def, { ...x, natural: x.natural == null ? /^w\d+$/.test(String(x.id || '')) : x.natural, hp: Math.max(0, Math.min(def.hp, Number(x.hp) || 0)), fuel: Math.max(0, Math.min(def.fuel.cap, Number(x.fuel) || 0)) });
}
function save(worldId) {
  const st = worldsState.get(worldId);
  if (!st) return 0;
  st.file.data = {
    spawned: true, spawnedRegions:[...st.spawnedRegions],catalogVersion: VEHICLE_CATALOG_VERSION, savedAt: Date.now(),
    list: [...st.list.values()].map((v) => ({ id: v.id, def: v.def, room: v.room, x: round2(v.x), y: round2(v.y), hp: Math.round(v.hp), fuel: round2(v.fuel), wreck: v.wreck, natural: v.natural, owner: v.owner, ownerName: v.ownerName, locked: v.locked, cargo: v.cargo, companions: v.companions, turretDir: v.turretDir, rearTurretDir: v.rearTurretDir, facingAngle: v.facingAngle,odometer:v.odometer||0 })),
    respawns: st.respawns,
  };
  try { st.file.save(); } catch (e) { console.warn('[vehicles] не удалось сохранить технику:', e.message); }
  return st.file.data.savedAt;
}
worlds.on('removed', (w) => {
  const st = worldsState.get(w.id);
  worldsState.delete(w.id);
  const f = st ? st.file : ID_RE.test(w.id) ? new JsonFile(`worlds/${w.id}.vehicles.json`, null) : null;
  if (f) { try { require('fs').unlinkSync(f.file); } catch { /* файла нет */ } }
});

// ---------- Доступ ----------
const inRoom = (room) => {
  const st=stateFor(room.world),key=keyOfRoom(room);
  if(room.region&&!st.spawnedRegions.has(key)){
    st.spawnedRegions.add(key);
    for(const s of V.worldSpawns(room.map)){if(G().vehicleMaxPerWorld>0&&st.list.size>=G().vehicleMaxPerWorld)break;const def=V.get(s.def);st.list.set(newId(),blank(def,{...s,id:undefined,room:key,natural:true}));}
    save(room.worldId);
  }
  return [...st.list.values()].filter(v=>v.room===key);
};
const defOf = (v) => V.get(v.def);
function vehicleOf(c) {
  if (!c || !c.veh || !c.room) return null;
  const v = stateFor(c.room.world).list.get(c.veh.id);
  return v && v.seats[c.veh.seat] === c.account.id ? v : null;
}
const isDriver = (c) => Boolean(vehicleOf(c)) && c.veh.seat === 0;
// Допущен ли герой (хозяин, допущенные на его базу, администратор)
function trusted(room, v, c) {
  if (c.account.role === 'admin' || !v.owner || v.owner === c.account.id) return true;
  const surface = realtime.rooms.get(room.worldId);
  const bases = surface && surface.bld ? [...surface.bld.bases.values()] : [];
  return bases.some((b) => b.ownerId === v.owner && building().hasAccess(b, c.account.id));
}
function accessError(room, v, c, asDriver) {
  if (trusted(room, v, c)) return null;
  if (v.locked) return `Машина заперта хозяином (${v.ownerName || 'другой игрок'}).`;
  if (asDriver && !G().vehicleGuestDrive) return 'Водить чужую машину нельзя — садитесь пассажиром.';
  return null;
}

function publicVehicle(v) {
  const def = defOf(v);
  const names = v.seats.map((id) => { const c = id && realtime.byAccount.get(id); return id ? (c && c.character ? c.character.name : '?') : null; });
  return {
    id: v.id, def: v.def, x: round2(v.x), y: round2(v.y), hp: Math.round(v.hp), maxHp: def.hp, fuel: round2(v.fuel), cap: def.fuel.cap,
    wreck: v.wreck ? 1 : 0, owner: v.owner, ownerName: v.ownerName, locked: v.locked ? 1 : 0, seats: v.seats.slice(), names, alt: v.alt, cargo: v.cargo, companions: v.companions.slice(), turretDir: v.turretDir, rearTurretDir: v.rearTurretDir, facingAngle: v.facingAngle,odometer:v.odometer||0,
  };
}
const roomOfVehicle = (world, v) => realtime.rooms.get(v.room === 'ground' ? world.id : `${world.id}~${v.room}`) || null;
function touch(v) { v.dirty = true; }

// ---------- Посадка и высадка ----------
function sendSeat(c, v) {
  realtime.send(c, v ? { t: 'veh-seat', id: v.id, seat: c.veh.seat, def: v.def, alt: v.alt, v: publicVehicle(v) } : { t: 'veh-seat', id: null });
}
function nearest(room, c, id) {
  const list = inRoom(room);
  if (id) return list.find((v) => v.id === id) || null;
  let best = null, bd = Infinity;
  for (const v of list) { const d = V.pointBodyDistance(c.pos,V.bodyAt(v.def,v)); if (d < bd) { bd = d; best = v; } }
  return best;
}
function boardCompanions(room, c, records) {
  if (!G().vehiclesEnabled) return 'Транспорт выключен на этом сервере.';
  const seated = vehicleOf(c);
  const v = seated || inRoom(room).filter((x) => V.drivable(defOf(x), x) && x.alt === 0)
    .sort((a, b) => V.pointBodyDistance(c.pos,V.bodyAt(a.def,a)) - V.pointBodyDistance(c.pos,V.bodyAt(b.def,b)))[0] || null;
  if (!v) return 'Рядом нет транспорта — подведите к нему спутников.';
  const def = defOf(v);
  if (!V.drivable(def, v)) return `«${def.name}» разбит — сначала почините его.`;
  if (v.alt > 0) return 'Сначала посадите транспорт.';
  if (v.alt < 0) return 'Сначала всплывите (PageUp).';
  if (!seated && V.pointBodyDistance(c.pos,V.bodyAt(v.def,v)) > G().vehicleEnterRange + def.radius + 2) return 'Подойдите к машине ближе.';
  const candidates = records.filter((r) => r.out && !r.down);
  if (!candidates.length) return 'Нет призванных спутников для посадки.';
  let boarded = 0;
  for (const rec of candidates) {
    if (v.companions.length >= 11) break;
    if (v.companions.includes(rec.id)) continue;
    const ent = companions().entOf(room, rec.id);
    if (!ent) continue;
    ent.boardingVehicle = v.id; rec.order = 'board'; rec.guard = null; rec.attack = '';
    if (c.cb) c.cb.dirty = true;
    boarded++;
  }
  if (!boarded) return 'Спутники уже в этой машине или не могут сесть.';
  console.info('[vehicles] приказ посадить спутников: account=%s vehicle=%s type=%s count=%d',c.account.username||c.account.id,v.id,def.id,boarded);
  const owner = realtime.byAccount.get(c.account.id);
  if (owner) chat.tell(c, `Спутники идут к транспорту «${def.name}» (до 11).`);
  return null;
}
function boardEnt(room, ent, c, v) {
  if (!v.companions.includes(ent.id) && v.companions.length >= 11) { ent.boardingVehicle = null; return; }
  if (!v.companions.includes(ent.id)) v.companions.push(ent.id);
  ent.vehicleId = v.id; ent.boardingVehicle = null; ent.x = v.x; ent.y = v.y; ent.path = []; ent.target = null;
  const rec = c && c.character && c.character.companions.find((x) => x.id === ent.id);
  if (rec) { rec.order = 'board'; if (c.cb) c.cb.dirty = true; }
  console.info('[vehicles] спутник на борту: owner=%s companion=%s vehicle=%s',c?.account?.username||c?.account?.id||ent.owner,ent.id,v.id);
  touch(v);
}
// ids — только эти спутники (приказ «выйти»); без ids — все
function unboardCompanions(room, v, ids = null) {
  if (!v.companions || !v.companions.length) return;
  const used = new Set();
  const leaving = ids ? v.companions.filter((id) => ids.includes(id)) : v.companions.slice();
  v.companions = v.companions.filter((id) => !leaving.includes(id));
  for (const id of leaving) {
    const ent = companions().entOf(room, id), c = ent && room.players.get(ent.owner);
    const rec = c && c.character.companions.find((x) => x.id === id);
    if (!ent) continue;
    ent.vehicleId = null; ent.boardingVehicle = null; ent.target = null; ent.path = [];
    let pos=c?exitSpot(room,c,v):{x:v.x,y:v.y};
    for (let r = 0; r <= 4; r++) {
      let found = false;
      for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const p = { x: Math.floor(pos.x) + dx + 0.5, y: Math.floor(pos.y) + dy + 0.5 };
        const k = `${Math.floor(p.x)},${Math.floor(p.y)}`;
        if (!used.has(k) && !M.validatePosition(room.map,p)&&V.pointBodyDistance(p,V.bodyAt(v.def,v))>.25) { pos = p; used.add(k); found = true; break; }
      }
      if (found) break;
    }
    ent.x = pos.x; ent.y = pos.y;
    if (rec) { rec.order = 'follow'; if (c.cb) c.cb.dirty = true; if (c.room === room) companions().sendList(c); }
  }
  touch(v);
}
function enter(c, id, seat) {
  const room = c.room, g = G();
  if (!g.vehiclesEnabled) return 'Транспорт выключен на этом сервере.';
  if (vehicleOf(c)) return exit(c);
  if (combat().cbOf(c).dead) return 'Вы погибли.';
  if (c.mount) return 'Сначала слезьте с дракона (N).';
  if (levels().airborne(c)) return 'Сначала снизьтесь.';
  const v = nearest(room, c, id);
  const def = v && defOf(v);
  if (!v || V.pointBodyDistance(c.pos,V.bodyAt(v.def,v)) > g.vehicleEnterRange + def.radius) return 'Рядом нет машины — подойдите ближе.';
  if (v.alt > 0) return 'Машина в воздухе.';
  if (v.alt < 0) return 'Подлодка под водой.';
  let s = Number.isInteger(seat) ? seat : null;
  if (s !== null && (s < 0 || s >= def.seats || v.seats[s])) return 'Это место занято.';
  if (s === null) {
    const canDrive = !v.seats[0] && !accessError(room, v, c, true);
    s = canDrive ? 0 : v.seats.findIndex((x, i) => i > 0 && !x);
    if (s < 0) return v.seats[0] && def.seats === 1 ? 'Место занято.' : accessError(room, v, c, true) || 'Свободных мест нет.';
  }
  const err = accessError(room, v, c, s === 0);
  if (err) return err;
  v.seats[s] = c.account.id;
  c.veh = { id: v.id, seat: s };
  c.speedMul=s===0?speedMul(c):0;
  c.path = []; c.dir = null;
  // первый водитель ничейной машины становится хозяином (если не превышен предел)
  if (s === 0 && !v.owner) claim(c, v);
  realtime.teleport(c, v.x, v.y);
  touch(v);
  sendSeat(c, v);
  console.info('[vehicles] посадка: account=%s vehicle=%s type=%s seat=%d',c.account.username||c.account.id,v.id,def.id,s);
  chat.tell(c, `Вы в машине «${def.name}»: ${s === 0 ? 'за рулём (WASD — ехать' + (def.fly ? ', PageUp/PageDown — высота' : V.canDive(def) ? ', PageDown — погрузиться, PageUp — всплыть' : '') + ')' : s === def.gunner ? 'у бортового оружия (1–9 или [ ] — вид оружия, ПКМ — огонь)' : 'пассажиром'}. Y — выйти.`);
  return null;
}
function claim(c, v) {
  const mine = [...stateFor(c.room.world).list.values()].filter((x) => x.owner === c.account.id).length;
  if (mine >= G().vehicleOwnedPerPlayer) return false;
  v.owner = c.account.id; v.ownerName = c.character.name;
  chat.tell(c, `«${defOf(v).name}» теперь ваш${G().vehicleOwnedPerPlayer ? ` (машин: ${mine + 1}/${G().vehicleOwnedPerPlayer})` : ''}. M — запереть.`);
  return true;
}
// Свободная клетка для пешехода рядом с машиной
function exitSpot(room, c, v) {
  return realtime.asActor(room, c.account.id, () => {
    room.map.drive = null;
    const b=V.bodyAt(v.def,v);
    for(const side of [1,-1]){
      const p={x:b.x+side*b.vx*(b.halfWidth+.6),y:b.y+side*b.vy*(b.halfWidth+.6)};
      if(!M.validatePosition(room.map,p))return p;
    }
    for (let r = 0; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const p = { x: Math.floor(v.x) + dx + 0.5, y: Math.floor(v.y) + dy + 0.5 };
        if (!M.validatePosition(room.map,p)&&V.pointBodyDistance(p,b)>.25) return p;
      }
    }
    return { x: v.x, y: v.y };
  }, c);
}
// Выйти (force — без проверок: машина разбита, герой ушёл из мира)
function exit(c, force = false) {
  const v = vehicleOf(c);
  if (!v) { c.veh = null; return null; }
  const def = defOf(v), room = c.room;
  let fallLevels = 0;
  if (v.alt < 0 && !force) return 'Под водой не выйти — сначала всплывите (PageUp).';
  if (v.alt > 0 && !force) {
    if (G().airDismount !== 'fall') return 'В воздухе не выйти — сначала посадите машину (PageDown).';
    fallLevels = v.alt;
    if (c.veh.seat === 0) { crash(room, v, 'Пилот выпрыгнул — машина падает!'); return null; }
  }
  if (c.veh.seat === 0) unboardCompanions(room, v);
  v.seats[c.veh.seat] = null;
  c.veh = null;
  if (levels().lvOf(c).alt) { levels().lvOf(c).alt = 0; room.broadcast({ t: 'lvl-alt', id: c.account.id, alt: 0 }); }
  const p = exitSpot(room, c, v);
  realtime.teleport(c, p.x, p.y);
  touch(v);
  sendSeat(c, null);
  if (fallLevels) levels().fall(c, fallLevels, `Вы выпрыгнули из машины «${def.name}» с высоты ${fallLevels}.`);
  return null;
}

// ---------- Урон и разрушение ----------
function damage(room, v, amount, why) {
  const def = defOf(v);
  if (!(amount > 0) || v.hp <= 0) return 0;
  if (v.seats.some((id) => id && realtime.godOf(id).vehicleInvulnerable)) return 0;
  v.hp = Math.max(0, v.hp - amount);
  v.hurtAt = Date.now();
  touch(v);
  combat().fx(room, { k: 'hit', t: 'v', id: v.id, n: Math.round(amount), c: 0, d: 'physical' });
  if (v.hp <= 0) crash(room, v, why || `«${def.name}» разбит!`);
  return amount;
}
// Машина разбита (или упала): все выходят, в воздухе — падение
function crash(room, v, text) {
  const def = defOf(v);
  const fallLevels = v.alt > 0 ? v.alt : 0;
  v.hp = fallLevels ? 0 : v.hp; v.wreck = v.hp <= def.hp * G().vehicleWreckMinPct / 100 || v.wreck;
  if (fallLevels) v.wreck = true;
  v.alt = 0; // разбитая подлодка всплывает (экипаж выбирается наверх)
  unboardCompanions(room, v);
  combat().fx(room, { k: 'boom', x: round2(v.x), y: round2(v.y), r: 1.5, f: 'grenade' });
  for (const id of v.seats) {
    const c = id && room.players.get(id);
    if (!c) continue;
    chat.tell(c, text);
    exit(c, true);
    if (fallLevels) levels().fall(c, fallLevels, `Падение вместе с машиной с высоты ${fallLevels}.`);
  }
  v.seats.fill(null);
  // The wreck remains enterable: its occupants can restore it without spare parts.
  touch(v);
}
// Удар по герою в закрытой машине принимает машина (server/combat.js applyHit). Возвращает урон машине или null
function soak(room, c, amount, type) {
  const v = vehicleOf(c);
  if (!v) return null;
  const def = defOf(v);
  if (def.open || v.hp<=0) return null;
  return damage(room, v, V.armorCut(def, amount), `«${def.name}» разбит — вы снаружи!`);
}

// ---------- Низкий полёт ----------
// Клетка, в которую влетает машина, выше её высоты (дом до крыши, лес +2, скалы +4) — удар: урон vehicleLowFlyHitPct % прочности,
// машина и пилот остаются на прежнем месте. Возвращает true, если был удар.
function lowFlyHit(room, v, def, driver, now) {
  if (dist(driver.pos, v) < 0.001) return false;
  let h = 0, name = 'препятствие';
  const distance=dist(driver.pos,v),steps=Math.max(1,Math.ceil(distance/.2)),heading=V.motionHeading(v.facingAngle||0,driver.pos.x-v.x,driver.pos.y-v.y);
  for(let i=0;i<=steps;i++){
    const t=i/steps,body=V.bodyAt(def,{x:v.x+(driver.pos.x-v.x)*t,y:v.y+(driver.pos.y-v.y)*t,alt:v.alt},heading);
    for(let y=Math.floor(body.y-body.extentY);y<=Math.floor(body.y+body.extentY);y++)for(let x=Math.floor(body.x-body.extentX);x<=Math.floor(body.x+body.extentX);x++){
      if(!V.bodyIntersectsCell(body,x,y))continue;
      const z=Houses.obstacleZ(room.map,x,y);if(z>h){h=z;name=Houses.obstacleName(room.map,x,y);}
      const id=y*room.map.width+x;
      if(!(room.map.openGates&&room.map.openGates.has(id))&&room.map.towns?.some(t=>t.walls.includes(id))&&h<4){h=4;name='стену поселения';}
    }
  }
  if (!(v.alt <= h)) return false;
  realtime.teleport(driver, v.x, v.y);
  if (!(v.lowHitAt && now - v.lowHitAt < 700)) {
    v.lowHitAt = now;
    const pct = Math.max(0, Number(G().vehicleLowFlyHitPct) || 0);
    chat.tell(driver, `«${def.name}» задел ${name} на высоте +${v.alt} — поднимитесь выше +${h} (PageUp).`);
    if (pct > 0) damage(room, v, def.hp * pct / 100, `«${def.name}» разбился о препятствие в низком полёте!`);
  }
  return true;
}

// ---------- Тик ----------
function tick(room, dt, now) {
  const g = G();
  if (!g.vehiclesEnabled) return;
  const list = inRoom(room);
  if (!room.level&&keyOfRoom(room)==='ground') processRespawns(room, now);
  for (const v of list) {
    const def = defOf(v);
    for (const id of v.companions || []) {
      const ent = companions().entOf(room, id);
      if (ent) { ent.vehicleId = v.id; ent.x = v.x; ent.y = v.y; ent.path = []; }
    }
    const driver = v.seats[0] && room.players.get(v.seats[0]);
    // кто ушёл из комнаты — освободить место
    for (let i = 0; i < v.seats.length; i++) if (v.seats[i] && !room.players.has(v.seats[i])) { v.seats[i] = null; touch(v); }
    if(require('../shared/recovery').vehicle(v,def,dt,v.seats.some(Boolean)||v.companions.length>0,now,g)){v.soft=true;}
    if (driver) {
      const oldPos = { x: v.x, y: v.y, alt:v.alt, facingAngle:v.facingAngle||0,odometer:v.odometer||0 };
      let moved = dist(driver.pos, v);
      if (moved > 3) moved = 0; // телепорт администратора — не езда
      if (moved > 0) {
        const nextHeading=V.motionHeading(v.facingAngle||0,driver.pos.x-v.x,driver.pos.y-v.y),startBody=V.bodyAt(def,v);
        const blocker=list.find(other=>{
          if(other===v)return false;
          const ob=V.bodyAt(defOf(other),other),startOverlap=V.bodiesOverlap(startBody,ob);
          if(startOverlap&&Math.hypot(driver.pos.x-other.x,driver.pos.y-other.y)>Math.hypot(v.x-other.x,v.y-other.y))return false;
          const turn=Math.atan2(Math.sin(nextHeading-(v.facingAngle||0)),Math.cos(nextHeading-(v.facingAngle||0)));
          const steps=Math.max(1,Math.ceil((moved+Math.abs(turn)*Math.hypot(startBody.halfLength,startBody.halfWidth))/.12));
          for(let i=1;i<=steps;i++){const t=i/steps,body=V.bodyAt(def,{x:v.x+(driver.pos.x-v.x)*t,y:v.y+(driver.pos.y-v.y)*t,alt:v.alt},(v.facingAngle||0)+turn*t);if(V.bodiesOverlap(body,ob))return true;}
          return false;
        });
        if (blocker) { realtime.teleport(driver, oldPos.x, oldPos.y); moved = 0; }
      }
      const speed = dt > 0 ? moved / dt : 0;
      if(moved>0.0001)v.facingAngle=V.motionHeading(v.facingAngle||0,driver.pos.x-v.x,driver.pos.y-v.y);
      // низкий полёт (+1…+5): удар о дом, кроны или скалы — урон и отброс назад; чтобы пролететь — подняться выше препятствия
      if (v.alt > 0 && moved > 0 && !room.level && lowFlyHit(room, v, def, driver, now)) continue;
      v.x = driver.pos.x; v.y = driver.pos.y;
      if (def.fuel.type !== 'none') {
        if (realtime.godOf(driver.account.id).vehicleFuel) {
          if (v.fuel < def.fuel.cap) { v.fuel = def.fuel.cap; touch(v); v.soft = true; }
          v.noFuelSaid = false;
        } else if (moved > 0) {
          v.fuel = Math.max(0, v.fuel - V.fuelFor(def, moved));
          if (v.fuel <= 0 && !v.noFuelSaid) { v.noFuelSaid = true; chat.tell(driver, `Топливо кончилось («${V.FUELS[def.fuel.type].name}») — заправьте машину (J).`); }
        }
      }
      if (moved > 0) {
        if (def.staminaPerSec) { const st = driver.character.vitals; st.stamina = Math.max(0, st.stamina - (def.staminaPerSec + g.staminaRegenPerSec) * dt); combat().markDirty(driver); }
        v.movedAt = now; v.soft = true; // топливо и позиция — не чаще раза в секунду
      }
      if (v.fuel > 0) v.noFuelSaid = false;
      if (v.alt > 0 && def.fuel.type !== 'none' && v.fuel <= 0) { crash(room, v, 'Двигатель заглох в воздухе — падение!'); continue; }
      // подлодка над мелью: поднимается до дна
      if (v.alt < 0 && !room.level) {
        const floor = V.depthAt(room.map, v.x, v.y);
        if (-v.alt > floor) { setAlt(room, v, -floor); chat.tell(driver, floor ? `Мелеет — подлодка поднялась до −${floor}.` : 'Мель — подлодка всплыла.'); }
      }
      // Таран и наезд: проверяем весь отрезок движения, чтобы быстрые машины не пролетали сквозь цель между тиками.
      v.odometer=(v.odometer||0)+moved*V.M_PER_TILE;
      const impact=v.alt===0?hitRammedActors(room,v,def,driver,oldPos,v,speed,now):0;
      if (impact > 0) damage(room, v, Math.min(def.hp*.01,impact*g.vehicleRamSelfPct/100), `«${def.name}» разбит о врага!`);
      // удар о стену на скорости
      if (driver.dir && v.lastSpeed > def.speed * 0.6 && speed < v.lastSpeed * 0.25 && v.hp > 0) damage(room, v, def.hp * g.vehicleCrashDamagePct / 100, `«${def.name}» разбит о препятствие!`);
      v.lastSpeed = speed;
    } else {
      v.lastSpeed = 0;
      if (v.alt < 0) setAlt(room, v, 0); // без водителя подлодка всплывает
    }
    // седоки — вместе с машиной
    for (let i = 1; i < v.seats.length; i++) {
      const c = v.seats[i] && room.players.get(v.seats[i]);
      if (c) { c.pos = { x: v.x, y: v.y }; c.path = []; c.dir = null; c.moving = Boolean(driver && driver.moving); }
    }
    if ((v.dirty && (!v.sentAt || now - v.sentAt > 250)) || (v.soft && now - (v.sentAt || 0) > 1000)) { v.dirty = false; v.soft = false; v.sentAt = now; room.broadcast({ t: 'veh-upd', v: publicVehicle(v) }); }
  }
}
function hitRammedActors(room, v, def, driver, from, to, speed, now) {
  let enemyImpact=0;
  const victims = [];
  for (const e of combat().stateOf(room).enemies.values()) if (!e.dead&&!e.def.fly) victims.push({ kind: 'enemy', ref: e, radius: e.def.radius || 0.4 });
  for (const n of room.stl?.ents?.values?.() || []) victims.push({ kind: 'npc', ref: n, radius: n.radius || 0.35 });
  for (const ent of companions().stateOf(room).ents.values()) if (!ent.vehicleId&&!ent.def?.fly) victims.push({ kind: 'companion', ref: ent, radius: ent.radius || 0.4 });
  for (const c of room.players.values()) if (c !== driver && !c.veh && !combat().cbOf(c).dead) victims.push({ kind: 'player', ref: c, radius: 0.3 });
  for (const victim of victims) {
    const target = victim.kind === 'player' ? {...victim.ref.pos,alt:victim.ref.lvl?.alt||0} : victim.ref;
    const contact=V.vehicleContact(def,from,to,target,victim.radius,speed);
    if(!contact)continue;
    const amount=contact.damage;
    if ((victim.ref.vehicleRamAt || 0) > now - 750) continue;
    victim.ref.vehicleRamAt = now;
    let dealt = 0;
    if (victim.kind === 'enemy') dealt = combat().companionHit(room, { id: driver.account.id, x: to.x, y: to.y }, victim.ref, amount, 'physical', driver, []);
    else if (victim.kind === 'npc') dealt = require('./settlements').hurt(room, victim.ref, amount, 'physical', { kind: 'e', e: { id: `vehicle:${v.id}`, x: to.x, y: to.y, def: { name: def.name } } });
    else if (victim.kind === 'companion') dealt = companions().hitByVehicle(room, victim.ref, amount, 'physical');
    else dealt = combat().vehicleHitPlayer(room, v, def, victim.ref, amount);
    if(dealt>0){
      const status=victim.kind==='player'?combat().cbOf(victim.ref):victim.ref;
      status.stunUntil=Math.max(status.stunUntil||0,now+contact.stunSec*1000);
      if(contact.knockback>0)shoveVictim(room,victim,from,to,contact.knockback);
      if(victim.kind==='enemy')enemyImpact=Math.max(enemyImpact,amount);
    }
  }
  return enemyImpact;
}
function shoveVictim(room, victim, from, to, distance) {
  const ref = victim.ref, p = victim.kind === 'player' ? ref.pos : ref;
  let dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
  if (len < 0.02) { dx = p.x - to.x; dy = p.y - to.y; len = Math.hypot(dx, dy); }
  if (len < 0.02) return;
  dx /= len; dy /= len;
  let x = p.x, y = p.y;
  for (let step = 0.2; step <= distance + 1e-5; step += 0.2) {
    const nx = p.x + dx * Math.min(distance, step), ny = p.y + dy * Math.min(distance, step);
    if (!M.posWalkable(room.map, nx, ny)) break;
    x = nx; y = ny;
  }
  if (Math.hypot(x - p.x, y - p.y) < 0.05) return;
  if (victim.kind === 'player') realtime.teleport(ref, x, y);
  else { ref.x = x; ref.y = y; ref.path = []; }
}
function processRespawns(room, now) {
  const st = stateFor(room.world), pending = st.respawns;
  for (let i = pending.length - 1; i >= 0; i--) {
    const entry = pending[i];
    if (entry.at > now) continue;
    if (G().vehicleMaxPerWorld > 0 && st.list.size >= G().vehicleMaxPerWorld) { entry.at = now + 30000; continue; }
    const occupied = (x, y) => [...st.list.values()].some((v) => v.room === 'ground' && Math.hypot(v.x - x, v.y - y) < Math.max(3, (V.get(v.def).radius || 0.6) + 1));
    const sites = [...V.worldSpawns(room.map), { x: entry.x, y: entry.y }].filter((s) => !occupied(s.x, s.y));
    let def = null, spot = null;
    for (let attempt = 0; attempt < 30 && sites.length; attempt++) {
      const candidate = V.randomDef();
      const compatible = sites.filter(s=>V.canPlaceBody(room.map,candidate,s)&&!inRoom(room).some(v=>V.bodiesOverlap(V.bodyAt(candidate,s),V.bodyAt(defOf(v),v))));
      if (compatible.length) { def = candidate; spot = compatible[Math.floor(Math.random() * compatible.length)]; break; }
    }
    if (!spot) { entry.at = now + 30000; continue; }
    const v = blank(def, { x: spot.x, y: spot.y, room: 'ground', hp: def.hp, fuel: Math.round(def.fuel.cap * 0.3), natural: true });
    st.list.set(v.id, v);
    pending.splice(i, 1);
    room.broadcast({ t: 'veh-upd', v: publicVehicle(v) });
    save(room.worldId);
  }
}
// Множитель скорости героя в машине: null — не в машине; седок — 0; водитель — скорость машины (нет топлива, сил — 0)
function speedMul(c) {
  const v = vehicleOf(c);
  if (!v) return null;
  if (c.veh.seat !== 0) return 0;
  const def = defOf(v);
  if(!V.drivable(def,v))return 0;
  if (def.fuel.type !== 'none' && v.fuel <= 0 && !realtime.godOf(c.account.id).vehicleFuel) return 0;
  if (def.staminaPerSec && c.character.vitals.stamina <= 0) return 0.25;
  return V.speedMul(def, v, M.settings.heroSpeed);
}
// Режим движения для карты (server/realtime.js asActor): только у водителя
function driveOf(c) {
  const v = vehicleOf(c);
  return v && c.veh.seat === 0 ? V.drive(defOf(v),v.alt,v.facingAngle||0) : null;
}
const sealed = (c) => { const v = vehicleOf(c); return Boolean(v && defOf(v).sealed); };
const inside = (c) => Boolean(vehicleOf(c));

// ---------- Бортовое оружие (server/combat.js onAtk) ----------
// undefined — обычная атака своим оружием; иначе текст ошибки или null
function rearSector(v, point) {
  const bearing=Math.atan2(point.y-v.y,point.x-v.x), heading=Number.isFinite(v.facingAngle)?v.facingAngle:0;
  const delta=Math.atan2(Math.sin(bearing-heading),Math.cos(bearing-heading));
  return Math.abs(delta)>Math.PI/2;
}
// Выбранный вид оружия места (driver/gunner): msg.vw — id группы из V.armsOf (без него — последний выбранный или первый)
function armGroup(def, v, c, msg) {
  const groups = V.armsOf(def);
  if (!groups.length) return null;
  v.armSel = v.armSel || {};
  if (typeof msg.vw === 'string' && groups.some((g) => g.id === msg.vw)) v.armSel[c.veh.seat] = msg.vw;
  const want = v.armSel[c.veh.seat] || groups[0].id;
  return groups.find((g) => g.id === want) || groups[0];
}
// Повернуть башню установки к точке (8 направлений, как модель)
function turnTurret(v, frame, point) {
  const key = frame === 'rear' ? 'rearTurretDir' : 'turretDir';
  const dir = (Math.round(Math.atan2(point.y - v.y, point.x - v.x) / (Math.PI / 4)) + 8) % 8;
  if (v[key] !== dir) { v[key] = dir; touch(v); }
}
// Цель для управляемой ракеты: выбранный враг/житель/игрок или ближайший враждебный в 3 клетках от точки прицела
function guideTarget(room, c, msg, aim) {
  const list = combat().hostiles(room, { kind: 'p', c, id: c.account.id });
  const keyOf = (h) => h.kind + ':' + (h.kind === 'p' ? h.ref.account.id : h.ref.id);
  if (typeof msg.target === 'string' && msg.tk) { const h = list.find((x) => keyOf(x) === msg.tk + ':' + msg.target); if (h) return keyOf(h); }
  let best = null, bd = 3;
  for (const h of list) { const d = Math.hypot(h.x - aim.x, h.y - aim.y); if (d < bd) { bd = d; best = h; } }
  return best ? keyOf(best) : null;
}
function attack(c, msg) {
  const v = vehicleOf(c);
  if (!v) return undefined;
  const def = defOf(v), room = c.room, now = Date.now();
  const gunner = def.gunner ?? 0;
  const groups = V.armsOf(def);
  if (!groups.length || (c.veh.seat !== gunner && c.veh.seat !== 0)) {
    if (def.open && !(v.alt < 0)) return undefined;
    return groups.length ? 'Бортовое оружие управляется водителем или стрелком.' : 'Из закрытой машины не выстрелить.';
  }
  let aim = null;
  if (msg.tk === 'e' && typeof msg.target === 'string') { const e = combat().stateOf(room).enemies.get(msg.target); if (e && !e.dead) aim = { x: e.x, y: e.y }; }
  if (!aim && Number.isFinite(msg.x) && Number.isFinite(msg.y)) aim = { x: msg.x, y: msg.y };
  if (!aim) return 'Не указана цель.';
  const group = armGroup(def, v, c, msg);
  if (v.alt < 0 && !group.deep) return `«${group.name}» не стреляет из-под воды — всплывите (PageUp) или выберите торпеды/ракеты.`;
  if (group.air && !(v.alt > 0)) return 'Бомбы сбрасываются только в полёте (PageUp — взлететь).';
  // установки группы, которые достают до цели (сектор наведения башни/пилона)
  const ok = group.mounts.filter((m) => V.inArc(def, v, m, aim));
  if (!ok.length) return `Цель вне сектора обстрела: «${group.name}».`;
  v.armNext = v.armNext || {};
  v.armShot = v.armShot || {};
  const mount = ok[(v.armNext[group.id] || 0) % ok.length];
  if (mount.frame !== 'hull') turnTurret(v, mount.frame, aim);
  const it = group.item ? Items.get(group.item) : null;
  const prof = it ? Combat.profile(it) : V.armProfile(group.type);
  if (now - (v.armShot[group.id] || 0) < Combat.cooldownMs(prof) * G().attackSpeedTolerance) return 'Слишком быстро.';
  const mw = V.mountWorld(def, v, mount);
  const isWater = (x, y) => { const b = WorldGen.BIOMES[WorldGen.tileAt(room.map, Math.floor(x), Math.floor(y))]; return Boolean(b && (b.swim || b.underwater)); };
  if (group.water && !isWater(mw.x, mw.y)) return 'Торпеда идёт только по воде: аппарат должен быть над водой.';
  if (prof.ammo && !realtime.godOf(c.account.id).vehicleAmmo) {
    if (!Inv.rounds(c.character, prof.ammo)) return `Нет боеприпасов для «${it ? it.name : group.name}»: «${Items.get(prof.ammo).name}».`;
    Inv.takeRounds(c.character, prof.ammo, 1);
    const cb = combat().cbOf(c); cb.invDirtyAt = cb.invDirtyAt || now;
    combat().markDirty(c);
  }
  v.armShot[group.id] = now;
  v.armNext[group.id] = (v.armNext[group.id] || 0) + 1;
  // совместимость: время последнего выстрела носовой/кормовой установки
  if (mount.frame === 'rear') v.lastRearShot = now; else v.lastShot = now;
  touch(v);
  prof.stealthCrit = require('./magic').hidden(c); require('./magic').onAttack(c);
  const owner = { kind: 'p', c, id: c.account.id };
  const opts = { veh: v.id, hp: mount.id, h: Math.round(mw.z * V.UNITS_PER_M * 100) / 100, alt: v.alt || 0, up: Boolean(mount.up) };
  let dir = { x: aim.x - mw.x || 0.01, y: aim.y - mw.y };
  if (group.type === 'bomb') {
    const d = Math.min(prof.range, Math.hypot(aim.x - mw.x, aim.y - mw.y));
    opts.mode = 'bomb'; opts.fall = Math.max(0.5, d);
  } else if (group.type === 'torpedo') opts.mode = 'torpedo';
  else if (group.guided) {
    opts.track = guideTarget(room, c, msg, aim);
    opts.aim = { x: aim.x, y: aim.y };
    // ракета выходит по направлению пусковой (из вертикальной шахты — по курсу на цель)
    if (!mount.up) dir = { x: Math.cos(mw.a), y: Math.sin(mw.a) };
  }
  combat().shoot(room, owner, { x: mw.x, y: mw.y }, dir, prof, opts);
  return null;
}
function aim(c, msg) {
  const v = vehicleOf(c);
  if (!v) return undefined;
  const def = defOf(v);
  if (!V.armsOf(def).length || (c.veh.seat !== (def.gunner ?? 0) && c.veh.seat !== 0)) return 'Башней управляет водитель или стрелок.';
  if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return 'Некорректное направление.';
  const point = { x: Math.max(0, Math.min(c.room.map.width, msg.x)), y: Math.max(0, Math.min(c.room.map.height, msg.y)) };
  const turrets = V.turretsOf(def);
  // носовая или кормовая башня — по полусфере (если есть кормовая)
  const frame = turrets.rear && rearSector(v, point) ? 'rear' : turrets.front ? 'front' : null;
  if (frame) turnTurret(v, frame, point);
  return null;
}

// ---------- Высота полёта (server/levels.js altitude) ----------
// undefined — не в машине (пусть решает логика дракона)
function altitude(c, d) {
  const v = vehicleOf(c);
  if (!v) return undefined;
  const def = defOf(v), room = c.room;
  if (V.canDive(def)) return dive(c, v, def, d);
  if (!def.fly) return 'Эта машина не летает.';
  if (c.veh.seat !== 0) return 'Высотой управляет пилот.';
  if (room.level) return 'Взлетать можно только над поверхностью.';
  const top = Levels.airTop(G().airMaxAltitude);
  const next = Math.max(0, Math.min(top, v.alt + (d > 0 ? 1 : -1)));
  if (next === v.alt) return next ? 'Выше не подняться.' : null;
  const under = Houses.obstacleZ(room.map, v.x, v.y);
  if (next > 0 && next < v.alt && next <= under) return `Ниже — ${Houses.obstacleName(room.map, v.x, v.y)}: снижаться здесь нельзя.`;
  const t = WorldGen.tileAt(room.map, Math.floor(v.x), Math.floor(v.y));
  if (v.alt === 0 && !V.canTakeOff(def, t)) return def.vtol ? 'Взлёт — только с суши.' : 'Самолёту нужна ровная полоса: город, пустошь или поселение.';
  if (next === 0 && !V.canTakeOff(def, t)) return def.vtol ? 'Внизу нельзя сесть — найдите сушу.' : 'Посадка — только на ровную землю (город, пустошь, поселение).';
  if (def.fuel.type !== 'none' && v.fuel <= 0) return 'Нет топлива.';
  setAlt(room, v, next);
  return null;
}
// Высота машины и всех седоков (lvOf(c).alt: > 0 — в воздухе, < 0 — под водой)
function setAlt(room, v, next) {
  v.alt = next;
  for (const id of v.seats) {
    const o = id && room.players.get(id);
    if (!o) continue;
    levels().lvOf(o).alt = next;
    room.broadcast({ t: 'lvl-alt', id, alt: next });
    levels().sendLv(o);
  }
  touch(v);
}
// Подлодка: PageDown — погрузиться на уровень (до −vehicleDiveMaxDepth и не глубже дна), PageUp — всплыть.
// Вертикаль: 0 — уровень моря, −1…−5 — глубина (shared/vehicles.js depthAt: чем дальше от берега, тем глубже)
function dive(c, v, def, d) {
  const room = c.room;
  if (c.veh.seat !== 0) return 'Глубиной управляет водитель.';
  if (room.level) return 'Здесь уже глубина — подниматься к поверхности через места погружения (U).';
  const max = Math.max(0, Math.min(V.DEPTH_MAX, Number(G().vehicleDiveMaxDepth ?? V.DEPTH_MAX)));
  if (!max) return 'Погружение отключено настройкой vehicleDiveMaxDepth.';
  const floor = V.depthAt(room.map, v.x, v.y);
  if (!floor) return 'Погружаться можно только на воде.';
  const bottom = -Math.min(max, floor);
  const next = Math.max(bottom, Math.min(0, v.alt + (d > 0 ? 1 : -1)));
  if (next === v.alt) return next === 0 ? 'Подлодка уже на поверхности.' : floor < max ? `Глубже нельзя: здесь дно на −${floor}. Мористее — глубже.` : `Предельная глубина −${max}.`;
  if (def.fuel.type !== 'none' && v.fuel <= 0 && next < v.alt) return 'Нет топлива — погружаться нельзя.';
  setAlt(room, v, next);
  return null;
}

// ---------- Через вход уровня (server/levels.js go): только подлодка через места погружения ----------
function throughPortal(c, p, t) {
  const v = vehicleOf(c);
  const def = defOf(v), room = c.room, map = worlds.getMap(room.world);
  if(p.kind==='travel'){
    if(c.veh.seat!==0)return 'Переход выбирает водитель.';
    if(!V.drivable(def,v))return 'Дождитесь восстановления машины или используйте автозапчасти (O).';
    const target=t.key==='ground'?map:Levels.level(map,t.key);
    const destination=realtime.roomFor(room.world,t.key,c);
    if(!destination)return 'Регион недоступен.';
    const hulls=inRoom(destination).filter(other=>other!==v).map(other=>V.bodyAt(other.def,other));
    const actors=[...[...destination.players.values()].map(other=>other.pos),...companions().stateOf(destination).ents.values(),...(destination.stl?.ents.values()||[])];
    const spot=V.findBerth(target,def,{x:t.x+.5,y:t.y+.5,facingAngle:v.facingAngle},p=>{const body=V.bodyAt(def,p);return !hulls.some(other=>V.bodiesOverlap(body,other))&&!actors.some(other=>V.pointBodyDistance(other,body)<.5);});
    if(!spot){if(!destination.players.size)destination.destroy();return 'В этом регионе нет свободного места для корпуса этой техники.';}
    v.facingAngle=spot.facingAngle||0;
    return moveTo(room,v,t.key,spot.x-.5,spot.y-.5);
  }
  if (!def.sealed) return 'Выйдите из машины (Y), чтобы пройти.';
  if (c.veh.seat !== 0) return 'Нырять решает водитель.';
  const to = t.key === 'ground' ? null : Levels.level(map, t.key);
  if (to ? !to.underwater : !(room.level && room.level.underwater)) return 'Подлодка проходит только под воду и обратно.';
  return moveTo(room, v, t.key, t.x, t.y);
}
// Перенести машину с седоками на другой уровень
function moveTo(room, v, key, x, y) {
  const riders = v.seats.map((id) => id && room.players.get(id)).filter(Boolean);
  room.broadcast({ t: 'veh-remove', id: v.id });
  v.room = key; v.x = x + 0.5; v.y = y + 0.5; v.alt = 0;
  for (const c of riders) {
    c.vehMoving = true;
    let err;
    try { err = realtime.changeLevel(c, key, x, y); } finally { c.vehMoving = false; }
    if (err) return err;
    realtime.teleport(c, v.x, v.y);
    sendSeat(c, v);
  }
  const nr = roomOfVehicle(room.world, v);
  if (nr) nr.broadcast({ t: 'veh-upd', v: publicVehicle(v) });
  save(room.worldId);
  return null;
}

// ---------- Заправка, ремонт, замок, багажник ----------
function near(c, id) {
  const v = vehicleOf(c) || nearest(c.room, c, id);
  const def = v && defOf(v);
  if (!v || (!vehicleOf(c) && V.pointBodyDistance(c.pos,V.bodyAt(v.def,v)) > G().vehicleEnterRange + def.radius)) return null;
  return v;
}
function refuel(c, id) {
  const v = near(c, id);
  if (!v) return 'Рядом нет машины.';
  const def = defOf(v);
  if (def.fuel.type === 'none') return `«${def.name}» едет без топлива.`;
  const need = Math.ceil(def.fuel.cap - v.fuel - 1e-6);
  if (need <= 0) return 'Бак полон.';
  const item = V.FUELS[def.fuel.type].item;
  let got = 0;
  inventory.mutate(c.account, c.character.id, (ch) => {
    if (!Inv.rounds(ch, item)) return `Нет топлива: «${Items.get(item).name}».`;
    got = Inv.takeRounds(ch, item, need);
    return null;
  });
  v.fuel = Math.min(def.fuel.cap, v.fuel + got);
  touch(v);
  chat.tell(c, `Заправлено ${got} ед. (${Math.floor(v.fuel)}/${def.fuel.cap}).`);
  return null;
}
function repair(c, id) {
  const v = near(c, id);
  if (!v) return 'Рядом нет машины.';
  const def = defOf(v), g = G();
  if (v.hp >= def.hp) return 'Машина цела.';
  const cap = 100;
  const want = V.repairNeed(def, v, cap);
  if (want <= 0) return `В поле — не выше ${cap}% прочности. Для полного ремонта — к верстаку своей базы.`;
  const infiniteParts = realtime.godOf(c.account.id).vehicleParts;
  let used = 0;
  inventory.mutate(c.account, c.character.id, (ch) => {
    const have = Inv.count(ch, 'veh_parts');
    if (!have && !infiniteParts) return `Нужны «${Items.get('veh_parts').name}» (крафт в кузнице, добыча в тайниках и у рейдеров).`;
    used = infiniteParts ? want : Math.min(have, want);
    if (!infiniteParts) Inv.takeById(ch, 'veh_parts', used);
    return null;
  });
  v.hp = Math.min((def.hp * cap) / 100, v.hp + (used * def.hp * g.vehicleRepairPerParts) / 100);
  if (v.hp > def.hp * g.vehicleWreckMinPct / 100) v.wreck = false;
  if (!v.owner) claim(c, v);
  touch(v);
  chat.tell(c, `Мгновенный ремонт: ${infiniteParts ? 'бесплатно (бесконечные автозапчасти)' : `${used} × автозапчасти`} → ${Math.round((v.hp / def.hp) * 100)}%. Без запчастей сядьте внутрь — ремонт идёт медленно.`);
  return null;
}
function cheatAction(c, op) {
  const seated = vehicleOf(c);
  const v = seated || nearest(c.room, c);
  if (!v) throw new auth.HttpError(404, 'В этом месте нет транспорта.');
  const def = defOf(v);
  if (!seated && V.pointBodyDistance(c.pos,V.bodyAt(v.def,v)) > G().vehicleEnterRange + def.radius) throw new auth.HttpError(400, 'Подойдите к машине ближе или займите в ней место.');
  if (op === 'repair') {
    v.hp = def.hp; v.wreck = false; touch(v);
    c.room.broadcast({ t: 'veh-upd', v: publicVehicle(v) });
    save(c.room.worldId);
    return `«${def.name}» полностью отремонтирована.`;
  }
  if (op === 'refuel') {
    if (def.fuel.type === 'none') throw new auth.HttpError(400, `«${def.name}» не использует топливо.`);
    v.fuel = def.fuel.cap; v.noFuelSaid = false; touch(v);
    c.room.broadcast({ t: 'veh-upd', v: publicVehicle(v) });
    save(c.room.worldId);
    return `Бак «${def.name}» заполнен (${v.fuel}/${def.fuel.cap}).`;
  }
  if (op === 'ammo') {
    if (!def.weapon) throw new auth.HttpError(400, `У «${def.name}» нет бортового оружия.`);
    const item = Items.get(def.weapon.item), ammo = item && item.weapon && item.weapon.ammo;
    if (!ammo) throw new auth.HttpError(400, `Для оружия «${def.weapon.item}» боезапас не требуется.`);
    const ammoItem = Items.get(ammo);
    const rounds = Math.max(1, item.weapon.magazine || 60);
    const count = Math.ceil(rounds / ((ammoItem && ammoItem.rounds) || 1));
    inventory.mutate(c.account, c.character.id, (ch) => Inv.add(ch, ammo, count));
    return `В сумку добавлен боезапас «${ammoItem.name}» для «${def.name}» (${rounds} выстрелов).`;
  }
  throw new auth.HttpError(400, 'Неизвестное действие с транспортом.');
}
function lock(c, id) {
  const v = near(c, id);
  if (!v) return 'Рядом нет машины.';
  if (v.owner !== c.account.id && c.account.role !== 'admin') return v.owner ? 'Запирать может только хозяин.' : 'Сначала сделайте машину своей: сядьте за руль или почините.';
  v.locked = !v.locked;
  touch(v);
  chat.tell(c, v.locked ? 'Машина заперта: водить и садиться могут только вы и допущенные на вашу базу.' : 'Машина открыта для всех.');
  return null;
}
// Багажник: op 'put' (из сумки, i — ячейка) или 'take' (i — ячейка багажника)
function cargo(c, m) {
  const v = near(c, m.id);
  if (!v) return 'Рядом нет машины.';
  const def = defOf(v);
  if (!def.cargo) return 'У этой машины нет багажника.';
  if (!trusted(c.room, v, c) && v.locked) return 'Машина заперта.';
  const i = Number(m.i);
  if (!Number.isInteger(i) || i < 0) return 'Некорректная ячейка.';
  if (m.op === 'put') {
    if (v.cargo.filter(Boolean).length >= def.cargo) return 'Багажник полон.';
    let moved = null;
    inventory.mutate(c.account, c.character.id, (ch) => {
      const a = ch.inventory.cells[i];
      if (!a) return 'Ячейка пуста.';
      moved = a; ch.inventory.cells[i] = null;
      return null;
    });
    const j = v.cargo.findIndex((x) => !x);
    if (j >= 0) v.cargo[j] = moved; else v.cargo.push(moved);
  } else if (m.op === 'take') {
    const x = v.cargo[i];
    if (!x) return 'В багажнике там пусто.';
    const { id, n, dur, uid, ...extra } = x;
    inventory.mutate(c.account, c.character.id, (ch) => Inv.add(ch, id, n || 1, dur, Object.keys(extra).length ? extra : null));
    v.cargo.splice(i, 1);
  } else return 'Неизвестное действие.';
  touch(v);
  return null;
}

// Набор-машина (предмет с vehicle): поставить рядом, хозяин — герой
function onUse(ch, inst, it, ctx, take) {
  if (!it.vehicle) return undefined;
  const c = ctx && ctx.client;
  if (!c || !c.room) return 'Собрать машину можно только в мире.';
  const def = V.get(it.vehicle);
  const spot = placeSpot(c.room, def, c.pos);
  if (!spot) return def.kind === 'water' ? 'Подойдите к воде — лодку нужно спустить на воду.' : 'Здесь не поставить — найдите ровное место.';
  const st = stateFor(c.room.world);
  if (st.list.size >= G().vehicleMaxPerWorld) return 'В мире слишком много техники.';
  take();
  const v = blank(def, { x: spot.x, y: spot.y, room: keyOfRoom(c.room),facingAngle:spot.facingAngle });
  st.list.set(v.id, v);
  claim(c, v);
  c.room.broadcast({ t: 'veh-upd', v: publicVehicle(v) });
  return null;
}
Inv.setUseHook(onUse, true);
function placeSpot(room, def, pos) {
  if(def.id==='submarine')return V.findBerth(room.map,def,pos);
  for (let r = 0; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = Math.floor(pos.x) + dx, y = Math.floor(pos.y) + dy;
    const spot={x:x+.5,y:y+.5};
    if(V.canPlaceBody(room.map,def,spot)&&!inRoom(room).some(v=>V.bodiesOverlap(V.bodyAt(def,spot),V.bodyAt(defOf(v),v))))return spot;
  }
  return null;
}

// ---------- Администратор ----------
function adminRoom(body) {
  const c = body.username ? require('./admin').requireOnline(String(body.username)) : null;
  return c;
}
function adminSpawn(admin, body = {}) {
  const c = adminRoom(body) || require('./admin').selfClient(admin);
  const q = String(body.def || '').trim().toLowerCase();
  const def = V.get(q) || V.LIST.find((d) => d.name.toLowerCase().includes(q));
  if (!def) throw new auth.HttpError(404, `Нет такой техники. Есть: ${V.LIST.map((d) => d.id).join(', ')}.`);
  const at = Number.isFinite(Number(body.x)) && Number.isFinite(Number(body.y)) && body.x !== null && body.y !== null ? { x: Number(body.x), y: Number(body.y) } : c.pos; // чит-панель: у курсора
  const spot = placeSpot(c.room, def, at) || { x: at.x, y: at.y };
  const v = blank(def, { x: spot.x, y: spot.y, room: keyOfRoom(c.room), fuel: def.fuel.cap, wreck: Boolean(body.wreck), hp: body.wreck ? Math.round(def.hp * 0.15) : def.hp });
  if (body.own) { v.owner = c.account.id; v.ownerName = c.character.name; }
  stateFor(c.room.world).list.set(v.id, v);
  c.room.broadcast({ t: 'veh-upd', v: publicVehicle(v) });
  save(c.room.worldId);
  auth.logAdmin(admin, 'vehicle-spawn', { worldId: c.room.worldId, def: def.id, id: v.id, x: v.x, y: v.y });
  return { vehicle: publicVehicle(v) };
}
function findAny(id) {
  for (const [wid, st] of worldsState) { const v = st.list.get(id); if (v) return { wid, st, v }; }
  throw new auth.HttpError(404, 'Машина не найдена (мир не загружен или id неверен).');
}
function adminAct(admin, body = {}) {
  const { wid, st, v } = findAny(String(body.id || ''));
  const def = defOf(v), world = worlds.load(wid), room = roomOfVehicle(world, v);
  const op = String(body.op || '');
  if (op === 'remove') {
    if (room) for (const id of v.seats) { const c = id && room.players.get(id); if (c) exit(c, true); }
    st.list.delete(v.id);
    if (room) room.broadcast({ t: 'veh-remove', id: v.id });
  } else if (op === 'repair') { v.hp = def.hp; v.wreck = false; }
  else if (op === 'refuel') v.fuel = def.fuel.cap;
  else throw new auth.HttpError(400, 'op: remove | repair | refuel.');
  touch(v);
  if (room && op !== 'remove') room.broadcast({ t: 'veh-upd', v: publicVehicle(v) });
  save(wid);
  auth.logAdmin(admin, 'vehicle-' + op, { worldId: wid, id: v.id, def: v.def });
  return { ok: true, id: v.id, vehicle: op === 'remove' ? null : publicVehicle(v) };
}
function adminList(body = {}) {
  const wid = String(body.worldId || '');
  let st = worldsState.get(wid);
  if (!st && wid) { try { st = stateFor(worlds.load(wid)); } catch { throw new auth.HttpError(404, 'Мир не найден.'); } }
  const out = [];
  for (const [w, s] of st ? [[wid, st]] : worldsState) for (const v of s.list.values()) out.push({ worldId: w, room: v.room, ...publicVehicle(v), name: defOf(v).name });
  return { vehicles: out, catalogue: V.LIST.map((d) => ({ id: d.id, name: d.name })) };
}

// ---------- Подключение ----------
function safely(c, action, fn) {
  let err;
  try { err = fn(); } catch (e) { err = e.message || String(e); }
  if (err) { console.warn('[vehicles] действие отклонено: account=%s action=%s: %s',c.account.username||c.account.id,action,err); realtime.send(c, { t: 'veh-reject', message: err }); }
  return err;
}
realtime.use({
  welcome: (room) => (G().vehiclesEnabled ? { vehicles: inRoom(room).map(publicVehicle) } : { vehicles: [] }),
  onJoin: (room, c) => { const v = vehicleOf(c); if (v) sendSeat(c, v); },
  beforeLeave: (room, c) => { if (c.veh && !c.vehMoving) { if (vehicleOf(c)) { const v = vehicleOf(c); v.seats[c.veh.seat] = null; if (c.veh.seat === 0 && v.alt > 0 && !v.seats.some(Boolean)) v.alt = 0; touch(v); } c.veh = null; if(c.savedPos)c.pos={...c.savedPos}; } },
  onSaveWorld: (room) => save(room.worldId),
  onDestroy: (room) => { // последняя комната мира закрыта — сохранить и выгрузить (при следующем входе — из файла)
    if (!worldsState.has(room.worldId) || room.removed) return;
    save(room.worldId);
    if (!realtime.worldRooms(room.worldId).some((r) => r !== room)) worldsState.delete(room.worldId);
  },
  tick,
  playerState: (c) => (c.veh ? { vh: c.veh.id, st: c.veh.seat } : {}),
  publicExtra: (c) => (c.veh ? { vh: c.veh.id, st: c.veh.seat } : {}),
  handlers: {
    'veh-aim': (c, m) => safely(c, 'aim', () => aim(c, m || {})),
    'veh-enter': (c, m) => safely(c, 'enter', () => enter(c, typeof m.id === 'string' ? m.id : null, Number.isInteger(m.seat) ? m.seat : null)),
    'veh-exit': (c) => safely(c, 'exit', () => exit(c)),
    'veh-refuel': (c, m) => safely(c, 'refuel', () => refuel(c, typeof m.id === 'string' ? m.id : null)),
    'veh-repair': (c, m) => safely(c, 'repair', () => repair(c, typeof m.id === 'string' ? m.id : null)),
    'veh-lock': (c, m) => safely(c, 'lock', () => lock(c, typeof m.id === 'string' ? m.id : null)),
    'veh-cargo': (c, m) => safely(c, 'cargo', () => cargo(c, m)),
  },
});

module.exports = { hitRammedActors,stateFor, save, inRoom, vehicleOf, isDriver, enter, exit, damage, crash, soak, tick, speedMul, driveOf, sealed, inside, attack, altitude, throughPortal, moveTo, refuel, repair, cheatAction, lock, cargo, adminSpawn, adminAct, adminList, publicVehicle, trusted, boardCompanions, boardEnt, unboardCompanions };
