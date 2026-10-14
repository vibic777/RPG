'use strict';
// Поселения (шаг 15). Застройка, данные жителей, цены и диалоги — shared/settlements.js.
// Состояние на мир: data/worlds/<id мира>.settlements.json — { towns: { <id поселения>: { rep: { <id героя>: −100…100 },
//   names, stockN, restockAt, stock: { роль: { предмет: число } }, hp (0–100), dead: { <id жителя>: когда вернётся }, trade } }.
// Жители живут только в комнате поверхности и появляются, когда рядом герой (settlementWakeRadius); стража ходит дозором,
// бьёт врагов и тех, у кого враждебная репутация или кто напал на жителя (розыск wantedSec); мирные бродят и убегают от врагов.
// Сделки атомарны: инвентарь меняется на копии и применяется только целиком. Валюта — крышки и самородки (= S.NUGGET крышек).
// Набег (событие raid): налётчики идут на поселение, каждый внутри разрушает его; отбили — награда и репутация защитникам,
// не отбили за raidMaxMin — поселение разорено (цены выше, пока не отстроится).
const realtime = require('./realtime');
const chat = require('./chat');
const config = require('./config');
const auth = require('./auth');
const worlds = require('./worlds');
const events = require('./events');
const inventory = require('./inventory');
const { JsonFile, registerSchema } = require('./store');
const S = require('../shared/settlements');
const Items = require('../shared/items');
const Inv = require('../shared/inventory');
const Combat = require('../shared/combat');
const Enemies = require('../shared/enemies');
const M = require('../shared/movement');
const WorldGen = require('../shared/worldgen');
const Magic = require('../shared/magic');
const Crafting = require('../shared/crafting');

registerSchema('settlements', 1);
const G = () => config.get().game;
const combat = () => require('./combat');
const factions = () => require('./factions'); // фракции (шаг 16)
const quests = () => require('./quests'); // задания (шаг 16)
const family = () => require('./family'); // семья (шаг 17)
const Fac = require('../shared/factions');
const Q = () => require('../shared/quests');
const magic = () => require('./magic');
const survival = () => require('./survival');
const round2 = (v) => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ID_RE = /^[0-9a-f-]{36}$/;
const on = () => G().settlementsEnabled !== false;

// ---------- Хранение ----------
const worldsState = new Map(); // id мира -> { file, towns: {}, dirty, savedAt }
function stateFor(world) {
  let st = worldsState.get(world.id);
  if (st) return st;
  if (!ID_RE.test(world.id)) throw new Error('Некорректный мир.');
  const file = new JsonFile(`worlds/${world.id}.settlements.json`, { towns: {} }, { kind: 'settlements' });
  const data = file.get() || { towns: {} };
  st = { file, towns: data.towns || {}, dirty: false, savedAt: Date.now() };
  worldsState.set(world.id, st);
  return st;
}
const townKey=(world,sid)=>world.settlementNamespace?world.settlementNamespace+':'+sid:sid;
function recOf(world, sid) {
  sid=townKey(world,sid);
  const st = stateFor(world);
  let r = st.towns[sid];
  if (!r) r = st.towns[sid] = { rep: {}, names: {}, stockN: 0, restockAt: 0, stock: {}, hp: 100, dead: {}, trade: {} };
  return r;
}
function save(worldId) {
  const st = worldsState.get(worldId);
  if (!st) return 0;
  st.file.data = { savedAt: Date.now(), towns: st.towns };
  try { st.file.save(); st.dirty = false; st.savedAt = Date.now(); } catch (e) { console.warn('[settlements] не удалось сохранить поселения:', e.message); }
  return st.savedAt;
}
const dirty = (world) => { stateFor(world).dirty = true; };
worlds.on('removed', (w) => {
  const st = worldsState.get(w.id);
  worldsState.delete(w.id);
  const f = st ? st.file : ID_RE.test(w.id) ? new JsonFile(`worlds/${w.id}.settlements.json`, null) : null;
  if (f) { try { require('fs').unlinkSync(f.file); } catch { /* файла нет */ } }
});

// ---------- Поселения и репутация ----------
const townsOf = (room) => (room && !room.level && room.map && room.map.towns) || [];
const townById = (room, sid) => townsOf(room).find((t) => t.id === sid) || null;
const infoOf = (room, sid) => (room.map.settlements || []).find((s) => s.id === sid) || { name: '?', type: 'village' };
const charKey = (c) => c.character.id;
function repOf(world, ch, sid) { const r = stateFor(world).towns[townKey(world,sid)]; return r ? S.clampRep(r.rep[ch.id] || 0) : 0; }
// Отношение поселения с учётом фракции (шаг 16): + доля репутации Союза поселений (у мага — Ордена магов)
const effRep = (world, ch, sid, role) => Fac.townRep(ch, repOf(world, ch, sid), role);
const damaged = (world, sid) => { const r = stateFor(world).towns[townKey(world,sid)]; return Boolean(r && r.hp < 50); };
function publicTown(room, t, ch) {
  const r = recOf(room.world, t.id), rep = ch ? effRep(room.world, ch, t.id) : 0, info = infoOf(room, t.id);
  return { id: t.id, name: info.name, kind: t.kind, rep, tier: S.tierOf(rep), hp: Math.round(r.hp), raid: r.raid ? 1 : 0 };
}
// Изменить репутацию героя в поселении; часть — поселениям того же рода (фракции)
function changeRep(room, c, sid, delta, why) {
  if (!delta) return 0;
  const world = room.world, ch = c.character;
  const apply = (id, d) => {
    const r = recOf(world, id);
    const before = S.clampRep(r.rep[ch.id] || 0);
    r.rep[ch.id] = S.clampRep(before + d);
    r.names[ch.id] = ch.name;
    (r.users || (r.users = {}))[ch.id] = c.account.username;
    return r.rep[ch.id] - before;
  };
  const got = apply(sid, delta);
  const kind = infoOf(room, sid).type;
  const share = Math.trunc(delta * S.settings.repFactionShare);
  if (share) for (const s of room.map.settlements || []) if (s.id !== sid && s.type === kind) apply(s.id, share);
  dirty(world);
  const t = townById(room, sid);
  if (t) realtime.send(c, { t: 'stl-town', town: publicTown(room, t, ch) });
  if (why && got) chat.tell(c, `Репутация в «${infoOf(room, sid).name}»: ${got > 0 ? '+' : ''}${got} (${why}). Отношение: ${S.TIERS[S.tierOf(effRep(world, ch, sid))].name}.`);
  return got;
}

