// Остальная техника из моделей (художественный проход, ART.md): лодки, гидроцикл, подлодки, велосипед,
// мотоцикл, верховые животные и шагоходы. Размеры в метрах; ноги — gait.js (опорная стопа стоит на земле,
// колено гуманоидного меха — вперёд, «куриного» шагохода — назад). Каждая модель возвращает стволы.
import { rotAt, scaleAt } from './mesh-art.js';
import { tone } from './figure-art.js';
import { gaitFoot, legIK } from './gait.js';
import { connectFitting } from './mesh-attachments.js';

const TAU = Math.PI * 2;
const RUBBER = '#25292a', STEEL = '#3a4247', DARK = '#1d2124', GLASS = '#5d8fa3', LAMP = '#f3e3b0', RED = '#a8352f', WOOD = '#6e4f2e';
const clampArc = (a, center, half) => { const d = Math.atan2(Math.sin(a - center), Math.cos(a - center)); return center + Math.max(-half, Math.min(half, d)); };
const turretBlock = (g, angle, piv, bias, fn) => g.with(rotAt('z', angle, piv), fn, bias);
// Фаза шага по пройденному пути: за опорную половину цикла стопа проходит 2·half метров
const gaitPhase = (ctx, half) => ctx.dist * TAU / (4 * half);

// Пулемёт на вертлюге: arc — [центр, полуширина] сектора; без arc — круговой обзор
function pintle(g, ctx, at, turrets, o = {}) {
  connectFitting(g,g.attachmentSurface(),at,o.rear?'primary:rear':'primary:front');
  const angle = o.arc ? clampArc(o.rear ? ctx.rearAngle : ctx.turretAngle, o.arc[0], o.arc[1]) : ctx.turretAngle;
  turretBlock(g, angle, at, 0.8, () => {
    g.tube(at, [at[0], at[1], at[2] + 0.22], 0.05, 0.05, STEEL, 6);
    g.box(at[0], at[1] + 0.05, at[2] + 0.2, 0.14, 0.42, 0.14, DARK);
    if (o.shield) g.box(at[0], at[1] + 0.22, at[2] + 0.12, 0.5, 0.04, 0.34, STEEL);
    g.box(at[0] + 0.1, at[1], at[2] + 0.2, 0.08, 0.16, 0.12, '#5a5a3a');
    const end = [at[0], at[1] + (o.len || 1.05), at[2] + 0.27];
    g.tube([at[0], at[1] + 0.25, at[2] + 0.27], end, 0.03, 0.026, DARK, 6);
    turrets.push({ end: g.at(end), front: !o.rear, rear: Boolean(o.rear) });
  });
}
// Колесо из обода (велосипед, мотоцикл): шина кольцом, спицы вращаются
function ringWheel(g, ctx, yy, r) {
  g.wheel([0, yy, r], [1, 0, 0], r, Math.max(0.06, r * 0.12), RUBBER, -ctx.phase / r);
}
// Шар (гондола батискафа, шарниры): лофт из восьмиугольников вдоль y
function ball(g, c, r, color, o) {
  const secs = [];
  for (const t of [-1.25, -0.7, 0, 0.7, 1.25]) { const rr = r * Math.cos(t), pts = []; for (let i = 0; i < 8; i++) { const a = i * TAU / 8; pts.push([c[0] + Math.cos(a) * rr, c[2] + Math.sin(a) * rr]); } secs.push({ y: c[1] + r * Math.sin(t), pts }); }
  g.loft(secs, color, o);
}

