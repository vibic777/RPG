// A small bounded particle system: no allocations retained between frames.
const TAU=Math.PI*2;
const COLORS={shadow:'#788faa',water:'#72d5ff',air:'#b6edff',earth:'#ccb078',blood:'#ee6685',dark:'#a27cdd',arcane:'#c5a0ff',light:'#fff0a0',fire:'#ffa054',plasma:'#ff93dc',electricity:'#91c9ff',tesla:'#9ac7ff',ion:'#9effc8',laser:'#66edff'};
export function drawEquipmentAura(ctx,item,x,y,radius,time=0,angle=0,length=0) {
  if(!item)return;
  const types=[item.school,item.material].filter((t,i,a)=>COLORS[t]&&a.indexOf(t)===i);
  if(!types.length)return;
  ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.lineCap='round';ctx.lineJoin='round';
  const low=window.GameSettings?.graphicsQuality==='low',count=low?4:6;
  const r=Math.max(3,radius),span=Math.max(r*0.4,length);
  for(const type of types){const ink=COLORS[type],phase=time/(type==='tesla'?75:650);
    ctx.strokeStyle=ink;ctx.fillStyle=ink;ctx.lineWidth=Math.max(0.7,r*0.055);
    if(type==='tesla'||type==='electricity'){
      ctx.globalAlpha=0.8;
      for(const side of [-1,1]){ctx.beginPath();for(let i=0;i<9;i++){const q=i/8,bend=Math.sin(i*7.3+Math.floor(phase)*2.7)*r*0.22;const px=-span*0.5+q*span,py=side*r*0.35+(i===0||i===8?0:bend);i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.stroke();}
      ctx.globalAlpha=0.9;ctx.strokeStyle='#eff9ff';ctx.lineWidth=0.6;ctx.beginPath();ctx.moveTo(-span*0.45,0);ctx.lineTo(span*0.45,0);ctx.stroke();
    }else if(['water','air','blood','dark','shadow'].includes(type)){
      for(let j=0;j<2;j++){ctx.globalAlpha=0.27+j*0.2;ctx.beginPath();for(let i=0;i<=24;i++){const q=i/24,a=q*TAU*1.6+phase+j*Math.PI,px=(q-0.5)*span+Math.cos(a)*r*0.27,py=Math.sin(a)*r*(0.38+j*0.12);i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.stroke();}
    }else if(type!=='earth'){
      ctx.globalAlpha=0.18;ctx.beginPath();ctx.ellipse(0,0,Math.max(r*0.8,span*0.5),r*0.58,0,0,TAU);ctx.stroke();
    }
    for(let i=0;i<count;i++){
      const a=phase+i*TAU/count,px=Math.cos(a)*(span*0.5+r*0.2),py=Math.sin(a)*r*0.65,z=Math.sin(a*1.7+i)*r*0.2;
      ctx.globalAlpha=0.4+(Math.sin(a)+1)*0.22;
      if(type==='earth') {ctx.beginPath();ctx.moveTo(px-r*0.12,py);ctx.lineTo(px,py-r*0.15);ctx.lineTo(px+r*0.12,py-r*0.02);ctx.lineTo(px+r*0.07,py+r*0.1);ctx.closePath();ctx.fill();ctx.strokeStyle='#ede2bd';ctx.stroke();ctx.strokeStyle=ink;}
      else if(type==='water'||type==='blood') {ctx.beginPath();ctx.moveTo(px,py-r*0.13);ctx.bezierCurveTo(px+r*0.15,py,px+r*0.1,py+r*0.13,px,py+r*0.13);ctx.bezierCurveTo(px-r*0.1,py+r*0.13,px-r*0.15,py,px,py-r*0.13);ctx.fill();}
      else {ctx.beginPath();ctx.ellipse(px,py+z,r*(type==='plasma'?0.13:0.055),r*(type==='plasma'?0.09:0.055),a,0,TAU);ctx.fill();}
    }
  }
  ctx.restore();
}
