'use strict';
// Задания и концовки на сервере (шаг 16). Задания — общие на мир (группа игроков владельца мира): взял один — прогресс у всех,
// награду получает каждый участник (кто был в мире, пока задание шло; ушедшим — при следующем входе). Цели отслеживает сервер:
// убийства (combat.killEnemy), приручение (companions), крафт (crafting.deliver), набеги (settlements), спуск на уровни (вход в комнату
// уровня), сопровождение (житель идёт за героем), доставка и сбор (сдача старосте), репутация (проверка по таймеру).
// Сюжетная кампания мира; финал — разговор (T рядом с Патриархом) или бой → концовка → markEnding, экран финала,
// игра продолжается, «Новая игра+» открыта. Состояние — data/worlds/<мир>.quests.json.
const Q = require('../shared/quests');
const F = require('../shared/factions');
const S = require('../shared/settlements');
const Items = require('../shared/items');
const Enemies = require('../shared/enemies');
const Inv = require('../shared/inventory');
const Magic = require('../shared/magic');
const Crafting = require('../shared/crafting');
const Levels = require('../shared/levels');
const Regions = require('../shared/regions');
const M = require('../shared/movement');
const WorldGen = require('../shared/worldgen');
const realtime = require('./realtime');
const chat = require('./chat');
const config = require('./config');
const auth = require('./auth');
const worlds = require('./worlds');
const characters = require('./characters');
const ngplus = require('./ngplus');
const { JsonFile, registerSchema } = require('./store');

registerSchema('quests', 1);
const G = () => config.get().game;
const combat = () => require('./combat');
const settlements = () => require('./settlements');
const factions = () => require('./factions');
const magic = () => require('./magic');
const ID_RE = /^[0-9a-f-]{36}$/;
const on = () => G().questsEnabled !== false;
const round2 = (v) => Math.round(v * 100) / 100;

// Зацепка семьи (шаг 17): Патриарх согласился войти в семью героя. Шаг 17 заменит обработчик.
const hooks = { familyJoin: (c, who) => require('./family').invite(c, who) }; // приглашение в семью (шаг 17: панель семьи)

// ---------- Хранение ----------
const worldsState = new Map();
function stateFor(world) {
  let st = worldsState.get(world.id);
  if (st) return st;
  if (!ID_RE.test(world.id)) throw new Error('Некорректный мир.');
  const file = new JsonFile(`worlds/${world.id}.quests.json`, null, { kind: 'quests' });
  const d = file.get() || {};
  st = { file, active: d.active || [], done: d.done || {}, main: d.main || 0, pending: d.pending || {}, campaign: d.campaign || {}, story: d.story || { patriarch: 'alive', ending: null }, stats: d.stats || { completed: 0 }, dirty: false, savedAt: Date.now() };
  worldsState.set(world.id, st);
  return st;
}
function save(worldId) {
  const st = worldsState.get(worldId);
  if (!st) return 0;
  st.file.data = { savedAt: Date.now(), active: st.active, done: st.done, main: st.main, pending: st.pending, campaign: st.campaign, story: st.story, stats: st.stats };
  try { st.file.save(); st.dirty = false; st.savedAt = Date.now(); } catch (e) { console.warn('[quests] не удалось сохранить задания:', e.message); }
  return st.savedAt;
}
const dirty = (world) => { stateFor(world).dirty = true; };
worlds.on('removed', (w) => {
  const st = worldsState.get(w.id);
  worldsState.delete(w.id);
  const f = st ? st.file : ID_RE.test(w.id) ? new JsonFile(`worlds/${w.id}.quests.json`, null) : null;
  if (f) { try { require('fs').unlinkSync(f.file); } catch { /* файла нет */ } }
});

// ---------- Помощники ----------
const worldClients = (worldId) => realtime.worldRooms(worldId).flatMap((r) => [...r.players.values()]);
const surfaceOf = (worldId) => realtime.worldRooms(worldId).find((r) => !r.level) || null;
const townName = (room, sid) => { const s = (room.map.settlements || []).find((x) => x.id === sid); return s ? s.name : `#${sid}`; };
function envFor(room) {
  const ground = !room.level?room:surfaceOf(room.worldId) || room;
  return {
    items: Items.get, enemies: Enemies.get,
    townName: (sid) => townName(ground, sid),
    levelName: (t) => (Levels.TYPES[t] ? Levels.TYPES[t].name : t),
  };
}
function publicQuest(room, rec) {
  const q = rec.def, env = envFor(room);
  const destination=rec.data?.regionKey||'ground',here=room.region?.key||room.level?.regionKey||'ground';
  let where=rec.data?.where||null;
  if(destination!==here&&!room.level){const p=Regions.nextPortal(room.map,destination);if(p)where={x:p.x,y:p.y,name:'Переход к '+Regions.name(Regions.parse(destination).x,Regions.parse(destination).y),travel:true};}
  else if(!where&&rec.data?.storySupply)where={...rec.data.storySupply,name:'Сюжетный запас'};
  if(room.level&&destination!==here){const exit=room.level.exits.find(e=>['up','door'].includes(e.kind));if(exit)where={x:exit.x,y:exit.y,name:'Выход к сюжетному маршруту',travel:true};}
  return {
    id: rec.id, name: q.name, kind: q.kind, main: q.main ? 1 : 0, text: q.text, giver: rec.giver, giverName: rec.giver != null ? env.townName(rec.giver) : '',
    goals: q.goals.map((g, i) => ({ text: Q.goalText(g, rec.prog[i], env), done: g.type === 'rep' || g.type === 'any' ? 0 : Q.goalDone(g, rec.prog[i], null) ? 1 : 0, optional: g.optional ? 1 : 0 })),
    reward: q.reward, where,regionKey:destination,regionName:Regions.name(Regions.parse(destination)?.x||0,Regions.parse(destination)?.y||0), at: rec.at,
  };
}
function logOf(room, c = null) {
  const st = stateFor(room.world);
  const member = c && st.campaign[c.character.id];
  return { t: 'quests', active: st.active.map((r) => publicQuest(room, r)), done: st.stats.completed, main: st.main, mainTotal: Q.MAIN.length,
    party:realtime.worldRooms(room.worldId).flatMap(r=>[...r.players.values()].filter(p=>!c||realtime.visibleTo(c,p)).map(p=>({id:p.account.id,name:p.character.name,key:r.key||'ground',region:r.region?.name||r.level?.name||Regions.name(0,0)}))),
    creditMain: member ? member.main : st.main, story: { patriarch: st.story.patriarch, ending: st.story.ending } };
}
function broadcastLog(worldId) {
  const rooms = realtime.worldRooms(worldId);
  if (!rooms.length) return;
  for (const c of worldClients(worldId)) realtime.send(c, logOf(c.room, c));
}
const findActive = (st, id) => st.active.find((r) => r.id === id) || null;

