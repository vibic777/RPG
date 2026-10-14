(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Difficulty = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MODES = [
    { id: 'super_easy', label: 'Сверх лёгкая', level: 0.6, hp: 0.55, damage: 0.45, defense: 0.6, deathDrop: 0 },
    { id: 'easy', label: 'Лёгкая', level: 0.8, hp: 0.75, damage: 0.65, defense: 0.8, deathDrop: 0.05 },
    { id: 'normal', label: 'Нормально', level: 1, hp: 1, damage: 1, defense: 1, deathDrop: 0.1 },
    { id: 'medium', label: 'Средне', level: 1.08, hp: 1.12, damage: 1.1, defense: 1.1, deathDrop: 0.2 },
    { id: 'high', label: 'Высоко', level: 1.18, hp: 1.3, damage: 1.25, defense: 1.2, deathDrop: 0.35 },
    { id: 'hard', label: 'Тяжело', level: 1.32, hp: 1.55, damage: 1.5, defense: 1.35, deathDrop: 0.6 },
    { id: 'hardcore', label: 'Хардкор', level: 1.45, hp: 1.8, damage: 1.75, defense: 1.5, deathDrop: 1, resetOnDeath: true },
  ];
  const get = id => MODES.find(x => x.id === id) || MODES[2];
  return { MODES, get };
});
