'use strict';
// Чит-панель, шаг 21: вкладки «Персонажи» (любой персонаж мира — как для себя) и «Стройка» (поставить в мир что угодно, ластик).
// Цель: { k, id } — 'p' игрок (id аккаунта), 'c' спутник (в том числе дракон и член семьи в походе), 'n' житель, 'e' враг.
// Доступ и журнал — в server/cheats.js (onCheat). Игрокам «как для себя» правка идёт обычными действиями god / edit / heal / give с полем who.
const realtime = require('./realtime');
const config = require('./config');
const auth = require('./auth');
const WorldGen = require('../shared/worldgen');
const M = require('../shared/movement');
const C = require('../shared/companions');
const Enemies = require('../shared/enemies');
const Fam = require('../shared/family');
const S = require('../shared/settlements');
const W = require('../shared/worldedit');
const { HttpError } = auth;

const G = () => config.get().game;
const round2 = (v) => Math.round(v * 100) / 100;
const mod = (n) => require('./' + n);
const ACTIONS = ['list', 'pick', 't', 'allmine', 'place', 'erase'];

// Свободная клетка рядом с точкой
function near(room, p) {
  for (let r = 1; r <= 3; r++) for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
    if (WorldGen.isWalkable(room.map, Math.floor(x), Math.floor(y))) return { x: round2(x), y: round2(y) };
  }
  return { x: p.x, y: p.y };
}

// ---------- Список целей ----------
function compRows(room, c) {
  const out = [], st = mod('companions').stateOf(room), seen = new Set();
  for (const ent of st.ents.values()) {
    const o = room.players.get(ent.owner), rec = o && C.list(o.character).find((r) => r.id === ent.id);
    if (!rec) continue;
    seen.add(rec.id);
    out.push(compRow(rec, ent, o, c));
  }
  for (const rec of C.list(c.character)) if (!seen.has(rec.id)) out.push(compRow(rec, null, c, c)); // свои — и те, что в контейнере
  return out;
}
const compRow = (rec, ent, o, c) => {
  const s = C.statsOf(rec), def = Enemies.get(rec.def);
  return { k: 'c', id: rec.id, name: rec.name, kind: rec.fam ? 'семья' : def && def.tags.includes('dragon') ? 'дракон' : 'спутник', owner: o.character.name, mine: o === c ? 1 : 0,
    lvl: rec.level, hp: Math.ceil(rec.hp), max: s.maxHp, down: rec.down ? 1 : 0, god: rec.god ? 1 : 0, out: ent ? 1 : 0, x: ent ? round2(ent.x) : null, y: ent ? round2(ent.y) : null };
};
function rows(c) {
  const room = c.room, R = G().cheatListRadius, d = (o) => Math.hypot(o.x - c.pos.x, o.y - c.pos.y);
  const out = [];
  for (const p of room.players.values()) {
    const v = p.character.vitals || {}, max = mod('combat').maxVitals(p.character);
    out.push({ k: 'p', id: p.account.id, name: p.character.name, kind: p === c ? 'вы' : 'игрок', lvl: p.character.level || 1, hp: Math.ceil(v.hp || 0), max: max.hp, down: mod('combat').cbOf(p).dead ? 1 : 0, god: realtime.godOf(p.account.id).invulnerable ? 1 : 0, x: p.pos.x, y: p.pos.y });
  }
  out.push(...compRows(room, c));
  for (const n of room.stl ? room.stl.ents.values() : []) if (d(n) <= R) out.push({ k: 'n', id: n.id, name: n.name, kind: (S.ROLES[n.role] || {}).name || 'житель', lvl: n.level || 1, hp: Math.ceil(n.hp), max: n.maxHp, god: n.god ? 1 : 0, x: round2(n.x), y: round2(n.y) });
  const es = [...mod('combat').stateOf(room).enemies.values()].filter((e) => !e.dead && d(e) <= R).sort((a, b) => d(a) - d(b)).slice(0, 80);
  for (const e of es) out.push({ k: 'e', id: e.id, name: e.def.name + (e.elite ? ' (элита)' : ''), kind: e.def.tags.includes('dragon') ? 'дракон' : e.def.boss ? 'босс' : 'враг', lvl: e.level, hp: Math.ceil(e.hp), max: e.maxHp, god: e.god ? 1 : 0, x: round2(e.x), y: round2(e.y) });
  for (const b of mod('corpses').adminList(room)) if (d(b) <= R) out.push({ k: 'd', id: b.id, name: b.name + ' (труп)', kind: 'труп врага', lvl: b.level, hp: 0, max: 0, x: round2(b.x), y: round2(b.y) });
  return out;
}
// Ближайшая к точке цель (щелчок по миру)
function pick(c, x, y) {
  let best = null, bd = 1.6;
  for (const r of rows(c)) { if (r.x == null) continue; const dd = Math.hypot(r.x - x, r.y - y); if (dd < bd) { bd = dd; best = r; } }
  return best;
}

