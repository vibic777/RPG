'use strict';
// Шаг 20: производительность клиента — ограничение FPS, простой, автокачество, батарея, оверлей; кэш земли и спрайтов, отсечение
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const WorldGen = require('../shared/worldgen.js');
const Items = require('../shared/items.js');
const Enemies = require('../shared/enemies.js');
const Art = require('../shared/art.js');

const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'client', 'js', f)).href);
// rAF с частотой hz в течение ms: сколько кадров разрешено нарисовать
function run(gov, hz, ms, t0 = 0, active = true) {
  let n = 0;
  for (let t = t0; t < t0 + ms; t += 1000 / hz) { if (active) gov.touch(t); if (gov.shouldDraw(t)) { n++; gov.drawn(t, 2); } }
  return n;
}

test('кадры: ограничение 30/60/без, простой, частые мониторы', async () => {
  const { FrameGovernor } = await load('game/perf.js');
  assert.ok(Math.abs(run(new FrameGovernor({ cap: 60 }), 60, 2000) - 120) <= 2, '60 Гц, предел 60');
  assert.ok(Math.abs(run(new FrameGovernor({ cap: 30 }), 60, 2000) - 60) <= 2, '60 Гц, предел 30');
  const hi = run(new FrameGovernor({ cap: 60 }), 144, 2000);
  assert.ok(hi >= 100 && hi <= 122, '144 Гц, предел 60: ' + hi);
  assert.ok(Math.abs(run(new FrameGovernor({ cap: 0 }), 144, 1000) - 144) <= 2, 'без ограничения — каждый rAF');
  // простой: без ввода и движения через idleAfterSec — fpsIdle
  const g = new FrameGovernor({ cap: 60, idleFps: 10, idleAfterSec: 1 });
  g.touch(0);
  run(g, 60, 1000, 0, false);
  assert.ok(g.idle(1500));
  const idle = run(g, 60, 2000, 1500, false);
  assert.ok(idle >= 18 && idle <= 22, 'в простое ~10 кадров в секунду: ' + idle);
  g.touch(3600);
  assert.ok(!g.idle(3700) && g.target(3700) === 60, 'ввод — снова 60');
  assert.equal(new FrameGovernor({ cap: 0, idleFps: 15 }).target(1e9), 15, 'простой и без ограничения');
});

test('кадры: автокачество снижает ступень при низком FPS, но не в простое и не из-за своего предела', async () => {
  const { FrameGovernor } = await load('game/perf.js');
  const g = new FrameGovernor({ cap: 60, autoFps: 24, lowSec: 2, cooldownSec: 5 });
  let q = 'high', changes = [];
  for (let t = 0; t < 20000; t += 1000 / 15) { // 15 FPS
    g.touch(t); g.shouldDraw(t); g.drawn(t, 30);
    if (Math.round(t) % 1000 < 67) { const nq = g.autoCheck(t, q, Art.lowerQuality); if (nq) { changes.push([Math.round(t), nq]); q = nq; } }
  }
  assert.deepEqual(changes.map((c) => c[1]), ['medium', 'low'], 'две ступени: ' + JSON.stringify(changes));
  assert.ok(changes[1][0] - changes[0][0] >= 5000, 'пауза между снижениями');
  const capped = new FrameGovernor({ cap: 30, autoFps: 30, lowSec: 1 });
  for (let t = 0; t < 8000; t += 1000 / 20) { capped.touch(t); capped.drawn(t); assert.equal(capped.autoCheck(t, 'high', Art.lowerQuality), null); }
  const idle = new FrameGovernor({ cap: 60, autoFps: 24, lowSec: 1, idleAfterSec: 1 });
  for (let t = 5000; t < 12000; t += 100) { idle.drawn(t); assert.equal(idle.autoCheck(t, 'high', Art.lowerQuality), null, 'простой — не снижать'); }
  assert.equal(new FrameGovernor({ autoFps: 0 }).autoCheck(1e6, 'high', Art.lowerQuality), null, 'выключено');
});

test('кадры: батарея и текст оверлея', async () => {
  const { watchBattery, overlayText } = await load('game/perf.js');
  assert.equal(await watchBattery(() => assert.fail('без API не зовётся'), {}), false);
  const ls = {}; const bat = { charging: false, addEventListener: (k, f) => { ls[k] = f; } };
  const seen = [];
  assert.equal(await watchBattery((on) => seen.push(on), { getBattery: async () => bat }), true);
  bat.charging = true; ls.chargingchange();
  assert.deepEqual(seen, [true, false]);
  const t = overlayText({ fps: 58, cap: 60, idle: false, frameMs: 4.25, ping: 12.4, srv: { tickMs: 0.8, tickMax: 2.1, kbps: 3.2, awake: 5, enemies: 160, errors: 0 }, quality: 'среднее', saver: true, chunks: 12 });
  for (const part of ['FPS 58/60', 'кадр 4.3 мс', 'пинг 12 мс', 'тик 0.8/2.1 мс', '3.2 КБ/с', 'враги 5/160', 'качество: среднее (батарея)', 'фрагменты 12']) assert.ok(t.includes(part), part + ' в «' + t + '»');
});

