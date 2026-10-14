'use strict';
// Процедурные иконки: у каждой формы из каталога есть рисунок в client/js/icons.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Items = require('../shared/items.js');

test('иконки: каждая форма предмета из каталога рисуется (нет «заглушки-квадрата»)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'client', 'js', 'icons.js'), 'utf8');
  const drawn = new Set([...src.matchAll(/case '([a-z_0-9]+)'/g)].map((m) => m[1]));
  const missing = [...new Set(Items.ITEMS.map((i) => i.icon.shape))].filter((s) => !drawn.has(s));
  assert.deepEqual(missing, [], 'нет рисунка для форм: ' + missing.join(', '));
  for (const it of Items.ITEMS) assert.match(it.icon.color, /^#[0-9a-f]{6}$/i, it.id + ': цвет иконки');
});
