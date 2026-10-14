(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./worldgen'));else root.Regions=factory(root.WorldGen);})(typeof self!=='undefined'?self:this,function(G){
 'use strict';
 // The surface world is an 8×8 torus. Coordinates in old saves are normalized
 // into the new grid, including local dungeon keys qualified with a region.
 const LIMIT=7,SIZE=8,cache=new WeakMap(),portalCache=new WeakMap();
 const ROUTE=[[0,0],[0,0],[1,0],[1,1],[2,1],[2,0],[3,0],[3,7],[4,7],[4,0],[5,0],[5,1]];
 const DIRECTIONS=[{id:'N',dx:0,dy:-1,name:'Север'},{id:'E',dx:1,dy:0,name:'Восток'},{id:'S',dx:0,dy:1,name:'Юг'},{id:'W',dx:-1,dy:0,name:'Запад'}];
 const wrap=n=>((n%SIZE)+SIZE)%SIZE;
 const keyOf=(x,y)=>{x=wrap(x);y=wrap(y);return x===0&&y===0?'ground':`region_${x}_${y}`;};
 function parse(key){if(key==='ground'||!key)return{x:0,y:0,key:'ground',local:null};const m=/^region_(-?\d+)_(-?\d+)(?:!(.+))?$/.exec(key);if(!m)return null;const x=Number(m[1]),y=Number(m[2]);if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||m[1]!==String(x)||m[2]!==String(y)||x< -7||x>7||y< -7||y>7)return null;const wx=wrap(x),wy=wrap(y);return{x:wx,y:wy,key:keyOf(wx,wy),local:m[3]||null};}
 const qualify=(key,local)=>local==='ground'?key:key==='ground'?local:`${key}!${local}`;
 const letter=x=>String.fromCharCode(65+wrap(x));
 const name=(x,y)=>`${['Пепельные земли','Забытые трассы','Зелёные руины','Мёртвые кварталы','Стальные пустоши','Солёные острова','Ржавые гавани','Затопленные кварталы'][G.hashString(wrap(x)+','+wrap(y))%8]} [${letter(x)}${wrap(y)+1}]`;
 function profile(x,y){
   // A deterministic sea-and-island belt ensures ships can leave any sector;
   // the other sectors retain large wasteland continents with a coastal fringe.
   return (x+y*3)%7===0?{shape:'islands',waterMode:'archipelago'}:{shape:'continent',waterMode:'sea'};
 }
 function map(root,key){const p=parse(key);if(!p)return null;if(p.key==='ground')return root;let maps=cache.get(root);if(!maps){maps=new Map();cache.set(root,maps);}if(maps.has(p.key))return maps.get(p.key);
   const terrain=profile(p.x,p.y),m=G.generate({seed:root.seed+'|'+p.key,width:256,...terrain,genVersion:root.genVersion,dragons:3,regionRoads:false});
   Object.assign(m,{key:p.key,surfaceRegion:true,regionX:p.x,regionY:p.y,z:0,n:0,type:'region',typeName:name(p.x,p.y),name:name(p.x,p.y),exits:[],safeRadius:4});
   maps.set(p.key,m);return m;
 }
 function portals(m){if(!m)return[];if(portalCache.has(m))return portalCache.get(m);const rx=m.regionX||0,ry=m.regionY||0,W=m.width,H=m.height;
   const terrain={...m,swimmer:false,flyer:false,drive:null,actor:null,buildElevation:0,blocks:null,openGates:new Set((m.towns||[]).flatMap(t=>(t.gates||[]).flatMap(g=>g.cells)))};
   const walk=new Uint8Array(W*H),queue=[m.spawn.y*W+m.spawn.x];walk[queue[0]]=1;
   for(let i=0;i<queue.length;i++){const j=queue[i],x=j%W,y=Math.floor(j/W);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const X=x+dx,Y=y+dy,k=Y*W+X;if(X<1||Y<1||X>=W-1||Y>=H-1||walk[k]||!G.isWalkable(terrain,X,Y))continue;walk[k]=1;queue.push(k);}}
   const out=[];
   for(const d of DIRECTIONS){
     const nx=wrap(rx+d.dx),ny=wrap(ry+d.dy),ideal=d.id==='N'?[W/2,12]:d.id==='S'?[W/2,H-13]:d.id==='W'?[12,H/2]:[W-13,H/2];
     let best=null,score=Infinity;
     for(const j of queue){const x=j%W,y=Math.floor(j/W);if(x<8||y<8||x>=W-8||y>=H-8)continue;const s=Math.hypot(x-ideal[0],y-ideal[1]);if(s>=score)continue;let clear=true;for(let Y=y-5;Y<=y+5&&clear;Y++)for(let X=x-5;X<=x+5;X++)if(!G.isWalkable(terrain,X,Y)){clear=false;break;}if(clear){score=s;best={x,y};}}
     if(!best){const j=queue.reduce((a,b)=>Math.hypot(b%W-ideal[0],Math.floor(b/W)-ideal[1])<Math.hypot(a%W-ideal[0],Math.floor(a/W)-ideal[1])?b:a,queue[0]);best={x:j%W,y:Math.floor(j/W)};}
     if(m.surfaceRegion||G.isWalkable(terrain,best.x,best.y))out.push({...best,id:'region-land-'+d.id,kind:'travel',travelMode:'land',direction:d.id,name:d.name+' → '+name(nx,ny),destination:keyOf(nx,ny)});
   }
   // Water gateways are placed inside a broad, connected ocean apron. The
   // berth point is offset from the edge so the largest ships fit entirely.
   const waterIdeal={N:[W/2,16],S:[W/2,H-17],W:[16,H/2],E:[W-17,H/2]};
   const V=typeof module==='object'&&module.exports?require('./vehicles'):null;
   const boat=V&&V.get('boat');
   for(const d of DIRECTIONS){
     let best=null,score=Infinity;const [ix,iy]=waterIdeal[d.id];
     for(let y=8;y<H-8;y+=2)for(let x=8;x<W-8;x+=2){
       if(G.tileAt(m,x,y)!==G.B.WATER)continue;const s=Math.hypot(x-ix,y-iy);if(s>=score)continue;
       if(boat&&(!V.canPlaceBody(m,boat,{x:x+.5,y:y+.5,facingAngle:({N:-Math.PI/2,E:0,S:Math.PI/2,W:Math.PI})[d.id]})))continue;
       score=s;best={x,y};
     }
     if(best){const nx=wrap(rx+d.dx),ny=wrap(ry+d.dy);out.push({...best,id:'region-sea-'+d.id,kind:'travel',travelMode:'water',direction:d.id,name:d.name+' — море → '+name(nx,ny),destination:keyOf(nx,ny)});}
   }
   portalCache.set(m,out);return out;
 }
 function target(root,current,p){const destination=parse(p.destination)?.key||p.destination||'ground',destMap=destination==='ground'?root:map(root,destination);if(!destMap)return null;const opposite={N:'S',S:'N',E:'W',W:'E'}[p.direction];let entry=portals(destMap).find(g=>g.direction===opposite&&g.travelMode===(p.travelMode||'land'));if(!entry&&p.travelMode==='water')entry=portals(destMap).find(g=>g.direction===opposite&&g.travelMode==='land');entry=entry||destMap.spawn;return{key:destination,x:entry.x,y:entry.y,z:0};}
 function route(index){const [x,y]=ROUTE[Math.min(Math.max(0,index),ROUTE.length-1)];return{key:keyOf(x,y),x:wrap(x),y:wrap(y),name:name(x,y)};}
 function nextPortal(m,destination){const to=parse(destination),here={x:m.regionX||0,y:m.regionY||0};if(!to||to.key===keyOf(here.x,here.y))return null;const dx=wrap(to.x-here.x),dy=wrap(to.y-here.y);let dir;if(dx&&(!dy||dx<=SIZE-dx))dir=dx<=SIZE/2?'E':'W';else dir=dy<=SIZE/2?'S':'N';return portals(m).find(p=>p.direction===dir&&p.travelMode==='land')||portals(m).find(p=>p.direction===dir);}
 function release(root,key){const p=parse(key);if(p&&p.key!=='ground')cache.get(root)?.delete(p.key);}
 return{LIMIT,SIZE,ROUTE,DIRECTIONS,keyOf,parse,qualify,name,map,portals,target,route,nextPortal,release};
});
