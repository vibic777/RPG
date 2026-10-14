import { drawSurfaces } from './mesh-surface.js';
import { attachmentSurface } from './mesh-attachments.js';
// Объёмные модели в метрах: скруглённые поверхности, плавные нормали и буфер глубины.
// Canvas-сортировка остаётся запасным способом для сред без WebGL.
// Оси модели: x — поперёк (борт), y — вперёд (нос), z — вверх. Проекция совпадает с isoRig (figure-art.js):
// 1 м = 3,3 / 1,75 единицы фигуры (герой ростом 1,75 м), так что техника и люди в одном масштабе.
import { tone, isoRig } from './figure-art.js';

export const M_TO_UNIT = 3.3 / 1.75;
const TAU = Math.PI * 2;
// Направление на зрителя в мировых осях (wx, wy, z): точки вдоль него проецируются в одну точку экрана
const VIEW = norm([1, 1, 0.78]);
// Свет сверху-слева-спереди (как у остальной графики)
const LIGHT = norm([-0.25, 0.65, 1]);

function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// Матрица 3×4: [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz]
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const apply = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
function mul(a, b) { // a ∘ b
  const r = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j];
    r[i * 4 + 3] = a[i * 4] * b[3] + a[i * 4 + 1] * b[7] + a[i * 4 + 2] * b[11] + a[i * 4 + 3];
  }
  return r;
}
// Поворот вокруг оси через точку: 'z' — рыскание (θ: вперёд → (sin θ, cos θ)), 'x' — тангаж/качение колёс, 'y' — крен
export function rotAt(axis, angle, p = [0, 0, 0]) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const r = axis === 'z' ? [c, s, 0, -s, c, 0, 0, 0, 1] : axis === 'x' ? [1, 0, 0, 0, c, -s, 0, s, c] : [c, 0, s, 0, 1, 0, -s, 0, c];
  const m = [r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0];
  const t = apply(m, p);
  m[3] = p[0] - t[0]; m[7] = p[1] - t[1]; m[11] = p[2] - t[2];
  return m;
}
export function scaleAt(sx, sy, sz, p = [0, 0, 0]) {
  return [sx, 0, 0, p[0] * (1 - sx), 0, sy, 0, p[1] * (1 - sy), 0, 0, sz, p[2] * (1 - sz)];
}

