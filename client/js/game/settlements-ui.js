import { drawHouse } from './scenery-art.js';
// Поселения на клиенте (шаг 15): стены и дома застройки (тот же расчёт, что на сервере — shared/settlements.js),
// жители (фигуры с именем и значком роли), окно разговора по дереву диалога, торговля, лекарь, маг, рецепты, репутация.
// T рядом с жителем или щелчок по нему — поговорить; Ctrl+щелчок — напасть (преступление!). Всё решает сервер.
const SS = () => window.Settlements;
const It = () => window.Items;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let api = null; // { send, toast, you, map(), hero(), character() }
const st = { npcs: new Map(), towns: new Map(), defenseFlash: new Map(), talk: null, node: null, offer: null, hintAt: 0, hintId: '' };

export function stlAttach(a) {
  api = a;
  const b = $('#btn-npc-close');
  if (b && !b.dataset.bound) { b.dataset.bound = '1'; b.addEventListener('click', close); }
}
export function stlOnWelcome(msg) {
  syncGates(msg.sg);
  st.npcs = new Map();
  st.defenseFlash.clear();
  for (const n of msg.npcs || []) addNpc(n);
  st.towns = new Map((msg.towns || []).map((t) => [t.id, t]));
  close();
}
function addNpc(n) {
  const role = SS().ROLES[n.role] || SS().ROLES.civilian;
  st.npcs.set(n.id, { ...n, snaps: [{ t: performance.now(), x: n.x, y: n.y, m: 0 }], role: n.role, look: { shirt: { color: role.look.shirt, shape: 'shirt' }, pants: { color: role.look.pants, shape: 'pants' }, feet: { color: '#393a34', shape: 'boots' }, ...(n.outfit || {}) }, colors: colorsOf(n, role), dir: 1, moving: false });
}
function colorsOf(n, role) {
  const skins = ['#e8c4a0', '#c99a72', '#8d5a3b', '#f0d2b4', '#b07850'];
  const k = [...n.id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const skin = skins[k % skins.length];
  return { skin, hair: k % 4 ? ['#2a1a10', '#6a4a2a', '#c8a050', '#888'][k % 4] : null, longHair: k % 3 === 0, underwear: role.look.shirt, legs: role.look.pants, armL: skin, armR: skin };
}
export function stlHover(sx,sy,r){
  for(const npc of st.npcs.values()){const p=r.toScreen(npc.x,npc.y);if(r.fog&&!r.fog.see(npc.x,npc.y))continue;
    if(Math.abs(sx-p.x)<r.hh&&sy>p.y-r.hh*3.5&&sy<p.y+r.hh*.3)return {text:`${npc.name} · ${SS().ROLES[npc.role]?.name||'житель'} · T рядом — поговорить`,topic:'role:'+npc.role,key:npc.id};
  }return null;
}
export const stlLookup = (id) => st.npcs.get(id) || null;
function syncGates(cells) {
  if (SS().syncGates(api && api.map(), cells) && api.refreshGrid) api.refreshGrid();
}
export function stlOnState(list, gates) {
  syncGates(gates);
  if (!list) return;
  const now = performance.now();
  for (const [id, x, y, hp, flags] of list) {
    const n = st.npcs.get(id);
    if (!n) continue;
    n.hp = hp; n.angry = Boolean(flags & 2);
    n.snaps.push({ t: now, x, y, m: flags & 1 });
    if (n.snaps.length > 20) n.snaps.shift();
  }
}
export function stlOnMessage(msg) {
  switch (msg.t) {
    case 'npc-add': addNpc(msg.npc); return true;
    case 'npc-remove': st.npcs.delete(msg.id); if (st.talk && st.talk.npc.id === msg.id) close(); return true;
    case 'npc-talk': openTalk(msg); return true;
    case 'npc-offer': st.offer = msg; render(); return true;
    case 'npc-say': if (st.talk) { st.say = msg.text; render(); } else api.toast(msg.text, 4000); return true;
    case 'npc-reject': api.toast(msg.message, 3500); return true;
    case 'fam-rel': // семья (шаг 17): отношения с жителем и условия диалога изменились
      if (st.talk && st.talk.npc.id === msg.id) { st.talk.rel = msg.rel; st.talk.flags = msg.flags; if (msg.say) st.say = msg.say; render(); } else if (msg.say) api.toast(msg.say, 4000);
      return true;
    case 'stl-town': {
      const old = st.towns.get(msg.town.id);
      st.towns.set(msg.town.id, msg.town);
      if (old && old.tier !== msg.town.tier) api.toast(`«${msg.town.name}»: отношение — ${SS().TIERS[msg.town.tier].name}.`, 3500);
      if (st.talk && st.talk.town.id === msg.town.id) { st.talk.town = msg.town; render(); }
      return true;
    }
    case 'settlement-gates': {
      const m = api && api.map();
      if (m) {
        if (!m.openGates) m.openGates = new Set();
        for (const j of msg.cells || []) { if (msg.open) m.openGates.add(j); else m.openGates.delete(j); }
        if (api.refreshGrid) api.refreshGrid();
      }
      return true;
    }
    case 'settlement-turret': st.defenseFlash.set(`${msg.townId}:${msg.index}`, { x: msg.x, y: msg.y, tx: msg.tx, ty: msg.ty, until: performance.now() + 180 }); return true;
    default: return false;
  }
}

// ---------- Разговор ----------
function openTalk(msg) {
  st.talk = msg; st.node = dlgsOf(msg)[msg.dlg].start; st.offer = null; st.say = null; st.listen = null;
  $('#npc-window').classList.remove('hidden');
  render();
}
// Разговор с врагом-лидером (Патриарх, шаг 16) — диалоги из Quests, ответы уходят в {t:'quest',a:'dlg'}
const dlgsOf = (talk) => (talk.src === 'quest' ? window.Quests.DIALOGUES : SS().DIALOGUES);
function close() { st.talk = null; st.offer = null; st.say = null; const w = $('#npc-window'); if (w) w.classList.add('hidden'); }
export const stlIsOpen = () => Boolean(st.talk);
export function stlClose() { close(); }
function choose(o) {
  if (o.next) { st.node = o.next; st.offer = null; st.say = null; render(); return; }
  if (o.action === 'bye') { close(); return; }
  st.say = null;
  if (st.talk.src === 'quest') { api.send({ t: 'quest', a: 'dlg', act: o.action }); close(); return; }
  api.send({ t: 'npc', a: o.action, id: st.talk.npc.id });
}
function ctxOf() {
  if (st.talk.src === 'quest') return { npc: st.talk.npc.name, town: '', player: api.character().name, tier: 'neutral', flags: st.talk.flags || {} };
  const t = st.talk.town;
  return { flags: st.talk.flags || {}, npc: st.talk.npc.name, town: t.name, player: api.character().name, tier: t.tier, damaged: t.hp < 50, raid: Boolean(t.raid) };
}
function money(n) { return `${n} 🪙`; }
function render() {
  const box = $('#npc-body');
  if (!st.talk || !box) return;
  const { npc, town, dlg } = st.talk;
  const quest = st.talk.src === 'quest';
  const d = dlgsOf(st.talk)[dlg], node = d.nodes[st.node], ctx = ctxOf();
  let h = '';
  if (quest) $('#npc-title').textContent = `👑 ${npc.name}`;
  else {
  const role = SS().ROLES[npc.role], tier = SS().TIERS[town.tier];
  $('#npc-title').textContent = `${role.icon} ${npc.name} — ${role.name}`;
  h = `<div class="muted" title="Репутация −100…100: влияет на цены, стражу и вербовку. Растёт от торговли и защиты поселения, падает от нападений.">«${esc(town.name)}» (${esc(SS().KINDS[town.kind].name)}) · отношение: <b style="color:${tier.color}">${tier.name}</b> (${town.rep})${town.hp < 100 ? ` · прочность ${town.hp}%` : ''}${town.raid ? ' · <b class="bad">набег!</b>' : ''}</div>`;
  const rel = st.talk.rel, F = window.Family;
  if (rel && F) h += `<div class="muted" title="Симпатия 0…100: разговоры, подарки, задания старосты, защита поселения (панель семьи — F3)">Отношения: <b>${F.STAGES[rel.stage].icon} ${F.STAGES[rel.stage].name}</b> · симпатия ${rel.affinity}</div>`;
  }
  h += `<p class="npc-text">${esc(SS().fill(node.text, ctx))}</p>`;
  if (st.say) h += `<p class="npc-text">${esc(st.say)}</p>`;
  h += '<div class="npc-opts">' + SS().optionsFor(node, ctx).map((o, i) => `<button type="button" class="btn small" data-opt="${i}">${esc(o.text)}</button>`).join('') + '</div>';
  const o = st.offer && st.offer.id === npc.id ? st.offer : null;
  if (o) h += renderOffer(o);
  box.innerHTML = h;
  const opts = SS().optionsFor(node, ctx);
  box.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => choose(opts[Number(b.dataset.opt)])));
  box.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', (e) => api.send({ t: 'npc', a: 'buy', id: npc.id, item: b.dataset.buy, n: e.shiftKey ? Math.min(5, Number(b.dataset.max)) : 1 })));
  box.querySelectorAll('[data-sell]').forEach((b) => b.addEventListener('click', (e) => api.send({ t: 'npc', a: 'sell', id: npc.id, i: Number(b.dataset.sell), n: e.shiftKey ? Number(b.dataset.max) : 1 })));
  box.querySelectorAll('[data-heal]').forEach((b) => b.addEventListener('click', () => api.send({ t: 'npc', a: b.dataset.heal, id: npc.id, go: 1 })));
  box.querySelectorAll('[data-spell]').forEach((b) => b.addEventListener('click', () => api.send({ t: 'npc', a: 'learn', id: npc.id, spell: b.dataset.spell })));
  box.querySelectorAll('[data-qtake]').forEach((b) => b.addEventListener('click', () => { st.listen = null; api.send({ t: 'npc', a: 'quest', id: npc.id, take: b.dataset.qtake }); }));
  box.querySelectorAll('[data-qturn]').forEach((b) => b.addEventListener('click', () => api.send({ t: 'npc', a: 'quest', id: npc.id, turnin: b.dataset.qturn })));
  box.querySelectorAll('[data-qlisten]').forEach((b) => b.addEventListener('click', () => { st.listen = b.dataset.qlisten || null; render(); }));
  box.querySelectorAll('[data-gift]').forEach((b) => b.addEventListener('click', () => api.send({ t: 'npc', a: 'fam_gift', id: npc.id, i: Number(b.dataset.gift) })));
  box.querySelectorAll('[data-adopt]').forEach((b) => b.addEventListener('click', () => { const sel = box.querySelector(`[data-study="${b.dataset.adopt}"]`); api.send({ t: 'npc', a: 'orphans', id: npc.id, adopt: b.dataset.adopt, study: sel ? sel.value : 'gather' }); }));
  box.querySelectorAll('[data-recipe]').forEach((b) => b.addEventListener('click', () => api.send({ t: 'npc', a: 'recipes', id: npc.id, recipe: b.dataset.recipe })));
}
function renderOffer(o) {
  let h = `<div class="npc-money" title="Крышки и золотые самородки (1 самородок = ${SS().NUGGET} крышек; сдачу дают крышками).">Ваши деньги: <b>${money(o.money)}</b>${o.damaged ? ' · <span class="bad">поселение разорено — цены выше</span>' : ''}</div>`;
  if (o.what === 'trade') {
    h += '<h3>Товар</h3><ul class="npc-list">' + o.stock.map((s) => { const it = It().get(s.id); return `<li title="${esc(it.desc || '')}"><span style="color:${It().RARITIES[it.rarity].color}">${esc(it.name)}</span> × ${s.n} — ${money(s.price)} <button type="button" class="btn small" data-buy="${s.id}" data-max="${s.n}" ${s.price > o.money ? 'disabled' : ''} title="Купить одну (Shift — до пяти)">Купить</button></li>`; }).join('') + '</ul>';
    if (st.talk.npc.role === 'trader') {
      const cells = api.character().inventory.cells;
      const rows = cells.map((x, i) => { const it = x && It().get(x.id); if (!it || !SS().tradable(it)) return ''; const p = SS().price(it, 'sell', { rep: o.rep }); return `<li>${esc(it.name)}${x.n > 1 ? ` × ${x.n}` : ''} — ${money(p)}${x.n > 1 ? ' за шт.' : ''} <button type="button" class="btn small" data-sell="${i}" data-max="${x.n}" title="Продать одну (Shift — все); поношенное дешевле">Продать</button></li>`; }).join('');
      h += `<h3>Продать</h3><ul class="npc-list">${rows || '<li class="muted">нечего продать</li>'}</ul>`;
    }
  }
  if (o.what === 'heal') {
    h += `<p>${o.heal.miss ? `Лечение ран (+${o.heal.miss} здоровья): ${money(o.heal.price)} <button type="button" class="btn small" data-heal="heal">Лечить</button>` : 'Вы здоровы.'}</p>`;
    h += `<p>${o.cure.need ? `Болезнь и радиация (${o.cure.rad}%${o.cure.ill ? ', болен' : ''}): ${money(o.cure.price)} <button type="button" class="btn small" data-heal="cure">Вылечить</button>` : 'Ни болезни, ни радиации.'}</p>`;
  }
  if (o.what === 'learn') {
    h += '<h3>Заклинания</h3><ul class="npc-list">' + o.spells.map((s) => `<li>${esc(s.name)} (${s.tier}-й круг) — ${s.known ? '<span class="muted">изучено</span>' : `${money(s.price)} ${s.err ? `<span class="bad" title="${esc(s.err)}">нельзя</span>` : `<button type="button" class="btn small" data-spell="${s.id}" ${s.price > o.money ? 'disabled' : ''}>Учиться</button>`}`}</li>`).join('') + '</ul>';
    if (!o.spells.length) h += '<p class="muted">Здесь магии не учат.</p>';
  }
  if (o.what === 'recipes') {
    h += '<h3>Рецепты</h3><ul class="npc-list">' + o.recipes.map((r) => `<li>${esc(r.name)} — ${r.known ? '<span class="muted">известен</span>' : `${money(r.price)} <button type="button" class="btn small" data-recipe="${r.id}" ${r.price > o.money ? 'disabled' : ''}>Купить</button>`}</li>`).join('') + '</ul>';
  }
  if (o.what === 'quests') h = renderQuestOffer(o);
  if (o.what === 'gifts') { // семья (шаг 17)
    h = `<h3 title="Подарок повышает симпатию: +1 за каждые ${window.Family.settings.familyGiftValuePer} крышек ценности">Подарить</h3>` + (o.cooldown ? '<p class="muted">Недавно уже дарили — подождите немного.</p>' : '')
      + (o.gifts.length ? '<ul class="npc-list">' + o.gifts.map((g) => `<li>${esc(g.name)}${g.n > 1 ? ` × ${g.n}` : ''} — симпатия +${g.gain} <button type="button" class="btn small" data-gift="${g.i}">Подарить</button></li>`).join('') + '</ul>' : '<p class="muted">Нечего подарить.</p>');
  }
  if (o.what === 'orphans') {
    const F = window.Family;
    h = `<h3 title="Ребёнку нужна своя кровать на вашей базе. Он взрослеет со временем и учится выбранному делу.">Сироты (свободных кроватей: ${o.beds})</h3>` + (o.say ? `<p class="npc-text">${esc(o.say)}</p>` : '')
      + (o.orphans.length ? '<ul class="npc-list">' + o.orphans.map((x) => `<li>${x.gender === 'female' ? '👧' : '👦'} ${esc(x.name)}, ${x.age} лет · учить: <select data-study="${esc(x.id)}" title="Чему ребёнок будет учиться до взрослости">${F.ROLE_IDS.map((r) => `<option value="${r}">${F.ROLES[r].icon} ${F.ROLES[r].name}</option>`).join('')}</select> <button type="button" class="btn small primary" data-adopt="${esc(x.id)}" ${o.beds > 0 ? '' : 'disabled title="Нужна свободная кровать на базе"'}>Принять в семью</button></li>`).join('') + '</ul>' : '<p class="muted">Все дети этого поселения уже нашли дом.</p>');
  } // деньги не нужны — свой заголовок
  return h;
}
// Доска старосты (шаг 16): сюжетное задание («Выслушать» — его диалог), процедурные, сдача «принести/доставить»
function renderQuestOffer(o) {
  const Q = window.Quests, It2 = It();
  const rw = (r) => [r.caps ? `${r.caps} 🪙` : '', r.xp ? `${r.xp} оп.` : '', ...(r.items || []).map(([id, n]) => `${(It2.get(id) || {}).name || id}${n > 1 ? ` × ${n}` : ''}`), r.rep ? `+${r.rep} реп.` : '', ...Object.entries(r.fac || {}).map(([f, n]) => `${n > 0 ? '+' : ''}${n} ${window.Factions.FACTIONS[f].name}`), r.spell ? 'заклинание' : '', r.recipe ? 'рецепт' : ''].filter(Boolean).join(', ');
  let h = `<h3 title="Задания общие для мира: взятое засчитывается всем игрокам в нём, награду получает каждый. Журнал — F2.">Задания (взято ${o.active}/${o.max})</h3>`;
  if (o.say) h += `<p class="npc-text">${esc(o.say)}</p>`;
  if (st.listen) {
    const q = o.quests.find((x) => x.id === st.listen), dd = Q.DIALOGUES[st.listen];
    if (q && dd) {
      const node = dd.nodes[dd.start];
      h += `<p class="npc-text">${esc(SS().fill(node.text, { ...ctxOf(), npc: st.talk.npc.name }))}</p><div class="npc-opts">${node.options.map((op) => (op.action === 'accept' ? `<button type="button" class="btn small primary" data-qtake="${esc(q.id)}">${esc(op.text)}</button>` : `<button type="button" class="btn small" data-qlisten="">${esc(op.text)}</button>`)).join('')}</div>`;
      return h;
    }
  }
  if (!o.quests.length) return h + '<p class="muted">Работы пока нет — доска обновится позже.</p>';
  h += '<ul class="npc-list q-offers">' + o.quests.map((q) => {
    const k = Q.KINDS[q.kind] || { icon: '•', name: q.kind };
    const tip = `${q.text}\nЦели: ${q.goals.join('; ')}\nНаграда: ${rw(q.reward || {})}`;
    let btn = '';
    if (q.state === 'offer') btn = q.main ? `<button type="button" class="btn small primary" data-qlisten="${esc(q.id)}">Выслушать</button>` : `<button type="button" class="btn small" data-qtake="${esc(q.id)}" ${o.active >= o.max ? 'disabled' : ''}>Взять</button>`;
    else if (q.state === 'turnin') btn = `<button type="button" class="btn small primary" data-qturn="${esc(q.id)}" ${q.ready ? '' : 'disabled title="Не хватает предметов"'}>Сдать</button>`;
    else btn = '<span class="muted">взято</span>';
    return `<li title="${esc(tip)}">${k.icon} ${q.main ? '<b>' : ''}${esc(q.name)}${q.main ? '</b>' : ''} <span class="muted">— ${esc(rw(q.reward || {}))}</span> ${btn}</li>`;
  }).join('') + '</ul>';
  return h;
}

