// Спутники на клиенте (шаг 11): фигуры спутников в мире, панель спутников с полосками здоровья, команды, верховой дракон.
// Правила — shared/companions.js; всё решает сервер (server/companions.js), клиент показывает и просит.
// T — приручить / завербовать / взломать цель под курсором (Shift+T — внушение; рядом со складом без цели — вскрыть склад);
// V — приказ всем: следовать → охранять место → атаковать мою цель; N — сесть на дракона / слезть; Q — дыхание дракона (верхом);
// H — показать / скрыть панель спутников.
const Cm = () => window.Companions;
const En = () => window.Enemies;
const Items = () => window.Items;
const $ = (s) => document.querySelector(s);
import {restorePanel,setPanelMode} from '../floating-window.js';
let st = null;

export function compAttach(api) {
  // api: { send, toast, you, map, hero(), character(), target(), mouse() }
  st = { api, ents: new Map(), mine: [], allies: [], slots: 1, shrinker: false, mount: null, controlled:null, speed: 1, depots: [], open: true, orderIdx: 0, selected:null, renderKey: '' };
  api.map.flyer = window.Items.setEffects(api.character()).fly;
  const bar=$('#comp-bar');if(bar&&!bar.dataset.restoreBound){bar.dataset.restoreBound='1';bar.addEventListener('panel-restore',()=>{if(st){st.open=true;renderBar(true);}});}
  buildBar();
}
export function compDetach() { st = null; const el = $('#comp-bar'); if (el) { el.innerHTML = ''; el.classList.add('hidden'); } }
export const compSpeedMul = () => (st && st.mount ? st.speed : 1);
export const compControlled=()=>st?.controlled?st.ents.get(st.controlled)||null:null;
export function compHover(sx,sy,renderer){
  if(!st)return null;let best=null,depth=-Infinity;
  for(const e of st.ents.values()){
    if(e.inVehicle||e.mounted||renderer.fog&&!renderer.fog.see(e.x,e.y))continue;const p=renderer.toScreen(e.x,e.y),u=renderer.hh*0.9,h=u*(e.look.size||1)*3.5;
    if(Math.abs(sx-p.x)<=u*(e.look.size||1)&&sy>=p.y-h&&sy<=p.y+u*.4&&e.x+e.y>depth){best=e;depth=e.x+e.y;}
  }return best;
}
export const compLookup = (id) => (st ? st.ents.get(id) || null : null);