// ---------- Награды ----------
// Выдать награду подключённому герою атомарно (деньги, предметы, рецепт — всё или ничего); опыт, репутация, заклинание — после.
function grant(room, c, reward, name, giver) {
  const ch = c.character, r = reward || {};
  const caps = Math.max(0, Math.round(r.caps || 0));
  let recipe = r.recipe && Crafting.get(r.recipe) && !Crafting.known(ch).has(r.recipe) ? r.recipe : null;
  const extra = r.recipe && !recipe ? 50 : 0; // рецепт уже известен — деньгами
  const st = settlements();
  const err = st.deal(ch, () => st.receive(ch, caps + extra) || (r.items || []).reduce((e, [id, n]) => e || Inv.add(ch, id, n), null) || (recipe ? Crafting.learn(ch, recipe) : null));
  if (err) return err;
  if (r.items && r.items.length || caps || extra || recipe) { require('./inventory').events.emit('changed', c.account.id, ch); }
  if (recipe) { try { realtime.send(c, { t: 'craft', ...require('./crafting').view(ch) }); } catch { /* книга обновится при открытии */ } }
  if (r.xp) combat().grantXp(room, c, Math.round(r.xp));
  if (r.rep && giver != null && !room.level && (room.map.towns || [])[giver]) st.changeRep(room, c, giver, r.rep, `задание «${name}»`);
  for (const [f, d] of Object.entries(r.fac || {})) factions().change(c, f, d, `задание «${name}»`);
  if (r.spell) { const e = magic().learnLive(c, r.spell, 'quest', true); if (e) chat.tell(c, `Заклинание из награды не выучено: ${e}`); }
  combat().persist(c);
  const parts = [caps + extra ? `${caps + extra} крышек` : '', ...(r.items || []).map(([id, n]) => `${(Items.get(id) || {}).name || id}${n > 1 ? ` × ${n}` : ''}`), r.xp ? `${Math.round(r.xp)} опыта` : '', recipe ? `рецепт «${Crafting.get(recipe).name}»` : '', r.spell ? `заклинание «${(Magic.get(r.spell) || {}).name}»` : ''].filter(Boolean);
  chat.tell(c, `Награда за «${name}»: ${parts.join(', ') || 'благодарность'}.`);
  return null;
}
// Ожидающие награды и концовки героя (вне мира в момент завершения или не было места)
function deliverPending(room, c) {
  const st = stateFor(room.world), list = st.pending[c.character.id];
  if (!list || !list.length) return;
  const keep = [];
  for (const p of list) {
    if (p.ending) { markEnding(room, c, p.ending, true); continue; }
    const err = grant(room, c, p.reward, p.name, p.giver);
    if (err) { keep.push(p); chat.tell(c, `Награда за «${p.name}» ждёт: ${err} Освободите место — выдадим при следующем разговоре со старостой или входе.`); }
  }
  if (keep.length) st.pending[c.character.id] = keep; else delete st.pending[c.character.id];
  dirty(room.world);
}

