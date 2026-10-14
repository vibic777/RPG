'use strict';
// Клиентский рендер без браузера: порядок рисования фигур и предметов, рисунки всех врагов
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const WorldGen = require('../shared/worldgen.js');
const Items = require('../shared/items.js');
const Enemies = require('../shared/enemies.js');

globalThis.window = globalThis.window || {};
Object.assign(globalThis.window, { WorldGen, Items });
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'client', 'js', f)).href);

// Рендер без конструктора: камера у героя и широкий экран — depthList отсекает фигуры вне экрана
const viewport = (r, cx = 10.5, cy = 10.5) => Object.assign(r, { cam: { x: cx, y: cy }, tw: 64, zoom: 0.25, vw: 1920, vh: 1080 });

// Порядок вызовов рисования: подменяем методы рендера записью в журнал
async function orderFor(scene, near = 0.9) {
  const { IsoRenderer } = await load('game/render.js');
  const log = [];
  const r = Object.create(IsoRenderer.prototype);
  viewport(r); r.groundOnTop = near;
  r.drawHero = (h) => log.push('hero:' + h.name);
  r.drawTarget = () => {};
  r.drawEnemyFig = (e) => log.push('enemy:' + e.id);
  r.drawGroundItem = (g) => log.push('item:' + g.gid);
  r.drawTrap = (t) => log.push('trap:' + t.id);
  r.drawTurret = (t) => log.push('turret:' + t.id);
  const dl = r.depthList(scene, 0);
  for (const f of dl.flat) f.fn();
  for (const f of dl.figs) r.drawFigure(f);
  return log;
}

test('рендер: предмет у ног героя рисуется поверх героя, дальний — под фигурами', async () => {
  const scene = {
    hero: { name: 'А', x: 10.5, y: 10.5 },
    others: [{ name: 'Б', x: 14.5, y: 14.5 }],
    ground: [{ gid: 'feet', id: 'ration', x: 10.3, y: 10.2 }, { gid: 'far', id: 'ration', x: 20, y: 20 }],
    enemies: [{ id: 'e1', x: 12, y: 12 }], traps: [{ id: 'm1', x: 12, y: 12 }], turrets: [],
  };
  const log = await orderFor(scene);
  assert.ok(log.indexOf('item:feet') > log.indexOf('hero:А'), 'предмет у ног — после героя: ' + log.join(' '));
  assert.ok(log.indexOf('item:far') < log.indexOf('hero:А'), 'предмет вдали — плоский, раньше фигур');
  assert.ok(log.indexOf('trap:m1') < log.indexOf('enemy:e1'), 'мина — под врагом');
  assert.ok(log.indexOf('hero:А') < log.indexOf('enemy:e1') && log.indexOf('enemy:e1') < log.indexOf('hero:Б'), 'фигуры по глубине x+y');
  // с нулевым радиусом (настройка groundOnTopRadius = 0) — старое поведение: предметы всегда под фигурами
  const flat = await orderFor(scene, 0);
  assert.ok(flat.indexOf('item:feet') < flat.indexOf('hero:А'));
});

test('рендер: каждый враг бестиария рисуется в восьми ракурсах, в бою и со вспышкой', async () => {
  const { drawEnemy, enemyHeight } = await load('game/enemy-draw.js');
  const calls = { fill: 0, stroke: 0 };
  const ctx = new Proxy({ globalAlpha: 1 }, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'fill' || k === 'stroke') return () => { calls[k]++; };
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
  for (const e of Enemies.ENEMIES) {
    for (let direction=0;direction<8;direction++) {
      const opts={facingAngle:direction*Math.PI/4,moving:true,flash:0.7,alpha:0.5,attackAt:1000,attackAngle:direction*Math.PI/4,attackKind:e.attack.kind==='ranged'?'ranged':'melee'};
      drawEnemy(ctx, { def:e, look: e.look, ...opts }, 100, 100, 20, 1234);
      assert.ok(!/NaN|undefined/.test(String(ctx.fillStyle)), `${e.id}: цвет заливки ${ctx.fillStyle}`);
    }
    assert.ok(enemyHeight(e.look) > 0, e.id);
  }
  assert.ok(calls.fill > Enemies.ENEMIES.length * 4 && calls.stroke > 0, 'рисунки что-то рисуют');
});

