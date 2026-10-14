'use strict';
// Рисунок домов и плавания (ART.md): фасад дома — рядов окон столько же, сколько этажей, крыша над ними, полуподвальные окна;
// мебель этажей рисуется; все фигуры (герои, жители, спутники, звери, враги) плавают и ныряют своей анимацией, а не шагом.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
globalThis.window = globalThis.window || {};
window.WorldGen = require('../shared/worldgen');
window.Houses = require('../shared/houses');
const { ENEMIES } = require('../shared/enemies.js');
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'client', 'js', 'game', f)).href);

function stubCtx() {
  const st = { fills: 0, clips: 0, rotates: 0, ys: [], ellipses: 0, arcs: 0 };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === '__st') return st;
      if (k === 'fill') return () => { st.fills++; };
      if (k === 'clip') return () => { st.clips++; };
      if (k === 'rotate') return () => { st.rotates++; };
      if (k === 'ellipse') return () => { st.ellipses++; };
      if (k === 'arc') return () => { st.arcs++; };
      if (k === 'moveTo' || k === 'lineTo') return (x, y) => { st.ys.push(y); };
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => ctx;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return ctx;
}

test('фасад дома: рядов окон = этажей (1…5), крыша над верхним рядом, есть подвал — окошки у цоколя', async () => {
  const { drawHouse, drawFurniture, HOUSE_FLOOR_H } = await load('scenery-art.js');
  for (const style of Object.keys(window.Houses.STYLES)) for (let floors = 1; floors <= 5; floors++) for (const basement of [0, 2]) {
    const h = { id: 'h1', i: 1, x: 0, y: 0, style, floors, basement, variant: 0.4, door: { x: 0, y: 1 } };
    const out = drawHouse(stubCtx(), h, 100, 200, 12);
    assert.equal(out.rows, floors, `${style}: ${floors} эт. — ${out.rows} рядов окон`);
    assert.equal(out.rowZ.length, floors);
    assert.ok(out.rowZ.every((z, i) => i === 0 || z - out.rowZ[i - 1] >= HOUSE_FLOOR_H - 1e-9), 'по ряду на этаж');
    assert.ok(out.rowZ[floors - 1] < floors * HOUSE_FLOOR_H, 'верхний ряд — под крышей');
    assert.equal(out.roofZ, floors, 'крыша на уровне +этажей');
    assert.equal(out.basementWindows > 0, basement > 0);
    assert.ok(out.windows >= floors);
  }
  for (const key of Object.keys(window.Houses.FURNITURE)) { const c = stubCtx(); assert.ok(drawFurniture(c, key, 50, 50, 20, 0.3), 'рисуется ' + key); assert.ok(c.__st.fills > 0 || key === 'junk'); }
});

test('плавание: режим из клетки — вода «swim», подводный уровень «dive»; летуны (кроме драконов), всадники и седоки не плавают', async () => {
  const { swimModeAt } = await load('swim-art.js');
  const B = window.WorldGen.B, tiles = new Uint8Array(4).fill(B.WASTE); tiles[1] = B.WATER; tiles[2] = B.RIVER;
  const map = { width: 2, height: 2, tiles };
  assert.equal(swimModeAt(map, { x: 0.5, y: 0.5 }), null);
  assert.equal(swimModeAt(map, { x: 1.5, y: 0.5 }), 'swim');
  assert.equal(swimModeAt(map, { x: 0.5, y: 1.5 }), 'swim');
  assert.equal(swimModeAt({ ...map, underwater: true }, { x: 0.5, y: 0.5 }), 'dive');
  for (const extra of [{ alt: 2 }, { mounted: true }, { seated: true }, { def: { fly: true } }, { deadAt: 1 }]) assert.equal(swimModeAt(map, { x: 1.5, y: 0.5, ...extra }), null, JSON.stringify(extra));
  // все места, где рисуются фигуры, спрашивают режим: враги и спутники (drawEnemyFig), герои и жители (drawHeroBody)
  const src = fs.readFileSync(path.join(__dirname, '..', 'client', 'js', 'game', 'render.js'), 'utf8');
  assert.match(src, /e\.swim = swimModeAt\(this\.map, e\)/);
  assert.match(src, /hero\.swim = [^;]*swimModeAt\(this\.map, hero\)/);
});