// ---------- Жители в мире ----------
function rt(room) {
  if (!room.stl) room.stl = { ents: new Map(), active: new Set(), wanted: new Map(), next: 0, gateOpen: new Map(), defenseAt: new Map() };
  room.stl.gateOpen ||= new Map(); room.stl.defenseAt ||= new Map();
  return room.stl;
}
const entOf = (room, id) => (room.stl ? room.stl.ents.get(id) || null : null);
const publicNpc = (n) => ({ id: n.id, sid: n.sid, role: n.role, name: n.name, x: round2(n.x), y: round2(n.y), outfit: require('./actor-items').look(n.equip), hp: Math.max(0, Math.ceil((n.hp / n.maxHp) * 100)) });
function spawnTown(room, t, now) {
  const st = rt(room), rec = recOf(room.world, t.id);
  for (const p of t.npcs) {
    if (st.ents.has(p.id) || (rec.dead[p.id] || 0) > now || (rec.gone && rec.gone[p.id])) continue; // gone — переехал на базу (свадьба, шаг 17)
    const role = S.ROLES[p.role];
    const n = { id: p.id, sid: t.id, role: p.role, name: `${p.name}`, x: p.x, y: p.y, home: { x: p.x, y: p.y }, hp: role.hp, maxHp: role.hp, path: [], repathAt: 0, target: null, nextAttack: 0, wanderAt: now + 2000 + (p.x * 97 % 5000), radius: 0.35, hurtAt: 0 };
    rec.npcItems = rec.npcItems || {};
    if (!rec.npcItems[p.id]) { rec.npcItems[p.id] = require('./actor-items').generate({ family: 'human' }, p.role === 'guard' ? 8 : 3); dirty(room.world); }
    Object.assign(n, rec.npcItems[p.id]);
    st.ents.set(n.id, n);
    room.broadcast({ t: 'npc-add', npc: publicNpc(n) });
  }
  st.active.add(t.id);
}
// Чит-панель (шаги 20–21): житель роли role у точки; приписан к ближайшему поселению. level — уровень (здоровье и урон +10 % за уровень).
// Такие жители (n.cheat) не уходят, когда поселение засыпает, и сохраняются в состоянии мира (snapshotCheat / restoreCheat).
const NPC_LEVEL_K = 0.1;
function adminSpawnNpc(room, role, x, y, level = 1, extra = {}) {
  if (!S.ROLES[role]) throw new Error(`Роль: ${Object.keys(S.ROLES).join(', ')}.`);
  const t = (room.map.towns || []).reduce((b, q) => (!b || Math.hypot(q.x - x, q.y - y) < Math.hypot(b.x - x, b.y - y) ? q : b), null);
  if (!t) throw new Error('В этом мире нет поселений — жителя не к кому приписать.');
  const st = rt(room), r = S.ROLES[role], now = Date.now();
  const lv = Math.max(1, Math.min(50, Math.floor(Number(level)) || 1)), k = 1 + NPC_LEVEL_K * (lv - 1);
  const n = { id: extra.id || `cheat-${role}-${now.toString(36)}-${++st.next}`, sid: t.id, role, name: extra.name || r.name, x, y, home: { x, y }, hp: Math.round(r.hp * k), maxHp: Math.round(r.hp * k), path: [], repathAt: 0, target: null, nextAttack: 0, wanderAt: now + 2000, radius: 0.35, hurtAt: 0, cheat: true, level: lv, cheatDmg: k };
  Object.assign(n, extra.loadout || require('./actor-items').generate({ family: 'human' }, lv));
  st.ents.set(n.id, n);
  room.broadcast({ t: 'npc-add', npc: publicNpc(n) });
  return n;
}
const snapshotCheat = (room) => (room.stl ? [...room.stl.ents.values()].filter((n) => n.cheat && n.hp > 0).map((n) => ({ id: n.id, role: n.role, name: n.name, x: round2(n.x), y: round2(n.y), level: n.level || 1, hp: Math.ceil(n.hp), maxHp: n.maxHp, god: n.god ? 1 : 0, cheatSpeed: n.cheatSpeed || 0, cheatDmg: n.cheatDmg || 1, equip: n.equip, bag: n.bag })) : []);
function restoreCheat(room, list) {
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || !S.ROLES[x.role] || !Number.isFinite(x.x) || !Number.isFinite(x.y)) continue;
    try {
      const n = adminSpawnNpc(room, x.role, x.x, x.y, x.level, { id: String(x.id || '').slice(0, 60) || undefined, name: String(x.name || '').slice(0, 40) || undefined, loadout: x.equip ? { equip: x.equip, bag: x.bag || [] } : null });
      if (x.maxHp > 0) n.maxHp = x.maxHp;
      n.hp = Math.max(1, Math.min(n.maxHp, x.hp || n.maxHp));
      if (x.god) n.god = true;
      if (x.cheatSpeed > 0) n.cheatSpeed = x.cheatSpeed;
      if (x.cheatDmg > 0) n.cheatDmg = x.cheatDmg;
    } catch { /* поселений нет */ }
  }
}
// Убрать жителя из мира (свадьба — переезд на базу, шаг 17)
function removeNpc(room, id) { const st = rt(room); if (st.ents.delete(id)) room.broadcast({ t: 'npc-remove', id }); }
function sleepTown(room, sid) {
  const st = rt(room);
  for (const n of [...st.ents.values()]) if (n.sid === sid && !n.escort && !n.cheat) { st.ents.delete(n.id); room.broadcast({ t: 'npc-remove', id: n.id }); }
  st.active.delete(sid);
}
// Враги видят жителей как цели (стража, мирные, торговцы)
function aiTargets(room) {
  if (!room.stl || !room.stl.ents.size) return [];
  return [...room.stl.ents.values()].map((n) => ({ id: n.id, x: n.x, y: n.y, dead: false, radius: n.radius, level: n.role === 'guard' ? 8 : 3, name: n.name, npc: true }));
}
// Жители, которых герой может ударить: выбранный им житель (owner.npc) и стражники, которые сами на него напали
function hostileNpcs(room, owner) {
  if (!room.stl || !room.stl.ents.size) return [];
  const out = [];
  for (const n of room.stl.ents.values()) {
    if (n.id === owner.npc || (n.target && n.target.k === 'p' && n.target.id === owner.id)) out.push({ kind: 'n', ref: n, x: n.x, y: n.y, r: n.radius });
  }
  return out;
}
const isWanted = (room, c, sid) => { const w = rt(room).wanted.get(c.account.id + ':' + sid); return Boolean(w && w > Date.now()); };
function crime(room, c, n, kind) {
  const st = rt(room), key = c.account.id + ':' + n.sid, now = Date.now();
  st.wanted.set(key, now + G().wantedSec * 1000);
  const loss = kind === 'murder' ? S.settings.repMurder : S.settings.repAssault;
  changeRep(room, c, n.sid, -loss, kind === 'murder' ? `убийство: ${n.name}` : `нападение на жителя: ${n.name}`);
  factions().change(c, Fac.ofRole(n.role) || 'alliance', -loss / 2, 'преступление в поселении'); // и у Союза (Ордена)
  for (const g of st.ents.values()) if (g.sid === n.sid && g.role === 'guard') g.target = { k: 'p', id: c.account.id };
  if (kind !== 'murder') chat.tell(c, `Стража «${infoOf(room, n.sid).name}» ищет вас ${G().wantedSec} с — уходите или защищайтесь.`);
}
// Урон жителю. attacker: { kind: 'p', c } | { kind: 'e', e } | null
function hurt(room, n, amount, type, attacker) {
  if (!n || !room.stl || !room.stl.ents.has(n.id) || n.god) return 0; // n.god — бессмертие (чит-панель)
  const def = n.role === 'guard' ? 6 : 1;
  const dmg = amount > 0 ? Combat.mitigate(amount, type || 'physical', def, {}, []) : 0;
  n.hp -= dmg;
  n.hurtAt = Date.now();
  combat().fx(room, { k: 'hit', t: 'n', id: n.id, n: dmg, c: 0, d: type });
  const c = attacker && attacker.kind === 'p' ? attacker.c : null;
  if (c) {
    const now = Date.now();
    if (!(n.crimeAt && now - n.crimeAt < 5000) && !(n.target && n.target.k === 'p' && n.target.id === c.account.id && n.role === 'guard' && isWanted(room, c, n.sid))) { n.crimeAt = now; if (n.hp > 0) crime(room, c, n, 'assault'); }
    if (n.role === 'guard') n.target = { k: 'p', id: c.account.id };
  } else if (attacker && attacker.kind === 'e' && n.role === 'guard' && !n.target) n.target = { k: 'e', id: attacker.e.id };
  if (n.hp <= 0) kill(room, n, c);
  return dmg;
}
function kill(room, n, killer) {
  const st = rt(room), rec = recOf(room.world, n.sid);
  combat().dropLoot(room, { ...n, level: n.level || (n.role === 'guard' ? 8 : 3), def: { name: n.name, loot: 'raider' } });
  if (rec.npcItems) delete rec.npcItems[n.id];
  require('./corpses').add(room, { kind: 'npc', role: n.role, name: n.name, x: n.x, y: n.y, look: require('./actor-items').look(n.equip), items: require('./actor-items').belongings(n).map(x => ({ ...x })) });
  st.ents.delete(n.id);
  rec.dead[n.id] = Date.now() + G().settlementNpcRespawnSec * 1000;
  dirty(room.world);
  combat().fx(room, { k: 'die', t: 'n', id: n.id, x: round2(n.x), y: round2(n.y) });
  room.broadcast({ t: 'npc-remove', id: n.id, dead: 1 });
  chat.system(room.id, `${S.ROLES[n.role].name} ${n.name} из «${infoOf(room, n.sid).name}» погибает${killer ? ` (${killer.character.name})` : ''}.`);
  if (killer && !n.escort) crime(room, killer, n, 'murder');
  if (n.escort) quests().escortLost(room, n);
}
function hitByEnemy(room, n, e, amount, type) { return hurt(room, n, amount, type, { kind: 'e', e }); }

