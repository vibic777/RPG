'use strict';
// Шаг 19: художественный рендер без браузера — выбор рендера, запасной путь, рисование кадра на заглушке canvas
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const WorldGen = require('../shared/worldgen.js');
const Items = require('../shared/items.js');
const Enemies = require('../shared/enemies.js');
const Art = require('../shared/art.js');

// Заглушка 2D-контекста: любые методы — пустые, нужные — с результатом
function mockCtx(calls) {
  const t = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}), measureText: (s) => ({ width: String(s).length * 6 }),
  };
  return new Proxy(t, {
    get: (o, k) => (k in o ? o[k] : (o[k] = (...a) => { calls[k] = (calls[k] || 0) + 1; return undefined; })),
    set: (o, k, v) => { o[k] = v; return true; },
  });
}
globalThis.Path2D = globalThis.Path2D || class { moveTo() {} lineTo() {} closePath() {} };
const calls = {};
const mockCanvas = (w = 640, h = 360) => ({ width: w, height: h, clientWidth: w, clientHeight: h, getContext: () => mockCtx(calls), addEventListener() {}, style: {} });
globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document || { createElement: () => mockCanvas(1, 1) };
Object.assign(globalThis.window, { WorldGen, Items, Enemies, devicePixelRatio: 1 });
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'client', 'js', f)).href);
const map = WorldGen.generate({ seed: 'art-render', size: 'small', width: 64, height: 64 });
const opts = { tileWidth: 64, zoom: 1 };

test('рендер-арт: classic и отсутствие window.Art дают прежний IsoRenderer, иначе — художественный', async () => {
  const { createRenderer, ArtRenderer, loadGfx, saveGfx } = await load('game/art.js');
  const { IsoRenderer } = await load('game/render.js');
  delete globalThis.window.Art;
  const noArt = createRenderer(mockCanvas(), map, opts, { renderer: 'art', quality: 'high' });
  assert.ok(noArt instanceof IsoRenderer && !(noArt instanceof ArtRenderer), 'без Art — запасной рендер');
  globalThis.window.Art = Art;
  const classic = createRenderer(mockCanvas(), map, opts, { renderer: 'classic', quality: 'high' });
  assert.ok(!(classic instanceof ArtRenderer), 'classic — прежний рендер');
  const art = createRenderer(mockCanvas(), map, opts, { renderer: 'art', quality: 'ultra' });
  assert.ok(art instanceof ArtRenderer);
  assert.equal(art.quality, 'medium', 'неверное качество — среднее');
  art.setQuality('low');
  assert.equal(art.quality, 'low');
  // localStorage-заглушка: сохранение санируется
  const st = { v: {}, getItem(k) { return this.v[k] ?? null; }, setItem(k, v) { this.v[k] = v; } };
  const D = { fps: 60, battery: true, auto: true, overlay: false, edge: false, arrows: true };
  assert.deepEqual(saveGfx({ renderer: 'classic', quality: 'хак' }, st), { renderer: 'classic', quality: 'medium', ...D });
  assert.deepEqual(loadGfx(st), { renderer: 'classic', quality: 'medium', ...D });
  st.v['rpg.gfx'] = '{битый json';
  assert.deepEqual(loadGfx(st), { renderer: 'art', quality: 'medium', ...D });
});

test('рендер-арт: кадр с героем, ребёнком, врагами и частицами рисуется на всех качествах без ошибок; атлас кэшируется', async () => {
  globalThis.window.Art = Art;
  const { ArtRenderer, artFx, artParticles } = await load('game/art.js');
  const r = new ArtRenderer(mockCanvas(), map, opts);
  r.resize();
  const hx = map.width / 2, hy = map.height / 2;
  r.cam = { x: hx, y: hy };
  const hero = { name: 'Герой', x: hx, y: hy, dir: 1, moving: true, colors: {}, look: {}, attackAt: 1000 };
  const kid = { name: 'Малыш', x: hx + 1, y: hy, dir: 1, colors: {}, look: {}, scale: 0.6 };
  const enemies = Enemies.ENEMIES.slice(0, 6).map((d, i) => ({ id: 'e' + i, type: d.id, x: hx + i - 3, y: hy + 2, hp: 5, maxHp: 10, look: d.look, attackAt: 1000, deadAt: i % 2 ? 900 : 0 }));
  for (const q of ['low', 'medium', 'high']) {
    r.setQuality(q);
    artFx({ t: 'e', k: 'hit', id: 'e1' }, { x: hx, y: hy });
    for (const time of [1000, 1100, 5000]) r.draw({ hero, others: [kid], enemies, ground: [], traps: [], turrets: [], markers: new Map() }, time);
    for(let i=0;i<8;i++) r.draw({hero,others:[],enemies:[],ground:[],markers:new Map()},5500+i*16);
    assert.ok(r.gcache.size > 0, 'непрерывная земля собрана в кэш: ' + q);
    const b = r.gcache.size;
    r.draw({ hero, others: [], enemies: [], ground: [], markers: new Map() }, 6000);
    assert.equal(r.gcache.size, b, 'повторный кадр берёт землю из кэша: ' + q);
    assert.equal(r.lastStats.groundBuilt,0,'земля не пересобирается: '+q);
  }
  r.level = { z: -2, type: 'cave' };
  r.draw({ hero, others: [], enemies: [], ground: [], markers: new Map() }, 7000);
  r.zoom = 0.5; // мелкий масштаб — кэш фрагментов
  r.draw({ hero, others: [], enemies: [], ground: [], markers: new Map() }, 8000);
  assert.ok(calls.drawImage > 0 && calls.fillRect > 0);
  assert.ok(artParticles().list.length <= Art.settings.artParticleMax);
});
