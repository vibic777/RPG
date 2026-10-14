'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {updateGate}=require('../server/settlement-gates');
const base={gate:{cells:[105]},town:{x:5,y:5,r:5},width:10,open:false};
const hero={id:'hero',x:5.5,y:12,radius:0.35};
test('nearby enemy blocks opening; clearing the approach opens it',()=>{
 assert.equal(updateGate({...base,actors:[hero],enemies:[{x:6,y:13}]}).open,false);
 assert.equal(updateGate({...base,actors:[hero],enemies:[{x:6,y:19}]}).open,true);
 assert.equal(updateGate({...base,actors:[],enemies:[{x:5,y:11}]}).open,false);
});
test('open gate waits for hero, companion and vehicle despite arriving enemies',()=>{
 const companion={id:'ally',x:6,y:13},vehicle={id:'truck',x:5,y:14,radius:2};
 let state=updateGate({...base,actors:[hero,companion,vehicle],enemies:[]});
 assert.equal(state.pending.size,3);
 state=updateGate({...base,...state,actors:[{...hero,y:7},companion,vehicle],enemies:[{x:6,y:12}]});
 assert.equal(state.open,true);assert.equal(state.pending.size,2);
 state=updateGate({...base,...state,actors:[{...hero,y:7},{...companion,y:7},{...vehicle,y:7}],enemies:[]});
 assert.equal(state.open,true,'nearby friendlies keep the gate open from inside too');
 state=updateGate({...base,...state,actors:[],enemies:[]});
 assert.equal(state.open,false);
});
test('vehicle footprint and enemy in the doorway prevent closure',()=>{
 assert.equal(updateGate({...base,open:true,actors:[{id:'truck',x:5.5,y:13,radius:2}],enemies:[]}).open,true);
 assert.equal(updateGate({...base,open:true,actors:[],enemies:[{x:5.5,y:10.5}]}).open,true);
 assert.equal(updateGate({...base,open:true,actors:[],enemies:[]}).open,false);
});

function gateMap(){
 const G=require('../shared/worldgen'),width=40,cells=[17,18,19,20,21,22,23].map(x=>20*width+x);
 return{width,height:40,tiles:new Uint8Array(1600).fill(G.B.WASTE),walls:new Set(Array.from({length:40},(_,x)=>20*width+x)),towns:[{x:20,y:10,r:10,zone:11,gates:[{cells}]}],openGates:new Set(),cells};
}
test('authoritative snapshot restores an already open gate on reconnect and closes stale client gates',()=>{
 const S=require('../shared/settlements'),M=require('../shared/movement'),map=gateMap();
 assert.equal(M.segmentWalkable(map,{x:20.5,y:22},0,-4),false);
 assert.equal(S.syncGates(map,[...map.cells,0]),true);
 assert.equal(map.openGates.has(0),false,'non-gate walls cannot be opened');
 assert.equal(M.segmentWalkable(map,{x:20.5,y:22},0,-4),true);
 assert.equal(S.syncGates(map,map.cells),false,'unchanged state needs no grid rebuild');
 assert.equal(S.syncGates(map,[]),true);
 assert.equal(M.segmentWalkable(map,{x:20.5,y:22},0,-4),false);
});
test('enemy cannot cross a closed gate even with an old path, but can enter an open gate',()=>{
 const S=require('../shared/settlements'),M=require('../shared/movement'),AI=require('../server/ai'),E=require('../shared/enemies'),map=gateMap();
 const ctx={map,grid:M.gridFromWorld(map),game:{enemySpeedFactor:1},isSafe:()=>false};
 const enemy={def:E.get('mage_fire'),x:20.5,y:22,path:[[20,18]]};
 AI.moveAlong(ctx,enemy,2);
 assert.ok(enemy.y>=21,'closed gate stopped enemy');
 S.syncGates(map,map.cells);enemy.path=[[20,18]];
 AI.moveAlong(ctx,enemy,2);assert.ok(enemy.y<20,'enemy entered the open gate');
});
test('cleared vehicle approach opens the gate and the entire car can cross in both directions',()=>{
 const S=require('../shared/settlements'),M=require('../shared/movement'),V=require('../shared/vehicles'),map=gateMap();
 const pos={x:20.5,y:24,facingAngle:-Math.PI/2},actor={id:'vehicle:car',body:V.bodyAt('car',pos)};
 const state=updateGate({gate:{cells:map.cells},town:map.towns[0],width:map.width,actors:[actor],enemies:[],open:false});
 assert.equal(state.open,true);map.drive=V.drive(V.get('car'),0,pos.facingAngle);
 assert.equal(M.segmentWalkable(map,pos,0,-8),false);
 S.syncGates(map,map.cells);
 assert.equal(M.segmentWalkable(map,pos,0,-8),true);
 assert.equal(M.segmentWalkable(map,{...pos,y:16},0,8),true,'reverse gear clears open gate');
});
test('town perimeter excludes natural enemy spawns beyond the old five-cell circle',()=>{
 const Spawner=require('../server/spawner'),map=gateMap();map.settlements=[{x:20,y:10}];
 const ctx={map,game:{settlementSafeRadius:5,spawnMinPlayerDist:0},players:[]};
 assert.equal(Spawner.spawnable(ctx,25.5,18.5),false);
 assert.equal(Spawner.spawnable(ctx,25.5,24.5),true);
});
test('server welcome and regular state include open gates even without resident NPCs',()=>{
 const realtime=require('../server/realtime'),saved=realtime.use,plugins=[];
 realtime.use=plugin=>plugins.push(plugin);
 try{require('../server/settlements');}finally{realtime.use=saved;}
 const plugin=plugins.find(p=>p.handlers?.npc);assert.ok(plugin);
 const room={map:{towns:[],openGates:new Set([105,106])}};
 assert.deepEqual(plugin.welcome(room,{}).sg,[105,106]);
 assert.deepEqual(plugin.stateExtra(room).sg,[105,106]);
 room.map.openGates.clear();assert.deepEqual(plugin.stateExtra(room).sg,[]);
});
test('client applies welcome and recurring gate snapshots to both collision and gate appearance',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),S=require('../shared/settlements'),M=require('../shared/movement');
 const map=gateMap();let rebuilds=0;
 const context={window:{Settlements:S},document:{querySelector:()=>null},performance:{now:()=>0}};
 vm.createContext(context);
 const source=fs.readFileSync(require.resolve('../client/js/game/settlements-ui.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,'');
 vm.runInContext(source+'\nglobalThis.ui={stlAttach,stlOnWelcome,stlOnState,stlOnMessage};',context);
 context.ui.stlAttach({map:()=>map,refreshGrid:()=>rebuilds++});
 context.ui.stlOnWelcome({sg:map.cells});
 assert.equal(M.segmentWalkable(map,{x:20.5,y:22},0,-4),true);
 context.ui.stlOnState(undefined,[]);
 assert.equal(M.segmentWalkable(map,{x:20.5,y:22},0,-4),false);
 context.ui.stlOnMessage({t:'settlement-gates',cells:map.cells,open:true});
 assert.equal(map.cells.every(j=>map.openGates.has(j)),true);
 // Full state repairs the client even if the closing event was missed.
 context.ui.stlOnState([],[]);
 assert.equal(map.openGates.size,0);assert.equal(rebuilds,4);
});
