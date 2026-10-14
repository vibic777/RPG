import {replacePanelHtml} from '../floating-window.js';
import { drawBasePiece } from './base-art.js';
// База, строительство, добыча и крафт на клиенте (шаг 10). Правила и данные — shared/building.js и shared/crafting.js;
// всё решает сервер, клиент показывает и отправляет просьбы.
// B — режим строительства (призрак постройки под курсором, R — поворот, ЛКМ — поставить; инструменты «Ремонт», «Снести»);
// K — книга рецептов с очередью; E — добыть ресурс рядом / открыть сундук или станок рядом.
// Щелчок по своей двери — запереть/отпереть, по сундуку — открыть, по кровати — назначить точкой возрождения,
// по ресурсной точке (дерево, валун, завал) — добыть.
const B = () => window.Building;
const C = () => window.Crafting;
const Items = () => window.Items;
const $ = (s) => document.querySelector(s);
let st = null;

let buttonsBound = false;
export function baseAttach(api) {
  // api: { send, toast, you, map, hero(), character(), openInv() }
  const networkSend=api.send;
  api={...api,send:message=>{
    if(message.t==='gather'||message.t==='build'&&['place','repair','demolish'].includes(message.a)||message.t==='craft'&&message.recipe){
      const hero=api.hero();hero.actionAt=performance.now();hero.actionKind='work';
      if(Number.isFinite(message.x)&&Number.isFinite(message.y))hero.facingAngle=Math.atan2(message.y+0.5-hero.y,message.x+0.5-hero.x);
    }
    networkSend(message);
  }};
  st = { api, bases: new Map(), pieces: new Map(), tiles: new Map(), nodes: new Map(), craft: { known: [], queue: [], stations: [] },
    workshopQuery:'', workshopItem:null, mode: null, piece: 'wall_wood', rot: 0, chest: null };
  api.map.blocks = new Map();
  api.map.walkways = new Map();api.map.buildElevation=0;
  api.map.actor = api.you; // клиент ищет путь только для себя: свои двери проходимы
  buildPanels();
  if (!buttonsBound) {
    buttonsBound = true;
    $('#btn-build').addEventListener('click', () => { if (st) toggleBuild(); });
    $('#btn-craft').addEventListener('click', () => { if (st) toggleCraft(); });
  }
}
export function baseDetach() {
  st = null;
  for (const id of ['#build-window', '#craft-window', '#chest-window']) { const el = $(id); if (el) el.classList.add('hidden'); }
}
export const baseMode = () => Boolean(st && st.mode);
export const baseAnyOpen = () => Boolean(st) && ['#build-window', '#craft-window', '#chest-window'].some((id) => !$(id).classList.contains('hidden'));

export function baseHover(x,y){
  if(!st)return null;const tile=st.tiles.get(Math.floor(y)*st.api.map.width+Math.floor(x));
  const p=tile&&(tile.main||tile.roof||tile.floor);if(p){const def=B().get(p.type);return {text:`${def.name} · ${def.desc||'Постройка базы; B — строительство, E рядом — взаимодействие'}`,topic:'building:'+def.id,key:'building:'+p.id};}return null;
}
const idx = (x, y) => y * st.api.map.width + x;
const layerOf = (p) => B().get(p.type).layer;
function indexPiece(p) {
  const old = st.pieces.get(p.id);
  if (old) unindexPiece(old);
  st.api.map.walkways ||= new Map();
  if(B().get(p.type).battlements || p.type==='stairs') st.api.map.walkways.set(idx(p.x, p.y),p.id);
  st.pieces.set(p.id, p);
  const k = idx(p.x, p.y), t = st.tiles.get(k) || {};
  t[layerOf(p)] = p; st.tiles.set(k, t);
  const def = B().get(p.type), base = st.bases.get(p.base);
  if ((def.layer === 'main' || def.layer === 'floor') && def.block) st.api.map.blocks.set(k, { block: def.block, get locked() { return p.locked; }, owner: p.owner, get allow() { return base ? base.allow.map((a) => a.id) : []; }, pid: p.id });
}
function unindexPiece(p) {
  const walkKey=idx(p.x, p.y);
  if(st.api.map.walkways?.get(walkKey)===p.id)st.api.map.walkways.delete(walkKey);
  st.pieces.delete(p.id);
  const k = idx(p.x, p.y), t = st.tiles.get(k);
  if (t && t[layerOf(p)] && t[layerOf(p)].id === p.id) t[layerOf(p)] = null;
  const b = st.api.map.blocks.get(k);
  if (b && b.pid === p.id) st.api.map.blocks.delete(k);
}
const at = (x, y, layer) => { const t = st.tiles.get(idx(x, y)); return (t && t[layer]) || null; };
const myBase = () => [...st.bases.values()].find((b) => b.owner === st.api.you) || null;
const access = (base) => base && (base.owner === st.api.you || base.allow.some((a) => a.id === st.api.you));