function moveTowards(room, n, tx, ty, dt, speed, now) {
  room.grid = room.grid || M.gridFromWorld(room.map);
  if (!n.path.length || now >= n.repathAt) {
    n.path = M.findPath(room.grid, Math.floor(n.x), Math.floor(n.y), Math.floor(tx), Math.floor(ty), G().aiPathMaxNodes) || [];
    if (n.path.length && n.path[0][0] === Math.floor(n.x) && n.path[0][1] === Math.floor(n.y)) n.path.shift();
    n.repathAt = now + 600;
  }
  if (!n.path.length) return false;
  const previousRadius=room.map.actorRadius;
  let r;
  room.map.actorRadius=n.radius;
  try { r = M.followPath(room.map, n, n.path, dt, (speed * (n.cheatSpeed || 1)) / M.settings.heroSpeed); }
  finally { room.map.actorRadius=previousRadius; }
  n.x = r.pos.x; n.y = r.pos.y; n.path = r.path;
  return true;
}
// Цель стражника: враг рядом или преступник (розыск, враждебная репутация)
function guardTarget(room, n, t) {
  const g = G(), cs = combat().stateOf(room), now = Date.now();
  const limit = t.zone + g.guardLeash;
  const inReach = (p) => Math.max(Math.abs(p.x - t.x - 0.5), Math.abs(p.y - t.y - 0.5)) <= limit;
  if (n.target) {
    if (n.target.k === 'e') { const e = cs.enemies.get(n.target.id); if (e && require('./enemy-behaviour').hostile(e) && inReach(e)) return e; }
    else { const c = room.players.get(n.target.id); if (c && !combat().cbOf(c).dead && inReach(c.pos) && (isWanted(room, c, n.sid) || S.tierOf(effRep(room.world, c.character, n.sid)) === 'hostile')) return c; }
    n.target = null;
  }
  let best = null, bd = g.guardAggroRadius;
  for (const e of cs.enemies.values()) {
    if (!require('./enemy-behaviour').hostile(e) || e.boundUntil > now || (Enemies.behaviourOf(e.def).passive && !e.target) || !inReach(e)) continue;
    const d = dist(n, e);
    if (d < bd) { bd = d; best = e; n.target = { k: 'e', id: e.id }; }
  }
  if (best) return best;
  for (const c of room.players.values()) {
    if (combat().cbOf(c).dead || !inReach(c.pos) || dist(n, c.pos) > g.guardAggroRadius) continue;
    if (isWanted(room, c, n.sid) || S.tierOf(effRep(room.world, c.character, n.sid)) === 'hostile') { n.target = { k: 'p', id: c.account.id }; return c; }
  }
  return null;
}
function stepNpc(room, n, t, dt, now) {
  if(n.stunUntil>now){n.path=[];return;}
  const role = S.ROLES[n.role];
  if (n.escort) { stepEscort(room, n, dt, now); return; }
  if (now - n.hurtAt > 8000 && n.hp < n.maxHp) n.hp = Math.min(n.maxHp, n.hp + (G().npcRegenPerSec ?? .5) * dt);
  if (n.role === 'guard') {
    const tg = guardTarget(room, n, t);
    if (tg) {
      const pos = tg.pos || tg, r = tg.def ? tg.def.radius || 0.4 : 0.35;
      if (dist(n, pos) > role.range + r) { moveTowards(room, n, pos.x, pos.y, dt, role.speed, now); return; }
      n.path = [];
      if (now >= n.nextAttack) {
        n.nextAttack = now + 1100;
        const amount = (role.damage[0] + (role.damage[1] - role.damage[0]) * combat().random()) * (n.cheatDmg || 1);
        combat().fx(room, { k: 'swing', o: 'n', id: n.id, x: round2(n.x), y: round2(n.y), a: round2(Math.atan2(pos.y - n.y, pos.x - n.x)), r: Math.min(role.range, 2), f: 'lslash' });
        if (tg.def) combat().companionHit(room, { id: n.id, x: n.x, y: n.y }, tg, amount, 'physical', null, []);
        else combat().npcHit(room, n, tg, amount, 'physical');
      }
      return;
    }
  }
  // мирные убегают от врагов к центру
  if (n.role === 'civilian') {
    for (const e of combat().stateOf(room).enemies.values()) {
      if (!e.dead && dist(e, n) < 5) { moveTowards(room, n, t.x + 0.5, t.y + 0.5, dt, role.speed * 1.4, now); return; }
    }
  }
  // дозор и прогулки; службы стоят у себя
  const roams = n.role === 'guard' || n.role === 'civilian';
  if (roams && now >= n.wanderAt) {
    n.wanderAt = now + 5000 + combat().random() * 7000;
    const rr = Math.max(2, t.r - 1);
    const tx = Math.floor(t.x + (combat().random() * 2 - 1) * rr), ty = Math.floor(t.y + (combat().random() * 2 - 1) * rr);
    if (WorldGen.isWalkable(room.map, tx, ty)) n.goal = { x: tx + 0.5, y: ty + 0.5 };
  }
  const goal = roams ? n.goal : n.home;
  if (goal && dist(n, goal) > 0.3) { if (!moveTowards(room, n, goal.x, goal.y, dt, role.speed * (roams ? 0.6 : 1), now)) n.goal = null; } else n.path = [];
}

