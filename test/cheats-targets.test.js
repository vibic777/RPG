'use strict';
// Чит-панель, шаг 21: «Персонажи» (цель, бессмертие сущности, лечение, правка, приручение, клон…), уровень и элита при спавне, «Стройка» (все категории, ластик, сохранение)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startServer, api, newPlayer, joinWorld, sleep, tmpDir } = require('./helpers');
const WorldGen = require('../shared/worldgen');
const W = require('../shared/worldedit');

const params = (seed) => ({ name: 'Читы-2', seed, size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false });
const SET = ['--set', 'game.survivalFoodPerMin=0', '--set', 'game.survivalWaterPerMin=0', '--set', 'game.depotsPer256=0'];
async function cheat(C, msg) {
  C.drain();
  C.send({ t: 'cheat', ...msg });
  const m = await C.next((x) => x.t === 'cheat-ok' || x.t === 'cheat-err', 4000);
  return m.t === 'cheat-err' ? { err: m.message } : m;
}
const ok = (r) => { assert.ok(!r.err, r.err); return r; };
const row = async (A, k, id) => (ok(await cheat(A, { a: 'list' }))).list.find((r) => r.k === k && r.id === id);

test('companions/settlements: бессмертие сущности — урон 0 (спутник, житель), без него — урон есть', () => {
  const C = require('../shared/companions');
  const Enemies = require('../shared/enemies');
  const comp = require('../server/companions');
  const stl = require('../server/settlements');
  const rec = C.makeRecord(Enemies.get('wolf') || Enemies.ENEMIES.find((e) => C.kindOf(e)), 3, 'tame', 'c1');
  const ch = { companions: [rec] }, cl = { account: { id: 'a1' }, character: ch };
  const room = { id: 'r', players: new Map([['a1', cl]]), broadcast() {}, map: { width: 10, height: 10 } };
  const ent = { id: 'c1', owner: 'a1', x: 1, y: 1 };
  rec.god = true;
  assert.equal(comp.hitByEnemy(room, ent, { id: 'e1' }, 50, 'physical'), 0);
  rec.god = false;
  assert.ok(comp.hitByEnemy(room, ent, { id: 'e1' }, 5, 'physical') > 0);
  // правка множителей спутника
  const before = C.statsOf(rec);
  rec.cheat = { maxHp: 999, dmg: 2, speed: 1.5 };
  const after = C.statsOf(rec);
  assert.equal(after.maxHp, 999);
  assert.ok(after.damage[0] >= before.damage[0] * 2 - 1 && after.speed === before.speed * 1.5);
  assert.equal(C.sanitize({ ...rec, god: true }).god, true, 'бессмертие сохраняется');
  assert.deepEqual(C.sanitize(rec).cheat, { maxHp: 999, dmg: 2, speed: 1.5 });
  const n = { id: 'n1', hp: 50, maxHp: 50, role: 'civilian', god: true, name: 'Жора', x: 1, y: 1 };
  room.stl = { ents: new Map([['n1', n]]) };
  assert.equal(stl.hurt(room, n, 30, 'physical', null), 0);
  assert.equal(n.hp, 50);
});