test('справка: строится из данных без ошибок, есть разделы боя, бестиарий со всеми врагами', async () => {
  const Rules = require('../shared/character-rules.js');
  const Combat = require('../shared/combat.js');
  const { DEFAULTS } = require('../server/config.js');
  const Companions = require('../shared/companions.js');
  const Magic = require('../shared/magic.js');
  const Vehicles = require('../shared/vehicles.js');
  Object.assign(globalThis.window, { CharacterRules: Rules, Combat, Enemies, Companions, Magic, Vehicles, GameSettings: DEFAULTS.game, Voice: require('../shared/voice.js') });
  const { helpHtml } = await load('help.js');
  const html = helpHtml();
  for (const id of ['h-combat', 'h-enemies', 'h-xp', 'h-death', 'h-controls', 'h-admin']) assert.match(html, new RegExp(`id="${id}"`), id);
  for (const e of Enemies.ENEMIES) assert.ok(html.includes(e.name), 'в бестиарии нет ' + e.name);
  assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/, 'в тексте справки нет пустых подстановок');
  for (const cmd of ['/spawn', '/kill', '/heal', '/setlevel']) assert.ok(html.includes(cmd), cmd);
  // голосовой чат (шаг 18): раздел, F4, рация, Shift+V для спутников
  assert.match(html, /id="h-voice"/);
  assert.match(html, /id="h-gfx"/); // графика (шаг 19)
  assert.match(html, /id="h-cheats"/); // чит-панель и производительность (шаг 20)
  assert.match(html, /id="h-perf"/);
  assert.match(html, /<b>F9<\/b>/);
  assert.match(html, /<b>F8<\/b>/);
  assert.match(html, /простой \(прежний\)/);
  assert.match(html, /<b>F4<\/b>/);
  assert.match(html, /Shift\+V/);
  // спутники (шаг 11): раздел, клавиши, способ приручения в бестиарии
  assert.match(html, /id="h-companions"/);
  assert.match(html, /id="h-magic"/);
  for (const sp of Magic.SPELLS) assert.ok(html.includes(sp.name), 'справка: ' + sp.name);
  assert.match(html, /<b>P<\/b>/);
  assert.match(html, /Контейнер-уменьшитель/);
  assert.match(html, /может стать спутником: приручение/);
  assert.doesNotMatch(html, /спутником не станет/, 'все существа могут стать спутниками');
  // транспорт (шаг 14): раздел со всей техникой и клавиши
  assert.match(html, /id="h-vehicles"/);
  for (const d of Vehicles.LIST) assert.ok(html.includes(d.name), 'справка: ' + d.name);
  assert.match(html, /<b>Y<\/b>/);
});

test('стройка чит-панели (клиент): объекты, скрытые клетки, ресурсные точки, тайник по щелчку, призрак', async () => {
  window.WorldEdit = require('../shared/worldedit.js');
  window.Building = require('../shared/building.js');
  const we = await load('game/worldedit-ui.js');
  const { IsoRenderer } = await load('game/render.js');
  const map = { width: 50, height: 50, tiles: new Uint8Array(2500) };
  const r = Object.create(IsoRenderer.prototype);
  r.zoom = 1; r.dpr = 1; r.map = map;
  const sent = [];
  we.weAttach({ send: (m) => sent.push(m), toast: () => {}, map: () => map, renderer: () => r });
  const k0 = r.groundKey();
  we.weOnWelcome({ props: [{ id: 'p1', k: 'obj', key: 'tree_oak', x: 5.5, y: 5.5, rot: 0 }, { id: 'p2', k: 'cache', key: 'cache', x: 8, y: 8, rot: 0 }, { id: 'p3', k: 'node', key: 'rock', x: 3, y: 4, rot: 0 }], hidden: [10 * 50 + 10] });
  assert.ok(r.hidden.has(510) && r.groundKey() !== k0, 'скрытая клетка — перестроить землю');
  assert.equal(window.Building.nodes(map).get(4 * 50 + 3), 'rock', 'ресурсная точка добывается');
  we.weOnMessage({ t: 'prop-add', prop: { id: 'p4', k: 'bld', key: 'market', x: 20, y: 20, rot: 1 } });
  we.weOnMessage({ t: 'prop-remove', id: 'p1' });
  we.weOnMessage({ t: 'prop-hide', i: 600, on: true });
  assert.deepEqual(we.weProps().map((p) => p.id).sort(), ['p2', 'p3', 'p4']);
  assert.ok(r.hidden.has(600));
  r.visibleRange = () => ({ x0: 0, y0: 0, x1: 49, y1: 49 });
  we.weSetGhost({ cat: 'bld', id: 'market', rot: 2, name: 'Рынок' });
  const sc = we.weScene({ props: [] }, r, { x: 9, y: 9 }, 0);
  assert.equal(sc.props.length, 2, 'тайник и здание (точки рисует база)');
  assert.equal(typeof sc.overlay, 'function');
  assert.equal(we.weClick({ x: 8.3, y: 8.2 }), true);
  assert.deepEqual(sent.pop(), { t: 'prop', a: 'open', id: 'p2' });
  assert.equal(we.weClick({ x: 30, y: 30 }), false);
  assert.equal(window.WorldEdit.bldWalls(0, 0, 0).length, 11, 'кольцо 4×4 с дверью');
  we.weDetach();
});

