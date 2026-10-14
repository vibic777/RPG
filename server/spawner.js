'use strict';
// Появление врагов (сервер). Мир делится на участки spawnAreaSize×spawnAreaSize клеток; участки рядом с героями
// «оживают» и заполняются группами врагов по весам биомов до предела (плотность врагов мира × доля проходимых клеток).
// Убитый враг возвращается через enemyRespawnSec; участки без героев через despawnDelaySec пустеют.
// Рядом с точкой появления героев и поселениями (безопасные зоны) враги не появляются и туда не заходят.
// Орды зомби приходят по таймеру (частота орд мира). Чистая логика: всё внешнее — в ctx, поэтому легко тестировать.
const WorldGen = require('../shared/worldgen');
const Enemies = require('../shared/enemies');
const Companions = require('../shared/companions');
const Difficulty = require('../shared/difficulty');

// Безопасная зона: около точки появления и поселений
function isSafe(map, x, y, game) {
  const s = map.spawn;
  if (s && Math.hypot(x - (s.x + 0.5), y - (s.y + 0.5)) < (map.safeRadius ?? game.spawnSafeRadius)) return true; // уровни (шаг 13) — своя маленькая зона у входа
  // Town footprints can be much larger than the legacy five-cell safe circle.
  // This prevents spawning inside the fence; combat handles entry through open gates.
  for (const t of map.towns || []) if (Math.max(Math.abs(x - (t.x + 0.5)), Math.abs(y - (t.y + 0.5))) <= t.zone + 0.5) return true;
  for (const t of map.settlements || []) if (Math.hypot(x - (t.x + 0.5), y - (t.y + 0.5)) < game.settlementSafeRadius) return true;
  return false;
}

function densityFactor(world, game) {
  return { none: 0, low: game.densityLow, normal: game.densityNormal, high: game.densityHigh }[world.enemyDensity] ?? game.densityNormal;
}

// Уровень врагов: подстройка под героев (макс. или средний уровень группы) или уровень зоны (дальше от старта — сильнее)
function partyLevel(levels, mode) {
  if (!levels.length) return 1;
  return mode === 'avg' ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : Math.max(...levels);
}
function zoneLevel(map, x, y, game) {
  const s = map.spawn || { x: 0, y: 0 };
  return 1 + Math.floor(Math.hypot(x - s.x, y - s.y) / Math.max(1, game.levelPerTiles));
}
function levelFor(ctx, x, y, def) {
  const { game, world, rnd } = ctx, maxEnemy = game.maxEnemyLevel || 99;
  const party = ctx.players.map((p) => p.level || 1);
  const profile = Difficulty.get(world.difficulty||game.difficulty);
  if (def.boss) {
    const base = party.length ? Math.round(partyLevel(party, 'avg') * profile.level) : def.level[1];
    const cap = party.length ? Math.ceil(partyLevel(party, 'max') * profile.level) : def.level[1];
    return Math.max(1, Math.min(maxEnemy, cap, Math.max(def.level[0], base)));
  }
  // Обычные враги всегда остаются в пределах уровня группы. Глубина зоны не делает
  // противников выше игроков; вид врага сам задаёт его базовую силу.
  const base = Math.max(1, Math.round((party.length ? partyLevel(party, 'avg') : zoneLevel(ctx.map, x, y, game)) * profile.level));
  const spread = party.length ? Math.max(0, game.scaleLevelSpread || 0) : 0;
  const rolled = base + Math.round((rnd() * 2 - 1) * spread);
  const hi = party.length ? Math.min(Math.ceil(partyLevel(party, 'max') * profile.level), def.level[1]) : def.level[1];
  return Math.max(1, Math.min(maxEnemy, hi, Math.max(def.level[0], rolled)));
}

