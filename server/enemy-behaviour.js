'use strict';
const hash=s=>{let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
const steadfast=e=>Boolean(e.def.boss||e.guardOf||e.bossGuard||['wolf','wolf_mutant'].includes(e.def.id)||['robot','zombie','insect'].includes(e.def.family));
const social=e=>['human','mage','cyborg','mutant'].includes(e.def.family)&&!steadfast(e);
function profile(e){
 if(e.personality)return e.personality;
 const seed=hash(e.id),human=social(e);
 return e.personality={courage:steadfast(e)?1:.2+(seed%71)/100,neutral:['civil','loner'].includes(e.def.behaviour)||human&&seed%11===0,role:['lure','left','right','rush'][seed%4]};
}
function hostile(e){return !e.dead&&!['neutral','follower','surrender'].includes(e.disposition);}
function morale(e,ctx,target){
 if(steadfast(e)||!target)return false;
 const p=profile(e),friends=require('./enemy-neighbours').near(ctx,e,8).filter(o=>o!==e&&!o.dead&&o.def.family===e.def.family).length;
 const pressure=Math.max(0,(target.level||e.level||1)/(e.level||1)-1)*.08;
 return e.hp/e.maxHp < Math.max(e.def.fleeAt||0,(1-p.courage)*.3+pressure-friends*.025);
}
function negotiate(e,c,action,rnd=Math.random){
 if(!social(e))return{ok:false,text:'Он не станет договариваться.'};
 if(action==='dismiss'&&e.followerOf===c.account.id){e.followerOf=null;e.disposition='neutral';e.state='idle';e.target=null;e.path=[];return{ok:true,text:'Почитатель остаётся здесь.'};}
 if(action==='dismiss')return{ok:false,text:'Это не ваш почитатель.'};
 if(!['peace','follow'].includes(action))return{ok:false,text:'Выберите перемирие или предложите идти следом.'};
 const p=profile(e),charisma=Number(c.character.stats?.persuasion??c.character.stats?.charisma)||0,power=(c.character.level||1)/(e.level||1),weak=e.hp/e.maxHp;
 const chance=Math.max(.05,Math.min(.95,.2+charisma*.025+Math.max(0,power-1)*.12+(1-weak)*.35+(1-p.courage)*.2-(action==='follow'?.15:0)));
 if(rnd()>chance)return{ok:false,text:'Он отверг предложение. Будьте осторожны.'};
 e.disposition=action==='follow'?'follower':'neutral';e.followerOf=action==='follow'?c.account.id:null;e.state=action==='follow'?'follower':'idle';e.target=null;e.path=[];
 return{ok:true,text:action==='follow'?'Он признаёт вашу силу и идёт следом. Это почитатель: он не занимает место спутника и не подчиняется его приказам.':'Он согласился на перемирие. Новый удар отменит его.'};
}
module.exports={profile,steadfast,social,hostile,morale,negotiate};
