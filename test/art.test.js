'use strict';
// Шаг 19: данные арта — детерминированный атлас, полнота спрайт-маппинга, качество, свет, частицы, вид детей
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Art = require('../shared/art.js');
const Items = require('../shared/items.js');
const Enemies = require('../shared/enemies.js');
const Vehicles = require('../shared/vehicles.js');
const Building = require('../shared/building.js');
const Settlements = require('../shared/settlements.js');
const Family = require('../shared/family.js');
const WorldGen = require('../shared/worldgen.js');
const { DEFAULTS, DESCRIPTIONS } = require('../server/config.js');

const keyed = (o) => Object.entries(o).map(([id, v]) => ({ ...v, id }));

test('арт: атлас текстур детерминирован и различается по биомам и вариантам', () => {
  const a = Art.texturePixels(3, 1, 16), b = Art.texturePixels(3, 1, 16);
  assert.equal(a.size, 16);
  assert.equal(a.data.length, 16 * 16 * 4);
  assert.deepEqual(a.data, b.data, 'одинаковые входы — одинаковые пиксели');
  assert.notDeepEqual(Art.texturePixels(3, 2, 16).data, a.data, 'другой вариант — другая текстура');
  assert.notDeepEqual(Art.texturePixels(4, 1, 16).data, a.data, 'другой биом — другая текстура');
  assert.equal(Art.atlasHash(16), Art.atlasHash(16), 'хеш всего атласа стабилен');
  assert.match(Art.atlasHash(16), /^[0-9a-f]{8}$/);
  for (let i = 0; i < 8; i++) assert.ok(Art.texturePixels(i, 0, 16).data.every((v) => v >= 0 && v <= 255));
});

test('арт: у каждой сущности каталога есть спрайт (предметы, враги, биомы, объекты, техника, постройки, семья)', () => {
  assert.equal(Art.BIOMES.length, WorldGen.BIOMES.length, 'палитра на каждый биом');
  WorldGen.BIOMES.forEach((b, i) => assert.equal(Art.BIOMES[i].id, b.key, 'порядок биомов как в WorldGen: ' + b.key));
  const miss = Art.coverage({
    items: Items.ITEMS, enemies: Enemies.ENEMIES, vehicles: Vehicles.LIST, pieces: Building.PIECES,
    buildings: keyed(Settlements.BUILDINGS), nodes: keyed(Building.NODES), family: keyed(Family.KINDS), biomes: WorldGen.BIOMES,
  });
  assert.deepEqual(miss, [], 'без спрайта: ' + JSON.stringify(miss));
  assert.equal(Art.spriteOf('item', null), null);
  assert.equal(Art.spriteOf('nope', { id: 'x' }), null);
  // формы иконок и врагов совпадают с тем, что умеют рисовать icons.js и enemy-draw.js
  const icons = fs.readFileSync(path.join(__dirname, '..', 'client', 'js', 'icons.js'), 'utf8');
  for (const sh of Art.ICON_SHAPES) assert.ok(icons.includes(`'${sh}'`), 'icons.js не рисует ' + sh);
  const ed = fs.readFileSync(path.join(__dirname, '..', 'client', 'js', 'game', 'creature-art.js'), 'utf8');
  for (const sh of Art.ENEMY_SHAPES) assert.ok(ed.includes(`'${sh}'`), 'enemy-draw.js не рисует ' + sh);
  for (const sh of Art.ENEMY_SHAPES) assert.ok(Art.ANIMS[sh] && Art.ANIMS[sh].death, 'анимация смерти: ' + sh);
});

