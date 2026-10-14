'use strict';
// Спутники, приручение, драконы (шаг 11). Правила и формулы — shared/companions.js.
// Записи спутников живут на герое (character.companions) и переходят с ним между мирами.
// В комнате мира: room.comp = { ents: Map id → сущность призванного спутника, cd: Map аккаунт → время следующей попытки,
//   depotsDone }; сущность: { id, owner (аккаунт), x, y, path, repathAt, nextAttack, target, fly, radius }.
// Верховой дракон: c.mount = id спутника; герой движется быстрее (compMountSpeed) и летает над водой и горами.
const crypto = require('crypto');
const realtime = require('./realtime');
const chat = require('./chat');
const config = require('./config');
const ground = require('./ground');
const inventory = require('./inventory');
const C = require('../shared/companions');
const Enemies = require('../shared/enemies');
const Items = require('../shared/items');
const Inv = require('../shared/inventory');
const Combat = require('../shared/combat');
const WorldGen = require('../shared/worldgen');
const Difficulty = require('../shared/difficulty');
const M = require('../shared/movement');
const Levels = require('../shared/levels');
const Houses = require('../shared/houses');

const G = () => config.get().game;
const combat = () => require('./combat');
const round2 = (v) => Math.round(v * 100) / 100;
const newId = () => 'c' + crypto.randomBytes(4).toString('hex');
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function stateOf(room) {
  if (!room.comp) room.comp = { ents: new Map(), cd: new Map() };
  return room.comp;
}
const recOf = (c, id) => (c && c.character ? C.list(c.character).find((r) => r.id === id) : null);
const ownerOf = (room, ent) => ent.autonomous || room.players.get(ent.owner) || null;
function markDirty(c) { if (c.cb) c.cb.dirty = true; }
const publicComp = (rec, ent) => ({
  id: rec.id, def: rec.def, name: rec.name, lvl: rec.level, hp: Math.ceil(rec.hp), max: C.statsOf(rec).maxHp, kind: rec.kind, method: rec.method,
  out: rec.out ? 1 : 0, down: rec.down || 0, until: rec.until || 0, order: rec.order, stance: rec.stance, food: Math.round(rec.food == null ? 100 : rec.food),
  xp: rec.xp || 0, next: C.xpToNext(rec.level), equip: rec.equip || {}, bag: rec.bag || [], spells: require('./companion-magic').known(rec), mp: Math.floor(rec.mp ?? (40 + rec.level * 4)), x: ent ? round2(ent.x) : null, y: ent ? round2(ent.y) : null,
  wait: rec.wait ? rec.wait.name || rec.wait.key : '', // ждёт в другом месте (приказы «войти в здание» / «выйти»)
});
// Своему игроку — полный список спутников; всем — появление/исчезновение сущностей
function sendList(c) {
  if (!c || !c.room || c.autonomous) return;
  const st = stateOf(c.room);
  const allies=[...st.ents.values()].filter(e=>e.autonomous&&e.formerOwner===c.account.id&&e.formerCharacter===c.character.id).map(e=>({...publicComp(recOf(e.autonomous,e.id),e),distance:Math.round(dist(e,c.pos)*10)/10,near:dist(e,c.pos)<=G().compTameRange+e.radius}));
  realtime.send(c, { t: 'comp-list', list: C.list(c.character).map((r) => publicComp(r, st.ents.get(r.id))), allies, slots: C.slots(c.character), shrinker: C.hasShrinker(c.character) ? 1 : 0, mount: c.mount || null });
}
const publicEnt = (room, ent) => { const c = ownerOf(room, ent), rec = recOf(c, ent.id),m=rec?.fam&&require('../shared/family').of(c.character).members.find(m=>m.id===rec.fam); return rec ? { id: ent.id, owner: ent.owner, def: rec.def, name: rec.name, lvl: rec.level, x: round2(ent.x), y: round2(ent.y), hp: hpPct(rec), down: rec.down ? 1 : 0, outfit: require('./actor-items').look(rec.equip),family:m?{id:m.id,kind:m.kind,age:require('../shared/family').ageOf(m),gender:m.gender,adultAge:require('../shared/family').settings.familyAdultAge}:null } : null; };
const hpPct = (rec) => Math.max(0, Math.ceil((rec.hp / C.statsOf(rec).maxHp) * 100));

// ---------- Сущности в мире ----------
function freeNear(room, p) {
  for (let r = 1; r <= 3; r++) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
      if (WorldGen.isWalkable(room.map, Math.floor(x), Math.floor(y))) return { x: round2(x), y: round2(y) };
    }
  }
  return { x: p.x, y: p.y };
}
function spawnEnt(room, c, rec, at) {
  const st = stateOf(room);
  if (st.ents.has(rec.id)) return st.ents.get(rec.id);
  const def = Enemies.get(rec.def);
  if (!rec.loadoutInitialized) {
    if (!Object.keys(rec.equip || {}).length && !(rec.bag || []).length) Object.assign(rec, require('./actor-items').generate(def, rec.level));
    rec.loadoutInitialized = true; markDirty(c);
  }
  const p = at || freeNear(room, c.pos);
  const ent = { id: rec.id, owner: c.account.id, x: p.x, y: p.y, path: [], repathAt: 0, nextAttack: 0, target: null, fly: Boolean(def.fly), radius: def.radius || 0.4, breathAt: 0 };
  st.ents.set(ent.id, ent);
  const pub = publicEnt(room, ent);
  if (pub) room.broadcast({ t: 'comp-add', comp: pub });
  return ent;
}
function removeEnt(room, id) {
  const st = stateOf(room);
  const ent = st.ents.get(id);
  if (!ent) return;
  st.ents.delete(id);
  const c = ownerOf(room, ent);
  if(c?.controlledComp===id)require("./companion-control").release(c);
  if (c && c.mount === id) setMount(c, null);
  room.broadcast({ t: 'comp-remove', id });
}
const entOf = (room, id) => (room.comp ? room.comp.ents.get(id) || null : null);
function hiddenEnt(room,ent,now=Date.now()){
  if(ent.hiddenUntil>now)return true;
  const c=ownerOf(room,ent);return Boolean(c&&!ent.autonomous&&Items.setEffects(c.character).stealthTeam&&!(ent.stealthRevealedUntil>now));
}
function revealEnt(ent){ent.hiddenUntil=0;ent.stealthRevealedUntil=Date.now()+8000;}
function snapshotAllies(room){return [...(room.comp?.ents.values()||[])].filter(e=>e.autonomous).map(e=>({rec:recOf(e.autonomous,e.id),x:e.x,y:e.y,formerOwner:e.formerOwner,formerCharacter:e.formerCharacter,factions:e.autonomous.character.factions||{}}));}
function restoreAllies(room,rows){
  for(const row of Array.isArray(rows)?rows:[]){
    const rec=C.sanitize(row.rec);if(!rec||rec.hp<=0||!Number.isFinite(row.x)||!Number.isFinite(row.y)||typeof row.formerOwner!=='string')continue;
    rec.out=true;rec.order='guard';rec.stance='aggressive';rec.guard={x:row.x,y:row.y};delete rec.until;delete rec.summoned;
    const c={autonomous:true,account:{id:row.formerOwner},character:{id:row.formerCharacter,factions:row.factions||{},companions:[rec]},room,pos:{x:row.x,y:row.y},ws:{readyState:3},cb:{dead:false,dirty:false}};
    const ent=spawnEnt(room,c,rec,c.pos);ent.owner='ally:'+rec.id;ent.autonomous=c;ent.formerOwner=row.formerOwner;ent.formerCharacter=row.formerCharacter;
  }
}
// Спутники глазами ИИ врагов (враги нападают и на них); раненые лежат и не видны
function aiTargets(room) {
  if (!room.comp) return [];
  const out = [];
  for (const ent of room.comp.ents.values()) {
    const c = ownerOf(room, ent), rec = recOf(c, ent.id);
    if (!rec || ent.vehicleId || (c && c.mount === ent.id)) continue;
    out.push({ id: ent.id, x: ent.x, y: ent.y, dead: Boolean(rec.down) || hiddenEnt(room,ent), radius: ent.radius, level: rec.level, name: rec.name, companion: true });
  }
  return out;
}

// ---------- Приручение / вербовка / внушение / взлом ----------
function foodCell(ch) {
  const cells = ch.inventory.cells;
  for (let i = 0; i < cells.length; i++) { const x = cells[i], it = x && Items.get(x.id); if (it && it.effect && it.effect.food > 0) return x.id; }
  return null;
}
// Репутация поселений (шаг 15): отношение ближайшего поселения −2…+2 облегчает или затрудняет вербовку
// Фракции (шаг 16): отношение банды цели добавляет ещё −2…+2
const reputationOf = (c, e) => require('./settlements').recruitBonus(c.room, c) + (e ? require('../shared/factions').recruitBonus(c.character, e.def) : 0);