// ---------- Разрешить цель ----------
function resolve(c, k, id) {
  const room = c.room;
  id = String(id || '');
  if (k === 'p') { const p = room.players.get(id); if (!p) throw new HttpError(404, 'Игрок не найден в этом мире.'); return { k, p, name: p.character.name }; }
  if (k === 'c') {
    const ent = mod('companions').entOf(room, id);
    const owners = ent ? [room.players.get(ent.owner)] : [c];
    for (const o of owners) { const rec = o && C.list(o.character).find((r) => r.id === id); if (rec) return { k, rec, ent, o, name: rec.name }; }
    throw new HttpError(404, 'Спутник не найден.');
  }
  if (k === 'n') { const n = mod('settlements').entOf(room, id); if (!n) throw new HttpError(404, 'Житель не найден (ушёл или погиб).'); return { k, n, name: n.name }; }
  if (k === 'e') { const e = mod('combat').stateOf(room).enemies.get(id); if (!e || e.dead) throw new HttpError(404, 'Враг не найден.'); return { k, e, name: e.def.name }; }
  if (k === 'd') { const body = mod('corpses').adminList(room).find((x) => x.id === id); if (!body) throw new HttpError(404, 'Труп не найден.'); return { k, body, name: body.name }; }
  throw new HttpError(400, 'Цель: p, c, n или e.');
}
const posOf = (t) => (t.k === 'p' ? t.p.pos : t.k === 'c' ? t.ent : t.k === 'n' ? t.n : t.e);
function compChanged(t) {
  mod('combat').markDirty(t.o);
  mod('companions').sendList(t.o);
}
const num = (v, lo, hi, label) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, `${label}: от ${lo} до ${hi}.`); return n; };
const has = (e, k) => e[k] !== undefined && e[k] !== null && e[k] !== '';

