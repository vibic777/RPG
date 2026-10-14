import { animeBrush } from './anime-figure.js';
import { gaitFoot, legIK, strideFor } from './gait.js';
export function drawAnimeBeast(ctx,e,x,y,unit,time,pose,K,helpers){
 const {isoRig,tone,meters}=helpers,r=isoRig(ctx,x,y,unit*meters,pose.angle),{project,depth,paint,line,ellipse}=r;
 const brush=animeBrush(ctx,unit*meters,project,tone),{contour,chain}=brush,c=e.look?.color||'#69716b',near=Math.cos(pose.angle)-Math.sin(pose.angle)>0?1:-1,move=e.deadAt?0:pose.move;
 const phase=pose.phase,half=Math.min(strideFor(13.5)/meters,K.len*.45),bob=move*Math.sin(phase*2)*.014,back=K.back+bob;
 const headY=K.len*.75+K.neck,headZ=back+K.neck*.4,front=headY+K.head*.6;
 const sections=[[-K.len*.95,back-.18,K.w*.25,K.back*.16],[-K.len*.65,back-.12,K.w*.48,K.back*.28],[0,back-.12,K.w*.52,K.back*.29],[K.len*.55,back-.08,K.w*.48,K.back*.30],[headY-K.head*.3,headZ,K.w*.35,K.head*.32],[headY+K.head*.32,headZ-.015,K.w*.30,K.head*.30],[front+K.snout*.6,headZ-K.head*.14,K.w*.23,K.head*.18]];
 // One body outline runs from the rump across shoulders and neck into the muzzle.
 const body=()=>{
  const center=project([0,0,back]),axis=project([0,1,back]),d=[axis[0]-center[0],axis[1]-center[1]],length=Math.hypot(...d)||1,n=[-d[1]/length,d[0]/length],left=[],right=[];
  for(const [yy,zz,rx,rz] of sections){const p=project([0,yy,zz]),a=project([rx,yy,zz]),b=project([0,yy,zz+rz]),ax=[a[0]-p[0],a[1]-p[1]],az=[b[0]-p[0],b[1]-p[1]],t=Math.atan2(az[0]*n[0]+az[1]*n[1],ax[0]*n[0]+ax[1]*n[1]),v=[Math.cos(t)*ax[0]+Math.sin(t)*az[0],Math.cos(t)*ax[1]+Math.sin(t)*az[1]];left.push([p[0]+v[0],p[1]+v[1]]);right.push([p[0]-v[0],p[1]-v[1]]);}
  contour([...left,...right.reverse()],c);
 };
 for(const side of [-1,1])for(const end of [-1,1]){
  const st=gaitFoot(phase,side*end>0?0:Math.PI,half,K.back*.22,move),hip=[side*K.w*.35,end*K.len*.65,back-.12],foot=[side*K.w*.40,end*K.len*.73+st.dy,.055+st.dz],L=K.back*.96,knee=legIK(hip,foot,L*.51,L*.52,end>0?1:-1),mid=hip.map((v,k)=>v*.55+knee[k]*.45);
  paint(side===near?.15:-.5,()=>{chain([hip,mid,knee,foot],[K.leg*1.45,K.leg*1.3,K.leg*.85,K.leg*.73],side===near?c:tone(c,-.12));
   contour([[foot[0]-K.leg,foot[1]-.04,foot[2]+.035],[foot[0]+K.leg,foot[1]-.04,foot[2]+.035],[foot[0]+K.leg*1.15,foot[1]+K.leg*1.8,foot[2]],[foot[0]-K.leg*1.15,foot[1]+K.leg*1.8,foot[2]]].map(project),tone(c,-.12));});
 }
 if(K.tail>.1)paint(-.6,()=>{const sw=Math.sin(time/360)*K.tail*.2;chain([[0,-K.len*.85,back-.12],[sw*.3,-K.len-K.tail*.4,back-.2],[sw,-K.len-K.tail*.9,back-K.tail*.45]],[K.leg*.85,K.leg*.7,.012],c);});
 paint(0,body);
 paint(.25,()=>{
  for(const side of [-1,1]){
   const ex=side*K.w*.28,ey=headY-K.head*.13,ez=headZ+K.head*.25;
   if(K.ears==='round')contour([[ex-K.head*.16,ey,ez],[ex-K.head*.13,ey,ez+K.head*.24],[ex+K.head*.13,ey,ez+K.head*.24],[ex+K.head*.16,ey,ez]].map(project),c);
   else contour([[ex-K.head*.13,ey,ez],[ex+side*K.head*.10,ey-.04,ez+K.head*.42],[ex+K.head*.13,ey+.025,ez]].map(project),c);
  }
  const eye=[near*K.w*.28,headY+K.head*.18,headZ+K.head*.07];ellipse(eye,.018,.022,'#273537');ellipse([eye[0],eye[1]+.008,eye[2]+.008],.005,.006,'#dce9e2');
  ellipse([0,front+K.snout*.63,headZ-K.head*.14],K.w*.15,K.head*.09,'#283330');
  if(K.tusks)for(const side of [-1,1])chain([[side*K.w*.2,front,headZ-K.head*.25],[side*K.w*.26,front+.06,headZ-K.head*.08],[side*K.w*.22,front+.08,headZ+K.head*.12]],[.026,.018,.002],'#d1c7b5');
  if((e.def?.id||e.type||'').includes('mutant'))line([[near*K.w*.32,0,back],[near*K.w*.32,K.len*.3,back+.035]],e.look?.color2||'#8cc7c5',.016);
 });r.flush();
}
