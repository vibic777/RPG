// Выживание — общие правила для сервера (расчёт) и клиента (шкалы, подсказки, радиация на карте).
// Сытость, вода, бодрость (100 — полный, 0 — пусто) и радиация (0 — чисто, 100 — предел).
// Еда → здоровье, вода → выносливость, отдых → мана (GDD). Сервер — единственный источник истины.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./worldgen'));
  else root.Survival = factory(root.WorldGen);
})(typeof self !== 'undefined' ? self : this, function (WorldGen) {
  'use strict';

  // Настраиваемые значения (сервер задаёт из config.game, клиент — из /api/config)
  const settings = {
    survivalEnabled: true,
    survivalFoodPerMin: 1, survivalWaterPerMin: 1.4, survivalRestPerMin: 0.7,
    survivalSprintWaterFactor: 2, survivalSprintRestFactor: 1.5,
    survivalSitRestPerMin: 8, survivalSleepRestPerMin: 20, survivalUnsafeRestFactor: 0.25, survivalRestVitalsFactor: 2,
    survivalRestSafeRadius: 10,
    survivalLow: 30, survivalCritical: 10,
    survivalStarveHpPerSec: 0.2, survivalThirstHpPerSec: 0.15, survivalCanKill: false,
    survivalThirstStaminaMaxLow: 0.8, survivalThirstStaminaMaxZero: 0.5,
    survivalThirstStaminaRegenLow: 0.5, survivalThirstStaminaRegenZero: 0.25,
    survivalTiredMpRegen: 0.5, survivalExhaustedMpRegen: 0, survivalExhaustedPenalty: 0.2,
    survivalRadPerMin: 4, survivalRadDecayPerMin: 0.5, survivalRadSickAt: 50, survivalRadMaxHpLoss: 0.5,
    survivalRadCityThreshold: 0.74, survivalCratersPer128: 1, survivalCraterRadius: 6,
    survivalIllMin: 8, survivalIllDrainFactor: 2,
    survivalSpoilMin: 60, survivalSpoiledIllChance: 0.6, survivalSpoiledFactor: 0.5,
    survivalCampfireMin: 10, survivalCampfireRange: 2, survivalMaxCampfires: 2,
    survivalDrinkRange: 1.6, survivalDrinkWater: 20, survivalDrinkIllChance: 0.2, survivalDrinkRad: 2, survivalDrinkCooldownSec: 1.5,
    survivalWarnCooldownSec: 60, survivalRespawnMin: 50,
    survivalDifficultyEasy: 0.5, survivalDifficultyNormal: 1, survivalDifficultyHard: 1.5, survivalDifficultyBrutal: 2,
  };
  function configure(game) {
    for (const k of Object.keys(settings)) if (game && game[k] !== undefined) settings[k] = game[k];
  }

  const METERS = [
    { k: 'food', name: 'Сытость', icon: '🍖', color: '#c8873a', hint: 'Сытость: падает со временем. Мало — здоровье не восстанавливается, ноль — медленно убывает. Ешьте еду.' },
    { k: 'water', name: 'Вода', icon: '💧', color: '#4fa3e0', hint: 'Вода: падает быстрее при беге. Мало — меньше выносливости и она медленнее восстанавливается. Пейте воду или из реки (G).' },
    { k: 'rest', name: 'Бодрость', icon: '💤', color: '#a38ce0', hint: 'Бодрость: падает со временем. Мало — мана восстанавливается медленнее, ноль — урон и скорость ниже. Отдых — Z (сесть / спать).' },
    { k: 'rad', name: 'Радиация', icon: '☢', color: '#b8e03a', hint: 'Радиация: копится в руинах и воронках (зелёные клетки). Много — лучевая болезнь: меньше здоровья. Снимается антирадином и медленно сама.' },
  ];
  const DIFFICULTY = [
    { id: 'easy', name: 'Лёгкое', key: 'survivalDifficultyEasy' },
    { id: 'normal', name: 'Обычное', key: 'survivalDifficultyNormal' },
    { id: 'hard', name: 'Тяжёлое', key: 'survivalDifficultyHard' },
    { id: 'brutal', name: 'Суровое', key: 'survivalDifficultyBrutal' },
  ];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, d) => (Number.isFinite(v) ? v : d);

  // Состояние у героя; старые герои получают полные шкалы
  function ensure(ch) {
    const s = ch.survival && typeof ch.survival === 'object' ? ch.survival : {};
    ch.survival = {
      food: clamp(num(s.food, 100), 0, 100), water: clamp(num(s.water, 100), 0, 100),
      rest: clamp(num(s.rest, 100), 0, 100), rad: clamp(num(s.rad, 0), 0, 100),
      illUntil: num(s.illUntil, 0), off: Boolean(s.off),
    };
    return ch.survival;
  }

  // Мир: включено ли выживание и множитель сложности
  function worldMode(world) {
    const on = Boolean(settings.survivalEnabled) && !(world && world.survival === false);
    const d = DIFFICULTY.find((x) => x.id === (world && world.survivalDifficulty)) || DIFFICULTY[1];
    return { on, mul: on ? num(settings[d.key], 1) : 0, difficulty: d.id };
  }

  const isIll = (s, now) => s.illUntil > now;

  // Эффекты от шкал (чистая функция). Выключенное выживание — без эффектов
  function effects(ch, now = Date.now()) {
    const e = { hpRegen: 1, hpDrain: 0, staMax: 1, staRegen: 1, mpRegen: 1, hpMax: 1, penalty: 0, flags: [] };
    const s = ch && ch.survival;
    if (!s || s.off) return e;
    const L = settings.survivalLow, C = settings.survivalCritical;
    if (s.food <= L) { e.hpRegen = 0; e.flags.push('hungry'); }
    if (s.food <= 0) { e.hpDrain += settings.survivalStarveHpPerSec; e.flags.push('starving'); }
    if (s.water <= 0) {
      e.staMax = settings.survivalThirstStaminaMaxZero; e.staRegen = settings.survivalThirstStaminaRegenZero;
      e.hpDrain += settings.survivalThirstHpPerSec; e.flags.push('dehydrated');
    } else if (s.water <= L) { e.staMax = settings.survivalThirstStaminaMaxLow; e.staRegen = settings.survivalThirstStaminaRegenLow; e.flags.push('thirsty'); }
    if (s.rest <= C) { e.mpRegen = settings.survivalExhaustedMpRegen; e.penalty = s.rest <= 0 ? settings.survivalExhaustedPenalty : 0; e.flags.push(s.rest <= 0 ? 'exhausted' : 'tired'); }
    else if (s.rest <= L) { e.mpRegen = settings.survivalTiredMpRegen; e.flags.push('tired'); }
    if (s.rad >= settings.survivalRadSickAt) {
      const k = (s.rad - settings.survivalRadSickAt) / Math.max(1, 100 - settings.survivalRadSickAt);
      e.hpMax = 1 - settings.survivalRadMaxHpLoss * clamp(k, 0, 1);
      e.flags.push('radsick');
    }
    if (isIll(s, now)) { e.hpRegen = 0; e.flags.push('ill'); }
    return e;
  }

  // Шаг времени. ctx: { on, mul, running, rest: null|'sit'|'sleep', safe, radLevel, now }
  // Возвращает пересечённые пороги: [{ k, level: 'low'|'critical'|'empty'|'sick' }]
  function tick(ch, dt, ctx = {}) {
    const s = ensure(ch);
    s.off = !ctx.on;
    if (!ctx.on) return [];
    const now = ctx.now || Date.now();
    const m = num(ctx.mul, 1), min = dt / 60;
    const ill = isIll(s, now) ? settings.survivalIllDrainFactor : 1;
    const before = { food: s.food, water: s.water, rest: s.rest, rad: s.rad };
    s.food = clamp(s.food - settings.survivalFoodPerMin * m * ill * min, 0, 100);
    s.water = clamp(s.water - settings.survivalWaterPerMin * m * ill * (ctx.running ? settings.survivalSprintWaterFactor : 1) * min, 0, 100);
    if (ctx.rest) {
      const rate = ctx.rest === 'sleep' ? settings.survivalSleepRestPerMin : settings.survivalSitRestPerMin;
      s.rest = clamp(s.rest + rate * (ctx.safe ? 1 : settings.survivalUnsafeRestFactor) * min, 0, 100);
    } else {
      s.rest = clamp(s.rest - settings.survivalRestPerMin * m * (ctx.running ? settings.survivalSprintRestFactor : 1) * min, 0, 100);
    }
    const lvl = ctx.radLevel || 0;
    if (lvl > 0) s.rad = clamp(s.rad + settings.survivalRadPerMin * lvl * m * min, 0, 100);
    else s.rad = clamp(s.rad - settings.survivalRadDecayPerMin * min, 0, 100);
    const out = [];
    const L = settings.survivalLow, C = settings.survivalCritical;
    for (const k of ['food', 'water', 'rest']) {
      if (before[k] > 0 && s[k] <= 0) out.push({ k, level: 'empty' });
      else if (before[k] > C && s[k] <= C) out.push({ k, level: 'critical' });
      else if (before[k] > L && s[k] <= L) out.push({ k, level: 'low' });
    }
    if (before.rad < settings.survivalRadSickAt && s.rad >= settings.survivalRadSickAt) out.push({ k: 'rad', level: 'sick' });
    return out;
  }

  // Урон от голода/жажды: не убивает, если survivalCanKill выключено (остаётся 1 здоровья)
  function drainHp(hp, perSec, dt) {
    if (!(perSec > 0)) return hp;
    const floor = settings.survivalCanKill ? 0 : Math.min(hp, 1);
    return Math.max(floor, hp - perSec * dt);
  }

  // ---------- Порча еды ----------
  const spoilMs = () => Math.max(0, settings.survivalSpoilMin) * 60000;
  function isSpoiled(it, inst, now = Date.now()) {
    return Boolean(it && it.spoils && spoilMs() > 0 && inst && Number.isFinite(inst.made) && now - inst.made >= spoilMs());
  }
  function spoilLeftMs(it, inst, now = Date.now()) {
    if (!it || !it.spoils || !inst || !Number.isFinite(inst.made) || spoilMs() <= 0) return null;
    return Math.max(0, inst.made + spoilMs() - now);
  }

  // ---------- Съесть / выпить ----------
  // it.effect: { hp, stamina, mp, food, water, rest, rad }, it.ill — шанс болезни, it.cure — лечит болезнь.
  // opts: { on, now, rnd, max: { hp, stamina, mp } }. Возвращает { error } или { msgs: [] }. Меняет ch только при успехе.
  function consume(ch, it, inst, opts = {}) {
    const now = opts.now || Date.now(), rnd = opts.rnd || Math.random, on = opts.on !== false;
    const s = ensure(ch);
    const spoiled = on && isSpoiled(it, inst, now);
    const f = spoiled ? settings.survivalSpoiledFactor : 1;
    const eff = it.effect || {};
    const v = { ...ch.vitals }, sv = { ...s };
    const max = opts.max || {};
    let gain = 0;
    for (const k of ['hp', 'stamina', 'mp']) {
      if (!eff[k]) continue;
      const nv = Math.min(num(max[k], Infinity), (v[k] || 0) + eff[k] * f);
      gain += Math.max(0, nv - (v[k] || 0));
      v[k] = Math.max(v[k] || 0, nv);
    }
    if (on) {
      for (const k of ['food', 'water', 'rest']) {
        if (!eff[k]) continue;
        const nv = clamp(sv[k] + eff[k] * f, 0, 100);
        gain += Math.max(0, nv - sv[k]);
        sv[k] = nv;
      }
      if (eff.rad) { const nv = clamp(sv.rad + eff.rad, 0, 100); if (eff.rad < 0) gain += sv.rad - nv; sv.rad = nv; }
      if (it.cure && isIll(sv, now)) { sv.illUntil = 0; gain += 1; }
    }
    if (gain <= 0) return { error: `Сейчас «${it.name}» ничего не даст: показатели уже полные.` };
    const msgs = [];
    if (spoiled) msgs.push(`«${it.name}» испортилось — пользы вдвое меньше.`);
    const chance = on ? (spoiled ? Math.max(settings.survivalSpoiledIllChance, it.ill || 0) : it.ill || 0) : 0;
    if (chance > 0 && !it.cure && rnd() < chance) {
      sv.illUntil = Math.max(sv.illUntil, now) + settings.survivalIllMin * 60000;
      msgs.push(`Вам нехорошо — вы заболели (${settings.survivalIllMin} мин): голод и жажда быстрее, здоровье не восстанавливается. Лечат травы.`);
    }
    if (it.cure && s.illUntil > now && !sv.illUntil) msgs.push('Болезнь прошла.');
    ch.vitals = v;
    Object.assign(s, sv);
    return { msgs };
  }

  // ---------- Радиация на карте ----------
  // Уровень 0…3 для каждой клетки: пятна в руинах городов (шум) и воронки (круги) вдали от поселений.
  const radCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function craters(map) {
    const W = map.width, H = map.height;
    const n = Math.round(((W * H) / (128 * 128)) * settings.survivalCratersPer128);
    const rnd = WorldGen.mulberry32((WorldGen.hashString(String(map.seed)) ^ 0x5eed1234) >>> 0);
    const far = (x, y, d) => (map.settlements || []).every((s) => Math.hypot(s.x - x, s.y - y) > d) && (!map.spawn || Math.hypot(map.spawn.x - x, map.spawn.y - y) > d);
    const out = [];
    for (let tries = 0; out.length < n && tries < n * 60; tries++) {
      const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H);
      const t = WorldGen.tileAt(map, x, y);
      if (t !== WorldGen.B.WASTE && t !== WorldGen.B.DESERT && t !== WorldGen.B.CITY) continue;
      if (!far(x, y, settings.survivalCraterRadius + 12)) continue;
      out.push({ x, y, r: settings.survivalCraterRadius });
    }
    return out;
  }
  function radGrid(map) {
    if (radCache && radCache.has(map)) return radCache.get(map);
    const W = map.width, H = map.height, g = new Uint8Array(W * H);
    const seed = (WorldGen.hashString(String(map.seed)) + 777) | 0;
    const th = settings.survivalRadCityThreshold;
    const near = (x, y) => (map.settlements || []).some((s) => Math.hypot(s.x - x, s.y - y) < 10);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (map.tiles[y * W + x] !== WorldGen.B.CITY) continue;
      const v = WorldGen.valueNoise(x / 9, y / 9, seed);
      if (v > th && !near(x, y)) g[y * W + x] = v > th + (1 - th) / 2 ? 2 : 1;
    }
    for (const c of craters(map)) {
      for (let y = Math.max(0, c.y - c.r); y <= Math.min(H - 1, c.y + c.r); y++) for (let x = Math.max(0, c.x - c.r); x <= Math.min(W - 1, c.x + c.r); x++) {
        const d = Math.hypot(x - c.x, y - c.y);
        if (d > c.r || !WorldGen.BIOMES[map.tiles[y * W + x]].walkable) continue;
        const lvl = d < c.r / 3 ? 3 : d < (2 * c.r) / 3 ? 2 : 1;
        if (lvl > g[y * W + x]) g[y * W + x] = lvl;
      }
    }
    if (radCache) radCache.set(map, g);
    return g;
  }
  function radAt(map, x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 0;
    return radGrid(map)[ty * map.width + tx];
  }

  // Рядом вода (река/озеро)? Проверяются клетки в радиусе survivalDrinkRange
  function nearWater(map, x, y, range = settings.survivalDrinkRange) {
    const r = Math.ceil(range);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
      const t = WorldGen.tileAt(map, tx, ty);
      if (t !== WorldGen.B.WATER && t !== WorldGen.B.RIVER) continue;
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
      const cx = Math.max(tx, Math.min(x, tx + 1)), cy = Math.max(ty, Math.min(y, ty + 1));
      if (Math.hypot(cx - x, cy - y) <= range) return true;
    }
    return false;
  }

  const FLAG_NAMES = {
    hungry: 'Голод: здоровье не восстанавливается', starving: 'Истощение: здоровье убывает',
    thirsty: 'Жажда: меньше выносливости', dehydrated: 'Обезвоживание: выносливость вдвое меньше, здоровье убывает',
    tired: 'Усталость: мана восстанавливается медленнее', exhausted: 'Изнеможение: мана не восстанавливается, урон и скорость ниже',
    radsick: 'Лучевая болезнь: меньше здоровья', ill: 'Болезнь: голод и жажда быстрее, здоровье не восстанавливается',
  };

  return {
    settings, configure, METERS, DIFFICULTY, FLAG_NAMES, ensure, worldMode, effects, tick, drainHp,
    isSpoiled, spoilLeftMs, consume, craters, radGrid, radAt, nearWater,
  };
});