function tryTame(room, c, msg) {
  const g = G(), now = Date.now(), ch = c.character, st = stateOf(room);
  if (!g.compEnabled) return 'Спутники отключены на сервере.';
  const former=st.ents.get(String(msg.target||''));
  if(former?.autonomous&&former.formerOwner===c.account.id&&former.formerCharacter===ch.id)return ACTS.rejoin(room,c,{id:former.id});
  const e = combat().stateOf(room).enemies.get(String(msg.target || ''));
  if (!e || e.dead) return 'Цель не найдена.';
  if (dist(e, c.pos) > g.compTameRange + (e.def.radius || 0.4)) return `Подойдите ближе (не дальше ${g.compTameRange} клеток).`;
  if ((st.cd.get(c.account.id) || 0) > now) return 'Слишком часто — переведите дух.';
  const methods = C.methodsFor(e.def);
  // союзная банда (дружба и выше): любого её бойца можно уговорить, даже киборга (шаг 16)
  if (!methods.includes('persuade') && C.kindOf(e.def) && require('../shared/factions').recruitable(ch, e.def)) methods.unshift('persuade');
  const method = msg.method && methods.includes(msg.method) ? msg.method : methods[0];
  if (!method) return `«${e.def.name}» не может стать спутником.`;
  const dragon = e.def.family === 'dragon';
  const shrinker = C.hasShrinker(ch);
  if (!C.freeSlots(ch)) return `Команда заполнена (${C.slots(ch)}, максимум 11). Исключите спутника, чтобы освободить место; контейнер места не освобождает.`;
  const stat = (ch.stats && ch.stats[C.METHODS[method].stat]) || 0;
  const o = { stat, level: e.level, hpFrac: e.hp / e.maxHp, dragon };
  const cost = {};
  if (method === 'tame') {
    if (!(e.lassoBy === c.account.id && e.lassoUntil > now)) return 'Сначала свяжите цель лассо — приручить можно только связанного.';
    if (dragon) {
      if (!shrinker) return 'Дракона не приручить без контейнера-уменьшителя.';
      if (stat < g.compDragonMinTaming) return `Для дракона нужно «Приручение» не ниже ${g.compDragonMinTaming}.`;
      if (Inv.count(ch, g.compDragonItem) < 1) return `Нужен ${Items.get(g.compDragonItem) ? Items.get(g.compDragonItem).name : g.compDragonItem}.`;
      cost[g.compDragonItem] = 1;
    }
    const food = foodCell(ch);
    if (food) { cost[food] = 1; o.food = true; }
  } else if (method === 'persuade') {
    o.reputation = reputationOf(c, e);
    if (msg.pay) {
      const n = C.recruitCost(e.level);
      if (Inv.count(ch, 'gold_nugget') < n) return `Наёмник просит ${n} зол. самородков.`;
      o.paid = true; o.payN = n;
    }
  } else if (method === 'suggest') {
    if (!ch.vitals || ch.vitals.mp < g.compSuggestMpCost) return `Не хватает маны (нужно ${g.compSuggestMpCost}).`;
    ch.vitals.mp -= g.compSuggestMpCost;
    markDirty(c);
  } else if (method === 'hack') {
    if (Inv.count(ch, g.compHackItem) < 1) return `Для взлома нужна ${Items.get(g.compHackItem).name.toLowerCase()}.`;
    cost[g.compHackItem] = 1;
  }
  st.cd.set(c.account.id, now + g.compTryCooldownSec * 1000);
  const p = C.chance(method, o);
  const ok = combat().random() < p;
  let rec = null;
  inventory.mutate(c.account, ch.id, (x) => {
    for (const [id, n] of Object.entries(cost)) Inv.takeById(x, id, n);
    if (!ok) return null;
    if (o.paid) Inv.takeById(x, 'gold_nugget', o.payN);
    rec = C.makeRecord(e.def, e.level, method, newId());
    rec.equip = structuredClone(e.equip || {}); rec.bag = structuredClone(e.bag || []); rec.loadoutInitialized = true;
    rec.hp = Math.max(1, Math.round(C.statsOf(rec).maxHp * Math.max(0.3, e.hp / e.maxHp)));
    if (method === 'suggest') rec.until = now + C.suggestSec(stat) * 1000;
    if (!C.freeSlots(x)) rec.out = false; // мест нет — сразу в контейнер
    x.companions = C.list(x).concat(rec);
    return null;
  });
  const verb = C.METHODS[method].name;
  if (!ok) {
    realtime.send(c, { t: 'comp-try', ok: 0, method, chance: p, target: e.id });
    if (method === 'tame') { e.lassoUntil = 0; e.boundUntil = 0; e.stunUntil = 0; e.immobileUntil = 0; } // вырвался
    return `${verb}: не вышло (шанс ${Math.round(p * 100)}%).`;
  }
  combat().removeEnemy(room, e, false);
  require('./quests').onTame(room, c, e.def); // цели заданий «приручить» (шаг 16)
  if (rec.out) spawnEnt(room, c, rec, { x: e.x, y: e.y });
  realtime.send(c, { t: 'comp-try', ok: 1, method, chance: p, id: rec.id });
  chat.tell(c, `${verb}: «${rec.name}» теперь ваш спутник${rec.out ? '' : ' (в контейнере — нет свободного места)'}${rec.until ? ` на ${Math.round((rec.until - now) / 1000)} с` : ''}.`);
  sendList(c);
  return null;
}

// ---------- Магия (шаг 12) ----------
// Призыв заклинанием: временный спутник (занимает место в команде, рассыпается по истечении времени)
function summon(room, c, def, level, sec) {
  const ch = c.character, now = Date.now();
  const mine = C.list(ch).filter((r) => r.summoned);
  if (mine.length >= G().magicMaxSummons) { const old = mine[0]; const ent = entOf(room, old.id); if (ent) wakeUp(room, c, ent, old); else ch.companions = C.list(ch).filter((r) => r.id !== old.id); }
  if(!C.freeSlots(ch)){chat.tell(c,'Команда заполнена: для призыва освободите место (максимум 11).');return null;}
  const rec = C.makeRecord(def, level, 'suggest', newId());
  rec.loadoutInitialized = true;
  rec.summoned = true; rec.until = now + sec * 1000; rec.kind = rec.kind || 'machine';
  ch.companions = C.list(ch).concat(rec);
  markDirty(c);
  const at = freeNear(room, c.pos) || c.pos;
  spawnEnt(room, c, rec, at);
  sendList(c);
  return rec;
}
// Подчинение заклинанием: как внушение — временный спутник (нужно свободное место)
function enthrall(room, c, e, sec) {
  const ch = c.character, now = Date.now();
  if (!C.freeSlots(ch)) return `Нет свободного места для спутника (Напарники: ${C.slots(ch)}).`;
  const rec = C.makeRecord(e.def, e.level, 'suggest', newId());
  rec.equip = structuredClone(e.equip || {}); rec.bag = structuredClone(e.bag || []); rec.loadoutInitialized = true;
  rec.hp = Math.max(1, Math.round(C.statsOf(rec).maxHp * Math.max(0.3, e.hp / e.maxHp)));
  rec.until = now + sec * 1000;
  ch.companions = C.list(ch).concat(rec);
  markDirty(c);
  combat().removeEnemy(room, e, false);
  spawnEnt(room, c, rec, { x: e.x, y: e.y });
  sendList(c);
  return rec;
}

// ---------- Команды ----------
function findRec(c, id) {
  const rec = recOf(c, String(id || ''));
  if (!rec) throw new Error('Нет такого спутника.');
  return rec;
}
function targets(c, id) { return id === 'all' ? C.list(c.character).filter((r) => r.out) : [findRec(c, id)]; }
function setMount(c, id) {
  if (!id && c.mount) require('./levels').onUnmount(c); // потерял дракона в воздухе — падение (шаг 13)
  c.mount = id || null;
  const rec = id ? recOf(c, id) : null;
  realtime.send(c, { t: 'comp-mount', id: c.mount, speed: rec ? G().compMountSpeed : 1, fly: rec && Enemies.get(rec.def).fly ? 1 : 0 });
  if (c.room) c.room.broadcast({ t: 'comp-rider', id: c.account.id, comp: c.mount });
}
// Множитель скорости героя (верхом на драконе) и полёт
const speedFactor = (c) => (c.mount ? G().compMountSpeed : 1);
function flying(c) {
  if (!c || !c.mount) return false;
  const rec = recOf(c, c.mount);
  return Boolean(rec && Enemies.get(rec.def).fly);
}

