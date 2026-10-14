'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const V=require('../shared/vehicles');
test('mass determines impact damage, with separate knockdown and crushing behavior',()=>{
 for(const d of V.LIST)assert.ok(d.mass>0,d.id);
 const car=V.get('car'),hit=V.contactImpact(car,6),heavy=V.contactImpact({...car,mass:car.mass*4},6);
 assert.equal(hit.kind,'knockdown');assert.ok(hit.knockback>0&&hit.stunSec>0);
 assert.ok(heavy.damage>hit.damage&&heavy.knockback>hit.knockback);
 const tank=V.contactImpact(V.get('tank'),.2);
 assert.equal(tank.kind,'crush');assert.ok(tank.damage>hit.damage);
 assert.equal(V.contactImpact(car,0),null);assert.equal(V.contactImpact(car,.1),null);
});
test('fast impact samples the path and airborne targets are out of reach',()=>{
 const def=V.get('car'),a={x:10,y:10},b={x:20,y:10};
 assert.equal(V.vehicleContact(def,a,b,{x:15,y:10},.2,10).kind,'knockdown');
 assert.equal(V.vehicleContact(def,a,b,{x:15,y:10,alt:2},.2,10),null);
 assert.equal(V.vehicleContact(def,a,b,{x:15,y:13},.2,10),null);
});
test('walkers crush at an actual planted foot and leave the gap between their legs clear',()=>{
 for(const id of ['mech_sentinel','chicken_walker','elephant_walker']){
  const def=V.get(id),p={x:20,y:20,odometer:0,facingAngle:0},feet=V.walkerFeet(def,0,false),foot=feet[0];
  const target={x:p.x+foot.y/V.M_PER_TILE,y:p.y+foot.x/V.M_PER_TILE};
  const contact=V.vehicleContact(def,p,p,target,.08,0);
  assert.equal(contact.kind,'stomp',id);assert.equal(contact.foot,0,id);
  assert.ok(contact.damage>0&&contact.knockback===0);
  assert.equal(V.vehicleContact(def,p,p,p,.15,0),null,id+': empty space under body is safe');
 }
});
test('a raised foot does not crush until it reaches the ground',()=>{
 const def=V.get('mech_sentinel'),distance=.6,p={x:20,y:20,odometer:distance,facingAngle:0};
 const raised=V.walkerFeet(def,distance,true).find(f=>!f.stance&&f.z>.1);
 assert.ok(raised);
 const target={x:p.x+raised.y/V.M_PER_TILE,y:p.y+raised.x/V.M_PER_TILE};
 assert.equal(V.vehicleContact(def,p,{...p,x:p.x+.0002,odometer:distance+.0003},target,.04,1),null);
});
test('stomp pressure grows with mass and distributes across planted feet',()=>{
 const def=V.get('elephant_walker');
 assert.ok(V.contactImpact(def,2,2).damage>V.contactImpact(def,2,4).damage);
 assert.ok(V.contactImpact(def,2,2).damage>V.contactImpact({...def,mass:5},2,2).damage);
});
test('Project 941 is a full-sized submarine with twenty missile silos ahead of the sail',()=>{
 assert.deepEqual(V.dimensionsOf('submarine').slice(0,2),[23.3,172.8]);
 const def=V.get('submarine');assert.equal(def.mass,23200);assert.equal(def.submergedMass,48000);
 const silos=V.armsOf(def).find(g=>g.type==='missile').mounts;
 assert.equal(silos.length,20);assert.ok(silos.every(s=>s.at[1]>0&&s.up));
});

test('the full hull finds a berth in open sea and refuses a waterway narrower than its beam',()=>{
 const G=require('../shared/worldgen'),def=V.get('submarine'),map={width:200,height:200,tiles:new Uint8Array(40000).fill(G.B.WATER)};
 for(let y=0;y<200;y++)for(let x=0;x<30;x++)map.tiles[y*200+x]=G.B.CITY;
 const spot=V.findBerth(map,def,{x:30,y:80});
 assert.ok(spot&&V.canPlaceBody(map,def,spot));
 const narrow={width:12,height:200,tiles:new Uint8Array(2400).fill(G.B.WATER)};
 assert.equal(V.findBerth(narrow,def,{x:6,y:100}),null);
});

test('server applies knockdown to NPCs, leaves parked cars harmless, and checks the actual walker foot',()=>{
 const vehicles=require('../server/vehicles'),combat=require('../server/combat'),companions=require('../server/companions'),towns=require('../server/settlements'),G=require('../shared/worldgen');
 const saved=[combat.stateOf,companions.stateOf,towns.hurt];
 combat.stateOf=()=>({enemies:new Map()});companions.stateOf=()=>({ents:new Map()});
 towns.hurt=(room,n,amount)=>{n.hp-=amount;return amount;};
 const n={id:'npc',x:20,y:20,hp:1000,radius:.1,path:[]},room={players:new Map(),stl:{ents:new Map([['npc',n]])},map:{width:60,height:60,tiles:new Uint8Array(3600).fill(G.B.CITY)}};
 const driver={account:{id:'driver'}},now=10000;
 try{
  vehicles.hitRammedActors(room,{id:'car',facingAngle:0},V.get('car'),driver,{x:20,y:20},{x:20,y:20},0,now);
  assert.equal(n.hp,1000);
  vehicles.hitRammedActors(room,{id:'car',facingAngle:0},V.get('car'),driver,{x:19,y:20},{x:21,y:20},6,now+1000);
  assert.ok(n.hp<1000&&n.stunUntil>now+1000&&n.x>20);
  n.x=20;n.y=20;n.hp=1000;n.vehicleRamAt=0;
  const def=V.get('mech_sentinel'),p={x:20,y:20,odometer:0},foot=V.walkerFeet(def,0,false)[0];
  vehicles.hitRammedActors(room,{id:'walker',facingAngle:0},def,driver,p,p,0,now+2000);
  assert.equal(n.hp,1000,'between feet is safe');
  n.x=p.x+foot.y/V.M_PER_TILE;n.y=p.y+foot.x/V.M_PER_TILE;
  vehicles.hitRammedActors(room,{id:'walker',facingAngle:0},def,driver,p,p,0,now+3000);
  assert.ok(n.hp<1000,'planted foot crushes the NPC');
 }finally{[combat.stateOf,companions.stateOf,towns.hurt]=saved;}
});