export function baseOnWelcome(msg) {
  if (!st) return;
  const w = msg.bld || { bases: [], pieces: [], nodes: [] };
  for (const b of w.bases) st.bases.set(b.id, b);
  for (const p of w.pieces) indexPiece(p);
  const now = Date.now();
  for (const [k, until] of w.nodes || []) st.nodes.set(k, until - (msg.time || now) + now);
  if (msg.craft) st.craft = { ...st.craft, ...msg.craft };
}

export function baseOnMessage(msg) {
  if (!st) return false;
  switch (msg.t) {
    case 'bld-height': st.api.hero().buildElevation=msg.height; st.api.map.buildElevation=msg.height; break;
    case 'bld-base': st.bases.set(msg.base.id, msg.base); break;
    case 'bld-base-remove':
      st.bases.delete(msg.id);
      for (const p of [...st.pieces.values()]) if (p.base === msg.id) unindexPiece(p);
      break;
    case 'bld-add': indexPiece(msg.p); if (st.mode) queueBuildRender(); break;
    case 'bld-upd': { const p = st.pieces.get(msg.id); if (p) { p.hp = msg.hp; p.locked = msg.locked; if (msg.n != null) p.n = msg.n; } break; }
    case 'bld-remove': { const p = st.pieces.get(msg.id); if (p) unindexPiece(p); if (st.chest === msg.id) closeChest(); break; }
    case 'bld-reject': st.api.toast(msg.message, 2600); break;
    case 'node-upd': if (msg.until) st.nodes.set(msg.i, msg.until); else st.nodes.delete(msg.i); break;
    case 'gathered': st.api.toast(`${B().NODES[msg.kind].name}: +${msg.items.map((i) => `${i.name} × ${i.n}`).join(', ')}${msg.left ? '' : ' — истощено'}`, 1600); break;
    case 'chest': st.chest = msg.id; renderChest(msg.items); break;
    case 'craft': st.craft = { known: msg.known, queue: msg.queue, stations: msg.stations || st.craft.stations }; renderCraft(); break;
    case 'craft-reject': st.api.toast(msg.message, 2800); break;
    default: return false;
  }
  return true;
}

// ---------- Клавиши ----------
export function baseKey(e) {
  if (!st) return false;
  if (e.code === 'KeyB') { e.preventDefault(); toggleBuild(); return true; }
  if (e.code === 'KeyK') { e.preventDefault(); toggleCraft(); return true; }
  if (e.code === 'KeyE') { e.preventDefault(); interactNear(); return true; }
  if (st.mode && e.code === 'KeyR') { e.preventDefault(); st.rot = (st.rot + 1) % 4; renderBuild(); return true; }
  if (e.code === 'Escape' && baseAnyOpen()) {
    e.preventDefault();
    if (!$('#chest-window').classList.contains('hidden')) closeChest();
    else if (!$('#craft-window').classList.contains('hidden')) toggleCraft(false);
    else toggleBuild(false);
    return true;
  }
  return false;
}

function toggleBuild(force) {
  const open = force === undefined ? !st.mode : force;
  st.mode = open ? (st.mode || 'place') : null;
  $('#build-window').classList.toggle('hidden', !open);
  if (open) { renderBuild(); if (!myBase()) st.api.toast('Сначала объявите базу: создайте «Флаг базы» (K) и используйте его в сумке.', 4000); }
}
function toggleCraft(force) {
  const el = $('#craft-window');
  const open = force === undefined ? el.classList.contains('hidden') : force;
  el.classList.toggle('hidden', !open);
  if (open) { st.api.send({ t: 'craft', a: 'list' }); renderCraft(); }
}

