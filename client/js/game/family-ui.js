// Семья на клиенте (шаг 17): панель семьи (F3 или 👪) — члены семьи (дело, распорядок, кровать, поход), приглашение
// Патриарха, семейный союз с игроком (предложить, принять, расторгнуть), отношения с жителями; члены семьи на базе рисуются
// у кроватей и флага по распорядку дня. Всё решает сервер; разговоры с жителями — в окне поселений (settlements-ui.js).
const FF = () => window.Family;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let api = null; // { send, toast, hero() }
const st = { fam: null, open: false, at: 0 };

export function famAttach(a) {
  api = a;
  const b = $('#btn-family');
  if (b && !b.dataset.bound) { b.dataset.bound = '1'; b.addEventListener('click', () => famToggle()); }
  const x = $('#btn-family-close');
  if (x && !x.dataset.bound) { x.dataset.bound = '1'; x.addEventListener('click', () => famToggle(false)); }
}
export function famOnWelcome(msg) { st.fam = msg.fam || null; st.at = performance.now(); render(); }
export function famOnMessage(msg) {
  switch (msg.t) {
    case 'fam': st.fam = msg; st.at = performance.now(); render(); return true;
    case 'fam-ask': api.toast(`💞 ${msg.name} предлагает создать семью. Ответ — в панели семьи (F3), ${msg.sec} с.`, 6000); badge(true); return true;
    case 'fam-reject': api.toast(msg.message, 4000); return true;
    default: return false;
  }
}
export const famIsOpen = () => st.open;
export function famToggle(on = !st.open) {
  st.open = on;
  const w = $('#family-window');
  if (w) w.classList.toggle('hidden', !on);
  if (on) { badge(false); api.send({ t: 'fam', a: 'list' }); render(); }
}
function badge(on) { const b = $('#family-badge'); if (b) b.classList.toggle('hidden', !on || st.open); }

