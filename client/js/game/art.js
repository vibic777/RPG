// Художественный рендер (шаг 19): наследник IsoRenderer. Всё рисуется кодом — без покупных и скачиваемых картинок.
//  - атлас: текстуры клеток по биомам (shared/art.js → пиксели) кэшируются и кладутся на ромб изометрии одним drawImage;
//  - переходы между биомами — мягкий край соседнего биома (по старшинству), вода переливается;
//  - объекты по биомам: сосны, дубы, кривые деревья, сухостой, кактусы, кости, бочки, шины, ржавые машины, руины с ржавчиной,
//    сталагмиты, светящиеся грибы, коконы, водоросли, облака, ящики; тени;
//  - анимации: удар (выпад), попадание (вспышка), смерть (падение, рассыпание, таяние — по типу тела); дети — по возрасту;
//  - освещение: день и ночь (сутки game.artDayMin), подземелья с кругом света, подводье, высоты;
//  - частицы боя и магии (искры, кровь, огонь, лёд, яд, магия, лечение, новый уровень).
// Качество low/medium/high (shared/art.js QUALITY); «простой» рендер — прежний IsoRenderer (запасной).
import { IsoRenderer } from './render.js';
import { trimSprite } from './sprite-memo.js';
import { drawScenery } from './scenery-art.js';

const A = () => window.Art;
const G = () => window.WorldGen;
const GFX_KEY = 'rpg.gfx';

// ---------- Настройки графики игрока ----------
export function loadGfx(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { return A().sanitizeGfx(JSON.parse((storage && storage.getItem(GFX_KEY)) || 'null')); } catch { return A().sanitizeGfx(null); }
}
export function saveGfx(prefs, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  const p = A().sanitizeGfx(prefs);
  try { if (storage) storage.setItem(GFX_KEY, JSON.stringify(p)); } catch { /* полный localStorage */ }
  return p;
}
// Рендер по настройкам: «простой» — прежний IsoRenderer; без window.Art или при ошибке — тоже он (запасной путь)
export function createRenderer(canvas, map, opts, gfx = null) {
  let g = null;
  try { g = gfx ? A().sanitizeGfx(gfx) : loadGfx(); } catch { g = null; }
  const classic = () => { const r = new IsoRenderer(canvas, map, opts); if (g) r.setQuality(g.quality); return r; };
  if (!g || g.renderer === 'classic') return classic();
  try { return new ArtRenderer(canvas, map, { ...opts, quality: g.quality }); } catch (e) { console.warn('[арт] запасной рендер:', e && e.message); return classic(); }
}

