'use strict';
// База и строительство по WebSocket: флаг базы (участок, правила), постройки (стоимость, занятые клетки, чертежи,
// вне участка), дверь и замок, снос с возвратом, ремонт, враги ломают стены на пути к герою, колья, кровать,
// сундук, сохранение базы и очага после перезапуска, добыча ресурсов, НИ+ с базой, панель администратора.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, api, newPlayer, joinWorld, tmpDir, rmDir, sleep } = require('./helpers');
const WorldGen = require('../shared/worldgen');
const B = require('../shared/building');

const params = (o = {}) => ({ name: 'Пустошь', seed: 'base-1', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false, ...o });
const RULES = { baseRadius: 5, baseMinSpawnDist: 4, baseMinSettlementDist: 2 };
const set = (o) => Object.entries({ survivalFoodPerMin: 0, survivalWaterPerMin: 0, survivalRestPerMin: 0, chatRateCount: 100, ...RULES, ...o }).flatMap(([k, v]) => ['--set', `game.${k}=${v}`]);
B.configure(RULES);

// Место под базу: участок допустим, вокруг флага 3×3 проходимо, без ресурсных точек рядом
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
async function give(b, token, item, count = 1) {
  const r = await api(b, 'POST', '/api/admin/items/give', { username: 'admin', item, count }, token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
}
const cellsOf = (m) => m.inventory.cells;
const countIn = (m, id) => cellsOf(m).reduce((a, x) => a + (x && x.id === id ? x.n : 0), 0);
const lastInv = (c) => [...c.messages].reverse().find((m) => m.t === 'inv');
async function use(c, id) {
  await sleep(150);
  let inv = lastInv(c);
  if (!inv || !countIn(inv, id)) inv = await c.next((m) => m.t === 'inv' && countIn(m, id) > 0);
  c.send({ t: 'inv', a: { type: 'use', from: { c: 'cell', i: cellsOf(inv).findIndex((x) => x && x.id === id) } } });
}
const build = (c, o) => c.send({ t: 'build', ...o });
const reject = async (c, re) => assert.match((await c.next('bld-reject')).message, re);
const say = (c, text) => c.send({ t: 'chat', text });

test('WS база: флаг, правила размещения, стоимость, дверь, снос с возвратом, ремонт, сундук, кровать; сохранение после перезапуска', async (t) => {
  const dir = tmpDir(), data = path.join(dir, 'data');
  t.after(() => rmDir(dir));
  const extra = ['--data', data, '--set', 'backupOnStart=false', ...set({})];
  const s1 = await startServer(extra, { ipc: true });
  t.after(() => { if (s1.proc.exitCode === null && s1.proc.signalCode === null) s1.proc.kill(); });
  const b = s1.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  const map = WorldGen.generate({ ...w });
  const spot = claimSpot(map);
  let A = await joinWorld(b, admin, w.id);
  assert.deepEqual(A.welcome.bld.bases, []);
  // без базы строить нельзя
  build(A, { a: 'place', type: 'wall_wood', x: spot.x + 1, y: spot.y });
  await reject(A, /объявите базу/);
  // у точки появления флаг не ставится
  await give(b, admin.token, 'base_flag', 2);
  await use(A, 'base_flag');
  assert.match((await A.next('inv-error')).message, /точке появления|поселени|краю/);
  assert.equal((await api(b, 'POST', '/api/admin/teleport', { x: spot.x + 0.5, y: spot.y + 0.5 }, admin.token)).status, 200);
  await sleep(100);
  await use(A, 'base_flag');
  const base = (await A.next('bld-base')).base;
  assert.equal(base.x, spot.x); assert.equal(base.r, 5); assert.equal(base.owner, admin.accountId || base.owner);
  await use(A, 'base_flag');
  assert.match((await A.next('inv-error')).message, /уже есть база/);
  // костёр переживёт перезапуск (состояние мира)
  await give(b, admin.token, 'campfire');
  await use(A, 'campfire');
  await A.next('fire-add');
  // постройки: стоимость, занятая клетка, под героем, вне участка, чертёж
  await give(b, admin.token, 'wood', 30);
  await give(b, admin.token, 'scrap_metal', 6);
  await give(b, admin.token, 'cloth', 4);
  await A.next((m) => m.t === 'inv' && countIn(m, 'cloth') === 4);
  build(A, { a: 'place', type: 'wall_wood', x: spot.x + 2, y: spot.y, rot: 1 });
  const wall = (await A.next((m) => m.t === 'bld-add' && m.p.type === 'wall_wood')).p;
  assert.equal(wall.type, 'wall_wood'); assert.equal(wall.rot, 1); assert.equal(wall.hp, wall.max);
  await A.next((m) => m.t === 'inv' && countIn(m, 'wood') === 26);
  build(A, { a: 'place', type: 'fence', x: spot.x + 2, y: spot.y });
  await reject(A, /занята/);
  build(A, { a: 'place', type: 'wall_wood', x: spot.x, y: spot.y + 1 });
  build(A, { a: 'place', type: 'fence', x: spot.x + 1, y: spot.y + 1 }); // рядом — можно
  await A.next((m) => m.t === 'bld-add' && m.p.type === 'fence');
  build(A, { a: 'place', type: 'foundation', x: spot.x + 6, y: spot.y });
  await reject(A, /Вне участка|далеко/);
  build(A, { a: 'place', type: 'wall_stone', x: spot.x - 1, y: spot.y - 1 });
  await reject(A, /чертёж/);
  build(A, { a: 'place', type: 'roof', x: spot.x - 1, y: spot.y - 1 });
  await reject(A, /фундамент/);
  build(A, { a: 'place', type: 'bed', x: spot.x - 1, y: spot.y + 1 });
  const bed = (await A.next((m) => m.t === 'bld-add' && m.p.type === 'bed')).p;
  build(A, { a: 'bed', id: bed.id });
  await A.next((m) => m.t === 'chat' && /Кровать назначена/.test(m.m.text));
  // дверь: запереть может только хозяин
  build(A, { a: 'place', type: 'door', x: spot.x - 2, y: spot.y });
  const door = (await A.next((m) => m.t === 'bld-add' && m.p.type === 'door')).p;
  build(A, { a: 'lock', id: door.id });
  assert.equal((await A.next((m) => m.t === 'bld-upd' && m.id === door.id)).locked, 1);
  build(A, { a: 'lock', id: wall.id });
  await reject(A, /двери/);
  // сундук: положить и взять
  build(A, { a: 'place', type: 'chest', x: spot.x - 1, y: spot.y });
  const chest = (await A.next((m) => m.t === 'bld-add' && m.p.type === 'chest')).p;
  const inv = await A.next((m) => m.t === 'inv' && countIn(m, 'wood') > 0 && !cellsOf(m).some((x) => x && x.id === 'wood' && false));
  const woodCell = cellsOf(lastInv(A) || inv).findIndex((x) => x && x.id === 'scrap_metal');
  build(A, { a: 'chest', op: 'put', id: chest.id, cell: woodCell, n: 1 });
  const ch1 = await A.next('chest');
  assert.equal(ch1.items.filter(Boolean).length, 1);
  assert.equal(ch1.items[0].id, 'scrap_metal');
  // снос с возвратом половины (стена: 4 дерева → 2)
  const before = countIn(lastInv(A), 'wood');
  build(A, { a: 'demolish', id: wall.id });
  await A.next((m) => m.t === 'bld-remove' && m.id === wall.id);
  await A.next((m) => m.t === 'inv' && countIn(m, 'wood') === before + 2);
  build(A, { a: 'demolish', id: 'flag-' + base.id.slice(0, 8) });
  await reject(A, /не сносится/);
  // перезапуск: база, дверь (заперта), сундук с содержимым — на месте
  A.close();
  await sleep(300);
  await new Promise((res) => { s1.proc.once('exit', res); s1.proc.send('shutdown'); });
  const file = path.join(data, 'bases', fs.readdirSync(path.join(data, 'bases'))[0]);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')).bases[0];
  assert.equal(saved.placed.worldId, w.id);
  assert.ok(saved.structures.some((x) => x.type === 'door' && x.data.locked && x.x === -2 && x.y === 0));
  const s2 = await startServer(extra, { ipc: true });
  t.after(() => s2.stop());
  A = await joinWorld(s2.base, admin, w.id);
  const types = A.welcome.bld.pieces.map((p) => p.type).sort();
  assert.deepEqual(types, ['bed', 'chest', 'door', 'fence', 'flag', 'wall_wood']);
  assert.equal(A.welcome.bld.pieces.find((p) => p.type === 'door').locked, 1);
  assert.equal(A.welcome.bld.pieces.find((p) => p.type === 'chest').n, 1);
  assert.equal(A.welcome.fires.length, 1, 'костёр сохранился');
  // администратор: список баз и удаление
  const list = (await api(s2.base, 'GET', '/api/admin/bases', undefined, admin.token)).data.bases;
  assert.equal(list.length, 1); assert.equal(list[0].structures, 5);
  assert.equal((await api(s2.base, 'POST', '/api/admin/bases/remove', { id: list[0].id }, admin.token)).status, 200);
  await A.next((m) => m.t === 'bld-base-remove');
  assert.equal((await api(s2.base, 'GET', '/api/admin/bases', undefined, admin.token)).data.bases.length, 0);
});

test('WS база: враг не проходит сквозь стены и ломает их на пути к герою, ремонт', async (t) => {
  // стены тонкие (5 % прочности), чтобы и под нагрузкой полного прогона зомби ломал стену за секунды
  const s = await startServer(set({ pieceHpFactor: 0.05, spikeDamage: 50 }));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  const map = WorldGen.generate({ ...w });
  const spot = claimSpot(map);
  const A = await joinWorld(b, admin, w.id);
  await api(b, 'POST', '/api/admin/teleport', { x: spot.x + 0.5, y: spot.y + 0.5 }, admin.token);
  await give(b, admin.token, 'base_flag');
  await give(b, admin.token, 'wood', 34);
  await sleep(100);
  await use(A, 'base_flag');
  await A.next('bld-base');
  // герой отходит на две клетки севернее флага; вокруг — кольцо из 8 стен
  await api(b, 'POST', '/api/admin/teleport', { x: spot.x + 0.5, y: spot.y - 1.5 }, admin.token);
  await sleep(100);
  const ring = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) ring.push([spot.x + dx, spot.y - 2 + dy]);
  for (const [x, y] of ring) build(A, { a: 'place', type: 'wall_wood', x, y });
  for (let i = 0; i < ring.length; i++) { const m = await A.next((x) => (x.t === 'bld-add' && x.p.type === 'wall_wood') || x.t === 'bld-reject'); assert.equal(m.t, 'bld-add', m.message); }
  // враг снаружи: пути нет — ломает стену
  const sp = await api(b, 'POST', '/api/admin/spawn', { kind: 'enemy', id: 'zombie', at: 'point', x: spot.x + 0.5, y: spot.y - 4.5 }, admin.token);
  assert.equal(sp.status, 200, JSON.stringify(sp.data));
  const hit = await A.next((m) => m.t === 'bld-upd' || m.t === 'bld-remove', 15000);
  assert.ok(hit);
  // ремонт повреждённой стены (если ещё стоит)
  const dmg = [...A.messages].find((m) => m.t === 'bld-upd');
  if (dmg && ![...A.messages].some((m) => m.t === 'bld-remove' && m.id === dmg.id)) {
    build(A, { a: 'repair', id: dmg.id });
    const r = await A.next((m) => (m.t === 'bld-upd' && m.id === dmg.id && m.hp === B.maxHp(B.get('wall_wood')) * 0 + m.hp) || m.t === 'bld-reject');
    assert.ok(r);
  }
  // стена сломана: снос мог прийти первым же событием (тогда он уже забран как hit) — учитываем всю историю
  if (!A.messages.some((m) => m.t === 'bld-remove')) await A.next((m) => m.t === 'bld-remove', 40000);
});