// ---------- Панель ----------
function memberRow(m) {
  const F = FF(), k = F.KINDS[m.kind], ph = F.PHASES[m.phase];
  const roles = F.ROLE_IDS.map((r) => `<option value="${r}" ${(m.adult ? m.role : m.study) === r ? 'selected' : ''}>${F.ROLES[r].icon} ${F.ROLES[r].name}</option>`).join('');
  const roleTip = m.adult ? 'Чем помогает на базе в рабочее время (нужна своя кровать)' : `Чему учится до взрослости (${F.settings.familyAdultAge} лет): повзрослев, займётся этим делом`;
  const state = m.out ? '<span class="fam-tag">в походе</span>' : m.housed ? `<span title="Распорядок дня: сон, работа, отдых">${ph.icon} ${ph.name}</span>${m.helping ? ' · <b class="good">помогает</b>' : ''}` : '<span class="bad" title="Поставьте ещё кровать на базе — без неё член семьи не помогает">нет кровати</span>';
  const go = m.out ? `<button type="button" class="btn small" data-home="${esc(m.id)}" title="Вернуть домой на базу: здесь ребёнок защищён от гибели">Домой</button>` : `<button type="button" class="btn small" data-out="${esc(m.id)}" title="Взять в команду (место из 11). Ребёнок вне базы получает урон и может погибнуть">В поход</button>`;
  return `<div class="fam-item"><div><b>${k.icon} ${esc(m.name)}</b> <span class="muted">${k.name.toLowerCase()}${m.kind === 'child' ? `, ${m.age} лет${m.adult ? ' (взрослый)' : ''}` : ''} · ур. ${m.level}</span></div>`
    + `<div class="fam-line"><select data-role="${esc(m.id)}" title="${esc(roleTip)}">${roles}</select> ${state} ${go}${m.kind==='partner'&&m.age>=18&&!m.out?` <button type="button" class="btn small" data-together="${esc(m.id)}" title="Совместный отдых с супругом: подойдите к кровати">🌙</button> <button type="button" class="btn small" data-conceive="${esc(m.id)}" title="Завести ребёнка: взрослые супруги разного пола, кровать рядом и свободная кровать для ребёнка">💞</button>`:''}${m.pregnancy?` <span>🤰 Рождение через ${Math.max(0,Math.ceil((m.pregnancy.due-Date.now())/60000))} мин.</span>`:''}</div></div>`;
}
function render() {
  const box = $('#family-body');
  if (!box || !st.open) return;
  const f = st.fam, F = FF();
  if (!f || !F) { box.innerHTML = '<p class="muted">Семья отключена на сервере.</p>'; return; }
  const home = f.members.filter((m) => !m.out).length;
  let h = `<div class="muted" title="Каждому члену семьи дома нужна своя кровать на базе; без кровати он живёт у вас, но не помогает">Кроватей на базе: <b>${f.beds}</b> · дома: ${home} · в семье: ${f.members.length}/${F.settings.familyMaxMembers}</div>`;
  if(f.pregnancy)h+=`<p>🤰 Вы ожидаете ребёнка. Рождение через ${Math.max(0,Math.ceil((f.pregnancy.due-Date.now())/60000))} мин.</p>`;
  for (const inv of f.invites) if (inv === 'boss_super') h += `<div class="fam-item main"><b>👴 Железный Патриарх</b> хочет войти в вашу семью (концовка «Семья»). <button type="button" class="btn small primary" data-invite="1">Принять</button> <button type="button" class="btn small" data-invite="0">Отказать</button></div>`;
  h += '<h3>Семья</h3>' + (f.members.length ? f.members.map(memberRow).join('') : '<p class="muted">Пока никого. Подружитесь с жителем поселения или спросите старосту о сиротах.</p>');
  h += '<h3 title="Семейный союз с другим игроком — по взаимному согласию; открывает базы друг другу">Союз с игроком</h3>';
  if (f.bond) h += `<p>💞 Ваша семья — <b>${esc(f.bond.name)}</b>. <button type="button" class="btn small danger" data-unbond="1">Расторгнуть</button></p>`;
  else h += '<p><input id="fam-bond-name" placeholder="имя героя рядом" maxlength="40"> <button type="button" class="btn small" data-bond="1" title="Предложить игроку рядом создать семью; он должен согласиться">Предложить</button></p>';
  for (const a of f.asks) h += `<p>💌 <b>${esc(a.name)}</b> предлагает создать семью. <button type="button" class="btn small primary" data-answer="${esc(a.from)}" data-yes="1">Согласиться</button> <button type="button" class="btn small" data-answer="${esc(a.from)}" data-yes="0">Отказать</button></p>`;
  h += '<h3 title="Симпатия 0…100 растёт от разговоров, подарков, заданий старосты и защиты поселения">Отношения в этом мире</h3>';
  h += f.rel.length ? '<table class="fam-rel">' + f.rel.map((r) => { const s = F.STAGES[r.stage]; return `<tr><td>${s.icon} ${esc(r.name)}</td><td class="muted">${esc(r.town)}</td><td class="q-bar" title="Симпатия ${r.affinity}/100"><span style="left:${r.affinity}%"></span></td><td>${s.name}</td></tr>`; }).join('') + '</table>' : '<p class="muted">Поговорите с жителями поселений (T → «Поговорить о личном…»).</p>';
  box.innerHTML = h;
  for(const attr of ['together','conceive'])box.querySelectorAll('[data-'+attr+']').forEach(el=>el.addEventListener('click',()=>api.send({t:'fam',a:'together',id:el.dataset[attr],conceive:attr==='conceive'})));
  box.querySelectorAll('[data-role]').forEach((el) => el.addEventListener('change', () => api.send({ t: 'fam', a: 'role', id: el.dataset.role, role: el.value })));
  box.querySelectorAll('[data-out]').forEach((el) => el.addEventListener('click', () => api.send({ t: 'fam', a: 'out', id: el.dataset.out })));
  box.querySelectorAll('[data-home]').forEach((el) => el.addEventListener('click', () => api.send({ t: 'fam', a: 'home', id: el.dataset.home })));
  box.querySelectorAll('[data-invite]').forEach((el) => el.addEventListener('click', () => api.send({ t: 'fam', a: 'invite', who: 'boss_super', yes: el.dataset.invite === '1' })));
  box.querySelectorAll('[data-answer]').forEach((el) => el.addEventListener('click', () => api.send({ t: 'fam', a: 'answer', from: el.dataset.answer, yes: el.dataset.yes === '1' })));
  box.querySelectorAll('[data-unbond]').forEach((el) => el.addEventListener('click', () => { if (confirm('Расторгнуть семейный союз?')) api.send({ t: 'fam', a: 'unbond' }); }));
  box.querySelectorAll('[data-bond]').forEach((el) => el.addEventListener('click', () => { const v = $('#fam-bond-name').value.trim(); if (v) api.send({ t: 'fam', a: 'bond', name: v }); }));
}