// ---------- Завершение и провал ----------
function finish(room, rec, why) {
  const st = stateFor(room.world), q = rec.def;
  st.active = st.active.filter((r) => r !== rec);
  st.done[rec.id] = Date.now();
  st.stats.completed += 1;
  if (q.main) st.main = Math.max(st.main, Q.MAIN_IDS.indexOf(rec.id) + 1);
  cleanup(room, rec);
  const online = new Map(worldClients(room.worldId).map((c) => [c.character.id, c]));
  for (const c of online.values()) if (!rec.party.includes(c.character.id)) rec.party.push(c.character.id); // кто в мире — тоже участник
  for (const id of rec.party) {
    const m = st.campaign[id] || (st.campaign[id] = { main: 0, joinedAt: Date.now() });
    if (q.main) m.main = Math.max(m.main || 0, Q.MAIN_IDS.indexOf(rec.id) + 1);
  }
  chat.system(room.id, `Задание «${q.name}» выполнено${why ? ` (${why})` : ''}!${q.done ? ' ' + q.done : ''}`);
  for (const id of rec.party) {
    const c = online.get(id);
    const err = c ? grant(c.room, c, q.reward, q.name, rec.giver) : 'нет в мире';
    if (c && rec.giver != null) require('./family').onQuestDone(c.room, c, rec.giver); // симпатия жителей поселения (шаг 17)
    if (err) { (st.pending[id] || (st.pending[id] = [])).push({ reward: q.reward, name: q.name, giver: rec.giver }); if (c) chat.tell(c, `Награда за «${q.name}» ждёт: ${err}`); }
  }
  dirty(room.world);
  save(room.worldId);
  broadcastLog(room.worldId);
}
function fail(room, rec, why) {
  const st = stateFor(room.world);
  st.active = st.active.filter((r) => r !== rec);
  cleanup(room, rec);
  chat.system(room.id, `Задание «${rec.def.name}» провалено: ${why}. Его можно взять снова.`);
  dirty(room.world);
  broadcastLog(room.worldId);
}
// Убрать то, что задание поставило в мир (сопровождаемый житель)
function cleanup(room, rec) {
  const ground = realtime.worldRooms(room.worldId).find(r=>(r.key||'ground')===(rec.data?.regionKey||'ground'))||surfaceOf(room.worldId);
  if (ground && rec.data && rec.data.escort) settlements().removeEscort(ground, rec.data.escort);
  const supply = rec.data && rec.data.storySupply;
  if (ground && supply && supply.gid) {
    const removed = require('./ground').remove(ground.id, supply.gid);
    if (removed) ground.broadcast({ t: 'ground-remove', gid: supply.gid });
  }
  if (ground && rec.data && rec.data.waves) {
    const cs = combat().stateOf(ground);
    for (const id of Object.values(rec.data.waves).flat()) {
      const enemy = cs.enemies.get(id);
      if (enemy && enemy.quest === rec.id) combat().removeEnemy(ground, enemy, false);
    }
  }
}
function ensureStorySupply(room, rec, now = Date.now()) {
  if (!rec.def.main || room.level || rec.data?.regionKey && rec.data.regionKey!==(room.key||'ground')) return;
  const goal = rec.def.goals.find((g) => g.type === 'fetch');
  if (!goal) return;
  const db = require('./ground');
  const data = rec.data || (rec.data = {});
  let supply = data.storySupply;
  if (!supply) {
    const town = (room.map.towns || [])[rec.giver] || room.map.spawn;
    const candidates = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];
    const pos = candidates.map(([dx, dy]) => ({ x: town.x + dx + 0.5, y: town.y + dy + 0.5 })).find((p) => !M.validatePosition(room.map, p)) || { x: town.x + 0.5, y: town.y + 0.5 };
    supply = data.storySupply = { item: goal.item, n: goal.n, x: pos.x, y: pos.y, gid: null, respawnAt: 0 };
  }
  if (supply.gid && db.find(room.id, supply.gid)) return;
  if (supply.gid) {
    supply.gid = null;
    if (!supply.respawnAt) supply.respawnAt = now + Math.max(0, Number(G().questItemRespawnSec) || 0) * 1000;
  }
  if (now < (supply.respawnAt || 0) || db.list(room.id).length >= G().groundItemsMax) return;
  const item = db.add(room.id, { id: supply.item, n: supply.n }, { x: supply.x, y: supply.y }, 'Сюжетный запас', { permanent: true });
  if (!item) return;
  supply.gid = item.gid;
  supply.respawnAt = 0;
  room.broadcast({ t: 'ground-add', item });
  dirty(room.world);
}
function check(room, rec) {
  if (!findActive(stateFor(room.world), rec.id)) return;
  if (rec.def.goals.some((g) => g.type === 'fetch' || g.type === 'deliver')) return; // сдача — у старосты
  const ok = Q.complete(rec.def, rec.prog, null) || worldClients(room.worldId).some((c) => Q.complete(rec.def, rec.prog, c.character));
  if (ok) finish(room, rec);
}

// ---------- События ----------
const real = (room) => Boolean(room && room.world && ID_RE.test(room.world.id)); // проверочные комнаты без мира — без заданий
function event(room, ev, who) {
  if (!on() || !real(room)) return;
  const st = stateFor(room.world);
  for (const rec of [...st.active]) {
    if(rec.data?.regionKey&&rec.data.regionKey!==(room.region?.key||room.level?.regionKey||'ground'))continue;
    if (!Q.advance(rec.def, rec.prog, ev)) continue;
    for (const c of who || []) if (!rec.party.includes(c.character.id)) rec.party.push(c.character.id);
    dirty(room.world);
    broadcastLog(room.worldId);
    check(room, rec);
  }
}
function onKill(room, e, share) {
  if (!on()) return;
  event(room, { type: 'kill', def: e.def }, share);
  // Железный Патриарх убит — концовка (бой)
  if (e.def.id === 'boss_super' && real(room)) {
    const st = stateFor(room.world);
    const killer = share.find((c) => e.hitBy && e.hitBy.has(c.account.id)) || share[0];
    if (st.story.patriarch === 'alive' && killer) {
      st.story.patriarch = 'dead';
      ending(room, Q.endingFor('kill', killer.character), killer);
    }
  }
}
const onTame = (room, c, def) => event(room, { type: 'tame', def }, [c]);
function onCraft(room, c, items) { for (const it of items || []) event(room, { type: 'craft', item: it.id, n: it.n }, [c]); }
function onRaid(room, sid, ok, defenders) {
  if (!on() || !real(room)) return;
  const who = (defenders || []).map((id) => room.players.get(id)).filter(Boolean);
  event(room, { type: 'defend', town: sid, ok }, who);
  if (!ok) for (const rec of [...stateFor(room.world).active]) if (rec.def.goals.some((g) => g.type === 'defend' && g.town === sid)) fail(room, rec, 'поселение разорено');
}
function onExplore(room, c) {
  if (!room.level || !real(room)) return;
  event(room, { type: 'explore', level: room.level.type, depth: room.level.n }, [c]);
}