// ---------- рендер на заглушке canvas: кэш земли фрагментами, спрайты объектов, предел плотности пикселей ----------
function mockCtx(calls) {
  const t = { createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), measureText: (s) => ({ width: String(s).length * 6 }) };
  return new Proxy(t, { get: (o, k) => (k in o ? o[k] : (o[k] = () => { calls[k] = (calls[k] || 0) + 1; })), set: (o, k, v) => { o[k] = v; return true; } });
}
const calls = {};
let canvases = 0;
const mockCanvas = (w = 1280, h = 720) => ({ width: w, height: h, clientWidth: w, clientHeight: h, getContext: () => mockCtx(calls), addEventListener() {}, style: {} });
globalThis.Path2D = globalThis.Path2D || class { moveTo() {} lineTo() {} closePath() {} };
globalThis.window = globalThis.window || {};
globalThis.document = { createElement: () => { canvases++; return mockCanvas(1, 1); } };
Object.assign(globalThis.window, { WorldGen, Items, Enemies, Art, devicePixelRatio: 2 });
const map = WorldGen.generate({ seed: 'perf-client', size: 'small', width: 96, height: 96 });
const scene = (x, y) => ({ hero: { name: 'Г', x, y, dir: 1, colors: {}, look: {} }, others: [], enemies: [], ground: [], traps: [], turrets: [], markers: new Map() });

test('рендер: земля из кэша фрагментов (не больше N новых за кадр), повторный кадр без пересборки; отсечение по экрану', async () => {
  const { IsoRenderer } = await load('game/render.js');
  const r = new IsoRenderer(mockCanvas(), map, { tileWidth: 64, zoom: 1, groundBuildsPerFrame: 2 });
  r.setQuality('low'); // предел плотности 1 при devicePixelRatio 2
  r.resize();
  assert.equal(r.dpr, 1, 'низкое качество — плотность 1');
  r.setQuality('high'); r.resize();
  assert.equal(r.dpr, 2, 'высокое — до 2');
  r.cam = { x: 48, y: 48 };
  r.draw(scene(48, 48), 1000);
  assert.equal(r.lastStats.groundBuilt, 2, 'за кадр собрано не больше 2 фрагментов');
  assert.ok(r.lastStats.tiles > 0, 'несобранные пока рисуются напрямую');
  for (let i = 0; i < 20; i++) r.draw(scene(48, 48), 1000 + i * 16);
  assert.equal(r.lastStats.groundBuilt, 0, 'всё собрано — новых нет');
  assert.equal(r.lastStats.tiles, 0, 'напрямую ничего');
  const n = r.lastStats.groundChunks, size = r.gcache.size;
  assert.ok(n > 0 && n <= size && n < 40, 'видимых фрагментов немного: ' + n);
  // отсечение: видимые фрагменты — только те, что пересекают экран
  const rng = r.visibleRange();
  // экран 1280×720 в клетках плюс 24 ряда снизу (высокие деревья и постройки за нижним краем) и поля по 2 клетки
  const span = Math.ceil((r.vw / r.hw + r.vh / r.hh + 24) / 2) + 6;
  assert.ok(rng.x1 - rng.x0 <= span && rng.y1 - rng.y0 <= span && span < map.width * 0.7, `в диапазоне — только видимые клетки: ${JSON.stringify(rng)}, предел ${span}`);
  r.zoom = 1.5; r.draw(scene(48, 48), 2000);
  assert.ok(r.lastStats.groundBuilt > 0, 'новый масштаб — пересборка');
});

test('рендер-арт: объекты — спрайтами из кэша, качество меняет ключ кэша', async () => {
  const { ArtRenderer } = await load('game/art.js');
  const r = new ArtRenderer(mockCanvas(), map, { tileWidth: 64, zoom: 1, quality: 'medium' });
  r.resize();
  // клетка леса
  let fx = -1, fy = -1;
  for (let y = 10; y < 86 && fx < 0; y++) for (let x = 10; x < 86; x++) if (WorldGen.BIOMES[map.tiles[y * map.width + x]].key === 'forest') { fx = x; fy = y; break; }
  assert.ok(fx >= 0, 'есть лес');
  r.cam = { x: fx, y: fy };
  for (let i = 0; i < 20; i++) r.draw(scene(fx, fy), 1000 + i * 16); // земля собрана за несколько кадров
  const made = r.sprites.size;
  assert.ok(made > 0, 'спрайты объектов созданы');
  const before = canvases;
  for (let i = 0; i < 5; i++) r.draw(scene(fx, fy), 1100 + i * 16);
  assert.equal(r.sprites.size, made, 'новые кадры — те же спрайты');
  assert.ok(canvases - before < 3, 'холсты не создаются каждый кадр');
  r.setQuality('high');
  r.draw(scene(fx, fy), 3000);
  assert.ok(r.spriteKey.endsWith('|high'), 'ключ кэша зависит от качества');
});
