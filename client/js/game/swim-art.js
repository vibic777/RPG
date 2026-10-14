// Плавание и ныряние всех фигур (герои, жители, спутники, питомцы, враги) — ART.md «Плавание».
// Режим берётся из клетки под фигурой: вода/река на поверхности — «swim» (по плечи в воде, гребки руками, круги и брызги),
// подводный уровень — «dive» (тело почти горизонтально, ноги работают «ножницами», пузыри). Летящие, верховые,
// сидящие в машине и летающие машины (дроны) не плавают; драконы (look.shape «dragon») плывут и ныряют.
const TAU = Math.PI * 2;
const W = () => (typeof window !== 'undefined' ? window : globalThis);

// Роботы и дроны (семейство «robot», метка robot, формы drone/walker) — машины: не плавают, а ходят по дну
export function isMachine(actor) {
  const d = (actor && actor.def) || {}, shape = (actor && actor.look && actor.look.shape) || (d.look && d.look.shape);
  return d.family === 'robot' || (Array.isArray(d.tags) && d.tags.includes('robot')) || shape === 'drone' || shape === 'walker';
}

// 'swim' | 'dive' | 'seabed' | 'seabed-deep' | null для фигуры actor (x, y — клетки) на карте map.
// seabed — робот идёт по дну под открытой водой (виден сквозь воду, муть из-под ног, пузыри); seabed-deep — по дну подводного уровня.
export function swimModeAt(map, actor) {
  if (!map || !actor || actor.dead || actor.deadAt) return null;
  if (actor.seated || actor.mounted || actor.vehicleHidden || actor.inVehicle || (actor.alt || 0) > 0) return null;
  const machine = isMachine(actor), fly = Boolean(actor.def && actor.def.fly);
  // летуны над водой летят — кроме драконов: те садятся на воду, плывут и ныряют, как все существа.
  // Летающие дроны не ныряют: над водой летят (по дну ходят только наземные роботы и дроны).
  if (fly && machine) return null;
  if (fly && ((actor.look && actor.look.shape) || (actor.def.look && actor.def.look.shape)) !== 'dragon') return null;
  if (map.underwater) return machine ? 'seabed-deep' : 'dive';
  const x = Math.floor(actor.x), y = Math.floor(actor.y);
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  const B = W().WorldGen && W().WorldGen.BIOMES;
  const t = map.tiles[y * map.width + x];
  return B && B[t] && B[t].swim ? (machine ? 'seabed' : 'swim') : null;
}

const seedOf = (a) => { const s = String(a.id || a.name || ''); let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0) % 1000 / 159; };
// Поза конечностей для гуманоида (figure-art.js): рука side (−1/1) в гребке — [hand, elbow] в координатах фигуры
export function strokeArm(mode, side, width, time, moving) {
  const sp = time / (moving ? 360 : 700) + (side < 0 ? Math.PI : 0);
  if (mode === 'dive') { // брасс: руки вперёд, разводятся и сводятся
    const k = (Math.sin(sp) + 1) / 2;
    return { hand: [side * (0.12 + k * 0.55), 0.75 - k * 0.35, 2.75 + k * 0.1], elbow: [side * (width + 0.12 + k * 0.2), 0.3, 2.45] };
  }
  // кроль: рука описывает круг над водой и под ней
  return { hand: [side * (width + 0.12), Math.cos(sp) * 0.72, 2.25 + Math.sin(sp) * 0.62], elbow: [side * (width + 0.18), Math.cos(sp) * 0.32, 2.3 + Math.sin(sp) * 0.32] };
}
// Ноги: «ножницы» (смещение стопы вперёд-назад и вверх)
export function kickFoot(mode, side, time) {
  const k = time / (mode === 'dive' ? 240 : 190) + (side < 0 ? Math.PI : 0);
  return { dy: -0.18 + Math.sin(k) * 0.2, dz: 0.18 + Math.cos(k) * 0.12 };
}