// ---------- Члены семьи на базе ----------
const SKINS = ['#e8c4a0', '#c99a72', '#8d5a3b', '#f0d2b4', '#b07850'];
function figure(m, i, x, y) {
  const k = [...m.id].reduce((a, ch) => a + ch.charCodeAt(0), 0), skin = SKINS[k % SKINS.length];
  const shirt = m.kind === 'elder' ? '#3d4247' : ['#6a8a5a', '#8a5a6a', '#5a6a8a', '#8a7a4a'][k % 4];
  if (m.kind === 'child' && window.Art) { // дети разные (шаг 19): рост по возрасту, волосы, кожа, одежда — по сиду
    const c = window.Art.childLook(m.id, m.age, FF().settings.familyAdultAge);
    const look = { shirt: { color: c.shirt, shape: 'shirt' }, pants: { color: c.pants, shape: 'pants' }, feet: { color: '#53534b', shape: 'boots' }, ...(c.accessory === 'cap' ? { head: { shape: 'bandana', color: c.pants } } : c.accessory === 'scarf' ? { belt: { color: c.pants } } : {}) };
    return { id: 'fam-' + m.id, x, y, dir: 1, moving: false, look, scale: c.scale, name: m.name, kind: m.kind, colors: { skin: c.skin, hair: c.hair, longHair: c.longHair, underwear: c.shirt, legs: c.pants, armL: c.skin, armR: c.skin } };
  }
  return { id: 'fam-' + m.id, x, y, dir: 1, moving: false, look: { shirt: { color: shirt, shape: 'shirt' }, pants: { color: '#4a4038', shape: 'pants' }, feet: { color: '#53534b', shape: 'boots' } }, name: m.name, kind: m.kind, colors: { skin, hair: m.kind === 'elder' ? null : ['#2a1a10', '#6a4a2a', '#c8a050'][k % 3], longHair: m.gender === 'female', underwear: shirt, legs: '#4a4038', armL: skin, armR: skin } };
}
function homeFigures(now) {
  const f = st.fam, F = FF();
  if (!f || !f.home || !F) return [];
  const out = [], beds = f.home.beds, t = Date.now();
  f.members.forEach((m, i) => {
    if (m.out || !m.housed) return;
    const ph = F.phase(t, i), bed = beds[i % Math.max(1, beds.length)];
    let x, y;
    if (ph === 'sleep' && bed) { x = bed.x; y = bed.y; }
    else { const a = i * 2.1 + (ph === 'rest' ? now / 9000 : 0), r = ph === 'work' ? 2.2 : 1.4; x = f.home.x + Math.cos(a) * r; y = f.home.y + Math.sin(a) * r; }
    out.push(figure(m, i, x, y));
  });
  return out;
}
export function famScene(scene, r, now) {
  const figs = homeFigures(now);
  if (!figs.length) return scene;
  const over = scene.overlay;
  return {
    ...scene, props: [...(scene.props || []), ...figs.map((p) => ({ x: p.x, y: p.y, draw: (rr, time) => rr.drawHero(p, time) }))],
    overlay: (rr, tt) => {
      if (over) over(rr, tt);
      for (const p of figs) { if (rr.fog && !rr.fog.known(p.x, p.y)) continue; const s = rr.toScreen(p.x, p.y); if (s.x > -60 && s.x < rr.vw + 60 && s.y > -60 && s.y < rr.vh + 60) rr.label(`${FF().KINDS[p.kind].icon} ${p.name}`, s.x, s.y - rr.hh * 3.6 - 6, '#b8e8a8'); }
    },
  };
}

