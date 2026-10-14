import { animeBrush } from './anime-figure.js';
import { drawSwimming } from './swim-art.js';
import {drawDragonHead} from './dragon-head.js';
import { actorPose, isoRig, drawHumanoid, tone, shadow, digitigradeLeg, humanoidLeg } from './figure-art.js';
import { gaitFoot, legIK, strideFor } from './gait.js';
import { wave } from './figure-memo.js';
import { drawBeast, beastKind, drawWalkerBot } from './creature-mesh.js';
import { meshRig, M_TO_UNIT } from './mesh-art.js';
import { EXTRA } from './vehicle-mesh-extra.js';
// Шаг всех существ — gait.js: опорная стопа стоит на земле, ноги поочерёдно (ART.md §3)
const HALF=strideFor(13.5);
const TAU=Math.PI*2;

// Архетип силуэта по id/семейству (figure-art.js, ARCH): зомби горбится и тянет руки, ниндзя — капюшон,
// маска и шарф, маг — мантия и колпак, киборг — силовая броня и светящийся глаз, голем — каменные блоки
export function archetypeOf(e) {
  const id=e.def&&e.def.id||e.type||'', lk=e.look||{}, fam=e.def&&e.def.family||'';
  if(lk.shape==='zombie') return 'zombie';
  if(lk.shape==='cyborg') return 'cyborg';
  const pairs=[[/golem/,'golem'],[/droid|android|robot/,'droid'],[/ninja|shinobi|assassin/,'ninja'],[/samurai|ronin/,'samurai'],[/predator|hunter|yautja/,'hunter'],[/cannibal/,'cannibal'],[/barbarian|berserk|savage/,'barbarian'],[/mage|wizard|witch|priest|shaman/,'mage'],[/raider|bandit/,'raider'],[/mutant/,'mutant']];
  for(const [re,a] of pairs) if(re.test(id)) return a;
  return fam==='mutant'?'mutant':fam==='mage'?'mage':null;
}

function humanoidLook(e) {
  const lk=e.look, id=e.def&&e.def.id||e.type||'', arch=archetypeOf(e);
  const robot=arch==='cyborg', zombie=arch==='zombie', mutant=arch==='mutant', metal=robot||arch==='droid', stone=arch==='golem';
  const bare=['barbarian','cannibal','golem'].includes(arch)||/brute/.test(id);
  const skin=metal?(arch==='droid'?'#c9a956':'#919ba2'):stone?'#7d7a72':zombie?'#8b9776':mutant?lk.color:arch==='cannibal'?'#9c6b4b':'#bd9478';
  const weapon=lk.weapon&&lk.weapon!=='none'?{shape:lk.weapon,color:robot?'#727f89':'#9aa1a2',color2:lk.color2||'#d4ba80',twoHanded:['rifle','shotgun','staff','halberd'].includes(lk.weapon)}:null;
  const armored=robot||/marauder|guard|soldier|knight|boss_raider|patriarch|samurai/.test(id);
  const hair=/thug|brute|zombie_bloated/.test(id)||metal||stone?null:zombie?'#4a4a3c':arch==='ninja'?null:'#39302a';
  const colors={skin,hair,armL:skin,armR:skin,legs:metal||stone||bare?skin:lk.color,underwear:metal||stone?skin:arch==='cannibal'||arch==='barbarian'?'#5a4030':lk.color2||'#544c40',wide:(lk.size||1)>1.2,body:zombie&&/bloated/.test(id)?'heavy':(lk.size||1)>1.3||bare?'muscular':'athletic',cyberEye:robot,scar:zombie||mutant,
    mohawk:/thug/.test(id),beard:/brute|boss_raider|barbarian/.test(id),hairStyle:arch==='barbarian'?'braids':undefined,longHair:arch==='barbarian'};
  return { arch, colors,
    look:{shirt:bare||metal?null:{color:lk.color,shape:'shirt'},pants:metal||stone?null:{color:tone(lk.color,-0.2),shape:'pants'},feet:bare?null:{color:robot?'#333d46':arch==='ninja'?'#202224':'#302c29',shape:'boots'},
      armor:armored?{color:lk.color,color2:lk.color2,power:robot}:arch==='droid'?{color:skin,color2:'#7fe0ff',shape:'plate'}:null,
      outer:arch==='mage'?{color:lk.color,shape:'robe'}:/raider_gunner|raider_sniper/.test(id)?{color:tone(lk.color,-0.1),shape:'jacket'}:null,
      head:arch==='ninja'?{color:lk.color,shape:'hood'}:/raider_sniper/.test(id)?{color:'#5d5a44',shape:'helmet'}:/raider_gunner/.test(id)?{color:lk.color2||'#7a3a2a',shape:'bandana'}:null,
      face:arch==='ninja'?{color:tone(lk.color,-0.15),shape:'mask'}:null,
      hands:robot?{color:'#3d464d'}:null,
      mainHand:weapon, ...outfitOver(e.outfit, lk, arch)} };
}