// ---------- Действие над целью ----------
function act(c, msg) {
  const room = c.room, t = resolve(c, msg.k, msg.id), op = String(msg.op || '');
  if (t.k === 'p') { // игрок: как для себя — god / edit / heal / give идут с who; здесь — перемещение и смерть
    if (op === 'tphere') { if (t.p === c) throw new HttpError(400, 'Это вы.'); const p = near(room, c.pos); realtime.teleport(t.p, p.x, p.y); return `${t.name} перенесён к вам.`; }
    if (op === 'tpto') { if (t.p === c) throw new HttpError(400, 'Это вы.'); realtime.teleport(c, t.p.pos.x, t.p.pos.y); return `Вы у ${t.name}.`; }
    if (op === 'kill') { mod('combat').adminKillPlayer(c.account, room, t.p); return `${t.name} убит.`; }
    if (op === 'heal') { return null; } // через heal с who (воскрешение и шкалы)
    throw new HttpError(400, 'Для игрока: лечение, бессмертие, правка и предметы — как для себя (поле who); здесь — tphere, tpto, kill.');
  }
  if (t.k === 'c') {
    const { rec, o } = t, s0 = C.statsOf(rec);
    switch (op) {
      case 'heal': rec.down = 0; rec.hp = C.statsOf(rec).maxHp; rec.food = 100; if (rec.out && !t.ent && o.room === room) mod('companions').spawnEnt(room, o, rec); compChanged(t); return `${t.name}: здоров(а) и на ногах.`;
      case 'god': rec.god = Boolean(msg.on); compChanged(t); return `${t.name}: бессмертие ${rec.god ? 'включено' : 'выключено'}.`;
      case 'edit': {
        const e = msg.edit || {}, ch = { ...(rec.cheat || {}) };
        if (has(e, 'level')) { rec.level = Math.floor(num(e.level, 1, 100000, 'Уровень спутника')); if (rec.level > 40) ch.level = 1; }
        if (has(e, 'maxHp')) ch.maxHp = Math.round(num(e.maxHp, 1, 1000000000, 'Макс. здоровье'));
        if (has(e, 'dmg')) ch.dmg = num(e.dmg, 0.1, 100000, 'Урон (множитель)');
        if (has(e, 'speed')) ch.speed = num(e.speed, 0.1, 100000, 'Скорость (множитель)');
        if (has(e, 'skill')) ch.skill = num(e.skill, 0.1, 100000, 'Навык (множитель)');
        if (Object.keys(ch).length) rec.cheat = ch; else delete rec.cheat;
        if (has(e, 'food')) rec.food = num(e.food, 0, 100, 'Сытость');
        const max = C.statsOf(rec).maxHp;
        rec.hp = has(e, 'hp') ? Math.min(max, num(e.hp, 0, 100000, 'Здоровье')) : Math.min(max, rec.hp * (max / s0.maxHp));
        if (rec.hp <= 0) rec.hp = 1;
        if (rec.level > 40) rec.cheat = { ...(rec.cheat || {}), level: 1 };
        compChanged(t);
        return `${t.name} изменён(а).`;
      }
      case 'dismiss':
        if (rec.fam) { mod('family').sendHome(o, rec.fam, 'отпущен(а) домой'); return `${t.name} отправлен(а) домой.`; }
        mod('companions').adminRemove({ username: o.account.username, character: o.character.id, id: rec.id });
        return `${t.name} отпущен(а).`;
      case 'tphere': if (!t.ent) throw new HttpError(400, 'Спутник не в мире (в контейнере).'); Object.assign(t.ent, near(room, c.pos), { path: [], target: null }); return `${t.name} рядом с вами.`;
      case 'tpto': if (!t.ent) throw new HttpError(400, 'Спутник не в мире.'); realtime.teleport(c, t.ent.x, t.ent.y); return `Вы рядом с ${t.name}.`;
      case 'kill': if (!t.ent) throw new HttpError(400, 'Спутник не в мире.'); rec.god = false; mod('companions').knockDown(room, o, t.ent, rec); compChanged(t); return `${t.name} без сознания.`;
      case 'clone': { const r = mod('companions').adminGive({ username: o.account.username, character: o.character.id, def: rec.def, level: rec.level, out: true, cheat: true }, true); return `Клон: ${r.companion.name}.`; }
      case 'tame': throw new HttpError(400, `${t.name} — уже спутник.`);
      default: throw new HttpError(400, 'Неизвестное действие.');
    }
  }
  if (t.k === 'd') {
    const corpses = mod('corpses'), body = t.body;
    if (op === 'revive') {
      const def = Enemies.get(body.def); if (!def) throw new HttpError(400, 'Враг не найден в бестиарии.');
      corpses.adminAct(c.account, room, { action: 'revive', id: body.id });
      return `${body.name} воскрес.`;
    }
    if (op === 'recruit') {
      const owner = targetPlayer(c, { who: msg.who });
      const result = corpses.adminAct(c.account, room, { action: 'recruit', id: body.id, username: owner.account.username, character: owner.character.id });
      return `${result.companion.name} стал спутником ${owner.character.name}.`;
    }
    if (op === 'edit') {
      const edit = msg.edit || {};
      if (edit.name !== undefined) body.name = String(edit.name).slice(0, 40) || body.name;
      if (edit.level !== undefined) { const n = Number(edit.level); if (!Number.isSafeInteger(n) || n < 1 || n > 100000) throw new HttpError(400, 'Уровень трупа: от 1 до 100000.'); body.level = n; }
      if (edit.def !== undefined) { const def = Enemies.get(String(edit.def)); if (!def) throw new HttpError(400, 'Нет такого существа в бестиарии.'); body.def = def.id; body.name = def.name; }
      room.broadcast({ t: 'corpse-remove', id: body.id }); room.broadcast({ t: 'corpse-add', corpse: body });
      return 'Труп изменён.';
    }
    throw new HttpError(400, 'Для трупа доступны правка, воскрешение и вербовка.');
  }
  if (t.k === 'n') {
    const n = t.n, stl = mod('settlements');
    switch (op) {
      case 'heal': n.hp = n.maxHp; return `${t.name}: здоров(а).`;
      case 'god': n.god = Boolean(msg.on); return `${t.name}: бессмертие ${n.god ? 'включено' : 'выключено'}.`;
      case 'edit': {
        const e = msg.edit || {};
        if (has(e, 'level')) { const lv = Math.floor(num(e.level, 1, 50, 'Уровень')), k = 1 + 0.1 * (lv - 1), base = (S.ROLES[n.role] || { hp: 50 }).hp; n.level = lv; n.maxHp = Math.round(base * k); n.cheatDmg = k; n.hp = Math.min(n.hp, n.maxHp); }
        if (has(e, 'maxHp')) { n.maxHp = Math.round(num(e.maxHp, 1, 100000, 'Макс. здоровье')); n.hp = Math.min(n.hp, n.maxHp); }
        if (has(e, 'hp')) n.hp = Math.max(1, Math.min(n.maxHp, num(e.hp, 1, 100000, 'Здоровье')));
        if (has(e, 'dmg')) n.cheatDmg = num(e.dmg, 0.1, 100, 'Урон (множитель)');
        if (has(e, 'speed')) n.cheatSpeed = num(e.speed, 0.1, 5, 'Скорость (множитель)');
        if (has(e, 'affinity')) { // симпатия к вам (семья, шаг 17)
          const rel = mod('family').relFor(room, c, n);
          rel.affinity = num(e.affinity, 0, 100, 'Симпатия');
          if (!rel.stage || Fam.STAGES[rel.stage].auto) rel.stage = Fam.autoStage(rel.affinity);
          mod('combat').markDirty(c); mod('family').send(c);
        }
        room.broadcast({ t: 'npc-add', npc: stl.publicNpc(n) });
        return `${t.name} изменён(а).`;
      }
      case 'dismiss': stl.removeNpc(room, n.id); return `${t.name} убран(а) из мира.`;
      case 'tphere': Object.assign(n, near(room, c.pos), { path: [], target: null }); n.home = { x: n.x, y: n.y }; return `${t.name} рядом с вами.`;
      case 'tpto': realtime.teleport(c, n.x, n.y); return `Вы рядом с ${t.name}.`;
      case 'kill': n.god = false; stl.hurt(room, n, n.hp * 100 + 1000, 'true', null); return `${t.name} погиб(ла).`;
      case 'clone': { const p = near(room, c.pos), m = stl.adminSpawnNpc(room, n.role, p.x, p.y, n.level || 1); return `Клон: ${m.name}.`; }
      case 'tame': throw new HttpError(400, 'Жителя нельзя приручить — его можно позвать в семью (разговор, симпатия) или нанять в поселении.');
      default: throw new HttpError(400, 'Неизвестное действие.');
    }
  }
  const e = t.e, cb = mod('combat');
  switch (op) {
    case 'heal': e.hp = e.maxHp; e.dots = []; return `${t.name}: здоров.`;
    case 'god': e.god = Boolean(msg.on); return `${t.name}: бессмертие ${e.god ? 'включено' : 'выключено'}.`;
    case 'edit': {
      const ed = msg.edit || {};
      if (has(ed, 'level')) cb.setEnemyLevel(room, e, num(ed.level, 1, 100000, 'Уровень врага'));
      if (ed.elite) cb.makeElite(room, e);
      if (has(ed, 'maxHp')) { e.maxHp = Math.round(num(ed.maxHp, 1, 1000000000, 'Макс. здоровье')); e.hp = Math.min(e.hp, e.maxHp); }
      if (has(ed, 'hp')) e.hp = Math.max(1, Math.min(e.maxHp, num(ed.hp, 1, 1000000000, 'Здоровье')));
      if (has(ed, 'dmg')) { const k = num(ed.dmg, 0.1, 100000, 'Урон (множитель)'), base = Enemies.statsAt(e.def, e.level, room.world.difficulty||config.get().game.difficulty).damage; e.damage = Array.isArray(base) ? base.map((d) => Math.max(1, Math.round(d * k))) : Math.max(1, Math.round(base * k)); }
      if (has(ed, 'speed')) e.cheatSpeed = num(ed.speed, 0.1, 100000, 'Скорость (множитель)');
      room.broadcast({ t: 'enemy-add', enemy: cb.publicEnemy(e) });
      return `${t.name} изменён.`;
    }
    case 'tame': {
      if (!C.kindOf(e.def)) throw new HttpError(400, `«${t.name}» не может быть спутником.`);
      const r = mod('companions').adminGive({ username: c.account.username, character: c.character.id, def: e.def.id, level: e.level, out: true, cheat: true, x: e.x, y: e.y }, true);
      cb.removeEnemy(room, e, false);
      return `${r.companion.name} теперь ваш спутник.`;
    }
    case 'dismiss': cb.removeEnemy(room, e, false); return `${t.name} убран из мира.`;
    case 'tphere': Object.assign(e, near(room, c.pos), { path: [] }); e.home = { x: e.x, y: e.y }; return `${t.name} рядом с вами.`;
    case 'tpto': realtime.teleport(c, e.x, e.y); return `Вы рядом с ${t.name}.`;
    case 'kill': e.god = false; e.hitBy.set(c.account.id, e.hp); cb.killEnemy(room, e, c); return `${t.name} убит.`;
    case 'clone': { const p = near(room, c.pos), m = cb.spawnEnemy(room, e.def, e.level, p.x, p.y, null, { ignoreSafe: true }); if (e.elite) cb.makeElite(room, m); return `Клон: ${t.name}.`; }
    default: throw new HttpError(400, 'Неизвестное действие.');
  }
}

