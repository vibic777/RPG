// Closest points on the actual model skin, captured before adding weapon fittings.
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const add=(a,b,t)=>a.map((v,i)=>v+b[i]*t);
export function closestTrianglePoint(p,a,b,c){
  const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
  if(d1<=0&&d2<=0)return a;
  const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);
  if(d3>=0&&d4<=d3)return b;
  const vc=d1*d4-d3*d2;
  if(vc<=0&&d1>=0&&d3<=0)return add(a,ab,d1/(d1-d3||1));
  const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);
  if(d6>=0&&d5<=d6)return c;
  const vb=d5*d2-d1*d6;
  if(vb<=0&&d2>=0&&d6<=0)return add(a,ac,d2/(d2-d6||1));
  const va=d3*d6-d5*d4;
  if(va<=0&&d4-d3>=0&&d5-d6>=0)return add(b,sub(c,b),(d4-d3)/((d4-d3)+(d5-d6)||1));
  const den=va+vb+vc;
  if(Math.abs(den)<1e-14)return [a,b,c].sort((u,v)=>dot(sub(p,u),sub(p,u))-dot(sub(p,v),sub(p,v)))[0];
  return add(add(a,ab,vb/den),ac,vc/den);
}
export function attachmentSurface(faces,{nested}={}){
  const skin=faces.filter(f=>f.pts?.length>=3&&!f.o?.glow&&!(f.o?.alpha<1)&&(nested===undefined||Boolean(f.sub)===nested)).map(f=>({
    pts:f.pts,min:[0,1,2].map(k=>Math.min(...f.pts.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...f.pts.map(p=>p[k])))
  }));
  return {nearest(p){
    let point=null,best=Infinity;
    for(const f of skin){
      const lower=[0,1,2].reduce((s,k)=>s+Math.max(0,f.min[k]-p[k],p[k]-f.max[k])**2,0);
      if(lower>best)continue;
      for(let i=1;i<f.pts.length-1;i++){
        const q=closestTrianglePoint(p,f.pts[0],f.pts[i],f.pts[i+1]),delta=sub(p,q),d=dot(delta,delta);
        if(d<best){point=q;best=d;}
      }
    }
    return point&&{point:point.slice(),distance:Math.sqrt(best)};
  }};
}
export function connectFitting(g,surface,grip,id){
  const hit=surface.nearest(grip);
  if(!hit)throw Error('No structural surface for weapon '+id);
  const delta=sub(grip,hit.point),len=Math.hypot(...delta),axis=len>.001?delta.map(v=>v/len):[0,0,1];
  // The foot penetrates the skin, and the strut ends inside the weapon cradle.
  const foot=add(hit.point,axis,-.045);
  if(len>.02){
    g.tube(foot,grip,.055,.055,'#414b4c',8);
    g.tube(foot,add(hit.point,axis,.065),.105,.085,'#596160',8);
  }
  const record={id,grip:grip.slice(),anchor:hit.point,foot,distance:len};
  g.attachments.push(record);
  return record;
}