// Снаряжение врага поверх облика архетипа: пустые слоты не стирают облик, ткань (рубаха, штаны, плащ,
// головной убор, обувь) — в цветах врага, цвет материала предмета идёт в отделку; броня и оружие — как есть.
// Слоты, задающие силуэт архетипа (капюшон ниндзя, мантия мага, корпус киборга), не заменяются.
const KEEP={ninja:['head','face'],mage:['outer'],cyborg:['armor','pants','shirt'],droid:['armor','pants','shirt'],golem:['armor','shirt','pants','feet'],zombie:[],samurai:['armor']};
function outfitOver(outfit, lk, arch) {
  if(!outfit) return {};
  const cloth={shirt:lk.color,pants:tone(lk.color||'#555',-0.22),outer:tone(lk.color||'#555',-0.1),head:tone(lk.color||'#555',-0.15),back:tone(lk.color||'#555',-0.28),feet:'#302c29',hands:'#3a3430'};
  const keep=KEEP[arch]||[], out={};
  for(const [k,v] of Object.entries(outfit)){
    if(!v||keep.includes(k)) continue;
    out[k]=cloth[k]&&!v.power?{...v,color:cloth[k],color2:v.color}:v;
  }
  return out;
}

// Гранёные объёмы вместо градиентных эллипсов (ART.md §4): volume → многогранник, limb → гранёная кость
function facetRig(rig,fine){
  return rig;
}

