import { drawAnimeBeast } from './anime-beast.js';
// Звери с непрерывными контурами (ART.md §3): волк, медведь, кабан и их мутанты,
// шагающий робот-патрульный. Размеры в метрах (как у техники), шаг — gait.js: рысь диагональными парами,
// у передних лап запястье выступает вперёд, у задних скакательный сустав — назад; опорная лапа не скользит.
import { M_TO_UNIT } from './mesh-art.js';
import { tone, isoRig } from './figure-art.js';
import { gaitFoot, legIK, strideFor } from './gait.js';

const KINDS = {
  wolf: { len: 0.62, back: 0.62, w: 0.34, neck: 0.32, head: 0.32, snout: 0.2, leg: 0.06, tail: 0.5, ears: 'pointy', fur: true },
  bear: { len: 0.75, back: 0.82, w: 0.58, neck: 0.25, head: 0.36, snout: 0.16, leg: 0.12, tail: 0.08, ears: 'round', hump: true },
  boar: { len: 0.55, back: 0.62, w: 0.42, neck: 0.12, head: 0.34, snout: 0.18, leg: 0.065, tail: 0.18, ears: 'pointy', tusks: true, bristle: true },
};
export const beastKind = (id) => (id.includes('bear') ? 'bear' : id.includes('boar') ? 'boar' : id.includes('eel') ? null : 'wolf');

export function drawBeast(ctx,e,x,y,unit,time,pose,kindId){
 return drawAnimeBeast(ctx,e,x,y,unit,time,pose,KINDS[kindId],{isoRig,tone,meters:M_TO_UNIT});
}

// Патрульный робот: гладкая оболочка, обратные колени, шаг по фазе actorPose.
export function drawWalkerBot(ctx,e,x,y,unit,time,pose){
  const lk=e.look||{},c=lk.color||'#697f8a',accent=lk.color2||'#8ed5d9',r=isoRig(ctx,x,y,unit,pose.angle),{paint,depth,limb,volume,line,ellipse,silhouette}=r;
  for(const side of [-1,1]){
    const st=gaitFoot(pose.phase,side<0?Math.PI:0,strideFor(13.5),.17,pose.move),hip=[side*.22,-.06,1.43],foot=[side*.27,st.dy,.08+st.dz],knee=legIK(hip,foot,.78,.75,-1);
    paint(depth(hip),()=>{limb(hip,knee,.115,.085,c);limb(knee,foot,.082,.055,c);volume(knee,.083,.09,.08,tone(c,-.10));
      silhouette([[foot[0]-.09,foot[1]-.10,foot[2]],[foot[0]+.09,foot[1]-.10,foot[2]],[foot[0]+.13,foot[1]+.22,foot[2]-.035],[foot[0],foot[1]+.28,foot[2]-.035],[foot[0]-.13,foot[1]+.22,foot[2]-.035]],tone(c,-.18));
      line([knee,[knee[0],knee[1]+.045,knee[2]],foot],tone(c,.22),.012);
    });
  }
  paint(0,()=>{volume([0,-.02,1.45],.28,.22,.22,tone(c,-.12));volume([0,.04,1.95],.45,.34,.53,c);
    silhouette([[-.33,.31,2.14],[-.25,.36,2.35],[.25,.36,2.35],[.33,.31,2.14],[.27,.34,1.96],[-.27,.34,1.96]],'#233843');
    line([[-.23,.365,2.13],[.23,.365,2.13]],accent,.025);
    for(const side of [-1,1]){limb([side*.39,.02,2.05],[side*.49,.22,1.73],.12,.08,c);limb([side*.49,.22,1.73],[side*.49,.63,1.79],.075,.065,tone(c,-.18));ellipse([side*.49,.65,1.79],.035,.045,'#17262d');}
  });
  r.flush();return [];
}
