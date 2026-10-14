import {tooltipSettings} from './tooltip-settings.js';
import {helpContext} from './help-browser.js';
// Каждая кнопка с текстом получает пиктограмму; исходная подпись остаётся в title и aria-label.
const ICONS = [
  [/всё рядом|все предметы|собирать всё/i, '📦'], [/нужное|необходимое/i, '💧'], [/лучшее/i, '⭐'], [/ближний|рукопашный/i, '⚔'], [/дальний|дистанционный/i, '🎯'],
  [/игроки/i, '👥'], [/персонажи/i, '🧙'], [/спавн/i, '🌀'], [/сообщения/i, '💬'], [/события/i, '🎉'], [/журнал/i, '📋'], [/миры/i, '🗺'], [/техника/i, '🚙'],
  [/регистрац|создать аккаунт|новый аккаунт/i, '👤＋'], [/войти|вход|присоединиться|подключиться/i, '↪'], [/выйти|выход|отключиться/i, '⏻'],
  [/случайн|рандом/i, '🎲'], [/назад|к списку|предыдущ/i, '←'], [/сброс|обнулить|очистить/i, '↺'], [/создать|новый персонаж|новый мир/i, '＋'],
  [/сохранить|в файл|экспорт/i, '💾'], [/загрузить|импорт|из файла/i, '📂'], [/продолжить|вернуться в игру/i, '▶'], [/справка|помощь|управлять/i, '❔'],
  [/закрыть|отказать|отказаться|забыть|убрать|удалить|снести|разрушить|отменить|расторгнуть|выселить|выгнать|бан/i, '✕'], [/свернуть|minimi[sz]/i, '−'], [/развернуть|раскрыть/i, '▸'], [/обновить|перезагрузить/i, '⟳'],
  [/починить|ремонт|починка|восстановить/i, '🔧'], [/улучшить|апгрейд|повысить уровень/i, '⬆'], [/ставить|поставить|строить|фундамент|стена/i, '🧱'],
  [/повернуть|вращать/i, '⟳'], [/допустить|разрешить|согласиться|принять|одобрить|применить|подтвердить|назначить/i, '✓'], [/забрать|взять|получить|подобрать/i, '⬇'], [/положить|дать|передать|отправить/i, '⬆'],
  [/продать|продажа/i, '💰'], [/обмен|торговл|лавк|магазин/i, '⇄'], [/лечить|вылечить|исцел|лечение/i, '✚'], [/учиться|изучить|заклинан|магия|прочитать/i, '✨'],
  [/сдать|завершить|готово|выполнить/i, '✓'], [/предложить|пригласить|сватать/i, '💌'], [/домой|вернуть домой/i, '⌂'], [/в поход|спутник|призвать/i, '🐾'],
  [/заправить|топлив/i, '⛽'], [/запереть|закрыть замок/i, '🔒'], [/отпереть|открыть замок/i, '🔓'], [/багажник|в сумку/i, '📥'],
  [/возродиться|респаун|воскресить/i, '✨'], [/обычный размер|сбросить размер/i, 'A'], [/выслушать|слушать/i, '👂'], [/телепатия|попросить/i, '🧠'],
  [/купить|приобрести/i, '🛒'], [/подарить/i, '🎁'], [/научить|обучить/i, '📖'], [/оружие|снаряжение|экипировать/i, '⚔'], [/инвентар|сумк|вещь/i, '🎒'],
  [/персонаж|герой|игрок|цель/i, '👤'], [/враг|босс|существ/i, '👹'], [/спавн|создать врага/i, '🌀'], [/предмет|добыч|лут/i, '📦'],
  [/мир|карта|телепорт|координат/i, '🗺'], [/транспорт|машин|техник|топлив/i, '🚙'], [/сервер|параметр|настройк/i, '⚙'], [/задани|квест|журнал/i, '📜'],
  [/фракци|репутац/i, '⚑'], [/семь|родств|ребён/i, '👪'], [/голос|микрофон|раци/i, '🎙'], [/сообщ|объявлен|чат/i, '💬'],
  [/журнал|лог|действ/i, '📋'], [/баз|постройк|строительств/i, '🏠'], [/поселени|жител|торговец/i, '🏘'], [/событи|расписан/i, '🎉'],
  [/роль|администратор|гм/i, '🛡'], [/неуязв|бессмерт|бог/i, '✨'], [/полёт|летать|невидим/i, '🪽'], [/добавить|выдать|создать/i, '＋'],
  [/страниц|далее|следующ/i, '→'], [/применить для всех/i, '✓'], [/экран|размер текста|масштаб/i, '🔎'], [/взять квест|принять задание/i, '📥'], [/сделать|изготовить|производить/i, '⚒'], [/вложить очко|увеличить/i, '➕'],
  [/имя|название|переимен/i, '✎'], [/поиск|найти|фильтр/i, '🔎'], [/выбрать|установить|включить|активировать/i, '☑'], [/выключить|деактивировать/i, '☐'],
  [/ответить|разговор|диалог|реплик/i, '💬'], [/атак|стрел|удар|бо[йя]/i, '⚔'], [/еда|вода|здоров|мана|лечеб/i, '➕'], [/книга|рецепт|крафт|создать предмет/i, '📖'],
  [/приблизить|увеличить масштаб|zoom in/i, '🔍'], [/отдалить|уменьшить масштаб|zoom out/i, '➖'], [/нормализац|показать всю карту|сбросить масштаб/i, '⟲'],
  [/сменить|изменить клавишу/i, '⌨'], [/продолжить игру/i, '▶'], [/спасти|поднять спутник/i, '🩹'],
  [/ближай|рядом|точка/i, '📍'], [/да$/i, '✓'], [/нет$/i, '✕'],
];

