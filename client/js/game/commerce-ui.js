import { floatingWindow } from '../floating-window.js';
import { isoRig } from './figure-art.js';
import { textScale } from '../accessibility.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const number = value => Number(value || 0).toLocaleString('ru-RU');
const itemName = id => window.Items.get(id)?.name || 'Предмет';
let api = null, windowControls = null;
let st = null;
function fresh() {
  return { tab:'own', shops:[], own:[], inbox:{items:[],money:0}, limit:1, trade:null, selectedShop:null,
    draft:[], tradeDraft:[], title:'', search:'', selected:'', count:1, price:1, money:0, peer:'', pendingCreate:false };
}
const send = value => api?.send({ t:'commerce', ...value });
const actionButton = (label, action, extra='', disabled=false) => `<button type="button" class="btn small" data-commerce="${action}" ${extra}${disabled?' disabled':''}>${label}</button>`;
export function commerceInit() {
  const panel = $('#commerce-window');
  windowControls = floatingWindow(panel,{ header:'.inv-head', onRestore:render });
  $('#btn-commerce').addEventListener('click',()=>commerceToggle());
  $('#btn-inventory-commerce').addEventListener('click',()=>commerceToggle(true));
  $('#btn-commerce-close-all').addEventListener('click',()=>send({a:'closeAll'}));
  $('#btn-commerce-close').addEventListener('click',()=>commerceToggle(false));
  panel.addEventListener('click',onClick);
  panel.addEventListener('input',onInput);
  panel.addEventListener('change',onInput);
}
export function commerceAttach(context,msg) {
  api=context; st=fresh();
  if(msg)commerceMessage(msg);
}
export function commerceDetach() {
  commerceToggle(false); api=null; st=null;
  $('#btn-commerce-close-all').classList.add('hidden');
}
export const commerceIsOpen = () => !$('#commerce-window').classList.contains('hidden');
export function commerceToggle(force,tab) {
  if(!st||!api)return;
  const panel=$('#commerce-window'),wasClosed=panel.classList.contains('hidden');
  const open=force===undefined?wasClosed:force;
  panel.classList.toggle('hidden',!open);
  if(open){if(wasClosed)windowControls.open();if(tab)st.tab=tab;send({a:'list'});render();}
  else {if(st.trade)send({a:'trade',action:'cancel',trade:st.trade.id});windowControls.close();}
}
export function commerceMessage(msg) {
  if(!st)return false;
  if(msg.t==='commerce'){
    if(st.pendingCreate&&msg.own.length>st.own.length){st.draft=[];st.pendingCreate=false;st.tab='own';}
    st.shops=msg.shops||[];st.own=msg.own||[];st.limit=msg.limit;st.inbox=msg.inbox||{items:[],money:0};
    $('#btn-commerce-close-all').classList.toggle('hidden',!st.own.length);
    $('#btn-commerce-close-all').textContent=`Свернуть все лавки (${st.own.length})`;
    render();return true;
  }
  if(msg.t==='trade'){
    if(st.trade?.id!==msg.id){st.tradeDraft=[];st.money=0;}
    st.trade=msg;
    if(!commerceIsOpen())commerceToggle(true,'trade');else{st.tab='trade';render(true);}
    return true;
  }
  if(msg.t==='trade-end'){
    st.trade=null;st.tradeDraft=[];st.money=0;api.toast(msg.message,3000);render();return true;
  }
  if(msg.t==='commerce-error'){st.pendingCreate=false;api.toast(msg.message,3500);return true;}
  return false;
}
function bagItems() {
  const query=st.search.trim().toLowerCase();
    const result=[],cells=api.character().inventory.cells;
    for(let cell=0;cell<cells.length&&result.length<300;cell++) {
      const item=cells[cell];
      if(item&&item.id!=='caps'&&!window.Items.get(item.id)?.fixed&&(!query||itemName(item.id).toLowerCase().includes(query)||item.id.includes(query))) result.push({item,cell});
    }
    return result;
}
function picker(priced) {
  const list=bagItems();
  if(!list.some(x=>x.item.uid===st.selected))st.selected=list[0]?.item.uid||'';
  return `<div class="commerce-picker"><label>Найти вещь<input type="search" data-field="search" value="${esc(st.search)}" placeholder="Название предмета"></label>
    <label>Вещь из сумки<select data-field="selected">${list.map(({item})=>`<option value="${esc(item.uid)}"${st.selected===item.uid?' selected':''}>${esc(itemName(item.id))} × ${number(item.n)}${item.dur!=null?' · прочность '+number(item.dur):''}</option>`).join('')}</select></label>
    <div class="commerce-fields"><label>Количество<input type="number" min="1" step="1" data-field="count" value="${st.count}"></label>
    ${priced?`<label>Цена за штуку, крышки<input type="number" min="1" step="1" data-field="price" value="${st.price}"></label>`:''}</div>
    ${actionButton('Добавить в предложение','add',`data-priced="${priced}"`,!list.length)}</div>`;
}
function draftRows(priced) {
  const rows=priced?st.draft:st.tradeDraft;
  return rows.length?`<ul class="commerce-list">${rows.map((row,i)=>`<li>${esc(itemName(row.item))} × ${number(row.count)}${priced?' · '+number(row.price)+' крышек за штуку':''} ${actionButton('Убрать','remove',`data-index="${i}" data-priced="${priced}"`)}</li>`).join('')}</ul>`:'<p class="muted">В предложении пока нет вещей.</p>';
}
function tradeContent() {
  if(!st.trade){
    const peers=[...api.others()].filter(([,p])=>!p.dead&&Math.hypot(p.x-api.hero().x,p.y-api.hero().y)<=(window.GameSettings.tradeRange||3));
    return `<p>Обмен между героями рядом. Завершается после подтверждения обоих участников. При изменении предложения подтверждения сбрасываются.</p>
      <label>Игрок<select data-field="peer">${peers.map(([id,p])=>`<option value="${esc(id)}"${st.peer===id?' selected':''}>${esc(p.name||p.info?.name||'Игрок')}</option>`).join('')}</select></label>
      ${actionButton('Предложить обмен','invite','',!peers.length)}${!peers.length?'<p class="muted">Подойдите к другому игроку и нажмите «Обновить».</p>':''}`;
  }
  const t=st.trade,mine=t.offers.find(o=>o.player===api.you());
  const matchesDraft=mine?.submitted&&mine.money===st.money&&JSON.stringify(mine.items.map(x=>[x.uid,x.count]))===JSON.stringify(st.tradeDraft.map(x=>[x.uid,x.count]));
  const summaries=t.offers.map(o=>`<section class="commerce-card"><b>${esc(o.name)}${o.player===api.you()?' (вы)':''}</b><p>${number(o.money)} крышек ${o.confirmed?'· подтверждено':'· не подтверждено'}</p>
    <ul>${o.items.map(x=>`<li>${esc(itemName(x.id))} × ${number(x.count)}${x.dur!=null?' · прочность '+number(x.dur):''}</li>`).join('')||'<li>Без вещей</li>'}</ul></section>`).join('');
  if(t.phase==='invite')return summaries+`<p>${t.inviter===api.you()?'Ожидаем ответа игрока.':'Вас пригласили обменяться.'}</p>${t.inviter!==api.you()?actionButton('Принять приглашение','accept'):''} ${actionButton('Отказаться / отменить','cancel')}`;
  return summaries+picker(false)+draftRows(false)+`<label>Крышки в вашем предложении<input type="number" min="0" step="1" data-field="money" value="${st.money}"></label>
    <div class="commerce-actions">${actionButton('Отправить предложение','offer')}${actionButton('Подтвердить обмен','confirm','',!t.offers.every(o=>o.submitted)||!matchesDraft||mine?.confirmed)}${actionButton('Отменить','cancel')}</div>`;
}
function createContent() {
  const cap=Math.min(5,api.character().stats.shops||1);
  return `<p>Лавки: ${st.own.length} / ${cap}. Навык «Количество лавок» повышается в окне персонажа, максимум 5. Новая лавка останется на текущей точке, когда вы уйдёте или выйдете из игры.</p>
    <label>Название лавки<input maxlength="60" data-field="title" value="${esc(st.title)}" placeholder="Лавка ${esc(api.character().name)}"></label>
    ${picker(true)}${draftRows(true)}<p class="small muted">Выставленные вещи уходят из сумки в лавку. Цена указана за одну штуку. Лавка исчезнет после продажи всех товаров; выручка останется в возвратах.</p>
    ${actionButton('Открыть лавку здесь','create','',!st.draft.length||st.pendingCreate||st.own.length>=cap)}`;
}
function ownContent() {
  const cash=st.inbox.money+st.own.reduce((n,s)=>n+s.money,0);
  return `<div class="commerce-actions">${actionButton('Свернуть все лавки','closeAll','',!st.own.length)}${actionButton('Забрать выручку: '+number(cash),'collectMoney','',!cash)}</div>
    ${st.own.map(s=>`<section class="commerce-card"><b>${esc(s.title)}</b><p>${esc(s.worldName||'Мир')} · ${esc(s.location||'Поверхность')} · (${Math.round(s.x)}, ${Math.round(s.y)})</p>
      <p>Выручка: ${number(s.money)} крышек</p><ul>${s.items.map(x=>`<li>${esc(itemName(x.item.id))} × ${number(x.item.n)} · ${number(x.price)} за штуку</li>`).join('')}</ul>${actionButton('Забрать выручку этой лавки','collectMoney',`data-shop="${esc(s.id)}"`,!s.money)} ${actionButton('Свернуть эту лавку','close',`data-shop="${esc(s.id)}"`)}</section>`).join('')||'<p class="muted">Открытых лавок нет.</p>'}
    <h3>Возвращённые вещи</h3><p class="small muted">Вещи хранятся здесь, пока вы не заберёте их в сумку. Сворачивание лавки доступно и с заполненным инвентарём.</p>
    ${actionButton('Забрать все вещи','collectAll','',!st.inbox.items.length)}<ul class="commerce-list">${st.inbox.items.map(item=>`<li>${esc(itemName(item.id))} × ${number(item.n)} ${actionButton('Забрать','collectItem',`data-item="${esc(item.returnId)}"`)}</li>`).join('')}</ul>`;
}
function nearbyContent() {
  const shops=st.selectedShop?st.shops.filter(s=>s.id===st.selectedShop):st.shops;
  return `<p>Купить можно, подойдя к лавке на ${window.GameSettings.shopBuyRange||3} клетки. Оплата — крышками.</p>
    ${st.selectedShop?actionButton('Все лавки на этом уровне','showAll'):''}
    ${shops.map(s=>`<section class="commerce-card"><b>${esc(s.title)}</b><p>Владелец: ${esc(s.name)} · (${Math.round(s.x)}, ${Math.round(s.y)}) · расстояние ${Math.hypot(s.x-api.hero().x,s.y-api.hero().y).toFixed(1)}</p>
      ${s.items.map(x=>`<div class="commerce-good"><span>${esc(itemName(x.item.id))} × ${number(x.item.n)}${x.item.dur!=null?' · прочность '+number(x.item.dur):''}<br>${number(x.price)} крышек за штуку</span>
        <label>Количество<input type="number" min="1" max="${x.item.n}" value="1" data-buy-count="${esc(x.id)}"></label>${actionButton('Купить','buy',`data-shop="${esc(s.id)}" data-item="${esc(x.id)}"`,s.owner===api.character().id)}</div>`).join('')}</section>`).join('')||'<p class="muted">Здесь нет открытых лавок.</p>'}`;
}
function render(force = false) {
  if(!st||!api||!commerceIsOpen()||$('#commerce-window').classList.contains('window-minimized'))return;
  if(!force&&$('#commerce-body').contains(document.activeElement)&&document.activeElement.matches('input,select,textarea'))return;
  $('#commerce-tabs').innerHTML=[['own','Мои лавки / возвраты'],['create','Открыть лавку'],['near','Купить'],['trade','Обмен']].map(([id,label])=>`<button type="button" class="btn small${st.tab===id?' active':''}" data-commerce="tab" data-tab="${id}">${label}</button>`).join('');
  const body=$('#commerce-body'),top=body.scrollTop;
  body.innerHTML=st.tab==='trade'?tradeContent():st.tab==='create'?createContent():st.tab==='near'?nearbyContent():ownContent();
  body.scrollTop=top;
  windowControls?.refresh();
}
function onInput(event) {
  const field=event.target.dataset.field;if(!field||!st)return;
  st[field]=['count','price','money'].includes(field)?Number(event.target.value):event.target.value;
  if(field==='search'){
    const list=bagItems(),select=$('[data-field=selected]');
    select.innerHTML=list.map(({item})=>`<option value="${esc(item.uid)}">${esc(itemName(item.id))} × ${number(item.n)}</option>`).join('');
    st.selected=select.value;
  }
}
function onClick(event) {
  const b=event.target.closest('[data-commerce]');if(!b||!st)return;
  const a=b.dataset.commerce;
  if(a==='tab'){st.tab=b.dataset.tab;st.search='';render(true);return;}
  if(a==='refresh'){send({a:'list'});return;}
  if(a==='add'){
    const item=api.character().inventory.cells.find(x=>x&&x.uid===st.selected);
    if(!item||!Number.isSafeInteger(st.count)||st.count<1||st.count>item.n){api.toast('Выберите вещь и доступное количество.');return;}
    const priced=b.dataset.priced==='true';
    if(priced&&(!Number.isSafeInteger(st.price)||st.price<1)){api.toast('Цена должна быть положительным целым числом.');return;}
    const draft=priced?st.draft:st.tradeDraft,row={uid:item.uid,item:item.id,count:st.count,...(priced?{price:st.price}:{})};
    const index=draft.findIndex(x=>x.uid===item.uid);if(index>=0)draft[index]=row;else draft.push(row);render();return;
  }
  if(a==='remove'){(b.dataset.priced==='true'?st.draft:st.tradeDraft).splice(Number(b.dataset.index),1);render();return;}
  if(a==='create'){st.pendingCreate=true;send({a:'create',title:st.title,items:st.draft});render();return;}
  if(a==='close'||a==='closeAll'){send({a,shop:b.dataset.shop});return;}
  if(a==='collectMoney'){send({a:'collect',money:true,shop:b.dataset.shop});return;}
  if(a==='collectAll'||a==='collectItem'){send({a:'collect',item:b.dataset.item});return;}
  if(a==='showAll'){st.selectedShop=null;render();return;}
  if(a==='buy'){
    const quantity=b.closest('.commerce-good').querySelector('[data-buy-count]').value;
    send({a:'buy',shop:b.dataset.shop,item:b.dataset.item,count:Number(quantity)});return;
  }
  if(a==='invite'){const player=$('[data-field=peer]')?.value;send({a:'trade',action:'invite',player});return;}
  if(a==='confirm'&&st.trade){
    const mine=st.trade.offers.find(o=>o.player===api.you());
    if(!mine?.submitted||mine.money!==st.money||JSON.stringify(mine.items.map(x=>[x.uid,x.count]))!==JSON.stringify(st.tradeDraft.map(x=>[x.uid,x.count]))){api.toast('Сначала отправьте изменённое предложение.');return;}
  }
  if(['accept','cancel','confirm','offer'].includes(a)&&st.trade)send({a:'trade',action:a,trade:st.trade.id,revision:st.trade.revision,...(a==='offer'?{items:st.tradeDraft,money:st.money}:{})});
}
export function commerceClick(event,sx,sy,renderer) {
  if(!st||event.button!==0||event.shiftKey||event.ctrlKey)return false;
  const sorted=[...st.shops].sort((a,b)=>(b.x+b.y)-(a.x+a.y));
  const shop=sorted.find(s=>{if(renderer.fog&&!renderer.fog.see(s.x,s.y))return false;const p=renderer.toScreen(s.x,s.y);return Math.abs(sx-p.x)<renderer.hw*1.5&&sy>p.y-renderer.hh*5&&sy<p.y+renderer.hh;});
  if(!shop)return false;
  st.selectedShop=shop.id;commerceToggle(true,'near');return true;
}
export function commerceMinimap(ctx,toMini,visible=()=>true) {
  if(!st||!api)return;
  for(const s of st.shops){
    if(!visible(s.x,s.y)&&s.owner!==api.character().id)continue;
    const p=toMini(s.x,s.y);ctx.fillStyle=s.owner===api.character().id?'#ffe09a':'#bd96ef';
    ctx.fillRect(p.x-2,p.y-2,4,4);
  }
}
export function commerceScene(scene) {
  if(!st||!api)return scene;
  const props=st.shops.map(s=>({x:s.x,y:s.y,draw:(r)=>{
    const p=r.toScreen(s.x,s.y),u=r.hh*0.9*3.3/1.75;
    const rig=isoRig(r.ctx,p.x,p.y,u,0),color=s.owner===api.character().id?'#af8145':'#76619b';
    for(const x of [-0.85,0.85])for(const y of [-0.5,0.5])rig.limb([x,y,0],[x,y,1.8],0.035,0.035,'#605441');
    rig.box(0,0,0.75,1.7,1,0.1,'#8a7350');
    rig.polygon([[-1,-0.7,1.85],[1,-0.7,1.85],[1,0,2.2],[-1,0,2.2]],color);
    rig.polygon([[-1,0,2.2],[1,0,2.2],[1,0.7,1.85],[-1,0.7,1.85]],color);
    for(let i=0;i<3;i++)rig.box(-0.55+i*0.55,0,0.85,0.32,0.32,0.23,['#946c3f','#547065','#87738c'][i]);
    rig.flush();r.ctx.save();r.ctx.textAlign='center';r.ctx.font=`${12*textScale()}px Segoe UI`;r.label(s.title,p.x,p.y-u*2.25,'#efd7a0');r.ctx.restore();
  }}));
  return {...scene,props:[...(scene.props||[]),...props]};
}
