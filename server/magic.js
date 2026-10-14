'use strict';
// Магия (шаг 12). Правила и каталог заклинаний — shared/magic.js; сервер проверяет и применяет всё сам (клиенту не верим).
// Состояние героя в бою (c.cb): casting { spell, until, total, target, x, y, sx, sy }, spellCd { id → время готовности }, gcdUntil,
//   shield { amount, until }, defBuff { amount, until }, speedBuff { k, until }, regen { perSec, until }, hiddenUntil, weakUntil/weakFactor, stealAt.
// Изучение: свиток/книга (использовать предмет), телепатия (попросить у игрока рядом, он разрешает), передача от мага к магу
// (учитель сам передаёт; маги-наставники в поселениях — зацепка mageTeach), кража у живого мага, дар убитого мага, панель ГМ.
// Враги-маги (def.spells) читают заклинания сами: enemyThink из тика боя.
const realtime = require('./realtime');
const chat = require('./chat');
const config = require('./config');
const inventory = require('./inventory');
const characters = require('./characters');
const Magic = require('../shared/magic');
const Enemies = require('../shared/enemies');
const Inv = require('../shared/inventory');
const M = require('../shared/movement');
const AI = require('./ai');
const Fields=require('./magic-fields');

const G = () => config.get().game;
const combat = () => require('./combat');
const companions = () => require('./companions');
const round2 = (v) => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cb = (c) => combat().cbOf(c);
const asks = new Map(); // учитель (аккаунт) → [{ from, spell, until }]

// ---------- Эффекты на героях и врагах (зовёт server/combat.js) ----------
const live = (b, now = Date.now()) => b && b.until > now;
function absorb(ent, dmg, now = Date.now()) {
  if (!(dmg > 0) || !live(ent.shield, now)) return dmg;
  const used = Math.min(ent.shield.amount, dmg);
  ent.shield.amount -= used;
  if (ent.shield.amount <= 0.01) ent.shield = null;
  return dmg - used;
}
const enemyDefense = (ent, now = Date.now()) => (live(ent.defBuff, now) ? ent.defBuff.amount : 0);
const speedFactor = (c, now = Date.now()) => { const b = c.cb && c.cb.speedBuff; return live(b, now) ? b.k : 1; };
const hidden = (c) => {const set=require('../shared/items').setEffects(c.character);return Boolean(c.cb&&c.cb.hiddenUntil>Date.now())||set.invisible||Boolean(set.stealth&&!(c.cb?.stealthRevealedUntil>Date.now()));};
const weakFactor = (c) => (c.cb && c.cb.weakUntil > Date.now() ? c.cb.weakFactor || 1 : 1);
function onAttack(c) {const b=cb(c);b.stealthRevealedUntil=Date.now()+8000;if(b.hiddenUntil){b.hiddenUntil=0;b.magicKey=null;}}
function onHurt(c) {
  const b = c.cb;
  if (b && b.casting && G().magicInterruptOnDamage) interrupt(c, 'Вас ранили — чтение заклинания прервано.');
}
function interrupt(c, why) {
  const b = cb(c);
  if (!b.casting) return;
  combat().fx(c.room, { k: 'cast', id: c.account.id, s: b.casting.spell, ms: 0 });
  b.casting = null;
  if (why) chat.tell(c, why);
  sendState(c, true);
}

// ---------- Состояние для клиента ----------
function stateOf(c, now = Date.now()) {
  const b = cb(c), ch = c.character;
  const cds = {};
  for (const [id, t] of Object.entries(b.spellCd || {})) if (t > now) cds[id] = Math.ceil(t - now);
  const left = (x) => (live(x, now) ? Math.ceil(x.until - now) : 0);
  const room = c.room;
  const near = room ? [...room.players.values()].filter((o) => o !== c && dist(o.pos, c.pos) <= G().magicTelepathyRange && !cb(o).dead)
    .map((o) => ({ id: o.account.id, name: o.character.name, spells: Magic.known(o.character) })) : [];
  return {
    spells: Magic.known(ch), power: Math.round((Number(ch.magicPower) || 0) * 100) / 100, cds, gcd: Math.max(0, Math.ceil((b.gcdUntil || 0) - now)),
    casting: b.casting ? { spell: b.casting.spell, total: b.casting.total, left: Math.max(0, Math.ceil(b.casting.until - now)) } : null,
    buffs: { shield: live(b.shield, now) ? Math.round(b.shield.amount) : 0, shieldMs: left(b.shield), def: left(b.defBuff), speed: left(b.speedBuff), regen: left(b.regen), vampirism:left(b.vampirism), frozen:Math.max(0,(b.frozenUntil||0)-now), hidden: Math.max(0, Math.ceil((b.hiddenUntil || 0) - now)), weak: Math.max(0, Math.ceil((b.weakUntil || 0) - now)) },
    instant: Boolean(realtime.godOf(c.account.id).instantMagic),
    steal: Math.max(0, Math.ceil((b.stealAt || 0) - now)),
    asks: (asks.get(c.account.id) || []).filter((a) => a.until > now).map((a) => ({ from: a.from, name: a.name, spell: a.spell })),
    near,
  };
}
function sendState(c, force = false) {
  if (!c.character || !c.room) return;
  const st = stateOf(c);
  // ключ без счётчиков времени: присылаем при изменениях, раз в секунду — если что-то тикает
  const key = JSON.stringify({ ...st, cds: Object.keys(st.cds), gcd: 0, casting: st.casting && st.casting.spell, buffs: Object.fromEntries(Object.entries(st.buffs).map(([k, v]) => [k, v > 0])), steal: st.steal > 0 });
  const b = cb(c), now = Date.now();
  if (!force && key === b.magicKey && now < (b.magicSentAt || 0) + 1000) return;
  if (!force && key === b.magicKey && !Object.keys(st.cds).length && !st.casting && !Object.values(st.buffs).some((v) => v > 0) && !st.steal) return;
  b.magicKey = key; b.magicSentAt = now;
  realtime.send(c, { t: 'magic', ...st });
}
function persistNow(c) { try { characters.persist(c.account, c.character); } catch { /* сохранится с автосохранением */ } }

