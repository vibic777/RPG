'use strict';
// Выживание на сервере (шаг 9): шкалы героя в тике боя, отдых (Z), питьё из реки/озера (G),
// костры (костровой набор) и готовка у огня (сырое мясо → жареное, грязная вода → чистая),
// предупреждения. Правила — shared/survival.js; бой (server/combat.js) спрашивает эффекты и максимумы.
const crypto = require('crypto');
const realtime = require('./realtime');
const chat = require('./chat');
const Rules = require('../shared/character-rules');
const Inv = require('../shared/inventory');
const Items = require('../shared/items');
const S = require('../shared/survival');
const WorldGen = require('../shared/worldgen');
const Settlements = require('../shared/settlements');

const round2 = (v) => Math.round(v * 100) / 100;
const svOf = (c) => c.sv || (c.sv = { rest: null, lastDrink: 0, warned: {}, key: '', sentAt: 0, radHere: 0 });
const stateOf = (room) => room.survival || (room.survival = { fires: new Map(), nextCheck: 0 });
const markDirty = (c) => { if (c.cb) c.cb.dirty = true; };

// Максимумы с учётом выживания: жажда — меньше выносливости, лучевая болезнь — меньше здоровья
function maxVitals(ch) {
  const d = Rules.derive(ch.stats, ch.level), e = S.effects(ch);
  return { hp: Math.max(1, Math.round(d.maxHp * e.hpMax)), stamina: Math.max(1, Math.round(d.maxStamina * e.staMax)), mp: d.maxMp };
}

const modeOf = (room) => S.worldMode(room && room.world);
const inSettlement = (room, pos) => WorldGen.tileAt(room.map, Math.floor(pos.x), Math.floor(pos.y)) === WorldGen.B.SETTLEMENT || Boolean(!room.level && Settlements.at(room.map, pos.x, pos.y)); // вся застройка поселения (шаг 15)
const nearBed=(room,c)=>[...require('./building').stateOf(room).pieces.values()].some(p=>require('../shared/building').get(p.type)?.bed&&Math.hypot(c.pos.x-p.x-.5,c.pos.y-p.y-.5)<=2&&require('./building').hasAccess(require('./building').stateOf(room).bases.get(p.base),c.account.id));
const restKind = (room, c) => (nearBed(room,c) || Inv.count(c.character, 'bedroll') > 0 || inSettlement(room, c.pos) ? 'sleep' : 'sit');

// Безопасно ли отдыхать: нет живых врагов ближе survivalRestSafeRadius и не было боя только что
function isSafe(c, enemies, inCombat) {
  if (inCombat) return false;
  const r = S.settings.survivalRestSafeRadius;
  for (const e of enemies ? enemies.values() : []) if (!e.dead && Math.hypot(e.x - c.pos.x, e.y - c.pos.y) <= r) return false;
  return true;
}

function publicSv(room, c) {
  const ch = c.character, s = S.ensure(ch), sv = svOf(c), now = Date.now(), mode = modeOf(room);
  return {
    on: mode.on ? 1 : 0, diff: mode.difficulty,
    // вверх: «0» на шкале — только когда она действительно пуста (и есть состояние «истощение» и т. п.)
    food: Math.ceil(s.food), water: Math.ceil(s.water), rest: Math.ceil(s.rest), rad: Math.round(s.rad),
    ill: Math.max(0, s.illUntil - now), flags: S.effects(ch, now).flags,
    resting: sv.rest, safe: sv.safe ? 1 : 0, radHere: sv.radHere,
  };
}
function sendSv(room, c, force = false) {
  const sv = svOf(c), o = publicSv(room, c);
  const key = JSON.stringify({ ...o, ill: Math.ceil(o.ill / 10000) });
  if (!force && key === sv.key) return;
  if (!force && Date.now() - sv.sentAt < 250) return;
  sv.key = key; sv.sentAt = Date.now();
  realtime.send(c, { t: 'sv', ...o });
}

const WARN = {
  food: { low: 'Вы проголодались — здоровье больше не восстанавливается. Поешьте.', critical: 'Сильный голод! Поешьте как можно скорее.', empty: 'Истощение: здоровье медленно убывает. Срочно поешьте!' },
  water: { low: 'Хочется пить — выносливость ниже. Попейте воды (или из реки: G).', critical: 'Сильная жажда! Выносливость сильно снижена.', empty: 'Обезвоживание: здоровье убывает. Срочно попейте!' },
  rest: { low: 'Вы устали — мана восстанавливается медленнее. Отдохните (Z).', critical: 'Сильная усталость: мана не восстанавливается.', empty: 'Изнеможение: урон и скорость снижены. Отдохните (Z)!' },
  rad: { sick: 'Лучевая болезнь! Максимум здоровья снижен. Уходите из зоны и примите антирадин.' },
};
function warn(c, k, level, now) {
  const sv = svOf(c), id = k + ':' + level;
  if (now - (sv.warned[id] || 0) < S.settings.survivalWarnCooldownSec * 1000) return;
  sv.warned[id] = now;
  const text = WARN[k] && WARN[k][level];
  if (text) { chat.tell(c, text); realtime.send(c, { t: 'sv-warn', k, level, text }); }
}

