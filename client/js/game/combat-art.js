import {drawSpellBurst,drawSpellStream,drawSpellSupport} from './spell-effects.js';
import {drawSpellZone,drawElementalProjectile} from './spell-art.js';
import { drawIcon } from '../icons.js';
// Эффекты в одной изометрической проекции: свет, следы оружия, разные стихии.
const TAU=Math.PI*2;
const COLORS={fireArrow:'#ff9951',flame:'#ed985d',fire:'#ed985d',fireball:'#ed985d',frost:'#a2d9eb',ice:'#a2d9eb',stone:'#c2a984',shadow:'#ad91d8',holy:'#efdda0',spark:'#a8d8ee',plasma:'#ff93dc',wind:'#dae8df',acid:'#b4cd70',poison:'#b4cd70',magic:'#c3a2e7',laser:'#ef9385',lslash:'#a4dae6',lasso:'#a4dae6',smoke:'#8c939f',bloodDrain:'#d45978',lightning:'#a5d3ff',tesla:'#a5d3ff',blood:'#d45978',trap:'#bec5c6'};
const color=(kind)=>COLORS[kind]||'#e8c89b';
const noise=(n)=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
function glow(ctx,x,y,rad,col,alpha=1){
  ctx.save();ctx.globalAlpha*=alpha;ctx.globalCompositeOperation='lighter';
  const g=ctx.createRadialGradient(x,y,0,x,y,Math.max(1,rad));g.addColorStop(0,col);g.addColorStop(0.24,col+'99');g.addColorStop(1,col+'00');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,Math.max(1,rad),0,TAU);ctx.fill();ctx.restore();
}
function stroke(ctx,pts,col,width){ctx.strokeStyle=col;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}
export function drawMagicCircle(ctx,x,y,rx,col,time,alpha=1){
  ctx.save();ctx.globalAlpha*=alpha;ctx.strokeStyle=col;ctx.lineWidth=1.1;
  ctx.beginPath();ctx.ellipse(x,y,rx,rx*0.5,0,0,TAU);ctx.stroke();
  ctx.beginPath();ctx.ellipse(x,y,rx*0.82,rx*0.41,0,0,TAU);ctx.stroke();
  for(let i=0;i<8;i++){
    const a=i*TAU/8+time/2600;
    const pts=[0.84,0.96,0.84].map((k,j)=>({x:x+Math.cos(a+(j-1)*0.1)*rx*k,y:y+Math.sin(a+(j-1)*0.1)*rx*k*0.5}));stroke(ctx,pts,col,1.2);
  }
  ctx.restore();
}
export function drawCombatEffect(r,f,time,life,who=null){
  if(f.k==='boom'&&drawSpellBurst(r,f,time,life)||f.k==='cone'&&drawSpellStream(r,f,time,life)||f.k==='spell'&&drawSpellSupport(r,f,time,life,who))return;
  const ctx=r.ctx,u=r.hh*0.9,k=Math.max(0,(time-f.born)/life),fade=Math.max(0,1-k),col=color(f.f);
  if(!fade&&!(f.until>time))return;
  ctx.save();ctx.globalAlpha*=fade;
  const center=r.toScreen(f.x||0,f.y||0);
  if(f.k==='muzzle'){
    const age=time-f.born;if(age>95||['arrow','bolt','lasso','weaponThrow'].includes(f.f)){ctx.restore();return;}
    const scale=f.muzzle?.scale||1,px=center.x+(f.muzzle?.dx||0)*u*scale,py=center.y+(f.muzzle?.dy??-2.16)*u*scale-(f.muzzle?.alt||0)*10;
    const hot=['bullet','pellets','grenade','shell'].includes(f.f)?'#ffcd7d':col,life=Math.max(0,1-age/100);
    glow(ctx,px,py,u*(f.up?0.42:0.28)*life,hot,0.9);
    if(f.up){
      stroke(ctx,[{x:px,y:py},{x:px,y:py-u*0.72*life}],'#fff6d2',Math.max(1.2,u*0.06));
      stroke(ctx,[{x:px-u*0.08,y:py},{x:px,y:py-u*0.4*life}],hot,Math.max(0.8,u*0.03));
      stroke(ctx,[{x:px+u*0.08,y:py},{x:px,y:py-u*0.4*life}],hot,Math.max(0.8,u*0.03));
    }else{
      const a=r.toScreen((f.x||0)+Math.cos(f.a||0),(f.y||0)+Math.sin(f.a||0)),dx=a.x-center.x,dy=a.y-center.y,len=Math.max(1,Math.hypot(dx,dy));
      stroke(ctx,[{x:px,y:py},{x:px+dx/len*u*0.42*life,y:py+dy/len*u*0.42*life}],'#fff6d2',Math.max(1.1,u*0.05));
      for(const spread of [-0.16,0.16]){const d=u*0.28*life;stroke(ctx,[{x:px,y:py},{x:px+dx/len*d-dy/len*spread*u,y:py+dy/len*d+dx/len*spread*u}],hot,Math.max(0.7,u*0.028));}
    }
  }else if(f.k==='swing'){
    const arc=(f.f==='thrust'?24:100)*Math.PI/180,a=f.a||0,radius=f.r||1;
    const sweep=(Math.min(1,k/0.35)-0.5)*arc;
    const pts=Array.from({length:12},(_,i)=>{
      const angle=a+sweep-arc*0.32+(i/11)*arc*0.4;
      const p=r.toScreen(f.x+Math.cos(angle)*radius*(0.8+i*0.016),f.y+Math.sin(angle)*radius*(0.8+i*0.016));return{x:p.x,y:p.y-u*1.85};
    });
    ctx.globalAlpha*=0.58;stroke(ctx,pts,col,Math.max(1,u*0.065));ctx.globalAlpha*=0.45;stroke(ctx,pts,col,Math.max(2,u*0.24));
  }else if(f.k==='cone'){
    const arc=(f.w||40)*Math.PI/180;
    for(let i=0;i<20;i++){
      const a=(f.a||0)+(noise(i+f.born)*2-1)*arc*0.46,d=(0.15+noise(i*11+f.born)*0.85)*(f.r||2)*Math.min(1,k*3+0.3);
      const p=r.toScreen(f.x+Math.cos(a)*d,f.y+Math.sin(a)*d);
      const z=u*(1.8+noise(i*7)*0.7);glow(ctx,p.x,p.y-z,u*(0.08+noise(i*2)*0.19),col,0.65);
      stroke(ctx,[{x:p.x,y:p.y-z},{x:p.x-Math.cos(a-Math.PI/4)*u*0.16,y:p.y-z+u*0.1}],col,1.2);
    }
  }else if(f.k==='boom'&&['iceSpikes','earthSpikes','bloodSpikes','shadowField','lightningStrike'].includes(f.f)){
    ctx.restore();drawSpellZone(r,{...f,until:f.born+Math.max(650,life)},time,true);drawSpellZone(r,{...f,until:f.born+Math.max(650,life)},time,false);return;
  }else if(f.k==='boom'){
    const radius=(f.r||1)*r.hw*(0.3+Math.sin(Math.min(1,k)*Math.PI/2)*0.7);
    if(f.f==='blood'){ctx.fillStyle='#853f36';for(let i=0;i<8;i++){const a=noise(i+f.born)*TAU,d=radius*noise(i*5);ctx.beginPath();ctx.ellipse(center.x+Math.cos(a)*d,center.y+Math.sin(a)*d*0.5,Math.max(1,u*0.07),Math.max(1,u*0.03),0,0,TAU);ctx.fill();}}
    else{ctx.strokeStyle=col;ctx.lineWidth=Math.max(1,u*0.04*fade);ctx.beginPath();ctx.ellipse(center.x,center.y,radius,radius*0.5,0,0,TAU);ctx.stroke();
      for(let i=0;i<14;i++){const a=noise(i+f.born)*TAU,d=radius*(0.2+noise(i*4)*0.6),p={x:center.x+Math.cos(a)*d,y:center.y+Math.sin(a)*d*0.5-u*k*(0.3+noise(i))};glow(ctx,p.x,p.y,u*(0.1+noise(i*8)*0.22)*fade,col,0.5);}
    }
  }else if(f.k==='chain'){
    const a=r.toScreen(f.x,f.y),b=r.toScreen(f.x2,f.y2),dx=b.x-a.x,dy=b.y-a.y,len=Math.max(1,Math.hypot(dx,dy)),frame=Math.floor(time/65);
    const pts=Array.from({length:10},(_,i)=>{const q=i/9,wiggle=i===0||i===9?0:(noise(i+frame*19)-0.5)*u*0.5;return{x:a.x+dx*q-dy/len*wiggle,y:a.y+dy*q-u*1.5+dx/len*wiggle};});
    ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha*=0.25;stroke(ctx,pts,'#8ebdd7',6);ctx.globalAlpha=fade;stroke(ctx,pts,f.f==='bloodDrain'?'#e36683':'#b4d9ed',2);stroke(ctx,pts,f.f==='bloodDrain'?'#ffc1ca':'#e9f7ff',0.7);ctx.restore();
    glow(ctx,b.x,b.y-u*1.5,u*0.24,'#b4d9ed',fade);
  }else if(f.k==='impact'){
    const x=center.x,y=center.y-(f.lift??u*2.12);glow(ctx,x,y,u*0.4*fade,col,0.8);
    for(let i=0;i<7;i++){const a=noise(i+f.born)*TAU,d=u*k*(0.3+noise(i*3)*0.4);stroke(ctx,[{x:x+Math.cos(a)*d,y:y+Math.sin(a)*d},{x:x+Math.cos(a)*d*0.6,y:y+Math.sin(a)*d*0.6}],col,Math.max(0.7,u*0.025));}
    if(f.lasso){const a=r.toScreen(f.lasso.x,f.lasso.y);stroke(ctx,[{x:a.x,y:a.y-u*1.6},{x,y}],col,1.4);}
  }else if(f.k==='spell'||f.k==='cast'||f.k==='levelup'){
    if(f.k==='cast'&&!who)return;
    const p=who?r.toScreen(who.x,who.y):center;
    const spell=window.Magic&&window.Magic.get(f.s),school=spell&&window.Magic.SCHOOLS[spell.school];
    const ink=f.k==='levelup'?'#e8c887':school?school.color:'#bba0dd';
    if(f.k==='cast'){const progress=Math.max(0,Math.min(1,(time-f.born)/Math.max(1,f.until-f.born)));ctx.globalAlpha=time<f.until?0.25+progress*0.4:0;}
    const rad=r.hw*(f.k==='cast'?0.48:0.3+k*0.7);
    drawMagicCircle(ctx,p.x,p.y,rad,ink,time,0.85);
    for(let i=0;i<6;i++){const a=i*TAU/6+time/750,z=((time/1200+i/6)%1)*u*2.6;glow(ctx,p.x+Math.cos(a)*rad*0.55,p.y+Math.sin(a)*rad*0.28-z,u*0.06,ink,0.5);}
  }
  ctx.restore();
}

