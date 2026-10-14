'use strict';
// Вертикаль техники и бортовое оружие (shared/vehicles.js): глубина под подлодкой, погружение, виды оружия по машинам,
// точки вылета (стволы, пилоны, аппараты) совпадают с моделью, секторы башен
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
globalThis.window = globalThis.window || {};
const V = require('../shared/vehicles.js');
const G = require('../shared/worldgen.js');
const L = require('../shared/levels.js');
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'client', 'js', 'game', f)).href);

// Карта: суша слева (x < 3), дальше море
function seaMap(W = 16, H = 5) {
  const tiles = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tiles[y * W + x] = x < 3 ? G.B.WASTE : G.B.WATER;
  return { width: W, height: H, tiles };
}

test('вертикаль: море −5…0, предметы до +5, полёт до +10 (слои шага 13)', () => {
  assert.equal(V.DEPTH_MAX, 5);
  assert.equal(L.GROUND_TOP, 5, 'дома и деревья — до +5');
  assert.equal(V.AIR_MAX, 10, 'потолок авиации +10');
  assert.equal(L.airTop(), 10, 'высота полёта — прямо z: +1…+5 низко, +6…+10 небо');
  assert.equal(L.airTop(2), 7);
  const m = seaMap();
  assert.equal(V.depthAt(m, 1.5, 1.5), 0, 'суша — глубина 0');
  assert.equal(V.depthAt(m, 3.5, 1.5), 1, 'у берега мелко');
  assert.equal(V.depthAt(m, 5.5, 1.5), 3);
  assert.equal(V.depthAt(m, 12.5, 1.5), 5, 'дальше — не глубже 5');
  assert.equal(V.depthAt(m, -3, 1), 5, 'за краем карты — открытое море');
});

test('подлодки ныряют; под водой — только по воде', () => {
  assert.ok(V.canDive(V.get('submarine')) && V.canDive(V.get('deep_submarine')));
  for (const d of V.LIST) if (!['submarine', 'deep_submarine'].includes(d.id)) assert.ok(!V.canDive(d), d.id);
  const sub = V.get('submarine');
  const under = V.drive(sub, -3);
  assert.ok(under.walk(G.B.WATER) && !under.walk(G.B.WASTE), 'под водой — только вода');
  assert.ok(!V.drive(sub, -1).air);
});

test('оружие: у каждой боевой машины 3–5 видов; примеры из ТЗ', () => {
  for (const d of V.LIST) {
    const g = V.armsOf(d);
    if (['bicycle', 'horse', 'mutant_mount'].includes(d.id)) { assert.equal(g.length, 0, d.id); continue; }
    assert.ok(g.length >= 4 && g.length <= 5, `${d.id}: ${g.length}`);
    assert.ok(g.some((x) => x.type === 'mg' || x.type === 'cannon'), d.id + ': есть пулемёт/пушка');
    for (const x of g) {
      assert.ok(x.mounts.length >= 1, d.id + x.id);
      const p = x.item ? null : V.armProfile(x.type);
      if (p) assert.ok(p.damage[1] >= p.damage[0] && p.range > 0 && p.speed > 0 && p.ammo, d.id + x.id);
    }
  }
  const types = (id) => V.armsOf(V.get(id)).map((g) => g.type);
  for (const t of ['rockets', 'cannon', 'torpedo', 'mg']) assert.ok(types('helicopter').includes(t), 'вертолёт: ' + t);
  for (const t of ['rockets', 'bomb', 'torpedo']) assert.ok(types('plane').includes(t), 'самолёт: ' + t);
  for (const t of ['torpedo', 'missile']) assert.ok(types('boat').includes(t), 'лодка: ' + t);
  for (const t of ['torpedo', 'missile']) assert.ok(types('submarine').includes(t), 'подлодка: ' + t);
  // вертолёт: пушки под крыльями — пара симметричных установок (как в Urban Strike)
  const guns = V.armsOf(V.get('helicopter')).find((g) => g.type === 'cannon').mounts;
  assert.equal(guns.length, 2);
  assert.equal(guns[0].at[0], -guns[1].at[0]);
  // под водой стреляют только торпеды и управляемые ракеты; торпеда — по воде, бомба — с воздуха
  for (const g of V.armsOf(V.get('submarine'))) assert.equal(g.deep, ['torpedo', 'missile'].includes(g.type), g.type);
  assert.ok(V.ARMS.torpedo.water && V.ARMS.bomb.air && V.ARMS.missile.guided);
});

test('настройки: урон и поворотливость ракет', () => {
  const base = V.armProfile('missile');
  V.configure({ vehicleArmsDamageFactor: 2, vehicleMissileTurnFactor: 0 });
  try {
    const p = V.armProfile('missile');
    assert.equal(p.damage[0], base.damage[0] * 2);
    assert.equal(p.turn, 0);
  } finally { V.configure({ vehicleArmsDamageFactor: 1, vehicleMissileTurnFactor: 1 }); }
});

