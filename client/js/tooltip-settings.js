// Личные настройки подсказок, отдельно от параметров кооперативного сервера.
let profile='';let prefs={enabled:true,seconds:5};
const key=()=>`rpg.tooltips.${profile||'default'}`;
export const tooltipSettings=()=>prefs;
function sync(){
  const checkbox=document.getElementById('ui-tooltips-enabled'),duration=document.getElementById('ui-tooltip-seconds');
  if(checkbox)checkbox.checked=prefs.enabled;if(duration){duration.value=String(prefs.seconds);duration.disabled=!prefs.enabled;}
  window.dispatchEvent(new Event('tooltip-settings-change'));
}
export function setTooltipProfile(id){
  profile=String(id||'');let stored={};try{stored=JSON.parse(localStorage.getItem(key())||'{}')||{};}catch{}
  const seconds=Number(stored.seconds);prefs={enabled:stored.enabled!==false,seconds:Number.isFinite(seconds)?Math.max(1,Math.min(65536,Math.round(seconds))):5};sync();
}
export function initTooltipSettings(){
  setTooltipProfile('');
  const save=()=>{const n=Number(document.getElementById('ui-tooltip-seconds').value);prefs={enabled:document.getElementById('ui-tooltips-enabled').checked,seconds:Number.isFinite(n)?Math.max(1,Math.min(65536,Math.round(n))):5};try{localStorage.setItem(key(),JSON.stringify(prefs));}catch{}sync();};
  document.getElementById('ui-tooltips-enabled')?.addEventListener('change',save);
  document.getElementById('ui-tooltip-seconds')?.addEventListener('change',save);
}