// ---------- Приказы «ко мне», «войти в здание», «выйти» (shared/companions.js ORDERS) ----------
// Спутник, оставленный в другом месте, ждёт там (rec.wait: { key — 'ground' или ключ уровня, x, y, name }); его сущности нет,
// пока хозяин не придёт туда же (onJoin — снова в команде) или не прикажет «ко мне».
const roomKey = (room) => (room.key || (room.level ? room.level.key : 'ground'));
const rootMap = (room) => require('./worlds').getMap(room.world);
const groundMap = (room) => require('../shared/regions').map(rootMap(room),room.region?.key||room.level?.regionKey||'ground');
function unboardEnt(room, ent) {
  const v = ent && ent.vehicleId && require('./vehicles').stateFor(room.world).list.get(ent.vehicleId);
  if (v) require('./vehicles').unboardCompanions(room, v, [ent.id]);
  if (ent) ent.vehicleId = null;
}
function rejoin(room, c, rec, at) {
  delete rec.wait; rec.order = 'follow'; rec.guard = null;
  const ent = entOf(room, rec.id) || spawnEnt(room, c, rec, at);
  ent.entering = null; ent.exiting = null; ent.boardingVehicle = null; ent.target = null;
  return ent;
}
function orderCome(room, c, recs) {
  let n = 0;
  for (const rec of recs) {
    if (!rec.out || rec.down) continue;
    const here = entOf(room, rec.id);
    if (here && here.vehicleId) unboardEnt(room, here);
    const far = !here || dist(here, c.pos) > G().compLeash;
    const ent = rejoin(room, c, rec);
    if (far) { const p = freeNear(room, c.pos); ent.x = p.x; ent.y = p.y; ent.path = []; } // из другого места — сразу рядом
    ent.coming = true; n++;
  }
  markDirty(c); sendList(c);
  return n ? null : 'Некого звать: нет призванных спутников.';
}
// Точка у входа на поверхности для уровня key (дверь дома, люк бункера…)
function outsideOf(room, key) {
  const R=require('../shared/regions'),region=R.parse(key)?.key||'ground',map=R.map(rootMap(room),region),lv=key==='ground'?null:Levels.level(rootMap(room),key);
  const e = lv && Levels.entranceById(map, lv.entrance);
  const p = e ? { x: e.x + 0.5, y: e.y + 0.5 } : { x: map.spawn.x + 0.5, y: map.spawn.y + 0.5 };
  return { key: region, x: p.x, y: p.y, name: e && e.house ? `у входа: ${e.house.name.toLowerCase()}` : 'на улице у входа' };
}
function orderExit(room, c, recs) {
  let veh = 0, out = 0, walk = 0;
  for (const rec of recs) {
    if (!rec.out || rec.down) continue;
    const ent = entOf(room, rec.id);
    if (ent && ent.vehicleId) { unboardEnt(room, ent); rec.order = 'follow'; veh++; continue; }
    if (rec.wait && rec.wait.key !== 'ground' && (!rec.wait.key.startsWith('region_')||rec.wait.key.includes('!'))) { // ждёт в здании, хозяин в другом месте — выходит к входу
      const o = outsideOf(room, rec.wait.key);
      if (roomKey(room) === o.key) rejoin(room, c, rec, { x: o.x, y: o.y });
      else { rec.wait = o; rec.order = 'guard'; rec.guard = { x: o.x, y: o.y }; }
      out++; continue;
    }
    if (ent && room.level) { // вместе с хозяином внутри — идёт к выходу и выходит на улицу
      const ex = Levels.nearbyPortal(groundMap(room), room.level, ent.x, ent.y, 999);
      const door = room.level.exits.find((e) => e.kind === 'door') || ex;
      ent.exiting = { x: (door ? door.x : ent.x) + 0.5, y: (door ? door.y : ent.y) + 0.5, until: Date.now() + 15000 };
      rec.order = 'exit'; walk++;
    }
  }
  markDirty(c); sendList(c);
  if (!veh && !out && !walk) return room.level ? 'Спутники не могут выйти.' : 'Спутники и так снаружи: никто не сидит в машине и не ждёт в здании.';
  return null;
}
function orderEnter(room, c, recs, m) {
  if (room.level) { // хозяин внутри: ждущие снаружи заходят к нему
    let n = 0;
    for (const rec of recs) if (rec.out && !rec.down && rec.wait && rec.wait.key !== roomKey(room)) { const ent = rejoin(room, c, rec); const p = freeNear(room, c.pos); ent.x = p.x; ent.y = p.y; n++; }
    markDirty(c); sendList(c);
    return n ? null : 'Спутники уже здесь, внутри.';
  }
  const map = groundMap(room);
  const R = 10, list = Houses.near(map, c.pos.x, c.pos.y, R).filter((h) => !m.house || h.id === m.house);
  const h = list.sort((a, b) => dist(a.door, c.pos) - dist(b.door, c.pos))[0];
  if (!h || dist(h.door, c.pos) > R) return `Рядом нет дома: подойдите ближе к двери (до ${R} клеток).`;
  let n = 0;
  for (const rec of recs) {
    if (!rec.out || rec.down) continue;
    const ent = entOf(room, rec.id);
    if (!ent) continue;
    if (ent.vehicleId) unboardEnt(room, ent);
    ent.entering = { id: h.id, x: h.door.x + 0.5, y: h.door.y + 0.5, until: Date.now() + 20000 };
    ent.target = null; rec.order = 'enter'; n++;
  }
  markDirty(c); sendList(c);
  return n ? null : 'Нет призванных спутников рядом.';
}
// Шаг сущности с приказом войти/выйти: идёт к двери, затем исчезает внутри (снаружи) и ждёт там
function stepDoorway(room, c, ent, rec, speed, dt, now) {
  const goal = ent.entering || ent.exiting;
  if (!goal) return false;
  if (dist(ent, goal) > 1.3 && now < goal.until) { if (!moveTowards(room, ent, goal.x, goal.y, dt, speed, now) && now > goal.until - 12000) goal.until = now; return true; }
  let wait;
  if (ent.entering) {
    const h = Houses.byId(groundMap(room), ent.entering.id), lv = h && Levels.level(groundMap(room), Houses.keyOf(h, 0));
    if (!lv) { ent.entering = null; rec.order = 'follow'; return false; }
    wait = { key: require('../shared/regions').qualify(room.region?.key||'ground',lv.key), x: lv.spawn.x + 0.5, y: lv.spawn.y + 0.5, name: lv.name };
  } else wait = outsideOf(room, roomKey(room));
  rec.wait = wait; rec.order = 'guard'; rec.guard = { x: wait.x, y: wait.y };
  ent.entering = null; ent.exiting = null;
  chat.tell(c, `${rec.name}: ждёт — ${wait.name}. Позовите «Ко мне» (${C.ORDER_KEYS.come}) или придите туда.`);
  removeEnt(room, ent.id);
  markDirty(c); sendList(c);
  return true;
}

