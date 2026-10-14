'use strict';
// Баланс (server/tools/balance.js): герой против групп врагов по формулам игры с фиксированным ГПСЧ.
// Держит ранний бой честным: герой 1-го уровня со стартовым набором побеждает 1–2 слабых врагов,
// стая из 5 зомби для героя 10-го уровня опасна, но от неё можно убежать; никто не убивает героя своего уровня за пару ударов.
const test = require('node:test');
const assert = require('node:assert/strict');
const Combat = require('../shared/combat');
const Enemies = require('../shared/enemies');
const Rules = require('../shared/character-rules');
const config = require('../server/config');
const B = require('../server/tools/balance');

const G = config.DEFAULTS.game;
Combat.configure(G); Enemies.configure(G); Rules.configure(G);
const RUNS = 40;
function stats(s) {
  const res = Array.from({ length: RUNS }, (_, i) => B.duel({ ...s, rnd: Combat.rng(1000 + i), game: G }));
  const sorted = (f) => res.map(f).sort((a, b) => a - b);
  return { wins: res.filter((r) => r.won).length / RUNS, sec: sorted((r) => r.sec), hp: sorted((r) => r.hpFrac) };
}
const scenario = (prefix) => B.scenarios().find((s) => s.name.startsWith(prefix));

test('баланс: герой 1-го уровня со стартовым набором уверенно побеждает одного и двух слабых врагов', () => {
  for (const [name, minHp, maxSec] of [
    ['Ур. 1, стартовый набор против волка', 0.5, 6],
    ['Ур. 1, стартовый набор против рейдера-громилы', 0.5, 8],
    ['Ур. 1, стартовый набор против 2 волков', 0.3, 10],
    ['Ур. 1, стартовый набор против 2 зомби', 0.3, 15],
  ]) {
    const r = stats(scenario(name));
    assert.equal(r.wins, 1, name + ': всегда победа');
    assert.ok(r.hp[0] >= minHp, `${name}: остаётся не меньше ${minHp * 100}% здоровья (было ${Math.round(r.hp[0] * 100)}%)`);
    assert.ok(r.sec[r.sec.length - 1] <= maxSec, `${name}: бой не затягивается (${r.sec[r.sec.length - 1]} с)`);
    assert.ok(r.sec[0] >= 1, `${name}: враг не умирает мгновенно`);
  }
  // стая побольше — уже риск
  const pack = stats(scenario('Ур. 1, стартовый набор против стаи'));
  assert.equal(pack.wins, 1, 'стая опасна, но новичок может пережить бой');
  assert.ok(pack.hp[0] < 0.4, 'стая волков оставляет героя тяжело раненным');
});

test('баланс: 5 зомби для героя 10-го уровня опасны, но убежать можно', () => {
  const weak = scenario('Ур. 10, «небоевой»');
  const ttk = B.secondsToKillHero({ ...weak, game: G });
  assert.ok(ttk >= 10 && ttk <= 25, `стоящего героя стая убивает за ${ttk.toFixed(1)} с — есть время убежать, но стоять опасно`);
  assert.ok(stats(weak).wins < 0.5, 'ржавым ножом стаю не одолеть');
  const geared = stats(scenario('Ур. 10, короткий меч'));
  assert.ok(geared.wins >= 0.5, 'с приличным оружием и бронёй — чаще победа');
  assert.ok(geared.hp[Math.floor(RUNS / 2)] < 0.6 && geared.hp[Math.floor(RUNS / 2)] > 0.2, 'но с заметными потерями');
  // все, кто ходит ордой, медленнее героя — от орды можно уйти
  for (const e of Enemies.ENEMIES.filter((x) => x.behaviour === 'horde')) assert.ok(e.speed < G.heroSpeed, `${e.id}: скорость ${e.speed} < ${G.heroSpeed}`);
  assert.ok(G.hordeSizeMax <= 10, 'орда не больше 10 зомби');
});

test('баланс: ни один враг не убивает героя своего уровня за пару секунд (кроме как толпой)', () => {
  for (const e of Enemies.ENEMIES) {
    const level = e.level[0];
    const ttk = B.secondsToKillHero({ hero: { level, armor: B.START_KIT }, foes: [{ id: e.id, level }], game: G });
    assert.ok(ttk >= (e.boss ? 3 : 5), `${e.id} (ур. ${level}) убивает героя за ${ttk.toFixed(1)} с`);
  }
});
