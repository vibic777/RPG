// Спрайты фигур (герои, жители, спутники, враги, звери) — производительность без потери качества.
// Фигура перерисовывается заново, только когда меняется то, что видно: облик, одежда, оружие, ракурс,
// поза (шаг, удар, каст), масштаб. Одинаковые фигуры в одной позе делят один спрайт.
// Поза квантуется мельче, чем меняется между кадрами: сдвиг любой точки — не больше ~0,4 пикселя
// (шаг ходьбы за кадр — десятки таких шагов). Анимации по времени:
//  • плавные колебания (wave: дыхание, покачивание, руки зомби, крылья в покое) — фаза в ключе с шагом ≤ 0,15 пикселя;
//  • всё остальное по времени (шарф, плащ на ветру, ауры, крылья, полёт, плавание, оглушение, смерть,
//    вращение стволов, хвосты) — фигура в этот момент рисуется как раньше, каждый кадр (кэш не берёт).
// Время передаётся рисованию как Clock: любое арифметическое обращение к нему (valueOf) помечает рисунок как
// «анимированный по времени», а wave() читает время без пометки и сообщает, какие волны нужны в ключе.
import { SpriteMemo, spriteMemoStats, boundsProxy } from './sprite-memo.js';

export const figureMemo = new SpriteMemo(3000);
// Где у фигуры дуло оружия (относительно ног): пишет рисование, читают выстрелы. Со спрайта — восстанавливается
export const muzzles = new WeakMap();
const muzzleOf = (actor) => { const m = muzzles.get(actor); return m ? { ...m } : null; };
export const figureMemoStats = { keyed: 0, skipped: 0, hit: 0, first: 0, timed: 0, made: 0, big: 0 };
export function clearFigureSprites() { figureMemo.clear(); }

export class Clock {
  constructor(t) { this.t = t; this.timed = false; this.waves = null; }
  valueOf() { this.timed = true; return this.t; }
}
const TAU0 = Math.PI * 2;
const cycleIdx = (t, period, K) => { const i = Math.round((t / period / TAU0) * K) % K; return i < 0 ? i + K : i; };

// Плавное колебание amp·sin(t/period + offset) (дыхание, покачивание, руки зомби, крылья в покое).
// px — сколько пикселей в единице amp. При рисовании в спрайт фаза берётся с шагом, при котором
// точка смещается не больше чем на 0,15 пикселя, и этот шаг входит в ключ спрайта.
export function wave(time, period, amp, px, offset = 0) {
  if (!(time instanceof Clock)) return Math.sin(time / period + offset) * amp;
  const K = Math.max(4, Math.ceil(Math.PI * Math.abs(amp) * Math.max(1, px) / 0.15 / 4) * 4);
  (time.waves || (time.waves = new Set())).add(period + '/' + K);
  return Math.sin(cycleIdx(time.t, period, K) * TAU0 / K + offset) * amp;
}

// Что в объекте фигуры не влияет на рисунок (положение, здоровье, служебные метки сети)
// moving, flags, dir, facingAngle, …Until/…At — уже учтены позой (actorPose) или нужны только анимациям по времени
const SKIP = new Set(['x', 'y', 'snaps', 'hp', 'maxHp', 'hpShowUntil', 'flashUntil', 'attackAt', 'id', 'ring', 'moving', 'flags', 'dir',
  'facingAngle', 'castUntil', 'stunUntil', 'hurtAt', 'actionAt',
  'name', 'lvl', 'level', 'ts', 'vx', 'vy', 'path', 'target', 'targetId', 'artSparked', 'mp', 'stamina', 'xp']);
const MAX_FP = 6000;
// Отпечаток облика: все поля, кроме служебных; вложенные объекты — целиком (одежда, цвета, вид)
export function fingerprint(a) {
  let s = '';
  for (const k in a) {
    if (SKIP.has(k) || k.charCodeAt(0) === 95 /* _ */) continue;
    const v = a[k];
    if (v === undefined || typeof v === 'function') continue;
    if (k === 'def' && v && typeof v === 'object') { s += 'def=' + v.id + ';'; continue; }
    if (v !== null && typeof v === 'object') {
      let j; try { j = JSON.stringify(v); } catch { return null; }
      s += k + '=' + j + ';';
    } else s += k + '=' + v + ';';
    if (s.length > MAX_FP) return null;
  }
  return s;
}

const TAU = Math.PI * 2;
// Поза с квантованием (шаг зависит от размера фигуры на экране)
export function quantPose(pose, unit) {
  const u = Math.max(4, unit);
  const nPh = Math.max(32, Math.ceil(TAU * 0.2 * u / 0.4 / 8) * 8); // ступня проходит ~0,2u за радиан фазы
  const nV = Math.max(32, Math.ceil(1.6 * u / 0.4 / 8) * 8); // оружие/рука проходят до ~1,6u за ход 0…1
  const qv = (v) => (typeof v === 'number' ? Math.round(v * nV) / nV : v);
  const ph = ((pose.phase % TAU) + TAU) % TAU;
  const q = { ...pose, phase: (Math.round(ph / TAU * nPh) % nPh) * TAU / nPh, p: qv(pose.p), wind: qv(pose.wind),
    strike: qv(pose.strike), action: qv(pose.action), hurt: qv(pose.hurt), move: qv(pose.move) };
  return q;
}
function poseKey(q) {
  return [q.angle.toFixed(3), q.phase.toFixed(4), q.active ? 1 : 0, q.p, q.wind, q.strike, q.kind, q.action, q.actionKind, q.cast ? 1 : 0, q.hurt, q.stun ? 1 : 0, q.move].join(',');
}

