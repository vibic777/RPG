'use strict';
const crypto=require('crypto');
const Magic=require('../shared/magic');
const combat=()=>require('./combat');
const fields=room=>room.magicFields||(room.magicFields=new Map());
function packet(f,now=Date.now()){return {id:f.id,s:f.spell,owner:f.owner.id,o:f.owner.kind,x:f.x,y:f.y,r:f.radius,f:f.fx,ms:Math.max(0,f.until-now),total:f.duration,pulse:f.pulse,slippery:f.slippery};}
function remove(room,id){if(fields(room).delete(id))room.broadcast({t:'magic-field',remove:id});}
function add(room,owner,s,k,center){
  const list=fields(room),now=Date.now(),mine=[...list.values()].filter(f=>f.owner.id===owner.id);
  for(const f of mine)if(f.spell===s.id)remove(room,f.id);
  while([...list.values()].filter(f=>f.owner.id===owner.id).length>=4){const old=[...list.values()].find(f=>f.owner.id===owner.id);remove(room,old.id);}
  if(list.size>=48)remove(room,list.keys().next().value);
  const stealthCrit=s.stealthCrit??(owner.kind==='p'?require('./magic').hidden(owner.c):owner.kind==='c'?require('./companions').hiddenEnt(room,owner.ent):false);
  const f={stealthCrit,id:'mf'+crypto.randomBytes(5).toString('hex'),spell:s.id,spec:s,owner,x:center.x,y:center.y,radius:s.radius,fx:s.fx,duration:s.dur*1000,until:now+s.dur*1000,next:now,pulse:s.pulse||1,k,slippery:Boolean(s.slippery)};
  list.set(f.id,f);room.broadcast({t:'magic-field',field:packet(f)});return f;
}
function snapshot(room){return [...fields(room).values()].map(f=>packet(f));}
function slippery(room,pos){if(!room.magicFields?.size)return false;const now=Date.now();for(const f of room.magicFields.values())if(f.slippery&&f.until>now&&Math.hypot(pos.x-f.x,pos.y-f.y)<=f.radius)return true;return false;}
function tick(room,now){
  if(!room.magicFields?.size)return;
  const cs=combat();
  for(const f of [...fields(room).values()]){
    const owner=f.owner;
    const gone=owner.kind==='p'?(owner.c.room!==room||cs.cbOf(owner.c).dead):owner.kind==='e'?!cs.stateOf(room).enemies.has(owner.id)||Boolean(cs.stateOf(room).enemies.get(owner.id)?.dead):!require('./companions').entOf(room,owner.id);
    if(now>=f.until||gone){remove(room,f.id);continue;}
    if(now<f.next)continue;f.next=now+f.pulse*1000;
    const s=Magic.get(f.spell)||f.spec;if(!s?.damage)continue;
    const prof={stealthCrit:f.stealthCrit,kind:'spell',damage:Magic.scaled(s.damage,f.k),damageType:s.type,superAttack:Boolean(s.superAttack),flags:['magic',...s.flags],fx:s.fx,rootSec:s.root||0,stunSec:s.stun||0,freezeSec:s.freeze||0,lifesteal:s.lifesteal||0,undead:s.undead};
    for(const target of cs.hostiles(room,owner)){
      if(Math.hypot(target.x-f.x,target.y-f.y)>f.radius+(target.r||0))continue;
      if(owner.kind==='p')require('./magic').onAttack(owner.c);else if(owner.kind==='c')require('./companions').revealEnt(owner.ent);
      if(target.kind==='p'&&require('./levels').airborne(target.ref)&&['iceRain','roots','iceFloor','earthSpikes'].includes(f.fx))continue;
      cs.applyHit(room,owner,target,prof);
    }
  }
}
function clearOwner(room,id){for(const f of [...fields(room).values()])if(f.owner.id===id)remove(room,f.id);}
module.exports={add,tick,snapshot,slippery,clearOwner};