// ---------- Ввод ----------
function nearestNpc(range) {
  const h = api.hero();
  let best = null, bd = range;
  for (const n of st.npcs.values()) { const d = Math.hypot(n.x - h.x, n.y - h.y); if (d < bd) { bd = d; best = n; } }
  return best;
}
export function stlKey(e) {
  if (!api || !SS()) return false;
  if (e.code === 'Escape' && st.talk) { e.preventDefault(); close(); return true; }
  if (e.code === 'KeyT' && !e.shiftKey) {
    const n = nearestNpc((window.GameSettings.settlementTalkRange || 3) + 0.3);
    if (!n) return false; // T — приручение (спутники)
    e.preventDefault();
    api.send({ t: 'npc', a: 'talk', id: n.id });
    return true;
  }
  return false;
}
// Щелчок по жителю: поговорить; Ctrl+щелчок — напасть
export function stlClick(e, sx, sy, r) {
  if (!api || e.button !== 0) return false;
  let hit = null, hd = Math.max(16, r.hh * 1.2);
  for (const n of st.npcs.values()) {
    const p = r.toScreen(n.x, n.y);
    const d = Math.hypot(p.x - sx, p.y - r.hh * 1.6 - sy);
    if (d < hd) { hd = d; hit = n; }
  }
  if (!hit) return false;
  if (e.ctrlKey) { api.send({ t: 'atk', slot: 'main', target: hit.id, tk: 'n', x: hit.x, y: hit.y }); return true; }
  const h = api.hero();
  if (Math.hypot(hit.x - h.x, hit.y - h.y) > (window.GameSettings.settlementTalkRange || 3)) return false; // далеко — просто идти
  api.send({ t: 'npc', a: 'talk', id: hit.id });
  return true;
}
// Подсказка у поселения и закрытие окна, если отошли
export function stlFrame(now) {
  if (!api || now - st.hintAt < 600) return;
  st.hintAt = now;
  const h = api.hero();
  if (st.talk && st.talk.src !== 'quest') { const n = st.npcs.get(st.talk.npc.id); if (!n || Math.hypot(n.x - h.x, n.y - h.y) > (window.GameSettings.settlementTalkRange || 3) + 2) close(); }
  const n = nearestNpc((window.GameSettings.settlementTalkRange || 3) + 0.3);
  const id = n ? n.id : '';
  if (id && id !== st.hintId && !st.talk) api.toast(`${SS().ROLES[n.role].icon} ${n.name} — ${SS().ROLES[n.role].name}. T или щелчок — поговорить.`, 2200);
  st.hintId = id;
}
// Поселение под героем — для строки места в HUD
export function stlWhere(x, y) {
  const m = api && api.map();
  const t = m && SS() && SS().at(m, x, y);
  if (!t) return null;
  const info = st.towns.get(t.id) || { name: (m.settlements[t.id] || {}).name, tier: 'neutral', rep: 0 };
  return { name: info.name, tier: info.tier, rep: info.rep, raid: info.raid };
}