// Боеприпасы техники (shared/vehicles.js ARMS): true — нарисовано
function drawOrdnance(ctx,r,p,head,tail,dx,dy,len,u,time){
  const ux=dx/len,uy=dy/len,nx=-uy,ny=ux;
  if(p.f==='shell'){
    stroke(ctx,[{x:head.x-ux*u*0.9,y:head.y-uy*u*0.9},head],'#ffb347',Math.max(1.4,r.zoom*2));
    stroke(ctx,[{x:head.x-ux*u*0.3,y:head.y-uy*u*0.3},head],'#fff4c8',Math.max(1,r.zoom*1.2));
    return true;
  }
  if(p.f==='rocket'||p.f==='missile'){
    const L=u*(p.f==='missile'?0.5:0.38),body=p.f==='missile'?'#e9ece4':'#6d7560';
    for(let i=1;i<=(p.f==='missile'?10:6);i++){const k=i*u*0.16;glow(ctx,head.x-ux*(L+k)+nx*Math.sin(time/60+i)*u*0.03,head.y-uy*(L+k)+ny*Math.sin(time/60+i)*u*0.03,u*(0.05+i*0.012),'#c9c7c0',0.32*(1-i/11));}
    glow(ctx,head.x-ux*L,head.y-uy*L,u*0.13,'#ffb24a',0.9);
    stroke(ctx,[{x:head.x-ux*L,y:head.y-uy*L},head],body,Math.max(2,u*0.09));
    stroke(ctx,[{x:head.x-ux*L*0.25,y:head.y-uy*L*0.25},head],p.f==='missile'?'#c23b2e':'#2e3328',Math.max(2,u*0.09));
    for(const sd of [-1,1])stroke(ctx,[{x:head.x-ux*L+nx*sd*u*0.07,y:head.y-uy*L+ny*sd*u*0.07},{x:head.x-ux*L*0.7,y:head.y-uy*L*0.7}],body,1);
    return true;
  }
  if(p.f==='torpedo'){
    for(let i=0;i<8;i++){const k=i*u*0.22;ctx.globalAlpha=0.5*(1-i/8);ctx.strokeStyle='#d8f1fb';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(head.x-ux*k,head.y-uy*k,u*(0.06+i*0.03),u*(0.03+i*0.015),Math.atan2(dy,dx),0,TAU);ctx.stroke();}
    ctx.globalAlpha=0.85;ctx.fillStyle='#22313a';ctx.beginPath();ctx.ellipse(head.x-ux*u*0.25,head.y-uy*u*0.25,u*0.3,u*0.06,Math.atan2(dy,dx),0,TAU);ctx.fill();ctx.globalAlpha=1;
    return true;
  }
  if(p.f==='bomb'){
    ctx.save();ctx.translate(head.x,head.y);ctx.rotate(Math.atan2(dy,dx)*0.25+Math.PI/2);
    ctx.fillStyle='#3e4636';ctx.strokeStyle='#1c201a';ctx.lineWidth=0.8;ctx.beginPath();ctx.ellipse(0,0,u*0.08,u*0.2,0,0,TAU);ctx.fill();ctx.stroke();
    ctx.fillStyle='#2b3127';ctx.fillRect(-u*0.1,-u*0.26,u*0.2,u*0.05);ctx.restore();
    return true;
  }
  return false;
}