// Всем моим спутникам: heal / god
function allMine(c, msg) {
  const list = C.list(c.character);
  if (!list.length) throw new HttpError(400, 'У вас нет спутников.');
  for (const rec of list) {
    if (msg.what === 'god') rec.god = Boolean(msg.on);
    else { rec.down = 0; rec.hp = C.statsOf(rec).maxHp; rec.food = 100; if (rec.out && !mod('companions').entOf(c.room, rec.id)) mod('companions').spawnEnt(c.room, c, rec); }
  }
  mod('combat').markDirty(c); mod('companions').sendList(c);
  return msg.what === 'god' ? `Бессмертие спутников ${msg.on ? 'включено' : 'выключено'}: ${list.length}.` : `Вылечены спутники: ${list.length}.`;
}

// ---------- Стройка ----------
function place(c, msg) {
  const room = c.room, cat = String(msg.cat || ''), id = String(msg.id || ''), x = Number(msg.x), y = Number(msg.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= room.map.width || y >= room.map.height) throw new HttpError(400, 'Точка за краем карты.');
  if (cat === 'piece') { const err = mod('building').cheatPlace(room, c, id, x, y, msg.rot); if (err) throw new HttpError(400, err); return { text: 'Поставлено (бесплатно).' }; }
  if (W.PROP_KINDS.includes(cat)) {
    try { const p = mod('worldedit').place(room, cat, id, x, y, msg.rot, msg.level); return { text: `Поставлено: ${W.nameOf(p)}.`, id: p.id }; } catch (e) { throw new HttpError(400, e.message); }
  }
  if (['enemy', 'npc', 'companion', 'vehicle'].includes(cat)) return require('./cheats').run(c, { a: 'spawn', kind: cat, id, x, y, count: msg.count || 1, level: msg.level, elite: msg.elite });
  throw new HttpError(400, 'Категория: ' + Object.keys(W.CATS).join(', ') + '.');
}
// Ластик: что ближе всего к точке — объект стройки, деталь базы, враг, житель, техника, предмет на земле; иначе — скрыть объект мира на клетке
function erase(c, msg) {
  const room = c.room, x = Number(msg.x), y = Number(msg.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new HttpError(400, 'Укажите точку.');
  const we = mod('worldedit');
  const p = we.propAt(room, x, y);
  if (p) { we.remove(room, p.id); return `Убрано: ${W.nameOf(p)}.`; }
  const piece = mod('building').cheatErase(room, x, y);
  if (piece) return `Снесено: ${piece}.`;
  const d = (o) => Math.hypot(o.x - x, o.y - y);
  const e = [...mod('combat').stateOf(room).enemies.values()].find((q) => !q.dead && d(q) <= 1);
  if (e) { mod('combat').removeEnemy(room, e, false); return `Убран враг: ${e.def.name}.`; }
  const n = room.stl && [...room.stl.ents.values()].find((q) => d(q) <= 1);
  if (n) { mod('settlements').removeNpc(room, n.id); return `Убран житель: ${n.name}.`; }
  const v = [...mod('vehicles').stateFor(room.world).list.values()].find((q) => q.room === (room.level ? room.level.key : 'ground') && d(q) <= 1.2 && !q.seats.some(Boolean));
  if (v) { mod('vehicles').adminAct(c.account, { id: v.id, op: 'remove' }); return 'Убрана техника.'; }
  const ground = mod('ground'), gi = ground.list(room.id).find((g) => d(g) <= 0.9);
  if (gi) { ground.remove(room.id, gi.gid); room.broadcast({ t: 'ground-remove', gid: gi.gid }); return 'Убран предмет с земли.'; }
  if (we.hide(room, x, y)) return 'Объект мира на клетке скрыт.';
  throw new HttpError(404, 'Здесь нечего убирать.');
}

function run(c, msg) {
  switch (msg.a) {
    case 'list': return { list: rows(c) };
    case 'pick': { const r = pick(c, Number(msg.x), Number(msg.y)); if (!r) throw new HttpError(404, 'Здесь никого нет — щёлкните точнее по персонажу.'); return { target: r, text: `Цель: ${r.name}.` }; }
    case 't': { const text = act(c, msg); return { text: text || 'Готово.', target: (() => { try { return rows(c).find((r) => r.k === msg.k && r.id === String(msg.id)) || null; } catch { return null; } })() }; }
    case 'allmine': return { text: allMine(c, msg) };
    case 'place': return place(c, msg);
    case 'erase': return { text: erase(c, msg) };
    default: throw new HttpError(400, 'Неизвестное действие.');
  }
}

module.exports = { ACTIONS, run, rows, pick, resolve };
