// Единое перемещение и отображение игровых панелей.
const controllers = new Map();
const STYLE_KEYS = ['left', 'right', 'top', 'bottom', 'width', 'height', 'zIndex', 'transform'];
const MODES = ['normal', 'compact', 'iconified', 'maximized'];
let profileId = '';
let saved = {};
let writeQueued = false;
let activePanelId = '';
let activationOrder = 0;
const PINNED_PANELS=new Set(['hud-top','hud-map','comp-bar','attack-mode-controls','auto-loot-controls','auto-combat-controls','auto-use-controls','perf-overlay']);
const MIN_SIZES={'cheat-panel':[340,200],'admin-panel':[340,200],'inv-window':[340,220],'hud-map':[170,150],'comp-bar':[230,120],'attack-mode-controls':[200,70]};
function recoveryButton(controller,show){
  let dock=document.getElementById('panel-recovery-dock');
  if(!dock){dock=document.createElement('div');dock.id='panel-recovery-dock';dock.setAttribute('aria-label','Вернуть закрытые панели');document.getElementById('screen-game')?.append(dock);if(!dock.isConnected)controller.element.parentElement.append(dock);}
  let button=dock.querySelector(`[data-restore-panel="${controller.element.id}"]`);
  if(show&&!button){button=document.createElement('button');button.type='button';button.className='btn small';button.dataset.nativeIcon='';button.dataset.restorePanel=controller.element.id;button.textContent=controller.icon;button.title=`Открыть: ${controller.title||controller.element.getAttribute('aria-label')||controller.element.id}`;button.setAttribute('aria-label',button.title);button.addEventListener('click',()=>restorePanel(controller.element.id));dock.append(button);}
  initRecoveryDock(dock);
  if(!show)button?.remove();dock.hidden=!dock.querySelector('[data-restore-panel]');placeRecoveryDock();
}

function initRecoveryDock(dock){
  if(dock.dataset.draggable)return;dock.dataset.draggable='1';
  const handle=document.createElement('span');handle.className='panel-dock-handle';handle.textContent='⠿';
  handle.title='Переместить панель значков';handle.setAttribute('aria-label',handle.title);dock.prepend(handle);
  let drag=null;
  dock.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('button'))return;
    event.preventDefault();event.stopPropagation();window.getSelection()?.removeAllRanges();
    const rect=dock.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX-rect.left,y:event.clientY-rect.top};
    dock.setPointerCapture(event.pointerId);dock.classList.add('window-dragging');
  });
  dock.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;event.preventDefault();
    const snapped=magneticPosition({element:dock},event.clientX-drag.x,event.clientY-drag.y);
    const parent=dock.offsetParent?.getBoundingClientRect()||{left:0,top:0};
    saved['panel-recovery-dock']={left:snapped.left-parent.left,top:snapped.top-parent.top};
    placeRecoveryDock();
  });
  const finish=event=>{
    if(!drag||event.pointerId!==drag.id)return;drag=null;dock.classList.remove('window-dragging');
    if(dock.hasPointerCapture(event.pointerId))dock.releasePointerCapture(event.pointerId);persist();
  };
  for(const type of ['pointerup','pointercancel','lostpointercapture'])dock.addEventListener(type,finish);
  if(typeof ResizeObserver==='function')new ResizeObserver(()=>placeRecoveryDock()).observe(dock);
}
function placeRecoveryDock(){
  const dock=document.getElementById('panel-recovery-dock');if(!dock||dock.hidden)return;
  const bounds=gameBounds(dock);
  dock.style.maxWidth=`${Math.max(44,Math.min(480,bounds.width-16))}px`;
  dock.style.maxHeight=`${Math.max(44,bounds.height-16)}px`;
  const size=dock.getBoundingClientRect();
  const perf=controllers.get('perf-overlay');
  const blocked=perf?.visible()?perf.element.getBoundingClientRect():null;
  const positions=[
    {left:bounds.left+12,top:Math.max(bounds.top+8,bounds.bottom-size.height-64)},
    {left:bounds.right-size.width-12,top:Math.max(bounds.top+8,bounds.bottom-size.height-64)},
    {left:bounds.left+12,top:bounds.top+8},
    {left:bounds.right-size.width-12,top:bounds.top+8},
  ];
  const preferred=saved['panel-recovery-dock'];
  const parent=dock.offsetParent?.getBoundingClientRect()||{left:0,top:0};
  const chosen=Number.isFinite(preferred?.left)&&Number.isFinite(preferred?.top)?{left:preferred.left+parent.left,top:preferred.top+parent.top}:positions.find(p=>!blocked||p.left+size.width+8<=blocked.left||p.left>=blocked.right+8||p.top+size.height+8<=blocked.top||p.top>=blocked.bottom+8)||positions[0];
  const clamped=clampRect(dock,chosen.left,chosen.top);
  dock.style.left=`${clamped.left-parent.left}px`;
  dock.style.top=`${clamped.top-parent.top}px`;dock.style.bottom='auto';
  // На весь экран панель имеет приоритет над служебными значками.
  dock.style.zIndex=perf?.mode==='maximized'?'5':'100';
}

