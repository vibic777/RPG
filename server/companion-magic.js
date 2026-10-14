'use strict';
const Magic = require('../shared/magic');
const Items = require('../shared/items');
const C = require('../shared/companions');
const Enemies = require('../shared/enemies');
const config = require('./config');
const combat = () => require('./combat');
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function known(rec) {
  return [...new Set([...(Enemies.get(rec.def).spells || []), ...(rec.bag || []).map(x => Items.get(x.id)?.teachesSpell).filter(Boolean)])];
}
function apply(room, c, ent, rec, s, target, now,stealthCrit=false) {
  const cs = combat(), stats = C.statsOf(rec), owner = { kind: 'c', id: ent.id, ent, c };
  const enemies = [...cs.stateOf(room).enemies.values()].filter(e => !e.dead && (e.target || e === target || !require('./factions').peacefulTo(c, e)));
  const angle = target ? Math.atan2(target.y - ent.y, target.x - ent.x) : 0;
  const duration = (s.dur || 5) * 1000;
  cs.fx(room, { k: 'spell', o: 'c', id: ent.id, s: s.id, t:s.kind==='debuff'&&target?target.id:ent.id, x: ent.x, y: ent.y });
  if(['shield','buff','hot','vampirism','debuff'].includes(s.kind))cs.fx(room,{k:'aura',t:s.kind==='debuff'?'e':'c',id:s.kind==='debuff'?target.id:ent.id,s:s.id,group:s.kind,ms:duration});
  const prof = { stealthCrit,damage: s.damage || [0, 0], damageType: s.type, flags: ['magic', ...s.flags], range: s.range || s.radius || 8, proj: s.proj || 20, fx: s.fx || s.type, stunSec: s.stun || 0, rootSec: s.root || 0,freezeSec:s.freeze||0,lifesteal:s.lifesteal||0,undead:s.undead };
  const hit = e => cs.applyHit(room, owner, { kind: 'e', ref: e, x: e.x, y: e.y, r: e.def.radius }, prof);
  if(s.kind==='field')require('./magic-fields').add(room,owner,{...s,stealthCrit},1,s.target==='around'?ent:target||ent);
  else if(s.kind==='vampirism')ent.vampirism={factor:s.lifesteal,until:now+duration};
  else if (s.kind === 'bolt' && target) cs.shoot(room, owner, ent, { x: Math.cos(angle), y: Math.sin(angle) }, prof);
  else if (s.kind === 'chain' && target) {
    const list = [target, ...enemies.filter(e => e !== target && distance(e, target) <= 3)].slice(0, 3);
    let last = ent;
    for (const e of list) { cs.fx(room, { k: 'chain', x: last.x, y: last.y, x2: e.x, y2: e.y, f: s.fx || 'spark' }); hit(e); last = e; }
  } else if (s.kind === 'aoe') {
    const center = s.target === 'around' ? ent : target || ent;
    cs.fx(room, { k: 'boom', x: center.x, y: center.y, r: s.radius, f: s.fx });
    for (const e of enemies) if (distance(e, center) <= s.radius + e.def.radius) hit(e);
  } else if (s.kind === 'cone') {
    cs.coneStrike(room, owner, ent, { x: Math.cos(angle), y: Math.sin(angle) }, prof, s.deg || 70);
  } else if (s.kind === 'heal') { rec.hp = Math.min(stats.maxHp, rec.hp + (s.heal[0] + s.heal[1]) / 2); cs.fx(room, { k: 'heal', t: 'c', id: ent.id, n: Math.round((s.heal[0] + s.heal[1]) / 2) }); }
  else if (s.kind === 'hot') ent.regen = { perSec: s.perSec, until: now + duration };
  else if (s.kind === 'shield') ent.shield = { amount: s.absorb, until: now + duration };
  else if (s.kind === 'buff') { if (s.defense) ent.defBuff = { amount: s.defense, until: now + duration }; if (s.speed) ent.speedBuff = { k: s.speed, until: now + duration }; }
  else if (s.kind === 'debuff' && target) { target.weakUntil = now + duration; target.weakFactor = s.factor; }
  else if (s.kind === 'fear') {
    const AI = require('./ai');
    for (const e of enemies) if (!e.def.boss && distance(e, ent) <= s.radius) { e.target = e.target || c.account.id; AI.setState(e, 'flee', now - Math.max(0, (config.get().game.fleeRecoverSec - s.dur) * 1000)); e.path = []; }
  } else if (s.kind === 'summon' && !c.autonomous) require('./companions').summon(room, c, Enemies.get(s.summon), rec.level, s.dur);
  else if (s.kind === 'charm' && !c.autonomous && target && C.freeSlots(c.character) && cs.random() < 0.35) require('./companions').enthrall(room, c, target, s.dur);
  else if (['blink', 'step'].includes(s.kind) && target) {
    const p = { x: target.x - Math.cos(angle), y: target.y - Math.sin(angle) };
    if (require('../shared/worldgen').isWalkable(room.map, Math.floor(p.x), Math.floor(p.y))) { ent.x = p.x; ent.y = p.y; ent.path = []; }
  } else if (s.kind === 'stealth') { ent.hiddenUntil = now + duration; ent.target = null; for (const e of enemies) if (e.target === ent.id) { e.target = null; e.path = []; } }
  else if (s.kind === 'cleanse') { ent.stunUntil = 0; ent.immobileUntil = 0; ent.frozenUntil=0;ent.dots = [];cs.fx(room,{k:'status',t:'c',id:ent.id,f:'clear',ms:0}); }
  if (c.cb) c.cb.dirty = true;
}
function step(room, c, ent, rec, target, dt, now) {
  if (!config.get().game.magicEnabled) return false;
  const ids = known(rec), maxMp = 40 + rec.level * 4;
  rec.mp = Math.min(maxMp, (Number.isFinite(rec.mp) ? rec.mp : maxMp) + dt * 2);
  if (ent.regen && ent.regen.until > now) rec.hp = Math.min(C.statsOf(rec).maxHp, rec.hp + ent.regen.perSec * dt);
  if (ent.casting) {
    if (!ids.includes(ent.casting.spell) || ent.stunUntil > now && Magic.get(ent.casting.spell)?.kind !== 'cleanse') { ent.casting = null; combat().fx(room, { k: 'cast', o: 'c', id: ent.id, s: '', ms: 0 }); return false; }
    if (now < ent.casting.until) return true;
    const cast = ent.casting; ent.casting = null;
    const enemy = cast.target && combat().stateOf(room).enemies.get(cast.target);
    const s = Magic.get(cast.spell);
    if (s && (!cast.target || enemy && !enemy.dead && distance(ent, enemy) <= (s.range || s.radius || 0) + enemy.def.radius + 1)) apply(room, c, ent, rec, s, enemy, now,cast.stealthCrit);
    return true;
  }
  if (now < (ent.nextCastAt || 0)) return false;
  ent.nextCastAt = now + 400;
  ent.spellCd = ent.spellCd || {};
  const hp = rec.hp / C.statsOf(rec).maxHp;
  const candidates = ids.map(id => Magic.get(id)).filter(s => s && !(c.autonomous&&['summon','charm'].includes(s.kind)) && (ent.stunUntil <= now || !ent.stunUntil || s.kind === 'cleanse') && rec.mp >= s.mp && now >= (ent.spellCd[s.id] || 0) && (
    ['heal', 'hot'].includes(s.kind) ? hp < 0.7 && !(ent.regen && ent.regen.until > now) :
    ['shield', 'buff', 'vampirism', 'stealth', 'summon', 'cleanse'].includes(s.kind) ? target && (s.kind!=='vampirism'||!ent.vampirism||ent.vampirism.until<=now) && (s.kind !== 'shield' || !ent.shield || ent.shield.until <= now) && (s.kind !== 'cleanse' || ent.stunUntil > now || ent.immobileUntil > now) :
    target && (s.kind !== 'charm' || C.freeSlots(c.character)) && distance(ent, target) <= (s.range || s.radius || 0) + target.def.radius));
  const s = candidates.sort((a,b) => Number(['heal','hot'].includes(b.kind)) - Number(['heal','hot'].includes(a.kind)))[0];
  if (!s) return false;
  rec.mp -= s.mp; ent.spellCd[s.id] = now + s.cd * 1000; ent.path = [];
  ent.casting = { spell: s.id, until: now + s.cast * 1000, target: ['heal','hot','shield','buff','vampirism','stealth','summon','cleanse','fear'].includes(s.kind) ? null : target && target.id };
  ent.casting.stealthCrit=require('./companions').hiddenEnt(room,ent);
  if(s.damage||['debuff','charm','fear'].includes(s.kind))require('./companions').revealEnt(ent);
  combat().fx(room, { k: 'cast', o: 'c', id: ent.id, s: s.id, ms: Math.max(100, s.cast * 1000) });
  return true;
}
module.exports = { step, known };