// Шаг героя (вызывает бой каждый тик). opts: { running, enemies, inCombat, dead }. Возвращает эффекты
function step(room, c, dt, now, opts = {}) {
  const ch = c.character, sv = svOf(c), mode = modeOf(room);
  if (sv.rest && (c.moving || opts.dead || !mode.on)) stopRest(room, c, opts.dead || !mode.on ? null : 'Вы встали.');
  if (sv.rest) sv.rest = restKind(room, c);
  sv.safe = sv.rest ? isSafe(c, opts.enemies, opts.inCombat) : false;
  const radHere = mode.on && !opts.dead ? S.radAt(room.map, c.pos.x, c.pos.y) : 0;
  if (radHere !== sv.radHere) {
    if (radHere > 0 && !sv.radHere) chat.tell(c, '☢ Радиация! Здесь заражённая зона — радиация копится. Уходите или примите антирадин.');
    sv.radHere = radHere;
  }
  const before = JSON.stringify([Math.round(ch.survival && ch.survival.food), Math.round(ch.survival && ch.survival.water), Math.round(ch.survival && ch.survival.rest), Math.round(ch.survival && ch.survival.rad)]);
  const ev = opts.dead ? [] : S.tick(ch, dt, { on: mode.on, mul: mode.mul, running: opts.running, rest: sv.rest, safe: sv.safe, radLevel: radHere, now });
  for (const x of ev) warn(c, x.k, x.level, now);
  const s = ch.survival;
  if (JSON.stringify([Math.round(s.food), Math.round(s.water), Math.round(s.rest), Math.round(s.rad)]) !== before) markDirty(c);
  sendSv(room, c);
  return S.effects(ch, now);
}

const isResting = (c) => Boolean(c.sv && c.sv.rest);

function startRest(room, c) {
  const mode = modeOf(room);
  if (!mode.on) return 'В этом мире выживание выключено — отдыхать не нужно.';
  if (c.cb && c.cb.dead) return 'Вы погибли.';
  const sv = svOf(c);
  if (sv.rest) return null;
  c.path = []; c.dir = null; c.moving = false;
  sv.rest = restKind(room, c);
  chat.tell(c, sv.rest === 'sleep'
    ? `Вы ложитесь спать${nearBed(room,c)?' на кровать базы':inSettlement(room, c.pos) ? ' в поселении' : ' на спальник'} — бодрость восстанавливается быстро. Движение — встать.`
    : 'Вы садитесь отдохнуть. Бодрость восстанавливается (со спальником или в поселении — быстрее). Движение — встать.');
  sendSv(room, c, true);
  return null;
}
function stopRest(room, c, text) {
  const sv = svOf(c);
  if (!sv.rest) return;
  sv.rest = null;
  if (text) chat.tell(c, text);
  sendSv(room, c, true);
}

// Попить из реки/озера рядом (G)
function drink(room, c, rnd = Math.random) {
  const mode = modeOf(room), ch = c.character, sv = svOf(c), now = Date.now(), set = S.settings;
  if (!mode.on) return 'В этом мире выживание выключено.';
  if (c.cb && c.cb.dead) return 'Вы погибли.';
  if (now - sv.lastDrink < set.survivalDrinkCooldownSec * 1000) return 'Не так быстро.';
  if (!S.nearWater(room.map, c.pos.x, c.pos.y)) return 'Рядом нет воды — подойдите к реке или озеру.';
  const s = S.ensure(ch);
  if (s.water >= 100) return 'Вы не хотите пить.';
  sv.lastDrink = now;
  s.water = Math.min(100, s.water + set.survivalDrinkWater);
  s.rad = Math.min(100, s.rad + set.survivalDrinkRad);
  let text = `Вы пьёте из водоёма: вода +${set.survivalDrinkWater}, радиация +${set.survivalDrinkRad}.`;
  if (rnd() < set.survivalDrinkIllChance) {
    s.illUntil = Math.max(s.illUntil, now) + set.survivalIllMin * 60000;
    text += ` Вода была грязной — вы заболели (${set.survivalIllMin} мин). Лечат травы; воду лучше очищать у костра.`;
  }
  chat.tell(c, text);
  markDirty(c);
  sendSv(room, c, true);
  return null;
}

