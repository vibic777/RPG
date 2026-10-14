'use strict';
// Шаг 20: «интерес» и дельта для сообщений state.
// Каждому клиенту — только сущности не дальше radius от героя (квадрат, дёшево) и только изменившиеся
// с прошлой отправки этому клиенту (подпись строки). Опорный кадр (keyframe) — все ближние заново.
// Строки — массивы [id, x, y, ...]: так шлют враги (e), жители (np) и спутники (cp).

// rows — все строки комнаты; pos — { x, y } героя; seen — Map(id → подпись), своя у клиента и списка
// opts: { radius (0 — без ограничения), delta (true — только изменения), keyframe (true — все ближние) }
function filterRows(rows, pos, seen, opts = {}) {
  const r = opts.radius > 0 ? opts.radius : Infinity, delta = opts.delta !== false, key = Boolean(opts.keyframe);
  const out = [], near = new Set();
  for (const row of rows) {
    const id = row[0];
    if (Math.abs(row[1] - pos.x) > r || Math.abs(row[2] - pos.y) > r) continue;
    near.add(id);
    if (!delta) { out.push(row); continue; }
    const sig = row.length > 3 ? row.slice(1).join(',') : row[1] + ',' + row[2];
    if (key || seen.get(id) !== sig) { out.push(row); seen.set(id, sig); }
  }
  // ушедшие из радиуса (или исчезнувшие) забываются: при возвращении придут заново
  if (delta) for (const id of seen.keys()) if (!near.has(id)) seen.delete(id);
  return out;
}

// Каждому клиенту — свой номер тика для опорного кадра, чтобы полные списки не уходили всем разом
function isKeyframe(tickNo, phase, everyTicks) {
  if (!(everyTicks > 1)) return true;
  return (tickNo + phase) % everyTicks === 0;
}

module.exports = { filterRows, isKeyframe, LISTS: ['e', 'np', 'cp'] };
