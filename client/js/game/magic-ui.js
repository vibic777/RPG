import {replacePanelHtml} from '../floating-window.js';
import {resetMagicFields,magicFieldMessage} from './magic-field-view.js';
export {magicFieldsScene,magicSlipperyAt,magicFieldsWelcome} from './magic-field-view.js';
// Магия на клиенте (шаг 12): книга заклинаний (P), заклинания на панели 1–0, полоса чтения, откаты, телепатия и кража.
// Правила и каталог — shared/magic.js; всё проверяет сервер (server/magic.js), клиент только показывает и просит.
// P — книга заклинаний; X — украсть (скопировать) заклинание у мага под курсором; клавиша 1–0 с заклинанием — прочитать:
// во врага под курсором (или выбранную цель), в точку курсора, на себя; союзнику — если он под курсором.
import { iconUrl } from '../icons.js';
import { autoSpellUsable } from './auto-combat.js';
const Mg = () => window.Magic;
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let st = null;

export function magicAttach(api) {
  resetMagicFields();
  // api: { send, toast, you, character(), target(), mouse(), others(), hero(), invSend(a) }
  st = { api, spells: [], cds: {}, gcdUntil: 0, casting: null, buffs: {}, near: [], asks: [], power: 0, stealUntil: 0, open: false, key: '' };
  const win = $('#spell-window');
  win.onclick = onClick;
  win.onchange = onChange;
  $('#btn-spells').onclick = () => magicToggle();
}
export function magicDetach() { resetMagicFields(); st = null; magicToggle(false); const b = $('#cast-bar'); if (b) b.classList.add('hidden'); }
// Попутный ветер ускоряет — клиент предсказывает движение с тем же множителем, что и сервер
export const magicSpeedMul = () => { const h = Mg() && Mg().get('haste'); return st && h && st.buffs.speed > performance.now() ? h.speed : 1; };
export function magicViewRange(){
  if(!st||!Mg())return 0;
  return Math.max(0,...st.spells.map(id=>{const spell=Mg().get(id);return spell?Math.max(Number(spell.range)||0,spell.target==='around'?Number(spell.radius)||0:0):0;}));
}
export const magicIsOpen = () => Boolean(st && st.open);

// Сообщения сервера: true — обработано
export function magicOnMessage(msg) {
  if (!st) return false;
  const now = performance.now();
  switch (msg.t) {
    case 'magic-field':magicFieldMessage(msg);return true;
    case 'magic':
      st.instant = Boolean(msg.instant); st.spells = msg.spells || []; st.power = msg.power || 0; st.near = msg.near || []; st.asks = msg.asks || [];
      st.cds = Object.fromEntries(Object.entries(msg.cds || {}).map(([k, v]) => [k, now + v]));
      st.gcdUntil = now + (msg.gcd || 0);
      st.casting = msg.casting ? { spell: msg.casting.spell, total: msg.casting.total, until: now + msg.casting.left } : null;
      st.buffs = Object.fromEntries(Object.entries(msg.buffs || {}).map(([k, v]) => [k, k === 'shield' ? v : now + v]));
      st.api.hero().frozenUntil=now+(msg.buffs?.frozen||0);
      st.stealUntil = now + (msg.steal || 0);
      render();
      return true;
    case 'magic-learn': {
      const s = Mg().get(msg.spell);
      const how = { book: 'из свитка', telepathy: 'телепатией', teach: 'от другого мага', steal: 'украдено у мага', kill: 'сила убитого мага', mage: 'от наставника' }[msg.how] || '';
      if (s) st.api.toast(`Новое заклинание: ${s.name}${how ? ` (${how})` : ''}. Книга — P.`, 3200);
      return true;
    }
    case 'magic-steal':
      st.api.toast(msg.ok ? 'Заклинание скопировано!' : `Кража не удалась (шанс ${Math.round(msg.chance * 100)}%)`, 2600);
      return true;
    case 'cast-reject': st.api.toast(msg.message, 2600); return true;
    default: return false;
  }
}