// ---------- Изучение ----------
// Выучить заклинание подключённому герою. force — без требований (дар убитого мага, кража, ГМ)
function learnLive(c, id, how, force = false) {
  const ch = c.character, s = Magic.get(id);
  if (!s) return 'Неизвестное заклинание.';
  let err = Magic.canLearn(ch, id);
  if (err && force && !Magic.knows(ch, id) && Magic.known(ch).length < G().magicMaxKnown) err = null;
  if (err) return err;
  ch.spells = [...Magic.known(ch), id];
  persistNow(c);
  realtime.send(c, { t: 'magic-learn', spell: id, how });
  chat.tell(c, `Изучено заклинание: ${s.name} (${Magic.SCHOOLS[s.school].name}). Книга заклинаний — P.`);
  sendState(c, true);
  return null;
}
// Зацепка для поселений (шаг 15): маг-наставник передаёт заклинание (сейчас — панель ГМ и тесты)
function mageTeach(c, id, opts = {}) { return learnLive(c, id, 'mage', Boolean(opts.force)); }

// Свиток / книга: использовать предмет
function onUse(ch, inst, it, ctx, take) {
  if (!it.teachesSpell) return undefined;
  if (!G().magicEnabled) return 'Магия отключена на сервере.';
  const err = Magic.learn(ch, it.teachesSpell);
  if (err) return err;
  take();
  const c = ctx && ctx.client;
  if (c) {
    const s = Magic.get(it.teachesSpell);
    chat.tell(c, `Изучено заклинание: ${s.name} (${Magic.SCHOOLS[s.school].name}). Книга заклинаний — P; перетащите заклинание на панель 1–0.`);
    realtime.send(c, { t: 'magic-learn', spell: s.id, how: 'book' });
    setImmediate(() => { if (c.character) sendState(c, true); });
  }
  return null;
}
Inv.setUseHook(onUse, true);

