import { gaitFoot, legIK, strideFor } from './gait.js';
import { drawSwimming, strokeArm, kickFoot } from './swim-art.js';
import { drawEquipmentAura } from './equipment-aura.js';
import { wave, muzzles } from './figure-memo.js';
const TAU=Math.PI*2;
export function animeBrush(ctx,unit,project,tone){
 const shade=(color,points,contrast=.16)=>{
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),gr=ctx.createLinearGradient(Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys));
  gr.addColorStop(0,tone(color,.07));gr.addColorStop(.45,color);gr.addColorStop(.70,tone(color,-contrast));gr.addColorStop(1,tone(color,-contrast*.8));return gr;
 };
 const contour=(points,color,ink=true)=>{
  if(points.length<3)return;ctx.beginPath();ctx.moveTo(...points[0]);
  for(let i=0;i<points.length;i++){
   const a=points[(i+points.length-1)%points.length],b=points[i],d=points[(i+1)%points.length],e=points[(i+2)%points.length];
   ctx.bezierCurveTo(b[0]+(d[0]-a[0])/6,b[1]+(d[1]-a[1])/6,d[0]-(e[0]-b[0])/6,d[1]-(e[1]-b[1])/6,d[0],d[1]);
  }
  ctx.closePath();ctx.fillStyle=shade(color,points);ctx.fill();
  if(ink&&unit>17){ctx.strokeStyle=tone(color,-.32);ctx.lineWidth=Math.max(.35,unit*.008);ctx.lineJoin='round';ctx.stroke();}
 };
 const chain=(points,radii,color,ink=true)=>{
  const ps=points.map(project),left=[],right=[];
  ps.forEach((p,i)=>{const prev=ps[Math.max(0,i-1)],next=ps[Math.min(ps.length-1,i+1)],dx=next[0]-prev[0],dy=next[1]-prev[1],len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len,r=radii[i]*unit;left.push([p[0]+nx*r,p[1]+ny*r]);right.push([p[0]-nx*r,p[1]-ny*r]);});
  contour([...left,...right.reverse()],color,ink);
 };
 const shell=(rings,color,ink=true)=>{
  const left=[],right=[];
  for(const [z,rx,ry,cy] of rings){const center=project([0,cy,z]),a=project([rx,cy,z]),b=project([0,cy+ry,z]),ax=a[0]-center[0],ay=a[1]-center[1],bx=b[0]-center[0],by=b[1]-center[1],t=Math.atan2(bx,ax),dx=Math.cos(t)*ax+Math.sin(t)*bx,dy=Math.cos(t)*ay+Math.sin(t)*by;left.push([center[0]-dx,center[1]-dy]);right.push([center[0]+dx,center[1]+dy]);}
  contour([...left,...right.reverse()],color,ink);
 };
 return {contour,chain,shell};
}