const DATA_ICONS = {
  loot: { all: '📦', needed: '💧', best: '⭐' },
  'auto-combat': { melee: '⚔', ranged: '🎯', magic: '✦' },
  buy: '🛒', sell: '💰', take: '📥', give: '📤', close: '✕', adopt: '👪', invite: '💌',
};
const ACTION_ICONS = {
  close: '✕', deny: '✕', forget: '✕', delete: '🗑', remove: '✕', release: '✕',
  buy: '🛒', sell: '💰', take: '📥', give: '📤', put: '📤', heal: '✚', cure: '✚',
  cast: '✦', spell: '✨', repair: '🔧', refuel: '⛽', lock: '🔒', unlock: '🔓',
  summon: '🐾', store: '📦', mount: '🐉', order: '📜', stance: '🛡', revive: '🩹',
  next: '→', previous: '←', prev: '←', refresh: '⟳', save: '💾', load: '📂',
  answer: '💬', option: '💬', listen: '👂', accept: '✓', allow: '✓', agree: '✓',
  spawn: '🌀', teleport: '🗺', ban: '⛔', unban: '✅', kick: '🚪',
};
function iconFor(label, button) {
  const data = button && Object.entries(DATA_ICONS).map(([key, values]) => typeof values === 'string' ? (button.hasAttribute(`data-${key}`) ? values : null) : values[button.dataset[key]]).find(Boolean);
  if (data) return data;
  if (button) {
    for (const [key, value] of Object.entries(button.dataset)) if (ACTION_ICONS[value.toLowerCase()]) return ACTION_ICONS[value.toLowerCase()];
    if (button.matches('[data-opt], [data-qlisten], [data-qtake]')) return '💬';
  }
  const text = `${label} ${button?.title || ''} ${button?.id || ''} ${button ? Object.values(button.dataset).join(' ') : ''}`.replace(/\s+/g, ' ').trim();
  if (!text || !/[\p{L}\p{N}]/u.test(text)) return null;
  for (const [re, icon] of ICONS) if (re.test(text)) return icon;
  return null;
}