const ACTS = {
  control(room,c,m){require('./companion-control').select(c,m.id);return null;},
  summon(room, c, m) {
    const rec = findRec(c, m.id);
    if (rec.out) return 'Спутник уже рядом.';
    if (!C.hasShrinker(c.character)) return 'Нужен контейнер-уменьшитель.';
    if (C.outCount(c.character)>=C.slots(c.character)) return `Все места заняты (Напарники: ${C.slots(c.character)}).`;
    if (rec.down) return 'Спутник ранен.';
    rec.out = true; markDirty(c);
    spawnEnt(room, c, rec);
    return null;
  },
  store(room, c, m) {
    const rec = findRec(c, m.id);
    if (rec.fam) return 'Член семьи не прячется в контейнер — отправьте его домой в панели семьи (F3).';
    if (!C.hasShrinker(c.character)) return 'Без контейнера-уменьшителя спутника некуда спрятать — он идёт пешком.';
    if (!rec.out) return null;
    if (rec.down) return 'Раненого сначала нужно спасти.';
    rec.out = false; markDirty(c);
    removeEnt(room, rec.id);
    return null;
  },
  order(room, c, m) {
    if (!C.ORDERS[m.order]) return 'Неизвестный приказ.';
    if (m.order === 'board') return require('./vehicles').boardCompanions(room, c, targets(c, m.id));
    if (m.order === 'come') return orderCome(room, c, targets(c, m.id));
    if (m.order === 'enter') return orderEnter(room, c, targets(c, m.id), m);
    if (m.order === 'exit') return orderExit(room, c, targets(c, m.id));
    for (const rec of targets(c, m.id)) {
      rec.order = m.order;
      const ent = entOf(room, rec.id);
      if (m.order === 'guard') rec.guard = { x: round2(Number.isFinite(m.x) ? m.x : ent ? ent.x : c.pos.x), y: round2(Number.isFinite(m.y) ? m.y : ent ? ent.y : c.pos.y) };
      if (m.order === 'attack') { rec.attack = String(m.target || ''); if (ent) ent.target = rec.attack || null; }
      else if (ent) ent.target = null;
    }
    markDirty(c);
    return null;
  },
  stance(room, c, m) {
    if (!C.STANCES[m.stance]) return 'Неизвестная стойка.';
    for (const rec of targets(c, m.id)) { rec.stance = m.stance; const ent = entOf(room, rec.id); if (ent && m.stance === 'passive') ent.target = null; }
    markDirty(c);
    return null;
  },
  repair(room,c,m) {
    const rec=findRec(c,m.id),ent=entOf(room,rec.id);
    if(rec.kind!=='machine')return 'Ремонт доступен роботам.';
    if(ent&&dist(ent,c.pos)>3)return 'Подойдите к роботу.';
    if(rec.hp>=C.statsOf(rec).maxHp&&!rec.down)return 'Робот уже исправен.';
    inventory.mutate(c.account,c.character.id,ch=>{
      if(Inv.count(ch,'scrap_metal')<2||Inv.count(ch,'electronics')<1)return 'Для ремонта нужны 2 металлолома и 1 электроника.';
      Inv.takeById(ch,'scrap_metal',2);Inv.takeById(ch,'electronics',1);
      const r=C.list(ch).find(x=>x.id===rec.id);r.hp=C.statsOf(r).maxHp;r.down=0;return null;
    });markDirty(c);sendList(c);return null;
  },
  revive(room, c, m) {
    const rec = findRec(c, m.id), ent = entOf(room, rec.id);
    if (!rec.down || !ent) return 'Спутник не ранен.';
    if (dist(ent, c.pos) > G().compReviveRange + 0.5) return `Подойдите к спутнику (не дальше ${G().compReviveRange} клеток).`;
    rec.down = 0; rec.hp = Math.max(1, Math.round(C.statsOf(rec).maxHp * G().compReviveHp)); markDirty(c);
    chat.tell(c, `«${rec.name}» снова на ногах.`);
    return null;
  },
  feed(room, c, m) {
    const rec = findRec(c, m.id);
    if (!C.eats(rec)) return 'Кормить можно зверей и драконов.';
    const id = m.item && Items.get(m.item) && Items.get(m.item).effect && Items.get(m.item).effect.food ? m.item : foodCell(c.character);
    if (!id || Inv.count(c.character, id) < 1) return 'Нет еды в сумке.';
    inventory.mutate(c.account, c.character.id, (x) => {
      Inv.takeById(x, id, 1);
      const r = C.list(x).find((y) => y.id === rec.id);
      const it = Items.get(id);
      r.food = Math.min(100, (r.food || 0) + it.effect.food * 1.5);
      r.hp = Math.min(C.statsOf(r).maxHp, r.hp + (it.effect.hp || 10));
      return null;
    });
    return null;
  },
  equip(room, c, m) {
    const rec = findRec(c, m.id);
    const i = Number(m.cell);
    const x = c.character.inventory.cells[i], it = x && Items.get(x.id);
    if (!it) return 'Выберите предмет в сумке.';
    if (it.fixed || it.id === 'caps') return 'Этот предмет нельзя передать спутнику.';
    const slot = C.canEquip(rec) ? it.category === 'weapon' && !it.placeable ? 'weapon' : Items.slotsFor(it).find(s => !['underwear', 'mainHand', 'offHand'].includes(s)) : null;
    inventory.mutate(c.account, c.character.id, (ch) => {
      const cell = ch.inventory.cells[i];
      if (!cell || cell.uid !== x.uid || m.uid && cell.uid !== m.uid) return 'Предмет уже не в сумке.';
      const r = C.list(ch).find((y) => y.id === rec.id);
      if (!slot && (r.bag || []).length >= 64) return 'Сумка спутника заполнена (64 вещи).';
      const old = r.equip && r.equip[slot];
      const count = slot ? 1 : Number(m.count ?? 1);
      if (!Number.isSafeInteger(count) || count < 1 || count > cell.n) return 'Неверное количество вещей для передачи.';
      const one = { ...cell, uid: cell.n > count ? Inv.makeItem(cell.id).uid : cell.uid, n: count };
      if (cell.n > count) cell.n -= count; else ch.inventory.cells[i] = null;
      if (slot) r.equip = { ...(r.equip || {}), [slot]: one };
      else (r.bag || (r.bag = [])).push(one);
      if (old) { const err = Inv.add(ch, old.id, old.n || 1, old.dur, old); if (err) return err; }
      return null;
    });
    const ent = entOf(room, rec.id); if (ent) room.broadcast({ t: 'comp-outfit', id: rec.id, outfit: require('./actor-items').look(findRec(c, rec.id).equip) });
    return null;
  },
  unequip(room, c, m) {
    const rec = findRec(c, m.id);
    const slot = String(m.slot || '');
    if (!rec.equip || !rec.equip[slot]) return 'Нечего снимать.';
    inventory.mutate(c.account, c.character.id, (ch) => {
      const r = C.list(ch).find((y) => y.id === rec.id);
      const it = r.equip[slot];
      const err = Inv.add(ch, it.id, it.n || 1, it.dur, it);
      if (err) return err;
      delete r.equip[slot];
      return null;
    });
    const ent = entOf(room, rec.id); if (ent) room.broadcast({ t: 'comp-outfit', id: rec.id, outfit: require('./actor-items').look(findRec(c, rec.id).equip) });
    return null;
  },
  take(room, c, m) {
    const rec = findRec(c, m.id);
    inventory.mutate(c.account, c.character.id, ch => {
      const r = C.list(ch).find(x => x.id === rec.id), index = (r.bag || []).findIndex(x => x.uid === m.uid);
      if (index < 0) return 'Вещь уже отсутствует у спутника.';
      const item = r.bag[index], error = Inv.add(ch, item.id, item.n, item.dur, item);
      if (error) return error;
      r.bag.splice(index, 1); return null;
    });
    return null;
  },
  release(room, c, m) {
    const rec = findRec(c, m.id);
    if (rec.fam) return require('./family').sendHome(c, rec.fam); // член семьи (шаг 17) — домой, а не «на волю»
    if(!m.migrate&&(rec.down||rec.hp<=0))return 'Сначала спасите раненого спутника.';
    if(c.mount===rec.id){const error=ACTS.dismount(room,c);if(error)return error;}
    if(c.controlledComp===rec.id)require('./companion-control').release(c);
    const ent=entOf(room,rec.id)||spawnEnt(room,c,rec);
    if(ent.vehicleId)return 'Сначала высадите спутника из транспорта.';
    const detached=structuredClone(rec);detached.out=true;detached.order='guard';detached.stance='aggressive';detached.guard={x:ent.x,y:ent.y};delete detached.until;delete detached.summoned;delete detached.fam;
    ent.formerOwner=c.account.id;ent.formerCharacter=c.character.id;ent.owner='ally:'+ent.id;
    ent.autonomous={autonomous:true,account:{id:c.account.id},character:{...c.character,companions:[detached]},room,pos:{...detached.guard},ws:{readyState:3},cb:{dead:false,dirty:false}};
    ent.path=[];ent.target=null;ent.boardingVehicle=null;
    c.character.companions = C.list(c.character).filter((r) => r.id !== rec.id);
    room.broadcast({t:'comp-add',comp:publicEnt(room,ent)});
    markDirty(c);
    if(detached.hp<=0)lose(room,ent.autonomous,ent,detached);
    chat.tell(c, `«${rec.name}» исключён из команды, но остаётся союзником. Подойдите, чтобы принять его обратно.`);
    return null;
  },
  rejoin(room,c,m){
    const ent=entOf(room,String(m.id||''));
    if(!ent?.autonomous||ent.formerOwner!==c.account.id||ent.formerCharacter!==c.character.id)return 'Это не ваш бывший спутник.';
    const rec=recOf(ent.autonomous,ent.id);
    if(!rec||rec.hp<=0||rec.down)return 'Спутник погиб или недоступен.';
    if(dist(ent,c.pos)>G().compTameRange+ent.radius)return 'Подойдите ближе к союзнику.';
    if(!C.freeSlots(c.character))return 'Команда заполнена. Исключите спутника, чтобы освободить место (максимум 11).';
    rec.order='follow';delete rec.guard;c.character.companions=C.list(c.character).concat(rec);
    ent.owner=c.account.id;delete ent.autonomous;delete ent.formerOwner;delete ent.formerCharacter;ent.path=[];ent.target=null;
    markDirty(c);room.broadcast({t:'comp-add',comp:publicEnt(room,ent)});chat.tell(c,`«${rec.name}» снова в команде.`);return null;
  },
  mount(room, c, m) {
    if (c.mount) return ACTS.dismount(room, c, m);
    if (c.veh) return 'Сначала выйдите из машины (Y).';
    const rec = m.id ? findRec(c, m.id) : C.list(c.character).find((r) => r.out && !r.down && C.canMount(r));
    if (!rec || !C.canMount(rec)) return 'Верхом можно ездить на лошадях и драконах.';
    const ent = entOf(room, rec.id);
    if (!rec.out || !ent || rec.down) return 'Ездовое существо должно быть призвано и здорово.';
    if (dist(ent, c.pos) > G().compMountRange + ent.radius) return `Подойдите к ездовому спутнику (не дальше ${G().compMountRange} клеток).`;
    setMount(c, rec.id);
    ent.x = c.pos.x; ent.y = c.pos.y; ent.path = []; ent.target = null;
    return null;
  },
  dismount(room, c) {
    if (!c.mount) return null;
    const air = require('./levels').dismountError(c); // в воздухе (шаг 13): нельзя или падение
    if (air) return air;
    if (!WorldGen.isWalkable(room.map, Math.floor(c.pos.x), Math.floor(c.pos.y))) return 'Здесь не приземлиться — летите к суше.';
    const ent = entOf(room, c.mount);
    setMount(c, null);
    if (ent) { const p = freeNear(room, c.pos); ent.x = p.x; ent.y = p.y; }
    return null;
  },
  breath(room, c, m) {
    const g = G(), now = Date.now();
    if (!c.mount) return 'Дыхание — только верхом на драконе.';
    const rec = recOf(c, c.mount), ent = entOf(room, c.mount);
    if (!rec || !ent || rec.kind !== 'dragon') return 'Дыхание доступно только дракону.';
    if (ent.breathAt > now) return 'Дракон переводит дух.';
    ent.breathAt = now + g.compBreathCooldownSec * 1000;
    const a = Math.atan2((Number(m.y) || c.pos.y) - c.pos.y, (Number(m.x) || c.pos.x) - c.pos.x);
    const s = C.statsOf(rec), type = s.attack.type, half = ((g.compBreathAngle / 2) * Math.PI) / 180;
    const owner={kind:'c',id:ent.id,ent,c},direction={x:Math.cos(a),y:Math.sin(a)};
    const targets=combat().hostiles(room,owner).filter(e=>Math.hypot(e.x-c.pos.x,e.y-c.pos.y)<=g.compBreathRange+(e.r||0));
    const hits=targets.filter(e=>Math.abs(Math.atan2(Math.sin(Math.atan2(e.y-c.pos.y,e.x-c.pos.x)-a),Math.cos(Math.atan2(e.y-c.pos.y,e.x-c.pos.x)-a)))<=half).length;
    const stealthCrit=hiddenEnt(room,ent);revealEnt(ent);require('./magic').onAttack(c);
    combat().coneStrike(room,owner,c.pos,direction,{stealthCrit,kind:'cone',damage:s.damage.map(n=>n*g.compBreathFactor),damageType:type,flags:s.attack.flags||[],fx:s.attack.fx||'fireStream',range:g.compBreathRange,freezeSec:s.attack.freezeSec||0,rootSec:s.attack.rootSec||0},g.compBreathAngle);
    realtime.send(c, { t: 'comp-breath', hits, ready: ent.breathAt });
    return null;
  },
  depot(room, c, m) { return openDepot(room, c, Number(m.id)); },
};

