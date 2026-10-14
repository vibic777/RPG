'use strict';
// Гранёные люди (художественный проход, ART.md §4): все гуманоиды рисуются во всех ракурсах и на ходу,
// архетипы силуэтов распознаются по id, у ребёнка голова крупнее
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
globalThis.window = globalThis.window || {};
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'client', 'js', 'game', f)).href);
const { ENEMIES } = require('../shared/enemies.js');

function stubCtx() {
  const st = { fills: 0, curves: 0, ys: [] };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === '__st') return st;
      if (k === 'bezierCurveTo') return (...v) => { assert.ok(v.every(Number.isFinite)); st.curves++; };
      if (k === 'fill') return () => { st.fills++; };
      if (k === 'moveTo' || k === 'lineTo') return (x, y) => { st.ys.push(y); };
      if (k in t) return t[k];
      return () => ctx;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return ctx;
}

test('люди: все гуманоиды-враги рисуются цельными поверхностями в 8 ракурсах и на ходу, без ошибок', async () => {
  const { drawCreature, archetypeOf } = await load('creature-art.js');
  const humans = ENEMIES.filter((e) => ['humanoid', 'cyborg', 'zombie'].includes(e.look && e.look.shape));
  assert.ok(humans.length > 20);
  for (const def of humans) for (let k = 0; k < 8; k++) {
    const ctx = stubCtx(), a = { def, look: def.look, type: def.id, x: 0, y: 0, moving: true, facingAngle: k * Math.PI / 4 };
    for (let i = 0; i < 6; i++) { a.x += 0.05; drawCreature(ctx, a, 100, 100, 20, i * 40); }
    assert.ok(ctx.__st.curves > 60, def.id + ': отсутствуют связные кривые силуэта');
  }
  const arch = (id, extra = {}) => archetypeOf({ def: { id, ...extra }, look: extra.look || { shape: 'humanoid' } });
  assert.equal(arch('zombie', { look: { shape: 'zombie' } }), 'zombie');
  assert.equal(arch('cyborg_gunner', { look: { shape: 'cyborg' } }), 'cyborg');
  assert.equal(arch('ninja'), 'ninja');
  assert.equal(arch('mage_fire'), 'mage');
  assert.equal(arch('golem_stone'), 'golem');
  assert.equal(arch('samurai_ronin'), 'samurai');
  assert.equal(arch('cannibal_chief'), 'cannibal');
  assert.equal(arch('predator_hunter'), 'hunter');
  assert.equal(arch('barbarian'), 'barbarian');
  assert.equal(arch('family_kin', { family: 'human' }), null);
});

test('люди: у ребёнка голова относительно роста крупнее, чем у взрослого', async () => {
  const { drawHumanoid } = await load('figure-art.js');
  const look = { shirt: { color: '#557', shape: 'shirt' }, pants: { color: '#333', shape: 'pants' } };
  const height = (scale) => { const ctx = stubCtx(); drawHumanoid(ctx, { colors: { skin: '#c99a72' }, look, scale }, 0, 0, 20, 0); return -Math.min(...ctx.__st.ys); };
  const adult = height(1), child = height(0.6);
  assert.ok(child < adult * 0.75 && child > adult * 0.6, `рост ребёнка ${child} / взрослого ${adult}`);
});

test('постройки базы: у стен, дверей, станков, кроватей и т. д. есть гранёная модель, рисуется во всех поворотах', async () => {
  const { drawBasePiece, BASE_MODELS } = await load('base-art.js');
  const B = require('../shared/building.js');
  for (const def of Object.values(B.PIECES)) {
    if (def.layer !== 'main' || ['flag', 'stairs'].includes(def.id)) continue;
    assert.ok(BASE_MODELS.includes(def.id), 'нет модели постройки: ' + def.id);
    for (let rot = 0; rot < 4; rot++) { const ctx = stubCtx(); assert.equal(drawBasePiece(ctx, def, { rot }, 100, 100, 40, 1000), true); assert.ok(ctx.__st.fills > 4, def.id); }
  }
});


test('new anatomy retains aimed weapon muzzles for both hands',async()=>{
 const {drawHumanoid,actorMuzzle}=await load('figure-art.js');
 const actor={x:0,y:0,facingAngle:0,attackAngle:Math.PI/2,attackAt:1000,attackKind:'ranged',look:{shirt:{color:'#506772'},pants:{color:'#2f3d48'},mainHand:{shape:'rifle',color:'#566873'},offHand:{shape:'pistol',color:'#566873'}}};
 drawHumanoid(stubCtx(),actor,0,0,24,1100);
 for(const hand of ['mainHand','offHand']){const m=actorMuzzle(actor,hand);assert.ok(m&&Number.isFinite(m.dx)&&Number.isFinite(m.dy));assert.ok(m.height>1.5);assert.equal(m.angle,Math.PI/2);}
});
