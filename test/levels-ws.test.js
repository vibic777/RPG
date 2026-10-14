'use strict';
// Шаг 13 по WebSocket: переходы через входы (сервер решает), свои враги/предметы/игроки на уровне, тайники,
// сохранение уровня после перезахода, удушье под водой и возрождение на поверхности, акваланг, баллон,
// падение с крыши, плавание, дракон и воздушные уровни, лифт на дно бункера, телепорт администратора на уровень.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');
const G = require('../shared/worldgen');
const L = require('../shared/levels');

const SEED = 'levels-ws-1';
const params = (o = {}) => ({ name: 'Уровни', seed: SEED, size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false, ...o });
const set = (o) => Object.entries({
  survivalFoodPerMin: 0, survivalWaterPerMin: 0, survivalRestPerMin: 0, chatRateCount: 200, stunChance: 0, depotsPer256: 0, respawnSec: 0, ...o,
}).flatMap(([k, v]) => ['--set', `game.${k}=${v}`]);
const say = (c, text) => c.send({ t: 'chat', text });
const welcomeOf = (c, pred = () => true) => c.next((m) => m.t === 'welcome' && pred(m), 8000);

test('WS уровни: вход и выход, изоляция уровня, тайники, сохранение, удушье, акваланг, баллон, падение, плавание, дракон, ГМ', async (t) => {
  const s = await startServer(set({ breathSec: 3, drownDamagePct: 60, depotsPer256: 0 }));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const bob = await newPlayer(b, 'bob', 'Боб');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  L.configure({ depotsPer256: 0 });
  G.configure({ depotsPer256: 0 });
  const map = G.generate({ ...w }); // как клиент: по записи мира (форма карты, водоёмы)
  assert.equal(G.mapHash(map), w.mapHash, 'клиентская карта совпадает с серверной');
  const ents = L.entrances(map);
  const bunker = ents.find((e) => e.type === 'bunker' && e.depth >= 2);
  const sea = ents.find((e) => e.type === 'underwater' && e.depth >= 2) || ents.find((e) => e.type === 'underwater');
  const tower = ents.find((e) => e.type === 'tower');
  const lift = ents.find((e) => e.kind === 'elevator');
  assert.ok(bunker && sea && tower);

  let A = await joinWorld(b, admin, w.id);
  assert.equal(A.welcome.level, null);
  assert.equal(A.welcome.z, 0);
  const tp = async (c, body) => { const r = await api(b, 'POST', '/api/admin/teleport', body, admin.token); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };

  // далеко от входа — отказ
  A.send({ t: 'lvl-go' });
  assert.match((await A.next('lvl-reject', 5000)).message, /Рядом нет входа/);
  // лифт (шаг 14): сразу на самый нижний уровень бункера
  if (lift) {
    await tp(A, { x: lift.x + 0.5, y: lift.y + 0.5 });
    await A.next('teleported');
    A.send({ t: 'lvl-go' });
    const deep = L.entranceById(map, lift.of);
    const wl = await A.next('welcome', 5000);
    assert.equal(wl.level.key, `${deep.id}.${deep.depth}`);
    await tp(A, { level: 'ground', x: lift.x + 3, y: lift.y });
    await A.next('welcome', 5000);
  }
  // Боб в мире на поверхности
  const code = (await api(b, 'POST', `/api/worlds/${w.id}/share`, { open: true, invite: 'new' }, admin.token)).data.world.inviteCode;
  assert.equal((await api(b, 'POST', '/api/worlds/join', { code }, bob.token)).status, 200);
  const B = await joinWorld(b, bob, w.id);
  assert.ok(B.welcome.players.some((p) => p.id === A.welcome.you));

  // вход в бункер: люк → уровень 1 (z −1), враги и тайники генератора, Боб Алису больше не видит
  await tp(A, { x: bunker.x + 0.5, y: bunker.y + 0.5 });
  await A.next('teleported');
  A.send({ t: 'lvl-go' });
  const w1 = await Promise.race([welcomeOf(A), A.next('lvl-reject', 7000).then((m) => { throw new Error('отказ: ' + m.message); })]);
  assert.equal(w1.level.key, bunker.id + '.1');
  assert.equal(w1.z, -1);
  const lv1 = L.level(map, bunker.id + '.1');
  assert.ok(w1.enemies.length >= lv1.spots.length, 'уровень заселён врагами');
  assert.ok(w1.enemies.every((e) => L.TYPES.bunker.enemies.includes(e.type)));
  assert.ok(w1.ground.length > 0 && w1.ground.some((g) => g.by === 'Тайник' || g.from === 'Тайник' || JSON.stringify(g).includes('Тайник')), 'тайник с добычей');
  assert.ok(Math.hypot(w1.players.find((p) => p.id === w1.you).x - (lv1.spawn.x + 0.5), w1.players.find((p) => p.id === w1.you).y - (lv1.spawn.y + 0.5)) < 5, 'у входа уровня');
  const left = await B.next((m) => m.t === 'leave' && m.id === A.welcome.you, 5000);
  assert.equal(left.reason, 'level');
  await sleep(300);
  B.drain();
  const st = await B.next('state', 3000);
  assert.ok(!st.players.some((p) => p.id === A.welcome.you), 'другой уровень — не виден');
  assert.ok(!st.e || !st.e.length, 'враги подземелья не видны на поверхности');
  // чат общий для всего мира
  say(B, 'привет снизу?');
  assert.equal((await A.next((m) => m.t === 'chat' && m.m.text && m.m.text.includes('привет'), 5000)).m.channel || 'world', 'world');
  // базу на уровне не объявить — проверка серверная, нужен флаг; достаточно, что уровень не поверхность
  // спуск глубже: выход «вниз» → уровень 2, и обратно
  const down = lv1.exits.find((x) => x.kind === 'down');
  await tp(A, { x: down.x + 0.5, y: down.y + 0.5 });
  await A.next('teleported');
  A.send({ t: 'lvl-go' });
  const w2 = await welcomeOf(A);
  assert.equal(w2.level.key, bunker.id + '.2');
  assert.equal(w2.z, -2);
  const lv2 = L.level(map, bunker.id + '.2');
  if (bunker.depth === 2) assert.ok(w2.enemies.some((e) => e.type === L.TYPES.bunker.boss), 'босс на самом дне');
  const avg = (list) => list.reduce((a, e) => a + e.lvl, 0) / list.length;
  assert.ok(avg(w2.enemies) > avg(w1.enemies), 'глубже — сильнее');
  // перезаход: снова на уровне 2 (сохранение по уровню), враги сохранились
  const killedBefore = w2.enemies.length;
  await A.close();
  await sleep(300);
  A = await joinWorld(b, admin, w.id);
  assert.equal(A.welcome.level.key, bunker.id + '.2', 'после перезахода — тот же уровень');
  assert.ok(Math.abs(A.welcome.enemies.length - killedBefore) <= 1);
  // выход наверх: уровень 1 у прохода вниз, затем на поверхность к люку
  A.send({ t: 'lvl-go' });
  const up1 = await welcomeOf(A);
  assert.equal(up1.level.key, bunker.id + '.1');
  const me1 = up1.players.find((p) => p.id === up1.you);
  assert.ok(Math.hypot(me1.x - (down.x + 0.5), me1.y - (down.y + 0.5)) < 3, 'вернулись к проходу вниз');
  assert.ok(up1.ground.length > 0, 'предметы уровня сохранились');
  await tp(A, { x: lv1.spawn.x + 0.5, y: lv1.spawn.y + 0.5 });
  await A.next('teleported');
  A.send({ t: 'lvl-go' });
  const g0 = await welcomeOf(A);
  assert.equal(g0.level, null);
  const me0 = g0.players.find((p) => p.id === g0.you);
  assert.ok(Math.hypot(me0.x - (bunker.x + 0.5), me0.y - (bunker.y + 0.5)) < 4, 'на поверхности у люка');
  assert.ok(g0.players.some((p) => p.id === B.welcome.you), 'снова вместе с Бобом');
  await B.next((m) => m.t === 'join' && m.player.id === g0.you && m.level === 1, 5000);

  // под воду: без акваланга — только первый уровень; воздух кончается — удушье, смерть, возрождение на суше
  await tp(A, { level: sea.id + '.1' });
  const u1 = await welcomeOf(A);
  assert.equal(u1.level.key, sea.id + '.1');
  assert.equal(u1.level.underwater, 1);
  const lvU = L.level(map, sea.id + '.1');
  const lvMsg = await A.next((m) => m.t === 'lv' && m.u === 1 && m.b < m.bm, 6000);
  assert.equal(lvMsg.bm, 3);
  if (sea.depth >= 2) {
    const dn = lvU.exits.find((x) => x.kind === 'down');
    await tp(A, { x: dn.x + 0.5, y: dn.y + 0.5 });
    await A.next('teleported');
    A.send({ t: 'lvl-go' });
    assert.match((await A.next('lvl-reject', 5000)).message, /акваланг/);
  }
  const dead = await A.next('dead', 10000);
  assert.ok(dead);
  A.send({ t: 'respawn' });
  const out = await welcomeOf(A);
  assert.equal(out.level, null, 'возрождение — на поверхности');
  // акваланг: больше воздуха и можно глубже; баллон пополняет воздух
  for (const [item, n] of [['face_scuba', 1], ['air_tank', 2]]) assert.equal((await api(b, 'POST', '/api/admin/items/give', { username: 'admin', item, count: n }, admin.token)).status, 200);
  const inv = await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'face_scuba') && m.inventory.cells.some((x) => x && x.id === 'air_tank'), 6000);
  A.send({ t: 'inv', a: { type: 'equip', from: { c: 'cell', i: inv.inventory.cells.findIndex((x) => x && x.id === 'face_scuba') }, slot: 'face' } });
  const inv2 = await A.next((m) => m.t === 'inv' && m.inventory.equipment.face && m.inventory.equipment.face.id === 'face_scuba', 6000);
  const tankAt = inv2.inventory.cells.findIndex((x) => x && x.id === 'air_tank');
  A.send({ t: 'inv', a: { type: 'use', from: { c: 'cell', i: tankAt } } });
  assert.match((await A.next('inv-error', 5000)).message, /под водой/);
  await A.next((m) => m.t === 'lv' && m.u === 0 && m.b > 20, 8000); // на суше воздух восстанавливается
  await tp(A, { level: sea.id + '.1' });
  await welcomeOf(A);
  const sc = await A.next((m) => m.t === 'lv' && m.u === 1 && m.bm === 3 + L.settings.scubaBreathSec, 6000);
  assert.ok(sc.b > 3);
  await sleep(1300);
  A.send({ t: 'inv', a: { type: 'use', from: { c: 'cell', i: tankAt } } });
  await A.next((m) => m.t === 'inv' && (m.inventory.cells[tankAt] || { n: 0 }).n === 1, 6000);
  if (sea.depth >= 2) {
    const dn = lvU.exits.find((x) => x.kind === 'down');
    await tp(A, { x: dn.x + 0.5, y: dn.y + 0.5 });
    await A.next('teleported');
    A.send({ t: 'lvl-go' });
    assert.equal((await welcomeOf(A)).z, -2, 'с аквалангом — глубже');
  }

  // крыша башни: прыжок с края — урон от падения, приземление у башни
  await tp(A, { level: tower.id + '.1' });
  const wt = await welcomeOf(A);
  assert.equal(wt.z, 1);
  const lvT = L.level(map, tower.id + '.1');
  const edge = lvT.exits.find((x) => x.kind === 'jump');
  await tp(A, { x: edge.x + 0.5, y: edge.y + 0.5 });
  await A.next('teleported');
  A.send({ t: 'lvl-go' });
  const wg = await welcomeOf(A);
  assert.equal(wg.level, null);
  const fallMsg = await A.next((m) => m.t === 'chat' && /Урон от падения: \d+/.test(m.m.text || ''), 5000);
  const mhp = (await A.next('me', 5000)).mhp;
  const fd = Number(/Урон от падения: (\d+)/.exec(fallMsg.m.text)[1]);
  assert.ok(fd >= 5 && fd <= Math.round(mhp * L.settings.fallDamagePct / 100) + 1, 'урон от падения — 1 уровень высоты: ' + fd); // макс. здоровье зависит от шкал выживания

  // плавание: полёт ГМ — на воду; выносливость тает
  A.send({ t: 'gm', a: 'god', god: { fly: true } });
  await A.next('god');
  let wx = -1, wy = -1;
  for (let y = 2; y < map.height - 2 && wx < 0; y++) for (let x = 2; x < map.width - 2; x++) if (map.tiles[y * map.width + x] === G.B.WATER && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => G.BIOMES[map.tiles[(y + dy) * map.width + x + dx]].walkable)) { wx = x; wy = y; break; }
  await tp(A, { x: wx + 0.5, y: wy + 0.5 });
  await A.next('teleported');
  const swim = await A.next((m) => m.t === 'lv' && m.sw === 1, 6000);
  assert.equal(swim.z, 0);
  A.send({ t: 'gm', a: 'god', god: { fly: false } });

  // дракон: без дракона в небо нельзя; верхом — PageUp/PageDown, слезть в воздухе нельзя (airDismount=block)
  A.send({ t: 'lvl-alt', d: 1 });
  assert.match((await A.next('lvl-reject', 5000)).message, /дракон/);
  await tp(A, { x: bunker.x + 0.5, y: bunker.y + 0.5 });
  await A.next('teleported');
  const give = await api(b, 'POST', '/api/admin/companions/spawn', { username: 'admin', def: 'dragon_fire', level: 12 }, admin.token);
  assert.equal(give.status, 200, JSON.stringify(give.data));
  await sleep(300);
  A.send({ t: 'comp', a: 'mount' });
  const mnt = await A.next((m) => m.t === 'comp-mount' && m.id, 6000);
  assert.equal(mnt.fly, 1);
  A.send({ t: 'lvl-alt', d: 1 });
  assert.equal((await A.next((m) => m.t === 'lvl-alt' && m.id === A.welcome.you, 5000)).alt, 1);
  assert.equal((await A.next((m) => m.t === 'lv' && m.alt === 1, 5000)).z, 1, 'высота полёта — прямо z: +1 — среди домов и деревьев');
  const stA = await B.next((m) => m.t === 'state' && m.players.some((p) => p.id === A.welcome.you && p.a === 1), 5000);
  assert.ok(stA);
  A.send({ t: 'lvl-go' });
  assert.match((await A.next('lvl-reject', 5000)).message, /снизьтесь/);
  A.send({ t: 'comp', a: 'mount' }); // повторно — слезть
  assert.match((await A.next('comp-reject', 5000)).message, /В воздухе/);
  for (let i = 0; i < 12; i++) A.send({ t: 'lvl-alt', d: 1 }); // потолок — L.airTop() = +10
  await sleep(400);
  A.drain();
  A.send({ t: 'lvl-alt', d: 1 });
  assert.match((await A.next('lvl-reject', 5000)).message, /Выше не подняться/);
  assert.equal(L.airTop(), 10);
  for (let i = 0; i < 10; i++) A.send({ t: 'lvl-alt', d: -1 });
  await A.next((m) => m.t === 'lvl-alt' && m.alt === 0, 5000);
  A.send({ t: 'comp', a: 'mount' });
  await A.next((m) => m.t === 'comp-mount' && !m.id, 5000);

  // ГМ: /level по z и по ключу, телепорт к игроку на другой уровень
  say(A, '/level -2');
  assert.equal((await welcomeOf(A)).z, -2);
  const rB = await api(b, 'POST', '/api/admin/teleport', { username: 'bob', to: 'admin' }, admin.token);
  assert.equal(rB.status, 200, JSON.stringify(rB.data));
  assert.equal((await welcomeOf(B)).z, -2, 'Боб перенесён к Алисе на её уровень');
  const players = (await api(b, 'GET', '/api/admin/players', undefined, admin.token)).data.players;
  assert.ok(players.filter((p) => p.online).every((p) => p.online.z === -2 && p.online.levelKey), 'в списке игроков ГМ — уровень');
  say(A, '/level ground');
  assert.equal((await welcomeOf(A)).level, null);
  assert.equal((await api(b, 'POST', '/api/admin/teleport', { level: 'zz9.1' }, admin.token)).status, 404);
  say(B, '/level -1');
  assert.match((await B.next((m) => m.t === 'chat' && /Вы здесь/.test(m.m.text || ''), 5000)).m.text, /глубина 2 \(-2\)/, 'не администратору /level только показывает уровень');
  await A.close(); await B.close();
});
