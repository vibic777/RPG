// Туман войны на клиенте (шаг 22): разведанная карта (из welcome, затем своя разведка вокруг героя и fog-reveal / fog-merge от сервера),
// слой тумана — холст 1 пиксель на клетку (чёрное — не разведано, полупрозрачное — разведано, но не видно, прозрачное — видно),
// рисуется одним drawImage в изометрии (сглаживание даёт мягкий край); обновляется только изменившийся кусок.
// Рендер спрашивает see(x, y) — видно ли (враги, другие игроки) и known(x, y) — разведано ли (объекты, постройки, подписи).
const F = () => window.Fog;
let st = null; // { mode, w, h, bits, r, z, off, shared, canvas, ctx, img, vis: { x, y, r } | null, rAt }

export function fogOnWelcome(msg, map) {
  const f = msg.fog;
  if (!f || !F()) { st = null; return; }
  const w = map.width, h = map.height;
  st = { mode: f.mode, w, h, bits: F().decode(f.explored, w, h), r: f.radius || F().settings.fogRadius, z: f.z || 0, off: Boolean(f.off), shared: Boolean(f.shared), vis: null, rAt: 0 };
  if (typeof document !== 'undefined') {
    st.canvas = document.createElement('canvas');
    st.canvas.width = w; st.canvas.height = h;
    st.ctx = st.canvas.getContext('2d');
    st.img = st.ctx.createImageData(w, h);
  }
  repaint(0, 0, w - 1, h - 1);
}
export function fogDetach() { st = null; }
export const fogState = () => st;
export const fogActive = () => Boolean(st && st.mode !== 'off' && !st.off);
export function fogSetOff(off) { if (st && st.off !== Boolean(off)) { st.off = Boolean(off); repaint(0, 0, st.w - 1, st.h - 1); } }

export function fogOnMessage(msg, renderer) {
  if (!st) return false;
  if (msg.t === 'fog-reveal') { const res = F().reveal(st.bits, st.w, st.h, msg.x, msg.y, msg.r); if (res.n) changed(res, renderer); return true; }
  if (msg.t === 'fog-merge') { F().or(st.bits, F().decode(msg.explored, st.w, st.h)); repaint(0, 0, st.w - 1, st.h - 1); if (renderer && renderer.cache) renderer.cache.clear(); return true; }
  return false;
}
function changed(res, renderer) {
  repaint(res.x0, res.y0, res.x1, res.y1);
  if (renderer && renderer.fogDirty) renderer.fogDirty(res.x0, res.y0, res.x1, res.y1);
}

// Кадр: радиус обзора (раз в секунду — сутки), разведка вокруг героя, видимый круг
export function fogFrame(hero, renderer, now = Date.now()) {
  if (!st || !hero) return;
  if (now - st.rAt > 1000) { st.rAt = now; const A = window.Art; st.r = F().radiusAt({ phase: A && A.dayPhase ? A.dayPhase(now) : 0.5, z: st.z }); }
  const res = F().reveal(st.bits, st.w, st.h, hero.x, hero.y, st.r);
  if (res.n) changed(res, renderer);
  const v = st.vis, cx = Math.round(hero.x * 4) / 4, cy = Math.round(hero.y * 4) / 4; // круг — с шагом 1/4 клетки
  if (v && v.x === cx && v.y === cy && v.r === st.r) return;
  st.vis = { x: cx, y: cy, r: st.r };
  const R = Math.ceil(st.r) + 1;
  const xs = [cx - R, cx + R], ys = [cy - R, cy + R];
  if (v) { const R0 = Math.ceil(v.r) + 1; xs.push(v.x - R0, v.x + R0); ys.push(v.y - R0, v.y + R0); }
  repaint(Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys)), Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...ys)));
}

export function fogKnown(x, y) {
  if (!fogActive()) return true;
  const xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= st.w || yi >= st.h) return false;
  return Boolean(F().get(st.bits, yi * st.w + xi));
}
export function fogSee(x, y) {
  if (!fogActive()) return true;
  if (st.mode === 'explored') return fogKnown(x, y);
  return Boolean(st.vis) && F().visible(st.vis.x, st.vis.y, x, y, st.r + 0.5);
}
// Прозрачность тумана в клетке: 255 — чёрное, dim — разведано вне обзора, 0 — видно
function alphaAt(x, y) {
  if (!fogActive()) return 0;
  if (!F().get(st.bits, y * st.w + x)) return 255;
  if (st.mode === 'explored') return 0;
  if (st.vis && F().visible(st.vis.x, st.vis.y, x + 0.5, y + 0.5, st.r)) return 0;
  return Math.round(255 * Math.max(0, Math.min(1, F().settings.fogDimAlpha)));
}
function repaint(x0, y0, x1, y1) {
  if (!st || !st.img) return;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(st.w - 1, x1); y1 = Math.min(st.h - 1, y1);
  if (x1 < x0 || y1 < y0) return;
  const d = st.img.data, W = st.w;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) d[(y * W + x) * 4 + 3] = alphaAt(x, y); // цвет — чёрный (0,0,0)
  st.ctx.putImageData(st.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

// Слой тумана поверх сцены основного вида
export function fogDraw(r) {
  if (!fogActive() || !st.canvas) return;
  const ctx = r.ctx, dpr = r.dpr || 1, o = r.toScreen(0, 0);
  ctx.save();
  ctx.setTransform(dpr * r.hw, dpr * r.hh, -dpr * r.hw, dpr * r.hh, dpr * o.x, dpr * o.y);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(st.canvas, 0, 0);
  ctx.restore();
}
// Миникарта: тот же слой в её преобразовании (ctx уже с ним)
export function fogMinimap(ctx) {
  if (!fogActive() || !st.canvas) return;
  const s = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(st.canvas, 0, 0);
  ctx.imageSmoothingEnabled = s;
}
// Подключить к рендеру: предикаты для объектов и фигур, слой
export function fogBind(r) {
  if (!r) return;
  r.fog = st ? { see: fogSee, known: fogKnown, others: (x, y) => (st && st.shared) || fogSee(x, y), draw: fogDraw } : null;
}
