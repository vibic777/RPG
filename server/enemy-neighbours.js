'use strict';
// One spatial index per AI step; unrelated parts of a region never scan each other.
function near(ctx,actor,radius){
 if(!ctx.enemyBuckets||ctx.enemyBucketTime!==ctx.now){const buckets=new Map();for(const e of ctx.enemies){const key=Math.floor(e.x/8)+','+Math.floor(e.y/8);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(e);}ctx.enemyBuckets=buckets;ctx.enemyBucketTime=ctx.now;}
 const out=[];
 for(let y=Math.floor((actor.y-radius)/8);y<=Math.floor((actor.y+radius)/8);y++)for(let x=Math.floor((actor.x-radius)/8);x<=Math.floor((actor.x+radius)/8);x++)for(const e of ctx.enemyBuckets.get(x+','+y)||[])if(Math.hypot(e.x-actor.x,e.y-actor.y)<=radius)out.push(e);
 return out;
}
module.exports={near};