// Сборщик сцены одной модели. q — уровень детализации 0 (низкий) … 2 (высокий)
export function meshRig(ctx, x, y, unit, heading, q = 1, style = 'metal', scale = [1,1,1]) {
  const u = unit * M_TO_UNIT, ca = Math.cos(heading), sa = Math.sin(heading);
  const toWorld = (p) => [-sa * p[0] + ca * p[1], ca * p[0] + sa * p[1], p[2]];
  const project = (p) => { const w = toWorld(p); return [x + (w[0] - w[1]) * u * 0.78, y + (w[0] + w[1]) * u * 0.39 - w[2] * u]; };
  const faces = [];
  const organic = style === 'anime' ? isoRig(ctx,x,y,u,heading) : null;
  let M = scaleAt(...scale), extraBias = 0, nested = 0;
  // Выпуклое тело: вершины + грани (индексы); нормаль граней — от центра тела наружу
  function solid(verts, polys, color, o = {}) {
    const vs = verts.map((p) => apply(M, p));
    const c = [0, 0, 0];
    for (const p of vs) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    c[0] /= vs.length; c[1] /= vs.length; c[2] /= vs.length;
    if(organic){const col=Array.isArray(color)?color[0]:typeof color==='function'?color(0,[0,0,1]):color;faces.push({organic:true,pts:vs,fc:c,col,o});return;}
    const faceStart=faces.length;
    polys.forEach((idx, k) => {
      const pts = idx.map((i) => vs[i]);
      let n = [0, 0, 0];
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); }
      n = norm(n);
      const fc = [0, 0, 0];
      for (const p of pts) { fc[0] += p[0]; fc[1] += p[1]; fc[2] += p[2]; }
      fc[0] /= pts.length; fc[1] /= pts.length; fc[2] /= pts.length;
      if (dot(n, sub(fc, c)) < 0) n = [-n[0], -n[1], -n[2]];
      const col = Array.isArray(color) ? color[k % color.length] : typeof color === 'function' ? color(k, n) : color;
      faces.push({ pts, n, fc, col, o: extraBias ? { ...o, bias: ((o && o.bias) || 0) + extraBias } : o, sub: nested > 0 });
    });
    if(o.smooth){
      const normals=vs.map(()=>[0,0,0]);
      polys.forEach((idx,k)=>{for(const i of idx)for(let a=0;a<3;a++)normals[i][a]+=faces[faceStart+k].n[a];});
      polys.forEach((idx,k)=>{faces[faceStart+k].normals=idx.map(i=>norm(normals[i]));});
    }
  }
  const rounded=(poly,r,steps=4)=>poly.flatMap((p,i)=>{
    const prev=poly[(i+poly.length-1)%poly.length],next=poly[(i+1)%poly.length],a=sub([prev[0],prev[1],0],[p[0],p[1],0]),b=sub([next[0],next[1],0],[p[0],p[1],0]);
    const d=Math.min(r,Math.hypot(...a)*.3,Math.hypot(...b)*.3),na=norm(a),nb=norm(b),start=[p[0]+na[0]*d,p[1]+na[1]*d],end=[p[0]+nb[0]*d,p[1]+nb[1]*d];
    return Array.from({length:steps+1},(_,k)=>{const t=k/steps,v=1-t;return[v*v*start[0]+2*v*t*p[0]+t*t*end[0],v*v*start[1]+2*v*t*p[1]+t*t*end[1]];});
  });
  const api = {
    project, q, unit: u, finish: style,
    attachments: [],
    attachmentSurface:options=>attachmentSurface(faces,options),
    // Точка модели с учётом текущих поворотов (дуло повёрнутой башни)
    at: (p) => apply(M, p),
    // Повернуть / сдвинуть всё, что нарисует fn
    // bias — поднять в порядке рисования (башня поверх корпуса)
    with(m, fn, bias = 0) { const old = M, ob = extraBias; M = mul(M, m); extraBias += bias; nested++; try { fn(); } finally { M = old; extraBias = ob; nested--; } },
    // Параллелепипед: центр основания (cx, cy, z), размеры
    box(cx, cy, z, w, l, h, color, o) {
      const bevel=Math.min(Math.abs(w),Math.abs(l),Math.abs(h))*.16;
      if(!organic && bevel*u>.7 && w>0 && l>0 && h>0){
        const profiles=[[z,w-bevel*2,l-bevel*2],[z+bevel,w,l],[z+h-bevel,w,l],[z+h,w-bevel*2,l-bevel*2]];
        const rings=profiles.map(([zz,ww,ll])=>rounded([[-ww/2,-ll/2],[ww/2,-ll/2],[ww/2,ll/2],[-ww/2,ll/2]],bevel,q===0?2:4).map(([xx,yy])=>[cx+xx,cy+yy,zz]));
        const n=rings[0].length,polys=[Array.from({length:n},(_,i)=>i),Array.from({length:n},(_,i)=>3*n+i)];
        for(let k=0;k<3;k++)for(let i=0;i<n;i++)polys.push([k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i]);
        solid(rings.flat(),polys,color,{...o,smooth:true,noEdge:true});return;
      }
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - l / 2, y1 = cy + l / 2, z1 = z + h;
      solid([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
        [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], color, o);
    },
    // Профиль в плоскости (y, z), вытянутый поперёк от x0 до x1 (корпуса, гусеницы)
    prismX(profile, x0, x1, color, o) {
      if(!organic&&Math.abs(x1-x0)*u>5) {profile=rounded(profile,.12,q===0?2:5);o={...o,smooth:true,noEdge:true};}
      const n = profile.length, v = [...profile.map(([py, pz]) => [x0, py, pz]), ...profile.map(([py, pz]) => [x1, py, pz])];
      const polys = [profile.map((_, i) => i), profile.map((_, i) => n + i)];
      for (let i = 0; i < n; i++) polys.push([i, (i + 1) % n, n + (i + 1) % n, n + i]);
      solid(v, polys, color, o);
    },
    // Многоугольник в плане (x, y), вытянутый вверх от z0 до z1; top — сжатие верха к центру (скосы башни)
    prismZ(plan, z0, z1, color, top = 1, o) {
      const n = plan.length, cx = plan.reduce((s, p) => s + p[0], 0) / n, cy = plan.reduce((s, p) => s + p[1], 0) / n;
      const v = [...plan.map(([px, py]) => [px, py, z0]), ...plan.map(([px, py]) => [cx + (px - cx) * top, cy + (py - cy) * top, z1])];
      const polys = [plan.map((_, i) => i), plan.map((_, i) => n + i)];
      for (let i = 0; i < n; i++) polys.push([i, (i + 1) % n, n + (i + 1) % n, n + i]);
      solid(v, polys, color, o);
    },
    // Сечения [{ y, pts: [[x, z], …] }] с одинаковым числом точек — фюзеляжи, корпуса лодок
    loft(sections, color, o) {
      const n = sections[0].pts.length, v = [], polys = [];
      sections.forEach((s) => s.pts.forEach(([px, pz]) => v.push([px, s.y, pz])));
      for (let k = 0; k + 1 < sections.length; k++) for (let i = 0; i < n; i++) polys.push([k * n + i, k * n + (i + 1) % n, (k + 1) * n + (i + 1) % n, (k + 1) * n + i]);
      polys.push(sections[0].pts.map((_, i) => i), sections[0].pts.map((_, i) => (sections.length - 1) * n + i));
      solid(v, polys, color, o);
    },
    // Усечённый конус между точками a и b (стволы, колёса, мачты, ракеты)
    tube(a, b, ra, rb, color, sides = 8, o) {
      const ax = norm(sub(b, a)), ref = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const e1 = norm(cross(ax, ref)), e2 = cross(ax, e1), v = [];
      const n = organic ? 24 : Math.max(q===0?16:32,sides);
      for (const [p, r] of [[a, ra], [b, rb]]) for (let i = 0; i < n; i++) { const t = (i / n) * TAU + 0.3; v.push([p[0] + (e1[0] * Math.cos(t) + e2[0] * Math.sin(t)) * r, p[1] + (e1[1] * Math.cos(t) + e2[1] * Math.sin(t)) * r, p[2] + (e1[2] * Math.cos(t) + e2[2] * Math.sin(t)) * r]); }
      const polys = [[...Array(n).keys()], [...Array(n).keys()].map((i) => n + i)];
      for (let i = 0; i < n; i++) polys.push([i, (i + 1) % n, n + (i + 1) % n, n + i]);
      solid(v, polys, color, {...o,smooth:true,noEdge:true});
    },
    // Тонкая пластина (лопасть, крыло, руль): четырёхугольник с толщиной th вдоль z
    plate(pts, th, color, o) {
      solid([...pts.map((p) => [p[0], p[1], p[2] - th / 2]), ...pts.map((p) => [p[0], p[1], p[2] + th / 2])],
        [[...pts.keys()], [...pts.keys()].map((i) => pts.length + i), ...pts.map((_, i) => [i, (i + 1) % pts.length, pts.length + (i + 1) % pts.length, pts.length + i])], color, o);
    },
    // Любое выпуклое тело: вершины и грани (индексы) — камни, кровли
    solid(verts, polys, color, o) { solid(verts, polys, color, o); },
    // Произвольный выпуклый шестигранник (звено гусеницы на изгибе)
    hexa(v8, color, o) { solid(v8, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], color, o); },
    // Плоский диск поверх всего (размытие винта): центр, радиус, нормаль 'z'|'y'
    disc(c, r, axis, color, alpha) { faces.push({ disc: true, c: apply(M, c), r, axis, col: color, alpha, fc: apply(M, c), n: [0, 0, 1] }); },
    // Гладкое колесо: эллипс проекции круга, без граней. axis — ось наружу, spin — поворот спиц.
    wheel(c, axis, r, th, color, spin = 0) {
      const p = apply(M, c), o = apply(M, [0, 0, 0]), tip = apply(M, axis);
      faces.push({ wheel: true, c: p, axis: norm(sub(tip, o)), r, th, col: color, spin, fc: p });
    },
    // Габариты модели в плане (для тени): [xmin, ymin, xmax, ymax]
    bounds() {
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const f of faces) if (!f.disc && !f.wheel && !f.sub && !(f.o && f.o.two) && f.pts) for (const p of f.pts) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; }
      return b;
    },
    flush(wreck = false) {
      if(drawSurfaces(ctx,faces,{project,toWorld,quality:q,weather:api.finish==='salvage'})){faces.length=0;return;}
      const list = [];
      for (const f of faces) {
        if (f.disc || f.wheel || f.organic) { list.push({ f, d: dot(toWorld(f.fc), VIEW) + 0.05 + (f.wheel ? Math.max(0,dot(toWorld(f.axis),VIEW))*(f.r+f.th)*1.8 : 0) }); continue; }
        const nw = toWorld(f.n);
        if (dot(nw, VIEW) <= 0.02 && !(f.o && f.o.two)) continue;
        list.push({ f, d: dot(toWorld(f.fc), VIEW) + ((f.o && f.o.bias) || 0), nw });
      }
      list.sort((a, b) => a.d - b.d);
      const lw = Math.max(0.5, u * 0.012);
      ctx.lineJoin = 'round';
      for (const { f, nw } of list) {
        if(f.organic){organic.silhouette(f.pts,f.col);continue;}
        if (f.disc) {
          const s = project(f.c), r = f.r * u;
          ctx.save(); ctx.globalAlpha *= f.alpha; ctx.fillStyle = f.col; ctx.beginPath();
          if (f.axis === 'z') ctx.ellipse(s[0], s[1], r * 1.1, r * 0.55, 0, 0, TAU); else ctx.ellipse(s[0], s[1], r * 0.62, r * 0.95, 0, 0, TAU);
          ctx.fill(); ctx.restore();
          continue;
        }
        if (f.wheel) {
          const ax = f.axis, ref = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
          const e1 = norm(cross(ax, ref)), e2 = cross(ax, e1), c = f.c;
          const s0 = project(c);
          const s1 = project([c[0] + e1[0] * f.r, c[1] + e1[1] * f.r, c[2] + e1[2] * f.r]);
          const s2 = project([c[0] + e2[0] * f.r, c[1] + e2[1] * f.r, c[2] + e2[2] * f.r]);
          const back = project([c[0] - ax[0] * f.th, c[1] - ax[1] * f.th, c[2] - ax[2] * f.th]);
          const d1 = [s1[0] - s0[0], s1[1] - s0[1]], d2 = [s2[0] - s0[0], s2[1] - s0[1]];
          const tr = d1[0] * d1[0] + d1[1] * d1[1] + d2[0] * d2[0] + d2[1] * d2[1];
          const cross2 = d1[0] * d2[1] - d1[1] * d2[0];
          const disc = Math.sqrt(Math.max(0, tr * tr - 4 * cross2 * cross2));
          const major = Math.sqrt((tr + disc) / 2), minor = Math.max(1.1, Math.sqrt(Math.max(0, (tr - disc) / 2)));
          const rot = 0.5 * Math.atan2(2 * (d1[0] * d1[1] + d2[0] * d2[1]), d1[0] * d1[0] + d2[0] * d2[0] - d1[1] * d1[1] - d2[1] * d2[1]);
          // The tread is a projected cylinder, never a round-capped screen-space stroke.
          // A thick stroke inflated the edge-on tire into a black disk in the front view.
          const ring=(t,inner=false)=>{
            const v=[e1[0]*Math.cos(t)+e2[0]*Math.sin(t),e1[1]*Math.cos(t)+e2[1]*Math.sin(t),e1[2]*Math.cos(t)+e2[2]*Math.sin(t)];
            return project(c.map((n,k)=>n+v[k]*f.r-(inner?ax[k]*f.th:0)));
          };
          const segments=q===0?16:32, strips=[];
          for(let i=0;i<segments;i++){
            const t=i*TAU/segments, t1=(i+1)*TAU/segments, mid=(t+t1)/2;
            const n=toWorld(e1.map((v,k)=>v*Math.cos(mid)+e2[k]*Math.sin(mid)));
            strips.push({t,t1,n,d:dot(n,VIEW)});
          }
          strips.sort((a,b)=>a.d-b.d);
          for(const strip of strips){
            if(strip.d<0)continue;
            const lit=Math.max(0,dot(strip.n,LIGHT));
            ctx.fillStyle=tone(f.col,-0.25+lit*0.36);
            ctx.beginPath();[ring(strip.t),ring(strip.t1),ring(strip.t1,true),ring(strip.t,true)].forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fill();
            if(q>0 && Math.cos(strip.t*12+f.spin*12)>0.2){ctx.strokeStyle='#121617';ctx.lineWidth=Math.max(0.5,u*0.018);ctx.beginPath();ctx.moveTo(...ring(strip.t));ctx.lineTo(...ring(strip.t,true));ctx.stroke();}
          }
          const front=dot(toWorld(ax),VIEW)>0;
          const cap=front?s0:back;
          ctx.fillStyle=tone(f.col,front?0.03:-0.16);ctx.beginPath();ctx.ellipse(cap[0],cap[1],major,minor,rot,0,TAU);ctx.fill();
          ctx.strokeStyle='#111719';ctx.lineWidth=Math.max(0.5,u*0.02);ctx.stroke();
          // Hub and rotating lug bolts stay in the actual wheel plane.
          ctx.fillStyle=front?'#8a8c82':'#424844';ctx.beginPath();ctx.ellipse(cap[0],cap[1],major*.51,minor*.51,rot,0,TAU);ctx.fill();
          ctx.fillStyle='#303936';ctx.beginPath();ctx.ellipse(cap[0],cap[1],major*.24,minor*.24,rot,0,TAU);ctx.fill();
          if(q>0)for(let i=0;i<5;i++){
            const t=f.spin+i*TAU/5,px=cap[0]+(d1[0]*Math.cos(t)+d2[0]*Math.sin(t))*.36,py=cap[1]+(d1[1]*Math.cos(t)+d2[1]*Math.sin(t))*.36;
            ctx.fillStyle='#c2bcaa';ctx.beginPath();ctx.arc(px,py,Math.max(.45,u*.018),0,TAU);ctx.fill();
          }
          continue;
        }
        const lam = Math.max(0, dot(nw, LIGHT)), rim = Math.max(0, dot(nw, VIEW));
        let k = (lam - 0.55) * 0.62 + rim * 0.08 - (nw[2] < -0.2 ? 0.2 : 0);
        if (wreck) k -= 0.12;
        // Три плоских тона вместо шума соседних граней: читается как мульт, а не как рваный металл.
        k = Math.max(-0.3, Math.min(0.22, k));
        const col = f.o && f.o.glow ? f.col : tone(f.col, k);
        ctx.beginPath();
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < f.pts.length; i++) {
          const s = project(f.pts[i]);
          if (s[0] < x0) x0 = s[0]; if (s[0] > x1) x1 = s[0]; if (s[1] < y0) y0 = s[1]; if (s[1] > y1) y1 = s[1];
          i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]);
        }
        ctx.closePath();
        const tiny = (x1 - x0) + (y1 - y0) < 5; // мелкой грани обводка не нужна
        const al = f.o && f.o.alpha;
        if (al) { ctx.save(); ctx.globalAlpha *= al; }
        if(api.finish==='salvage'&&!tiny&&!(f.o&&f.o.glow)){
          const grad=ctx.createLinearGradient(x0,y0,x1,y1);grad.addColorStop(0,tone(col,.08));grad.addColorStop(.6,col);grad.addColorStop(1,tone(col,-.12));ctx.fillStyle=grad;
        }else ctx.fillStyle=col;
        ctx.fill();
        if(api.finish==='salvage'&&q>0&&(x1-x0)*(y1-y0)>90&&!(f.o&&f.o.glow)){
          const ps=f.pts.map(project),center=ps.reduce((a,p)=>[a[0]+p[0]/ps.length,a[1]+p[1]/ps.length],[0,0]);
          ctx.strokeStyle='rgba(31,29,23,.32)';ctx.lineWidth=Math.max(.45,u*.012);
          for(let i=0;i<Math.min(3,ps.length);i++){const a=ps[i],b=ps[(i+1)%ps.length];ctx.beginPath();ctx.moveTo(center[0]*.65+a[0]*.35,center[1]*.65+a[1]*.35);ctx.lineTo(center[0]*.65+b[0]*.35,center[1]*.65+b[1]*.35);ctx.stroke();}
          ctx.strokeStyle='rgba(119,65,36,.48)';ctx.lineWidth=Math.max(.6,u*.025);ctx.beginPath();ctx.moveTo(center[0],center[1]);ctx.lineTo(center[0]*.7+ps[0][0]*.3,center[1]*.7+ps[0][1]*.3);ctx.stroke();

        }
        if (!tiny && !(f.o && f.o.noEdge)) { ctx.strokeStyle = f.o && f.o.edge || col; ctx.lineWidth = Math.max(0.4, lw * 0.45); ctx.stroke(); }
        if (al) ctx.restore();
      }
      faces.length = 0;
    },
  };
  return api;
}