test('арт: настройки качества и рендера санируются, запасной рендер — classic', () => {
  const D = { fps: 60, battery: true, auto: true, overlay: false, edge: false, arrows: true }; // шаг 20: кадры, батарея, автокачество, оверлей
  assert.deepEqual(Art.sanitizeGfx(null), { renderer: Art.settings.graphicsRenderer, quality: Art.settings.graphicsQuality, ...D });
  assert.deepEqual(Art.sanitizeGfx({ renderer: 'classic', quality: 'high' }), { renderer: 'classic', quality: 'high', ...D });
  assert.deepEqual(Art.sanitizeGfx({ renderer: '<x>', quality: 'ultra', fps: 144, battery: 'да', overlay: 1 }), { renderer: 'art', quality: 'medium', ...D });
  assert.deepEqual(Art.sanitizeGfx('мусор'), { renderer: 'art', quality: 'medium', ...D });
  assert.deepEqual(Art.sanitizeGfx({ fps: 0, battery: false, auto: false, overlay: true, edge: true, arrows: false }), { renderer: 'art', quality: 'medium', fps: 0, battery: false, auto: false, overlay: true, edge: true, arrows: false });
  assert.equal(Art.sanitizeGfx({ fps: '30' }).fps, 30);
  // от батареи с экономией — низкое качество и не больше 30 FPS; без экономии — как выбрано
  assert.deepEqual(Art.effectiveGfx({ quality: 'high', fps: 0 }, true), { renderer: 'art', quality: 'low', fps: 30, battery: true, auto: true, overlay: false, edge: false, arrows: true, saver: true });
  assert.equal(Art.effectiveGfx({ quality: 'high', fps: 0, battery: false }, true).quality, 'high');
  assert.equal(Art.effectiveGfx({ quality: 'high' }, false).saver, false);
  assert.equal(Art.lowerQuality('high'), 'medium'); assert.equal(Art.lowerQuality('medium'), 'low'); assert.equal(Art.lowerQuality('low'), null);
  assert.ok(Art.QUALITY.low.dpr <= Art.QUALITY.medium.dpr && Art.QUALITY.medium.dpr <= Art.QUALITY.high.dpr, 'предел плотности пикселей растёт с качеством');
  assert.ok(Art.RENDERERS.classic && Art.RENDERERS.art);
  assert.equal(Art.quality('нет').particles, Art.QUALITY.medium.particles, 'неизвестное качество — среднее');
  assert.equal(Art.QUALITY.low.particles, 0);
  assert.ok(Art.QUALITY.high.particles >= Art.QUALITY.medium.particles);
});

test('арт: свет дня и ночи, подземелья и подводья; частицы детерминированы и зависят от качества', () => {
  assert.equal(Art.light({ phase: 0.5, z: 0 }).alpha, 0, 'полдень — без затемнения');
  const night = Art.light({ phase: 0, z: 0 });
  assert.equal(night.name, 'ночь');
  assert.ok(night.alpha > 0.3 && night.alpha <= Art.settings.artNightDark + 1e-9);
  assert.equal(Art.light({ phase: 0, z: 0 }, 'low').alpha, 0, 'низкое качество — ровный свет');
  const cave = Art.light({ phase: 0.5, z: -2, type: 'cave' });
  assert.equal(cave.name, 'подземелье');
  assert.equal(cave.radius, Art.settings.artUnderLight);
  assert.equal(Art.light({ phase: 0.5, z: -1, type: 'underwater' }).name, 'подводье');
  assert.equal(Art.dayPhase(0, 0), 0.5, 'artDayMin 0 — всегда день');
  const p1 = Art.burst('fire', 42, 'medium'), p2 = Art.burst('fire', 42, 'medium');
  assert.deepEqual(p1, p2);
  assert.ok(p1.length > 0);
  assert.equal(Art.burst('fire', 42, 'low').length, 0);
  assert.ok(Art.burst('fire', 42, 'high').length >= p1.length);
  assert.equal(Art.fxKind({ k: 'nothing-known' }) === null || typeof Art.fxKind({ k: 'x' }) === 'string', true);
});

test('арт: дети выглядят по-разному и растут с возрастом', () => {
  const a = Art.childLook('kid-1', 2, 16), b = Art.childLook('kid-1', 12, 16), c = Art.childLook('kid-1', 2, 16);
  assert.deepEqual(a, c, 'внешность стабильна');
  assert.ok(a.scale >= 0.55 && a.scale < b.scale && b.scale <= 1, 'рост с возрастом');
  assert.equal(Art.childLook('kid-1', 99, 16).scale, 1);
  const looks = new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify({ ...Art.childLook('kid-' + i, 5, 16), scale: 0 })));
  assert.ok(looks.size >= 8, 'разные дети — разная внешность: ' + looks.size);
});

test('арт: настройки графики есть в DEFAULTS и описаны по-русски', () => {
  for (const k of ['graphicsRenderer', 'graphicsQuality', 'artDayMin', 'artNightDark', 'artUnderLight', 'artParticleMax', 'artTextureSize']) {
    assert.ok(k in DEFAULTS.game, k);
    assert.match(DESCRIPTIONS['game.' + k] || '', /[а-я]/i, 'описание ' + k);
  }
  Art.configure({ graphicsQuality: 'high', artNightDark: 9 });
  assert.equal(Art.settings.graphicsQuality, 'high');
  assert.ok(Art.settings.artNightDark <= 0.9, 'затемнение ночи ограничено');
  Art.configure(DEFAULTS.game);
});