// Нарисовать фигуру в воде: draw(dy) рисует её со сдвигом dy пикселей вниз. opts.creature — зверь/машина (не человек).
// Возвращает раскладку { mode, sink?, tilt?, ripples, bubbles } (для тестов и отладки)
export function drawSwimming(ctx, mode, x, y, unit, time, actor, draw, opts = {}) {
  if (!mode) { draw(0); return null; }
  const seed = seedOf(actor), moving = Boolean(actor.moving);
  const out = { mode, ripples: 0, bubbles: 0 };
  if (mode === 'seabed' || mode === 'seabed-deep') return drawSeabed(ctx, mode, x, y, unit, time, actor, draw, opts, seed, moving, out);
  if (mode === 'swim') {
    const sink = unit * (opts.creature ? 0.75 * (opts.size || 1) : 1.55), bob = Math.sin(time / 430 + seed) * unit * 0.07;
    const water = y - unit * 0.04;
    out.sink = sink;
    // под водой — бледно (преломление), над водой — как есть
    ctx.save(); ctx.beginPath(); ctx.rect(x - unit * 9, water, unit * 18, unit * 9); ctx.clip(); ctx.globalAlpha *= 0.2; draw(sink + bob); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(x - unit * 9, water - unit * 16, unit * 18, unit * 16); ctx.clip(); draw(sink + bob); ctx.restore();
    ctx.save();
    ctx.lineWidth = Math.max(1, unit * 0.05);
    for (let i = 0; i < 2; i++) {
      const k = (time / (moving ? 700 : 1300) + i * 0.5 + seed) % 1;
      ctx.globalAlpha = (1 - k) * 0.6; ctx.strokeStyle = '#d8eefc';
      ctx.beginPath(); ctx.ellipse(x, water, unit * (0.55 + k * 0.9), unit * (0.22 + k * 0.36), 0, 0, TAU); ctx.stroke();
      out.ripples++;
    }
    if (moving && !opts.creature) { // брызги от гребков
      const side = Math.sin(time / 360) > 0 ? 1 : -1, k = Math.abs(Math.sin(time / 360));
      ctx.globalAlpha = 0.8 * k; ctx.fillStyle = '#f2fbff';
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x + side * unit * (0.45 + i * 0.08), water - unit * (0.15 + k * 0.35 + i * 0.07), Math.max(1, unit * 0.05), 0, TAU); ctx.fill(); }
    }
    ctx.restore();
    return out;
  }
  // ныряние: человек ложится горизонтально головой по ходу, звери покачиваются; пузыри вверх
  const angle = actor.facingAngle ?? actor.angle ?? 0, dir = Math.cos(angle) - Math.sin(angle) >= 0 ? 1 : -1;
  const tilt = opts.creature ? Math.sin(time / 600 + seed) * 0.12 : dir * (1.2 + Math.sin(time / 520 + seed) * 0.06);
  const bob = Math.sin(time / 640 + seed) * unit * 0.12, px = x, py = y - unit * (opts.creature ? 0.5 : 1.25) + bob;
  out.tilt = tilt;
  ctx.save(); ctx.translate(px, py); ctx.rotate(tilt); ctx.translate(-px, -py); draw(bob + (opts.creature ? 0 : -unit * 0.4)); ctx.restore();
  ctx.save(); ctx.fillStyle = 'rgba(220,245,255,0.7)';
  for (let i = 0; i < 3; i++) {
    const k = (time / 1400 + i / 3 + seed) % 1;
    ctx.globalAlpha = 0.75 * (1 - k);
    ctx.beginPath(); ctx.arc(px + dir * unit * 0.8 + Math.sin(k * 9 + i) * unit * 0.12, py - unit * (0.6 + k * 2.2), Math.max(1, unit * (0.05 + i * 0.02)), 0, TAU); ctx.fill();
    out.bubbles++;
  }
  ctx.restore();
  return out;
}