export function drawProjectile(r,p,time){
  const ctx=r.ctx,u=r.hh*0.9,head=r.toScreen(p.x,p.y),ink=color(p.f);
  const traveled=Math.hypot(p.x-p.x0,p.y-p.y0)+(p.travel0||0),blend=Math.max(0,1-traveled/0.85),muzzle=p.originMuzzle,scale=muzzle?.scale||1;
  const sourceHeight=(muzzle?.height||2.12)*scale,target=p.source?.attackTarget;
  const distance=target?Math.max(0.85,Math.hypot(target.x-p.x0,target.y-p.y0)):Math.max(1,p.r||5);
  const progress=Math.max(0,Math.min(1,traveled/distance)),targetHeight=p.th??target?.height??2.12; // th — бомба/торпеда: к земле/воде
  const lift=u*(sourceHeight+(targetHeight-sourceHeight)*progress)+(muzzle?.alt||0)*10*(1-progress);
  const offsetX=(muzzle?.dx||0)*u*scale*blend,offsetY=((muzzle?.dy??-2.12)*scale+sourceHeight)*u*blend;
  p.visualLift=lift-offsetY;
  const tail=r.toScreen(p.x-Math.cos(p.a)*Math.min(0.5,traveled),p.y-Math.sin(p.a)*Math.min(0.5,traveled));
  head.x+=offsetX;tail.x+=offsetX;head.y+=offsetY-lift;tail.y+=offsetY-lift;
  // Ракета из вертикальной шахты сначала поднимается, потом ложится на курс.
  if(p.up){const rise=Math.max(0,1-traveled/1.15);head.y-=u*rise*0.75;tail.x=head.x-(head.x-tail.x)*(1-rise);tail.y=head.y+u*(0.2+rise*0.5);}
  const dx=head.x-tail.x,dy=head.y-tail.y,len=Math.max(1,Math.hypot(dx,dy));
  ctx.save();
  if(drawElementalProjectile(r,p,head,tail,time)) {ctx.restore();return;}
  if(p.f === 'weaponThrow') {
    const item=window.Items.get(p.item), shape=item?.icon.shape;
    if(item){const spear=['spear','halberd'].includes(shape), blade=['sword','katana','nodachi','wakizashi','tanto','knife'].includes(shape);
      stroke(ctx,[tail,head],item.icon.color2||'#c4d3dc',Math.max(0.7,r.zoom));
      ctx.translate(head.x,head.y);ctx.rotate(spear||blade?Math.atan2(dy,dx)+Math.PI/4:time/75);
      drawIcon(ctx,{...item.icon,rarity:'common',set:null},-u*0.46,-u*0.46,u*0.92);
    }
  }else if(drawOrdnance(ctx,r,p,head,tail,dx,dy,len,u,time)){
    // бортовое оружие техники: снаряд, ракета, управляемая ракета, торпеда, бомба
  }else if(['bullet','pellets'].includes(p.f)){
    stroke(ctx,[tail,head],'#d9b377',Math.max(0.9,r.zoom));stroke(ctx,[{x:head.x-dx*0.22,y:head.y-dy*0.22},head],'#fff0c2',Math.max(1,r.zoom*1.2));
  }else if(['arrow','bolt'].includes(p.f)){
    stroke(ctx,[tail,head],'#94826b',Math.max(1,r.zoom*1.2));const nx=-dy/len,ny=dx/len;
    for(const side of [-1,1])stroke(ctx,[{x:tail.x+dx*0.13+nx*side*u*0.045,y:tail.y+dy*0.13+ny*side*u*0.045},{x:tail.x+dx*0.3,y:tail.y+dy*0.3}],'#d2c4ae',1);
    stroke(ctx,[{x:head.x-dx*0.14-dy/len*u*0.03,y:head.y-dy*0.14+dx/len*u*0.03},head,{x:head.x-dx*0.14+dy/len*u*0.03,y:head.y-dy*0.14-dx/len*u*0.03}],'#ccd1c9',1.2);
  }else if(['grenade','stone','disc'].includes(p.f)){
    ctx.fillStyle=p.f==='stone'?'#98836b':p.f==='disc'?'#b4bdc1':'#4f5947';ctx.strokeStyle='#282d2e';ctx.lineWidth=0.8;ctx.beginPath();ctx.ellipse(head.x,head.y,u*0.12,u*(p.f==='disc'?0.045:0.1),time/90,0,TAU);ctx.fill();ctx.stroke();
  }else{
    const trailLength=Math.min(traveled,['laser','holy','wind'].includes(p.f)?0.95:0.6);
    for(let i=7;i>=0;i--){const d=i/7*trailLength,t=r.toScreen(p.x-Math.cos(p.a)*d,p.y-Math.sin(p.a)*d);glow(ctx,t.x+offsetX,t.y+offsetY-lift,u*(0.1-i*0.009),ink,(1-i/9)*0.55);}
    if(p.f==='laser'||p.f==='holy'){stroke(ctx,[tail,head],ink,Math.max(1,r.zoom*2));stroke(ctx,[tail,head],'#f8efdd',Math.max(0.5,r.zoom*0.7));}
    else{glow(ctx,head.x,head.y,u*0.24,ink);ctx.fillStyle='#e8eddf';ctx.beginPath();ctx.arc(head.x,head.y,Math.max(1,u*0.035),0,TAU);ctx.fill();}
    if(['fire','fireball','flame'].includes(p.f)){
      for(let i=0;i<4;i++){const phase=noise(i+p.born)*TAU+time/85,back=i*u*0.07;const px=head.x-dx/len*back-dy/len*Math.sin(phase)*u*0.07,py=head.y-dy/len*back+dx/len*Math.sin(phase)*u*0.07;
        glow(ctx,px,py,u*(0.12-i*0.018),i%2?'#ffbe68':'#ef7952',0.55);}
    }else if(['shadow','magic','poison','acid','wind'].includes(p.f)){
      for(let i=0;i<3;i++){const a=time/170+i*TAU/3,rr=u*0.16;stroke(ctx,[{x:head.x+Math.cos(a)*rr,y:head.y+Math.sin(a)*rr},{x:head.x+Math.cos(a+0.7)*rr*0.7,y:head.y+Math.sin(a+0.7)*rr*0.7}],ink,Math.max(0.65,u*0.025));}
    }
    if(p.f==='frost'){ctx.strokeStyle='#d6edf4';ctx.lineWidth=1;for(let i=0;i<3;i++){const a=time/450+i*Math.PI/3;stroke(ctx,[{x:head.x+Math.cos(a)*u*0.1,y:head.y+Math.sin(a)*u*0.1},{x:head.x-Math.cos(a)*u*0.1,y:head.y-Math.sin(a)*u*0.1}],'#d6edf4',1);}}
  }
  ctx.restore();
}
