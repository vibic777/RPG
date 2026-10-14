// Окно персонажа (C или 📊): характеристики и вложение очков за уровни, производные показатели, опыт, смерти.
// Экран смерти: какая характеристика потеряна, отсчёт до возрождения, кнопка «Возродиться».
const R = window.CharacterRules;
const Cb = window.Combat;
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => `${Math.round(v * 100)}%`;

let ctx = null; // { getCharacter, getMe, send }
let deathTimer = null;

export function initStatsUi() {
  $('#btn-stats').addEventListener('click', () => statsToggle());
  $('#btn-stats-close').addEventListener('click', () => statsToggle(false));
  $('#stats-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-alloc]');
    if (b && ctx) ctx.send({ t: 'alloc', stat: b.dataset.alloc });
  });
  $('#btn-respawn').addEventListener('click', () => { if (ctx) ctx.send({ t: 'respawn' }); });
}

export function statsAttach(api) { ctx = api; statsRender(); }
export function statsDetach() { ctx = null; statsToggle(false); hideDeath(); }
export const statsIsOpen = () => !$('#stats-window').classList.contains('hidden');

export function statsToggle(force) {
  const win = $('#stats-window');
  const open = force === undefined ? win.classList.contains('hidden') : force;
  win.classList.toggle('hidden', !open);
  $('#btn-stats').classList.toggle('active', open);
  if (open) statsRender();
}

// Значок «есть очки» и содержимое окна (если открыто)
export function statsRender() {
  if (!ctx) return;
  const ch = ctx.getCharacter(), me = ctx.getMe() || {};
  const pts = me.pts ?? ch.unspentPoints ?? 0;
  const badge = $('#stats-badge');
  badge.textContent = pts;
  badge.classList.toggle('hidden', !pts);
  $('#btn-stats').title = `Персонаж: характеристики, опыт, смерти (C)${pts ? ` — не вложено очков: ${pts}` : ''}`;
  if (!statsIsOpen()) return;
  const lvl = me.lvl || ch.level || 1, d = R.derive(ch.stats, lvl), s = window.GameSettings || {};
  const statsRows = R.STATS.map((st) => `<tr title="${esc(st.desc)}">
      <td>${st.label}</td><td class="num">${ch.stats[st.id]}</td>
      <td>${pts && ch.stats[st.id] < R.statCap(st.id, false) ? `<button type="button" class="btn small" data-alloc="${st.id}" title="Вложить очко в «${st.label}»">+</button>` : ''}</td></tr>`).join('');
  const xpNext = me.next || Cb.xpToNext(lvl);
  const crit = Cb.critChance(ch.stats);
  const def = Cb.heroDefense(ch);
  const res = Object.entries(def.resist).map(([k, v]) => `${window.Items.DAMAGE_TYPES[k]} ${pct(v)}`).join(', ') || 'нет';
  $('#stats-body').innerHTML = `
    <div class="stats-head"><b>${esc(ch.name)}</b> · уровень ${lvl}${lvl >= (s.maxLevel || Infinity) ? ' (предел)' : ''}</div>
    <div class="bar-hud xp" title="Опыт до следующего уровня"><div class="fill" style="width:${Math.min(100, ((me.xp || 0) / xpNext) * 100)}%"></div><span class="lbl">Опыт</span><span class="val">${me.xp || 0} / ${xpNext}</span></div>
    <p class="${pts ? 'ok' : 'muted'} small">${pts ? `Свободных очков: <b>${pts}</b> — нажмите «+» у характеристики.` : `Очки характеристик даются за каждый новый уровень (${s.statPointsPerLevel ?? 3} за уровень).`}</p>
    <table class="stats-table">${statsRows}</table>
    <table class="stats-table derived">
      <tr title="Растёт с Силой и уровнем"><td>Здоровье</td><td class="num">${me.hp ?? '—'} / ${d.maxHp}</td></tr>
      <tr title="Растёт с Силой и Скрытностью; тратится на удары и бег"><td>Выносливость</td><td class="num">${me.st ?? '—'} / ${d.maxStamina}</td></tr>
      <tr title="Растёт с Магией и Интеллектом"><td>Мана</td><td class="num">${me.mp ?? '—'} / ${d.maxMp}</td></tr>
      <tr title="Шанс крита растёт со Скрытностью; крит умножает урон"><td>Критический удар</td><td class="num">${pct(crit)} · ×${Cb.settings.critMultiplier}</td></tr>
      <tr title="Бонус урона ближнего боя от Силы"><td>Урон в ближнем бою</td><td class="num">+${pct(ch.stats.strength * Cb.settings.meleeBonusPerStrength)}</td></tr>
      <tr title="Сумма брони надетых вещей (сломанные не считаются)"><td>Защита</td><td class="num">${def.defense}</td></tr>
      <tr title="Сопротивления типам урона от надетых вещей"><td>Сопротивления</td><td class="num">${res}</td></tr>
      <tr title="Сколько раз герой погибал. Каждая смерть отнимает 1 очко случайной характеристики"><td>Смертей</td><td class="num">${me.deaths ?? ch.deaths ?? 0}</td></tr>
    </table>`;
}

// ---------- Смерть ----------

export function showDeath(msg) {
  const box = $('#death-overlay');
  $('#death-cause').textContent = msg.by ? `Причина: ${msg.by}.` : '';
  $('#death-stat').innerHTML = msg.statLabel
    ? `Потеряно очко характеристики: <b>${esc(msg.statLabel)}</b> (теперь ${msg.stats[msg.stat]}).`
    : 'Все характеристики уже на минимуме (1) — на этот раз ничего не потеряно.';
  $('#death-count').textContent = `Смертей всего: ${msg.deaths}.`;
  if (msg.hardcore) $('#death-count').textContent += ' Хардкор: при возрождении прогресс сбросится, герой начнёт заново.';
  const until = performance.now() + (msg.respawnIn || 0);
  const btn = $('#btn-respawn');
  const tickFn = () => {
    const left = Math.ceil((until - performance.now()) / 1000);
    btn.disabled = left > 0;
    btn.textContent = left > 0 ? `Возродиться (${left})` : 'Возродиться';
  };
  clearInterval(deathTimer);
  tickFn();
  deathTimer = setInterval(tickFn, 250);
  box.classList.remove('hidden');
}

export function hideDeath() {
  clearInterval(deathTimer);
  deathTimer = null;
  $('#death-overlay').classList.add('hidden');
}
export const deathShown = () => !$('#death-overlay').classList.contains('hidden');