function storageKey() { return `rpg.panelLayout.${profileId}`; }
function loadProfile(id) {
  profileId = String(id || '');
  try { saved = profileId ? JSON.parse(localStorage.getItem(storageKey()) || '{}') : {}; }
  catch { saved = {}; }
  for (const controller of controllers.values()) controller.restoreSaved();
  placeRecoveryDock();
}
function persist() {
  if (!profileId || writeQueued) return;
  writeQueued = true;
  queueMicrotask(() => {
    writeQueued = false;
    try { localStorage.setItem(storageKey(), JSON.stringify(saved)); } catch { /* Раскладка останется в текущей сессии. */ }
  });
}

function gameBounds(element){
  const game=element.closest('#screen-game'),r=game?.getBoundingClientRect();
  const left=Math.max(0,r?.left||0),top=Math.max(0,r?.top||0);
  const right=Math.min(innerWidth,r?.right||innerWidth),bottom=Math.min(innerHeight,r?.bottom||innerHeight);
  return {left,top,right,bottom,width:Math.max(44,right-left),height:Math.max(44,bottom-top)};
}
function clampRect(element,x,y){
  const bounds=gameBounds(element),r=element.getBoundingClientRect();
  const w=Math.min(r.width,bounds.width-16),h=Math.min(r.height,bounds.height-16);
  return {left:Math.max(bounds.left+8,Math.min(x,bounds.right-w-8)),top:Math.max(bounds.top+8,Math.min(y,bounds.bottom-h-8))};
}
// Притягивается только перетаскиваемая панель; координаты указателя остаются исходными.
// Поэтому магнит отпускает окно, когда мышь уходит за порог, без накопления смещения.
const MAGNET_DISTANCE=18;
const CORNER_DISTANCE=28;
function magneticPosition(controller,x,y){
  const element=controller.element,rect=element.getBoundingClientRect(),bounds=gameBounds(element);
  const width=rect.width,height=rect.height;
  const start=clampRect(element,x,y);x=start.left;y=start.top;
  let best=null;
  function offer(left,top){
    if(left<bounds.left+8||top<bounds.top+8||left+width>bounds.right-8||top+height>bounds.bottom-8)return;
    const score=Math.hypot(left-x,top-y);
    if(!best||score<best.score)best={left,top,score};
  }
  function corner(value,options){
    const nearest=options.reduce((a,b)=>Math.abs(b-value)<Math.abs(a-value)?b:a);
    return Math.abs(nearest-value)<=CORNER_DISTANCE?nearest:value;
  }
  for(const other of controllers.values()){
    if(other===controller||!other.visible()||other.mode==='maximized')continue;
    const target=other.element;
    if(target.closest('#screen-game')!==element.closest('#screen-game'))continue;
    const r=target.getBoundingClientRect();
    if(!r.width||!r.height||!target.getClientRects().length)continue;
    // Боковая стыковка: верхние или нижние углы, в том числе для разной высоты.
    const alignedY=corner(y,[r.top,r.bottom-height]);
    if(y+height>=r.top-CORNER_DISTANCE&&y<=r.bottom+CORNER_DISTANCE){
      for(const left of [r.right,r.left-width]){
        if(Math.abs(left-x)<=MAGNET_DISTANCE)offer(left,alignedY);
      }
    }
    // Вертикальная стыковка: левые или правые углы, в том числе для разной ширины.
    const alignedX=corner(x,[r.left,r.right-width]);
    if(x+width>=r.left-CORNER_DISTANCE&&x<=r.right+CORNER_DISTANCE){
      for(const top of [r.bottom,r.top-height]){
        if(Math.abs(top-y)<=MAGNET_DISTANCE)offer(alignedX,top);
      }
    }
  }
  return best||start;
}
export function replacePanelHtml(element,html){
  const template=document.createElement('template');template.innerHTML=html;
  replacePanelContents(element,...template.content.childNodes);
}
export function replacePanelContents(element,...nodes){
  const oldHeader=element.querySelector(':scope > .panel-window-header:not(.panel-window-generated-head)'),newHeader=nodes.find(n=>n instanceof Element&&n.matches('.gm-head,.inv-head,.comp-head,.panel-window-header'));
  if(oldHeader&&newHeader){const oldLabel=oldHeader.querySelector('b'),newLabel=newHeader.querySelector('b');if(oldLabel&&newLabel){oldLabel.textContent=newLabel.textContent;oldLabel.title=newLabel.title;}nodes[nodes.indexOf(newHeader)]=oldHeader;}
  const chrome=[...element.children].filter(n=>n.matches('.panel-window-icon,.panel-window-icon-close'));
  const keep=new Set([...chrome,...nodes]);for(const node of [...element.childNodes])if(!keep.has(node))node.remove();
  for(const node of nodes)element.append(node);
}

