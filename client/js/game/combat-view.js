import {replacePanelHtml} from '../floating-window.js';
import {spellLife,drawSpellSupport} from './spell-effects.js';
import {drawCharacterStatus} from './spell-art.js';
import {magicFieldsBusy} from './magic-field-view.js';
// Бой на клиенте: враги, мины, турели, снаряды, вспышки, всплывающие числа урона, выбор цели и атака.
// Сервер решает всё (попадание, урон, смерть, патроны); клиент показывает и отправляет намерения:
//   щелчок по врагу — цель (подойти на дистанцию удара и бить), Shift — бить на месте, ПКМ — вторая рука.
import { artFx } from './art.js';
import { enemyHeight } from './enemy-draw.js';
import { drawCombatEffect, drawProjectile } from './combat-art.js';
import { attackDistance, approachPoint, nearestAutoEnemy } from './auto-combat.js';
import { magicAutoCast } from './magic-ui.js';
import { textScale } from '../accessibility.js';
import { actorMuzzle } from './figure-art.js';
import { vehSeat, vehAim, vehShotMuzzle, vehWeapon, vehWeaponProfile } from './vehicles-ui.js';

const Cb = window.Combat;
const En = window.Enemies;
const Items = window.Items;
const cfg = () => window.GameSettings || {};

let cv = null; // состояние боя текущей сессии

// api: { getCharacter, getHero, getOthers, you, send, toast, moveTo, stop, renderer }
export function combatAttach(api) {
  cv = {
    api, enemies: new Map(), traps: new Map(), turrets: new Map(), shots: new Map(), fx: [], nums: [], statusActors:new Map(),
    hover: null, target: null, shift: false, mouseDown: false, mouse: null, lastAtk: { main: 0, off: 0 }, repathAt: 0,
    me: null, pvp: false, reloadEnd: 0, reloadTotal: 0,
  };
  cv.attackMode = 'normal'; cv.nextThrow = 'main'; cv.superNext = false;
  cv.targetSlot = 'main';
  cv.auto = { melee: false, ranged: false, magic: false };
  try { Object.assign(cv.auto, JSON.parse(localStorage.getItem('rpg.autoCombat.' + api.getCharacter().id) || '{}')); } catch { /* defaults */ }
  cv.autoPauseUntil = 0; cv.autoCheckAt = 0; cv.autoPath = false;
  syncAutoCombat();
  const controls = document.getElementById('attack-mode-controls');
  if (controls) controls.onclick = event => {
    const btn = event.target.closest('[data-attack-mode],[data-super-attack]'); if (!btn) return;
    if (btn.hasAttribute('data-super-attack')) {
      if ((cv.me?.superCharge || 0) < 100) { cv.api.toast('Суперудар заряжается попаданиями.'); return; }
      cv.superNext = !cv.superNext;
    } else { cv.attackMode = btn.dataset.attackMode; cv.nextThrow = 'main'; }
    syncAttackMode();
  };
  syncAttackMode();
}

function syncAttackMode() {
  for (const btn of document.querySelectorAll('[data-attack-mode]')) {
    const active = btn.dataset.attackMode === cv?.attackMode; btn.classList.toggle('active',active); btn.setAttribute('aria-pressed',String(active));
  }
  const btn = document.querySelector('[data-super-attack]');
  if (btn && cv) { const charge = cv.me?.superCharge || 0; btn.classList.toggle('active',cv.superNext); btn.disabled = charge < 100;
    btn.title = `Суперудар: ${charge}/100. Нажмите, затем атакуйте цель. Тройной урон.`;
    btn.setAttribute('data-icon-tooltip',btn.title); btn.style.setProperty('--charge',charge+'%');
    btn.setAttribute('aria-label',btn.title);
  }
}
function syncAutoCombat() {
  for(const button of document.querySelectorAll('[data-auto-combat]')){
    const on=Boolean(cv&&cv.auto[button.dataset.autoCombat]);
    button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on));
  }
}
export function combatAutoToggle(mode) {
  if(!cv||!Object.hasOwn(cv.auto,mode))return;
  cv.auto[mode]=!cv.auto[mode];
  try{localStorage.setItem('rpg.autoCombat.'+cv.api.getCharacter().id,JSON.stringify(cv.auto));}catch{}
  if(!Object.values(cv.auto).some(Boolean)&&cv.autoPath){cv.api.stop();cv.autoPath=false;}
  syncAutoCombat();
}
export function combatDetach() { closeTurretPanel();document.getElementById('enemy-dialogue')?.remove(); cv = null; }
export const combatMe = () => (cv ? cv.me : null);
export const combatTarget = () => (cv ? cv.target || cv.hover : null);
export const combatPvp = () => Boolean(cv && cv.pvp);
export const combatEnemies = () => (cv ? cv.enemies : new Map()); // задания (шаг 16): Патриарх рядом

// ---------- Сообщения сервера ----------

function addEnemy(p, now) {
  const def = En.get(p.type);
  if (!def) return;
  cv.enemies.set(p.id, {
    id: p.id, def, look: def.look, outfit: p.outfit, lvl: p.lvl, maxHp: p.maxHp, hp: Math.ceil((p.hp / p.maxHp) * 100), boss: Boolean(def.boss),
    x: p.x, y: p.y, dir: 1, moving: false, flags: p.disposition==='neutral'?128:p.disposition==='follower'?256:p.disposition==='surrender'?512:0, snaps: [{ t: now, x: p.x, y: p.y, m: 0 }], flashUntil: 0, hpShowUntil: 0, deadAt: 0,
  });
}