// ---------- Урон, опыт, ранение ----------
function hitByEnemy(room, ent, e, amount, type) {
  const c = ownerOf(room, ent), rec = recOf(c, ent.id);
  if (!rec || rec.down || rec.god) return 0; // rec.god — бессмертие (чит-панель)
  if(require('./family').childProtected(room,c,ent,rec))return 0;
  const s = C.statsOf(rec), def = Enemies.get(rec.def);
  let dmg = amount > 0 ? Combat.mitigate(amount, type, s.defense + (ent.defBuff && ent.defBuff.until > Date.now() ? ent.defBuff.amount : 0), def.resist, []) : 0;
  if (ent.shield && ent.shield.until > Date.now()) { const absorbed = Math.min(dmg, ent.shield.amount); ent.shield.amount -= absorbed; dmg -= absorbed; if (!ent.shield.amount) ent.shield = null; }
  rec.hp -= dmg;
  ent.lastHitAt = Date.now();
  if (!ent.target && rec.stance !== 'passive') ent.target = e.id; // отвечает обидчику
  markDirty(c);
  combat().fx(room, { k: 'hit', t: 'c', id: ent.id, n: dmg, d: type });
  if (rec.hp <= 0) knockDown(room, c, ent, rec);
  return dmg;
}
function hitByVehicle(room, ent, amount, type = 'physical') {
  if (!ent || ent.vehicleId) return 0;
  const c = ownerOf(room, ent), rec = recOf(c, ent.id);
  if (!rec || rec.down || rec.god || require('./family').childProtected(room, c, ent, rec)) return 0;
  const stats = C.statsOf(rec), def = Enemies.get(rec.def);
  const dmg = amount > 0 ? Combat.mitigate(amount, type, stats.defense + (ent.defBuff && ent.defBuff.until > Date.now() ? ent.defBuff.amount : 0), def.resist, []) : 0;
  rec.hp -= dmg; ent.lastHitAt = Date.now(); markDirty(c);
  combat().fx(room, { k: 'hit', t: 'c', id: ent.id, n: dmg, d: type });
  if (rec.hp <= 0) knockDown(room, c, ent, rec);
  return dmg;
}
function knockDown(room, c, ent, rec) {
  if(require('./family').childProtected(room,c,ent,rec)){rec.hp=Math.max(1,rec.hp);rec.down=0;return;}
  if(ent.autonomous){lose(room,c,ent,rec);return;}
  const g = G();
  rec.hp = 0; rec.down = Date.now() + g.compReviveSec * 1000;
  ent.target = null; ent.path = [];
  if (c.mount === ent.id) setMount(c, null);
  chat.tell(c, `«${rec.name}» тяжело ранен! Подойдите и спасите его за ${g.compReviveSec} с (панель спутников).`);
  sendList(c);
}
function lose(room, c, ent, rec) {
  const g = G();
  const lostChild=require('./family').childDeath(c,rec);
  if (rec.fam&&!lostChild) { require('./family').sendHome(c, rec.fam, 'ранен и вернулся домой'); return; }
  if (lostChild || ent.autonomous || g.compPermadeath) {
    combat().dropLoot(room, { x: ent.x, y: ent.y, level: rec.level, def: Enemies.get(rec.def) });
    require('./corpses').add(room, { kind: 'creature', def: rec.def, x: ent.x, y: ent.y, outfit: require('./actor-items').look(rec.equip), items: require('./actor-items').belongings(rec).map(x => ({ ...x })) });
    removeEnt(room, rec.id);
    c.character.companions = C.list(c.character).filter((r) => r.id !== rec.id);
    chat.tell(c, `«${rec.name}» погиб.`);
  } else {
    rec.down = 0; rec.hp = 1;
    if (C.hasShrinker(c.character)) { rec.out = false; removeEnt(room, rec.id); chat.tell(c, `«${rec.name}» спасся в контейнер.`); }
    else chat.tell(c, `«${rec.name}» еле жив, но встал.`);
  }
  markDirty(c);
  sendList(c);
}
// Внушение закончилось: существо снова враг
function wakeUp(room, c, ent, rec) {
  const def = Enemies.get(rec.def);
  removeEnt(room, rec.id);
  c.character.companions = C.list(c.character).filter((r) => r.id !== rec.id);
  markDirty(c);
  if (rec.summoned) { // призванное заклинанием существо просто рассыпается
    combat().fx(room, { k: 'boom', x: round2(ent.x), y: round2(ent.y), r: 1, f: 'stone' });
    chat.tell(c, `Чары выдохлись: «${rec.name}» рассыпается.`);
    sendList(c);
    return;
  }
  const e = combat().spawnEnemy(room, def, rec.level, ent.x, ent.y, null, { target: c.account.id });
  e.equip = structuredClone(rec.equip || {}); e.bag = structuredClone(rec.bag || []);
  room.broadcast({ t: 'enemy-add', enemy: combat().publicEnemy(e) });
  e.hp = Math.max(1, Math.min(e.maxHp, Math.round(e.maxHp * hpPct(rec) / 100)));
  chat.tell(c, `Внушение спало: «${rec.name}» снова враг!`);
  sendList(c);
}
// Герой получил опыт — призванные спутники получают долю
function onOwnerXp(room, c, amount) {
  if (!amount || !c.character) return;
  let up = false;
  for (const rec of C.list(c.character)) {
    if (!rec.out || rec.down) continue;
    if (C.addXp(rec, amount * G().compXpShare)) { up = true; rec.hp = C.statsOf(rec).maxHp; chat.tell(c, `«${rec.name}» достиг уровня ${rec.level}.`); }
  }
  if (up) sendList(c);
}