function createButton(action, text, title) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'btn small panel-window-control';
  button.dataset.panelAction = action; button.textContent = text; button.title = title;
  button.setAttribute('aria-label', title);
  return button;
}

export function floatingWindow(element, { header, icon = '▣', title = '', onRestore = () => {}, onMinimize = () => {} }) {
  if (!element) return null;
  const existing = controllers.get(element.id);
  if (existing) return existing;
  element.classList.add('floating-window');
  const original = Object.fromEntries(STYLE_KEYS.map(key => [key, element.style[key]]));
  const controller = {
    element, original, header, icon, title, onRestore, onMinimize,
    closedByManager: false, mode: 'normal', drag: null, moved: false, expandedScrollTop: 0, observer: null,
    visible: () => !element.classList.contains('hidden') && !element.classList.contains('collapsed'),
    minimized: () => controller.mode !== 'normal',
    setMode: null, activeAt: 0,
  };

  function getHeader() {
    let head = header && element.querySelector(header);
    if (!head) {
      head = element.querySelector('.panel-window-header');
      if (!head) {
        head = document.createElement('div');
        head.className = 'panel-window-header panel-window-generated-head';
        const label=document.createElement('span');label.className='panel-window-title';label.textContent=title||element.getAttribute('aria-label')||element.id;head.append(label);
        element.insertBefore(head, element.firstChild);
      }
    }
    head.classList.add('panel-window-header');
    return head;
  }
  function ensureControls() {
    const head = getHeader();
    let collapse = head.querySelector('[data-panel-action="collapse"], [data-window-minimize]');
    if (!collapse) { collapse = createButton('collapse', '▣', 'Скрыть в значок'); head.append(collapse); }
    collapse.dataset.panelAction = 'collapse';
    let maximize = head.querySelector('[data-panel-action="maximize"]');
    if (!maximize) { maximize = createButton('maximize', '□', 'Развернуть панель на экран'); head.append(maximize); }
    let iconify = head.querySelector('[data-panel-action="iconify"],[data-panel-action="normal"]');
    if (!iconify) { iconify = createButton('normal', '▤', 'Обычный вид — показать содержимое'); head.append(iconify); }
    iconify.dataset.panelAction='normal';
    if(element.id==='comp-bar'&&!head.querySelector('[data-panel-action=compact]'))head.append(createButton('compact','☷','Компактный список с вертикальной прокруткой'));
    let close = head.querySelector('[data-panel-action="close"]');
    if (!close) {
      controller.nativeClose = head.querySelector('button[title*="Закрыть" i],button[aria-label*="Закрыть" i],[data-close],[data-a="close"]')
        || [...head.querySelectorAll('button')].find(button => /×|✕/.test(button.textContent));
      if (!controller.nativeClose) { close = createButton('close', '×', 'Закрыть панель (Esc)'); head.append(close); }
      else { controller.nativeClose.title ||= 'Закрыть панель (Esc)'; controller.nativeClose.setAttribute('aria-label', controller.nativeClose.title); }
    }
    let iconButton = element.querySelector(':scope > .panel-window-icon');
    if (!iconButton) {
      iconButton = document.createElement('button'); iconButton.type = 'button';
      iconButton.className = 'btn panel-window-icon'; iconButton.textContent = icon;
      element.insertBefore(iconButton, element.firstChild);
    }
    for (const button of [iconButton, collapse, maximize, iconify, close, controller.nativeClose].filter(Boolean)) {
      button.classList.remove('icon-button');
      delete button.dataset.iconizedLabel;
      button.classList.add(button === iconButton ? 'panel-window-icon' : 'panel-window-control');
    }
    let iconClose = element.querySelector(':scope > .panel-window-icon-close');
    if (!iconClose) {
      iconClose = createButton('close', '×', 'Закрыть панель (Esc)');
      iconClose.classList.add('panel-window-icon-close'); element.append(iconClose);
    }
    iconClose.hidden = controller.mode !== 'iconified';
    if (iconButton.textContent !== controller.icon) iconButton.textContent = controller.icon;
    iconButton.title = `Развернуть: ${controller.title || element.getAttribute('aria-label') || element.id}`;
    iconButton.setAttribute('aria-label', iconButton.title);
    collapse.textContent='▣';collapse.title='Скрыть в значок';collapse.setAttribute('aria-label',collapse.title);
    iconify.title='Обычный вид — показать содержимое';iconify.setAttribute('aria-label',iconify.title);
    const maximizeIcon = controller.mode === 'maximized' ? '❐' : '□';
    if (maximize.textContent !== maximizeIcon) maximize.textContent = maximizeIcon;
    maximize.title = controller.mode === 'maximized' ? 'Восстановить размер панели' : 'Развернуть панель на экран';
    iconButton.hidden = controller.mode !== 'iconified';
    // Одна группа и один порядок, независимо от того, когда создан заголовок.
    let controls=head.querySelector(':scope > .panel-window-controls');
    if(!controls){controls=document.createElement('div');controls.className='panel-window-controls';head.append(controls);}
    const ordered=[collapse,maximize,iconify,head.querySelector('[data-panel-action=compact]'),close||controller.nativeClose].filter(Boolean);
    if(ordered.some((button,index)=>controls.children[index]!==button)||controls.children.length!==ordered.length){
      for(const button of ordered)controls.append(button);
    }
    maximize.setAttribute('aria-label',maximize.title);
  }
  function place(x, y) {
    const p = clampRect(element, x, y);
    const parent=element.offsetParent?.getBoundingClientRect()||{left:0,top:0};
    element.style.left = `${p.left-parent.left}px`; element.style.top = `${p.top-parent.top}px`;
    element.style.right = 'auto'; element.style.bottom = 'auto';element.style.transform='none';
  }
  function freeze() {
    const r = element.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (controller.mode === 'normal') { element.style.width = `${r.width}px`; element.style.height = `${r.height}px`; }
    place(r.left, r.top);
  }
  function saveState() {
    if (!profileId) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const storedLeft = parseFloat(element.style.left), storedTop = parseFloat(element.style.top);
    const storedWidth = parseFloat(element.style.width), storedHeight = parseFloat(element.style.height);
    saved[element.id] = {
      left: Math.round(Number.isFinite(storedLeft) ? storedLeft : rect.left),
      top: Math.round(Number.isFinite(storedTop) ? storedTop : rect.top),
      width: Number.isFinite(storedWidth) ? Math.round(storedWidth) : controller.mode === 'normal' ? Math.round(rect.width) : undefined,
      height: Number.isFinite(storedHeight) ? Math.round(storedHeight) : controller.mode === 'normal' ? Math.round(rect.height) : undefined,
      mode: controller.mode,
    };
    persist();
  }
  function setMode(mode, { save = true, callbacks = true, freezeSize = true } = {}) {
    if(mode==='collapsed')mode='iconified';
    if(mode==='compact'&&element.id!=='comp-bar')mode='normal';
    if (!MODES.includes(mode)) return;
    element.classList.remove('window-collapsed','window-minimized');
    if (freezeSize && mode !== 'normal' && controller.mode === 'normal') {
      controller.expandedScrollTop = element.scrollTop;
      freeze();
    }
    controller.mode = mode;
    for (const m of MODES) element.classList.toggle(`window-${m}`, m === mode && m !== 'normal');
    element.dataset.panelMode=mode;
    if (mode === 'normal') {
      element.style.height='auto';element.style.bottom='auto';
      const min=MIN_SIZES[element.id]||[160,90];
      if(parseFloat(element.style.width)<min[0])element.style.width=original.width;
      if(parseFloat(element.style.height)<min[1])element.style.height=original.height;
      if(element.id==='comp-bar'){
        if(parseFloat(element.style.width)<120)element.style.width='';
        if(parseFloat(element.style.height)<80)element.style.height='';
        element.dispatchEvent(new Event('panel-restore'));
      }
      element.scrollTop = controller.expandedScrollTop;
      if (callbacks) onRestore();
    } else if (mode==='compact') {element.style.height='auto';element.dispatchEvent(new Event('panel-restore'));}
    else if(mode==='maximized')element.dispatchEvent(new Event('panel-restore'));
    else if(mode==='iconified'&&callbacks)onMinimize();
    ensureControls();
    if (controller.visible() && mode !== 'maximized') {
      const rect = element.getBoundingClientRect();
      if (rect.width && rect.height) place(rect.left, rect.top);
    }
    placeRecoveryDock();
    if (save) saveState();
  }
  function restoreSaved() {
    const state = saved[element.id];
    if (!state) { resetLayout(); return; }
    requestAnimationFrame(() => {
      if (Number.isFinite(state.left) && Number.isFinite(state.top)) {
        element.style.left = `${state.left}px`; element.style.top = `${state.top}px`;
        element.style.right = 'auto'; element.style.bottom = 'auto';
      }
      if (Number.isFinite(state.width)) element.style.width = `${Math.max(44, Math.min(state.width, innerWidth - 16))}px`;
      if (Number.isFinite(state.height)) element.style.height = `${Math.max(44, Math.min(state.height, innerHeight - 16))}px`;
      setMode(state.mode || 'normal', { save: false, callbacks: false, freezeSize: false });
      if (controller.visible() && controller.mode !== 'maximized') {
        const rect = element.getBoundingClientRect();
        if (rect.width && rect.height) place(rect.left, rect.top);
      }
    });
  }
  controller.setMode = setMode;
  function resetLayout() {
    delete element.dataset.panelClosed;
    element.classList.remove('window-collapsed', 'window-iconified', 'window-maximized', 'window-compact', 'window-minimized', 'window-dragging');
    controller.mode = 'normal';element.dataset.panelMode='normal'; controller.expandedScrollTop = 0;
    for (const key of STYLE_KEYS) element.style[key] = original[key];
    if (controller.closedByManager) { element.classList.remove('hidden'); controller.closedByManager = false; }
    element.scrollTop = 0; ensureControls();
    recoveryButton(controller,false);controller.refresh?.();
  }
  function closePanel() {
    saveState();
    activePanelId = '';
    const closeButton = controller.nativeClose && getHeader().contains(controller.nativeClose) ? controller.nativeClose : null;
    if (closeButton) closeButton.click();
    else if (element.id === 'chat') {
      element.classList.add('collapsed');
      document.getElementById('btn-chat-toggle')?.setAttribute('aria-pressed', 'false');
    } else { controller.closedByManager = true;element.dataset.panelClosed='1'; element.classList.add('hidden');if(PINNED_PANELS.has(element.id))recoveryButton(controller,true); }
    saveState();
  }

  element.addEventListener('click', event => {
    const iconButton = event.target.closest('.panel-window-icon');
    if (iconButton) {
      event.preventDefault(); event.stopPropagation();
      if (controller.moved) { controller.moved = false; return; }
      setMode('normal'); return;
    }
    const button = event.target.closest('[data-panel-action]');
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    const action = button.dataset.panelAction;
    if (action === 'collapse') setMode('iconified');
    else if(action==='normal')setMode('normal');
    else if(action==='compact')setMode(controller.mode==='compact'?'normal':'compact');
    else if (action === 'iconify') setMode('iconified');
    else if (action === 'maximize') setMode(controller.mode === 'maximized' ? 'normal' : 'maximized');
    else if (action === 'close') controller.closePanel();
  });
  element.addEventListener('dblclick', event => {
    if (event.target.closest('.panel-window-header') && !event.target.closest('button, input, select, textarea, a'))
      setMode(controller.mode === 'maximized' ? 'normal' : 'maximized');
  });
  element.addEventListener('pointerdown', event => {
    if (!controller.visible() || event.button !== 0) return;
    controller.activeAt = ++activationOrder; activePanelId = element.id;
    for(const c of controllers.values())c.element.style.zIndex=c===controller?'40':c.original.zIndex;
    const iconDrag = Boolean(event.target.closest('.panel-window-icon'));
    const headDrag = Boolean(event.target.closest('.panel-window-header')) && !event.target.closest('button, input, select, textarea, a');
    if (!iconDrag && !headDrag || controller.mode === 'maximized') return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    for (const c of controllers.values()) c.element.style.zIndex = c === controller ? '40' : c.original.zIndex;
    const rect = element.getBoundingClientRect();
    controller.drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top, startX: event.clientX, startY: event.clientY, capture: iconDrag ? event.target.closest('.panel-window-icon') : element };
    controller.moved = false;
    element.classList.add('window-dragging'); controller.drag.capture.setPointerCapture(event.pointerId);
  });
  element.addEventListener('pointermove', event => {
    const drag = controller.drag;
    if (!drag || drag.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) controller.moved = true;
    if (!controller.moved) return;
    event.preventDefault();
    const snapped=magneticPosition(controller,event.clientX-drag.x,event.clientY-drag.y);
    place(snapped.left,snapped.top);placeRecoveryDock();
  });
  const endDrag = event => {
    if (!controller.drag || controller.drag.id !== event.pointerId) return;
    const capture = controller.drag.capture;
    controller.drag = null; element.classList.remove('window-dragging');
    if (capture.hasPointerCapture(event.pointerId)) capture.releasePointerCapture(event.pointerId);
    saveState();
    setTimeout(() => { controller.moved = false; }, 400);
  };
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
  element.addEventListener('lostpointercapture', endDrag);
  element.addEventListener('focusin', () => { controller.activeAt = ++activationOrder; activePanelId = element.id; });
  element.addEventListener('click', () => { controller.activeAt = ++activationOrder; activePanelId = element.id; });

  controller.open = () => { controller.closedByManager=false;delete element.dataset.panelClosed;resetLayout();setMode('normal');controller.refresh(); };
  controller.close = () => { saveState(); };
  let measuredScale = Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-text-scale')) || 1;
  controller.refresh = () => {
    ensureControls();placeRecoveryDock();
    const bounds=gameBounds(element);element.style.setProperty('--panel-field-width',`${bounds.width}px`);element.style.setProperty('--panel-field-height',`${bounds.height}px`);
    if (!controller.visible() || controller.mode === 'maximized') return;
    const scale = Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-text-scale')) || 1;
    if (controller.mode === 'normal') {
      const width = element.getBoundingClientRect().width;
      if (width && scale !== measuredScale) element.style.width = `${Math.min(bounds.width - 16, width * scale / measuredScale)}px`;
      element.style.height = 'auto';
      // Old saved widths must not force an extra horizontal scrollbar.
      const needed = element.scrollWidth + element.offsetWidth - element.clientWidth;
      if (needed > element.offsetWidth + 1) element.style.width = `${Math.min(bounds.width - 16, needed)}px`;
    }
    measuredScale = scale;
    const rect = element.getBoundingClientRect();
    const p = clampRect(element, rect.left, rect.top);
    if (p.left !== rect.left || p.top !== rect.top) place(p.left, p.top);
  };
  controller.restoreSaved = restoreSaved;
  controller.resetLayout = resetLayout;
  controller.closePanel = closePanel;
  controller.saveState = saveState;
  let wasHidden = element.classList.contains('hidden');
  controller.observer = new MutationObserver(() => {
    ensureControls();
    const hidden = element.classList.contains('hidden');
    if (wasHidden && !hidden) {controller.closedByManager=false;delete element.dataset.panelClosed;recoveryButton(controller,false);controller.activeAt = ++activationOrder; activePanelId = element.id;setMode('normal',{save:false,callbacks:false});controller.refresh();}
    wasHidden = hidden;
  });
  controller.observer.observe(element, { childList: true, attributes: true, attributeFilter: ['class'] });
  if(typeof ResizeObserver==='function'){
    let resizeQueued=false;
    controller.resizeObserver=new ResizeObserver(()=>{if(resizeQueued)return;resizeQueued=true;requestAnimationFrame(()=>{resizeQueued=false;controller.refresh();});});
    controller.resizeObserver.observe(element);
  }
  ensureControls();
  controllers.set(element.id, controller);
  if (profileId) restoreSaved();
  return controller;
}