export function combatOnWelcome(msg) {
  if (!cv) return;
  const now = performance.now();
  cv.enemies.clear(); cv.traps.clear(); cv.turrets.clear(); cv.shots.clear(); cv.fx = []; cv.nums = [];
  cv.target = null; cv.hover = null;cv.statusActors.clear();
  for (const e of msg.enemies || []) addEnemy(e, now);
  for (const t of msg.traps || []) cv.traps.set(t.id, trapView(t));
  for (const t of msg.turrets || []) cv.turrets.set(t.id, { ...t });
  cv.pvp = Boolean(msg.pvp);
  if (msg.me) setMe(msg.me);
}

function trapView(t) {
  return { ...t, mine: t.owner === cv.api.you(), armAt: performance.now() + Math.max(0, (cfg().trapArmSec || 0) * 1000) };
}

function setMe(me) {
  cv.me = me; syncAttackMode();
  if (me.reload) { cv.reloadEnd = performance.now() + me.reload.ms; cv.reloadTotal = me.reload.total; }
  else { cv.reloadEnd = 0; cv.reloadTotal = 0; }
}

// Позиции врагов из снимка state: [id, x, y, hp%, флаги]
// Шаг 20: что-то движется рядом с героем (враги, снаряды, вспышки, числа урона) — не простой
export function combatBusy(hero) {
  if (!cv) return false;
  if (magicFieldsBusy() || cv.statusActors.size || cv.shots.size || cv.fx.length || cv.nums.length) return true;
  for (const e of cv.enemies.values()) if ((e.moving || e.deadAt) && hero && Math.abs(e.x - hero.x) < 25 && Math.abs(e.y - hero.y) < 25) return true;
  return false;
}

export function combatOnState(list) {
  if (!cv || !list) return;
  const now = performance.now();
  for (const [id, x, y, hp, flags] of list) {
    const e = cv.enemies.get(id);
    if (!e || e.deadAt) continue;
    if (hp < e.hp) e.hpShowUntil = now + (cfg().hpBarShowSec ?? 4) * 1000;
    e.hp = hp; e.flags = flags;
    e.snaps.push({ t: now, x, y, m: flags & 1 });
    if (e.snaps.length > 30) e.snaps.shift();
  }
}

// true — сообщение относится к бою и обработано
export function combatOnMessage(msg) {
  if (!cv) return false;
  const now = performance.now();
  switch (msg.t) {
    case 'enemy-dialogue': {
      let panel=document.getElementById('enemy-dialogue');
      if(!panel){panel=document.createElement('div');panel.id='enemy-dialogue';Object.assign(panel.style,{position:'fixed',top:'25%',left:'50%',transform:'translateX(-50%)',maxWidth:'460px',width:'90%',padding:'20px',background:'#202b30',color:'#eef0e8',border:'1px solid #c8a66a',borderRadius:'10px',zIndex:1000});document.body.append(panel);}
      panel.replaceChildren();const text=document.createElement('p');text.textContent=msg.text;panel.append(text);
      for(const action of msg.options||[]){const b=document.createElement('button');b.className='btn';b.textContent={peace:'Предложить перемирие',follow:'Предложить идти следом',dismiss:'Отпустить почитателя'}[action]||action;b.onclick=()=>{cv.api.send({t:'enemy-talk',id:msg.id,action});panel.remove();};panel.append(b);}
      const close=document.createElement('button');close.className='btn';close.textContent='Закрыть';close.onclick=()=>panel.remove();panel.append(close);
      cv.target=null;cv.mouseDown=false;cv.autoPauseUntil=performance.now()+10000;
      return true;
    }
    case 'enemy-add': addEnemy(msg.enemy, now); return true;
    case 'enemy-remove': {
      const e = cv.enemies.get(msg.id);
      if (!e) return true;
      if (msg.dead && !msg.corpse) { e.deadAt = now; e.hp = 0; } else cv.enemies.delete(msg.id);
      if (cv.target === e) cv.target = null;
      if (cv.hover === e) cv.hover = null;
      return true;
    }
    case 'trap-add': cv.traps.set(msg.trap.id, trapView(msg.trap)); return true;
    case 'trap-remove': cv.traps.delete(msg.id); return true;
    case 'turret-add': cv.turrets.set(msg.turret.id, { ...msg.turret }); return true;
    case 'turret-upd': {
      const old = cv.turrets.get(msg.turret.id);
      cv.turrets.set(msg.turret.id, { ...old, ...msg.turret });
      if (cv.panelId === msg.turret.id) renderTurretPanel();
      return true;
    }
    case 'turret-remove':
      cv.turrets.delete(msg.id);
      if (cv.panelId === msg.id) closeTurretPanel();
      return true;
    case 'fx': for (const ev of msg.ev) onFx(ev, now); return true;
    case 'me': { const { t, ...me } = msg; setMe(me); return false; } // игра тоже обновит полоски
    case 'atk-reject':
      if (!['cooldown', 'reload'].includes(msg.reason)) cv.api.toast(msg.message, 2200);
      if (msg.reason === 'target' || msg.reason === 'pvp') cv.target = null;
      return true;
    default: return false;
  }
}

// Где сейчас сущность: враг, свой герой или другой игрок
let compLookup = null, npcLookup = null; // спутники (companions-ui.js) и жители поселений (settlements-ui.js): удары по ним и их взмахи
export function combatSetCompLookup(fn, npc = null) { compLookup = fn; npcLookup = npc; }
function posOf(kind, id) {
  if (kind === 'e') return cv.enemies.get(id);
  if (kind === 'c') return compLookup ? compLookup(id) : null;
  if (kind === 'n') return npcLookup ? npcLookup(id) : null;
  if (kind === 't') return cv.turrets.get(id);
  if (id === cv.api.you()) return cv.api.getHero();
  return cv.api.getOthers().get(id);
}

