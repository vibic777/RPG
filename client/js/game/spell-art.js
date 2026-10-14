// Distinct elemental shapes, bounded particle counts and one isometric projection.
const TAU=Math.PI*2;
const hash=n=>{const a=Math.sin(n*127.1+19.7)*43758.5453;return a-Math.floor(a);};
const INK={umbraRain:'#788faa',umbraSpikes:'#788faa',umbraField:'#788faa',shadowRain:'#a182d6',shadowSpikes:'#a182d6',lightRain:'#ffe29b',lightSpikes:'#ffe29b',windRain:'#c4e7ef',windSpikes:'#c4e7ef',teslaSpikes:'#a5d3ff',fireRain:'#ff9951',fireArrowRain:'#ff9951',flameField:'#ff9951',fireTornado:'#ff9951',iceRain:'#9ddff4',iceSpikes:'#9ddff4',iceFloor:'#9ddff4',earthSpikes:'#bea078',stoneRain:'#bea078',roots:'#87b778',hurricane:'#c4e7ef',vortexField:'#c4e7ef',shadowField:'#a182d6',bloodRain:'#e36b87',bloodSpikes:'#e36b87',thunderstorm:'#a5d3ff',lightningStrike:'#a5d3ff'};
function path(ctx,pts,color,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}
export function shard(ctx,p,w,h,color,angle=0){ctx.save();ctx.translate(p.x,p.y);ctx.rotate(angle);const g=ctx.createLinearGradient(-w,0,w,h);g.addColorStop(0,color);g.addColorStop(0.45,'#effaff');g.addColorStop(1,color);ctx.fillStyle=g;ctx.strokeStyle=color;ctx.lineWidth=0.6;ctx.beginPath();ctx.moveTo(0,-h);ctx.lineTo(w,0);ctx.lineTo(0,h*0.15);ctx.lineTo(-w,0);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();}
export function flame(ctx,x,y,w,h,time,seed=0){
  const sway=Math.sin(time/140+seed)*w*0.5;ctx.save();
  const g=ctx.createLinearGradient(x,y-h,x,y);g.addColorStop(0,'#ff6c2422');g.addColorStop(0.4,'#ff6d24bb');g.addColorStop(0.8,'#ffbc54ee');g.addColorStop(1,'#fff3ae');ctx.fillStyle=g;
  ctx.beginPath();ctx.moveTo(x-w,y);ctx.bezierCurveTo(x-w*1.2,y-h*0.35,x+w*0.4,y-h*0.65,x+sway,y-h);ctx.bezierCurveTo(x+w*1.3,y-h*0.55,x+w*0.8,y-h*0.2,x+w,y);ctx.closePath();ctx.fill();
  ctx.fillStyle='#fff1bacc';ctx.beginPath();ctx.moveTo(x-w*0.35,y);ctx.quadraticCurveTo(x-w*0.3,y-h*0.25,x+sway*0.4,y-h*0.5);ctx.quadraticCurveTo(x+w*0.4,y-h*0.2,x+w*0.35,y);ctx.fill();ctx.restore();
}
export function drawVortex(ctx,x,y,w,h,time,col='#c4e7ef',alpha=1){
  ctx.save();ctx.globalAlpha*=alpha;
  for(let layer=0;layer<8;layer++){const q=layer/7,rx=w*(0.16+q*0.7),yy=y-h*q,a=time/190+q*7,cx=x+Math.sin(a)*w*0.1*q;
    ctx.globalAlpha=alpha*(0.15+q*0.12);ctx.fillStyle=col;ctx.beginPath();ctx.ellipse(cx,yy,rx,rx*0.25,0,0,TAU);ctx.fill();
    ctx.globalAlpha=alpha*(0.4+q*0.2);ctx.strokeStyle=col;ctx.lineWidth=1+q;ctx.beginPath();ctx.ellipse(cx,yy,rx,rx*0.25,0,a,a+Math.PI*1.5);ctx.stroke();
  }ctx.restore();
}
export function drawSpellZone(r,f,time,floor=false){
  const umbra={umbraRain:'shadowRain',umbraSpikes:'shadowSpikes',umbraField:'shadowField'}[f.f];
  if(umbra)f={...f,f:umbra,tint:'#788faa'};
  const ctx=r.ctx,c=r.toScreen(f.x,f.y),radius=f.r||f.radius||3,rx=radius*r.hw*Math.SQRT2,ry=radius*r.hh*Math.SQRT2,u=r.hh*0.9,col=f.tint||INK[f.f]||'#a9d8f1';
  if(c.x+rx<-50||c.x-rx>r.vw+50||c.y+ry<-200||c.y-ry>r.vh+200||r.fog&&!r.fog.see(f.x,f.y))return;
  const age=time-(f.born||0),remaining=f.until?f.until-time:500-age,fade=Math.max(0,Math.min(1,age/220,remaining/400));if(!fade)return;
  const quality=r.art?.q||window.GameSettings?.graphicsQuality,count=quality==='low'?10:18;
  ctx.save();ctx.globalAlpha*=fade;
  if(floor){
    const ice=f.f==='iceFloor',g=ctx.createRadialGradient(c.x,c.y,1,c.x,c.y,Math.max(1,rx));g.addColorStop(0,ice?'#6caed655':col+'25');g.addColorStop(0.8,ice?'#96dff14a':col+'18');g.addColorStop(1,col+'00');
    ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(c.x,c.y,rx,ry,0,0,TAU);ctx.fill();ctx.strokeStyle=col+'88';ctx.lineWidth=1;ctx.stroke();
    if(ice){ctx.save();ctx.beginPath();ctx.ellipse(c.x,c.y,rx,ry,0,0,TAU);ctx.clip();for(let i=0;i<10;i++){const x=c.x+(hash(i*7)-0.5)*rx*1.8,y=c.y+(hash(i*11)-0.5)*ry*1.8;path(ctx,[{x,y},{x:x+rx*0.1,y:y-ry*0.1},{x:x+rx*0.19,y:y+ry*0.08},{x:x+rx*0.35,y:y+ry*0.13}],'#d8f9ff77',0.8);}ctx.restore();}
    ctx.restore();return;
  }
  const worldPoint=(i)=>{const a=hash(i*5+3)*TAU,d=Math.sqrt(hash(i*11+5))*radius*0.9;return r.toScreen(f.x+Math.cos(a)*d,f.y+Math.sin(a)*d);};
  if(['hurricane','vortexField','shadowField','fireTornado'].includes(f.f)){
    const several=!['hurricane','fireTornado'].includes(f.f),n=several?4:1;
    for(let i=0;i<n;i++){const p=several?worldPoint(i+37):c;drawVortex(ctx,p.x,p.y,(several?0.27:0.65)*rx,(several?2.8:5.5)*u,time+i*173,col,fade*0.7);}
    for(let i=0;i<8;i++){const a=time/500+i*TAU/8;const p=r.toScreen(f.x+Math.cos(a)*radius*0.7,f.y+Math.sin(a)*radius*0.7);path(ctx,[{x:p.x-4,y:p.y-5},{x:p.x+4,y:p.y-9}],col,1);}
    if(f.f==='fireTornado')for(let i=0;i<8;i++){const a=time/400+i*TAU/8,p=r.toScreen(f.x+Math.cos(a)*radius*0.4,f.y+Math.sin(a)*radius*0.4);flame(ctx,p.x,p.y-u*(i%3),u*0.22,u*(1+hash(i)),time,i);}
  }else if(f.f==='flameField'){
    for(let i=0;i<count;i++){const p=worldPoint(i);flame(ctx,p.x,p.y,u*(0.2+hash(i)*0.2),u*(1+hash(i+5)*1.6),time,i);}
  }else if(['fireRain','fireArrowRain'].includes(f.f)){
    for(let i=0;i<count;i++){const p=worldPoint(i),phase=(age/700+hash(i*13))%1,yy=p.y-(1-phase)*u*7;
      ctx.globalAlpha=fade*(0.4+phase*0.6);flame(ctx,p.x,yy,u*0.22,u*0.95,time,i);
      if(f.f==='fireArrowRain'){path(ctx,[{x:p.x+u*0.18,y:yy-u*1.1},{x:p.x,y:yy}],'#ffe0a4',1.5);shard(ctx,{x:p.x,y:yy},u*0.14,u*0.27,'#ffe0a4',Math.PI);}
      if(phase>0.8)flame(ctx,p.x,p.y,u*0.3,u*0.6,time,i);
    }
  }else if(['iceRain','bloodRain','stoneRain','shadowRain','lightRain','windRain'].includes(f.f)){
    for(let i=0;i<count;i++){const p=worldPoint(i),phase=(age/780+hash(i*13))%1,height=(1-phase)*u*5.5;ctx.globalAlpha=fade*(0.25+phase*0.65);
      if(f.f==='stoneRain'){const rr=u*0.24;ctx.fillStyle=col;ctx.beginPath();for(let j=0;j<6;j++){const a=j*TAU/6+phase;const x=p.x+Math.cos(a)*rr,y=p.y-height+Math.sin(a)*rr;j?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();ctx.fill();}
      else shard(ctx,{x:p.x,y:p.y-height},u*0.12,u*(f.f==='iceRain'?0.65:0.45),col,-0.14);
      path(ctx,[{x:p.x,y:p.y-height-u*0.1},{x:p.x+2,y:p.y-height-u*0.48}],col+'55',0.8);
      if(phase>0.85){ctx.strokeStyle=col+'77';ctx.beginPath();ctx.ellipse(p.x,p.y,u*0.2*phase,u*0.08*phase,0,0,TAU);ctx.stroke();}
    }
  }else if(['iceSpikes','earthSpikes','bloodSpikes','shadowSpikes','lightSpikes','windSpikes','teslaSpikes'].includes(f.f)){
    const grow=Math.min(1,age/170);let last=null;for(let i=0;i<count;i++){const p=worldPoint(i),h=u*(0.6+hash(i)*1.1)*grow;
      if(f.f==='windSpikes')drawVortex(ctx,p.x,p.y,u*0.6,h,time+i*90,col,fade);
      else shard(ctx,p,u*(0.1+hash(i+3)*0.12),h,col,(hash(i+7)-0.5)*0.22);
      if(f.f==='teslaSpikes'&&last){const top={x:p.x,y:p.y-h};path(ctx,[last,{x:(last.x+top.x)/2+Math.sin(time/50+i)*u*0.2,y:(last.y+top.y)/2-u*0.2},top],col,1.2);last=top;}else last={x:p.x,y:p.y-h};
    }
  }else if(f.f==='roots'){
    for(let i=0;i<9;i++){const p=worldPoint(i),phase=time/750+i;const points=Array.from({length:9},(_,j)=>({x:p.x+Math.sin(j*0.7+phase)*u*0.4,y:p.y-j*u*0.18}));path(ctx,points,'#735238',Math.max(1.5,u*0.13));path(ctx,points,col,Math.max(0.7,u*0.05));for(let j=2;j<8;j+=2){ctx.fillStyle=col;ctx.beginPath();ctx.ellipse(points[j].x+u*0.06,points[j].y,u*0.17,u*0.07,phase,0,TAU);ctx.fill();}}
  }else if(['thunderstorm','lightningStrike'].includes(f.f)){
    ctx.globalAlpha=fade*0.17;ctx.fillStyle='#889bab';for(let i=0;i<5;i++){ctx.beginPath();ctx.ellipse(c.x+(i-2)*rx*0.2,c.y-u*5.2,rx*0.28,u*0.5,0,0,TAU);ctx.fill();}
    const frame=Math.floor(age/190);for(let i=0;i<3;i++){const p=worldPoint(i+frame*3);const flash=0.35+0.65*(1-(age/190)%1);ctx.globalAlpha=fade*flash;const pts=Array.from({length:9},(_,j)=>({x:p.x+(j===8?0:(hash(j+i*17+frame)-0.5)*u*0.5),y:p.y-u*5.5*(1-j/8)}));path(ctx,pts,col,3*r.zoom);path(ctx,pts,'#f2fbff',Math.max(0.8,r.zoom));ctx.beginPath();ctx.ellipse(p.x,p.y,u*0.35,u*0.13,0,0,TAU);ctx.stroke();}
  }
  ctx.restore();
}
export function drawElementalProjectile(r,p,head,tail,time){
  const ctx=r.ctx,u=r.hh*0.9,a=Math.atan2(head.y-tail.y,head.x-tail.x);
  if(p.f==='umbraBolt'){path(ctx,[tail,head],'#202733aa',Math.max(3,r.zoom*4));shard(ctx,head,u*.18,u*.8,'#788faa',a+Math.PI/2);ctx.fillStyle='#eef6ff';ctx.beginPath();ctx.arc(head.x,head.y,Math.max(1.2,u*0.05),0,TAU);ctx.fill();return true;}
  if(p.f==='sunRay'){
    path(ctx,[tail,head],'#ffdfa388',Math.max(5,r.zoom*5));path(ctx,[tail,head],'#fff7c4',Math.max(1.6,r.zoom*2.2));
    ctx.save();ctx.translate(head.x,head.y);ctx.rotate(time/300);path(ctx,[{x:-u*0.3,y:0},{x:u*0.3,y:0}],'#fff7d3',1.5);path(ctx,[{x:0,y:-u*0.3},{x:0,y:u*0.3}],'#fff7d3',1.5);ctx.restore();return true;
  }
  if(p.f==='fireArrow'){
    ctx.save();ctx.translate(head.x,head.y);ctx.rotate(a);path(ctx,[{x:-u*1.15,y:0},{x:0,y:0}],'#ffe0a4',Math.max(1,r.zoom));shard(ctx,{x:0,y:0},u*0.14,u*0.3,'#ffdf99',Math.PI/2);
    for(let i=0;i<3;i++)flame(ctx,-u*(0.3+i*0.25),0,u*0.12,u*(0.4+i*0.15),time,i);ctx.restore();return true;
  }
  if(['icicle','bloodSpike'].includes(p.f)){const col=p.f==='icicle'?'#9edcf3':'#ed7188';path(ctx,[tail,head],col+'99',Math.max(1,r.zoom));shard(ctx,head,u*0.16,u*0.9,col,a+Math.PI/2);return true;}
  if(p.f==='boulder'){ctx.save();ctx.translate(head.x,head.y);ctx.rotate(time/180);ctx.fillStyle='#a58c70';ctx.strokeStyle='#ded0ac';ctx.lineWidth=1;ctx.beginPath();for(let i=0;i<7;i++){const a=i*TAU/7,rr=u*(0.3+hash(i)*0.15);i?ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr):ctx.moveTo(Math.cos(a)*rr,Math.sin(a)*rr);}ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();return true;}
  if(['vortex','shadowVortex'].includes(p.f)){drawVortex(ctx,head.x,head.y+u*0.35,u*0.42,u*0.85,time,p.f==='vortex'?'#c4e7ef':'#a182d6',0.85);return true;}
  if(p.f==='tesla'){const dx=head.x-tail.x,dy=head.y-tail.y,pts=Array.from({length:7},(_,i)=>({x:tail.x+dx*i/6,y:tail.y+dy*i/6+(i===0||i===6?0:Math.sin(i*4+time/60)*u*0.1)}));path(ctx,pts,'#8ac9ff',Math.max(2,r.zoom*2));path(ctx,pts,'#f1faff',0.8);return true;}
  return false;
}

