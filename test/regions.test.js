'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/worldgen'),R=require('../shared/regions'),L=require('../shared/levels'),V=require('../shared/vehicles');
require('../shared/settlements');
const root=()=>G.generate({seed:'region-network',size:'small',waterMode:'lakes',genVersion:4,dragons:0});
test('regions are lazy, deterministic, distinct and do not change the original world',()=>{
 const a=root(),hash=G.mapHash(a),m=R.map(a,'region_1_0'),b=R.map(root(),'region_1_0');
 assert.equal(m.width,256);assert.equal(m.height,256);assert.equal(m.surfaceRegion,true);
 assert.equal(G.mapHash(m),G.mapHash(b));assert.equal(G.mapHash(a),hash);
 assert.notEqual(G.mapHash(R.map(a,'region_1_1')),G.mapHash(m));
 assert.ok(m.towns.length>0);assert.equal(R.map(a,'region_1_0'),m);
});
test('land and sea gateways connect to matching safe berths in the opposite region',()=>{
 const a=root(),m=R.map(a,'region_1_0'),portals=R.portals(m);
 assert.equal(portals.length,8);
 for(const p of portals){
  const target=L.portalTarget(a,{...p,regionKey:m.key}),next=target.key==='ground'?a:L.level(a,target.key);
  const back=R.portals(next).find(g=>g.direction===({N:'S',S:'N',E:'W',W:'E'}[p.direction])&&g.travelMode===p.travelMode);
  assert.ok(back);const returned=R.target(a,next.key,back);assert.equal(returned.key,m.key);
  assert.deepEqual([returned.x,returned.y],[p.x,p.y]);
  if(p.travelMode==='land'){
   assert.equal(G.isWalkable(m,p.x,p.y),true);
   assert.ok(V.canPlaceBody(m,V.get('car'),{x:p.x+.5,y:p.y+.5,facingAngle:0}));
  }else{
   assert.equal(G.tileAt(m,p.x,p.y),G.B.WATER);
   assert.ok(V.canPlaceBody(m,V.get('boat'),{x:p.x+.5,y:p.y+.5,facingAngle:0}));
   assert.ok(V.canPlaceBody(next,V.get('boat'),{x:target.x+.5,y:target.y+.5,facingAngle:0}));
  }
 }
});
test('each region has independent dungeons whose exits return to that same region',()=>{
 const a=root(),m=L.level(a,'region_2_1'),entry=L.entrances(m).find(e=>!e.disabled&&e.kind!=='elevator');
 assert.ok(entry);
 const target=L.portalTarget(a,{...entry,from:'ground',regionKey:m.key});
 assert.ok(target.key.startsWith(m.key+'!'));
 const dungeon=L.level(a,target.key);assert.equal(dungeon.regionKey,m.key);
 const back=L.nearbyPortal(a,dungeon,target.x+.5,target.y+.5);
 const destination=L.portalTarget(a,back);
 assert.equal(destination.key,m.key);assert.deepEqual([destination.x,destination.y],[entry.x,entry.y]);
 assert.ok(L.parseKey(a,target.key));
});
test('story chapters span multiple regions and the 8×8 region grid wraps in both axes',()=>{
 const a=root();assert.equal(R.route(0).key,'ground');assert.notEqual(R.route(10).key,'ground');
 assert.equal(R.nextPortal(a,R.route(2).key).direction,'E');
 const m=R.map(a,'region_1_0');assert.equal(R.nextPortal(m,'region_1_1').direction,'S');
 assert.equal(R.nextPortal(m,m.key),null);
 assert.equal(R.keyOf(-1,0),'region_7_0');assert.equal(R.keyOf(8,0),'ground');
 assert.equal(R.keyOf(0,-1),'region_0_7');assert.equal(R.keyOf(0,8),'ground');
 assert.equal(R.parse('region_33_0'),null);assert.equal(L.level(a,'region_33_0'),null);
 assert.equal(R.parse('region_-1_0').key,'region_7_0','legacy negative coordinates normalize into the torus');
 for(const key of ['region_01_0','region_-0_1'])assert.equal(R.parse(key),null,'malformed numeric aliases are rejected');
 assert.equal(R.parse('region_0_0').key,'ground','the root sector has one canonical key');
 const keys=new Set();for(let y=0;y<8;y++)for(let x=0;x<8;x++)keys.add(R.keyOf(x,y));assert.equal(keys.size,64);
});
test('gateways ignore per-player swimming, flight and vehicle state; released maps regenerate identically',()=>{
 const a=root(),b=root();b.swimmer=true;b.flyer=true;b.drive={walk:()=>true};b.blocks=new Map([[0,{block:'wall'}]]);
 assert.deepEqual(R.portals(a),R.portals(b),'same markers for all eight players and server');
 const first=L.level(a,'region_4_0'),hash=G.mapHash(first);
 L.releaseRegion(a,'region_4_0');const second=L.level(a,'region_4_0');
 assert.notEqual(first,second);assert.equal(G.mapHash(second),hash);
});