function onFx(ev, now) {
  const s = cfg();
  artFx(ev, ev.x != null && ev.y != null ? { x: ev.x, y: ev.y } : ev.id != null ? posOf(ev.t || 'p', ev.id) : null); // частицы (шаг 19)
  switch (ev.k) {
    case 'hit': {
      const who = posOf(ev.t, ev.id);
      if (!who) return;
      who.flashUntil = now + (s.hitFlashMs ?? 140);
      who.hurtAt = now;
      if (ev.t === 'e') who.hpShowUntil = now + (s.hpBarShowSec ?? 4) * 1000;
      const self = ev.t === 'p' && ev.id === cv.api.you();
      const color = ev.dot ? ({ burn: '#ff8a3a', poison: '#8ee05a', bleed: '#e05a5a' }[ev.dot] || '#ffb070')
        : self ? '#ff5a4a' : ev.t === 'p' ? '#ff9ab0' : ev.c ? '#ffd83a' : '#ffffff';
      addNum(who.x, who.y, (ev.c ? '✦' : '') + ev.n, color, ev.c ? 1.45 : ev.dot ? 0.85 : 1, now, ev.t === 'e' || ev.t === 'c' ? enemyHeight(who.look) : ev.t === 'n' ? 4.2 : ev.t === 't' ? 2.6 : 4.2, ev.t + ev.id);
      return;
    }
    case 'aura': {const actor=posOf(ev.t,ev.id);if(actor){actor.spellAuras=actor.spellAuras||{};actor.spellAuras[ev.group]={spell:ev.s,until:now+ev.ms};cv.statusActors.set(ev.t+ev.id,actor);}return;}
    case 'status': {const actor=posOf(ev.t,ev.id);if(actor){if(ev.f==='clear'){actor.frozenUntil=actor.rootUntil=actor.iceRootUntil=actor.burnUntil=0;if(actor.spellAuras)delete actor.spellAuras.debuff;}actor[ev.f==='frozen'?'frozenUntil':ev.f==='iceRoot'?'iceRootUntil':ev.f==='burn'?'burnUntil':'rootUntil']=now+ev.ms;cv.statusActors.set(ev.t+ev.id,actor);}return;}
    case 'shot':
      if (ev.f === 'weaponThrow') { const actor = posOf(ev.o,ev.by); if (actor) { actor.thrownHands ||= {}; actor.thrownHands[ev.hand === 'offHand' ? 'offHand' : 'mainHand'] = now + Math.min(850, ev.r / ev.s * 1000 + 120); } }
      {
        // выстрел техники: точка вылета — сама установка (ствол, пилон, аппарат), h — её высота над корпусом
        const vm = ev.veh ? { dx: 0, dy: -(ev.h || 0), height: ev.h || 0, alt: Math.max(0, ev.alt || 0), scale: 1 } : null;
        const th = ev.f === 'bomb' || ev.f === 'torpedo' ? 0 : undefined; // бомба падает на землю, торпеда идёт по воде
        cv.shots.set(ev.id, { ...ev, x0: ev.x, y0: ev.y, born: now, source:posOf(ev.o,ev.by), originMuzzle: vm, th });
        cv.fx.push({ ...ev, k:'muzzle',born:now,source:posOf(ev.o,ev.by), muzzle: vm, fixedMuzzle: Boolean(vm) });
      }
      if (ev.o !== 't' && ev.by != null) {
        const shooter = posOf(ev.o, ev.by);
        if (shooter) { shooter.attackHand = shooter.attackAt === now && shooter.attackHand !== ev.hand ? 'both' : ev.hand || 'mainHand'; shooter.attackAt = now; shooter.attackAngle = ev.a; shooter.attackFx = ev.f; shooter.attackKind = ev.f === 'weaponThrow' ? 'throw' : 'ranged'; }
      }
      if (ev.o === 't') return;
      for (const t of cv.turrets.values()) if (Math.hypot(t.x - ev.x, t.y - ev.y) < 0.05) t.flash = now + 90;
      return;
    case 'steer': { // управляемая ракета довернула: новый отрезок полёта
      const p = cv.shots.get(ev.id);
      if (!p) return;
      p.travel0 = (p.travel0 || 0) + Math.hypot(ev.x - p.x0, ev.y - p.y0);
      Object.assign(p, { x0: ev.x, y0: ev.y, x: ev.x, y: ev.y, a: ev.a, r: ev.r, born: now });
      return;
    }
    case 'impact': {
      const p = cv.shots.get(ev.id);
      cv.shots.delete(ev.id);
      cv.fx.push({ k: 'impact', x: ev.x, y: ev.y, f: ev.f, born: now, lift:p?.visualLift, lasso: p && ev.f === 'lasso' ? { x: p.x0, y: p.y0 } : null });
      return;
    }
    case 'swing': case 'cone': case 'boom': case 'chain':
      cv.fx.push({ ...ev, born: now });
      if (['e','p','c'].includes(ev.o)) { const actor = posOf(ev.o, ev.id); if (actor) { actor.attackAt = now; actor.attackAngle = ev.a; actor.attackFx = ev.f; actor.attackKind = ev.k === 'cone' ? 'cast' : 'melee'; } }
      return;
    case 'heal': { // лечение заклинанием — зелёное число
      const who = posOf(ev.t, ev.id);
      if (who && ev.n > 0) addNum(who.x, who.y, '+' + ev.n, '#6ff08a', 1, now, ev.t === 'e' ? enemyHeight(who.look) : 4.2);
      return;
    }
    case 'spell': case 'cast': // вспышка заклинания и свечение читающего (shared/magic.js — цвет школы)
      cv.fx.push({ ...ev, born: now, until: ev.k === 'cast' ? now + (ev.ms || 0) : 0 });
      if (ev.k === 'cast') { const caster = posOf(ev.o || 'p', ev.id); if (caster) { caster.castAt = now; caster.castUntil = now + (ev.ms || 450); caster.attackFx = 'magic'; caster.attackKind = 'cast'; caster.castColor = magicColor(ev.s); } }
      if (ev.k === 'cast' && !ev.ms) cv.fx = cv.fx.filter((f) => !(f.k === 'cast' && f.id === ev.id));
      return;
    case 'die':
      if (ev.t === 'p') cv.fx.push({ k: 'boom', x: ev.x, y: ev.y, r: 0.8, f: 'blood', born: now });
      return;
    case 'xp':
      if (ev.id === cv.api.you()) { const h = cv.api.getHero(); addNum(h.x, h.y, `+${ev.n} опыта`, '#7ec8ff', 0.85, now, 4.2); }
      return;
    case 'levelup': {
      const who = posOf('p', ev.id);
      if (!who) return;
      cv.fx.push({ k: 'levelup', id: ev.id, born: now });
      addNum(who.x, who.y, `Уровень ${ev.lvl}!`, '#ffd27a', 1.3, now, 4.6);
      return;
    }
    default:
  }
}