// ---------- Сопровождение (задания шага 16) ----------
// Житель выходит из поселения-заказчика и идёт за героем; дошёл до зоны поселения to — задание засчитано, житель остаётся там
function spawnEscort(room, giver, c, qid, to) {
  const st = rt(room), t = townById(room, giver.sid), dest = townById(room, to);
  if (!t || !dest) return null;
  const pool = S.NAMES;
  const id = `esc-${qid}`;
  if (st.ents.has(id)) return id;
  const base = giver.x != null ? giver : { x: t.x + 0.5, y: t.y + 0.5 };
  const n = { id, sid: giver.sid, role: 'civilian', name: pool[Math.abs(WorldGen.hashString(qid)) % pool.length], x: base.x, y: base.y, home: { x: base.x, y: base.y }, hp: 80, maxHp: 80, path: [], repathAt: 0, target: null, nextAttack: 0, wanderAt: 0, radius: 0.35, hurtAt: 0, escort: { qid, follow: c.account.id, to } };
  st.ents.set(id, n);
  room.broadcast({ t: 'npc-add', npc: { ...publicNpc(n), escort: 1 } });
  return id;
}
function removeEscort(room, id) {
  const st = rt(room);
  if (!st.ents.has(id)) return;
  st.ents.delete(id);
  room.broadcast({ t: 'npc-remove', id });
}
function stepEscort(room, n, dt, now) {
  if (now - n.hurtAt > 8000 && n.hp < n.maxHp) n.hp = Math.min(n.maxHp, n.hp + (G().npcRegenPerSec ?? .5) * dt);
  const dest = townById(room, n.escort.to);
  if (dest && Math.max(Math.abs(n.x - dest.x - 0.5), Math.abs(n.y - dest.y - 0.5)) <= dest.zone) {
    removeEscort(room, n.id);
    chat.system(room.id, `${n.name} добрался до «${infoOf(room, dest.id).name}».`);
    quests().escortArrived(room, n);
    return;
  }
  // идёт за ближайшим из группы (сначала — за тем, кто взял задание)
  let lead = room.players.get(n.escort.follow);
  if (!lead || combat().cbOf(lead).dead) lead = [...room.players.values()].filter((c) => !combat().cbOf(c).dead).sort((a, b) => dist(a.pos, n) - dist(b.pos, n))[0];
  if (!lead) { n.path = []; return; }
  if (lead.account.id !== n.escort.follow && dist(lead.pos, n) < 6) n.escort.follow = lead.account.id;
  const d = dist(lead.pos, n);
  if (d > 1.8 && d < 40) moveTowards(room, n, lead.pos.x, lead.pos.y, dt, Q().settings.questEscortSpeed * (d > 6 ? 1.3 : 1), now);
  else n.path = [];
}

