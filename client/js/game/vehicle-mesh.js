import { SpriteMemo, memoDraw } from './sprite-memo.js';
// Техника из низкополигональных моделей (mesh-art.js), размеры в метрах по прототипам:
// Т-14 «Армата», лёгкий танк, БМП, БТР, Ка-52, Ил-2 и другие. Каждая модель возвращает стволы для вспышек выстрела.
import { meshRig, rotAt, pathLinks, M_TO_UNIT } from './mesh-art.js';
import { tone } from './figure-art.js';
import { EXTRA } from './vehicle-mesh-extra.js';
import { connectFitting } from './mesh-attachments.js';

const TAU = Math.PI * 2;
// Поворотная башня: поворот вокруг вертикали через piv, рисуется поверх корпуса (bias)
const turretBlock = (g, angle, piv, bias, fn) => g.with(rotAt('z', angle, piv), fn, bias);
const RUBBER = '#25292a', STEEL = '#3a4247', DARK = '#1d2124', GLASS = '#5d8fa3', LAMP = '#f3e3b0', RED = '#a8352f';

// ---------- Гусеничный ход ----------
// P: { L — длина хода, wheels, r — радиус катка, x0/x1 — внутренняя/внешняя кромка гусеницы, top — высота верхней ветви }
function trackRun(g, P, side, phase, col) {
  const { L, wheels, r, x0, x1 } = P, half = L / 2, zc = r + 0.08, top = P.top || zc + r + 0.14;
  const xi = side * x0, xo = side * x1, xa = Math.min(xi, xo), xb = Math.max(xi, xo);
  const idler = [half + 0.32, zc + 0.16], spr = [-half - 0.38, zc + 0.22];
  const segs = [
    { a: [-half + 0.1, 0.04] }, { a: [half - 0.1, 0.04] },
    { c: idler, r: idler[1] - 0.04, a0: -1.85, a1: Math.PI / 2 },
    { a: [half - 0.2, top] }, { a: [-half + 0.2, top + 0.04] },
    { c: spr, r: spr[1] - 0.04, a0: Math.PI / 2, a1: Math.PI * 1.5 + 0.3 },
  ];
  const pitch = g.q === 0 ? 0.55 : g.q === 1 ? 0.34 : 0.26;
  for (const { p, t } of pathLinks(segs, pitch, phase)) {
    const n = [t[1], -t[0]], hl = pitch * 0.46;
    const at = (s, h) => [p[0] + t[0] * s + n[0] * h, p[1] + t[1] * s + n[1] * h];
    const q4 = [at(-hl, -0.03), at(hl, -0.03), at(hl, 0.07), at(-hl, 0.07)];
    g.hexa([
      [xa, q4[0][0], q4[0][1]], [xb, q4[0][0], q4[0][1]], [xb, q4[1][0], q4[1][1]], [xa, q4[1][0], q4[1][1]],
      [xa, q4[3][0], q4[3][1]], [xb, q4[3][0], q4[3][1]], [xb, q4[2][0], q4[2][1]], [xa, q4[2][0], q4[2][1]],
    ], [col, tone(col, 0.06)], { bias: 0.002, noEdge: true });
  }
  // Катки, ленивец и ведущее колесо (с зубьями); ступицы вращаются
  const spin = -phase / r;
  const wheel = (yy, zz, rr) => g.wheel([side * (x0 + x1) / 2, yy, zz], [side, 0, 0], rr, Math.abs(x1 - x0) * 0.45, RUBBER, spin * (r / rr));
  for (let i = 0; i < wheels; i++) wheel(-half + 0.45 + i * (L - 0.9) / (wheels - 1), zc, r);
  wheel(idler[0], idler[1], 0.28);
  wheel(spr[0], spr[1], 0.32);
}