// ---------- Отрисовка ----------
function wallColor(t, x, y) {
  for (const b of t.buildings) if (b.built && x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h) return SS().BUILDINGS[b.kind].color;
  return t.wall || '#6e675e';
}
export function stlScene(scene, r, now) {
  if (!api || !SS()) return scene;
  const m = api.map();
  const props = [];
  if (m && m.towns && !m.level) {
    const vr = r.visibleRange();
    for (const t of m.towns) {
      if (t.x + t.r < vr.x0 || t.x - t.r > vr.x1 || t.y + t.r < vr.y0 || t.y - t.r > vr.y1) continue;
      for (const j of t.walls) {
        const x = j % m.width, y = Math.floor(j / m.width);
        if ((t.gateCells || []).includes(j) || t.buildings.some(b=>b.built&&x>=b.x&&y>=b.y&&x<b.x+b.w&&y<b.y+b.h)) continue;
        const col = wallColor(t, x, y);
        props.push({ obstacle:true, kind:'settlement-wall', x: x + 0.5, y: y + 0.5, draw: (rr) => drawWall(rr, x, y, col, t.style) });
      }
      for (const b of t.buildings) if (b.built) props.push({ obstacle:true,kind:'settlement-building',x:b.x+b.w/2,y:b.y+b.h/2,draw:rr=>{
        const p=rr.toScreen(b.x+b.w/2,b.y+b.h/2),variant=((b.x*31+b.y*17)%97)/97;
        const style=b.kind==='market'?'shop':b.kind==='tower'?'office':t.style==='wood'?'farm':b.kind==='house'?'cottage':'block';
        const heading=Math.atan2(b.door.y+.5-(b.y+b.h/2),b.door.x+.5-(b.x+b.w/2));
        drawHouse(rr.ctx,{style,floors:b.kind==='tower'?3:1,basement:false,variant,condition:'weathered',heading,footprint:{w:b.w,h:b.h}},p.x,p.y,rr.hh*1.1);
        drawSign(rr,b);
      }});
      for (const gate of t.gates || []) {
        const cells = gate.cells || [], gx = cells.length ? cells.reduce((a, j) => a + (j % m.width) + 0.5, 0) / cells.length : t.x + 0.5;
        const gy = cells.length ? cells.reduce((a, j) => a + Math.floor(j / m.width) + 0.5, 0) / cells.length : t.y + 0.5;
        props.push({ x: gx, y: gy, draw: (rr) => drawGate(rr, gate, m, t) });
      }
      for (let i = 0; i < (t.defenses || []).length; i++) {
        const p = t.defenses[i], fire = st.defenseFlash.get(`${t.id}:${i}`);
        props.push({ x: p.x, y: p.y, draw: (rr) => drawDefense(rr, p, t, fire && fire.until > performance.now()) });
        if (fire && fire.until > performance.now()) props.push({ x: fire.tx, y: fire.ty, draw: (rr) => drawDefenseBeam(rr, fire) });
      }
      for (const d of t.decor || []) props.push({ x: d.x, y: d.y, draw: (rr) => drawDecor(rr, d, t) });
    }
  }
  const t = now - 120;
  for (const n of st.npcs.values()) {
    const sn = n.snaps;
    while (sn.length > 2 && sn[1].t <= t) sn.shift();
    let nx, ny;
    if (sn.length >= 2 && sn[0].t <= t) { const k = Math.min(1, (t - sn[0].t) / Math.max(1, sn[1].t - sn[0].t)); nx = sn[0].x + (sn[1].x - sn[0].x) * k; ny = sn[0].y + (sn[1].y - sn[0].y) * k; n.moving = Boolean(sn[1].m); const dx = (sn[1].x - sn[1].y) - (sn[0].x - sn[0].y); if (Math.abs(dx) > 1e-3) n.dir = dx > 0 ? 1 : -1; }
    else { const l = sn[sn.length - 1]; nx = l.x; ny = l.y; n.moving = Boolean(l.m); }
    n.x = nx; n.y = ny;
    if (r.fog && !r.fog.see(nx, ny)) continue; // житель вне обзора (туман войны, шаг 22)
    props.push({ x: nx, y: ny, draw: (rr, time) => rr.drawHero(n, time) });
  }
  const over = scene.overlay;
  return {
    ...scene, props: [...(scene.props || []), ...props],
    overlay: (rr, tt) => {
      if (over) over(rr, tt);
      for (const n of st.npcs.values()) {
        const s = rr.toScreen(n.x, n.y);
        if (s.x < -60 || s.x > rr.vw + 60 || s.y < -60 || s.y > rr.vh + 60) continue;
        if (rr.fog && !rr.fog.see(n.x, n.y)) continue;
        const role = SS().ROLES[n.role];
        rr.label(`${role.icon} ${n.name}`, s.x, s.y - rr.hh * 3.6 - 6, n.angry && n.role === 'guard' ? '#ff8a6a' : '#e8e0a8');
        if (n.hp < 100) { const w = rr.hw * 0.9, ctx = rr.ctx; ctx.fillStyle = '#000a'; ctx.fillRect(s.x - w / 2, s.y - rr.hh * 3.6, w, 4); ctx.fillStyle = '#e0c040'; ctx.fillRect(s.x - w / 2, s.y - rr.hh * 3.6, (w * n.hp) / 100, 4); }
      }
    },
  };
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
function drawWall(r, x, y, color, style) {
  const ctx = r.ctx, { hw, hh } = r, s = r.toScreen(x, y), h = hh * 4, k = 0.95;
  ctx.fillStyle = shade(color, 0.7);
  ctx.beginPath(); ctx.moveTo(s.x - hw * k, s.y + hh); ctx.lineTo(s.x, s.y + hh * (1 + k)); ctx.lineTo(s.x, s.y + hh * (1 + k) - h); ctx.lineTo(s.x - hw * k, s.y + hh - h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = shade(color, 0.85);
  ctx.beginPath(); ctx.moveTo(s.x + hw * k, s.y + hh); ctx.lineTo(s.x, s.y + hh * (1 + k)); ctx.lineTo(s.x, s.y + hh * (1 + k) - h); ctx.lineTo(s.x + hw * k, s.y + hh - h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(s.x, s.y + hh - h - hh * k + hh * (1 - k)); ctx.lineTo(s.x + hw * k, s.y + hh - h); ctx.lineTo(s.x, s.y + hh * (1 + k) - h); ctx.lineTo(s.x - hw * k, s.y + hh - h); ctx.closePath(); ctx.fill();
}
function drawSign(r, b) {
  const def = SS().BUILDINGS[b.kind], s = r.toScreen(b.x + 1.5, b.y + 1.5);
  r.label(`${def.icon} ${def.name}`, s.x, s.y - r.hh * 3.4, '#f3e4c4');
}
const gateMotion = new WeakMap();
function drawGate(r, gate, map, town) {
  const ctx = r.ctx, open = (gate.cells || []).every((j) => map.openGates && map.openGates.has(j));
  for (const j of gate.cells || []) {
    const x = j % map.width, y = Math.floor(j / map.width), s = r.toScreen(x + 0.5, y + 0.5), color = gate.appearance === 'truck' ? '#855d42' : gate.appearance === 'timber' ? '#746447' : gate.appearance === 'vault' ? '#637f7b' : town.wall || '#77766b';
    if (open) {
      ctx.fillStyle = shade(color, 0.62); ctx.fillRect(s.x - r.hw * 0.7, s.y - r.hh * 2.8, r.hw * 0.18, r.hh * 3.4);
      ctx.fillRect(s.x + r.hw * 0.52, s.y - r.hh * 2.8, r.hw * 0.18, r.hh * 3.4);
    } else {
      ctx.fillStyle = shade(color, 0.7); ctx.fillRect(s.x - r.hw * 0.72, s.y - r.hh * 2.4, r.hw * 1.44, r.hh * 2.5);
      if (gate.appearance === 'truck') {
        ctx.fillStyle = '#182126'; ctx.fillRect(s.x-r.hw*0.56,s.y-r.hh*2.05,r.hw*0.4,r.hh*0.55);
        ctx.fillStyle = '#25292a';
        for (const dx of [-0.48,0.48]) { ctx.beginPath(); ctx.ellipse(s.x+r.hw*dx,s.y,r.hw*0.17,r.hh*0.38,0,0,Math.PI*2); ctx.fill(); }
        ctx.fillStyle = '#c7ad70'; ctx.fillRect(s.x-r.hw*0.65,s.y-r.hh*0.7,r.hw*0.1,r.hh*0.18);
      }
      ctx.strokeStyle = shade(color, 1.35); ctx.lineWidth = Math.max(1, r.hw * 0.09);
      for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(s.x + k * r.hw * 0.38, s.y - r.hh * 2.25); ctx.lineTo(s.x + k * r.hw * 0.38, s.y + r.hh * 0.1); ctx.stroke(); }
    }
  }
}
function drawDefense(r, p, town, firing = false) {
  const ctx = r.ctx, s = r.toScreen(p.x, p.y);
  ctx.fillStyle = '#252b2c'; ctx.beginPath(); ctx.ellipse(s.x, s.y, r.hw * 0.72, r.hh * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = town.wall || '#778080'; ctx.fillRect(s.x - r.hw * 0.35, s.y - r.hh * 1.7, r.hw * 0.7, r.hh * 1.6);
  ctx.fillStyle = '#30383a'; ctx.fillRect(s.x - r.hw * 0.13, s.y - r.hh * 2.5, r.hw * 0.26, r.hh * 1.1);
  ctx.fillStyle = firing ? '#fff2a0' : '#f4bd58'; ctx.fillRect(s.x - r.hw * 0.07, s.y - r.hh * 2.1, r.hw * 0.14, r.hh * 0.2);
}
function drawDefenseBeam(r, fire) {
  const a = r.toScreen(fire.x, fire.y), b = r.toScreen(fire.tx, fire.ty), ctx = r.ctx;
  ctx.save(); ctx.strokeStyle = '#ffd56b'; ctx.globalAlpha = 0.75; ctx.lineWidth = Math.max(1, r.hw * 0.1);
  ctx.beginPath(); ctx.moveTo(a.x, a.y - r.hh * 1.8); ctx.lineTo(b.x, b.y - r.hh); ctx.stroke(); ctx.restore();
}
function drawDecor(r, d, town) {
  const ctx = r.ctx, s = r.toScreen(d.x, d.y), hw = r.hw, hh = r.hh;
  const colors = town.style === 'wood' ? ['#80623e', '#52724b', '#bf9b5d'] : town.style === 'vault' ? ['#42666c', '#9ac7b5', '#a89056'] : ['#596269', '#a87848', '#7e985c'];
  ctx.save();
  if (d.kind === 'well' || d.kind === 'reactor') {
    ctx.fillStyle = colors[0]; ctx.beginPath(); ctx.ellipse(s.x, s.y, hw * 0.62, hh * 0.36, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = d.kind === 'reactor' ? '#55e7cb' : '#28302d'; ctx.beginPath(); ctx.ellipse(s.x, s.y - hh * 0.25, hw * 0.38, hh * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  } else if (d.kind === 'planter') {
    ctx.fillStyle = colors[1]; ctx.fillRect(s.x - hw * 0.48, s.y - hh * 0.7, hw * 0.96, hh * 0.65);
    ctx.fillStyle = colors[2]; ctx.beginPath(); ctx.arc(s.x, s.y - hh * 1.15, hw * 0.22, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = colors[d.variant % colors.length]; ctx.fillRect(s.x - hw * 0.45, s.y - hh * 1.05, hw * 0.9, hh * 1.05);
    ctx.fillStyle = shade(colors[0], 0.7); ctx.fillRect(s.x - hw * 0.45, s.y - hh * 1.05, hw * 0.9, hh * 0.2);
    if (d.kind === 'antenna' || d.kind === 'radio' || d.kind === 'terminal') { ctx.strokeStyle = '#b8c7bf'; ctx.beginPath(); ctx.moveTo(s.x, s.y - hh); ctx.lineTo(s.x + hw * 0.12, s.y - hh * 2); ctx.stroke(); }
  }
  ctx.restore();
}

// Раздел справки «Поселения» (значения — из настроек сервера)
export function settlementsHelp() {
  const S = SS(), g = window.GameSettings || {}, s = { ...(S ? S.settings : {}), ...g };
  if (!S) return '';
  const kinds = Object.values(S.KINDS).map((k) => `<b>${k.name}</b> — ${k.roles.filter((r, i, a) => a.indexOf(r) === i).map((r) => S.ROLES[r].name.toLowerCase()).join(', ')}${k.ring ? '; стена с воротами' : ''}${k.spellTier ? `; маг учит до ${k.spellTier}-го круга` : ''}`).join('; ');
  return `<ul>
    <li>Поселения стоят на карте с самого начала: ${kinds}. Застройка (дома, стены, ворота, рынок, лечебница, башня мага, мастерская) одинакова у всех игроков с этим сидом.</li>
    <li><b>Жители</b> появляются, когда вы подходите. <b>T</b> рядом с жителем или <b>щелчок</b> по нему — разговор; ответы выбираются кнопками. <b>Esc</b> — закрыть.</li>
    <li><b>Торговец</b> покупает и продаёт. Цена = ценность × редкость (обычный ×1 … легендарный ×3.2) × ${s.tradeBuyFactor} при покупке и × ${s.tradeSellFactor} при продаже; репутация ±100 меняет цены на ±${Math.round(s.tradeRepPriceMax * 100)}%. Товар пополняется раз в ${s.settlementRestockMin} мин. Деньги — <b>крышки</b>; золотой самородок = ${S.NUGGET} крышек, сдачу дают крышками. Shift+щелчок — купить до пяти / продать всё.</li>
    <li><b>Лекарь</b> лечит раны (${s.healPricePerHp} крышки за единицу здоровья), болезнь и радиацию (${s.curePrice} крышек), продаёт лекарства. <b>Маг-наставник</b> учит заклинаниям (${s.spellPricePerTier} × круг² крышек). <b>Мастер</b> продаёт рецепты крафта без свитков; верстак и кузня мастерской — общие. <b>Староста</b> раздаёт задания (появятся позже).</li>
    <li><b>Репутация</b> в каждом поселении от −100 до 100: растёт от торговли (+1 за ${s.repTradePer} крышек) и защиты от набегов (+${s.repDefend}), падает от нападения на жителя (−${s.repAssault}) и убийства (−${s.repMurder}); ${Math.round(s.repFactionShare * 100)}% изменения получают поселения того же рода. Отношение: враждебность (≤ ${s.repHostileAt}: стража нападает, никто не торгует), неприязнь (≤ ${s.repUnfriendlyAt}: лекарь и маг отказывают), безразличие, дружба (≥ ${s.repFriendlyAt}), почёт (≥ ${s.repHonoredAt}). Хорошая репутация облегчает вербовку «Договором».</li>
    <li><b>Стража</b> обходит поселение и бьёт врагов. Напали на жителя (Ctrl+щелчок по нему) — стража преследует вас ${s.wantedSec} с, и с вами не говорят.</li>
    <li><b>Мирная зона</b>: в поселении нет PvP${s.settlementPvpOff ? '' : ' (на этом сервере PvP разрешено)'}, нельзя ставить мины, ловушки и турели, нельзя строить базу рядом. Здесь можно выспаться (Z) и возродиться после гибели.</li>
    <li><b>Набеги</b>: налётчики нападают на поселения (событие администратора). Каждый налётчик внутри разрушает поселение; отбили — каждый защитник получает ${s.raidRewardGold} золотых самородка и +${s.repDefend} репутации. Не отбили за ${s.raidMaxMin} мин — поселение разорено: цены ×${s.tradeDamagedFactor}, пока не отстроится.</li>
  </ul>`;
}