// Число над целью; несколько попаданий подряд по одной цели встают столбиком, а не друг на друга
function addNum(x, y, text, color, scale, now, h, key = null) {
  const recent = key ? cv.nums.filter((n) => n.key === key && now - n.born < (cfg().dmgNumberMs ?? 900) / 3).length : 0;
  cv.nums.push({ x, y, text, color, scale, born: now, h: h + recent * 0.9, key, jx: (Math.random() - 0.5) * 0.6 });
  if (cv.nums.length > 80) cv.nums.shift();
}

// ---------- Оружие героя ----------

function weaponOf(slot) {
  const ch = cv.api.getCharacter();
  const inst = ch.inventory.equipment[slot === 'off' ? 'offHand' : 'mainHand'];
  const item = inst && Items.get(inst.id);
  if (!item || !item.weapon) return slot === 'off' ? null : { inst: null, item: null, prof: Cb.profile(null) };
  return { inst, item, prof: (inst.dur === 0 ? Cb.profile(null) : Cb.attackProfile(item,cv.attackMode)) || Cb.profile(item) };
}
export const combatWeapon = (slot = 'main') => (cv ? weaponOf(slot) : null);

// Дистанция, с которой можно атаковать цель
function reach(prof, e) {
  return attackDistance(prof,e,cfg().meleeApproachMargin ?? 0.08);
}

// Отправить атаку, если оружие готово (сервер всё равно проверит скорость, дальность и патроны)
function tryAttack(slot, aim, now) {
  const seat = vehSeat();
  if (!seat && cv.attackMode === 'throw' && slot === 'main' && Cb.canThrow(weaponOf('off')?.item)) slot = cv.nextThrow;
  // бортовое оружие: выбранный вид (1–9, [ ]); кулдаун — свой у каждого вида
  const group = seat ? vehWeapon(slot) : null;
  const mountedWeapon = group;
  const w = group ? { prof: vehWeaponProfile(group) } : weaponOf(slot);
  const cdKey = group ? 'veh:' + group.id : slot;
  if (!w) { if (slot === 'off') cv.api.toast('Во второй руке нет оружия.'); return false; }
  if (cv.me && cv.me.dead) return false;
  if (!mountedWeapon && !Cb.attackProfile(w.inst?.dur === 0 ? null : w.item,cv.attackMode)) { cv.api.toast('Это оружие нельзя метать.'); return false; }
  if (!mountedWeapon && cv.attackMode === 'dualThrow' && (!Cb.canThrow(weaponOf('main')?.item) || !Cb.canThrow(weaponOf('off')?.item))) { cv.api.toast('Для двойного броска вооружите обе руки метательным оружием.'); return false; }
  if (now - (cv.lastAtk[cdKey] || 0) < Cb.cooldownMs(w.prof)) return false;
  if (!seat && cv.attackMode === 'dualThrow') {const off=weaponOf('off');if(off && now-cv.lastAtk.off<Cb.cooldownMs(off.prof))return false;}
  if (cv.reloadEnd > now) return false;
  cv.lastAtk[cdKey] = now;
  const msg = { t: 'atk', slot, mode: seat ? 'normal' : cv.attackMode, super: !seat && cv.superNext };
  if (group) msg.vw = group.id;
  if (!seat && cv.attackMode === 'dualThrow') cv.lastAtk.main = cv.lastAtk.off = now;
  if (aim.enemy) { msg.target = aim.enemy.id; msg.tk = 'e'; }
  else if (aim.player) { msg.target = aim.player.id; msg.tk = 'p'; msg.x = Math.round(aim.player.x * 100) / 100; msg.y = Math.round(aim.player.y * 100) / 100; }
  else { msg.x = Math.round(aim.x * 100) / 100; msg.y = Math.round(aim.y * 100) / 100; }
  const h = cv.api.getHero();
  const to = aim.enemy || aim.player || aim;
  h.attackTarget={x:to.x,y:to.y,height:to.look?enemyHeight(to.look)*0.65:2.12};
  h.face = to.x - to.y >= h.x - h.y ? 1 : -1;
  const anim = w.prof, ranged = anim.kind !== 'melee';
  h.attackHand = cv.attackMode === 'dualThrow' ? 'both' : slot === 'off' ? 'offHand' : 'mainHand';
  h.attackAt = performance.now(); h.attackAngle = Math.atan2(to.y - h.y, to.x - h.x); h.attackKind = anim.kind === 'thrown' ? 'throw' : ranged ? 'ranged' : 'melee'; h.attackFx = anim.fx;
  cv.api.send(msg);
  if (!seat && cv.attackMode === 'throw') cv.nextThrow = slot === 'main' ? 'off' : 'main';
  if (cv.superNext) { cv.superNext = false; syncAttackMode(); }
  return true;
}

// ---------- Ввод ----------