test('туман войны (клиент): разведанное из welcome, своя разведка, видно / разведано, fog-reveal и fog-merge, фильтр рендера, «без тумана»', async () => {
  window.Fog = require('../shared/fog.js');
  const fog = await load('game/fog-ui.js');
  const { IsoRenderer } = await load('game/render.js');
  const F = window.Fog, w = 60, h = 40, map = { width: w, height: h };
  const pre = F.create(w, h); F.reveal(pre, w, h, 50, 30, 3);
  fog.fogOnWelcome({ fog: { mode: 'on', radius: 5, z: 0, shared: false, off: false, explored: F.encode(pre, w, h) } }, map);
  assert.ok(fog.fogKnown(50, 30) && !fog.fogKnown(10, 10));
  const dirty = [];
  const r = Object.create(IsoRenderer.prototype);
  r.chunkSize = 16; r.cache = new Map([['0,0', {}], ['3,1', {}]]);
  const fd = r.fogDirty.bind(r); r.fogDirty = (...a) => { dirty.push(a); fd(...a); };
  fog.fogFrame({ x: 10.5, y: 10.5 }, r, 0);
  assert.ok(fog.fogKnown(10, 10) && fog.fogSee(12, 12) && !fog.fogSee(20, 10), 'обзор — круг');
  assert.ok(dirty.length && !r.cache.has('0,0') && r.cache.has('3,1'), 'пересобран только задетый фрагмент');
  assert.ok(fog.fogKnown(50, 30) && !fog.fogSee(50, 30), 'разведано, но не видно');
  fog.fogOnMessage({ t: 'fog-reveal', x: 30, y: 20, r: 2 }, r);
  assert.ok(fog.fogKnown(30, 20));
  const all = F.create(w, h).fill(255);
  fog.fogOnMessage({ t: 'fog-merge', explored: F.encode(all, w, h) }, r);
  assert.ok(fog.fogKnown(1, 38));
  // фильтр рендера: враг вне обзора и предмет на неразведанной клетке не рисуются
  fog.fogOnWelcome({ fog: { mode: 'on', radius: 5, explored: '' } }, map);
  fog.fogFrame({ x: 10.5, y: 10.5 }, null, 0);
  fog.fogBind(r);
  const log = [];
  viewport(r); r.groundOnTop = 0.9;
  r.drawHero = (o) => log.push('hero:' + o.name); r.drawTarget = () => {};
  r.drawEnemyFig = (e) => log.push('enemy:' + e.id); r.drawGroundItem = (g) => log.push('item:' + g.gid);
  const dl = r.depthList({ hero: { name: 'Я', x: 10.5, y: 10.5 }, others: [{ name: 'Б', x: 40, y: 30 }], enemies: [{ id: 'near', x: 12, y: 11 }, { id: 'far', x: 30, y: 30 }], ground: [{ gid: 'g1', id: 'ration', x: 35, y: 35 }], turrets: [], traps: [] }, 0);
  for (const f of dl.flat) f.fn();
  for (const f of dl.figs) r.drawFigure(f);
  assert.deepEqual(log.sort(), ['enemy:near', 'hero:Я']);
  fog.fogSetOff(true);
  assert.ok(fog.fogSee(30, 30) && fog.fogKnown(59, 39), '«без тумана»');
  fog.fogOnWelcome({ fog: { mode: 'explored', radius: 5, explored: '' } }, map);
  fog.fogFrame({ x: 10.5, y: 10.5 }, null, 0);
  assert.ok(fog.fogSee(10, 10) && !fog.fogSee(30, 30), 'режим explored — видно всё разведанное');
  fog.fogDetach();
  assert.ok(fog.fogSee(30, 30), 'тумана нет без welcome');
});

test('рендер: летящая техника и летуны рисуются поверх наземной техники, даже если стоят «дальше»', async () => {
  const log = [];
  const scene = {
    hero: { name: 'А', x: 10.5, y: 10.5 },
    others: [{ name: 'Дракон', x: 9.5, y: 9.5, alt: 1 }],
    props: [
      { x: 9, y: 9, layer: 2, draw: () => log.push('вертолёт') },
      { x: 13, y: 13, layer: 0, draw: () => log.push('танк') },
      { x: 9.2, y: 9.2, layer: 1, draw: () => log.push('самолёт') },
    ],
  };
  const order = await orderFor(scene);
  // техника пишет в log сама, герои — в журнал orderFor
  assert.ok(log.indexOf('танк') < log.indexOf('самолёт') && log.indexOf('самолёт') < log.indexOf('вертолёт'), 'выше — позже: ' + log.join(','));
  assert.ok(order.indexOf('hero:Дракон') > order.indexOf('hero:А'), 'летун поверх пешего героя');
});
