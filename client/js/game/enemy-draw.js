// Общая графика врагов и компаньонов: восемь объёмных ракурсов для каждой формы.
import { drawCreature } from './creature-art.js';
export const drawEnemy = drawCreature;
export function enemyHeight(look) {
  const h = { humanoid: 3.3, cyborg: 3.3, zombie: 3.3, quadruped: 1.65, scorpion: 1.7, ant: 1.1, spider: 1.0, mantis: 2.15, walker: 2.35, alien: 3.0, dragon: 2.4 }[look.shape] || 2;
  return h * (look.size || 1);
}