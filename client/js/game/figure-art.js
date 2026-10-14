import { renderAnimeHumanoid } from './anime-figure.js';
import { drawEquipmentAura } from './equipment-aura.js';
import { legIK } from './gait.js';
import { muzzles } from './figure-memo.js';
// Объёмные фигуры: восемь ракурсов, общая проекция и суставные позы.
// Размеры в локальных координатах: поперёк тела, вперёд, вверх.
const TAU = Math.PI * 2;
const poses = new WeakMap();
export const actorMuzzle = (actor,hand='mainHand') => {const value=muzzles.get(actor);return value?.[hand] || value?.mainHand || value?.offHand;};
const tones = new Map();
// Направление на зрителя и свет — как в mesh-art.js (одна проекция и освещение для техники и людей)
const nrm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
const VIEW = nrm([1, 1, 0.78]), LIGHT = nrm([-0.25, 0.65, 1]);
const BLOB = [[0.58, 0.81, 0], [-0.58, 0.81, 0]];
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };

// Кэш оттенков: цвет → (доля → результат), без склейки строк-ключей в горячем цикле граней
let toneCount = 0;
export function tone(color, amount) {
  let per = tones.get(color);
  if (per) { const hit = per.get(amount); if (hit !== undefined) return hit; }
  const result = toneRaw(color, amount);
  if (toneCount >= 4096) { tones.clear(); toneCount = 0; per = null; }
  if (!per) { per = new Map(); tones.set(color, per); }
  per.set(amount, result); toneCount++;
  return result;
}
function toneRaw(color, amount) {
  const rgb = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color || '');
  const dec = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(color || '');
  if (!rgb && !dec) return color || '#737b80';
  const hex = rgb && (rgb[1].length === 3 ? [...rgb[1]].map((c) => c + c).join('') : rgb[1]);
  const n = hex ? parseInt(hex, 16) : 0;
  const channels = dec ? dec.slice(1).map(Number) : [n >> 16, (n >> 8) & 255, n & 255];
  return `rgb(${channels.map((c) => Math.round(clamp(amount > 0 ? c + (255 - c) * amount : c * (1 + amount), 0, 255))).join(',')})`;
}

// A fixed backwards bend keeps the mechanical hock on the same side throughout the step.
export function digitigradeLeg(hip, foot) {
  const height=hip[2]-foot[2], ankle=[foot[0],foot[1]-height*0.11,foot[2]+height*0.16];
  const dy=ankle[1]-hip[1], dz=ankle[2]-hip[2], distance=Math.max(0.001,Math.hypot(dy,dz));
  const upper=height*0.62, lower=height*0.64;
  const reach=Math.min(distance,upper+lower-0.001);
  const along=(upper*upper-lower*lower+reach*reach)/(2*reach);
  const bend=Math.sqrt(Math.max(0,upper*upper-along*along));
  const knee=[(hip[0]+ankle[0])/2,hip[1]+dy/distance*along+dz/distance*bend,hip[2]+dz/distance*along-dy/distance*bend];
  return { knee, ankle };
}

// Humanoid knees always bend forward in the body's local sagittal plane.
// Длины бедра и голени — от высоты таза: прямая нога чуть короче суммы, колено всегда немного согнуто.
export function humanoidLeg(hip,foot){
  const L=Math.max(0.2,hip[2])*1.04;
  return {knee:legIK(hip,foot,L*0.51,L*0.49,1)};
}

export function facing8(angle) { return Math.round((angle || 0) / (Math.PI / 4)) * Math.PI / 4; }

