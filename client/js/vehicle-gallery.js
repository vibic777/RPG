import {drawMesh} from './game/vehicle-mesh.js';
import {drawHumanoid} from './game/figure-art.js';

const V=window.Vehicles,$=id=>document.getElementById(id),params=new URLSearchParams(location.search);
const view=$('view'),ctx=view.getContext('2d'),boundsMemo=new Map();
let selected=V.get(params.get('id'))||V.get('helicopter'),filter='all',spinning=false,lastFrame=0,pan={x:0,y:0},drag=null;
const group=d=>d.animal?'animal':d.kind;
const groups=[['all','Все'],['land','Наземная'],['air','Авиация'],['water','Водная'],['animal','Скакуны']];
const hero={colors:{skin:'#cba58d',hair:'#25303c',hairStyle:'short'},look:{shirt:{color:'#556d75'},pants:{color:'#303c48'},feet:{color:'#25303b'}}};
const number=n=>n.toLocaleString('ru-RU',{maximumFractionDigits:2});
function state(){return{moving:$('moving').checked,wreck:$('wreck').checked,turretDir:Number($('turret').value),rearTurretDir:Number($('rear').value)};}

// Measure the real rendered silhouette, including barrels, propellers and shadows.
function measure(def,heading,v,quality){
  const key=[def.id,Math.round(heading*180/Math.PI),v.moving,v.wreck,v.turretDir,v.rearTurretDir,quality].join(':');
  if(boundsMemo.has(key))return boundsMemo.get(key);
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  const point=(x,y)=>{x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);};
  const target={canvas:{width:4096,height:4096},getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0})};
  const mock=new Proxy(target,{get(o,k){
    if(k in o)return o[k];
    if(k==='moveTo'||k==='lineTo')return point;
    if(k==='ellipse')return(x,y,rx,ry)=>{point(x-rx,y-ry);point(x+rx,y+ry);};
    if(k==='arc')return(x,y,r)=>{point(x-r,y-r);point(x+r,y+r);};
    if(k==='drawImage')return(image,x,y,w,h)=>{point(x,y);point(x+w,y+h);};
    if(k==='createLinearGradient'||k==='createRadialGradient')return()=>({addColorStop(){}});
    return()=>{};
  },set(o,k,value){o[k]=value;return true;}});
  drawMesh(mock,def,{...v},1000,1000,1,heading,1400,0,quality);
  const b={x0:x0-1000,y0:y0-1000,x1:x1-1000,y1:y1-1000};
  if(!Object.values(b).every(Number.isFinite))throw Error('Не удалось нарисовать '+def.name);
  boundsMemo.set(key,b);if(boundsMemo.size>180)boundsMemo.delete(boundsMemo.keys().next().value);
  return b;
}
function fit(def,heading,v,quality,w,h){
  const b=measure(def,heading,v,quality),unit=Math.min((w-38)/(b.x1-b.x0),(h-38)/(b.y1-b.y0),90);
  return{unit,x:w/2-(b.x0+b.x1)*unit/2,y:h/2-(b.y0+b.y1)*unit/2};
}
function paint(time=1400){
  const heading=Number($('heading').value)*Math.PI/180,v=state(),quality=$('quality').value;
  const b=fit(selected,heading,v,quality,view.width,view.height-50),zoom=Number($('zoom').value)/100;
  ctx.fillStyle='#b1a17e';ctx.fillRect(0,0,view.width,view.height);
  ctx.save();ctx.translate(view.width/2+pan.x,view.height/2+pan.y);ctx.scale(zoom,zoom);ctx.translate(-view.width/2,-view.height/2);
  drawMesh(ctx,selected,{...v},b.x,b.y+20,b.unit,heading,time,0,quality);
  if($('hero').checked){drawHumanoid(ctx,hero,75,view.height-40,b.unit,time);}
  ctx.restore();ctx.fillStyle='#293336';ctx.font='15px system-ui';
  ctx.fillText($('hero').checked?'Человек — 1,75 м, тот же масштаб':'',20,view.height-14);
  $('degrees').value=$('heading').value+'°';
}
function catalog(){
  const query=$('search').value.toLocaleLowerCase('ru');$('list').replaceChildren();
  for(const d of V.LIST){
    if(filter!=='all'&&group(d)!==filter||!d.name.toLocaleLowerCase('ru').includes(query))continue;
    const button=document.createElement('button');button.textContent=d.name;button.classList.toggle('active',d.id===selected.id);
    button.onclick=()=>{selected=d;pan={x:0,y:0};$('zoom').value=100;history.replaceState(null,'','?id='+d.id);refresh();};$('list').append(button);
  }
}
function refresh(){
  $('name').textContent=selected.name;
  $('details').textContent=V.dimensionsOf(selected).slice(0,3).map(number).join(' × ')+' м · '+number(selected.mass)+' т · '+(selected.animal?'Скакун':selected.walker?'Шагоход · Mad Max':selected.id==='helicopter'?'Ка-52 · соосные винты · Mad Max':'Mad Max');
  catalog();paint();
}
function sheet(id){
  const def=V.get(id);if(!def)throw Error('Неизвестная модель '+id);
  document.body.className='sheet';const canvas=$('sheet'),c=canvas.getContext('2d');
  c.fillStyle='#b1a17e';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='#263135';c.font='bold 26px system-ui';c.fillText(def.name,26,39);
  c.font='15px system-ui';c.fillText(V.dimensionsOf(def).slice(0,3).map(number).join(' × ')+' м · '+number(def.mass)+' т · реальные игровые модели · высокое качество',26,68);
  for(let i=0;i<8;i++){
    const heading=i*Math.PI/4,v={moving:false,turretDir:i,rearTurretDir:(i+4)%8},b=fit(def,heading,v,'high',300,420);
    const x=i%4*300,y=100+Math.floor(i/4)*475;
    c.save();c.beginPath();c.rect(x,y,300,430);c.clip();drawMesh(c,def,v,x+b.x,y+b.y,b.unit,heading,1400,0,'high');c.restore();
    c.fillStyle='#263135';c.font='15px system-ui';c.fillText(i*45+'°',x+132,y+454);
  }
  document.body.dataset.ready='true';document.title=def.name+' — 8 ракурсов';
}
try{
 if(params.has('sheet'))sheet(params.get('sheet'));
 else{
  for(const [key,label] of groups){const b=document.createElement('button');b.textContent=label;b.classList.toggle('active',key===filter);b.onclick=()=>{filter=key;for(const node of $('filters').children)node.classList.remove('active');b.classList.add('active');catalog();};$('filters').append(b);}
  for(const id of ['heading','turret','rear','zoom','quality','hero','wreck','moving'])$(id).addEventListener('input',()=>paint());
  $('search').oninput=catalog;
  let framePending=false;
  $('rotate').onclick=()=>{spinning=!spinning;$('rotate').textContent=spinning?'Остановить':'Вращать';if(spinning&&!framePending){framePending=true;requestAnimationFrame(frame);}};
  function frame(t){framePending=false;if(!spinning&&!$('moving').checked)return;if(t-lastFrame>50){if(spinning)$('heading').value=(Number($('heading').value)+2)%360;paint(t);lastFrame=t;}if(!framePending){framePending=true;requestAnimationFrame(frame);}}
  $('moving').addEventListener('change',()=>{if($('moving').checked&&!framePending){framePending=true;requestAnimationFrame(frame);}});
  $('reset').onclick=()=>{pan={x:0,y:0};$('zoom').value=100;$('heading').value=315;paint();};
  $('save').onclick=()=>{const a=document.createElement('a');a.download=selected.id+'.png';a.href=view.toDataURL('image/png');a.click();};
  view.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY,pan:{...pan}};view.setPointerCapture(e.pointerId);};
  view.onpointermove=e=>{if(!drag)return;const scale=view.width/view.getBoundingClientRect().width;pan={x:drag.pan.x+(e.clientX-drag.x)*scale,y:drag.pan.y+(e.clientY-drag.y)*scale};paint();};
  view.onpointerup=()=>{drag=null;};view.onpointercancel=()=>{drag=null;};
  refresh();document.body.dataset.ready='true';
 }
}catch(e){$('error').textContent=e.stack;document.body.dataset.error=String(e);throw e;}
