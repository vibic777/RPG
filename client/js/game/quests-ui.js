// Задания, фракции и концовки на клиенте (шаг 16): журнал (F2 или 📜) — взятые задания мира с целями, наградами и меткой главаря,
// сюжет, отказ; вкладка «Фракции» — репутация у банд, Союза, Ордена и Улья с отношениями; экран концовки со сводкой;
// T рядом с Железным Патриархом — разговор (окно диалога поселений). Всё решает сервер.
const QQ = () => window.Quests;
const FF = () => window.Factions;
const SS = () => window.Settlements;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let api = null; // { send, toast, hero(), enemies() }
const st = { log: null, fac: {}, tab: 'quests', open: false };

export function questsAttach(a) {
  api = a;
  const b = $('#btn-quests');
  if (b && !b.dataset.bound) { b.dataset.bound = '1'; b.addEventListener('click', () => questsToggle()); }
  const c = $('#btn-ending-close');
  if (c && !c.dataset.bound) { c.dataset.bound = '1'; c.addEventListener('click', () => $('#ending-window').classList.add('hidden')); }
  const x = $('#btn-quest-close');
  if (x && !x.dataset.bound) { x.dataset.bound = '1'; x.addEventListener('click', () => questsToggle(false)); }
}
export function questsOnWelcome(msg) {
  st.log = msg.quests || null;
  st.fac = msg.fac || {};
  render();
}
export function questsOnMessage(msg) {
  switch (msg.t) {
    case 'quests': {
      const before = st.log ? st.log.active.length : 0;
      st.log = msg;
      if (msg.active.length > before) badge(true);
      render();
      return true;
    }
    case 'fac': st.fac = msg.reps; render(); return true;
    case 'ending': showEnding(msg); return true;
    case 'quest-reject': api.toast(msg.message, 4000); return true;
    default: return false;
  }
}
export const questsIsOpen = () => st.open;
export function questsToggle(on = !st.open) {
  st.open = on;
  const w = $('#quest-window');
  if (w) w.classList.toggle('hidden', !on);
  if (on) { badge(false); render(); }
}
function badge(on) { const b = $('#quests-badge'); if (b) b.classList.toggle('hidden', !on || st.open); }