// Точки замкнутого пути (гусеница): отрезки и дуги → равномерные звенья с шагом pitch, сдвиг phase (движение)
export function pathLinks(segments, pitch, phase) {
  // segments: [{ a:[y,z], b:[y,z] }] или { c:[y,z], r, a0, a1 } (дуга); возвращает [{ p:[y,z], t:[dy,dz] }]
  const pts = [];
  for (const s of segments) {
    if (s.c) { const n = Math.max(3, Math.ceil(Math.abs(s.a1 - s.a0) * s.r / (pitch * 0.5))); for (let i = 0; i < n; i++) { const a = s.a0 + (s.a1 - s.a0) * i / n; pts.push([s.c[0] + Math.cos(a) * s.r, s.c[1] + Math.sin(a) * s.r]); } }
    else pts.push(s.a);
  }
  const L = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const d = Math.hypot(b[0] - a[0], b[1] - a[1]); L.push(d); total += d; }
  const out = [], n = Math.floor(total / pitch);
  let seg = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const s = (((k * pitch + phase) % total) + total) % total;
    while (s > acc + L[seg % pts.length] && seg < pts.length * 2) { acc += L[seg % pts.length]; seg++; }
    if (s < acc) { seg = 0; acc = 0; while (s > acc + L[seg]) { acc += L[seg]; seg++; } }
    const i = seg % pts.length, a = pts[i], b = pts[(i + 1) % pts.length], f = L[i] ? (s - acc) / L[i] : 0;
    out.push({ p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], t: [(b[0] - a[0]) / (L[i] || 1), (b[1] - a[1]) / (L[i] || 1)] });
  }
  return out;
}