// Робот на дне: шагает как на суше (походка не меняется), чуть утопает в иле; из-под ног — облачка мути, из корпуса — пузыри.
// Под открытой водой (seabed) фигура видна сквозь толщу: приглушена, сверху голубая толща с бликами, на поверхности — круги.
// На подводном уровне (seabed-deep) вода и так вокруг — фигура в полную силу, только муть и пузыри.
function drawSeabed(ctx, mode, x, y, unit, time, actor, draw, opts, seed, moving, out) {
  const size = opts.size || 1, sink = unit * 0.12 * size, deep = mode === 'seabed-deep', h = unit * 2.1 * size;
  out.sink = sink; out.silt = 0;
  // муть под ногами (за фигурой): при ходьбе — расходящиеся облачка, на месте — слабый ореол
  ctx.save();
  for (let i = 0; i < (moving ? 3 : 1); i++) {
    const k = (time / 900 + i / 3 + seed) % 1;
    ctx.globalAlpha = (moving ? 0.45 : 0.22) * (1 - k); ctx.fillStyle = '#9c8f6a';
    ctx.beginPath(); ctx.ellipse(x + Math.sin(i * 2.1 + seed) * unit * 0.3, y + sink * 0.5, unit * (0.35 + k * 0.6) * size, unit * (0.12 + k * 0.2) * size, 0, 0, TAU); ctx.fill();
    out.silt++;
  }
  ctx.restore();
  if (deep) draw(sink);
  else { ctx.save(); ctx.globalAlpha *= 0.62; draw(sink); ctx.restore(); }
  ctx.save();
  if (!deep) { // толща воды над роботом: мягкий голубой столб с бегущими бликами и круги на поверхности
    const top = y - h - unit * 0.5, g = ctx.createLinearGradient ? ctx.createLinearGradient(x, top, x, y) : null;
    if (g) { g.addColorStop(0, 'rgba(90,170,215,0.32)'); g.addColorStop(1, 'rgba(40,110,160,0.12)'); ctx.fillStyle = g; } else ctx.fillStyle = 'rgba(70,140,190,0.22)';
    ctx.beginPath(); ctx.ellipse(x, y - h * 0.45, unit * 0.85 * size, h * 0.62, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(210,240,255,0.5)'; ctx.lineWidth = Math.max(1, unit * 0.04);
    for (let i = 0; i < 2; i++) { const k = (time / 1100 + i * 0.5 + seed) % 1; ctx.globalAlpha = 0.5 * Math.sin(k * Math.PI); ctx.beginPath(); ctx.moveTo(x - unit * 0.5 * size, y - h * (0.2 + k * 0.6)); ctx.quadraticCurveTo(x, y - h * (0.25 + k * 0.6), x + unit * 0.5 * size, y - h * (0.2 + k * 0.6)); ctx.stroke(); }
    ctx.strokeStyle = '#d8eefc';
    for (let i = 0; i < 2; i++) { const k = (time / (moving ? 800 : 1500) + i * 0.5 + seed) % 1; ctx.globalAlpha = (1 - k) * 0.5; ctx.beginPath(); ctx.ellipse(x, y - h - unit * 0.1, unit * (0.4 + k * 0.7), unit * (0.15 + k * 0.25), 0, 0, TAU); ctx.stroke(); out.ripples++; }
  }
  ctx.fillStyle = 'rgba(220,245,255,0.75)';
  for (let i = 0; i < 3; i++) { // пузыри из корпуса поднимаются к поверхности
    const k = (time / 1700 + i / 3 + seed) % 1;
    ctx.globalAlpha = 0.7 * (1 - k);
    ctx.beginPath(); ctx.arc(x + Math.sin(k * 7 + i * 2 + seed) * unit * 0.2, y - h * (0.55 + k * 0.6), Math.max(1, unit * (0.04 + i * 0.015)), 0, TAU); ctx.fill();
    out.bubbles++;
  }
  ctx.restore();
  return out;
}