// ---------- Атлас ----------
const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
export class Atlas {
  constructor(quality = 'medium') { this.q = quality; this.tex = new Map(); this.dia = new Map(); this.edges = new Map(); this.key = ''; this.builds = 0; }
  texture(b, v) {
    const k = b + ':' + v;
    let c = this.tex.get(k);
    if (c) return c;
    const { size, data } = A().texturePixels(b, v);
    c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    img.data.set(data);
    ctx.putImageData(img, 0, 0);
    this.tex.set(k, c);
    this.builds++;
    return c;
  }
  // Ромб клетки (2hw × 2hh) с текстурой в изометрии: квадрат текстуры → ромб (верх, право, низ, лево)
  diamond(b, v, hw, hh, dpr = 1) {
    const zk = hw.toFixed(2) + '|' + dpr;
    if (zk !== this.key) { this.dia.clear(); this.edges.clear(); this.key = zk; }
    const k = b + ':' + v;
    let c = this.dia.get(k);
    if (c) return c;
    const t = this.texture(b, v), n = t.width;
    c = makeCanvas((2 * hw + 2) * dpr, (2 * hh + 2) * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform((hw / n) * dpr, (hh / n) * dpr, (-hw / n) * dpr, (hh / n) * dpr, (hw + 1) * dpr, 1 * dpr);
    ctx.drawImage(t, 0, 0);
    // мягкий верхний свет и нижняя тень грани — объём без сетки
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    const gr = ctx.createLinearGradient(0, 1, 0, 2 * hh + 1);
    gr.addColorStop(0, 'rgba(255,240,210,0.025)'); gr.addColorStop(1, 'rgba(0,0,0,0.035)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 2 * hw + 2, 2 * hh + 2);
    this.dia.set(k, c);
    return c;
  }
  // Край соседнего биома на моей клетке: dir 0 — сосед (x, y−1), 1 — (x+1, y), 2 — (x, y+1), 3 — (x−1, y)
  edge(nb, dir, hw, hh, dpr = 1) {
    const k = nb + ':' + dir;
    let c = this.edges.get(k);
    if (c) return c;
    const n = 32, src = makeCanvas(n, n), sctx = src.getContext('2d');
    const col = A().BIOMES[nb].base;
    const g = [[0, 0, 0, n * 0.4], [n, 0, n * 0.6, 0], [0, n, 0, n * 0.6], [0, 0, n * 0.4, 0]][dir];
    const gr = sctx.createLinearGradient(...g);
    gr.addColorStop(0, col + 'aa'); gr.addColorStop(1, col + '00');
    sctx.fillStyle = gr; sctx.fillRect(0, 0, n, n);
    c = makeCanvas((2 * hw + 2) * dpr, (2 * hh + 2) * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform((hw / n) * dpr, (hh / n) * dpr, (-hw / n) * dpr, (hh / n) * dpr, (hw + 1) * dpr, 1 * dpr);
    ctx.drawImage(src, 0, 0);
    this.edges.set(k, c);
    return c;
  }
}

// ---------- Частицы ----------
export class Particles {
  constructor() { this.list = []; this.seq = 0; }
  emit(kind, x, y, quality, max, color = null, h = 1.2) {
    for (const p of A().burst(kind, ++this.seq, quality, color)) {
      if (this.list.length >= max) this.list.shift();
      this.list.push({ ...p, x, y, h, age: 0 });
    }
  }
  step(dt) {
    const s = dt / 1000;
    for (const p of this.list) { p.age += dt; p.x += p.vx * s * 0.35; p.y -= p.vx * s * 0.35; p.h += -p.vy * s; p.vy += p.g * s; } // vx — вдоль экрана, vy и g — по высоте
    this.list = this.list.filter((p) => p.age < p.life && p.h > -0.5);
  }
  draw(r) {
    const ctx = r.ctx;
    for (const p of this.list) {
      const s = r.toScreen(p.x, p.y), a = 1 - p.age / p.life;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
            ctx.beginPath();
      ctx.ellipse(s.x, s.y - p.h * r.hh * 2, Math.max(0.4, p.size * 0.55), Math.max(0.4, p.size * 0.38), p.age / 700, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
const particles = new Particles();
let activeRenderer = null;
// События боя и магии → частицы (вызывается из combat-view.js); pos — { x, y } в клетках
export function artFx(ev, pos) {
  const r = activeRenderer;
  if (!r || !r.Q || !r.Q.particles || !pos) return;
  const kind = A().fxKind(ev);
  if (!kind) return;
  const color = ev.k === 'spell' && window.Magic && window.Magic.SCHOOLS[ev.school] ? window.Magic.SCHOOLS[ev.school].color : null;
  particles.emit(kind, pos.x, pos.y, r.quality, Math.round(A().settings.artParticleMax * r.Q.particles), color, ev.k === 'hit' || ev.k === 'heal' ? 1.4 : 0.6);
}
export const artParticles = () => particles;

// ---------- Рендер ----------
export class ArtRenderer extends IsoRenderer {
  constructor(canvas, map, opts = {}) {
    super(canvas, map, opts);
    this.art = true;
    this.setQuality(opts.quality || 'medium');
    this.level = null; // уровень мира (shared/levels.js) — для освещения
    this.lastT = 0;
    this.deferred = null;
    activeRenderer = this;
  }
  setQuality(q) {
    this.quality = A().QUALITY[q] ? q : 'medium';
    this.Q = A().quality(this.quality);
    this.atlas = new Atlas(this.quality);
    super.setQuality(this.quality); // предел плотности пикселей, сброс кэшей земли
  }
  groundKey() { return super.groundKey() + '|' + this.quality; }
  lightEnv(time) {
    const lv = this.level;
    return { phase: typeof this.phaseOverride === 'number' ? this.phaseOverride : A().dayPhase(Date.now()), // phaseOverride — чит-панель «время суток» (шаг 20)
      z: lv ? lv.z || 0 : 0, type: lv ? lv.type : null, time };
  }

  draw(scene, time) {
    activeRenderer = this;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0d1b26';
    ctx.fillRect(0, 0, this.vw, this.vh);
    const r = this.visibleRange();
    this.deferred = [];
    this.beginVisibility(scene,time);
    if (this.zoom < this.cacheBelowZoom) this.drawCached(r, scene, time);
    else this.drawDirect(r, scene, time);
    if (this.fog) this.fog.draw(this); // туман войны (шаг 22) — под частицами и светом
    const dt = this.lastT ? Math.min(100, time - this.lastT) : 16;
    this.lastT = time;
    particles.step(dt);
    if (this.Q.particles) particles.draw(this);
    this.drawLight(scene, time);
    const labels = this.deferred;
    this.deferred = null;
    for (const args of labels) super.drawLabels(...args); // подписи — поверх освещения
    this.drawGroundLabels(scene.ground, scene.hero, scene.groundLabelRange || 3);
    if (scene.overlay) scene.overlay(this, time);
  }
  drawLabels(...args) { if (this.deferred) this.deferred.push(args); else super.drawLabels(...args); }

  // Освещение: оттенок суток / уровня поверх сцены; в темноте — круг света вокруг героя
  drawLight(scene, time) {
    const L = A().light(this.lightEnv(time), this.quality);
    this.lastLight = L;
    if (!L.alpha) return;
    const ctx = this.ctx;
    const n = parseInt(L.tint.slice(1), 16), rgb = `${n >> 16},${(n >> 8) & 255},${n & 255}`;
    if (L.radius && scene.hero) {
      const s = this.toScreen(scene.hero.x, scene.hero.y), rad = L.radius * this.hw;
      const g = ctx.createRadialGradient(s.x, s.y - this.hh, rad * 0.25, s.x, s.y - this.hh, rad);
      g.addColorStop(0, `rgba(${rgb},${(L.alpha * 0.15).toFixed(3)})`);
      g.addColorStop(1, `rgba(${rgb},${L.alpha})`);
      ctx.fillStyle = g;
    } else ctx.fillStyle = `rgba(${rgb},${L.alpha})`;
    ctx.fillRect(0, 0, this.vw, this.vh);
  }

  // Земля: каждый биом одним сплошным полем; крупная фактура не повторяется по клеткам.
  drawGround(ctx, x0, x1, y0, y1, toScr, inView, time) {
    const { hw, hh } = this, map = this.map, W = map.width, B = A().BIOMES;
    const dpr = this.dpr || 1;
    let count = 0;
    const continuous = new Map();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const s = toScr(x, y);
        if (!inView(s)) continue;
        const t = map.tiles[y * W + x];
        const groundTile = t === G().B.CITY && this.cityRoadAt(x, y) ? G().B.ROAD : t;
        let path = continuous.get(groundTile); if (!path) continuous.set(groundTile, path = new Path2D());
        const bleed = Math.max(0.8, 1.25 / dpr);
        path.moveTo(s.x, s.y - bleed); path.lineTo(s.x + hw + bleed, s.y + hh); path.lineTo(s.x, s.y + 2 * hh + bleed); path.lineTo(s.x - hw - bleed, s.y + hh); path.closePath();
        count++;
      }
    }
    // Заполняем и подрезаем каждый биом единым контуром, без отдельных ромбов/текстур по клеткам.
    for (const [tile, path] of continuous) {
      const id = B[tile]?.id;
      ctx.save(); ctx.fillStyle = B[tile]?.base || '#55534d'; ctx.fill(path); ctx.clip(path);
      const step = id === 'road' ? 3 : id === 'city' ? 5 : 4;
      for (let gy = Math.floor((y0 - 5) / step) * step; gy <= y1 + 5; gy += step) for (let gx = Math.floor((x0 - 5) / step) * step; gx <= x1 + 5; gx += step) {
        const r = this.rand(gx, gy, id === 'road' ? 61 : id === 'forest' ? 51 : 41);
        if (id === 'road') {
          if (r < 0.28) continue;
          const p = toScr(gx + 0.5, gy + 0.5); if (!inView(p)) continue;
          ctx.strokeStyle = 'rgba(19,21,22,0.42)'; ctx.lineWidth = Math.max(0.8, hw * 0.018); ctx.lineCap = 'round';
          const dx = hw * (0.2 + r * 0.16), dy = hh * (0.2 + r * 0.16), bend = (this.rand(gx, gy, 62) - 0.5) * hh * 0.4;
          ctx.beginPath(); ctx.moveTo(p.x - dx, p.y - dy); ctx.lineTo(p.x - dx * 0.3, p.y + bend); ctx.lineTo(p.x + dx * 0.25, p.y - bend * 0.5); ctx.lineTo(p.x + dx, p.y + dy); ctx.stroke();
          if (this.rand(gx, gy, 63) > 0.82) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + dx * 0.35, p.y - hh * 0.35); ctx.stroke(); }
          // Faded lane paint, patched asphalt and weeds growing out of fissures.
          if(r>.6){ctx.strokeStyle='rgba(193,179,132,.48)';ctx.lineWidth=Math.max(1,hw*.055);ctx.beginPath();ctx.moveTo(p.x-hw*.45,p.y-hh*.45);ctx.lineTo(p.x+hw*.15,p.y+hh*.15);ctx.stroke();}
          if(r>.78){ctx.fillStyle='rgba(29,32,29,.6)';ctx.beginPath();ctx.ellipse(p.x+hw*.25,p.y+hh*.2,hw*.18,hh*.14,.2,0,Math.PI*2);ctx.fill();}
          ctx.strokeStyle='#65704a';ctx.lineWidth=Math.max(.7,hw*.025);
          for(let i=0;i<3;i++){const px=p.x+dx*(i-1)*.3,py=p.y+bend;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+(i-1)*hw*.035,py-hh*(.14+i*.04));ctx.stroke();}
          continue;
        }
        if (id === 'city' && r < 0.7) continue;
        if (id === 'forest' && r < 0.36) continue;
        if (id === 'desert' && r < 0.28) continue;
        if (['water', 'river', 'seabed'].includes(id) && r < 0.7) continue;
        const p = toScr(gx + this.rand(gx, gy, 42) * step, gy + this.rand(gx, gy, 43) * step); if (!inView(p)) continue;
        const rx = hw * (id === 'city' ? 1.7 : id === 'water' || id === 'river' || id === 'seabed' ? 2.4 : 2.2 + this.rand(gx, gy, 44) * 2.8), ry = hh * (id === 'city' ? 1.0 : id === 'water' || id === 'river' || id === 'seabed' ? 0.26 : 1.2 + this.rand(gx, gy, 45) * 1.8);
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rx);
        const light = r > 0.67;
        const colors = id === 'forest' ? (light ? ['rgba(110,145,65,0.19)', 'rgba(110,145,65,0)'] : ['rgba(24,48,22,0.22)', 'rgba(24,48,22,0)'])
          : id === 'city' ? ['rgba(36,34,30,0.1)', 'rgba(36,34,30,0)']
            : ['water', 'river', 'seabed'].includes(id) ? ['rgba(175,220,225,0.13)', 'rgba(175,220,225,0)']
            : light ? ['rgba(239,211,151,0.20)', 'rgba(239,211,151,0)'] : ['rgba(119,83,39,0.14)', 'rgba(119,83,39,0)'];
        grad.addColorStop(0, colors[0]); grad.addColorStop(1, colors[1]); ctx.fillStyle = grad;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, (this.rand(gx, gy, 46) - 0.5) * 0.5, 0, Math.PI * 2); ctx.fill();
        if (['forest','waste','settlement','city','hills'].includes(id)) {
          ctx.strokeStyle = 'rgba(137,157,77,0.3)'; ctx.lineWidth = Math.max(0.7, hw * 0.012);
          ctx.beginPath(); ctx.moveTo(p.x - hw * 0.22, p.y + hh * 0.16); ctx.lineTo(p.x + hw * 0.08, p.y - hh * 0.1); ctx.lineTo(p.x + hw * 0.24, p.y + hh * 0.11); ctx.stroke();
        }
      }
      // Stable fine detail crosses tile boundaries and remains cached with the ground chunk.
      if(!['water','river','sky'].includes(id))for(let gy=y0;gy<=y1;gy++)for(let gx=x0;gx<=x1;gx++){
        const seed=this.rand(gx,gy,137),p=toScr(gx+.1+this.rand(gx,gy,138)*.8,gy+this.rand(gx,gy,139));
        ctx.fillStyle=id==='road'?'rgba(158,152,130,.22)':'rgba(48,49,35,.16)';
        for(let k=0;k<3;k++){ctx.beginPath();ctx.ellipse(p.x+(k-1)*hw*.13,p.y+Math.sin(k+seed*8)*hh*.2,Math.max(.5,hw*.025),Math.max(.35,hh*.035),0,0,Math.PI*2);ctx.fill();}
        if(id==='road'&&seed>.7){ctx.strokeStyle='rgba(15,20,19,.65)';ctx.lineWidth=Math.max(.7,hw*.02);ctx.beginPath();ctx.moveTo(p.x-hw*.5,p.y-hh*.2);ctx.lineTo(p.x-hw*.1,p.y+hh*.1);ctx.lineTo(p.x+hw*.12,p.y-hh*.16);ctx.lineTo(p.x+hw*.5,p.y+hh*.18);ctx.stroke();}
        if(['city','waste','settlement','forest','hills'].includes(id)&&seed>.55){ctx.strokeStyle=id==='waste'?'#6a7251':'#5f7048';ctx.lineWidth=Math.max(.6,hw*.02);for(let k=0;k<3;k++){ctx.beginPath();ctx.moveTo(p.x+k*hw*.04,p.y);ctx.lineTo(p.x+(k-1)*hw*.06,p.y-hh*(.12+seed*.18));ctx.stroke();}}
      }
      ctx.restore();
    }
    return count;
  }