const sigs = new WeakMap(); // фигура → какие плавные колебания были нужны в прошлый раз
let scratch = null; // общий черновой холст: спрайт рисуется в него с замером границ, потом вырезается
function scratchCtx(w, h) {
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width < w || scratch.height < h) { scratch.width = Math.max(scratch.width, w); scratch.height = Math.max(scratch.height, h); }
  const c = scratch.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, scratch.width, scratch.height);
  return c;
}

// Порядок: 1-й раз с ключом — обычное рисование (без лишней работы); 2-й — спрайт (черновик + замер границ,
// вырезка точно по рисунку); дальше — одна копия спрайта. Анимированное по времени — всегда обычное рисование.
// draw(ctx, x, y, time|Clock, pose) → результат рисования
export function memoFigure(ctx, actor, x, y, unit, time, pose, draw) {
  const tr = spriteMemoStats.enabled && typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const plain = tr && tr.b === 0 && tr.c === 0 && tr.a === tr.d && tr.a > 0 && ctx.globalAlpha === 1 && (ctx.filter === undefined || ctx.filter === 'none') && ctx.globalCompositeOperation === 'source-over' && typeof document !== 'undefined';
  const fp = plain ? fingerprint(actor) : null;
  if (fp === null) { figureMemoStats.skipped++; return draw(ctx, x, y, time, pose); }
  figureMemoStats.keyed++;
  const q = quantPose(pose, unit), sig = sigs.get(actor) || '', dpr = tr.a;
  let key = fp + '#' + poseKey(q) + '#' + unit.toFixed(3) + '#' + dpr + '#' + sig;
  if (sig) for (const w of sig.split(',')) { const [p, K] = w.split('/'); key += ':' + cycleIdx(time, +p, +K); }
  const s = figureMemo.get(key);
  if (s && s.canvas) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(s.canvas, Math.round(x * dpr + tr.e) - s.ax, Math.round(y * dpr + tr.f) - s.ay);
    ctx.restore();
    if (s.muzzle) muzzles.set(actor, { ...s.muzzle });
    spriteMemoStats.hits++; figureMemoStats.hit++;
    return s.result;
  }
  const clock = new Clock(time);
  const finish = (result) => {
    const used = clock.waves ? [...clock.waves].sort().join(',') : '';
    const known = !used || used.split(',').every((w) => sig.split(',').includes(w));
    if (used !== sig) sigs.set(actor, used);
    return !clock.timed && known;
  };
  if (!s || s.nocache) { // первый раз (или анимация по времени) — как обычно
    const result = draw(ctx, x, y, clock, q);
    const ok = finish(result);
    if (!s) figureMemo.put(key, ok ? { seen: true } : { nocache: true });
    if (s || !ok) figureMemoStats.timed++; else figureMemoStats.first++;
    spriteMemoStats.direct++;
    return result;
  }
  // второй раз — спрайт: черновик с запасом по размеру фигуры, замер границ, вырезка
  const size = Math.max(1, (actor.look && actor.look.size) || 1) * Math.max(1, actor.scale || 1);
  const W = Math.ceil(unit * size * 12 * dpr), H = Math.ceil(unit * size * 16 * dpr);
  const ax0 = Math.floor(W / 2), ay0 = Math.floor(H * 0.72);
  const sc = scratchCtx(W, H);
  sc.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { proxy, b } = boundsProxy(sc);
  const result = draw(proxy, ax0 / dpr, ay0 / dpr, clock, q);
  const ok = finish(result);
  const pad = Math.ceil(b.lw + b.blur + 2);
  const sx0 = Math.floor((b.x0 - pad) * dpr), sy0 = Math.floor((b.y0 - pad) * dpr), sx1 = Math.ceil((b.x1 + pad) * dpr), sy1 = Math.ceil((b.y1 + pad) * dpr);
  if (!ok || b.unsafe || !Number.isFinite(b.x0) || sx0 < 0 || sy0 < 0 || sx1 > W || sy1 > H) {
    figureMemoStats.big++;
    figureMemo.put(key, { nocache: true }); // не помещается в черновик или анимировано — рисуем как обычно
    spriteMemoStats.direct++;
    return draw(ctx, x, y, new Clock(time), q);
  }
  const canvas = document.createElement('canvas'); canvas.width = sx1 - sx0; canvas.height = sy1 - sy0;
  canvas.getContext('2d').drawImage(scratch, sx0, sy0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  const sp = { canvas, ax: ax0 - sx0, ay: ay0 - sy0, result, muzzle: muzzleOf(actor) };
  figureMemo.put(key, sp);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(canvas, Math.round(x * dpr + tr.e) - sp.ax, Math.round(y * dpr + tr.f) - sp.ay);
  ctx.restore();
  spriteMemoStats.made++; figureMemoStats.made++;
  return result;
}
