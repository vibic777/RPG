// Создание героя и кукла инвентаря используют тот же объёмный рисунок, что и мир.
import { drawHumanoid } from './game/figure-art.js';
const R = window.CharacterRules;
const colorOf = (group,id) => (R.APPEARANCE[group].find((o)=>o.id===id)||R.APPEARANCE[group][0]).color;
export function drawCharacter(canvas,a,opts={}) {
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);
  if(opts.background!==false){const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'#29343b');g.addColorStop(0.65,'#1e272c');g.addColorStop(1,'#12191e');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);}
  const skin=colorOf('skin',a.skin),metal='#909ca6',implants=a.implants||[];
  const hero={x:0,y:0,facingAngle:Math.PI/4,colors:{skin,hair:a.hair==='bald'?null:colorOf('hairColor',a.hairColor),longHair:['long','braids','dreads','ponytail'].includes(a.hair),mohawk:a.hair==='mohawk',body:a.body,face:a.face,eyes:colorOf('eyes',a.eyes),hairStyle:a.hair,scars:a.scars||[],tattoos:a.tattoos||[],implants,female:a.gender==='female',wide:['muscular','heavy'].includes(a.body),beard:a.beard&&a.beard!=='none',scar:Boolean(a.scars&&a.scars.length),tattoo:Boolean(a.tattoos&&a.tattoos.length),underwear:colorOf('underwear',a.underwear),legs:implants.includes('legs')?metal:skin,armL:implants.includes('armLeft')?metal:skin,armR:implants.includes('armRight')?metal:skin,cyberEye:implants.includes('eye')},look:opts.look||{}};
  drawHumanoid(ctx,hero,w/2,h*0.94,Math.min(h/3.62,w/2.3),0);
}