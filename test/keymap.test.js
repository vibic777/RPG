'use strict';
// Раскладка: стрелки двигают камеру, W A S D — героя (меню «Стрелки — камера», game.cameraArrowKeys)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('клавиши: стрелки — камера, WASD — движение; выключено — стрелки ведут героя, обзор Ctrl+стрелки', async () => {
  const K = await import(pathToFileURL(path.join(__dirname, '..', 'client', 'js', 'game', 'keymap.js')).href);
  for (const [code, dir] of [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right']]) {
    assert.equal(K.panKeyFor(code, false, true), dir, code + ' двигает обзор');
    assert.equal(K.moveKey(code, true), false, code + ' не двигает героя');
    assert.equal(K.panKeyFor(code, false, false), null, 'выключено: без Ctrl стрелка — не камера');
    assert.equal(K.moveKey(code, false), true, 'выключено: стрелка ведёт героя');
    assert.equal(K.panKeyFor(code, true, false), dir, 'Ctrl+стрелка — камера всегда');
  }
  for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
    for (const on of [true, false]) { assert.equal(K.moveKey(code, on), true, code + ' ведёт героя'); assert.equal(K.panKeyFor(code, false, on), null); }
  }
  for (const code of ['Numpad8', 'Numpad2', 'Numpad4', 'Numpad6']) for (const on of [true, false]) { assert.ok(K.panKeyFor(code, false, on)); assert.equal(K.moveKey(code, on), false); }
  assert.equal(K.moveKey('KeyQ', true), false);
});

test('настройка «Стрелки — камера»: по умолчанию вкл., сервер задаёт умолчание, игрок меняет в меню; справка и подсказки', () => {
  const Art = require('../shared/art');
  assert.equal(Art.sanitizeGfx({}).arrows, true);
  assert.equal(Art.sanitizeGfx({ arrows: false }).arrows, false);
  Art.configure({ cameraArrowKeys: false });
  try { assert.equal(Art.sanitizeGfx({}).arrows, false, 'умолчание сервера'); assert.equal(Art.sanitizeGfx({ arrows: true }).arrows, true, 'выбор игрока важнее'); }
  finally { Art.configure({ cameraArrowKeys: true }); }
  assert.match(read('server/config.js'), /'game\.cameraArrowKeys': 'камера: стрелки двигают обзор, а WASD — героя/);
  const html = read('client/index.html');
  assert.match(html, /<label title="Стрелки ← ↑ → ↓ двигают обзор[^"]*"[^>]*><input type="checkbox" id="gfx-arrows"> Стрелки — камера<\/label>/);
  assert.doesNotMatch(html, /WASD\/стрелки/);
  const g = read('client/js/game/game.js');
  assert.match(g, /from '\.\/keymap\.js'/);
  assert.match(g, /panKeyFor\(e\.code, e\.ctrlKey, game\.arrowsPan\)/);
  assert.match(g, /moveKey\(e\.code, game\.arrowsPan\)/);
  assert.match(g, /game\.arrowsPan = eff\.arrows !== false/);
  assert.match(g, /arrows: \$\('#gfx-arrows'\)\.checked/);
  assert.doesNotMatch(g, /if \(KEY_DIRS\[e\.code\]\) \{ e\.preventDefault\(\); game\.keys\.add/, 'стрелки больше не добавляются в движение напрямую');
  const help = read('client/js/help.js');
  assert.match(help, /<tr><td><b>W A S D<\/b><\/td>/);
  assert.match(help, /<b>Стрелки ← ↑ → ↓<\/b>, цифры 8\/4\/6\/2/);
  assert.match(help, /«Стрелки — камера»/);
  assert.match(read('README.md'), /\| \*\*WASD\*\* \| движение/);
});
