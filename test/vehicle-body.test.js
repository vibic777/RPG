'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const V=require('../shared/vehicles'),M=require('../shared/movement'),G=require('../shared/worldgen');
const {updateGate}=require('../server/settlement-gates');
const mapOf=()=>({width:60,height:60,tiles:new Uint8Array(3600).fill(G.B.CITY)});

test('a vehicle stopped at a shoreline can reverse without rotating through the water',()=>{
 for(const id of ['car','truck','bus','semi_truck','tank']){
  const map=mapOf(),heading=Math.PI/4,def=V.get(id);
  for(let y=0;y<60;y++)for(let x=30;x<60;x++)map.tiles[y*60+x]=G.B.WATER;
  map.drive=V.drive(def,0,heading);
  const body=V.bodyAt(def,{x:0,y:0},heading),from={x:30-body.x-body.extentX-.03,y:30.5};
  assert.equal(M.posWalkable(map,from.x,from.y),true,id+' initially clear');
  const to=M.moveWithCollision(map,from,-.04,-.04);
  assert.ok(to.x<from.x&&to.y<from.y,id+' must back away from the bank');
  assert.ok(Math.abs(map.drive.heading-heading)<1e-9,id+' must retain its facing while reversing');
 }
});

test('slightly embedded vehicles can retreat in small valid steps without driving farther into water',()=>{
 const map=mapOf();for(let y=0;y<60;y++)for(let x=30;x<60;x++)map.tiles[y*60+x]=G.B.WATER;
 map.drive=V.drive(V.get('car'),0,0);
 let p={x:30-map.drive.bodyAt(0,0,0).extentX+.08,y:30.5};
 assert.equal(M.posWalkable(map,p.x,p.y),false);
 const deeper=M.moveWithCollision(map,p,.02,0);assert.deepEqual(deeper,p);
 for(let i=0;i<10;i++){
  const next=M.moveWithCollision(map,p,-.02,0);
  assert.ok(next.x<p.x,'each retreat step must be possible');
  assert.equal(M.validateStep(map,p,next,.1,V.speedMul(V.get('car'),{hp:100},M.settings.heroSpeed)),null,'server accepts a safe retreat');
  p=next;
 }
 assert.equal(M.posWalkable(map,p.x,p.y),true);
});

test('after backing away from a bank the vehicle can steer and continue driving',()=>{
 const map=mapOf(),def=V.get('car');for(let y=0;y<60;y++)for(let x=30;x<60;x++)map.tiles[y*60+x]=G.B.WATER;
 map.drive=V.drive(def,0,0);
 let p={x:30-map.drive.bodyAt(0,0,0).extentX-.01,y:30.5};
 assert.deepEqual(M.moveWithCollision(map,p,.1,0),p,'water still blocks forward motion');
 for(let i=0;i<30;i++)p=M.moveWithCollision(map,p,-.05,0);
 const steered=M.moveWithCollision(map,p,.035,.035);
 assert.ok(steered.x>p.x&&steered.y>p.y,'turning becomes possible after retreat');
 assert.ok(Math.abs(map.drive.heading-Math.PI/4)<1e-8);
});

test('reverse from a wall works and embedded recovery cannot cross a second obstacle',()=>{
 const map=mapOf();for(let y=0;y<60;y++){map.tiles[y*60+30]=G.B.MOUNTAIN;map.tiles[y*60+24]=G.B.MOUNTAIN;}
 map.drive=V.drive(V.get('car'),0,Math.PI/4);
 const b=map.drive.bodyAt(0,0,Math.PI/4),p={x:30-b.extentX-.03,y:30.5};
 assert.ok(M.moveWithCollision(map,p,-.04,-.04).x<p.x);
 map.drive.heading=0;
 const embedded={x:30-map.drive.bodyAt(0,0,0).extentX+.08,y:30.5};
 assert.equal(M.segmentWalkable(map,embedded,-7,0),false,'escape cannot tunnel through a new wall');
});

test('click-to-move can also back out of a shoreline overlap',()=>{
 const map=mapOf(),def=V.get('car');for(let y=0;y<60;y++)for(let x=30;x<60;x++)map.tiles[y*60+x]=G.B.WATER;
 map.drive=V.drive(def,0,0);
 const from={x:30-map.drive.bodyAt(0,0,0).extentX+.08,y:30.5};
 const result=M.followPath(map,from,[[27,30],[26,30]],.01,V.speedMul(def,{hp:def.hp},M.settings.heroSpeed));
 assert.ok(result.pos.x<from.x);
 assert.equal(map.drive.heading,0);
 assert.equal(M.validateStep(map,from,result.pos,.01,V.speedMul(def,{hp:def.hp},M.settings.heroSpeed)),null);
});