test('плавание и ныряние: у людей гребки и «ножницы», фигура по плечи в воде / горизонтально; звери — тоже не шаг по суше', async () => {
  const { drawHumanoid } = await load('figure-art.js');
  const { drawCreature } = await load('creature-art.js');
  const { strokeArm, kickFoot } = await load('swim-art.js');
  // руки в гребке и ноги «ножницами» меняются со временем
  assert.notDeepEqual(strokeArm('swim', 1, 0.34, 0, true).hand, strokeArm('swim', 1, 0.34, 600, true).hand);
  assert.notDeepEqual(strokeArm('dive', 1, 0.34, 0, true).hand, strokeArm('swim', 1, 0.34, 0, true).hand, 'под водой — брасс, на поверхности — кроль');
  assert.notDeepEqual(kickFoot('dive', 1, 0), kickFoot('dive', 1, 300));
  const hero = (swim) => ({ id: 'h', x: 1, y: 1, moving: true, facingAngle: 0.5, colors: { skin: '#c99a72' }, look: {}, swim });
  const draw = (fn, a) => { const c = stubCtx(); fn(c, a); return c.__st; };
  const walk = draw((c, a) => drawHumanoid(c, a, 100, 100, 20, 500), hero(null));
  const swim = draw((c, a) => drawHumanoid(c, a, 100, 100, 20, 500), hero('swim'));
  const dive = draw((c, a) => drawHumanoid(c, a, 100, 100, 20, 500), hero('dive'));
  assert.equal(walk.clips, 0);
  assert.ok(swim.clips >= 2 && swim.ellipses >= 2, 'по плечи в воде: срез по воде и круги на воде');
  assert.ok(dive.rotates >= 1 && dive.arcs >= 3, 'под водой: тело горизонтально, пузыри');
  assert.ok(Math.max(...swim.ys) > Math.max(...walk.ys), 'фигура в воде ниже, чем на суше');
  // враги и спутники всех форм: люди — через гребки, звери/машины — тоже по-своему
  const shapes = new Map();
  for (const d of ENEMIES) if (!shapes.has(d.look.shape) && !d.fly) shapes.set(d.look.shape, d);
  for (const def of shapes.values()) for (const mode of ['swim', 'dive']) {
    const e = { id: 'e', def, look: def.look, type: def.id, x: 1, y: 1, moving: true, facingAngle: 1, swim: mode };
    const st = draw((c) => drawCreature(c, e, 100, 100, 20, 700), e);
    assert.ok(mode === 'swim' ? st.clips >= 2 : st.rotates >= 1, `${def.id} (${def.look.shape}): ${mode}`);
    assert.ok(st.fills > 10, `${def.id}: рисуется в воде`);
  }
});

test('справка F1: новые клавиши описаны — оружие техники, высота/погружение, приказы спутникам, дверь дома, плавание', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'client', 'js', 'help.js'), 'utf8');
  for (const re of [/<b>1 … 9<\/b>, <b>\[<\/b> \/ <b>\]<\/b>/, /PageDown погрузиться/, /низкий полёт/, /<b>,<\/b> \/ <b>\.<\/b> \/ <b>\/<\/b>/, /<b>\+<\/b> \(Shift \+ =/,
    /<b>дверь дома<\/b>/, /ныряют/, /<b>F7<\/b>/, /<b>F8<\/b>/, /<b>F9<\/b>/, /<b>F10<\/b>/, /Ctrl \+ стрелки/, /Туман войны/]) assert.match(src, re);
});


test('ruined facades never draw glazing beyond the surviving front wall',async()=>{
 const {drawHouse}=await load('scenery-art.js');
 for(const style of ['block','office','shop','cottage','farm']){
  const fills=[],state={};let path=[];
  const gradient=()=>({material:null,addColorStop(t,c){if(t===.5)this.material=c;}});
  const ctx=new Proxy(state,{get(o,k){if(k in o)return o[k];if(k==='beginPath')return()=>{path=[];};if(k==='moveTo'||k==='lineTo')return(x,y)=>path.push([x,y]);if(k==='createLinearGradient'||k==='createRadialGradient')return gradient;if(k==='fill')return()=>fills.push({material:o.fillStyle?.material,points:path.slice()});return()=>{};},set(o,k,v){o[k]=v;return true;}});
  drawHouse(ctx,{style,floors:3,basement:true,condition:'ruined',variant:.56},0,0,30);
  const glass=style==='office'?'#5a7f8f':'#3d5560';
  const windows=fills.filter(f=>f.material===glass);assert.ok(windows.length,'remaining glazing: '+style);
  for(const w of windows)for(const [sx] of w.points){const localX=2.9/2+.015-sx/(.78*30);assert.ok(localX<=3.3*.13+1e-6,'floating glazing: '+style);}
 }
});

test('rotated houses hide glazing on walls facing away from the camera',async()=>{
 const {drawHouse}=await load('scenery-art.js');
 const {tone}=await load('figure-art.js');
 for(const heading of [0,Math.PI/2,Math.PI]){
  const materials=[],state={};
  const gradient=()=>({material:null,addColorStop(t,c){if(t===.5)this.material=c;}});
  const ctx=new Proxy(state,{get(o,k){if(k in o)return o[k];if(k==='createLinearGradient'||k==='createRadialGradient')return gradient;if(k==='fill')return()=>materials.push(o.fillStyle?.material);return()=>{};},set(o,k,v){o[k]=v;return true;}});
  drawHouse(ctx,{style:'office',floors:2,variant:.56,condition:'intact',heading,footprint:{w:1,h:1}},0,0,30);
  assert.equal(materials.filter(c=>c==='#5a7f8f').length,heading===Math.PI?0:2,'front glazing');
  assert.equal(materials.filter(c=>c===tone('#5a7f8f',-.1)).length,heading===0?2:0,'side glazing');
 }
});
