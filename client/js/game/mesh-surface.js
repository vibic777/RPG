// Shared depth-buffered surface renderer. Canvas remains the fallback and draws living figures.
// The depth buffer resolves body/wheel intersections per pixel, independently of viewing angle.
let renderer;
export const surfaceStats={rendered:0,available:null,error:''};
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const norm=v=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const VIEW=norm([1,1,.78]);
function color(value){
 const m=/^#([a-f0-9]{3}|[a-f0-9]{6})$/i.exec(value||'');
 if(m){const h=m[1].length===3?m[1].split('').map(v=>v+v).join(''):m[1],n=parseInt(h,16);return[(n>>16)/255,((n>>8)&255)/255,(n&255)/255,1];}
 const rgb=/rgba?\(([^)]+)\)/.exec(value||'');if(rgb){const c=rgb[1].split(',').map(Number);return[c[0]/255,c[1]/255,c[2]/255,c[3]??1];}
 return [.45,.48,.46,1];
}
function init(){
 if(typeof document==='undefined')return null;
 const canvas=document.createElement('canvas');
 const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true,depth:true});
 if(!gl || typeof gl.getParameter(gl.VERSION)!=='string')return null;
 const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
 const program=gl.createProgram();
 gl.attachShader(program,shader(gl.VERTEX_SHADER,`
 attribute vec3 a_screen; attribute vec3 a_normal; attribute vec4 a_color; attribute vec3 a_model; attribute float a_glow;
 uniform vec4 u_rect; uniform vec2 u_depth;
 varying vec3 v_normal;varying vec4 v_color;varying vec3 v_model;varying float v_glow;
 void main(){gl_Position=vec4((a_screen.x-u_rect.x)/u_rect.z*2.-1.,1.-(a_screen.y-u_rect.y)/u_rect.w*2.,1.-2.*(a_screen.z-u_depth.x)/u_depth.y,1.);v_normal=a_normal;v_color=a_color;v_model=a_model;v_glow=a_glow;}
 `));
 gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`
 precision mediump float;
 varying vec3 v_normal;varying vec4 v_color;varying vec3 v_model;varying float v_glow;uniform float u_weather;
 void main(){vec3 n=normalize(v_normal),light=normalize(vec3(-.25,.65,1.));float diffuse=max(0.,dot(n,light));
 float spec=pow(max(0.,dot(n,normalize(light+normalize(vec3(1.,1.,.78))))),24.);
 vec3 c=v_color.rgb*(.67+.38*diffuse)+vec3(spec*.075);
 float grain=fract(sin(dot(floor(v_model*110.),vec3(12.9898,78.233,39.425)))*43758.5453);
 c*=1.-u_weather*grain*.06;
 gl_FragColor=vec4(mix(c,v_color.rgb,v_glow),v_color.a);}
 `));
 gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))return null;
 const buffer=gl.createBuffer();return{canvas,gl,program,buffer};
}
export function wheelSurfaceFaces(f,quality){
 const ax=f.axis,ref=Math.abs(ax[2])<.9?[0,0,1]:[1,0,0],e1=norm(cross(ax,ref)),e2=cross(ax,e1),out=[],n=quality===0?32:64;
 const point=(a,t,r)=>f.c.map((c,k)=>c+ax[k]*a+(e1[k]*Math.cos(t)+e2[k]*Math.sin(t))*r);
 const profile=[[-f.th,f.r*.84],[-f.th*.87,f.r*.98],[-f.th*.74,f.r],[-f.th*.26,f.r],[-f.th*.13,f.r*.98],[0,f.r*.84]];
 for(let j=0;j+1<profile.length;j++)for(let i=0;i<n;i++){
  const t=i/n*Math.PI*2,t1=(i+1)/n*Math.PI*2,[a,r]=profile[j],[b,r1]=profile[j+1],mid=(t+t1)/2;
  const radial=e1.map((v,k)=>v*Math.cos(mid)+e2[k]*Math.sin(mid));
  const slant=(r-r1)/Math.max(.001,b-a),normal=norm(radial.map((v,k)=>v+ax[k]*slant));
  const tread=j===2&&Math.cos(mid*24+f.spin*24)>.45;
  out.push({pts:[point(a,t,r),point(a,t1,r),point(b,t1,r1),point(b,t,r1)],n:normal,col:tread?'#202523':f.col,o:{smooth:true}});
 }
 for(const [a,normal] of [[.003,ax],[-f.th-.003,ax.map(v=>-v)]]){
  let layer=0;const direction=a>0?1:-1;
  for(const [r,c] of [[f.r*.84,f.col],[f.r*.5,'#858c85'],[f.r*.29,'#313d39'],[f.r*.12,'#a1a59a']]){
   out.push({pts:Array.from({length:n},(_,i)=>point(a+layer*.009*direction,i/n*Math.PI*2,r)),n:normal,col:c,o:{}});layer++;
  }
 }
 return out;
}
export function drawSurfaces(ctx,faces,{project,toWorld,quality,weather=false}){
 if(renderer===undefined){try{renderer=init();}catch(e){renderer=null;surfaceStats.error=String(e);}surfaceStats.available=Boolean(renderer);}
 if(!renderer||!ctx.canvas||typeof ctx.getTransform!=='function')return false;
 const data=[],transparent=[];let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity,d0=Infinity,d1=-Infinity;
 const append=f=>{
  const col=color(f.col);if(f.o?.alpha!=null)col[3]*=f.o.alpha;
  const ps=f.pts.map(p=>{const s=project(p),d=dot(toWorld(p),VIEW);x0=Math.min(x0,s[0]);x1=Math.max(x1,s[0]);y0=Math.min(y0,s[1]);y1=Math.max(y1,s[1]);d0=Math.min(d0,d);d1=Math.max(d1,d);return[s[0],s[1],d];});
  const target=col[3]<1?transparent:data,glow=f.o?.glow?1:0;
  for(let i=1;i+1<ps.length;i++)for(const k of [0,i,i+1])target.push(...ps[k],...toWorld(f.normals?.[k]||f.n),...col,...f.pts[k],glow);
 };
 for(const f of faces){
  if(f.organic)return false;
  if(f.wheel){for(const w of wheelSurfaceFaces(f,quality))append(w);}
  else if(f.disc){const n=48;append({pts:Array.from({length:n},(_,i)=>{const a=i/n*Math.PI*2;return f.axis==='z'?[f.c[0]+Math.cos(a)*f.r,f.c[1]+Math.sin(a)*f.r,f.c[2]]:[f.c[0]+Math.cos(a)*f.r,f.c[1],f.c[2]+Math.sin(a)*f.r];}),n:f.axis==='z'?[0,0,1]:[0,1,0],col:f.col,o:{alpha:f.alpha,glow:true}});}
  else append(f);
 }
 if(!data.length&&!transparent.length)return false;
 const {canvas,gl,program,buffer}=renderer,tr=ctx.getTransform(),ratio=Math.max(1,Math.min(2,Math.hypot(tr.a,tr.b))),pad=3;
 x0=Math.floor(x0)-pad;y0=Math.floor(y0)-pad;
 if(((x1-x0)*ratio>4096||(y1-y0)*ratio>4096)&&tr.b===0&&tr.c===0&&tr.a>0&&tr.d>0){
  x0=Math.max(x0,-tr.e/tr.a-pad);y0=Math.max(y0,-tr.f/tr.d-pad);
  x1=Math.min(x1,(ctx.canvas.width-tr.e)/tr.a+pad);y1=Math.min(y1,(ctx.canvas.height-tr.f)/tr.d+pad);
 }
 const w=Math.ceil(x1-x0)+pad,h=Math.ceil(y1-y0)+pad;if(w<1||h<1)return true;if(w*ratio>4096||h*ratio>4096)return false;
 const cw=Math.ceil(w*ratio),ch=Math.ceil(h*ratio);if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}
 gl.viewport(0,0,cw,ch);gl.clearColor(0,0,0,0);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);
 gl.uniform4f(gl.getUniformLocation(program,'u_rect'),x0,y0,w,h);gl.uniform2f(gl.getUniformLocation(program,'u_depth'),d0-.1,Math.max(.2,d1-d0+.2));gl.uniform1f(gl.getUniformLocation(program,'u_weather'),weather?1:0);
 gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
 for(const [name,size,offset] of [['a_screen',3,0],['a_normal',3,3],['a_color',4,6],['a_model',3,10],['a_glow',1,13]]){const p=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,size,gl.FLOAT,false,56,offset*4);}
 const draw=values=>{gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,values.length/14);};
 gl.disable(gl.BLEND);gl.depthMask(true);if(data.length)draw(data);
 if(transparent.length){gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);draw(transparent);gl.depthMask(true);}
 ctx.drawImage(canvas,x0,y0,w,h);surfaceStats.rendered++;return true;
}