// Кто может появиться на клетке: вес биома > 0 и минимальный уровень не выше уровня зоны + 1.
// Боссы появляются отдельно (со свитой), spawn: false — никогда сами; драконы — только у логов (см. dragonOk)
// dragonLair — тип ближайшего логова (fire / ice / lava / water) или false: у логова появляется только дракон его вида
function candidates(biomeKey, level, scaled, dragonLair = false) {
  const dragonId = dragonLair ? Companions.dragonForLair(dragonLair === true ? 'fire' : dragonLair) : null;
  return Enemies.ENEMIES.filter((e) => !e.boss && e.spawn && e.level[0] <= level && (e.family !== 'dragon' ? (e.biomes[biomeKey] || 0) > 0 : e.id === dragonId));
}
const countOf = (ctx, pred) => (ctx.countOf ? ctx.countOf(pred) : 0);
// Дракон может появиться у логова (не дальше dragonLairRadius), пока драконов меньше, чем логов
function dragonOk(ctx, x, y) {
  const lairs = ctx.map.lairs || [];
  const near = lairs.filter((l) => Math.hypot(l.x + 0.5 - x, l.y + 0.5 - y) <= ctx.game.dragonLairRadius);
  if (!near.length || countOf(ctx, (d) => d.family === 'dragon') >= lairs.length) return false;
  return Companions.nearestLair({ lairs: near }, x - 0.5, y - 0.5).type || 'fire';
}
// Главарь банды со свитой: редкий бросок bossSpawnChance, не больше maxBossesPerRoom одновременно
function spawnBoss(ctx, area, biome, x, y, zl) {
  const { game, rnd } = ctx;
  if (!(rnd() < game.bossSpawnChance) || countOf(ctx, (d) => d.boss) >= game.maxBossesPerRoom) return 0;
  const list = Enemies.ENEMIES.filter((e) => e.boss && e.spawn && (e.biomes[biome] || 0) > 0 && (!ctx.players.length || e.level[0] <= Math.max(...ctx.players.map((p) => p.level || 1)) + 1));
  const def = weighted(list, (e) => (e.family === 'dragon' ? 1 : e.biomes[biome]), rnd);
  if (!def) return 0;
  const boss = ctx.spawn(def, levelFor(ctx, x, y, def), x, y, area.key);
  if (!boss) return 0;
  area.alive.add(boss.id);
  if (ctx.count() >= (ctx.populationCeiling ?? game.maxEnemiesPerRoom)) return 1;
  let made = 1;
  const n = def.guardCount[0] + Math.floor(rnd() * (def.guardCount[1] - def.guardCount[0] + 1));
  for (let i = 0; i < n; i++) {
    const g = Enemies.get(def.guards[i % def.guards.length]);
    const ang = (i / n) * Math.PI * 2, px = x + Math.cos(ang) * 1.5, py = y + Math.sin(ang) * 1.5;
    const pos = spawnable(ctx, px, py) ? { x: px, y: py } : { x, y };
    const guardLevel = partyLevel(ctx.players.map((p) => p.level || 1), 'avg') || g.level[0];
    if (guardLevel < g.level[0] || ctx.count() >= (ctx.populationCeiling ?? game.maxEnemiesPerRoom)) continue;
    const e = ctx.spawn(g, Math.min(game.maxEnemyLevel || 99, g.level[1], guardLevel), pos.x, pos.y, area.key, { guardOf: boss.id });
    if (e) { area.alive.add(e.id); made++; }
  }
  if (ctx.announce && game.bossAnnounce) ctx.announce(`Где-то рядом ${def.name} со свитой (${made - 1}).`);
  return made;
}
function weighted(list, w, rnd) {
  const total = list.reduce((a, x) => a + w(x), 0);
  if (total <= 0) return null;
  let r = rnd() * total;
  for (const x of list) { r -= w(x); if (r < 0) return x; }
  return list[list.length - 1];
}

const areaKey = (ax, ay) => ax + ',' + ay;

// Предел врагов на участке
function areaCap(map, ax, ay, world, game) {
  const S = game.spawnAreaSize;
  let walk = 0, total = 0;
  for (let y = ay * S; y < Math.min(map.height, (ay + 1) * S); y++) {
    for (let x = ax * S; x < Math.min(map.width, (ax + 1) * S); x++) {
      total++;
      if (WorldGen.isWalkable(map, x, y) && !isSafe(map, x + 0.5, y + 0.5, game)) walk++;
    }
  }
  if (!total) return 0;
  return Math.round(game.areaBaseCap * densityFactor(world, game) * (walk / total));
}

// Подходит ли клетка для появления: проходима, не в безопасной зоне, не ближе spawnMinPlayerDist к героям
function spawnable(ctx, x, y) {
  const { map, game } = ctx;
  if (!WorldGen.isWalkable(map, Math.floor(x), Math.floor(y))) return false;
  if (isSafe(map, x, y, game)) return false;
  return ctx.players.every((p) => Math.hypot(p.x - x, p.y - y) >= game.spawnMinPlayerDist);
}

// Состояние появления для комнаты
function populationTarget(world, game, rnd = Math.random) {
  const base = Math.max(0, Math.min(game.maxEnemiesPerRoom || 250, Number(game.enemyPopulation) || 0));
  const density = densityFactor(world, game);
  if (!base || !density) return 0;
  return Math.min(game.maxEnemiesPerRoom || 250, Math.max(1, Math.round(base * density * (0.9 + rnd() * 0.2))));
}
function createState() {
  return { areas: new Map(), nextHordeAt: 0, populationTarget: null, orphanPending: 0, orphanReadyAt: 0 };
}