// ---------- Ввод ----------
export function famKey(e) {
  if (!api) return false;
  if (e.code === 'F3') { e.preventDefault(); famToggle(); return true; }
  if (e.code === 'Escape' && st.open) { e.preventDefault(); famToggle(false); return true; }
  return false;
}
export function familyHelp() {
  const F = FF();
  if (!F) return '';
  const s = F.settings, stg = F.STAGES;
  return `<h3 id="h-family">Семья</h3>
  <p><b>Панель семьи</b> — <b>F3</b> или кнопка 👪: члены семьи, их дело и распорядок, поход, союз с игроком, отношения с жителями.</p>
  <ul>
    <li><b>Отношения.</b> С любым жителем поселения, кроме стражи: T → «Поговорить о личном…». Симпатия 0…100: разговор по душам +${s.familyTalkAffinity} (не чаще раза в ${s.familyTalkCooldownMin} мин), подарок — +1 за каждые ${s.familyGiftValuePer} крышек ценности (до +${s.familyGiftMax}), задание старосты +${s.familyQuestAffinity}, защита от набега +${s.familyHelpAffinity}. Отношение поселения ускоряет или замедляет рост (враги — не растёт).</li>
    <li><b>Стадии:</b> ${['stranger', 'acquaint', 'friend', 'close'].map((k) => `${stg[k].icon} ${stg[k].name}`).join(' → ')} (с ${s.familyCourtAt}) → ${stg.courting.icon} ухаживание (прогулка) → ${stg.engaged.icon} помолвка (предложение, симпатия ${s.familyProposeAt}+) → ${stg.partner.icon} свадьба.${s.familyOppositeSex ? ' По правилам мира семью создают с персонажем противоположного пола.' : ''} Ухаживать можно только за одним человеком, супруг — один.</li>
    <li><b>Свадьба</b> — праздник в поселении («Сыграть свадьбу!»): нужна помолвка, отношение поселения не ниже безразличия, ${s.familyCeremonyCost} крышек и свободная кровать на базе. Супруг(а) переезжает к вам на базу.</li>
    <li><b>Союз с игроком</b> — по взаимному согласию: «Предложить» в панели, другой игрок соглашается (${s.familyBondAskSec} с). Базы становятся общими. Расторгнуть можно в любой момент.</li>
    <li><b>Дети.</b> Староста знает сирот (по ${s.familyOrphansPerTown} в поселении): «Есть ли сироты…» → «Принять в семью» (нужна кровать). Ребёнок взрослеет на год за ${s.familyChildYearMin} мин и учится выбранному делу; к ${s.familyAdultAge} годам становится помощником с уровнем за учёбу и может ходить с вами.</li>
    <li><b>Жизнь на базе.</b> Каждому дома — своя кровать. Распорядок: сон, работа, отдых (день — ${s.familyDayMin} мин). В рабочее время взрослые помогают: 🛡 охрана (бьёт врагов в ${s.familyGuardRadius} кл. от флага), 🔨 ремесло (очередь крафта на ${Math.round(s.familyCraftSpeedup * 100)}% быстрее, пока помощник дома), 🧺 сбор (ресурс в сундук базы раз в ${s.familyGatherMin} мин), ✚ лечение (+${s.familyHealPerTick} здоровья вам на базе).</li>
    <li><b>Поход.</b> Взять можно и ребёнка: «В поход» занимает место команды (до 11), «Домой» возвращает на базу. Дома и внутри своей базы дети защищены от гибели. Вне базы получают урон; тяжело раненого нужно спасти до истечения таймера, иначе он погибает окончательно, оставляя труп и вещи. «Исключить» в панели спутников отправляет члена семьи домой. Дети растут и в походе, и вне игры: один год за ${s.familyChildYearMin} реальных минут.</li>
    <li><b>Железный Патриарх</b> после концовки «Семья» ждёт в панели: «Принять» — он становится старейшиной и охраняет базу.</li>
    <li>Семья хранится на герое и переезжает в «Новую игру+» вместе с базой.</li>
  </ul>`;
}