// Прочитать заклинание: цель по виду заклинания
export function magicCast(id) {
  if (!st) return;
  const s = Mg().get(id);
  if (!s) return;
  const m = st.api.mouse(), t = st.api.target();
  const msg = { t: 'cast', spell: id };
  if (s.target === 'enemy') { if (t && t.id) msg.target = t.id; if (m) { msg.x = m.x; msg.y = m.y; } }
  else if (s.target === 'point' && m) { msg.x = m.x; msg.y = m.y; }
  else if (s.target === 'ally' && m) { // союзник под курсором, иначе — на себя
    for (const [pid, o] of st.api.others()) if (Math.hypot(o.x - m.x, o.y - m.y) < 0.8) { msg.target = pid; break; }
  }
  st.api.send(msg);
}

// Панель 1–0 задаёт список разрешённых заклинаний. Откаты/мана проверяются до запроса.
export function magicAutoCast(target,now) {
  if(!st||st.gcdUntil>now||st.casting&&st.casting.until>now)return false;
  const ch=st.api.character(),hero=st.api.hero();
  if(hero.dead||hero.stunUntil>now)return false;
  const M=Mg(),known=new Set(st.spells),bar=ch.inventory.hotbar||[];
  const maxHp=window.CharacterRules.derive(ch.stats,ch.level).maxHp;
  const start=st.autoCursor||0;
  for(let n=0;n<bar.length;n++){
    const index=(start+n)%bar.length,id=M.fromHotbar(bar[index]),spell=id&&M.get(id);
    if(!spell||!known.has(id)||!autoSpellUsable(spell,hero,target,ch.vitals,maxHp,st,now))continue;
    const msg={t:'cast',spell:id};
    if(spell.target==='enemy'){msg.target=target.id;msg.x=target.x;msg.y=target.y;}
    else if(spell.target==='point'){msg.x=target.x;msg.y=target.y;}
    // Лечение/защита в режиме автобоя направлены на самого героя.
    st.api.send(msg);
    st.gcdUntil=now+(st.instant?150:Math.max(450,spell.cast*1000+150));
    st.cds[id]=st.instant?0:now+spell.cd*1000;
    if(spell.cast>0&&!st.instant){hero.castAt=now;hero.castUntil=now+spell.cast*1000;}
    st.autoCursor=(index+1)%bar.length;
    if(target)hero.attackAngle=Math.atan2(target.y-hero.y,target.x-hero.x);
    return true;
  }
  return false;
}
export function magicKey(e) {
  if (!st) return false;
  if (e.code === 'KeyP') { e.preventDefault(); magicToggle(); return true; }
  if (e.code === 'KeyX') {
    e.preventDefault();
    const t = st.api.target();
    if (!t || !t.def || !t.def.spells) { st.api.toast('Наведите курсор на мага (врага, владеющего магией), чтобы украсть заклинание.'); return true; }
    st.api.send({ t: 'magic', a: 'steal', target: t.id });
    return true;
  }
  if (e.code === 'Escape' && st.open) { magicToggle(false); return true; }
  return false;
}
export function magicToggle(force) {
  if (!st) return;
  st.open = force === undefined ? !st.open : force;
  $('#spell-window').classList.toggle('hidden', !st.open);
  st.key = '';
  render();
}

// Подсказка к заклинанию (панель 1–0 и книга)
export function spellTip(id, ch) {
  const s = Mg().get(id);
  if (!s) return '';
  const sc = Mg().SCHOOLS[s.school];
  return `<b style="color:${sc.color}">${esc(s.name)}</b><div class="small">${esc(s.desc)}</div>` + Mg().describe(s, ch).map((l) => `<div class="small muted">${esc(l)}</div>`).join('');
}
// Иконка заклинания — руна цвета школы
export function spellIcon(id) {
  const s = Mg().get(id);
  const sc = s ? Mg().SCHOOLS[s.school] : { color: '#888888' };
  return iconUrl({ id: 'spell:' + id, icon: { shape: 'rune', color: sc.color, color2: '#ffffff' } });
}

