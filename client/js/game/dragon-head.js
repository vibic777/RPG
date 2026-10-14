import {tone} from './figure-art.js';
import {animeBrush} from './anime-figure.js';
// Neck, skull and muzzle share a single flowing contour; surface marks never split the skin.
export function drawDragonHead(rig,color,accent,hover,strike,time,unit=24){
 const {paint,depth,project,line,ellipse}=rig,{chain,contour}=animeBrush(rig.ctx,unit,project,tone);
 const p=(x,y,z)=>[x,y+strike*.13,z+hover],ivory='#d7ccb3',dark=tone(color,-.56),near=depth([1,0,0])>=0?1:-1;
 paint(depth([0,.6,0]),()=>{
  chain([p(0,.35,1.03),p(0,.55,1.39),p(0,.73,1.68),p(0,.98,1.77),p(0,1.30,1.69),p(0,1.52,1.65)],[.235,.22,.25,.255,.18,.13],color);
 });
 for(const side of [-1,1])paint(depth([side*.3,.7,0])+.02,()=>{
  chain([p(side*.19,.72,1.87),p(side*.27,.55,2.07),p(side*.36,.22,2.21)],[.06,.04,.002],ivory);
 });
 paint(.6,()=>{
  const eye=p(near*.20,1.0,1.81);ellipse(eye,.036,.027,dark);ellipse(p(near*.207,1.013,1.814),.024,.020,accent);
  line([p(near*.21,1.01,1.829),p(near*.21,1.02,1.795)],'#172b2e',.009);
  line([p(near*.23,.91,1.855),p(near*.22,1.06,1.86),p(near*.18,1.16,1.80)],tone(color,-.16),.016);
  ellipse(p(near*.085,1.51,1.68),.021,.012,dark);
  line([p(near*.20,1.12,1.60),p(near*.155,1.35,1.57-strike*.07),p(near*.09,1.51,1.59)],dark,.012);
  if(strike>.12){contour([p(-.11,1.25,1.57),p(.11,1.25,1.57),p(.10,1.49,1.55-strike*.10),p(-.10,1.49,1.55-strike*.10)].map(project),dark);for(let i=0;i<3;i++)line([p(near*.12,1.27+i*.07,1.58),p(near*.12,1.29+i*.07,1.54-strike*.03)],ivory,.014);}
  for(let i=0;i<3;i++)line([p(near*.17,.58+i*.1,1.36+i*.1),p(near*.22,.67+i*.1,1.38+i*.1)],tone(color,-.12),.008);
 });
}