// ---------- Щелчок по карте ----------
export function baseClick(e, w) {
  if (!st || e.button !== 0) return false;
  const x = Math.floor(w.x), y = Math.floor(w.y);
  if (st.mode) {
    if (st.mode === 'place') st.api.send({ t: 'build', a: 'place', type: st.piece, x, y, rot: st.rot });
    else {
      const p = at(x, y, 'main') || at(x, y, 'roof') || at(x, y, 'floor');
      if (!p) st.api.toast('Здесь нет постройки.');
      else if (st.mode === 'demolish' && !confirm(`Снести «${B().get(p.type).name}»? Вернётся половина материалов.`)) return true;
      else st.api.send({ t: 'build', a: st.mode, id: p.id });
    }
    return true;
  }
  const p = at(x, y, 'main');
  if (p && usePiece(p)) return true;
  if (B().nodeAt(st.api.map, x, y) && Math.hypot(st.api.hero().x - (x + 0.5), st.api.hero().y - (y + 0.5)) <= B().settings.gatherRange) {
    st.api.send({ t: 'gather', x, y });
    return true;
  }
  return false;
}
function usePiece(p) {
  const def = B().get(p.type), base = st.bases.get(p.base), h = st.api.hero();
  const near = Math.hypot(h.x - (p.x + 0.5), h.y - (p.y + 0.5)) <= B().settings.buildRange;
  if (!near || !access(base)) return false;
  if (def.block === 'door' && base.owner === st.api.you) { st.api.send({ t: 'build', a: 'lock', id: p.id }); return true; }
  if(def.id==='stairs') {st.api.send({t:'build',a:'climb',id:p.id});return true;}
  if (def.storage) { st.api.send({ t: 'build', a: 'chest', op: 'open', id: p.id }); return true; }
  if (def.bed) { st.api.send({ t: 'build', a: 'bed', id: p.id }); return true; }
  if (def.station) { toggleCraft(true); return true; }
  return false;
}
// E: ближайшая ресурсная точка в пределах добычи, иначе ближайший сундук/станок/кровать
function interactNear() {
  const h = st.api.hero(), map = st.api.map;
  let best = null, bd = B().settings.gatherRange;
  for (let y = Math.floor(h.y) - 2; y <= Math.floor(h.y) + 2; y++) for (let x = Math.floor(h.x) - 2; x <= Math.floor(h.x) + 2; x++) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height || !B().nodeAt(map, x, y)) continue;
    const d = Math.hypot(h.x - (x + 0.5), h.y - (y + 0.5));
    if (d <= bd) { bd = d; best = { x, y }; }
  }
  if (best) { st.api.send({ t: 'gather', x: best.x, y: best.y }); return; }
  let piece = null; bd = 2.5;
  for (const p of st.pieces.values()) {
    const def = B().get(p.type);
    if (!def.storage && !def.station && !def.bed && def.id!=='stairs') continue;
    const d = Math.hypot(h.x - (p.x + 0.5), h.y - (p.y + 0.5));
    if (d < bd) { bd = d; piece = p; }
  }
  if (piece && usePiece(piece)) return;
  st.api.toast('Рядом нечего добывать. Деревья — в лесу, валуны — в холмах и пустошах, завалы — в руинах.', 2600);
}

// ---------- Панели ----------
const costText = (cost) => Object.entries(cost).map(([id, n]) => `${Items().get(id).name} × ${n}`).join(', ') || 'бесплатно';
const have = (id) => { const ch = st.api.character(); return C().haveCount(ch, id); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function buildPanels() {
  const bw = $('#build-window');
  if (bw && !bw.dataset.built) {
    bw.dataset.built = '1';
    bw.addEventListener('click', (e) => {
      const t = e.target.closest('[data-piece],[data-tool],[data-rot],[data-close],[data-flag],[data-template]');
      if (!t) return;
      if(t.dataset.flag) { st.api.send({t:'craft',recipe:'base_flag',n:1}); toggleCraft(true); return; }
      if(t.dataset.template) { st.api.send({t:'build',a:'template',id:t.dataset.template}); return; }
      if (t.dataset.close) return toggleBuild(false);
      if (t.dataset.piece) { st.piece = t.dataset.piece; st.mode = 'place'; }
      if (t.dataset.tool) st.mode = t.dataset.tool;
      if (t.dataset.rot) st.rot = (st.rot + 1) % 4;
      renderBuild();
    });
    bw.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = bw.querySelector('input[name=allow]').value.trim();
      if (name) st.api.send({ t: 'build', a: 'allow', name, on: !e.submitter || e.submitter.value !== 'off' });
    });
  }
  const cw = $('#craft-window');
  if (cw && !cw.dataset.built) {
    cw.dataset.built = '1';
    cw.addEventListener('input',e=>{if(e.target.matches('[data-workshop-search]')){st.workshopQuery=e.target.value;renderWorkshopItems();}});
    cw.addEventListener('change',e=>{if(e.target.matches('[data-workshop-items]')){st.workshopItem=e.target.value;renderWorkshopCost();}});
    cw.addEventListener('click', (e) => {
      const t = e.target.closest('[data-craft],[data-cancel],[data-close],[data-workshop]');
      if (!t) return;
      if(t.dataset.workshop){const item=cw.querySelector('[data-workshop-items]').value,cell=cw.querySelector('[data-upgrade-cell]').value;st.api.send({t:'craft',a:'workshop',item,upgrade:t.dataset.workshop==='upgrade',cell:Number(cell)});return;}
      if (t.dataset.close) return toggleCraft(false);
      if (t.dataset.craft) st.api.send({ t: 'craft', recipe: t.dataset.craft, n: Number(t.dataset.n || 1) });
      if (t.dataset.cancel) st.api.send({ t: 'craft', a: 'cancel', id: t.dataset.cancel });
    });
  }
  const chw = $('#chest-window');
  if (chw && !chw.dataset.built) {
    chw.dataset.built = '1';
    chw.addEventListener('click', (e) => {
      const t = e.target.closest('[data-take],[data-put],[data-close]');
      if (!t || !st.chest) return;
      if (t.dataset.close) return closeChest();
      if (t.dataset.take) st.api.send({ t: 'build', a: 'chest', op: 'take', id: st.chest, i: Number(t.dataset.take) });
      if (t.dataset.put) st.api.send({ t: 'build', a: 'chest', op: 'put', id: st.chest, cell: Number(t.dataset.put) });
    });
  }
}