// ---------- Вёсельная лодка ----------
function rowboat(g, def, v, ctx) {
  const c = ctx.color, inside = tone(c, -0.35);
  const sec = (w, top, bot) => [[-w, top], [-w * 0.85, bot + 0.15], [-w * 0.4, bot], [w * 0.4, bot], [w * 0.85, bot + 0.15], [w, top]];
  g.loft([{ y: -1.6, pts: sec(0.5, 0.62, 0.12) }, { y: -0.9, pts: sec(0.64, 0.58, 0.04) }, { y: 0.5, pts: sec(0.66, 0.6, 0.04) }, { y: 1.25, pts: sec(0.42, 0.68, 0.1) }, { y: 1.7, pts: sec(0.05, 0.8, 0.3) }],
    (k, n) => (n[2] > 0.9 ? inside : c));
  // Доски обшивки, банки (сиденья), уключины и вёсла (гребут на ходу)
  if (g.q > 0) for (const side of [-1, 1]) g.box(side * 0.64, -0.2, 0.36, 0.02, 2.4, 0.03, tone(c, -0.2), { noEdge: true, bias: 0.02 });
  for (const yy of [-1.0, 0.0, 0.9]) g.box(0, yy, 0.5, 1.2 - Math.abs(yy) * 0.25, 0.22, 0.05, tone(c, 0.12), { bias: 0.05 });
  const row = ctx.moving ? Math.sin(ctx.time / 260) : 0.3;
  for (const side of [-1, 1]) {
    const lock = [side * 0.66, 0.0, 0.66], a = row * 0.6, out = [side * 1.95, lock[1] - Math.sin(a) * 1.1, 0.2 + (ctx.moving ? Math.max(0, Math.cos(ctx.time / 260)) * 0.3 : 0)];
    g.tube([side * 0.15, lock[1] + Math.sin(a) * 0.4, 0.75], out, 0.03, 0.03, '#8a6a42', 5);
    g.plate([[out[0] - side * 0.05, out[1] - 0.12, out[2]], [out[0] + side * 0.35, out[1] - 0.14, out[2] - 0.05], [out[0] + side * 0.35, out[1] + 0.14, out[2] - 0.05], [out[0] - side * 0.05, out[1] + 0.12, out[2]]], 0.03, '#8a6a42');
  }
  const turrets = [];
  pintle(g, ctx, [0, 1.15, 0.68], turrets, { len: 0.95 });
  return turrets;
}
// ---------- Прогулочный катер (два пулемёта: нос и корма) ----------
function cruiser(g, def, v, ctx) {
  const c = ctx.color, stripe = '#48534b', deck = '#7c6448';
  const sec = (w, top, bot) => [[-w, top], [-w * 0.92, bot + 0.35], [0, bot], [w * 0.92, bot + 0.35], [w, top]];
  g.loft([{ y: -3.0, pts: sec(1.0, 1.05, 0.2) }, { y: -1.5, pts: sec(1.12, 1.05, 0.05) }, { y: 1.2, pts: sec(1.1, 1.12, 0.02) }, { y: 2.6, pts: sec(0.65, 1.25, 0.2) }, { y: 3.3, pts: sec(0.05, 1.38, 0.6) }],
    (k, n) => (n[2] > 0.9 ? deck : n[2] < -0.3 ? stripe : c));
  for (const side of [-1, 1]) g.box(side * 1.08, -0.4, 0.7, 0.03, 5.6, 0.12, stripe, { noEdge: true, bias: 0.03 }); // полоса по борту
  // Рубка с окнами и лобовым стеклом, леер
  g.prismX([[-1.6, 1.08], [-1.6, 1.95], [0.2, 1.95], [0.85, 1.08]], -0.8, 0.8, c, { bias: 0.05 });
  g.prismX([[0.22, 1.9], [0.5, 1.92], [0.95, 1.12], [0.85, 1.1]], -0.78, 0.78, GLASS, { bias: 0.08 });
  for (const side of [-1, 1]) g.box(side * 0.81, -0.7, 1.35, 0.02, 1.4, 0.35, GLASS, { glow: true, bias: 0.06 });
  g.box(0, -0.7, 1.95, 1.7, 1.9, 0.06, tone(c, -0.05), { bias: 0.06 });
  if (g.q > 0) for (const side of [-1, 1]) g.tube([side * 0.98, -2.8, 1.35], [side * 0.6, 2.9, 1.5], 0.025, 0.025, '#c9ccc9', 5, { noEdge: true });
  // Французский флаг на корме
  g.tube([0, -2.9, 1.05], [0, -2.9, 2.2], 0.02, 0.02, STEEL, 4);
  const wave = ctx.moving ? Math.sin(ctx.time / 160) * 0.06 : 0;
  ['#3f463b', '#80775e', '#574234'].forEach((col, i) => g.plate([[0, -2.9 - i * 0.2, 2.15], [0, -3.1 - i * 0.2, 2.15 + wave * (i + 1) / 3], [0, -3.1 - i * 0.2, 1.85 + wave * (i + 1) / 3], [0, -2.9 - i * 0.2, 1.85]].map(([x, y, z]) => [x, y, z]), 0.01, col, { two: true, glow: true, noEdge: true }));
  const turrets = [];
  pintle(g, ctx, [0, 2.45, 1.25], turrets, { arc: [0, Math.PI / 2], shield: true });
  pintle(g, ctx, [0, -2.45, 1.1], turrets, { arc: [Math.PI, Math.PI / 2], rear: true, shield: true });
  return turrets;
}
// ---------- Гидроцикл ----------
function jetski(g, def, v, ctx) {
  const c = ctx.color, white = '#736d5b';
  const sec = (w, top, bot) => [[-w, top], [-w * 0.9, bot + 0.18], [0, bot], [w * 0.9, bot + 0.18], [w, top]];
  g.loft([{ y: -1.35, pts: sec(0.5, 0.5, 0.1) }, { y: 0.2, pts: sec(0.55, 0.6, 0.05) }, { y: 1.0, pts: sec(0.4, 0.72, 0.15) }, { y: 1.45, pts: sec(0.06, 0.62, 0.42) }], (k, n) => (n[2] < -0.3 ? white : c));
  g.loft([{ y: -0.9, pts: sec(0.22, 0.88, 0.55) }, { y: 0.15, pts: sec(0.24, 0.9, 0.55) }, { y: 0.45, pts: sec(0.2, 0.72, 0.55) }], DARK); // сиденье
  g.prismX([[0.45, 0.6], [0.55, 0.98], [0.95, 0.85], [1.15, 0.6]], -0.3, 0.3, tone(c, 0.1));
  g.tube([0, 0.62, 0.95], [0, 0.62, 1.1], 0.04, 0.04, STEEL, 5); g.tube([-0.38, 0.6, 1.12], [0.38, 0.6, 1.12], 0.025, 0.025, DARK, 5);
  g.box(0, 1.05, 0.72, 0.36, 0.08, 0.1, LAMP, { glow: true });
  const turrets = [];
  pintle(g, ctx, [0, 0.95, 0.88], turrets, { len: 0.9 });
  return turrets;
}
// ---------- Подлодка «Акула» (торпедные установки на носу и корме) ----------
function submarine(g, def, v, ctx) {
  const c=ctx.color,deck='#343c3d',rust='#79513c',turrets=[];
  const section=(width,top,bottom)=>Array.from({length:32},(_,i)=>{const a=i*Math.PI*2/32;return[Math.cos(a)*width,(top+bottom)/2+Math.sin(a)*(top-bottom)/2];});
  g.loft([
    {y:-81,pts:section(2.5,7,2)},{y:-72,pts:section(8.5,12,.8)},{y:-58,pts:section(11,14,0)},
    {y:-30,pts:section(11.65,14.3,0)},{y:20,pts:section(11.65,14.3,0)},{y:65,pts:section(10.7,13.3,.6)},
    {y:79,pts:section(7,10,2)},{y:86.4,pts:section(.2,6,5)}
  ],(k,n)=>n[2]>.5?deck:n[2]<-.4?'#292d2e':c,{smooth:true,noEdge:true});
  // Project 941: broad missile deck ahead of the sail, two rows of ten doors.
  g.box(0,25,12.7,15,94,1.15,deck);
  for(let row=0;row<10;row++)for(const side of [-1,1]){
    const y=8+row*5.1,x=side*3.25;
    g.tube([x,y,13.8],[x,y,14.14],1.55,1.55,'#5c5c52',20);
    g.tube([x,y,14.14],[x,y,14.22],1.35,1.35,'#31393a',20);
    g.box(x,y,14.2,.12,2.2,.08,'#8b6c4a');
    g.box(x+side*1.32,y,14,.22,.9,.34,STEEL);
  }
  // Aft sail, observation slits, repaired mast housings; no civilian portholes.
  g.prismZ([[-3.4,-25],[3.4,-25],[3.5,-9],[2.8,-4],[-2.8,-4],[-3.5,-9]],13.5,23.3,c,.88);
  for(const side of [-1,1]){
    g.box(side*3.4,-12,20.4,.14,5,.7,'#111e23');
    g.box(side*3.5,-20,15.5,.22,3.2,5.5,rust);
    g.box(side*3.6,-20,17.6,.25,3.4,.16,'#a28964');
  }
  for(const [x,y,h] of [[-.9,-18,31.5],[.9,-16,29.4],[0,-12,27.3]]){
    g.tube([x,y,22.8],[x,y,h],.18,.14,STEEL,12);
    g.box(x,y+.4,h-.4,.45,1.1,.5,STEEL);
  }
  // Twin shafts and protected screws, the characteristic broad stern assembly.
  for(const side of [-1,1]){
    const x=side*7.2;
    g.tube([x,-69,5],[x,-83.6,5],1.9,1.1,STEEL,20);
    g.tube([x,-82,5],[x,-86.4,5],2.75,2.75,'#393f3e',24);
    const a=ctx.moving&&!ctx.wreck?ctx.time/80:0;
    for(let k=0;k<7;k++){const t=a+k*Math.PI*2/7;g.plate([[x,-85,5],[x+Math.cos(t)*2.45,-85,5+Math.sin(t)*2.45],[x+Math.cos(t+.32)*2.4,-85.2,5+Math.sin(t+.32)*2.4]],.18,'#8c7853',{two:true});}
    g.plate([[side*2,-64,5.5],[side*11.65,-68,5.5],[side*11.65,-76,5.5],[side*2,-73,5.5]],.5,c);
    g.prismX([[-65,6],[-70,17],[-77,17],[-81,5]],side*7.2-.3,side*7.2+.3,c);
    g.plate([[side*8,65,7],[side*11.65,63,7],[side*11.65,58,7],[side*8,60,7]],.45,c);
  }
  // Field repairs, welded armor, short spikes and bolted access walkways.
  for(let i=0;i<12;i++)for(const side of [-1,1]){
    const y=-57+i*10,x=side*(i>10?8.5:10.6);
    g.box(x,y,6,.25,5.5,4.5,i%3?c:rust);
    for(const z of [6.3,10])g.box(x+side*.16,y,z,.18,5.7,.12,'#9b8061');
    if(i%2===0)g.tube([side*7.2,y,13.5],[side*7.7,y+.3,14.5],.28,.015,'#9e9782',8);
  }
  g.prismX([[78,5],[86.4,5],[85.8,7.2],[80,8]],-2.5,2.5,'#555a53');
  turretBlock(g,clampArc(ctx.turretAngle,0,Math.PI/2),[0,65,14.5],.8,()=>{
    g.tube([0,65,12.4],[0,65,14.7],.75,.65,STEEL,16);
    g.box(0,65,14.7,2.1,2.6,2.1,c);
    g.tube([0,65.4,16.08],[0,72,16.08],.16,.12,DARK,12);
    turrets.push({end:g.at([0,72,16.08]),front:true});
  });
  pintle(g,ctx,[0,-58,14.4],turrets,{arc:[Math.PI,Math.PI/2],rear:true,shield:true});
  return turrets;
}
// ---------- Глубоководный батискаф ----------
function bathyscaphe(g, def, v, ctx) {
  const c = ctx.color, z = 2.1, R = 1.25;
  g.tube([0, -3.8, z], [0, 3.2, z], R, R, c, 12);
  g.tube([0, 3.2, z], [0, 4.6, z - 0.1], R, 0.35, c, 12);
  g.tube([0, -3.8, z], [0, -4.8, z], R, 0.4, c, 12);
  g.box(0, 0, z + R - 0.1, 0.9, 7.6, 0.14, tone(c, -0.15));
  g.prismZ([[-0.45, -0.7], [0.45, -0.7], [0.45, 0.6], [-0.45, 0.6]], z + R - 0.05, z + R + 0.85, tone(c, 0.05), 0.85);
  // Гондола-шар экипажа с иллюминаторами, балластные бункеры, прожекторы
  g.tube([0, 0.9, z - R + 0.1], [0, 0.9, z - R - 0.25], 0.35, 0.35, STEEL, 8);
  ball(g, [0, 0.9, 0.85], 0.85, tone(c, -0.08));
  for (const [xx, zz] of [[0, 1.0], [-0.35, 0.7], [0.35, 0.7]]) g.box(xx, 1.72, zz, 0.18, 0.06, 0.18, '#ffe7a0', { glow: true, bias: 0.3 });
  for (const yy of [-1.6, 2.6]) g.prismZ([[-0.5, yy - 0.4], [0.5, yy - 0.4], [0.35, yy + 0.4], [-0.35, yy + 0.4]], z - R - 0.3, z - R + 0.2, DARK, 0.9);
  for (const side of [-1, 1]) {
    g.tube([side * (R + 0.15), -3.4, z], [side * (R + 0.15), -2.4, z], 0.28, 0.28, STEEL, 8);
    const pa = ctx.moving && !ctx.wreck ? ctx.time / 35 * side : 0.3;
    for (let k = 0; k < 3; k++) { const t = pa + k * TAU / 3; g.plate([[side * (R + 0.15), -3.5, z], [side * (R + 0.15) + Math.cos(t) * 0.3, -3.5, z + Math.sin(t) * 0.3], [side * (R + 0.15) + Math.cos(t + 0.4) * 0.3, -3.5, z + Math.sin(t + 0.4) * 0.3]], 0.02, DARK, { two: true }); }
  }
  const turrets = [];
  turretBlock(g, ctx.turretAngle, [0, 2.3, z + R], 0.8, () => {
    g.tube([0, 2.3, z + R], [0, 2.3, z + R + 0.2], 0.32, 0.3, STEEL, 8);
    g.box(0, 2.3, z + R + 0.2, 0.62, 0.7, 0.34, tone(c, -0.15));
    g.tube([0, 2.0, z + R + 0.38], [0, 3.3, z + R + 0.38], 0.13, 0.13, DARK, 8);
    turrets.push({ end: g.at([0, 3.35, z + R + 0.38]), front: true });
  });
  return turrets;
}
// ---------- Велосипед ----------
function bicycle(g, def, v, ctx) {
  const c = ctx.color, r = 0.34, yb = -0.52, yf = 0.54, bb = [0, -0.02, 0.3], seat = [0, -0.22, 0.86], head = [0, 0.4, 0.84];
  ringWheel(g, ctx, yb, r, 0.03, 4, 0.05); ringWheel(g, ctx, yf, r, 0.03, 4, 0.05);
  const t = (a, b, rr = 0.025) => g.tube(a, b, rr, rr, c, 5);
  t(bb, seat); t(bb, head, 0.03); t(seat, head); t(bb, [0, yb, r]); t(seat, [0, yb, r], 0.018);
  t(head, [0, yf, r], 0.022); t(head, [0, 0.36, 1.0], 0.022);
  g.tube([-0.26, 0.34, 1.02], [0.26, 0.34, 1.02], 0.018, 0.018, DARK, 5);
  g.tube(seat, [0, -0.24, 0.95], 0.015, 0.015, STEEL, 4); g.box(0, -0.22, 0.95, 0.12, 0.26, 0.05, DARK);
  // Шатун с педалями крутится вместе с ходом
  const crank = -ctx.phase / 0.17;
  for (const side of [-1, 1]) { const a = crank + (side > 0 ? 0 : Math.PI), p = [side * 0.1, bb[1] + Math.cos(a) * 0.17, bb[2] + Math.sin(a) * 0.17]; g.tube([side * 0.04, bb[1], bb[2]], p, 0.015, 0.015, STEEL, 4); g.box(p[0] + side * 0.05, p[1], p[2] - 0.02, 0.1, 0.1, 0.03, DARK); }
  g.tube([-0.03, bb[1], bb[2]], [0.03, bb[1], bb[2]], 0.09, 0.09, STEEL, 8);
  return [];
}
// ---------- Мотоцикл (пулемёт на руле) ----------
function motorcycle(g, def, v, ctx) {
  const c = ctx.color, r = 0.32, yb = -0.68, yf = 0.72;
  ringWheel(g, ctx, yb, r, 0.075, 3, 0.11); ringWheel(g, ctx, yf, r, 0.07, 3, 0.1);
  g.prismX([[-0.35, 0.3], [-0.4, 0.6], [0.2, 0.62], [0.35, 0.3]], -0.17, 0.17, STEEL); // двигатель
  g.loft([{ y: -0.15, pts: [[-0.17, 0.7], [0.17, 0.7], [0.15, 0.92], [-0.15, 0.92]] }, { y: 0.4, pts: [[-0.15, 0.68], [0.15, 0.68], [0.12, 0.98], [-0.12, 0.98]] }], c); // бак
  g.loft([{ y: -0.95, pts: [[-0.12, 0.72], [0.12, 0.72], [0.1, 0.8], [-0.1, 0.8]] }, { y: -0.15, pts: [[-0.16, 0.7], [0.16, 0.7], [0.15, 0.84], [-0.15, 0.84]] }], DARK); // сиденье
  g.plate([[-0.14, -0.9, 0.72], [0.14, -0.9, 0.72], [0.12, -1.0, 0.62], [-0.12, -1.0, 0.62]], 0.05, c);
  for (const side of [-1, 1]) g.tube([side * 0.09, 0.48, 0.98], [side * 0.08, yf, r], 0.03, 0.03, '#b7bcbd', 5);
  g.tube([-0.38, 0.45, 1.06], [0.38, 0.45, 1.06], 0.02, 0.02, DARK, 5);
  g.tube([0, 0.52, 0.9], [0, 0.66, 0.9], 0.09, 0.08, STEEL, 8); g.box(0, 0.66, 0.85, 0.12, 0.03, 0.1, LAMP, { glow: true });
  g.tube([0.17, 0.0, 0.35], [0.2, -1.0, 0.45], 0.05, 0.045, '#8a8f8a', 6); // выхлоп
  g.box(0, -1.0, 0.6, 0.12, 0.03, 0.05, RED, { glow: true });
  const turrets = [];
  pintle(g, ctx, [0, 0.52, 1.08], turrets, { len: 0.8 });
  return turrets;
}

