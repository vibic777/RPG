// Фракции (шаг 16, GDD §6.14, §11): банды с главарями, Железная свита супер-босса, Союз поселений, Орден магов, Улей пришельцев.
// Это ДАННЫЕ и чистые расчёты (общий файл сервера и клиента): члены фракции — враги бестиария (shared/enemies.js) и роли жителей
// поселений; репутация героя у фракции −100…100 (хранится на герое: ch.factions); отношения фракций (союз / вражда) разносят
// часть каждого изменения репутации союзникам (с тем же знаком) и врагам (с обратным). Уровни — те же, что у поселений.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./settlements'));
  else root.Factions = factory(root.Settlements);
})(typeof self !== 'undefined' ? self : this, function (Settlements) {
  'use strict';

  const settings = {
    factionsEnabled: true, // фракции включены: враждебность по репутации, разнос изменений союзникам и врагам
    factionAttackAt: -15, // члены фракции нападают первыми, если репутация героя у неё не выше этого
    factionAllyShare: 0.3, // доля изменения репутации, которая достаётся союзникам фракции
    factionEnemyShare: 0.5, // доля изменения (с обратным знаком), которая достаётся врагам фракции
    factionKillRep: 6, // убийство члена фракции: −репутации у неё
    factionBossKillRep: 30, // убийство главаря: −репутации у его фракции
    factionAttackRep: 3, // удар по члену фракции, которая не враждебна: −репутации
    factionTownWeight: 0.5, // какая доля репутации Союза поселений (Ордена магов — у магов) добавляется к репутации поселения
  };
  function configure(game) {
    for (const k of Object.keys(settings)) if (game && game[k] !== undefined) settings[k] = game[k];
  }

  // kind: gang — банда (главарь boss), overlord — супер-босс, alliance — поселения, order — маги, aliens — пришельцы.
  // start — стартовая репутация; locked — репутацию не изменить (всегда враг); members — id врагов бестиария; roles — роли жителей.
  const FACTIONS = {
    raiders: { name: 'Рейдеры Ржавого Зуба', kind: 'gang', boss: 'boss_raider', start: -60, color: '#c8a03a', members: ['raider_thug', 'raider_gunner', 'raider_marauder', 'raider_sniper', 'boss_raider'], desc: 'Самая многочисленная банда пустоши: грабят караваны и поселения. Уважают силу и тех, кто бьёт мутантов.' },
    mutants: { name: 'Дети Язв', kind: 'gang', boss: 'boss_mutant', start: -60, color: '#9aff5a', members: ['mutant_irradiated', 'mutant_slasher', 'mutant_brute', 'boss_mutant'], desc: 'Облучённые последователи Пророка Язв. Ненавидят рейдеров, считают радиацию благословением.' },
    cyborgs: { name: 'Клан Шестерни', kind: 'gang', boss: 'boss_cyborg', start: -60, color: '#3a8ad8', members: ['cyborg_ripper', 'cyborg_gunner', 'boss_cyborg'], desc: 'Наёмники с имплантами под началом Командора Шестерни. Служат Патриарху ближе всех, враждуют с кланом Тени.' },
    ninja: { name: 'Клан Тени', kind: 'gang', boss: 'boss_ninja', start: -50, color: '#8a8aa8', members: ['ninja', 'boss_ninja'], desc: 'Воины-тени Мастера Безликого: дым, клинки и магия тьмы. Презирают железо киборгов.' },
    patriarch: { name: 'Железная свита', kind: 'overlord', boss: 'boss_super', start: -70, color: '#ffd84a', members: ['boss_super'], desc: 'Железный Патриарх и его власть над бандами. Банды — его союзники из страха: кто дружен с бандами, с тем Патриарх готов говорить.' },
    alliance: { name: 'Союз поселений', kind: 'alliance', start: 0, color: '#60c0ff', members: [], roles: ['trader', 'healer', 'recipes', 'quest', 'guard', 'civilian'], desc: 'Деревни, поселения, базы и убежища. Репутация Союза добавляется к репутации каждого поселения.' },
    mages: { name: 'Орден магов', kind: 'order', start: 0, color: '#b088ff', members: [], roles: ['mage'], desc: 'Маги-наставники поселений. Бродячие маги-отступники в Орден не входят.' },
    hive: { name: 'Улей', kind: 'aliens', start: -100, locked: true, color: '#e05aff', members: ['alien_spitter', 'alien_hunter', 'alien_drone', 'alien_queen'], desc: 'Пришельцы. С ними не договориться — только воевать.' },
  };
  const IDS = Object.keys(FACTIONS);
  const GANGS = IDS.filter((id) => FACTIONS[id].kind === 'gang');

  // Отношения: пары 'a|b' → 'ally' | 'enemy' (симметрично)
  const RELATIONS = {};
  const rel = (a, b, r) => { RELATIONS[`${a}|${b}`] = r; RELATIONS[`${b}|${a}`] = r; };
  rel('raiders', 'mutants', 'enemy'); rel('cyborgs', 'ninja', 'enemy');
  for (const g of GANGS) { rel(g, 'patriarch', 'ally'); rel(g, 'alliance', 'enemy'); }
  rel('patriarch', 'alliance', 'enemy'); rel('alliance', 'mages', 'ally');
  for (const f of IDS) if (f !== 'hive') rel(f, 'hive', 'enemy');
  const relation = (a, b) => (a === b ? 'self' : RELATIONS[`${a}|${b}`] || 'neutral');
  const alliesOf = (f) => IDS.filter((x) => relation(f, x) === 'ally');
  const enemiesOf = (f) => IDS.filter((x) => relation(f, x) === 'enemy');

  const BY_ENEMY = {}, BY_ROLE = {};
  for (const [id, f] of Object.entries(FACTIONS)) { for (const m of f.members) BY_ENEMY[m] = id; for (const r of f.roles || []) BY_ROLE[r] = id; }
  const ofEnemy = (defOrId) => BY_ENEMY[typeof defOrId === 'string' ? defOrId : defOrId && defOrId.id] || null;
  const ofRole = (role) => BY_ROLE[role] || null;

  const clamp = (v) => Math.max(-100, Math.min(100, Math.round((Number(v) || 0) * 10) / 10));
  // Репутация героя у фракции (нет записи — стартовая)
  function repOf(ch, f) {
    const d = FACTIONS[f];
    if (!d) return 0;
    if (d.locked) return d.start;
    const v = ch && ch.factions && ch.factions[f];
    return v == null ? d.start : clamp(v);
  }
  const all = (ch) => Object.fromEntries(IDS.map((f) => [f, repOf(ch, f)]));
  // Изменить репутацию: delta — фракции, союзникам ×allyShare, врагам ×(−enemyShare). Возвращает { f: изменение } (что реально сдвинулось).
  function change(ch, f, delta, opts = {}) {
    const out = {};
    if (!FACTIONS[f] || !delta) return out;
    ch.factions = ch.factions && typeof ch.factions === 'object' ? ch.factions : {};
    const apply = (id, d) => {
      if (FACTIONS[id].locked || !d) return;
      const before = repOf(ch, id), after = clamp(before + d);
      if (after !== before) { ch.factions[id] = after; out[id] = Math.round((after - before) * 10) / 10; }
    };
    apply(f, delta);
    if (opts.spread !== false) {
      for (const a of alliesOf(f)) apply(a, delta * settings.factionAllyShare);
      for (const e of enemiesOf(f)) apply(e, -delta * settings.factionEnemyShare);
    }
    return out;
  }
  function set(ch, f, value) {
    if (!FACTIONS[f] || FACTIONS[f].locked) return false;
    ch.factions = ch.factions && typeof ch.factions === 'object' ? ch.factions : {};
    ch.factions[f] = clamp(value);
    return true;
  }
  const tierOf = (v) => Settlements.tierOf(v);
  // Нападает ли член фракции первым на героя
  function hostile(ch, f) {
    if (!f || !settings.factionsEnabled) return true;
    const d = FACTIONS[f];
    return d.locked || repOf(ch, f) <= settings.factionAttackAt;
  }
  // Враг бестиария нападает на героя первым? (звери, зомби, роботы, драконы — вне фракций, как раньше)
  const enemyHostile = (ch, def) => hostile(ch, ofEnemy(def));
  // Можно ли уговорить члена фракции в спутники (союзная банда: дружба и выше)
  function recruitable(ch, def) {
    const f = ofEnemy(def);
    if (!f || FACTIONS[f].locked) return false;
    const t = tierOf(repOf(ch, f));
    return t === 'friendly' || t === 'honored';
  }
  // Бонус к вербовке −2…+2 (как у поселений)
  const recruitBonus = (ch, def) => { const f = ofEnemy(def); return f ? Settlements.tierBonus(repOf(ch, f)) : 0; };
  // Репутация поселения с учётом фракции: Союз (для мага — Орден) добавляет долю своей репутации
  function townRep(ch, townRep, role) {
    const f = role === 'mage' ? 'mages' : 'alliance';
    return Settlements.clampRep(Math.round(Number(townRep || 0) + repOf(ch, f) * settings.factionTownWeight));
  }
  // Изменение за убийство члена фракции (отрицательное число) или 0
  function killDelta(def) {
    const f = ofEnemy(def);
    if (!f) return { f: null, delta: 0 };
    return { f, delta: -(def.boss ? settings.factionBossKillRep : settings.factionKillRep) };
  }
  // Сколько банд дружны (≥ friendly) / не враждебны
  const gangsAtLeast = (ch, min) => GANGS.filter((g) => repOf(ch, g) >= min).length;

  function validate(Enemies) {
    const errs = [];
    for (const [id, f] of Object.entries(FACTIONS)) {
      if (!f.name || !f.desc || !f.color) errs.push(`${id}: нет имени, описания или цвета`);
      if (!(f.start >= -100 && f.start <= 100)) errs.push(`${id}: стартовая репутация вне −100…100`);
      for (const m of f.members) if (Enemies && !Enemies.get(m)) errs.push(`${id}: нет врага ${m}`);
      if (f.kind === 'gang' && (!f.boss || !f.members.includes(f.boss))) errs.push(`${id}: у банды нет главаря среди членов`);
      if (f.boss && Enemies && !(Enemies.get(f.boss) || {}).boss) errs.push(`${id}: ${f.boss} не главарь`);
    }
    for (const k of Object.keys(RELATIONS)) { const [a, b] = k.split('|'); if (!FACTIONS[a] || !FACTIONS[b]) errs.push(`отношение ${k}: нет фракции`); }
    return errs;
  }

  return {
    settings, configure, FACTIONS, IDS, GANGS, RELATIONS, relation, alliesOf, enemiesOf, ofEnemy, ofRole, clamp, repOf, all, change, set,
    tierOf, hostile, enemyHostile, recruitable, recruitBonus, townRep, killDelta, gangsAtLeast, validate,
  };
});