// ---------- Торговля и услуги ----------
const MONEY_MAX = Number.MAX_SAFE_INTEGER - 100;
const wallet = (ch) => Math.min(MONEY_MAX, Inv.count(ch, 'caps') + S.NUGGET * Inv.count(ch, 'gold_nugget'));
// Изменения инвентаря на копии: применяются только если fn не вернула ошибку
function deal(ch, fn) {
  const saved = JSON.stringify({ inventory: ch.inventory, ammoOpen: ch.ammoOpen || null, survival: ch.survival || null });
  let err;
  try { err = fn(); } catch (e) { err = e.message; }
  if (err) { const o = JSON.parse(saved); ch.inventory = o.inventory; if (o.ammoOpen) ch.ammoOpen = o.ammoOpen; if (o.survival) ch.survival = o.survival; }
  return err || null;
}
function pay(ch, amount, free = false) {
  if (!Number.isSafeInteger(amount) || amount > MONEY_MAX) return 'Сумма выше безопасного предела кошелька.';
  if (amount <= 0) return null;
  if (free) return null;
  if (wallet(ch) < amount) return `Не хватает денег: нужно ${amount} крышек, у вас ${wallet(ch)}.`;
  const caps = Math.min(Inv.count(ch, 'caps'), amount);
  if (caps) Inv.takeById(ch, 'caps', caps);
  const rest = amount - caps;
  if (rest > 0) {
    const k = Math.ceil(rest / S.NUGGET);
    Inv.takeById(ch, 'gold_nugget', k);
    const change = k * S.NUGGET - rest;
    if (change > 0) { const e = Inv.add(ch, 'caps', change); if (e) return 'Нет места для сдачи: ' + e; }
  }
  return null;
}
function receive(ch, amount) {
  if (!Number.isSafeInteger(amount) || amount > MONEY_MAX) return 'Сумма выше безопасного предела кошелька.';
  return amount ? Inv.add(ch, 'caps', amount) : null;
}
function stockOf(room, t, role) {
  const rec = recOf(room.world, t.id), now = Date.now();
  if (!rec.restockAt || now >= rec.restockAt) {
    if (rec.restockAt) rec.stockN += 1;
    rec.restockAt = now + G().settlementRestockMin * 60000;
    rec.stock = {};
    dirty(room.world);
  }
  if (!rec.stock[role]) { rec.stock[role] = S.stockFor(room.map.seed, infoOf(room, t.id) && { id: t.id, type: t.kind }, role, rec.stockN); dirty(room.world); }
  return rec.stock[role];
}
function restock(room, sid) {
  const rec = recOf(room.world, sid);
  rec.stockN += 1; rec.stock = {}; rec.restockAt = Date.now() + G().settlementRestockMin * 60000;
  dirty(room.world);
}
const ctxOf = (room, c, n) => { const rep = effRep(room.world, c.character, n.sid, n.role); return { rep, tier: S.tierOf(rep), damaged: damaged(room.world, n.sid) }; };
function afterInv(c) {
  inventory.events.emit('changed', c.account.id, c.character);
  combat().markDirty(c);
  combat().persist(c);
}
function noteTrade(room, c, sid, caps) {
  const rec = recOf(room.world, sid), ch = c.character;
  const acc = Math.min(MONEY_MAX, (rec.trade[ch.id] || 0) + caps);
  const gain = Math.floor(acc / S.settings.repTradePer);
  rec.trade[ch.id] = acc - gain * S.settings.repTradePer;
  if (gain) changeRep(room, c, sid, gain, 'честная торговля');
  dirty(room.world);
}
function offers(room, c, n, what) {
  const t = townById(room, n.sid), ctx = ctxOf(room, c, n), ch = c.character, kind = S.KINDS[t.kind];
  const out = { t: 'npc-offer', id: n.id, what, rep: ctx.rep, tier: ctx.tier, damaged: ctx.damaged ? 1 : 0, money: wallet(ch) };
  if (what === 'trade') out.stock = Object.entries(stockOf(room, t, n.role === 'healer' ? 'healer' : 'trader')).filter(([, k]) => k > 0).map(([id, k]) => ({ id, n: k, price: S.price(Items.get(id), 'buy', ctx) }));
  if (what === 'heal') {
    const max = combat().maxVitals(ch).hp, miss = Math.max(0, Math.ceil(max - ch.vitals.hp));
    const sv = ch.survival || {};
    out.heal = { miss, price: miss ? S.servicePrice(miss * S.settings.healPricePerHp, ctx) : 0 };
    out.cure = { need: (sv.rad > 0 || sv.illUntil > Date.now()) ? 1 : 0, rad: Math.round(sv.rad || 0), ill: sv.illUntil > Date.now() ? 1 : 0, price: S.servicePrice(S.settings.curePrice, ctx) };
  }
  if (what === 'learn') out.spells = Magic.SPELLS.filter((s) => s.tier <= kind.spellTier).map((s) => ({ id: s.id, name: s.name, tier: s.tier, school: s.school, known: Magic.knows(ch, s.id) ? 1 : 0, err: Magic.knows(ch, s.id) ? null : Magic.canLearn(ch, s.id), price: spellPrice(s, ctx) }));
  if (what === 'recipes') { const known = Crafting.known(ch); out.recipes = Crafting.RECIPES.filter((r) => !r.start).map((r) => ({ id: r.id, name: r.name, known: known.has(r.id) ? 1 : 0, price: recipePrice(r, ctx) })); }
  realtime.send(c, out);
}
const spellPrice = (s, ctx) => S.servicePrice(S.settings.spellPricePerTier * s.tier * s.tier, ctx);
function recipePrice(r, ctx) {
  const it = r.out && Items.get(r.out.id); // чертежи построек — без предмета на выходе
  return S.servicePrice(Math.max(40, Math.ceil(((it && it.value) || 20) * ((r.out && r.out.n) || 1) * S.settings.recipePriceFactor)), ctx);
}