test('WS чит-панель «Персонажи»: доступ, список и выбор щелчком, правка «как для себя» другого игрока, спутник, житель, враг', async (t) => {
  const s = await startServer(SET);
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const bob = await newPlayer(b, 'bob', 'Боб');
  const w = (await api(b, 'POST', '/api/worlds', params('cheat-t'), admin.token)).data.world;
  await api(b, 'POST', `/api/worlds/${w.id}/share`, { open: true }, admin.token);
  const code = (await api(b, 'POST', `/api/worlds/${w.id}/share`, { invite: 'new' }, admin.token)).data.world.inviteCode;
  assert.equal((await api(b, 'POST', '/api/worlds/join', { code }, bob.token)).status, 200);
  const A = await joinWorld(b, admin, w.id);
  // обычный игрок — нет доступа
  const wb = (await api(b, 'POST', '/api/worlds', params('cheat-t2'), bob.token)).data.world;
  const B0 = await joinWorld(b, bob, wb.id);
  B0.send({ t: 'cheat', a: 'list' });
  assert.match((await B0.next('cheat-err')).message, /только администратору/);
  await B0.close();
  ok(await cheat(A, { a: 'god', god: { invulnerable: true } }));
  const me = A.welcome.players.find((p) => p.id === A.welcome.you);
  // спутник-дракон у курсора, с уровнем
  const map = WorldGen.generate({ ...w });
  let spot = null;
  for (let r = 2; r < 6 && !spot; r++) for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r]]) if (!spot && WorldGen.isWalkable(map, Math.floor(me.x + dx), Math.floor(me.y + dy))) spot = { x: Math.floor(me.x + dx) + 0.5, y: Math.floor(me.y + dy) + 0.5 };
  const cs = ok(await cheat(A, { a: 'spawn', kind: 'companion', id: 'dragon_fire', level: 12, x: spot.x, y: spot.y }));
  let cr = await row(A, 'c', cs.id);
  assert.ok(cr && cr.kind === 'дракон' && cr.lvl === 12 && cr.mine === 1 && cr.out === 1);
  assert.ok(Math.hypot(cr.x - spot.x, cr.y - spot.y) < 2, 'спутник у курсора');
  // выбор щелчком
  const pk = ok(await cheat(A, { a: 'pick', x: cr.x + 0.3, y: cr.y }));
  assert.equal(pk.target.id, cs.id);
  // правка, бессмертие, нокаут и лечение (воскрешение)
  ok(await cheat(A, { a: 't', k: 'c', id: cs.id, op: 'edit', edit: { maxHp: 5000, dmg: 3, speed: 2, food: 50 } }));
  cr = await row(A, 'c', cs.id);
  assert.equal(cr.max, 5000);
  ok(await cheat(A, { a: 't', k: 'c', id: cs.id, op: 'god', on: true }));
  assert.equal((await row(A, 'c', cs.id)).god, 1);
  ok(await cheat(A, { a: 't', k: 'c', id: cs.id, op: 'kill' }));
  assert.equal((await row(A, 'c', cs.id)).down, 1, 'без сознания');
  ok(await cheat(A, { a: 't', k: 'c', id: cs.id, op: 'heal' }));
  cr = await row(A, 'c', cs.id);
  assert.ok(cr.down === 0 && cr.hp === cr.max, 'поднят и здоров');
  ok(await cheat(A, { a: 'allmine', what: 'god', on: false }));
  assert.equal((await row(A, 'c', cs.id)).god, 0);
  ok(await cheat(A, { a: 't', k: 'c', id: cs.id, op: 'clone' }));
  assert.equal((await cheat(A, { a: 'list' })).list.filter((r) => r.k === 'c' && r.mine).length, 2, 'клон');
  ok(await cheat(A, { a: 't', k: 'c', id: cs.id, op: 'dismiss' }));
  assert.ok(!(await row(A, 'c', cs.id)), 'отпущен');
  // враг: уровень и элита при спавне, правка, бессмертие, приручение
  const es = ok(await cheat(A, { a: 'spawn', kind: 'enemy', id: 'wolf', count: 1, level: 20, elite: true }));
  assert.match(es.text, /ур\. 20, элита/);
  const eid = es.ids[0];
  let er = await row(A, 'e', eid);
  assert.ok(er.lvl === 20 && /элита/.test(er.name));
  const base = require('../shared/enemies').statsAt(require('../shared/enemies').get('wolf'), 20).maxHp;
  assert.equal(er.max, base * 2, 'элита: здоровье ×2 от уровня 20');
  ok(await cheat(A, { a: 't', k: 'e', id: eid, op: 'edit', edit: { level: 5 } }));
  er = await row(A, 'e', eid);
  assert.ok(er.lvl === 5 && er.max < base, 'уровень пересчитан');
  ok(await cheat(A, { a: 't', k: 'e', id: eid, op: 'god', on: true }));
  ok(await cheat(A, { a: 't', k: 'e', id: eid, op: 'tphere' }));
  for (let i = 0; i < 4; i++) { A.send({ t: 'atk', slot: 'main', target: eid, tk: 'e' }); await sleep(700); }
  er = await row(A, 'e', eid);
  assert.ok(er && er.hp === er.max, 'бессмертного врага не ранить');
  const tm = ok(await cheat(A, { a: 't', k: 'e', id: eid, op: 'tame' }));
  assert.match(tm.text, /ваш спутник/);
  assert.ok(!(await row(A, 'e', eid)));
  // житель с уровнем, бессмертие, симпатия
  const ns = ok(await cheat(A, { a: 'spawn', kind: 'npc', id: 'civilian', level: 11 }));
  let nr = await row(A, 'n', ns.id);
  assert.ok(nr.lvl === 11 && nr.max === Math.round(require('../shared/settlements').ROLES.civilian.hp * 2), 'житель ур. 11: здоровье ×2');
  ok(await cheat(A, { a: 't', k: 'n', id: ns.id, op: 'edit', edit: { affinity: 70, maxHp: 300, hp: 10 } }));
  nr = await row(A, 'n', ns.id);
  assert.ok(nr.max === 300 && nr.hp === 10);
  ok(await cheat(A, { a: 't', k: 'n', id: ns.id, op: 'heal' }));
  assert.equal((await row(A, 'n', ns.id)).hp, 300);
  // другой игрок — тем же интерфейсом, что и вы (who)
  const B = await joinWorld(b, bob, w.id);
  ok(await cheat(A, { a: 'edit', who: B.welcome.you, edit: { level: 9, stats: { strength: 8 } } }));
  ok(await cheat(A, { a: 'give', who: B.welcome.you, item: 'caps', count: 5 }));
  assert.match((await cheat(A, { a: 'take', who: B.welcome.you, item: 'caps', count: 5 })).text, /Забрано \(Боб\)/);
  const g = ok(await cheat(A, { a: 'god', who: B.welcome.you, god: { invulnerable: true, infinite: true } }));
  assert.ok(g.tgod.invulnerable && g.tgod.infinite);
  assert.equal((await B.next('god')).god.infinite, true);
  const wi = ok(await cheat(A, { a: 'whois', who: B.welcome.you })).whois; // данные для общей формы «Я / цель»
  assert.ok(wi.level === 9 && wi.stats.strength === 8 && wi.god.infinite && !wi.me && wi.name === 'Боб');
  assert.equal(ok(await cheat(A, { a: 'whois' })).whois.me, true);
  assert.match(ok(await cheat(A, { a: 'spells', who: B.welcome.you, school: 'all' })).text, /Боб/);
  ok(await cheat(A, { a: 't', k: 'p', id: B.welcome.you, op: 'tphere' }));
  ok(await cheat(A, { a: 'god', who: B.welcome.you, god: { invulnerable: false } }));
  ok(await cheat(A, { a: 't', k: 'p', id: B.welcome.you, op: 'kill' }));
  assert.equal((await row(A, 'p', B.welcome.you)).down, 1);
  ok(await cheat(A, { a: 'heal', who: B.welcome.you }));
  assert.equal((await row(A, 'p', B.welcome.you)).down, 0, 'воскрешён');
  assert.equal((await row(A, 'p', B.welcome.you)).lvl, 9);
  await B.close();
  await A.close();
  const log = JSON.stringify((await api(b, 'GET', '/api/admin/log?action=cheat-t', undefined, admin.token)).data);
  assert.ok(log.includes('cheat-t'), 'действия над целью в журнале');
});