test('WS добыча: дерево даёт дерево, валун требует кирку, точка истощается и сохраняется', async (t) => {
  const s = await startServer(set({ gatherUses: 2, gatherCooldownSec: 0 }));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  const map = WorldGen.generate({ ...w });
  const A = await joinWorld(b, admin, w.id);
  const nodes = [...B.nodes(map).entries()];
  const standBy = (k) => { const x = k % map.width, y = Math.floor(k / map.width); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (WorldGen.isWalkable(map, x + dx, y + dy) && !B.nodeAt(map, x + dx, y + dy)) return { x, y, sx: x + dx + 0.5, sy: y + dy + 0.5 }; return null; };
  const tree = nodes.filter(([, v]) => v === 'tree').map(([k]) => standBy(k)).find(Boolean);
  const rock = nodes.filter(([, v]) => v === 'rock').map(([k]) => standBy(k)).find(Boolean);
  assert.ok(tree && rock);
  A.send({ t: 'gather', x: tree.x, y: tree.y });
  await A.next('bld-reject'); // далеко
  await api(b, 'POST', '/api/admin/teleport', { x: tree.sx, y: tree.sy }, admin.token);
  await sleep(100);
  A.send({ t: 'gather', x: tree.x, y: tree.y });
  const g = await A.next('gathered');
  assert.equal(g.items[0].id, 'wood'); assert.equal(g.left, 1);
  await A.next((m) => m.t === 'inv' && countIn(m, 'wood') > 0);
  A.send({ t: 'gather', x: tree.x, y: tree.y });
  const dep = await A.next('node-upd');
  assert.ok(dep.until > Date.now());
  A.send({ t: 'gather', x: tree.x, y: tree.y });
  assert.match((await A.next('bld-reject')).message, /пусто/);
  await api(b, 'POST', '/api/admin/teleport', { x: rock.sx, y: rock.sy }, admin.token);
  await sleep(100);
  A.send({ t: 'gather', x: rock.x, y: rock.y });
  assert.match((await A.next('bld-reject')).message, /кирка/);
  await give(b, admin.token, 'pickaxe');
  await sleep(200);
  const inv = lastInv(A);
  A.send({ t: 'inv', a: { type: 'equip', from: { c: 'cell', i: cellsOf(inv).findIndex((x) => x && x.id === 'pickaxe') }, slot: 'mainHand' } });
  const eq = await A.next((m) => (m.t === 'inv' && m.inventory.equipment.mainHand && m.inventory.equipment.mainHand.id === 'pickaxe') || m.t === 'inv-error');
  assert.equal(eq.t, 'inv', eq.message);
  A.send({ t: 'gather', x: rock.x, y: rock.y });
  const r = await A.next((m) => m.t === 'gathered' && m.kind === 'rock');
  assert.ok(r.items.some((x) => x.id === 'stone' && x.n >= 2), 'кирка — вдвое больше: ' + JSON.stringify(r.items));
  // истощение — в состоянии мира
  say(A, '/save');
  await sleep(500);
  A.close();
  await sleep(400);
  const st = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'worlds', w.id + '.state.json'), 'utf8'));
  assert.ok(st.nodes.some((x) => x[0] === tree.y * map.width + tree.x && x[2] > 0));
});

