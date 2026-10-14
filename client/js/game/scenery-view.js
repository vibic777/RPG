// Four local rendering modes; collision and fog remain authoritative.
const KEY='rpg.sceneryView';
const MODES=['solid','low','transparent','cutaway'];
const LABELS={solid:'1 · Полный вид',low:'2 · Низкие остатки',transparent:'3 · Прозрачность в радиусе',cutaway:'4 · Сферический вырез'};
let preferences;
export function sceneryView(){
  if(!preferences){let p={};try{p=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch{}
    const mode=p.mode==='hidden'?'low':MODES.includes(p.mode)?p.mode:'solid';
    preferences={mode,opacity:Number.isFinite(+p.opacity)?Math.max(0.05,Math.min(0.8,+p.opacity)):0.25};
  }return preferences;
}
export function initSceneryView(getRenderer){
  const button=document.getElementById('btn-scenery-view'),mode=document.getElementById('scenery-mode'),opacity=document.getElementById('scenery-opacity');
  const sync=()=>{const p=sceneryView();mode.value=p.mode;opacity.value=Math.round(p.opacity*100);document.getElementById('scenery-opacity-value').textContent=Math.round(p.opacity*100)+'%';
    button.title='Вид окружения: '+LABELS[p.mode]+'. Переключить: полный → остатки → прозрачность → вырез. Радиус определяется дальностью оружия и доступной магии.';button.setAttribute('aria-label',button.title);button.dataset.mode=p.mode;button.setAttribute('aria-pressed',String(p.mode!=='solid'));
    button.querySelector('path').setAttribute('d',p.mode==='low'?'M3 19h18M5 16v3M9 17v2M15 16v3M19 17v2':p.mode==='cutaway'?'M4 10l8-5 8 5v10H4ZM17 12a5 5 0 1 0 0 8':p.mode==='transparent'?'M4 10l8-5 8 5M4 10v10h16V10M8 20v-7h8v7':'M4 10l8-5 8 5v10H4ZM9 20v-7h6v7');
  };
  const update=p=>{preferences={...sceneryView(),...p};try{localStorage.setItem(KEY,JSON.stringify(preferences));}catch{}const r=getRenderer();if(r)r.visibilityPrefs=preferences;sync();};
  button.addEventListener('click',()=>update({mode:MODES[(MODES.indexOf(sceneryView().mode)+1)%MODES.length]}));mode.addEventListener('change',()=>update({mode:mode.value}));opacity.addEventListener('input',()=>update({opacity:+opacity.value/100}));sync();
}