const ROT = ['↗ север-восток', '↘ юго-восток', '↙ юго-запад', '↖ северо-запад'];
let buildRenderPending=false;
function queueBuildRender(){if(buildRenderPending)return;buildRenderPending=true;requestAnimationFrame(()=>{buildRenderPending=false;if(st)renderBuild();});}
function renderBuild() {
  const el = $('#build-window');
  if (!el || el.classList.contains('hidden')) return;
  const known = new Set(st.craft.known), base = myBase();
  const pieces = B().PIECES.filter((p) => !p.fixed).map((p) => {
    const locked = p.learn && !known.has(p.learn);
    const afford = Object.entries(p.cost).every(([id, n]) => have(id) >= n);
    const tip = `${p.name} — ${p.desc}\nСтоимость: ${costText(p.cost)}\nПрочность: ${B().maxHp(p)}${p.block === 1 ? '\nНепроходимо' : p.block === 'door' ? '\nДверь: проходят хозяин и допущенные' : ''}${locked ? `\nНужен чертёж: «${C().get(p.learn).name}» (свиток)` : ''}`;
    return `<button type="button" class="btn bld-piece${st.mode === 'place' && st.piece === p.id ? ' on' : ''}${locked ? ' locked' : ''}${afford ? '' : ' poor'}" data-piece="${p.id}" title="${esc(tip)}"><span class="sw" style="background:${p.color}"></span>${esc(p.name)}</button>`;
  }).join('');
  const allow = base ? base.allow.map((a) => esc(a.name || a.id.slice(0, 6))).join(', ') || 'никого' : '—';
  replacePanelHtml(el,`<div class="inv-head"><b>🔨 Строительство (B)</b><button type="button" class="btn small" data-close="1" title="Закрыть (Esc или B)">✕</button></div>
    <div class="small muted">${base ? `База «${esc(base.name)}»: участок радиусом ${base.r} вокруг флага.` : 'Базы нет: используйте «Флаг базы» в сумке (рецепт в книге K).'} ЛКМ — поставить, R — повернуть (${ROT[st.rot]}).</div>
    <p class="small">🚩 Флаг: 5 дерева + 2 ткани, без станка. После изготовления откройте сумку I и используйте флаг на свободном участке.</p>
    <button type="button" class="btn" data-flag="1" title="Изготовить флаг базы из 5 дерева и 2 ткани">🚩</button>
    <div class="bld-tools">${B().TEMPLATES.map(t=>`<button type="button" class="btn small" data-template="${t.id}" title="${esc(t.name)}: построить вокруг флага; списываются материалы всех деталей. Участок должен быть свободен.">${t.castle?'🏰':'🏠'}</button>`).join('')}</div>
    <div class="bld-tools">
      <button type="button" class="btn small${st.mode === 'place' ? ' on' : ''}" data-tool="place" title="Ставить выбранную постройку">Ставить</button>
      <button type="button" class="btn small${st.mode === 'repair' ? ' on' : ''}" data-tool="repair" title="Щёлкните по повреждённой постройке: чинится до полной прочности за часть её стоимости">Ремонт</button>
      <button type="button" class="btn small${st.mode === 'demolish' ? ' on' : ''}" data-tool="demolish" title="Щёлкните по своей постройке: снести, вернётся половина материалов; содержимое сундука упадёт на землю">Снести</button>
      <button type="button" class="btn small" data-rot="1" title="Повернуть (R)">⟳</button>
    </div>
    <div class="bld-list">${pieces}</div>
    <form class="bld-allow small" title="Допуск к базе: допущенные проходят через запертые двери, пользуются сундуками, станками и кроватями">
      Допущены: ${allow}<br><input name="allow" placeholder="имя героя в мире" maxlength="32"> <button class="btn small" value="on">Допустить</button> <button class="btn small" value="off">Убрать</button>
    </form>`);
}