// ---------- Сюжетные главари ----------
function bossSpot(room, from) {
  const rnd = combat().random, d = G().questBossDist;
  for (let t = 0; t < 60; t++) {
    const a = rnd() * Math.PI * 2, r = d * (0.7 + rnd() * 0.6);
    const x = Math.floor(from.x + Math.cos(a) * r), y = Math.floor(from.y + Math.sin(a) * r);
    if (x < 2 || y < 2 || x >= room.map.width - 2 || y >= room.map.height - 2) continue;
    if (!WorldGen.isWalkable(room.map, x, y) || S.at(room.map, x, y)) continue;
    return { x: x + 0.5, y: y + 0.5 };
  }
  return null;
}
function spawnBoss(room, rec, defId) {
  const def = Enemies.get(defId);
  if (!def || room.level || rec.data?.regionKey && rec.data.regionKey!==(room.key||'ground')) return null;
  rec.data = rec.data || {};
  let where = rec.data.where;
  if (!where) {
    const t = (room.map.towns || [])[rec.giver] || room.map.spawn || { x: room.map.width / 2, y: room.map.height / 2 };
    where = bossSpot(room, t);
    if (!where) return null;
    rec.data.where = { x: Math.floor(where.x), y: Math.floor(where.y), boss: defId, name: def.name };
  }
  const made = combat().spawnGroup(room, { x: rec.data.where.x + 0.5, y: rec.data.where.y + 0.5 }, def, 1, null, 0, 3);
  if (!made.length) return null;
  made[0].quest = rec.id;
  rec.data.bossId = made[0].id;
  dirty(room.world);
  return made[0];
}
// Главарь пропал (мир выгружался, враг ушёл) — вернуть, когда кто-то рядом с меткой
function keepBosses(room) {
  const st = stateFor(room.world), cs = combat().stateOf(room);
  for (const rec of st.active) {
    if(rec.data?.regionKey&&rec.data.regionKey!==(room.key||'ground'))continue;
    ensureFactionWaves(room, rec);
    const w = rec.data && rec.data.where;
    if (!w || !w.boss) continue;
    const idx = rec.def.goals.findIndex((g) => JSON.stringify(g).includes(`"enemy":"${w.boss}"`));
    if (idx >= 0 && Q.goalDone(rec.def.goals[idx], rec.prog[idx], null)) continue;
    if (w.boss === 'boss_super' && st.story.patriarch !== 'alive') continue;
    const alive = rec.data.bossId && cs.enemies.get(rec.data.bossId);
    if (alive && !alive.dead) continue;
    if ([...room.players.values()].some((c) => Math.hypot(c.pos.x - w.x, c.pos.y - w.y) <= 40)) spawnBoss(room, rec, w.boss);
  }
}
function ensureFactionWaves(room, rec) {
  if (!rec.def.main || room.level || rec.data?.regionKey&&rec.data.regionKey!==(room.key||'ground')) return;
  const progress = rec.prog || [], targets = [];
  const collect = (goal, value) => {
    if (goal.type === 'any') {
      const values = value || [];
      const repDone = goal.of.some((sub, i) => sub.type === 'rep' && [...room.players.values()].some((c) => Q.goalDone(sub, values[i], c.character)));
      if (!repDone) goal.of.forEach((sub, i) => collect(sub, values[i] || 0));
    } else if (goal.type === 'kill' && goal.faction) targets.push({ goal, current: Number(value) || 0 });
  };
  rec.def.goals.forEach((goal, i) => collect(goal, progress[i]));
  if (!targets.length) return;
  const cs = combat().stateOf(room), rnd = combat().random;
  rec.data = rec.data || {}; rec.data.waves = rec.data.waves || {};
  for (const { goal, current } of targets) {
    const id = goal.faction, def = F.FACTIONS[id];
    const members = def && def.members.map((eid) => Enemies.get(eid)).filter((e) => e && !e.boss);
    const chosen = members && members[0];
    if (!chosen) continue;
    const wave = rec.data.waves[id] || (rec.data.waves[id] = []);
    const alive = wave.filter((eid) => { const e = cs.enemies.get(eid); return e && !e.dead; });
    rec.data.waves[id] = alive;
    const want = Math.max(0, Math.min(12, (goal.n || 1) - current - alive.length));
    if (!want) continue;
    const town = (room.map.towns || [])[rec.giver] || room.map.spawn;
    const target = [...room.players.values()].find((c) => !combat().cbOf(c).dead && rec.party.includes(c.character.id));
    const made = combat().spawnGroup(room, { x: town.x + 0.5, y: town.y + 0.5 }, chosen, want, target && target.account.id, 5, 10);
    for (const e of made) { e.quest = rec.id; wave.push(e.id); }
    if (made.length) dirty(room.world);
  }
}

