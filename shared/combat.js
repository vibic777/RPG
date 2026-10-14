// Правила боя — общие для сервера (расчёт) и клиента (подсказки, предсказание перезарядки).
// Только формулы и данные: сервер — единственный источник истины, клиент ничего не решает сам.
//   профиль атаки оружия (ближний бой / выстрел / конус / бросок / установка),
//   урон с учётом характеристик и крита, защита и сопротивления, опыт и уровни.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./items'), require('./character-rules'));
  else root.Combat = factory(root.Items, root.CharacterRules);
})(typeof self !== 'undefined' ? self : this, function (Items, Rules) {
  'use strict';

  // Настраиваемые значения (сервер задаёт из config.game, клиент — из /api/config)
  const settings = {
    pvpAllowed: true,
    critBase: 0.05, critPerStealth: 0.01, critMax: 0.5, critMultiplier: 1.75,
    meleeBonusPerStrength: 0.04, magicBonusPerMagic: 0.05, energyBonusPerIntellect: 0.03,
    armorK: 50, armorNonPhysicalFactor: 0.5, armorPierceFactor: 0.5, resistMax: 0.8,
    unarmedDamageMin: 1, unarmedDamageMax: 3, unarmedSpeed: 1.5, unarmedRange: 1.1,
    meleeMaxRange: 2.6,
    meleeStaminaCost: 4, heavyStaminaFactor: 1.5, magicMpCost: 4,
    sprintMultiplier: 1.5, sprintStaminaPerSec: 12,
    staminaRegenPerSec: 6, hpRegenPerSec: 0.5, mpRegenPerSec: 1, regenDelaySec: 5,
    attackSpeedTolerance: 0.85, meleeRangeTolerance: 0.6,
    durabilityLossChance: 0.25,
    cleaveArcDeg: 100, flameConeDeg: 40, spreadConeDeg: 30, spreadSecondaryFactor: 0.5,
    explosionRadius: 1.6, chainTargets: 2, chainRange: 3, chainFactor: 0.6,
    pullDistance: 3, knockbackDistance: 1.5, stunChance: 0.25, stunSec: 1, lassoHoldSec: 2.5, lassoHoldPerTaming: 0.3,
    dotDurationSec: 3, dotBurnFactor: 0.3, dotPoisonFactor: 0.4, dotBleedFactor: 0.3,
    empRobotFactor: 2, noiseRadius: 12, thrownRecoverChance: 0.6, projectileRadius: 0.25,
    trapArmSec: 1.5, trapTriggerRadius: 0.7, trapImmobilizeSec: 4, trapLifetimeMin: 30, maxTrapsPerPlayer: 8,
    turretLifetimeSec: 300,
    // турели: для справки и панели (сервер берёт те же значения из настроек)
    maxTurretsPerPlayer: 3, turretHpBase: 150, turretMaxTier: 3, turretRepairItem: 'scrap_metal', turretRepairHpPerItem: 40,
    turretUpgradeItem: 'scrap_metal', turretUpgradeCount: 6, turretUpgradeItem2: 'electronics', turretUpgradeCount2: 2,
    xpBase: 100, xpExponent: 1.5, maxLevel: 999, statPointsPerLevel: 3, xpShareRadius: 20, levelUpHeal: true,
    respawnSec: 5, respawnHpFraction: 1, deathDropItems: false, settlementVisitRadius: 3,
  };
  function configure(game) {
    for (const k of Object.keys(settings)) if (game && game[k] !== undefined) settings[k] = game[k];
  }

  // Как атакует оружие каждого класса (данные, а не ветвления по предметам):
  // kind — melee (удар в дуге), ranged (снаряд), cone (струя/конус), thrown (бросок), place (установка на землю);
  // auto — ближний бой, если дальность не больше meleeMaxRange, иначе снаряд.
  // proj — скорость снаряда, клеток/с; fx — вид эффекта для клиента.
  const CLASS_ATTACK = {
    pistol: { kind: 'ranged', proj: 32, fx: 'bullet' },
    smg: { kind: 'ranged', proj: 32, fx: 'bullet' },
    rifle: { kind: 'ranged', proj: 40, fx: 'bullet' },
    sniper: { kind: 'ranged', proj: 55, fx: 'bullet' },
    shotgun: { kind: 'ranged', proj: 28, fx: 'pellets' },
    machinegun: { kind: 'ranged', proj: 40, fx: 'bullet' },
    launcher: { kind: 'ranged', proj: 14, fx: 'grenade' },
    knife: { kind: 'melee', fx: 'slash' },
    club: { kind: 'melee', fx: 'smash' },
    sword: { kind: 'melee', fx: 'slash' },
    axe: { kind: 'melee', fx: 'slash' },
    spear: { kind: 'melee', fx: 'thrust' },
    bow: { kind: 'ranged', proj: 20, fx: 'arrow' },
    crossbow: { kind: 'ranged', proj: 26, fx: 'bolt' },
    disc: { kind: 'thrown', proj: 14, fx: 'disc' },
    laser_gun: { kind: 'ranged', proj: 60, fx: 'laser' },
    laser_sword: { kind: 'melee', fx: 'lslash' },
    lasso: { kind: 'ranged', proj: 22, fx: 'lasso' },
    fantasy: { kind: 'auto', proj: 12, fx: 'magic' },
    flamethrower: { kind: 'cone', fx: 'flame' },
    mine: { kind: 'place', fx: 'mine' },
    trap: { kind: 'place', fx: 'trap' },
    turret: { kind: 'place', fx: 'turret' },
  };
  const KIND_NAMES = { melee: 'ближний бой', ranged: 'выстрел', cone: 'струя (конус)', thrown: 'бросок', place: 'установка на землю' };

  // Особые свойства оружия, которые работают в бою (остальные — описательные)
  const FLAG_INFO = {
    stun: 'может оглушить', burn: 'поджигает (урон огнём со временем)', poison: 'отравляет (урон ядом со временем)',
    bleed: 'кровотечение (урон со временем)', cleave: 'бьёт всех врагов в дуге удара', reach: 'длинная дистанция удара',
    spread: 'разброс: задевает врагов рядом с целью', area: 'урон по площади', explosive: 'взрывается при попадании',
    chain: 'разряд перескакивает на соседние цели', pull: 'притягивает цель к владельцу', knockback: 'отбрасывает цель',
    armorPiercing: 'пробивает броню', returns: 'возвращается в руку', thrown: 'метательное',
    silent: 'бесшумное: выстрел не будит врагов вокруг', immobilize: 'обездвиживает', nonLethal: 'не ранит',
    emp: 'двойной урон роботам', automatic: 'автоматический огонь (зажмите кнопку)', burst: 'очередь', heavy: 'тяжёлое: больше тратит выносливость',
    magic: 'магическое: тратит ману, усиливается Магией', turret: 'стреляет само', trigger: 'срабатывает, когда враг наступает',
    deployable: 'устанавливается на землю', beam: 'непрерывный луч', scope: 'оптика', glow: 'светится', burnsWebs: 'выжигает паутину', spray: 'струя',
  };

  const FISTS = { id: null, name: 'Кулаки', weapon: null };

  // Профиль атаки предмета (или кулаков, если item = null)
  function profile(item) {
    if (!item || !item.weapon) {
      return {
        name: 'Кулаки', kind: 'melee', fx: 'smash', damage: [settings.unarmedDamageMin, settings.unarmedDamageMax], damageType: 'physical',
        range: settings.unarmedRange, speed: settings.unarmedSpeed, ammo: null, magazine: 0, reload: 0, flags: [], proj: 0, class: null, unarmed: true,
      };
    }
    const w = item.weapon;
    const ca = CLASS_ATTACK[w.class] || { kind: 'melee', fx: 'slash' };
    let kind = ca.kind;
    if (w.flags.includes('thrown')) kind = 'thrown';
    else if (kind === 'auto') kind = w.range <= settings.meleeMaxRange ? 'melee' : 'ranged';
    return {
      name: item.name, kind, fx: w.fx || ca.fx, proj: ca.proj || 18, damage: w.damage, damageType: w.damageType, range: w.range,
      speed: w.speed, ammo: w.ammo, magazine: w.magazine, reload: w.reload, flags: w.flags, class: w.class, unarmed: false,
    };
  }

  const ATTACK_MODES = { normal: 'Обычная атака', special: 'Особая атака', throw: 'Метание по очереди', dualThrow: 'Двойной бросок' };
  function canThrow(item) {
    return Boolean(item && item.weapon && !item.placeable && (item.weapon.throwable || ['knife','sword','axe','spear','disc','laser_sword'].includes(item.weapon.class) || ['knife','sword','axe','halberd','spear'].includes(item.icon.shape)));
  }
  function attackProfile(item, mode = 'normal', superAttack = false) {
    const p = { ...profile(item), flags: [...profile(item).flags], mode, item: item && item.id };
    if (mode === 'throw' || mode === 'dualThrow') {
      if (!canThrow(item)) return null;
      p.kind = 'thrown'; p.range = item.weapon.throwRange || (item.weapon.class === 'spear' ? 14 : item.weapon.class === 'knife' ? 10 : 9);
      p.proj = item.weapon.class === 'spear' ? 24 : 18; p.ammo = null; p.magazine = 0;
      p.fx = 'weaponThrow'; p.flags = p.flags.filter(f => !['spread','area','explosive'].includes(f));
      p.flags.push('returns'); p.speed = Math.min(2.5, p.speed); p.costMultiplier = 1.2;
    }
    if (p.kind === 'thrown') p.fx = 'weaponThrow';
    if (mode === 'special') {
      p.damage = p.damage.map(n => n * 1.65); p.speed *= 0.65; p.costMultiplier = 2;
      p.flags.push(p.kind === 'melee' ? 'cleave' : 'armorPiercing');
      if (p.kind === 'melee') p.range *= 1.15;
    }
    if (superAttack) {
      p.damage = p.damage.map(n => n * 3); p.costMultiplier = 1; p.superAttack = true;
      p.flags.push('armorPiercing', p.kind === 'melee' ? 'cleave' : 'stun');
    }
    if (p.damageType === 'energy' && p.kind !== 'melee' && p.kind !== 'thrown') p.fx = 'laser';
    if (p.damageType === 'electric' && p.kind !== 'melee' && p.kind !== 'thrown') p.fx = 'spark';
    if (item && item.material === 'plasma' && p.kind !== 'melee' && p.kind !== 'thrown') p.fx = 'plasma';
    if (p.class === 'bow' && p.damageType === 'fire' && p.kind === 'ranged') {
      p.fx = 'fireArrow';
      if (!p.flags.includes('burn')) p.flags.push('burn');
      if (superAttack) p.skyRain = true;
    }
    return p;
  }

  // Бонус урона от характеристик: ближний бой — Сила, магия — Магия, энергия и электричество — Интеллект
  function statBonus(prof, stats) {
    const s = stats || {};
    let k = 1;
    if (prof.kind === 'melee') k += (s.strength || 0) * settings.meleeBonusPerStrength;
    if (prof.flags.includes('magic')) k += (s.magic || 0) * settings.magicBonusPerMagic;
    if (prof.damageType === 'energy' || prof.damageType === 'electric') k += (s.intellect || 0) * settings.energyBonusPerIntellect;
    return k;
  }
  const critChance = (stats) => Math.min(settings.critMax, settings.critBase + ((stats && stats.stealth) || 0) * settings.critPerStealth);

  // Бросок урона атакующего (до защиты цели). rnd — функция 0..1 (на сервере — Math.random, в тестах — ГПСЧ)
  function rollDamage(prof, stats, rnd = Math.random) {
    const [a, b] = prof.damage;
    let dmg = a + (b - a) * rnd();
    dmg *= statBonus(prof, stats);
    const crit = rnd() < Math.min(1,critChance(stats)*(prof.stealthCrit?10:1));
    if (crit) dmg *= settings.critMultiplier*(prof.stealthCrit?10:1);
    return { amount: dmg, crit, type: prof.damageType };
  }

  // Защита цели: сопротивление типу урона (доля, не выше resistMax) и броня (defense; против нефизического — слабее).
  // flags: armorPiercing ослабляет броню. Ненулевой урон после защиты — минимум 1.
  function mitigate(amount, type, defense = 0, resist = {}, flags = []) {
    if (amount <= 0) return 0;
    let def = Math.max(0, defense);
    if (type !== 'physical') def *= settings.armorNonPhysicalFactor;
    if (flags.includes('armorPiercing')) def *= settings.armorPierceFactor;
    const res = Math.min(settings.resistMax, Math.max(0, (resist && resist[type]) || 0));
    const out = amount * (1 - res) * (settings.armorK / (settings.armorK + def));
    return Math.max(1, Math.round(out));
  }

  // Защита героя: сумма брони и сопротивлений надетого (сломанное — прочность 0 — не защищает)
  function heroDefense(ch) {
    let defense = 0;
    const resist = {};
    const eq = (ch && ch.inventory && ch.inventory.equipment) || {};
    for (const x of Object.values(eq)) {
      const it = x && Items.get(x.id);
      if (!it || !it.armor || x.dur === 0) continue;
      defense += it.armor.defense || 0;
      for (const [k, v] of Object.entries(it.armor.resist || {})) resist[k] = (resist[k] || 0) + v;
    }
    defense += Items.setEffects(ch).defense;
    for (const k of Object.keys(resist)) resist[k] = Math.min(settings.resistMax, resist[k]);
    return { defense, resist };
  }

  // Пауза между атаками, мс
  const cooldownMs = (prof) => (prof.speed > 0 ? 1000 / prof.speed : Infinity);
  const staminaCost = (prof) => ((['melee','thrown'].includes(prof.kind) || prof.mode === 'special') ? settings.meleeStaminaCost * (prof.flags.includes('heavy') ? settings.heavyStaminaFactor : 1) * (prof.costMultiplier || 1) : 0);
  const mpCost = (prof) => (prof.flags.includes('magic') ? settings.magicMpCost * (prof.costMultiplier || 1) : 0);

  // Боеприпасы: сколько «выстрелов» даёт один предмет боеприпасов
  const roundsPerItem = (ammoId) => { const a = Items.get(ammoId); return (a && a.rounds) || 1; };

  // ---------- Опыт и уровни ----------
  const xpToNext = (level) => Math.max(1, Math.round(settings.xpBase * Math.pow(Math.max(1, level), settings.xpExponent)));

  // Начислить опыт персонажу (запись меняется). Возвращает { gained, levels } — сколько уровней получено
  function addXp(ch, amount) {
    const gained = Math.max(0, Math.round(amount));
    ch.xp = (ch.xp || 0) + gained;
    let levels = 0;
    while ((ch.level || 1) < settings.maxLevel && ch.xp >= xpToNext(ch.level || 1)) {
      ch.xp -= xpToNext(ch.level || 1);
      ch.level = (ch.level || 1) + 1;
      ch.unspentPoints = (ch.unspentPoints || 0) + settings.statPointsPerLevel;
      levels++;
    }
    if ((ch.level || 1) >= settings.maxLevel) ch.xp = Math.min(ch.xp, xpToNext(ch.level) - 1);
    if (levels && settings.levelUpHeal) {
      const d = Rules.derive(ch.stats, ch.level);
      ch.vitals = { hp: d.maxHp, stamina: d.maxStamina, mp: d.maxMp };
    }
    return { gained, levels };
  }

  // Вложить свободные очки в характеристику. Возвращает текст ошибки или null
  function allocate(ch, stat, n = 1) {
    const def = Rules.STATS.find((s) => s.id === stat);
    if (!def) return 'Неизвестная характеристика.';
    if (!Number.isInteger(n) || n < 1) return 'Неверное количество очков.';
    if ((ch.unspentPoints || 0) < n) return 'Нет свободных очков.';
    const cap = Rules.statCap(stat, false);
    if (ch.stats[stat] + n > cap) return `«${def.label}» не может быть больше ${cap}.`;
    ch.stats[stat] += n;
    ch.unspentPoints -= n;
    return null;
  }

  // Смерть: −1 к случайной характеристике выше 1 (никогда не ниже 1), счётчик смертей
  function deathPenalty(ch, rnd = Math.random) {
    const lost = Rules.applyDeathPenalty(ch.stats, rnd);
    ch.deaths = (ch.deaths || 0) + 1;
    const d = Rules.derive(ch.stats, ch.level);
    ch.vitals = { hp: 0, stamina: Math.min(ch.vitals ? ch.vitals.stamina : d.maxStamina, d.maxStamina), mp: Math.min(ch.vitals ? ch.vitals.mp : d.maxMp, d.maxMp) };
    return lost;
  }

  // Детерминированный ГПСЧ (для воспроизводимых бросков добычи в тестах)
  function rng(seed) {
    let a = (typeof seed === 'number' ? seed : hashStr(String(seed))) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // Геометрия: угол между направлением атаки и направлением на цель, градусы
  function angleBetween(ax, ay, bx, by) {
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (!la || !lb) return 0;
    const c = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
    return (Math.acos(c) * 180) / Math.PI;
  }
  // Пересечение отрезка (x0,y0)→(x1,y1) с кругом (cx,cy,r): доля пути 0..1 или -1
  function segmentCircle(x0, y0, x1, y1, cx, cy, r) {
    const dx = x1 - x0, dy = y1 - y0;
    const fx = x0 - cx, fy = y0 - cy;
    const a = dx * dx + dy * dy;
    if (a < 1e-12) return fx * fx + fy * fy <= r * r ? 0 : -1;
    const b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
    if (c <= 0) return 0;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t >= 0 && t <= 1 ? t : -1;
  }

  return {
    settings, configure, CLASS_ATTACK, KIND_NAMES, FLAG_INFO, FISTS, profile, canThrow, attackProfile, ATTACK_MODES, statBonus, critChance, rollDamage, mitigate, heroDefense,
    cooldownMs, staminaCost, mpCost, roundsPerItem, xpToNext, addXp, allocate, deathPenalty, rng, angleBetween, segmentCircle,
  };
});