function renderWorkshopItems() {
  const el=$('#craft-window [data-workshop-items]');if(!el)return;
  const q=st.workshopQuery.trim().toLocaleLowerCase();
  const list=Items().ITEMS.filter(it=>C().workshopPlan(it)&&(!q||it.name.toLocaleLowerCase().includes(q))).slice(0,80);
  el.innerHTML=list.map(it=>`<option value="${it.id}" ${it.id===st.workshopItem?'selected':''}>${esc(it.name)}</option>`).join('');
  st.workshopItem=el.value;renderWorkshopCost();
}
function renderWorkshopCost() {
  const el=$('#craft-window [data-workshop-cost]');if(!el)return;
  const it=Items().get(st.workshopItem),p=C().workshopPlan(it);
  el.textContent=p?`${C().STATIONS[p.station].name}: ${costText(p.cost)}. ${it.desc||''}`:'Нет подходящих предметов. Измените поиск.';
}
function renderCraft() {
  const el = $('#craft-window');
  if (!el || el.classList.contains('hidden')) return;
  if(el.contains(document.activeElement)&&document.activeElement.matches('input,select'))return;
  const workshopOpen=Boolean(el.querySelector('.craft-workshop')?.open);
  const known = new Set(st.craft.known), stations = new Set(st.craft.stations || []);
  const now = Date.now();
  const q = st.craft.queue.map((o) => {
    const r = C().get(o.r), left = Math.max(0, Math.ceil((o.done - now) / 1000));
    return `<div class="craft-q"><span>${esc(r.name)}${o.n > 1 ? ' × ' + o.n : ''}</span><span class="muted">${left ? left + ' с' : 'готово'}</span><button type="button" class="btn small" data-cancel="${o.id}" title="Отменить: материалы вернутся">✕</button></div>`;
  }).join('') || '<div class="muted small">Очередь пуста</div>';
  const groups = Object.entries(C().GROUPS).map(([g, gname]) => {
    const rows = C().RECIPES.filter((r) => r.group === g && known.has(r.id)).map((r) => {
      if (r.piece) return `<div class="craft-row" title="${esc('Чертёж: постройка открыта в режиме строительства (B)')}"><b>${esc(r.name)}</b><span class="muted small">изучен — стройте (B)</span></div>`;
      const mats = Object.entries(r.in).map(([id, n]) => `<span class="${have(id) >= n ? '' : 'bad'}">${esc(Items().get(id).name)} ${have(id)}/${n}</span>`).join(', ');
      const st2 = r.station ? `<span class="${stations.has(r.station) ? '' : 'bad'}" title="${esc(C().STATIONS[r.station].hint)}">${esc(C().STATIONS[r.station].name)}</span>` : 'руками';
      const req = Object.entries(r.req || {}).map(([s, v]) => `${(window.CharacterRules.STATS.find((x) => x.id === s) || { label: s }).label} ${v}`).join(', ');
      const out = Items().get(r.out.id);
      const tip = `${out.name}${r.out.n > 1 ? ' × ' + r.out.n : ''}: ${out.desc || ''}\nВремя: ${Math.ceil(r.time * C().settings.craftTimeFactor)} с${req ? '\nТребуется: ' + req : ''}`;
      return `<div class="craft-row" title="${esc(tip)}"><b>${esc(r.name)}</b><span class="small">${mats} · ${st2}</span><span><button type="button" class="btn small" data-craft="${r.id}" title="Сделать 1 раз">×1</button><button type="button" class="btn small" data-craft="${r.id}" data-n="5" title="Сделать 5 раз">×5</button></span></div>`;
    }).join('');
    return rows ? `<div class="craft-group"><div class="muted small">${esc(gname)}</div>${rows}</div>` : '';
  }).join('');
  const unknown = C().RECIPES.filter((r) => !known.has(r.id)).length;
  replacePanelHtml(el,`<div class="inv-head"><b>📖 Книга рецептов (K)</b><button type="button" class="btn small" data-close="1" title="Закрыть (Esc или K)">✕</button></div>
    <div class="small muted">Станки рядом: ${[...stations].map((s) => C().STATIONS[s].name).join(', ') || 'нет'} (не дальше ${C().settings.craftStationRange} клеток). Материалы списываются сразу, готовое приходит в сумку. Ещё не изучено: ${unknown} — ищите свитки рецептов.</div>
    <details class="craft-workshop" ${workshopOpen?'open':''}><summary>⚒ Мастерство: создать или улучшить снаряжение</summary>
      <p class="small">Все материалы и школы доступны через поиск. Показаны первые 80 совпадений. Для улучшения положите предмет в сумку и выберите его ниже; он заменяется выбранной моделью того же типа.</p>
      <input data-workshop-search placeholder="Катана, золотой, кровавый…" value="${esc(st.workshopQuery)}" aria-label="Поиск снаряжения мастерской">
      <select data-workshop-items aria-label="Результат изготовления"></select><p class="small" data-workshop-cost></p>
      <button type="button" class="btn" data-workshop="create" title="Создать выбранное снаряжение за материалы на указанном станке">⚒</button>
      <select data-upgrade-cell aria-label="Предмет для улучшения">${(st.api.character().inventory?.cells||[]).map((x,i)=>x&&C().workshopPlan(Items().get(x.id))?`<option value="${i}">${i+1}: ${esc(Items().get(x.id).name)}</option>`:'').join('')}</select>
      <button type="button" class="btn" data-workshop="upgrade" title="Улучшить предмет из выбранной ячейки до выбранной модели; списать материалы">⬆</button>
    </details>
    <div class="craft-queue"><b class="small">Очередь (до ${C().settings.craftQueueMax})</b>${q}</div>
    <div class="craft-list">${groups}</div>`);
  renderWorkshopItems();
}
setInterval(() => { if (st && st.craft.queue.length) renderCraft(); }, 1000);