// ---------- Старосты ----------
function boardFor(room, sid) {
  const t = (room.map.towns || [])[sid];
  const towns = (room.map.towns || []).map((x) => ({ id: x.id, name: townName(room, x.id), x: x.x, y: x.y, kind: x.kind }));
  const ents = Levels.entrances(room.map).filter((e) => e.dir < 0 && !e.disabled).map((e) => ({ type: e.type, depth: e.depth, name: Levels.TYPES[e.type].name }));
  const seen = new Set(), uniq = ents.filter((e) => (seen.has(e.type) ? false : seen.add(e.type)));
  const recipes = Crafting.RECIPES.filter((r) => !r.start && r.out).map((r) => r.id);
  const town = { id: sid, name: townName(room, sid), x: t.x, y: t.y, kind: t.kind };
  const env = { items: Items.get, enemies: Enemies.get, towns, entrances: uniq, recipes };
  return Q.board(room.map.seed, town, Q.epochOf(Date.now()), env).concat(Q.sideBoard(room.map.seed, town, env, Object.keys(stateFor(room.world).done))).map(q=>room.region?{...q,id:room.region.key+':'+q.id}:q);
}
// Что староста показывает: сюжет, доска, взятые у него, что можно сдать
function offersFor(room, c, n) {
  const st = stateFor(room.world), ch = c.character, env = envFor(room);
  const out = [];
  const nextMain = Q.MAIN[st.main];
  if (nextMain && !findActive(st, nextMain.id)) out.push({ id: nextMain.id, name: nextMain.name, kind: nextMain.kind, main: 1, text: nextMain.text, reward: nextMain.reward, goals: nextMain.goals.map((g) => Q.goalText(g, null, env)), state: 'offer' });
  for (const q of boardFor(room, n.sid)) {
    if (st.done[q.id]) continue;
    const act = findActive(st, q.id);
    out.push({ id: q.id, name: q.name, kind: q.kind, text: q.text, reward: q.reward, goals: q.goals.map((g) => Q.goalText(g, act ? act.prog[0] : null, env)), state: act ? 'active' : 'offer' });
  }
  for (const rec of st.active) {
    const g0 = rec.def.goals[0];
    if((rec.giverKey||'ground')!==(room.key||'ground'))continue;
    const here = (g0.type === 'fetch' && rec.giver === n.sid) || (g0.type === 'deliver' && g0.to === n.sid);
    if (!here) continue;
    const have = g0.type === 'fetch' ? Inv.count(ch, g0.item) : Inv.count(ch, 'quest_parcel');
    const row = out.find((o) => o.id === rec.id) || (out.push({ id: rec.id, name: rec.def.name, kind: rec.def.kind, text: rec.def.text, reward: rec.def.reward, goals: rec.def.goals.map((g, i) => Q.goalText(g, rec.prog[i], env)) }), out[out.length - 1]);
    row.state = 'turnin'; row.ready = have >= (g0.type === 'fetch' ? g0.n : 1) ? 1 : 0;
  }
  return out;
}
function sendOffers(room, c, n, say) {
  realtime.send(c, { t: 'npc-offer', id: n.id, what: 'quests', quests: offersFor(room, c, n), money: settlements().wallet(c.character), active: stateFor(room.world).active.length, max: G().questMaxActive, ...(say ? { say } : {}) });
}
// Взять задание
function accept(room, c, n, qid) {
  const st = stateFor(room.world), g = G();
  if (findActive(st, qid)) return 'Это задание уже взято.';
  if (st.active.length >= g.questMaxActive) return `Взято слишком много заданий (${g.questMaxActive}) — выполните или откажитесь от какого-нибудь (журнал — F2).`;
  let def = null;
  const main = Q.get(qid);
  if (main) { if (Q.MAIN[st.main] !== main) return 'Это сюжетное задание сейчас недоступно.'; def = main; }
  else { def = boardFor(room, n.sid).find((q) => q.id === qid); if (!def || st.done[qid]) return 'Такого задания у старосты нет.'; }
  const rec = { id: qid, def: JSON.parse(JSON.stringify(def)), giver: n.sid, at: Date.now(), prog: Q.freshProgress(def), party: worldClients(room.worldId).map((x) => x.character.id), data: {} };
  rec.data.regionKey=def.main?Regions.route(Q.MAIN_IDS.indexOf(def.id)).key:(room.key||'ground');
  rec.giverKey=rec.data.regionKey;
  if(def.main&&rec.data.regionKey!==(room.key||'ground'))rec.giver=0;
  if (!rec.party.includes(c.character.id)) rec.party.push(c.character.id);
  // Подготовка по видам целей
  for (const goal of def.goals) {
    if (goal.type === 'deliver') {
      const s = settlements(), ch = c.character;
      const err = s.deal(ch, () => Inv.add(ch, goal.item, 1));
      if (err) return `Некуда взять посылку: ${err}`;
      require('./inventory').events.emit('changed', c.account.id, ch);
    }
    if (goal.type === 'defend') {
      const r = settlements().startRaid(room, goal.town, {});
      if (!r) return 'Набег сейчас не начать (уже идёт или некуда поставить налётчиков).';
    }
    if (goal.type === 'escort') {
      const id = settlements().spawnEscort(room, n, c, rec.id, goal.to);
      if (!id) return 'Житель не может выйти — попробуйте позже.';
      rec.data.escort = id;
    }
  }
  st.active.push(rec);
  ensureFactionWaves(room, rec);
  ensureStorySupply(room, rec);
  for (const goal of def.goals) {
    const kill = goal.type === 'any' ? goal.of.find((x) => x.spawn) : goal.spawn ? goal : null;
    if (kill && !(kill.enemy === 'boss_super' && st.story.patriarch !== 'alive')) spawnBoss(room, rec, kill.enemy);
  }
  dirty(room.world);
  chat.system(room.id, `${c.character.name} берёт задание «${def.name}»${def.main ? ' (сюжет)' : ''}.`);
  broadcastLog(room.worldId);
  check(room, rec); // цель «репутация» могла быть уже выполнена
  return null;
}
// Сдать (принести, доставить)
function turnIn(room, c, n, qid) {
  const st = stateFor(room.world), rec = findActive(st, qid);
  if (!rec) return 'Задание не взято.';
  if((rec.giverKey||'ground')!==(room.key||'ground'))return 'Задание нужно сдать в другом регионе — направление есть в журнале F2.';
  const g = rec.def.goals[0], ch = c.character, s = settlements();
  if (g.type === 'fetch') {
    if (rec.giver !== n.sid) return 'Сдавать нужно старосте, давшему задание.';
    const err = s.deal(ch, () => (Inv.count(ch, g.item) < g.n ? `Нужно ${g.n} × ${Items.get(g.item).name}, у вас ${Inv.count(ch, g.item)}.` : Inv.takeById(ch, g.item, g.n) && null));
    if (err) return err;
    rec.prog[0] = g.n;
  } else if (g.type === 'deliver') {
    if (g.to !== n.sid) return 'Посылка — для другого поселения.';
    const err = s.deal(ch, () => (Inv.count(ch, 'quest_parcel') < 1 ? 'Посылки у вас нет (её мог нести другой участник группы).' : Inv.takeById(ch, 'quest_parcel', 1) && null));
    if (err) return err;
    Q.advance(rec.def, rec.prog, { type: 'deliver', to: n.sid });
  } else return 'Это задание не сдаётся старосте — оно засчитается само.';
  require('./inventory').events.emit('changed', c.account.id, ch);
  if (!rec.party.includes(ch.id)) rec.party.push(ch.id);
  finish(room, rec, `сдал ${ch.name}`);
  return null;
}
// Отказаться
function abandon(room, c, qid) {
  const st = stateFor(room.world), rec = findActive(st, qid);
  if (!rec) return 'Задание не взято.';
  if (rec.def.main) return 'От сюжетного задания отказаться нельзя.';
  fail(room, rec, `отказ (${c.character.name})`);
  return null;
}
// Действие старосты (settlements: npc { a: 'quest', id, take?, turnin? })
function giverAct(room, c, n, m) {
  if (!on()) return 'Задания отключены на сервере.';
  deliverPending(room, c);
  let err = null, say = null;
  if (m.take) { err = accept(room, c, n, String(m.take)); if (!err) say = `${n.name}: «Договорились. Удачи!»`; }
  else if (m.turnin) { err = turnIn(room, c, n, String(m.turnin)); if (!err) say = `${n.name}: «Спасибо, выручил!»`; }
  if (err) return err;
  sendOffers(room, c, n, say);
  return null;
}

