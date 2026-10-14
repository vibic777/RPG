'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Recovery=require('../shared/recovery'),B=require('../server/enemy-behaviour'),AI=require('../server/ai'),E=require('../shared/enemies'),V=require('../shared/vehicles');
const enemy=(id='raider_thug')=>({id:'actor',def:E.get(id),level:2,x:20,y:20,home:{x:20,y:20},hp:10,maxHp:100,path:[],state:'idle',target:null});
test('occupied wreck recovers from zero without parts, empty wreck does not, damage delays repair',()=>{
 const v={hp:0,wreck:true},def=V.get('car');
 assert.equal(Recovery.vehicle(v,def,10,false,10000,{}),false);assert.equal(v.hp,0);
 assert.equal(Recovery.vehicle(v,def,10,true,10000,{}),true);assert.ok(v.hp>0&&v.hp<def.hp*.1);assert.equal(v.wreck,true);
 assert.equal(V.speedMul(def,v,4),0,'broken vehicle cannot move on the client either');
 Recovery.vehicle(v,def,110,true,10000,{});assert.equal(v.wreck,false);assert.equal(V.drivable(def,v),true);
 v.hurtAt=10000;const hp=v.hp;Recovery.vehicle(v,def,5,true,12000,{});assert.equal(v.hp,hp);
 Recovery.vehicle(v,def,10000,true,20000,{});assert.equal(v.hp,def.hp);
});
test('slow healing never revives dead actors and escaped enemies heal gradually without a home reset',()=>{
 assert.equal(Recovery.heal(0,100,.5,1000),0);assert.equal(Recovery.heal(99,100,.5,10),100);
 const e=enemy(),ctx={now:10000,game:{},players:[]};
 AI.recover(ctx,e,4);assert.equal(e.hp,11);
 e.hurtAt=10000;AI.recover(ctx,e,4);assert.equal(e.hp,11);
 e.hurtAt=0;e.target='hero';ctx.players=[{id:'hero',x:21,y:20}];AI.recover(ctx,e,4);assert.equal(e.hp,11);
});
test('bosses, their guards and wolves are steadfast while fearful humans can surrender',()=>{
 for(const id of ['boss_raider','wolf','wolf_mutant']){const e=enemy(id);if(!e.def)continue;assert.equal(B.steadfast(e),true);assert.equal(B.morale(e,{enemies:[]},{level:99}),false);}
 const guard=enemy();guard.guardOf='boss';assert.equal(B.steadfast(guard),true);assert.equal(B.social(guard),false);
 const e=enemy();e.personality={courage:.2,role:'left'};assert.equal(B.morale(e,{enemies:[e]},{level:2}),true);
});
test('negotiation can produce neutrality or a follower, refusal is possible and betrayal cancels peace',()=>{
 const e=enemy(),c={account:{id:'owner'},character:{level:8,stats:{charisma:8}}};
 assert.equal(B.negotiate(e,c,'peace',()=>0).ok,true);assert.equal(B.hostile(e),false);
 assert.equal(B.negotiate(e,c,'follow',()=>0).ok,true);assert.equal(e.followerOf,'owner');assert.equal(e.state,'follower');assert.equal(c.character.companions,undefined);
 assert.equal(B.negotiate(e,c,'dismiss',()=>0).ok,true);assert.equal(e.disposition,'neutral');
 assert.equal(B.negotiate(e,c,'follow',()=>1).ok,false);
 AI.onDamaged({now:10000,enemies:[e],game:{}},e,{id:'owner',x:21,y:20});assert.equal(B.hostile(e),true);assert.equal(e.followerOf,null);
 assert.equal(B.negotiate(enemy('wolf'),c,'follow',()=>0).ok,false);
});
test('spatial AI index selects local enemies and refreshes after they move on the next tick',()=>{
 const near=require('../server/enemy-neighbours').near;
 const enemies=Array.from({length:2000},(_,i)=>({id:i,x:i*10,y:0})),ctx={enemies,now:1};
 assert.deepEqual(near(ctx,enemies[0],8).map(e=>e.id),[0]);
 const index=ctx.enemyBuckets;near(ctx,enemies[10],8);assert.equal(ctx.enemyBuckets,index,'one index per tick');
 enemies[1].x=1;ctx.now=2;assert.deepEqual(near(ctx,enemies[0],8).map(e=>e.id),[0,1]);
});
function context(enemies,target){const G=require('../shared/worldgen'),M=require('../shared/movement');const map={width:80,height:80,tiles:new Uint8Array(6400).fill(G.B.WASTE)};return{map,grid:M.gridFromWorld(map),enemies,players:[target],now:8000,rnd:()=>.5,isSafe:()=>false,attack:()=>{},game:{aiPathMaxNodes:6000,aiRepathSec:1,aiFleeStep:5,fleeRecoverSec:4,enemySpeedFactor:1,packAggroRadius:8}};}
test('frightened human flees and surrenders, while a boss guard continues fighting',()=>{
 const e=enemy(),target={id:'hero',x:22,y:20,level:2};e.target=target.id;e.state='chase';e.personality={courage:.2,role:'rush'};const ctx=context([e],target);
 AI.think(ctx,e,.1);assert.equal(e.state,'flee');ctx.now+=5000;AI.think(ctx,e,.1);assert.equal(e.state,'surrender');assert.equal(B.hostile(e),false);
 const guard=enemy();guard.guardOf='boss';guard.target=target.id;guard.state='chase';AI.think(context([guard],target),guard,.1);assert.notEqual(guard.state,'flee');assert.notEqual(guard.state,'surrender');
});
test('coordinated group flankers approach from a side and a lure draws attention away',()=>{
 const target={id:'hero',x:32,y:20,level:2},e=enemy();e.hp=100;e.target=target.id;e.state='chase';e.personality={courage:1,role:'left'};
 const team=[e,{...enemy(),id:'second',x:20,y:21,target:target.id,hp:100},{...enemy(),id:'third',x:20,y:19,target:target.id,hp:100}];
 AI.think(context(team,target),e,.1);assert.deepEqual(e.path.at(-1),[32,22],'flank instead of a straight rush');
 e.x=20;e.y=20;e.path=[];e.repathAt=0;e.personality.role='lure';target.x=25;
 AI.think(context(team,target),e,.1);assert.ok(e.path.at(-1)[0]<20,'lure steps away while group can close in');
});
test('civilian starts neutral and flees an assault without turning into an attacker',()=>{
 const e=enemy('house_resident'),target={id:'hero',x:22,y:20,level:2},ctx=context([e],target);
 assert.equal(B.profile(e).neutral,true);let attacks=0;ctx.attack=()=>attacks++;
 AI.onDamaged(ctx,e,target);assert.equal(e.state,'flee');assert.equal(B.hostile(e),false);
 ctx.now+=5000;AI.think(ctx,e,.1);assert.equal(e.state,'return');assert.equal(attacks,0);
});
