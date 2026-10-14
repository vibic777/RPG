'use strict';
// Чит-панель (шаг 20): режим бога, правка героя, телепорт, выдача предметов, спавн, убийство врагов рядом, открытие рецептов и заклинаний,
// репутация, задания и концовки. Доступ: администратор или все, если game.cheatsForAll = true (одиночная проверка).
// WS: { t: 'cheat', a, ... } → { t: 'cheat-ok', a, text, ... } или { t: 'cheat-err', message }. Каждое действие — в журнал администратора (cheat-<a>).
// Действия переиспользуют админские функции модулей (admin, inventory, combat, companions, vehicles, crafting, magic, settlements, quests, factions).
const config = require('./config');
const auth = require('./auth');
const realtime = require('./realtime');
const chat = require('./chat');
const M = require('../shared/movement');
const Magic = require('../shared/magic');
const S = require('../shared/settlements');
const { HttpError } = auth;

const G = () => config.get().game;
const round2 = (v) => Math.round(v * 100) / 100;
const mod = (n) => require('./' + n);

const allowed = (account) => Boolean(account && (account.role === 'admin' || G().cheatsForAll));

// Точка: x/y из сообщения (курсор) или рядом с героем
function pointOf(c, msg) {
  const x = Number(msg.x), y = Number(msg.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    const gd = realtime.godOf(c.account.id);
    if (x < 0 || y < 0 || x >= c.room.map.width || y >= c.room.map.height) throw new HttpError(400, 'Точка за краем карты.');
    if (!(msg.a === 'tp' && (gd.noclip || gd.fly)) && M.validatePosition(c.room.map, { x, y })) throw new HttpError(400, 'Сюда нельзя: точка за краем карты или непроходима.');
    return { x: round2(x), y: round2(y), at: 'point' };
  }
  return { x: c.pos.x, y: c.pos.y, at: 'me' };
}
const me = (c) => ({ username: c.account.username, character: c.character.id });
// Цель «как для себя» (шаг 21): who — id аккаунта игрока в этом же мире (уровне); нет — вы сами
function targetPlayer(c, msg) {
  if (!msg.who || msg.who === c.account.id) return c;
  const t = c.room.players.get(String(msg.who));
  if (!t) throw new HttpError(404, 'Игрок не найден рядом (он в другом мире или уровне).');
  return t;
}
const whoName = (c, t) => (t === c ? '' : ` (${t.character.name})`);

function info(c) {
  const map = c.room.map;
  return {
    allowed: true, god: realtime.godOf(c.account.id), speedMax: G().cheatSpeedMax, killRadius: G().cheatKillRadius,
    towns: (map.towns || []).map((t) => ({ id: t.id, name: (map.settlements[t.id] || {}).name || `#${t.id}`, x: t.x, y: t.y })),
    roles: Object.entries(S.ROLES).map(([id, r]) => ({ id, name: r.name })),
    schools: [...new Set(Magic.SPELLS.map((s) => s.school))],
    endings: Object.entries(require('../shared/quests').ENDINGS).map(([id, e]) => ({ id, name: e.name })),
    factions: Object.entries(require('../shared/factions').FACTIONS).filter(([, f]) => !f.locked).map(([id, f]) => ({ id, name: f.name })),
    active: (() => { try { return mod('quests').adminList(c.account, {}).active.map((q) => ({ id: q.id, name: q.name })); } catch { return []; } })(),
  };
}

