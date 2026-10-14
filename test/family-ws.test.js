'use strict';
// Шаг 17 по WebSocket: отношения с жителем (разговор, подарки), ухаживание, помолвка, свадьба (кровать и плата), житель
// переезжает; сироты у старосты (кровать, одного не усыновить дважды); семейный союз игроков по согласию (отказ, принятие,
// «уже есть супруг»), Патриарх по приглашению, рост ребёнка, помощник «сбор» кладёт в сундук, поход со спутниками и домой,
// сохранение, «Новая игра+» (семья и база переезжают), панель ГМ.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');
const WorldGen = require('../shared/worldgen');
const B = require('../shared/building');
const Fam = require('../shared/family');
require('../shared/settlements');

const params = (o = {}) => ({ name: 'Семья', seed: 'base-1', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false, ...o });
const RULES = { baseRadius: 5, baseMinSpawnDist: 4, baseMinSettlementDist: 2 };
const set = (o) => Object.entries({
  survivalFoodPerMin: 0, survivalWaterPerMin: 0, survivalRestPerMin: 0, chatRateCount: 500, ...RULES,
  familyTalkCooldownMin: 0, familyGiftCooldownMin: 0, familyOppositeSex: false, familyHelperTickSec: 1, familyGatherMin: 0.02, familyDayMin: 0.05 /* цикл 3 с: тики помощников (~1 с) не попадают в такт только сна, как бывало на Windows с 0,002 */, familyChildYearMin: 0.05, ...o,
}).flatMap(([k, v]) => ['--set', `game.${k}=${v}`]);
B.configure(RULES);
function claimSpot(map) {
  const ok = (x, y) => WorldGen.isWalkable(map, x, y) && !B.nodeAt(map, x, y);
  for (let y = 8; y < map.height - 8; y++) for (let x = 8; x < map.width - 8; x++) {
    if (B.canClaim(map, x, y, [], 5)) continue;
    let good = true;
    for (let dy = -5; dy <= 2 && good; dy++) for (let dx = -2; dx <= 2 && good; dx++) if (!ok(x + dx, y + dy)) good = false;
    if (good) return { x, y };
  }
  throw new Error('нет места под базу');
}
const say = (c, text) => c.send({ t: 'chat', text });
const countIn = (inv, id) => inv.cells.reduce((a, x) => a + (x && x.id === id ? x.n : 0), 0);