// ---------- ИИ спутников ----------
function moveTowards(room, ent, tx, ty, dt, speed, now) {
  if (ent.immobileUntil > now || ent.stunUntil > now) { ent.path = []; return; }
  const g = G();
  room.grid = room.grid || M.gridFromWorld(room.map);
  const previousRadius=room.map.actorRadius;room.map.actorRadius=ent.radius||M.settings.actorRadius;
  room.map.flyer = ent.fly;
  room.map.swimmer = !ent.fly; // спутники плавают, как герой: могут доплыть до лодки или подлодки на воде
  try {
    if (!ent.path.length || now >= ent.repathAt) {
      ent.path = M.findPath(room.grid, Math.floor(ent.x), Math.floor(ent.y), Math.floor(tx), Math.floor(ty), g.aiPathMaxNodes) || [];
      if (ent.path.length && ent.path[0][0] === Math.floor(ent.x) && ent.path[0][1] === Math.floor(ent.y)) ent.path.shift();
      ent.repathAt = now + 500;
    }
    if (!ent.path.length) return;
    const r = M.followPath(room.map, ent, ent.path, dt, speed / M.settings.heroSpeed);
    ent.x = r.pos.x; ent.y = r.pos.y; ent.path = r.path;
  } finally { room.map.flyer=false;room.map.swimmer=false;room.map.actorRadius=previousRadius; }
}
function pickTarget(room, c, ent, rec) {
  const g = G();
  const enemies = combat().stateOf(room).enemies;
  if (rec.order === 'attack' && rec.attack) {
    const e = enemies.get(rec.attack);
    if (e && !e.dead) return e;
    rec.attack = ''; rec.order = 'follow';
  }
  if (ent.target) {
    const e = enemies.get(ent.target);
    if (e && require('./enemy-behaviour').hostile(e)) return e;
    ent.target = null;
  }
  if (rec.stance === 'passive') return null;
  const anchor = rec.order === 'guard' && rec.guard ? rec.guard : c.pos;
  const r = rec.order === 'guard' ? g.compGuardRadius : g.compAggroRadius;
  let best = null, bd = Infinity;
  for (const e of enemies.values()) {
    if (!require('./enemy-behaviour').hostile(e) || e.boundUntil > Date.now()) continue;
    // одиночки (драконы) не трогают первыми — и спутники их не задирают, если враг не напал
    if (Enemies.behaviourOf(e.def).passive && !e.target) continue;
    if (!e.target && require('./factions').peacefulTo(c, e)) continue; // дружественная хозяину банда (шаг 16)
    const d = dist(e, anchor);
    if (d <= r && d < bd) { best = e; bd = d; }
  }
  if (best) ent.target = best.id;
  return best;
}
function stepEnt(room,ent,dt,now) {
  const before={x:ent.x,y:ent.y},c=ownerOf(room,ent),rec=recOf(c,ent.id);
  const result=stepEntInner(room,ent,dt,now);
  const def=Enemies.get(rec?.def);
  if(stateOf(room).ents.has(ent.id)&&rec&&c&&def&&!def.fly&&!ent.vehicleId&&c.mount!==ent.id&&!rec.down){
    if(ent.stunUntil>now||ent.immobileUntil>now)ent.surfaceVelocity={vx:0,vy:0};
    else{const to=require('../shared/movement').surfaceMove(room.map,before,ent,ent.surfaceVelocity||(ent.surfaceVelocity={}),dt,require('./magic-fields').slippery(room,before));ent.x=to.x;ent.y=to.y;}
  }
  return result;
}
function stepEntInner(room, ent, dt, now) {
  const g = G();
  const c = ownerOf(room, ent), rec = recOf(c, ent.id);
  if (!c || !rec || !rec.out) { removeEnt(room, ent.id); return; }
  if (rec.until && now >= rec.until) { wakeUp(room, c, ent, rec); return; }
  let s = C.statsOf(rec);
  const weapon = rec.equip && rec.equip.weapon, item = weapon && Items.get(weapon.id);
  const profile = item && weapon.dur !== 0 ? Combat.profile(item) : null;
  const ammo = profile && profile.ammo;
  const roundAvailable = !ammo || (rec.ammoOpen && rec.ammoOpen[ammo] || 0) > 0 || (rec.bag || []).some(x => x.id === ammo && x.n > 0);
  if (!roundAvailable) {
    s = C.statsOf({ ...rec, equip: { ...rec.equip, weapon: null } });
    s.attack = { kind: 'melee', type: 'physical', speed: 1.2, fx: 'smash' }; s.range = 1.2;
    s.damage = [Math.max(2, rec.level / 3), Math.max(4, rec.level / 2)];
  }
  if (ent.speedBuff && ent.speedBuff.until > now) s.speed *= ent.speedBuff.k;
  if (C.eats(rec)) rec.food = Math.max(0, (rec.food == null ? 100 : rec.food) - (g.compFoodPerMin * dt) / 60);
  if (rec.down) { if (now >= rec.down) lose(room, c, ent, rec); return; }
  const hungry = C.eats(rec) && rec.food < g.compHungryAt;
  if(!hungry&&now-(ent.lastHitAt||0)>5000&&rec.hp<s.maxHp){rec.hp=require('../shared/recovery').heal(rec.hp,s.maxHp,g.compRegenPerSec,dt);markDirty(c);}
  if (ent.vehicleId) {
    const v = require('./vehicles').stateFor(room.world).list.get(ent.vehicleId);
    if (v && v.room === (room.key || (room.level ? room.level.key : 'ground')) && v.companions.includes(ent.id)) {
      ent.x = v.x; ent.y = v.y; ent.path = []; ent.target = null; return;
    }
    ent.vehicleId = null;
  }
  if (ent.boardingVehicle) {
    const v = require('./vehicles').stateFor(room.world).list.get(ent.boardingVehicle);
    if (!v || v.room !== (room.key || (room.level ? room.level.key : 'ground'))) { ent.boardingVehicle = null; rec.order = 'follow'; markDirty(c); }
    else if (dist(ent, v) > 1.4) { moveTowards(room, ent, v.x, v.y, dt, s.speed, now); return; }
    else { require('./vehicles').boardEnt(room, ent, c, v); return; }
  }
  if (c.mount === ent.id) { ent.x = c.pos.x; ent.y = c.pos.y; return; }
  if(c.controlledComp===ent.id){ent.target=null;return;}
  if (stepDoorway(room, c, ent, rec, s.speed, dt, now)) return; // приказ «войти в здание» / «выйти»
  if (ent.coming) { if (dist(ent, c.pos) > 1.6) { ent.target = null; moveTowards(room, ent, c.pos.x, c.pos.y, dt, s.speed * 1.2, now); return; } ent.coming = false; }
  const dOwner = dist(ent, c.pos);
  if (dOwner > g.compLeash * 2 && rec.order !== 'guard') { const p = freeNear(room, c.pos); ent.x = p.x; ent.y = p.y; ent.path = []; ent.target = null; return; }
  const e = pickTarget(room, c, ent, rec);
  if (require('./companion-magic').step(room, c, ent, rec, e, dt, now)) { ent.path = []; return; }
  if (ent.stunUntil > now) { ent.path = []; return; }
  // Лечение доступно и при малом здоровье, затем спутник отступает.
  if (rec.hp / s.maxHp <= g.compFleeAt) { ent.target = null; if (dOwner > 1.2) moveTowards(room, ent, c.pos.x, c.pos.y, dt, s.speed * 1.1, now); return; }
  if (e && dist(e, c.pos) > g.compLeash && rec.order !== 'attack') ent.target = null;
  if (e && ent.target) {
    const reach = s.range + (e.def.radius || 0.4) + ent.radius * 0.5;
    if (dist(ent, e) > reach) { moveTowards(room, ent, e.x, e.y, dt, s.speed, now); return; }
    ent.path = [];
    if (now >= ent.nextAttack) {
      ent.nextAttack = now + 1000 / Math.max(0.2, s.attack.speed || 1);
      if (ammo && roundAvailable) {
        rec.ammoOpen = rec.ammoOpen || {};
        if (!(rec.ammoOpen[ammo] > 0)) {
          const index = (rec.bag || []).findIndex(x => x.id === ammo && x.n > 0);
          if (index < 0) return;
          rec.ammoOpen[ammo] = Inv.perItem(ammo);
          if (--rec.bag[index].n <= 0) rec.bag.splice(index, 1);
        }
        rec.ammoOpen[ammo]--;
      }
      const amount = (s.damage[0] + (s.damage[1] - s.damage[0]) * combat().random()) * (hungry ? 0.7 : 1);
      const angle = Math.atan2(e.y - ent.y, e.x - ent.x), owner = { kind: 'c', id: ent.id, ent, c };
      const attack = { ...(profile && roundAvailable ? profile : { kind: s.attack.kind, flags: s.attack.flags||[], proj: s.attack.proj || 20, fx: s.attack.fx || 'claw' }), damage: [amount, amount], range: s.range, damageType: s.attack.type,freezeSec:s.attack.freezeSec||0,rootSec:s.attack.rootSec||0,stealthCrit:hiddenEnt(room,ent) };revealEnt(ent);
      if(attack.kind==='cone')combat().coneStrike(room,owner,ent,{x:Math.cos(angle),y:Math.sin(angle)},attack,50);
      else if (['ranged', 'thrown'].includes(attack.kind)) combat().shoot(room, owner, ent, { x: Math.cos(angle), y: Math.sin(angle) }, attack);
      else { combat().fx(room, { k: 'swing', o: 'c', id: ent.id, x: round2(ent.x), y: round2(ent.y), a: round2(angle), r: Math.min(s.range, 2), f: attack.fx }); combat().applyHit(room, owner, { kind: 'e', ref: e, x: e.x, y: e.y, r: e.def.radius }, attack); }
      if (c.cb) c.cb.dirty = true;
      if (weapon && weapon.dur > 0 && combat().random() < g.durabilityLossChance) weapon.dur--;
    }
    return;
  }
  const anchor = rec.order === 'guard' && rec.guard ? rec.guard : c.pos;
  const want = rec.order === 'guard' ? 0.8 : g.compFollowDist;
  if (dist(ent, anchor) > want) moveTowards(room, ent, anchor.x, anchor.y, dt, s.speed * (dist(ent, anchor) > want * 3 ? 1.3 : 1), now);
  else ent.path = [];
}

