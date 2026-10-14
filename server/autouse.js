'use strict';
// Автопомощь из сумки (панель «Автопомощь», как «Автосбор» и «Автобой»): когда шкала ниже порога, сервер сам
// использует подходящий предмет из сумки — так же, как если бы игрок нажал «Использовать» (те же проверки и правила).
// Шкалы: здоровье, мана, выносливость, сытость, вода, бодрость, радиация (антирадин), воздух под водой;
// машина, в которой вы водитель, — заправка (J) и ремонт (O) из сумки. Каждая шкала включается отдельно.
// Настройки: game.autoUseEnabled, game.autoUseThresholdPct, game.autoUseRadAt, game.autoUseIntervalSec, game.autoUseRetrySec.
const config = require('./config');
const realtime = require('./realtime');
const chat = require('./chat');
const Items = require('../shared/items');
const S = require('../shared/survival');
const V = require('../shared/vehicles');
const Levels = require('../shared/levels');

const KINDS = ['hp', 'mp', 'stamina', 'food', 'water', 'rest', 'rad', 'air', 'vehFuel', 'vehRepair'];
const NAMES = { hp: 'здоровье', mp: 'мана', stamina: 'выносливость', food: 'сытость', water: 'вода', rest: 'бодрость', rad: 'радиация', air: 'воздух', vehFuel: 'топливо машины', vehRepair: 'прочность машины' };
const G = () => config.get().game;
const modesOf = (ch) => Object.fromEntries(KINDS.map((k) => [k, Boolean(ch && ch.autoUse && ch.autoUse[k])]));
const st = (c) => c.autoUse || (c.autoUse = { next: 0, retry: {} });

// Сколько не хватает (0 — помощь не нужна) и текущая доля шкалы — для сообщения
function deficit(c, kind) {
  const ch = c.character, g = G(), thr = Math.max(0, Math.min(100, Number(g.autoUseThresholdPct) || 0)) / 100;
  if (['hp', 'mp', 'stamina'].includes(kind)) {
    const max = require('./survival').maxVitals(ch)[kind], cur = (ch.vitals && ch.vitals[kind]) || 0;
    return max > 0 && cur < max * thr ? { need: max - cur, pct: cur / max } : null;
  }
  if (['food', 'water', 'rest', 'rad'].includes(kind)) {
    if (!S.worldMode(c.room && c.room.world).on) return null;
    const s = S.ensure(ch);
    if (kind === 'rad') return s.rad >= (Number(g.autoUseRadAt) || 0) && s.rad > 0 ? { need: s.rad, pct: s.rad / 100 } : null;
    return s[kind] < 100 * thr ? { need: 100 - s[kind], pct: s[kind] / 100 } : null;
  }
  if (kind === 'air') {
    if (!(c.room && c.room.level && c.room.level.underwater)) return null;
    const lv = require('./levels'), s = lv.lvOf(c), max = Levels.breathMax(lv.scubaOn(ch));
    return Number.isFinite(s.breath) && s.breath < max * thr ? { need: max - s.breath, pct: s.breath / max } : null;
  }
  return null;
}

// Лучший предмет: хватает с наименьшим перебором; без радиации в нагрузку; при равенстве — дешевле
function pickItem(ch, kind) {
  let best = -1, bestScore = Infinity;
  const cells = ch.inventory && ch.inventory.cells || [];
  return (need) => {
    for (let i = 0; i < cells.length; i++) {
      const x = cells[i]; if (!x) continue;
      const it = Items.get(x.id); if (!it || !it.effect) continue;
      const e = it.effect[kind === 'rad' ? 'rad' : kind];
      const gain = kind === 'rad' ? -(e || 0) : (e || 0);
      if (!(gain > 0)) continue;
      let score = gain >= need ? gain - need : 1000 + need - gain;
      if (kind !== 'rad' && (it.effect.rad || 0) > 0) score += 500;
      score += (it.value || 0) / 1000;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  };
}

function useItem(c, kind, d, now) {
  const ch = c.character, i = pickItem(ch, kind)(d.need);
  if (i < 0) return false;
  const name = Items.get(ch.inventory.cells[i].id).name;
  try {
    require('./inventory').act(c.account, ch.id, { type: 'use', from: { c: 'cell', i } }, c);
  } catch (e) { return false; }
  chat.tell(c, `Автопомощь: «${name}» — ${NAMES[kind]} ${Math.round(d.pct * 100)}%.`);
  return true;
}

function vehicleHelp(c, kind) {
  const vehicles = require('./vehicles');
  const v = vehicles.vehicleOf(c);
  if (!v || !vehicles.isDriver(c)) return null;
  const def = V.get(v.def), thr = Math.max(0, Math.min(100, Number(G().autoUseThresholdPct) || 0)) / 100;
  if (!def) return null;
  if (kind === 'vehFuel') {
    if (def.fuel.type === 'none' || !(v.fuel < def.fuel.cap * thr)) return null;
    return vehicles.refuel(c, v.id) === null;
  }
  if (!(v.hp < def.hp * thr)) return null;
  return vehicles.repair(c, v.id) === null;
}

function tick(room, dt, now) {
  const g = G();
  if (!g.autoUseEnabled || now < (room.autoUseAt || 0)) return;
  room.autoUseAt = now + 400;
  for (const c of room.players.values()) {
    const ch = c.character;
    if (!ch || !ch.autoUse || !KINDS.some((k) => ch.autoUse[k])) continue;
    const s = st(c);
    if (now < s.next) continue;
    if (require('./combat').cbOf(c).dead) continue;
    for (const kind of KINDS) {
      if (!ch.autoUse[kind] || now < (s.retry[kind] || 0)) continue;
      let ok = null;
      if (kind === 'vehFuel' || kind === 'vehRepair') ok = vehicleHelp(c, kind);
      else { const d = deficit(c, kind); if (d) ok = useItem(c, kind, d, now); }
      if (ok === null) continue; // помощь не нужна
      if (ok) { s.next = now + Math.max(0.2, Number(g.autoUseIntervalSec) || 1.5) * 1000; break; }
      s.retry[kind] = now + Math.max(1, Number(g.autoUseRetrySec) || 20) * 1000; // нечем помочь — не спамить
    }
  }
}

realtime.use({ name: 'автопомощь', tick });

module.exports = { KINDS, NAMES, modesOf, deficit, tick };
