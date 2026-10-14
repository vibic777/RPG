// Изометрический рендер (ромб 2:1): земля пачками по цветам, объекты по диагоналям (дальние раньше).
import { iconCanvas, weaponKind } from '../icons.js';
import { trimSprite } from './sprite-memo.js';
import { drawEnemy } from './enemy-draw.js';
import { drawHumanoid, actorPose } from './figure-art.js';
import { memoFigure } from './figure-memo.js';
import { drawScenery, drawHouse, drawFurniture } from './scenery-art.js';
import { swimModeAt } from './swim-art.js';
import { sceneryView } from './scenery-view.js';
import { textScale } from '../accessibility.js';

const G = window.WorldGen;
const Items = window.Items;

export class IsoRenderer {
  constructor(canvas, map, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.tw = opts.tileWidth;
    this.zoom = opts.zoom;
    this.cam = { x: 0, y: 0 }; // центр камеры в координатах клеток
    this.seed = G.hashString(map.seed);
    this.visibilityFades = new Map();
    this.lastStats = { tiles: 0, chunks: 0 };
    // Кэш фрагментов карты (земля + объекты) для мелкого масштаба
    this.chunkSize = opts.chunkSize || 16;
    this.cacheBelowZoom = opts.cacheBelowZoom ?? 0.75;
    this.cacheMax = opts.cacheMaxChunks || 256;
    this.cache = new Map();
    this.cacheKey = '';
    // шаг 20: земля фрагментами на любом масштабе (кэш холстов), не больше groundBuildsPerFrame новых за кадр
    this.groundCache = opts.groundCache ?? true;
    this.groundBuildsPerFrame = opts.groundBuildsPerFrame ?? 3;
    this.gcache = new Map();
    this.gkey = '';
    this.maxDpr = opts.maxDpr || 4; // предел плотности пикселей (качество графики)
  }

