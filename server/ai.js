'use strict';
// ИИ врагов (сервер). Чистая логика без сети: состояние врага меняется функцией think(),
// всё внешнее (карта, игроки, атака) передаётся в ctx — поэтому ИИ легко проверять в тестах.
//
// Состояния: idle (стоит) → wander (бродит у дома) → chase (заметил героя, идёт по A*) → attack (бьёт/стреляет);
// return (ушёл дальше поводка — возвращается домой, лечится); flee (мало здоровья — убегает).
// Параметры поведения берутся из данных врага (shared/enemies.js → BEHAVIOURS), а не из ветвлений по видам.
const M = require('../shared/movement');
const Enemies = require('../shared/enemies');
const Behaviour = require('./enemy-behaviour');

// ctx: { map, grid, game, now, rnd, players: [{ id, x, y, dead, radius }], enemies: [...], isSafe(x, y), attack(e, target) }
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function aggroRadius(e) { return e.def.aggro * (Enemies.behaviourOf(e.def).aggroFactor || 1); }
function leashRadius(e) { return e.def.leash * (Enemies.behaviourOf(e.def).leashFactor || 1); }

// Ближайший живой герой в радиусе обнаружения (герои в безопасной зоне невидимы для врагов)
function findTarget(ctx, e) {
  let best = null, bd = Infinity;
  const r = aggroRadius(e);
  if(!Behaviour.hostile(e)||Behaviour.profile(e).neutral&&!e.provoked&&e.disposition!=='hostile')return null;
  if (Enemies.behaviourOf(e.def).passive) return null; // одиночка не нападает первым
  for (const p of ctx.players) {
    if (p.dead || ctx.isSafe(p.x, p.y) || (ctx.peaceful && ctx.peaceful(e, p))) continue; // фракция героя не трогает (шаг 16)
    const d = dist(e, p);
    if (d <= r && d < bd && dist(e.home, p) <= leashRadius(e)) { best = p; bd = d; }
  }
  return best;
}

// Натравить врага на героя (с тревогой стаи)
function engage(ctx, e, target, alarm = true) {
  if (e.state === 'return' || e.state === 'flee') { if (!alarm) return; }
  e.target = target.id;
  e.provoked=true;
  if(Behaviour.profile(e).neutral)e.disposition='hostile';
  if (e.state !== 'attack') setState(e, 'chase', ctx.now);
  const b = Enemies.behaviourOf(e.def);
  if (alarm && !e.def.boss && b.packAggro) {
    const r = ctx.game.packAggroRadius * (b.alarmFactor || 1);
    for (const o of require('./enemy-neighbours').near(ctx,e,r)) {
      if (o === e || !Behaviour.hostile(o) || Behaviour.profile(o).neutral&&!o.provoked&&o.disposition!=='hostile' || o.target || o.state === 'flee') continue;
      // тревогу слышат сородичи: тот же вид или то же семейство со стайным поведением
      if (o.def.id !== e.def.id && !(o.def.family === e.def.family && Enemies.behaviourOf(o.def).packAggro)) continue;
      if (dist(o, e) <= r) { o.target = target.id; o.path = []; setState(o, 'chase', ctx.now); }
    }
  }
}

function setState(e, s, now) {
  if (e.state === s) return;
  e.state = s;
  e.stateAt = now;
  e.path = [];
  e.repathAt = 0;
}

// Роботы и наземные дроны ходят по дну (Enemies.seabedWalker): на время поиска пути и шага вода для них проходима
function onSeabed(ctx, e, fn) {
  const prev=ctx.map.swimmer,prevRadius=ctx.map.actorRadius;
  ctx.map.actorRadius=e.def.radius||M.settings.actorRadius;
  if (Enemies.seabedWalker(e.def)) ctx.map.swimmer = true;
  try { return fn(); } finally { ctx.map.swimmer=prev;ctx.map.actorRadius=prevRadius; }
}

// Путь A* к точке (клетки); если не нашёлся — пустой (враг стоит)
function pathTo(ctx, e, x, y) {
  if (e.def.fly) { // летун — напрямую, над водой и горами (в пределах карты)
    const tx = Math.max(0, Math.min(ctx.map.width - 1, Math.floor(x))), ty = Math.max(0, Math.min(ctx.map.height - 1, Math.floor(y)));
    return tx === Math.floor(e.x) && ty === Math.floor(e.y) ? [] : [[tx, ty]];
  }
  const p = onSeabed(ctx, e, () => M.findPath(ctx.grid, Math.floor(e.x), Math.floor(e.y), Math.floor(x), Math.floor(y), ctx.game.aiPathMaxNodes));
  return p || [];
}

