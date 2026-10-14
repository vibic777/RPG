// Спутники, приручение, драконы — общие правила для сервера (расчёт, ИИ) и клиента (панель, подсказки, справка).
// Спутник хранится на герое (character.companions) и путешествует с ним между мирами:
//   { id, def (id врага из бестиария), name, level, xp, hp, kind, method, out (призван), down (до какого времени можно спасти),
//     until (внушение: до какого времени), order, stance, guard: {x, y}, food (сытость зверя 0…100), equip: { weapon, armor } }
// Вся команда, включая контейнер, ограничена «Напарниками» (1–11).
// Контейнер-уменьшитель (предмет shrinker) нужен, чтобы прятать спутников и приручать драконов;
// без него приручённые звери просто идут пешком за героем.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./enemies'), require('./items'));
  else root.Companions = factory(root.Enemies, root.Items);
})(typeof self !== 'undefined' ? self : this, function (Enemies, Items) {
  'use strict';

  const settings = {
    compEnabled: true,
    compTameBase: 0.35, compTamePerStat: 0.06, compTameLevelPenalty: 0.03, compTameHpBonus: 0.3, compTameFoodBonus: 0.15,
    compChanceMin: 0.02, compChanceMax: 0.95, compTryCooldownSec: 3, compTameRange: 3,
    compDragonFactor: 0.25, compDragonItem: 'dragon_charm', compDragonMinTaming: 5,
    compPersuadeBase: 0.25, compPersuadePerStat: 0.07, compRecruitGoldPerLevel: 0.5, compRecruitPaidBonus: 0.3, compReputationBonus: 0.1,
    compSuggestBase: 0.4, compSuggestPerStat: 0.06, compSuggestMpCost: 30, compSuggestSec: 90, compSuggestSecPerStat: 15,
    compHackBase: 0.3, compHackPerStat: 0.07, compHackItem: 'electronics',
    compFollowDist: 2.2, compGuardRadius: 6, compAggroRadius: 7, compLeash: 14, compFleeAt: 0.2, compRegenPerSec: 0.5,
    compXpShare: 0.5, compLevelHpBonus: 0.1, compReviveSec: 60, compReviveRange: 2, compReviveHp: 0.3, compPermadeath: true,
    compFoodPerMin: 1, compHungryAt: 20, compShrinkerRequired: true,
    compMountSpeed: 1.8, compMountRange: 2.5, compBreathCooldownSec: 4, compBreathRange: 6, compBreathAngle: 40, compBreathFactor: 1.2,
  };
  function configure(game) {
    for (const k of Object.keys(settings)) if (game && game[k] !== undefined) settings[k] = game[k];
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // Приказы. come/enter/exit — разовые: «ко мне» (бегом к хозяину, выйдя из машины), «войти в здание» (в ближайший дом — ждать
  // внутри), «выйти» (из машины; из дома или подземелья — на улицу, ждать у входа). Ждущий спутник (rec.wait) возвращается
  // в команду, как только хозяин придёт туда же, или по приказу «ко мне».
  const ORDERS = { follow: 'Следовать', guard: 'Охранять место', attack: 'Атаковать мою цель', board: 'Сесть в транспорт', come: 'Ко мне', enter: 'Войти в здание', exit: 'Выйти (из машины / здания)' };
  const ORDER_KEYS = { come: ',', enter: '.', exit: '/' }; // клавиши (код клавиши: Comma, Period, Slash; работают и с Shift)
  const STANCES = { aggressive: 'Агрессивно', passive: 'Пассивно' };
  const METHODS = {
    tame: { name: 'Приручение', stat: 'taming', hint: 'Связанного лассо зверя, мутанта-зверя или дракона. Еда в сумке повышает шанс.' },
    persuade: { name: 'Договор', stat: 'persuasion', hint: 'Людей и мутантов: уговорить или заплатить золотом (самородки).' },
    suggest: { name: 'Внушение', stat: 'suggestion', hint: 'Любое живое существо, на время. Тратит ману.' },
    hack: { name: 'Взлом', stat: 'hacking', hint: 'Роботов и киборгов. Тратит электронику.' },
    family: { name: 'Семья', stat: 'persuasion', hint: 'Взрослый член вашей семьи в походе (панель семьи, F3).' },
  };

  // Кем может стать враг: beast — зверь (приручение), dragon, human — человек/мутант (договор), machine — робот/киборг (взлом)
  function kindOf(def) {
    if (!def) return null;
    if (def.family === 'dragon') return 'dragon';
    if (def.family === 'animal' || def.family === 'insect') return 'beast';
    if (def.family === 'human' || def.family === 'mutant') return 'human';
    if (def.family === 'robot' || def.family === 'cyborg') return 'machine';
    if (def.family === 'alien') return 'alien';
    if (def.family === 'mage') return (def.tags || []).includes('construct') ? 'machine' : 'human';
    return 'beast'; // прочие существа подчиняются навыку приручения
  }
  // Какие способы подходят к существу
  function methodsFor(def) {
    const k = kindOf(def);
    if (!k) return [];
    if (k === 'beast' || k === 'dragon') return ['tame', ...(k === 'beast' ? ['suggest'] : [])];
    if (k === 'human') return ['persuade', 'tame', 'suggest'];
    if (k === 'machine') return def.family === 'cyborg' ? ['hack', 'suggest'] : ['hack'];
    if (k === 'alien') return ['tame', 'suggest'];
    return [];
  }
  const defaultMethod = (def) => methodsFor(def)[0] || null;

  // Шанс: база + навык − уровень цели + ранение (меньше здоровья — легче) + бонусы. Детерминирован.
  // o: { stat, level, hpFrac, food, paid, reputation, dragon }
  function chance(method, o) {
    const s = settings;
    const stat = Number(o.stat) || 0, lvl = Math.max(1, Number(o.level) || 1), hp = clamp(o.hpFrac == null ? 1 : o.hpFrac, 0, 1);
    let p;
    if (method === 'tame') p = s.compTameBase + s.compTamePerStat * stat - s.compTameLevelPenalty * lvl + s.compTameHpBonus * (1 - hp) + (o.food ? s.compTameFoodBonus : 0);
    else if (method === 'persuade') p = s.compPersuadeBase + s.compPersuadePerStat * stat - s.compTameLevelPenalty * lvl + (o.paid ? s.compRecruitPaidBonus : 0) + s.compReputationBonus * (Number(o.reputation) || 0);
    else if (method === 'suggest') p = s.compSuggestBase + s.compSuggestPerStat * stat - s.compTameLevelPenalty * lvl + s.compTameHpBonus * 0.5 * (1 - hp);
    else if (method === 'hack') p = s.compHackBase + s.compHackPerStat * stat - s.compTameLevelPenalty * lvl + s.compTameHpBonus * 0.5 * (1 - hp);
    else return 0;
    if (o.dragon) p *= s.compDragonFactor;
    return Math.round(clamp(p, s.compChanceMin, s.compChanceMax) * 1000) / 1000;
  }
  // Сколько золота просит наёмник (договор с оплатой)
  const recruitCost = (level) => Math.max(1, Math.ceil((Number(level) || 1) * settings.compRecruitGoldPerLevel));
  // Длительность внушения, секунд
  const suggestSec = (stat) => settings.compSuggestSec + settings.compSuggestSecPerStat * Math.max(0, (Number(stat) || 1) - 1);

  // Места команды: «Напарники» 1…11; контейнер не освобождает место.
  const slots = (ch) => ch && ch.cheat && ch.cheat.stats
    ? clamp(Math.floor(Number(ch.stats && ch.stats.companions) || 1), 1, 10000)
    : ch && ch.cheat && Number.isFinite(Number(ch.cheat.companionSlots))
      ? clamp(Math.floor(Number(ch.cheat.companionSlots)), 1, 10000)
      : clamp(Math.floor(Number(ch && ch.stats && ch.stats.companions) || 1), 1, 11);
  const list = (ch) => (ch && Array.isArray(ch.companions) ? ch.companions : []);
  const outCount = (ch) => list(ch).filter((c) => c.out && !c.summoned).length;
  const freeSlots = (ch) => Math.max(0, slots(ch) - list(ch).length);
  // Есть ли контейнер-уменьшитель в сумке или на поясе
  function hasShrinker(ch) {
    if (!settings.compShrinkerRequired) return true;
    const inv = ch && ch.inventory;
    if (!inv) return false;
    const all = [...(inv.cells || []), ...Object.values(inv.equipment || {})];
    return all.some((x) => x && x.id === 'shrinker');
  }

  // Характеристики спутника по уровню; люди получают бонус от снаряжения
  function statsOf(rec) {
    const def = Enemies.get(rec.def);
    if (!def) return null;
    const st = Enemies.statsAt(def, rec.level || 1);
    const k = 1 + settings.compLevelHpBonus * Math.max(0, (rec.level || 1) - 1);
    let damage = Array.isArray(st.damage) ? st.damage.slice() : [st.damage, st.damage], defense = st.defense;
    const w = rec.equip && rec.equip.weapon && Items.get(rec.equip.weapon.id);
    if (w && w.weapon && Array.isArray(w.weapon.damage) && rec.equip.weapon.dur !== 0) damage = w.weapon.damage.slice();
    for (const x of Object.values(rec.equip || {})) {
      const a = x && x.dur !== 0 && Items.get(x.id);
      if (a && a.armor) defense += a.armor.defense || 0;
    }
    const unarmed = rec.kind === 'human' && rec.loadoutInitialized && (!w || !w.weapon || rec.equip.weapon.dur === 0);
    if (unarmed) damage = [Math.max(2, (rec.level || 1) / 3), Math.max(4, (rec.level || 1) / 2)];
    // чит-панель (шаг 21): rec.cheat = { maxHp, dmg (множитель урона), speed (множитель скорости) }
    const ch = rec.cheat || {};
    if (ch.dmg > 0 || ch.skill > 0) damage = damage.map((d) => Math.max(1, Math.round(d * (ch.dmg || 1) * (ch.skill || 1))));
    const attack = unarmed ? { kind: 'melee', type: 'physical', range: 1.2, speed: 1.2 } : w && w.weapon && rec.equip.weapon.dur !== 0 ? { ...w.weapon, type: w.weapon.damageType, kind: w.weapon.ammo ? 'ranged' : 'melee' } : def.attack;
    return { maxHp: ch.maxHp > 0 ? Math.round(ch.maxHp) : Math.round(st.maxHp * k), damage, defense, speed: def.speed * (ch.speed > 0 ? ch.speed : 1), range: attack.range || def.attack.range, attack, fly: Boolean(def.fly) };
  }
  // Опыт до следующего уровня спутника
  const xpToNext = (level) => Math.round(80 * Math.pow(Math.max(1, level), 1.5));
  function addXp(rec, amount) {
    rec.xp = (rec.xp || 0) + Math.max(0, Math.round(amount));
    let ups = 0;
    while (rec.level < 40 && rec.xp >= xpToNext(rec.level)) { rec.xp -= xpToNext(rec.level); rec.level++; ups++; }
    return ups;
  }
  const canEquip = (rec) => rec && ['human', 'machine', 'alien'].includes(rec.kind);
  const eats = (rec) => rec && (rec.kind === 'beast' || rec.kind === 'dragon');
  const canMount = (rec) => Boolean(rec && (rec.kind === 'dragon' || (Enemies.get(rec.def) || {}).mountable));

  // Драконы: вид по типу логова
  const DRAGON_BY_LAIR = { fire: 'dragon_fire', ice: 'dragon_ice', lava: 'dragon_lava', water: 'dragon_water',air:'dragon_air',earth:'dragon_earth',electricity:'dragon_electricity',blood:'dragon_blood',dark:'dragon_shadow',shadow:'dragon_shadow',light:'dragon_electricity' };
  const dragonForLair = (type) => DRAGON_BY_LAIR[type] || 'dragon_fire';
  function nearestLair(map, x, y) {
    let best = null, bd = Infinity;
    for (const l of (map && map.lairs) || []) { const d = Math.hypot(l.x - x, l.y - y); if (d < bd) { bd = d; best = l; } }
    return best;
  }

  // Новый спутник из существа
  function makeRecord(def, level, method, id) {
    const kind = kindOf(def);
    const rec = { id, def: def.id, name: def.name, level: Math.max(1, level | 0), xp: 0, kind, method, out: true, order: 'follow', stance: 'aggressive', food: 100, equip: {} };
    rec.hp = statsOf(rec).maxHp;
    return rec;
  }
  // Проверка записи (импорт героя, панель ГМ)
  function sanitize(rec) {
    if (!rec || typeof rec !== 'object' || !Enemies.get(rec.def)) return null;
    const def = Enemies.get(rec.def);
    const out = {
      id: String(rec.id || '').slice(0, 24) || 'c' + Math.random().toString(16).slice(2, 10), def: def.id, name: String(rec.name || def.name).slice(0, 40),
      level: rec.cheat && rec.cheat.level ? clamp(Math.floor(Number(rec.level) || 1), 1, 100000) : clamp(Math.floor(Number(rec.level) || 1), 1, 40), xp: Math.max(0, Math.floor(Number(rec.xp) || 0)), kind: kindOf(def) || 'beast',
      method: METHODS[rec.method] ? rec.method : 'tame', out: Boolean(rec.out), order: ORDERS[rec.order] ? rec.order : 'follow',
      stance: STANCES[rec.stance] ? rec.stance : 'aggressive', food: clamp(Number(rec.food == null ? 100 : rec.food), 0, 100), equip: {},
    };
    for (const s of ['weapon', ...Items.SLOTS.map(x => x.id)]) if (rec.equip && rec.equip[s] && Items.get(rec.equip[s].id)) out.equip[s] = { ...rec.equip[s] };
    out.bag = (Array.isArray(rec.bag) ? rec.bag : []).filter(x => x && Items.get(x.id) && Number.isSafeInteger(x.n) && x.n > 0).slice(0, 64).map(x => ({ ...x }));
    out.loadoutInitialized = Boolean(rec.loadoutInitialized);
    out.mp = Math.max(0, Math.min(40 + out.level * 4, rec.mp == null ? 40 + out.level * 4 : Number(rec.mp) || 0));
    out.ammoOpen = {};
    for (const [id, value] of Object.entries(rec.ammoOpen || {})) if (Items.get(id)?.category === 'ammo' && Number.isSafeInteger(value) && value > 0) out.ammoOpen[id] = Math.min(value, Items.get(id).rounds || 1);
    const max = statsOf(out).maxHp;
    out.hp = clamp(Number(rec.hp == null ? max : rec.hp), 0, max);
    if (rec.until) out.until = Number(rec.until) || 0;
    if (rec.wait && typeof rec.wait.key === 'string' && Number.isFinite(rec.wait.x) && Number.isFinite(rec.wait.y)) out.wait = { key: rec.wait.key.slice(0, 24), x: rec.wait.x, y: rec.wait.y, name: String(rec.wait.name || '').slice(0, 60) };
    if (rec.summoned) out.summoned = true;
    if (rec.down) out.down = Number(rec.down) || 0;
    if (rec.fam) out.fam = String(rec.fam).slice(0, 24); // член семьи (шаг 17)
    if (rec.god) out.god = true; // бессмертие (чит-панель, шаг 21)
    if (rec.cheat && typeof rec.cheat === 'object') { const ch = {}; for (const k of ['maxHp', 'dmg', 'speed', 'skill', 'level']) { const v = Number(rec.cheat[k]); if (v > 0 && v <= 1000000000) ch[k] = v; } if (Object.keys(ch).length) { out.cheat = ch; out.hp = clamp(Number(rec.hp == null ? statsOf(out).maxHp : rec.hp), 0, statsOf(out).maxHp); } }
    return out;
  }

  return {
    settings, configure, ORDERS, ORDER_KEYS, STANCES, METHODS, DRAGON_BY_LAIR,
    kindOf, methodsFor, defaultMethod, chance, recruitCost, suggestSec, slots, list, outCount, freeSlots, hasShrinker,
    statsOf, xpToNext, addXp, canEquip, eats, canMount, dragonForLair, nearestLair, makeRecord, sanitize,
  };
});