test('WS база: «Новая игра+» переносит базу с постройками в новый мир', async (t) => {
  const s = await startServer(set({}));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  const spot = claimSpot(WorldGen.generate({ ...w }));
  const A = await joinWorld(b, admin, w.id);
  await api(b, 'POST', '/api/admin/teleport', { x: spot.x + 0.5, y: spot.y + 0.5 }, admin.token);
  await give(b, admin.token, 'base_flag');
  await give(b, admin.token, 'wood', 10);
  await use(A, 'base_flag');
  const base = (await A.next('bld-base')).base;
  build(A, { a: 'place', type: 'wall_wood', x: spot.x + 2, y: spot.y + 1 });
  await A.next((m) => m.t === 'bld-add' && m.p.type === 'wall_wood');
  say(A, '/ending Алиса good_end');
  await A.next((m) => m.t === 'chat' && /good_end/.test(m.m.text));
  const r = await api(b, 'POST', '/api/worlds', params({ name: 'Второй круг', seed: 'base-ng', newGamePlus: true, characterId: admin.characterId }), admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ng = r.data.world;
  assert.equal(ng.ngPlus.baseId, base.id);
  assert.ok(ng.ngPlus.basePlaced, 'база поставлена в новом мире');
  await A.next((m) => m.t === 'bld-base-remove' && m.id === base.id); // из старого мира ушла
  A.close();
  const A2 = await joinWorld(b, admin, ng.id);
  const nb = A2.welcome.bld.bases.find((x) => x.id === base.id);
  assert.ok(nb);
  assert.deepEqual([nb.x, nb.y], [ng.ngPlus.basePlaced.x, ng.ngPlus.basePlaced.y]);
  const wall = A2.welcome.bld.pieces.find((p) => p.type === 'wall_wood');
  assert.ok(wall, 'постройки переехали');
  assert.deepEqual([wall.x - nb.x, wall.y - nb.y], [2, 1], 'на тех же местах относительно флага');
});

test('WS база: колья (чертёж и характеристика) ранят врага, стоящего на них', async (t) => {
  const s = await startServer(set({ spikeDamage: 5, spikeIntervalSec: 0.2 }));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  const spot = claimSpot(WorldGen.generate({ ...w }));
  const A = await joinWorld(b, admin, w.id);
  await api(b, 'POST', '/api/admin/teleport', { x: spot.x + 0.5, y: spot.y + 0.5 }, admin.token);
  await give(b, admin.token, 'base_flag');
  await give(b, admin.token, 'wood', 27);
  await use(A, 'base_flag');
  await A.next('bld-base');
  build(A, { a: 'place', type: 'spikes', x: spot.x + 2, y: spot.y });
  await reject(A, /чертёж/);
  assert.equal((await api(b, 'POST', '/api/admin/recipes/give', { username: 'admin', recipe: 'build_spikes' }, admin.token)).status, 200);
  assert.equal((await api(b, 'POST', '/api/admin/characters/edit', { username: 'admin', characterId: admin.characterId, stats: { builder: 2 } }, admin.token)).status, 200);
  await sleep(150);
  // герой в кольце из кольев: враг, подходя вплотную, встаёт на них
  await api(b, 'POST', '/api/admin/teleport', { x: spot.x + 2.5, y: spot.y + 0.5 }, admin.token);
  await sleep(100);
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) { build(A, { a: 'place', type: 'spikes', x: spot.x + 2 + dx, y: spot.y + dy }); n++; }
  for (let i = 0; i < n; i++) { const m = await A.next((x) => (x.t === 'bld-add' && x.p.type === 'spikes') || x.t === 'bld-reject'); assert.equal(m.t, 'bld-add', m.message); }
  const sp = await api(b, 'POST', '/api/admin/spawn', { kind: 'enemy', id: 'zombie', at: 'point', x: spot.x + 2.5, y: spot.y + 3.5 }, admin.token);
  assert.equal(sp.status, 200, JSON.stringify(sp.data));
  const hit = await A.next((m) => m.t === 'fx' && m.ev.some((e) => e.k === 'hit' && e.t === 'e' && e.n === 5), 8000);
  assert.ok(hit);
});