// Сдвинуть врага по пути; в безопасную зону не заходит
function moveAlong(ctx, e, dt) {
  if (!e.path.length) return false;
  const pace = e.def.boss ? (ctx.game.bossSpeedFactor ?? 0.55) : e.def.fly ? 1 : (ctx.game.enemySpeedFactor ?? 1);
  const bonus = e.cheatSpeed || 1;
  const mul = (e.def.speed / M.settings.heroSpeed) * (e.def.boss ? pace : pace * (e.speedMul == null ? 1 : e.speedMul) * bonus); // босс остаётся медленным и в элитной версии
  if (mul <= 0) return false;
  const r = e.def.fly ? flyAlong(e, dt, mul) : onSeabed(ctx, e, () => M.followPath(ctx.map, e, e.path, dt, mul));
  if (ctx.isSafe(r.pos.x, r.pos.y) && !ctx.isSafe(e.x, e.y)) { e.path = []; return false; }
  e.x = r.pos.x; e.y = r.pos.y; e.path = r.path;
  return true;
}

// Полёт по точкам пути напрямую, скорость не зависит от местности
function flyAlong(e, dt, mul) {
  let budget = M.settings.heroSpeed * mul * dt, p = { x: e.x, y: e.y };
  const rest = e.path.slice();
  while (rest.length && budget > 0) {
    const tx = rest[0][0] + 0.5, ty = rest[0][1] + 0.5, d = Math.hypot(tx - p.x, ty - p.y);
    if (d <= budget) { p = { x: tx, y: ty }; budget -= d; rest.shift(); } else { p = { x: p.x + ((tx - p.x) / d) * budget, y: p.y + ((ty - p.y) / d) * budget }; budget = 0; }
  }
  return { pos: p, path: rest };
}

// Шаг прочь от точки (стрелки держат дистанцию, раненые убегают)
function stepAway(ctx, e, from, dist0) {
  const dx = e.x - from.x, dy = e.y - from.y, d = Math.hypot(dx, dy) || 1;
  const tx = Math.max(0, Math.min(ctx.map.width - 1, Math.floor(e.x + (dx / d) * dist0)));
  const ty = Math.max(0, Math.min(ctx.map.height - 1, Math.floor(e.y + (dy / d) * dist0)));
  e.path = pathTo(ctx, e, tx, ty);
}

const inAttackRange = (e, t) => dist(e, t) <= e.def.attack.range + (t.radius || 0.3);

