'use strict';
// Симулятор баланса: герой против группы врагов «стенка на стенку» (все враги сразу рядом — худший случай).
// Считает по тем же формулам, что и сервер (shared/combat.js, shared/enemies.js, shared/character-rules.js):
// кто победил, за сколько секунд, сколько здоровья осталось. Эффекты со временем (яд, горение) и уклонение не учитываются.
// Справка: node server/tools/balance.js --help
const Combat = require('../../shared/combat');
const Enemies = require('../../shared/enemies');
const Items = require('../../shared/items');
const Rules = require('../../shared/character-rules');

// Типичный герой уровня level: характеристики как у стартового (Сила 3, Скрытность 2…); очки уровней — треть в Силу, треть
// в Скрытность, остальное в небоевые навыки. weak — «небоевой» герой: все очки уровней мимо Силы (меньше всего здоровья)
function typicalHero(level = 1, game = {}, weak = false) {
  const stats = { strength: 3, magic: 1, intellect: 2, stealth: 2, persuasion: 1, hacking: 1, engineering: 2, builder: 1, suggestion: 1, taming: 1, companions: 1 };
  const pts = (level - 1) * (game.statPointsPerLevel ?? 3);
  if (weak) { stats.engineering += pts; return stats; }
  stats.strength += Math.floor(pts / 3);
  stats.stealth += Math.floor(pts / 3);
  stats.engineering += pts - 2 * Math.floor(pts / 3);
  return stats;
}

// hero: { level, stats?, weapon (id), armor: [id…] }; foes: [{ id, level, n }]; rnd — ГПСЧ; dt — шаг, с; maxSec — предел
function duel({ hero, foes, rnd = Combat.rng(1), dt = 0.05, maxSec = 120, game = {} }) {
  const stats = hero.stats || typicalHero(hero.level, game, hero.weak);
  const maxHp = Rules.derive(stats, hero.level).maxHp;
  const prof = Combat.profile(hero.weapon ? Items.get(hero.weapon) : null);
  const equipment = {};
  (hero.armor || []).forEach((id, i) => { equipment['s' + i] = { id }; });
  const def = Combat.heroDefense({ inventory: { equipment } });
  const enemies = [];
  for (const f of foes) {
    const d = Enemies.get(f.id);
    const st = Enemies.statsAt(d, f.level);
    for (let i = 0; i < (f.n || 1); i++) enemies.push({ d, hp: st.maxHp, st, next: rnd() * (1000 / d.attack.speed) });
  }
  let hp = maxHp, t = 0, heroNext = 0, dealt = 0, taken = 0;
  const kills = [];
  while (t < maxSec * 1000) {
    const alive = enemies.filter((e) => e.hp > 0);
    if (!alive.length || hp <= 0) break;
    if (t >= heroNext) { // герой бьёт самого слабого
      const e = alive.reduce((a, b) => (b.hp < a.hp ? b : a));
      // В расчет включаем групповые удары, которые реально проходят в радиусе и секторе цели.
      const targets = prof.kind === 'melee' && prof.flags.includes('cleave') ? alive.filter((x) => x.hp > 0) : [e];
      for (const target of targets) {
        const roll = Combat.rollDamage(prof, stats, rnd);
        const dmg = Combat.mitigate(roll.amount, roll.type, target.st.defense, target.d.resist, prof.flags || []);
        target.hp -= dmg; dealt += dmg;
        if (target.hp <= 0) kills.push(t / 1000);
      }
      heroNext = t + Combat.cooldownMs(prof);
    }
    for (const e of alive) {
      if (e.hp <= 0 || t < e.next) continue;
      const [a, b] = e.st.damage;
      const dmg = Combat.mitigate(a + (b - a) * rnd(), e.d.attack.type, def.defense, def.resist, e.d.attack.flags);
      hp -= dmg; taken += dmg;
      e.next = t + 1000 / e.d.attack.speed;
    }
    t += dt * 1000;
  }
  const won = hp > 0 && enemies.every((e) => e.hp <= 0);
  return { won, sec: Math.round(t) / 1000, hpLeft: Math.max(0, Math.round(hp)), maxHp, hpFrac: Math.max(0, hp) / maxHp, kills, dealt: Math.round(dealt), taken: Math.round(taken), heroDps: dealt / Math.max(0.001, t / 1000), enemyDps: taken / Math.max(0.001, t / 1000) };
}

