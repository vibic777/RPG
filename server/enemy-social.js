'use strict';
const realtime=require('./realtime'),B=require('./enemy-behaviour');
const combat=()=>require('./combat');
function talk(c,m){
 const room=c.room;if(!room)return;
 const e=combat().stateOf(room).enemies.get(String(m.id||''));
 const reject=text=>realtime.send(c,{t:'enemy-dialogue',id:e?.id,text,options:[]});
 if(!e||e.dead||combat().cbOf(c).dead||Math.hypot(e.x-c.pos.x,e.y-c.pos.y)>4)return reject('Для разговора подойдите ближе.');
 if(!B.social(e))return reject('Он не станет вести переговоры.');
 if(!m.action)return realtime.send(c,{t:'enemy-dialogue',id:e.id,text:e.state==='flee'?'Он напуган. Можно предложить перемирие или признать вашу силу.':'Попытаться договориться? Успех зависит от Убеждения, вашей силы и его решимости.',options:e.followerOf===c.account.id?['dismiss']:['peace','follow']});
 if(Date.now()<(e.talkAt||0))return reject('Он ещё обдумывает предыдущий разговор.');
 if(m.action==='follow'&&[...combat().stateOf(room).enemies.values()].filter(x=>!x.dead&&x.followerOf===c.account.id).length>=6)return reject('За вами уже идут шесть почитателей.');
 e.talkAt=Date.now()+10000;
 const result=B.negotiate(e,c,m.action,combat().random);
 if(!result.ok&&e.disposition==='hostile')require('./ai').engage(combat().aiCtx(room,Date.now()),e,{id:c.account.id,...c.pos});
 realtime.send(c,{t:'enemy-dialogue',id:e.id,text:result.text,options:[]});
 combat().saveWorldState(room);
}
realtime.use({
 handlers:{'enemy-talk':talk},
 beforeLeave:(room,c)=>{
  if(!c.levelMove)return;
  c.followersTravelling=[];
  for(const e of [...combat().stateOf(room).enemies.values()])if(!e.dead&&e.followerOf===c.account.id){c.followersTravelling.push({def:e.def,level:e.level,hp:e.hp,maxHp:e.maxHp,personality:e.personality,equip:e.equip,bag:e.bag});combat().removeEnemy(room,e,false);}
 },
 onJoin:(room,c)=>{
  for(const saved of c.followersTravelling||[]){const p=realtime.freeSpawn(room,{x:Math.floor(c.pos.x),y:Math.floor(c.pos.y)}),e=combat().spawnEnemy(room,saved.def,saved.level,p.x,p.y,null,{loadout:{equip:saved.equip,bag:saved.bag}});Object.assign(e,{hp:Math.max(1,e.maxHp*saved.hp/saved.maxHp),personality:saved.personality,disposition:'follower',followerOf:c.account.id,state:'follower'});}
  c.followersTravelling=[];
 }
});
module.exports={talk};