// ---------- Т-14 «Армата» и лёгкий танк ----------
function tank(g, def, v, ctx) {
  const light = def.id === 'light_tank', S = light ? 0.8 : 1, c = ctx.color;
  const L = (light ? 5.6 : 7.0), half = L / 2, W = light ? 1.0 : 1.2, TX0 = W, TX1 = W + (light ? 0.5 : 0.6), r = light ? 0.34 : 0.38;
  for (const side of [-1, 1]) trackRun(g, { L, wheels: light ? 5 : 7, r, x0: TX0, x1: TX1 }, side, ctx.phase, ctx.trackCol);
  const deck = light ? 1.62 : 1.9, nose = half + (light ? 0.75 : 0.95), tail = -half - (light ? 0.55 : 0.7);
  // Корпус: длинный клин, высокий лоб, плоская моторная корма
  g.prismX([[tail, 0.48], [tail, deck - 0.15], [tail + 0.25, deck], [half - 0.6, deck], [nose, deck - (light ? 0.55 : 0.7)], [nose - 0.25, 0.5]], -W, W, c);
  // Надгусеничные полки и бортовые экраны (секциями)
  for (const side of [-1, 1]) {
    g.box(side * (W + (TX1 - TX0) / 2), (nose + tail) / 2 - 0.05, deck - 0.85, TX1 - TX0 + 0.12, nose - tail - 0.4, 0.07, tone(c, -0.08), { bias: 0.6 });
    const n = light ? 4 : 6, y0 = tail + 0.35, step = (nose - tail - 0.9) / n;
    for (let i = 0; i < n; i++) g.box(side * (TX1 + 0.04), y0 + step * (i + 0.5), deck - 1.4 + (i === n - 1 ? 0.06 : 0), 0.08, step * 0.96, 0.62, i % 2 ? c : tone(c, -0.06), { bias: 0.6 });
    g.box(side * (TX1 + 0.05), nose - 0.55, deck - 1.25, 0.06, 0.6, 0.42, DARK, { bias: 0.6 }); // резиновый фартук
  }
  // Детали корпуса: решётки МТО, фары, люк механика, буксирные крюки
  for (let i = 0; i < 3; i++) g.box(0, tail + 0.45 + i * 0.42, deck, W * 1.5, 0.3, 0.03, DARK, { noEdge: true });
  for (const side of [-1, 1]) {
    g.box(side * W * 0.72, nose - 0.48, deck - 0.62, 0.22, 0.1, 0.12, LAMP, { glow: true });
    g.box(side * W * 0.5, tail + 0.02, 0.9, 0.18, 0.06, 0.1, RED, { glow: true });
  }
  g.box(0, half - 0.75, deck - 0.02, 0.6, 0.5, 0.12, tone(c, -0.12));
  // Необитаемая башня (поворачивается), пушка 125 мм, боевой модуль с пулемётом
  const piv = [0, light ? -0.2 : -0.45, 0];
  const turrets = [];
  turretBlock(g, ctx.turretAngle, piv, 1, () => {
    const ty = piv[1], tz0 = deck, tz1 = deck + (light ? 0.62 : 0.72);
    const plan = light
      ? [[-0.95, -1.2], [0.95, -1.2], [1.05, 0.2], [0.7, 1.2], [-0.7, 1.2], [-1.05, 0.2]]
      : [[-1.18, -1.75], [1.18, -1.75], [1.32, 0.15], [0.95, 1.5], [0.4, 1.95], [-0.4, 1.95], [-0.95, 1.5], [-1.32, 0.15]];
    g.prismZ(plan.map(([px, py]) => [px, py + ty]), tz0, tz1, tone(c, 0.04), 0.86);
    g.box(0, ty - (light ? 1.35 : 1.95), tz0 + 0.08, light ? 1.4 : 1.9, 0.45, 0.48, tone(c, -0.08)); // кормовая ниша
    // Решётки и блоки защиты по бортам башни
    for (const side of [-1, 1]) {
      g.box(side * (light ? 1.0 : 1.3), ty - 0.5, tz0 + 0.12, 0.12, light ? 1.0 : 1.5, 0.42, tone(c, -0.14));
      if (!light && g.q > 0) for (let k = 0; k < 3; k++) g.tube([side * 1.2, ty + 0.6 + k * 0.2, tz1 - 0.05], [side * 1.32, ty + 0.62 + k * 0.2, tz1 + 0.05], 0.06, 0.06, DARK, 6);
    }
    // Прицелы: наводчика (спереди), панорама командира (на мачте)
    g.box(-0.55, ty + 0.9, tz1, 0.32, 0.4, 0.26, STEEL); g.box(-0.55, ty + 1.1, tz1 + 0.05, 0.22, 0.04, 0.14, GLASS, { glow: true });
    g.tube([0.2, ty - 1.0, tz1], [0.2, ty - 1.0, tz1 + 0.35], 0.06, 0.06, STEEL, 6);
    g.box(0.2, ty - 1.0, tz1 + 0.35, 0.36, 0.36, 0.24, STEEL); g.box(0.2, ty - 0.82, tz1 + 0.4, 0.2, 0.03, 0.12, GLASS, { glow: true });
    // Пушка: маска, длинный гладкий ствол с кожухом
    const gz = tz0 + (light ? 0.32 : 0.36), front = ty + (light ? 1.2 : 1.95);
    g.box(0, front - 0.05, gz - 0.2, light ? 0.5 : 0.62, 0.35, 0.42, tone(c, -0.06));
    const len = light ? 3.2 : 5.6, end = [0, front + len, gz];
    g.tube([0, front, gz], [0, front + len * 0.55, gz], light ? 0.07 : 0.11, light ? 0.06 : 0.1, tone(c, -0.04), 10);
    g.tube([0, front + len * 0.55, gz], end, light ? 0.055 : 0.09, light ? 0.05 : 0.085, tone(c, -0.1), 10);
    if (light) g.tube([0, end[1] - 0.25, gz], [0, end[1] + 0.05, gz], 0.075, 0.075, DARK, 8); // дульный тормоз
    turrets.push({ end: g.at(end), front: true });
    // Дистанционный боевой модуль (пулемёт 7,62 / 12,7) на крыше башни
    const rw = [light ? 0.45 : 0.62, ty - (light ? 0.4 : 0.7), tz1];
    g.tube(rw, [rw[0], rw[1], rw[2] + 0.12], 0.2, 0.18, STEEL, 8);
    g.box(rw[0], rw[1], rw[2] + 0.12, 0.34, 0.5, 0.26, tone(c, -0.1));
    g.box(rw[0] - 0.12, rw[1] + 0.2, rw[2] + 0.2, 0.08, 0.14, 0.1, GLASS, { glow: true });
    g.box(rw[0] + 0.19, rw[1] + 0.02, rw[2] + 0.14, 0.12, 0.3, 0.16, '#5a5a3a'); // короб с лентой
    const mgEnd = [rw[0] + 0.05, rw[1] + 1.25, rw[2] + 0.25];
    g.tube([rw[0] + 0.05, rw[1] + 0.25, rw[2] + 0.25], mgEnd, 0.035, 0.03, DARK, 6);
    turrets.push({ end: g.at(mgEnd) });
  });
  return turrets;
}

// Ограничить угол турели её сектором: center — направление сектора (0 — нос, π — корма), half — полуширина
export function clampArc(a, center, half) {
  const d = Math.atan2(Math.sin(a - center), Math.cos(a - center));
  return center + Math.max(-half, Math.min(half, d));
}

