// Постройки базы игрока (художественный проход, ART.md §5): гранёные модели в метрах (mesh-art.js),
// клетка ≈ 1,51 м. Неподвижные части рисуются один раз в спрайт (кэш по типу и масштабу), живые
// детали (огонь, свет лампы, экран, кристалл) — поверх спрайта каждый кадр.
import { meshRig, M_TO_UNIT } from './mesh-art.js';
import { tone } from './figure-art.js';
const T = 1.51, H = T / 2;
const cache = new Map();
// Симметричные блоки: поворот не меняет вид (у сруба брёвна строятся только на видимых гранях)
const SYM = new Set(['wall_wood', 'wall_stone', 'castle_wall', 'tower', 'spikes', 'campfire_pit', 'magic_table']);
const wood = '#8a6a3a', iron = '#545b60', stone = '#8f8a84';
const table = (g, col, h = 0.85, w = 1.2, l = 0.7) => {
  g.box(0, 0, h - 0.07, w, l, 0.07, col);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.box(sx * (w / 2 - 0.06), sy * (l / 2 - 0.06), 0, 0.07, 0.07, h - 0.07, tone(col, -0.2));
  g.box(0, 0, 0.18, w - 0.12, l - 0.12, 0.04, tone(col, -0.12));
};
// Модели: g — meshRig, def — постройка, p — экземпляр (замок двери)
const MODELS = {
  wall_wood(g, def) {
    // сруб: сплошной блок, брёвна выступают на гранях, по углам — торцы
    const c = def.color, d = T * 0.92;
    g.box(0, 0, 0, d - 0.1, d - 0.1, 2.36, tone(c, -0.12));
    for (let i = 0; i < 6; i++) for (const sy of [1]) g.tube([-d / 2, sy * (d / 2 - 0.12), 0.2 + i * 0.39], [d / 2, sy * (d / 2 - 0.12), 0.2 + i * 0.39], 0.19, 0.19, tone(c, (i % 2 ? -0.05 : 0.04)), 7, { bias: 0.6 });
    for (let i = 0; i < 6; i++) for (const sx of [1]) g.tube([sx * (d / 2 - 0.12), -d / 2, 0.39 + i * 0.39], [sx * (d / 2 - 0.12), d / 2, 0.39 + i * 0.39], 0.18, 0.18, tone(c, (i % 2 ? 0.02 : -0.07)), 7, { bias: 0.6 });
  },
  wall_stone(g, def, p, rand) { blocks(g, def.color, rand, 2.36); },
  castle_wall(g, def, p, rand) { blocks(g, def.color, rand, 2.36); for (const dx of [-0.48, 0, 0.48]) g.box(dx, 0, 2.36, 0.32, T * 0.9, 0.42, tone(def.color, -0.05)); },
  tower(g, def, p, rand) {
    blocks(g, def.color, rand, 2.36); g.box(0, 0, 2.36, T * 1.02, T * 1.02, 0.12, tone(def.color, -0.15));
    for (const [dx, dy] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55], [0, 0.55], [0.55, 0]]) g.box(dx, dy, 2.48, 0.3, 0.3, 0.4, tone(def.color, 0.03));
    g.box(0, H + 0.01, 1.2, 0.14, 0.04, 0.5, '#23272a');
  },
  door(g, def, p) {
    const c = def.color;
    for (const sx of [-1, 1]) g.box(sx * H * 0.86, 0, 0, 0.18, 0.4, 2.12, tone(c, -0.2));
    g.box(0, 0, 1.98, T * 0.95, 0.42, 0.22, tone(c, -0.25));
    for (let i = 0; i < 4; i++) g.box(-0.42 + i * 0.28, 0.02, 0, 0.26, 0.12, 1.98, tone(c, (i % 2 ? -0.04 : 0.04)));
    for (const z of [0.4, 1.5]) g.box(0, 0.09, z, 1.1, 0.03, 0.08, iron);
    g.box(0.36, 0.11, 1.0, 0.08, 0.05, 0.12, p && p.locked ? '#e0b040' : '#2a1a0a');
  },
  gate(g, def) {
    const c = def.color;
    for (const sx of [-1, 1]) g.box(sx * H * 0.86, 0, 0, 0.2, 0.2, 2.2, tone(c, -0.15));
    for (let i = 0; i < 6; i++) g.box(-0.5 + i * 0.2, 0, 0, 0.07, 0.07, 1.9, iron);
    for (const z of [0.3, 1.0, 1.75]) g.box(0, 0, z, T * 0.8, 0.09, 0.08, tone(iron, 0.1));
  },
  window(g, def, p, rand) {
    blocks(g, stone, rand, 0.9);
    g.box(0, 0, 0.9, T * 0.96, 0.5, 0.1, tone(stone, -0.12));
    for (const sx of [-1, 1]) g.box(sx * H * 0.84, 0, 1.0, 0.22, 0.5, 1.0, stone);
    g.box(0, 0, 1.0, T * 0.74, 0.08, 1.0, def.color, { alpha: 0.75 });
    g.box(0, 0.02, 1.0, 0.05, 0.1, 1.0, '#e9e3d4'); g.box(0, 0.02, 1.47, T * 0.74, 0.1, 0.05, '#e9e3d4');
    g.box(0, 0, 2.0, T * 0.98, 0.52, 0.36, stone);
  },
  fence(g, def) {
    const c = def.color;
    for (const sx of [-0.62, 0, 0.62]) { g.box(sx, 0, 0, 0.12, 0.12, 1.0, tone(c, -0.15)); g.prismZ([[sx - 0.06, -0.06], [sx + 0.06, -0.06], [sx + 0.06, 0.06], [sx - 0.06, 0.06]], 1.0, 1.12, tone(c, -0.1), 0.1); }
    for (const z of [0.35, 0.78]) g.box(0, 0.08, z, T * 0.96, 0.05, 0.12, c);
  },
  barricade(g, def) {
    const c = def.color;
    for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - (row === 2 ? 1 : 0); i++) g.loft([{ y: -0.2, pts: [[-0.22, 0], [0.22, 0], [0.24, 0.12], [0.2, 0.26], [-0.2, 0.26], [-0.24, 0.12]].map(([px, pz]) => [px + (i - (row === 2 ? 0.5 : 1)) * 0.46, pz + row * 0.27]) }, { y: 0.2, pts: [[-0.22, 0], [0.22, 0], [0.24, 0.12], [0.2, 0.26], [-0.2, 0.26], [-0.24, 0.12]].map(([px, pz]) => [px + (i - (row === 2 ? 0.5 : 1)) * 0.46, pz + row * 0.27]) }], tone('#9a8a62', (i + row) % 2 ? -0.06 : 0.03));
    for (const s of [-1, 1]) g.tube([-0.6 * s, -0.35, 0], [0.6 * s, -0.35, 1.1], 0.05, 0.05, c, 6);
  },
  chest(g, def) {
    const c = def.color;
    g.box(0, 0, 0, 0.8, 0.5, 0.38, c);
    g.prismX([[-0.25, 0.38], [0.25, 0.38], [0.25, 0.46], [0.15, 0.55], [-0.15, 0.55], [-0.25, 0.46]], -0.4, 0.4, tone(c, 0.06));
    for (const x of [-0.28, 0.28]) { g.box(x, 0, 0, 0.06, 0.52, 0.4, iron); g.prismX([[-0.26, 0.38], [0.26, 0.38], [0.26, 0.47], [0.16, 0.56], [-0.16, 0.56], [-0.26, 0.47]], x - 0.03, x + 0.03, iron); }
    g.box(0, 0.26, 0.3, 0.1, 0.03, 0.12, '#c9a65a');
  },
  workbench(g, def) {
    table(g, def.color);
    g.box(0.42, 0, 0.85, 0.16, 0.2, 0.14, iron); g.box(-0.3, 0.1, 0.85, 0.3, 0.06, 0.04, '#b0b5b8');
    g.tube([-0.1, -0.15, 0.88], [0.15, -0.1, 0.88], 0.025, 0.025, '#6a4a2a', 5); g.box(0.2, -0.1, 0.86, 0.1, 0.06, 0.06, '#7c858a');
  },
  forge(g, def) {
    const c = def.color;
    g.prismZ([[-0.6, -0.4], [0.6, -0.4], [0.6, 0.4], [-0.6, 0.4]], 0, 0.8, c, 0.92);
    g.box(0, 0.05, 0.8, 0.8, 0.5, 0.08, tone(c, -0.25));
    g.box(-0.35, -0.2, 0.8, 0.3, 0.3, 1.3, tone(c, -0.1)); g.box(-0.35, -0.2, 2.1, 0.36, 0.36, 0.08, tone(c, -0.2));
    g.box(0.4, 0.45, 0, 0.3, 0.2, 0.55, iron); g.box(0.4, 0.45, 0.55, 0.42, 0.24, 0.1, tone(iron, 0.1));
  },
  chemlab(g, def) {
    table(g, '#7c6a52');
    g.box(0.35, -0.1, 0.85, 0.3, 0.3, 0.4, tone(def.color, -0.2));
    for (const [x, y, h] of [[-0.35, 0.05, 0.3], [-0.15, -0.1, 0.22], [0.0, 0.12, 0.35]]) g.tube([x, y, 0.85], [x, y, 0.85 + h], 0.06, 0.035, def.color, 7, { alpha: 0.8 });
  },
  electronics_bench(g, def) {
    table(g, '#5a5f63');
    g.box(0, -0.18, 0.85, 0.6, 0.12, 0.42, '#2a2f33'); g.box(0, -0.1, 0.92, 0.5, 0.02, 0.3, def.color);
    g.box(0, 0.12, 0.85, 0.5, 0.18, 0.03, '#3a3f43'); g.box(0.45, 0.05, 0.85, 0.18, 0.25, 0.2, '#6a6f73');
  },
  magic_table(g, def) {
    const c = def.color;
    g.prismZ(Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4) * 0.55, Math.sin(i * Math.PI / 4) * 0.55]), 0.75, 0.85, tone(c, -0.25));
    g.prismZ(Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3) * 0.2, Math.sin(i * Math.PI / 3) * 0.2]), 0, 0.75, tone(c, -0.35), 0.7);
  },
  technical_table(g, def) {
    table(g, def.color);
    g.tube([-0.25, 0, 0.92], [-0.25, 0.03, 0.92], 0.16, 0.16, '#b0b5b8', 10); g.tube([0.05, 0.05, 0.9], [0.05, 0.08, 0.9], 0.1, 0.1, '#8a8f93', 8);
    g.box(0.38, -0.1, 0.85, 0.22, 0.3, 0.25, tone(def.color, -0.2));
  },
  garage(g, def) {
    const c = def.color;
    g.box(0, 0, 0, T * 0.96, T * 0.96, 2.2, c);
    g.prismX([[-H * 0.98, 2.2], [H * 0.98, 2.2], [0, 2.6]], -H * 0.98, H * 0.98, tone(c, -0.2));
    for (let i = 0; i < 6; i++) g.box(0, H * 0.96 + 0.01, 0.1 + i * 0.3, T * 0.7, 0.02, 0.24, tone('#9aa3a6', i % 2 ? -0.06 : 0.02));
  },
  generator(g, def) {
    const c = def.color;
    g.box(0, 0, 0, 1.0, 0.62, 0.12, '#33383b');
    g.box(-0.12, 0, 0.12, 0.6, 0.55, 0.5, c); g.tube([0.25, -0.2, 0.4], [0.25, 0.2, 0.4], 0.17, 0.17, tone(c, 0.1), 10);
    g.tube([-0.3, -0.15, 0.62], [-0.3, -0.15, 1.0], 0.04, 0.04, '#2a2e30', 6);
    g.box(0.0, 0.28, 0.3, 0.2, 0.03, 0.14, '#c9a65a');
  },
  bed(g, def) { bed(g, def.color, 0.95); },
  double_bed(g, def) { bed(g, def.color, 1.4); },
  lamp(g) {
    g.box(0, 0, 0, 0.3, 0.3, 0.06, '#3a3f43'); g.tube([0, 0, 0.06], [0, 0, 1.7], 0.035, 0.03, '#3a3f43', 6);
    g.box(0, 0, 1.7, 0.24, 0.24, 0.04, '#2a2e30');
  },
  spikes(g, def) {
    for (let i = 0; i < 9; i++) { const x = (i % 3 - 1) * 0.42, y = (Math.floor(i / 3) - 1) * 0.42; g.tube([x, y, 0], [x + 0.04, y + 0.06, 0.55], 0.06, 0.004, tone(def.color, (i % 2 ? -0.1 : 0.05)), 5); }
    g.box(0, 0, 0, 1.2, 1.2, 0.05, '#5a4a3a');
  },
  campfire_pit(g) {
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; g.box(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0, 0.2, 0.18, 0.14, tone('#7a7670', (i % 3) * 0.05 - 0.05)); }
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; g.tube([Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.04], [Math.cos(a) * 0.04, Math.sin(a) * 0.04, 0.28], 0.05, 0.04, '#5b3e24', 6); }
  },
};
function blocks(g, col, rand, h) {
  const rows = Math.round(h / 0.3), rh = h / rows;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? 0.25 : 0, n = 3;
    for (let i = 0; i < n + (off ? 1 : 0); i++) {
      const x0 = Math.max(-H * 0.96, -H * 0.96 + (i - (off ? 0.5 : 0)) * T * 0.96 / n), x1 = Math.min(H * 0.96, -H * 0.96 + (i + 1 - (off ? 0.5 : 0)) * T * 0.96 / n);
      if (x1 - x0 < 0.05) continue;
      g.box((x0 + x1) / 2, 0, r * rh, x1 - x0 - 0.02, T * 0.96 - (rand() * 0.04), rh - 0.02, tone(col, (rand() - 0.5) * 0.12));
    }
  }
}
function bed(g, col, w) {
  g.box(0, 0, 0, w, 1.9, 0.3, '#6a4a2a'); g.box(0, -0.92, 0, w, 0.08, 0.75, '#5a3e22');
  g.box(0, 0, 0.3, w - 0.08, 1.8, 0.16, '#e6e0d2');
  g.box(0, 0.25, 0.46, w - 0.06, 1.2, 0.06, col);
  for (let i = 0; i < (w > 1.2 ? 2 : 1); i++) g.box((w > 1.2 ? (i - 0.5) * 0.6 : 0), -0.65, 0.46, 0.5, 0.3, 0.1, '#f2efe6');
}
export const BASE_MODELS = Object.keys(MODELS);
// Живые детали поверх спрайта
function live(ctx, id, x, y, u, now) {
  const pr = (p) => [x + (p[0] - p[1]) * u * 0.78, y + (p[0] + p[1]) * u * 0.39 - p[2] * u];
  const glow = (p, r, col) => { const s = pr(p); ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createRadialGradient(s[0], s[1], 0, s[0], s[1], r * u); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(s[0], s[1], r * u, 0, Math.PI * 2); ctx.fill(); ctx.restore(); };
  const flame = (p, h) => { const s = pr(p), f = Math.sin(now / 90) * 0.08 + Math.sin(now / 37) * 0.04; ctx.save(); for (const [k, col] of [[1, '#ff7a2a'], [0.6, '#ffd35a']]) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(s[0] - u * 0.18 * k, s[1]); ctx.quadraticCurveTo(s[0] - u * 0.12 * k, s[1] - h * u * 0.6 * k, s[0] + f * u, s[1] - h * u * k); ctx.quadraticCurveTo(s[0] + u * 0.12 * k, s[1] - h * u * 0.6 * k, s[0] + u * 0.18 * k, s[1]); ctx.fill(); } ctx.restore(); glow(p, 0.9, 'rgba(255,150,60,0.35)'); };
  if (id === 'campfire_pit') flame([0, 0, 0.1], 0.6);
  else if (id === 'forge') { const s = pr([0, 0.05, 0.88]); ctx.fillStyle = `rgb(255,${110 + Math.round(Math.sin(now / 200) * 30)},40)`; ctx.beginPath(); ctx.ellipse(s[0], s[1], u * 0.3, u * 0.12, 0, 0, Math.PI * 2); ctx.fill(); glow([0, 0.05, 0.9], 0.6, 'rgba(255,120,40,0.4)'); }
  else if (id === 'lamp') glow([0, 0, 1.62], 0.7 + Math.sin(now / 500) * 0.03, 'rgba(255,220,130,0.55)');
  else if (id === 'magic_table') { const z = 1.15 + Math.sin(now / 420) * 0.06, s = pr([0, 0, z]); ctx.fillStyle = '#c9b4ff'; ctx.beginPath(); ctx.moveTo(s[0], s[1] - u * 0.22); ctx.lineTo(s[0] + u * 0.1, s[1]); ctx.lineTo(s[0], s[1] + u * 0.22); ctx.lineTo(s[0] - u * 0.1, s[1]); ctx.fill(); glow([0, 0, z], 0.55, 'rgba(170,140,255,0.45)'); }
  else if (id === 'electronics_bench') glow([0, -0.09, 1.07], 0.3, 'rgba(110,255,170,0.3)');
  else if (id === 'chemlab') glow([-0.15, 0, 1.05], 0.35, 'rgba(110,230,170,0.25)');
}
// Нарисовать постройку: центр клетки на экране (cx, cy), полуширина ромба hw. false — модели нет
export function drawBasePiece(ctx, def, p, cx, cy, hw, now) {
  const build = MODELS[def.id];
  if (!build) return false;
  const u = hw / (T * 0.78), unit = u / M_TO_UNIT;
  const rot = SYM.has(def.id) ? 0 : ((p && p.rot) || 0) & 3, key = def.id + '|' + Math.round(hw * 4) + '|' + (p && p.locked ? 1 : 0) + '|' + rot;
  let sp = cache.get(key);
  if (sp === undefined && typeof document !== 'undefined') {
    const w = Math.ceil(hw * 2.6), h = Math.ceil(u * 3.6 + hw), c = document.createElement('canvas'); c.width = w; c.height = h;
    const g2 = c.getContext('2d'), ox = w / 2, oy = h - hw * 0.62;
    paint(g2, build, def, p, ox, oy, unit, rot);
    sp = { c, ox, oy }; if (cache.size > 300) cache.clear(); cache.set(key, sp);
  }
  if (sp) ctx.drawImage(sp.c, cx - sp.ox, cy - sp.oy); else paint(ctx, build, def, p, cx, cy, unit, rot);
  live(ctx, def.id, cx, cy, u, now);
  return true;
}
function paint(ctx, build, def, p, x, y, unit, rot = 0) {
  let a = 0; for (const ch of def.id) a = a * 31 + ch.charCodeAt(0) | 0;
  const rand = () => { a = a * 1103515245 + 12345 | 0; return ((a >>> 8) & 0xffff) / 0x10000; };
  ctx.fillStyle = 'rgba(7,9,12,0.22)'; ctx.beginPath(); const u = unit * M_TO_UNIT; ctx.ellipse(x, y, u * 0.95, u * 0.48, 0, 0, Math.PI * 2); ctx.fill();
  const g = meshRig(ctx, x, y, unit, rot * Math.PI / 2, 1); build(g, def, p, rand); g.flush();
}