function renderChest(items) {
  const el = $('#chest-window');
  el.classList.remove('hidden');
  const ch = st.api.character();
  const cell = (x, attr, i) => x ? `<button type="button" class="btn inv-mini" ${attr}="${i}" title="${esc(Items().get(x.id).name)}${x.n > 1 ? ' × ' + x.n : ''}">${esc(Items().get(x.id).name.slice(0, 10))}${x.n > 1 ? `<small>×${x.n}</small>` : ''}</button>` : `<span class="inv-mini empty"></span>`;
  replacePanelHtml(el,`<div class="inv-head"><b>📦 Сундук базы</b><button type="button" class="btn small" data-close="1" title="Закрыть (Esc)">✕</button></div>
    <div class="small muted">Щёлкните по предмету в сундуке — забрать, в сумке — положить (весь стопкой). Сундук общий для хозяина и допущенных.</div>
    <div class="chest-grid">${items.map((x, i) => cell(x, 'data-take', i)).join('')}</div>
    <div class="small"><b>Сумка</b></div>
    <div class="chest-grid">${ch.inventory.cells.map((x, i) => cell(x, 'data-put', i)).join('')}</div>`);
}
function closeChest() { st.chest = null; $('#chest-window').classList.add('hidden'); }
export function baseOnInventory() { if (st && st.chest) st.api.send({ t: 'build', a: 'chest', op: 'open', id: st.chest }); if (st) { renderCraft(); renderBuild(); } }

// ---------- Рисование ----------
// Постройки — объекты по глубине (props) и плоские (flats); ресурсные точки — метки; призрак постройки и граница участка
export function baseScene(scene, r, mouse, now) {
  if (!st) return scene;
  const props = [], flats = [];
  const R = r.visibleRange();
  for (const p of st.pieces.values()) {
    if (p.x < R.x0 || p.x > R.x1 || p.y < R.y0 || p.y > R.y1) continue;
    const def = B().get(p.type);
    if (def.layer === 'main' && (def.block || def.station || def.storage || def.id === 'flag')) props.push({ obstacle: Boolean(def.block), kind: 'base', x: p.x + 0.5, y: p.y + 0.5, draw: (rr) => drawPiece(rr, p, def, now) });
    else flats.push({ x: p.x + 0.5, y: p.y + 0.5, draw: (rr) => def.layer==='roof' ? rr.drawObstacle(p.x+0.5,p.y+0.5,()=>drawPiece(rr,p,def,now),'roof') : drawPiece(rr,p,def,now) });
  }
  const nodes = B().nodes(st.api.map), W = st.api.map.width, t = Date.now();
  for (let y = R.y0; y <= R.y1; y++) for (let x = R.x0; x <= R.x1; x++) {
    const k = nodes.get(y * W + x);
    if (!k) continue;
    const dep = (st.nodes.get(y * W + x) || 0) > t;
    flats.push({ x: x + 0.5, y: y + 0.5, draw: (rr) => drawNode(rr, x, y, k, dep) });
  }
  const over = scene.overlay;
  return { ...scene, props: [...(scene.props || []), ...props], flats: [...(scene.flats || []), ...flats], overlay: (rr, tt) => { drawGhost(rr, mouse); if (over) over(rr, tt); } };
}