function decorate(button) {
  if (!(button instanceof HTMLButtonElement)) return;
  if (button.matches("[data-native-icon],.panel-window-icon,.panel-window-control,[data-panel-action],[data-window-minimize]")) return;
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT, {
    acceptNode(node) { return node.parentElement.closest('.badge,[aria-hidden="true"],.icon-button-label') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
  });
  const nodes = [];
  while (walker.nextNode()) if (walker.currentNode.textContent.trim()) nodes.push(walker.currentNode);
  const label = nodes.map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
  if (!label) return;
  const icon = iconFor(label, button);
  if (!icon) return; // Не подменять неизвестное действие бессмысленным символом.
  const previous = button.dataset.iconizedLabel;
  if (previous === label) return;
  button.dataset.iconizedLabel = label;
  if (!button.hasAttribute('data-icon-source-title')) button.dataset.iconSourceTitle = button.title || '';
  const description = button.dataset.iconSourceTitle || '';
  const help = description && description.toLowerCase() !== label.toLowerCase() ? `${label} — ${description}` : label;
  button.dataset.iconTooltip = help;
  button.title = help;
  if (!button.hasAttribute('aria-label') || previous) button.setAttribute('aria-label', label);
  nodes[0].textContent = ` ${icon} `;
  for (const node of nodes.slice(1)) node.textContent = '';
  button.classList.add('icon-button');
}