// ---------- Сопровождение (житель — в server/settlements.js, шаг сюда) ----------
function escortArrived(room, n) {
  const st = stateFor(room.world), rec = findActive(st, n.escort.qid);
  if (!rec) return;
  const who = room.players.get(n.escort.follow);
  event(room, { type: 'escort', to: n.escort.to }, who ? [who] : []);
}
function escortLost(room, n) {
  const rec = findActive(stateFor(room.world), n.escort.qid);
  if (rec) { rec.data.escort = null; fail(room, rec, `${n.name} погиб в пути`); }
}

// ---------- Патриарх: разговор и концовки ----------
function patriarchNear(room, c) {
  if (room.level) return null;
  for (const e of combat().stateOf(room).enemies.values()) if (!e.dead && e.def.id === 'boss_super' && Math.hypot(e.x - c.pos.x, e.y - c.pos.y) <= 4 + (e.def.radius || 0.5)) return e;
  return null;
}
function parley(room, c) {
  const e = patriarchNear(room, c);
  if (!e) return 'Рядом нет Железного Патриарха.';
  const flags = Q.parleyFlags(c.character);
  if (!flags.talk || (e.angry && e.angry.has(c.account.id))) return 'Патриарх не станет с вами говорить — он видит в вас врага.';
  realtime.send(c, { t: 'npc-talk', src: 'quest', npc: { id: e.id, name: e.def.name, role: 'patriarch' }, dlg: 'patriarch', flags });
  return null;
}
function dlgAct(room, c, m) {
  const e = patriarchNear(room, c);
  if (!e) return 'Рядом нет Железного Патриарха.';
  const act = String(m.act || '');
  if (!Q.DLG_ACTIONS.includes(act)) return 'Неизвестный ответ.';
  if (act === 'fight') {
    const ch = c.character;
    if (F.repOf(ch, 'patriarch') > -60) { F.set(ch, 'patriarch', -60); factions().sendFac(c); combat().markDirty(c); }
    for (const o of combat().stateOf(room).enemies.values()) if (!o.dead && (o === e || Math.hypot(o.x - e.x, o.y - e.y) <= 8)) (o.angry || (o.angry = new Set())).add(c.account.id);
    require('./ai').engage(combat().aiCtx(room, Date.now()), e, { id: c.account.id, x: c.pos.x, y: c.pos.y });
    chat.system(room.id, `${c.character.name} бросает вызов Железному Патриарху!`);
    return null;
  }
  const id = Q.endingFor(act, c.character);
  if (!id) return 'Патриарх не согласится — не хватает репутации (журнал — F2).';
  const st = stateFor(room.world);
  if (st.story.patriarch !== 'alive') return 'История Патриарха уже завершена.';
  st.story.patriarch = act === 'family' ? 'family' : 'peace';
  // Патриарх и свита уходят мирно
  for (const o of [...combat().stateOf(room).enemies.values()]) if (!o.dead && (o === e || (Math.hypot(o.x - e.x, o.y - e.y) <= 8 && F.ofEnemy(o.def) === 'cyborgs'))) combat().removeEnemy(room, o, false);
  if (act === 'family') hooks.familyJoin(c, 'boss_super');
  ending(room, id, c);
  return null;
}
// Концовка: отметить у всех участников (markEnding), экран финала, сюжетное задание выполнено, игра продолжается
function ending(room, id, decider, opts = {}) {
  if (!room.world) return null;
  const st = stateFor(room.world);
  st.story.ending = id; st.story.at = Date.now(); st.story.by = decider ? decider.character.name : null;
  const rec = findActive(st, 'm6_patriarch');
  if (rec) { Q.advance(rec.def, rec.prog, { type: 'finale' }); }
  const online = worldClients(room.worldId);
  const party = new Set([...(rec ? rec.party : []), ...Object.keys(st.campaign), ...online.map((c) => c.character.id)]);
  for (const chId of party) {
    const m = st.campaign[chId] || (st.campaign[chId] = { main: 0, joinedAt: Date.now() });
    m.main = Math.max(m.main || 0, st.main);
    m.ending = id;
  }
  for (const c of online) markEnding(c.room, c, id);
  if (!opts.admin) for (const chId of party) if (!online.some((c) => c.character.id === chId)) (st.pending[chId] || (st.pending[chId] = [])).push({ ending: id });
  const e = Q.ENDINGS[id];
  chat.system(room.id, `🏁 Концовка: «${e ? e.name : id}»${decider ? ` — выбор ${decider.character.name}` : ''}. Игра продолжается; «Новая игра+» открыта при создании мира.`);
  if (rec) finish(room, rec, e ? e.name : id);
  dirty(room.world);
  save(room.worldId);
  broadcastLog(room.worldId);
  return id;
}
function summaryOf(room, c) {
  const st = stateFor(room.world), ch = c.character;
  return {
    level: ch.level || 1, deaths: ch.deaths || 0, quests: st.stats.completed, main: Math.min(st.main, Q.MAIN.length), mainTotal: Q.MAIN.length,
    factions: factions().publicReps(ch), endings: (ch.endings || []).map((x) => x.id), world: room.world.name,
  };
}
// Сброс кампании вызывается из лобби до входа в мир. Кампания общая на мир,
// поэтому сбрасываем сюжет для всех его участников, сохраняя побочные задания и героев.
function resetCampaign(account, worldId) {
  const w = worlds.get(account, worldId);
  if (!worlds.isOwner(account, w)) throw new auth.HttpError(403, 'Начать сюжет заново может только владелец мира.');
  if (worldClients(w.id).length) throw new auth.HttpError(409, 'Перед сбросом все игроки должны выйти из мира.');
  const st = stateFor(w), room = surfaceOf(w.id);
  for (const rec of st.active) if (rec.def.main && room) cleanup(room, rec);
  st.active = st.active.filter((rec) => !rec.def.main);
  let cleared = 0;
  for (const id of Q.MAIN_IDS) {
    if (st.done[id]) { delete st.done[id]; cleared++; }
  }
  st.stats.completed = Math.max(0, st.stats.completed - cleared);
  st.main = 0;
  st.story = { patriarch: 'alive', ending: null };
  for (const [characterId, progress] of Object.entries(st.campaign)) {
    st.campaign[characterId] = { ...progress, main: 0 };
    delete st.campaign[characterId].ending;
  }
  for (const [characterId, pending] of Object.entries(st.pending)) {
    const kept = pending.filter((item) => !item.ending);
    if (kept.length) st.pending[characterId] = kept; else delete st.pending[characterId];
  }
  dirty(w);
  save(w.id);
  broadcastLog(w.id);
  return { ok: true, main: 0, mainTotal: Q.MAIN.length };
}
function markEnding(room, c, id, late = false) {
  const fresh = ngplus.markEnding(c.character, id);
  combat().persist(c);
  const e = Q.ENDINGS[id] || { name: id, text: 'Особая концовка, отмеченная администратором.' };
  realtime.send(c, { t: 'ending', id, name: e.name, text: e.text, fresh: fresh ? 1 : 0, late: late ? 1 : 0, summary: summaryOf(room, c) });
  return fresh;
}