// Главная функция ИИ: один шаг для врага e за dt секунд.
// Враги, созданные администратором (ignoreSafe), не признают безопасных зон — чтобы их можно было проверить у точки появления.
const NEVER = () => false;
function think(ctx, e, dt) {
  if (!e.ignoreSafe) return thinkInner(ctx, e, dt);
  const saved = ctx.isSafe;
  ctx.isSafe = NEVER;
  try { return thinkInner(ctx, e, dt); } finally { ctx.isSafe = saved; }
}
function thinkInner(ctx, e, dt) {
  const { now, game } = ctx;
  if (e.dead) return;
  const stunned = e.stunUntil > now;
  const target = e.target ? ctx.players.find((p) => p.id === e.target) : null;
  const b = Enemies.behaviourOf(e.def);

  // бегство при малом здоровье (один раз, пока не восстановится)
  if (!Behaviour.steadfast(e) && ((e.def.fleeAt > 0 && e.hp / e.maxHp <= e.def.fleeAt)||Behaviour.morale(e,ctx,target)) && e.state !== 'flee' && e.state !== 'return' && !e.fled) {
    e.fled = true;
    setState(e, 'flee', now);
  }
  if (stunned) return;

  switch (e.state) {
    case 'follower': {
      const owner=ctx.players.find(p=>p.id===e.followerOf&&!p.dead);
      if(!owner)return;
      if(dist(e,owner)>3){if(!e.path.length||now>=e.repathAt){e.path=pathTo(ctx,e,owner.x,owner.y);e.repathAt=now+1000;}moveAlong(ctx,e,dt);}else e.path=[];
      break;
    }
    case 'idle':
    case 'wander': {
      const t = findTarget(ctx, e);
      if (t) { engage(ctx, e, t); break; }
      if (e.state === 'idle' && now >= (e.wanderAt || 0)) {
        const r = game.aiWanderRadius;
        const tx = Math.floor(e.home.x + (ctx.rnd() * 2 - 1) * r), ty = Math.floor(e.home.y + (ctx.rnd() * 2 - 1) * r);
        if (tx >= 0 && ty >= 0 && tx < ctx.map.width && ty < ctx.map.height && !ctx.isSafe(tx + 0.5, ty + 0.5)) {
          setState(e, 'wander', now);
          e.path = pathTo(ctx, e, tx, ty);
        }
        e.wanderAt = now + (game.aiIdleMinSec + ctx.rnd() * Math.max(0, game.aiIdleMaxSec - game.aiIdleMinSec)) * 1000;
      } else if (e.state === 'wander' && !moveAlong(ctx, e, dt)) setState(e, 'idle', now);
      break;
    }
    case 'chase':
    case 'attack': {
      if (!target || target.dead || ctx.isSafe(target.x, target.y) || dist(e, e.home) > leashRadius(e) || dist(target, e.home) > leashRadius(e) + e.def.attack.range) {
        e.target = null;
        setState(e, 'return', now);
        break;
      }
      const d = dist(e, target);
      if (inAttackRange(e, target)) {
        if (e.state !== 'attack') setState(e, 'attack', now);
        // стрелок отходит, если герой подошёл вплотную
        if (b.keepDistance && d < e.def.attack.range * b.keepDistance) {
          if (!e.path.length || now >= e.repathAt) { stepAway(ctx, e, target, game.aiRetreatStep); e.repathAt = now + game.aiRepathSec * 1000; }
          moveAlong(ctx, e, dt);
        }
        if (now >= (e.nextAttack || 0)) {
          const bossAttackSpeed = e.def.boss ? Math.min(e.def.attack.speed, ctx.game.bossAttackSpeedMax ?? 0.5) : e.def.attack.speed;
          e.nextAttack = now + 1000 / bossAttackSpeed;
          e.face = Math.atan2(target.y - e.y, target.x - e.x);
          ctx.attack(e, target);
        }
      } else {
        if (e.state !== 'chase') setState(e, 'chase', now);
        if (now >= (e.repathAt || 0) || !e.path.length) {
          const team=require('./enemy-neighbours').near(ctx,e,12).filter(o=>o!==e&&!o.dead&&o.target===target.id&&o.def.family===e.def.family);
          const role=Behaviour.profile(e).role;
          let aim=target;
          if(!e.def.boss&&team.length>=2&&['left','right'].includes(role)&&d>3){const a=Math.atan2(target.y-e.y,target.x-e.x)+(role==='left'?1:-1)*Math.PI/2;aim={x:target.x+Math.cos(a)*2.5,y:target.y+Math.sin(a)*2.5};}
          if(!e.def.boss&&team.length>=2&&role==='lure'&&d<6&&Math.floor(now/4000)%2===0){const a=Math.atan2(e.y-target.y,e.x-target.x);aim={x:e.x+Math.cos(a)*2,y:e.y+Math.sin(a)*2};}
          e.path = pathTo(ctx, e, aim.x, aim.y);
          if(!e.path.length&&aim!==target)e.path=pathTo(ctx,e,target.x,target.y);
          // нет пути — стены базы: идём напролом и ломаем первую постройку на пути
          if (!e.path.length && ctx.breachPath && !e.def.fly) e.path = ctx.breachPath(e, target.x, target.y);
          e.repathAt = now + game.aiRepathSec * 1000;
        }
        if (e.path.length && ctx.blockAt && !e.def.fly) {
          const [nx, ny] = e.path[0];
          const piece = ctx.blockAt(nx, ny);
          if (piece) { // вплотную к постройке — бьём её, внутрь не заходим
            if (now >= (e.nextAttack || 0)) { const bossAttackSpeed = e.def.boss ? Math.min(e.def.attack.speed, ctx.game.bossAttackSpeedMax ?? 0.5) : e.def.attack.speed; e.nextAttack = now + 1000 / bossAttackSpeed; e.face = Math.atan2(ny + 0.5 - e.y, nx + 0.5 - e.x); ctx.hitPiece(e, piece); }
            break;
          }
        }
        moveAlong(ctx, e, dt);
      }
      break;
    }
    case 'return': {
      if (dist(e, e.home) < 1) {
        setState(e, 'idle', now);
        e.fled = false;
        break;
      }
      if (!e.path.length) {
        e.path = pathTo(ctx, e, e.home.x, e.home.y);
        if (!e.path.length) { e.home = { x: e.x, y: e.y }; setState(e, 'idle', now); break; }
      }
      moveAlong(ctx, e, dt);
      break;
    }
    case 'flee': {
      if (now - e.stateAt > game.fleeRecoverSec * 1000) {
        if(b.peaceful){e.target=null;setState(e,'return',now);break;}
        if(Behaviour.social(e)&&Behaviour.profile(e).courage<.3&&e.hp/e.maxHp<.3){e.disposition='surrender';e.target=null;setState(e,'surrender',now);break;}
        setState(e, target && !target.dead ? 'chase' : 'return', now);
        break;
      }
      if (target && (!e.path.length || now >= e.repathAt)) { stepAway(ctx, e, target, game.aiFleeStep); e.repathAt = now + game.aiRepathSec * 1000; }
      moveAlong(ctx, e, dt);
      break;
    }
    case 'surrender': e.path=[];break;
    default:
      setState(e, 'idle', now);
  }
}