function addEnt(p, now = performance.now()) {
  const def = En().get(p.def);
  if (!def) return;
  st.ents.set(p.id, { id: p.id, owner: p.owner, def, look: def.look, outfit: p.outfit, name: p.name, lvl: p.lvl, hp: p.hp, down: p.down, x: p.x, y: p.y, dir: 1, moving: false, snaps: [{ t: now, x: p.x, y: p.y, m: 0 }], flashUntil: 0, mine: p.owner === st.api.you });
  familyAppearance(st.ents.get(p.id),p.family);
}
function familyAppearance(e,family){
  if(!e)return;e.family=family||null;
  if(family?.kind!=='child'||!window.Art)return;
  const c=window.Art.childLook(family.id,family.age,family.adultAge);
  e.look={...e.def.look,size:c.scale,weapon:'none',color:c.shirt,color2:c.pants};
  e.familyColors={skin:c.skin,hair:c.hair,longHair:c.longHair,underwear:c.shirt,legs:c.pants,armL:c.skin,armR:c.skin,female:family.gender==='female'};
}
export function compOnWelcome(msg) {
  if (!st) return;
  st.ents.clear();
  for (const p of msg.comps || []) addEnt(p);
  st.depots = msg.depots || [];
}
export function compOnState(list) {
  if (!st || !list) return;
  const now = performance.now();
  for (const [id, x, y, hp, flags] of list) {
    const e = st.ents.get(id);
    if (!e) continue;
    e.hp = hp; e.down = Boolean(flags & 2); e.mounted = Boolean(flags & 4); e.inVehicle = Boolean(flags & 8);e.stealth=Boolean(flags&16);
    e.snaps.push({ t: now, x, y, m: flags & 1 });
    if (e.snaps.length > 30) e.snaps.shift();
  }
}
export function compOnMessage(msg) {
  if (!st) return false;
  switch (msg.t) {
    case 'comp-control':st.controlled=msg.id||null;renderBar(true);renderControlBadge();st.api.toast(msg.id?'Управление спутником: движение — обычные клавиши или щелчок, ПКМ — атака, Shift+\\ — следующий. Вернуться к герою — \\ или ↩.':'Управление героем восстановлено.',3500);return true;
    case 'comp-add': addEnt(msg.comp); return true;
    case 'comp-family':familyAppearance(st.ents.get(msg.id),msg.family);return true;
    case 'comp-outfit': { const e = st.ents.get(msg.id); if (e) e.outfit = msg.outfit; return true; }
    case 'comp-remove': if(st.controlled===msg.id){st.controlled=null;renderControlBadge();}st.ents.delete(msg.id); return true;
    case 'comp-list':
      st.mine = msg.list; st.allies=msg.allies||[]; st.slots = msg.slots; st.shrinker = Boolean(msg.shrinker);
      renderBar();
      return true;
    case 'comp-mount':
      st.mount = msg.id; st.speed = msg.speed || 1;
      st.api.hero().mounted = Boolean(msg.id);
      st.api.map.flyer = Boolean(msg.id && msg.fly) || window.Items.setEffects(st.api.character()).fly;
      st.api.toast(msg.id ? 'Вы верхом на драконе: быстрее, над водой и горами. Q — дыхание, N — слезть.' : 'Вы спешились.', 2600);
      renderBar();
      return true;
    case 'comp-rider': return true;
    case 'comp-try':
      st.api.toast(msg.ok ? `${Cm().METHODS[msg.method].name}: удалось!` : `${Cm().METHODS[msg.method].name}: не вышло (шанс ${Math.round(msg.chance * 100)}%).`, 2400);
      return true;
    case 'comp-breath': if (msg.hits) st.api.toast(`Дыхание дракона: задето ${msg.hits}`, 1200); return true;
    case 'comp-reject': st.api.toast(msg.message, 3000); return true;
    default: return false;
  }
}

// ---------- Клавиши ----------
function nearDepot() {
  const h = st.api.hero(), r = (window.GameSettings || {}).depotRadius || 4;
  return st.depots.find((d) => Math.hypot(d.x + 0.5 - h.x, d.y + 0.5 - h.y) <= r) || null;
}
// Кто может принять управление: свой, в строю (не в контейнере), не ранен, не в машине и не под седлом
export function controllable() {
  if (!st) return [];
  return st.mine.filter((c) => c.out && !c.down && st.ents.get(c.id) && !st.ents.get(c.id).inVehicle && st.mount !== c.id);
}
export function controlKey(next = false) {
  if (!st) return null;
  const list = controllable();
  if (st.controlled && !next) { st.api.send({ t: 'comp', a: 'control', id: st.controlled }); return st.controlled; } // повтор — вернуться к герою
  if (!list.length) { st.api.toast('Некем управлять: нужен свой спутник в строю — не в контейнере, не раненый, не в машине.', 3000); return null; }
  let pick;
  if (st.controlled) { const i = list.findIndex((c) => c.id === st.controlled); pick = list[(i + 1) % list.length]; }
  else {
    const sel = list.find((c) => c.id === st.selected);
    const h = st.api.hero(), d = (c) => { const e = st.ents.get(c.id); return Math.hypot(e.x - h.x, e.y - h.y); };
    pick = sel || list.slice().sort((a, b) => d(a) - d(b))[0];
  }
  if (!pick || pick.id === st.controlled) return null;
  st.api.send({ t: 'comp', a: 'control', id: pick.id });
  return pick.id;
}
// Плашка «вы управляете …» с кнопкой возврата
function renderControlBadge() {
  const b = document.getElementById('comp-control-badge');
  if (!b) return;
  const rec = st && st.controlled ? st.mine.find((c) => c.id === st.controlled) : null;
  b.classList.toggle('hidden', !rec);
  if (!rec) return;
  const name = b.querySelector('.ccb-name');
  if (name) name.textContent = rec.name;
}