// Враг под курсором (экранные координаты): прямоугольник рисунка, передние — в приоритете
function pickEnemy(sx, sy) {
  const r = cv.api.renderer(), u = r.hh * 0.9;
  let best = null, bestDepth = -Infinity;
  for (const e of cv.enemies.values()) {
    if (e.deadAt) continue;
    const s = r.toScreen(e.x, e.y);
    const h = enemyHeight(e.look) * u, w = Math.max(u * 1.1, u * 1.3 * (e.look.size || 1));
    if (sx < s.x - w / 2 || sx > s.x + w / 2 || sy < s.y - h || sy > s.y + u * 0.35) continue;
    const depth = e.x + e.y;
    if (depth > bestDepth) { bestDepth = depth; best = e; }
  }
  return best;
}
function pickPlayer(sx, sy) {
  if (!cv.pvp) return null;
  const r = cv.api.renderer(), u = r.hh * 0.9;
  for (const o of cv.api.getOthers().values()) {
    const s = r.toScreen(o.x, o.y);
    if (!o.dead && Math.abs(sx - s.x) < u * 0.6 && sy > s.y - u * 3.2 && sy < s.y + u * 0.3) return o;
  }
  return null;
}

// Своя турель под курсором (щелчок открывает панель управления)
function pickTurret(sx, sy) {
  const r = cv.api.renderer(), u = r.hh * 0.9;
  for (const t of cv.turrets.values()) {
    if (t.owner !== cv.api.you()) continue;
    const s = r.toScreen(t.x, t.y);
    if (Math.abs(sx - s.x) < u * 0.8 && sy > s.y - u * 2.2 && sy < s.y + u * 0.3) return t;
  }
  return null;
}

