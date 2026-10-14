import {drawSpellZone,drawVortex,flame,shard} from './spell-art.js';
const TAU=Math.PI*2,hash=n=>{const v=Math.sin(n*127.1+19.7)*43758.5453;return v-Math.floor(v);};
const INK={shadow:'#788faa',fire:'#ff9951',water:'#92e4f6',earth:'#c3a77b',air:'#c9eaf2',dark:'#b290ed',blood:'#ed7e99',electricity:'#a7d9ff',light:'#ffe5a5'};
const line=(ctx,pts,c,w=1)=>{ctx.strokeStyle=c;ctx.lineWidth=w;ctx.lineCap='round';ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();};
export function spellLife(f,fallback=450){return f.k==='cone'?850:f.k==='spell'?1200:f.k==='boom'&&['umbraSpikes','umbraField','umbraVeil','fireNova','meteorFall','quake','judgement','shadowFear','shadowSmoke','smoke','shadow','iceSpikes','earthSpikes','bloodSpikes','shadowSpikes','lightSpikes','windSpikes','teslaSpikes','lightningStrike','shadowField','shadowStep','windBlink','golemSummon'].includes(f.f)?1300:fallback;}
export function drawSpellBurst(r,f,time,life){
  if(f.f==='umbraVeil')f={...f,f:'shadowSmoke'};
  const kinds=['umbraRain','umbraSpikes','umbraField','iceSpikes','earthSpikes','bloodSpikes','shadowSpikes','lightSpikes','windSpikes','teslaSpikes','lightningStrike','shadowField'];
  if(kinds.includes(f.f)){drawSpellZone(r,{...f,until:f.born+life},time,true);drawSpellZone(r,{...f,until:f.born+life},time);return true;}
  if(!['fireNova','meteorFall','quake','judgement','shadowFear','shadowSmoke','smoke','shadow'].includes(f.f))return false;
  const ctx=r.ctx,p=r.toScreen(f.x,f.y),u=r.hh*0.9,age=time-f.born,k=Math.min(1,age/life),fade=Math.sin(k*Math.PI),rx=(f.r||3)*r.hw*Math.SQRT2,ry=(f.r||3)*r.hh*Math.SQRT2;
  ctx.save();ctx.globalAlpha*=fade;
  if(f.f==='meteorFall'){
    const impact=0.42,fall=Math.min(1,k/impact),y=p.y-u*10*(1-fall);
    if(k<impact){flame(ctx,p.x,y,u*0.8,u*3,time);shard(ctx,{x:p.x,y},u*0.65,u*0.9,'#edb476',time/170);}
    else for(let i=0;i<14;i++){const a=i*TAU/14,d=(k-impact)/(1-impact);flame(ctx,p.x+Math.cos(a)*rx*d,p.y+Math.sin(a)*ry*d,u*0.25,u*(0.6+hash(i)),time,i);}
  }else if(f.f==='fireNova'){
    for(let i=0;i<22;i++){const a=i*TAU/22,rad=Math.min(1,k*2);flame(ctx,p.x+Math.cos(a)*rx*rad,p.y+Math.sin(a)*ry*rad,u*0.24,u*(0.8+hash(i)),time,i);}
  }else if(f.f==='quake'){
    for(let i=0;i<12;i++){const a=i*TAU/12,pts=Array.from({length:7},(_,j)=>{const q=j/6*Math.min(1,k*2),aa=a+(hash(i*7+j)-0.5)*0.15;return{x:p.x+Math.cos(aa)*rx*q,y:p.y+Math.sin(aa)*ry*q};});line(ctx,pts,'#342d23',4);line(ctx,pts,'#d7b781',1);const tip=pts[6];shard(ctx,tip,u*0.25,u*0.6,'#bea078',i);}
  }else if(f.f==='judgement'){
    for(let i=0;i<7;i++){const a=i*TAU/7,q=i===0?0:0.6,x=p.x+Math.cos(a)*rx*q,y=p.y+Math.sin(a)*ry*q,g=ctx.createLinearGradient(x,y-u*9,x,y);g.addColorStop(0,'#ffeab600');g.addColorStop(0.65,'#ffe4a844');g.addColorStop(1,'#fff3c8dd');ctx.fillStyle=g;ctx.fillRect(x-u*0.23,y-u*9,u*0.46,u*9);ctx.strokeStyle='#ffe9b9';ctx.beginPath();ctx.ellipse(x,y,u*0.5,u*0.2,0,0,TAU);ctx.stroke();}
  }else{
    const fear=f.f==='shadowFear';for(let i=0;i<10;i++){const a=i*TAU/10+time/900,d=(0.3+hash(i)*0.65)*rx;ctx.fillStyle=fear?'#aa80de44':'#70677d44';ctx.beginPath();ctx.ellipse(p.x+Math.cos(a)*d,p.y+Math.sin(a)*d*0.5-u*k*2,u*(0.6+hash(i)),u*(0.35+hash(i)*0.3),a,0,TAU);ctx.fill();}if(fear){ctx.strokeStyle='#bd91e9';ctx.beginPath();ctx.ellipse(p.x,p.y,rx*k,ry*k,0,0,TAU);ctx.stroke();}
  }ctx.restore();return true;
}
export function drawSpellStream(r,f,time,life){
  const names={umbraStream:'shadow',fireStream:'fire',flame:'fire',waterJet:'water',frost:'water',gravelStream:'earth',windStream:'air',wind:'air',shadowStream:'dark',bloodStream:'blood',arcStream:'electricity',lightStream:'light'};
  const school=names[f.f];if(!school)return false;
  const ctx=r.ctx,u=r.hh*0.9,k=Math.min(1,(time-f.born)/life),fade=Math.sin(k*Math.PI),arc=(f.w||40)*Math.PI/180,col=INK[school],count=window.GameSettings?.graphicsQuality==='low'?14:26;
  ctx.save();ctx.globalAlpha*=fade;
  for(let i=0;i<count;i++){
    const phase=(k*1.7+hash(i*11))%1,a=(f.a||0)+(hash(i*3)-0.5)*arc*0.9,d=(0.15+phase*0.85)*(f.r||4)*Math.min(1,k*4),p=r.toScreen(f.x+Math.cos(a)*d,f.y+Math.sin(a)*d),prev=r.toScreen(f.x+Math.cos(a)*Math.max(0,d-0.6),f.y+Math.sin(a)*Math.max(0,d-0.6));p.y-=u*1.7;prev.y-=u*1.7;
    if(school==='fire')flame(ctx,p.x,p.y,u*(0.16+phase*0.25),u*(0.5+phase),time,i);
    else if(school==='earth')shard(ctx,p,u*0.16,u*0.28,col,a);
    else if(school==='air'||school==='dark'||school==='shadow')drawVortex(ctx,p.x,p.y+u*0.25,u*(0.15+phase*0.35),u*0.6,time+i*100,col,fade*0.65);
    else if(school==='electricity'){line(ctx,[prev,{x:(prev.x+p.x)/2,y:(prev.y+p.y)/2+Math.sin(time/45+i)*u*0.35},p],col,2);line(ctx,[prev,p],'#e8faff',0.6);}
    else{line(ctx,[prev,p],col+'88',u*(0.1+phase*0.13));shard(ctx,p,u*0.12,u*(school==='light'?0.35:0.2),col,a+Math.PI/2);}
  }ctx.restore();return true;
}
export function drawSpellSupport(r,f,time,life,actor){
  const sp=window.Magic?.get(f.s);if(!sp||f.k!=='spell')return false;
  const ctx=r.ctx,p=actor?r.toScreen(actor.x,actor.y):r.toScreen(f.x,f.y),u=r.hh*0.9,col=INK[sp.school],k=Math.min(1,(time-f.born)/life),fade=Math.sin(k*Math.PI);
  ctx.save();ctx.globalAlpha*=fade;
  if(['heal','hot','cleanse'].includes(sp.kind)){
    for(let i=0;i<9;i++){const a=i*TAU/9+time/400,z=((k+i/9)%1)*u*3,x=p.x+Math.cos(a)*u*0.8,y=p.y+Math.sin(a)*u*0.3-z;shard(ctx,{x,y},u*0.1,u*0.24,col,time/400);}
    for(let i=0;i<3;i++){ctx.strokeStyle=col;ctx.beginPath();ctx.ellipse(p.x,p.y-u*i*0.8,u*(0.9-i*0.15),u*0.24,0,0,TAU);ctx.stroke();}
  }else if(sp.kind==='shield'){
    ctx.fillStyle=col+'22';ctx.strokeStyle=col+'bb';ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(p.x,p.y-u*1.7,u*0.9,u*1.9,0,0,TAU);ctx.fill();ctx.stroke();for(let i=0;i<7;i++){const y=p.y-u*(0.4+i*0.45);line(ctx,[{x:p.x-u*0.6,y},{x:p.x+u*0.6,y:y-u*0.3}],col+'55',0.7);}
  }else if(sp.kind==='debuff'||sp.kind==='charm'||sp.kind==='vampirism'){
    const y=p.y-u*3.3,rad=u*0.65;ctx.strokeStyle=col;ctx.beginPath();ctx.arc(p.x,y,rad,0,TAU);ctx.stroke();const pts=Array.from({length:6},(_,i)=>({x:p.x+Math.cos(i*TAU/5+time/900)*rad,y:y+Math.sin(i*TAU/5+time/900)*rad}));line(ctx,pts,col,1.3);for(let i=0;i<3;i++){const a=time/350+i*TAU/3;line(ctx,[{x:p.x+Math.cos(a)*u*0.7,y:p.y-u*0.3},{x:p.x+Math.cos(a+0.5)*u*0.7,y:p.y-u*2.7}],col+'88',1);}
  }else if(sp.kind==='buff'&&sp.defense){
    for(let i=0;i<6;i++){const a=i*TAU/6+time/700;shard(ctx,{x:p.x+Math.cos(a)*u*0.8,y:p.y-u*1.4+Math.sin(a)*u*0.5},u*0.22,u*0.4,col,a);}
  }else if(['blink','step','buff','stealth'].includes(sp.kind))drawVortex(ctx,p.x,p.y,u*1.2,u*3,time,col,fade*0.7);
  else if(sp.kind==='summon'){for(let i=0;i<8;i++){const a=i*TAU/8;shard(ctx,{x:p.x+Math.cos(a)*u*1.3,y:p.y+Math.sin(a)*u*0.5-u*k},u*0.25,u*0.55,col,a);}}
  else{ctx.restore();return false;}
  ctx.restore();return true;
}