// Одна группа на участке. Возвращает число появившихся
function spawnGroup(ctx, state, area) {
  const { map, game, rnd } = ctx;
  const S = game.spawnAreaSize;
  for (let tries = 0; tries < 12; tries++) {
    const x = area.ax * S + rnd() * S, y = area.ay * S + rnd() * S;
    if (x >= map.width || y >= map.height || !spawnable(ctx, x, y)) continue;
    const biome = WorldGen.BIOMES[WorldGen.tileAt(map, Math.floor(x), Math.floor(y))].key;
    const zl = world_level(ctx, x, y);
    const boss = spawnBoss(ctx, area, biome, x, y, zl);
    if (boss) return boss;
    const def = weighted(candidates(biome, zl, true, dragonOk(ctx, x, y)), (e) => e.biomes[biome], rnd);
    if (!def) return 0;
    const free = area.cap - area.alive.size - area.pending.length;
    const roomFree = Math.max(0, (ctx.populationCeiling ?? game.maxEnemiesPerRoom) - ctx.count());
    const n = Math.max(0, Math.min(free, roomFree, def.group[0] + Math.floor(rnd() * (def.group[1] - def.group[0] + 1))));
    if (!n) return 0;
    let made = 0;
    for (let i = 0; i < n && ctx.count() < (ctx.populationCeiling ?? game.maxEnemiesPerRoom); i++) {
      const px = x + (rnd() - 0.5) * 2, py = y + (rnd() - 0.5) * 2;
      const pos = spawnable(ctx, px, py) ? { x: px, y: py } : { x, y };
      const e = ctx.count() < (ctx.populationCeiling ?? game.maxEnemiesPerRoom) ? ctx.spawn(def, levelFor(ctx, pos.x, pos.y, def), pos.x, pos.y, area.key) : null;
      if (e) { area.alive.add(e.id); made++; }
    }
    return made;
  }
  return 0;
}
const world_level = (ctx, x, y) => ctx.players.length ? partyLevel(ctx.players.map((p) => p.level || 1), 'avg') : zoneLevel(ctx.map, x, y, ctx.game);

// Шаг появления. ctx: { map, world, game, now, rnd, players: [{ x, y, level }], count() — сколько врагов в комнате,
//   spawn(def, level, x, y, areaKey) → враг, despawn(id) — убрать врага (если не в бою — вернуть true), announce(text) }
function step(ctx, state) {
  const { map, game, now, rnd } = ctx;
  const S = game.spawnAreaSize;
  const factor = densityFactor(ctx.world, game);
  if (state.populationTarget == null) state.populationTarget = populationTarget(ctx.world, game, rnd);
  ctx.populationCeiling = state.populationTarget;
  // активные участки — в радиусе spawnActiveRadius от героев
  const active = new Set();
  if (factor > 0) {
    for (const p of ctx.players) {
      const r = game.spawnActiveRadius;
      for (let ay = Math.max(0, Math.floor((p.y - r) / S)); ay <= Math.floor((p.y + r) / S); ay++) {
        for (let ax = Math.max(0, Math.floor((p.x - r) / S)); ax <= Math.floor((p.x + r) / S); ax++) {
          if (ax * S >= map.width || ay * S >= map.height) continue;
          active.add(areaKey(ax, ay));
        }
      }
    }
  }
  const eligible = [];
  for (const key of active) {
    let a = state.areas.get(key);
    if (!a) {
      const [ax, ay] = key.split(',').map(Number);
      a = { key, ax, ay, cap: areaCap(map, ax, ay, ctx.world, game), alive: new Set(), pending: [], lastActive: now };
      state.areas.set(key, a);
    }
    a.lastActive = now;
    a.pending = a.pending.filter((t) => t > now);
    if (a.alive.size + a.pending.length < a.cap) eligible.push(a);
  }
  // Одна группа за проверку в случайном активном участке. Это выравнивает плотность
  // и распределяет стартовую нагрузку по времени и карте.
  // Место убитого врага занято до конца его таймера (enemyRespawnSec) — иначе предел населения
  // сразу добирался бы группой в другом участке и враг «возвращался» мгновенно
  let reserved = 0;
  for (const a of state.areas.values()) reserved += a.pending.filter((t) => t > now).length;
  if (eligible.length && ctx.count() + reserved < state.populationTarget) {
    const area = eligible[Math.floor(rnd() * eligible.length)];
    spawnGroup(ctx, state, area);
  }
  if (state.orphanPending && state.orphanReadyAt <= now && ctx.count() < state.populationTarget && eligible.length) {
    const area = eligible[Math.floor(rnd() * eligible.length)];
    const before = ctx.count();
    spawnGroup(ctx, state, area);
    if (ctx.count() > before) state.orphanPending--;
    state.orphanReadyAt = now + game.spawnCheckSec * 1000;
  }
  // опустевшие участки
  for (const [key, a] of state.areas) {
    if (active.has(key) || now - a.lastActive < game.despawnDelaySec * 1000) continue;
    for (const id of [...a.alive]) if (ctx.despawn(id)) a.alive.delete(id);
    if (!a.alive.size) state.areas.delete(key);
  }
  stepHorde(ctx, state);
}