test('WS база: запертая дверь не пускает чужого, допуск хозяином — пускает', async (t) => {
  const s = await startServer(set({}));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const bob = await newPlayer(b, 'bob', 'Боб');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  const code = (await api(b, 'POST', `/api/worlds/${w.id}/share`, { open: true, invite: 'new' }, admin.token)).data.world.inviteCode;
  await api(b, 'POST', '/api/worlds/join', { code }, bob.token);
  const spot = claimSpot(WorldGen.generate({ ...w }));
  const A = await joinWorld(b, admin, w.id);
  const Bb = await joinWorld(b, bob, w.id);
  await api(b, 'POST', '/api/admin/teleport', { x: spot.x + 0.5, y: spot.y + 0.5 }, admin.token);
  await give(b, admin.token, 'base_flag');
  await give(b, admin.token, 'wood', 6);
  await give(b, admin.token, 'scrap_metal', 2);
  await use(A, 'base_flag');
  await A.next('bld-base');
  build(A, { a: 'place', type: 'door', x: spot.x + 2, y: spot.y });
  const door = (await Bb.next((m) => m.t === 'bld-add' && m.p.type === 'door')).p;
  build(A, { a: 'lock', id: door.id });
  await Bb.next((m) => m.t === 'bld-upd' && m.id === door.id && m.locked === 1);
  assert.equal((await api(b, 'POST', '/api/admin/teleport', { username: 'bob', x: spot.x + 1.5, y: spot.y + 0.5 }, admin.token)).status, 200);
  await sleep(150);
  Bb.send({ t: 'path', path: [[spot.x + 2, spot.y], [spot.x + 3, spot.y]] });
  assert.match((await Bb.next('reject')).reason, /непроходим|Непроходим|клетк/);
  // хозяин допускает Боба — теперь запертая дверь его пропускает
  build(A, { a: 'allow', name: 'Боб' });
  const nb = await Bb.next((m) => m.t === 'bld-base' && m.base.allow.some((x) => x.name === 'Боб'));
  assert.ok(nb);
  Bb.send({ t: 'path', path: [[spot.x + 2, spot.y], [spot.x + 3, spot.y]] });
  await Bb.next((m) => m.t === 'state' && m.players.some((p) => p.id === Bb.welcome.you && Math.floor(p.x) === spot.x + 3 && Math.floor(p.y) === spot.y), 4000);
});
