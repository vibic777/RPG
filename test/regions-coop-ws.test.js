'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {startServer,api,newPlayer,joinWorld}=require('./helpers');
const G=require('../shared/worldgen'),R=require('../shared/regions');require('../shared/settlements');
test('eight co-op players can occupy eight regions, move independently and share the campaign',async t=>{
 const s=await startServer(['--set','game.depotsPer256=0','--set','game.survivalFoodPerMin=0','--set','game.survivalWaterPerMin=0']);t.after(()=>s.stop());
 const owner=await newPlayer(s.base,'admin','Первый');
 const created=await api(s.base,'POST','/api/worlds',{name:'Восемь регионов',seed:'coop-regions',size:'small',enemyDensity:'none',hordeFrequency:'never',dragons:0,scaleToLevel:false},owner.token);assert.equal(created.status,200,JSON.stringify(created.data));const w=created.data.world;
 const shared=await api(s.base,'POST','/api/worlds/'+w.id+'/share',{open:true,invite:'new'},owner.token);assert.equal(shared.status,200);
 const clients=[await joinWorld(s.base,owner,w.id)];t.after(()=>Promise.all(clients.map(c=>c.close())));
 for(let i=1;i<8;i++){
  const p=await newPlayer(s.base,'guest'+i,'Путник '+i),joined=await api(s.base,'POST','/api/worlds/join',{code:shared.data.world.inviteCode},p.token);assert.equal(joined.status,200,JSON.stringify(joined.data));
  const c=await joinWorld(s.base,p,w.id);assert.ok(c.welcome);clients.push(c);
  const moved=await api(s.base,'POST','/api/admin/teleport',{username:p.username,level:R.keyOf(i,0)},owner.token);assert.equal(moved.status,200,JSON.stringify(moved.data));
  const welcome=await c.next(m=>m.t==='welcome'&&m.level?.key===R.keyOf(i,0),12000);assert.equal(welcome.players.length,1,'players in other regions are isolated');
 }
 for(const c of clients){c.drain();const state=await c.next('state');assert.equal(state.players.length,1);assert.equal(state.players[0].id,c.welcome.you);}
 G.configure({depotsPer256:0});const root=G.generate(w),region=R.map(root,'region_1_0'),gate=R.portals(region).find(p=>p.direction==='E');
 const c=clients[1];await api(s.base,'POST','/api/admin/teleport',{username:'guest1',x:gate.x+.5,y:gate.y+.5},owner.token);await c.next('teleported');c.send({t:'lvl-go'});
 const merged=await c.next(m=>m.t==='welcome'&&m.level?.key==='region_2_0',12000);assert.equal(merged.players.length,2,'only players in destination region meet');
 await clients[2].next(m=>m.t==='join'&&m.player.id===c.welcome.you);
 const grant=await api(s.base,'POST','/api/admin/quests/act',{worldId:w.id,act:'grant',id:'m2_baron'},owner.token);assert.equal(grant.status,200,JSON.stringify(grant.data));
 for(const client of clients){const log=await client.next(m=>m.t==='quests'&&m.active.some(q=>q.id==='m2_baron'));assert.equal(log.active.find(q=>q.id==='m2_baron').regionKey,'region_1_1');}
 for(const i of [0,3,4,5,6,7]){clients[i].drain();const state=await clients[i].next('state');assert.equal(state.players.length,1,'another player crossing did not move this player');}
 // A driver, another player's passenger and a companion transfer together;
 // everyone else continues playing in their own regions.
 const nextRegion=R.map(root,'region_2_0'),road=R.portals(nextRegion).find(g=>g.direction==='E');
 for(const username of ['guest1','guest2']){const moved=await api(s.base,'POST','/api/admin/teleport',{username,x:road.x+.5,y:road.y+.5},owner.token);assert.equal(moved.status,200,JSON.stringify(moved.data));}
 const spawned=await api(s.base,'POST','/api/admin/vehicles/spawn',{username:'guest1',def:'car',own:true,x:road.x+.5,y:road.y+.5},owner.token);assert.equal(spawned.status,200,JSON.stringify(spawned.data));const car=spawned.data.vehicle;
 clients[1].send({t:'veh-enter',id:car.id});await clients[1].next(m=>m.t==='veh-seat'&&m.id===car.id&&m.seat===0);
 clients[2].send({t:'veh-enter',id:car.id});await clients[2].next(m=>m.t==='veh-seat'&&m.id===car.id&&m.seat===1);
 const summoned=await api(s.base,'POST','/api/admin/companions/spawn',{username:'guest1',def:'wolf',level:1},owner.token);assert.equal(summoned.status,200,JSON.stringify(summoned.data));const companion=summoned.data.companion.id;
 clients[1].send({t:'comp',a:'order',id:'all',order:'board'});
 await clients[1].next(m=>m.t==='veh-upd'&&m.v.id===car.id&&m.v.companions.includes(companion),8000);
 clients[1].send({t:'lvl-go'});
 for(const i of [1,2]){const arrival=await clients[i].next(m=>m.t==='welcome'&&m.level?.key==='region_3_0',12000);assert.ok(arrival.vehicles.some(v=>v.id===car.id&&v.companions.includes(companion)));await clients[i].next(m=>m.t==='veh-seat'&&m.id===car.id&&m.seat===i-1);}
 clients[3].drain();assert.equal((await clients[3].next('state')).players.length,3);
 clients[7].drain();assert.equal((await clients[7].next('state')).players.length,1);
});