// ---------- Ка-52 «Аллигатор» ----------
function ka52(g, def, v, ctx) {
  const c = ctx.color, belly = tone(c, 0.18), dark = tone(c, -0.25);
  const oct = (w, z0, z1) => { const h = z1 - z0, m = (z0 + z1) / 2; return [[-w * 0.5, z0 + h * 0.18], [-w * 0.3, z0], [w * 0.3, z0], [w * 0.5, z0 + h * 0.18], [w * 0.5, z1 - h * 0.25], [w * 0.28, z1], [-w * 0.28, z1], [-w * 0.5, z1 - h * 0.25]].map(([px, pz]) => [px, pz + 0 * m]); };
  const paint = (k, n) => (n[2] < -0.45 ? belly : c);
  g.loft([
    { y: -2.6, pts: oct(0.8, 1.3, 2.2) }, { y: -1.2, pts: oct(1.6, 0.75, 2.45) }, { y: 1.0, pts: oct(1.75, 0.6, 2.5) },
    { y: 3.0, pts: oct(1.65, 0.65, 2.1) }, { y: 4.4, pts: oct(1.05, 0.85, 1.8) }, { y: 5.2, pts: oct(0.35, 1.15, 1.45) },
  ], paint);
  // Кабина: широкий фонарь, лётчики сидят бок о бок (рамка посередине)
  g.loft([{ y: 1.4, pts: oct(1.5, 2.05, 2.75) }, { y: 2.8, pts: oct(1.55, 1.95, 2.6) }, { y: 4.15, pts: oct(1.0, 1.7, 1.95) }], GLASS);
  g.box(0, 2.8, 2.5, 0.06, 2.6, 0.08, dark, { bias: 0.3 });
  // Хвостовая балка, стабилизатор с двумя килями на концах
  g.tube([0, -2.4, 1.85], [0, -6.6, 2.0], 0.36, 0.2, c, 8);
  g.plate([[-1.7, -5.7, 2.0], [1.7, -5.7, 2.0], [1.7, -6.3, 2.0], [-1.7, -6.3, 2.0]], 0.08, c);
  for (const side of [-1, 1]) g.prismX([[-5.6, 1.6], [-5.9, 2.6], [-6.5, 2.75], [-6.4, 1.6]], side * 1.72, side * 1.64, tone(c, -0.05));
  g.prismX([[-6.2, 2.0], [-6.5, 3.1], [-6.95, 3.1], [-6.8, 2.0]], -0.05, 0.05, c);
  // Двигатели по бокам редуктора
  for (const side of [-1, 1]) {
    g.tube([side * 0.95, 1.2, 2.4], [side * 0.95, -1.9, 2.4], 0.4, 0.32, tone(c, -0.06), 8);
    g.box(side * 1.05, -2.05, 2.25, 0.3, 0.3, 0.3, DARK);
  }
  // Крылья с пилонами: блоки НАР Б-8 и ПТУР
  for (const side of [-1, 1]) {
    g.plate([[side * 0.6, 0.3, 1.25], [side * 3.0, -0.05, 1.18], [side * 3.0, -0.95, 1.18], [side * 0.6, -1.25, 1.25]], 0.12, c);
    for (const xx of [1.5, 2.4]) {
      g.box(side * xx, -0.45, 0.95, 0.1, 0.5, 0.22, DARK);
      g.tube([side * xx, 0.55, 0.72], [side * xx, -1.45, 0.72], 0.26, 0.26, xx > 2 ? '#56604f' : '#4a5248', 10);
      if (g.q > 0) g.tube([side * xx, 0.56, 0.72], [side * xx, 0.6, 0.72], 0.16, 0.16, DARK, 8);
    }
    g.tube([side * 3.05, 0.5, 1.05], [side * 3.05, -1.3, 1.05], 0.1, 0.1, '#7a7f6a', 6);
  }
  // Шасси (на земле)
  if (!(ctx.alt > 0.05)) for (const [xx, yy] of [[-0.8, -0.6], [0.8, -0.6], [0, 4.0]]) { g.box(xx, yy, 0.25, 0.06, 0.06, 0.55, STEEL); g.tube([xx - 0.1, yy, 0.25], [xx + 0.1, yy, 0.25], 0.24, 0.24, RUBBER, 8); }
  // Шар оптики и подвижная пушечная турель под носом (брюхо)
  g.tube([0, 4.55, 0.86], [0, 4.85, 0.86], 0.28, 0.2, '#2e3a3f', 8);
  g.box(0, 4.85, 0.78, 0.22, 0.04, 0.16, GLASS, { glow: true });
  const turrets = [];
  const piv = [0, 3.4, 0.55], ta = clampArc(ctx.turretAngle, 0, Math.PI / 2);
  g.with(rotAt('z', ta, piv), () => {
    g.tube([0, 3.4, 0.68], [0, 3.4, 0.45], 0.3, 0.26, tone(c, -0.12), 8);
    g.box(0, 3.45, 0.3, 0.34, 0.5, 0.2, DARK);
    const end = [0, 5.0, 0.4];
    g.tube([0, 3.6, 0.4], end, 0.06, 0.05, '#262b2e', 6);
    turrets.push({ end: g.at(end), front: true });
  });
  // Соосные винты: два ротора навстречу; на ходу — диски размытия
  g.tube([0, 0.2, 2.4], [0, 0.2, 3.95], 0.17, 0.14, STEEL, 8);
  g.box(0, 0.2, 3.05, 0.5, 0.5, 0.22, STEEL); g.box(0, 0.2, 3.62, 0.45, 0.45, 0.2, STEEL);
  const spinning = !ctx.wreck;
  const rotor = (z, a, col) => {
    for (let k = 0; k < 3; k++) {
      const t = a + k * TAU / 3, cx = Math.sin(t), cy = Math.cos(t), px = cy * 0.12, py = -cx * 0.12;
      g.plate([[px, 0.2 + py, z], [cx * 5.2 + px, 0.2 + cy * 5.2 + py, z], [cx * 5.2 - px, 0.2 + cy * 5.2 - py, z], [-px, 0.2 - py, z]], 0.05, col, { two: true, alpha: spinning ? 0.7 : 1 });
    }
    if (spinning && g.q > 0) g.disc([0, 0.2, z], 5.2, 'z', '#d8e0e0', 0.12);
  };
  rotor(3.15, ctx.wreck ? 0.4 : ctx.time / 38, '#2b2f30');
  rotor(3.75, ctx.wreck ? 1.1 : -ctx.time / 43, '#343839');
  return turrets;
}