// ---------- Военные склады ----------
const depotArea = (id) => 'depot:' + id;
// Охрана склада появляется, когда герой впервые подходит ближе depotWakeRadius (один раз за жизнь комнаты;
// охрана сохраняется вместе с врагами мира — area 'depot:<id>')
function initDepots(room, force = false) {
  const st = stateOf(room);
  const g = G(), cs = combat().stateOf(room);
  st.depotsDone = st.depotsDone || new Set();
  for (const d of room.map.depots || []) {
    if (st.depotsDone.has(d.id)) continue;
    if (!force && ![...room.players.values()].some((c) => Math.hypot(c.pos.x - d.x, c.pos.y - d.y) <= g.depotWakeRadius)) continue;
    st.depotsDone.add(d.id);
    const alive = [...cs.enemies.values()].filter((e) => e.area === depotArea(d.id)).length;
    for (let i = alive; i < g.depotGuards; i++) {
      const def = i === 0 || combat().random() < 0.6 ? Enemies.get('walker_patrol') : Enemies.get('droid_repair');
      const a = (i / Math.max(1, g.depotGuards)) * Math.PI * 2;
      const x = d.x + 0.5 + Math.cos(a) * 2, y = d.y + 0.5 + Math.sin(a) * 2;
      const ok = WorldGen.isWalkable(room.map, Math.floor(x), Math.floor(y));
      const guardLevel = Math.round(g.depotGuardLevel * Difficulty.get(room.world.difficulty||g.difficulty).level);
      combat().spawnEnemy(room, def, Math.max(def.level[0], Math.min(def.level[1] + 3, guardLevel)), ok ? x : d.x + 0.5, ok ? y : d.y + 0.5, depotArea(d.id), { ignoreSafe: true });
    }
  }
}
function depotGuardsLeft(room, d) {
  const g = G();
  return [...combat().stateOf(room).enemies.values()].filter((e) => !e.dead && (e.area === depotArea(d.id) || (e.def.id === 'walker_patrol' && Math.hypot(e.x - d.x - 0.5, e.y - d.y - 0.5) <= g.depotRadius))).length;
}
function openDepot(room, c, id) {
  const g = G(), now = Date.now();
  const d = (room.map.depots || []).find((x) => x.id === id) || (room.map.depots || []).find((x) => Math.hypot(x.x + 0.5 - c.pos.x, x.y + 0.5 - c.pos.y) <= g.depotRadius);
  if (!d) return 'Склада рядом нет.';
  if (Math.hypot(d.x + 0.5 - c.pos.x, d.y + 0.5 - c.pos.y) > g.depotRadius) return 'Подойдите к складу.';
  const left = depotGuardsLeft(room, d);
  if (left) return `Склад охраняют шагоходы (${left}) — сначала разберитесь с ними.`;
  const key = room.id + ':' + d.id;
  const ch = c.character;
  const last = (ch.depots || {})[key];
  if (last && (!g.depotRespawnMin || now - last < g.depotRespawnMin * 60000)) return 'Склад пуст — вы уже его обчистили.';
  const drops = Enemies.rollLoot('depot', Math.round(g.depotGuardLevel * Difficulty.get(room.world.difficulty||g.difficulty).level), combat().random);
  if (!C.hasShrinker(ch)) drops.unshift({ id: 'shrinker', n: 1 });
  inventory.mutate(c.account, ch.id, (x) => {
    x.depots = { ...(x.depots || {}), [key]: now };
    const rest = [];
    for (const it of drops) { const item = Items.get(it.id); if (Inv.add(x, it.id, it.n, item.durability || undefined)) rest.push(it); }
    drops.length = 0; drops.push(...rest);
    return null;
  });
  for (const it of drops) {
    if (ground.isFull(room.id)) break;
    const gi = ground.add(room.id, { id: it.id, n: it.n }, { x: round2(c.pos.x + Math.random() - 0.5), y: round2(c.pos.y + Math.random() - 0.5) }, 'Военный склад');
    room.broadcast({ t: 'ground-add', item: gi });
  }
  chat.tell(c, 'Военный склад вскрыт: внутри контейнер-уменьшитель и довоенная электроника.');
  sendList(c);
  return null;
}