// ---------- Подключение ----------
function tick(room, dt, now) {
  if (!on() || !real(room)) return;
  room.qNext = room.qNext || 0;
  if (now < room.qNext) return;
  room.qNext = now + 2000;
  const st = stateFor(room.world);
  if (!room.level) keepBosses(room);
  if (!room.level) for (const rec of st.active) ensureStorySupply(room, rec, now);
  for (const rec of [...st.active]) if (rec.def.goals.some((g) => g.type === 'rep' || g.type === 'any')) check(room, rec);
  if (st.dirty && now - st.savedAt > 10000) save(room.worldId);
}
function safely(c, fn) {
  let err;
  try { err = fn(); } catch (e) { err = e.message || String(e); }
  if (err) realtime.send(c, { t: 'quest-reject', message: err });
  return err;
}
realtime.use({
  welcome: (room, c) => (real(room) ? { quests: logOf(room, c) } : {}),
  onJoin: (room, c) => {
    if (!on() || !real(room)) return;
    const st = stateFor(room.world);
    const prior = st.campaign[c.character.id];
    const lateMain = Math.max(0, Math.min(st.main, Q.MAIN.length));
    st.campaign[c.character.id] = { ...(prior || {}), main: Math.max(prior && prior.main || 0, lateMain), joinedAt: prior && prior.joinedAt || Date.now() };
    if (!prior && lateMain > 0) {
      const titles = Q.MAIN.slice(0, lateMain).map((q) => q.name).join(' → ');
      chat.tell(c, `Кооперативная история мира уже прошла ${lateMain} глав${lateMain === 1 ? 'у' : lateMain < 5 ? 'ы' : ''}. Засчитано до вашего прибытия: ${titles}. Продолжайте с группой; старые награды повторно не выдаются.`);
    }
    if (st.story.ending && st.campaign[c.character.id].ending !== st.story.ending) {
      st.campaign[c.character.id].ending = st.story.ending;
      markEnding(room, c, st.story.ending, true);
    }
    for (const rec of st.active) if (!rec.party.includes(c.character.id)) { rec.party.push(c.character.id); dirty(room.world); }
    dirty(room.world);
    deliverPending(room, c);
    onExplore(room, c);
    broadcastLog(room.worldId);
  },
  onLeave:(room)=>broadcastLog(room.worldId),
  tick,
  onSaveWorld: (room) => save(room.worldId),
  onDestroy: (room) => {
    if (!worldsState.has(room.worldId) || room.removed) return;
    save(room.worldId);
    if (!realtime.worldRooms(room.worldId).some((r) => r !== room)) worldsState.delete(room.worldId);
  },
  handlers: {
    quest: (c, m) => safely(c, () => {
      const msg = m && typeof m === 'object' ? m : {}, room = c.room;
      if (!room || !on()) return 'Задания отключены.';
      if (combat().cbOf(c).dead) return 'Вы погибли.';
      switch (msg.a) {
        case 'log': realtime.send(c, logOf(room)); return null;
        case 'abandon': return abandon(room, c, String(msg.id || ''));
        case 'parley': return parley(room, c);
        case 'dlg': return dlgAct(room, c, msg);
        default: return 'Неизвестное действие.';
      }
    }),
  },
});