// ---------- Ил-2 (двухместный штурмовик) ----------
function il2(g, def, v, ctx) {
  const top = ctx.wreck ? ctx.color : '#4b5a32', belly = ctx.wreck ? ctx.color : '#93aebd';
  const paint = (k, n) => (n[2] < -0.35 ? belly : top);
  const sec = (w, z0, z1) => [[-w / 2, z0 + 0.2], [-w * 0.3, z0], [w * 0.3, z0], [w / 2, z0 + 0.2], [w / 2, z1 - 0.18], [w * 0.28, z1], [-w * 0.28, z1], [-w / 2, z1 - 0.18]];
  g.loft([
    { y: -4.9, pts: sec(0.16, 1.6, 1.85) }, { y: -2.0, pts: sec(0.75, 1.15, 2.0) }, { y: 0.4, pts: sec(1.05, 0.9, 2.08) },
    { y: 2.6, pts: sec(1.15, 0.85, 2.05) }, { y: 4.6, pts: sec(1.0, 0.95, 1.9) }, { y: 5.35, pts: sec(0.7, 1.15, 1.7) },
  ], paint);
  // Две кабины под длинным фонарём: лётчик спереди, стрелок сзади
  g.loft([{ y: 0.55, pts: sec(0.6, 2.0, 2.5) }, { y: 1.3, pts: sec(0.66, 2.0, 2.62) }, { y: 2.1, pts: sec(0.5, 1.98, 2.3) }], GLASS);
  g.loft([{ y: -1.15, pts: sec(0.5, 1.98, 2.22) }, { y: -0.55, pts: sec(0.62, 2.0, 2.45) }, { y: 0.2, pts: sec(0.6, 2.0, 2.48) }], tone(GLASS, -0.1));
  g.box(0, 0.38, 2.0, 0.64, 0.12, 0.42, tone(top, -0.1)); // бронеперегородка между кабинами
  // Крылья (низкоплан, лёгкое V), пушки ВЯ-23 в крыльях, РС-82 и бомбы под крылом
  for (const side of [-1, 1]) {
    g.plate([[side * 0.5, 2.0, 1.0], [side * 6.6, 0.95, 1.38], [side * 6.6, 0.05, 1.38], [side * 0.5, -0.9, 1.0]], 0.16, paint);
    g.tube([side * 1.9, 1.5, 0.95], [side * 1.9, 2.75, 0.95], 0.06, 0.05, DARK, 6);
    g.tube([side*1.9,1.5,.95],[side*1.9,1.5,1.15],.055,.055,STEEL,8);
    for (let k = 0; k < (g.q ? 4 : 2); k++) {
      const xx = side * (2.6 + k * 0.55),wingZ=1+(Math.abs(xx)-.5)/6.1*.38;
      g.tube([xx, 1.3, 0.85], [xx, -0.1, 0.85], 0.07, 0.07, '#6d6f65', 6);
      for(const y of [.2,.75])g.tube([xx,y,.85],[xx,y,wingZ],.045,.045,STEEL,8);
    }
    g.tube([side * 1.1, 1.0, 0.7], [side * 1.1, -0.4, 0.7], 0.15, 0.1, '#3d4232', 8);
    // Bolted replacement wing skin instead of factory markings.
    g.plate([[side*4,.85,1.39],[side*5,.85,1.39],[side*5,.15,1.39],[side*4,.15,1.39]],.025,'#6b5741');
    for(let k=0;k<3;k++)g.box(side*(4.1+k*.35),.8,1.42,.04,.04,.025,'#b4aa8e');
    if (!(ctx.alt > 0.05)) { g.box(side * 1.6, 1.3, 0.3, 0.08, 0.08, 0.7, STEEL); g.tube([side * 1.5, 1.3, 0.32], [side * 1.7, 1.3, 0.32], 0.32, 0.32, RUBBER, 10); }
  }
  // Оперение
  g.plate([[-2.2, -3.9, 1.75], [2.2, -3.9, 1.75], [1.9, -4.7, 1.75], [-1.9, -4.7, 1.75]], 0.08, paint);
  g.prismX([[-4.0, 1.85], [-4.5, 2.95], [-4.95, 2.95], [-4.95, 1.75]], -0.05, 0.05, top);
  if (!(ctx.alt > 0.05)) g.tube([-0.08, -4.4, 1.45], [0.08, -4.4, 1.45], 0.14, 0.14, RUBBER, 8);
  // Мотор: радиатор, патрубки, кок и трёхлопастный винт
  g.box(0, 4.7, 0.78, 0.5, 0.6, 0.22, DARK);
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) g.box(side * 0.52, 4.3 - k * 0.3, 1.55, 0.08, 0.14, 0.1, '#5a4a3a');
  g.tube([0, 5.3, 1.42], [0, 5.95, 1.42], 0.3, 0.06, '#d9d4c8', 8);
  const pa = ctx.wreck ? 0.5 : ctx.time / 24;
  for (let k = 0; k < 3; k++) { const t = pa + k * TAU / 3; g.plate([[0, 5.65, 1.42], [Math.cos(t) * 1.65 + 0.08, 5.65, 1.42 + Math.sin(t) * 1.65], [Math.cos(t) * 1.65 - 0.08, 5.7, 1.42 + Math.sin(t) * 1.65 - 0.12]], 0.05, '#2c2f2b', { two: true }); }
  if (!ctx.wreck && g.q > 0) g.disc([0, 5.68, 1.42], 1.65, 'y', '#d8dcd4', 0.14);
  // Курсовые пушки неподвижны (огонь вперёд); турель стрелка — задняя полусфера
  const turrets = [{ end: [-1.9, 2.75, 0.95], front: true }];
  const rp = [0, -0.75, 2.25], ra = clampArc(ctx.rearAngle, Math.PI, Math.PI / 2);
  turretBlock(g, ra, rp, 0.3, () => {
    g.tube([0, -0.75, 2.2], [0, -0.75, 2.42], 0.14, 0.12, STEEL, 8);
    const end = [0, -0.75 + 1.25, 2.48];
    g.tube([0, -0.75, 2.45], end, 0.035, 0.03, DARK, 6);
    turrets.push({ end: g.at(end), rear: true });
  });
  return turrets;
}


