import { isoRig, tone, shadow } from './figure-art.js';
import { drawVehicleModel } from './vehicle-art.js';
import { meshRig, M_TO_UNIT } from './mesh-art.js';
const TAU=Math.PI*2;
const random=(seed)=>{let a=seed|0;return()=>{a|=0;a=a+0x6d2b79f5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};};
export function drawScenery(ctx,key,x,y,unit,variant=0.5) {
  const rand=random(Math.floor(variant*1e6)+17),rig=isoRig(ctx,x,y,unit,0);
  const {line,polygon,volume,ellipse,box}=rig;
  if(key==='node_tree')key='tree_oak';if(key==='node_rock')key='boulder';if(key==='node_ruin')key='ruin_block';
  const blob=(cx,cy,rx,ry,col)=>{
    const g=ctx.createLinearGradient(cx-rx,cy-ry,cx+rx,cy+ry);g.addColorStop(0,tone(col,0.2));g.addColorStop(0.45,col);g.addColorStop(1,tone(col,-0.3));
    const points=Array.from({length:32},(_,i)=>{const a=i*TAU/32,k=.91+rand()*.14;return[cx+Math.cos(a)*rx*k,cy+Math.sin(a)*ry*k];});
    ctx.fillStyle=g;ctx.beginPath();const last=points.at(-1),first=points[0];ctx.moveTo((last[0]+first[0])/2,(last[1]+first[1])/2);
    points.forEach((p,i)=>{const q=points[(i+1)%points.length];ctx.quadraticCurveTo(p[0],p[1],(p[0]+q[0])/2,(p[1]+q[1])/2);});ctx.closePath();ctx.fill();
  };
  ctx.save();
  // Гранёный ком (крона, валун): два пояса вершин с разбросом радиуса и полюса
  const gem=(g,c,r,col,n=6)=>{const vs=[[c[0],c[1],c[2]+r[2]],[c[0],c[1],c[2]-r[2]*0.8]],ps=[];
    for(const [lat,ph] of [[0.45,0],[-0.4,0.5]])for(let i=0;i<n;i++){const t=(i+ph)/n*TAU,k=0.85+rand()*0.3;vs.push([c[0]+Math.cos(t)*Math.cos(lat)*r[0]*k,c[1]+Math.sin(t)*Math.cos(lat)*r[1]*k,c[2]+Math.sin(lat)*r[2]]);}
    for(let i=0;i<n;i++){const j=(i+1)%n;ps.push([0,2+i,2+j],[1,2+n+j,2+n+i],[2+i,2+n+i,2+j],[2+j,2+n+i,2+n+j]);}
    g.solid(vs,ps,(k)=>tone(col,(rand()-0.5)*0.1));};
  if(key.startsWith('tree_')){
    const pine=key==='tree_pine',dead=key==='tree_dead',twisted=key==='tree_twisted',height=6.4+variant*3.8;
    const bark=dead?'#756351':'#6c5035', crown=twisted?'#425e65':pine?'#304c3e':'#49603b';
    shadow(ctx,x+unit*0.22,y,unit,pine?1.1:1.6,0.42);
    // Дерево — модель (художественный проход): ствол и ветви гранёными конусами, крона — гранёные комья / ярусы хвои
    const g=meshRig(ctx,x,y,unit/M_TO_UNIT,0,1),root=0.2+variant*0.07,lean=(rand()-0.5)*0.3;
    const top=[lean,0,height*(pine?0.92:dead?0.8:0.55)];
    if(twisted){let p=[0,0,0];for(let i=1;i<=4;i++){const q=[Math.sin(i*1.7+variant*5)*0.35,Math.cos(i*1.3)*0.25,top[2]*i/4];g.tube(p,q,root*(1-(i-1)*0.18),root*(1-i*0.18),tone(bark,i%2?-0.05:0.03),7);p=q;}top[0]=p[0];top[1]=p[1];}
    else g.tube([0,0,0],top,root,pine?0.05:root*0.55,bark,7);
    for(let i=0;i<3;i++){const a=i/3*TAU+variant*4;g.tube([Math.cos(a)*root*0.5,Math.sin(a)*root*0.5,0.35],[Math.cos(a)*root*2.6,Math.sin(a)*root*2.6,0],root*0.45,0.04,tone(bark,-0.1),5);}
    if(!pine){const nb=dead?7:4;for(let i=0;i<nb;i++){const a=i/nb*TAU+rand(),z=top[2]*(dead?0.45+i*0.07:0.75+rand()*0.2),len=(dead?2.1:1.6)*(0.7+rand()*0.5),from=[top[0]*z/top[2],top[1]*z/top[2],z],mid=[from[0]+Math.cos(a)*len*0.6,from[1]+Math.sin(a)*len*0.6,z+len*0.45],end=[from[0]+Math.cos(a)*len,from[1]+Math.sin(a)*len,z+len*(dead?1.1:0.9)];
      g.tube(from,mid,root*0.4,root*0.25,tone(bark,0.05),5);g.tube(mid,end,root*0.25,0.02,tone(bark,0.05),5);if(dead)g.tube(mid,[mid[0]-Math.sin(a)*0.4,mid[1]+Math.cos(a)*0.4,mid[2]+0.5],0.05,0.01,bark,4);}}
    if(!pine)g.flush();
    if(!dead){
      if(pine){for(let tier=0;tier<5;tier++){const z0=height*(0.2+tier*0.15),r=1.75*(1-tier*0.16)*(0.9+rand()*0.2);g.tube([lean*z0/top[2],0,z0],[lean*(z0+height*0.3)/top[2],0,z0+height*(0.3-tier*0.02)],r,0.03,tone(crown,tier*0.03),8);}}
      else{const lumps=[[0,0,height*0.74,1.9],...Array.from({length:7},(_,i)=>{const a=i/7*TAU+rand()*0.6,d=1.2+rand()*0.6;return [Math.cos(a)*d,Math.sin(a)*d*0.85,height*(0.55+rand()*0.22),1.15+rand()*0.5];}),[0.1,0.05,height*0.93,1.3]];
        for(const [lx,ly,lz,r] of lumps){const p=rig.project([top[0]+lx,top[1]+ly,lz]);blob(p[0],p[1],r*unit*.95,r*unit*.65,tone(crown,(lx+ly>0?-.09:.04)));}}
    }
    if(pine)g.flush();
    if(twisted){ctx.fillStyle='#a0dace';for(let i=0;i<8;i++){ctx.beginPath();ctx.arc(x+(rand()-0.5)*unit*2,y-height*unit*(0.6+rand()*0.3),Math.max(0.7,unit*0.025),0,TAU);ctx.fill();}}
    if(!dead&&!pine){for(let i=0;i<70;i++){
      const lx=(rand()-.5)*4.8,ly=(rand()-.5)*3.5,lz=height*(.55+rand()*.37);
      const p=rig.project([top[0]+lx,ly,lz]);ctx.fillStyle=i%3?'#526a41':'#7b8754';ctx.beginPath();ctx.ellipse(p[0],p[1],unit*(.045+rand()*.065),unit*.04,0,0,TAU);ctx.fill();
    }}
    for(let i=0;i<9;i++){const xx=(rand()-0.5)*1.1;line([[xx,0,0],[xx-0.05,0,0.15+rand()*0.2]],'#536343',0.014);}
  }else if(['peak','boulder','mound','stalagmite'].includes(key)){
    const peak=key==='peak',stal=key==='stalagmite',h=peak?5+variant*3:stal?2.5+variant*2:0.5+variant*0.7,w=peak?3.2:stal?0.23:0.65,col=key==='mound'?'#80745b':'#797b79';
    shadow(ctx,x,y,unit,w,0.25);
    // Гранёный камень из модели (художественный проход): неровные сечения, свет сверху-слева
    const g=meshRig(ctx,x,y,unit/M_TO_UNIT,0,1),n=24,rad=Array.from({length:n},()=>0.75+rand()*0.4),tw=rand()*0.6;
    const ring=(k,z,dx)=>Array.from({length:n},(_,i)=>{const a=i*TAU/n+tw*k;return [dx+Math.cos(a)*w*rad[i]*(1-k*(peak?0.6:0.35)),Math.sin(a)*w*0.75*rad[(i+Math.round(k*2))%n]*(1-k*(peak?0.6:0.35)),z];});
    const secs=[ring(0,0,0),ring(stal?0.6:0.5,h*(stal?0.3:0.45),-w*0.05),ring(stal?1.5:1,h*(stal?0.75:0.8),-w*0.1)];
    // лофт по z: сечения — кольца точек; грани между соседними кольцами, верх — маленькая шапка
    const verts=[...secs.flat(),[-w*0.12,0,h]],polys=[secs[0].map((_,i)=>i)],T=verts.length-1;
    for(let k=0;k+1<secs.length;k++)for(let i=0;i<n;i++){const j=(i+1)%n;polys.push([k*n+i,k*n+j,(k+1)*n+j,(k+1)*n+i]);}
    for(let i=0;i<n;i++)polys.push([(secs.length-1)*n+i,(secs.length-1)*n+(i+1)%n,T]);
    g.solid(verts,polys,col,{smooth:true,noEdge:true});
    g.flush();
    for(let i=0;i<6;i++){const yy=(rand()-0.5)*w*0.6,zz=h*(0.1+rand()*0.6);line([[-w*0.1,yy,zz],[-w*(0.18+rand()*0.38),yy,zz-h*0.11]],tone(col,-0.2),0.018);}
  }else if(['ruin_block','wall_block','settlement','depot','rubble'].includes(key)){
    const ruin=key==='ruin_block',rubble=key==='rubble',wall=key==='wall_block',house=key==='settlement';
    const height=wall?4.6:house?4.8:3.8+variant*3.1,w=wall?2.55:3.4,length=wall?2.55:2.8;
    const masonry=key==='depot'?'#626b65':house?'#b6aa8a':'#827f73';
    shadow(ctx,x,y,unit,wall?1.25:2,0.48);
    if(rubble){for(let i=0;i<8;i++)box((rand()-0.5)*1.7,(rand()-0.5)*1.2,0,0.18+rand()*0.4,0.2+rand()*0.45,0.15+rand()*0.4,['#74756c','#8a7d6d','#625f56'][i%3]);}
    else{
      // Объём стен — модель с плоским светом; у руин три простенка разной высоты (обрушенный верх)
      const g=meshRig(ctx,x,y,unit/M_TO_UNIT,0,1),cols=ruin?[0.62+rand()*0.38,0.45+rand()*0.4,0.75+rand()*0.25].map(k=>height*k):[height,height,height];
      if(ruin)cols.forEach((hc,i)=>g.box(-w/2+w*(i+0.5)/3,0,0,w/3+0.001,length,hc,tone(masonry,(i-1)*0.02)));
      else g.box(0,0,0,w,length,height,masonry);
      g.box(0,0,0,w+0.12,length+0.12,0.35,tone(masonry,-0.18)); // цоколь
      // Vegetation reclaims foundations; stains and repair sheets keep inhabited ruins readable.
      for(let i=0;i<5;i++){
        const xx=-w/2+(i+0.5)*w/5;
        g.box(xx,length/2+0.025,0.35,0.18+rand()*0.16,0.035,0.35+rand()*0.5,'#687354');
        if(i%2===0) g.box(xx,length/2+0.05,height*0.35,0.3,0.035,0.5,'#6c6052');
      }
      g.flush();
      for(let i=0;i<10;i++){const xx=(rand()-0.5)*(w+0.7),yy=length/2+rand()*0.45;line([[xx,yy,0],[xx+0.08,yy,0.2+rand()*0.35]],'#687b4e',0.025);}
      const low=Math.min(...cols),colOf=(xx)=>cols[Math.max(0,Math.min(2,Math.floor((xx+w/2)/(w/3))))];
      // Only the two camera-facing walls receive windows and mortar details.
      for(let row=0;row<Math.floor(height/0.65);row++){
        const z=0.22+row*0.65;if(z>low-0.05)continue;line([[-w/2,length/2,z],[w/2,length/2,z]],tone(masonry,-0.12),0.016);
        for(let j=0;j<5;j++){const xx=-w/2+(j+(row%2)*0.5)*w/4;if(xx<w/2)line([[xx,length/2,z],[xx,length/2,z+0.6]],tone(masonry,-0.08),0.012);}
      }
      if(!wall){
        for(let row=0;row<Math.floor(height/2);row++)for(let col=0;col<3;col++){
          const xx=-w*0.35+col*w*0.35,z=1.1+row*2,yy=length/2+0.015;if(z+0.8>colOf(xx))continue;
          polygon([[xx-0.23,yy,z],[xx+0.23,yy,z],[xx+0.23,yy,z+0.7],[xx-0.23,yy,z+0.7]],ruin?'#273638':'#415f6b');
          line([[xx-0.24,yy,z],[xx+0.24,yy,z]],'#c1b99e',0.055);line([[xx,yy,z],[xx,yy,z+0.7]],tone(masonry,0.1),0.025);
          if(house)line([[xx-0.23,yy,z+0.35],[xx+0.23,yy,z+0.35]],tone(masonry,0.2),0.023);
        }
        box(w/2+0.01,-0.1,0,0.035,0.65,1.8,'#3c3b32');line([[w/2+0.03,-0.1,0],[w/2+0.03,-0.1,1.8]],'#78634a',0.04);
      }
      if(ruin){
        {const gr=meshRig(ctx,x,y,unit/M_TO_UNIT,0,1);for(let i=0;i<8;i++){const xx=(rand()-0.5)*w*0.9;gr.box(xx,(rand()-0.5)*length*0.8,colOf(xx),0.18+rand()*0.2,0.18+rand()*0.2,0.05+rand()*0.4,tone(masonry,-0.15));}
        for(let i=0;i<6;i++)gr.box(w/2+0.3+rand()*0.6,(rand()-0.5)*length,0,0.2+rand()*0.3,0.2+rand()*0.3,0.1+rand()*0.25,tone(masonry,-0.1-rand()*0.1));gr.flush();}
        line([[w/2,0.5,height*0.87],[w/2,0.3,height*0.58],[w/2,0.55,height*0.4],[w/2,0.25,0.25]],'#51554e',0.024);
        for(let i=0;i<8;i++)ellipse([w/2+0.01,(rand()-0.5)*length*0.8,rand()*height*0.5],0.07,0.15,'#4d6145');
      }else if(house){
        const ridge=height+1.4,gr=meshRig(ctx,x,y,unit/M_TO_UNIT,0,1),roof='#7a5148';
        gr.loft([{y:-length/2-0.25,pts:[[-w/2-0.25,height-0.05],[w/2+0.25,height-0.05],[0,ridge]]},{y:length/2+0.25,pts:[[-w/2-0.25,height-0.05],[w/2+0.25,height-0.05],[0,ridge]]}],roof);
        gr.box(-0.65,0.55,height+0.45,0.4,0.4,1.35,'#91816b');gr.box(-0.65,0.55,height+1.8,0.5,0.5,0.1,'#6f6352');
        gr.flush();
        for(let i=1;i<6;i++){const xx=(w/2+0.25)*i/6,z=ridge-(ridge-height+0.05)*i/6;line([[xx,-length/2-0.25,z],[xx,length/2+0.25,z]],tone(roof,-0.18),0.022);}
      }else if(!wall){
        box(0,0,height+0.02,w*0.92,length*0.9,0.08,tone(masonry,-0.12));box(-w*0.3,0.5,height+0.1,0.5,0.55,0.45,'#59676a');
      }
    }
  }else if(key==='rusted_car'){
    drawVehicleModel(ctx,{id:'car',kind:'land',radius:0.6,color:'#825945'},{wreck:true},x,y,unit*0.9/1.1,Math.floor(variant*8)*Math.PI/4,0);
  }else if(key==='cactus'){
    // Сагуаро: гранёный ствол и руки с округлыми верхушками, рёбра и колючки
    const h=1.7+variant*0.9,col='#637859',g=meshRig(ctx,x,y,unit/M_TO_UNIT,0,1);shadow(ctx,x,y,unit,0.35,0.13);
    g.tube([0,0,0],[0,0,h],0.2,0.18,col,8);gem(g,[0,0,h],[0.18,0.18,0.12],col,8);
    for(const side of [-1,1]){const z=h*(side<0?0.42:0.55),top=h*(side<0?0.75:0.88),dx=side*0.36;g.tube([0,0,z],[dx,0,z],0.11,0.11,tone(col,side<0?0.06:-0.08),7);g.tube([dx,0,z-0.05],[dx,0,top],0.11,0.1,tone(col,side<0?0.06:-0.08),7);gem(g,[dx,0,top],[0.1,0.1,0.08],tone(col,side<0?0.06:-0.08),7);}
    g.flush();
    for(let i=0;i<4;i++)line([[-0.14+i*0.09,0.17,0.05],[-0.13+i*0.085,0.15,h-0.05]],tone(col,-0.18),0.01);
    for(let i=0;i<10;i++)line([[-0.04,0.18,i*h/10],[0.02,0.25,i*h/10+0.03]],'#d8d2b8',0.012);
    if(variant>0.6)ellipse([0,0.05,h+0.12],0.07,0.05,'#e8d36a');
  }else if(key==='barrel'){
    shadow(ctx,x,y,unit,0.28,0.1);{const g=meshRig(ctx,x,y,unit/M_TO_UNIT,0,1);g.tube([0,0,0],[0,0,0.4],0.2,0.22,'#795b43',12);g.tube([0,0,0.4],[0,0,0.77],0.22,0.2,'#795b43',12);for(const z of [0.1,0.62])g.tube([0,0,z],[0,0,z+0.04],0.225,0.225,'#3f4a47',12);g.flush();}ellipse([0,0,0.77],0.24,0.12,'#7a6e57');for(const z of [0.12,0.58])line([[-0.24,0,z],[0,0.25,z],[0.24,0,z]],'#3f4a47',0.035);ellipse([0.07,0,0.79],0.05,0.025,'#b0bd73');
  }else if(key==='crate'||key==='vent'){
    const vent=key==='vent';shadow(ctx,x,y,unit,0.43,0.14);{const g=meshRig(ctx,x,y,unit/M_TO_UNIT,0,1);g.box(0,0,0,0.68,0.62,vent?0.45:0.58,vent?'#7c8788':'#8d7452');if(!vent)for(const z of [0,0.52])g.box(0,0,z,0.7,0.64,0.06,'#6e5a3f');g.flush();}
    if(vent){for(let i=0;i<5;i++)line([[-0.24,-0.2+i*0.1,0.46],[0.24,-0.2+i*0.1,0.46]],'#38464c',0.024);}
    else{for(const z of [0.08,0.48])line([[-0.35,0,z],[0,0.32,z],[0.35,0,z]],'#50483c',0.03);line([[-0.35,0,0.08],[0,0.32,0.48]],'#b1996e',0.06);}
  }else if(key==='tire'){
    volume([0,0,0.1],0.35,0.3,0.15,'#2e3435');ellipse([0,0,0.2],0.13,0.065,'#5b5b4e');for(let i=0;i<10;i++){const a=i*TAU/10;line([[Math.cos(a)*0.27,Math.sin(a)*0.24,0.2],[Math.cos(a)*0.34,Math.sin(a)*0.29,0.1]],'#545650',0.02);}
  }else if(key==='mushroom'||key==='cocoon'){
    if(key==='cocoon'){volume([0,0,0.58],0.25,0.24,0.58,'#766975');for(let i=0;i<7;i++)line([[-0.2,0,0.14+i*0.13],[0,0.24,0.2+i*0.13],[0.2,0,0.22+i*0.13]],'#afa999',0.016);}
    else{line([[0,0,0],[0,0,0.65]],'#b4b9a3',0.06);volume([0,0,0.67],0.32,0.3,0.15,variant>0.5?'#8ea698':'#9585a5');for(let i=0;i<5;i++)ellipse([(rand()-0.5)*0.34,(rand()-0.5)*0.25,0.79],0.03,0.018,'#c5e1d2');}
  }else if(key==='bones'||key==='shell'){
    if(key==='bones'){for(let i=0;i<4;i++)line([[(rand()-0.5)*0.7,-0.2+rand()*0.4,0.02],[(rand()-0.5)*0.7,-0.2+rand()*0.4,0.06]],'#b8b19c',0.045);volume([0.29,0.1,0.13],0.12,0.16,0.12,'#d1c9b1');ellipse([0.27,0.22,0.15],0.025,0.027,'#454841');}
    else{volume([0,0,0.12],0.26,0.23,0.15,'#b7ae8e');for(let i=0;i<6;i++)line([[0,-0.12,0.07],[(i-2.5)*0.065,0.18,0.19]],'#8f886f',0.018);}
  }else if(key==='dune'){
    volume([0,0,0.06],0.9,0.65,0.17,'#b7a176');line([[-0.66,0,0.12],[-0.12,-0.14,0.23],[0.6,0.04,0.1]],'#dac59d',0.025);
  }else if(key==='kelp'){
    for(let i=0;i<5;i++){const xx=(i-2)*0.11;const pts=Array.from({length:6},(_,j)=>[xx+Math.sin(j*1.2+i)*0.07,0,j*0.23]);line(pts,tone('#556f54',i*0.025),0.05);for(let j=1;j<5;j++)polygon([pts[j],[pts[j][0]+(j%2?1:-1)*0.12,0,pts[j][2]+0.14],pts[j+1]],'#617b57');}
  }else if(key==='cloud'){
    ctx.globalAlpha*=0.33;for(let i=0;i<7;i++)blob(x+(i-3)*unit*0.24,y-unit*(0.7+Math.sin(i)*0.08),unit*0.4,unit*0.19,'#ced9dc');
  }else if(key==='portal'||key==='lair'){
    for(let i=0;i<7;i++){const a=Math.PI+i*Math.PI/6;volume([Math.cos(a)*0.4,0,0.1-Math.sin(a)*0.85],0.16,0.16,0.18,'#646d67');}ellipse([0,0.02,0.36],0.27,0.38,key==='portal'?'#4b737e':'#202d2b');
  }else{ctx.restore();return false;}
  ctx.restore();return true;
}