// ---------- Верховые животные: лошадь и мутант-скакун ----------
function mount(g, def, v, ctx) {
  const mutant = def.id === 'mutant_mount', S = mutant ? 1.12 : 1, c = ctx.color, dark = tone(c, -0.3), hoofC = '#2b2724';
  const half = ctx.half || 0.42 * S, ph = ctx.ph ?? gaitPhase(ctx, half), hz = 1.18 * S; // ctx.half/ph — дикая лошадь (фаза actorPose)
  // Ноги: рысь (диагональные пары); у передней запястье выступает вперёд, у задней скакательный сустав — назад
  for (const side of [-1, 1]) for (const end of [-1, 1]) {
    const gf = gaitFoot(ph, side * end > 0 ? 0 : Math.PI, half, 0.22 * S, ctx.moving ? 1 : 0);
    const hip = [side * 0.24 * S, end * 0.62 * S, hz], foot = [side * 0.25 * S, end * 0.64 * S + gf.dy, 0.07 + gf.dz];
    const knee = legIK(hip, foot, 0.6 * S, 0.62 * S, end > 0 ? 1 : -1);
    g.tube(hip, knee, (end > 0 ? 0.14 : 0.18) * S, 0.07 * S, c, 6);
    g.tube(knee, foot, 0.055 * S, 0.05 * S, end > 0 ? c : tone(c, -0.05), 6);
    g.tube([foot[0], foot[1], foot[2] - 0.07], [foot[0], foot[1], foot[2] + 0.06], 0.075 * S, 0.06 * S, hoofC, 6);
  }
  // Корпус-бочка, шея, голова
  const oct = (w, z0, z1) => [[-w * 0.5, z0 + (z1 - z0) * 0.3], [-w * 0.3, z0], [w * 0.3, z0], [w * 0.5, z0 + (z1 - z0) * 0.3], [w * 0.5, z1 - (z1 - z0) * 0.25], [w * 0.3, z1], [-w * 0.3, z1], [-w * 0.5, z1 - (z1 - z0) * 0.25]];
  const bob = ctx.moving ? Math.abs(Math.sin(ph)) * 0.05 : 0;
  g.loft([{ y: -1.0 * S, pts: oct(0.5 * S, 1.02 * S + bob, 1.5 * S + bob) }, { y: -0.6 * S, pts: oct(0.72 * S, 0.9 * S + bob, 1.62 * S + bob) }, { y: 0.45 * S, pts: oct(0.7 * S, 0.88 * S + bob, 1.62 * S + bob) }, { y: 0.95 * S, pts: oct(0.52 * S, 1.02 * S + bob, 1.74 * S + bob) }], c);
  const nod = ctx.moving ? Math.sin(ph * 2) * 0.05 : Math.sin(ctx.time / 900) * 0.03;
  const neckTop = [0, 1.25 * S, 2.05 * S + nod + bob];
  g.tube([0, 0.8 * S, 1.42 * S + bob], neckTop, 0.28 * S, 0.17 * S, c, 8);
  g.tube([0, 1.15 * S, 2.1 * S + nod + bob], [0, 1.7 * S, 1.78 * S + nod + bob], 0.16 * S, 0.1 * S, c, 8);
  g.tube([0, 1.65 * S, 1.8 * S + nod + bob], [0, 1.74 * S, 1.75 * S + nod + bob], 0.085 * S, 0.06 * S, dark, 6);
  for (const side of [-1, 1]) {
    g.tube([side * 0.07, 1.2 * S, 2.17 * S + nod + bob], [side * 0.09, 1.16 * S, 2.35 * S + nod + bob], 0.035, 0.01, c, 4);
    g.box(side * 0.1 * S, 1.42 * S, 2.0 * S + nod + bob, 0.03, 0.06, 0.05, mutant ? '#f0c040' : '#141414', { glow: mutant, bias: 0.05 });
  }
  // Грива и хвост (хвост качается)
  const mane = mutant ? '#3b3a2a' : '#2e241d';
  for (let k = 0; k < 5; k++) { const t = k / 4; g.box(0, (0.82 + t * 0.4) * S, (1.6 + t * 0.48) * S + bob + nod * t, 0.07, 0.14 * S, 0.14, mane, { noEdge: true, bias: 0.04 }); }
  const sw = Math.sin(ctx.time / 400) * 0.12 + (ctx.moving ? Math.sin(ph) * 0.1 : 0);
  g.tube([0, -0.95 * S, 1.45 * S + bob], [sw * 0.5, -1.15 * S, 1.1 * S], 0.07, 0.06, mane, 5);
  g.tube([sw * 0.5, -1.15 * S, 1.1 * S], [sw, -1.2 * S, 0.65 * S], 0.06, 0.03, mane, 5);
  // Седло, потник, стремена; у мутанта — костяные пластины, рога и перемётные сумы
  if (!ctx.wild) g.box(0, 0.0, 1.57 * S + bob, 0.62 * S, 0.7 * S, 0.06, '#7a2f2a');
  if (!ctx.wild) g.prismX([[-0.32, 1.62 * S + bob], [-0.36, 1.78 * S + bob], [-0.22, 1.72 * S + bob], [0.2, 1.72 * S + bob], [0.3, 1.82 * S + bob], [0.3, 1.62 * S + bob]], -0.2, 0.2, '#5b4130');
  if (!ctx.wild) for (const side of [-1, 1]) { g.tube([side * 0.3 * S, 0, 1.6 * S + bob], [side * 0.33 * S, 0.02, 1.0 * S], 0.012, 0.012, '#3a2e24', 3); g.box(side * 0.33 * S, 0.02, 0.95 * S, 0.06, 0.12, 0.05, STEEL); }
  if (mutant) {
    for (let k = 0; k < 4; k++) g.prismZ([[-0.12, -0.85 + k * 0.22], [0.12, -0.85 + k * 0.22], [0, -0.7 + k * 0.22]], 1.6 * S + bob, 1.9 * S + bob, '#c9c1a0', 0.2);
    for (const side of [-1, 1]) { g.tube([side * 0.1, 1.3 * S, 2.2 * S + nod + bob], [side * 0.3, 1.45 * S, 2.55 * S + nod + bob], 0.05, 0.012, '#d8d0b0', 5); g.box(side * 0.36 * S, -0.45, 1.15 * S, 0.14, 0.42, 0.34, '#5a4a32'); }
  }
  return [];
}

