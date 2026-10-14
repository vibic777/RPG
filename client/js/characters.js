// Экраны «Персонажи» и «Создание персонажа».
import { Api } from './api.js';
import { drawCharacter } from './preview.js';
import { GROUP_HINTS, optionHint } from './hints.js';
import { openWorlds } from './worlds.js';

const R = window.CharacterRules;
const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const c of children) e.append(c);
  return e;
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let show = () => {};
let characters = [];

export function initCharacters(showScreen) {
  show = showScreen;
  $('#btn-new-character').addEventListener('click', openCreate);
  $('#btn-import-character').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', importFromFile);
  $('#btn-create-back').addEventListener('click', openList);
  $('#btn-create-random').addEventListener('click', () => { randomizeAppearance(); renderCreate(); });
  $('#btn-stats-reset').addEventListener('click', () => { resetStats(); renderCreate(); });
  $('#create-form').addEventListener('submit', submitCreate);
  $('#create-name').addEventListener('input', () => { draft.name = $('#create-name').value; });
}

// ---------- Список ----------

export async function openList() {
  show('screen-characters');
  const box = $('#character-list');
  box.textContent = 'Загрузка...';
  try {
    characters = (await Api.listCharacters()).characters;
  } catch (err) {
    box.textContent = err.message;
    return;
  }
  renderList();
}

function renderList() {
  const box = $('#character-list');
  box.textContent = '';
  if (!characters.length) box.append(el('p', { className: 'muted', textContent: 'У вас пока нет персонажей. Создайте первого героя!' }));
  for (const c of characters) {
    const canvas = el('canvas', { width: 120, height: 200, className: 'card-preview' });
    drawCharacter(canvas, c.appearance, { look: window.Inventory.look(c) });
    const top = R.STATS.slice().sort((a, b) => c.stats[b.id] - c.stats[a.id]).slice(0, 3)
      .map((s) => `${s.label} ${c.stats[s.id]}`).join(', ');
    const play = el('button', { type: 'button', className: 'btn primary auto', textContent: 'Играть',
      title: 'Выбрать или создать мир и войти в него этим героем' });
    play.addEventListener('click', () => openWorlds(c));
    const del = el('button', { type: 'button', className: 'btn danger', textContent: 'Удалить',
      title: 'Удалить персонажа навсегда' });
    del.addEventListener('click', () => removeCharacter(c));
    const save = el('button', { type: 'button', className: 'btn', textContent: 'В файл',
      title: 'Скачать героя файлом JSON (резервная копия или перенос). Файл подписан сервером: изменённый файл вернёт только имя и внешность.' });
    save.addEventListener('click', () => exportToFile(c));
    box.append(el('div', { className: 'card' }, canvas,
      el('div', { className: 'card-body' },
        el('div', { className: 'card-name', textContent: c.name }),
        el('div', { className: 'muted', textContent: `Уровень ${c.level} · ${R.APPEARANCE.gender.find((g) => g.id === c.appearance.gender).label}` }),
        el('div', { className: 'card-stats', textContent: top }),
        el('div', { className: 'card-actions' }, play, save, del))));
  }
  const full = characters.length >= R.MAX_CHARACTERS;
  $('#btn-new-character').disabled = full;
  $('#btn-new-character').title = full ? `Не больше ${R.MAX_CHARACTERS} персонажей` : 'Создать нового героя';
  $('#btn-import-character').disabled = full;
}

// ---------- Файл героя ----------