// Враг убит: место на участке освободится через enemyRespawnSec
function onKilled(state, e, now, game) {
  const a = e.area && state.areas.get(e.area);
  if (a) a.alive.delete(e.id);
  if (e.horde || !a) state.orphanPending = (state.orphanPending || 0) + 1;
  if (a) a.pending.push(now + game.enemyRespawnSec * 1000);
}
function updateRespawnTimers(state, now, seconds) {
  for (const area of state.areas.values()) if (area.pending.length) area.pending = area.pending.map(() => now - seconds * 1000);
  if (state.orphanPending) state.orphanReadyAt = now - seconds * 1000;
}
function onRemoved(state, e) {
  const a = e.area && state.areas.get(e.area);
  if (a) a.alive.delete(e.id);
}

// ---------- Орды ----------
function hordeIntervalMs(world, game) {
  const min = { rare: game.hordeIntervalRareMin, normal: game.hordeIntervalNormalMin, often: game.hordeIntervalOftenMin }[world.hordeFrequency];
  return min > 0 ? min * 60000 : 0;
}
const HORDE_ENEMIES = () => Enemies.ENEMIES.filter((e) => e.behaviour === 'horde' && e.spawn && !e.boss);

function stepHorde(ctx, state, force = false) {
  const { game, now, rnd, map } = ctx;
  const iv = hordeIntervalMs(ctx.world, game);
  if (!force) {
    if (!iv || !ctx.players.length || densityFactor(ctx.world, game) <= 0 || ctx.count() >= (ctx.populationCeiling ?? game.maxEnemiesPerRoom)) return 0;
    if (!state.nextHordeAt) { state.nextHordeAt = now + iv * (0.5 + rnd()); return 0; }
    if (now < state.nextHordeAt) return 0;
    state.nextHordeAt = now + iv * (0.75 + rnd() * 0.5);
  }
  const victims = ctx.players.filter((p) => !p.dead && !isSafe(map, p.x, p.y, game));
  if (!victims.length) return 0;
  const victim = victims[Math.floor(rnd() * victims.length)];
  let origin = null;
  for (let t = 0; t < 24 && !origin; t++) {
    const ang = rnd() * Math.PI * 2;
    const x = victim.x + Math.cos(ang) * game.hordeSpawnDist, y = victim.y + Math.sin(ang) * game.hordeSpawnDist;
    if (x > 0 && y > 0 && x < map.width && y < map.height && spawnable(ctx, x, y)) origin = { x, y };
  }
  if (!origin) return 0;
  const pool = HORDE_ENEMIES();
  const n = game.hordeSizeMin + Math.floor(rnd() * (game.hordeSizeMax - game.hordeSizeMin + 1));
  const zl = world_level(ctx, origin.x, origin.y);
  const maxLevel = Math.max(...victims.map((p) => p.level || 1));
  let made = 0;
  for (let i = 0; i < n && ctx.count() < (force ? game.maxEnemiesPerRoom : (ctx.populationCeiling ?? game.maxEnemiesPerRoom)); i++) {
    const list = pool.filter((e) => e.level[0] <= maxLevel);
    const def = weighted(list.length ? list : pool, (e) => (e.biomes.city || 0) + (e.biomes.waste || 0) + 1, rnd);
    const px = origin.x + (rnd() - 0.5) * 3, py = origin.y + (rnd() - 0.5) * 3;
    const pos = spawnable(ctx, px, py) ? { x: px, y: py } : origin;
    const e = ctx.spawn(def, levelFor(ctx, pos.x, pos.y, def), pos.x, pos.y, null, { horde: true, target: victim.id });
    if (e) made++;
  }
  if (made && ctx.announce) ctx.announce(`Орда зомби (${made}) идёт на ${victim.name || 'героя'}!`);
  return made;
}

module.exports = { isSafe, densityFactor, populationTarget, partyLevel, zoneLevel, levelFor, candidates, spawnBoss, dragonOk, areaCap, spawnable, createState, step, onKilled, updateRespawnTimers, onRemoved, stepHorde, hordeIntervalMs, areaKey };
