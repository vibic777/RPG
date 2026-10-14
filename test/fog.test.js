'use strict';
// Шаг 22: туман войны (битовая карта, RLE, радиус обзора, сохранение, отсечение по обзору, общая разведка, читы) и камера (границы, слежение, возврат)
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');
const Fog = require('../shared/fog');
const Camera = require('../shared/camera');

test('туман: битовая карта — разведка круга, подсчёт, RLE + base64 туда и обратно, битые строки', () => {
  const w = 300, h = 200, b = Fog.create(w, h);
  const r1 = Fog.reveal(b, w, h, 10.5, 10.5, 5);
  assert.ok(r1.n > 70 && r1.n < 90, 'круг r=5 ≈ 78 клеток');
  assert.deepEqual([r1.x0, r1.y0, r1.x1, r1.y1], [5, 5, 15, 15]);
  assert.equal(Fog.reveal(b, w, h, 10.5, 10.5, 5).n, 0, 'повторно — ничего нового');
  assert.equal(Fog.count(b), r1.n);
  Fog.reveal(b, w, h, 299, 199, 3); // у края карты — без выхода за границы
  const s = Fog.encode(b, w, h);
  assert.ok(s.length < 200, 'компактно: ' + s.length);
  assert.deepEqual(Fog.decode(s, w, h), b);
  assert.equal(Fog.count(Fog.decode(s, w, h + 1)), 0, 'другой размер — пустая карта');
  assert.equal(Fog.count(Fog.decode('мусор!!', w, h)), 0);
  assert.equal(Fog.count(Fog.decode(undefined, w, h)), 0);
  const full = Fog.create(256, 256).fill(255);
  assert.ok(Fog.encode(full, 256, 256).length <= 8, 'вся карта — несколько байт');
  assert.equal(Fog.count(Fog.decode(Fog.encode(full, 256, 256), 256, 256)), 65536);
  const c = Fog.create(w, h); Fog.reveal(c, w, h, 50, 50, 4);
  assert.ok(Fog.or(c, b) > 0 && Fog.get(c, 10 * w + 10) === 1, 'слияние разведанного (совместная игра)');
});

test('туман: видимость и радиус обзора — день, ночь, подземелье; настройки', () => {
  const save = { ...Fog.settings };
  try {
    Fog.configure({ fogRadius: 10, fogNightMul: 0.5, fogUndergroundMul: 0.4, fogMode: 'explored', fogShared: false });
    assert.equal(Fog.mode(), 'explored');
    assert.equal(Fog.radiusAt({ phase: 0.5, z: 0 }), 10, 'полдень');
    assert.equal(Fog.radiusAt({ phase: 0, z: 0 }), 5, 'полночь');
    assert.ok(Fog.radiusAt({ phase: 0.25, z: 0 }) > 5 && Fog.radiusAt({ phase: 0.25, z: 0 }) <= 10, 'сумерки — между');
    assert.equal(Fog.radiusAt({ phase: 0, z: -2 }), 4, 'под землёй');
    assert.equal(Fog.radiusAt({ phase: 0, z: 1 }), 10, 'наверху — без ночи');
    Fog.configure({ fogMode: 'чепуха' });
    assert.equal(Fog.mode(), 'explored', 'неизвестный режим не принимается');
    assert.ok(Fog.visible(0, 0, 3, 4, 5) && !Fog.visible(0, 0, 3, 4.1, 5));
  } finally { Object.assign(Fog.settings, save); }
  const { DEFAULTS, DESCRIPTIONS } = require('../server/config');
  for (const k of ['fogMode', 'fogRadius', 'fogNightMul', 'fogUndergroundMul', 'fogShared', 'fogServerCull', 'fogDimAlpha', 'cameraPanSpeed', 'cameraSmoothSec', 'cameraEdgeScroll', 'cameraEdgePx', 'cameraFollowDefault']) {
    assert.ok(k in DEFAULTS.game, k);
    assert.ok(DESCRIPTIONS['game.' + k], 'описание для --help: ' + k);
  }
});