export function initButtonIcons() {
  initViewportTooltips();
  const scan = (root) => {
    if (root instanceof HTMLButtonElement) decorate(root);
    root.querySelectorAll?.('button').forEach(decorate);
    root.querySelectorAll?.('button,input,select,textarea,label').forEach(el=>{
      if(el.closest('#help-body')||el.hasAttribute('title')||el.dataset.uiTooltip||el.dataset.iconTooltip)return;
      const label=el.getAttribute('aria-label')||el.labels?.[0]?.textContent||el.closest('label')?.textContent||el.textContent||el.placeholder;
      if(label?.trim())el.dataset.uiTooltip=label.trim();
    });
  };
  scan(document);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach((node) => { if (node.nodeType === Node.ELEMENT_NODE) scan(node); else if (node.parentElement) decorate(node.parentElement.closest('button')); });
      else if (record.type === 'characterData') decorate(record.target.parentElement?.closest('button'));
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
}
function initViewportTooltips(){
  if(document.getElementById('viewport-tooltip'))return;
  const tip=document.createElement('div');tip.id='viewport-tooltip';tip.className='viewport-tooltip';tip.role='tooltip';tip.hidden=true;document.body.append(tip);
  let anchor=null,originalTitle=null,frame=0,delay=0,expiry=0,leave=0,topic='h-controls',point=null,key='',expired=false;
  function hide(){clearTimeout(delay);clearTimeout(expiry);clearTimeout(leave);if(anchor&&originalTitle!==null&&!anchor.hasAttribute('title'))anchor.setAttribute('title',originalTitle);anchor=null;originalTitle=null;tip.hidden=true;cancelAnimationFrame(frame);point=null;key='';expired=false;}
  function place(){
    if(!anchor?.isConnected||!anchor.getClientRects().length){hide();return;}
    if(anchor.hasAttribute('title'))anchor.removeAttribute('title');
    const v=window.visualViewport,left=v?.offsetLeft||0,top=v?.offsetTop||0,w=v?.width||innerWidth,h=v?.height||innerHeight,pad=8,gap=7;
    tip.style.maxWidth=Math.max(1,Math.min(420,w-pad*2))+'px';tip.style.maxHeight=Math.max(1,h-pad*2)+'px';
    const a=point?{left:point.x,top:point.y,bottom:point.y+6,width:0}:anchor.getBoundingClientRect(),r=tip.getBoundingClientRect();
    const minX=left+pad,maxX=left+w-pad-r.width,minY=top+pad,maxY=top+h-pad-r.height;
    const midX=a.left+a.width/2,midY=a.top+a.height/2;
    // Dock beside the hovered control when possible. Centering a long tooltip
    // over a small HUD button can hide the next row of controls.
    const horizontal=midX<w/2
      ? [{x:a.right+gap,y:midY-r.height/2},{x:a.left-gap-r.width,y:midY-r.height/2}]
      : [{x:a.left-gap-r.width,y:midY-r.height/2},{x:a.right+gap,y:midY-r.height/2}];
    const vertical=midY<h/2
      ? [{x:midX-r.width/2,y:a.bottom+gap},{x:midX-r.width/2,y:a.top-gap-r.height}]
      : [{x:midX-r.width/2,y:a.top-gap-r.height},{x:midX-r.width/2,y:a.bottom+gap}];
    const candidates=[...horizontal,...vertical];
    const chosen=candidates.find(p=>p.x>=minX&&p.x<=maxX&&p.y>=minY&&p.y<=maxY);
    const p=chosen||{x:Math.max(minX,Math.min(maxX,midX-r.width/2)),y:Math.max(minY,Math.min(maxY,a.bottom+gap))};
    tip.style.left=p.x+'px';tip.style.top=p.y+'px';
  }
  function follow(){place();if(anchor&&!tip.hidden)frame=requestAnimationFrame(follow);}
  function queue(el,text,help,identity,coords=null){
    if(!tooltipSettings().enabled){hide();return;}
    if(anchor===el&&key===identity){clearTimeout(leave);if(coords)point=coords;return;}
    hide();if(!text?.trim())return;anchor=el;key=identity;originalTitle=el.getAttribute('title');el.removeAttribute('title');topic=help;tip.dataset.helpTopic=help;point=coords;
    tip.textContent=text+' · F1 — справка';
    delay=setTimeout(()=>{if(!anchor||expired)return;tip.hidden=false;place();frame=requestAnimationFrame(follow);expiry=setTimeout(()=>{tip.hidden=true;expired=true;cancelAnimationFrame(frame);},tooltipSettings().seconds*1000);},450);
  }
  function show(node){
    if(node instanceof Element&&tip.contains(node)){clearTimeout(leave);return;}
    const el=node instanceof Element?node.closest('[title],[data-icon-tooltip],[data-ui-tooltip]'):null;
    if(!el)return;const text=el.dataset.iconTooltip||el.getAttribute('title')||el.dataset.uiTooltip;
    if(text)el.dataset.uiTooltip=text;queue(el,text,helpContext(el,text),'ui');
  }
  document.addEventListener('pointerover',e=>show(e.target));
  document.addEventListener('pointerout',e=>{if(anchor&&!anchor.contains(e.relatedTarget)&&!tip.contains(e.relatedTarget))leave=setTimeout(hide,250);});
  tip.addEventListener('pointerenter',()=>clearTimeout(leave));tip.addEventListener('pointerleave',e=>{if(!anchor?.contains(e.relatedTarget))hide();});
  window.addEventListener('tooltip-dismiss',hide);
  document.addEventListener('focusin',e=>show(e.target));document.addEventListener('focusout',e=>{if(!tip.contains(e.relatedTarget))leave=setTimeout(hide,250);});
  document.addEventListener('pointerdown',e=>{if(!tip.contains(e.target))hide();},true);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape')hide();
  },true);window.addEventListener('blur',hide);
  function suppressNativeTitle(el){
    if(tooltipSettings().enabled||!(el instanceof Element)||!el.hasAttribute('title'))return;
    const title=el.getAttribute('title');if(title){el.dataset.suppressedTooltipTitle=title;el.dataset.uiTooltip=el.dataset.iconTooltip||title;}
    el.removeAttribute('title');
  }
  function applyPreferences(){
    hide();
    if(!tooltipSettings().enabled)document.querySelectorAll('[title]').forEach(suppressNativeTitle);
    else document.querySelectorAll('[data-suppressed-tooltip-title]').forEach(el=>{if(!el.hasAttribute('title'))el.title=el.dataset.suppressedTooltipTitle;delete el.dataset.suppressedTooltipTitle;});
  }
  new MutationObserver(records=>{
    if(tooltipSettings().enabled)return;
    for(const record of records){if(record.type==='attributes')suppressNativeTitle(record.target);else for(const node of record.addedNodes){if(node instanceof Element){suppressNativeTitle(node);node.querySelectorAll('[title]').forEach(suppressNativeTitle);}}}
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['title']});
  window.addEventListener('tooltip-settings-change',applyPreferences);applyPreferences();
  window.addEventListener('rpg-ui-tooltip',e=>{const d=e.detail;if(d?.element&&d.text)queue(d.element,d.text,d.topic,d.key);});
  window.addEventListener('rpg-world-tooltip',e=>{const d=e.detail;if(!d?.text){hide();return;}queue(d.canvas,d.text,d.topic,d.key,{x:d.x,y:d.y});});
}