// Anatomy is drawn as continuous inked contours, not articulated pieces or mesh primitives.
export function renderAnimeHumanoid(ctx,actor,x,y,unit,time,forcedPose,helpers){
 const {actorPose,isoRig,tone,shadow,drawWeapon}=helpers;
 if(actor.swim&&!actor._swimWrapped){actor._swimWrapped=true;try{return drawSwimming(ctx,actor.swim,x,y,unit*(actor.scale||1),time,actor._sourceActor||actor,dy=>renderAnimeHumanoid(ctx,actor,x,y+dy,unit,time,forcedPose,helpers));}finally{actor._swimWrapped=false;}}
 const pose=forcedPose||actorPose(actor,time),c=actor.colors||{},look=actor.look||{},arch=actor.arch||'',scale=actor.scale||1;
 if(actor.vehicleCockpit&&Number.isFinite(actor.facingAngle))pose.angle=actor.facingAngle;
 const young=actor.young||(scale<.9?scale:0),headK=young?1+(1-young)*.9:1,female=Boolean(c.female),adultFemale=female&&!young;
 const heavy=c.body==='heavy',muscular=c.body==='muscular'||c.wide,power=Boolean(look.armor?.power||look.armor?.shape==='power_armor');
 const shoulder=(heavy?.40:muscular?.39:adultFemale?.31:.35)*(power?1.13:1),hip=heavy?.37:adultFemale?.32:.29,waist=heavy?.35:adultFemale?.215:.265;
 const skin=c.skin||'#c9a58d',garment=look.armor||look.outer||look.shirt,cloth=garment?.color||skin,pants=look.pants?.color||c.legs||skin;
 const metallic=['cyborg','droid','golem'].includes(arch)||power,accent=look.armor?.color2||(['cyborg','droid'].includes(arch)?'#79cdd5':'#85adb2');
 const swimming=actor.swim&&!String(actor.swim).startsWith('seabed'),flight=Boolean((look.wings||look.jetpack)&&actor.alt>0&&!actor.seated&&!actor.mounted),walk=swimming||flight?0:pose.move;
 const half=strideFor(actor.sprint?10.5:13.5),steps={1:gaitFoot(pose.phase,0,half,actor.sprint?.26:.18,walk),'-1':gaitFoot(pose.phase,Math.PI,half,actor.sprint?.26:.18,walk)};
 const hunch=arch==='zombie'?.12:pose.stun?.035:0,lean=pose.strike*.10-pose.hurt*.09+(actor.sprint?.07:0);
 const leanAt=z=>lean*(z-1.45)+hunch*Math.max(0,z-1.5);
 unit*=scale;const ride=actor.seated&&actor.ride;
 if(actor.seated&&!ride)y+=unit*.3;if(actor.mounted)y-=unit*.65;
 if(ride){const k=3.3/1.75,ly=(ride.y||0)*k,ca=Math.cos(pose.angle),sa=Math.sin(pose.angle);x+=(ca-sa)*ly*unit*.78;y+=(ca+sa)*ly*unit*.39-unit*(ride.z*k-1.43);if(ride.cockpit)y-=unit*.42;}
 ctx.save();if(actor.stealth)ctx.globalAlpha*=.42;if(actor.dead){ctx.translate(x,y);ctx.rotate(-1.27);ctx.translate(-x,-y);}
 if(!ride)shadow(ctx,x,y,unit,.49,.19);if(flight)y-=unit*(.8+Math.min(10,actor.alt)*.1);
 const bob=walk?Math.sin(pose.phase*2)*.016*walk:wave(time,950,.008,unit);
 const rig=isoRig(ctx,x,y-unit*bob,unit,ride&&Number.isFinite(ride.angle)?pose.angle+ride.angle:pose.angle),{project,paint,depth,line,ellipse}=rig;
 const frontness=(Math.cos(pose.angle)+Math.sin(pose.angle))/Math.SQRT2,back=frontness<-.12,profile=(Math.cos(pose.angle)-Math.sin(pose.angle))/Math.SQRT2;
 const {contour,chain,shell}=animeBrush(ctx,unit,project,tone);
 const detail=(points,color,width=.012)=>line(points,color,width);
 // Rear garments and equipment sit behind the complete figure.
 if(look.back&&!['jetpack','wings'].includes(look.back.shape))paint(-2,()=>{
  const sway=walk?wave(time,260,.05,unit):0,cc=look.back.color;
  shell([[.65,shoulder*.9,.13,-.20-sway],[1.05,shoulder*1.05,.12,-.23],[2.18,shoulder,.10,-.19],[2.46,shoulder*.65,.08,-.12]],cc);
 });
 if(look.backpack||look.jetpack)paint(-1,()=>{const col=(look.jetpack||look.backpack).color||'#3c4f5a';shell([[1.65,.23,.15,-.30],[2.25,.25,.16,-.30],[2.39,.18,.10,-.27]],col);if(look.jetpack)for(const side of [-1,1]){chain([[side*.2,-.34,1.65],[side*.2,-.34,2.29]],[.07,.08],tone(col,.08));if(flight)ellipse([side*.2,-.34,1.6],.06,.12,'#8fdde2');}});
 if(look.wings)for(const side of [-1,1])paint(-2,()=>{
  const flap=flight?Math.sin(time/280)*.20:wave(time,900,.02,unit),span=flight?1.35:.65,z=2.25;
  const points=[[side*.14,-.17,z],[side*.6,-.28,z+.25+flap],[side*span,-.4,z+.08+flap],[side*.85,-.35,z-.62],[side*.23,-.2,z-.35]];
  contour(points.map(project),look.wings.color||'#c4d1d5');for(let i=0;i<4;i++)detail([[side*(.35+i*.15),-.28,z+.08],[side*(.45+i*.12),-.32,z-.36]],look.wings.color2||'#71868e',.012);
 });
 for(const side of [-1,1]){
  const st=steps[side],hipPoint=[side*hip*.61,leanAt(1.43),1.43],foot=[side*.17,st.dy,st.dz];
  if(actor.seated||actor.mounted){foot[0]=side*.29;foot[1]=.28;foot[2]=.4;}
  if(swimming){const kick=kickFoot(actor.swim,side,time);foot[1]=kick.dy;foot[2]=kick.dz;}
  if(ride?.pedal){const t=time/120*(actor.moving?1:0)+(side<0?Math.PI:0);foot[1]=.12+Math.sin(t)*.12;foot[2]=.42+Math.cos(t)*.12;}
  const ankle=[foot[0],foot[1]-.025,foot[2]+.11],knee=legIK(hipPoint,ankle,.67,.67,1);
  const thigh=hipPoint.map((v,k)=>v*.58+knee[k]*.42),calf=knee.map((v,k)=>v*.45+ankle[k]*.55);
  paint(depth(hipPoint),()=>{
   const legColor=pants;chain([hipPoint,thigh,knee,calf,ankle],[adultFemale?.145:.135,adultFemale?.14:.13,.085,.092,.058],legColor);
   if(look.feet){chain([calf,ankle,[foot[0],foot[1]+.05,foot[2]+.06]],[.087,.064,.065],look.feet.color);}
   const fc=look.feet?.color||skin;
   contour([[foot[0]-.06,foot[1]-.09,foot[2]+.13],[foot[0]+.06,foot[1]-.09,foot[2]+.13],[foot[0]+.075,foot[1]+.16,foot[2]+.055],[foot[0],foot[1]+.23,foot[2]+.035],[foot[0]-.075,foot[1]+.16,foot[2]+.035]].map(project),fc);
   if(look.pants||metallic)detail([[hipPoint[0]+side*.045,hipPoint[1]+.085,1.25],[knee[0]+side*.035,knee[1]+.06,knee[2]+.08],[ankle[0]+side*.025,ankle[1]+.03,ankle[2]+.12]],tone(legColor,.12),.01);
   if(!look.pants&&!metallic){const shorts=c.underwear||'#39454d';chain([hipPoint,thigh],[.14,.125],shorts);}
  });
 }
 const robe=[look.outer,look.armor].find(v=>v&&['robe','coat'].includes(v.shape));
 const rings=[[look.armor?1.16:1.25,hip*(look.armor?.35:.86),.14,leanAt(1.25)],[1.30,hip*.86,.15,leanAt(1.30)],[1.43,hip,.155,leanAt(1.43)],[1.66,waist,.135,leanAt(1.66)],[1.88,waist*1.05,.15,leanAt(1.88)],[2.14,shoulder*.84,adultFemale?.19:.17,leanAt(2.14)],[2.34,shoulder*.97,.15,leanAt(2.34)],[2.42,shoulder,.125,leanAt(2.42)],[2.49,shoulder*.6,.10,leanAt(2.49)],[2.53,.105,.08,leanAt(2.53)]];
 paint(.01,()=>{
  shell(rings,cloth);
  if(!garment)shell([[1.25,hip*.87,.15,leanAt(1.25)],[1.42,hip,.16,leanAt(1.42)],[1.49,waist*1.03,.14,leanAt(1.49)]],c.underwear||'#39454d');
  if(robe)shell([[.48,hip*1.3,.20,-walk*.05],[.8,hip*1.13,.17,0],[1.46,hip*1.04,.16,leanAt(1.46)],[1.85,waist*1.06,.15,leanAt(1.85)]],robe.color);
  const sign=back?-1:1,front=z=>leanAt(z)+sign*(adultFemale&&z>2?.19:.16);
  if(garment){
   // Seams follow the chest and waist instead of forming separate chest/abdominal plates.
   for(const side of [-1,1])detail([[side*shoulder*.67,front(2.36),2.36],[side*waist*.82,front(1.96),1.96],[side*waist*.90,front(1.64),1.64],[side*hip*.78,front(1.37),1.37]],tone(cloth,-.24),.01);
   detail([[-.095,front(2.48),2.48],[0,front(2.42),2.42],[.095,front(2.48),2.48]],tone(cloth,-.28),.018);
   if(look.armor||metallic){detail([[-shoulder*.6,front(2.29)+sign*.005,2.29],[0,front(2.17)+sign*.005,2.17],[shoulder*.6,front(2.29)+sign*.005,2.29]],tone(cloth,.18),.016);if(!back)detail([[.06,front(2.34),2.34],[.16,front(2.34),2.34]],accent,.014);}
   else detail([[0,front(2.36),2.36],[0,front(1.58),1.58]],tone(cloth,-.17),.009);
   if(!back&&unit>15){
    for(const side of [-1,1]){
     const points=[[side*shoulder*.76,front(2.28)+.007,2.28],[side*waist*.73,front(1.91)+.007,1.91],[side*waist*.79,front(1.63)+.007,1.63],[side*hip*.66,front(1.38)+.007,1.38]];
     detail(points,tone(cloth,.12),.018);detail([[side*shoulder*.62,front(2.33)+.008,2.33],[side*shoulder*.39,front(2.25)+.008,2.25]],accent,.01);
    }
   }
  }else if(!back){
   detail([[-.19,front(2.31),2.31],[-.07,front(2.27),2.27]],tone(skin,-.16),.01);detail([[.19,front(2.31),2.31],[.07,front(2.27),2.27]],tone(skin,-.16),.01);
   if(!young)detail([[0,front(1.93),1.93],[0,front(1.73),1.73]],tone(skin,-.10),.007);
  }
  if(c.tattoos?.length&&!back&&!garment){detail([[-.10,front(2.24),2.24],[-.15,front(2.03),2.03],[-.10,front(1.89),1.89]],'#526c70',.018);}
  if(look.belt){detail([[-hip*.8,front(1.48),1.48],[hip*.8,front(1.48),1.48]],look.belt.color,.045);}
 });
 // One continuous sleeve from shoulder through elbow to wrist; no ball joints or floating cuffs.
 for(const side of [-1,1]){
  const shoulderPoint=[side*shoulder*.88,leanAt(2.37),2.37];let elbow=[side*(shoulder+.04),-steps[side].dy*.22,1.96],hand=[side*(shoulder+.04),-steps[side].dy*.7,1.51];
  const main=side>0,weapon=main?look.mainHand:look.offHand,two=look.mainHand?.twoHanded,range=pose.kind==='ranged'&&Boolean(weapon||two),attackingHand=(actor.attackHand||'mainHand')===(main?'mainHand':'offHand');
  if(swimming){const p=strokeArm(actor.swim,side,shoulder,time,actor.moving||pose.move>.05);elbow=p.elbow;hand=p.hand;}
  else if(range){elbow=[side*(shoulder+.04),.15,2.04];hand=[side*.14,.57-pose.wind*.06,2.15];}
  else if(pose.cast){elbow=[side*(shoulder+.1),.1,2.1];hand=[side*.48,.25,2.54];}
  else if(pose.action){elbow=[side*(shoulder+.02),.1,1.98];hand=pose.actionKind==='consume'?[side*.12,.2,1.6+pose.action*1.1]:[side*.20,.15+pose.action*.3,1.6+pose.action*.3];}
  else if(pose.active&&attackingHand){elbow=[side*(shoulder+.06),.12,2.05+pose.wind*.12];hand=[side*(.29+pose.wind*.22-pose.strike*.13),.04+pose.strike*.7,1.85+pose.wind*.55];}
  else if(arch==='zombie'){elbow=[side*(shoulder+.03),.24,2.13];hand=[side*.23,.62,2.08];}
  const upper=shoulderPoint.map((v,k)=>v*.55+elbow[k]*.45),lower=elbow.map((v,k)=>v*.5+hand[k]*.5),sleeved=Boolean(garment&&!(look.armor?.shape==='vest'&&!look.shirt&&!look.outer)),armColor=sleeved?cloth:(side<0?c.armL:c.armR)||skin;
  paint(depth(hand)*.6+depth(shoulderPoint)*.4,()=>{
   chain([shoulderPoint,upper,elbow,lower,hand],[.115,.10,.072,.079,.052].map(v=>v*(power?1.18:1)),armColor);
   if(look.armor||metallic)detail([[upper[0],upper[1]+.055,upper[2]],[elbow[0],elbow[1]+.04,elbow[2]],[hand[0],hand[1]+.03,hand[2]+.04]],tone(armColor,.18),.01);
   const hc=look.hands?.color||skin,end=[hand[0],hand[1]+.018,hand[2]-.115];chain([hand,[hand[0],hand[1]+.01,hand[2]-.06],end],[.052,.057,.034],hc);
   if(weapon&&!pose.action){const muzzle=drawWeapon(rig,weapon,hand,pose,actor,unit,time,main?'mainHand':'offHand');if(muzzle){const origin=project([0,0,0]),tip=project(muzzle),source=actor._sourceActor||actor,origins=muzzles.get(source)||{};origins[main?'mainHand':'offHand']={dx:(tip[0]-origin[0])/unit,dy:(tip[1]-origin[1])/unit,scale,height:muzzle[2],angle:actor.attackAngle??pose.angle};muzzles.set(source,origins);}}
   if(pose.cast)ellipse(hand,.10,.09,actor.castColor||'#8bdee2');
  });
 }
 paint(.4,()=>{
  const headZ=2.90-hunch*.30+(headK-1)*.10,headY=leanAt(headZ),center=project([0,headY,headZ]),rx=unit*({round:.23,square:.225,narrow:.195,heart:.22,angular:.215}[c.face]||.215)*headK,ry=unit*.285*headK;
  const headColor=look.head?.shape==='helmet_full'?look.head.color:skin;
  chain([[0,leanAt(2.47),2.47],[0,headY,headZ-.20*headK]],[.09,.076],skin,false);
  const hp=(a,b)=>[center[0]+a*rx,center[1]+b*ry],faceShift=profile*.22;
  const headPoints=[hp(-.86,-.45),hp(-.65,-.9),hp(0,-1),hp(.65,-.9),hp(.86,-.45),hp(.88,.15),hp(.62,.60),hp(faceShift,.94),hp(-.62,.60),hp(-.88,.15)];
  const hair=c.hair&&c.hairStyle!=='bald'?c.hair:null,longHair=Boolean(c.longHair||['long','braids','dreads','ponytail'].includes(c.hairStyle));
  if(hair&&longHair){const sway=walk?wave(time,250,.04,unit):0;
   if(c.hairStyle==='ponytail')contour([hp(.45,-.7),hp(1.1,-.3),hp(1.22,.65),hp(1.15,1.5+sway),hp(.82,1.86+sway),hp(.88,.68),hp(.6,.25)],hair);
   else for(const side of [-1,1])contour([hp(side*.73,-.63),hp(side*1.03,.1),hp(side*.96,1.35+sway),hp(side*.65,1.65+sway),hp(side*.61,.40)],hair);
  }
  if(look.head?.shape==='hood')contour([hp(-1.2,-.4),hp(-.8,-1.15),hp(.5,-1.2),hp(1.18,-.3),hp(1.12,.96),hp(-1.05,1.02)],look.head.color);
  contour(headPoints,headColor);
  if(!back&&look.head?.shape!=='helmet_full'){
   const visibility=Math.max(.25,Math.min(1,frontness+.35)),eyeY=-.03,eyeSpan=.47,iris=c.eyes||'#5a767b';
   for(const side of [-1,1]){
    if(Math.abs(profile)>.82&&side*profile<0)continue;
    const ex=faceShift+side*eyeSpan*visibility,ey=eyeY+side*profile*.07;
    const ep=(a,b)=>hp(ex+a,ey+b);
    contour([ep(-.22,0),ep(-.10,-.075),ep(.12,-.07),ep(.23,-.015),ep(.1,.075),ep(-.12,.065)],'#eeeae3',false);
    ctx.strokeStyle='#27313a';ctx.lineWidth=Math.max(.4,unit*(female?.010:.007));ctx.beginPath();ctx.moveTo(...ep(-.23,0));ctx.quadraticCurveTo(...ep(0,-.13),...ep(.23,-.01));ctx.stroke();
    ctx.fillStyle=metallic||c.cyberEye&&side<0?accent:iris;ctx.beginPath();const pp=ep(.02,.005);ctx.ellipse(pp[0],pp[1],Math.max(.45,rx*.07),Math.max(.5,ry*.07),0,0,TAU);ctx.fill();
    ctx.fillStyle='#f7f4eb';ctx.beginPath();ctx.arc(pp[0]-.01*unit,pp[1]-.012*unit,Math.max(.22,unit*.007),0,TAU);ctx.fill();
    ctx.strokeStyle=hair||tone(skin,-.4);ctx.lineWidth=Math.max(.4,unit*.008);ctx.beginPath();ctx.moveTo(...ep(-.22,-.20));ctx.quadraticCurveTo(...ep(0,-.25),...ep(.23,-.18));ctx.stroke();
   }
   const nose=hp(faceShift+.08*profile,.27);ctx.strokeStyle=tone(skin,-.24);ctx.lineWidth=Math.max(.35,unit*.006);ctx.beginPath();ctx.moveTo(nose[0]-.015*unit,nose[1]-.035*unit);ctx.quadraticCurveTo(nose[0]+.025*unit,nose[1],nose[0],nose[1]+.009*unit);ctx.stroke();
   ctx.strokeStyle=female?'#9c6c69':tone(skin,-.32);ctx.lineWidth=Math.max(.35,unit*.007);ctx.beginPath();ctx.moveTo(...hp(faceShift-.20,.55));ctx.quadraticCurveTo(...hp(faceShift,.58),...hp(faceShift+.19,.53));ctx.stroke();
  }
  if(c.beard&&!back){contour([hp(-.70,.36),hp(-.55,.69),hp(faceShift,1.01),hp(.55,.69),hp(.7,.36),hp(.3,.57),hp(-.3,.57)],c.hair||'#413c35');}
  if((c.scar||c.scars?.length)&&!back){ctx.strokeStyle=tone(skin,-.28);ctx.lineWidth=Math.max(.35,unit*.007);ctx.beginPath();ctx.moveTo(...hp(.58,-.22));ctx.lineTo(...hp(.48,.27));ctx.stroke();}
  if(hair&&!look.head){
   const hairPoints=adultFemale&&['bob','short',undefined].includes(c.hairStyle)?[hp(-.98,.20),hp(-1.06,-.45),hp(-.72,-1.03),hp(.05,-1.12),hp(.88,-.86),hp(1.06,-.20),hp(.81,.55),hp(.58,.35),hp(.63,-.32),hp(.24,-.03),hp(-.12,-.32),hp(-.61,-.08),hp(-.78,.44)]:[hp(-1.02,.12),hp(-1.03,-.52),hp(-.7,-1.03),hp(.02,-1.12),hp(.73,-.98),hp(1.02,-.43),hp(.87,.12),hp(.57,-.29),hp(.20,-.13),hp(-.20,-.36),hp(-.55,-.19),hp(-.82,.27)];
   contour(hairPoints,hair);ctx.strokeStyle=tone(hair,.16);ctx.lineWidth=Math.max(.35,unit*.009);ctx.beginPath();ctx.moveTo(...hp(-.63,-.8));ctx.bezierCurveTo(...hp(-.23,-.96),...hp(.55,-.83),...hp(.78,-.35));ctx.stroke();
  }
  if(look.head&&look.head.shape!=='hood'){
   const col=look.head.color;contour([hp(-1,.0),hp(-1.04,-.55),hp(-.6,-1.08),hp(.55,-1.08),hp(1.03,-.56),hp(1,.02),hp(.55,-.28),hp(-.55,-.28)],col);
  }
  if(look.face||['hunter','droid'].includes(arch)){
   const col=look.face?.color||'#576b75';contour([hp(-.85,.08),hp(.85,.08),hp(.72,.6),hp(.1,.88),hp(-.67,.63)],col);
   if(!back){ctx.strokeStyle=accent;ctx.lineWidth=Math.max(.45,unit*.012);ctx.beginPath();ctx.moveTo(...hp(-.60,.18));ctx.quadraticCurveTo(...hp(0,.25),...hp(.6,.18));ctx.stroke();}
  }
  if((c.implants?.length||metallic||look.armor)&&!back){ctx.strokeStyle=accent;ctx.lineWidth=Math.max(.35,unit*.008);ctx.beginPath();ctx.moveTo(...hp(.87,.20));ctx.lineTo(...hp(.69,.43));ctx.lineTo(...hp(.70,.64));ctx.stroke();}
 });
 rig.flush();
 if(look.armor?.school&&look.armor.school!=='none')drawEquipmentAura(ctx,look.armor,x,y-unit*1.6,unit*.5,time,Math.PI/2,unit*2);
 if(pose.stun){ctx.strokeStyle='#e1cc8a';ctx.lineWidth=Math.max(.6,unit*.018);ctx.beginPath();ctx.ellipse(x,y-unit*3.4,unit*.25,unit*.065,0,0,TAU);ctx.stroke();}
 ctx.restore();
}
