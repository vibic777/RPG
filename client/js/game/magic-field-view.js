import { drawSpellZone } from './spell-art.js';
const fields=new Map();
export function resetMagicFields(){fields.clear();}
export function magicFieldsWelcome(list){fields.clear();for(const field of list)magicFieldMessage({field});}
export function magicFieldMessage(msg){if(msg.remove)fields.delete(msg.remove);if(msg.field){const f=msg.field,now=performance.now();fields.set(f.id,{...f,born:now-(f.total-f.ms),until:now+f.ms});}}
export function magicSlipperyAt(x,y){const now=performance.now();for(const f of fields.values())if(f.slippery&&f.until>now&&Math.hypot(f.x-x,f.y-y)<=f.r)return true;return false;}
export function magicFieldsBusy(){return fields.size>0;}
export function magicFieldsScene(scene){
  const ground=scene.groundEffects,over=scene.overlay;
  return {...scene,groundEffects:(r,time)=>{if(ground)ground(r,time);for(const f of fields.values())if(f.until>time)drawSpellZone(r,f,time,true);},overlay:(r,time)=>{for(const [id,f]of fields){if(f.until<=time)fields.delete(id);else drawSpellZone(r,f,time,false);}if(over)over(r,time);}};
}