// ---------- Колёсная техника ----------
function wheelSet(g, ctx, axles, xw, r, w = 0.3) {
  const spin = -ctx.phase / r;
  for (const yy of axles) for (const side of [-1, 1]) {
    g.box(side * (xw - 0.04), yy, r * 0.4, w * 1.15, r * 2.25, r * 1.15, '#171a1c', { noEdge: true, bias: 0.05 });
    g.box(side * (xw + w * 0.16), yy, r * 1.5, w * 0.55, r * 2.35, 0.08, '#4a5258', { bias: 0.14 });
    g.wheel([side * (xw + w * 0.95), yy, r], [side, 0, 0], r, w * 0.8, RUBBER, spin);
  }
}
// Лобовое стекло — горизонтальные металлические жалюзи в стальной раме и смотровая щель.
function louvers(g, y0, z0, y1, z1, halfW) {
  const n = 5, dy = (y1 - y0) / n, dz = (z1 - z0) / n;
  for (const side of [-1, 1]) g.box(side * halfW * 0.96, (y0 + y1) / 2, Math.min(z0, z1), 0.06, Math.abs(y1 - y0) * 0.92, Math.abs(z1 - z0) * 0.92, '#3c4348', { bias: 0.15 });
  for (let i = 0; i < n; i++) {
    const slit = i === 2;
    g.box(0, y0 + dy * (i + 0.5), z0 + dz * i, halfW * 1.9, Math.max(0.05, Math.abs(dy) * 0.72), slit ? 0.025 : 0.048, slit ? '#0d1115' : '#656e77', { bias: 0.17 });
  }
}
// Турель с пулемётом на крыше (машины, автобусы, пикап): 360°, если нет кормовой установки
function roofGun(g, ctx, at, heavy, turrets, arc = null) {
  connectFitting(g,g.attachmentSurface(),at,'primary:roof');
  const a = arc ? clampArc(ctx.turretAngle, arc[0], arc[1]) : ctx.turretAngle;
  turretBlock(g, a, at, 1, () => {
    g.tube(at, [at[0], at[1], at[2] + 0.18], 0.22, 0.2, STEEL, 8);
    g.box(at[0], at[1], at[2] + 0.18, 0.5, 0.36, 0.3, tone(ctx.color, -0.12));
    g.box(at[0], at[1] + 0.2, at[2] + 0.18, 0.56, 0.06, 0.42, STEEL); // щиток
    const end = [at[0], at[1] + (heavy ? 1.6 : 1.25), at[2] + 0.36];
    g.tube([at[0], at[1] + 0.1, at[2] + 0.36], end, heavy ? 0.05 : 0.035, heavy ? 0.045 : 0.03, DARK, 6);
    turrets.push({ end: g.at(end), front: true });
  });
}
function lamps(g, yFront, yBack, z, xw) {
  for (const side of [-1, 1]) {
    g.box(side * xw, yFront, z, 0.26, 0.06, 0.12, LAMP, { glow: true });
    g.box(side * xw, yBack, z, 0.2, 0.05, 0.1, RED, { glow: true });
  }
}
// Легковые: car, sedan, armored_car (универсал)
function car(g, def, v, ctx) {
  const c = ctx.color, armored = def.id === 'armored_car', sedan = def.id === 'sedan';
  const L = armored ? 4.9 : sedan ? 4.8 : 4.3, half = L / 2, W = armored ? 1.95 : 1.8, r = armored ? 0.38 : 0.33;
  wheelSet(g, ctx, [half - 0.85, -half + 0.8], W / 2 - 0.12, r, 0.26);
  const zb = r * 0.75, zt = armored ? 1.05 : 0.92;
  g.prismX([[-half, zb + 0.05], [-half, zt - 0.08], [-half + 0.25, zt], [half - 1.25, zt], [half - 0.1, zt - 0.14], [half, zb + 0.18], [half - 0.2, zb]], -W / 2, W / 2, c);
  const back = armored ? -half + 0.15 : sedan ? -half + 0.9 : -half + 0.7, roofB = armored ? -half + 0.25 : back + 0.35;
  g.prismX([[back, zt], [roofB, zt + (armored ? 0.62 : 0.5)], [half - 1.9, zt + (armored ? 0.62 : 0.5)], [half - 1.25, zt]], -W * 0.44, W * 0.44, '#3a4248');
  louvers(g, half - 1.9, zt + (armored ? 0.62 : 0.5), half - 1.25, zt, W * 0.44);
  g.box(0, (roofB + half - 1.9) / 2, zt + (armored ? 0.6 : 0.48), W * 0.9, half - 1.9 - roofB, 0.06, tone(c, 0.05));
  g.box(0, (roofB + half - 1.9) / 2, zt + 0.02, 0.06, half - 1.9 - roofB, (armored ? 0.6 : 0.48), c, { bias: 0.3 }); // стойки посередине
  lamps(g, half + 0.01, -half - 0.01, zt - 0.3, W * 0.34);
  g.box(0, half + 0.04, zb + 0.05, W * 0.92, 0.14, 0.24, STEEL);
  for (let i = -2; i <= 2; i++) g.box(i * W * 0.18, half + 0.1, zb + 0.08, 0.04, 0.12, 0.2, '#8b8e91');
  if (armored) { for (const side of [-1, 1]) g.box(side * (W / 2 + 0.02), 0, zb + 0.2, 0.05, L * 0.7, 0.4, STEEL); g.box(0, half - 0.6, zt + 0.01, W * 0.8, 0.5, 0.04, DARK); }
  const turrets = [];
  if (def.weapon) roofGun(g, ctx, [0, (roofB + half - 1.9) / 2 - 0.2, zt + (armored ? 0.66 : 0.54)], armored, turrets);
  return turrets;
}
// Пикап (Ford Raptor): двойная кабина, открытый кузов, пулемёт в кузове
function pickup(g, def, v, ctx) {
  const c = ctx.color, L = 5.8, half = L / 2, W = 2.15, r = 0.46;
  wheelSet(g, ctx, [half - 1.05, -half + 1.1], W / 2 - 0.12, r, 0.34);
  const zb = r * 0.85, zt = 1.25;
  g.prismX([[0.1, zb], [0.1, zt + 0.02], [half - 1.0, zt], [half - 0.05, zt - 0.12], [half, zb + 0.2], [half - 0.25, zb]], -W / 2, W / 2, c);
  g.prismX([[-half, zb + 0.1], [-half, zt - 0.05], [0.1, zt - 0.05], [0.1, zb + 0.1]], -W / 2, -W / 2 + 0.1, c);
  g.prismX([[-half, zb + 0.1], [-half, zt - 0.05], [0.1, zt - 0.05], [0.1, zb + 0.1]], W / 2 - 0.1, W / 2, c);
  g.box(0, -half + 0.05, zb + 0.1, W, 0.1, zt - zb - 0.15, c);
  g.box(0, (-half + 0.1) / 2, zb + 0.1, W - 0.2, half - 0.1, 0.06, tone(c, -0.3));
  g.prismX([[0.15, zt], [0.25, zt + 0.62], [half - 1.65, zt + 0.62], [half - 1.0, zt]], -W * 0.45, W * 0.45, '#3a4248');
  louvers(g, half - 1.65, zt + 0.62, half - 1.0, zt, W * 0.45);
  g.box(0, (0.25 + half - 1.65) / 2, zt + 0.6, W * 0.92, half - 1.9, 0.06, tone(c, 0.05));
  for (const side of [-1, 1]) for (const yy of [half - 1.05, -half + 1.1]) g.box(side * (W / 2 + 0.06), yy, r + 0.25, 0.14, 1.2, 0.14, DARK); // расширители арок
  g.box(0, half + 0.04, zb + 0.08, W * 0.94, 0.16, 0.34, STEEL);
  g.box(0, half + 0.02, zb + 0.15, W * 0.7, 0.12, 0.42, '#24292a'); // решётка
  lamps(g, half + 0.02, -half - 0.02, zt - 0.35, W * 0.38);
  const turrets = [];
  roofGun(g, ctx, [0, -half + 1.2, zb + 0.16], false, turrets);
  return turrets;
}
// Грузовик с прицепом / тягач с полуприцепом
function hauler(g, def, v, ctx) {
  const c = ctx.color, semi = def.id === 'semi_truck', W = 2.45, r = 0.52;
  const cab = 2.4, tl = semi ? 9.5 : 5.6, L = cab + tl + 0.5, front = L / 2, back = -L / 2;
  wheelSet(g, ctx, [front - 0.9, front - cab - 0.3, ...(semi ? [back + 1.4, back + 2.6] : [back + 1.0, back + 2.1])], W / 2 - 0.2, r, 0.42);
  // Кабина над двигателем
  g.box(0, front - cab / 2, r * 0.9, W, cab, 1.5, c, 0.1);
  g.prismX([[front - cab, r * 0.9 + 1.5], [front - cab, r * 0.9 + 2.55], [front - 0.25, r * 0.9 + 2.55], [front, r * 0.9 + 1.5]], -W / 2, W / 2, c);
  g.prismX([[front - 0.75, r * 0.9 + 1.6], [front - 0.3, r * 0.9 + 2.45], [front - 0.05, r * 0.9 + 1.6]], -W * 0.44, W * 0.44, '#3a4248');
  louvers(g, front - 0.75, r * 0.9 + 1.6, front - 0.05, r * 0.9 + 2.2, W * 0.44);
  for (const side of [-1, 1]) g.box(side * W * 0.38, front + 0.02, r * 0.9 + 0.35, 0.3, 0.06, 0.16, LAMP, { glow: true });
  g.prismZ([[-W * 0.52, front + 0.02], [W * 0.52, front + 0.02], [0, front + 0.38]], r * 0.9 - 0.05, r * 0.9 + 0.65, STEEL, 0.75);
  g.box(0, front + 0.02, r * 0.9 + 0.2, W * 0.5, 0.08, 0.5, '#24292a');
  g.tube([W / 2 - 0.15, front - cab - 0.05, r * 0.9 + 1.4], [W / 2 - 0.15, front - cab - 0.05, r * 0.9 + 3.0], 0.08, 0.08, STEEL, 6); // выхлоп
  // Рама и кузов-фургон
  g.box(0, (front - cab + back) / 2, r * 0.9, W * 0.6, front - cab - back, 0.25, DARK);
  const ty = back + tl / 2 + 0.1, tz = r * 0.9 + 0.3;
  g.box(0, ty, tz, W, tl, 2.3, tone(c, -0.12), 0.06);
  g.box(0, ty, tz + 2.3, W * 0.96, tl * 0.98, 0.05, tone(c, 0.05));
  if (g.q > 0) for (let k = 1; k < (semi ? 9 : 5); k++) g.box(0, back + 0.1 + k * tl / (semi ? 9 : 5), tz, W + 0.04, 0.06, 2.3, tone(c, -0.2), { bias: 0.01 });
  for (const side of [-1, 1]) g.box(side * W * 0.36, back + 0.08, tz + 0.2, 0.22, 0.04, 0.12, RED, { glow: true });
  const turrets = [];
  roofGun(g, ctx, [0, front - cab / 2 - 0.2, r * 0.9 + 2.55], true, turrets); // ракетная установка на крыше
  return turrets;
}
// Автобус Mercedes и защищённый автобус
function bus(g, def, v, ctx) {
  const c = ctx.color, armored = def.id === 'armored_bus', L = 10.5, half = L / 2, W = 2.5, r = 0.5, z0 = 0.45, H = 2.9;
  wheelSet(g, ctx, [half - 2.4, -half + 2.6], W / 2 - 0.08, r, 0.34);
  g.box(0, 0, z0, W, L, H, c, 0.15);
  g.prismX([[half - 0.05, z0 + 1.25], [half - 0.18, z0 + H - 0.2], [half - 0.02, z0 + H - 0.2], [half + 0.06, z0 + 1.25]], -W * 0.46, W * 0.46, '#3a4248');
  louvers(g, half - 0.2, z0 + H - 0.35, half + 0.02, z0 + 1.3, W * 0.46);
  for (const side of [-1, 1]) {
    g.box(side * (W / 2 + 0.01), -0.5, z0 + 1.35, 0.03, L - 2.2, 1.0, STEEL, { bias: 0.02 });
    if (armored) for (let k = 0; k < 7; k++) g.box(side * (W / 2 + 0.04), -half + 1.4 + k * 1.15, z0 + 1.4, 0.04, 0.85, 0.12, GLASS, { glow: true, bias: 0.03 });
    else if (g.q > 0) for (let k = 0; k < 8; k++) g.box(side * (W / 2 + 0.03), -half + 1.0 + k * 1.05, z0 + 1.35, 0.03, 0.08, 1.0, tone(c, -0.15), { bias: 0.04 });
    g.box(side * (W / 2 + 0.02), 0, z0 + 0.95, 0.02, L - 0.3, 0.06, '#c9c5b8', { bias: 0.03 });
  }
  g.box(0, 0, z0 + H, W * 0.6, L * 0.4, 0.22, tone(c, -0.08)); // кондиционер
  g.box(0, half + 0.05, z0 + 0.05, W * 0.96, 0.16, 0.38, STEEL);
  lamps(g, half + 0.03, -half - 0.03, z0 + 0.55, W * 0.36);
  const turrets = [];
  roofGun(g, ctx, [0, -half + 1.4, z0 + H], armored, turrets);
  return turrets;
}
// БТР-82А: восемь колёс, лодочный корпус, башенка с КПВТ
function btr(g, def, v, ctx) {
  const c = ctx.color, L = 7.6, half = L / 2, W = 2.9, r = 0.52;
  wheelSet(g, ctx, [2.3, 0.9, -0.9, -2.3], W / 2 - 0.15, r, 0.38);
  g.prismX([[-half, 0.75], [-half, 2.0], [-half + 0.5, 2.15], [half - 1.6, 2.15], [half, 1.4], [half - 0.6, 0.55], [-half + 0.5, 0.55]], -W / 2 + 0.2, W / 2 - 0.2, c);
  for (const side of [-1, 1]) g.prismX([[-half + 0.2, 1.2], [-half + 0.4, 1.95], [half - 1.4, 1.95], [half - 0.3, 1.3]], side * (W / 2 - 0.2), side * (W / 2 + 0.05), tone(c, -0.05));
  for (const side of [-1, 1]) { g.box(side * 0.55, half - 0.95, 1.65, 0.4, 0.05, 0.2, GLASS, { glow: true, bias: 0.1 }); g.box(side * (W / 2 + 0.05), 0, 1.4, 0.06, 0.8, 0.45, DARK); }
  lamps(g, half - 0.35, -half - 0.01, 1.35, 0.9);
  const turrets = [], piv = [0, 0.6, 2.15];
  turretBlock(g, ctx.turretAngle, piv, 1, () => {
    g.prismZ([[-0.6, 0.1], [0.6, 0.1], [0.75, 0.7], [0.45, 1.3], [-0.45, 1.3], [-0.75, 0.7]], 2.15, 2.6, tone(c, 0.04), 0.75);
    g.box(0.35, 0.6, 2.6, 0.2, 0.25, 0.2, STEEL);
    const end = [0, 3.4, 2.38];
    g.tube([0, 1.25, 2.38], end, 0.07, 0.06, DARK, 8); g.tube([0, end[1] - 0.25, 2.38], [0, end[1] + 0.05, 2.38], 0.09, 0.09, DARK, 8);
    g.tube([0.25, 1.25, 2.33], [0.25, 2.1, 2.33], 0.03, 0.03, DARK, 6);
    turrets.push({ end: g.at(end), front: true });
  });
  return turrets;
}
// БМП-3: гусеничная, 100-мм орудие и 30-мм пушка в одной башне
function bmp(g, def, v, ctx) {
  const c = ctx.color, L = 5.4, half = L / 2, W = 1.15;
  for (const side of [-1, 1]) trackRun(g, { L, wheels: 6, r: 0.33, x0: W, x1: W + 0.42 }, side, ctx.phase, ctx.trackCol);
  g.prismX([[-half - 0.6, 0.5], [-half - 0.6, 1.85], [half - 0.6, 1.95], [half + 0.75, 1.25], [half + 0.4, 0.45]], -W - 0.42, W + 0.42, c);
  for (const side of [-1, 1]) g.box(side * (W + 0.44), 0, 0.85, 0.05, L, 0.5, tone(c, -0.08), { bias: 0.6 });
  g.box(0, -half - 0.62, 0.9, 1.6, 0.05, 0.7, DARK); // кормовые двери
  lamps(g, half + 0.5, -half - 0.62, 1.2, 0.85);
  const turrets = [], piv = [0, -0.3, 1.95];
  turretBlock(g, ctx.turretAngle, piv, 1, () => {
    g.prismZ([[-0.9, -1.2], [0.9, -1.2], [1.0, 0.1], [0.55, 0.85], [-0.55, 0.85], [-1.0, 0.1]], 1.95, 2.5, tone(c, 0.04), 0.8);
    const end = [0, 3.1, 2.25];
    g.tube([0, 0.85, 2.25], end, 0.1, 0.085, tone(c, -0.1), 10);
    g.tube([0.32, 0.85, 2.2], [0.32, 2.6, 2.2], 0.04, 0.035, DARK, 6);
    g.box(-0.5, -0.4, 2.5, 0.3, 0.35, 0.22, STEEL);
    turrets.push({ end: g.at(end), front: true });
  });
  return turrets;
}

