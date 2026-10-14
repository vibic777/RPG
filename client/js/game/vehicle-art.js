import { isoRig, tone, facing8, shadow, digitigradeLeg } from './figure-art.js';
import { drawMesh } from './vehicle-mesh.js';
const TAU=Math.PI*2;
const muzzlePositions=new WeakMap();
export const vehicleMuzzle=(v,angle)=>{
  const slots=muzzlePositions.get(v);if(!slots)return null;
  if(Number.isFinite(angle)&&slots.rear){const bearing=angle-(Number.isFinite(v.facingAngle)?v.facingAngle:0),delta=Math.atan2(Math.sin(bearing),Math.cos(bearing));return Math.abs(delta)>Math.PI/2?slots.rear:slots.front;}
  return slots.front||slots.rear||null;
};
// Ширина, длина и высота в метрах; рядом герой ростом около 1,75 м.
// Второй вектор — размеры исходной модели, не радиус игровой коллизии.
const DIMENSIONS = {
  bicycle: [[0.6,1.8,1.05],[0.4,1.98,0.85]],
  horse: [[1.2,2.8,1.8],[1.0,2.2,1.5]],
  mutant_mount: [[1.5,3.2,2.15],[1.0,2.25,1.45]],
  motorcycle: [[0.8,2.2,1.15],[0.44,1.98,0.87]],
  car: [[1.8,4.4,1.45],[2.05,2.34,0.98]],
  sedan: [[1.85,4.8,1.48],[2.05,2.34,0.98]],
  armored_car: [[2.0,4.9,1.8],[2.05,2.34,0.98]],
  truck: [[2.0,5.2,1.9],[2.19,2.8,1.065]],
  cargo_truck: [[2.4,8.2,2.8],[2.19,5.8,1.5]],
  semi_truck: [[2.6,12.5,3.5],[2.19,7.5,1.8]],
  bus: [[2.5,10.5,3.1],[2.27,5.3,1.7]],
  armored_bus: [[2.6,10.5,3.3],[2.27,5.3,1.7]],
  apc: [[2.8,6.2,2.4],[2.35,2.34,1.19]],
  ifv: [[3.0,6.8,2.6],[2.35,2.34,1.19]],
  tank: [[3.5,7.0,2.4],[2.06,3.24,1.105]],
  light_tank: [[2.8,6.0,2.2],[2.06,3.24,1.105]],
  rowboat: [[1.22,2.9,0.64],[1.08,2.55,0.59]],
  boat: [[1.62,3.95,1.12],[1.08,2.52,0.78]],
  jetski: [[1.15,2.8,1.0],[0.7,2.0,0.76]],
  submarine: [[2.55,7.4,2.5],[1.3,4.1,1.48]],
  deep_submarine: [[4.0,11.5,3.8],[1.55,5.4,1.8]],
  helicopter: [[2.1,9.0,3.0],[0.96,2.57,1.27]],
  plane: [[1.65,7.0,2.3],[0.62,2.67,1.14]],
  mech_sentinel: [[3.0,3.0,5.5],[1.3,2.0,3.4]],
  chicken_walker: [[2.1,2.8,4.0],[1.05,2.0,3.0]],
  elephant_walker: [[5.2,7.0,6.0],[2.0,4.2,3.6]],
};
export function vehicleDimensions(id) { return window.Vehicles?.dimensionsOf(id)?.slice(0,3) || (DIMENSIONS[id] || DIMENSIONS.car)[0]; }
export function drawVehicleModel(ctx,def,v,x,y,unit,angle,time,alt=0,quality='medium') {
  // Объёмная модель с бронёй, скруглёнными поверхностями и проверкой глубины.
  const meshed=drawMesh(ctx,def,v,x,y,unit,angle,time,alt,quality);
  if(meshed){
    const front=meshed.find((t)=>t.front)||meshed[0],rear=meshed.find((t)=>t.rear);
    muzzlePositions.set(v,{front:front&&front.muzzle,rear:rear&&rear.muzzle});
    return meshed;
  }
  const tracked=Boolean(def.tracked)||def.id==='tank'||def.id==='light_tank';
  const armored=Boolean(def.apc)||def.id==='apc'||def.id==='ifv';
  const id=def.id, wreck=Boolean(v.wreck), color=wreck?'#66574b':def.color||'#697565';
  const moving=Boolean(v.moving), small=['bicycle','motorcycle','jetski'].includes(id);
  const [meters,base] = DIMENSIONS[id] || DIMENSIONS.car;
  const metersToUnits=3.3/1.75;
  const size=meters[1]*metersToUnits/base[1];
  const scale=[meters[0]*metersToUnits/(base[0]*size),1,meters[2]*metersToUnits/(base[2]*size)];
  const originalUnit=unit;
  unit*=size;
  ctx.save(); shadow(ctx,x,y,unit,def.fly?1.35:1.05,0.4);
  y-=Math.max(0,alt)*10;
  const rig=isoRig(ctx,x,y,unit,facing8(angle),scale),{depth,paint,polygon,line,ellipse,volume,limb,box,project}=rig;
  const heading=facing8(angle), frontVisible=Math.cos(heading)+Math.sin(heading)>0.001;
  const rearVisible=Math.cos(heading)+Math.sin(heading)<-0.001;
  const steel='#323c43', glass=wreck?'#3f4a47':'#648e9e';
  const spin=moving?time/110:0;
  const sideDepth = Math.cos(heading)-Math.sin(heading);
  const sideLayer = side => side*sideDepth > 0.001 ? 100 : -100;
  const wheel=(sx,sy,r=0.27,layer=depth([sx,sy,0]))=>paint(layer,()=>{
    const p=[sx,sy,r];volume(p,0.09,r,r,'#222628');volume([sx+Math.sign(sx)*0.055,sy,r],0.013,r*0.52,r*0.52,'#777c7b');
    for(let i=0;i<4;i++){const a=spin+i*TAU/4;line([[sx+Math.sign(sx)*0.07,sy,r],[sx+Math.sign(sx)*0.07,sy+Math.cos(a)*r*0.48,r+Math.sin(a)*r*0.48]],'#30393d',0.018);}
  });
  const hull=(w,len,z,h,col)=>box(0,0,z,w,len,h,col,0.16);
  const lights=(w,len,z)=>{for(const side of [-1,1]){if(frontVisible)volume([side*w*0.32,len*0.5+0.02,z],0.09,0.03,0.055,wreck?'#78654d':'#eee2ba');if(rearVisible)volume([side*w*0.32,-len*0.5-0.02,z],0.09,0.03,0.05,'#873b32');}};
  if(def.animal){
    const mutant=def.animal==='mutant', stride=moving?Math.sin(time/95):Math.sin(time/720)*0.025;
    paint(-0.1,()=>{
      volume([0,-0.05,0.77],mutant?0.38:0.3,mutant?0.69:0.62,mutant?0.35:0.31,color);
      limb([0,0.34,0.83],[0,0.64,1.22],0.16,0.12,color);
      volume([0,0.75,1.26],0.17,0.31,0.2,tone(color,0.08));
      if(mutant){for(const side of [-1,1]){limb([side*0.14,0.84,1.32],[side*0.18,0.9,1.56],0.05,0.012,'#c6c2a3');volume([side*0.15,0.54,1.5],0.055,0.06,0.045,'#edca62');}line([[0,-0.61,0.85],[0,-0.94,0.74],[0,-1.04,0.92]],tone(color,-0.22),0.09);}
      else {limb([0,0.61,1.42],[0,0.59,1.67],0.085,0.08,tone(color,-0.18));line([[-0.16,0.62,1.65],[0,0.58,1.69],[0.16,0.62,1.65]],tone(color,-0.22),0.035);}
      box(0,-0.12,1.12,0.38,0.38,0.08,'#5b4936');
      for(const side of [-1,1])for(const yy of [-0.42,0.36]){
        const phase=stride*(yy>0?1:-1), hip=[side*0.2,yy,0.7], knee=[side*0.22,yy+phase*0.28,0.39], hoof=[side*0.22,yy+phase*0.62,0.11];
        limb(hip,knee,0.09,0.07,tone(color,-0.08));limb(knee,hoof,0.07,0.055,color);volume([hoof[0],hoof[1]+0.04,0.085],0.09,0.13,0.07,'#302e2a');
      }
    });
  }else if(def.walker){
    const elephant=def.walker==='elephant', lightBiped=def.walker==='biped_light';
    const step=moving?Math.sin(time/105):Math.sin(time/760)*0.018;
    const legYs=elephant?[-0.58,0.58]:[0.42,-0.42];
    paint(-0.15,()=>{
      const count=elephant?4:2;
      for(let i=0;i<count;i++){
        const side=elephant?(i%2?0.55:-0.55):(i?0.48:-0.48), rowIndex=elephant?(i<2?1:-1):0;
        const phase=step*((i%2)?-1:1), hip=[side,elephant?legYs[rowIndex>0?0:1]:legYs[i],elephant?1.48:1.25];
        const foot=[side*1.04,hip[1]+phase*0.5,0.13+(elephant?0:Math.max(0,Math.cos(time/105+(i?Math.PI:0)))*(moving?0.15:0))];
        const leg=elephant?{knee:[side*1.04,hip[1]+phase*0.24,0.76],ankle:foot}:digitigradeLeg(hip,foot);
        const {knee,ankle}=leg;
        limb(hip,knee,elephant?0.25:0.18,elephant?0.21:0.14,tone(color,-0.1));
        volume(knee,elephant?0.24:0.17,0.25,0.22,'#41494a');
        limb(knee,ankle,elephant?0.2:0.13,elephant?0.16:0.1,color);
        if(!elephant)limb(ankle,foot,0.1,0.08,steel);
        box(foot[0],foot[1]+0.04,foot[2]-0.01,elephant?0.5:0.32,elephant?0.58:0.42,0.22,'#343b3c');
      }
      box(0,0,elephant?1.76:1.65,elephant?1.45:0.96,elephant?1.56:0.95,elephant?0.84:0.88,color);
      box(0,0.12,elephant?2.2:2.0,elephant?1.18:0.8,elephant?1.12:0.64,0.38,tone(color,-0.08));
      if(elephant){
        volume([0,0.81,1.9],0.56,0.55,0.55,tone(color,-0.12));
        limb([0,1.08,1.95],[0,1.55,1.47],0.19,0.14,tone(color,-0.18));
        for(const side of [-1,1]){limb([side*0.34,1.02,1.72],[side*0.48,1.4,1.45],0.11,0.025,'#d4c7a0');volume([side*0.47,0.75,2.13],0.06,0.06,0.05,'#efc767');}
        box(0,-0.08,2.62,0.62,0.72,0.32,'#39464b');line([[-0.4,-0.08,2.8],[0.4,-0.08,2.8]],steel,0.09);
      }else if(lightBiped){
        limb([0,0.3,2.2],[0,0.58,2.62],0.22,0.16,tone(color,-0.05));
        volume([0,0.7,2.68],0.42,0.47,0.34,glass);
        line([[-0.34,0.5,2.75],[0.34,0.5,2.75]],steel,0.09);
        box(0,-0.04,2.08,0.57,0.5,0.48,'#354047');
        for(const side of [-1,1]){
          limb([side*0.38,0.04,2.06],[side*0.67,0.32,1.82],0.13,0.1,steel);
          limb([side*0.67,0.32,1.82],[side*0.54,0.55,1.55],0.11,0.09,color);
        }
        line([[-0.18,0.13,2.31],[0.18,0.13,2.31]],'#c1b894',0.07);
      }else{
        volume([0,0.61,2.39],0.4,0.39,0.38,steel);
        box(0,0.96,2.41,0.52,0.15,0.18,'#88bbc0');
        for(const side of [-1,1]){limb([side*0.52,0.13,2.08],[side*0.78,0.54,1.56],0.16,0.12,color);limb([side*0.78,0.54,1.56],[side*0.84,0.85,1.42],0.11,0.09,steel);}
        box(0,-0.03,2.14,0.7,0.48,0.24,'#40484b');
        line([[-0.47,0.08,2.38],[0.47,0.08,2.38]],'#c1b894',0.07);
      }
      volume([0,-0.25,elephant?2.12:1.95],elephant?0.28:0.2,elephant?0.32:0.24,0.08,'#8ce1df');
    });
  }else if(id==='bicycle'||id==='motorcycle'){
    wheel(0,-0.64,id==='bicycle'?0.32:0.29);wheel(0,0.7,id==='bicycle'?0.32:0.29);
    paint(0,()=>{
      line([[0,-0.64,0.32],[0,-0.16,0.72],[0,0.23,0.32],[0,-0.64,0.32]],color,0.065);
      line([[0,-0.16,0.72],[0,0.33,0.78],[0,0.23,0.32]],tone(color,0.18),0.07);
      line([[0,0.33,0.78],[0,0.7,0.29]],'#919b9e',0.045);line([[-0.2,0.34,0.82],[0.2,0.34,0.82]],steel,0.05);
      volume([0,-0.22,0.77],0.16,0.22,0.045,'#2e3030');
      if(id==='motorcycle'){volume([0,0.09,0.64],0.22,0.28,0.14,color);box(0,-0.08,0.28,0.3,0.35,0.22,'#5c6469');limb([0.17,-0.53,0.25],[0.17,0.1,0.26],0.055,0.055,'#a2a3a0');volume([0,0.51,0.76],0.12,0.08,0.11,'#eed9a1');}
    });
  }else if(def.kind==='water'){
    const sub=Boolean(def.sealed), jet=id==='jetski', deep=id==='deep_submarine', len=deep?2.05:sub?1.7:jet?1.0:1.4, width=deep?0.78:sub?0.54:jet?0.35:0.6;
    paint(0,()=>{
    if(sub){
      const L=deep?2.08:1.82,W=deep?0.73:0.55;
      // Силуэт атомной подлодки «Акула»: длинный корпус, округлый нос и коническая корма.
      volume([0,-0.03,0.46],W,L,0.39,color);
      volume([0,0.94,0.47],W*0.78,0.57,0.34,tone(color,0.08));
      volume([0,-1.47,0.45],W*0.72,0.49,0.31,tone(color,-0.17));
      // Палубная линия и отдельные торпедные крышки у носа.
      line([[-W*0.77,-1.24,0.56],[-W*0.82,-0.25,0.69],[-W*0.68,0.66,0.64]],tone(color,0.22),0.035);
      line([[W*0.77,-1.24,0.56],[W*0.82,-0.25,0.69],[W*0.68,0.66,0.64]],tone(color,-0.22),0.035);
      for(const side of [-1,1])for(const yy of [0.62,0.78])volume([side*W*0.38,yy,0.47],0.055,0.035,0.035,'#27363b');
      // Высокая рубка с наклонённой передней кромкой и обзорными окнами.
      box(0,-0.22,0.79,W*0.9,0.6,0.28,tone(color,-0.13),0.09);
      polygon([[-W*0.42,0.08,0.83],[W*0.42,0.08,0.83],[W*0.34,0.18,1.0],[-W*0.34,0.18,1.0]],tone(color,-0.08));
      for(const side of [-1,1])volume([side*0.13,0.19,0.91],0.045,0.025,0.035,'#8bc4cc');
      // Кормовое оперение, гребной винт и небольшие носовые рули.
      for(const side of [-1,1]){
        polygon([[side*0.12,-1.52,0.5],[side*0.77,-1.92,0.43],[side*0.64,-1.56,0.51]],steel);
        polygon([[side*0.1,0.68,0.44],[side*0.67,0.93,0.39],[side*0.49,0.57,0.48]],tone(color,-0.16));
      }
      polygon([[-0.09,-1.52,0.49],[0.09,-1.52,0.49],[0,-1.92,0.78]],tone(color,-0.15));
      const prop=time/130;for(let i=0;i<7;i++){const a=prop+i*TAU/7;line([[0,-1.95,0.48],[Math.cos(a)*0.28,-2.0,0.48+Math.sin(a)*0.28]],'#aeb8b4',0.055);}
      line([[0,-0.96,0.85],[0,-0.96,1.27]],steel,0.03);line([[0,-0.96,1.27],[0,-0.78,1.27]],steel,0.04);
      if(deep){for(const side of [-1,1]){line([[side*0.58,-0.65,0.45],[side*0.88,-0.94,0.58]],'#bbc7bd',0.04);}}
    }
      else{
        polygon([[-width,-len,0.2],[width,-len,0.2],[width,0.57,0.28],[0,len,0.45],[-width,0.57,0.28]],tone(color,-0.22));
        polygon([[-width,-len,0.46],[width,-len,0.46],[width,0.54,0.58],[0,len,0.63],[-width,0.54,0.58]],color);
        polygon([[-width*0.72,-len*0.76,0.47],[width*0.72,-len*0.76,0.47],[width*0.65,0.44,0.6],[0,len*0.7,0.63],[-width*0.65,0.44,0.6]],id==='rowboat'?'#816b4f':tone(color,-0.4));
        if(id==='rowboat'){for(const yy of [-0.56,0.08])box(0,yy,0.49,width*1.7,0.16,0.045,'#a18c69');for(const side of [-1,1]){const yy=Math.sin(time/260)*0.17*(moving?1:0);line([[side*0.1,0.1,0.5],[side*0.98,yy,0.27]],'#957c52',0.04);volume([side*1.0,yy,0.23],0.12,0.19,0.025,'#b39a6d');}}
        else if(jet){volume([0,-0.23,0.63],0.21,0.45,0.065,steel);line([[-0.21,0.22,0.74],[0.21,0.22,0.74]],steel,0.035);}
        else{box(0,0.31,0.58,0.7,0.21,0.28,glass);box(0,-0.72,0.42,0.35,0.25,0.4,steel);}
        if(id==='boat'){
          // Французский прогулочный катер: белая V-образная палуба, рубка,
          // обёрнутое синей полосой борто, носовой релинг и кормовая площадка.
          polygon([[-width*0.88,-len*0.82,0.49],[width*0.88,-len*0.82,0.49],[width*0.7,0.68,0.62],[0,len*0.92,0.68],[-width*0.7,0.68,0.62]],'#e4e2d8');
          line([[-width*0.94,-len*0.72,0.5],[-width*0.76,0.34,0.61],[0,len*0.94,0.69],[width*0.76,0.34,0.61],[width*0.94,-len*0.72,0.5]],'#315f78',0.055);
          box(0,0.26,0.78,0.78,0.67,0.43,'#ece9dc',0.09);
          polygon([[-0.34,0.51,0.91],[0.34,0.51,0.91],[0.3,0.69,0.77],[-0.3,0.69,0.77]],'#82a8b0');
          for(const side of [-1,1]){
            polygon([[side*0.4,0.47,0.88],[side*0.4,0.1,0.88],[side*0.4,0.06,0.7],[side*0.4,0.49,0.7]],'#7da4ad');
            line([[side*0.08,0.75,0.67],[side*0.36,0.86,0.74],[side*0.56,0.65,0.74]],'#c5c8c0',0.035);
            line([[side*0.53,-0.34,0.66],[side*0.53,-0.8,0.61]],'#c5c8c0',0.03);
            volume([side*0.52,-0.89,0.61],0.08,0.11,0.07,'#be493b');
          }
          box(0,-0.56,0.63,0.62,0.46,0.11,'#d2cdbb',0.04);
          box(0,-0.98,0.6,0.53,0.13,0.14,'#334e5a',0.03);
          for(const side of [-1,1])volume([side*0.58,0.63,0.7],0.04,0.07,0.035,'#ddd8c8');
        }
      }
    });
    if(moving&&!wreck){ctx.save();ctx.globalAlpha=0.35;for(let i=0;i<3;i++){const d=0.22+i*0.2;line([[-width-d,-len-d,0],[0,-len-d-0.18,0],[width+d,-len-d,0]],'#bedbd7',0.035);}ctx.restore();}
  }else if(def.fly){
    const heli=id==='helicopter';
    if(heli){
      // Ка-52: короткая хвостовая балка, широкая кабина экипажа бок о бок,
      // короткие крылья с пилонами и два соосных несущих винта.
      paint(-0.8,()=>{
        limb([0,-0.48,0.63],[0,-1.72,0.73],0.115,0.075,color);
        box(0,-1.58,0.72,0.11,0.42,0.34,color);
        polygon([[-0.07,-1.74,0.9],[0.07,-1.74,0.9],[0,-1.87,1.18]],tone(color,-0.16));
        for(const side of [-1,1]){
          polygon([[side*0.37,-0.18,0.55],[side*1.2,-0.34,0.48],[side*1.16,-0.65,0.47],[side*0.34,-0.54,0.55]],tone(color,-0.08));
          limb([side*0.65,-0.34,0.5],[side*0.65,-0.34,0.26],0.045,0.035,steel);
          for(const yy of [-0.45,-0.67])volume([side*0.88,yy,0.37],0.06,0.08,0.06,'#424a4b');
          line([[side*0.42,-0.54,0.43],[side*1.13,-0.62,0.39]],tone(color,0.28),0.025);
          // Основные стойки шасси и компактные колёса.
          limb([side*0.34,-0.28,0.37],[side*0.44,-0.4,0.06],0.04,0.03,steel);volume([side*0.44,-0.4,0.055],0.075,0.11,0.07,'#202528');
        }
      });
      paint(0,()=>{
        volume([0,-0.02,0.61],0.34,0.83,0.31,color);
        volume([0,0.42,0.65],0.4,0.48,0.32,tone(color,0.07));
        volume([0,0.83,0.52],0.27,0.39,0.22,tone(color,-0.1));
        // Панорамная двухместная кабина с отдельными передними стёклами.
        for(const side of [-1,1]){
          polygon([[side*0.035,0.84,0.75],[side*0.32,0.78,0.74],[side*0.29,1.04,0.47],[side*0.035,1.12,0.48]],glass);
          polygon([[side*0.36,0.73,0.72],[side*0.49,0.49,0.66],[side*0.45,0.27,0.65],[side*0.35,0.48,0.75]],tone(glass,side>0?-0.2:0.08));
          line([[side*0.035,0.82,0.77],[side*0.035,1.11,0.49]],steel,0.025);
        }
        line([[-0.36,0.29,0.72],[0.36,0.29,0.72]],tone(color,-0.25),0.035);
        // Втулки двух винтов вращаются навстречу друг другу.
        limb([0,-0.08,0.86],[0,-0.08,1.22],0.075,0.07,steel);
        const a=wreck?0.42:time/38,b=wreck?0.92:-time/43;
        for(const [phase,z,shade] of [[a,1.25,tone(color,-0.25)],[b,1.31,tone(color,0.15)]]){
          for(let i=0;i<3;i++){
            const t=phase+i*TAU/3;
            polygon([[Math.cos(t)*0.12,-0.08+Math.sin(t)*0.12,z],[Math.cos(t+0.07)*1.45,-0.08+Math.sin(t+0.07)*1.45,z-0.015],[Math.cos(t+0.18)*1.43,-0.08+Math.sin(t+0.18)*1.43,z],[Math.cos(t+0.28)*0.12,-0.08+Math.sin(t+0.28)*0.12,z+0.012]],shade);
          }
        }
        volume([0,-0.08,1.27],0.14,0.14,0.12,steel);
      });
    }else{
      // Ил-2: бронированный моторный нос, низкое толстое крыло, кабина и винт.
      paint(-0.8,()=>{
        polygon([[-0.18,0.16,0.61],[-1.78,-0.25,0.52],[-1.62,-0.55,0.53],[-0.14,-0.27,0.66]],tone(color,-0.05));
        polygon([[0.18,0.16,0.61],[1.78,-0.25,0.52],[1.62,-0.55,0.53],[0.14,-0.27,0.66]],color);
        // Подкрыльевые подвесы с парами ракет.
        for(const side of [-1,1])for(const xx of [1.02,1.34]){
          line([[side*xx,-0.14,0.49],[side*xx,-0.14,0.3]],steel,0.035);
          limb([side*xx,-0.03,0.34],[side*xx,-0.43,0.34],0.07,0.055,'#56616a');
        }
        polygon([[-0.74,-1.24,0.65],[0.74,-1.24,0.65],[0,-1.55,0.73]],tone(color,-0.1));
        polygon([[-0.12,-1.35,0.68],[0.12,-1.35,0.68],[0,-1.66,1.04]],steel);
        polygon([[-0.19,-0.7,0.82],[0.19,-0.7,0.82],[0.17,-0.4,0.78],[-0.17,-0.4,0.78]],glass);
        for(const side of [-1,1]){line([[side*0.28,-0.08,0.54],[side*0.32,-0.1,0.12]],steel,0.045);volume([side*0.32,-0.1,0.1],0.07,0.12,0.065,'#252a2b');}
      });
      paint(0,()=>{
        volume([0,-0.06,0.59],0.28,1.08,0.25,color);
        volume([0,0.68,0.62],0.33,0.52,0.27,tone(color,-0.18));
        volume([0,0.97,0.56],0.27,0.3,0.19,tone(color,-0.3));
        // Радиатор, бронекапот и фонарь кабины.
        box(0,1.12,0.49,0.37,0.16,0.23,steel,0.05);
        for(let i=0;i<4;i++)line([[-0.12+i*0.08,1.205,0.43],[-0.12+i*0.08,1.205,0.57]],'#9ca5a1',0.018);
        polygon([[-0.22,0.55,0.83],[0.22,0.55,0.83],[0.19,0.91,0.75],[-0.19,0.91,0.75]],glass);
        line([[0,0.56,0.83],[0,0.91,0.75]],steel,0.026);
        for(const side of [-1,1]){
          volume([side*0.12,1.2,0.47],0.045,0.045,0.045,'#f0dfad');
          line([[side*0.24,-0.5,0.65],[side*0.24,0.32,0.64]],tone(color,-0.23),0.028);
          const star=[];for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?0.075:0.16;star.push([side*0.94+Math.cos(a)*r,-0.1+Math.sin(a)*r,0.57]);}polygon(star,'#a8352f',false,true);
        }
        // Вращающийся носовой винт и ступица.
        limb([0,1.04,0.57],[0,1.37,0.57],0.075,0.07,steel);
        const a=wreck?0.5:time/24;
        for(let i=0;i<3;i++){const t=a+i*TAU/3;line([[Math.cos(t)*0.13,1.4,0.57+Math.sin(t)*0.13],[Math.cos(t)*0.66,1.4,0.57+Math.sin(t)*0.66]],'#444b4b',0.055);}
        volume([0,1.4,0.57],0.12,0.12,0.11,'#363d3e');
      });
    }
  }else {
    const tank=tracked,apc=armored,truck=Boolean(def.truckCab)||id==='truck',bus=Boolean(def.bus),len=tank?1.3:bus?1.52:truck?1.38:1.15,w=tank?1.17:apc?1.06:bus?1.02:truck?0.98:0.91;
    if(tank){for(const side of [-1,1])paint(sideLayer(side),()=>{
      // Непрерывная гусеничная лента с шестью крупными опорными катками.
      box(side*0.91,0,0.04,0.24,2.72,0.44,'#252b2c');
      box(side*1.035,0,0.26,0.045,2.42,0.34,'#424a45');
      for(let i=0;i<(id==='tank'?7:6);i++){
        const yy=(id==='tank'?-1.08:-1.01)+i*(id==='tank'?0.36:0.4);
        volume([side*1.06,yy,0.26],0.115,0.19,0.17,'#202729');
        volume([side*1.087,yy,0.26],0.055,0.115,0.105,'#777d76');
        volume([side*1.102,yy,0.26],0.022,0.052,0.05,'#353d3c');
      }
      for(let i=0;i<14;i++){
        const yy=-1.3+(i*0.2+(moving?time/600%0.2:0));
        line([[side*0.91,yy,0.49],[side*1.06,yy,0.49]],'#85877b',0.026);
      }
    });}
    else for(const side of [-1,1])for(const yy of apc?[-0.78,0,0.78]:[-0.75,0.75])wheel(side*(w+0.025),yy,apc?0.3:0.25,sideLayer(side));
    if(def.trailerLength){
      const trailerCenter=-len*0.7-def.trailerLength*0.5;
      for(const side of [-1,1])for(const yy of [trailerCenter-def.trailerLength*0.29,trailerCenter+def.trailerLength*0.29])wheel(side*w*0.52,yy,0.28,sideLayer(side));
    }
    paint(0,()=>{
      hull(tank?w*1.32:w*2,len*2,0.31,tank?0.35:0.29,color);
      if(tank){
        // Низкий клиновидный корпус Т-14 с длинной кормовой моторной плитой.
        polygon([[-0.75,1.04,0.48],[0.75,1.04,0.48],[0.68,0.72,0.82],[-0.68,0.72,0.82]],tone(color,0.12));
        polygon([[-0.75,-1.02,0.47],[-0.68,-0.72,0.81],[0.68,-0.72,0.81],[0.75,-1.02,0.47]],tone(color,-0.18));
        box(0,-0.12,0.68,0.65,0.92,0.1,tone(color,-0.12));
        // Модульные бортовые экраны закрывают верх гусениц.
        for(const side of [-1,1]){
          box(side*0.85,0,0.52,0.31,2.42,0.17,tone(color,-0.12),0.055);
          for(let i=0;i<5;i++)box(side*0.88,-0.8+i*0.39,0.67,0.12,0.29,0.16,i%2? tone(color,-0.08):tone(color,-0.17),0.035);
          for(let i=0;i<4;i++)line([[side*0.43,-0.78+i*0.18,0.77],[side*0.68,-0.78+i*0.18,0.77]],steel,0.021);
        }
        // Люки экипажа и компактный прицельно-оптический блок необитаемой башни.
        volume([0,-0.78,0.84],0.16,0.22,0.045,steel);
        volume([0.28,-0.33,0.82],0.11,0.12,0.055,'#303c3e');
        volume([-0.28,-0.33,0.82],0.1,0.12,0.05,'#8fc4c7');
      }
      else if(apc){box(0,-0.05,0.6,w*0.9,len*1.6,0.41,color);for(const side of [-1,1])for(const yy of [-0.6,0.05,0.68])line([[side*0.31,yy,0.86],[side*0.12,yy,0.86]],glass,0.105);box(0,-0.04,1.02,0.38,0.44,0.08,tone(color,-0.12));}
      else if(bus){
        box(0,-0.03,0.67,w*0.94,len*1.73,0.78,color,0.11);
        if(frontVisible){
          polygon([[-w*0.39,len*0.84,1.12],[w*0.39,len*0.84,1.12],[w*0.37,len*0.91,0.78],[-w*0.37,len*0.91,0.78]],glass);
          box(0,len*0.91,0.55,w*0.56,0.06,0.25,steel,0.04);
          for(let i=0;i<5;i++)line([[-w*0.23+i*w*0.115,len*0.95,0.45],[-w*0.23+i*w*0.115,len*0.95,0.64]],'#a6aaa3',0.018);
          for(const side of [-1,1])volume([side*w*0.37,len*0.92,0.69],0.075,0.035,0.065,'#f3e5bf');
          // Трёхлучевая эмблема и хромированная окантовка в духе междугороднего Mercedes.
          volume([0,len*0.955,0.76],0.07,0.025,0.07,'#bbc0bd');
          for(let i=0;i<3;i++){const t=-Math.PI/2+i*TAU/3;line([[0,len*0.96,0.76],[Math.cos(t)*0.06,len*0.96,0.76+Math.sin(t)*0.06]],'#e1dfd4',0.012);}
        }
        for(const side of [-1,1])for(let i=0;i<6;i++){if(side*sideDepth<=0.001)continue;const yy=0.9-i*0.34;box(side*w*0.48,yy,0.94,0.035,0.27,0.3,wreck?steel:glass,0.035);line([[side*w*0.5,yy+0.15,0.78],[side*w*0.5,yy-0.15,0.78]],tone(color,-0.12),0.022);}
        for(const side of [-1,1]){
          line([[side*w*0.48,-1.24,0.58],[side*w*0.48,1.24,0.58]],'#b4b0a4',0.025);
          if(rearVisible)volume([side*w*0.33,-len*0.91,0.58],0.075,0.03,0.085,'#c84a36');
        }
        if(id==='armored_bus'){for(let i=0;i<4;i++)line([[-w*0.48,-0.62+i*0.4,0.61],[w*0.48,-0.62+i*0.4,0.61]],steel,0.04);}
      }
      else{
        const cy=truck?0.34:-0.04,roof=truck?0.65:0.69;
        box(0,cy,0.6,w*0.84,roof*1.35,0.36,tone(color,-0.04),0.075);
        line([[-w*0.74,len*0.88,0.62],[w*0.74,len*0.88,0.62]],tone(color,0.15),0.017);
        for(const side of [-1,1])if(side*sideDepth>0.001){
          line([[side*w*1.01,-len*0.72,0.5],[side*w*1.01,len*0.72,0.5]],tone(color,-0.2),0.025);
          box(side*w*0.52,cy+roof*0.47,0.78,0.13,0.09,0.065,steel,0.015);
        }
        if(frontVisible)polygon([[-w*0.39,cy+roof*0.55,0.98],[w*0.39,cy+roof*0.55,0.98],[w*0.41,cy+roof*0.8,0.68],[-w*0.41,cy+roof*0.8,0.68]],glass);
        if(rearVisible)polygon([[-w*0.34,cy-roof*0.68,0.94],[w*0.34,cy-roof*0.68,0.94],[w*0.37,cy-roof*0.7,0.73],[-w*0.37,cy-roof*0.7,0.73]],tone(glass,-0.2));
        for(const side of [-1,1]){if(side*(Math.cos(heading)-Math.sin(heading))<=0.001)continue;polygon([[side*w*0.43,cy-roof*0.43,0.91],[side*w*0.43,cy+roof*0.43,0.91],[side*w*0.43,cy+roof*0.43,0.68],[side*w*0.43,cy-roof*0.43,0.68]],tone(glass,side>0?-0.18:0.1));line([[side*w*0.44,cy,0.89],[side*w*0.44,cy,0.7]],color,0.025);line([[side*w*0.45,cy-0.17,0.65],[side*w*0.45,cy-0.02,0.65]],'#b7b5a7',0.021);}
        if(truck){
          // Широкий Ford Raptor-подобный пикап: двойная кабина, высокий капот,
          // раздутые арки, открытый кузов и пулемёт на кормовой платформе.
          box(0,0.99,0.43,w*1.82,0.36,0.19,tone(color,-0.2),0.045);
          box(0,0.81,0.49,w*1.9,0.08,0.12,steel,0.035);
          for(const side of [-1,1]){
            volume([side*w*0.44,0.94,0.46],0.07,0.025,0.06,'#eadcae');
            polygon([[side*w*0.88,1.13,0.27],[side*w*0.96,1.04,0.56],[side*w*0.9,0.48,0.56],[side*w*0.82,0.36,0.27]],tone(color,-0.2));
            box(side*w*0.43,0.22,0.95,0.06,0.72,0.055,steel,0.02);
            box(side*w*0.48,-0.76,0.69,0.095,1.0,0.2,tone(color,-0.14),0.025);
            box(side*w*0.48,-1.25,0.66,0.095,0.09,0.2,tone(color,-0.14),0.02);
            line([[side*w*0.48,-1.28,0.78],[side*w*0.48,0.24,0.78]],steel,0.026);
            // Расширители над крупными внедорожными колёсами.
            for(const yy of [-0.75,0.78]){
              const arch=[-0.3,-0.15,0,0.15,0.3].map((dy,i)=>[side*(w+0.08),yy+dy,0.45+(i===2?0.21:i===1||i===3?0.15:0.03)]);
              line(arch,tone(color,0.12),0.065);
            }
          }
          box(0,-0.76,0.59,w*0.82,0.92,0.12,tone(color,-0.26),0.035);
          box(0,-1.27,0.66,w*0.82,0.12,0.3,tone(color,-0.12),0.035);
          box(0,-0.26,0.68,w*0.82,0.1,0.3,tone(color,-0.12),0.035);
          // Усиленная передняя решётка с широкими прорезями.
          box(0,1.18,0.57,w*0.66,0.055,0.31,'#24292a',0.035);
          for(let i=0;i<5;i++)line([[-w*0.28,1.215,0.47+i*0.045],[w*0.28,1.215,0.47+i*0.045]],'#9b9c91',0.017);
          polygon([[-w*0.44,0.68,0.93],[w*0.44,0.68,0.93],[w*0.44,0.93,0.54],[-w*0.44,0.93,0.54]],glass);
          line([[0,0.67,0.92],[0,0.94,0.54]],tone(color,-0.22),0.026);
          volume([0,1.22,0.69],0.095,0.026,0.06,'#e2c76e');
        }
        if(id==='armored_car'){for(const side of [-1,1])line([[side*w*0.49,-0.55,0.55],[side*w*0.49,0.55,0.55]],steel,0.055);}
      }
      if(def.trailerLength){
        const trailerCenter=-len*0.7-def.trailerLength*0.5;
        limb([0,-len*0.52,0.45],[0,trailerCenter+def.trailerLength*0.48,0.45],0.06,0.045,steel);
        box(0,trailerCenter,0.53,w*0.92,def.trailerLength,0.67,tone(color,-0.2));
        box(0,trailerCenter,0.89,w*0.87,def.trailerLength*0.91,0.12,tone(color,-0.04));
        if(rearVisible)for(const side of [-1,1])volume([side*w*0.31,trailerCenter-def.trailerLength*0.51,0.58],0.05,0.025,0.045,'#b7453d');
      }
      lights(w,len*2,0.49);if(frontVisible)line([[-w*0.4,len+0.025,0.35],[w*0.4,len+0.025,0.35]],steel,0.07);
      if(rearVisible)line([[-w*0.4,-len-0.025,0.35],[w*0.4,-len-0.025,0.35]],steel,0.06);
      if(rearVisible)box(0,-len-0.025,0.37,0.22,0.025,0.09,'#bbb9a3');
      if(frontVisible)for(let i=0;i<4;i++)line([[-0.15+i*0.1,len+0.03,0.42],[-0.15+i*0.1,len+0.03,0.53]],'#353d3c',0.02);
      if(wreck){polygon([[-0.16,0.74,0.63],[0.24,0.9,0.64],[0.31,0.71,0.64],[0.1,0.65,0.64]],'#8c573b');line([[-0.1,0.41,0.98],[0.04,0.46,0.9],[0.08,0.37,0.86]],'#d0b58d',0.018);}
    });
  }
  const vehicleTurrets=[];
  if (def.weapon && !def.animal) {
    // Крепления соответствуют корпусу и виду техники. +Y — нос; -Y — корма.
    let pivot;
    if(def.walker) pivot=[0,0,def.walker==='elephant'?2.74:2.57];
    else if(id==='tank'||id==='light_tank') pivot=[0,-0.08,0.94];
    else if(id==='helicopter') pivot=[0,0.68,0.28]; // подвесная турель под носовой частью фюзеляжа
    else if(id==='plane') pivot=[0,0.9,0.43]; // сдвоенное носовое оружие Ил-2
    else if(id==='submarine') pivot=[0,1.12,0.48];
    else if(id==='deep_submarine') pivot=[0,1.52,0.58];
    else if(id==='boat') pivot=[0,0.78,0.76]; // носовая установка катера
    else if(id==='bus') pivot=[0,-1.08,0.92]; // небольшая задняя пулемётная башенка
    else if(id==='truck') pivot=[0,-0.72,0.9]; // открытый кузов пикапа
    else if(def.kind==='water') pivot=[0,-0.48,0.68];
    else if(def.fly) pivot=[0,0.48,0.52];
    else if(tracked) pivot=[0,-0.08,0.94];
    else if(armored) pivot=[0,-0.08,1.14];
    else if(id==='armored_car'||id==='car'||id==='sedan') pivot=[0,-0.48,0.91];
    else pivot=[0,0,0.98];
    const [px,py,pz]=pivot;
    const platformScale=id==='tank'?1:id==='light_tank'?0.82:id==='helicopter'?0.58:id==='plane'?0.62:(id==='submarine'||id==='deep_submarine')?0.62:id==='truck'?0.68:id==='boat'?0.58:id==='bus'?0.5:armored?0.78:0.74;
    const worldAngle = ((Number.isInteger(v.turretDir) ? v.turretDir : 0) % 8) * Math.PI / 4;
    const localAngle = worldAngle - heading;
    const length = (def.weapon.item === 'launcher_boom' ? 1.02 : def.tracked || armored ? 0.92 : 0.72)*platformScale;
    const end = [pivot[0] + Math.sin(localAngle) * length, pivot[1] + Math.cos(localAngle) * length, pivot[2] + (id==='helicopter' ? -0.035 : id==='plane' ? -0.02 : def.fly ? 0.02 : 0.035)];
    // Сортируем башню по глубине корпуса, а не рисуем поверх всех объектов сцены.
    paint(Math.max(0,depth(pivot))+0.002, () => {
      const mount = (tracked ? 0.31 : def.walker ? 0.31 : 0.25)*platformScale;
      volume(pivot, mount, mount * 0.9, 0.13, wreck ? '#514942' : tone(color, -0.2));
      if(tracked){
        const footprint=id==='tank'?0.76:platformScale;
        const rotate = (xx,yy,zz) => [pivot[0]+Math.cos(localAngle)*xx+Math.sin(localAngle)*yy,pivot[1]-Math.sin(localAngle)*xx+Math.cos(localAngle)*yy,zz];
        const bottom=[[-0.43,-0.49],[0.43,-0.49],[0.43,0.49],[-0.43,0.49]].map(([xx,yy])=>rotate(xx*footprint,yy*footprint,pz-0.16*footprint));
        const top=bottom.map(p=>[pivot[0]+(p[0]-pivot[0])*0.82,pivot[1]+(p[1]-pivot[1])*0.82,pz+0.16*footprint]);
        for(const i of [0,1,2,3].filter(i=>depth([(bottom[i][0]+bottom[(i+1)%4][0])/2,(bottom[i][1]+bottom[(i+1)%4][1])/2,0])>depth(pivot)).sort((a,b)=>depth(bottom[a])-depth(bottom[b]))){const j=(i+1)%4;polygon([bottom[i],bottom[j],top[j],top[i]],tone(color,-0.2));}
        polygon(top,tone(color,0.05));
        volume([pivot[0],pivot[1]-0.04*footprint,pz+0.18*footprint],0.17*footprint,0.17*footprint,0.025*footprint,tone(color,-0.12));
        line([rotate(-0.19*footprint,-0.12*footprint,pz+0.2*footprint),rotate(0.19*footprint,-0.12*footprint,pz+0.2*footprint)],tone(color,0.2),0.022*footprint);
      }else volume([pivot[0], pivot[1], pivot[2] + 0.095], mount * 0.73, mount * 0.7, 0.11, wreck ? '#66574b' : tone(color, 0.08));
      limb(pivot, end, (def.weapon.item === 'launcher_boom' ? 0.09 : 0.065)*platformScale, (def.weapon.item === 'launcher_boom' ? 0.075 : 0.045)*platformScale, wreck ? '#443f3a' : steel);
      const tip=project(end),muzzle={dx:(tip[0]-x)/originalUnit,dy:(tip[1]-y)/originalUnit,height:end[2]*scale[2]*size,alt};
      muzzlePositions.set(v,{...(muzzlePositions.get(v)||{}),front:muzzle});vehicleTurrets.push({at:pivot,end,muzzle});
      volume(end, 0.075*platformScale, 0.075*platformScale, 0.065*platformScale, wreck ? '#514942' : '#252d32');
    });
  }
  if(def.rearWeapon&&!def.animal){
    const rp=id==='plane'?[0,-0.42,0.82]:(id==='submarine'||id==='deep_submarine')?[0,-1.32,0.68]:id==='boat'?[0,-0.82,0.75]:[0,-0.82,0.72];
    const direction=((Number.isInteger(v.rearTurretDir)?v.rearTurretDir:4)%8)*Math.PI/4-heading;
    const scale=id==='plane'?0.56:(id==='submarine'||id==='deep_submarine')?0.56:0.54;
    const length=(def.rearWeapon.item==='launcher_boom'?0.55:0.4)*scale;
    const tip=[rp[0]+Math.sin(direction)*length,rp[1]+Math.cos(direction)*length,rp[2]+0.015];
    paint(Math.max(0,depth(rp))+0.003,()=>{
      // Компактная кормовая установка с ограниченным задним сектором наведения.
      volume(rp,0.12*scale,0.12*scale,0.075*scale,tone(color,-0.2));
      if(id==='plane'){
        polygon([[-0.12,-0.58,0.72],[0.12,-0.58,0.72],[0.1,-0.3,1.01],[-0.1,-0.3,1.01]],steel);
        volume([0,rp[1]-0.03,rp[2]+0.12],0.11*scale,0.09*scale,0.08*scale,steel);
      }
      limb(rp,tip,0.045*scale,0.035*scale,steel);
      volume(tip,0.045*scale,0.045*scale,0.04*scale,'#252d32');
      const screenTip=project(tip),muzzle={dx:(screenTip[0]-x)/originalUnit,dy:(screenTip[1]-y)/originalUnit,height:tip[2]*scale[2]*size,alt};
      muzzlePositions.set(v,{...(muzzlePositions.get(v)||{}),rear:muzzle});vehicleTurrets.push({at:rp,end:tip,muzzle});
    });
  }
  rig.flush();
  if(moving&&!wreck&&def.kind==='land'&&!small){ctx.save();ctx.globalAlpha=0.18;for(let i=0;i<3;i++){const p=project([(i%2?1:-1)*0.35,-1.35-(time/450+i*0.3)%0.7,0.05]);ctx.fillStyle='#c4b39b';ctx.beginPath();ctx.ellipse(p[0],p[1],unit*(0.14+i*0.035),unit*0.07,0,0,TAU);ctx.fill();}ctx.restore();}
  ctx.restore();
}