// ---------- Администратор ----------
function worldOf(body, admin) {
  if (body.worldId) return worlds.load(String(body.worldId));
  const c = require('./admin').selfClient(admin);
  if (!c || !c.room) throw new auth.HttpError(400, 'Укажите мир (worldId) или войдите в мир.');
  return c.room.world;
}
function adminList(admin, body = {}) {
  const w = worldOf(body, admin), st = stateFor(w);
  const room = realtime.worldRooms(w.id)[0] || null;
  return {
    worldId: w.id, world: w.name, main: st.main, mainTotal: Q.MAIN.length, story: st.story, completed: st.stats.completed,
    active: st.active.map((r) => (room ? publicQuest(room, r) : { id: r.id, name: r.def.name, kind: r.def.kind, main: r.def.main ? 1 : 0, goals: [] })).map((p, i) => ({ ...p, party: st.active[i].party.length })),
    mainQuests: Q.MAIN.map((q, i) => ({ id: q.id, name: q.name, state: i < st.main ? 'done' : findActive(st, q.id) ? 'active' : i === st.main ? 'next' : 'locked' })),
    endings: Object.entries(Q.ENDINGS).map(([id, e]) => ({ id, name: e.name })), factions: F.IDS.map((f) => ({ id: f, name: F.FACTIONS[f].name, locked: F.FACTIONS[f].locked ? 1 : 0 })),
    pending: Object.keys(st.pending).length,
  };
}
// act: grant { id } — выдать (сюжетное — сделать текущим и взять); complete { id }; reset { id | 'all' }; ending { username, character?, ending }; faction { username, character?, faction, value }
function adminAct(admin, body = {}) {
  if (body.act === 'faction') return factions().adminSet(admin, body);
  const w = worldOf(body, admin), st = stateFor(w);
  const room = surfaceOf(w.id);
  const id = String(body.id || '');
  let out;
  switch (body.act) {
    case 'grant': {
      if (!room || !room.players.size) throw new auth.HttpError(409, 'В мире нет игроков на поверхности.');
      const q = Q.get(id);
      if (!q) throw new auth.HttpError(404, 'Выдавать можно сюжетные задания: ' + Q.MAIN_IDS.join(', ') + '.');
      if (findActive(st, id)) throw new auth.HttpError(409, 'Задание уже взято.');
      st.main = Q.MAIN_IDS.indexOf(id);
      if (q.goals.some((g) => g.type === 'finale') && st.story.patriarch !== 'alive') st.story = { patriarch: 'alive', ending: null };
      const c = [...room.players.values()][0];
      const t = (room.map.towns || []).reduce((b, x) => (!b || Math.hypot(x.x - c.pos.x, x.y - c.pos.y) < Math.hypot(b.x - c.pos.x, b.y - c.pos.y) ? x : b), null);
      const err = accept(room, c, { sid: t ? t.id : 0, name: 'Администратор' }, id);
      if (err) throw new auth.HttpError(409, err);
      out = { granted: id };
      break;
    }
    case 'complete': {
      const rec = findActive(st, id);
      if (!rec) throw new auth.HttpError(404, 'Задание не взято.');
      if (!room) throw new auth.HttpError(409, 'Мир не загружен.');
      finish(room, rec, 'администратор');
      out = { completed: id };
      break;
    }
    case 'reset': {
      if (id === 'all') {
        for (const rec of st.active) if (room) cleanup(room, rec);
        st.active = []; st.done = {}; st.main = 0; st.story = { patriarch: 'alive', ending: null }; st.stats = { completed: 0 }; st.campaign = {};
      } else {
        const rec = findActive(st, id);
        if (rec) { if (room) cleanup(room, rec); st.active = st.active.filter((r) => r !== rec); }
        delete st.done[id];
        if (Q.get(id)) st.main = Math.min(st.main, Q.MAIN_IDS.indexOf(id));
      }
      out = { reset: id };
      break;
    }
    case 'ending': {
      const { acc, ch } = require('./inventory').resolveTarget(body.username, body.character);
      const c = realtime.byAccount.get(acc.id);
      const eid = String(body.ending || 'test');
      if (c && c.room && c.character.id === ch.id) {
        if (c.room.world && c.room.world.id === w.id) ending(c.room, eid, null, { admin: true });
        else markEnding(c.room, c, eid);
      } else characters.update(acc, ch.id, (x) => { ngplus.markEnding(x, eid); });
      out = { ending: eid, character: ch.name };
      break;
    }
    default: throw new auth.HttpError(400, 'Действие: grant, complete, reset, ending или faction.');
  }
  auth.logAdmin(admin, 'quests', { worldId: w.id, act: body.act, id: id || undefined, ending: body.ending || undefined });
  dirty(w);
  save(w.id);
  broadcastLog(w.id);
  return out;
}

module.exports = {
  hooks, stateFor, save, onKill, onTame, onCraft, onRaid, onExplore, giverAct, sendOffers, offersFor, accept, turnIn, abandon,
  escortArrived, escortLost, parley, dlgAct, ending, markEnding, adminList, adminAct, logOf, boardFor, resetCampaign,
};