export const MESH = { tank, light_tank: tank, helicopter: ka52, plane: il2, car, sedan: car, armored_car: car, truck: pickup, cargo_truck: hauler, semi_truck: hauler, bus, armored_bus: bus, apc: btr, ifv: bmp, ...EXTRA };

// Одометр: пройденный путь в метрах — по нему катятся гусеницы и колёса и шагают ноги (без проскальзывания).
// Клетка ≈ 1,51 м (как у фигур). Без позиции на карте (галерея, тесты) — по времени, 3,2 м/с.
const TILE_M = 1.51, odo = new WeakMap();
function distanceOf(v, time, moving) {
  const p = v.visualPosition;
  if (!p) return moving ? time * 0.0032 : 0;
  let o = odo.get(v);
  if (!o) { o = { x: p.x, y: p.y, d: v.visualOdometer??v.odometer??0 }; odo.set(v, o); }
  const step = Math.hypot(p.x - o.x, p.y - o.y);
  if (step < 3) o.d += step * (globalThis.window?.Vehicles?.M_PER_TILE||TILE_M); // телепорт и переход уровня не крутят колёса
  o.x = p.x; o.y = p.y;
  v.visualOdometer=o.d;return o.d;
}


// Установки бортового оружия из shared/vehicles.js (пилоны, блоки ракет, торпедные аппараты, шахты ракет):
// рисуются ровно в точках вылета, по которым сервер выпускает снаряды (vehicle-mesh.test.js сверяет)
const POD = '#3f4a36', RAIL = '#58605a', TORP = '#2f3d45';
// Salvaged armor follows the hull; rotor, tracks and wheels keep their clearance.
const ARMOR = {
  car:[0.92,2.0,0.75],sedan:[0.93,2.2,0.75],armored_car:[1,2.3,0.85],
  truck:[1,2.5,0.95],cargo_truck:[1.2,3.8,1.2],semi_truck:[1.25,5,1.2],
  bus:[1.28,5,1.6],armored_bus:[1.28,5,1.6],apc:[1.4,3.3,1.2],
  tank:[1.85,3.5,1.2],light_tank:[1.55,2.8,1],ifv:[1.65,3,1.1],
  helicopter:[0.9,2,1.3],plane:[0.65,2,1.15],boat:[1.1,2.6,0.75],
  rowboat:[0.6,1.3,0.35],jetski:[0.4,1,0.45],submarine:[1.1,3,1.4],
  deep_submarine:[1,1.6,1.2],motorcycle:[0.28,0.65,0.6],bicycle:[0.2,0.45,0.55],
  mech_sentinel:[0.65,0.5,2.4],chicken_walker:[0.65,0.7,2.1],elephant_walker:[1.1,1.8,2.3]
};
const ROOF_ARMOR={car:1.5,sedan:1.5,armored_car:1.7,truck:1.8,cargo_truck:2.7,semi_truck:3,bus:3.4,armored_bus:3.4,apc:1.9,tank:1.9,light_tank:1.62,ifv:1.7,boat:1.3,rowboat:.6,jetski:.9,submarine:1.7,deep_submarine:2.1,helicopter:2,plane:2.1,mech_sentinel:3.5,chicken_walker:2.9,elephant_walker:3.1};
function salvageArmor(g, def) {
  if(def.id==='submarine')return;
  const spec=ARMOR[def.id]; if(!spec)return;
  const [w,l,z]=spec, n=g.q===0?2:4, roof=ROOF_ARMOR[def.id];
  if(roof){
    const y=-l*.25;
    for(const side of [-1,1]){
      g.box(side*w*.68,y,roof,.07,l*.4,.09,'#46443b');
      for(let k=0;k<(g.q===0?2:4);k++){
        const yy=y-l*.18+k*l*.12;
        g.tube([side*w*.68,yy,roof+.08],[side*w*.8,yy+.06,roof+.36],.055,.003,'#a59a7e',6);
      }
    }
    g.box(-w*.32,l*.12,roof,w*.5,l*.17,.035,'#74604c');
  }
  for(const side of [-1,1]) for(let i=0;i<n;i++) {
    const y=-l*0.65+(i+0.5)*l*1.3/n;
    const col=i%2?'#61594a':'#79533e';
    g.box(side*w,y,z,0.065,l*1.2/n,0.28,col);
    if(g.q>0){
      for(const dy of [-1,1]) g.tube([side*(w+0.035),y+dy*l*0.45/n,z+0.22],[side*(w+0.055),y+dy*l*0.45/n,z+0.22],0.027,0.027,'#bbb2a0',6);
      g.tube([side*w,y,z+0.28],[side*(w+0.19),y+0.05,z+0.6],0.065,0.004,'#a59c87',6);
    }
  }
  g.box(0,l*0.82,z, w*1.7,0.1,0.32,'#4a4640');
  g.box(0,l*0.82+0.06,z+0.16,w*1.1,0.018,0.055,'#10191c');
  if(def.kind==='land'&&w>.6){
    // Welded ram, exhaust stacks, asymmetric replacement hood panel.
    g.prismX([[l*.9,z-.1],[l*1.05,z-.22],[l*1.05,z+.16],[l*.9,z+.3]],-w*.9,w*.9,'#555043');
    g.box(-w*.25,l*.4,z+.32,w*.55,l*.3,.035,'#7d6550');
    for(const side of [-1,1])g.tube([side*w*.8,-l*.6,z],[side*w*.8,-l*.6,z+.8],.065,.065,'#4b443b',8);
  }
  if(g.q>0)for(const side of [-1,1]) g.tube([side*w*0.7,l*0.82,z+0.05],[side*w*0.7,l*0.82+0.35,z+0.08],0.08,0.003,'#aca28c',6);
}
function drawMounts(g, def, v, skin) {
  const VV = globalThis.window && globalThis.window.Vehicles;
  if (!VV || !VV.armsOf) return;
  for (const grp of VV.armsOf(def)) for (const m of grp.mounts) {
    if (!m.draw) continue;
    const p = VV.mountLocal(def, v, m);
    const a = m.frame === 'hull' ? m.dir : VV.turretAngle(def, v, m.frame);
    const d = m.up ? [0, 0, 1] : m.down ? [0, 0, -1] : [Math.sin(a), Math.cos(a), 0];
    const back = (len) => [p[0] - d[0] * len, p[1] - d[1] * len, p[2] - d[2] * len];
    if(['pod','rail','torpedo','barrel'].includes(m.draw)){
      const grips=m.draw==='barrel'?[.34]:m.draw==='torpedo'?[.4,1]:[.25,.65];
      for(const len of grips)connectFitting(g,m.frame==='hull'?skin.hull:skin.turret,back(len),m.id);
    }
    const cradle=(length,height)=>g.with(rotAt('z',a,p),()=>g.box(p[0],p[1]-.45,p[2]-height,.08,length,height,STEEL));
    if (m.draw === 'pod') { cradle(.5,.16); g.tube(back(0.85), p, 0.11, 0.11, POD, 8); if (g.q > 0) g.tube(p, [p[0] + d[0] * 0.02, p[1] + d[1] * 0.02, p[2]], 0.075, 0.075, DARK, 8); }
    else if (m.draw === 'rail') { cradle(.45,.14); g.tube(back(0.85), back(0.05), 0.03, 0.03, RAIL, 5); g.tube(back(0.78), back(0.15), 0.055, 0.055, '#686e60', 6); g.tube(back(0.15), p, 0.055, 0.018, '#b8b49a', 6); }
    else if (m.draw === 'barrel') { g.box(back(0.42)[0], back(0.42)[1], p[2] - 0.08, 0.14, 0.14, 0.14, STEEL); g.tube(back(0.4), p, 0.045, 0.04, DARK, 6); }
    else if (m.draw === 'torpedo') { g.tube(back(1.35), p, 0.14, 0.14, TORP, 8); g.tube(p, [p[0] + d[0] * 0.03, p[1] + d[1] * 0.03, p[2]], 0.1, 0.1, DARK, 8); }
    else if (m.draw === 'hatch') g.tube(back(0.06), p, 0.13, 0.13, DARK, 8, { bias: 0.05 });
    else if (m.draw === 'vls') g.box(p[0], p[1], p[2] - 0.02, 0.24, 0.24, 0.04, DARK, { bias: 0.05 });
  }
}

