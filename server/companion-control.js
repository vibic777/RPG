 'use strict';
const rt=require('./realtime'),M=require('../shared/movement'),C=require('../shared/companions'),Items=require('../shared/items'),Combat=require('../shared/combat');
const comps=()=>require('./companions'),combat=()=>require('./combat');
function current(c){const e=c.room&&comps().entOf(c.room,c.controlledComp),rec=C.list(c.character).find(r=>r.id===c.controlledComp);return e&&rec&&rec.out&&!rec.down&&!e.vehicleId&&!combat().cbOf(c).dead?{e,rec}:null;}
function release(c){if(!c.controlledComp)return;c.controlledComp=null;c.controlDir=null;c.controlGoal=null;c.dir=null;c.path=[];rt.send(c,{t:'comp-control',id:null});}
function select(c,id){if(!id||id===c.controlledComp){release(c);return;}if(c.mount||c.veh)throw Error('Сначала покиньте транспорт или слезьте с ездового существа.');const e=comps().entOf(c.room,id),rec=C.list(c.character).find(r=>r.id===id);if(!e||!rec||!rec.out||rec.down||e.vehicleId||combat().cbOf(c).dead)throw Error('Управлять можно только своим активным здоровым спутником вне транспорта.');c.controlledComp=id;c.controlHeroAt=0;c.controlHeroAttackAt=0;c.dir=null;c.path=[];c.controlDir=null;c.controlGoal=null;e.path=[];e.target=null;rt.send(c,{t:'comp-control',id});}
function input(c,m){if(!current(c))return release(c);if(m.action==='dir'){const dx=Number(m.dx),dy=Number(m.dy),l=Math.hypot(dx,dy);if(!Number.isFinite(l))return;c.controlDir=l?{dx:dx/l,dy:dy/l}:null;c.controlGoal=null;}else if(m.action==='move'){if(Number.isFinite(m.x)&&Number.isFinite(m.y)){c.controlGoal={x:Math.floor(m.x)+0.5,y:Math.floor(m.y)+0.5};c.controlDir=null;}}else if(m.action==='stop'){c.controlDir=null;c.controlGoal=null;}}
function attack(c,m){const pair=current(c);if(!pair)return release(c);const {e,rec}=pair,s=C.statsOf(rec),now=Date.now();if(e.stunUntil>now||e.nextAttack>now)return;
 const x=Number(m.x),y=Number(m.y);if(!Number.isFinite(x)||!Number.isFinite(y))return;
 const weapon=rec.equip?.weapon,item=weapon&&weapon.dur!==0?Items.get(weapon.id):null,p=item?Combat.profile(item):{kind:s.attack.kind,fx:s.attack.fx||'claw',proj:s.attack.proj||20,flags:s.attack.flags||[]};
 const prof={...p,damage:s.damage,damageType:s.attack.type,range:s.range,flags:p.flags||[],freezeSec:s.attack.freezeSec||0,rootSec:s.attack.rootSec||0},owner={kind:'c',id:e.id,ent:e,c},dir={x:x-e.x,y:y-e.y};
 if(p.ammo){rec.ammoOpen=rec.ammoOpen||{};if(!(rec.ammoOpen[p.ammo]>0)){const i=(rec.bag||[]).findIndex(a=>a.id===p.ammo&&a.n>0);if(i<0)return;rec.ammoOpen[p.ammo]=require('../shared/inventory').perItem(p.ammo);if(--rec.bag[i].n<=0)rec.bag.splice(i,1);}rec.ammoOpen[p.ammo]--;}
 prof.stealthCrit=comps().hiddenEnt(c.room,e);comps().revealEnt(e);
 e.nextAttack=now+1000/Math.max(0.2,s.attack.speed||1);e.target=m.target||null;
 if(p.kind==='cone')combat().coneStrike(c.room,owner,e,dir,prof,50);
 else if(['ranged','thrown'].includes(p.kind))combat().shoot(c.room,owner,e,dir,prof);
 else {combat().fx(c.room,{k:'swing',o:'c',id:e.id,x:e.x,y:e.y,a:Math.atan2(dir.y,dir.x),r:s.range,f:p.fx});for(const t of combat().hostiles(c.room,owner))if(Math.hypot(t.x-e.x,t.y-e.y)<=s.range+(t.r||0)&&Math.abs(Math.atan2(Math.sin(Math.atan2(t.y-e.y,t.x-e.x)-Math.atan2(dir.y,dir.x)),Math.cos(Math.atan2(t.y-e.y,t.x-e.x)-Math.atan2(dir.y,dir.x))))<Math.PI/2)combat().applyHit(c.room,owner,t,prof);}
 combat().markDirty(c);
}
function tick(c,dt){if(!c.controlledComp)return;const pair=current(c);if(!pair)return release(c);const {e,rec}=pair,s=C.statsOf(rec),now=Date.now(),map=c.room.map,fly=map.flyer,swim=map.swimmer;
 try{map.flyer=s.fly;map.swimmer=!s.fly;/* как в ИИ спутников: все плавают, летуны летят */let to={x:e.x,y:e.y};if(!(e.stunUntil>now||e.immobileUntil>now)){if(c.controlDir)to=M.moveWithCollision(map,e,c.controlDir.dx*s.speed*dt,c.controlDir.dy*s.speed*dt);else if(c.controlGoal){const g=c.controlGoal,d=Math.hypot(g.x-e.x,g.y-e.y);if(d<0.2)c.controlGoal=null;else{if(now>=(e.controlPathAt||0)){e.path=M.findPath(M.gridFromWorld(map),Math.floor(e.x),Math.floor(e.y),Math.floor(g.x),Math.floor(g.y))||[];e.controlPathAt=now+500;}const followed=M.followPath(map,e,e.path,dt,s.speed/M.settings.heroSpeed);to=followed.pos;e.path=followed.path;}}}
 const moved=Math.hypot(to.x-e.x,to.y-e.y)>0.001;e.x=to.x;e.y=to.y;e.path=moved?e.path.length?e.path:[[Math.floor(e.x),Math.floor(e.y)]]:[];
 }finally{map.flyer=fly;map.swimmer=swim;}
 const d=Math.hypot(e.x-c.pos.x,e.y-c.pos.y);if(now>=(c.controlHeroAt||0)){c.controlHeroAt=now+500;c.dir=null;if(d>2)c.path=M.findPath(M.gridFromWorld(map),Math.floor(c.pos.x),Math.floor(c.pos.y),Math.floor(e.x),Math.floor(e.y))||[];else c.path=[];}
 const it=Items.get(c.character.inventory.equipment.mainHand?.id),p=Combat.profile(it),target=[...combat().stateOf(c.room).enemies.values()].find(t=>!t.dead&&t.target===c.account.id&&Math.hypot(t.x-c.pos.x,t.y-c.pos.y)<=p.range+(t.def.radius||0));
 if(target&&now>=(c.controlHeroAttackAt||0)){c.controlHeroAttackAt=now+1000/Math.max(0.2,p.speed);combat().onAtk(c,{slot:'mainHand',tk:'e',target:target.id,x:target.x,y:target.y});}
}
rt.use({beforeLeave:release,handlers:{'comp-input':(c,m)=>input(c,m),'comp-attack':(c,m)=>attack(c,m)},tick:(room,dt)=>{for(const c of room.players.values())tick(c,dt);}});
module.exports={select,release,input,attack};