function diamond(ctx, p, hw, hh, k = 1, dy = 0) {
  ctx.beginPath();
  ctx.moveTo(p.x, p.y + hh * (1 - k) + dy); ctx.lineTo(p.x + hw * k, p.y + hh + dy); ctx.lineTo(p.x, p.y + hh * (1 + k) + dy); ctx.lineTo(p.x - hw * k, p.y + hh + dy);
  ctx.closePath();
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
function drawPiece(r, p, def, now) {
  const ctx = r.ctx, { hw, hh } = r, s = r.toScreen(p.x, p.y);
  ctx.save();
  // гранёная модель постройки (base-art.js); лестница, мост, пол, крыша, флаг — прежним рисунком
  if(def.layer==='main'&&drawBasePiece(ctx,def,p,s.x,s.y+hh,hw,now)){}
  else if(def.id==='stairs'){for(let i=0;i<7;i++){diamond(ctx,s,hw,hh,.5-i*.035,-i*hh*.55);ctx.fillStyle=i%2?shade(def.color,.75):def.color;ctx.fill();}}
  else if(def.id==='bridge') {diamond(ctx,s,hw,hh,.96);ctx.fillStyle=def.color;ctx.fill();ctx.strokeStyle='#5b4935';for(let i=-4;i<=4;i++){ctx.beginPath();ctx.moveTo(s.x-hw*.7+i*hw*.12,s.y+hh*.6+i*hh*.12);ctx.lineTo(s.x+hw*.15+i*hw*.12,s.y+hh*1.5+i*hh*.12);ctx.stroke();}}
  else if (def.layer === 'floor') { diamond(ctx, s, hw, hh, 0.96); ctx.fillStyle = def.color; ctx.globalAlpha = 0.9; ctx.fill();if(def.id==='moat'){ctx.clip();ctx.strokeStyle='#a9e4e577';ctx.lineWidth=1;for(let i=0;i<4;i++){ctx.beginPath();for(let j=-7;j<=7;j++){const xx=s.x+j*hw/7,yy=s.y+hh*.4+i*hh*.4+Math.sin(j*.8+now/750)*hh*.07;j===-7?ctx.moveTo(xx,yy):ctx.lineTo(xx,yy);}ctx.stroke();}} }

  else if (def.layer === 'roof') { diamond(ctx, s, hw, hh, 0.9, -hh * 2.2); ctx.fillStyle = def.color; ctx.globalAlpha = 0.35; ctx.fill(); }
  else if (def.id === 'flag') {
    ctx.strokeStyle = '#5a4a3a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s.x, s.y + hh); ctx.lineTo(s.x, s.y + hh - hh * 3.2); ctx.stroke();
    ctx.fillStyle = def.color;
    const wv = Math.sin(now / 300) * 2;
    ctx.beginPath(); ctx.moveTo(s.x, s.y + hh - hh * 3.2); ctx.lineTo(s.x + hw * 0.6, s.y + hh - hh * 2.8 + wv); ctx.lineTo(s.x, s.y + hh - hh * 2.4); ctx.closePath(); ctx.fill();
  } else if (def.block || def.station || def.storage) {
    const h = def.block === 'door' ? hh * 3.6 : def.block ? hh * (def.id === 'fence' ? 1.8 : 4) : hh * 1.1;
    const k = def.block ? 0.92 : 0.6;
    // стенки и крыша коробки
    ctx.fillStyle = shade(def.color, 0.7);
    ctx.beginPath(); ctx.moveTo(s.x - hw * k, s.y + hh); ctx.lineTo(s.x, s.y + hh * (1 + k)); ctx.lineTo(s.x, s.y + hh * (1 + k) - h); ctx.lineTo(s.x - hw * k, s.y + hh - h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(def.color, 0.85);
    ctx.beginPath(); ctx.moveTo(s.x + hw * k, s.y + hh); ctx.lineTo(s.x, s.y + hh * (1 + k)); ctx.lineTo(s.x, s.y + hh * (1 + k) - h); ctx.lineTo(s.x + hw * k, s.y + hh - h); ctx.closePath(); ctx.fill();
    diamond(ctx, s, hw, hh, k, -h); ctx.fillStyle = def.color; ctx.fill();
    if(def.station){ctx.font=`${Math.max(10,hh)}px sans-serif`;ctx.textAlign='center';ctx.fillStyle='#f2df9b';ctx.fillText({magic:'✦',technical:'⚙',garage:'🔧',forge:'⚒',workbench:'⚒',chem:'⚗',electronics:'⚡'}[def.station]||'',s.x,s.y+hh-h);if(def.station==='magic'){ctx.strokeStyle='#bba3ff';ctx.beginPath();ctx.ellipse(s.x,s.y+hh-h-hh*.5,hw*.25,hh*.25,now/1800,0,Math.PI*2);ctx.stroke();}}
    if(def.battlements){ctx.fillStyle=shade(def.color,.72);for(const dx of [-.65,0,.65]){ctx.fillRect(s.x+dx*hw-hw*.12,s.y-h-hh*.2,hw*.24,hh*.65);}ctx.strokeStyle='#58534a';ctx.lineWidth=1;for(let row=1;row<5;row++){ctx.beginPath();ctx.moveTo(s.x,s.y+hh*1.9-h+row*h/5);ctx.lineTo(s.x+hw*.92,s.y+hh-h+row*h/5);ctx.stroke();}}
    if (def.block === 'door') { ctx.fillStyle = p.locked ? '#e0b040' : '#2a1a0a'; ctx.fillRect(s.x + hw * 0.25, s.y + hh * 1.2 - h * 0.5, 3, 3); }
    if (def.id === 'window') { ctx.fillStyle = '#bfe4f5'; ctx.fillRect(s.x + hw * 0.2, s.y + hh * 1.1 - h * 0.7, hw * 0.4, h * 0.3); }
  } else {
    diamond(ctx, s, hw, hh, 0.6); ctx.fillStyle = def.color; ctx.fill();
    ctx.font = `${Math.max(9, hh * 0.9)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const glyph = { spikes: '▲', bed: '🛏', lamp: '💡', campfire_pit: '🔥', stairs: '▤', double_bed:'🛏' }[def.id] || '';
    if (glyph) ctx.fillText(glyph, s.x, s.y + hh);
  }
  if (p.hp < p.max) { // полоска прочности
    const w = hw * 0.9;
    ctx.globalAlpha = 1; ctx.fillStyle = '#000a'; ctx.fillRect(s.x - w / 2, s.y - hh * 1.6, w, 4);
    ctx.fillStyle = p.hp / p.max > 0.5 ? '#7c4' : p.hp / p.max > 0.25 ? '#db4' : '#d43'; ctx.fillRect(s.x - w / 2, s.y - hh * 1.6, (w * p.hp) / p.max, 4);
  }
  ctx.restore();
}
function drawNode(r, x, y, kind, dep) {
  const ctx = r.ctx, { hh } = r, s = r.toScreen(x + 0.5, y + 0.5);
  ctx.save();
  ctx.globalAlpha = dep ? 0.35 : 0.85;
  ctx.fillStyle = { tree: '#e8d060', rock: '#d8d8d0', ruin: '#e0a070' }[kind];
  ctx.beginPath(); ctx.arc(s.x, s.y - hh * 0.2, Math.max(2, hh * 0.18), 0, Math.PI * 2); ctx.fill();
  if (dep) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(s.x - 3, s.y - 3 - hh * 0.2); ctx.lineTo(s.x + 3, s.y + 3 - hh * 0.2); ctx.stroke(); }
  ctx.restore();
}
function drawGhost(r, mouse) {
  const base = myBase(), ctx = r.ctx, { hw, hh } = r;
  if (base && st.mode) { // граница участка
    ctx.save(); ctx.strokeStyle = '#e8c05088'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    const c = r.toScreen(base.x + 0.5, base.y + 0.5);
    ctx.beginPath(); ctx.ellipse(c.x, c.y, base.r * hw * Math.SQRT2, base.r * hh * Math.SQRT2, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  if (!st.mode || !mouse) return;
  const x = Math.floor(mouse.x), y = Math.floor(mouse.y), s = r.toScreen(x, y);
  ctx.save();
  if (st.mode === 'place') {
    const def = B().get(st.piece), h = st.api.hero();
    let err = B().canPlace(st.api.map, base ? { x: base.x, y: base.y, r: base.r } : null, def, x, y, at);
    if (!err && Math.hypot(h.x - (x + 0.5), h.y - (y + 0.5)) > B().settings.buildRange) err = 'далеко';
    if (!err && def.learn && !st.craft.known.includes(def.learn)) err = 'нужен чертёж';
    if (!err && !Object.entries(def.cost).every(([id, n]) => have(id) >= n)) err = 'мало материалов';
    diamond(ctx, s, hw, hh, 1);
    ctx.fillStyle = err ? '#d4433a66' : '#6fdc3a55'; ctx.fill();
    ctx.strokeStyle = err ? '#d4433a' : '#6fdc3a'; ctx.lineWidth = 2; ctx.stroke();
    // стрелка поворота
    const ang = [-Math.PI / 4, Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4][st.rot];
    ctx.beginPath(); ctx.moveTo(s.x, s.y + hh); ctx.lineTo(s.x + Math.cos(ang) * hw * 0.6, s.y + hh + Math.sin(ang) * hh * 0.6); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(def.name + (err ? ` — ${err}` : ''), s.x, s.y - hh * 0.4);
  } else {
    diamond(ctx, s, hw, hh, 1);
    ctx.strokeStyle = st.mode === 'repair' ? '#50b0ff' : '#ff7050'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.restore();
}