// ---------- Дома с интерьерами (shared/houses.js) ----------
// Фасад повторяет дом изнутри: рядов окон столько же, сколько этажей (house.floors), над ними — крыша;
// есть подвал — у цоколя полуподвальные окошки. Дверь — на лицевой стене (к камере, сторона +y), перед ней клетка входа.
// Возвращает раскладку { rows, roofZ, windows, basementWindows } — её проверяют тесты фасада.
export const HOUSE_FLOOR_H=1.7;
export const HOUSE_FLOOR_METERS=3;
export function drawHouse(ctx,house,x,y,unit){
  const H=window.Houses,f=H.facade(house),rand=random(Math.floor(house.variant*1e6)+house.floors*7919);
  const condition=house.condition||'intact',visualFloors=house.floors;
  const hasFireEscape=house.variant<0.24&&condition!=='ruined';
  const w=3.3,length=2.9,fh=HOUSE_FLOOR_H,top=visualFloors*fh+0.3,col=tone(f.color,(house.variant-0.5)*0.12+(condition==='weathered'?-0.1:condition==='damaged'?-0.2:condition==='ruined'?-0.28:0));
  // Local x points along world y; local y points along world x.
  const heading=house.heading||0,swapped=Math.abs(Math.sin(heading))>.5;
  const tileUnits=2/(1.1*.78),heightScale=HOUSE_FLOOR_METERS*(3.3/1.75)*.9/(1.1*HOUSE_FLOOR_H),plan=house.footprint||{w:5,h:5};
  const scale=[(swapped?plan.w:plan.h)*tileUnits/w,(swapped?plan.h:plan.w)*tileUnits/length,heightScale];
  const rig=isoRig(ctx,x,y,unit,heading,scale);
  const frontVisible=Math.cos(heading)+Math.sin(heading)>1e-6,sideVisible=Math.cos(heading)-Math.sin(heading)>1e-6;
  const visible=points=>points.every(p=>p[0]>=w/2-.001)?sideVisible:frontVisible;
  const line=(points,...args)=>{if(visible(points))rig.line(points,...args);};
  const polygon=(points,...args)=>{if(visible(points))rig.polygon(points,...args);};
  const ellipse=(point,...args)=>{if(visible([point]))rig.ellipse(point,...args);};
  const out={rows:0,roofZ:house.floors,windows:0,basementWindows:0,rowZ:[]};
  ctx.save();
  shadow(ctx,x,y,unit,2.1,0.5);
  const g=meshRig(ctx,x,y,unit/M_TO_UNIT,heading,1,'metal',scale);
  if(condition==='ruined'){
    g.box(-w*0.18,0,0,w*0.62,length,top,col);
    g.box(w*0.32,length*0.12,0,w*0.3,length*0.72,Math.min(top,fh*0.9),tone(col,-0.12));
  }else g.box(0,0,0,w,length,top,col);
  g.box(0,0,0,w+0.14,length+0.14,0.3,tone(col,-0.2)); // цоколь
  for(let r=1;r<visualFloors;r++)g.box(condition==='ruined'?-w*.18:0,0,r*fh+0.05,condition==='ruined'?w*.62:w+.06,length+.06,.07,tone(col,-.12)); // межэтажные пояса
  if(condition==='ruined'){g.box(-w*.18,0,top,w*.62,length,.1,tone(col,-.2));}
  else if(f.roof==='gable'){
    const ridge=top+1.3,roof=house.style==='farm'?'#6b4a3a':'#7a5148';
    g.loft([{y:-length/2-0.22,pts:[[-w/2-0.22,top-0.05],[w/2+0.22,top-0.05],[0,ridge]]},{y:length/2+0.22,pts:[[-w/2-0.22,top-0.05],[w/2+0.22,top-0.05],[0,ridge]]}],roof);
    g.box(-0.7,0.4,top+0.4,0.35,0.35,1.2,'#8b7b66');
  }else{
    g.box(0,0,top,w,length,0.08,tone(col,-0.25));
    for(const [px,py,pw,pl] of [[0,length/2,w,0.12],[0,-length/2,w,0.12],[-w/2,0,0.12,length]])g.box(px,py,top,pw,pl,0.28,tone(col,-0.08)); // парапет
    if(hasFireEscape){ // проход с крыши прямо к лестнице
      const gap=0.34, ladderY=-length*0.18;
      for(const [a,b] of [[-length/2,ladderY-gap/2],[ladderY+gap/2,length/2]])if(b>a)g.box(w/2,(a+b)/2,top,0.12,b-a,0.28,tone(col,-0.08));
    }else g.box(w/2,0,top,0.12,length,0.28,tone(col,-0.08));
    if(house.floors>=3)g.tube([-w*0.25,-length*0.15,top+0.08],[-w*0.25,-length*0.15,top+0.95],0.38,0.38,'#6f7470',10); // бак с водой
    g.box(w*0.22,length*0.12,top+0.08,0.5,0.4,0.35,'#5d6668'); // вентиляция
  }
  g.flush();
  const glass=house.style==='office'?'#5a7f8f':'#3d5560',frame=tone(col,0.25);
  const yy=length/2+0.015,xx=w/2+0.015;
  const frontMax=condition==='ruined'?w*.13:w*.5,sideExists=condition!=='ruined';
  for(let r=0;r<visualFloors;r++){
    const z=0.5+r*fh;out.rows++;out.rowZ.push(z);
    if(house.style==='office'){ // ленточное остекление: по полосе на этаж
      polygon([[-w*.44,yy,z],[Math.min(w*.44,frontMax),yy,z],[Math.min(w*.44,frontMax),yy,z+.85],[-w*.44,yy,z+.85]],glass);
      if(sideExists)polygon([[xx,-length*0.42,z],[xx,length*0.42,z],[xx,length*0.42,z+0.85],[xx,-length*0.42,z+0.85]],tone(glass,-0.1));
      for(let k=1;k<4;k++){const px=-w*0.44+k*w*0.22;if(px>frontMax)continue;line([[px,yy,z],[px,yy,z+0.85]],frame,0.03);}
      out.windows+=2;continue;
    }
    if(r===0&&house.style==='shop'){ // витрина магазина
      polygon([[-w*0.45,yy,0.4],[-w*0.12,yy,0.4],[-w*0.12,yy,1.3],[-w*0.45,yy,1.3]],'#6f8f94');
      if(sideExists)polygon([[w*0.12,yy,0.4],[w*0.45,yy,0.4],[w*0.45,yy,1.3],[w*0.12,yy,1.3]],'#6f8f94');
      polygon([[-w*0.46,yy,1.36],[Math.min(w*.46,frontMax),yy,1.36],[Math.min(w*.46,frontMax),yy+.25,1.6],[-w*0.46,yy+0.25,1.6]],rand()<0.5?'#8a3a32':'#3a5a7a'); // вывеска-козырёк
      out.windows+=2;
    }else{
      const n=f.windowsPerRow;
      for(let c=0;c<n;c++){
        const px=-w/2+(c+0.5)*w/n;
        if(px+.24>frontMax || r===0&&Math.abs(px)<.45)continue; // место двери
        const lit=rand()<0.18;
        polygon([[px-0.24,yy,z],[px+0.24,yy,z],[px+0.24,yy,z+0.75],[px-0.24,yy,z+0.75]],lit?'#b7a477':glass);
        line([[px-0.26,yy,z],[px+0.26,yy,z]],frame,0.05);line([[px,yy,z],[px,yy,z+0.75]],frame,0.02);
        if(r===0&&condition!=='intact')for(const b of [0.22,0.52])line([[px-0.25,yy+0.02,z+b],[px+0.25,yy+0.02,z+b+0.06]],'#7c6244',0.045);
        out.windows++;
      }
      if(sideExists)for(let c=0;c<Math.max(1,n-1);c++){const py=-length/2+(c+0.5)*length/Math.max(1,n-1);polygon([[xx,py-0.22,z],[xx,py+0.22,z],[xx,py+0.22,z+0.75],[xx,py-0.22,z+0.75]],tone(glass,-0.12));out.windows++;}
    }
  }
  // дверь
  polygon([[-0.32,yy+0.005,0.3],[0.32,yy+0.005,0.3],[0.32,yy+0.005,1.45],[-0.32,yy+0.005,1.45]],'#4a3a2c');
  line([[0.2,yy+0.01,0.85],[0.24,yy+0.01,0.85]],'#c8b070',0.04);
  polygon([[-0.42,yy,1.5],[0.42,yy,1.5],[0.42,yy+0.3,1.62],[-0.42,yy+0.3,1.62]],tone(col,-0.3)); // козырёк
  // Peeling plaster, rain streaks, repaired glazing and vines on every facade.
  for(let i=0;i<12;i++){
    const px=-w*.46+rand()*(frontMax+w*.4),z=.35+rand()*(top-.5),rw=Math.min(frontMax-px,.09+rand()*.18),rh=.12+rand()*.4;if(rw<=0)continue;
    polygon([[px,yy+.035,z],[px+rw,yy+.035,z+.03],[px+rw*.8,yy+.035,z+rh],[px-rw*.15,yy+.035,z+rh*.85]],tone(col,i%3?-.18:.15));
    if(i%3===0)line([[px,yy+.04,z],[px+.025,yy+.04,Math.max(.3,z-.4)]],'#645947',.018);
  }
  for(const side of [-1,1]){
    const vineX=side*w*.43;if(vineX>frontMax)continue;
    line([[vineX,yy+.06,.2],[vineX-side*.08,yy+.06,top*.3],[vineX+side*.08,yy+.06,top*.65]],'#46513a',.025);
    for(let i=0;i<9;i++){const z=.25+i*top*.065;ellipse([vineX+Math.sin(i*2)*.09,yy+.065,z],.075,.035,i%2?'#536343':'#778257');}
  }
  for(let i=0;i<18;i++){const px=(rand()-.5)*(w+.5),py=length/2+rand()*.4;line([[px,py,0],[px+.04,py,.13+rand()*.32]],'#62734c',.025);}
  if(condition==='damaged'||condition==='ruined'){
    const cracks=condition==='ruined'?4:2;
    for(let i=0;i<cracks;i++){
      const px=-w*0.42+rand()*w*0.82,z=0.7+rand()*Math.max(0.5,top-0.9),j=0.12+rand()*0.16;
      line([[px,yy+0.025,z+j],[px-j*0.45,yy+0.026,z],[px+j*0.2,yy+0.026,z-j*0.55],[px+j*0.35,yy+0.026,z-j]],'#383632',0.035);
    }
  }
  if(f.basementWindows){for(const s of [-1,1]){const px=s*w*0.33;if(px+.22>frontMax)continue;polygon([[px-0.22,yy,0.05],[px+0.22,yy,0.05],[px+0.22,yy,0.26],[px-0.22,yy,0.26]],'#2a3134');out.basementWindows++;}}
  if(hasFireEscape){
    const ladder=meshRig(ctx,x,y,unit/M_TO_UNIT,heading,1,'metal',scale),lx=w/2+0.28,ly=-length*0.18;
    const railTop=f.roof==='gable'?top:top+0.28;
    ladder.tube([lx-0.18,ly,0.01],[lx-0.18,ly,railTop],0.045,0.045,'#555b58',6);
    ladder.tube([lx+0.18,ly,0.01],[lx+0.18,ly,railTop],0.045,0.045,'#555b58',6);
    for(let z=0.2;z<railTop;z+=0.42)ladder.tube([lx-0.18,ly,z],[lx+0.18,ly,z],0.035,0.035,'#737874',5);
    ladder.flush();
  }
  ctx.restore();
  return out;
}
// Мебель и обстановка этажей дома (lv.props): ключи shared/houses.js FURNITURE
export function drawFurniture(ctx,key,x,y,unit,variant=0.5){
  const rand=random(Math.floor(variant*1e6)+31),rig=isoRig(ctx,x,y,unit,0),{line,polygon,ellipse}=rig;
  const g=meshRig(ctx,x,y,unit/M_TO_UNIT,0,1),wood='#7a5a3c',dark='#4a3a2c',cloth=['#7a4a4a','#4a5f7a','#5f7a4a','#7a6a4a'][Math.floor(variant*4)];
  ctx.save();shadow(ctx,x,y,unit,0.7,0.25);
  const legs=(w,l,h,c)=>{for(const sx of [-1,1])for(const sy of [-1,1])g.box(sx*(w/2-0.06),sy*(l/2-0.06),0,0.07,0.07,h,c);};
  switch(key){
    case 'table':legs(1.5,0.9,0.7,dark);g.box(0,0,0.7,1.6,1.0,0.08,wood);break;
    case 'chair':legs(0.5,0.5,0.42,dark);g.box(0,0,0.42,0.52,0.52,0.06,wood);g.box(0,-0.23,0.48,0.52,0.06,0.55,wood);break;
    case 'bed':g.box(0,0,0,1.0,1.9,0.35,dark);g.box(0,0.08,0.35,0.95,1.7,0.16,'#d8d4c8');g.box(0,-0.7,0.5,0.7,0.3,0.12,'#ece8dc');g.box(0,0.35,0.5,0.97,1.0,0.06,cloth);g.box(0,-0.92,0,1.0,0.08,0.8,wood);break;
    case 'computer':legs(1.3,0.7,0.72,dark);g.box(0,0,0.72,1.4,0.75,0.07,'#8a8478');g.box(0,-0.15,0.79,0.6,0.08,0.45,'#2a2e33');g.box(0,0.15,0.79,0.5,0.18,0.03,'#3a3e42');g.box(0.5,-0.1,0,0.25,0.5,0.55,'#3a3e42');
      polygon([[-0.26,-0.105,0.84],[0.26,-0.105,0.84],[0.26,-0.105,1.19],[-0.26,-0.105,1.19]],rand()<0.5?'#3f7f9a':'#2f5a46');break;
    case 'sofa':g.box(0,0,0,1.9,0.85,0.42,cloth);g.box(0,-0.33,0.42,1.9,0.2,0.45,tone(cloth,-0.1));for(const s of [-1,1])g.box(s*0.9,0,0.42,0.14,0.85,0.25,tone(cloth,-0.15));break;
    case 'wardrobe':g.box(0,0,0,1.1,0.6,2.0,wood);line([[0,0.305,0.1],[0,0.305,1.9]],dark,0.03);break;
    case 'shelf':for(let i=0;i<4;i++){g.box(0,0,i*0.5,1.4,0.45,0.05,'#6a6a62');}for(const s of [-1,1])g.box(s*0.68,0,0,0.05,0.45,1.6,'#5a5a52');
      for(let i=0;i<7;i++)g.box(-0.55+rand()*1.1,0,Math.floor(rand()*3)*0.5+0.05,0.15+rand()*0.15,0.3,0.15+rand()*0.25,['#8a4a3a','#4a6a8a','#c8b070','#5a7a4a'][i%4]);break;
    case 'stove':g.box(0,0,0,0.8,0.65,0.9,'#c8c8c0');for(const sx of [-0.18,0.18])for(const sy of [-0.13,0.13])ellipse([sx,sy,0.91],0.11,0.06,'#2a2a2a');break;
    case 'fridge':g.box(0,0,0,0.75,0.7,1.8,'#d8d8d0');line([[0.25,0.355,0.9],[0.25,0.355,1.4]],'#888',0.04);line([[-0.37,0.355,1.2],[0.37,0.355,1.2]],'#aaa',0.015);break;
    case 'counter':g.box(0,0,0,1.8,0.7,1.0,'#7a6a5a');g.box(0,0,1.0,1.9,0.8,0.06,'#a09080');g.box(0.4,0,1.06,0.45,0.35,0.3,'#3a3e42');break;
    case 'tv':g.box(0,0,0,1.2,0.45,0.5,wood);g.box(0,0,0.5,0.95,0.12,0.6,'#1e2226');polygon([[-0.42,0.065,0.55],[0.42,0.065,0.55],[0.42,0.065,1.05],[-0.42,0.065,1.05]],'#2c3e48');break;
    case 'sink':g.box(0,0,0,0.6,0.5,0.8,'#d0d0c8');ellipse([0,0,0.81],0.2,0.1,'#9aa8ad');line([[0,-0.2,0.8],[0,-0.1,1.0]],'#999',0.03);break;
    case 'crate':g.box(0,0,0,0.75,0.7,0.65,'#8d7452');for(const z of [0,0.58])g.box(0,0,z,0.77,0.72,0.06,'#6e5a3f');break;
    case 'barrel':g.tube([0,0,0],[0,0,0.85],0.26,0.26,'#795b43',12);for(const z of [0.15,0.65])g.tube([0,0,z],[0,0,z+0.05],0.27,0.27,'#3f4a47',12);break;
    case 'boiler':g.tube([0,0,0],[0,0,1.6],0.45,0.45,'#8a5a3a',12);g.tube([0,0,1.6],[0,0,2.4],0.08,0.08,'#555',6);g.box(0,0.42,0.3,0.3,0.1,0.25,'#2a2a2a');break;
    case 'vent':g.box(0,0,0,0.8,0.7,0.5,'#7c8788');break;
    case 'tank':g.tube([0,0,0],[0,0,0.3],0.1,0.1,'#555',6);g.tube([0,0,0.3],[0,0,1.3],0.55,0.55,'#6f7470',12);break;
    case 'antenna':g.tube([0,0,0],[0,0,2.6],0.04,0.02,'#8a8a8a',5);for(let i=1;i<4;i++)g.box(0,0,i*0.6,0.9-i*0.18,0.04,0.04,'#8a8a8a');break;
    case 'chest':g.box(0,0,0,0.9,0.6,0.5,'#7a5230');g.loft([{y:-0.3,pts:[[-0.45,0.5],[0.45,0.5],[0.38,0.68],[-0.38,0.68]]},{y:0.3,pts:[[-0.45,0.5],[0.45,0.5],[0.38,0.68],[-0.38,0.68]]}],'#8a6238');g.box(0,0.31,0.38,0.12,0.03,0.18,'#c8b070');break;
    case 'junk':g.flush();for(let i=0;i<7;i++){const px=(rand()-0.5)*1.4,py=(rand()-0.5)*1.0;polygon([[px,py,0.01],[px+0.25,py+0.05,0.01],[px+0.2,py+0.22,0.01],[px-0.04,py+0.18,0.01]],['#c8c0a8','#8a7d6d','#5a6a5a','#a8a090'][i%4]);}
      {const g2=meshRig(ctx,x,y,unit/M_TO_UNIT,0,1);g2.tube([0.3,-0.2,0],[0.3,-0.2,0.3],0.06,0.04,'#5a7a5a',6);g2.box(-0.35,0.2,0,0.3,0.25,0.15,'#7a6a5a');g2.flush();}break;
    case 'stairs_up':case 'stairs_down':{
      const up=key==='stairs_up',col='#795b40',edge='#4d4032';
      for(let i=0;i<4;i++){const t=i/3,px=(t-0.5)*0.72,py=(up?1:-1)*(0.3-t*0.6),z=t*0.78;g.box(px,py,z,0.58,0.38,0.12,col);g.box(px,py-0.02,z+0.07,0.6,0.4,0.035,edge);}
      g.tube([-0.42,up?0.36:-0.36,0.12],[0.42,up?-0.36:0.36,0.92],0.035,0.035,'#594531',6);
      break;
    }
    case 'timber_stairs':{
      for(let i=0;i<5;i++){const t=i/4,z=t*0.92,y=(0.4-t*0.8);g.box(0,y,z,0.82,0.24,0.11,i%2?'#76583d':'#8a6847');g.box(0,y-0.02,z+0.055,0.86,0.25,0.025,'#493a2d');}
      g.tube([-0.49,0.42,0.08],[-0.49,-0.42,1.02],0.04,0.04,'#594531',6);g.tube([0.49,0.42,0.08],[0.49,-0.42,1.02],0.04,0.04,'#594531',6);break;
    }
    case 'vertical_ladder':{
      const y=-0.08,h=1.9;for(const x of [-0.28,0.28])g.tube([x,y,0.03],[x,y,h],0.045,0.045,'#626760',7);
      for(let z=0.16;z<h;z+=0.24)g.tube([-0.3,y,z],[0.3,y,z],0.035,0.035,'#a18a62',6);
      g.tube([-0.28,y,0.12],[-0.42,y,0.02],0.035,0.035,'#626760',6);g.tube([0.28,y,0.12],[0.42,y,0.02],0.035,0.035,'#626760',6);break;
    }
    case 'rope_ladder':{
      const y=-0.08,h=1.7;for(const x of [-0.3,0.3]){g.tube([x*0.8,y,0.02],[x,y-0.06,h],0.045,0.04,'#9a7045',7);}
      for(let z=0.13;z<h;z+=0.25){const sway=Math.sin(z*2.4)*0.045;g.tube([-0.31+sway,y-0.035,z],[0.31+sway,y-0.035,z],0.035,0.035,'#c09a62',6);}break;
    }
    case 'stone_steps':{
      for(let i=0;i<5;i++){const t=i/4,y=0.34-t*0.68,z=0.07+t*0.72;g.box(0,y,z,0.95,0.24,0.16,i%2?'#777469':'#898576');g.box(0,y-0.015,z+0.08,1.0,0.25,0.035,'#554f46');}break;
    }
    case 'stone_ramp':{
      g.prismX([[-0.5,0.03],[0.5,0.03],[0.5,0.48],[-0.5,0.94]],-0.42,0.42,'#746b5c');
      for(let i=0;i<4;i++){const t=i/3,y=0.28-t*0.56,z=0.12+t*0.66;g.box(0,y,z,0.9,0.18,0.07,i%2?'#8a8171':'#6f685b');}break;
    }
    case 'metal_hatch':{
      g.box(0,0,0.02,1.02,0.84,0.09,'#41494a');g.box(0,0,0.08,0.86,0.68,0.08,'#69716d');
      for(const x of [-0.32,0,0.32])g.box(x,0,0.13,0.045,0.62,0.035,'#303738');
      g.box(0.28,0.2,0.16,0.14,0.08,0.045,'#c3a45c');break;
    }
    case 'stair_landing':g.box(0,0,0.04,1.05,0.82,0.12,'#927354');g.box(0,0,0.105,0.9,0.67,0.025,'#b09068');break;
    default:ctx.restore();return false;
  }
  g.flush();ctx.restore();return true;
}