test('clipped overlap areas preserve the physical area of rotated hulls',()=>{
 for(const heading of [0,.17,Math.PI/4,1.9]){
  const body=V.bodyAt('semi_truck',{x:30.4,y:30.6},heading);let area=0;
  for(let y=24;y<38;y++)for(let x=24;x<38;x++)area+=V.bodyCellOverlapArea(body,x,y);
  assert.ok(Math.abs(area-4*body.halfWidth*body.halfLength)<1e-8);
 }
});

test('every vehicle class has finite physical dimensions and a rotated footprint',()=>{
  for(const def of V.LIST){
    assert.ok(Object.hasOwn(V.HULL_METERS,def.id),def.id);
    const a=V.bodyAt(def,{x:30,y:30}),b=V.bodyAt(def,{x:30,y:30},Math.PI/2);
    assert.ok(a.halfWidth>0&&a.halfLength>0&&a.maxZ>a.minZ,def.id);
    assert.ok(Math.abs(a.extentX-b.extentY)<1e-9,def.id);
    assert.equal(V.pointBodyDistance({x:30,y:30},a),0);
  }
});

test('truck nose and trailer collide even while their center cell is clear',()=>{
  const map=mapOf();map.drive=V.drive(V.get('semi_truck'));
  map.tiles[30*60+34]=G.B.MOUNTAIN;
  assert.equal(G.tileAt(map,30,30),G.B.CITY);
  assert.equal(M.posWalkable(map,30.5,30.5),false);
  map.drive=V.drive(V.get('car'));
  assert.equal(M.posWalkable(map,30.5,30.5),true);
});

test('vehicle fit depends on orientation in a narrow passage',()=>{
  const map=mapOf();
  for(let x=0;x<60;x++)for(const y of [28,32])map.tiles[y*60+x]=G.B.MOUNTAIN;
  map.drive=V.drive(V.get('semi_truck'),0,0);
  assert.equal(M.posWalkable(map,30.5,30.5),true);
  map.drive.heading=Math.PI/2;
  assert.equal(M.posWalkable(map,30.5,30.5),false);
});

test('whole movement segment prevents walking and driving through a wall',()=>{
  const map=mapOf();for(let y=0;y<60;y++)map.tiles[y*60+30]=G.B.MOUNTAIN;
  for(const drive of [null,V.drive(V.get('car'))]){
    map.drive=drive;
    assert.equal(M.posWalkable(map,36.5,30.5),true);
    assert.equal(M.segmentWalkable(map,{x:24.5,y:30.5},12,0),false);
  }
});

test('a stale path stops at a newly closed doorway',()=>{
  const map=mapOf();map.tiles[30*60+30]=G.B.MOUNTAIN;
  const result=M.followPath(map,{x:29.5,y:30.5},[[30,30],[31,30]],1);
  assert.ok(result.pos.x<30);
  assert.equal(result.path.length,2);
});

test('a large creature cannot squeeze through a passage narrower than its body',()=>{
 const map=mapOf();for(let x=0;x<60;x++)for(const y of [29,31])map.tiles[y*60+x]=G.B.MOUNTAIN;
 map.actorRadius=.22;assert.equal(M.posWalkable(map,30.5,30.5),true);
 map.actorRadius=.85;assert.equal(M.posWalkable(map,30.5,30.5),false);
});

test('body contacts respect altitude and ram sweep catches a crossed target',()=>{
  const ground=V.bodyAt('car',{x:20,y:20}),high=V.bodyAt('plane',{x:20,y:20,alt:8});
  assert.equal(V.bodiesOverlap(ground,high),false);
  assert.equal(V.bodiesOverlap(ground,V.bodyAt('car',{x:21,y:20})),true);
  assert.equal(V.sweptBodyHit('car',{x:10,y:20},{x:30,y:20},{x:20,y:20},.25),true);
  assert.equal(V.sweptBodyHit('car',{x:10,y:20},{x:30,y:20},{x:20,y:24},.25),false);
});

test('gate stays open until the complete trailer clears its doorway',()=>{
  const width=60,base={gate:{cells:[20*width+30]},town:{x:30,y:10,r:15},width,enemies:[]};
  const truck=y=>({id:'truck',x:30.5,y,body:V.bodyAt('semi_truck',{x:30.5,y},-Math.PI/2)});
  let state=updateGate({...base,open:false,actors:[truck(23)]});
  assert.equal(state.open,true);
  state=updateGate({...base,...state,actors:[truck(17)]});
  assert.equal(state.open,true,'center is inside, trailer is still in the opening');
  state=updateGate({...base,...state,actors:[truck(10)]});
  assert.equal(state.open,false);
});