test('WS семья: отношения, свадьба, сироты, союз игроков, Патриарх, рост, помощники, поход, сохранение, НИ+, ГМ', async (t) => {
  let stage = 'начало';
  process.on('exit', (code) => { if (code) console.error('этап:', stage, JSON.stringify((globalThis.__FA || { messages: [] }).messages.filter((m) => /fam|npc-|reject|chat/.test(m.t)).slice(-6).map((m) => JSON.stringify(m).slice(0, 300)))); });
  const s = await startServer(set({}));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const bob = await newPlayer(b, 'bob', 'Боб');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  const code = (await api(b, 'POST', `/api/worlds/${w.id}/share`, { invite: 'new', open: true }, admin.token)).data.world.inviteCode;
  assert.equal((await api(b, 'POST', '/api/worlds/join', { code }, bob.token)).status, 200);
  const map = WorldGen.generate({ ...w });
  const spot = claimSpot(map);
  const A = await joinWorld(b, admin, w.id);
  globalThis.__FA = A;
  const Bc = await joinWorld(b, bob, w.id);
  assert.ok(A.welcome.fam && A.welcome.fam.members.length === 0 && A.welcome.fam.beds === 0);
  const tp = async (x, y, who = 'admin') => { const r = await api(b, 'POST', '/api/admin/teleport', { username: who, x, y }, admin.token); assert.equal(r.status, 200, JSON.stringify(r.data)); await sleep(150); };
  const give = async (item, count, who = 'admin') => { const r = await api(b, 'POST', '/api/admin/items/give', { username: who, item, count }, admin.token); assert.equal(r.status, 200, JSON.stringify(r.data)); };
  const fact = (body) => api(b, 'POST', '/api/admin/family/act', { username: 'admin', ...body }, admin.token);
  const inv = async () => (await api(b, 'GET', `/api/characters/${admin.characterId}`, undefined, admin.token)).data.character.inventory;
  const npcAct = async (n, a, extra = {}, want = (m) => m.t === 'fam-rel' || m.t === 'npc-offer') => { A.drain(); A.send({ t: 'npc', a, id: n.id, ...extra }); return A.next((m) => want(m) || m.t === 'npc-reject', 4000); };
  const famMsg = (pred, c = A) => c.next((m) => m.t === 'fam' && pred(m), 6000);

  stage = 'база: флаг и одна кровать';
  await tp(spot.x + 0.5, spot.y + 0.5);
  await give('base_flag', 1);
  await give('wood', 40);
  await give('cloth', 20);
  await sleep(200);
  const cells = (await inv()).cells;
  A.send({ t: 'inv', a: { type: 'use', from: { c: 'cell', i: cells.findIndex((x) => x && x.id === 'base_flag') } } });
  await A.next('bld-base');
  const build = async (type, x, y) => { A.send({ t: 'build', a: 'place', type, x, y }); return (await A.next((m) => m.t === 'bld-add' && m.p.type === type, 4000)).p; };

  stage = 'житель: разговор и подарки';
  const town = map.towns.find((x) => x.npcs.some((n) => n.role === 'civilian') && x.npcs.some((n) => n.role === 'quest'));
  const n = town.npcs.find((x) => x.role === 'civilian');
  await tp(n.x, n.y);
  await A.next((m) => m.t === 'npc-add' && m.npc.id === n.id, 4000).catch(() => null);
  A.send({ t: 'npc', a: 'talk', id: n.id });
  const talk = await A.next('npc-talk', 4000);
  assert.ok(talk.flags.famOk && !talk.flags.famCourt && talk.rel === null);
  let r = await npcAct(n, 'fam_talk');
  assert.equal(r.t, 'fam-rel', JSON.stringify(r));
  assert.equal(r.rel.affinity, Fam.settings.familyTalkAffinity);
  await give('gold_nugget', 12);
  await sleep(200);
  r = await npcAct(n, 'fam_gift');
  assert.equal(r.what, 'gifts');
  const gi = r.gifts.find((g) => g.id === 'gold_nugget');
  assert.equal(gi.gain, 10);
  for (let k = 0; k < 6; k++) { r = await npcAct(n, 'fam_gift', { i: gi.i }); assert.equal(r.t, 'fam-rel', JSON.stringify(r)); }
  assert.equal(r.rel.affinity, 64);
  assert.ok(r.flags.famCourt && !r.flags.famPropose);
  assert.equal(countIn(await inv(), 'gold_nugget'), 6, 'подарки ушли из сумки');
  r = await npcAct(n, 'fam_propose');
  assert.equal(r.t, 'npc-reject');
  r = await npcAct(n, 'fam_court');
  assert.equal(r.rel.stage, 'courting');
  for (let k = 0; k < 2; k++) r = await npcAct(n, 'fam_gift', { i: gi.i });
  assert.ok(r.flags.famPropose);
  r = await npcAct(n, 'fam_propose');
  assert.equal(r.rel.stage, 'engaged');
  assert.ok(r.flags.famWed);

  stage = 'свадьба: кровать и плата';
  r = await npcAct(n, 'fam_wed');
  assert.match(r.message, /кровать/);
  await tp(spot.x + 0.5, spot.y + 0.5);
  await build('bed', spot.x - 1, spot.y + 1);
  await tp(n.x, n.y);
  await sleep(300);
  // денег: 4 самородка = 400 крышек ≥ 200 — хватает; проверим плату
  r = await npcAct(n, 'fam_wed', {}, (m) => m.t === 'fam' && m.members.length === 1);
  assert.equal(r.t, 'fam', JSON.stringify(r));
  assert.equal(r.members[0].kind, 'partner');
  assert.equal(r.members[0].name, n.name);
  assert.equal(r.rel.length, 0, 'отношения превратились в семью');
  const after = await inv();
  assert.equal(countIn(after, 'gold_nugget') * 100 + countIn(after, 'caps'), 400 - Fam.settings.familyCeremonyCost);
  await sleep(300);
  A.send({ t: 'npc', a: 'talk', id: n.id });
  assert.match((await A.next('npc-reject', 4000)).message, /нет/, 'житель переехал из поселения');

  stage = 'сироты';
  const q = town.npcs.find((x) => x.role === 'quest');
  await tp(q.x, q.y);
  await A.next((m) => m.t === 'npc-add' && m.npc.id === q.id, 4000).catch(() => null);
  r = await npcAct(q, 'orphans');
  assert.equal(r.what, 'orphans', JSON.stringify(r));
  assert.equal(r.orphans.length, Fam.settings.familyOrphansPerTown);
  const kid = r.orphans[0];
  r = await npcAct(q, 'orphans', { adopt: kid.id });
  assert.match(r.message, /кровать/);
  await tp(spot.x + 0.5, spot.y + 0.5);
  await build('bed', spot.x + 1, spot.y + 1);
  await tp(q.x, q.y);
  await sleep(300);
  r = await npcAct(q, 'orphans', { adopt: kid.id, study: 'craft' });
  assert.equal(r.what, 'orphans', JSON.stringify(r));
  assert.equal(r.orphans.length, Fam.settings.familyOrphansPerTown - 1);
  r = await npcAct(q, 'orphans', { adopt: kid.id });
  assert.match(r.message, /забрали/);
  const fam2 = await famMsg((m) => m.members.length === 2, A).catch(() => null) || (A.send({ t: 'fam', a: 'list' }), await famMsg((m) => m.members.length === 2));
  const child = fam2.members.find((m) => m.kind === 'child');
  assert.equal(child.name, kid.name);
  assert.equal(child.study, 'craft');
  assert.ok(!child.adult);

  stage = 'союз игроков: согласие';
  Bc.send({ t: 'fam', a: 'bond', name: 'Алиса' });
  assert.match((await Bc.next('fam-reject', 4000)).message, /уже есть супруг|подойдите/i);
  const partner = fam2.members.find((m) => m.kind === 'partner');
  assert.equal((await fact({ act: 'remove', id: partner.id })).status, 200);
  await tp(spot.x + 2.5, spot.y + 0.5, 'bob');
  await tp(spot.x + 0.5, spot.y + 0.5);
  Bc.send({ t: 'fam', a: 'bond', name: 'Алиса' });
  const ask = await A.next('fam-ask', 4000);
  assert.equal(ask.name, 'Боб');
  A.send({ t: 'fam', a: 'answer', from: ask.from, yes: false });
  await Bc.next((m) => m.t === 'chat' && /не готов/.test(JSON.stringify(m)), 4000);
  A.send({ t: 'fam', a: 'answer', from: ask.from, yes: true });
  assert.match((await A.next('fam-reject', 4000)).message, /не действует/); // ответ дан — повторно нельзя
  Bc.send({ t: 'fam', a: 'bond', name: 'Алиса' });
  const ask2 = await A.next('fam-ask', 4000);
  A.send({ t: 'fam', a: 'answer', from: ask2.from, yes: true });
  const fa = await famMsg((m) => m.bond && m.bond.name === 'Боб');
  const fb = await famMsg((m) => m.bond && m.bond.name === 'Алиса', Bc);
  assert.ok(fa && fb);

  stage = 'Патриарх по приглашению';
  assert.equal((await fact({ act: 'invite' })).status, 200);
  await famMsg((m) => m.invites.includes('boss_super'));
  A.send({ t: 'fam', a: 'invite', who: 'boss_super', yes: true });
  const fp = await famMsg((m) => m.members.some((x) => x.kind === 'elder'));
  assert.equal(fp.invites.length, 0);

  stage = 'рост и помощник «сбор»';
  r = await fact({ act: 'add', kind: 'child', name: 'Ваня', age: 15, role: 'gather' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await A.next((m) => m.t === 'chat' && /Ваня повзрослел/.test(JSON.stringify(m)), 8000);
  await build('bed', spot.x - 1, spot.y - 1); // кровать для каждого: ребёнок, Патриарх, Ваня
  const chest = await build('chest', spot.x + 1, spot.y - 1);
  await A.next((m) => m.t === 'bld-upd' && m.id === chest.id && m.n > 0, 15000);
  A.drain();
  A.send({ t: 'fam', a: 'list' });
  const fv = await famMsg((m) => m.members.some((x) => x.name === 'Ваня' && x.adult));
  const vanya = fv.members.find((x) => x.name === 'Ваня');
  assert.equal(vanya.role, 'gather');
  assert.ok(vanya.housed);

  stage = 'поход и домой';
  // ребёнка тоже можно взять в поход (занимает место команды); «отпустить» — отправить домой
  A.send({ t: 'fam', a: 'out', id: child.id });
  const ccl = await A.next((m) => m.t === 'comp-list' && m.list.some((x) => x.name === child.name), 4000);
  await famMsg((m) => m.members.some((x) => x.id === child.id && x.out));
  A.send({ t: 'comp', a: 'release', id: ccl.list.find((x) => x.name === child.name).id });
  await famMsg((m) => m.members.some((x) => x.id === child.id && !x.out));
  A.send({ t: 'fam', a: 'out', id: vanya.id });
  const cl = await A.next((m) => m.t === 'comp-list' && m.list.some((x) => x.fam === vanya.id || x.name === 'Ваня'), 4000);
  const comp = cl.list.find((x) => x.name === 'Ваня');
  assert.ok(comp);
  await famMsg((m) => m.members.some((x) => x.id === vanya.id && x.out));
  A.send({ t: 'comp', a: 'release', id: comp.id }); // «отпустить» члена семьи — значит отправить домой
  await famMsg((m) => m.members.some((x) => x.id === vanya.id && !x.out));

  stage = 'ГМ';
  assert.equal((await api(b, 'POST', '/api/admin/family/list', { username: 'admin' }, bob.token)).status, 403);
  const gl = (await api(b, 'POST', '/api/admin/family/list', { username: 'admin' }, admin.token)).data;
  assert.equal(gl.members.length, 3);
  assert.equal(gl.bond.name, 'Боб');
  assert.equal((await fact({ act: 'add', kind: 'dragon', name: 'X' })).status, 400);
  assert.equal((await fact({ act: 'remove', id: 'nope' })).status, 404);

  stage = 'сохранение и «Новая игра+»';
  say(A, '/ending Алиса good_end');
  await A.next((m) => m.t === 'ending' || (m.t === 'chat' && /good_end/.test(JSON.stringify(m))), 4000);
  await sleep(300);
  r = await api(b, 'POST', '/api/worlds', params({ name: 'Второй круг', seed: 'base-ng', newGamePlus: true, characterId: admin.characterId }), admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ng = r.data.world;
  A.close(); Bc.close();
  await sleep(500);
  const ch = (await api(b, 'GET', `/api/characters/${admin.characterId}`, undefined, admin.token)).data.character;
  assert.equal(ch.family.members.length, 3, 'семья сохранена на герое');
  assert.equal(ch.family.bond.name, 'Боб');
  const A2 = await joinWorld(b, admin, ng.id);
  assert.equal(A2.welcome.fam.members.length, 3, 'семья в мире «Новой игры+»');
  assert.ok(A2.welcome.fam.home, 'база с кроватями переехала');
  assert.equal(A2.welcome.fam.beds, 3);
  A2.close();
});
