'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const load=(file)=>import(pathToFileURL(path.join(__dirname,'..','client','js','game',file)).href);

test('автобой: цель видима, враждебна и жива; мирные одиночки не провоцируются',async()=>{
  const {nearestAutoEnemy}=await load('auto-combat.js');
  const hero={x:0,y:0},enemy=(id,x,extra={})=>({id,x,y:0,hp:100,flags:0,def:{behaviour:'rusher'},...extra});
  const list=[enemy('friend',0.5),enemy('fog',0.7),enemy('dead',1,{deadAt:1}),enemy('loner',1.1,{def:{behaviour:'loner'}}),enemy('hostile',2)];
  assert.equal(nearestAutoEnemy(hero,list,8,e=>e.id!=='fog',e=>e.id!=='friend').id,'hostile');
  assert.equal(nearestAutoEnemy(hero,list,0.1),null);
  list[3].flags=8;
  assert.equal(nearestAutoEnemy(hero,list,8,e=>e.id!=='fog',e=>e.id!=='friend').id,'loner');
});
test('ближний бой: маршрут заканчивается перед целью, дальность зависит от оружия и размера врага',async()=>{
  const {attackDistance,approachPoint}=await load('auto-combat.js');
  const hero={x:0,y:0},target={x:8,y:0,def:{radius:0.6}},reach=attackDistance({kind:'melee',range:1.6},target);
  const p=approachPoint(hero,target,reach);
  assert.ok(p.x<target.x-1&&p.x>hero.x);
  assert.ok(Math.hypot(target.x-p.x,target.y-p.y)<reach);
  assert.ok(attackDistance({kind:'melee',range:3},target)>reach);
  assert.ok(Math.abs(attackDistance({kind:'ranged',range:10},target)-9.4)<1e-9);
});
test('автомагия: мана, откат, чтение на месте, дальность, лечение и защита по необходимости',async()=>{
  const {autoSpellUsable}=await load('auto-combat.js');
  const hero={x:0,y:0},target={x:5,y:0},v={hp:90,mp:20},st={cds:{},buffs:{}},spell={id:'bolt',kind:'bolt',target:'enemy',mp:8,range:10,cast:0.4};
  assert.equal(autoSpellUsable(spell,hero,target,v,100,st,1000),true);
  assert.equal(autoSpellUsable(spell,{...hero,moving:true},target,v,100,st,1000),false);
  assert.equal(autoSpellUsable(spell,hero,{x:11,y:0},v,100,st,1000),false);
  assert.equal(autoSpellUsable(spell,hero,target,{...v,mp:0},100,st,1000),false);
  assert.equal(autoSpellUsable(spell,hero,target,v,100,{...st,cds:{bolt:1100}},1000),false);
  const heal={...spell,kind:'heal',target:'ally'};
  assert.equal(autoSpellUsable(heal,hero,null,v,100,st,1000),false);
  assert.equal(autoSpellUsable(heal,hero,null,{...v,hp:50},100,st,1000),true);
  const shield={...spell,kind:'shield',target:'ally'};
  assert.equal(autoSpellUsable(shield,hero,target,v,100,{...st,buffs:{shield:15}},1000),false);
  assert.equal(autoSpellUsable(shield,hero,target,v,100,st,1000),true);
  const defense={...spell,kind:'buff',target:'self',defense:6};
  assert.equal(autoSpellUsable(defense,hero,target,v,100,{...st,buffs:{def:2000}},1000),false);
  assert.equal(autoSpellUsable(defense,hero,target,v,100,st,1000),true);
});
test('миникарта: прямоугольная карта вписывается; зум центрирует героя и сохраняет точность клика',async()=>{
  const {minimapMatrix,minimapWorldPoint}=await load('minimap-math.js');
  const map={width:240,height:80},w=220,h=114;
  const screen=(m,x,y)=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f});
  const base=minimapMatrix(map,w,h);
  for(const [x,y]of[[0,0],[240,0],[0,80],[240,80]]){const p=screen(base,x,y);assert.ok(p.x>=0&&p.x<=w&&p.y>=0&&p.y<=h);}
  const hero={x:23,y:39},z=minimapMatrix(map,w,h,4,hero),center=screen(z,hero.x,hero.y);
  assert.equal(center.x,w/2);assert.equal(center.y,h/2);
  const p=screen(z,42.7,51.9),back=minimapWorldPoint(z,p.x,p.y);
  assert.ok(Math.abs(back.x-42.7)<1e-9&&Math.abs(back.y-51.9)<1e-9);
  assert.deepEqual(minimapMatrix(map,w,h,1,hero),base);
});
