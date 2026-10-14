'use strict';
// Походка (ART.md, раздел 3): опорная стопа не скользит, ноги поочерёдно, колено человека — вперёд,
// «куриного» шагохода — назад; шагоходы-техника переставляют ноги по пройденному пути.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
globalThis.window = globalThis.window || {};
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'client', 'js', 'game', f)).href);

test('шаг: опорная стопа уходит назад со скоростью тела, ноги в противофазе', async () => {
  const { gaitFoot, strideFor, TILE_UNITS } = await load('gait.js');
  const rate = 13.5, half = strideFor(rate), dPhase = 0.05;
  for (let ph = 0.1; ph < 3; ph += 0.37) {
    const a = gaitFoot(ph, 0, half, 0.2), b = gaitFoot(ph + dPhase, 0, half, 0.2);
    if (!a.stance || !b.stance) continue;
    // тело проходит dPhase / rate клетки = dPhase / rate * TILE_UNITS единиц; стопа — столько же назад
    assert.ok(Math.abs((a.dy - b.dy) - dPhase / rate * TILE_UNITS) < 1e-9, 'стопа скользит при фазе ' + ph);
    assert.equal(a.dz, 0);
  }
  for (let ph = 0; ph < 6.2; ph += 0.3) {
    const l = gaitFoot(ph, 0, half, 0.2), r = gaitFoot(ph, Math.PI, half, 0.2);
    assert.ok(l.stance !== r.stance || Math.abs(ph % Math.PI) < 1e-6, 'ноги поочерёдно');
  }
  assert.equal(gaitFoot(1.3, 0, half, 0.2, 0).dy, 0, 'стоя — ноги на месте');
});

test('колени: человек и гуманоидный мех — вперёд, «куриный» шагоход — назад; длины костей сохраняются', async () => {
  const { legIK } = await load('gait.js');
  const fa = await load('figure-art.js');
  const hip = [0.2, 0, 1.34];
  for (const fy of [-0.3, 0, 0.3]) {
    const foot = [0.2, fy, 0.05];
    const fwd = legIK(hip, foot, 0.7, 0.68, 1), back = legIK(hip, foot, 0.7, 0.68, -1);
    const mid = (hip[1] + foot[1]) / 2;
    assert.ok(fwd[1] > mid, 'колено вперёд'); assert.ok(back[1] < mid, 'сустав назад');
    assert.ok(Math.abs(Math.hypot(fwd[1] - hip[1], fwd[2] - hip[2]) - 0.7) < 1e-6, 'бедро той же длины');
    const { knee } = fa.humanoidLeg(hip, foot);
    assert.ok(knee[1] > mid, 'humanoidLeg — колено вперёд');
  }
});

test('шагоходы-техника переставляют ноги по пути: «Страж» — колени вперёд, «Страйдер» — назад', async () => {
  const { drawMesh } = await load('vehicle-mesh.js');
  const Vehicles = require('../shared/vehicles.js');
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ctx), set: (t, k, v) => { t[k] = v; return true; } });
  for (const id of ['mech_sentinel', 'chicken_walker', 'elephant_walker', 'horse', 'bicycle']) {
    const v = { moving: true, visualPosition: { x: 10, y: 10 } };
    for (let i = 0; i < 20; i++) { v.visualPosition = { x: 10 + i * 0.1, y: 10 }; const t = drawMesh(ctx, Vehicles.get(id), v, 0, 0, 10, 0, i * 16, 0, 'medium'); assert.ok(Array.isArray(t)); }
  }
});