  // Шаг 20: качество графики у простого рендера — только предел плотности пикселей
  setQuality(q) {
    const Q = typeof window !== 'undefined' && window.Art ? window.Art.quality(q) : null;
    this.quality = q;
    this.maxDpr = Q && Q.dpr ? Q.dpr : 4;
    if (this.vw) this.resize();
    this.gcache.clear(); this.gkey = ''; this.cache.clear(); this.cacheKey = '';
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr || 4);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.vw = w; this.vh = h;
  }

  get hw() { return (this.tw / 2) * this.zoom; }
  get hh() { return (this.tw / 4) * this.zoom; }

  // координаты клетки -> экран (CSS-пиксели)
  toScreen(x, y) {
    return {
      x: (x - y - (this.cam.x - this.cam.y)) * this.hw + this.vw / 2,
      y: (x + y - (this.cam.x + this.cam.y)) * this.hh + this.vh / 2,
    };
  }

  actorToScreen(actor) {
    const out = { x: 0, y: 0 };
    out.x = (actor.x - actor.y - (this.cam.x - this.cam.y)) * this.hw + this.vw / 2;
    out.y = (actor.x + actor.y - (this.cam.x + this.cam.y)) * this.hh + this.vh / 2;
    return out;
  }

  // экран -> координаты клетки (дробные)
  toWorld(sx, sy) {
    const a = (sx - this.vw / 2) / this.hw + (this.cam.x - this.cam.y);
    const b = (sy - this.vh / 2) / this.hh + (this.cam.x + this.cam.y);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  visibleRange() {
    const pad = 2;
    const pts = [this.toWorld(0, 0), this.toWorld(this.vw, 0), this.toWorld(0, this.vh), this.toWorld(this.vw, this.vh + 24 * this.hh)];
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return {
      x0: Math.max(0, Math.floor(Math.min(...xs)) - pad), x1: Math.min(this.map.width - 1, Math.ceil(Math.max(...xs)) + pad),
      y0: Math.max(0, Math.floor(Math.min(...ys)) - pad), y1: Math.min(this.map.height - 1, Math.ceil(Math.max(...ys)) + pad),
    };
  }

  rand(x, y, k = 0) { return G.hash2(x, y, (this.seed + k) | 0); }

  cityRoadAt(x, y) {
    if (!this.map || this.map.genVersion >= 4 || G.tileAt(this.map, x, y) !== G.B.CITY) return false;
    if (window.Houses && (window.Houses.covering?.(this.map,x,y)||window.Houses.at(this.map, x, y))) return false;
    const phaseX = this.seed % 24, phaseY = Math.floor(this.seed / 24) % 22;
    const bendX = Math.round(1.5 * Math.sin((y + phaseY) * 0.035));
    const bendY = Math.round(1.2 * Math.sin((x + phaseX) * 0.032));
    const laneX = ((x - phaseX + bendX) % 24 + 24) % 24;
    const laneY = ((y - phaseY + bendY) % 22 + 22) % 22;
    return laneX < 2 || laneY < 2;
  }

  draw(scene, time) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0d1b26';
    ctx.fillRect(0, 0, this.vw, this.vh);
    const r = this.visibleRange();
    this.beginVisibility(scene, time);
    if (this.zoom < this.cacheBelowZoom) this.drawCached(r, scene, time);
    else this.drawDirect(r, scene, time);
    if (this.fog) this.fog.draw(this); // туман войны (шаг 22)
    this.drawGroundLabels(scene.ground, scene.hero, scene.groundLabelRange || 3);
    if (scene.overlay) scene.overlay(this, time); // полоски здоровья, снаряды, вспышки, числа урона
  }

  // Мелкий масштаб: карта рисуется готовыми фрагментами (кэш), герой — поверх
  drawCached(r, scene, time) {
    const C = this.chunkSize, { hw, hh } = this;
    const key = this.zoom.toFixed(4) + '|' + this.dpr;
    if (key !== this.cacheKey) { this.cache.clear(); this.cacheKey = key; }
    const cx0 = Math.floor(r.x0 / C), cx1 = Math.floor(r.x1 / C), cy0 = Math.floor(r.y0 / C), cy1 = Math.floor(r.y1 / C);
    const labels = [];
    let n = 0;
    for (let d = cx0 + cy0; d <= cx1 + cy1; d++) {
      for (let cx = Math.max(cx0, d - cy1); cx <= Math.min(cx1, d - cy0); cx++) {
        const cy = d - cx;
        const top = this.toScreen(cx * C, cy * C);
        if (top.x + (C+14) * hw < 0 || top.x - (C+14) * hw > this.vw || top.y - 42 * hh > this.vh || top.y + 2 * C * hh < 0) continue;
        let chunk = this.cache.get(cx + ',' + cy);
        if (!chunk) chunk = this.buildChunk(cx, cy);
        else { this.cache.delete(cx + ',' + cy); this.cache.set(cx + ',' + cy, chunk); }
        if (chunk.objects && (this.visibilityPrefs || sceneryView()).mode === 'solid') {
          // полный вид: земля и объекты фрагмента — заранее сведённым холстом (один drawImage вместо двух; source-over ассоциативен)
          if (!chunk.merged) { const m = document.createElement('canvas'); m.width = chunk.canvas.width; m.height = chunk.canvas.height; const mc = m.getContext('2d'); mc.drawImage(chunk.canvas, 0, 0); mc.drawImage(chunk.objects, 0, 0); chunk.merged = m; }
          this.blitVisible(chunk.merged, top.x - chunk.ox, top.y - chunk.oy, chunk.w, chunk.h);
        } else {
          this.blitVisible(chunk.canvas, top.x - chunk.ox, top.y - chunk.oy, chunk.w, chunk.h);
          this.drawCachedObjects(chunk,top,scene,time);
        }
        for(const m of chunk.markers)this.drawMarkerView(m,this.toScreen(m.x,m.y));
        n++;
        for (const m of chunk.markers) labels.push([m, this.toScreen(m.x, m.y)]);
      }
    }
    let cachePixels=0;for(const chunk of this.cache.values())cachePixels+=chunk.canvas.width*chunk.canvas.height*(chunk.lowObjects?3:chunk.objects?2:1)+(chunk.merged?1:0);
    while(this.cache.size>this.cacheMax||(cachePixels>32e6&&this.cache.size>n)){const [key,chunk]=this.cache.entries().next().value;cachePixels-=chunk.canvas.width*chunk.canvas.height*(chunk.lowObjects?3:chunk.objects?2:1)+(chunk.merged?1:0);this.cache.delete(key);}
    this.lastStats.chunks = n;
    if(scene.groundEffects)scene.groundEffects(this,time);
    const dl = this.depthList(scene, time);
    for (const f of dl.flat) f.fn();
    for (const f of dl.figs) this.drawFigure(f);
    this.drawLabels(labels, scene.hero, scene.others);
  }

  // Порядок рисования: плоские вещи (предметы, мины) и фигуры (герои, враги, турели) по глубине x+y.
  // Предмет у ног фигуры рисуется сразу после неё — иначе фигура его закрывает (например, только что выброшенный).
  depthList(scene, time) {
    const figs = [];
    // Запас учитывает крупный транспорт, крылья и высокие постройки.
    const margin = Math.max(240, this.hw * 12);
    const padX = margin / Math.max(1, this.hw), padY = margin / Math.max(1, this.hh);
    const x0 = this.cam.x - this.vw / (2 * this.hw) - padX - 1, x1 = this.cam.x + this.vw / (2 * this.hw) + padX + 1;
    const y0 = this.cam.y - this.vh / (2 * this.hh) - padY - 1, y1 = this.cam.y + this.vh / (2 * this.hh) + padY + 1;
    const visible=(x,y,r=0)=>x+r>=x0&&x-r<=x1&&y+r>=y0&&y-r<=y1;
    // layer — высота полёта (> 0): летящее (авиация, дракон, ранец) рисуется поверх всего наземного, выше — позже
    const add = (x, y, fn, layer = 0, actor = null,radius=0) => { if (visible(x, y,radius)) figs.push({ x, y, s: actor ? this.actorToScreen(actor) : null, d: Math.floor(x) + Math.floor(y), fn, after: [], layer: layer > 0 ? layer : 0 }); };
    // шаг 22: туман войны — враги и чужие герои только в обзоре, остальное — на разведанных клетках
    const fg = this.fog, see = fg ? fg.see : null, known = fg ? fg.known : null, others = fg ? fg.others : null;
    for (const t of scene.turrets || []) if (!known || known(t.x, t.y)) add(t.x, t.y, () => this.drawTurret(t, time));
    for (const e of scene.enemies || []) if (!see || see(e.x, e.y)) add(e.x, e.y, () => this.drawEnemyFig(e, time), 0, e);
    for (const o of scene.others || []) if (!others || others(o.x, o.y)) add(o.x, o.y, () => this.drawHero(o, time), o.alt, o);
    for (const p of scene.props || []) if (!known || known(p.x, p.y)) add(p.x, p.y, () => p.obstacle ? this.drawObstacle(p.x,p.y,()=>p.draw(this,time),p.kind||'building') : p.draw(this,time), p.layer,null,p.boundsRadius||0); // постройки базы, техника (layer — высота полёта)
    add(scene.hero.x, scene.hero.y, () => { this.drawTarget(scene.target, time); this.drawHero(scene.hero, time); }, scene.hero.alt, scene.hero);
    figs.sort((a, b) => a.layer - b.layer || a.x + a.y - (b.x + b.y));
    const flat = [];
    for (const f of scene.flats || []) if (visible(f.x, f.y) && (!known || known(f.x, f.y))) flat.push({ d: Math.floor(f.x) + Math.floor(f.y), fn: () => f.draw(this, time) });
    for (const t of scene.traps || []) if (visible(t.x, t.y) && (!known || known(t.x, t.y))) flat.push({ d: Math.floor(t.x) + Math.floor(t.y), fn: () => this.drawTrap(t, time) });
    const near = this.groundOnTop ?? 0.9;
    const buckets = new Map(), bucketSize = Math.max(near, 0.01);
    const key = (x, y) => x + ',' + y;
    for (const f of figs) {
      const k = key(Math.floor(f.x / bucketSize), Math.floor(f.y / bucketSize));
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(f);
    }
    for (const g of scene.ground || []) {
      if (!visible(g.x, g.y) || known && !known(g.x, g.y)) continue;
      const fn = () => this.drawGroundItem(g, time);
      let best = null, bd = near;
      const bx = Math.floor(g.x / bucketSize), by = Math.floor(g.y / bucketSize);
      for (let x = bx - 1; x <= bx + 1; x++) for (let y = by - 1; y <= by + 1; y++) {
        for (const f of buckets.get(key(x, y)) || []) {
          const dd = Math.hypot(f.x - g.x, f.y - g.y);
          if (dd < bd) { bd = dd; best = f; }
        }
      }
      if (best) best.after.push(fn); else flat.push({ d: Math.floor(g.x) + Math.floor(g.y), fn });
    }
    return { figs, flat };
  }

  drawFigure(f) {
    f.fn();
    for (const fn of f.after) fn();
  }

  buildChunk(cx, cy) {
    const C = this.chunkSize, { hw, hh } = this;
    const padTop = 42 * hh, w = (2*C+28)*hw+2, h = 2*C*hh+padTop+16*hh+2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * this.dpr); canvas.height = Math.ceil(h * this.dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(this.dpr, this.dpr);
    const ox = (C+14)*hw+1, oy = padTop;
    const x0 = cx * C, y0 = cy * C;
    const x1 = Math.min(this.map.width, x0 + C) - 1, y1 = Math.min(this.map.height, y0 + C) - 1;
    const local = (x, y) => ({ x: (x - x0 - (y - y0)) * hw + ox, y: (x - x0 + (y - y0)) * hh + oy });
    const markers = [];
    const saved = this.ctx;
    this.ctx = ctx;
    this.drawGround(ctx, x0, x1, y0, y1, local, () => true, 0);
    const objects=document.createElement('canvas');objects.width=canvas.width;objects.height=canvas.height;
    const objectCtx=objects.getContext('2d');objectCtx.scale(this.dpr,this.dpr);this.ctx=objectCtx;
    for (let d = x0 + y0; d <= x1 + y1; d++) {
      for (let x = Math.max(x0, d - y1); x <= Math.min(x1, d - y0); x++) {
        const y = d - x;
        const s = local(x, y);
        if (this.fog && !this.fog.known(x, y)) continue; // не разведано — ни объектов, ни меток (шаг 22)
        if (!(this.hidden && this.hidden.has(y * this.map.width + x))) this.drawObject(this.map.tiles[y * this.map.width + x], x, y, s); // hidden — убрано ластиком (шаг 21)
        const m = this.markersRef && this.markersRef.get(x + ',' + y);
        if (m) markers.push({ ...m,x,y });
      }
    }
    const lowObjects=document.createElement('canvas');lowObjects.width=canvas.width;lowObjects.height=canvas.height;
    const lowCtx=lowObjects.getContext('2d');lowCtx.scale(this.dpr,this.dpr);this.ctx=lowCtx;
    for(let d=x0+y0;d<=x1+y1;d++)for(let x=Math.max(x0,d-y1);x<=Math.min(x1,d-y0);x++){
      const y=d-x;if(this.fog&&!this.fog.known(x,y)||this.hidden?.has(y*this.map.width+x))continue;
      const s=local(x,y);lowCtx.save();lowCtx.beginPath();lowCtx.rect(s.x-this.hw*5,s.y+this.hh*0.78,this.hw*10,this.hh*1.3);lowCtx.clip();this.drawObject(this.map.tiles[y*this.map.width+x],x,y,s);lowCtx.restore();
    }
    this.ctx = saved;
    const chunk = { canvas, objects, lowObjects, ox, oy, w, h, markers };
    this.cache.set(cx + ',' + cy, chunk);
    return chunk;
  }

  drawCachedObjects(chunk,top,scene,time){
    if(!chunk.objects)return;
    const p=this.visibilityPrefs||sceneryView(),left=top.x-chunk.ox,upper=top.y-chunk.oy;
    if(p.mode==='solid'){this.blitVisible(chunk.objects,left,upper,chunk.w,chunk.h);return;}
    if(p.mode==='low'){if(chunk.lowObjects)this.ctx.drawImage(chunk.lowObjects,left,upper,chunk.w,chunk.h);return;}
    const circle=this.visibilityCircle();
    if(!circle||circle.x+circle.r<left||circle.x-circle.r>left+chunk.w||circle.y+circle.r<upper||circle.y-circle.r>upper+chunk.h){this.ctx.drawImage(chunk.objects,left,upper,chunk.w,chunk.h);return;}
    let scratch=this.visibilityScratch;
    if(!scratch||scratch.width!==chunk.objects.width||scratch.height!==chunk.objects.height){scratch=document.createElement('canvas');scratch.width=chunk.objects.width;scratch.height=chunk.objects.height;this.visibilityScratch=scratch;}
    const c=scratch.getContext('2d');c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,scratch.width,scratch.height);c.drawImage(chunk.objects,0,0);
    c.setTransform(this.dpr,0,0,this.dpr,0,0);c.globalCompositeOperation='destination-out';c.fillStyle=p.mode==='transparent'?`rgba(0,0,0,${1-p.opacity})`:'#000';
    c.beginPath();c.arc(circle.x-left,circle.y-upper,circle.r,0,Math.PI*2);c.fill();c.globalCompositeOperation='source-over';
    this.ctx.drawImage(scratch,left,upper,chunk.w,chunk.h);
    if(p.mode==='cutaway'&&chunk.lowObjects){this.ctx.save();this.ctx.beginPath();this.ctx.arc(circle.x,circle.y,circle.r,0,Math.PI*2);this.ctx.clip();this.ctx.drawImage(chunk.lowObjects,left,upper,chunk.w,chunk.h);this.ctx.restore();}
  }

  // Шаг 22: разведаны новые клетки — пересобрать фрагменты мелкого масштаба (с объектами), которые их задевают
  fogDirty(x0, y0, x1, y1) {
    const C = this.chunkSize;
    for (let cy = Math.floor(y0 / C); cy <= Math.floor(y1 / C); cy++) for (let cx = Math.floor(x0 / C); cx <= Math.floor(x1 / C); cx++) this.cache.delete(cx + ',' + cy);
  }

  terrainChanged() { this.gcache.clear(); this.gkey = ''; this.cache.clear(); this.cacheKey = ''; }

  // Шаг 20: ключ кэша земли — масштаб, плотность пикселей, карта и то, что меняет рисунок (качество у арт-рендера)
  groundKey() { return this.zoom.toFixed(4) + '|' + this.dpr + '|' + (this.map && this.map.seed) + '|' + (this.map && this.map.width) + '|' + (this.hiddenVer || 0); }

  // Земля готовыми фрагментами: каждый кадр — несколько drawImage вместо тысяч ромбов.
  // Новых фрагментов за кадр — не больше groundBuildsPerFrame, остальные пока рисуются напрямую.
  // Копия фрагмента карты только в пределах экрана: то же отображение (та же точка, тот же масштаб), но
  // источник обрезан по видимой части с запасом 2 пикселя (сглаживание у края берёт те же соседние пиксели).
  // Видимые пиксели те же; работы меньше — фрагмент 770×540…1026×514 обычно виден на четверть
  blitVisible(img, dx, dy, w, h) {
    const ctx = this.ctx, tr = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    const W = ctx.canvas && ctx.canvas.width, H = ctx.canvas && ctx.canvas.height;
    if (!tr || tr.b || tr.c || !(tr.a > 0) || !(tr.d > 0) || !W || !(w > 0) || !(h > 0)) return ctx.drawImage(img, dx, dy, w, h);
    const vx0 = Math.max(dx, -tr.e / tr.a), vy0 = Math.max(dy, -tr.f / tr.d);
    const vx1 = Math.min(dx + w, (W - tr.e) / tr.a), vy1 = Math.min(dy + h, (H - tr.f) / tr.d);
    if (vx1 <= vx0 || vy1 <= vy0) return; // целиком за экраном
    const kx = img.width / w, ky = img.height / h;
    const x0 = Math.max(0, Math.floor((vx0 - dx) * kx) - 2), y0 = Math.max(0, Math.floor((vy0 - dy) * ky) - 2);
    const x1 = Math.min(img.width, Math.ceil((vx1 - dx) * kx) + 2), y1 = Math.min(img.height, Math.ceil((vy1 - dy) * ky) + 2);
    if (x0 === 0 && y0 === 0 && x1 === img.width && y1 === img.height) return ctx.drawImage(img, dx, dy, w, h);
    ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, dx + x0 / kx, dy + y0 / ky, (x1 - x0) / kx, (y1 - y0) / ky);
  }

  drawGroundChunks(r, inView, time) {
    const C = this.chunkSize, { hw, hh } = this, ctx = this.ctx, dpr = this.dpr || 1;
    const key = this.groundKey();
    if (key !== this.gkey || this.gmap !== this.map) { this.gcache.clear(); this.gkey = key; this.gmap = this.map; }
    const cx0 = Math.floor(r.x0 / C), cx1 = Math.floor(r.x1 / C), cy0 = Math.floor(r.y0 / C), cy1 = Math.floor(r.y1 / C);
    let built = 0, n = 0, direct = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const top = this.toScreen(cx * C, cy * C);
        if (top.x + C * hw < 0 || top.x - C * hw > this.vw || top.y > this.vh || top.y + 2 * C * hh < 0) continue;
        const k = cx + ',' + cy;
        let ch = this.gcache.get(k);
        if (!ch && built < this.groundBuildsPerFrame) { ch = this.buildGroundChunk(cx, cy); built++; }
        if (ch) {
          this.gcache.delete(k); this.gcache.set(k, ch); // свежий — в конец (вытеснение старых)
          this.blitVisible(ch.canvas, Math.round((top.x - ch.ox) * dpr) / dpr, Math.round((top.y - ch.oy) * dpr) / dpr, ch.w, ch.h);
          n++;
        } else { // ещё не собран — этот кусок напрямую
          const x0 = Math.max(r.x0, cx * C), y0 = Math.max(r.y0, cy * C);
          direct += this.drawGround(ctx, x0, Math.min(r.x1, cx * C + C - 1), y0, Math.min(r.y1, cy * C + C - 1), (x, y) => this.toScreen(x, y), inView, time);
        }
      }
    }
    // вытеснение: не больше max(16 Мпикс, 3 экранов) в кэше
    const limit = Math.max(16e6, 3 * this.canvas.width * this.canvas.height);
    let px = 0;
    for (const ch of this.gcache.values()) px += ch.canvas.width * ch.canvas.height;
    while (px > limit && this.gcache.size > n) { const [k0, ch] = this.gcache.entries().next().value; px -= ch.canvas.width * ch.canvas.height; this.gcache.delete(k0); }
    this.lastStats.groundChunks = n; this.lastStats.groundBuilt = built; this.lastStats.tiles = direct; this.lastStats.cachedPx = px;
  }

  buildGroundChunk(cx, cy) {
    const C = this.chunkSize, { hw, hh } = this;
    const w = 2 * C * hw + 2, h = 2 * C * hh + 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * this.dpr); canvas.height = Math.ceil(h * this.dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(this.dpr, this.dpr);
    const ox = C * hw + 1, oy = 1, x0 = cx * C, y0 = cy * C;
    const x1 = Math.min(this.map.width, x0 + C) - 1, y1 = Math.min(this.map.height, y0 + C) - 1;
    this.drawGround(ctx, x0, x1, y0, y1, (x, y) => ({ x: (x - x0 - (y - y0)) * hw + ox, y: (x - x0 + (y - y0)) * hh + oy }), () => true, 0);
    const ch = { canvas, ox, oy, w, h };
    this.gcache.set(cx + ',' + cy, ch);
    return ch;
  }

  // Земля: по одному пути Path2D на цвет
  drawGround(ctx, x0, x1, y0, y1, toScr, inView, time) {
    const { hw, hh } = this;
    const map = this.map, W = map.width;
    const buckets = new Map();
    let count = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const s = toScr(x, y);
        if (!inView(s)) continue;
        const t = map.tiles[y * W + x];
        const key = t === G.B.CITY && this.cityRoadAt(x, y) ? 'city-road' : t;
        let p = buckets.get(key);
        if (!p) { p = new Path2D(); buckets.set(key, p); }
        // Биом рисуется единым цветовым полем: перекрытие субпиксельного края убирает швы.
        const bleed = Math.max(0.8, 1.25 / (this.dpr || 1));
        p.moveTo(s.x, s.y - bleed);
        p.lineTo(s.x + hw + bleed, s.y + hh);
        p.lineTo(s.x, s.y + 2 * hh + bleed);
        p.lineTo(s.x - hw - bleed, s.y + hh);
        p.closePath();
        count++;
      }
    }
    for (const [key, p] of buckets) {
      ctx.fillStyle = key === 'city-road' ? '#454644' : G.BIOMES[key]?.color || '#55534d';
      ctx.fill(p);
    }
    return count;
  }

  // Крупный масштаб: каждый кадр заново (анимация воды, герой среди объектов)
  drawDirect(r, scene, time) {
    const ctx = this.ctx;
    const { hw, hh } = this;
    const map = this.map, W = map.width;
    const inView = (s) => s.x > -hw * 2 && s.x < this.vw + hw * 2 && s.y > -hh * 8 && s.y < this.vh + hh * 24;
    if (this.groundCache) this.drawGroundChunks(r, inView, time);
    else this.lastStats.tiles = this.drawGround(ctx, r.x0, r.x1, r.y0, r.y1, (x, y) => this.toScreen(x, y), inView, time);

    // --- объекты: по диагоналям x+y (дальние раньше); фигуры и предметы — на своих диагоналях,
    // чтобы деревья и горы перекрывали их правильно ---
    const labels = [];
    if(scene.groundEffects)scene.groundEffects(this,time);
    const dl = this.depthList(scene, time);
    const byDiag = (list) => { const m = new Map(); for (const o of list) { if (!m.has(o.d)) m.set(o.d, []); m.get(o.d).push(o); } return m; };
    const figsBy = byDiag(dl.figs), flatBy = byDiag(dl.flat);
    const done = new Set();
    const markers = scene.markers; // Map "x,y" -> marker
    for (let d = r.x0 + r.y0; d <= r.x1 + r.y1; d++) {
      for (let x = Math.max(r.x0, d - r.y1); x <= Math.min(r.x1, d - r.y0); x++) {
        const y = d - x;
        const s = this.toScreen(x, y);
        if (!inView(s)) continue;
        if (this.fog && !this.fog.known(x, y)) continue; // не разведано (шаг 22)
        if (!(this.hidden && this.hidden.has(y * W + x))) this.drawObstacle(x+0.5,y+0.5,()=>this.drawObject(map.tiles[y * W + x], x, y, s),'tile');
        const m = markers.get(x + ',' + y);
        if (m) { this.drawMarkerView(m,s); labels.push([m,s]); }
      }
      for (const f of flatBy.get(d) || []) { f.fn(); done.add(f); }
      for (const f of figsBy.get(d) || []) { this.drawFigure(f); done.add(f); }
    }
    for (const f of dl.flat) if (!done.has(f)) f.fn();
    for (const f of dl.figs) if (!done.has(f)) this.drawFigure(f);
    this.drawLabels(labels, scene.hero, scene.others);
  }

  beginVisibility(scene,time){
    this.visibilityPrefs=sceneryView();this.visibilityHero=scene.hero;
    const range=Number(scene.visibilityRange);this.visibilityRange=Number.isFinite(range)&&range>0?range:1;
    this.visibilityDt=Math.min(100,Math.max(0,time-(this.visibilityLast??time-16)));this.visibilityLast=time;
    if(this.visibilityMap!==this.map){this.visibilityMap=this.map;this.revealRadius=0;}
    this.revealRadius=(this.revealRadius||0)+(this.visibilityRange-(this.revealRadius||0))*(1-Math.exp(-this.visibilityDt/180));
  }
  drawMarkerView(marker,screen){
    const position=this.toWorld(screen.x,screen.y);
    if(['settlement','depot','lair'].includes(marker.kind))this.drawObstacle(position.x+0.5,position.y+0.5,()=>this.drawMarker(marker,screen),'marker');
    else this.drawMarker(marker,screen);
  }
  visibilityCircle(){
    const hero=this.visibilityHero;if(!hero)return null;
    const center=this.toScreen(hero.x,hero.y);
    // A circular screen section of a sphere, centered at the hero's body.
    return {x:center.x,y:center.y-this.hh*1.4,r:Math.max(1,(this.revealRadius||this.visibilityRange||1)*this.hw)};
  }
  clipLow(x,y,draw){
    const ground=this.toScreen(x,y);this.ctx.save();this.ctx.beginPath();
    this.ctx.rect(ground.x-this.hw*5,ground.y-this.hh*0.22,this.hw*10,this.hh*1.3);this.ctx.clip();
    try{draw();}finally{this.ctx.restore();}
  }
  drawObstacle(x,y,draw,kind='building'){
    if(kind==='tile'){
      const b=G.BIOMES[this.map.tiles[Math.floor(y)*this.map.width+Math.floor(x)]];
      if(!b){draw();return;}
    }
    const p=this.visibilityPrefs||sceneryView();
    if(p.mode==='solid'){draw();return;}
    if(p.mode==='low'){this.clipLow(x,y,draw);return;}
    const circle=this.visibilityCircle();if(!circle){draw();return;}
    const ground=this.toScreen(x,y);
    if(ground.x+this.hw*5<circle.x-circle.r||ground.x-this.hw*5>circle.x+circle.r||ground.y<circle.y-circle.r||ground.y-this.hh*24>circle.y+circle.r){draw();return;}
    const ctx=this.ctx;ctx.save();ctx.beginPath();ctx.rect(-1,-1,this.vw+2,this.vh+2);ctx.moveTo(circle.x+circle.r,circle.y);ctx.arc(circle.x,circle.y,circle.r,0,Math.PI*2);ctx.clip('evenodd');
    try{draw();}finally{ctx.restore();}
    ctx.save();ctx.beginPath();ctx.arc(circle.x,circle.y,circle.r,0,Math.PI*2);ctx.clip();
    try{if(p.mode==='transparent'){ctx.globalAlpha*=p.opacity;draw();}else this.clipLow(x,y,draw);}finally{ctx.restore();}
  }

  // Подписи поверх всего
  drawLabels(labels, hero, others = []) {
    const ctx = this.ctx, { hh } = this;
    ctx.textAlign = 'center';
    ctx.font = `${Math.max(11, 13 * Math.min(1.3, this.zoom)) * textScale()}px Segoe UI, Arial, sans-serif`;
    for (const [m, s] of labels) {
      if (this.zoom < 0.6 && m.kind !== 'settlement') continue;
      this.label(m.label, s.x, s.y - hh * (m.kind === 'settlement' ? 3.2 : 2.2), m.kind === 'lair' ? '#ff9a7a' : m.kind === 'depot' ? '#e0d070' : m.kind === 'portal' ? '#ffd84a' : '#f3e4c4');
    }
    for (const o of others) { // имена других игроков (администратор — со значком)
      const os = this.toScreen(o.x, o.y);
      if (os.x < -100 || os.x > this.vw + 100 || os.y < -50 || os.y > this.vh + 100) continue;
      this.label((o.vc ? '🔊 ' : '') + (o.admin ? '🛡 ' : '') + o.name, os.x, os.y - hh * 3.6 - 6, o.admin ? '#ffb36b' : '#8fdcff'); // 🔊 — говорит (голосовой чат)
    }
    const hs = this.toScreen(hero.x, hero.y);
    this.label((hero.vc ? '🔊 ' : '') + hero.name, hs.x, hs.y - hh * 3.6 - 6, '#ffd27a');
  }

  label(text, x, y, color) {
    const ctx = this.ctx;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  propAt(x, y) {
    const m = this.map;
    if (!m.__propIndex) m.__propIndex = new Map((m.props || []).map((p) => [p.y * m.width + p.x, p]));
    return m.__propIndex.get(y * m.width + x) || null;
  }

  drawObject(t, x, y, s) {
    const ctx = this.ctx, { hw, hh } = this;
    const cx = s.x, cy = s.y + hh; // центр ромба
    const rnd = this.rand(x, y, 11);
    const B = G.B;
    // Дома с интерьерами (shared/houses.js): фасад — по числу этажей; мебель этажа дома (lv.props)
    const house = !this.map.level && window.Houses ? window.Houses.at(this.map, x, y) : null;
    const furn = this.map.level && this.map.props ? this.propAt(x, y) : null;
    if(!house&&window.Houses?.covering?.(this.map,x,y))return;
    if (house || furn) {
      const cacheKey = `${this.hw}|${this.dpr}`;
      if (this.sceneryKey !== cacheKey) { this.sceneryKey = cacheKey; this.sceneryCache = new Map(); }
      const id = house ? `house:${house.style}:${house.floors}:${house.basement ? 1 : 0}:${house.condition || 'intact'}:${Math.floor(house.variant * 6)}:${house.footprint?.w}:${house.footprint?.h}` : `furn:${furn.key}:${Math.floor(rnd * 4)}`;
      let sprite = this.sceneryCache.get(id);
      if (!sprite) {
        const canvas = document.createElement('canvas'),plan=house?.footprint||{w:1,h:1},w=this.hw*(house?plan.w+plan.h+4:6)+4,h=this.hh*(house?plan.w+plan.h+house.floors*6+12:20)+4,ox=w/2,oy=h-this.hh*(house?(plan.w+plan.h)/2+2:1.2);
        canvas.width = Math.ceil(w * this.dpr); canvas.height = Math.ceil(h * this.dpr);
        const c = canvas.getContext('2d', { willReadFrequently: true }); c.scale(this.dpr, this.dpr);
        if (house) drawHouse(c, { ...house, heading:Math.PI/2, footprint:house.footprint, variant: (Math.floor(house.variant * 6) + 0.5) / 6 }, ox, oy, this.hh * 1.1);
        else drawFurniture(c, furn.key, ox, oy, this.hh * 1.6, (Math.floor(rnd * 4) + 0.5) / 4);
        sprite = trimSprite({ canvas, w, h, ox, oy }); this.sceneryCache.set(id, sprite);if(this.sceneryCache.size>48)this.sceneryCache.delete(this.sceneryCache.keys().next().value); // без пустых полей (sprite-memo.js)
      }
      ctx.drawImage(sprite.canvas, cx - sprite.ox, cy - sprite.oy, sprite.w, sprite.h);
      return;
    }
    if (t === B.CITY && this.cityRoadAt(x, y)) return;
    // руины города между домами — обломки и брошенные машины (пустых «коробок» без входа больше нет)
    const key = t === B.FOREST ? (rnd < 0.5 ? 'tree_pine' : 'tree_oak') : t === B.MOUNTAIN ? 'peak' : t === B.HILLS ? 'mound' : t === B.CITY ? (rnd < 0.035 ? 'ruin_block' : rnd < 0.13 ? 'rubble' : rnd < 0.15 ? 'rusted_car' : null) : t === B.WALL ? 'wall_block' : null;
    if (key) {
      const cacheKey = `${this.hw}|${this.dpr}`;
      if (this.sceneryKey !== cacheKey) { this.sceneryKey = cacheKey; this.sceneryCache = new Map(); }
      const variation = Math.min(7, Math.floor(rnd * 8)), id = key + ':' + variation;
      let sprite = this.sceneryCache.get(id);
      if (!sprite) {
        const canvas = document.createElement('canvas'), w = this.hw * 6 + 4, h = this.hh * 20 + 4, ox = w / 2, oy = h - this.hh * 1.2;
        canvas.width = Math.ceil(w * this.dpr); canvas.height = Math.ceil(h * this.dpr);
        const c = canvas.getContext('2d', { willReadFrequently: true }); c.scale(this.dpr, this.dpr);
        drawScenery(c, key, ox, oy, this.hh * 1.1, (variation + 0.5) / 8);
        sprite = trimSprite({ canvas, w, h, ox, oy }); this.sceneryCache.set(id, sprite); // без пустых полей (sprite-memo.js)
      }
      ctx.drawImage(sprite.canvas, cx - sprite.ox, cy - sprite.oy, sprite.w, sprite.h);
      return;
    }
    if (t === B.FOREST) {
      const n = rnd < 0.35 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const ox = (this.rand(x, y, 20 + i) - 0.5) * hw, oy = (this.rand(x, y, 30 + i) - 0.5) * hh * 0.8;
        const h = hh * (1.6 + this.rand(x, y, 40 + i) * 0.9);
        ctx.fillStyle = '#4a3322';
        ctx.fillRect(cx + ox - hw * 0.04, cy + oy - h * 0.35, hw * 0.08, h * 0.35);
        ctx.beginPath();
        ctx.moveTo(cx + ox, cy + oy - h);
        ctx.lineTo(cx + ox + hw * 0.3, cy + oy - h * 0.25);
        ctx.lineTo(cx + ox - hw * 0.3, cy + oy - h * 0.25);
        ctx.closePath();
        ctx.fillStyle = rnd < 0.5 ? '#2d4a22' : '#35522a';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx + ox, cy + oy - h);
        ctx.lineTo(cx + ox + hw * 0.3, cy + oy - h * 0.25);
        ctx.lineTo(cx + ox, cy + oy - h * 0.3);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fill();
      }
    } else if (t === B.MOUNTAIN) {
      const h = hh * (2.2 + rnd * 2.2);
      const px = cx + (this.rand(x, y, 12) - 0.5) * hw * 0.3;
      ctx.beginPath(); ctx.moveTo(cx - hw, cy); ctx.lineTo(px, cy - h); ctx.lineTo(cx, cy + hh); ctx.closePath();
      ctx.fillStyle = '#9b958e'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx + hw, cy); ctx.lineTo(px, cy - h); ctx.lineTo(cx, cy + hh); ctx.closePath();
      ctx.fillStyle = '#6c6761'; ctx.fill();
      if (rnd > 0.45) { // снег
        ctx.beginPath(); ctx.moveTo(px, cy - h); ctx.lineTo(px - hw * 0.28, cy - h * 0.62); ctx.lineTo(px + hw * 0.25, cy - h * 0.6); ctx.closePath();
        ctx.fillStyle = '#e9ecef'; ctx.fill();
      }
    } else if (t === B.HILLS) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, hw * 0.7, hh * (0.55 + rnd * 0.4), 0, Math.PI, 0);
      ctx.fillStyle = 'rgba(60,45,30,0.35)';
      ctx.fill();
    } else if (t === B.CITY) {
      if (rnd < 0.4) { // обломки
        ctx.fillStyle = '#55524c';
        for (let i = 0; i < 3; i++) ctx.fillRect(cx + (this.rand(x, y, 50 + i) - 0.5) * hw, cy + (this.rand(x, y, 60 + i) - 0.5) * hh, hw * 0.15, hh * 0.15);
        return;
      }
      const h = hh * (0.8 + (rnd - 0.4) * 4.5);
      const w = 0.62;
      const top = (dx, dy) => [cx + dx * hw * w, cy + dy * hh * w - h];
      // левая грань
      ctx.beginPath();
      ctx.moveTo(cx - hw * w, cy); ctx.lineTo(cx, cy + hh * w); ctx.lineTo(cx, cy + hh * w - h); ctx.lineTo(cx - hw * w, cy - h); ctx.closePath();
      ctx.fillStyle = '#6f6a62'; ctx.fill();
      // правая грань
      ctx.beginPath();
      ctx.moveTo(cx + hw * w, cy); ctx.lineTo(cx, cy + hh * w); ctx.lineTo(cx, cy + hh * w - h); ctx.lineTo(cx + hw * w, cy - h); ctx.closePath();
      ctx.fillStyle = '#4f4b45'; ctx.fill();
      // крыша (с «выбитым» углом)
      ctx.beginPath();
      ctx.moveTo(...top(0, -1)); ctx.lineTo(...top(1, 0)); ctx.lineTo(...top(0, 1)); ctx.lineTo(...top(-1, 0)); ctx.closePath();
      ctx.fillStyle = '#86807a'; ctx.fill();
      if (this.zoom >= 0.6) { // окна
        ctx.fillStyle = 'rgba(20,20,25,0.7)';
        const floors = Math.max(1, Math.floor(h / (hh * 0.7)));
        for (let f = 0; f < floors; f++) {
          const fy = cy - h + hh * 0.45 + f * hh * 0.7;
          ctx.fillRect(cx - hw * w * 0.7, fy, hw * 0.1, hh * 0.22);
          ctx.fillRect(cx - hw * w * 0.35, fy + hh * 0.18, hw * 0.1, hh * 0.22);
          ctx.fillRect(cx + hw * w * 0.3, fy + hh * 0.18, hw * 0.1, hh * 0.22);
        }
      }
    } else if (this.zoom >= 0.5 && (t === B.DESERT || t === B.WASTE) && rnd < 0.06) {
      ctx.fillStyle = t === B.DESERT ? '#8c7a45' : '#5b513d';
      ctx.beginPath(); ctx.ellipse(cx, cy, hw * 0.12, hh * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawMarker(m, s) {
    const ctx = this.ctx, { hw, hh } = this;
    const cx = s.x, cy = s.y + hh;
    if (m.kind === 'settlement') {
      // домик с флагом
      ctx.fillStyle = '#7b5a3a';
      ctx.fillRect(cx - hw * 0.35, cy - hh * 1.1, hw * 0.7, hh * 1.1);
      ctx.beginPath(); ctx.moveTo(cx - hw * 0.45, cy - hh * 1.1); ctx.lineTo(cx, cy - hh * 2); ctx.lineTo(cx + hw * 0.45, cy - hh * 1.1); ctx.closePath();
      ctx.fillStyle = '#a33b2a'; ctx.fill();
      ctx.fillStyle = '#2a1d12';
      ctx.fillRect(cx - hw * 0.08, cy - hh * 0.6, hw * 0.16, hh * 0.6);
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx + hw * 0.3, cy - hh * 1.4); ctx.lineTo(cx + hw * 0.3, cy - hh * 2.6); ctx.stroke();
      ctx.fillStyle = '#e0b040'; ctx.fillRect(cx + hw * 0.3, cy - hh * 2.6, hw * 0.25, hh * 0.35);
    } else if (m.kind === 'depot') {
      // военный склад: ящик цвета хаки с жёлтой полосой
      ctx.fillStyle = '#4a5238'; ctx.fillRect(cx - hw * 0.4, cy - hh * 1.2, hw * 0.8, hh * 1.1);
      ctx.fillStyle = '#e0c040'; ctx.fillRect(cx - hw * 0.4, cy - hh * 0.8, hw * 0.8, hh * 0.18);
      ctx.strokeStyle = '#23281a'; ctx.lineWidth = 1.5; ctx.strokeRect(cx - hw * 0.4, cy - hh * 1.2, hw * 0.8, hh * 1.1);
    } else if (m.kind === 'portal') {
      // вход/выход вертикального уровня (шаг 13): вид по m.pk
      const pk = m.pk;
      if (pk === 'dive') {
        ctx.strokeStyle = '#bff0ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(cx, cy - hh * 0.3, hw * 0.4, hh * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx, cy - hh * 0.3, hw * 0.2, hh * 0.17, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (pk === 'cave') {
        ctx.beginPath(); ctx.ellipse(cx, cy - hh * 0.2, hw * 0.4, hh * 0.55, 0, Math.PI, 0); ctx.fillStyle = '#120d0a'; ctx.fill();
      } else if (pk === 'hatch' || pk === 'elevator' || pk === 'metal_hatch') {
        ctx.fillStyle = pk === 'elevator' ? '#5a5a62' : '#3a3f36'; ctx.fillRect(cx - hw * 0.3, cy - hh * 0.75, hw * 0.6, hh * 0.6);
        ctx.strokeStyle = '#d8c070'; ctx.lineWidth = 1.5; ctx.strokeRect(cx - hw * 0.3, cy - hh * 0.75, hw * 0.6, hh * 0.6);
      } else if (pk === 'vertical_ladder' || pk === 'rope_ladder') {
        ctx.strokeStyle = pk === 'rope_ladder' ? '#a97845' : '#b19a70'; ctx.lineWidth = Math.max(1.5, hw * 0.07); ctx.lineCap = 'round';
        for (const side of [-1,1]) { ctx.beginPath(); ctx.moveTo(cx + side * hw * 0.22, cy - hh * 0.1); ctx.lineTo(cx + side * hw * 0.22, cy - hh * 1.0); ctx.stroke(); }
        for (let i=0;i<4;i++){const yy=cy-hh*(0.2+i*0.2);ctx.beginPath();ctx.moveTo(cx-hw*0.23,yy);ctx.lineTo(cx+hw*0.23,yy);ctx.stroke();}
      } else if (pk === 'jump') {
        ctx.fillStyle = '#e05a3a'; ctx.beginPath(); ctx.moveTo(cx - hw * 0.25, cy - hh * 0.9); ctx.lineTo(cx + hw * 0.25, cy - hh * 0.9); ctx.lineTo(cx, cy - hh * 0.2); ctx.closePath(); ctx.fill();
      } else if (pk === 'ramp' || pk === 'stone_ramp') {
        ctx.fillStyle = '#5b4937'; ctx.beginPath(); ctx.moveTo(cx-hw*0.36,cy-hh*0.65); ctx.lineTo(cx+hw*0.36,cy-hh*0.65); ctx.lineTo(cx+hw*0.3,cy-hh*0.05); ctx.lineTo(cx-hw*0.3,cy-hh*0.05); ctx.closePath(); ctx.fill();
        ctx.strokeStyle='#b39a70';ctx.lineWidth=1.5;for(let i=0;i<3;i++){const yy=cy-hh*(0.52-i*0.15);ctx.beginPath();ctx.moveTo(cx-hw*0.27,yy);ctx.lineTo(cx+hw*0.27,yy);ctx.stroke();}
      } else { // лестницы, тропа: ступени
        ctx.fillStyle = pk === 'down' || pk === 'stairs' ? '#2a2420' : '#c8a060';
        for (let i = 0; i < 3; i++) ctx.fillRect(cx - hw * (0.35 - i * 0.08), cy - hh * (0.35 + i * 0.3), hw * (0.7 - i * 0.16), hh * 0.22);
      }
    } else if (m.kind === 'lair') {
      ctx.beginPath(); ctx.ellipse(cx, cy - hh * 0.2, hw * 0.35, hh * 0.45, 0, Math.PI, 0); ctx.fillStyle = '#1a1210'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx - hw * 0.08, cy - hh * 0.35, 2, 0, Math.PI * 2); ctx.arc(cx + hw * 0.08, cy - hh * 0.35, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4a2a'; ctx.fill();
    }
  }

  drawTarget(target, time) {
    if (!target) return;
    const s = this.toScreen(target.x + 0.5, target.y + 0.5);
    const k = 1 + Math.sin(time / 150) * 0.12;
    this.ctx.strokeStyle = '#ffd27a';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.ellipse(s.x, s.y, this.hw * 0.45 * k, this.hh * 0.45 * k, 0, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  // Предмет на земле: иконка с тенью и лёгким покачиванием
  drawGroundItem(g, time) {
    const it = Items.get(g.id);
    if (!it) return;
    const ctx = this.ctx;
    const s = this.toScreen(g.x, g.y);
    const size = Math.max(12, this.hh * 1.1);
    const lift = Math.sin(time / 400 + g.x * 3) * size * 0.06;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, size * 0.42, size * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(iconCanvas(it, 48), s.x - size / 2, s.y - size * 0.95 + lift, size, size);
  }

  // Подписи предметов рядом с героем
  drawGroundLabels(ground, hero, range) {
    if (!ground || this.zoom < 0.6) return;
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.font = `${Math.max(10, 11 * Math.min(1.3, this.zoom)) * textScale()}px Segoe UI, Arial, sans-serif`;
    for (const g of ground) {
      if (Math.hypot(g.x - hero.x, g.y - hero.y) > range) continue;
      const it = Items.get(g.id);
      if (!it) continue;
      const s = this.toScreen(g.x, g.y);
      this.label(it.name + (g.n > 1 ? ` × ${g.n}` : ''), s.x, s.y - this.hh * 1.3 - 4, Items.RARITIES[it.rarity].color);
    }
  }

  // Враг: рисунок по данным бестиария; мёртвый — тает
  drawEnemyFig(e, time) {
    const s = this.actorToScreen(e);
    if (s.x < -200 || s.x > this.vw + 200 || s.y < -200 || s.y > this.vh + 300) return;
    if (e.ring) { // цель атаки — красное кольцо, под курсором — светлое
      const k = e.ring === 'target' ? 1 + Math.sin(time / 150) * 0.08 : 1, rr = Math.max(0.5, (e.def.radius || 0.4) * 1.6) * (e.look.size || 1);
      this.ctx.strokeStyle = e.ring === 'target' ? '#ff4a3a' : 'rgba(255,230,200,0.8)';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath(); this.ctx.ellipse(s.x, s.y, this.hw * rr * k, this.hh * rr * k, 0, 0, Math.PI * 2); this.ctx.stroke();
    }
    e.swim = swimModeAt(this.map, e); // плавание и ныряние (swim-art.js)
    const u = this.hh * 0.9; // спрайт фигуры: перерисовка только при смене облика или позы (figure-memo.js)
    memoFigure(this.ctx, e, s.x, s.y, u, time, actorPose(e, time), (c, x, y, t, pose) => drawEnemy(c, e, x, y, u, t, pose));
  }

  // Мина или ловушка: плоский значок; взведённая мигает красным огоньком
  drawTrap(t, time) {
    const it = Items.get(t.item);
    if (!it) return;
    const ctx = this.ctx, s = this.toScreen(t.x, t.y), size = Math.max(10, this.hh * 0.8);
    ctx.save();
    ctx.globalAlpha = t.mine ? 0.95 : 0.6;
    ctx.drawImage(iconCanvas(it, 48), s.x - size / 2, s.y - size * 0.6, size, size);
    ctx.restore();
    if (t.armed && Math.floor(time / 400) % 2 === 0) {
      ctx.fillStyle = '#ff3b2f';
      ctx.beginPath(); ctx.arc(s.x, s.y - size * 0.2, Math.max(2, size * 0.09), 0, Math.PI * 2); ctx.fill();
    }
  }

  // Турель: тренога и значок оружия сверху
  drawTurret(t, time) {
    const it = Items.get(t.item);
    const ctx = this.ctx, s = this.toScreen(t.x, t.y), u = this.hh * 0.9;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, u * 0.6, u * 0.26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#4a5058'; ctx.lineWidth = Math.max(2, u * 0.12); ctx.lineCap = 'round';
    for (const k of [-1, 0, 1]) { ctx.beginPath(); ctx.moveTo(s.x, s.y - u * 1.1); ctx.lineTo(s.x + k * u * 0.5, s.y + (k ? 0 : u * 0.1)); ctx.stroke(); }
    if (it) ctx.drawImage(iconCanvas(it, 48), s.x - u * 0.7, s.y - u * 2.1, u * 1.4, u * 1.4);
    if (t.flash && t.flash > time) { ctx.fillStyle = '#ffd35a'; ctx.beginPath(); ctx.arc(s.x + u * 0.6, s.y - u * 1.5, u * 0.18, 0, Math.PI * 2); ctx.fill(); }
    if (t.flashUntil > time) { ctx.fillStyle = 'rgba(255,80,60,0.35)'; ctx.fillRect(s.x - u * 0.7, s.y - u * 2.1, u * 1.4, u * 1.4); }
    if (t.tier > 1) { // звёзды уровня улучшения
      ctx.fillStyle = '#ffd84a'; ctx.font = `${Math.round(u * 0.45)}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('★'.repeat(t.tier - 1), s.x, s.y - u * 2.2);
    }
    if (t.maxHp && t.hp < t.maxHp) { // полоска здоровья, если турель ранена
      const w = u * 1.4, y = s.y - u * (t.tier > 1 ? 2.75 : 2.3);
      ctx.fillStyle = '#000a'; ctx.fillRect(s.x - w / 2, y, w, 4);
      ctx.fillStyle = t.hp / t.maxHp > 0.35 ? '#7bd35a' : '#e0503a'; ctx.fillRect(s.x - w / 2, y, (w * Math.max(0, t.hp)) / t.maxHp, 4);
    }
  }

  // Герой: простая фигура в цветах персонажа (кожа, волосы, бельё) и надетых вещей (hero.look)
  // Павший герой полупрозрачен, раненый — вспыхивает
  drawHero(hero, time) {
    if (hero.dead) return; // лежащий герой рисуется отдельным серверным трупом
    if (hero.vehicleHidden) return;
    const ctx = this.ctx;
    const dead = hero.dead, flash = hero.flashUntil && hero.flashUntil > time;
    const invisible = hero.look && hero.look.invisible;
    if (!dead && !flash && !invisible) return this.drawHeroBody(hero, time);
    ctx.save();
    if (dead) ctx.globalAlpha = 0.35;
    else if (invisible) ctx.globalAlpha *= 0.42;
    if (flash) ctx.filter = 'brightness(1.2)';
    this.drawHeroBody(hero, time);
    ctx.restore();
  }

  drawHeroBody(hero, time) {
    const s = this.actorToScreen(hero);
    hero.swim = hero.buildElevation ? null : swimModeAt(this.map, hero); // герои и жители тоже плавают и ныряют
    const u = this.hh * 0.9, y = s.y - (hero.buildElevation ? this.hh * 4 : 0), m = Math.max(200, this.hh * 10);
    if (s.x < -m || s.x > this.vw + m || y < -m || y > this.vh + m) return; // за краем экрана не рисуем
    memoFigure(this.ctx, hero, s.x, y, u, time, actorPose(hero, time), (c, x, yy, t, pose) => drawHumanoid(c, hero, x, yy, u, t, pose));
  }
}

// Миникарта: 1 пиксель на клетку, рисуется один раз
export function renderMinimapImage(map) {
  const c = document.createElement('canvas');
  c.width = map.width; c.height = map.height;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(map.width, map.height);
  const rgb = G.BIOMES.map((b) => { const n = parseInt(b.color.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
  for (let i = 0; i < map.tiles.length; i++) {
    const [r, g, b] = rgb[map.tiles[i]];
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