export function compKey(e) {
  if (!st) return false;
  const send = st.api.send;
  if (e.code === 'NumpadAdd' || (e.code === 'Equal' && e.shiftKey)) {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return false;
    e.preventDefault();
    send({ t: 'comp', a: 'order', id: 'all', order: 'board' });
    st.api.toast('Спутники идут к ближайшему транспорту.', 1800);
    return true;
  }
  // Приказы всем: «,» — ко мне, «.» — войти в здание, «/» — выйти (из машины / здания); с Shift — то же
  // (если рация голосового чата назначена на одну из этих клавиш, без Shift её занимает рация — см. voice.js)
  // «\» — вселиться в спутника (выбранного или ближайшего) / вернуться к герою; Shift+\ — следующий спутник
  if (e.code === 'Backslash' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return false;
    e.preventDefault();
    controlKey(e.shiftKey);
    return true;
  }
  const quick = { Comma: 'come', Period: 'enter', Slash: 'exit' }[e.code];
  if (quick && !e.ctrlKey && !e.altKey && !e.metaKey) {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return false;
    e.preventDefault();
    quickOrder(quick);
    return true;
  }
  switch (e.code) {
    case 'KeyT': {
      e.preventDefault();
      const tg = st.api.target();
      const former=st.allies.find(c=>c.id===tg?.id)||st.allies.filter(c=>c.near).sort((a,b)=>a.distance-b.distance)[0];
      if(former){send({t:'comp',a:'rejoin',id:former.id});return true;}
      if (!tg || !tg.def) {
        const d = nearDepot();
        if (d) { send({ t: 'comp', a: 'depot', id: d.id }); return true; }
        st.api.toast('Наведите курсор на существо (или выберите цель) и нажмите T.', 2400);
        return true;
      }
      const methods = Cm().methodsFor(tg.def);
      if (!methods.length) { st.api.toast(`«${tg.def.name}» не может стать спутником.`, 2400); return true; }
      const method = e.shiftKey && methods.includes('suggest') ? 'suggest' : methods[0];
      send({ t: 'tame', target: tg.id, method, pay: method === 'persuade' && e.altKey });
      return true;
    }
    case 'KeyV': {
      e.preventDefault();
      const orders = ['follow', 'guard', 'attack'];
      st.orderIdx = (st.orderIdx + 1) % orders.length;
      const order = orders[st.orderIdx], tg = st.api.target();
      if (order === 'attack' && !(tg && tg.def)) { st.orderIdx = 0; send({ t: 'comp', a: 'order', id: 'all', order: 'follow' }); st.api.toast('Приказ: следовать (для атаки выберите цель)', 1800); return true; }
      send({ t: 'comp', a: 'order', id: 'all', order, target: order === 'attack' ? tg.id : undefined });
      st.api.toast('Приказ всем: ' + Cm().ORDERS[order].toLowerCase(), 1600);
      return true;
    }
    case 'KeyN': e.preventDefault(); send({ t: 'comp', a: 'mount' }); return true;
    case 'KeyQ': {
      if (!st.mount) return false;
      e.preventDefault();
      const m = st.api.mouse();
      if (m) send({ t: 'comp', a: 'breath', x: m.x, y: m.y });
      return true;
    }
    case 'KeyH': {
      e.preventDefault();const panel=$('#comp-bar');
      if(!st.open||panel?.matches('.hidden,.window-iconified,.window-collapsed,.window-minimized')){st.open=true;renderBar(true);restorePanel('comp-bar');}
      else{setPanelMode('comp-bar',panel.dataset.panelMode==='compact'?'normal':'compact');}return true;
    }
    default: return false;
  }
}

// Разовый приказ всем спутникам (кнопки панели и клавиши , . /)
const QUICK_TOAST = { come: 'Спутники: ко мне!', enter: 'Спутники идут в ближайший дом и ждут внутри.', exit: 'Спутники выходят из машины / здания.' };
export function quickOrder(order) {
  if (!st) return;
  st.api.send({ t: 'comp', a: 'order', id: 'all', order });
  st.api.toast(QUICK_TOAST[order], 1800);
}