// Сколько секунд группа убивает стоящего на месте героя (герой не бьёт в ответ) — запас времени, чтобы убежать
function secondsToKillHero({ hero, foes, rnd = Combat.rng(1), game = {} }) {
  const stats = hero.stats || typicalHero(hero.level, game, hero.weak);
  const maxHp = Rules.derive(stats, hero.level).maxHp;
  const equipment = {};
  (hero.armor || []).forEach((id, i) => { equipment['s' + i] = { id }; });
  const def = Combat.heroDefense({ inventory: { equipment } });
  let dps = 0;
  for (const f of foes) {
    const d = Enemies.get(f.id), st = Enemies.statsAt(d, f.level);
    let sum = 0;
    for (let i = 0; i < 200; i++) sum += Combat.mitigate(st.damage[0] + (st.damage[1] - st.damage[0]) * rnd(), d.attack.type, def.defense, def.resist, d.attack.flags);
    dps += (sum / 200) * d.attack.speed * (f.n || 1);
  }
  return maxHp / Math.max(0.001, dps);
}

// Набор эталонных сценариев (их проверяет test/balance.test.js, их же печатает командная строка)
const START_KIT = ['shirt_canvas', 'pants_burlap', 'feet_wraps'];
function scenarios() {
  return [
    { name: 'Ур. 1, стартовый набор против волка', hero: { level: 1, weapon: 'knife_rusty', armor: START_KIT }, foes: [{ id: 'wolf', level: 1 }] },
    { name: 'Ур. 1, стартовый набор против 2 волков', hero: { level: 1, weapon: 'knife_rusty', armor: START_KIT }, foes: [{ id: 'wolf', level: 1, n: 2 }] },
    { name: 'Ур. 1, стартовый набор против рейдера-громилы', hero: { level: 1, weapon: 'knife_rusty', armor: START_KIT }, foes: [{ id: 'raider_thug', level: 1 }] },
    { name: 'Ур. 1, стартовый набор против 2 зомби', hero: { level: 1, weapon: 'knife_rusty', armor: START_KIT }, foes: [{ id: 'zombie', level: 1, n: 2 }] },
    { name: 'Ур. 1, стартовый набор против стаи из 4 волков', hero: { level: 1, weapon: 'knife_rusty', armor: START_KIT }, foes: [{ id: 'wolf', level: 1, n: 4 }] },
    { name: 'Ур. 10, «небоевой» герой со стартовым ножом против 5 зомби ур. 10', hero: { level: 10, weak: true, weapon: 'knife_rusty', armor: START_KIT }, foes: [{ id: 'zombie', level: 10, n: 5 }] },
    { name: 'Ур. 10, короткий меч и кожаный доспех против 5 зомби ур. 10', hero: { level: 10, weapon: 'sword_short', armor: ['armor_leather', 'outer_leather', 'pants_work', 'feet_boots'] }, foes: [{ id: 'zombie', level: 10, n: 5 }] },
  ];
}

module.exports = { duel, typicalHero, secondsToKillHero, scenarios, START_KIT };

if (require.main === module) {
  const config = require('../config');
  const HELP = {
    usage: 'node server/tools/balance.js [параметры]',
    description: 'Симулятор баланса: герой против групп врагов по формулам игры (с учётом настроек config.json и --set).\n' +
      'Печатает для эталонных сценариев: победа или поражение, время боя, остаток здоровья, за сколько секунд группа убила бы героя.',
    flags: { '--runs': { arg: '<N>', desc: 'сколько боёв на сценарий (разные случайные броски), по умолчанию 50', name: 'runs' } },
    examples: ['node server/tools/balance.js', 'npm run balance -- --set game.enemyDamagePerLevel=0.05'],
  };
  const { cfg, args } = config.cli(process.argv.slice(2), HELP);
  const g = cfg.game;
  Combat.configure(g); Enemies.configure(g); Rules.configure(g);
  const runs = Math.max(1, Number(args.extra.runs) || 50);
  for (const s of scenarios()) {
    const res = Array.from({ length: runs }, (_, i) => duel({ ...s, rnd: Combat.rng(i + 1), game: g }));
    const wins = res.filter((r) => r.won).length;
    const sec = res.map((r) => r.sec).sort((a, b) => a - b);
    const hpl = res.map((r) => r.hpFrac).sort((a, b) => a - b);
    console.log(`${s.name}\n  побед ${wins}/${runs}; бой ${sec[0]}–${sec[sec.length - 1]} с; остаток здоровья ${Math.round(hpl[0] * 100)}–${Math.round(hpl[hpl.length - 1] * 100)}%; ` +
      `группа убивает стоящего героя за ~${secondsToKillHero({ ...s, game: g }).toFixed(1)} с`);
  }
}