const PANEL_DEFS = [
  ['hud-top', '.hud-title', '👤', 'Герой и состояние'], ['hud-map', '.panel-window-header', '🗺', 'Миникарта'],
  ['auto-loot-controls', '.hud-loot-label', '📦', 'Автосбор'], ['auto-combat-controls', '.hud-loot-label', '⚔', 'Автобой'], ['auto-use-controls', '.hud-loot-label', '❤', 'Автопомощь'],
  ['attack-mode-controls','.panel-window-header','⚔','Режимы атаки'],
  ['target-frame', '.panel-window-header', '🎯', 'Цель'], ['perf-overlay', '.panel-window-header', '📈', 'Производительность'],
  ['build-window', '.inv-head', '🔨', 'Строительство'], ['craft-window', '.inv-head', '📖', 'Рецепты'], ['spell-window', '.inv-head', '✨', 'Заклинания'],
  ['voice-window', '.inv-head', '🎙', 'Голосовой чат'], ['family-window', '.inv-head', '👪', 'Семья'], ['quest-window', '.inv-head', '📜', 'Задания'],
  ['npc-window', '.inv-head', '💬', 'Разговор'], ['veh-window', '.inv-head', '🚙', 'Транспорт'], ['chest-window', '.inv-head', '📦', 'Сундук'],
  ['corpse-loot-window', '.inv-head', '⚰', 'Труп'], ['turret-panel', '.inv-head', '🛡', 'Турель'], ['stats-window', '.inv-head', '📊', 'Персонаж'],
  ['inv-window', '.inv-head', '🎒', 'Инвентарь'], ['admin-panel', '.gm-head', '🛡', 'Панель ГМ'], ['cheat-panel', '.gm-head', '🧪', 'Читы'],
  ['commerce-window', '.inv-head', '🏪', 'Обмен и лавки'], ['comp-bar', '.comp-head', '🐾', 'Спутники'], ['chat', '.panel-window-header', '💬', 'Чат'],
];