test('камера: слежение, свободный обзор (сдвиг выключает слежение), границы мира, возврат к герою, переключатель, край экрана', () => {
  const save = { ...Camera.settings };
  try {
    Camera.configure({ cameraSmoothSec: 0, cameraPanSpeed: 10, cameraFollowDefault: true });
    const c = Camera.create({ w: 100, h: 80 });
    const hero = { x: 30, y: 30 };
    c.snap(hero);
    assert.deepEqual(c.update(0.1, { x: 31, y: 30 }), { x: 31, y: 30 }, 'за героем');
    c.update(0.5, hero, { up: true });
    assert.equal(c.follow, false, 'клавиши обзора выключают слежение');
    assert.ok(c.x < 31 && c.y < 30, 'вверх по экрану — к меньшим x и y');
    c.update(0.1, { x: 50, y: 50 });
    assert.ok(c.x < 31, 'герой ушёл — камера стоит');
    c.pan(-1000, 1000);
    c.update(0.1, hero);
    assert.deepEqual([c.x, c.y], [0, 80], 'не дальше края мира');
    c.lookAt(500, -5, true);
    assert.deepEqual([c.x, c.y], [100, 0]);
    c.recenter(hero);
    assert.equal(c.follow, true);
    c.update(0.1, hero);
    assert.deepEqual([c.x, c.y], [30, 30], 'возврат к герою');
    assert.equal(c.toggleFollow(hero), false);
    c.update(0.1, { x: 40, y: 40 });
    assert.deepEqual([c.x, c.y], [30, 30], 'слежение выключено — камера на месте');
    assert.equal(c.toggleFollow({ x: 40, y: 40 }), true);
    c.update(0.1, { x: 40, y: 40 });
    assert.deepEqual([c.x, c.y], [40, 40]);
    const d = Camera.screenToWorldDelta(64, 0, 32, 16);
    assert.deepEqual(d, { x: 1, y: -1 }, 'вправо по экрану');
    Camera.configure({ cameraSmoothSec: 0.2 });
    const s = Camera.create({ w: 100, h: 100 }); s.snap({ x: 0, y: 0 });
    s.update(0.05, { x: 10, y: 0 });
    assert.ok(s.x > 0 && s.x < 10, 'плавно');
    assert.deepEqual(Camera.edgeDirs(5, 300, 800, 600, 12), { left: true, right: false, up: false, down: false });
    assert.equal(Camera.edgeDirs(null, null, 800, 600), null);
  } finally { Object.assign(Camera.settings, save); }
});

const params = (seed) => ({ name: 'Туман', seed, size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false });
const SET = ['--set', 'game.fogNightMul=1', '--set', 'game.survivalFoodPerMin=0', '--set', 'game.survivalWaterPerMin=0'];
async function cheat(C, msg) {
  C.drain();
  C.send({ t: 'cheat', ...msg });
  const m = await C.next((x) => x.t === 'cheat-ok' || x.t === 'cheat-err', 4000);
  assert.ok(m.t === 'cheat-ok', m.message);
  return m;
}
const enemyIds = async (C) => { C.drain(); const ids = new Set(); for (let i = 0; i < 6; i++) { const st = await C.next((m) => m.t === 'state' && m.e, 3000); for (const r of st.e) ids.add(r[0]); } return ids; };