function playerIn(room, id) { const o = room.players.get(String(id || '')); return o && o.character ? o : null; }
const ACTS = {
  // Телепатия: попросить заклинание у игрока рядом (он должен разрешить)
  ask(room, c, m) {
    const g = G(), t = playerIn(room, m.from), id = String(m.spell || ''), s = Magic.get(id);
    if (!t || t === c) return 'Игрок не найден.';
    if (!s) return 'Неизвестное заклинание.';
    if (dist(t.pos, c.pos) > g.magicTelepathyRange) return `Телепатия достаёт не дальше ${g.magicTelepathyRange} клеток.`;
    if (!Magic.knows(t.character, id)) return `${t.character.name} не знает «${s.name}».`;
    const err = Magic.canLearn(c.character, id);
    if (err) return err;
    if (c.character.vitals.mp < g.magicTelepathyMpCost) return `Не хватает маны (нужно ${g.magicTelepathyMpCost}).`;
    const list = (asks.get(t.account.id) || []).filter((a) => a.until > Date.now() && !(a.from === c.account.id && a.spell === id));
    list.push({ from: c.account.id, name: c.character.name, spell: id, until: Date.now() + g.magicAskTimeoutSec * 1000 });
    asks.set(t.account.id, list);
    chat.tell(t, `${c.character.name} телепатически просит научить: «${s.name}». Разрешить — книга заклинаний (P).`);
    chat.tell(c, `Просьба отправлена: ${t.character.name} должен разрешить.`);
    sendState(t, true);
    return null;
  },
  // Учитель разрешает просьбу — ученик платит ману и учится
  allow(room, c, m) {
    const g = G(), list = asks.get(c.account.id) || [];
    const a = list.find((x) => x.from === String(m.from || '') && x.spell === String(m.spell || '') && x.until > Date.now());
    if (!a) return 'Просьба не найдена или устарела.';
    asks.set(c.account.id, list.filter((x) => x !== a));
    const l = playerIn(room, a.from);
    if (!l) return 'Ученик ушёл из мира.';
    if (!Magic.knows(c.character, a.spell)) return 'Вы уже не знаете это заклинание.';
    if (dist(l.pos, c.pos) > g.magicTelepathyRange) return 'Ученик слишком далеко.';
    if (l.character.vitals.mp < g.magicTelepathyMpCost) return `У ученика не хватает маны (нужно ${g.magicTelepathyMpCost}).`;
    const err = Magic.canLearn(l.character, a.spell);
    if (err) return err;
    l.character.vitals.mp -= g.magicTelepathyMpCost;
    combat().markDirty(l);
    learnLive(l, a.spell, 'telepathy');
    chat.tell(c, `Вы передали «${Magic.get(a.spell).name}» — ${l.character.name}.`);
    sendState(c, true);
    return null;
  },
  deny(room, c, m) {
    asks.set(c.account.id, (asks.get(c.account.id) || []).filter((x) => !(x.from === String(m.from || '') && x.spell === String(m.spell || ''))));
    sendState(c, true);
    return null;
  },
  // Передача от мага к магу: учитель сам учит игрока рядом (тратит свою ману)
  teach(room, c, m) {
    const g = G(), t = playerIn(room, m.to), id = String(m.spell || ''), s = Magic.get(id);
    if (!t || t === c) return 'Игрок не найден.';
    if (!s || !Magic.knows(c.character, id)) return 'Вы не знаете это заклинание.';
    if (dist(t.pos, c.pos) > g.magicTelepathyRange) return `Подойдите ближе (не дальше ${g.magicTelepathyRange} клеток).`;
    if (c.character.vitals.mp < g.magicTeachMpCost) return `Не хватает маны (нужно ${g.magicTeachMpCost}).`;
    const err = Magic.canLearn(t.character, id);
    if (err) return `${t.character.name}: ${err}`;
    c.character.vitals.mp -= g.magicTeachMpCost;
    combat().markDirty(c);
    learnLive(t, id, 'teach');
    chat.tell(c, `Вы научили ${t.character.name}: «${s.name}».`);
    return null;
  },
  // Кража (копия) заклинания у живого врага-мага
  steal(room, c, m) {
    const g = G(), now = Date.now(), b = cb(c), ch = c.character;
    if (!g.magicEnabled) return 'Магия отключена на сервере.';
    if (b.dead) return 'Вы мертвы.';
    const e = combat().stateOf(room).enemies.get(String(m.target || ''));
    if (!e || e.dead) return 'Цель не найдена.';
    if (!e.def.spells || !e.def.spells.length) return `«${e.def.name}» не владеет магией.`;
    if (dist(e, c.pos) > g.magicStealRange + (e.def.radius || 0.4)) return `Подойдите ближе (не дальше ${g.magicStealRange} клеток).`;
    if ((b.stealAt || 0) > now) return `Кража заклинаний ещё не готова (${Math.ceil((b.stealAt - now) / 1000)} с).`;
    const pool = e.def.spells.filter((id) => !Magic.knows(ch, id));
    if (!pool.length) return `Вы уже знаете все заклинания «${e.def.name}».`;
    if (ch.vitals.mp < g.magicStealMpCost) return `Не хватает маны (нужно ${g.magicStealMpCost}).`;
    ch.vitals.mp -= g.magicStealMpCost;
    b.stealAt = now + g.magicStealCooldownSec * 1000;
    combat().markDirty(c);
    const p = Magic.stealChance(ch, e.level);
    const ok = combat().random() < p;
    combat().fx(room, { k: 'chain', x: round2(e.x), y: round2(e.y), x2: round2(c.pos.x), y2: round2(c.pos.y), f: ok ? 'steal' : 'fail' });
    realtime.send(c, { t: 'magic-steal', ok: ok ? 1 : 0, chance: p, target: e.id });
    if (!ok) {
      AI.onDamaged(combat().aiCtx(room, now), e, { id: c.account.id, x: c.pos.x, y: c.pos.y });
      sendState(c, true);
      return `Кража не удалась (шанс ${Math.round(p * 100)}%) — маг заметил вас!`;
    }
    const id = pool[Math.floor(combat().random() * pool.length)];
    return learnLive(c, id, 'steal', true);
  },
  forget(room, c, m) {
    const id = String(m.spell || '');
    if (!Magic.knows(c.character, id)) return 'Такого заклинания вы не знаете.';
    inventory.mutate(c.account, c.character.id, (x) => { Magic.forget(x, id); return null; });
    chat.tell(c, `Вы забыли заклинание «${Magic.get(id).name}».`);
    sendState(c, true);
    return null;
  },
  cancel(room, c) { interrupt(c, null); return null; },
};

// Дар убитого мага: одно из его заклинаний или прибавка силы
function onMageKilled(room, c, e) {
  const g = G();
  if (!g.magicEnabled || !c || !c.character) return null;
  const ch = c.character;
  const pool = (e.def.spells || []).filter((id) => !Magic.knows(ch, id));
  if (pool.length && combat().random() < g.magicKillGrantChance && Magic.known(ch).length < g.magicMaxKnown) {
    const id = pool[Math.floor(combat().random() * pool.length)];
    chat.tell(c, `Умирая, ${e.def.name} передаёт вам свою силу.`);
    learnLive(c, id, 'kill', true);
    return { spell: id };
  }
  const before = Number(ch.magicPower) || 0;
  ch.magicPower = Math.min(g.magicPowerMax, before + g.magicKillPowerBoost);
  combat().markDirty(c);
  if (ch.magicPower > before) chat.tell(c, `Сила убитого мага переходит к вам: сила заклинаний +${Math.round(g.magicPowerPerPoint * (ch.magicPower - before) * 100)}% (всего ${ch.magicPower}).`);
  sendState(c, true);
  return { power: ch.magicPower };
}

