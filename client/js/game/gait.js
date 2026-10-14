// Походка без скольжения (художественный проход, ART.md §3): общие функции шага и сгиба ног.
// Фаза шага растёт с пройденным путём (actorPose: 13,5 рад на клетку, бег — 10,5), клетка ≈ 2,85 единицы фигуры.
// Опорная половина цикла: стопа стоит на земле и уходит назад ровно со скоростью тела; переносная — шаг вперёд с подъёмом.
const TAU = Math.PI * 2;
export const TILE_UNITS = 2.85;
// Полудлина шага, при которой опорная стопа неподвижна относительно земли
export const strideFor = (rate = 13.5) => (Math.PI / rate) * TILE_UNITS / 2;
const smooth = (x) => x * x * (3 - 2 * x);

// Смещение стопы вдоль хода (dy) и подъём (dz). offset — сдвиг фазы ноги (0 / π — поочерёдно).
export function gaitFoot(phase, offset, half, lift, move = 1) {
  const u = ((((phase + offset) / TAU) % 1) + 1) % 1;
  if (u < 0.5) return { dy: half * (1 - 4 * u) * move, dz: 0, stance: true };
  const v = (u - 0.5) * 2;
  return { dy: (-half + 2 * half * smooth(v)) * move, dz: Math.sin(v * Math.PI) * lift * move, stance: false };
}

// Двухзвенная нога: колено в продольной плоскости. dir = +1 — колено вперёд (человек, гуманоидный мех),
// −1 — назад (обратный «куриный» сустав шагохода, скакательный сустав задних лап).
export function legIK(hip, foot, upper, lower, dir = 1) {
  const dy = foot[1] - hip[1], dz = foot[2] - hip[2], d0 = Math.max(1e-4, Math.hypot(dy, dz));
  const d = Math.min(d0, upper + lower - 1e-4), uy = dy / d0, uz = dz / d0;
  const along = (upper * upper - lower * lower + d * d) / (2 * d), h = Math.sqrt(Math.max(0, upper * upper - along * along));
  // перпендикуляр к оси бедро—стопа, направленный вперёд для ноги, идущей вниз
  const py = -uz, pz = uy, t = upper ? along / Math.max(d, 1e-4) : 0.5;
  return [hip[0] + (foot[0] - hip[0]) * t, hip[1] + uy * along + py * h * dir, hip[2] + uz * along + pz * h * dir];
}