test('WS чит-панель «Стройка»: все категории, ластик, тайник, сохранение после перезапуска', async (t) => {
  const extra = ['--data', path.join(tmpDir(), 'data'), '--set', 'backupOnStart=false', ...SET];
  const s = await startServer(extra, { ipc: true });
  let stopped = false;
  t.after(() => { if (!stopped) s.stop(); });
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params('cheat-build'), admin.token)).data.world;
  const map = WorldGen.generate({ ...w });
  const A = await joinWorld(b, admin, w.id);
  assert.ok(Array.isArray(A.welcome.props) && Array.isArray(A.welcome.hidden));
  const me = A.welcome.players.find((p) => p.id === A.welcome.you);
  const free = [];
  for (let r = 3; r < 14 && free.length < 14; r++) for (let dx = -r; dx <= r; dx += 3) { const x = Math.floor(me.x + dx), y = Math.floor(me.y + r); if (WorldGen.isWalkable(map, x, y) && !free.some((f) => Math.abs(f.x - x) < 3 && Math.abs(f.y - y) < 3)) free.push({ x, y }); }
  assert.ok(free.length >= 9, 'есть место');
  const at = (i) => ({ x: free[i].x + 0.5, y: free[i].y + 0.5 });
  const ids = {};
  for (const [i, cat, id] of [[0, 'obj', 'tree_oak'], [1, 'obj', 'rusted_car'], [2, 'bld', 'market'], [3, 'cache', 'cache'], [4, 'node', 'rock']]) {
    const r = ok(await cheat(A, { a: 'place', cat, id, ...at(i), rot: 1, level: 5 }));
    ids[cat + id] = r.id;
    const add = await A.next((m) => m.t === 'prop-add' && m.prop.id === r.id);
    assert.equal(add.prop.k, cat);
  }
  assert.match((await cheat(A, { a: 'place', cat: 'obj', id: 'нет', ...at(5) })).err, /Нет такого/);
  // существа и техника у курсора, с уровнем
  ok(await cheat(A, { a: 'place', cat: 'enemy', id: 'zombie', ...at(5), level: 7 }));
  const v = ok(await cheat(A, { a: 'place', cat: 'vehicle', id: 'car', ...at(6) }));
  const vu = await A.next((m) => m.t === 'veh-upd' && m.v.id === v.id);
  assert.ok(Math.hypot(vu.v.x - at(6).x, vu.v.y - at(6).y) < 3, 'техника у курсора');
  ok(await cheat(A, { a: 'place', cat: 'companion', id: 'dragon_ice', ...at(7), level: 15 }));
  const npc = ok(await cheat(A, { a: 'place', cat: 'npc', id: 'guard', ...at(8), level: 4 }));
  // деталь базы: базы нет — объявится в точке (флаг), деталь — бесплатно (ресурсов и чертежа нет)
  const Bd = require('../shared/building');
  let cl = null;
  for (let d = 12; d < 60 && !cl; d += 2) for (let a = 0; a < 16 && !cl; a++) { const x = Math.floor(me.x + Math.cos(a / 16 * Math.PI * 2) * d), y = Math.floor(me.y + Math.sin(a / 16 * Math.PI * 2) * d); if (x > 12 && y > 12 && x < map.width - 12 && y < map.height - 12 && !Bd.canClaim(map, x - 2, y, [], Bd.settings.baseRadius) && WorldGen.isWalkable(map, x, y)) cl = { x: x - 2, y }; }
  assert.ok(cl, 'есть место под базу');
  assert.match(ok(await cheat(A, { a: 'place', cat: 'piece', id: 'wall_wood', x: cl.x + 2.5, y: cl.y + 0.5, rot: 1 })).text, /бесплатно/);
  const wallAdd = await A.next((m) => m.t === 'bld-add' && m.p.type === 'wall_wood');
  assert.deepEqual([wallAdd.p.x, wallAdd.p.y, wallAdd.p.rot], [cl.x + 2, cl.y, 1]);
  assert.match((await cheat(A, { a: 'place', cat: 'piece', id: 'flag', x: cl.x + 0.5, y: cl.y + 0.5 })).err, /флаг один/);
  // тайник: открыть рядом — добыча на земле
  ok(await cheat(A, { a: 'tp', x: at(3).x + 0.6, y: at(3).y }));
  A.send({ t: 'prop', a: 'open', id: ids.cachecache });
  await A.next((m) => m.t === 'prop-remove' && m.id === ids.cachecache);
  await A.next('ground-add');
  // ластик: объект стройки, затем пустая клетка с деревом мира — скрыть
  assert.match(ok(await cheat(A, { a: 'erase', ...at(1) })).text, /Ржавая машина/);
  let natural = null;
  for (let y = 2; y < map.height - 2 && !natural; y++) for (let x = 2; x < map.width - 2 && !natural; x++) if (require('../shared/building').nodeAt(map, x, y) === 'tree') natural = { x: x + 0.5, y: y + 0.5 };
  if (natural) {
    assert.match(ok(await cheat(A, { a: 'erase', ...natural })).text, /скрыт/);
    const h = await A.next('prop-hide');
    assert.equal(h.on, 1);
  }
  // сохранение и перезапуск
  assert.equal((await api(b, 'POST', `/api/admin/worlds/${w.id}/save`, {}, admin.token)).status, 200);
  A.close();
  await sleep(300);
  await new Promise((res) => { s.proc.once('exit', res); s.proc.send('shutdown'); });
  stopped = true;
  const s2 = await startServer(extra, { ipc: true });
  t.after(() => s2.stop());
  const A2 = await joinWorld(s2.base, admin, w.id);
  const keys = A2.welcome.props.map((p) => p.k + p.key).sort();
  assert.deepEqual(keys, ['bldmarket', 'noderock', 'objtree_oak'], 'объекты стройки сохранились');
  assert.equal(A2.welcome.props.find((p) => p.k === 'bld').rot, 1);
  assert.ok(A2.welcome.bld.pieces.some((p) => p.type === 'wall_wood' && p.x === cl.x + 2), 'деталь базы сохранилась');
  if (natural) assert.ok(A2.welcome.hidden.includes(Math.floor(natural.y) * map.width + Math.floor(natural.x)), 'скрытый объект мира сохранился');
  const list = (await cheat(A2, { a: 'list' })).list;
  assert.ok(list.some((r) => r.k === 'n' && r.id === npc.id && r.lvl === 4), 'житель по читу сохранился');
  await A2.close();
  assert.deepEqual(Object.keys(W.CATS).sort(), ['bld', 'cache', 'companion', 'enemy', 'node', 'npc', 'obj', 'piece', 'vehicle']);
});