export function drawCharacterStatus(r,actor,time,height=3.3){
  if(!actor||actor.dead||actor.deadAt||r.fog&&!r.fog.see(actor.x,actor.y))return;
  const frozen=actor.frozenUntil>time,ice=actor.iceRootUntil>time,root=actor.rootUntil>time,burn=actor.burnUntil>time;if(!frozen&&!ice&&!root&&!burn)return;
  const ctx=r.ctx,p=r.toScreen(actor.x,actor.y),u=r.hh*0.9,h=u*(frozen?height:0.75),w=u*(frozen?0.55:0.48);
  ctx.save();
  if(burn)for(let i=0;i<5;i++)flame(ctx,p.x+(hash(i+4)-0.5)*u*0.9,p.y-u*(i%3)*0.65,u*0.18,u*(0.7+hash(i)*0.7),time,i);
  if(frozen||ice){const g=ctx.createLinearGradient(p.x-w,p.y-h,p.x+w,p.y);g.addColorStop(0,'#d9fbff44');g.addColorStop(0.35,'#72cbec22');g.addColorStop(0.65,'#c8faff66');g.addColorStop(1,'#64bcd936');ctx.fillStyle=g;ctx.strokeStyle='#b9f0ffcc';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(p.x-w,p.y-h*0.15);ctx.lineTo(p.x-w*0.8,p.y-h*0.82);ctx.lineTo(p.x-w*0.2,p.y-h*1.05);ctx.lineTo(p.x+w*0.65,p.y-h);ctx.lineTo(p.x+w,p.y-h*0.22);ctx.lineTo(p.x+w*0.5,p.y+u*0.08);ctx.lineTo(p.x-w*0.45,p.y+u*0.08);ctx.closePath();ctx.fill();ctx.stroke();
    path(ctx,[{x:p.x-w*0.2,y:p.y-h*1.05},{x:p.x+w*0.3,y:p.y-h*0.53},{x:p.x-w*0.45,y:p.y+u*0.08}],'#baf6ff77',0.8);
  }else if(root){
    for(let i=0;i<3;i++){const a=i*TAU/3+time/1200,pts=Array.from({length:10},(_,j)=>({x:p.x+Math.cos(a+j*0.5)*w,y:p.y-j*h/10+Math.sin(a+j*0.5)*u*0.08}));path(ctx,pts,'#715032',2);path(ctx,pts,'#a3c687',0.75);}
  }
  ctx.restore();
}