export function drawCreature(ctx,e,x,y,u,time,forcedPose=null) {
  const lk=e.look||{},shape=lk.shape||'humanoid',id=e.def&&e.def.id||e.type||'', s=u*(lk.size||1),pose=forcedPose||actorPose(e,time);
  // Звери, машины, чудища в воде (swim-art.js); люди — через drawHumanoid (там гребки руками)
  if(e.swim&&!e._swimWrapped&&!['humanoid','cyborg','zombie','alien'].includes(shape)){
    e._swimWrapped=true;
    try{return drawSwimming(ctx,e.swim,x,y,s,time,e,(dy)=>drawCreature(ctx,e,x,y+dy,u,time,pose),{creature:true,size:shape==='dragon'?1.4:1});}
    finally{e._swimWrapped=false;}
  }
  ctx.save();ctx.globalAlpha*=e.alpha==null?1:e.alpha;
  if(e.flash>0) ctx.filter=`brightness(${1+e.flash*0.6})`;
  const death=e.deadAt?Math.max(0,Math.min(1,(time-e.deadAt)/520)):0;
  if(death){ctx.translate(x,y);ctx.rotate(death*(shape==='dragon'||shape==='quadruped'?0.25:1.1));ctx.scale(1,1-death*0.35);ctx.translate(-x,-y);}
  if(shape==='drone') {
    shadow(ctx,x,y,s,0.8,0.23);
    const rig=facetRig(isoRig(ctx,x,y,s,pose.angle),s>15),{paint,depth,volume,limb,line,ellipse}=rig;
    const c=lk.color||'#8395a2',a=lk.color2||'#65deff',flying=['quad','uav'].includes(lk.species),z=flying?1.65+Math.sin(time/330)*0.04:0.55;
    if(lk.species==='quad')for(const side of [-1,1])for(const end of [-1,1]){
      const p=[side*0.65,end*0.55,z];paint(depth(p),()=>{limb([0,0,z],p,0.045,0.035,c);ellipse(p,0.34,0.12,'#23394555');const angle=time/18+side;line([[p[0]-Math.cos(angle)*0.28,p[1]-Math.sin(angle)*0.28,z],[p[0]+Math.cos(angle)*0.28,p[1]+Math.sin(angle)*0.28,z]],'#b9d2db',0.025);});
    }
    if(lk.species==='uav')paint(0,()=>{volume([0,0,z],0.95,0.2,0.07,c);volume([0,-0.65,z],0.35,0.12,0.055,c);});
    if(lk.species==='tracked')for(const side of [-1,1])paint(depth([side*0.38,0,0.25]),()=>{volume([side*0.38,0,0.25],0.13,0.6,0.2,'#28323a');for(let i=-2;i<=2;i++)ellipse([side*0.49,i*0.2,0.25],0.07,0.08,'#77838b');});
    if(lk.species==='service')paint(0,()=>{volume([0,0,0.65],0.34,0.3,0.58,c);volume([0,0,1.28],0.33,0.3,0.18,'#d5e0e5');for(const side of [-1,1]){volume([side*0.43,0,0.38],0.09,0.15,0.36,c);volume([side*0.43,0.08,0.09],0.15,0.22,0.07,'#354b58');}ellipse([0,0.3,1.27],0.085,0.06,a);});
    else paint(0,()=>{volume([0,0,z],0.27,0.48,0.12,c);volume([0,0.48,z-0.06],0.13,0.13,0.09,'#243444');ellipse([0,0.59,z-0.03],0.07,0.05,a);limb([0,0,z-0.1],[0,0.4,z-0.13],0.035,0.025,'#303e47');});
    rig.flush();
  }else if(lk.species === 'horse') {
    // Дикая лошадь — та же модель, что у верховой (vehicle-mesh-extra.js), шаг по фазе actorPose
    shadow(ctx,x,y,u,1.25,0.38);
    const g=meshRig(ctx,x,y,u,pose.angle,1,'anime');
    EXTRA.horse(g,{id:'horse'},e,{color:lk.color||'#926d4f',moving:pose.move>0.05&&!e.deadAt,time,ph:pose.phase,half:strideFor(13.5)/M_TO_UNIT,wild:true,dist:0,phase:0,turretAngle:0,rearAngle:0});
    g.flush(Boolean(e.deadAt));
  }else if(['humanoid','cyborg','zombie','alien'].includes(shape)) {
    const look=humanoidLook(e);
    if(shape==='alien'){
      look.arch='hunter';look.colors={...look.colors,skin:lk.color||'#516773',hair:null,body:'slim',cyberEye:true,legs:lk.color||'#516773'};
      look.look={...look.look,armor:{color:lk.color||'#516773',color2:lk.color2||'#85d3d9',shape:'body_suit'},pants:{color:lk.color||'#516773'},feet:{color:tone(lk.color||'#516773',-.12)},face:{color:tone(lk.color||'#516773',-.1),shape:'mask'}};
    }
    if(e.familyColors)look.colors={...look.colors,...e.familyColors};
    if(shape==='zombie'){pose.strike=Math.max(pose.strike,0.16);pose.kind='melee';pose.active=true;}
    // дети в семье (companions-ui: look.size < 1) — крупная голова
    const young=e.familyColors&&(lk.size||1)<0.9?lk.size:0;
    drawHumanoid(ctx,{...e,...look,_sourceActor:e,scale:1,young},x,y,s,time,pose);
  }else {
    shadow(ctx,x,y,s,shape==='dragon'?1.3:shape==='quadruped'?0.9:0.7,0.28);
    const bob=pose.move?Math.cos(pose.phase*2)*0.022:wave(time,950,0.01,s); // покачивание на месте
    const rig=facetRig(isoRig(ctx,x,y-bob*s,s,pose.angle),s>15);
    const {paint,depth,polygon,line,ellipse,volume,limb,box}=rig;
    const c=lk.color||'#657569',accent=lk.color2||tone(c,0.2);
    const stride=Math.sin(pose.phase)*pose.move*0.28;
    if(shape==='quadruped') {
      if(id.includes('eel')){
        const points=Array.from({length:10},(_,i)=>[Math.sin(time/210+i*0.75)*0.16,-1.2+i*0.23,0.23+Math.sin(time/230+i*0.6)*0.04]);
        for(let i=0;i<9;i++)limb(points[i],points[i+1],0.07+i*0.009,0.08+i*0.009,c);
        volume([0,1,0.24],0.15,0.25,0.12,c);ellipse([-0.11,1.12,0.27],0.027,0.02,accent);
      }else if(beastKind(id)) drawBeast(ctx,e,x,y-bob*s,s,time,pose,beastKind(id));
      else {
        const bear=id.includes('bear'), boar=id.includes('boar'), mutant=id.includes('mutant');
        const top=bear?1.25:boar?0.91:0.92, bodyLen=bear?0.84:boar?0.8:0.84;
        for(const side of [-1,1])for(const end of [-1,1]){
          const g=gaitFoot(pose.phase,side*end>0?0:Math.PI,HALF,0.16,pose.move), hip=[side*0.27,end*0.55,top-0.2],foot=[side*0.29,end*0.6+g.dy,g.dz],{knee}=end>0?humanoidLeg(hip,foot):digitigradeLeg(hip,foot);
          paint(depth(hip),()=>{limb(hip,knee,bear?0.17:0.11,0.09,c);limb(knee,foot,0.1,0.06,c);volume([foot[0],foot[1]+0.06,foot[2]+0.035],0.105,0.16,0.065,tone(c,-0.25));});
        }
        paint(0,()=>{volume([0,-0.06,top-0.25],bear?0.43:0.32,bodyLen,0.35,c);volume([0,0.39,top-0.15],0.32,0.38,bear?0.43:0.32,tone(c,0.04));
          for(let i=0;i<8;i++)line([[-0.13+(i%3)*0.12,-0.53+i*0.13,top+0.02],[0.03+(i%3)*0.1,-0.47+i*0.13,top-0.09]],tone(c,-0.16),0.023);
          if(mutant)for(let i=0;i<4;i++)polygon([[-0.13,-0.5+i*0.23,top],[0.13,-0.5+i*0.23,top],[0,-0.55+i*0.23,top+0.25]],accent);
          if(!bear&&!boar){limb([0,-0.79,top-0.22],[0.12*Math.sin(time/330),-1.25,top-0.48],0.1,0.035,c);}
        });
        paint(depth([0,0.83,0])+0.05,()=>{
          const head=[0,0.77+pose.strike*0.19,top+(bear?0.03:0.02)];volume(head,bear?0.29:0.23,0.3,bear?0.26:0.2,c);
          volume([0,head[1]+0.28,head[2]-0.07],boar?0.2:0.12,boar?0.19:0.23,0.11,boar?tone(c,0.2):tone(c,-0.05));
          volume([0,head[1]+0.44,head[2]-0.06],0.085,0.07,0.045,'#252625');
          for(const side of [-1,1]){polygon([[side*0.16,head[1]-0.1,top+0.12],[side*0.25,head[1]-0.19,top+0.18],[side*0.19,head[1]-0.06,top+(bear?0.29:0.42)]],tone(c,-0.1));ellipse([side*0.18,head[1]+0.14,top+0.06],0.027,0.026,mutant?'#ebcc75':'#bca35e');if(boar)limb([side*0.16,head[1]+0.27,top-0.14],[side*0.2,head[1]+0.43,top+0.08],0.045,0.01,'#d7d0b6');}
        });
      }
    }else if(['ant','spider','scorpion','mantis'].includes(shape)) {
      const mantis=shape==='mantis', crab=id.includes('crab'), legs=shape==='spider'?4:3;
      for(const side of [-1,1])for(let i=0;i<legs;i++){
        // попеременные треножники: соседние ноги и пары слева/справа — в противофазе
        const z=mantis?0.65:0.34, y0=(i-(legs-1)/2)*0.24, g=gaitFoot(pose.phase,((i+(side>0?1:0))%2)*Math.PI,HALF*0.55,0.1,pose.move);
        const a=[side*0.18,y0,z],b=[side*(0.53+Math.sin(i)*0.09),y0+g.dy*0.6,z*0.8+g.dz],d=[side*(0.76+Math.sin(i)*0.1),y0+g.dy-0.17,0.015+g.dz];
        paint(depth(b),()=>{limb(a,b,0.05,0.035,c);limb(b,d,0.035,0.014,tone(c,-0.18));ellipse(b,0.048,0.036,accent);});
      }
      paint(0,()=>{
        volume([0,-0.27,mantis?0.95:0.38],shape==='spider'?0.35:0.26,shape==='scorpion'?0.43:0.37,0.24,c);
        volume([0,0.12,mantis?1.18:0.4],0.22,0.27,mantis?0.45:0.19,tone(c,0.06));
        for(let i=0;i<4;i++)line([[-0.2,-0.51+i*0.15,0.5],[0,-0.55+i*0.15,0.61],[0.2,-0.51+i*0.15,0.5]],tone(c,-0.27),0.025);
        if(shape==='scorpion'&&!crab){const pts=[[0,-0.6,0.36],[0,-0.85,0.6],[0,-0.97,0.99],[0,-0.85,1.34],[0,-0.58,1.45],[0,-0.42,1.3-pose.strike*0.4]];for(let i=0;i<pts.length-1;i++){limb(pts[i],pts[i+1],0.11-i*0.014,0.09-i*0.014,c);ellipse(pts[i],0.09,0.065,accent);} }
      });
      paint(depth([0,0.45,0])+0.03,()=>{
        const hz=mantis?1.8:0.42;volume([0,0.43,hz],mantis?0.27:0.18,0.17,0.16,c);
        for(const side of [-1,1]){ellipse([side*0.15,0.49,hz+0.04],0.06,0.045,accent);line([[side*0.08,0.45,hz+0.1],[side*0.18,0.67,hz+0.32]],tone(c,-0.22),0.022);
          if(mantis||shape==='scorpion'){
            const a=[side*0.17,0.17,mantis?1.25:0.34],b=[side*0.45,0.53,mantis?1.12:0.39],tip=[side*(0.54-pose.strike*0.15),0.94+pose.strike*0.3,mantis?1.5-pose.strike*0.7:0.35];
            limb(a,b,0.08,0.065,c);limb(b,tip,0.07,0.035,c);polygon([tip,[tip[0]+side*0.14,tip[1]+0.2,tip[2]+0.08],[tip[0],tip[1]+0.25,tip[2]-0.06]],accent);
          }
        }
      });
    }else if(shape==='walker'){
      // робот на «куриных» ногах: колени назад (модель «Страйдера»)
      drawWalkerBot(ctx,e,x,y,s,time,pose,EXTRA.chicken_walker);
    }else if(shape==='dragon'){
      const pen=animeBrush(ctx,s,rig.project,tone);
      const sw=e.swim, flap=sw==='dive'?Math.sin(time/700)*0.6-0.4:sw?Math.sin(time/900)*0.15-0.55:Math.sin(time/330), hover=sw?0:e.def&&e.def.fly?0.15:0; // в воде крылья сложены (плывёт) или гребут (ныряет)
      const wing=(side)=>{
        const root=[side*0.24,-0.08,1.05+hover],elbow=[side*0.85,-0.12,1.72+flap*0.2+hover],tip=[side*1.6,-0.55,1.55+flap*0.45+hover],end=[side*1.08,-0.91,0.67+hover];
        pen.contour([root,elbow,tip,[side*1.33,-0.63,1.1+flap*0.3+hover],end,[side*0.74,-0.71,0.81+hover],[side*0.53,-0.78,0.65+hover]].map(rig.project),tone(accent,side<0?-.18:.02));line([root,elbow,tip],tone(c,0.18),0.055);line([root,tip],tone(c,-0.15),0.027);line([root,end],tone(c,-0.15),0.026);for(let j=1;j<4;j++)line([elbow,[side*(0.58+j*0.22),-0.82,0.68+j*0.08+hover]],tone(c,-0.2),0.018);
      };
      for(const side of [-1,1])paint(depth([side,0,0])-0.1,()=>wing(side));
      paint(-0.8,()=>{const pts=[[0,-0.6,0.62+hover],[0.09,-0.96,0.51+hover],[Math.sin(time/440)*0.16,-1.36,0.32+hover],[Math.sin(time/440)*0.24,-1.7,0.24+hover]];pen.chain(pts,[.16,.12,.065,.012],c);});
      paint(0,()=>{volume([0,-0.06,0.86+hover],0.43,0.76,0.44,c);line([[-.18,.42,.68+hover],[0,.50,.62+hover],[.18,.42,.68+hover]],tone(c,.12),.02);for(let i=0;i<5;i++)polygon([[-0.07,-0.61+i*0.19,1.17+hover],[0.07,-0.61+i*0.19,1.17+hover],[0,-0.7+i*0.19,1.4+hover]],tone(accent,-0.05));});
      // Four independent legs; wings are an additional pair of limbs.
      for(const side of [-1,1])for(const end of [-1,1]){
        const g=gaitFoot(pose.phase,side*end<0?Math.PI:0,HALF*0.8,0.14,pose.move),step=g.dy,lift=g.dz;
        const hip=[side*0.32,end*0.46,0.83+hover],foot=[side*0.43,end*0.53+step,0.04+hover+lift],{knee,ankle}=digitigradeLeg(hip,foot);
        paint(depth(hip)+0.02,()=>{pen.chain([hip,knee,ankle,foot],[end<0?.17:.13,.095,.06,.055],c);volume(foot,.10,.15,.05,tone(c,-.14));for(let j=-1;j<=1;j++)limb([foot[0]+j*0.065,foot[1]+0.07,foot[2]],[foot[0]+j*0.08,foot[1]+0.2,foot[2]-0.01],0.02,0.004,'#e6dcc4');});
      }
      drawDragonHead(rig,c,accent,hover,pose.strike,time,s);
    }
    rig.flush();
  }
  if(lk.crown){ ctx.fillStyle='#d9b965';ctx.strokeStyle='#43392a';ctx.lineWidth=Math.max(0.5,u*0.025);const h=y-u*(shape==='dragon'?2.4:3.3)*(lk.size||1)-u*0.12;ctx.beginPath();ctx.moveTo(x-u*0.22,h);ctx.lineTo(x-u*0.25,h-u*0.22);ctx.lineTo(x-u*0.1,h-u*0.12);ctx.lineTo(x,h-u*0.29);ctx.lineTo(x+u*0.1,h-u*0.12);ctx.lineTo(x+u*0.25,h-u*0.22);ctx.lineTo(x+u*0.22,h);ctx.closePath();ctx.fill();ctx.stroke(); }
  ctx.restore();
}