// Каждый кадр: откаты на панели 1–0, полоса чтения
export function magicFrame(now) {
  if (!st) return;
  for (const el of document.querySelectorAll('#hotbar .slot[data-spell]')) {
    const id = el.dataset.spell, until = Math.max(st.cds[id] || 0, st.gcdUntil), s = Mg().get(id);
    let cd = el.querySelector('.slot-cd');
    if (!cd) { cd = document.createElement('span'); cd.className = 'slot-cd'; el.appendChild(cd); }
    const left = until - now, frac = s && left > 0 ? Math.min(1, left / Math.max(1, (st.cds[id] > now ? s.cd : 0.4) * 1000)) : 0;
    cd.style.height = Math.round(frac * 100) + '%';
    cd.textContent = left > 1000 ? Math.ceil(left / 1000) : '';
  }
  const bar = $('#cast-bar');
  if (st.casting && st.casting.until > now) {
    const s = Mg().get(st.casting.spell);
    bar.classList.remove('hidden');
    bar.querySelector('.fill').style.width = Math.round((1 - (st.casting.until - now) / st.casting.total) * 100) + '%';
    bar.querySelector('.fill').style.background = s ? Mg().SCHOOLS[s.school].color : '#c07aff';
    bar.querySelector('.lbl').textContent = s ? s.name : '';
  } else bar.classList.add('hidden');
}

