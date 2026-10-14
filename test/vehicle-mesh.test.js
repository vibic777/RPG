'use strict';
// Низкополигональные модели техники (художественный проход): каждая рисуется во всех ракурсах,
// у стволов есть дуло, турели не выходят из своего сектора (ART.md, раздел 4)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs=require('node:fs');
globalThis.window = globalThis.window || {};
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'client', 'js', 'game', f)).href);
const Vehicles = require('../shared/vehicles.js');

function stubCtx() {
  const st = { fills: 0, strokes: 0 };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === '__st') return st;
      if (k === 'fill') return () => { st.fills++; };
      if (k === 'stroke') return () => { st.strokes++; };
      if (k in t) return t[k];
      return () => ctx;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return ctx;
}

test('водитель катера сидит в рубке на уровне палубы и развёрнут по курсу',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','client','js','game','vehicle-mesh-extra.js'),'utf8');
 const ride=source.match(/,\s*boat:\s*\{([^}]+)\}/)?.[1];assert.ok(ride);
 assert.match(ride,/y:\s*0\.55/,'посадка смещена к носу в рубку');
 assert.match(ride,/z:\s*1\.48/,'таз находится на уровне сиденья рубки');
 assert.match(ride,/cockpit:\s*true/,'водитель рисуется привязанным к корпусу после его модели');
 assert.match(ride,/angle:\s*0/,'поза ориентирована вперёд по курсу катера');
});

test('модели техники: все рисуются в 8 ракурсах, у оружия есть дуло; детализация по качеству', async () => {
  const { MESH, drawMesh } = await load('vehicle-mesh.js');
  for (const id of ['tank', 'light_tank', 'helicopter', 'plane', 'apc', 'ifv', 'car', 'truck', 'bus', 'semi_truck']) assert.ok(MESH[id], 'модель ' + id);
  for (const def of Vehicles.LIST) assert.ok(MESH[def.id], 'нет модели: ' + def.id);
  for (const def of Vehicles.LIST.filter((d) => MESH[d.id])) {
    for (let a = 0; a < 8; a++) {
      const ctx = stubCtx();
      const t = drawMesh(ctx, def, { moving: true, turretDir: a, rearTurretDir: (a + 4) % 8 }, 100, 100, 10, a * Math.PI / 4, 1000, def.fly ? 1 : 0, 'medium');
      assert.ok(ctx.__st.fills > 25, `${def.id}: граней ${ctx.__st.fills}`);
      if (def.weapon) { const f = t.find((x) => x.front); assert.ok(f && Number.isFinite(f.muzzle.dx) && f.muzzle.height > 0, def.id + ': дуло'); }
      if (def.rearWeapon) assert.ok(t.find((x) => x.rear), def.id + ': кормовая турель');
    }
  }
  const lo = stubCtx(), hi = stubCtx(), tank = Vehicles.get('tank');
  drawMesh(lo, tank, { moving: true }, 0, 0, 10, 0, 0, 0, 'low');
  drawMesh(hi, tank, { moving: true }, 0, 0, 10, 0, 0, 0, 'high');
  assert.ok(lo.__st.fills < hi.__st.fills * 0.8, `низкое качество — меньше граней (${lo.__st.fills} < ${hi.__st.fills})`);
});

test('модели техники: сектор турели ~180°, танк — пушка и пулемёт на башне, Ка-52 — турель под носом', async () => {
  const { clampArc, drawMesh } = await load('vehicle-mesh.js');
  assert.ok(Math.abs(clampArc(0.3, 0, Math.PI / 2) - 0.3) < 1e-9);
  assert.ok(Math.abs(clampArc(Math.PI, 0, Math.PI / 2)) <= Math.PI / 2 + 1e-9, 'носовая не смотрит назад');
  const r = clampArc(0, Math.PI, Math.PI / 2);
  assert.ok(Math.abs(Math.atan2(Math.sin(r - Math.PI), Math.cos(r - Math.PI))) <= Math.PI / 2 + 1e-9, 'кормовая не смотрит вперёд');
  const tank = drawMesh(stubCtx(), Vehicles.get('tank'), { turretDir: 2 }, 0, 0, 10, 0, 0, 0, 'medium');
  assert.equal(tank.length, 2, 'Армата: пушка + пулемёт');
  const heli = drawMesh(stubCtx(), Vehicles.get('helicopter'), { turretDir: 4 }, 0, 0, 10, 0, 0, 1, 'medium');
  assert.ok(heli[0].end[2] < 1, 'турель Ка-52 — под фюзеляжем');
  const il = drawMesh(stubCtx(), Vehicles.get('plane'), { turretDir: 0, rearTurretDir: 0 }, 0, 0, 10, 0, 0, 1, 'medium');
  assert.ok(il.find((x) => x.rear).end[1] < -0.75 + 1e-6, 'стрелок Ил-2 не стреляет вперёд');
  const t2 = drawMesh(stubCtx(), Vehicles.get('tank'), { turretDir: 2 }, 0, 0, 10, 0, 0, 0, 'medium');
  assert.ok(Math.abs(t2[0].end[0]) > 3, 'дуло повёрнутой башни — сбоку (поворот учтён)');
});


test('wheel projection preserves the vertical wheel plane at every heading', async () => {
  const { meshRig } = await load('mesh-art.js');
  for (let i=0;i<8;i++) {
    const ellipses=[], ctx=stubCtx(); ctx.ellipse=(...args)=>ellipses.push(args);
    const g=meshRig(ctx,0,0,10,i*Math.PI/4,1);
    g.wheel([0,0,1],[1,0,0],1,0.2,'#25292a'); g.flush();
    const [, ,major,minor,rotation]=ellipses[0];
    const origin=g.project([0,0,1]), a=g.project([0,1,1]), b=g.project([0,0,2]);
    const vectors=[a,b].map(p=>p.map((v,k)=>v-origin[k]));
    const expected=vectors.reduce((sum,v)=>sum+v[0]*v[1],0);
    const actual=(major*major-minor*minor)*Math.sin(rotation)*Math.cos(rotation);
    assert.ok(Math.abs(actual-expected)<1e-6, 'wheel orientation '+i);
  }
});


test('tires use projected tread surfaces without disk-sized round strokes', async () => {
 const {meshRig}=await load('mesh-art.js');
 for(let i=0;i<8;i++){
   let widest=0;const ctx=stubCtx();ctx.stroke=()=>{widest=Math.max(widest,ctx.lineWidth||0);};
   const g=meshRig(ctx,0,0,20,i*Math.PI/4,2);g.wheel([1,0,.4],[1,0,0],.4,.25,'#25292a',1);g.flush();
   assert.ok(widest<3,'tire thickness must come from geometry, heading '+i);
 }
});


test('depth-buffered wheels have finite tread geometry and separated hub layers', async()=>{
 const {wheelSurfaceFaces}=await load('mesh-surface.js');
 for(const side of [-1,1])for(const quality of [0,1,2]){
   const faces=wheelSurfaceFaces({c:[side,2,.5],axis:[side,0,0],r:.5,th:.3,col:'#25292a',spin:1},quality);
   for(const f of faces){assert.ok(f.pts.every(p=>p.every(Number.isFinite)));assert.ok(f.n.every(Number.isFinite));}
   const caps=faces.slice(-8);const near=caps.slice(0,4).map(f=>f.pts[0][0]*side);
   assert.ok(near.every((x,i)=>!i||x>near[i-1]),'hub layers need distinct physical depth');
 }
});