// Сообщение npc: { a, id, ... }
function act(c, m) {
  if (!on()) return 'Поселения отключены на сервере.';
  const room = c.room;
  if (!room || room.level) return 'Здесь нет жителей.';
  if (combat().cbOf(c).dead) return 'Вы погибли.';
  const n = entOf(room, String(m.id || ''));
  if (!n) return 'Этого жителя здесь нет.';
  if (dist(n, c.pos) > S.settings.settlementTalkRange + n.radius) return 'Подойдите ближе, чтобы говорить.';
  const ctx = ctxOf(room, c, n), ch = c.character, t = townById(room, n.sid), role = S.ROLES[n.role];
  const rec = recOf(room.world, n.sid);
  if (m.a === 'talk') {
    realtime.send(c, { t: 'npc-talk', npc: publicNpc(n), town: publicTown(room, t, ch), dlg: role.dlg, ...family().talkExtra(room, c, n, ctx.tier) });
    return null;
  }
  if (m.a === 'quest') { // задания (шаг 16): только у старосты; враги поселения работы не получают
    if (n.role !== 'quest') return `${n.name}: «С работой — к старосте.»`;
    if (ctx.tier === 'hostile') return `${n.name} не даст работы врагу «${infoOf(room, n.sid).name}».`;
    return quests().giverAct(room, c, n, m);
  }
  if (ctx.tier === 'hostile') return `${n.name} не желает с вами говорить: в «${infoOf(room, n.sid).name}» вас считают врагом.`;
  if (isWanted(room, c, n.sid)) return `${n.name}: «Сначала разберись со стражей!»`;
  if (m.a === 'orphans' || String(m.a || '').startsWith('fam_')) return family().npcAct(room, c, n, m, ctx.tier); // семья (шаг 17)
  const sells = (n.role === 'trader' || n.role === 'healer');
  switch (m.a) {
    case 'trade': if (!sells) return 'Этот житель не торгует.'; offers(room, c, n, 'trade'); return null;
    case 'buy': {
      if (!sells) return 'Этот житель не торгует.';
      const id = String(m.item || ''), k = Number(m.n) || 1, it = Items.get(id);
      const stock = stockOf(room, t, n.role === 'healer' ? 'healer' : 'trader');
      if (!it || !(stock[id] > 0)) return 'Этого товара нет.';
      if (!Number.isInteger(k) || k < 1 || k > stock[id]) return `В наличии только ${stock[id]}.`;
      const cost = Math.min(MONEY_MAX, S.price(it, 'buy', ctx) * k);
      const free = realtime.godOf(c.account.id).infiniteMoney;
      const err = deal(ch, () => pay(ch, cost, free) || Inv.add(ch, id, k));
      if (err) return err;
      stock[id] -= k;
      dirty(room.world);
      noteTrade(room, c, n.sid, cost);
      afterInv(c);
      chat.tell(c, `Куплено: ${it.name}${k > 1 ? ` × ${k}` : ''} за ${cost} крышек.`);
      offers(room, c, n, 'trade');
      return null;
    }
    case 'sell': {
      if (n.role !== 'trader') return 'Продавать можно торговцу.';
      const i = Number(m.i), cell = Number.isInteger(i) ? ch.inventory.cells[i] : null;
      const it = cell && Items.get(cell.id);
      if (!it) return 'Там нет предмета.';
      if (!S.tradable(it)) return `«${it.name}» торговец не берёт.`;
      const k = Math.min(cell.n, Number(m.n) || 1);
      if (!Number.isInteger(k) || k < 1) return 'Неверное количество.';
      const k2 = it.durability ? Math.max(0.2, (cell.dur || it.durability) / it.durability) : 1; // поношенное — дешевле
      const gain = Math.min(MONEY_MAX, Math.max(1, Math.floor(S.price(it, 'sell', ctx) * k2)) * k);
      const err = deal(ch, () => {
        cell.n -= k;
        if (cell.n <= 0) ch.inventory.cells[i] = null;
        return receive(ch, gain);
      });
      if (err) return err;
      const stock = stockOf(room, t, 'trader');
      stock[it.id] = (stock[it.id] || 0) + k;
      dirty(room.world);
      noteTrade(room, c, n.sid, gain);
      afterInv(c);
      chat.tell(c, `Продано: ${it.name}${k > 1 ? ` × ${k}` : ''} за ${gain} крышек.`);
      offers(room, c, n, 'trade');
      return null;
    }
    case 'heal': case 'cure': {
      if (n.role !== 'healer') return 'Лечит лекарь.';
      if (ctx.tier === 'unfriendly') return `${n.name}: «Лечить тебя? После всего, что ты натворил? Нет.»`;
      if (m.a === 'heal' && !m.go) { offers(room, c, n, 'heal'); return null; }
      if (m.a === 'heal') {
        const max = combat().maxVitals(ch).hp, miss = Math.max(0, Math.ceil(max - ch.vitals.hp));
        if (!miss) return 'Вы здоровы.';
        const cost = S.servicePrice(miss * S.settings.healPricePerHp, ctx);
        const err = deal(ch, () => pay(ch, cost, realtime.godOf(c.account.id).infiniteMoney));
        if (err) return err;
        ch.vitals.hp = max;
        combat().sendMe(c, true);
        chat.tell(c, `${n.name} перевязывает раны: здоровье восстановлено за ${cost} крышек.`);
      } else {
        const sv = ch.survival || {};
        if (!(sv.rad > 0 || sv.illUntil > Date.now())) return 'Вы не больны и не облучены.';
        const cost = S.servicePrice(S.settings.curePrice, ctx);
        const err = deal(ch, () => pay(ch, cost, realtime.godOf(c.account.id).infiniteMoney));
        if (err) return err;
        sv.rad = 0; sv.illUntil = 0;
        try { survival().sendSv(room, c, true); } catch { /* шкалы дойдут со следующим тиком */ }
        chat.tell(c, `${n.name} выводит радиацию и лечит болезнь за ${cost} крышек.`);
      }
      afterInv(c);
      offers(room, c, n, 'heal');
      return null;
    }
    case 'learn': {
      if (n.role !== 'mage') return 'Учит маг-наставник.';
      if (!G().magicEnabled) return 'Магия отключена на сервере.';
      if (ctx.tier === 'unfriendly') return `${n.name}: «Учить тебя? Нет уж.»`;
      if (!m.spell) { offers(room, c, n, 'learn'); return null; }
      const s = Magic.get(String(m.spell));
      if (!s || s.tier > S.KINDS[t.kind].spellTier) return 'Этому здесь не учат.';
      const why = Magic.canLearn(ch, s.id);
      if (why) return why;
      const cost = spellPrice(s, ctx);
      const err = deal(ch, () => pay(ch, cost, realtime.godOf(c.account.id).infiniteMoney));
      if (err) return err;
      const e2 = magic().mageTeach(c, s.id);
      if (e2) { receive(ch, cost); return e2; } // не вышло — деньги назад
      afterInv(c);
      noteTrade(room, c, n.sid, cost);
      offers(room, c, n, 'learn');
      return null;
    }
    case 'recipes': {
      if (n.role !== 'recipes') return 'Рецепты продаёт мастер.';
      if (!m.recipe) { offers(room, c, n, 'recipes'); return null; }
      const r = Crafting.get(String(m.recipe));
      if (!r || r.start) return 'Такого рецепта здесь нет.';
      if (Crafting.known(ch).has(r.id)) return `Рецепт «${r.name}» уже известен.`;
      const cost = recipePrice(r, ctx);
      const err = deal(ch, () => pay(ch, cost, realtime.godOf(c.account.id).infiniteMoney) || Crafting.learn(ch, r.id));
      if (err) return err;
      afterInv(c);
      noteTrade(room, c, n.sid, cost);
      chat.tell(c, `Выучен рецепт: ${r.name} (${cost} крышек).`);
      try { realtime.send(c, { t: 'craft', ...require('./crafting').view(ch) }); } catch { /* книга обновится при открытии */ }
      offers(room, c, n, 'recipes');
      return null;
    }
    default: return 'Неизвестное действие.';
  }
}