// ---------- Журнал ----------
function rewardText(r) {
  if (!r) return '';
  const It = window.Items, parts = [];
  if (r.caps) parts.push(`${r.caps} 🪙`);
  if (r.xp) parts.push(`${r.xp} опыта`);
  for (const [id, n] of r.items || []) parts.push(`${(It.get(id) || {}).name || id}${n > 1 ? ` × ${n}` : ''}`);
  if (r.rep) parts.push(`+${r.rep} к поселению`);
  for (const [f, n] of Object.entries(r.fac || {})) parts.push(`${n > 0 ? '+' : ''}${n} «${FF().FACTIONS[f].name}»`);
  if (r.spell) parts.push(`заклинание «${(window.Magic && window.Magic.get(r.spell) || {}).name || r.spell}»`);
  if (r.recipe) parts.push('рецепт');
  return parts.join(', ');
}
function whereText(w) {
  const h = api && api.hero();
  if (!w || !h) return '';
  const dx = w.x + 0.5 - h.x, dy = w.y + 0.5 - h.y, d = Math.round(Math.hypot(dx, dy));
  const arrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  const a = arrows[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
  return `<div class="q-where" title="Где ждёт ${esc(w.name)}: координаты карты и направление от вас (стрелка — по карте, север вверху)">📍 ${esc(w.name)}: ${w.x}, ${w.y} — ${a} ${d} кл.</div>`;
}
function renderQuests() {
  const L = st.log;
  if (!L) return '<p class="muted">Журнал пуст.</p>';
  let h = `<div class="muted" title="Общая кооперативная кампания мира. Поздно вошедшему игроку уже пройденные главы засчитываются автоматически; награды старых заданий повторно не выдаются. После концовки мир остаётся доступен.">Сюжет мира: <b>${Math.min(L.main, L.mainTotal)}/${L.mainTotal}</b>${L.story.ending ? ` · концовка: <b>${esc((QQ().ENDINGS[L.story.ending] || { name: L.story.ending }).name)}</b>` : ''} · выполнено заданий: ${L.done}</div>`;
  if (!L.active.length) h += '<p class="muted">Нет взятых заданий. Поговорите со старостой поселения (❗): «Есть работа?».</p>';
  if(L.party?.length)h+=`<details><summary>Участники мира · ${L.party.length}/8</summary><ul>${L.party.map(p=>`<li>${esc(p.name)} — ${esc(p.region)}</li>`).join('')}</ul></details>`;
  for (const q of L.active) {
    const k = QQ().KINDS[q.kind] || { icon: '•', name: q.kind };
    h += `<div class="q-item${q.main ? ' main' : ''}"><div class="q-name" title="${esc(k.name)}">${k.icon} ${esc(q.name)}${q.main ? ' <span class="q-tag">сюжет</span>' : ''}${q.giverName ? ` <span class="muted">· ${esc(q.giverName)}</span>` : ''}</div>`;
    h += `<div class="q-text">${esc(q.text)}</div><ul class="q-goals">${q.goals.map((g) => `<li class="${g.done ? 'done' : ''}">${g.done ? '✔' : '○'} ${esc(g.text)}${g.optional ? ' <span class="muted">(не обязательно)</span>' : ''}</li>`).join('')}</ul>`;
    h += q.regionName?`<div class="muted">Регион: ${esc(q.regionName)}</div>`:'';
    h += whereText(q.where);
    h += `<div class="q-reward" title="Награду получает каждый участник: все, кто был в мире, пока задание шло">Награда: ${esc(rewardText(q.reward))}</div>`;
    if (!q.main) h += `<button type="button" class="btn small" data-abandon="${esc(q.id)}" title="Отказаться от задания (его можно взять снова, пока оно на доске)">Отказаться</button>`;
    h += '</div>';
  }
  return h;
}
function renderFactions() {
  const F = FF(), S = SS();
  let h = '<p class="muted small">Репутация −100…100 — у героя (переходит между мирами). Члены фракции, к которой вы не враждебны (выше ' + F.settings.factionAttackAt + '), не нападают первыми; дружественную банду можно уговорить в спутники (T). Часть каждого изменения достаётся союзникам фракции, обратная — её врагам.</p>';
  h += '<table class="q-fac">';
  for (const id of F.IDS) {
    const f = F.FACTIONS[id], v = st.fac[id] != null ? st.fac[id] : F.repOf({}, id), tier = S.TIERS[F.tierOf(v)];
    const allies = F.alliesOf(id).map((x) => F.FACTIONS[x].name), enemies = F.enemiesOf(id).map((x) => F.FACTIONS[x].name);
    const tip = `${f.desc}${allies.length ? `\nСоюзники: ${allies.join(', ')}` : ''}${enemies.length ? `\nВраги: ${enemies.join(', ')}` : ''}${f.locked ? '\nРепутацию не изменить.' : ''}`;
    h += `<tr title="${esc(tip)}"><td><span style="color:${f.color}">■</span> ${esc(f.name)}</td><td class="q-bar"><span style="left:${(v + 100) / 2}%"></span></td><td>${Math.round(v)}</td><td style="color:${tier.color}">${tier.name}</td></tr>`;
  }
  return h + '</table>';
}
function render() {
  const box = $('#quest-body');
  if (!box || !st.open) return;
  box.innerHTML = `<div class="q-tabs"><button type="button" class="btn small ${st.tab === 'quests' ? 'primary' : ''}" data-tab="quests" title="Взятые задания мира — общие для всех игроков в нём">Задания</button><button type="button" class="btn small ${st.tab === 'fac' ? 'primary' : ''}" data-tab="fac" title="Репутация у фракций и их отношения">Фракции</button></div>` + (st.tab === 'quests' ? renderQuests() : renderFactions());
  box.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; render(); }));
  box.querySelectorAll('[data-abandon]').forEach((b) => b.addEventListener('click', () => { if (confirm('Отказаться от задания?')) api.send({ t: 'quest', a: 'abandon', id: b.dataset.abandon }); }));
}
let lastRender = 0;
export function questsFrame(now) {
  if(now-lastRender<1000)return;lastRender=now;
  if(st.open&&st.tab==='quests')render();
  let pointer=$('#story-direction');
  const quest=st.log?.active?.find(q=>q.main&&q.where);
  if(!pointer&&quest){pointer=document.createElement('button');pointer.id='story-direction';pointer.className='btn';Object.assign(pointer.style,{position:'fixed',right:'18px',top:'100px',maxWidth:'310px',textAlign:'left',zIndex:40,fontSize:'13px',opacity:'.92'});pointer.onclick=()=>questsToggle(true);document.body.append(pointer);}
  if(pointer){pointer.hidden=!quest;if(quest){const h=api.hero(),dx=quest.where.x+.5-h.x,dy=quest.where.y+.5-h.y,arrows=['→','↘','↓','↙','←','↖','↑','↗'],arrow=arrows[(Math.round(Math.atan2(dy,dx)/(Math.PI/4))+8)%8];pointer.textContent=`${arrow} ${quest.name} · ${quest.where.name} · ${Math.round(Math.hypot(dx,dy))} кл. · F2`;}}
}