test('WS туман: разведанное в welcome и в сохранении героя, отсечение врагов вне обзора, «без тумана», открыть карту, общая разведка', async (t) => {
  const s = await startServer(SET);
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const bob = await newPlayer(b, 'bob', 'Боб');
  const w = (await api(b, 'POST', '/api/worlds', params('fog-1'), admin.token)).data.world;
  await api(b, 'POST', `/api/worlds/${w.id}/share`, { open: true }, admin.token);
  const code = (await api(b, 'POST', `/api/worlds/${w.id}/share`, { invite: 'new' }, admin.token)).data.world.inviteCode;
  await api(b, 'POST', '/api/worlds/join', { code }, bob.token);
  let A = await joinWorld(b, admin, w.id);
  const f = A.welcome.fog, W = w.width || A.welcome.map?.width;
  assert.equal(f.mode, 'on');
  assert.equal(f.radius, 12);
  const me = A.welcome.players.find((p) => p.id === A.welcome.you);
  const size = (await api(b, 'GET', `/api/worlds/${w.id}`, undefined, admin.token)).data.world;
  const mw = size.width || size.map?.width || W, mh = size.height || size.map?.height;
  let bits = Fog.decode(f.explored, mw, mh);
  assert.ok(Fog.count(bits) > 300 && Fog.get(bits, Math.floor(me.y) * mw + Math.floor(me.x)), 'вокруг героя разведано');
  // враг в 6 клетках виден, в 25 — нет (радиус 12)
  const G=require('../shared/worldgen'),M=require('../shared/movement');require('../shared/houses');require('../shared/settlements');const map=G.generate(w);
  const free=radius=>{const spots=[];for(let y=1;y<mh-1;y++)for(let x=1;x<mw-1;x++){const p={x:x+.5,y:y+.5},d=Math.hypot(p.x-me.x,p.y-me.y);if(Math.abs(d-radius)<2&&!M.validatePosition(map,p))spots.push(p);}assert.ok(spots.length,'free enemy spawn on the requested visibility ring');return spots[0];};
  const near = (await cheat(A, { a: 'spawn', kind: 'enemy', id: 'zombie', ...free(6) })).ids[0];
  const far = (await cheat(A, { a: 'spawn', kind: 'enemy', id: 'zombie', ...free(25) })).ids[0];
  let ids = await enemyIds(A);
  assert.ok(ids.has(near) && !ids.has(far), 'вне обзора — не отправляется');
  await cheat(A, { a: 'god', god: { nofog: true } });
  ids = await enemyIds(A);
  assert.ok(ids.has(far), '«без тумана» — видно всё в радиусе интереса');
  await cheat(A, { a: 'god', god: { nofog: false } });
  // телепорт — новое разведанное; выход и вход — сохранилось
  const tx = Math.max(15, Math.min(mw - 15, me.x - 30)), ty = Math.max(15, Math.min(mh - 15, me.y + 30));
  await cheat(A, { a: 'god', god: { noclip: true } });
  await cheat(A, { a: 'tp', x: tx, y: ty });
  await sleep(300);
  await A.close();
  await sleep(300);
  A = await joinWorld(b, admin, w.id);
  bits = Fog.decode(A.welcome.fog.explored, mw, mh);
  assert.ok(Fog.get(bits, Math.floor(me.y) * mw + Math.floor(me.x)), 'старое место — в сохранении');
  assert.ok(Fog.get(bits, Math.floor(ty) * mw + Math.floor(tx)), 'новое место — в сохранении');
  // общая разведка: второй игрок получает fog-merge (своё слито) и fog-reveal, когда первый открывает новое
  const B = await joinWorld(b, bob, w.id);
  const bb = Fog.decode(B.welcome.fog.explored, mw, mh);
  assert.ok(Fog.get(bb, Math.floor(ty) * mw + Math.floor(tx)), 'общая карта: Боб видит разведанное Алисой');
  B.drain();
  await cheat(A, { a: 'tp', x: Math.max(15, tx - 25), y: Math.max(15, ty - 25) });
  const rv = await B.next('fog-reveal', 4000);
  assert.ok(rv.r === 12 && Math.abs(rv.x - Math.max(15, tx - 25)) < 2);
  // открыть карту (чит) — всем в мире fog-merge со всей картой
  B.drain();
  await cheat(A, { a: 'reveal', who: B.welcome.you });
  assert.equal(Fog.count(Fog.decode((await B.next('fog-merge', 4000)).explored, mw, mh)), mw * mh);
  await B.close();
  await A.close();
});
