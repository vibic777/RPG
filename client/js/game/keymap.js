// Раскладка клавиш игры: камера и движение (F1 → «Клавиши», меню → «Стрелки — камера»).
// По умолчанию стрелки ← ↑ → ↓ двигают обзор (камеру), а W A S D ведут героя или спутника, которым управляете.
// Настройка «Стрелки — камера» выключена (game.cameraArrowKeys=false или в меню) — стрелки ведут героя, как WASD,
// а обзор — Ctrl+стрелки. Цифровой блок 8/4/6/2 двигает обзор всегда.

// Клавиши свободного обзора
export const PAN_KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Numpad8: 'up', Numpad2: 'down', Numpad4: 'left', Numpad6: 'right' };
// Направления движения в координатах клеток: «вверх по экрану» = (-1, -1)
export const KEY_DIRS = {
  KeyW: [-1, -1], ArrowUp: [-1, -1], KeyS: [1, 1], ArrowDown: [1, 1],
  KeyA: [-1, 1], ArrowLeft: [-1, 1], KeyD: [1, -1], ArrowRight: [1, -1],
};
// Куда сдвигать обзор по клавише (или null): цифровой блок — всегда; стрелки — при «Стрелки — камера» или с Ctrl
export function panKeyFor(code, ctrl, arrowsPan) {
  if (!PAN_KEYS[code]) return null;
  return code.startsWith('Numpad') || ctrl || arrowsPan ? PAN_KEYS[code] : null;
}
// Ведёт ли клавиша героя / спутника: W A S D — всегда, стрелки — только если они не камера
export function moveKey(code, arrowsPan) {
  return Boolean(KEY_DIRS[code]) && !(arrowsPan && code.startsWith('Arrow'));
}