// ---------- Книга заклинаний ----------
function render() {
  if (!st || !st.open) return;
  const ch = st.api.character();
  const key = JSON.stringify([st.spells, st.near, st.asks, st.power, ch.inventory.hotbar, ch.stats]);
  if (key === st.key) return;
  st.key = key;
  const M = Mg();
  const parts = [`<div class="inv-head"><b title="Изученные заклинания. Учатся свитками и книгами, телепатией у игроков рядом, передачей от другого мага, кражей у живого мага (X) и в дар от убитого мага">Книга заклинаний</b><button type="button" class="btn small" data-a="close" title="Закрыть (P или Esc)">✕</button></div>`];
  parts.push(`<div class="small muted">Мана тратится при чтении и восполняется со временем, быстрее — на отдыхе (Z). Сила заклинаний растёт с уровнем, статом школы и силой убитых магов${st.power ? ` (сейчас +${Math.round(st.power * (M.settings.magicPowerPerPoint || 0) * 100)}%)` : ''}.</div>`);
  if (!st.spells.length) parts.push('<div class="muted">Вы пока не знаете ни одного заклинания. Свитки и книги выпадают у магов; украсть заклинание у живого мага — X рядом с ним.</div>');
  const bound = (id) => { const i = ch.inventory.hotbar.indexOf(M.hotbarKey(id)); return i < 0 ? '' : String((i + 1) % 10); };
  for (const [sid, sc] of Object.entries(M.SCHOOLS)) {
    const mine = M.bySchool(sid).filter((s) => st.spells.includes(s.id));
    if (!mine.length) continue;
    parts.push(`<div class="craft-group"><b style="color:${sc.color}" title="${esc(sc.desc)} Сродство: ${esc(M.STAT_NAMES[sc.stat] || sc.stat)}">${esc(sc.name)}</b>`);
    for (const s of mine) {
      const opts = ['<option value="">—</option>', ...Array.from({ length: 10 }, (_, i) => { const k = String((i + 1) % 10); return `<option value="${i}"${bound(s.id) === k ? ' selected' : ''}>${k}</option>`; })].join('');
      parts.push(`<div class="spell-row" data-help="spell:${s.id}" title="${esc(M.describe(s, ch).join('\n'))}"><img src="${spellIcon(s.id)}" alt=""><span><b>${esc(s.name)}</b> <span class="muted small">${M.TIERS[s.tier].name.toLowerCase()} · ${s.mp} маны · ${s.cd} с</span><br><span class="small muted">${esc(s.desc)}</span></span>`
        + `<span class="spell-acts"><button type="button" class="btn small" data-a="cast" data-id="${s.id}" title="Прочитать (цель — под курсором или выбранный враг)">✦</button><select data-a="bind" data-id="${s.id}" title="Клавиша панели 1–0">${opts}</select><button type="button" class="btn small" data-a="forget" data-id="${s.id}" title="Забыть заклинание">✕</button></span></div>`);
    }
    parts.push('</div>');
  }
  // телепатия и передача
  if (st.asks.length) {
    parts.push('<div class="craft-group"><b title="Игроки рядом просят научить их телепатией: разрешите — ученик тратит свою ману">Просьбы научить</b>');
    for (const a of st.asks) parts.push(`<div class="craft-q"><span>${esc(a.name)}: ${esc((M.get(a.spell) || {}).name || a.spell)}</span><button type="button" class="btn small" data-a="allow" data-from="${esc(a.from)}" data-id="${a.spell}">Разрешить</button><button type="button" class="btn small" data-a="deny" data-from="${esc(a.from)}" data-id="${a.spell}">Нет</button></div>`);
    parts.push('</div>');
  }
  if (st.near.length) {
    parts.push(`<div class="craft-group"><b title="Игроки не дальше ${M.settings.magicTelepathyRange} клеток. Попросить — телепатия (вы платите ${M.settings.magicTelepathyMpCost} маны, учитель разрешает). Научить — передача (вы платите ${M.settings.magicTeachMpCost} маны)">Маги рядом</b>`);
    for (const p of st.near) {
      const theirs = p.spells.filter((id) => !st.spells.includes(id)), mineOnly = st.spells.filter((id) => !p.spells.includes(id));
      parts.push(`<div class="small"><b>${esc(p.name)}</b></div>`);
      if (theirs.length) parts.push(`<div class="craft-q"><span class="small">Попросить:</span><select data-a="askSel" data-from="${esc(p.id)}">${theirs.map((id) => `<option value="${id}">${esc(M.get(id).name)}</option>`).join('')}</select><button type="button" class="btn small" data-a="ask" data-from="${esc(p.id)}">Телепатия</button></div>`);
      if (mineOnly.length) parts.push(`<div class="craft-q"><span class="small">Научить:</span><select data-a="teachSel" data-to="${esc(p.id)}">${mineOnly.map((id) => `<option value="${id}">${esc(M.get(id).name)}</option>`).join('')}</select><button type="button" class="btn small" data-a="teach" data-to="${esc(p.id)}">Передать</button></div>`);
      if (!theirs.length && !mineOnly.length) parts.push('<div class="small muted">Знаете одно и то же.</div>');
    }
    parts.push('</div>');
  }
  replacePanelHtml($('#spell-window'),parts.join(''));
}
function onClick(ev) {
  const b = ev.target.closest('button[data-a]');
  if (!b || !st) return;
  const a = b.dataset.a, id = b.dataset.id;
  if (a === 'close') magicToggle(false);
  else if (a === 'cast') magicCast(id);
  else if (a === 'forget') { if (confirm(`Забыть заклинание «${Mg().get(id).name}»?`)) st.api.send({ t: 'magic', a: 'forget', spell: id }); }
  else if (a === 'allow' || a === 'deny') st.api.send({ t: 'magic', a, from: b.dataset.from, spell: id });
  else if (a === 'ask') { const sel = b.parentElement.querySelector('select'); st.api.send({ t: 'magic', a: 'ask', from: b.dataset.from, spell: sel.value }); }
  else if (a === 'teach') { const sel = b.parentElement.querySelector('select'); st.api.send({ t: 'magic', a: 'teach', to: b.dataset.to, spell: sel.value }); }
}
function onChange(ev) {
  const el = ev.target;
  if (!st || el.dataset.a !== 'bind') return;
  const ch = st.api.character(), key = Mg().hotbarKey(el.dataset.id);
  const old = ch.inventory.hotbar.indexOf(key);
  if (old >= 0) st.api.invSend({ type: 'hotbar', key: old, item: null });
  if (el.value !== '') st.api.invSend({ type: 'hotbar', key: Number(el.value), item: key });
}
