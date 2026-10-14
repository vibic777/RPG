'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const V=require('../shared/vehicles');
globalThis.window=globalThis.window||{};window.Vehicles=V;
const load=f=>import(pathToFileURL(path.join(__dirname,'../client/js/game',f)).href);
const ctx=()=>new Proxy({},{get(o,k){if(k in o)return o[k];if(k==='createLinearGradient'||k==='createRadialGradient')return()=>({addColorStop(){}});return()=>{};},set(o,k,v){o[k]=v;return true;}});

test('surface attachment uses the nearest point inside a face, including edges and thin panels',async()=>{
 const {attachmentSurface}=await load('mesh-attachments.js');
 const skin=attachmentSurface([{pts:[[0,0,0],[2,0,0],[2,2,0],[0,2,0]]}]);
 assert.deepEqual(skin.nearest([1,1,3]),{point:[1,1,0],distance:3});
 assert.deepEqual(skin.nearest([3,1,0]),{point:[2,1,0],distance:1});
});

test('every external weapon fitting is connected to actual model geometry at all quality levels and turret headings',async()=>{
 const {drawMesh,MESH}=await load('vehicle-mesh.js'),{meshRig}=await load('mesh-art.js');
 let checked=0;
 for(const def of V.LIST)for(const quality of ['low','medium','high'])for(let dir=0;dir<8;dir++){
  const q=quality==='low'?0:quality==='high'?2:1,heading=dir*Math.PI/4+.17;
  const v={facingAngle:heading,turretDir:dir,rearTurretDir:(dir+3)%8,moving:true};
  const g=meshRig(ctx(),0,0,10,heading,q);
  MESH[def.id](g,def,v,{color:'#607060',trackCol:'#25292a',phase:1400*.0032,dist:1400*.0032,time:1400,moving:true,wreck:false,turretAngle:dir*Math.PI/4-heading,rearAngle:((dir+3)%8)*Math.PI/4-heading,alt:0});
  const skin=g.attachmentSurface(),result=drawMesh(ctx(),def,v,0,0,10,heading,1400,0,quality);
  for(const group of V.armsOf(def))for(const mount of group.mounts){
   if(!['pod','rail','torpedo','barrel'].includes(mount.draw))continue;
   const supports=result.attachments.filter(a=>a.id===mount.id);
   assert.ok(supports.length>=1,`${def.id} ${mount.id} ${quality} ${dir}: missing attachment`);
   for(const support of supports){
    assert.ok(support.grip.concat(support.anchor,support.foot).every(Number.isFinite));
    assert.ok(skin.nearest(support.anchor).distance<1e-6,`${def.id} ${mount.id}: foot floats above the model`);
   }
   checked++;
  }
 }
 assert.ok(checked>1000);
});

test('jetski stern launcher has two brackets and its main gun has a pedestal touching the hull',async()=>{
 const {drawMesh}=await load('vehicle-mesh.js');
 const result=drawMesh(ctx(),V.get('jetski'),{moving:true},0,0,25,.37,1400,0,'high');
 assert.equal(result.attachments.filter(a=>a.id==='missile0').length,2);
 assert.ok(result.attachments.some(a=>a.id==='primary:front'));
});

test('hull brackets stay fixed while the turret turns; turret brackets rotate around its pivot',async()=>{
 const {drawMesh}=await load('vehicle-mesh.js');
 for(const def of V.LIST){
  const first=drawMesh(ctx(),def,{moving:true,turretDir:0,rearTurretDir:4},0,0,10,0,1400,0,'medium');
  const turned=drawMesh(ctx(),def,{moving:true,turretDir:2,rearTurretDir:6},0,0,10,0,1400,0,'medium');
  for(const group of V.armsOf(def))for(const m of group.mounts){
   const a=first.attachments.filter(p=>p.id===m.id),b=turned.attachments.filter(p=>p.id===m.id);
   if(!a.length)continue;
   if(m.frame==='hull')assert.deepEqual(a,b,def.id+' '+m.id+': hull bracket follows the turret');
  }
 }
 const def=V.get('apc'),mount=V.armsOf(def).find(g=>g.type==='missile').mounts[0];
 const zero=drawMesh(ctx(),def,{moving:true,turretDir:0},0,0,10,0,1400,0,'high').attachments.find(a=>a.id===mount.id);
 const turned=drawMesh(ctx(),def,{moving:true,turretDir:2},0,0,10,0,1400,0,'high').attachments.find(a=>a.id===mount.id);
 const pivot=V.turretsOf(def).front.pivot;
 const expected=[pivot[0]+zero.anchor[1]-pivot[1],pivot[1]-(zero.anchor[0]-pivot[0]),zero.anchor[2]];
 assert.ok(Math.hypot(...expected.map((v,i)=>v-turned.anchor[i]))<1e-6,'turret support must turn together with the rail');
});
