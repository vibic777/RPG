// Кэш спрайтов неподвижных моделей (производительность без потери качества).
// Модель, у которой за кадр не изменилось ничего из того, что влияет на рисунок (ключ), рисуется один раз
// в отдельный холст и дальше копируется одним drawImage вместо сотен граней. Рисунок тот же: спрайт делается
// той же функцией рисования, в тех же единицах и с той же плотностью пикселей; сдвиг — не больше полпикселя.
// Порядок: 1-й кадр с ключом — обычное рисование + замер границ (прокси холста); 2-й — спрайт; дальше — копия.
// Модели с анимацией по времени (винты, покачивание) кэш не берёт: функция сообщает cacheable=false.
const BOUND_METHODS = new Set(['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'fillRect', 'strokeRect', 'drawImage', 'fillText', 'strokeText', 'roundRect']);
const UNSAFE = new Set(['translate', 'rotate', 'scale', 'setTransform', 'transform', 'resetTransform', 'putImageData', 'clip']);

export const spriteMemoStats = { hits: 0, made: 0, direct: 0, enabled: true };

export class SpriteMemo {
  constructor(max = 64) { this.map = new Map(); this.max = max; }
  get(key) { const s = this.map.get(key); if (s) { this.map.delete(key); this.map.set(key, s); } return s; }
  put(key, s) { this.map.set(key, s); while (this.map.size > this.max) this.map.delete(this.map.keys().next().value); }
  clear() { this.map.clear(); }
}

// Прокси холста: всё пересылает настоящему, по пути собирает границы рисунка в координатах пользователя
export function boundsProxy(ctx) {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, lw: 1, blur: 0, unsafe: false };
  const add = (x, y, r = 0) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return; if (x - r < b.x0) b.x0 = x - r; if (y - r < b.y0) b.y0 = y - r; if (x + r > b.x1) b.x1 = x + r; if (y + r > b.y1) b.y1 = y + r; };
  const proxy = new Proxy(ctx, {
    get(t, k) {
      const v = t[k];
      if (typeof v !== 'function') return v;
      if (UNSAFE.has(k)) return (...a) => { b.unsafe = true; return v.apply(t, a); };
      if (!BOUND_METHODS.has(k)) return (...a) => v.apply(t, a);
      return (...a) => {
        if (k === 'arc') add(a[0], a[1], Math.abs(a[2]));
        else if (k === 'ellipse') add(a[0], a[1], Math.max(Math.abs(a[2]), Math.abs(a[3])));
        else if (k === 'rect' || k === 'fillRect' || k === 'strokeRect' || k === 'roundRect') { add(a[0], a[1]); add(a[0] + a[2], a[1] + a[3]); }
        else if (k === 'drawImage') { const n = a.length; const dx = n >= 9 ? a[5] : a[1], dy = n >= 9 ? a[6] : a[2], dw = n >= 9 ? a[7] : n >= 5 ? a[3] : a[0].width, dh = n >= 9 ? a[8] : n >= 5 ? a[4] : a[0].height; add(dx, dy); add(dx + dw, dy + dh); }
        else if (k === 'fillText' || k === 'strokeText') b.unsafe = true; // ширину текста не меряем — без кэша
        else for (let i = 0; i + 1 < a.length; i += 2) add(a[i], a[i + 1]);
        return v.apply(t, a);
      };
    },
    set(t, k, v) {
      if (k === 'lineWidth' && v > b.lw) b.lw = v;
      if (k === 'shadowBlur' && v > b.blur) b.blur = v;
      if (k === 'filter' && v && v !== 'none') b.unsafe = true;
      t[k] = v; return true;
    },
  });
  return { proxy, b };
}

