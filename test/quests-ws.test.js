'use strict';
// Шаг 16 по WebSocket: фракции (враждебность по репутации, репутация за убийства, ГМ), задания старосты (сбор, доставка,
// защита, сопровождение), общий прогресс группы и награды каждому (ушедшему — при входе), сюжетная цепочка (главарь, дружба
// с бандой), финал: разговор с Патриархом → концовка, бой → концовка, markEnding и «Новая игра+», сохранение, панель ГМ.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');
const G = require('../shared/worldgen');
const Mv = require('../shared/movement');
const Q = require('../shared/quests');
const F = require('../shared/factions');
const Items = require('../shared/items');
const Enemies = require('../shared/enemies');
const Levels = require('../shared/levels');
const Crafting = require('../shared/crafting');
require('../shared/settlements');

const SEED = 'quest-1';
const params = (o = {}) => ({ name: 'Задания', seed: SEED, size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false, ...o });
const set = (o) => Object.entries({
  survivalFoodPerMin: 0, survivalWaterPerMin: 0, survivalRestPerMin: 0, chatRateCount: 500, stunChance: 0, depotsPer256: 0, respawnSec: 0, questBoardRefreshMin: 1e9, questBossDist: 14, ...o,
}).flatMap(([k, v]) => ['--set', `game.${k}=${v}`]);
const say = (c, text) => c.send({ t: 'chat', text });
const money = (inv) => inv.cells.filter((x) => x && x.id === 'caps').reduce((a, x) => a + x.n, 0) + 100 * inv.cells.filter((x) => x && x.id === 'gold_nugget').reduce((a, x) => a + x.n, 0);
const chatHas = (c, re, ms = 4000) => c.next((m) => m.t === 'chat' && re.test(JSON.stringify(m)), ms);

// Ближайшая к (x, y) проходимая точка — по кольцам вокруг
function nearWalkable(map, x, y) {
  for (let r = 0; r < 20; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const p = { x: x + dx, y: y + dy };
    if (!Mv.validatePosition(map, p)) return p;
  }
  throw new Error(`нет проходимой точки у ${x},${y}`);
}