// ---------- Набеги ----------
function startRaid(room, sid, opts = {}) {
  const t = townById(room, sid);
  if (!t) return null;
  const rec = recOf(room.world, sid), info = infoOf(room, sid);
  if (rec.raid) return null;
  if (!rt(room).active.has(sid)) spawnTown(room, t, Date.now());
  const kind = S.KINDS[t.kind];
  const n = Math.max(2, Number(opts.count) || 3 + Math.min(4, room.players.size));
  const defs = kind.raiders.map((id) => Enemies.get(id)).filter(Boolean);
  const center = { x: t.x + 0.5, y: t.y + 0.5 };
  const firstNpc = [...rt(room).ents.values()].find((x) => x.sid === sid);
  const made = [];
  for (let i = 0; i < n && defs.length; i++) {
    const def = defs[i % defs.length];
    const got = combat().spawnGroup(room, center, def, 1, firstNpc ? firstNpc.id : null, t.r + 5, t.r + 9);
    for (const e of got) { e.home = { ...center }; e.raid = sid; made.push(e.id); }
  }
  if (!made.length) return null;
  rec.raid = { at: Date.now(), until: Date.now() + G().raidMaxMin * 60000, enemies: made, defenders: [] };
  dirty(room.world);
  chat.system(room.id, `⚔ Набег на «${info.name}»! Налётчиков: ${made.length}. Защитите поселение — награда ждёт защитников.`);
  for (const c of room.players.values()) { const tt = townById(room, sid); realtime.send(c, { t: 'stl-town', town: publicTown(room, tt, c.character) }); }
  return `набег (${made.length}) на «${info.name}» в мире «${room.world.name}»`;
}
function stepRaid(room, t, rec, dt, now) {
  const r = rec.raid, cs = combat().stateOf(room), g = G();
  const alive = r.enemies.map((id) => cs.enemies.get(id)).filter((e) => e && !e.dead);
  const defenders = new Set(r.defenders);
  for (const e of alive) {
    for (const id of e.hitBy.keys()) defenders.add(id);
    if (Math.max(Math.abs(e.x - t.x - 0.5), Math.abs(e.y - t.y - 0.5)) <= t.zone) rec.hp = Math.max(0, rec.hp - g.raidDamagePerSec * dt);
  }
  for (const c of room.players.values()) if (!combat().cbOf(c).dead && Math.max(Math.abs(c.pos.x - t.x), Math.abs(c.pos.y - t.y)) <= t.zone + 6) defenders.add(c.account.id);
  r.defenders = [...defenders];
  r.enemies = alive.map((e) => e.id);
  const info = infoOf(room, t.id);
  if (!alive.length) {
    rec.raid = null;
    const names = [];
    for (const id of r.defenders) {
      const c = room.players.get(id) || null;
      if (!c) continue;
      names.push(c.character.name);
      const ch = c.character;
      const err = deal(ch, () => Inv.add(ch, 'gold_nugget', g.raidRewardGold));
      chat.tell(c, err ? `Награду (${g.raidRewardGold} самородка) некуда положить: ${err}` : `Награда за защиту «${info.name}»: золотых самородков — ${g.raidRewardGold}.`);
      if (!err) afterInv(c);
      changeRep(room, c, t.id, S.settings.repDefend, 'защита от набега');
      factions().change(c, 'alliance', S.settings.repDefend / 3, 'защита поселения');
      family().onRaidDefended(room, c, t.id);
    }
    chat.system(room.id, `Набег на «${info.name}» отбит!${names.length ? ' Защитники: ' + names.join(', ') + '.' : ''}`);
    quests().onRaid(room, t.id, true, r.defenders);
  } else if (rec.hp <= 0 || now >= r.until) {
    rec.raid = null;
    rec.hp = Math.min(rec.hp, 25);
    chat.system(room.id, `«${info.name}» разорено налётчиками: цены выше, пока поселение не отстроится.`);
    quests().onRaid(room, t.id, false, r.defenders);
  } else return;
  dirty(room.world);
  for (const c of room.players.values()) realtime.send(c, { t: 'stl-town', town: publicTown(room, t, c.character) });
}
events.registerType('raid', 'Набег на поселение (target — имя или номер поселения; иначе — ближайшее к игроку)', (ev, room) => {
  if (room.level || !on() || !townsOf(room).length) return null;
  let sid = null;
  if (ev.target) {
    const q = String(ev.target).toLowerCase();
    const s = (room.map.settlements || []).find((x) => String(x.id) === q || x.name.toLowerCase() === q);
    if (!s) return null;
    sid = s.id;
  } else {
    const alive = [...room.players.values()].filter((c) => !combat().cbOf(c).dead);
    if (!alive.length) return null;
    const c = alive[Math.floor(combat().random() * alive.length)];
    let bd = Infinity;
    for (const t of townsOf(room)) { const d = Math.hypot(t.x - c.pos.x, t.y - c.pos.y); if (d < bd) { bd = d; sid = t.id; } }
  }
  return startRaid(room, sid, { count: ev.enemy && Number(ev.enemy) });
});

// ---------- Тик ----------
function tick(room, dt, now) {
  if (room.level || !on()) return;
  const towns = townsOf(room);
  if (!towns.length) return;
  const st = rt(room), g = G();
  stepTownDefenses(room, towns, st, now);
  if (now >= st.next) {
    const sec = st.last ? (now - st.last) / 1000 : 1;
    st.last = now;
    st.next = now + 1000;
    for (const t of towns) {
      const near = [...room.players.values()].some((c) => Math.hypot(c.pos.x - t.x, c.pos.y - t.y) <= g.settlementWakeRadius);
      const rec = stateFor(room.world).towns[townKey(room.world,t.id)];
      if (near || (rec && rec.raid)) spawnTown(room, t, now); // и возвращает погибших, когда пришло время
      else if (st.active.has(t.id) && ![...room.players.values()].some((c) => Math.hypot(c.pos.x - t.x, c.pos.y - t.y) <= g.settlementWakeRadius + 10)) sleepTown(room, t.id);
      if (!rec) continue;
      if (rec.raid) stepRaid(room, t, rec, sec, now);
      else if (rec.hp < 100) { rec.hp = Math.min(100, rec.hp + (g.settlementRegenPerMin * sec) / 60); dirty(room.world); }
    }
    const ws = stateFor(room.world);
    if (ws.dirty && now - ws.savedAt > 10000) save(room.worldId);
  }
  for (const n of [...st.ents.values()]) { const t = towns[n.sid]; if (t) stepNpc(room, n, t, dt, now); }
}

// Ворота реагируют на людей и угрозы, а автономные огневые точки держат периметр даже без игроков.
function stepTownDefenses(room, towns, st, now) {
  room.map.openGates ||= new Set();
  const enemies = [...combat().stateOf(room).enemies.values()].filter((e) => !e.dead).map(e=>({...e,hostile:require('./enemy-behaviour').hostile(e)}));
  const players = [...room.players.values()].filter((c) => !combat().cbOf(c).dead);
  let gridChanged = false;
  for (const t of towns) {
    for (const gate of t.gates || []) {
      const key = `${t.id}:${gate.id}`, open = st.gateOpen.get(key) || false;
      const owners = new Set(players.map((c) => c.account.id));
      const allies = [...require('./companions').stateOf(room).ents.values()].filter((e) => !e.dead && owners.has(e.owner) && !e.vehicleId);
      const vehicles = require('./vehicles').inRoom(room).filter((v) => !v.wreck && (owners.has(v.owner) || v.seats.some(id=>owners.has(id))));
      const actors = [...players.filter(c=>!c.veh).map(c=>({id:c.account.id,...c.pos,radius:0.35})),
        ...allies.map(e=>({...e,id:'ally:'+e.id})),
        ...vehicles.map(v=>({...v,id:'vehicle:'+v.id,radius:0,body:require('../shared/vehicles').bodyAt(v.def,v)}))];
      st.gatePending ||= new Map();
      const result = require('./settlement-gates').updateGate({gate,town:t,width:room.map.width,actors,enemies,open,pending:st.gatePending.get(key)});
      st.gatePending.set(key,result.pending);
      const near = result.open;
      if (near !== open) {
        st.gateOpen.set(key, near);
        for (const j of gate.cells) { if (near) room.map.openGates.add(j); else room.map.openGates.delete(j); }
        room.broadcast({ t: 'settlement-gates', townId: t.id, gateId: gate.id, open: near, cells: gate.cells });
        gridChanged = true;
      }
    }
    for (let i = 0; i < (t.defenses || []).length; i++) {
      const p = t.defenses[i], key = `${t.id}:${i}`;
      if ((st.defenseAt.get(key) || 0) > now) continue;
      const e = enemies.filter((x) => x.hostile && Math.hypot(x.x - p.x, x.y - p.y) <= 9 && Math.hypot(x.x - t.x, x.y - t.y) <= t.r + 2)
        .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (!e) continue;
      st.defenseAt.set(key, now + 900);
      combat().companionHit(room, { id: `settlement:${key}`, x: p.x, y: p.y }, e, 7, 'physical', null);
      room.broadcast({ t: 'settlement-turret', townId: t.id, index: i, x: p.x, y: p.y, tx: e.x, ty: e.y, until: now + 180 });
    }
  }
  if (gridChanged) room.grid = M.gridFromWorld(room.map);
}