// ---------- Шагоходы ----------
// Гуманоидный мех «Страж»: колени вперёд, поворотный корпус с пулемётом
function sentinel(g, def, v, ctx) {
  const c = ctx.color, half = 0.6, ph = gaitPhase(ctx, half), hz = 2.6;
  const steps = globalThis.window?.Vehicles?.walkerFeet(def,ctx.dist,ctx.moving)||[-1, 1].map((side) => gaitFoot(ph, side < 0 ? Math.PI : 0, half, 0.35, ctx.moving ? 1 : 0));
  const sink = ctx.moving ? -Math.abs(Math.cos(ph)) * 0.12 : 0;
  [-1, 1].forEach((side, i) => {
    const hip = [side * 0.62, 0, hz + sink], foot = [side * 0.72, steps[i].dy, 0.25 + steps[i].dz];
    const knee = legIK(hip, foot, 1.3, 1.35, 1);
    g.tube(hip, knee, 0.3, 0.24, tone(c, -0.05), 8); ball(g, knee, 0.26, STEEL);
    g.tube(knee, foot, 0.22, 0.18, c, 8);
    g.box(knee[0], knee[1] + 0.2, knee[2] - 0.35, 0.36, 0.12, 0.7, tone(c, 0.06)); // наколенник спереди
    g.box(foot[0], foot[1] + 0.15, foot[2] - 0.25, 0.6, 1.1, 0.25, DARK);
  });
  g.box(0, 0, hz - 0.25 + sink, 1.5, 0.9, 0.55, STEEL);
  g.tube([0,0,hz+sink],[0,0,hz+.38+sink],.36,.36,STEEL,12);
  const turrets = [];
  turretBlock(g, ctx.turretAngle, [0, 0, hz + sink], 0.6, () => {
    const z0 = hz + 0.3 + sink;
    g.prismZ([[-0.95, -0.7], [0.95, -0.7], [1.05, 0.3], [0.6, 0.85], [-0.6, 0.85], [-1.05, 0.3]], z0, z0 + 1.45, c, 0.88);
    g.prismX([[0.55, z0 + 0.75], [0.62, z0 + 1.2], [0.92, z0 + 0.95], [0.8, z0 + 0.6]], -0.45, 0.45, GLASS, { bias: 0.1 }); // кабина пилота
    g.box(0, -0.85, z0 + 0.3, 1.2, 0.4, 0.9, tone(c, -0.15)); // реактор сзади
    for (const side of [-1, 1]) { g.box(side * 1.2, 0, z0 + 1.0, 0.5, 0.8, 0.5, tone(c, 0.05)); }
    for (const side of [-1,1])g.tube([side*1.2,.1,z0+1.05],[side*1.3,.2,z0+.65],.15,.13,STEEL,12);
    // правая рука — тяжёлый пулемёт; левая — ракетный блок
    g.box(1.3, 0.2, z0 + 0.3, 0.38, 0.7, 0.6, tone(c, -0.08));
    g.tube([1.3, 0.5, z0 + 0.6], [1.3, 2.0, z0 + 0.6], 0.09, 0.08, DARK, 8);
    g.tube([1.3, 1.85, z0 + 0.6], [1.3, 2.15, z0 + 0.6], 0.12, 0.12, DARK, 8);
    turrets.push({ end: g.at([1.3, 2.15, z0 + 0.6]), front: true });
    g.box(-1.3, 0.2, z0 + 0.35, 0.45, 0.9, 0.55, tone(c, -0.1));
    if (g.q > 0) for (let k = 0; k < 4; k++) g.box(-1.42 + (k % 2) * 0.24, 0.66, z0 + 0.48 + Math.floor(k / 2) * 0.22, 0.14, 0.03, 0.14, '#3a2420', { glow: true, bias: 0.05 });
    g.box(0.4, -0.2, z0 + 1.45, 0.14, 0.14, 0.4, STEEL); // антенна-прожектор
  });
  return turrets;
}
// «Страйдер»: обратный (куриный) сустав — колено назад; голова-кабина с пушками по бокам
function strider(g, def, v, ctx) {
  const c = ctx.color, half = ctx.half || 0.5, ph = ctx.ph ?? gaitPhase(ctx, half), hz = 2.35;
  const sink = ctx.moving ? -Math.abs(Math.cos(ph)) * 0.1 : 0;
  for (const side of [-1, 1]) {
    const st = globalThis.window?.Vehicles?.walkerFeet(def,ctx.dist,ctx.moving).find(f=>f.side===side)||gaitFoot(ph, side < 0 ? Math.PI : 0, half, 0.32, ctx.moving ? 1 : 0);
    const hip = [side * 0.55, 0, hz + sink], foot = [side * 0.6, st.dy, 0.12 + st.dz];
    const ankle = [foot[0], foot[1] - 0.3, foot[2] + 0.45];
    const knee = legIK(hip, ankle, 1.15, 1.15, -1);
    g.tube(hip, knee, 0.17, 0.14, tone(c, -0.08), 8); ball(g, knee, 0.17, STEEL);
    g.tube(knee, ankle, 0.13, 0.1, c, 8); ball(g, ankle, 0.12, STEEL);
    g.tube(ankle, foot, 0.08, 0.07, STEEL, 6);
    for (const k of [-1, 0, 1]) g.box(foot[0] + k * 0.15, foot[1] + 0.25, foot[2] - 0.12, 0.1, 0.55, 0.1, DARK); // пальцы
    g.box(foot[0], foot[1] - 0.25, foot[2] - 0.12, 0.1, 0.25, 0.1, DARK);
  }
  g.box(0, 0, hz - 0.15 + sink, 1.2, 0.6, 0.35, STEEL);
  g.tube([0,0,hz+sink],[0,0,hz+.28+sink],.28,.28,STEEL,12);
  const turrets = [];
  turretBlock(g, ctx.turretAngle, [0, 0, hz + sink], 0.6, () => {
    const z0 = hz + 0.2 + sink;
    g.prismX([[-0.75, z0], [-0.8, z0 + 0.85], [0.3, z0 + 1.0], [0.95, z0 + 0.55], [0.8, z0]], -0.65, 0.65, c);
    g.prismX([[0.45, z0 + 0.6], [0.82, z0 + 0.58], [0.6, z0 + 0.8]], -0.4, 0.4, '#e0b040', { glow: true, bias: 0.1 }); // смотровая щель
    g.box(0, -0.2, z0 + 0.95, 0.5, 0.5, 0.18, tone(c, -0.1));
    for (const side of [-1, 1]) {
      g.box(side * 0.78, 0.2, z0 + 0.25, 0.2, 0.6, 0.25, STEEL);
      g.tube([side*.55,.2,z0+.36],[side*.78,.2,z0+.36],.1,.1,STEEL,8);
      g.tube([side * 0.78, 0.4, z0 + 0.36], [side * 0.78, 1.45, z0 + 0.36], 0.05, 0.045, DARK, 6);
    }
    turrets.push({ end: g.at([0.78, 1.45, z0 + 0.36]), front: true });
  });
  return turrets;
}
// «Мамонт»: четыре ноги-колонны (колени вперёд, как у слона), шаг поочерёдно, пушка на спине
function mammoth(g, def, v, ctx) {
  const c = ctx.color, half = 0.6, ph = gaitPhase(ctx, half), hz = 2.7;
  const off = { '-1,-1': 0, '-1,1': Math.PI / 2, '1,-1': Math.PI, '1,1': Math.PI * 1.5 };
  for (const side of [-1, 1]) for (const end of [-1, 1]) {
    const st = globalThis.window?.Vehicles?.walkerFeet(def,ctx.dist,ctx.moving).find(f=>f.side===side&&f.end===end)||gaitFoot(ph, off[side + ',' + end], half, 0.35, ctx.moving ? 1 : 0);
    const hip = [side * 1.25, end * 1.9, hz], foot = [side * 1.35, end * 1.95 + st.dy, 0.3 + st.dz];
    const knee = legIK(hip, foot, 1.3, 1.25, 1);
    g.tube(hip, knee, 0.45, 0.38, tone(c, -0.06), 8); ball(g, knee, 0.36, STEEL);
    g.tube(knee, foot, 0.36, 0.42, c, 8);
    g.tube([foot[0], foot[1], foot[2] - 0.3], [foot[0], foot[1], foot[2] + 0.05], 0.55, 0.5, DARK, 10);
  }
  g.prismX([[-3.0, 2.4], [-3.2, 3.6], [-2.4, 4.4], [2.2, 4.5], [2.9, 3.6], [2.6, 2.4]], -1.5, 1.5, c);
  for (const side of [-1, 1]) for (let k = 0; k < 4; k++) g.box(side * 1.52, -2.2 + k * 1.3, 2.7, 0.06, 1.15, 1.4, k % 2 ? c : tone(c, -0.08), { bias: 0.05 });
  // Голова с хоботом (качается) и бивнями
  g.prismX([[2.7, 2.6], [2.8, 4.0], [3.6, 3.7], [3.8, 2.9]], -0.9, 0.9, tone(c, 0.04));
  for (const side of [-1, 1]) { g.box(side * 0.45, 3.75, 3.4, 0.25, 0.06, 0.15, '#e0a030', { glow: true, bias: 0.06 }); g.tube([side * 0.5, 3.6, 2.8], [side * 0.65, 4.8, 2.3], 0.13, 0.05, '#d8d0b0', 6); g.plate([[side * 0.9, 2.8, 3.8], [side * 1.7, 2.6, 3.6], [side * 1.7, 2.6, 2.7], [side * 0.9, 2.8, 2.9]], 0.08, tone(c, -0.1)); }
  let p = [0, 3.75, 2.9], a = 0.3 + (ctx.moving ? Math.sin(ph) * 0.2 : Math.sin(ctx.time / 900) * 0.1);
  for (let k = 0; k < 5; k++) { a += 0.28; const q = [Math.sin(a * 2) * 0.1, p[1] + Math.cos(a) * 0.38, p[2] - Math.sin(a) * 0.45 + 0.05]; g.tube(p, q, 0.26 - k * 0.035, 0.22 - k * 0.035, k % 2 ? c : tone(c, -0.1), 8); p = q; }
  // Кабина и пушка на спине
  g.prismZ([[-0.9, -1.2], [0.9, -1.2], [0.9, 0.6], [0.5, 1.1], [-0.5, 1.1], [-0.9, 0.6]], 4.45, 5.1, tone(c, -0.05), 0.85);
  g.box(0, 0.95, 4.75, 1.1, 0.12, 0.25, GLASS, { glow: true, bias: 0.1 });
  const turrets = [];
  turretBlock(g, ctx.turretAngle, [0, -0.2, 5.1], 1, () => {
    g.prismZ([[-0.6, -0.8], [0.6, -0.8], [0.7, 0.3], [0.35, 0.7], [-0.35, 0.7], [-0.7, 0.3]], 5.1, 5.6, tone(c, 0.06), 0.8);
    g.tube([0, 0.6, 5.35], [0, 2.8, 5.35], 0.14, 0.12, DARK, 8);
    g.tube([0, 2.55, 5.35], [0, 2.9, 5.35], 0.18, 0.18, DARK, 8);
    // кронштейны блоков ракет по бокам башни и ложементы направляющих на крыше (сами блоки и ракеты — drawMounts по shared/vehicles.js)
    for (const side of [-1, 1]) {
      g.box(side * 0.7, 0.2, 5.25, 0.3, 0.55, 0.2, tone(c, -0.1));
      for (const y of [-0.35, 0.25]) g.box(side * 0.32, y, 5.58, 0.18, 0.1, 0.08, STEEL);
    }
    turrets.push({ end: g.at([0, 2.9, 5.35]), front: true });
  });
  return turrets;
}

export const EXTRA = { rowboat, boat: cruiser, jetski, submarine, deep_submarine: bathyscaphe, bicycle, motorcycle, horse: mount, mutant_mount: mount, mech_sentinel: sentinel, chicken_walker: strider, elephant_walker: mammoth };

// Седло открытой техники для фигуры седока: y — вдоль корпуса, z — высота таза, м; astride — верхом
export const RIDE = {
  bicycle: { y: -0.22, z: 0.98, astride: true, pedal: true }, motorcycle: { y: -0.5, z: 0.86, astride: true },
  horse: { y: 0, z: 1.72, astride: true }, mutant_mount: { y: 0, z: 1.92, astride: true },
  jetski: { y: -0.4, z: 0.92, astride: true }, rowboat: { y: -0.1, z: 0.6 }, boat: { y: 0.55, z: 1.48, angle: 0, cockpit: true },
};