// Лёгкое расталкивание врагов, чтобы толпа не сливалась в одну точку
function separate(ctx, list) {
  const r = ctx.game.enemySeparation;
  if (!(r > 0)) return;
  const spatial={enemies:list},indices=new Map(list.map((e,i)=>[e,i]));
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.dead) continue;
    for (const b of require('./enemy-neighbours').near(spatial,a,r)) {
      if(indices.get(b)<=i)continue;
      if (b.dead) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= r || d < 1e-6) continue;
      const push = (r - d) / 2, ux = dx / d, uy = dy / d;
      const na = { x: a.x - ux * push, y: a.y - uy * push }, nb = { x: b.x + ux * push, y: b.y + uy * push };
      if (onSeabed(ctx, a, () => M.posWalkable(ctx.map, na.x, na.y)) && !ctx.isSafe(na.x, na.y)) { a.x = na.x; a.y = na.y; }
      if (onSeabed(ctx, b, () => M.posWalkable(ctx.map, nb.x, nb.y)) && !ctx.isSafe(nb.x, nb.y)) { b.x = nb.x; b.y = nb.y; }
    }
  }
}

// Враг получил урон от героя — сразу замечает его (даже издалека), если не возвращается домой
function onDamaged(ctx, e, attacker) {
  if (e.dead || !attacker) return;
  if(Enemies.behaviourOf(e.def).peaceful){e.disposition='neutral';e.target=attacker.id;e.fled=true;setState(e,'flee',ctx.now);return;}
  e.disposition='hostile';e.provoked=true;e.followerOf=null;
  if(['follower','surrender'].includes(e.state))setState(e,'idle',ctx.now);
  if (e.state === 'idle' || e.state === 'wander' || (e.state === 'chase' && !e.target)) engage(ctx, e, attacker);
}

function recover(ctx,e,dt){
 if(e.dead||e.hp<=0||ctx.now-(e.hurtAt||0)<(ctx.game.regenDelaySec??5)*1000)return;
 const target=e.target&&ctx.players.find(p=>p.id===e.target&&!p.dead);
 if(target&&dist(e,target)<=e.def.attack.range+2)return;
 e.hp=require('../shared/recovery').heal(e.hp,e.maxHp,e.maxHp*(ctx.game.enemyRegenPctPerSec??.25)/100,dt);
}

// Шум выстрела будит врагов вокруг (бесшумное оружие — нет)
function onNoise(ctx, x, y, attacker, radius) {
  for (const e of ctx.enemies) {
  if (Behaviour.hostile(e) && !e.target && (e.state === 'idle' || e.state === 'wander') && Math.hypot(e.x - x, e.y - y) <= radius && !(ctx.peaceful && ctx.peaceful(e, attacker))) engage(ctx, e, attacker, false);
  }
}

module.exports = { recover,think, pathTo, moveAlong, separate, onDamaged, onNoise, findTarget, engage, setState, aggroRadius, leashRadius, inAttackRange };