// ---------- Чтение заклинаний героем ----------
function aimOf(room, c, s, m) {
  // цель: враг по id (или игрок в PvP), игрок-союзник по id, точка (x, y)
  const tol = G().magicRangeTolerance;
  const inRange = (p) => dist(p, c.pos) <= s.range + tol + (p.r || 0);
  if (s.target === 'self' || s.target === 'around') return { self: true };
  if (s.target === 'ally') {
    if (!m.target || m.target === c.account.id) return { ally: c };
    const o = playerIn(room, m.target);
    if (!o || cb(o).dead) return { err: 'Союзник не найден.' };
    if (!inRange(o.pos)) return { err: `Союзник слишком далеко (дальность ${s.range}).` };
    return { ally: o };
  }
  if (s.target === 'enemy') {
    const e = combat().stateOf(room).enemies.get(String(m.target || ''));
    if (e && !e.dead && !(e.hiddenUntil > Date.now())) {
      if (!inRange({ x: e.x, y: e.y, r: e.def.radius })) return { err: `Цель слишком далеко (дальность ${s.range}).` };
      return { enemy: e, x: e.x, y: e.y };
    }
    if (['bolt'].includes(s.kind) && Number.isFinite(m.x) && Number.isFinite(m.y)) return pointAim(c, s, m, tol); // снаряд — просто в точку
    return { err: 'Выберите цель — врага (щелчок или Tab).' };
  }
  return pointAim(c, s, m, tol);
}
function pointAim(c, s, m, tol) {
  const x = Number(m.x), y = Number(m.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { err: 'Укажите точку (курсор мыши).' };
  const d = Math.hypot(x - c.pos.x, y - c.pos.y);
  if (s.kind === 'blink' || s.kind === 'aoe' || s.kind === 'field') { if (d > s.range + tol) return { err: `Слишком далеко (дальность ${s.range}).` }; return { x, y }; }
  return { x, y }; // конус и снаряд — направление
}

function castError(c, s, now) {
  const g = G(), b = cb(c), ch = c.character;
  if (!g.magicEnabled) return 'Магия отключена на сервере.';
  if (!s) return 'Неизвестное заклинание.';
  if (!Magic.knows(ch, s.id)) return `Заклинание «${s.name}» не изучено.`;
  if (b.dead) return 'Вы мертвы.';
  if (b.stunUntil > now) return 'Вы оглушены.';
  if (b.casting) return 'Вы уже читаете заклинание.';
  if (!realtime.godOf(c.account.id).instantMagic && (b.gcdUntil || 0) > now) return 'Слишком быстро.';
  if (!realtime.godOf(c.account.id).instantMagic && ((b.spellCd || {})[s.id] || 0) > now) return `«${s.name}» ещё не готово (${Math.ceil((b.spellCd[s.id] - now) / 1000)} с).`;
  if (!ch.vitals || !realtime.godOf(c.account.id).instantMagic && ch.vitals.mp < s.mp) return `Не хватает маны: нужно ${s.mp}.`;
  const req = Magic.reqError(ch, s);
  if (req) return req;
  return null;
}
function cast(c, m) {
  const room = c.room, now = Date.now(), s = Magic.get(String(m.spell || ''));
  let err = castError(c, s, now);
  if (err) return err;
  const aim = aimOf(room, c, s, m);
  if (aim.err) return aim.err;
  const b = cb(c);
  b.gcdUntil = realtime.godOf(c.account.id).instantMagic ? 0 : now + G().magicGcdSec * 1000;
  if (s.cast > 0 && !realtime.godOf(c.account.id).instantMagic) {
    const total = Math.round(s.cast * 1000);
    b.casting = { spell: s.id, until: now + total, total, m: { target: m.target, x: m.x, y: m.y }, sx: c.pos.x, sy: c.pos.y };
    combat().fx(room, { k: 'cast', id: c.account.id, s: s.id, ms: total });
    sendState(c, true);
    return null;
  }
  return finish(c, s, aim);
}
// Закончить чтение: заново проверить цель и ману, потратить, применить
function finish(c, s, aim) {
  const room = c.room, now = Date.now(), ch = c.character, b = cb(c);
  if (!aim) { aim = aimOf(room, c, s, b.casting ? b.casting.m : {}); b.casting = null; if (aim.err) { sendState(c, true); return aim.err; } }
  if (!realtime.godOf(c.account.id).instantMagic && ch.vitals.mp < s.mp) { sendState(c, true); return `Не хватает маны: нужно ${s.mp}.`; }
  const err = apply(room, c, s, aim, now);
  if (err) { sendState(c, true); return err; }
  if (!realtime.godOf(c.account.id).instantMagic) ch.vitals.mp -= s.mp;
  b.spellCd = b.spellCd || {};
  b.spellCd[s.id] = realtime.godOf(c.account.id).instantMagic ? 0 : now + s.cd * 1000;
  combat().markDirty(c);
  onAttackIfHostile(c, s);
  sendState(c, true);
  return null;
}
function onAttackIfHostile(c, s) { if (s.damage || ['debuff', 'charm', 'fear'].includes(s.kind)) onAttack(c); }

function spellProf(s, k, extra = {}) {
  return { kind: 'spell', damage: Magic.scaled(s.damage || [0, 0], k), damageType: s.type, flags: ['magic', ...s.flags], range: s.kind === 'aoe' ? s.radius : s.range, proj: s.proj || 20, fx: s.fx, rootSec: s.root || 0, stunSec: s.stun || 0, freezeSec:s.freeze||0,lifesteal:s.lifesteal||0, undead: s.undead || 0, ...extra };
}
function dirTo(from, to) { const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; }
function freeAt(room, x, y) { return !M.validatePosition(room.map, { x: round2(x), y: round2(y) }); }
function healPlayer(room, t, amount) {
  const ch = t.character, max = combat().maxVitals(ch);
  const before = ch.vitals.hp;
  ch.vitals.hp = Math.min(max.hp, ch.vitals.hp + amount);
  combat().markDirty(t);
  combat().fx(room, { k: 'heal', t: 'p', id: t.account.id, n: Math.round(ch.vitals.hp - before) });
}
function cleanse(ent) { ent.dots = []; ent.stunUntil = 0; ent.immobileUntil = 0; ent.boundUntil = 0; ent.weakUntil = 0;ent.frozenUntil=0; }

function apply(room, c, s, aim, now) {
  const ch = c.character, k = Magic.power(ch, s), owner = { kind: 'p', c, id: c.account.id }, g = G();
  const pos = { x: c.pos.x, y: c.pos.y };
  const cs = combat();
  const profile=(...args)=>({...spellProf(...args),stealthCrit:hidden(c)});
  const target = aim.enemy ? { kind: 'e', ref: aim.enemy, x: aim.enemy.x, y: aim.enemy.y, r: aim.enemy.def.radius } : null;
  const fxCast = (extra = {}) => {
    cs.fx(room,{k:'spell',id:c.account.id,s:s.id,x:round2(pos.x),y:round2(pos.y),...extra});
    if(['shield','buff','hot','vampirism','debuff'].includes(s.kind))cs.fx(room,{k:'aura',t:s.kind==='debuff'?'e':'p',id:s.kind==='debuff'?aim.enemy.id:(aim.ally||c).account.id,s:s.id,group:s.kind,ms:s.dur*1000});
  };
  switch (s.kind) {
    case 'field': Fields.add(room,owner,s,k,aim.self?pos:aim);break;
    case 'vampirism': cb(c).vampirism={factor:s.lifesteal,until:now+s.dur*1000};fxCast();break;
    case 'bolt': cs.shoot(room, owner, pos, dirTo(pos, aim), profile(s, k)); break;
    case 'chain':
      cs.fx(room, { k: 'chain', x: round2(pos.x), y: round2(pos.y), x2: round2(aim.x), y2: round2(aim.y), f: s.fx });
      cs.applyHit(room, owner, target, profile(s, k));
      break;
    case 'cone': cs.coneStrike(room, owner, pos, dirTo(pos, aim), profile(s, k), s.deg); break;
    case 'aoe': cs.explode(room, owner, aim.self ? pos : { x: aim.x, y: aim.y }, profile(s, k, { kind: 'place' })); break;
    case 'heal': { const t = aim.ally; const [a, b2] = Magic.scaled(s.heal, k); healPlayer(room, t, a + (b2 - a) * cs.random()); fxCast({t:t.account.id}); if (s.cleanse) {cleanse(cb(t));cs.fx(room,{k:'status',t:'p',id:t.account.id,f:'clear',ms:0});} break; }
    case 'hot': { const t = aim.ally; cb(t).regen = { perSec: s.perSec * k, until: now + s.dur * 1000 }; fxCast({ t: t.account.id }); sendState(t, true); break; }
    case 'shield': { const t = aim.ally || c; cb(t).shield = { amount: Math.round(s.absorb * k), until: now + s.dur * 1000 }; fxCast({ t: t.account.id }); sendState(t, true); break; }
    case 'buff':
      if (s.defense) cb(c).defBuff = { amount: Math.round(s.defense * k), until: now + s.dur * 1000 };
      if (s.speed) cb(c).speedBuff = { k: s.speed, until: now + s.dur * 1000 };
      fxCast();
      break;
    case 'debuff': aim.enemy.weakUntil = now + s.dur * 1000; aim.enemy.weakFactor = s.factor; fxCast({ t: aim.enemy.id }); AI.onDamaged(cs.aiCtx(room, now), aim.enemy, { id: c.account.id, x: pos.x, y: pos.y }); break;
    case 'summon': {
      const def = Enemies.get(s.summon);
      companions().summon(room, c, def, Math.max(1, ch.level || 1), s.dur * (1 + g.magicPowerPerPoint * (Number(ch.magicPower) || 0)));
      fxCast();
      break;
    }
    case 'blink':
      if (!freeAt(room, aim.x, aim.y)) return 'Туда не перенестись (вода, горы или стена).';
      fxCast(); realtime.teleport(c, aim.x, aim.y); interruptMove(c);
      break;
    case 'step': {
      const e = aim.enemy, d = dirTo(pos, e), r = (e.def.radius || 0.4) + 0.8;
      const spots = [[d.x, d.y], [-d.y, d.x], [d.y, -d.x], [-d.x, -d.y]].map(([dx, dy]) => ({ x: e.x + dx * r, y: e.y + dy * r }));
      const spot = spots.find((p) => freeAt(room, p.x, p.y));
      if (!spot) return 'За спиной цели нет места.';
      fxCast(); realtime.teleport(c, spot.x, spot.y);
      break;
    }
    case 'stealth': {
      const b = cb(c);
      b.hiddenUntil = now + s.dur * 1000;
      for (const e of cs.stateOf(room).enemies.values()) if (e.target === c.account.id && dist(e, pos) <= s.radius) { e.target = null; AI.setState(e, 'idle', now); e.path = []; }
      cs.fx(room, { k: 'boom', x: round2(pos.x), y: round2(pos.y), r: 2.5, f: s.fx });
      break;
    }
    case 'fear': {
      let n = 0;
      for (const e of cs.stateOf(room).enemies.values()) {
        if (e.dead || e.def.boss || dist(e, pos) > s.radius + (e.def.radius || 0.4)) continue;
        e.target = e.target || c.account.id;
        AI.setState(e, 'flee', now - Math.max(0, (g.fleeRecoverSec - s.dur) * 1000));
        e.path = []; e.repathAt = 0; n++;
      }
      cs.fx(room, { k: 'boom', x: round2(pos.x), y: round2(pos.y), r: s.radius, f: s.fx });
      if (!n) chat.tell(c, 'Рядом нет врагов, которых можно напугать.');
      break;
    }
    case 'charm': {
      const e = aim.enemy;
      const p = Magic.charmChance(ch, e.level, e.hp / e.maxHp);
      if (cs.random() >= p) { AI.onDamaged(cs.aiCtx(room, now), e, { id: c.account.id, x: pos.x, y: pos.y }); chat.tell(c, `Подчинение не удалось (шанс ${Math.round(p * 100)}%).`); fxCast({ t: e.id }); break; }
      const rec = companions().enthrall(room, c, e, s.dur);
      if (typeof rec === 'string') return rec;
      fxCast({ t: rec.id });
      chat.tell(c, `Подчинение: «${rec.name}» служит вам ${s.dur} с.`);
      break;
    }
    case 'cleanse': cleanse(cb(aim.ally));cs.fx(room,{k:'status',t:'p',id:aim.ally.account.id,f:'clear',ms:0}); fxCast({ t: aim.ally.account.id }); break;
    default: return 'Это заклинание пока не работает.';
  }
  return null;
}
function interruptMove(c) { const b = cb(c); if (b.casting) b.casting = null; }

// ---------- Враги-маги ----------
function enemyProxy(e, s) {
  const k = Magic.enemyPower(e.level);
  return { kind: 'e', e: { id: e.id, x: e.x, y: e.y, damage: Magic.scaled(s.damage || [0, 0], k), weakUntil: e.weakUntil, weakFactor: e.weakFactor, def: e.def }, id: e.id, k };
}
// Выбор заклинания: лечится, прикрывается, прячется, отступает — или бьёт
function pickEnemySpell(room, e, t, now) {
  const d = dist(e, t.pos), low = e.hp / e.maxHp;
  const ready = (e.def.spells || []).map(Magic.get).filter((s) => s && ((e.spellCd || {})[s.id] || 0) <= now);
  const ok = (s) => {
    switch (s.kind) {
      case 'bolt': case 'chain': case 'debuff': return d <= s.range && (s.kind !== 'debuff' || !(cb(t).weakUntil > now));
      case 'cone': return d <= s.range;
      case 'field': case 'aoe': return s.target === 'around' ? d <= s.radius : d <= s.range;
      case 'fear': return d <= s.radius;
      case 'heal': case 'hot': return low < 0.5;
      case 'shield': return !live(e.shield, now) && low < 0.9;
      case 'vampirism': return !live(e.vampirism,now) && d<s.range+9;
      case 'buff': return !live(e.defBuff, now) && d < 8;
      case 'stealth': return low < 0.7 && !(e.hiddenUntil > now);
      case 'blink': return d < 2.5;
      case 'step': return d > 3 && d <= s.range;
      default: return false;
    }
  };
  const cand = ready.filter(ok);
  if (!cand.length) return null;
  const heal = cand.find((s) => s.kind === 'heal' || s.kind === 'hot');
  return heal || cand[Math.floor(combat().random() * cand.length)];
}
function enemyThink(room, e, now, ctx) {
  const g = G();
  if (!g.magicEnabled) return false;
  if (e.casting) {
    e.speedMul = 0;
    if (e.stunUntil > now) { e.casting = null; combat().fx(room, { k: 'cast', o: 'e', id: e.id, s: '', ms: 0 }); return false; }
    if (now < e.casting.until) return true;
    const s = Magic.get(e.casting.spell), t = room.players.get(e.casting.tid);
    e.casting = null;
    if (s && t && !cb(t).dead) enemyApply(room, e, s, t, now);
    return true;
  }
  if (!e.target || e.stunUntil > now || now < (e.nextCastAt || 0)) return false;
  const t = room.players.get(e.target);
  if (!t || cb(t).dead || (e.state !== 'chase' && e.state !== 'attack')) return false;
  const s = pickEnemySpell(room, e, t, now);
  if (!s) return false;
  e.spellCd = e.spellCd || {};
  e.spellCd[s.id] = now + s.cd * g.magicEnemyCastFactor * 1000 * 2;
  e.nextCastAt = now + 1500 * g.magicEnemyCastFactor;
  if (s.cast > 0) {
    e.casting = { spell: s.id, until: now + s.cast * 1000, tid: t.account.id };
    e.speedMul = 0; e.path = [];
    combat().fx(room, { k: 'cast', o: 'e', id: e.id, s: s.id, ms: Math.round(s.cast * 1000) });
    return true;
  }
  enemyApply(room, e, s, t, now);
  return false;
}
function enemyApply(room, e, s, t, now) {
  const cs = combat(), owner = enemyProxy(e, s), k = owner.k;
  const tpos = { x: t.pos.x, y: t.pos.y };
  const target = { kind: 'p', ref: t, x: tpos.x, y: tpos.y, r: 0.35 };
  const prof = spellProf(s, 1);
  const fxCast = (extra = {}) => {
    cs.fx(room,{k:'spell',o:'e',id:e.id,s:s.id,x:round2(e.x),y:round2(e.y),...extra});
    if(['shield','buff','hot','vampirism','debuff'].includes(s.kind))cs.fx(room,{k:'aura',t:s.kind==='debuff'?'p':'e',id:s.kind==='debuff'?t.account.id:e.id,s:s.id,group:s.kind,ms:s.dur*1000});
  };
  switch (s.kind) {
    case 'field': Fields.add(room,owner,s,1,s.target==='around'?e:tpos);break;
    case 'vampirism': e.vampirism={factor:s.lifesteal,until:now+s.dur*1000};fxCast();break;
    case 'bolt': cs.shoot(room, owner, { x: e.x, y: e.y }, dirTo(e, tpos), prof); break;
    case 'chain': cs.fx(room, { k: 'chain', x: round2(e.x), y: round2(e.y), x2: round2(tpos.x), y2: round2(tpos.y), f: s.fx }); cs.applyHit(room, owner, target, prof); break;
    case 'cone': cs.coneStrike(room, owner, { x: e.x, y: e.y }, dirTo(e, tpos), prof, s.deg); break;
    case 'aoe': cs.explode(room, owner, s.target === 'around' ? { x: e.x, y: e.y } : tpos, { ...prof, kind: 'place' }); break;
    case 'heal': { const [a, b] = Magic.scaled(s.heal, k); const before = e.hp; e.hp = Math.min(e.maxHp, e.hp + a + (b - a) * cs.random()); cs.fx(room, { k: 'heal', t: 'e', id: e.id, n: Math.round(e.hp - before) });fxCast(); break; }
    case 'hot': e.hp = Math.min(e.maxHp, e.hp + s.perSec * s.dur * k); fxCast(); break;
    case 'shield': e.shield = { amount: Math.round(s.absorb * k), until: now + s.dur * 1000 }; fxCast(); break;
    case 'buff': if (s.defense) e.defBuff = { amount: Math.round(s.defense * k), until: now + s.dur * 1000 }; fxCast(); break;
    case 'debuff': { const b = cb(t); b.weakUntil = now + s.dur * 1000; b.weakFactor = s.factor; fxCast({ t: t.account.id }); chat.tell(t, `${e.def.name} наводит на вас порчу: ваш урон ослаблен на ${s.dur} с.`); break; }
    case 'fear': { const b = cb(t); b.stunUntil = Math.max(b.stunUntil || 0, now + Math.min(2, s.dur) * 1000); cs.fx(room, { k: 'boom', x: round2(e.x), y: round2(e.y), r: s.radius, f: s.fx }); chat.tell(t, `${e.def.name} насылает ужас — вы оцепенели!`); break; }
    case 'stealth': e.hiddenUntil = now + s.dur * 1000; cs.fx(room, { k: 'boom', x: round2(e.x), y: round2(e.y), r: 2.5, f: s.fx }); break;
    case 'blink': { // отскок от героя
      const d = dirTo(tpos, e);
      for (const r of [s.range, s.range * 0.6, 3]) { const x = e.x + d.x * r, y = e.y + d.y * r; if (freeAt(room, x, y)) { fxCast(); e.x = x; e.y = y; e.path = []; break; } }
      break;
    }
    case 'step': { // за спину героя
      const d = dirTo(e, tpos);
      const x = tpos.x + d.x * 0.9, y = tpos.y + d.y * 0.9;
      if (freeAt(room, x, y)) { fxCast(); e.x = x; e.y = y; e.path = []; }
      break;
    }
    default: break;
  }
}

// ---------- Тик: чтение, прерывание движением, восстановление, отправка состояния ----------
function tick(room, dt, now) {
  Fields.tick(room,now);
  const g = G();
  for (const c of room.players.values()) {
    const b = cb(c);
    if (b.dead) { if (b.casting) b.casting = null; b.shield = null; b.hiddenUntil = 0; }
    if (b.casting) {
      if (g.magicInterruptOnMove && Math.hypot(c.pos.x - b.casting.sx, c.pos.y - b.casting.sy) > 0.3) interrupt(c, 'Вы сдвинулись — чтение заклинания прервано.');
      else if (b.stunUntil > now) interrupt(c, 'Вас оглушили — чтение прервано.');
      else if (now >= b.casting.until) {
        const s = Magic.get(b.casting.spell);
        const err = finish(c, s, null);
        if (err) realtime.send(c, { t: 'cast-reject', message: err });
      }
    }
    if (live(b.regen, now) && !b.dead) {
      const ch = c.character, max = combat().maxVitals(ch);
      ch.vitals.hp = Math.min(max.hp, ch.vitals.hp + b.regen.perSec * dt);
      combat().markDirty(c);
    }
    sendState(c);
  }
}

function safely(c, fn) {
  let err;
  try { err = fn(); } catch (e) { err = e.message || String(e); }
  if (err) realtime.send(c, { t: 'cast-reject', message: err });
  return err;
}

// ---------- Панель ГМ ----------
const { HttpError } = require('./auth');
function liveClient(acc, chId) { const c = realtime.byAccount.get(acc.id); return c && c.room && c.character && c.character.id === chId ? c : null; }
function adminList(body = {}) {
  const { acc, ch } = inventory.resolveTarget(body.username, body.character);
  return { username: acc.username, character: ch.name, spells: Magic.known(ch), power: Number(ch.magicPower) || 0, all: Magic.SPELLS.map((s) => ({ id: s.id, name: s.name, school: s.school, tier: s.tier })) };
}
function adminTeach(body = {}) {
  const { acc, ch } = inventory.resolveTarget(body.username, body.character);
  const id = String(body.spell || '').trim();
  const list = id === 'all' ? Magic.SPELLS.map((s) => s.id) : [id];
  if (id !== 'all' && !Magic.get(id)) throw new HttpError(400, `Неизвестное заклинание «${id}».`);
  const c = liveClient(acc, ch.id);
  if (c) { // герой в мире — через зацепку мага-наставника (без требований)
    for (const x of list) if (!Magic.knows(c.character, x)) { c.character.spells = [...Magic.known(c.character), x]; }
    persistNow(c);
    chat.tell(c, id === 'all' ? 'Администратор открыл вам все заклинания.' : `Администратор научил вас заклинанию: ${Magic.get(id).name}.`);
    sendState(c, true);
    return { username: acc.username, character: ch.name, spells: Magic.known(c.character).length };
  }
  const { record } = inventory.mutate(acc, ch.id, (x) => { x.spells = [...new Set([...Magic.known(x), ...list])]; return null; });
  return { username: acc.username, character: record.name, spells: Magic.known(record).length };
}
function adminRemove(body = {}) {
  const { acc, ch } = inventory.resolveTarget(body.username, body.character);
  const id = String(body.spell || '').trim();
  if (id !== 'all' && !Magic.get(id)) throw new HttpError(400, `Неизвестное заклинание «${id}».`);
  const c = liveClient(acc, ch.id);
  if (c) persistNow(c);
  const { record } = inventory.mutate(acc, ch.id, (x) => {
    const list = id === 'all' ? Magic.known(x) : [id];
    for (const s of list) Magic.forget(x, s);
    if (id === 'all') x.magicPower = 0;
    return null;
  });
  if (c) { chat.tell(c, id === 'all' ? 'Администратор стёр все ваши заклинания.' : `Администратор стёр заклинание: ${Magic.get(id).name}.`); sendState(c, true); }
  return { username: acc.username, character: record.name, spells: Magic.known(record).length };
}

realtime.use({
  playerState:c=>({sh:hidden(c)?1:0}),
  welcome:room=>({magicFields:Fields.snapshot(room)}),
  onDestroy:room=>{room.magicFields?.clear();},
  onJoin: (room, c) => {
    const ch = c.character;
    ch.spells = Magic.known(ch);
    const b = cb(c);
    b.casting = null;
    sendState(c, true);
  },
  beforeLeave: (room, c) => { Fields.clearOwner(room,c.account.id); const b = cb(c); b.casting = null; asks.delete(c.account.id); },
  tick,
  handlers: {
    cast: (c, msg) => { if (c.room) safely(c, () => cast(c, msg && typeof msg === 'object' ? msg : {})); },
    magic: (c, msg) => {
      const m = msg && typeof msg === 'object' ? msg : {};
      const fn = Object.prototype.hasOwnProperty.call(ACTS, m.a) ? ACTS[m.a] : null;
      if (c.room) safely(c, () => (fn ? fn(c.room, c, m) : 'Неизвестное действие магии.'));
    },
  },
});

module.exports = {
  absorb, enemyDefense, speedFactor, hidden, weakFactor, onAttack, onHurt, onMageKilled, enemyThink, mageTeach, learnLive,
  cast, ACTS, tick, sendState, stateOf, adminList, adminTeach, adminRemove,
};