export function actorPose(actor, time) {
  let old = poses.get(actor);
  if (!old) { old = { x: actor.x || 0, y: actor.y || 0, time, phase: 0, move:0, angle: actor.facingAngle ?? (actor.dir < 0 ? Math.PI : 0) }; poses.set(actor, old); }
  const dx = (actor.x || 0) - old.x, dy = (actor.y || 0) - old.y, distance = Math.hypot(dx, dy);
  if (distance > 0.0001 && distance < 2) {
    old.angle = Math.atan2(dy, dx);
    if (actor.moving) old.phase += distance * (actor.sprint ? 10.5 : 13.5) / (actor.look && actor.look.size || 1);
  }
  if (Number.isFinite(actor.facingAngle)) old.angle = actor.facingAngle;
  const kind = actor.attackKind || 'melee';
  const length = kind === 'cast' ? 650 : kind === 'ranged' ? 320 : actor.attackFx === 'smash' ? 580 : 440;
  const age = actor.attackAt == null ? Infinity : Math.max(0, time - actor.attackAt);
  const active = age < length;
  if (active && Number.isFinite(actor.attackAngle)) old.angle = actor.attackAngle;
  const delta=Math.min(100,Math.max(0,time-old.time));
  const targetMove=actor.moving&&!actor.dead&&!actor.deadAt?1:0;
  old.move+=(targetMove-old.move)*(1-Math.exp(-delta/90));
  if(old.visualAngle==null)old.visualAngle=old.angle;
  const turn=Math.atan2(Math.sin(old.angle-old.visualAngle),Math.cos(old.angle-old.visualAngle));
  old.visualAngle+=turn*(1-Math.exp(-delta/70));
  old.x = actor.x || 0; old.y = actor.y || 0; old.time = time;
  const actionAge=actor.actionAt==null?Infinity:Math.max(0,time-actor.actionAt);
  const action=!active&&actionAge<700&&!actor.moving?Math.sin(actionAge/700*Math.PI):0;
  const p = clamp(age / length);
  const wind = active ? ease(p / 0.18) * (1 - ease((p - 0.18) / 0.22)) : 0;
  const strike = active ? ease((p - 0.18) / 0.2) * (1 - ease((p - 0.45) / 0.55)) : 0;
  return { angle: old.visualAngle, phase: old.phase, active, p, wind, strike, kind, action, actionKind:actor.actionKind,
    cast: actor.castUntil > time || Boolean(actor.flags & 64) || active && kind === 'cast',
    hurt: actor.hurtAt && time - actor.hurtAt < 240 ? Math.sin(clamp((time - actor.hurtAt) / 240) * Math.PI) : 0,
    stun: actor.stunUntil > time || Boolean(actor.flags & 2),
    move: old.move };
}