// ---------- Подключение ----------
function safely(c, fn) {
  let err;
  try { err = fn(); } catch (e) { err = e.message || String(e); }
  if (err) realtime.send(c, { t: 'comp-reject', message: err });
  else sendList(c);
  return err;
}
function onJoin(room, c) {
  c.mount = null;
  const ch = c.character;
  if (!Array.isArray(ch.companions)) ch.companions = [];
  ch.companions = ch.companions.map(C.sanitize).filter(Boolean);
  while(ch.companions.length>C.slots(ch)){
    const rec=ch.companions[ch.companions.length-1];
    const error=ACTS.release(room,c,{id:rec.id,migrate:true});
    if(error)break;
  }
  for (const rec of ch.companions) if (!rec.loadoutInitialized) {
    if (!Object.keys(rec.equip || {}).length && !(rec.bag || []).length) Object.assign(rec, require('./actor-items').generate(Enemies.get(rec.def), rec.level));
    rec.loadoutInitialized = true;
  }
  // призванных больше, чем мест (например, «Напарники» уменьшили) — лишние в контейнер
  let out = 0;
  for (const rec of ch.companions) if (rec.out && !rec.summoned) { if (++out > C.slots(ch)) rec.out = false; }
  for (const rec of ch.companions) if (rec.out) {
    if (rec.wait) { // ждёт в другом месте — его здесь нет; пришли туда, где он ждёт, — снова в команде
      if (rec.wait.key !== roomKey(room)) continue;
      const at = { x: rec.wait.x, y: rec.wait.y };
      delete rec.wait; rec.order = 'follow'; rec.guard = null;
      spawnEnt(room, c, rec, M.validatePosition(room.map, at) ? at : null);
      chat.tell(c, `${rec.name} снова с вами.`);
      continue;
    }
    const ent = spawnEnt(room, c, rec);
    const v = [...require('./vehicles').stateFor(room.world).list.values()].find((x) => x.room === (room.key || (room.level ? room.level.key : 'ground')) && x.companions.includes(rec.id));
    if (v) { ent.vehicleId = v.id; ent.x = v.x; ent.y = v.y; rec.order = 'board'; }
  }
  sendList(c);
}
function beforeLeave(room, c) {
  const st = stateOf(room);
  if (c.mount) c.mount = null;
  for (const ent of [...st.ents.values()]) if (ent.owner === c.account.id) removeEnt(room, ent.id);
}
// ---------- Панель ГМ ----------
const { HttpError } = require('./auth');
function liveClient(acc, chId) { const c = realtime.byAccount.get(acc.id); return c && c.room && c.character && c.character.id === chId ? c : null; }
function adminList(body = {}) {
  const { acc, ch } = inventory.resolveTarget(body.username, body.character);
  const c = liveClient(acc, ch.id);
  const src = c ? c.character : ch;
  return { username: acc.username, character: src.name, slots: C.slots(src), shrinker: C.hasShrinker(src), online: Boolean(c), list: C.list(src).map((r) => publicComp(r, c && entOf(c.room, r.id))) };
}
// Выдать спутника; spawn — призвать приручённого рядом с героем (герой должен быть в мире)
function adminGive(body = {}, spawn = false) {
  const { acc, ch } = inventory.resolveTarget(body.username, body.character);
  const def = Enemies.get(String(body.def || ''));
  if (!def) throw new HttpError(400, 'Неизвестное существо.');
  if (!C.kindOf(def)) throw new HttpError(400, `«${def.name}» не может быть спутником.`);
  const c0 = liveClient(acc, ch.id);
  if (spawn && !c0) throw new HttpError(400, 'Герой не в мире — призвать рядом с ним нельзя.');
  let rec = null;
  inventory.mutate(acc, ch.id, (x) => {
    if (body.cheat) {
      x.cheat = x.cheat || {};
      x.cheat.companionSlots = Math.min(10000, Math.max(C.slots(x), C.list(x).length + 1));
    }
    if(!C.freeSlots(x))return 'Команда заполнена (обычный максимум 11). Включите чит-лимит для выдачи сверх него.';
    const levelMax = body.cheat ? 100000 : 40;
    rec = C.makeRecord(def, Math.max(1, Math.min(levelMax, Math.floor(Number(body.level) || def.level[0]))), C.defaultMethod(def) || 'tame', newId());
    if (body.cheat) rec.cheat = { level: 1 };
    if (body.out === false || !C.freeSlots(x)) rec.out = false;
    x.companions = C.list(x).concat(rec);
    return null;
  });
  const c = liveClient(acc, ch.id);
  const at = Number.isFinite(body.x) && Number.isFinite(body.y) ? { x: body.x, y: body.y } : undefined; // чит-панель: у курсора
  if (c) { const r = recOf(c, rec.id); if (r && r.out) spawnEnt(c.room, c, r, at); sendList(c); }
  inventory.notify(acc.id, ch.id, `Администратор дал вам спутника: ${rec.name} (ур. ${rec.level}).`);
  return { username: acc.username, character: ch.name, companion: publicComp(rec) };
}
function adminEdit(body = {}) {
  const { acc, ch } = inventory.resolveTarget(body.username, body.character);
  const id = String(body.id || ''), c = liveClient(acc, ch.id);
  let edited = null;
  inventory.mutate(acc, ch.id, (x) => {
    const rec = C.list(x).find((r) => r.id === id);
    if (!rec) return 'Спутник не найден.';
    rec.cheat = rec.cheat || {};
    if (body.name !== undefined) rec.name = String(body.name).slice(0, 40) || rec.name;
    if (body.level !== undefined) {
      const n = Number(body.level);
      if (!Number.isSafeInteger(n) || n < 1 || n > 100000) return 'Уровень спутника должен быть от 1 до 100000.';
      rec.level = n; rec.cheat.level = 1;
    }
    for (const [key, label, max] of [['maxHp', 'Здоровье', 1000000000], ['dmg', 'Урон', 100000], ['speed', 'Скорость', 100000], ['skill', 'Навык', 100000]]) {
      if (body[key] === undefined) continue;
      const n = Number(body[key]);
      if (!Number.isFinite(n) || n < 0 || n > max) return `${label}: значение от 0 до ${max}.`;
      if (n === 0) delete rec.cheat[key]; else rec.cheat[key] = n;
    }
    if (body.god !== undefined) rec.god = Boolean(body.god);
    if (body.revive) { rec.down = 0; rec.hp = C.statsOf(rec).maxHp; rec.out = true; delete rec.summoned; }
    else if (body.hp !== undefined) rec.hp = Math.max(0, Math.min(C.statsOf(rec).maxHp, Number(body.hp) || 0));
    if (body.out !== undefined) rec.out = Boolean(body.out);
    if (!Object.keys(rec.cheat).length) delete rec.cheat;
    edited = rec;
    return null;
  });
  if (c && edited) {
    const liveRec = recOf(c, id);
    if (liveRec && liveRec.out) {
      const ent = entOf(c.room, id);
      if (!ent) spawnEnt(c.room, c, liveRec);
      else c.room.broadcast({ t: 'comp-add', comp: publicEnt(c.room, ent) });
    } else removeEnt(c.room, id);
    sendList(c);
  }
  return { username: acc.username, character: ch.name, companion: edited && publicComp(edited) };
}
function adminRemove(body = {}) {
  const { acc, ch } = inventory.resolveTarget(body.username, body.character);
  const id = String(body.id || '');
  const c = liveClient(acc, ch.id);
  if (c) removeEnt(c.room, id);
  let found = null;
  inventory.mutate(acc, ch.id, (x) => {
    found = C.list(x).find((r) => r.id === id) || null;
    if (!found) return 'Нет такого спутника.';
    x.companions = C.list(x).filter((r) => r.id !== id);
    return null;
  });
  if (c) sendList(c);
  return { username: acc.username, character: ch.name, removed: found.name };
}

realtime.use({
  welcome: (room) => {
    const st = stateOf(room);
    return { comps: [...st.ents.values()].map((e) => publicEnt(room, e)).filter(Boolean), depots: room.map.depots || [] };
  },
  onJoin,
  beforeLeave,
  tick: (room, dt, now) => {
    const st = stateOf(room);
    if (room.combat && (room.map.depots || []).length && now >= (st.nextDepot || 0)) { st.nextDepot = now + 1000; initDepots(room); }
    for (const ent of [...st.ents.values()]) stepEnt(room, ent, dt, now);
    // список своих спутников раз в секунду (здоровье, сытость)
    if (now >= (st.nextList || 0)) { st.nextList = now + 1000; for (const c of room.players.values()) sendList(c); }
  },
  stateExtra: (room) => {
    if (!room.comp || !room.comp.ents.size) return {};
    const out = [];
    for (const ent of room.comp.ents.values()) {
      const c = ownerOf(room, ent), rec = recOf(c, ent.id);
      if (rec) out.push([ent.id, round2(ent.x), round2(ent.y), hpPct(rec), (ent.path.length ? 1 : 0) | (rec.down ? 2 : 0) | (c.mount === ent.id ? 4 : 0) | (ent.vehicleId ? 8 : 0) | (hiddenEnt(room,ent)?16:0)]);
    }
    return { cp: out };
  },
  handlers: {
    tame: (c, msg) => { if (c.room) safely(c, () => tryTame(c.room, c, msg || {})); },
    comp: (c, msg) => { const m = msg && typeof msg === 'object' ? msg : {}; const fn = Object.prototype.hasOwnProperty.call(ACTS, m.a) ? ACTS[m.a] : null; if (c.room) safely(c, () => (fn ? fn(c.room, c, m) : 'Неизвестная команда спутнику.')); },
  },
});

Inv.setUseHook((ch,inst,it,ctx,take)=>{
  if(!it.drone)return undefined;
  const c=ctx&&ctx.client;if(!c||!c.room)return 'Собрать дрон можно только в мире.';
  if(!C.freeSlots(ch))return 'Команда заполнена (максимум 11). Сначала исключите спутника.';
  const def=Enemies.get(it.drone);if(!def)return 'Неизвестный дрон.';
  const rec=C.makeRecord(def,Math.min(40,Math.max(1,ch.level||1)),'hack',newId());
  rec.out=C.freeSlots(ch)>0;rec.bag=[];rec.loadoutInitialized=true;
  take();ch.companions.push(rec);
  setImmediate(()=>{if(c.room){if(rec.out)spawnEnt(c.room,c,rec);markDirty(c);sendList(c);}});return null;
},true);
module.exports = { hiddenEnt,revealEnt,snapshotAllies,restoreAllies,summon, enthrall, stateOf, stepEnt, pickTarget, spawnEnt, removeEnt, knockDown, aiTargets, entOf, hitByEnemy, hitByVehicle, onOwnerXp, speedFactor, flying, tryTame, ACTS, initDepots, openDepot, adminList, adminGive, adminEdit, adminRemove, publicComp, sendList };
