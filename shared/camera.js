// Камера (шаг 22): слежение за героем или свободный обзор — общая логика без DOM (тестируется в Node).
// follow — камера держит героя в центре; любой сдвиг обзора (клавиши, перетаскивание, край экрана, миникарта) слежение выключает,
// recenter() возвращает камеру к герою и снова включает слежение. Движение плавное (экспоненциальное сглаживание), центр — в пределах мира.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Camera = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const settings = { cameraPanSpeed: 18, cameraSmoothSec: 0.12, cameraEdgeScroll: false, cameraEdgePx: 12, cameraFollowDefault: true };
  function configure(game) {
    if (!game) return;
    for (const k of Object.keys(settings)) {
      const v = game[k];
      if (typeof settings[k] === 'number' && Number.isFinite(v)) settings[k] = v;
      else if (typeof settings[k] === 'boolean' && typeof v === 'boolean') settings[k] = v;
    }
  }
  // Экранный сдвиг (пиксели) → сдвиг в клетках изометрии (hw, hh — половины ромба клетки)
  function screenToWorldDelta(sx, sy, hw, hh) { const a = sx / hw, b = sy / hh; return { x: (a + b) / 2, y: (b - a) / 2 }; }
  // Направление клавиш «вверх по экрану» и т. п. → клетки
  const DIRS = { up: [-1, -1], down: [1, 1], left: [-1, 1], right: [1, -1] };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function create(opts = {}) {
    const cam = {
      x: opts.x || 0, y: opts.y || 0, tx: opts.x || 0, ty: opts.y || 0, follow: opts.follow ?? settings.cameraFollowDefault, w: opts.w || 1, h: opts.h || 1,
      setWorld(w, h) { this.w = w; this.h = h; this.clampTarget(); },
      clampTarget() { this.tx = clamp(this.tx, 0, this.w); this.ty = clamp(this.ty, 0, this.h); },
      // Сдвиг обзора на (dx, dy) клеток — выключает слежение
      pan(dx, dy) { if (!dx && !dy) return; if (this.follow) { this.tx = this.x; this.ty = this.y; } this.follow = false; this.tx += dx; this.ty += dy; this.clampTarget(); },
      panScreen(sx, sy, hw, hh) { const d = screenToWorldDelta(sx, sy, hw, hh); this.pan(d.x, d.y); },
      // Перейти к точке (миникарта): instant — без плавности
      lookAt(x, y, instant) { this.follow = false; this.tx = x; this.ty = y; this.clampTarget(); if (instant) { this.x = this.tx; this.y = this.ty; } },
      recenter(hero) { this.follow = true; if (hero) { this.tx = hero.x; this.ty = hero.y; } },
      toggleFollow(hero) { if (this.follow) { this.follow = false; this.tx = this.x; this.ty = this.y; } else this.recenter(hero); return this.follow; },
      snap(hero) { if (hero) { this.x = this.tx = clamp(hero.x, 0, this.w); this.y = this.ty = clamp(hero.y, 0, this.h); } },
      // Кадр: dt — секунды; keys — { up, down, left, right } (true — зажата); edge — то же от края экрана
      update(dt, hero, keys, edge) {
        let dx = 0, dy = 0;
        for (const src of [keys, edge]) if (src) for (const k of Object.keys(DIRS)) if (src[k]) { dx += DIRS[k][0]; dy += DIRS[k][1]; }
        if (dx || dy) { const len = Math.hypot(dx, dy), sp = settings.cameraPanSpeed * dt; this.pan((dx / len) * sp, (dy / len) * sp); }
        if (this.follow && hero) { this.tx = hero.x; this.ty = hero.y; }
        this.clampTarget();
        const k = settings.cameraSmoothSec > 0 ? 1 - Math.exp(-dt / settings.cameraSmoothSec) : 1;
        this.x += (this.tx - this.x) * k; this.y += (this.ty - this.y) * k;
        if (Math.abs(this.tx - this.x) < 0.001) this.x = this.tx;
        if (Math.abs(this.ty - this.y) < 0.001) this.y = this.ty;
        return { x: this.x, y: this.y };
      },
    };
    return cam;
  }
  // Край экрана: { up, down, left, right } по положению мыши (px — ширина полосы)
  function edgeDirs(mx, my, vw, vh, px = settings.cameraEdgePx) {
    if (mx == null || my == null || mx < 0 || my < 0 || mx > vw || my > vh) return null;
    return { left: mx < px, right: mx > vw - px, up: my < px, down: my > vh - px };
  }
  return { settings, configure, create, screenToWorldDelta, edgeDirs, DIRS };
});