test('WS задания и фракции: враждебность, доска старосты, группа, сюжет, концовки, НИ+, сохранение, ГМ', async (t) => {
  let stage = 'начало';
  process.on('exit', (code) => { if (code) console.error('этап:', stage, JSON.stringify((globalThis.__QA || { messages: [] }).messages.filter((m) => /quest|npc-|reject|chat/.test(m.t)).slice(-6).map((m) => JSON.stringify(m).slice(0, 300)))); });
  const s = await startServer(set({}));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const bob = await newPlayer(b, 'bob', 'Боб');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  const code = (await api(b, 'POST', `/api/worlds/${w.id}/share`, { invite: 'new', open: true }, admin.token)).data.world.inviteCode;
  assert.equal((await api(b, 'POST', '/api/worlds/join', { code }, bob.token)).status, 200);
  G.configure({ depotsPer256: 0 });
  const map = G.generate({ ...w }); // как клиент: по записи мира (форма карты, водоёмы)
  assert.equal(G.mapHash(map), w.mapHash);
  const A = await joinWorld(b, admin, w.id);
  globalThis.__QA = A;
  let B = await joinWorld(b, bob, w.id);
  assert.ok(A.welcome.quests && A.welcome.quests.main === 0 && A.welcome.fac.raiders === F.FACTIONS.raiders.start);
  const tp = async (x, y, who = 'admin') => { const r = await api(b, 'POST', '/api/admin/teleport', { username: who, x, y }, admin.token); assert.equal(r.status, 200, `tp ${x},${y} ${who}: ` + JSON.stringify(r.data)); await sleep(150); };
  const give = async (item, count, who = 'admin') => { const r = await api(b, 'POST', '/api/admin/items/give', { username: who, item, count }, admin.token); assert.equal(r.status, 200, JSON.stringify(r.data)); };
  const qact = (body) => api(b, 'POST', '/api/admin/quests/act', { worldId: w.id, ...body }, admin.token);
  const setFac = async (faction, value, who = 'admin') => { const r = await qact({ act: 'faction', username: who, faction, value }); assert.equal(r.status, 200, JSON.stringify(r.data)); };
  const lastInv = async (c) => (await c.next((m) => m.t === 'inv', 4000)).inventory;
  const quester = (town) => town.npcs.find((n) => n.role === 'quest');
  // доска старосты — тот же расчёт, что на сервере (эпоха 0: доска не обновляется)
  const ents = Levels.entrances(map).filter((e) => e.dir < 0 && !e.disabled).map((e) => ({ type: e.type, depth: e.depth, name: Levels.TYPES[e.type].name }));
  const seenT = new Set(), uniq = ents.filter((e) => (seenT.has(e.type) ? false : seenT.add(e.type)));
  const towns = map.towns.map((x) => ({ id: x.id, name: map.settlements[x.id].name, x: x.x, y: x.y, kind: x.kind }));
  const boardOf = (town) => Q.board(map.seed, towns[town.id], 0, { items: Items.get, enemies: Enemies.get, towns, entrances: uniq, recipes: Crafting.RECIPES.filter((r) => !r.start && r.out).map((r) => r.id) });
  const withKind = (kind) => { for (const t of map.towns) { const q = boardOf(t).find((x) => x.kind === kind); if (q) return { town: t, q }; } return null; };
  async function talkQuest(c, town, extra = {}) {
    const n = quester(town);
    c.drain();
    c.send({ t: 'npc', a: 'quest', id: n.id, ...extra });
    return c.next((m) => (m.t === 'npc-offer' && m.what === 'quests') || m.t === 'npc-reject', 4000);
  }
  async function goQuester(town) {
    const n = quester(town);
    await tp(n.x, n.y);
    await A.next((m) => m.t === 'npc-add' && m.npc.id === n.id, 4000).catch(() => null);
  }

  stage = 'враждебность по репутации';
  await tp(map.spawn.x + 0.5, map.spawn.y + 0.5);
  await tp(map.spawn.x + 20.5, map.spawn.y + 0.5).catch(async () => tp(map.spawn.x + 0.5, map.spawn.y + 20.5));
  await setFac('raiders', 0);
  const fac0 = await A.next((m) => m.t === 'fac', 4000);
  assert.equal(fac0.reps.raiders, 0);
  assert.equal((await api(b, 'POST', '/api/admin/spawn', { kind: 'enemy', id: 'raider_thug', count: 1 }, admin.token)).status, 200);
  A.drain();
  await sleep(2500);
  assert.ok(!A.messages.some((m) => m.t === 'fx' && m.ev.some((e) => e.k === 'hit' && e.t === 'p' && e.id === A.welcome.you)), 'нейтральная банда не нападает');
  await setFac('raiders', -60);
  await A.next((m) => m.t === 'fx' && m.ev.some((e) => e.k === 'hit' && e.t === 'p' && e.id === A.welcome.you), 8000); // враждебная — нападает
  say(A, '/slay');
  const facK = await A.next((m) => m.t === 'fac' && m.d && m.d.raiders, 4000);
  assert.equal(facK.d.raiders, -F.settings.factionKillRep);
  assert.equal(facK.d.mutants, F.settings.factionKillRep * F.settings.factionEnemyShare); // враги рейдеров рады
  say(A, '/heal');

  stage = 'сюжет 1: убить рейдеров — прогресс группы';
  const home = map.towns[0];
  await goQuester(home);
  let off = await talkQuest(A, home);
  assert.equal(off.t, 'npc-offer', JSON.stringify(off));
  const m1 = off.quests.find((q) => q.id === 'm1_rumors');
  assert.ok(m1 && m1.main && m1.state === 'offer');
  assert.equal(off.quests.filter((q) => !q.main).length, Q.settings.questBoardSize);
  off = await talkQuest(A, home, { take: 'm1_rumors' });
  assert.equal(off.t, 'npc-offer', JSON.stringify(off));
  const logB = await B.next((m) => m.t === 'quests' && m.active.some((q) => q.id === 'm1_rumors'), 4000); // напарник видит задание
  assert.match(logB.active[0].goals[0].text, /Рейдеры.*\(0\/5\)/);
  // за оградой поселения: ближайшая проходимая точка (на картах с озёрами там может оказаться вода)
  const out = nearWalkable(map, home.x + home.zone + 12.5, home.y + 0.5);
  await tp(out.x, out.y);
  await tp(out.x, out.y, 'bob');
  await setFac('raiders', 0); // не нападают, пока создаём
  const invB0 = money((await api(b, 'GET', `/api/characters/${bob.characterId}`, undefined, bob.token)).data.character.inventory);
  assert.equal((await api(b, 'POST', '/api/admin/spawn', { kind: 'enemy', id: 'raider_gunner', count: 5 }, admin.token)).status, 200);
  await sleep(200);
  say(A, '/slay');
  await chatHas(A, /Слухи о Патриархе.*выполнено/);
  await chatHas(B, /Награда за «Слухи о Патриархе»/);
  const chB = (await api(b, 'GET', `/api/characters/${bob.characterId}`, undefined, bob.token)).data.character;
  assert.equal(money(chB.inventory) - invB0, Q.get('m1_rumors').reward.caps, 'напарник получил награду');
  assert.ok((chB.factions || {}).alliance >= Q.get('m1_rumors').reward.fac.alliance);

  stage = 'сбор: сдача атомарна, ушедший напарник получает награду при входе';
  const fe = withKind('fetch');
  assert.ok(fe, 'на доске есть «принести»');
  await goQuester(fe.town);
  off = await talkQuest(A, fe.town, { take: fe.q.id });
  assert.equal(off.t, 'npc-offer', JSON.stringify(off));
  off = await talkQuest(A, fe.town, { turnin: fe.q.id });
  assert.equal(off.t, 'npc-reject');
  assert.match(off.message, /Нужно/);
  await B.close();
  await sleep(300);
  const g0 = fe.q.goals[0];
  await give(g0.item, g0.n + 1);
  await lastInv(A);
  off = await talkQuest(A, fe.town, { turnin: fe.q.id });
  assert.equal(off.t, 'npc-offer', JSON.stringify(off));
  const invF = await lastInv(A);
  assert.equal(invF.cells.filter((x) => x && x.id === g0.item).reduce((a, x) => a + x.n, 0), 1, 'забрали ровно сколько нужно');
  B = await joinWorld(b, bob, w.id);
  await chatHas(B, new RegExp(`Награда за «${fe.q.name.replace(/[()]/g, '.')}»`));

  stage = 'доставка';
  const de = withKind('deliver');
  if (de) {
    await goQuester(de.town);
    off = await talkQuest(A, de.town, { take: de.q.id });
    assert.equal(off.t, 'npc-offer', JSON.stringify(off));
    assert.ok((await lastInv(A)).cells.some((x) => x && x.id === 'quest_parcel'));
    const to = map.towns[de.q.goals[0].to];
    await goQuester(to);
    off = await talkQuest(A, to);
    assert.ok(off.quests.some((q) => q.id === de.q.id && q.state === 'turnin' && q.ready), JSON.stringify(off.quests));
    off = await talkQuest(A, to, { turnin: de.q.id });
    assert.equal(off.t, 'npc-offer', JSON.stringify(off));
    assert.ok(!(await lastInv(A)).cells.some((x) => x && x.id === 'quest_parcel'));
  }

  stage = 'защита поселения';
  const df = withKind('defend');
  if (df) {
    await goQuester(df.town);
    off = await talkQuest(A, df.town, { take: df.q.id });
    assert.equal(off.t, 'npc-offer', JSON.stringify(off));
    await chatHas(A, /Набег на/);
    await sleep(300);
    say(A, '/kill all');
    await chatHas(A, /Отбить набег.*выполнено/, 8000);
  }

  stage = 'сопровождение';
  const es = withKind('escort');
  if (es) {
    await goQuester(es.town);
    off = await talkQuest(A, es.town, { take: es.q.id });
    assert.equal(off.t, 'npc-offer', JSON.stringify(off));
    const add = await A.next((m) => m.t === 'npc-add' && m.npc.escort, 4000);
    A.send({ t: 'quest', a: 'abandon', id: es.q.id });
    await A.next((m) => m.t === 'npc-remove' && m.id === add.npc.id, 4000);
    await chatHas(A, /провалено: отказ/);
  }

  stage = 'сюжет 2: главарь появляется, дружба с бандой засчитывает';
  let r = await qact({ act: 'grant', id: 'm2_baron' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const bossAdd = await A.next((m) => m.t === 'enemy-add' && m.enemy.type === 'boss_raider', 4000);
  const log2 = await A.next((m) => m.t === 'quests' && m.active.some((q) => q.id === 'm2_baron' && q.where), 4000);
  const where = log2.active.find((q) => q.id === 'm2_baron').where;
  assert.equal(where.boss, 'boss_raider');
  assert.ok(Math.hypot(bossAdd.enemy.x - where.x, bossAdd.enemy.y - where.y) < 6);
  await setFac('raiders', 30);
  await chatHas(A, /Барон Ржавый Зуб.*выполнено/, 6000);
  const list = (await api(b, 'POST', '/api/admin/quests/list', { worldId: w.id }, admin.token)).data;
  assert.equal(list.main, 2);
  assert.equal(list.mainQuests[2].state, 'next');

  stage = 'финал: разговор с Патриархом → концовка «союз»';
  r = await qact({ act: 'grant', id: 'm6_patriarch' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const pat = (await A.next((m) => m.t === 'enemy-add' && m.enemy.type === 'boss_super', 4000)).enemy;
  A.send({ t: 'quest', a: 'parley' });
  assert.match((await A.next('quest-reject', 4000)).message, /нет Железного Патриарха/);
  await setFac('patriarch', 30);
  await tp(pat.x + 1.5, pat.y + 0.5).catch(() => tp(pat.x, pat.y + 1.5));
  A.drain();
  A.send({ t: 'quest', a: 'parley' });
  const talk = await A.next((m) => m.t === 'npc-talk' || m.t === 'quest-reject', 4000);
  assert.equal(talk.t, 'npc-talk', JSON.stringify(talk));
  assert.equal(talk.src, 'quest');
  assert.ok(talk.flags.ally && !talk.flags.family);
  A.send({ t: 'quest', a: 'dlg', act: 'family' });
  assert.match((await A.next('quest-reject', 4000)).message, /не хватает репутации/);
  A.send({ t: 'quest', a: 'dlg', act: 'ally' });
  const end = await A.next('ending', 4000);
  assert.equal(end.id, 'ally');
  assert.ok(end.summary && end.summary.factions.length === F.IDS.length);
  assert.equal((await B.next('ending', 4000)).id, 'ally'); // напарник в мире — тоже концовка
  const chA = (await api(b, 'GET', `/api/characters/${admin.characterId}`, undefined, admin.token)).data.character;
  assert.ok(chA.endings.some((e) => e.id === 'ally'));
  const log6 = await A.next((m) => m.t === 'quests' && m.story.ending === 'ally', 4000);
  assert.equal(log6.main, Q.MAIN.length);
  r = await api(b, 'POST', '/api/worlds', params({ name: 'Второй круг', newGamePlus: true, characterId: admin.characterId }), admin.token);
  assert.equal(r.status, 200, 'НИ+ открыта: ' + JSON.stringify(r.data));

  stage = 'финал: бой → концовка «падение»';
  assert.equal((await qact({ act: 'reset', id: 'all' })).status, 200);
  r = await qact({ act: 'grant', id: 'm6_patriarch' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const pat2 = (await A.next((m) => m.t === 'enemy-add' && m.enemy.type === 'boss_super', 4000)).enemy;
  // не делаем Патриарха враждебным заранее: под нагрузкой свита успевает убить героя до /slay (падало на Windows)
  await tp(pat2.x + 1.5, pat2.y + 0.5).catch(() => tp(pat2.x, pat2.y + 1.5));
  say(A, '/slay');
  const end2 = await A.next('ending', 4000);
  assert.equal(end2.id, Q.endingFor('kill', { factions: (await A.next('fac', 4000).catch(() => ({ reps: {} }))).reps }) || 'destroy');
  assert.ok(['destroy', 'rule'].includes(end2.id));
  await setFac('patriarch', -80); // проверка сохранения репутации ниже

  stage = 'ГМ';
  assert.equal((await api(b, 'POST', '/api/admin/quests/list', { worldId: w.id }, bob.token)).status, 403);
  assert.equal((await qact({ act: 'nope' })).status, 400);
  assert.equal((await qact({ act: 'grant', id: 'p0-0-0' })).status, 404);
  assert.equal((await qact({ act: 'faction', username: 'admin', faction: 'hive', value: 50 })).status, 400);
  r = await qact({ act: 'ending', username: 'bob', ending: 'unite' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await B.next((m) => m.t === 'ending' && m.id === 'unite', 4000)).id, 'unite');
  say(A, '/ending Алиса good_end'); // старая команда — тоже экран финала
  assert.equal((await A.next((m) => m.t === 'ending' && m.id === 'good_end', 4000)).name, 'good_end');

  stage = 'сохранение';
  await A.close(); await B.close();
  await sleep(400);
  const file = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'worlds', `${w.id}.quests.json`), 'utf8'));
  assert.ok(['destroy', 'rule', 'unite'].includes(file.story.ending));
  assert.ok(file.stats.completed >= 1); // после сброса всех — финал
  const chA2 = (await api(b, 'GET', `/api/characters/${admin.characterId}`, undefined, admin.token)).data.character;
  assert.ok(chA2.factions.patriarch <= -80); // репутация на герое сохранена (убийство Патриарха — ещё ниже)
});