// ---------- Мирная зона ----------
const zoneAt = (room, x, y) => (room && !room.level ? S.at(room.map, x, y) : null);
// PvP в поселении запрещён (settlementPvpOff): кто-то из двоих — в мирной зоне
const pvpBlocked = (room, a, b) => Boolean(on() && G().settlementPvpOff && (zoneAt(room, a.x, a.y) || zoneAt(room, b.x, b.y)));
// Бонус вербовки «Договором» (shared/companions.js): репутация ближайшего поселения −2…+2
function recruitBonus(room, c) {
  if (!on() || !room || room.level) return 0;
  let best = null, bd = Infinity;
  for (const t of townsOf(room)) { const d = Math.hypot(t.x - c.pos.x, t.y - c.pos.y); if (d < bd) { bd = d; best = t; } }
  return best && bd <= best.zone + 20 ? S.tierBonus(effRep(room.world, c.character, best.id)) : 0;
}

// ---------- Администратор ----------
function worldOf(body, admin) {
  if (body.worldId) return worlds.load(String(body.worldId)); // 404, если мира нет
  const c = require('./admin').selfClient(admin);
  return c.room.world;
}
function adminList(admin, body = {}) {
  const w = worldOf(body, admin), map = worlds.getMap(w), st = stateFor(w);
  return {
    worldId: w.id, world: w.name,
    towns: (map.towns || []).map((t) => {
      const s = map.settlements[t.id], r = st.towns[t.id] || { rep: {}, names: {}, hp: 100, stockN: 0 };
      return { id: t.id, name: s.name, kind: t.kind, kindName: S.KINDS[t.kind].name, x: t.x, y: t.y, hp: Math.round(r.hp), raid: r.raid ? r.raid.enemies.length : 0, stockN: r.stockN || 0,
        reps: Object.entries(r.rep || {}).map(([id, v]) => ({ id, name: (r.names || {})[id] || id, username: (r.users || {})[id] || null, rep: v, tier: S.tierOf(v), tierName: S.TIERS[S.tierOf(v)].name })) };
    }),
  };
}
function adminAct(admin, body = {}) {
  const w = worldOf(body, admin), map = worlds.getMap(w);
  const sid = Number(body.sid);
  if (!Number.isInteger(sid) || !(map.towns || [])[sid]) throw new auth.HttpError(404, 'Поселение не найдено.');
  const room = realtime.worldRooms(w.id).find((r) => !r.level) || null;
  const name = map.settlements[sid].name;
  let out;
  switch (body.act) {
    case 'rep': {
      const { acc, ch } = inventory.resolveTarget(body.username, body.character);
      const v = S.clampRep(body.value);
      const r = recOf(w, sid);
      r.rep[ch.id] = v; r.names[ch.id] = ch.name; (r.users || (r.users = {}))[ch.id] = acc.username;
      dirty(w);
      const c = realtime.byAccount.get(acc.id);
      if (c && c.room && c.room.worldId === w.id && c.character.id === ch.id && !c.room.level) { realtime.send(c, { t: 'stl-town', town: publicTown(c.room, map.towns[sid], c.character) }); chat.tell(c, `Администратор изменил вашу репутацию в «${name}»: ${v}.`); }
      out = { town: name, character: ch.name, rep: v, tier: S.tierOf(v) };
      break;
    }
    case 'restock': { if (room) restock(room, sid); else { const r = recOf(w, sid); r.stockN += 1; r.stock = {}; r.restockAt = Date.now() + G().settlementRestockMin * 60000; dirty(w); } out = { town: name, stockN: recOf(w, sid).stockN }; break; }
    case 'repair': { const r = recOf(w, sid); r.hp = 100; dirty(w); out = { town: name, hp: 100 }; break; }
    case 'raid': {
      if (!room || !room.players.size) throw new auth.HttpError(409, 'В мире нет игроков на поверхности — набег некому отбивать.');
      const res = startRaid(room, sid, { count: body.count });
      if (!res) throw new auth.HttpError(409, 'Набег не начался (уже идёт или некуда поставить налётчиков).');
      out = { town: name, result: res };
      break;
    }
    default: throw new auth.HttpError(400, 'Действие: rep, restock, repair или raid.');
  }
  save(w.id);
  auth.logAdmin(admin, 'settlement-' + body.act, { worldId: w.id, sid, ...out });
  return out;
}

// ---------- Подключение ----------
function safely(c, fn) {
  let err;
  try { err = fn(); } catch (e) { err = e.message || String(e); }
  if (err) realtime.send(c, { t: 'npc-reject', message: err });
  return err;
}
realtime.use({
  welcome: (room, c) => {
    if (room.level || !on()) return { npcs: [], towns: [] };
    return { sg: [...(room.map.openGates || [])], npcs: room.stl ? [...room.stl.ents.values()].map(publicNpc) : [], towns: townsOf(room).map((t) => publicTown(room, t, c.character)) };
  },
  tick,
  stateExtra: (room) => {
    return { sg: [...(room.map.openGates || [])], np: room.stl ? [...room.stl.ents.values()].map((n) => [n.id, round2(n.x), round2(n.y), Math.max(0, Math.ceil((n.hp / n.maxHp) * 100)), (n.path.length ? 1 : 0) | (n.target ? 2 : 0)]) : [] };
  },
  onSaveWorld: (room) => save(room.worldId),
  onDestroy: (room) => {
    if (!worldsState.has(room.worldId) || room.removed) return;
    save(room.worldId);
    if (!realtime.worldRooms(room.worldId).some((r) => r !== room)) worldsState.delete(room.worldId);
  },
  handlers: {
    npc: (c, m) => safely(c, () => act(c, m && typeof m === 'object' ? m : {})),
  },
});

module.exports = { adminSpawnNpc, snapshotCheat, restoreCheat, publicNpc, removeNpc, afterInv, markWorldDirty: (world) => dirty(world), spawnEscort, removeEscort, townsOf, stateFor, save, recOf, repOf, changeRep, entOf, aiTargets, hostileNpcs, hurt, hitByEnemy, startRaid, restock, wallet, pay, receive, deal, pvpBlocked, zoneAt, recruitBonus, adminList, adminAct, publicTown, isWanted, act };