  // Объекты: по биому (shared/art.js BIOME_OBJECTS); горы и холмы — прежние фигуры с тенью
  drawObject(t, x, y, s) {
    if(window.Houses?.covering?.(this.map,x,y)){super.drawObject(t,x,y,s);return;}
    const b = A().BIOMES[t];
    if (!b) return super.drawObject(t, x, y, s);
    const rnd = this.rand(x, y, 11), objs = A().BIOME_OBJECTS[b.id] || [];
    const ctx = this.ctx, { hw, hh } = this, cx = s.x, cy = s.y + hh;
    if (b.id === 'mountain' || b.id === 'hills' || b.id === 'wall') { if(rnd<.7)this.objSprite(b.id==='mountain'?'peak':b.id==='hills'?'mound':'wall_block',cx,cy,rnd); return; }
    if (b.id === 'city') {
      if (window.Houses && window.Houses.at(this.map, x, y)) { super.drawObject(t, x, y, s); return; }
      if (this.cityRoadAt(x, y)) return;
      if (rnd < 0.055) this.objSprite('ruin_block', cx, cy, rnd);
      else if (rnd < 0.13) this.objSprite('rubble', cx, cy, rnd);
      else if (rnd < 0.15) this.objSprite('rusted_car', cx, cy, rnd);
      else if (rnd > 0.95) this.objSprite('tree_oak', cx, cy, rnd);
      else if (rnd > 0.9) this.rust(cx, cy, rnd);
      return;
    }
    if (!objs.length) return;
    const dense = b.id === 'forest' ? 0.34 : this.Q.detail ? 0.12 : 0.07;
    if (rnd >= dense) return;
    const key = objs[Math.floor(this.rand(x, y, 12) * objs.length)];
    if (b.id === 'forest' && rnd < 0.04) { // два дерева на клетке
      this.objSprite(key, cx - hw * 0.22, cy - hh * 0.15, this.rand(x, y, 13));
      this.objSprite(objs[Math.floor(this.rand(x, y, 14) * objs.length)], cx + hw * 0.2, cy + hh * 0.15, this.rand(x, y, 15));
    } else this.objSprite(key, cx + (this.rand(x, y, 16) - 0.5) * hw * 0.3, cy, this.rand(x, y, 17));
  }
  shadow(cx, cy, rx) { if (!this.Q.shadows) return; const ctx = this.ctx; ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(cx + rx * 0.25, cy, rx, rx * 0.4, 0, 0, Math.PI * 2); ctx.fill(); }
  // Ржавые потёки и лозы на руинах
  rust(cx, cy, rnd) {
    if (!this.Q.detail && rnd > 0.7) return;
    const ctx = this.ctx, { hw, hh } = this;
    ctx.fillStyle = 'rgba(150,72,34,0.45)';
    ctx.fillRect(cx - hw * 0.45, cy - hh * (1 + rnd * 2), hw * 0.06, hh * (0.6 + rnd));
    ctx.fillRect(cx + hw * 0.25, cy - hh * (0.8 + rnd), hw * 0.05, hh * 0.7);
    if (rnd > 0.6) { ctx.strokeStyle = 'rgba(70,110,40,0.75)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx - hw * 0.6, cy); ctx.quadraticCurveTo(cx - hw * 0.7, cy - hh * 1.2, cx - hw * 0.4, cy - hh * 2); ctx.stroke(); }
  }
  // Шаг 20: объект — готовым спрайтом из кэша (8 вариантов на ключ, на масштаб и качество): свечение (shadowBlur)
  // и десятки фигур рисуются один раз, а каждый кадр — один drawImage
  objSprite(key, cx, cy, r) {
    const { hw, hh } = this, dpr = this.dpr || 1, k = this.groundKey();
    if (this.spriteKey !== k) { this.sprites = new Map(); this.spriteKey = k; }
    const ri = Math.min(7, Math.floor(r * 8)), id = key + '|' + ri;
    let sp = this.sprites.get(id);
    if (!sp) {
      const car = key === 'rusted_car';
      const W = Math.ceil(hw * 6) + 4, H = Math.ceil(hh * 20) + 4, ox = W / 2, oy = H - Math.ceil(hh * (car ? 4 : 1.5));
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(W * dpr); canvas.height = Math.ceil(H * dpr);
      const c2 = canvas.getContext('2d', { willReadFrequently: true });
      c2.scale(dpr, dpr);
      const saved = this.ctx;
      this.ctx = c2;
      try { this.obj(key, ox, oy, (ri + 0.5) / 8); } finally { this.ctx = saved; }
      const t = trimSprite({ canvas, ox, oy, w: W, h: H }); // без пустых полей — меньше пикселей в кадре
      sp = { canvas: t.canvas, ox: t.ox, oy: t.oy, W: t.w, H: t.h };
      this.sprites.set(id, sp);
    }
    this.ctx.drawImage(sp.canvas, Math.round((cx - sp.ox) * dpr) / dpr, Math.round((cy - sp.oy) * dpr) / dpr, sp.W, sp.H);
  }
  // Объект по ключу (shared/art.js OBJECT_KEYS)
  obj(key, cx, cy, r) {
    const ctx = this.ctx, { hw, hh } = this;
    if (drawScenery(ctx, key, cx, cy, hh * 1.1, r)) return;
    const P = (pts, fill) => { ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
    const E = (x, y, rx, ry, fill) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
    switch (key) {
      case 'tree_pine': { const h = hh * (2 + r * 1.2); this.shadow(cx, cy, hw * 0.3); ctx.fillStyle = '#4a3322'; ctx.fillRect(cx - hw * 0.04, cy - h * 0.3, hw * 0.08, h * 0.3);
        for (let i = 0; i < 3; i++) { const yy = cy - h * (0.25 + i * 0.25), w = hw * (0.34 - i * 0.08); P([[cx, yy - h * 0.35], [cx + w, yy], [cx - w, yy]], i % 2 ? '#2a4a26' : '#24401f'); P([[cx, yy - h * 0.35], [cx + w, yy], [cx, yy - h * 0.05]], 'rgba(0,0,0,0.2)'); } break; }
      case 'tree_oak': { const h = hh * (1.8 + r); this.shadow(cx, cy, hw * 0.35); ctx.fillStyle = '#5a3b24'; ctx.fillRect(cx - hw * 0.05, cy - h * 0.55, hw * 0.1, h * 0.55);
        E(cx - hw * 0.15, cy - h * 0.7, hw * 0.26, hh * 0.55, '#3a5a2a'); E(cx + hw * 0.15, cy - h * 0.75, hw * 0.24, hh * 0.5, '#466a30'); E(cx, cy - h * 0.95, hw * 0.25, hh * 0.5, '#4e7434');
        if (r > 0.75) for (let i = 0; i < 3; i++) E(cx + (i - 1) * hw * 0.14, cy - h * (0.7 + (i % 2) * 0.2), 1.6, 1.6, '#e05a3a'); break; }
      case 'tree_twisted': { const h = hh * (1.9 + r); this.shadow(cx, cy, hw * 0.3); ctx.strokeStyle = '#3a2a30'; ctx.lineWidth = hw * 0.08; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.bezierCurveTo(cx - hw * 0.2, cy - h * 0.4, cx + hw * 0.2, cy - h * 0.6, cx, cy - h * 0.8); ctx.stroke();
        E(cx, cy - h * 0.9, hw * 0.3, hh * 0.45, '#3a4a5a'); ctx.save(); ctx.shadowColor = '#8ad0ff'; ctx.shadowBlur = 6; for (let i = 0; i < 3; i++) E(cx + (i - 1) * hw * 0.15, cy - h * (0.85 + (i % 2) * 0.12), 1.8, 1.8, '#9ae0ff'); ctx.restore(); break; } // магическое дерево со светлячками
      case 'tree_dead': { const h = hh * (1.6 + r); ctx.strokeStyle = '#4a3f36'; ctx.lineWidth = hw * 0.06; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - h); ctx.moveTo(cx, cy - h * 0.6); ctx.lineTo(cx + hw * 0.25, cy - h * 0.85); ctx.moveTo(cx, cy - h * 0.45); ctx.lineTo(cx - hw * 0.22, cy - h * 0.7); ctx.stroke(); break; }
      case 'cactus': { const h = hh * (1.3 + r * 0.8); this.shadow(cx, cy, hw * 0.15); ctx.fillStyle = '#4a7a3a'; ctx.fillRect(cx - hw * 0.06, cy - h, hw * 0.12, h); ctx.fillRect(cx + hw * 0.06, cy - h * 0.6, hw * 0.12, hw * 0.06); ctx.fillRect(cx + hw * 0.14, cy - h * 0.85, hw * 0.06, h * 0.3); break; }
      case 'bones': ctx.strokeStyle = '#e8e0cc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - hw * 0.2, cy); ctx.lineTo(cx + hw * 0.15, cy - hh * 0.2); ctx.moveTo(cx - hw * 0.1, cy - hh * 0.25); ctx.lineTo(cx + hw * 0.05, cy + hh * 0.1); ctx.stroke(); E(cx + hw * 0.22, cy - hh * 0.1, hw * 0.08, hh * 0.12, '#e8e0cc'); break;
      case 'dune': ctx.beginPath(); ctx.ellipse(cx, cy, hw * 0.6, hh * 0.45, 0, Math.PI, 0); ctx.fillStyle = 'rgba(230,200,130,0.5)'; ctx.fill(); break;
      case 'barrel': { this.shadow(cx, cy, hw * 0.14); ctx.fillStyle = '#7a4a2a'; ctx.fillRect(cx - hw * 0.12, cy - hh * 0.9, hw * 0.24, hh * 0.9); ctx.fillStyle = '#5a3420'; ctx.fillRect(cx - hw * 0.12, cy - hh * 0.6, hw * 0.24, 2); E(cx, cy - hh * 0.9, hw * 0.12, hh * 0.12, '#6a3a20');
        if (r > 0.5) { ctx.save(); ctx.shadowColor = '#9aff5a'; ctx.shadowBlur = 8; E(cx, cy - hh * 0.9, hw * 0.08, hh * 0.07, '#9aff5a'); ctx.restore(); } break; } // радиоактивная жижа
      case 'tire': ctx.strokeStyle = '#1e1c1a'; ctx.lineWidth = hw * 0.06; ctx.beginPath(); ctx.ellipse(cx, cy - hh * 0.1, hw * 0.16, hh * 0.12, 0, 0, Math.PI * 2); ctx.stroke(); break;
      case 'rusted_car': { this.shadow(cx, cy, hw * 0.45); P([[cx - hw * 0.5, cy - hh * 0.1], [cx, cy + hh * 0.2], [cx + hw * 0.5, cy - hh * 0.1], [cx + hw * 0.5, cy - hh * 0.5], [cx, cy - hh * 0.2], [cx - hw * 0.5, cy - hh * 0.5]], '#8a4a2a');
        P([[cx - hw * 0.3, cy - hh * 0.5], [cx + hw * 0.2, cy - hh * 0.35], [cx + hw * 0.25, cy - hh * 0.8], [cx - hw * 0.25, cy - hh * 0.95]], '#6a3a22'); E(cx - hw * 0.3, cy - hh * 0.05, hw * 0.07, hh * 0.08, '#1e1c1a'); E(cx + hw * 0.3, cy - hh * 0.05, hw * 0.07, hh * 0.08, '#1e1c1a'); break; }
      case 'stalagmite': P([[cx - hw * 0.12, cy], [cx, cy - hh * (1.5 + r)], [cx + hw * 0.12, cy]], '#5e5348'); break;
      case 'mushroom': { ctx.fillStyle = '#d8d0c0'; ctx.fillRect(cx - 1.5, cy - hh * 0.6, 3, hh * 0.6); ctx.save(); ctx.shadowColor = '#7affc8'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.ellipse(cx, cy - hh * 0.6, hw * 0.14, hh * 0.18, 0, Math.PI, 0); ctx.fillStyle = r > 0.5 ? '#5affb8' : '#b88aff'; ctx.fill(); ctx.restore(); break; }
      case 'cocoon': E(cx, cy - hh * 0.5, hw * 0.13, hh * 0.5, '#8a6a8a'); E(cx - hw * 0.03, cy - hh * 0.6, hw * 0.04, hh * 0.2, 'rgba(220,255,160,0.5)'); break;
      case 'kelp': { ctx.strokeStyle = '#3a8a5a'; ctx.lineWidth = 2; const t = (this.lastT || 0) / 600; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.quadraticCurveTo(cx + Math.sin(t + r * 6) * hw * 0.2, cy - hh, cx + Math.sin(t + r * 6 + 1) * hw * 0.1, cy - hh * 1.8); ctx.stroke(); break; }
      case 'shell': E(cx, cy - 2, hw * 0.07, hh * 0.08, '#e8c8b8'); break;
      case 'cloud': E(cx, cy - hh * 0.2, hw * 0.4, hh * 0.25, 'rgba(255,255,255,0.55)'); break;
      case 'vent': ctx.fillStyle = '#55524c'; ctx.fillRect(cx - hw * 0.12, cy - hh * 0.6, hw * 0.24, hh * 0.6); ctx.fillStyle = '#2a2826'; ctx.fillRect(cx - hw * 0.1, cy - hh * 0.55, hw * 0.2, 2); break;
      case 'crate': this.shadow(cx, cy, hw * 0.2); ctx.fillStyle = '#7a5a3a'; ctx.fillRect(cx - hw * 0.18, cy - hh * 0.8, hw * 0.36, hh * 0.8); ctx.strokeStyle = '#4a3422'; ctx.lineWidth = 1; ctx.strokeRect(cx - hw * 0.18, cy - hh * 0.8, hw * 0.36, hh * 0.8); break;
      case 'boulder': this.shadow(cx, cy, hw * 0.25); E(cx, cy - hh * 0.3, hw * 0.22, hh * 0.35, '#7a756e'); E(cx - hw * 0.06, cy - hh * 0.42, hw * 0.1, hh * 0.12, '#9a958e'); break;
      default:
    }
  }

  // Фигуры: дети меньше (hero.scale), удар — выпад, смерть — падение
  drawHero(hero, time) { super.drawHero(hero, time); }
  drawEnemyFig(e, time) {
    if (e.deadAt && e.look && ['cyborg', 'walker'].includes(e.look.shape) && !e.artSparked) {
      e.artSparked = true; artFx({ k: 'impact', f: 'spark' }, e);
    }
    super.drawEnemyFig(e, time);
  }
}
