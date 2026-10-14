'use strict';
// Спрайты фигур (client/js/game/figure-memo.js): ключ облика и позы, квантование, анимации по времени
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'client', 'js', 'game', f)).href);

test('отпечаток облика: положение, здоровье, сетевые метки не важны; одежда, вид, прицел — важны', async () => {
  const FM = await load('figure-memo.js');
  const a = { id: 'e1', x: 3.2, y: 4.1, hp: 50, flags: 9, moving: true, dir: 1, def: { id: 'zombie', loot: [1, 2, 3] }, look: { shape: 'zombie', color: '#7a8a6a' }, outfit: { shirt: { id: 'shirt_canvas', color: '#aaa' } } };
  const b = { ...a, id: 'e2', x: 9, y: 1, hp: 3, flags: 1, moving: false, dir: -1, def: { id: 'zombie' } };
  assert.equal(FM.fingerprint(a), FM.fingerprint(b), 'два одинаково одетых зомби делят спрайт');
  assert.notEqual(FM.fingerprint(a), FM.fingerprint({ ...a, outfit: { shirt: { id: 'shirt_canvas', color: '#bbb' } } }), 'другой цвет рубахи');
  assert.notEqual(FM.fingerprint(a), FM.fingerprint({ ...a, attackAngle: 1.2 }), 'направление выстрела влияет на прицел');
  assert.notEqual(FM.fingerprint(a), FM.fingerprint({ ...a, alpha: 0.5 }));
  assert.equal(FM.fingerprint({ ...a, huge: { s: 'x'.repeat(7000) } }), null, 'огромный объект — без кэша');
});

test('квантование позы мельче шага кадра: фаза по кругу, сдвиг < 0,5 пикселя', async () => {
  const FM = await load('figure-memo.js');
  const pose = { angle: 0.785, phase: 100.123, active: true, p: 0.4321, wind: 0.11, strike: 0.777, kind: 'melee', action: 0, cast: false, hurt: 0, stun: false, move: 0.9999 };
  for (const u of [10, 14.4, 30, 60]) {
    const q = FM.quantPose(pose, u), TAU = Math.PI * 2;
    const ph = ((pose.phase % TAU) + TAU) % TAU;
    let dph = Math.abs(q.phase - ph); dph = Math.min(dph, TAU - dph);
    assert.ok(dph * 0.2 * u <= 0.45, `фаза: ${dph * 0.2 * u} пикс при u=${u}`);
    for (const k of ['p', 'wind', 'strike', 'move']) assert.ok(Math.abs(q[k] - pose[k]) * 1.6 * u <= 0.45, `${k} при u=${u}`);
    assert.equal(q.kind, 'melee'); assert.equal(q.active, true); assert.equal(q.angle, pose.angle);
  }
  assert.equal(FM.quantPose(pose, 14).move, 1, 'почти дошедшее сглаживание — ровно 1');
});

test('время: любое обращение помечает рисунок, плавные колебания — с шагом ≤ 0,15 пикселя и в ключе', async () => {
  const FM = await load('figure-memo.js');
  const c = new FM.Clock(5000);
  assert.equal(c.timed, false);
  assert.equal(Math.sin(c / 130) !== null, true);
  assert.equal(c.timed, true, 'шарф/ауры — обычное рисование каждый кадр');
  assert.equal(FM.wave(5000, 850, 0.012, 20), Math.sin(5000 / 850) * 0.012, 'без спрайта — точное значение');
  for (const t of [0, 1234, 5000, 77777]) {
    const k = new FM.Clock(t), v = FM.wave(k, 850, 0.012, 30);
    assert.equal(k.timed, false, 'дыхание не мешает кэшу');
    assert.ok(Math.abs(v - Math.sin(t / 850) * 0.012) * 30 <= 0.15 + 1e-9, 'сдвиг дыхания ≤ 0,15 пикселя');
    assert.equal(k.waves.size, 1);
  }
  const k = new FM.Clock(1000); FM.wave(k, 380, 0.05, 26, 1); FM.wave(k, 380, 0.05, 26, -1);
  assert.equal(k.waves.size, 1, 'руки зомби — одна фаза на обе');
});

test('рисунок фигур: дыхание, плащ, крылья и руки зомби — через wave(); дула со спрайта восстанавливаются', async () => {
  const fs = require('fs');
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'client', 'js', 'game', f), 'utf8');
  const fa = src('anime-figure.js'), ca = src('creature-art.js'), fm = src('figure-memo.js'), r = src('render.js');
  assert.match(fa, /wave\(time,950,\.008,unit\)/);
  assert.match(fa, /wave\(time,260,\.05,unit\)/);
  assert.match(ca, /wave\(time,950,0\.01,s\)/);
  assert.match(fa, /import \{ wave, muzzles \} from '\.\/figure-memo\.js'/);
  assert.match(fm, /if \(s\.muzzle\) muzzles\.set\(actor/);
  assert.match(r, /memoFigure\(this\.ctx, e,/);
  assert.match(r, /memoFigure\(this\.ctx, hero,/);
  assert.match(r, /blitVisible\(ch\.canvas/);
});