async function exportToFile(c) {
  try {
    const data = await Api.exportCharacter(c.id);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${c.name.replace(/[^A-Za-zА-Яа-яЁё0-9 _-]/g, '_')}-ур${c.level}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (err) {
    alert(err.message);
  }
}

async function importFromFile(e) {
  const input = e.target;
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return;
  let file;
  try { file = JSON.parse(await f.text()); } catch { return alert('Это не файл героя: не удалось прочитать JSON.'); }
  let name;
  for (;;) {
    try {
      const r = await Api.importCharacter(file, name);
      alert(r.message);
      return openList();
    } catch (err) {
      if (err.status === 409 && err.data && err.data.nameTaken) {
        name = prompt(`${err.message}\nНовое имя героя:`, (name || (file.character && file.character.name) || '') + ' 2');
        if (name) continue;
        return;
      }
      return alert(err.message);
    }
  }
}

async function removeCharacter(c) {
  if (!confirm(`Удалить персонажа «${c.name}»? Это действие нельзя отменить.`)) return;
  try {
    await Api.deleteCharacter(c.id);
    characters = characters.filter((x) => x.id !== c.id);
    renderList();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Создание ----------

const draft = { name: '', appearance: {}, stats: {} };

function randomizeAppearance() {
  const a = draft.appearance;
  for (const key of R.SINGLE) if (key !== 'gender' || !a.gender) a[key] = pick(R.APPEARANCE[key]).id;
  for (const key of Object.keys(R.MULTI_LIMITS)) {
    a[key] = R.APPEARANCE[key].filter(() => Math.random() < 0.2).slice(0, R.MULTI_LIMITS[key]).map((o) => o.id);
  }
}

function resetStats() {
  for (const s of R.STATS) draft.stats[s.id] = R.STAT_MIN;
}

function pointsLeft() {
  return R.START_POINTS - R.STATS.reduce((sum, s) => sum + draft.stats[s.id] - R.STAT_MIN, 0);
}

function openCreate() {
  draft.name = '';
  draft.appearance = {};
  randomizeAppearance();
  Object.assign(draft.appearance, { scars: [], tattoos: [], implants: [] });
  resetStats();
  $('#create-name').value = '';
  $('#create-error').textContent = '';
  buildOptions();
  renderCreate();
  show('screen-create');
  $('#create-name').focus();
}

function buildOptions() {
  const box = $('#appearance-options');
  box.textContent = '';
  const groups = [...R.SINGLE, ...Object.keys(R.MULTI_LIMITS)];
  for (const key of groups) {
    const multi = key in R.MULTI_LIMITS;
    const title = R.GROUP_LABELS[key] + (multi ? ` (до ${R.MULTI_LIMITS[key]})` : '');
    const row = el('div', { className: 'opt-group' }, el('div', { className: 'opt-label', textContent: title, title: GROUP_HINTS[key] || '' }));
    const chips = el('div', { className: 'chips' });
    for (const o of R.APPEARANCE[key]) {
      const chip = el('button', { type: 'button', className: 'chip' + (o.color ? ' swatch' : ''), title: optionHint(key, o) });
      chip.dataset.group = key;
      chip.dataset.id = o.id;
      if (o.color) chip.style.setProperty('--sw', o.color);
      else chip.textContent = o.label;
      chip.addEventListener('click', () => toggleOption(key, o.id));
      chips.append(chip);
    }
    row.append(chips);
    box.append(row);
  }
  const statsBox = $('#stat-rows');
  statsBox.textContent = '';
  for (const s of R.STATS) {
    const minus = el('button', { type: 'button', className: 'btn small', textContent: '−', title: 'Убрать очко' });
    const plus = el('button', { type: 'button', className: 'btn small', textContent: '+', title: 'Добавить очко' });
    minus.addEventListener('click', () => changeStat(s.id, -1));
    plus.addEventListener('click', () => changeStat(s.id, +1));
    const value = el('span', { className: 'stat-value' });
    value.dataset.stat = s.id;
    statsBox.append(el('div', { className: 'stat-row', title: `${s.label}: ${s.desc}` },
      el('span', { className: 'stat-name', textContent: s.label }), minus, value, plus));
  }
}

function toggleOption(key, id) {
  const a = draft.appearance;
  if (key in R.MULTI_LIMITS) {
    const list = a[key];
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else if (list.length < R.MULTI_LIMITS[key]) list.push(id);
  } else {
    a[key] = id;
  }
  renderCreate();
}

function changeStat(id, delta) {
  const v = draft.stats[id] + delta;
  if (v < R.STAT_MIN || v > R.statCap(id, true)) return;
  if (delta > 0 && pointsLeft() <= 0) return;
  draft.stats[id] = v;
  renderCreate();
}

function renderCreate() {
  const a = draft.appearance;
  document.querySelectorAll('#appearance-options .chip').forEach((c) => {
    const v = a[c.dataset.group];
    c.classList.toggle('active', Array.isArray(v) ? v.includes(c.dataset.id) : v === c.dataset.id);
  });
  const left = pointsLeft();
  document.querySelectorAll('.stat-value').forEach((v) => { v.textContent = draft.stats[v.dataset.stat]; });
  document.querySelectorAll('.stat-row').forEach((row, i) => {
    const s = R.STATS[i];
    const [minus, plus] = row.querySelectorAll('button');
    minus.disabled = draft.stats[s.id] <= R.STAT_MIN;
    plus.disabled = left <= 0 || draft.stats[s.id] >= R.statCap(s.id, true);
  });
  $('#points-left').textContent = left;
  const d = R.derive(draft.stats);
  $('#derived').textContent = `Здоровье ${d.maxHp} · Выносливость ${d.maxStamina} · Мана ${d.maxMp}`;
  drawCharacter($('#create-preview'), a);
}

async function submitCreate(e) {
  e.preventDefault();
  const err = $('#create-error');
  err.textContent = '';
  const res = R.validateNew(draft); // та же проверка, что и на сервере
  if (!res.ok) { err.textContent = res.errors.join('\n'); return; }
  const btn = $('#btn-create-submit');
  btn.disabled = true;
  try {
    await Api.createCharacter(res.value);
    await openList();
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
  }
}