// draw(ctx, x, y) → { result, cacheable }. Возвращает result (из кэша — сохранённый).
export function memoDraw(ctx, memo, key, x, y, draw) {
  const tr = spriteMemoStats.enabled && key && typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const plain = tr && tr.b === 0 && tr.c === 0 && tr.a === tr.d && tr.a > 0 && ctx.globalAlpha === 1 && (ctx.filter === undefined || ctx.filter === 'none') && ctx.globalCompositeOperation === 'source-over' && typeof document !== 'undefined';
  if (!plain) { spriteMemoStats.direct++; return draw(ctx, x, y).result; }
  const dpr = tr.a, k = key + '|' + dpr;
  const s = memo.get(k);
  if (s && s.nocache) { spriteMemoStats.direct++; return draw(ctx, x, y).result; }
  if (s && s.canvas) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(s.canvas, Math.round(x * dpr + tr.e) - s.ax, Math.round(y * dpr + tr.f) - s.ay);
    ctx.restore();
    spriteMemoStats.hits++;
    return s.result;
  }
  if (s && s.bounds) { // второй кадр подряд с тем же ключом — сделать спрайт
    const bb = s.bounds, pad = Math.ceil(bb.lw + bb.blur + 2);
    const w = Math.ceil((bb.x1 - bb.x0 + 2 * pad) * dpr), h = Math.ceil((bb.y1 - bb.y0 + 2 * pad) * dpr);
    if (w > 0 && h > 0 && w * h <= 4e6) {
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const c = canvas.getContext('2d');
      const ax = Math.ceil((bb.dx + pad) * dpr), ay = Math.ceil((bb.dy + pad) * dpr); // якорь (x, y) в пикселях спрайта
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const out = draw(c, ax / dpr, ay / dpr);
      memo.put(k, { canvas, ax, ay, result: out.result });
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(canvas, Math.round(x * dpr + tr.e) - ax, Math.round(y * dpr + tr.f) - ay);
      ctx.restore();
      spriteMemoStats.made++;
      return out.result;
    }
  }
  // первый кадр: обычное рисование с замером границ
  const { proxy, b } = boundsProxy(ctx);
  const out = draw(proxy, x, y);
  spriteMemoStats.direct++;
  if (!out.cacheable || b.unsafe || !Number.isFinite(b.x0)) memo.put(k, { nocache: !out.cacheable || b.unsafe });
  else memo.put(k, { bounds: { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, dx: x - b.x0, dy: y - b.y0, lw: b.lw, blur: b.blur } });
  return out.result;
}

// Обрезать прозрачные поля готового спрайта (рисунок тот же, пиксель в пиксель): меньше пустых пикселей
// в каждом кадре. Холст лучше создавать с getContext('2d', { willReadFrequently: true }) — чтение один раз.
// → { canvas, x, y } — новый холст и сдвиг обрезки в пикселях исходного.
export function trimCanvas(canvas, pad = 1) {
  const W = canvas.width, H = canvas.height;
  let data;
  try { data = canvas.getContext('2d').getImageData(0, 0, W, H).data; } catch { return { canvas, x: 0, y: 0 }; }
  if (!data || data.length < W * H * 4) return { canvas, x: 0, y: 0 };
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = 0; x < W; x++) if (data[row + x * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  }
  if (x1 < 0) { const c = document.createElement('canvas'); c.width = c.height = 1; return { canvas: c, x: 0, y: 0 }; }
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w * h > W * H * 0.8) return { canvas, x: 0, y: 0 };
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
  return { canvas: c, x: x0, y: y0 };
}
// Спрайт { canvas, ox, oy, w, h } (w, h — размер в CSS-пикселях, ox, oy — якорь) после обрезки: тот же масштаб
export function trimSprite(sp) {
  const sx = sp.w / sp.canvas.width, sy = sp.h / sp.canvas.height, t = trimCanvas(sp.canvas);
  if (t.canvas === sp.canvas) return sp;
  return { ...sp, canvas: t.canvas, ox: sp.ox - t.x * sx, oy: sp.oy - t.y * sy, w: t.canvas.width * sx, h: t.canvas.height * sy };
}