export function initFloatingPanels(id) {
  for (const [panelId, selector, icon, title] of PANEL_DEFS) {
    const el = document.getElementById(panelId);
    if (!el) continue;
    const controller = controllers.get(panelId);
    if (controller) { controller.icon = icon; controller.title = title; controller.refresh(); }
    else floatingWindow(el, { header: selector, icon, title });
  }
  loadProfile(id);
}

export function setPanelMode(id,mode){controllers.get(id)?.setMode(mode);}
export function restorePanel(id){
  const controller=controllers.get(id);if(!controller)return;
  controller.closedByManager=false;
  recoveryButton(controller,false);
  delete controller.element.dataset.panelClosed;
  controller.element.classList.remove('hidden','collapsed');
  if(id==='chat'){
    const width=parseFloat(controller.element.style.width),height=parseFloat(controller.element.style.height);
    if(Number.isFinite(width)&&width<280)controller.element.style.width='400px';
    if(Number.isFinite(height)&&height<100)controller.element.style.height='auto';
  }
  controller.setMode('normal');controller.refresh();
}

export function restoreAllPanels() {
  for (const controller of controllers.values()) controller.resetLayout();
  saved = {};
  placeRecoveryDock();persist();
}

export function revealAdminPanels({ showCheats = true } = {}) {
  if (!profileId) return false;
  const admin = controllers.get('admin-panel'), cheatPanel = controllers.get('cheat-panel');
  if (!admin || !cheatPanel) return false;
  admin.element.classList.remove('hidden');
  admin.setMode('normal'); admin.refresh();
  if (showCheats) { cheatPanel.element.classList.remove('hidden'); cheatPanel.setMode('normal'); cheatPanel.refresh(); }
  return true;
}

export function closeTopmostPanel() {
  const escIgnore = new Set(['hud-top', 'hud-map', 'auto-loot-controls', 'auto-combat-controls', 'auto-use-controls', 'target-frame', 'perf-overlay']);
  const visible = [...controllers.values()].filter(c => c.visible() && !escIgnore.has(c.element.id));
  if (!visible.length) return false;
  const selected = visible.find(c => c.element.id === activePanelId);
  const candidates = selected ? visible : visible.filter(c => c.activeAt > 0);
  if (!candidates.length) return false;
  const top = selected || candidates.sort((a, b) => {
    const za = Number.parseInt(getComputedStyle(a.element).zIndex, 10) || 0;
    const zb = Number.parseInt(getComputedStyle(b.element).zIndex, 10) || 0;
    return zb - za || b.activeAt - a.activeAt;
  })[0];
  top.closePanel();
  return true;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const refresh = () => { for (const controller of controllers.values()) controller.refresh();placeRecoveryDock(); };
  window.addEventListener('resize', refresh);
  window.addEventListener('ui-layout-change', refresh);
}