// Рисует модель; null — модели нет (старый рисунок)
// Спрайты стоящей техники (sprite-memo.js): неподвижная модель без анимации по времени рисуется один раз
const memo = new SpriteMemo(96);
export function clearMeshSprites() { memo.clear(); }
export function drawMesh(ctx2d, def, v, x, y, unit, angle, time, alt, quality) {
  const build = MESH[def.id];
  if (!build) return null;
  const wreck = Boolean(v.wreck), moving = Boolean(v.moving) && !wreck;
  const heading = Number.isFinite(angle) ? angle : 0;
  const q = quality === 'low' ? 0 : quality === 'high' ? 2 : 1;
  const turretWorld = ((Number.isInteger(v.turretDir) ? v.turretDir : Math.round(heading / (Math.PI / 4))) % 8) * Math.PI / 4;
  const rearWorld = ((Number.isInteger(v.rearTurretDir) ? v.rearTurretDir : 4) % 8) * Math.PI / 4;
  const dist = wreck ? 0 : distanceOf(v, time, moving); // одометр — ровно один раз за кадр
  const key = moving||def.id==='submarine' ? null : [def.id, def.color, wreck ? 1 : 0, heading.toFixed(3), q, turretWorld.toFixed(3), rearWorld.toFixed(3), unit.toFixed(3), alt || 0, dist.toFixed(3), def.kind].join('|');
  return memoDraw(ctx2d, memo, key, x, y, (c2, xx, y2) => {
    let timed = false;
    const res = drawMeshRaw(c2, build, def, v, xx, y2, unit, heading, { get t() { timed = true; return time; } }, alt, q, wreck, moving, turretWorld, rearWorld, dist);
    return { result: res, cacheable: !timed };
  });
}
function drawMeshRaw(ctx2d, build, def, v, x, y, unit, heading, clock, alt, q, wreck, moving, turretWorld, rearWorld, dist) {
  const yy = y - Math.max(0, alt || 0) * 10;
  const g = meshRig(ctx2d, x, yy, unit, heading, q, ['horse','mutant_mount'].includes(def.id)?'anime':'salvage');
  const c = wreck ? '#5d5248' : ['horse','mutant_mount'].includes(def.id) ? def.color || '#80634b' : tone(def.color || '#5d6b4a', -0.22);
  const ctx = { color: c, trackCol: wreck ? '#332d2a' : '#2c2f30', phase: dist, dist, get time() { return clock.t; }, moving, wreck,
    turretAngle: wreck ? 0.6 : turretWorld - heading, rearAngle: rearWorld - heading, alt: alt || 0 };
  const turrets = build(g, def, v, ctx) || [];
  const skin={hull:g.attachmentSurface({nested:false}),turret:g.attachmentSurface({nested:true})};
  salvageArmor(g, def);
  drawMounts(g, def, { ...v, facingAngle: heading },skin);
  // Тень по габаритам корпуса — на земле (у летящей — там же, внизу)
  const bb = g.bounds(), lift = y - yy, grow = 0.25 + Math.min(1.5, (alt || 0) * 0.3);
  if (Number.isFinite(bb[0])) {
    ctx2d.save();
    for (const [k, a] of def.fly ? [[grow, 0.12]] : [[grow + 0.3, 0.1], [grow, 0.2]]) {
      ctx2d.fillStyle = `rgba(7,9,12,${a})`; ctx2d.beginPath();
      // суперэллипс: у наземной техники — скруглённый прямоугольник, у летящей — эллипс
      const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2, rx = (bb[2] - bb[0]) / 2 + k, ry = (bb[3] - bb[1]) / 2 + k, e = def.fly ? 1 : 0.35;
      for (let i = 0; i < 24; i++) { const t = i / 24 * TAU, ct = Math.cos(t), st = Math.sin(t); const s = g.project([cx + rx * Math.sign(ct) * Math.abs(ct) ** e, cy + ry * Math.sign(st) * Math.abs(st) ** e, 0]); i ? ctx2d.lineTo(s[0], s[1] + lift) : ctx2d.moveTo(s[0], s[1] + lift); }
      ctx2d.closePath(); ctx2d.fill();
    }
    // На воде на ходу — пена у бортов и след за кормой
    if (def.kind === 'water' && moving) {
      const w = (bb[2] - bb[0]) / 2;
      for (let k = 0; k < 5; k++) {
        ctx2d.fillStyle = `rgba(235,245,250,${0.32 - k * 0.055})`;
        for (const side of [-1, 1]) { const s = g.project([side * w * (0.7 + k * 0.25), bb[1] - k * 0.55, 0]), r = (0.22 + k * 0.06) * g.unit; ctx2d.beginPath(); ctx2d.ellipse(s[0], s[1] + lift, r, r * 0.5, 0, 0, TAU); ctx2d.fill(); }
      }
    }
    ctx2d.restore();
  }
  g.flush(wreck);
  return Object.assign(turrets.map((t) => { const s = g.project(t.end); return { ...t, muzzle: { dx: (s[0] - x) / unit, dy: (s[1] - y) / unit, height: t.end[2] * M_TO_UNIT, alt } }; }),{attachments:g.attachments});
}