function run(c, msg) {
  const acc = c.account, a = String(msg.a || '');
  const tc = ['god', 'edit', 'heal', 'give', 'take', 'money', 'recipes', 'spells', 'whois', 'reveal'].includes(a) ? targetPlayer(c, msg) : c;
  switch (a) {
    case 'corpses': return { text: `Трупы сохраняются ${mod('corpses').setLifetime(Number(msg.seconds))} с.` };
    case 'spawning': { const s = mod('spawner-settings').set(msg); return { text: `Спавн обновлён для всех: таймер ${s.enemyRespawnSec} с, цель ${s.enemyPopulation} врагов ±10%.` }; }
    case 'difficulty': { const s = mod('difficulty-settings').set(msg,c.room); return { text: `Сложность сервера: ${mod('difficulty-settings').MODES.find(x => x.id === s.difficulty).label}.` }; }
    case 'vehicle': return { text: mod('vehicles').cheatAction(c, String(msg.op || '')) };
    case 'info': return info(c);
    case 'reveal': { const n = mod('fog').revealAll(tc); return { text: `Карта уровня открыта${whoName(c, tc)}: +${n} клеток.` }; } // туман войны (шаг 22)
    case 'whois': { // данные игрока-цели для общей формы «Я / цель» (шаг 21)
      const ch = tc.character, v = ch.vitals || {}, inv = require('../shared/inventory');
      inv.ensure(ch);
      return { whois: { id: tc.account.id, name: ch.name, me: tc === c, level: ch.level || 1, xp: ch.xp || 0, unspentPoints: ch.unspentPoints || 0, stats: { ...(ch.stats || {}) }, inventorySlots: inv.summary(ch).capacity, hp: Math.ceil(v.hp || 0), dead: mod('combat').cbOf(tc).dead ? 1 : 0, god: realtime.godOf(tc.account.id) } };
    }
    case 'god': { const god = realtime.setGod(tc, msg.god || {}); if (tc !== c) chat.tell(tc, 'Ваш режим изменён через чит-панель.'); return { god: tc === c ? god : undefined, tgod: god, who: tc.account.id, text: 'Режим изменён' + whoName(c, tc) + '.' }; }
    case 'edit': { // уровень, опыт, очки, характеристики, шкалы (как в админке «Персонажи»)
      const ch = tc.character, old = ch.level || 1;
      const errs = mod('admin').applyEdit(ch, msg.edit || {});
      if (errs.length) throw new HttpError(400, errs.join('\n'));
      mod('combat').refreshPlayer(tc, old);
      mod('survival').sendSv(tc.room, tc, true);
      return { text: 'Герой изменён' + whoName(c, tc) + '.' };
    }
    case 'heal': { // в том числе воскрешение мёртвого героя
      mod('combat').adminHeal(acc, tc.room, tc);
      mod('admin').applyEdit(tc.character, { food: 100, water: 100, rest: 100, rad: 0, ill: false });
      mod('combat').refreshPlayer(tc, tc.character.level || 1);
      mod('survival').sendSv(tc.room, tc, true);
      return { text: (tc === c ? 'Полностью здоровы' : `${tc.character.name} полностью здоров(а)`) + ': здоровье, выносливость, мана, сытость, вода, бодрость; радиация и болезнь сняты.' };
    }
    case 'tp': {
      if (msg.level !== undefined) { mod('admin').teleport(acc, { level: msg.level }); return { text: 'Переход на уровень.' }; }
      if (msg.town !== undefined) {
        const t = (c.room.map.towns || [])[Number(msg.town)];
        if (!t) throw new HttpError(404, 'Поселение не найдено.');
        const p = realtime.freeSpawn(c.room, { x: Math.floor(t.x), y: Math.floor(t.y) + 2 });
        realtime.teleport(c, p.x, p.y);
        return { text: `Телепорт в «${(c.room.map.settlements[t.id] || {}).name || t.id}».` };
      }
      const p = pointOf(c, msg);
      realtime.teleport(c, p.x, p.y);
      return { text: 'Телепорт.' };
    }
    case 'give': { const r = mod('inventory').give(acc, { ...me(tc), item: msg.item, count: msg.count }); return { text: `Выдано${whoName(c, tc)}: ${r.name} × ${r.count}.` }; }
    case 'take': { const r = mod('inventory').take(acc, { ...me(tc), item: msg.item, count: msg.count }); return { text: `Забрано${whoName(c, tc)}: ${r.name} × ${r.count}.` }; }
    case 'money': {
      const id = S.CURRENCY[0];
      const r = mod('inventory').give(acc, { ...me(tc), item: id, count: msg.count || 1000 });
      return { text: `Деньги: ${r.name} × ${r.count}.` };
    }
    case 'spawn': {
      const kind = String(msg.kind || ''), id = String(msg.id || ''), n = Math.max(1, Math.floor(Number(msg.count) || 1));
      const p = pointOf(c, msg);
      const lvl = Math.floor(Number(msg.level)) || undefined;
      if (kind === 'enemy') { const r = mod('admin').spawn(acc, { kind: 'enemy', id, count: n, at: p.at, x: p.x, y: p.y, level: lvl, elite: Boolean(msg.elite) }); return { text: `Появились: ${r.name} × ${r.count} (ур. ${r.level}${msg.elite ? ', элита' : ''}).`, ids: r.ids }; }
      if (kind === 'item') { const r = mod('admin').spawn(acc, { kind: 'item', id, count: n, at: p.at, x: p.x, y: p.y }); return { text: `На земле: ${r.name} × ${r.count}.` }; }
      const at = p.at === 'point' ? { x: p.x, y: p.y } : {};
      if (kind === 'companion') { const r = mod('companions').adminGive({ ...me(c), def: id, level: msg.level, out: true, cheat: true, ...at }, true); return { text: `Спутник: ${r.companion.name}.`, id: r.companion.id }; }
      if (kind === 'vehicle') { const r = mod('vehicles').adminSpawn(acc, { def: id, own: true, ...at }); return { text: `Техника (ваша): ${r.vehicle.name || id}.`, id: r.vehicle.id }; }
      if (kind === 'npc') { const nn = mod('settlements').adminSpawnNpc(c.room, id, p.x, p.y, lvl || 1); return { text: `Житель: ${nn.name} (ур. ${nn.level}).`, id: nn.id }; }
      throw new HttpError(400, 'Что создать: enemy, item, companion, vehicle или npc.');
    }
    case 'kill': {
      const r = G().cheatKillRadius, cs = mod('combat').stateOf(c.room);
      const near = [...cs.enemies.values()].filter((e) => !e.dead && Math.hypot(e.x - c.pos.x, e.y - c.pos.y) <= r);
      for (const e of near) { e.hitBy.set(acc.id, e.hp); mod('combat').killEnemy(c.room, e, c); }
      return { text: `Убито врагов рядом: ${near.length}.` };
    }
    case 'recipes': { const r = mod('crafting').adminGive(acc, { ...me(tc), recipe: 'all' }); return { text: `Открыто рецептов${whoName(c, tc)}: ${r.recipes}.` }; }
    case 'spells': {
      const school = String(msg.school || 'all');
      if (school === 'all') { const r = mod('magic').adminTeach({ ...me(tc), spell: 'all' }); return { text: `Заклинаний известно${whoName(c, tc)}: ${r.spells}.` }; }
      const list = Magic.SPELLS.filter((s) => s.school === school);
      if (!list.length) throw new HttpError(400, 'Нет такой школы магии.');
      let r = null;
      for (const s of list) r = mod('magic').adminTeach({ ...me(tc), spell: s.id });
      return { text: `Школа «${school}»: изучено ${list.length}, всего известно ${r.spells}.` };
    }
    case 'rep': {
      if (msg.faction) { mod('quests').adminAct(acc, { act: 'faction', ...me(c), faction: msg.faction, value: msg.value }); return { text: 'Репутация фракции изменена.' }; }
      const r = mod('settlements').adminAct(acc, { act: 'rep', ...me(c), sid: msg.sid, value: msg.value });
      return { text: `Репутация в «${r.town}»: ${r.rep}.` };
    }
    case 'quests': { // завершить все взятые задания мира
      const list = mod('quests').adminList(acc, {}).active;
      for (const q of list) mod('quests').adminAct(acc, { act: 'complete', id: q.id });
      return { text: list.length ? `Завершено заданий: ${list.length}.` : 'Взятых заданий нет.' };
    }
    case 'ending': { mod('quests').adminAct(acc, { act: 'ending', ...me(c), ending: msg.ending || 'test' }); return { text: 'Концовка запущена.' }; }
    default: {
      const ext = mod('cheat-targets'); // шаг 21: «Персонажи» и «Стройка»
      if (ext.ACTIONS.includes(a)) return ext.run(c, msg);
      throw new HttpError(400, 'Неизвестное чит-действие.');
    }
  }
}

function onCheat(c, msg) {
  if (!allowed(c.account)) return realtime.send(c, { t: 'cheat-err', message: 'Чит-панель доступна только администратору (или включите game.cheatsForAll).' });
  if (!c.room) return;
  const a = String((msg && msg.a) || '');
  try {
    const out = run(c, msg || {});
    if (!['info', 'whois', 'list', 'pick'].includes(a)) { // чтение — не в журнал
      const { t: _t, a: _a, ...rest } = msg;
      auth.logAdmin(c.account, 'cheat-' + a, { worldId: c.room.worldId, character: c.character.name, ...rest });
      if (c.account.role !== 'admin') console.log(`[cheat] ${c.account.username}: ${a}`);
    }
    realtime.send(c, { t: a === 'info' ? 'cheat-info' : 'cheat-ok', a, ...out });
  } catch (e) {
    realtime.send(c, { t: 'cheat-err', a, message: e instanceof HttpError || e instanceof Error ? e.message : 'Ошибка.' });
    if (!(e instanceof HttpError)) console.warn('[cheat]', e && e.message);
  }
}
realtime.use({ welcome: (room, c) => ({ cheats: allowed(c.account) }), handlers: { cheat: onCheat } });

module.exports = { allowed, run, onCheat };