// ---------- Панель турели: здоровье, уровень, режим цели, ремонт, улучшение, свернуть ----------
const MODE_NAMES = { nearest: 'ближайший враг', strongest: 'самый здоровый', weakest: 'самый слабый' };
const itemName = (id) => (Items.get(id) || { name: id }).name;
function turretCosts(t) {
  const s = cfg();
  const up = [[s.turretUpgradeItem, s.turretUpgradeCount], [s.turretUpgradeItem2, s.turretUpgradeCount2]]
    .filter(([id, n]) => id && n > 0).map(([id, n]) => `${itemName(id)} × ${n * t.tier}`).join(', ');
  const rep = s.turretRepairItem ? Math.ceil((t.maxHp - t.hp) / (s.turretRepairHpPerItem || 1)) : 0;
  return { up, rep };
}
function openTurretPanel(t) { cv.panelId = t.id; renderTurretPanel(); }
function closeTurretPanel() {
  if (!cv) return;
  cv.panelId = null;
  const el = document.getElementById('turret-panel');
  if (el) el.classList.add('hidden');
}
function renderTurretPanel() {
  const el = document.getElementById('turret-panel'), t = cv.turrets.get(cv.panelId);
  if (!el || !t) return closeTurretPanel();
  const s = cfg(), c = turretCosts(t), maxTier = s.turretMaxTier || 1;
  const esc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  replacePanelHtml(el,`<div class="inv-head"><b>${esc(itemName(t.item))}</b><button type="button" class="btn small" data-a="close" title="Закрыть панель">✕</button></div>
    <div class="small" title="Здоровье турели: враги могут её разбить. Чинится материалом">Здоровье: <b>${t.hp} / ${t.maxHp}</b></div>
    <div class="small" title="Уровень улучшения: больше урон, дальность, скорострельность, магазин и здоровье">Уровень: <b>${'★'.repeat(t.tier)}${'☆'.repeat(Math.max(0, maxTier - t.tier))}</b></div>
    <div class="small" title="Заряды в магазине турели">Заряды: <b>${t.mag}${t.max ? ' / ' + t.max : ''}</b></div>
    <label class="small" title="Кого турель выбирает целью">Цель: <select data-a="mode">${Object.entries(MODE_NAMES).map(([k, v]) => `<option value="${k}"${k === t.mode ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <div class="row">
      <button type="button" class="btn small" data-a="repair" ${c.rep ? '' : 'disabled'} title="Починить: ${esc(itemName(s.turretRepairItem))} — ${s.turretRepairHpPerItem} здоровья за штуку">🔧 Починить${c.rep ? ` (${esc(itemName(s.turretRepairItem))} × ${c.rep})` : ''}</button>
      <button type="button" class="btn small" data-a="upgrade" ${t.tier >= maxTier ? 'disabled' : ''} title="Улучшить до следующего уровня">⬆ Улучшить${t.tier < maxTier ? ` (${esc(c.up)})` : ' — предел'}</button>
      <button type="button" class="btn small" data-a="fold" title="Свернуть турель в предмет на земле (оставшиеся заряды пропадут)">📦 Свернуть</button>
    </div>`);
  el.classList.remove('hidden');
  el.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || a === 'mode') return;
    if (a === 'close') return closeTurretPanel();
    cv.api.send({ t: 'turret', id: t.id, a });
  };
  el.querySelector('select').onchange = (e) => cv.api.send({ t: 'turret', id: t.id, a: 'mode', mode: e.target.value });
}

export function combatHover(){return cv?.hover||null;}
export function combatMouseMove(sx, sy) {
  if (!cv) return;
  cv.mouse = { sx, sy };
  cv.hover = pickEnemy(sx, sy);
  const seat = vehSeat(), mounted = seat && window.Vehicles && window.Vehicles.get(seat.def);
  if (mounted && window.Vehicles.armsOf(mounted).length && (seat.seat === (mounted.gunner ?? 0) || seat.seat === 0)) {
    const target = cv.hover || cv.target;
    const point = target || cv.api.renderer().toWorld(sx, sy);
    vehAim(point.x, point.y);
  }
  const canvas = cv.api.renderer().canvas;
  const cursor = cv.hover ? 'crosshair' : '';
  if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
}

// true — щелчок ушёл в бой (иначе игра обработает его как ходьбу / подбор предмета)
export function combatMouseDown(e, sx, sy) {
  if (!cv) return false;
  const now = performance.now();
  const r = cv.api.renderer();
  const enemy = pickEnemy(sx, sy), player = enemy ? null : pickPlayer(sx, sy);
  const w = r.toWorld(sx, sy);
  if (e.button === 2) { // ПКМ — вторая рука (или основная, если во второй пусто)
    const slot = vehWeapon() ? 'off' : weaponOf('off') ? 'off' : 'main'; // в машине — выбранное бортовое оружие
    tryAttack(slot, enemy ? { enemy } : player ? { player } : w, now);
    return true;
  }
  if (e.button !== 0) return false;
  if (!enemy && !player && !e.shiftKey) { const tur = pickTurret(sx, sy); if (tur) { openTurretPanel(tur); return true; } }
  cv.mouseDown = true;
  if (e.shiftKey) { // на месте: по врагу под курсором или в точку
    cv.target = null;
    cv.api.stop();
    tryAttack('main', enemy ? { enemy } : player ? { player } : w, now);
    return true;
  }
  if (enemy || player) {
    cv.target = enemy || player;
    cv.targetKind = enemy ? 'e' : 'p';
    cv.targetSlot = 'main';
    cv.repathAt = 0;
    return true;
  }
  cv.target = null;
  return false;
}
// Клавиатура: Tab — основная рука, Caps Lock — вторая (если пустая, основная).
// Выбираем ближайшего видимого противника и используем тот же подход к цели, что и ЛКМ.
export function combatKey(e) {
  if(cv&&e.code==='KeyT'&&!e.shiftKey&&!e.ctrlKey&&!e.altKey){const hero=cv.api.getHero();const nearby=[...cv.enemies.values()].filter(x=>!x.deadAt&&!x.def.boss&&['human','mage','cyborg','mutant'].includes(x.def.family)&&Math.hypot(x.x-hero.x,x.y-hero.y)<=4).sort((a,b)=>Math.hypot(a.x-hero.x,a.y-hero.y)-Math.hypot(b.x-hero.x,b.y-hero.y))[0];if(nearby){e.preventDefault();cv.api.send({t:'enemy-talk',id:nearby.id});return true;}}
  if (!cv || (e.code !== 'Tab' && e.code !== 'CapsLock')) return false;
  if (e.ctrlKey || e.altKey || e.metaKey || e.target?.closest?.('input,textarea,select,button,a,[contenteditable="true"],[tabindex]:not([tabindex="-1"])')) return false;
  e.preventDefault();
  if (cv.me?.dead) return true;
  if (e.repeat && !cv.api.controlled?.() && !vehSeat()) return true;
  const slot = e.code === 'CapsLock' && weaponOf('off') ? 'off' : 'main';
  const currentAlive = cv.target && (cv.targetKind === 'e' ? cv.enemies.has(cv.target.id) && !cv.target.deadAt : cv.api.getOthers().has(cv.target.id) && !cv.target.dead);
  let target = currentAlive ? cv.target : null, kind = currentAlive ? cv.targetKind : null;
  if (!target) {
    const hero = cv.api.getHero(), renderer = cv.api.renderer();
    const visible = (x) => !renderer.fog || renderer.fog.see(x.x, x.y);
    const hostile = (x) => !window.Factions || window.Factions.enemyHostile(cv.api.getCharacter(), x.def);
    target = nearestAutoEnemy(hero, cv.enemies.values(), 36, visible, hostile);
    kind = target ? 'e' : null;
    if (!target && cv.pvp) {
      for (const other of cv.api.getOthers().values()) {
        const d = Math.hypot(other.x - hero.x, other.y - hero.y);
        if (!other.dead && d <= 36 && (!target || d < Math.hypot(target.x - hero.x, target.y - hero.y))) { target = other; kind = 'p'; }
      }
    }
  }
  if (!target) { cv.api.toast('Рядом нет видимого противника.', 1400); return true; }
  if (cv.api.controlled?.()) {
    cv.api.send({ t: 'comp-attack', x: target.x, y: target.y, ...(kind === 'e' ? { target: target.id } : {}) });
    return true;
  }
  if (vehSeat()) { tryAttack(slot, kind === 'e' ? { enemy: target } : { player: target }, performance.now()); return true; }
  cv.target = target; cv.targetKind = kind; cv.targetSlot = slot; cv.repathAt = 0; cv.autoPauseUntil = 0;
  return true;
}
export function combatMouseUp() { if (cv) cv.mouseDown = false; }
export function combatShift(on) { if (cv) cv.shift = on; }
// Игрок пошёл сам (клавиши, щелчок по земле) — цель атаки сбрасывается
export function combatCancel() { if (cv) { cv.target = null; cv.autoPauseUntil = performance.now() + 1400; cv.autoPath = false; } }

function updateAutoCombat(now) {
  if(now<cv.autoCheckAt||now<cv.autoPauseUntil||cv.me&&cv.me.dead)return;
  cv.autoCheckAt=now+180;
  const hero=cv.api.getHero(),ch=cv.api.getCharacter(),r=cv.api.renderer();
  if(hero.stunUntil>now||hero.castUntil>now)return;
  const visible=(e)=>!r.fog||r.fog.see(e.x,e.y);
  const hostile=(e)=>!window.Factions||window.Factions.enemyHostile(ch,e.def);
  const enemies=cv.enemies.values();
  const target=cv.targetKind==='e'&&cv.target&&!cv.target.deadAt?cv.target:nearestAutoEnemy(hero,enemies,36,visible,hostile);
  if(cv.auto.magic&&magicAutoCast(target,now))return;
  if(!target){if(cv.autoPath){cv.api.stop();cv.autoPath=false;}return;}
  const d=Math.hypot(target.x-hero.x,target.y-hero.y);
  // Сначала стреляем: наличие меча в другой руке не должно заставлять бежать к цели.
  let rangedReady=false;
  const slots=['main','off'].sort((a,b)=>Number(weaponOf(a)?.prof.kind==='melee')-Number(weaponOf(b)?.prof.kind==='melee'));
  for(const slot of slots){
    const w=weaponOf(slot);if(!w)continue;
    const melee=w.prof.kind==='melee';
    if(melee?!cv.auto.melee:!cv.auto.ranged)continue;
    if(w.prof.kind==='place')continue;
    const ammo=w.prof.ammo;
    if(ammo&&!(w.inst&&w.inst.mag>0)&&!window.Inventory.rounds(ch,ammo))continue;
    if(ch.vitals.stamina<Cb.staminaCost(w.prof)||ch.vitals.mp<Cb.mpCost(w.prof))continue;
    const range=reach(w.prof,target);
    if(d<=range){if(!melee)rangedReady=true;if(cv.autoPath){cv.api.stop();cv.autoPath=false;}tryAttack(slot,{enemy:target},now);}
    else if(melee&&!rangedReady&&d<4.5&&!cv.target&&!hero.moving&&!cv.api.isMoving()){
      const goal=approachPoint(hero,target,range);cv.autoPath=true;cv.api.moveTo(goal.x,goal.y);
    }
  }
  // Цель могла сместиться, пока герой шёл. Не продолжаем старый путь сквозь неё.
  if(cv.autoPath&&d<=Math.max(...['main','off'].map((slot)=>{const w=weaponOf(slot);return w&&w.prof.kind==='melee'?reach(w.prof,target):0;}))){cv.api.stop();cv.autoPath=false;}
}

// ---------- Обновление ----------

export function combatUpdate(dt, now) {
  if (!cv) return;
  const s = cfg();
  // враги: интерполяция снимков, как у других игроков
  const t = now - (s.interpDelayMs ?? 150);
  for (const [id, e] of cv.enemies) {
    if (e.deadAt) {
      e.alpha = Math.max(0, 1 - (now - e.deadAt) / (s.enemyFadeMs ?? 600));
      if (e.alpha <= 0) cv.enemies.delete(id);
      continue;
    }
    e.alpha = e.flags & 32 ? 0.22 : 1; // в дыму (ниндзя) — почти невидим
    const sn = e.snaps;
    while (sn.length > 2 && sn[1].t <= t) sn.shift();
    let nx, ny;
    if (sn.length >= 2 && sn[0].t <= t) {
      const k = Math.min(1, (t - sn[0].t) / Math.max(1, sn[1].t - sn[0].t));
      nx = sn[0].x + (sn[1].x - sn[0].x) * k; ny = sn[0].y + (sn[1].y - sn[0].y) * k;
      e.moving = Boolean(sn[1].m || sn[0].m);
    } else { const l = sn[sn.length - 1]; nx = l.x; ny = l.y; e.moving = Boolean(l.m); }
    const dsx = (nx - ny) - (e.x - e.y);
    if (Math.abs(dsx) > 1e-3) e.dir = dsx > 0 ? 1 : -1;
    e.x = nx; e.y = ny;
    e.flash = e.flashUntil > now ? (e.flashUntil - now) / (s.hitFlashMs ?? 140) : 0;
    e.ring = e === cv.target ? 'target' : e === cv.hover ? 'hover' : null;
  }
  // снаряды летят сами (сервер пришлёт попадание)
  for (const [id, p] of cv.shots) {
    const k = ((now - p.born) / 1000) * p.s;
    if (k >= p.r) { cv.shots.delete(id); continue; }
    p.x = p.x0 + Math.cos(p.a) * k; p.y = p.y0 + Math.sin(p.a) * k;
  }
  const fxAge = s.fxMaxAgeMs ?? 450;
  cv.fx = cv.fx.filter((f) => f.until > now || now - f.born < (f.k === 'levelup' ? fxAge * 3 : spellLife(f,fxAge)));
  cv.nums = cv.nums.filter((n) => now - n.born < (s.dmgNumberMs ?? 900));
  // панель турели закрывается, если отойти
  if (cv.panelId) {
    const tp = cv.turrets.get(cv.panelId), h = cv.api.getHero();
    if (!tp || Math.hypot(tp.x - h.x, tp.y - h.y) > (s.turretInteractRange ?? 3) + 0.5) closeTurretPanel();
  }
  // мины взводятся
  for (const tr of cv.traps.values()) tr.armed = now >= tr.armAt;
  // преследование цели: подойти на дистанцию и атаковать
  if(!cv.api.controlled?.())updateAutoCombat(now);
  if(cv.api.controlled?.())return;
  const tg = cv.target;
  if (tg) {
    const alive = cv.targetKind === 'e' ? cv.enemies.has(tg.id) && !tg.deadAt : cv.api.getOthers().has(tg.id) && !tg.dead;
    if (!alive) { cv.target = null; return; }
    const requestedSlot = cv.targetSlot || 'main';
    const activeSlot = cv.attackMode === 'throw' && requestedSlot === 'main' && Cb.canThrow(weaponOf('off')?.item) ? cv.nextThrow : requestedSlot;
    const w = weaponOf(activeSlot);
    const h = cv.api.getHero();
    const d = Math.hypot(tg.x - h.x, tg.y - h.y);
    const need = cv.targetKind === 'e' ? reach(w.prof, tg) : w.prof.kind === 'melee' ? w.prof.range + 0.2 : w.prof.range * 0.95;
    if (d > need) {
      if (now >= cv.repathAt) { const goal = w.prof.kind === 'melee' ? approachPoint(h,tg,need) : tg; cv.api.moveTo(goal.x,goal.y); cv.repathAt = now + (s.chaseRepathMs ?? 400); }
    } else {
      if (cv.api.isMoving()) cv.api.stop();
      tryAttack(requestedSlot, cv.targetKind === 'e' ? { enemy: tg } : { player: tg }, now);
    }
  } else if (cv.shift && cv.mouseDown && cv.mouse) { // Shift + зажатая кнопка — огонь на месте
    const r = cv.api.renderer();
    const enemy = pickEnemy(cv.mouse.sx, cv.mouse.sy);
    tryAttack('main', enemy ? { enemy } : r.toWorld(cv.mouse.sx, cv.mouse.sy), now);
  }
}

// Для рендера: враги, мины, турели и слой поверх всего
export function combatScene() {
  if (!cv) return {};
  return { enemies: [...cv.enemies.values()], traps: [...cv.traps.values()], turrets: [...cv.turrets.values()], overlay: drawOverlay };
}

// ---------- Слой поверх карты ----------

const magicColor = (id) => { const M = window.Magic, sp = M && M.get(id); return sp ? M.SCHOOLS[sp.school].color : '#c07aff'; };

function drawOverlay(r, now) {
  if (!cv) return;
  const ctx = r.ctx, u = r.hh * 0.9, s = cfg();
  const lift = u * 1.4; // высота полёта снаряда над землёй
  const fxAge = s.fxMaxAgeMs ?? 450;
  drawCharacterStatus(r,cv.api.getHero(),now,3.3);
  for(const [key,actor]of cv.statusActors){
    let auraUntil=0;
    for(const [group,aura]of Object.entries(actor.spellAuras||{})){if(aura.until<=now||actor.dead||actor.deadAt)delete actor.spellAuras[group];else{auraUntil=Math.max(auraUntil,aura.until);r.ctx.save();r.ctx.globalAlpha*=0.45;drawSpellSupport(r,{k:'spell',s:aura.spell,x:actor.x,y:actor.y,born:now-400},now,1200,actor);r.ctx.restore();}}
    if(Math.max(actor.frozenUntil||0,actor.rootUntil||0,actor.iceRootUntil||0,actor.burnUntil||0,auraUntil)<=now)cv.statusActors.delete(key);
    else if(actor!==cv.api.getHero())drawCharacterStatus(r,actor,now,actor.look?enemyHeight(actor.look):3.3);
  }
  ctx.save();
  // Плавные следы клинков, стихийные вспышки и объёмные снаряды.
  for (const f of cv.fx) {
    const who = f.k === 'cast' ? posOf(f.o || 'p', f.id) : f.k === 'levelup' ? posOf('p', f.id) : f.k==='spell' ? (f.t&&(posOf('p',f.t)||posOf('e',f.t)||posOf('c',f.t)))||posOf(f.o||'p',f.id) : null;
    if(f.k==='muzzle'&&!f.fixedMuzzle)f.muzzle=vehShotMuzzle(f.x,f.y,f.by)||actorMuzzle(f.source,f.hand);
    drawCombatEffect(r, f, now, f.k === 'levelup' ? fxAge * 3 : spellLife(f,fxAge), who);
  }
  for (const p of cv.shots.values()){
    if(!p.originMuzzle)p.originMuzzle=vehShotMuzzle(p.x0,p.y0,p.by,p.a)||actorMuzzle(p.source,p.hand);
    drawProjectile(r,p,now);
  }
  // полоски здоровья врагов: раненые (недавно), под курсором и цель
  ctx.textAlign = 'center';
  for (const e of cv.enemies.values()) {
    if (e.deadAt) continue;
    if (r.fog && !r.fog.see(e.x, e.y)) continue; // в тумане войны (шаг 22)
    const focus = e === cv.target || e === cv.hover;
    if (!focus && !(e.hp < 100 && e.hpShowUntil > now)) continue;
    const sp = r.toScreen(e.x, e.y);
    const y = sp.y - enemyHeight(e.look) * u - 8;
    bar(ctx, sp.x, y, Math.max(34, u * 1.6), e.hp / 100, '#d8412f');
    if (focus) {
      ctx.font = `${Math.max(10, 11 * Math.min(1.3, r.zoom)) * textScale()}px Segoe UI, Arial, sans-serif`;
      const mood=e.flags&256?' · почитатель':e.flags&512?' · сдаётся':e.flags&128?' · нейтрален':e.flags&4?' · напуган':'';
      r.label(`${e.def.name} · ур. ${e.lvl}${mood}`, sp.x, y - 6, e.flags&(128|256|512)?'#aad8bd':e.def.boss ? '#ff9a3a' : '#ffb0a0');
    }
  }
  // здоровье других игроков (если ранены)
  for (const o of cv.api.getOthers().values()) {
    if (o.hp == null || o.hp >= 100 || o.dead) continue;
    const sp = r.toScreen(o.x, o.y);
    bar(ctx, sp.x, sp.y - r.hh * 3.6 - 2, Math.max(30, u * 1.4), o.hp / 100, '#4fbf4a');
  }
  // всплывающие числа
  const life = s.dmgNumberMs ?? 900;
  for (const n of cv.nums) {
    const k = (now - n.born) / life;
    const sp = r.toScreen(n.x, n.y);
    ctx.globalAlpha = Math.max(0, 1 - k * k);
    ctx.font = `bold ${Math.round(Math.max(12, 15 * Math.min(1.4, r.zoom)) * n.scale * textScale())}px Segoe UI, Arial, sans-serif`;
    r.label(n.text, sp.x + n.jx * r.hw, sp.y - n.h * u - k * r.hh * 2.2, n.color);
  }
  ctx.restore();
}

function bar(ctx, x, y, w, frac, color) {
  const h = 5;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), h);
}