test('точки вылета: стволы башен совпадают с моделью во всех ракурсах; секторы башен', async () => {
  const { drawMesh } = await load('vehicle-mesh.js');
  const ctx = new Proxy({}, { get(t, k) { if (k in t) return t[k]; return () => ctx; }, set(t, k, v) { t[k] = v; return true; } });
  let n = 0;
  for (const def of V.LIST) for (let h = 0; h < 16; h++) for (let d = 0; d < 8; d++) {
    const v = { turretDir: d, rearTurretDir: (d + 3) % 8, facingAngle: h * Math.PI / 8 };
    const ends = drawMesh(ctx, def, v, 0, 0, 10, v.facingAngle, 0, 0, 'medium');
    for (const g of V.armsOf(def)) for (const m of g.mounts) {
      if (m.draw || m.frame === 'hull') continue; // ствол модели (дорисованные установки проверены ниже)
      const p = V.mountLocal(def, v, m);
      const best = Math.min(...ends.map((t) => Math.hypot(t.end[0] - p[0], t.end[1] - p[1], t.end[2] - p[2])));
      assert.ok(best < 0.02, `${def.id} ${m.id} курс ${h} башня ${d}: ${best}`);
      n++;
    }
  }
  assert.ok(n > 500);
  // мировая точка: корпус на восток (курс 0) — «вперёд» модели = +x карты, правый борт = +y
  const heli = V.get('helicopter'), v = { x: 10, y: 10, facingAngle: 0 };
  const pods = V.armsOf(heli).find((g) => g.type === 'rockets').mounts;
  const [l, r] = pods.map((m) => V.mountWorld(heli, v, m));
  assert.ok(Math.abs(l.x - r.x) < 1e-9 && l.y < 10 && r.y > 10, 'пилоны слева и справа от оси');
  assert.ok(Math.abs(l.x - (10 + pods[0].at[1] / V.M_PER_TILE)) < 1e-9);
  // сектор: носовой пулемёт вертолёта ±90° — назад не стреляет; кормовая установка лодки — стреляет назад
  const chin = V.armsOf(heli).find((g) => g.type === 'mg').mounts[0];
  assert.ok(V.inArc(heli, v, chin, { x: 15, y: 10 }) && !V.inArc(heli, v, chin, { x: 5, y: 10.1 }));
  const boat = V.get('boat'), mgs = V.armsOf(boat).find((g) => g.type === 'mg').mounts;
  assert.ok(mgs.some((m) => V.inArc(boat, v, m, { x: 5, y: 10 })) && mgs.some((m) => V.inArc(boat, v, m, { x: 15, y: 10 })));
  // башня у края сектора не выходит из него
  const a = V.turretAngle(boat, { facingAngle: 0, rearTurretDir: 0 }, 'rear');
  assert.ok(Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) <= Math.PI / 2 + 1e-9, 'кормовая башня — в своей полусфере');
});

test('модель дорисовывает пилоны, блоки ракет и торпедные аппараты', async () => {
  const { drawMesh } = await load('vehicle-mesh.js');
  window.Vehicles = V;
  let polys = 0;
  const ctx = new Proxy({}, { get(t, k) { if (k === 'fill') return () => { polys++; }; if (k in t) return t[k]; return () => ctx; }, set(t, k, v) { t[k] = v; return true; } });
  const count = (id) => { polys = 0; drawMesh(ctx, V.get(id), { facingAngle: 0 }, 0, 0, 10, 0, 0, 0, 'high'); return polys; };
  const withArms = count('helicopter');
  window.Vehicles = null;
  const bare = count('helicopter');
  window.Vehicles = V;
  assert.ok(withArms > bare, `вертолёт с подвесками: ${withArms} > ${bare}`);
});

test('«Мамонт»: блоки ракет и направляющие закреплены на башне (не висят в воздухе), точки вылета вращаются с башней', async () => {
  const def = V.get('elephant_walker');
  const grp = (t) => V.armsOf(def).find((g) => g.type === t);
  // башня: план ±0,7 × −0,8…0,7 (м) вокруг оси (0; −0,2), высота 5,1…5,6; кронштейны блоков — до |x| = 0,85
  for (const m of grp('rockets').mounts) {
    assert.equal(m.frame, 'front');
    assert.ok(Math.abs(m.at[0]) - 0.14 <= 0.85 && Math.abs(m.at[0]) >= 0.7, 'блок ракет прилегает к кронштейну у борта башни: ' + m.at);
    assert.ok(m.at[2] >= 5.1 && m.at[2] <= 5.6, 'по высоте — в пределах башни');
    assert.ok(m.at[1] - 0.9 >= -0.9 && m.at[1] <= 0.9, 'по длине — вдоль башни');
  }
  for (const m of grp('missile').mounts) {
    assert.equal(m.frame, 'front');
    assert.ok(Math.abs(m.at[0]) <= 0.5 && m.at[2] - 0.07 >= 5.58 && m.at[2] - 0.07 <= 5.65, 'направляющая лежит на крыше башни: ' + m.at);
    assert.ok(m.at[1] - 0.95 >= -0.8 && m.at[1] <= 0.7);
  }
  // поворот башни на 90°: точки вылета поворачиваются вокруг оси башни
  const m0 = grp('rockets').mounts[1], v = { turretDir: 2, angle: 0 };
  const p = V.mountLocal(def, v, m0), r = Math.hypot(p[0] - 0, p[1] + 0.2), r0 = Math.hypot(m0.at[0], m0.at[1] + 0.2);
  assert.ok(Math.abs(r - r0) < 1e-9, 'радиус от оси башни сохраняется');
  const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'client', 'js', 'game', 'vehicle-mesh-extra.js'), 'utf8');
  assert.match(src, /кронштейны блоков ракет по бокам башни/);
  assert.match(src, /g\.box\(side \* 0\.7, 0\.2, 5\.25/);
});