export function isoRig(ctx, x, y, unit, angle = 0, scale = [1, 1, 1]) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const project = (p) => {
    const wx = -sa * p[0] * scale[0] + ca * p[1] * scale[1], wy = ca * p[0] * scale[0] + sa * p[1] * scale[1];
    return [x + (wx - wy) * unit * 0.78, y + (wx + wy) * unit * 0.39 - p[2] * scale[2] * unit];
  };
  const depth = (p) => { const wx = -sa * p[0] * scale[0] + ca * p[1] * scale[1], wy = ca * p[0] * scale[0] + sa * p[1] * scale[1]; return wx + wy; };
  const queue = [];
  const paint = (d, fn) => queue.push({ d, fn });
  const polygon = (points, color, edge = true, flat = false) => {
    const ps = points.map(project), xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
    const gr = ctx.createLinearGradient(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    gr.addColorStop(0, tone(color, 0.22)); gr.addColorStop(0.5, color); gr.addColorStop(1, tone(color, -0.25));
    ctx.beginPath(); ps.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.closePath();
    ctx.fillStyle = flat ? color : gr; ctx.fill();
    if (edge) { ctx.strokeStyle = tone(color, -0.3); ctx.lineWidth = Math.max(0.45, unit * 0.012); ctx.stroke(); }
  };
  const line = (ps, color, width = 0.03) => {
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.45, unit * width); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ps.map(project).forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.stroke();
  };
  const ellipse = (p, rx, ry, color, rotation = 0) => {
    const s = project(p), rr = Math.max(rx, ry) * unit;
    const gr = ctx.createRadialGradient(s[0] - rx * unit * 0.32, s[1] - ry * unit * 0.35, 0, s[0], s[1], Math.max(0.1, rr));
    gr.addColorStop(0, tone(color, 0.12)); gr.addColorStop(0.6, color); gr.addColorStop(1, tone(color, -0.15));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(...s, Math.max(0.1, rx * unit), Math.max(0.1, ry * unit), rotation, 0, TAU); ctx.fill();

  };
  // Замкнутый силуэт конечности с сужением к суставу, светлой и теневой гранями.
  const limb = (a, b, ra, rb, color) => {
    const p = project(a), q = project(b), dx = q[0] - p[0], dy = q[1] - p[1], len = Math.max(0.01, Math.hypot(dx, dy));
    const nx = -dy / len, ny = dx / len;
    const gr = ctx.createLinearGradient(p[0] + nx * ra * unit, p[1] + ny * ra * unit, p[0] - nx * ra * unit, p[1] - ny * ra * unit);
    gr.addColorStop(0, tone(color, -0.16)); gr.addColorStop(0.48, color); gr.addColorStop(1, tone(color, 0.10));
    ctx.beginPath(); ctx.moveTo(p[0] + nx * ra * unit, p[1] + ny * ra * unit);
    ctx.bezierCurveTo(p[0]+dx*.35+nx*ra*unit,p[1]+dy*.35+ny*ra*unit,q[0]-dx*.3+nx*rb*unit,q[1]-dy*.3+ny*rb*unit,q[0]+nx*rb*unit,q[1]+ny*rb*unit);
    ctx.quadraticCurveTo(q[0] + dx / len * rb * unit, q[1] + dy / len * rb * unit, q[0] - nx * rb * unit, q[1] - ny * rb * unit);
    ctx.bezierCurveTo(q[0]-dx*.3-nx*rb*unit,q[1]-dy*.3-ny*rb*unit,p[0]+dx*.35-nx*ra*unit,p[1]+dy*.35-ny*ra*unit,p[0]-nx*ra*unit,p[1]-ny*ra*unit);ctx.quadraticCurveTo(p[0]-dx/len*ra*unit,p[1]-dy/len*ra*unit,p[0]+nx*ra*unit,p[1]+ny*ra*unit);ctx.closePath();
    ctx.fillStyle = gr; ctx.fill();
  };
  const volume = (p, rx, ry, rz, color) => {
    const center=project(p), axes=[[rx,0,0],[0,ry,0],[0,0,rz]].map((a)=>project([p[0]+a[0],p[1]+a[1],p[2]+a[2]]).map((v,i)=>v-center[i]));
    const xx=axes.reduce((s,a)=>s+a[0]*a[0],0), yy=axes.reduce((s,a)=>s+a[1]*a[1],0), xy=axes.reduce((s,a)=>s+a[0]*a[1],0);
    const disc=Math.sqrt((xx-yy)**2+4*xy*xy);
    ellipse(p,Math.sqrt(Math.max(0.001,(xx+yy+disc)/2))/unit,Math.sqrt(Math.max(0.001,(xx+yy-disc)/2))/unit,color,0.5*Math.atan2(2*xy,xx-yy));
  };
  const box = (cx, cy, z, w, length, height, color, bevel=0) => {
    const bx=Math.min(w*0.2,bevel),by=Math.min(length*0.2,bevel);
    const corners=bevel>0?[[-w/2+bx,-length/2],[w/2-bx,-length/2],[w/2,-length/2+by],[w/2,length/2-by],[w/2-bx,length/2],[-w/2+bx,length/2],[-w/2,length/2-by],[-w/2,-length/2+by]]:[[-w/2,-length/2],[w/2,-length/2],[w/2,length/2],[-w/2,length/2]];
    const pts=corners.map(([xx,yy])=>[cx+xx,cy+yy,z]),top=pts.map(p=>[p[0],p[1],z+height]);
    const faces=pts.map((_,i)=>i).filter(i=>{const j=(i+1)%pts.length;return depth([(pts[i][0]+pts[j][0])/2,(pts[i][1]+pts[j][1])/2,z])>depth([cx,cy,z])+1e-6;});
    for(const i of faces.sort((a,b)=>depth(pts[a])-depth(pts[b]))){const j=(i+1)%pts.length;polygon([pts[i],pts[j],top[j],top[i]],tone(color,i%2?-0.12:-0.2));}
    polygon(top,tone(color,0.1));
  };
  // Гранёные тела (как mesh-art.js): плоская заливка с освещением, отсечение задних граней.
  // Выпуклое тело рисуется сразу, без сортировки граней (у выпуклого лицевые грани не перекрываются).
  const toW = (n) => [-sa * n[0] + ca * n[1], ca * n[0] + sa * n[1], n[2]];
  const seam = Math.max(0.35, unit * 0.008), inked = unit > 17;
  const face = (pts, col, n, o) => {
    const nw = toW(n), view = nw[0] * VIEW[0] + nw[1] * VIEW[1] + nw[2] * VIEW[2];
    if (view <= 0.015 && !(o && o.two)) return;
    const lam = Math.max(0, nw[0] * LIGHT[0] + nw[1] * LIGHT[1] + nw[2] * LIGHT[2]);
    const k = (lam - 0.55) * 0.62 + Math.abs(view) * 0.1 - (nw[2] < -0.2 ? 0.16 : 0);
    const cel = k > 0.14 ? 0.12 : k > -0.05 ? 0.02 : -0.1;
    const fill = o && o.glow ? col : tone(col, cel);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) { const s = project(pts[i]); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    // мелкая фигура: без обводки граней (дорого и не видно), швы закрывает соседняя грань
    // крупная: тёмный контур только на силуэте, внутренние грани заливаются в свой тон — без «рваных» швов
    if (inked) { ctx.strokeStyle = o && o.soft ? fill : fill; ctx.lineWidth = seam; ctx.lineJoin = 'round'; ctx.stroke(); }
  };
  const newell = (pts) => { let a = 0, b = 0, c = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += (p[1] - q[1]) * (p[2] + q[2]); b += (p[2] - q[2]) * (p[0] + q[0]); c += (p[0] - q[0]) * (p[1] + q[1]); } const l = Math.hypot(a, b, c) || 1; return [a / l, b / l, c / l]; };
  const solid = (verts, polys, col, o) => {
    let cx = 0, cy = 0, cz = 0; for (const v of verts) { cx += v[0]; cy += v[1]; cz += v[2]; }
    cx /= verts.length; cy /= verts.length; cz /= verts.length;
    if(!(o&&o.hard)){silhouette(verts,typeof col==='function'?col(0,[0,0,1]):col);return;}
    const fn = typeof col === 'function';
    for (let k = 0; k < polys.length; k++) {
      const idx = polys[k], pts = new Array(idx.length);
      let fx = 0, fy = 0, fz = 0;
      for (let i = 0; i < idx.length; i++) { const p = verts[idx[i]]; pts[i] = p; fx += p[0]; fy += p[1]; fz += p[2]; }
      let n = newell(pts);
      if (n[0] * (fx / pts.length - cx) + n[1] * (fy / pts.length - cy) + n[2] * (fz / pts.length - cz) < 0) n = [-n[0], -n[1], -n[2]];
      face(pts, fn ? col(k, n) : col, n, o);
    }
  };
  const silhouette = (points, color) => {
    const ps=points.map(project).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const lower=[],upper=[];
    for(const p of ps){while(lower.length>1&&turn(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
    for(const p of ps.slice().reverse()){while(upper.length>1&&turn(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
    const hull=lower.slice(0,-1).concat(upper.slice(0,-1));if(!hull.length)return;
    const xs=ps.map(p=>p[0]),ys=ps.map(p=>p[1]),left=Math.min(...xs),right=Math.max(...xs);
    const gr=ctx.createLinearGradient(left,Math.min(...ys),right,Math.max(...ys));
    gr.addColorStop(0,tone(color,.10));gr.addColorStop(.48,color);gr.addColorStop(1,tone(color,-.14));
    ctx.beginPath();
    for(let i=0;i<hull.length;i++){
      const p=hull[i],prev=hull[(i+hull.length-1)%hull.length],next=hull[(i+1)%hull.length];
      const a=[p[0]*.82+prev[0]*.18,p[1]*.82+prev[1]*.18],b=[p[0]*.82+next[0]*.18,p[1]*.82+next[1]*.18];
      if(i)ctx.lineTo(...a);else ctx.moveTo(...a);ctx.quadraticCurveTo(...p,...b);
    }
    ctx.closePath();ctx.fillStyle=gr;ctx.fill();

  };
  // Усечённый конус a→b (кость конечности); сечение повёрнуто так, чтобы ребро смотрело вперёд
  const tube = (a, b, ra, rb, col, sides = 6, o) => {
    limb(a,b,ra,rb,col);
  };
  // Гранёное «яйцо»: кольца профиля [z, радиус, сдвиг вперёд] между полюсами (голова, кисть, сустав, шлем)
  const egg = (c, rx, ry, rz, col, n = 8, prof = BLOB, o) => {
    n = unit>15?32:20;
    const points=[[c[0],c[1],c[2]+rz],[c[0],c[1],c[2]+(prof===CAP?prof.at(-1)[0]-.08:-1)*rz]];
    for(const [z,r,dy] of prof) for(let i=0;i<n;i++){const t=i/n*TAU;points.push([c[0]+Math.cos(t)*r*rx,c[1]+(Math.sin(t)*r+dy)*ry,c[2]+z*rz]);}
    silhouette(points,col);
  };
  const blob = (c, rx, ry, rz, col, n = 8, o) => egg(c, rx, ry, rz, col, n, BLOB, o);
  // Кольцевой «лофт» (торс, юбка, плащ): кольца [z, rx, ry, cy, цвет]; невыпуклый — панели сортируются
  const loft = (rings, slices, o) => {
    // Continuous cloth panels: one silhouette per material, with no internal facet edges.
    let start=0;
    while(start<rings.length-1){
      let end=start+1;while(end<rings.length-1&&rings[end][4]===rings[start][4])end++;
      const points=[];
      for(let k=start;k<=end;k++){const r=rings[k];for(let i=0;i<32;i++){const t=i/32*TAU;points.push([Math.cos(t)*r[1],r[3]+Math.sin(t)*r[2],r[0]]);}}
      silhouette(points,rings[start][4]);start=end;
    }
  };
  return { ctx, project, depth, paint, polygon, line, ellipse, volume, limb, box, tube, blob, egg, solid, loft, face, silhouette, flush() { queue.sort((a,b)=>a.d-b.d); for (const p of queue) p.fn(); queue.length = 0; } };
}

export function shadow(ctx, x, y, unit, rx = 0.58, ry = 0.23) {
  ctx.fillStyle='rgba(7,9,12,0.25)'; ctx.beginPath(); ctx.ellipse(x,y,unit*rx,unit*ry,0,0,TAU);ctx.fill();
  ctx.fillStyle='rgba(7,9,12,0.12)';ctx.beginPath();ctx.ellipse(x,y,unit*rx*1.3,unit*ry*1.25,0,0,TAU);ctx.fill();
}

export const ARCHETYPES=['zombie','cyborg','droid','golem','ninja','mage','barbarian','cannibal','samurai','hunter','raider','mutant'];
const CAP=[[.8,.62,-.05],[.45,.94,-.06],[.05,1,-.12]];

export function drawHumanoid(ctx,actor,x,y,unit,time,forcedPose=null){
  return renderAnimeHumanoid(ctx,actor,x,y,unit,time,forcedPose,{actorPose,isoRig,tone,shadow,drawWeapon});
}

function drawWeapon(rig,w,hand,pose,actor,unit,time,handSlot) {
  const thrown = actor.thrownHands?.[handSlot] || actor._sourceActor?.thrownHands?.[handSlot] || 0;
  if (thrown && thrown > time) return; // брошенное оружие ещё в полёте
  const {line,polygon,ellipse,project}=rig, ctxColor=w.color||'#828c92', accent=w.color2||'#d8e2e6';
  const shape=w.shape||'sword';
  const guns=['pistol','revolver','smg','rifle','shotgun','sniper','ar','mg','minigun','gatling','pecheneg','m240','launcher','plasma','laser','flamethrower','crossbow'];
  const gun=[...guns,'laser_pistol','laser_rifle','flamer','blowgun','armgun'].includes(shape);
  const localAim=pose.kind==='ranged'&&Number.isFinite(actor.attackAngle)?actor.attackAngle-pose.angle:0;
  const recoil=pose.active&&pose.kind==='ranged'?Math.exp(-pose.p*18)*0.085:0;
  const at=(dx,dy,dz)=>[hand[0]+dx*Math.cos(localAim)+(dy-recoil)*Math.sin(localAim),hand[1]-dx*Math.sin(localAim)+(dy-recoil)*Math.cos(localAim),hand[2]+dz];
  const aura=(end)=>{const a=project(hand),b=project(end);drawEquipmentAura(rig.ctx,w,(a[0]+b[0])/2,(a[1]+b[1])/2,unit*0.18,time,Math.atan2(b[1]-a[1],b[0]-a[0]),Math.hypot(b[0]-a[0],b[1]-a[1]));};
  if(shape==='book'||shape==='scroll') {
    if(shape==='book'){rig.box(hand[0],hand[1]+0.06,hand[2]-0.08,0.3,0.21,0.2,ctxColor);line([at(-0.13,0.04,0.03),at(0,0.06,0.1),at(0.13,0.04,0.03)],'#e7d9b6',0.07);}
    else {line([at(-0.16,0,0),at(0.16,0.1,0)],'#e7d9b6',0.12);ellipse(at(0,0.04,0.08),0.035,0.035,accent);}
    aura(at(0,0.15,0.2));
  }else if(shape==='star'||shape==='disc') {
    for(let i=0;i<4;i++){const a=i*Math.PI/2;line([at(0,0,0),at(Math.cos(a)*0.17,0.05,Math.sin(a)*0.17)],ctxColor,0.05);}ellipse(at(0,0.04,0),0.04,0.04,accent);aura(at(0,0.1,0.15));
  }else if(shape==='nunchaku') {
    const swing=pose.active?Math.sin(pose.p*Math.PI*2)*0.55:0.2;
    line([hand,at(0,0.15,0.32)],ctxColor,0.065);line([at(0,0.15,0.32),at(swing,0.2,0.5)],'#c7ced2',0.022);line([at(swing,0.2,0.5),at(swing*1.4,0.25,0.18)],ctxColor,0.065);aura(at(swing,0.2,0.5));
  }else if(gun){
    const pistol=['pistol','revolver','laser_pistol','smg'].includes(shape), len=pistol?0.42:0.92;
    line([at(0,-0.12,0),at(0,len,0.04)],'#222b30',pistol?0.11:0.13);
    line([at(0,0.02,0.06),at(0,len*0.7,0.07)],ctxColor,pistol?0.09:0.13);
    line([at(0,0.01,0),at(0,-0.04,-0.18)],'#54483a',0.075);
    if(!pistol){line([at(0,-0.3,-0.05),at(0,-0.02,0.025)],'#655545',0.13);line([at(0,0.2,-0.04),at(0,0.17,-0.24)],'#30393d',0.09);line([at(0,0.14,0.15),at(0,0.4,0.15)],'#283238',0.06);}
    if (shape==='gatling') { const spin=pose.active?time/35:0;for(let i=0;i<6;i++){const a=spin+i*Math.PI/3;line([at(Math.cos(a)*0.08,0.35,Math.sin(a)*0.08),at(Math.cos(a)*0.08,1.05,Math.sin(a)*0.08)],ctxColor,0.035);}ellipse(at(0,0.92,0),0.12,0.12,'#293238');}
    if (['m240','pecheneg'].includes(shape)){line([at(0,0.6,0),at(-0.16,0.75,-0.22)],'#313a40',0.025);line([at(0,0.6,0),at(0.16,0.75,-0.22)],'#313a40',0.025);}
    for(let i=0;i<4;i++)line([at(-0.025,0.38+i*0.055,0.08),at(0.025,0.38+i*0.055,0.08)],accent,0.012);
    if(w.energy) {line([at(0,0.13,0.05),at(0,len*0.85,0.05)],accent,0.028);ellipse(at(0,0.2,0.08),0.04,0.03,accent);}
    aura(at(0,len,0.04)); return at(0,len+0.03,0.04);
  } else if(shape.includes('bow')) {
    const front=0.13;
    line([at(0,front,0.55),at(0,0.36,0.31),at(0,0.42,0),at(0,0.36,-0.3),at(0,front,-0.55)],ctxColor,0.055);
    line([at(0,front,0.55),at(0,pose.active?-0.16:front,0),at(0,front,-0.55)],'#b5ac8d',0.015);
    aura(at(0,front,0.55));
    return at(0,pose.active?-0.16:front,0);
  } else if(shape==='shield'||shape.includes('shield')) {
    polygon([at(-0.3,0.04,0.3),at(0.3,0.04,0.3),at(0.25,0.04,-0.2),at(0,0.04,-0.45),at(-0.25,0.04,-0.2)],ctxColor);
    line([at(0,0.06,0.28),at(0,0.06,-0.38)],accent,0.035);
  } else if(['claws','fist','knuckles','blades'].includes(shape)) { const l=shape==='blades'?0.55:0.23; for(let i=0;i<3;i++) line([at((i-1)*0.04,0,0),at((i-1)*0.06,l,0.02)],shape==='blades'?'#d7e0e4':accent,shape==='blades'?0.03:0.024); }
  else {
    const pole=['staff','spear','halberd','scythe'].includes(shape), knife=['knife','dagger','tanto'].includes(shape), axe=shape.includes('axe')||shape==='halberd'||shape==='tomahawk', hammer=['mace','hammer','club'].includes(shape);
    const len=pole?1.5:knife?0.4:shape==='wakizashi'?0.65:shape==='nodachi'?1.45:w.twoHanded?1.2:0.85;
    let f=pose.active?pose.strike*0.8:0.08, z=pose.active?1-pose.strike*0.65:0.98;
    if(actor.attackFx==='thrust'&&pose.active){f=0.94;z=0.12;}
    const tip=at(0,f*len,z*len), base=at(0,0,-0.12);
    line([base,hand], '#514234',0.065);
    if(pole||hammer||axe) line([hand,tip], '#65503a',0.045);
    else { polygon([at(-0.045,0,0),at(0.045,0,0),[tip[0]+0.016,tip[1],tip[2]-0.08],tip,[tip[0]-0.016,tip[1],tip[2]-0.08]],ctxColor);line([hand,tip],accent,0.018);line([at(-0.13,0,0.02),at(0.13,0,0.02)],'#827763',0.05); }
    if(axe) polygon([[tip[0],tip[1],tip[2]], [tip[0]+0.32,tip[1],tip[2]+0.07],[tip[0]+0.29,tip[1],tip[2]-0.3],[tip[0],tip[1],tip[2]-0.2]],ctxColor);
    if(hammer) ellipse(tip,shape==='club'?0.12:0.2,0.13,ctxColor);
    if(w.energy) line([hand,tip],accent,0.05);
    aura(tip);
    if(['katana','wakizashi','nodachi'].includes(shape)){line([hand,at(0.07,f*len*0.6,z*len*0.6),tip],'#e5e9e8',0.015);ellipse(hand,0.09,0.035,'#c2a465');}
    if(w.rarity==='legendary'||w.set) {ellipse(at(0,0,-0.04),0.045,0.045,accent);line([at(-0.14,0,0),at(0.14,0,0)],'#d4b976',0.03);}
    if(shape==='staff'||shape==='wand'||w.glow) ellipse(tip,0.075,0.09,accent);
    if(shape==='staff'||shape==='wand') return tip;
  }
  return hand;
}
