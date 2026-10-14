(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.Recovery=factory();})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function heal(hp,max,rate,dt){return hp>0?Math.min(max,hp+Math.max(0,rate)*Math.max(0,dt)):hp;}
  function vehicle(v,def,dt,occupied,now,settings){
    if(!occupied||now-(v.hurtAt||0)<(settings.regenDelaySec??5)*1000||v.hp>=def.hp)return false;
    v.hp=Math.min(def.hp,Math.max(0,v.hp)+def.hp*Math.max(0,settings.vehicleAutoRepairPctPerSec??.25)/100*Math.max(0,dt));
    if(v.hp>def.hp*(settings.vehicleWreckMinPct??25)/100)v.wreck=false;
    return true;
  }
  return{heal,vehicle};
});