// ---------- Концовка ----------
function showEnding(msg) {
  const w = $('#ending-window'), body = $('#ending-body');
  if (!w || !body) return;
  const s = msg.summary || {};
  const S = SS();
  body.innerHTML = `<h2>${esc(msg.name)}</h2><p class="ending-text">${esc(msg.text)}</p>`
    + `<ul class="ending-sum"><li>Мир: <b>${esc(s.world || '')}</b></li><li>Уровень героя: <b>${s.level || 1}</b>, смертей: ${s.deaths || 0}</li><li>Заданий выполнено в мире: <b>${s.quests || 0}</b>, сюжет: ${s.main || 0}/${s.mainTotal || 0}</li>`
    + `<li>Фракции: ${(s.factions || []).map((f) => `${esc(f.name)} — <span style="color:${S.TIERS[f.tier].color}">${S.TIERS[f.tier].name}</span>`).join(', ')}</li><li>Концовки героя: ${(s.endings || []).length}</li></ul>`
    + `<p class="muted">${msg.fresh ? 'Новая концовка отмечена у героя. ' : ''}Игра продолжается: мир остаётся вашим. «Новая игра+» с этим героем и базой — кнопка при создании мира.</p>`;
  w.classList.remove('hidden');
}

// ---------- Ввод ----------
function patriarchNear() {
  const h = api.hero();
  for (const e of api.enemies().values()) if (e.def && e.def.id === 'boss_super' && !e.deadAt && Math.hypot(e.x - h.x, e.y - h.y) <= 4) return e;
  return null;
}
export function questsKey(e) {
  if (!api) return false;
  if (e.code === 'F2') { e.preventDefault(); questsToggle(); return true; }
  if (e.code === 'Escape' && st.open) { e.preventDefault(); questsToggle(false); return true; }
  if (e.code === 'Escape' && !$('#ending-window').classList.contains('hidden')) { e.preventDefault(); $('#ending-window').classList.add('hidden'); return true; }
  if (e.code === 'KeyT' && !e.shiftKey && !e.altKey && patriarchNear()) { e.preventDefault(); api.send({ t: 'quest', a: 'parley' }); return true; }
  return false;
}
export function questsHelp() {
  const Q = QQ(), F = FF();
  if (!Q || !F) return '';
  return `<h3 id="h-quests">Задания, фракции и концовки</h3>
  <p><b>Журнал</b> — <b>F2</b> или кнопка 📜: взятые задания мира, цели (✔ — выполнено), награда, метка главаря (координаты и стрелка). Сюжет <b>общий для мира</b>: игрок, который присоединится позже, автоматически получает зачёт уже пройденных глав и продолжает с группой. Старые предметы и опыт повторно не выдаются. Текущий квест общий: награду получает каждый участник и все, кто находится в мире при завершении; вышедшему участнику она придёт при следующем входе. После концовки можно остаться в том же мире.</p>
  <p><b>Старосты</b> поселений (❗) дают задания: «Есть работа?». Обычные (${Q.settings.questBoardSize} на доске, обновляются раз в ${Q.settings.questBoardRefreshMin} мин): ${Q.TEMPLATES.map((k) => Q.KINDS[k].icon + ' ' + Q.KINDS[k].name.toLowerCase()).join(', ')}. «Принести» и «доставить» сдаются старосте (посылку — старосте поселения-адресата); остальные засчитываются сами. Взять одновременно можно до ${Q.settings.questMaxActive} заданий.</p>
  <p><b>Сюжет</b> (${Q.MAIN.length} заданий у любого старосты): ${Q.MAIN.map((q) => q.name).join(' → ')}. Главаря банды можно убить <i>или</i> подружиться с бандой (репутация «дружба» и выше).</p>
  <p><b>Фракции</b>: ${F.IDS.map((id) => F.FACTIONS[id].name).join(', ')}. Убийство члена фракции: −${F.settings.factionKillRep} (главаря — −${F.settings.factionBossKillRep}); удар по невраждебному: −${F.settings.factionAttackRep}. ${Math.round(F.settings.factionEnemyShare * 100)}% изменения с обратным знаком получают враги фракции, ${Math.round(F.settings.factionAllyShare * 100)}% — союзники. Банды — союзники Патриарха и враги Союза поселений. Репутация Союза (×${F.settings.factionTownWeight}) добавляется к отношению каждого поселения: цены, стража, разговоры.</p>
  <p><b>Финал</b>: Железный Патриарх. Если он не враждебен — <b>T</b> рядом: служить ему («${Q.ENDINGS.ally.name}», нужна дружба с ним), объединить фракции («${Q.ENDINGS.unite.name}»: все банды не враждебны и дружба с Союзом), позвать в семью («${Q.ENDINGS.family.name}», почёт у Патриарха) — или сразиться. Убит в бою — «${Q.ENDINGS.destroy.name}», а если ${Q.settings.endingRuleGangs}+ банды вам друзья — «${Q.ENDINGS.rule.name}». После концовки — экран итогов, <b>игра продолжается</b>, а при создании мира открывается «Новая игра+» с этим героем и базой.</p>`;
}
