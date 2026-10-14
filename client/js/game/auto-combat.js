export function attackDistance(prof,target,margin=0.08) {
  return prof.kind==='melee'?Math.max(0.2,prof.range+(target.def&&target.def.radius||target.radius||0.4)-margin):prof.range*0.94;
}
export function approachPoint(hero,target,reach) {
  const dx=target.x-hero.x,dy=target.y-hero.y,d=Math.max(0.001,Math.hypot(dx,dy));
  const stop=Math.max(0.35,reach-0.45);
  return {x:target.x-dx/d*stop,y:target.y-dy/d*stop};
}
export function nearestAutoEnemy(hero,enemies,maxRange,visible=()=>true,hostile=()=>true) {
  let best=null,distance=maxRange;
  for(const enemy of enemies) {
    if(enemy.deadAt||enemy.dead||enemy.hp===0||enemy.flags&(32|128|256|512)||!visible(enemy)||!hostile(enemy))continue;
    if(enemy.def&&enemy.def.behaviour==='loner'&&!(enemy.flags&8))continue;
    const d=Math.hypot(enemy.x-hero.x,enemy.y-hero.y);
    if(d<distance){distance=d;best=enemy;}
  }
  return best;
}

export function autoSpellUsable(spell,hero,target,vitals,maxHp,state,now) {
  if(!spell||!state.instant&&vitals.mp<spell.mp||(state.cds[spell.id]||0)>now)return false;
  if(hero.moving&&spell.cast>0&&!state.instant)return false;
  const distance=target?Math.hypot(target.x-hero.x,target.y-hero.y):Infinity;
  if(['enemy','point'].includes(spell.target)&&(!target||distance>spell.range))return false;
  if(spell.target==='around'&&(!target||distance>(spell.radius||spell.range||3)))return false;
  const b=state.buffs||{};
  if(spell.kind==='heal')return vitals.hp<maxHp*0.8;
  if(spell.kind==='hot')return vitals.hp<maxHp*0.9&&!(b.regen>now);
  if(spell.kind==='cleanse')return Boolean(hero.stunUntil>now||b.weak>now||hero.afflicted);
  if(spell.kind==='shield')return Boolean(target)&&!(b.shield>0);
  if(spell.kind==='buff'&&spell.defense)return Boolean(target)&&!(b.def>now);
  if(spell.kind==='buff'&&spell.speed)return Boolean(target)&&!(b.speed>now);
  if(spell.kind==='vampirism')return Boolean(target)&&!(b.vampirism>now);
  if(spell.kind==='stealth')return Boolean(target)&&!(b.hidden>now);
  if(spell.kind==='step')return Boolean(target)&&distance>1.8;
  if(spell.target==='self'&&spell.damage)return Boolean(target)&&distance<=(spell.radius||spell.range||3);
  return Boolean(target);
}
