// Туман войны (шаг 22) — общий для сервера и клиента.
// Разведанная карта — битовая карта w×h (1 — клетка разведана); в сохранении — RLE (чередующиеся длины серий 0/1, varint) в base64.
// Видимость — круг радиуса radiusAt(env) вокруг героя; ночью и под землёй радиус меньше.
// Режимы game.fogMode: 'on' — три состояния (не разведано — чёрное, разведано — затемнено без живых врагов, видно),
// 'explored' — скрыто только неразведанное, 'off' — тумана нет.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Fog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MODES = ['on', 'explored', 'off'];
  const settings = { fogMode: 'on', fogRadius: 12, fogNightMul: 0.65, fogUndergroundMul: 0.6, fogShared: true, fogServerCull: true, fogDimAlpha: 0.55 };
  function configure(game) {
    if (!game) return;
    for (const k of Object.keys(settings)) {
      const v = game[k];
      if (typeof settings[k] === 'number' && Number.isFinite(v)) settings[k] = v;
      else if (typeof settings[k] === 'boolean' && typeof v === 'boolean') settings[k] = v;
    }
    if (MODES.includes(game.fogMode)) settings.fogMode = game.fogMode;
  }
  const mode = () => (MODES.includes(settings.fogMode) ? settings.fogMode : 'on');

  const create = (w, h) => new Uint8Array(Math.ceil((w * h) / 8));
  const get = (bits, i) => (bits[i >> 3] >> (i & 7)) & 1;
  const set = (bits, i) => { bits[i >> 3] |= 1 << (i & 7); };
  const count = (bits) => { let n = 0; for (const b of bits) { let v = b; while (v) { n += v & 1; v >>= 1; } } return n; };
  // Разведать круг радиуса r вокруг (x, y); возвращает число новых клеток и их рамку { n, x0, y0, x1, y1 }
  function reveal(bits, w, h, x, y, r) {
    const out = { n: 0, x0: Infinity, y0: Infinity, x1: -1, y1: -1 };
    if (!(r > 0)) return out;
    const r2 = r * r, cx = Math.floor(x), cy = Math.floor(y), R = Math.ceil(r);
    for (let yy = Math.max(0, cy - R); yy <= Math.min(h - 1, cy + R); yy++) {
      for (let xx = Math.max(0, cx - R); xx <= Math.min(w - 1, cx + R); xx++) {
        const dx = xx + 0.5 - x, dy = yy + 0.5 - y;
        if (dx * dx + dy * dy > r2) continue;
        const i = yy * w + xx;
        if (get(bits, i)) continue;
        set(bits, i); out.n++;
        if (xx < out.x0) out.x0 = xx; if (yy < out.y0) out.y0 = yy; if (xx > out.x1) out.x1 = xx; if (yy > out.y1) out.y1 = yy;
      }
    }
    return out;
  }
  // Клетка видна из (px, py) с радиусом r
  const visible = (px, py, x, y, r) => { const dx = x - px, dy = y - py; return dx * dx + dy * dy <= r * r; };
  // Радиус обзора: env { phase (0…1, доля суток), z (0 — поверхность, < 0 — под землёй) }
  function radiusAt(env) {
    const e = env || {}, base = Math.max(1, settings.fogRadius);
    if (e.z < 0) return +(base * settings.fogUndergroundMul).toFixed(2);
    if (e.z > 0 || typeof e.phase !== 'number') return base;
    const sun = Math.cos((e.phase - 0.5) * Math.PI * 2), night = Math.max(0, Math.min(1, -sun / 0.6)); // как свет в shared/art.js
    return +(base * (1 - (1 - settings.fogNightMul) * night)).toFixed(2);
  }
  function or(dst, src) { const n = Math.min(dst.length, src.length); let ch = 0; for (let i = 0; i < n; i++) { const v = dst[i] | src[i]; if (v !== dst[i]) { dst[i] = v; ch++; } } return ch; }

  // ---------- RLE + base64 ----------
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
    }
    return s;
  }
  function unb64(s) {
    const clean = String(s).replace(/[^A-Za-z0-9+/]/g, ''), out = [];
    for (let i = 0; i < clean.length; i += 4) {
      const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((clean[i + 2] ? B64.indexOf(clean[i + 2]) : 0) << 6) | (clean[i + 3] ? B64.indexOf(clean[i + 3]) : 0);
      out.push((n >> 16) & 255);
      if (clean[i + 2]) out.push((n >> 8) & 255);
      if (clean[i + 3]) out.push(n & 255);
    }
    return out;
  }
  function encode(bits, w, h) {
    const total = w * h, bytes = [];
    const varint = (v) => { while (v >= 128) { bytes.push((v & 127) | 128); v = Math.floor(v / 128); } bytes.push(v); };
    let cur = 0, run = 0;
    for (let i = 0; i < total; i++) { const b = get(bits, i); if (b === cur) run++; else { varint(run); cur = b; run = 1; } }
    varint(run);
    return b64(bytes);
  }
  // Неверная строка или другой размер — пустая карта
  function decode(str, w, h) {
    const bits = create(w, h), total = w * h;
    if (typeof str !== 'string' || !str) return bits;
    try {
      const bytes = unb64(str);
      let p = 0, i = 0, cur = 0;
      while (p < bytes.length && i <= total) {
        let v = 0, mul = 1, b;
        do { b = bytes[p++]; v += (b & 127) * mul; mul *= 128; } while (b & 128 && p < bytes.length);
        if (i + v > total) return create(w, h);
        if (cur) for (let k = i; k < i + v; k++) set(bits, k);
        i += v; cur ^= 1;
      }
      return i === total ? bits : create(w, h);
    } catch { return create(w, h); }
  }
  return { MODES, settings, configure, mode, create, get, set, count, reveal, visible, radiusAt, or, encode, decode };
});
