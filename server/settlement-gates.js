'use strict';
// A gate admits a cleared approach, then waits for the whole approaching party.
const V=require('../shared/vehicles');
const CLEAR_RADIUS = 5;
function updateGate({gate, town, width, actors, enemies, open, pending = new Set()}) {
  const distance = (p) => Math.min(...gate.cells.map(j => p.body?V.pointBodyDistance({x:j%width+.5,y:Math.floor(j/width)+.5},p.body):Math.hypot(p.x-(j%width+.5),p.y-(Math.floor(j/width)+.5))));
  const inside=p=>Math.abs((p.body?.x??p.x)-town.x-.5)+(p.body?.extentX||p.radius||0)<town.r-1&&Math.abs((p.body?.y??p.y)-town.y-.5)+(p.body?.extentY||p.radius||0)<town.r-1;
  const approaching = actors.filter(p => distance(p)<=5+(p.radius||0));
  if (!open) {
    if (!approaching.length || approaching.some(p => enemies.some(e => e.hostile!==false && (p.body?V.pointBodyDistance(e,p.body):Math.hypot(p.x-e.x,p.y-e.y))<=CLEAR_RADIUS+(e.def?.radius||0)))) return {open:false,pending:new Set()};
    pending = new Set(approaching.filter(p=>!inside(p)).map(p=>p.id));
    return {open:true,pending};
  }
  const live = new Map(actors.map(p=>[p.id,p]));
  for (const p of approaching) if(!inside(p)) pending.add(p.id);
  for (const id of pending) { const p=live.get(id); if(!p || inside(p) || distance(p)>20) pending.delete(id); }
  const occupied = [...actors,...enemies].some(p=>distance(p)<=1.5+(p.radius||p.def?.radius||0));
  return {open:approaching.length>0 || pending.size>0 || occupied,pending};
}
module.exports = { updateGate, CLEAR_RADIUS };