// ---------- Костры ----------
const publicFire = (f) => ({ id: f.id, x: f.x, y: f.y, owner: f.owner, ownerName: f.ownerName, until: f.until });
function placeFire(room, c) {
  const st = stateOf(room), set = S.settings;
  const mine = [...st.fires.values()].filter((f) => f.owner === c.account.id);
  if (mine.length >= set.survivalMaxCampfires) return `Не больше ${set.survivalMaxCampfires} костров одновременно.`;
  const f = { id: 'f' + crypto.randomBytes(3).toString('hex'), x: round2(c.pos.x), y: round2(c.pos.y), owner: c.account.id, ownerName: c.character.name, until: Date.now() + set.survivalCampfireMin * 60000 };
  st.fires.set(f.id, f);
  room.broadcast({ t: 'fire-add', fire: publicFire(f) });
  chat.tell(c, `Костёр разведён (${set.survivalCampfireMin} мин). Используйте рядом сырое мясо или грязную воду — приготовятся.`);
  return null;
}
// Другие источники огня (постоянный костёр базы — server/building.js): fn(room, pos, r) → объект или null
let extraFire = null;
const setFireSource = (fn) => { extraFire = fn; };
function nearFire(room, pos) {
  const r = S.settings.survivalCampfireRange;
  for (const f of stateOf(room).fires.values()) if (Math.hypot(f.x - pos.x, f.y - pos.y) <= r) return f;
  return extraFire ? extraFire(room, pos, r) : null;
}
// Сохранение костров вместе с состоянием мира (server/combat.js snapshotState/restoreState)
const snapshotFires = (room) => [...stateOf(room).fires.values()].map((f) => ({ ...f }));
function restoreFires(room, list) {
  const st = stateOf(room), now = Date.now();
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || typeof f.id !== 'string' || !Number.isFinite(f.x) || !Number.isFinite(f.y) || !(f.until > now)) continue;
    st.fires.set(f.id, { id: f.id, x: f.x, y: f.y, owner: f.owner, ownerName: f.ownerName, until: f.until });
  }
}

// Использование предмета (shared/inventory.js useHook): костёр, готовка у огня, еда/вода со шкалами
function onUse(ch, inst, it, ctx, take) {
  const c = ctx && ctx.client, room = c && c.room;
  if (it.camp) {
    if (!room) return 'Костёр можно развести только в мире.';
    const err = placeFire(room, c);
    if (err) return err;
    take();
    return null;
  }
  if (it.cook && room && nearFire(room, c.pos)) {
    const out = Items.get(it.cook);
    const n = Math.min(inst.n, out.stack);
    const rest = inst.n - n;
    inst.id = out.id; inst.n = n; delete inst.made;
    if (rest > 0) Inv.add(ch, it.id, rest);
    chat.tell(c, `У костра: «${it.name}» → «${out.name}» × ${n}.`);
    return null;
  }
  const on = room ? modeOf(room).on : !(ch.survival && ch.survival.off);
  const r = S.consume(ch, it, inst, { on, max: maxVitals(ch) });
  if (r.error) return r.error;
  take();
  if (c) for (const m of r.msgs) chat.tell(c, m); // шкалы уйдут со следующим тиком (ch — копия записи)
  return null;
}
Inv.setUseHook(onUse);

// После смерти шкалы не ниже survivalRespawnMin (чтобы не умирать снова от голода)
function onRespawn(room, c) {
  const s = S.ensure(c.character), m = S.settings.survivalRespawnMin;
  for (const k of ['food', 'water', 'rest']) s[k] = Math.max(s[k], m);
  svOf(c).rest = null;
  sendSv(room, c, true);
}

realtime.use({
  welcome: (room, c) => {
    require('./combat').stateOf(room); // состояние мира (с кострами) загружается вместе с боем
    S.ensure(c.character);
    svOf(c).rest = null;
    return { fires: [...stateOf(room).fires.values()].map(publicFire), sv: publicSv(room, c) };
  },
  tick: (room, dt, now) => {
    const st = stateOf(room);
    if (now < st.nextCheck) return;
    st.nextCheck = now + 1000;
    for (const f of st.fires.values()) if (now >= f.until) { st.fires.delete(f.id); room.broadcast({ t: 'fire-remove', id: f.id }); }
  },
  handlers: {
    rest: (c, msg) => {
      const err = msg && msg.on === false ? (stopRest(c.room, c, 'Вы встали.'), null) : startRest(c.room, c);
      if (err) realtime.send(c, { t: 'sv-reject', message: err });
    },
    drink: (c) => {
      const err = drink(c.room, c);
      if (err) realtime.send(c, { t: 'sv-reject', message: err });
    },
  },
});

module.exports = { sendSv, setFireSource, snapshotFires, restoreFires, maxVitals, step, isResting, startRest, stopRest, drink, placeFire, nearFire, onUse, onRespawn, publicSv, stateOf, svOf };