// ---------- Панель спутников ----------
function buildBar() {
  const el = $('#comp-bar');
  if (!el) return;
  el.querySelector('.comp-list')?.remove();
  if (!el.dataset.bound) { el.dataset.bound = '1'; el.addEventListener('click', onBarClick); el.addEventListener('change', onBarChange); }
  const back = document.getElementById('btn-comp-return');
  if (back && !back.dataset.bound) { back.dataset.bound = '1'; back.addEventListener('click', () => { if (st && st.controlled) st.api.send({ t: 'comp', a: 'control', id: st.controlled }); }); }
  renderBar(true);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderBar(force = false) {
  const el = $('#comp-bar');
  if (!el || !st) return;
  // Не заменяем DOM списка, пока пользователь выбирает приказ/стойку:
  // частые comp-list обновления приходят одновременно с раскрытым select.
  if (!force && el.contains(document.activeElement) && document.activeElement.matches('select[data-a]')) return;
  if (!force && el.querySelector('.comp-gear')) return;
  const scrollTop = el.querySelector('.comp-list')?.scrollTop || 0;
  const now = Date.now();
  const key = JSON.stringify([st.mine.map((c) => [c.id, c.hp, c.out, c.down ? Math.ceil((c.down - now) / 1000) : 0, c.order, c.stance, Math.round(c.food), c.lvl, c.wait]),st.allies.map(c=>[c.id,c.hp,c.near,Math.floor(c.distance||0)]), st.slots, st.shrinker, st.mount,st.controlled, st.open,st.selected,el.dataset.panelMode]);
  if (!force && key === st.renderKey) return;
  st.renderKey = key;
  if((st.mine.length||st.allies.length)&&!el.dataset.panelClosed)el.classList.remove('hidden');
  el.classList.toggle('comp-collapsed', !st.open);
  const out = st.mine.length;
  const head = `<div class="comp-head" title="Напарники: сколько спутников можно призвать одновременно. H — свернуть/развернуть."><span>🐾 Спутники ${out}/${st.slots}${st.shrinker ? ' · 🫙 контейнер' : ''}</span><button type="button" class="btn small" data-a="board-all" title="Посадить всех призванных спутников в ближайший транспорт (до 11); клавиша +">＋</button><button type="button" class="btn small" data-a="quick" data-order="come" title="Ко мне: все спутники бегут к вам (выходят из машины, возвращаются из дома); клавиша ,">⤵</button><button type="button" class="btn small" data-a="quick" data-order="enter" title="Войти в здание: спутники заходят в ближайший дом (до 10 клеток) и ждут внутри; клавиша .">🏠</button><button type="button" class="btn small" data-a="quick" data-order="exit" title="Выйти: из машины — рядом с ней; из дома или подземелья — на улицу, ждать у входа; клавиша /">🚪</button><button type="button" class="btn small" data-a="toggle" aria-expanded="${st.open}" aria-label="${st.open ? 'Компактный список' : 'Полный список'}">${st.open ? '▾' : '▸'}</button></div>`;
  let header=el.querySelector('.comp-head');
  if(!header){el.querySelector('.panel-window-generated-head')?.remove();el.insertAdjacentHTML('beforeend',head);header=el.querySelector('.comp-head');}
  header.querySelector('span').textContent=`🐾 Спутники ${out}/${st.slots}${st.shrinker?' · 🫙 контейнер':''}`;
  const toggle=header.querySelector('[data-a="toggle"]');toggle.setAttribute('aria-expanded',String(st.open));toggle.setAttribute('aria-label',st.open?'Свернуть спутников':'Развернуть спутников');toggle.textContent=st.open?'▾':'▸';
  let list=el.querySelector('.comp-list');if(!list){list=document.createElement('div');list.className='comp-list';el.append(list);}list.classList.toggle('hidden',!st.open);
  if(!st.open)return;
  const compact=el.dataset.panelMode!=='maximized';
  const choices=[...st.mine,...st.allies];if(!choices.some(c=>c.id===st.selected))st.selected=choices[0]?.id||null;
  let picker=el.querySelector('.comp-picker');
  if(!picker){picker=document.createElement('select');picker.className='comp-picker';picker.dataset.a='select-companion';picker.title='Выберите спутника или исключённого союзника';picker.setAttribute('aria-label',picker.title);el.insertBefore(picker,list);}
  picker.hidden=!compact||!choices.length;picker.innerHTML=choices.map(c=>`<option value="${c.id}" ${c.id===st.selected?'selected':''}>${esc(c.name)}${st.allies.includes(c)?' — исключённый союзник':''}</option>`).join('');
  const rows = st.mine.filter(c=>!compact||c.id===st.selected).map((c) => {
    const pct = Math.max(0, Math.round((c.hp / c.max) * 100));
    const status = c.down ? `<span class="comp-down" title="Подойдите и нажмите «Спасти», пока не истекло время">ранен · ${Math.max(0, Math.ceil((c.down - now) / 1000))} с</span>`
      : !c.out ? '<span class="comp-stored">в контейнере</span>' : c.wait ? `<span class="comp-wait" title="Ждёт в другом месте. Придите туда или прикажите «Ко мне» (,)">ждёт: ${esc(c.wait)}</span>` : c.until ? `<span class="comp-temp" title="Внушение закончится — существо снова станет врагом">внушение ${Math.max(0, Math.ceil((c.until - now) / 1000))} с</span>` : '';
    const food = c.kind === 'beast' || c.kind === 'dragon' ? `<div class="comp-food" title="Сытость ${c.food}/100: голодный зверь не лечится и бьёт слабее. Кормите едой из сумки."><i style="width:${c.food}%"></i></div>` : '';
    const btns = [];
    if(c.kind==='machine')btns.push(['repair','🔧','Починить робота: 2 металлолома и 1 электроника; подойдите ближе']);
    if (c.down) btns.push(['revive', '✚', 'Спасти (подойдите ближе)']);
    else if (c.out) {
      btns.push(['control',st.controlled===c.id?'↩':'🎮',st.controlled===c.id?'Вернуть управление герою (\\)':'Вселиться за спутника: управлять им; герой идёт следом и защищается (\\ — выбранным или ближайшим)']);
      if (st.shrinker) btns.push(['store', '🫙', 'Спрятать в контейнер-уменьшитель']);
      if (window.Companions.canMount(c)) btns.push(['mount', st.mount === c.id ? '⬇' : '🐉', st.mount === c.id ? 'Слезть (N)' : 'Сесть верхом (N): лошадь ускоряет движение, дракон также может летать']);
    } else btns.push(['summon', '⤴', 'Призвать из контейнера (нужно свободное место)']);
    if (c.kind === 'beast' || c.kind === 'dragon') btns.push(['feed', '🍖', 'Покормить едой из сумки']);
    btns.push(['gear', '🎒', 'Инвентарь: одежда, оружие, броня, книги и свитки']);
    btns.push(['release', '✕', 'Исключить из команды: остаётся самостоятельным союзником, можно принять обратно рядом']);
    const order = `<select data-a="order" data-id="${c.id}" title="Приказ">${Object.entries(Cm().ORDERS).map(([k, v]) => `<option value="${k}"${k === c.order ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
    const stance = `<select data-a="stance" data-id="${c.id}" title="Стойка: агрессивный сам нападает на врагов рядом, пассивный — только по приказу">${Object.entries(Cm().STANCES).map(([k, v]) => `<option value="${k}"${k === c.stance ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
    const def = En().get(c.def);
    const tip = `${def ? def.name : c.def} · ${Cm().METHODS[c.method] ? Cm().METHODS[c.method].name : ''} · опыт ${c.xp}/${c.next}` + (c.equip && (c.equip.weapon || c.equip.armor) ? ' · ' + ['weapon', 'armor'].filter((k) => c.equip[k]).map((k) => Items().get(c.equip[k].id).name).join(', ') : '');
    return `<div class="comp-row${c.out ? '' : ' stored'}" data-id="${c.id}"><div class="comp-name" title="${esc(tip)}">${esc(c.name)} <small>ур. ${c.lvl}</small> ${status}</div>
      <div class="comp-hp" title="Здоровье ${c.hp}/${c.max}"><i style="width:${pct}%" class="${pct < 35 ? 'low' : ''}"></i></div>${food}
      <div class="comp-ctl">${c.out && !c.down ? order + stance : ''}${btns.map(([a, t, h]) => `<button type="button" class="btn small${a==='control'?' comp-control-button':''}" data-a="${a}" data-id="${c.id}" title="${h}"${a==='control'?' aria-label="'+(st.controlled===c.id?'Вернуть управление герою':'Управлять спутником')+'"':''}>${t}</button>`).join('')}</div></div>`;
  }).join('');
  const visibleAllies=st.allies.filter(c=>!compact||c.id===st.selected);
  const allies=visibleAllies.length?'<div class="comp-allies-heading">Исключённые союзники — принять обратно</div>'+visibleAllies.map(c=>`<div class="comp-row"><span>${esc(c.name)} · ${c.hp}/${c.max} · расстояние ${c.distance ?? '?'} кл.</span><button type="button" class="btn small" data-native-icon data-help="h-rejoin" data-a="rejoin" data-id="${c.id}" title="${!c.near?'Подойдите ближе к союзнику, затем нажмите: принять обратно в команду':st.mine.length>=st.slots?'Освободите слот: исключите другого спутника':'Принять обратно в команду (или T рядом)'}" ${!c.near||st.mine.length>=st.slots?'disabled':''}>🤝</button></div>`).join(''):'';
  list.innerHTML=rows+allies+(!out&&!allies?'<p>Спутников пока нет. Выберите существо и нажмите T.</p>':'')+'<div class="comp-keys">Команда: до 11; контейнер занимает место. T — приручить/завербовать · V — приказ всем (Shift+V при рации на V) · , — ко мне · . — войти в здание · / — выйти · + — транспорт · \\ — вселиться в спутника / вернуться к герою · H — панель</div>';
  el.querySelector('.comp-list').scrollTop = scrollTop;
}
function onBarClick(ev) {
  const b = ev.target.closest('button[data-a]');
  if (!b || !st) return;
  const a = b.dataset.a, id = b.dataset.id;
  if (a === 'toggle') {setPanelMode('comp-bar',$('#comp-bar').dataset.panelMode==='compact'?'normal':'compact');return;}
  if (a === 'board-all') { st.api.send({ t: 'comp', a: 'order', id: 'all', order: 'board' }); return; }
  if (a === 'quick') { quickOrder(b.dataset.order); return; }
  if (a === 'gear') return gearMenu(id, b);
  st.api.send({ t: 'comp', a, id });
}
function onBarChange(ev) {
  const s = ev.target.closest('select[data-a]');
  if (!s || !st) return;
  if(s.dataset.a==='select-companion'){st.selected=s.value;renderBar(true);return;}
  const tg = st.api.target();
  if (s.dataset.a === 'order') st.api.send({ t: 'comp', a: 'order', id: s.dataset.id, order: s.value, target: s.value === 'attack' && tg ? tg.id : undefined });
  else st.api.send({ t: 'comp', a: 'stance', id: s.dataset.id, stance: s.value });
}
// Одетые вещи и сумка спутника; список героя ограничен, поиск просматривает всю сумку.
function gearMenu(id, anchor) {
  const ch = st.api.character();
  const c = st.mine.find((x) => x.id === id);
  const old = document.querySelector('.comp-gear');
  if (old) old.remove();
  const box = document.createElement('div');
  box.className = 'comp-gear';
  const worn = Object.entries(c.equip || {}).map(([k,x]) => `<button type="button" class="btn small" data-un="${esc(k)}">${esc(k === 'weapon' ? 'Оружие' : Items().slotById(k)?.name || k)}: ${esc(Items().get(x.id)?.name || x.id)}${x.dur != null ? ' · '+x.dur+' прочн.' : ''} — снять</button>`).join('');
  const bag = (c.bag || []).map(x => `<button type="button" class="btn small" data-take="${esc(x.uid)}">${esc(Items().get(x.id)?.name || x.id)} × ${x.n} — забрать</button>`).join('');
  const spells = (c.spells || []).map(id => window.Magic.get(id)?.name || id).join(', ');
  box.innerHTML = `<strong>Инвентарь: ${esc(c.name)}</strong><button type="button" data-close>Закрыть</button><div>Надето</div>${worn || '<div>Нет снаряжения.</div>'}<div>Сумка ${(c.bag || []).length}/64</div>${bag || '<div>Пусто.</div>'}<div>Мана: ${c.mp ?? 0} · Магия: ${esc(spells || 'нет')}</div><p>Оружие и одежда надеваются при передаче. Книги и свитки дают магию, пока лежат в сумке.</p><label>Количество для передачи <input type="number" data-count value="1" min="1" max="9999" step="1"></label><input type="search" placeholder="Найти вещь героя" aria-label="Поиск вещи для спутника"><div class="comp-give-list"></div>`;
  const fill = () => {
    const query = box.querySelector('input[type=search]').value.trim().toLowerCase(), rows = [];
    for (let i = 0; i < ch.inventory.cells.length && rows.length < 100; i++) {
      const x = ch.inventory.cells[i], it = x && Items().get(x.id);
      if (it && !it.fixed && it.id !== 'caps' && (!query || (it.name+' '+it.id).toLowerCase().includes(query))) rows.push(`<button type="button" class="btn small" data-cell="${i}" data-uid="${esc(x.uid)}">Дать: ${esc(it.name)} × ${x.n}</button>`);
    }
    box.querySelector('.comp-give-list').innerHTML = rows.join('') || 'Нет подходящих вещей.';
  };
  box.querySelector('input[type=search]').addEventListener('input', fill); fill();
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cell != null) st.api.send({ t: 'comp', a: 'equip', id, cell: Number(b.dataset.cell), uid: b.dataset.uid, count: Number(box.querySelector('[data-count]').value) });
    if (b.dataset.un) st.api.send({ t: 'comp', a: 'unequip', id, slot: b.dataset.un });
    if (b.dataset.take) st.api.send({ t: 'comp', a: 'take', id, uid: b.dataset.take });
    box.remove();
  });
  anchor.closest('.comp-row').appendChild(box);
}

// ---------- Рисование ----------
export function compScene(scene, r, now) {
  if (!st) return scene;
  renderBar();
  const t = now - 120; // как у врагов: небольшая задержка для плавности
  const figs = [];
  for (const e of st.ents.values()) {
    const sn = e.snaps;
    while (sn.length > 2 && sn[1].t <= t) sn.shift();
    let nx, ny;
    if (sn.length >= 2 && sn[0].t <= t) {
      const k = Math.min(1, (t - sn[0].t) / Math.max(1, sn[1].t - sn[0].t));
      nx = sn[0].x + (sn[1].x - sn[0].x) * k; ny = sn[0].y + (sn[1].y - sn[0].y) * k;
      e.moving = Boolean(sn[1].m || sn[0].m);
    } else { const l = sn[sn.length - 1]; nx = l.x; ny = l.y; e.moving = Boolean(l.m); }
    if (e.mounted && e.mine) { const h = st.api.hero(); nx = h.x; ny = h.y + 0.05; e.moving = h.moving; e.alt = h.alt || 0; } // в полёте не плывёт
    const dsx = (nx - ny) - (e.x - e.y);
    if (Math.abs(dsx) > 1e-3) e.dir = dsx > 0 ? 1 : -1;
    e.x = nx; e.y = ny;
    e.flash = e.flashUntil > now ? (e.flashUntil - now) / 140 : 0;
    e.alpha = e.down ? 0.45 : 1; e.flags = e.down ? 2 : 0;
    e.ring = null;
    if (e.inVehicle) continue;
    if (!e.mine && r && r.fog && !r.fog.see(e.x, e.y)) continue; // чужой спутник вне обзора (туман войны, шаг 22)
    figs.push(e);
  }
  const over = scene.overlay;
  return {
    ...scene, enemies: [...(scene.enemies || []), ...figs],
    overlay: (rr, tt) => {
      if (over) over(rr, tt);
      for (const e of figs) { // имя и полоска здоровья: свои — зелёные
        if (e.mounted) continue;
        if (!e.mine && rr.fog && !rr.fog.see(e.x, e.y)) continue; // чужой спутник вне обзора (туман войны)
        const s = rr.toScreen(e.x, e.y), h = rr.hh * 0.9 * (e.look.size || 1) * 2.6;
        rr.label((e.down ? '✚ ' : '') + e.name, s.x, s.y - h - 12, e.mine ? '#9dff9a' : '#c8f0c8');
        const w = rr.hw * 0.9, ctx = rr.ctx;
        ctx.fillStyle = '#000a'; ctx.fillRect(s.x - w / 2, s.y - h - 8, w, 4);
        ctx.fillStyle = e.hp > 35 ? '#6fd35a' : '#e0503a'; ctx.fillRect(s.x - w / 2, s.y - h - 8, (w * e.hp) / 100, 4);
      }
    },
  };
}
