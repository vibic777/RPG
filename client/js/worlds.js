// Экран «Миры»: свои и чужие миры, совместный доступ (открыт/закрыт, код приглашения), генератор нового мира.
import { Api } from './api.js';
import { enterGame } from './game/game.js';

const G = window.WorldGen;
const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const c of children) e.append(c);
  return e;
};

let show = () => {};
let backToList = () => {};
let character = null;
let worlds = [];

export function initWorlds(showScreen, onBack) {
  show = showScreen;
  backToList = onBack;
  $('#btn-worlds-back').addEventListener('click', () => backToList());
  $('#btn-seed-random').addEventListener('click', () => { $('#world-seed').value = G.randomSeed(); });
  $('#world-form').addEventListener('submit', submitWorld);
  $('#world-dragons').addEventListener('input', () => { $('#world-dragons-value').textContent = $('#world-dragons').value; });
  $('#join-form').addEventListener('submit', submitJoin);
}

function fillSelect(select, options, selected) {
  select.textContent = '';
  for (const o of options) select.append(el('option', { value: o.id, textContent: o.label, selected: o.id === selected }));
}

function resetForm() {
  const f = $('#world-form');
  f.reset();
  $('#world-seed').value = G.randomSeed();
  $('#world-name').value = '';
  const sizes = Object.entries(G.settings.worldSizes).map(([id, n]) => ({ id, label: `${G.SIZE_LABELS[id] || id} (${n}×${n})` }));
  fillSelect($('#world-size'), sizes, 'medium');
  fillSelect($('#world-shape'), G.MAP_SHAPES, 'square');
  fillSelect($('#world-water'), G.WATER_MODES, 'auto');
  fillSelect($('#world-difficulty'),window.Difficulty.MODES.map(x=>({id:x.id,label:x.label})), 'super_easy');
  fillSelect($('#world-enemies'), G.ENEMY_DENSITY, 'normal');
  fillSelect($('#world-hordes'), G.HORDE_FREQUENCY, 'normal');
  fillSelect($('#world-survival-diff'), G.SURVIVAL_DIFFICULTY, 'normal');
  const d = $('#world-dragons');
  d.max = G.settings.maxDragons;
  d.value = Math.min(4, G.settings.maxDragons);
  $('#world-dragons-value').textContent = d.value;
  $('#world-error').textContent = '';
}

export async function openWorlds(ch) {
  character = ch;
  $('#worlds-character').textContent = ch.name;
  resetForm();
  show('screen-worlds');
  await refresh();
}

async function refresh() {
  const box = $('#world-list');
  box.textContent = 'Загрузка...';
  try {
    const [w, c] = await Promise.all([Api.listWorlds(), Api.getCharacter(character.id)]);
    worlds = w.worlds;
    character = c.character; // свежие позиции героя по мирам
    // «Новая игра+» — только герою с концовкой
    const ng = Array.isArray(character.endings) && character.endings.length > 0;
    $('#world-ngplus-row').classList.toggle('hidden', !ng);
    if (!ng) $('#world-ngplus').checked = false;
  } catch (err) {
    box.textContent = err.message;
    return;
  }
  renderList();
}

const labelOf = (list, id) => (list.find((o) => o.id === id) || { label: id }).label;

async function copyText(btn, text, label) {
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Скопировано'; } catch { prompt('Скопируйте:', text); }
  setTimeout(() => { btn.textContent = label; }, 1500);
}

function button(text, title, onClick, className = 'btn small') {
  const b = el('button', { type: 'button', className, textContent: text, title });
  b.addEventListener('click', onClick);
  return b;
}

// Блок совместного доступа для владельца: открыт/закрыт и код приглашения
function shareBlock(w) {
  const toggle = button(w.open ? 'Закрыть мир' : 'Открыть мир',
    w.open ? 'Закрыть мир: другие игроки не смогут войти, текущие гости будут отключены' : 'Открыть мир: участники и игроки с кодом смогут войти',
    () => share(w, { open: !w.open }));
  const parts = [el('div', {}, el('span', { className: 'badge ' + (w.open ? 'open' : 'closed'), textContent: w.open ? '🌐 открыт' : '🔒 закрыт',
    title: w.open ? 'Мир открыт: в него могут войти участники (до ' + w.maxPlayers + ' игроков одновременно)' : 'Мир закрыт: войти можете только вы' }), ' ', toggle)];
  if (w.inviteCode) {
    const copy = button('Копировать', 'Скопировать код приглашения и отправить другу', () => copyText(copy, w.inviteCode, 'Копировать'));
    parts.push(el('div', { className: 'invite' }, 'Код приглашения: ', el('code', { className: 'invite-code', textContent: w.inviteCode, title: 'Друг вводит этот код в поле «Присоединиться по коду»' }), ' ', copy, ' ',
      button('Новый код', 'Создать другой код; старый перестанет работать (уже присоединившиеся останутся)', () => share(w, { invite: 'new' })), ' ',
      button('Убрать код', 'Отключить приглашение по коду', () => share(w, { invite: 'remove' }))));
  } else {
    parts.push(el('div', { className: 'invite' }, button('Создать код приглашения', 'Код, по которому друзья смогут присоединиться к этому миру', () => share(w, { invite: 'new' }))));
  }
  if (w.members.length) {
    parts.push(el('div', { className: 'small muted', textContent: 'Участники: ' + w.members.map((m) => m.username).join(', '), title: 'Игроки, присоединившиеся по коду' }));
  }
  return el('div', { className: 'share small' }, ...parts);
}

function renderList() {
  const box = $('#world-list');
  box.textContent = '';
  if (!worlds.length) box.append(el('p', { className: 'muted', textContent: 'Миров пока нет — создайте первый справа или присоединитесь по коду.' }));
  for (const w of worlds) {
    const visited = character.positions && character.positions[w.id];
    const locked = !w.own && !w.open;
    const enter = el('button', { type: 'button', className: 'btn primary auto', textContent: visited ? 'Продолжить' : 'Войти', disabled: locked,
      title: locked ? 'Мир закрыт владельцем — войти нельзя, пока он его не откроет' : visited ? 'Вернуться туда, где герой был в прошлый раз' : 'Войти в мир в точке появления' });
    enter.addEventListener('click', () => enterGame(character, w, { onExit: () => openWorlds(character) }));
    const actions = [enter];
    if (w.own) actions.push(button('Начать сюжет заново', 'Сбросить сюжетную линию этого мира перед входом. Герой, вещи, характеристики и компаньоны сохранятся; общий прогресс сюжета сбросится у всех игроков мира.', () => resetStory(w), 'btn'));
    if (w.own) actions.push(button('Удалить', 'Удалить мир навсегда (персонажи останутся)', () => removeWorld(w), 'btn danger'));
    else actions.push(button('Покинуть', 'Убрать чужой мир из списка. Вернуться можно будет по коду приглашения', () => leaveWorld(w), 'btn'));
    const copy = button('Копировать', 'Скопировать сид, чтобы поделиться: мир с тем же сидом и размером будет таким же', () => copyText(copy, w.seed, 'Копировать'));
    const title = el('div', { className: 'card-name', textContent: w.name });
    if (!w.own) title.append(' ', el('span', { className: 'badge foreign', textContent: 'чужой мир', title: `Владелец: ${w.ownerName}. Вы присоединились по коду приглашения` }));
    box.append(el('div', { className: 'world-card' + (w.own ? '' : ' foreign') },
      title,
      w.own ? '' : el('div', { className: 'small muted', textContent: `Владелец: ${w.ownerName}` + (w.open ? '' : ' · мир закрыт') }),
      el('div', { className: 'small' }, 'Сид: ', el('code', { textContent: w.seed }), ' ', copy),
      el('div', { className: 'small muted', textContent:
        `Сложность: ${window.Difficulty.get(w.difficulty).label} · ${G.SIZE_LABELS[w.size] || w.size} ${w.width}×${w.height} · ${labelOf(G.MAP_SHAPES, w.shape || 'square').toLowerCase()}${w.waterMode?' · '+labelOf(G.WATER_MODES,w.waterMode).toLowerCase():''} · враги: ${labelOf(G.ENEMY_DENSITY, w.enemyDensity).toLowerCase()} · ` +
        `орды: ${labelOf(G.HORDE_FREQUENCY, w.hordeFrequency).toLowerCase()} · драконов: ${w.dragons}` +
        (w.scaleToLevel ? ' · под уровень героя' : '') +
        (w.survival === false ? ' · без выживания' : ` · выживание: ${labelOf(G.SURVIVAL_DIFFICULTY, w.survivalDifficulty || 'normal').toLowerCase()}`) + (w.ngPlus ? ` · «Новая игра+» (${w.ngPlus.characterName})` : '') }),
      el('div', { className: 'small', textContent: `Сейчас в мире: ${w.online || 0} / ${w.maxPlayers}`, title: 'Игроков в мире прямо сейчас и предел одновременных игроков' }),
      w.own ? shareBlock(w) : '',
      el('div', { className: 'card-actions' }, ...actions)));
  }
}

async function resetStory(w) {
  const accepted = confirm(`Начать сюжет мира «${w.name}» заново?\n\nСюжетный прогресс сбросится для всех участников этого мира, а текущие сюжетные задания отменятся. Побочные задания, герой, уровень, экипировка, инвентарь и компаньоны сохранятся. Уже открытые концовки героя и доступ к «Новой игре+» останутся.`);
  if (!accepted) return;
  try {
    await Api.resetWorldStory(w.id);
    alert('Сюжет мира сброшен. Можно входить и проходить его заново.');
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

async function share(w, data) {
  if (data.open === false && w.online > 1 && !confirm('Закрыть мир? Гости, которые сейчас в нём, будут отключены.')) return;
  try {
    await Api.shareWorld(w.id, data);
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

async function leaveWorld(w) {
  if (!confirm(`Покинуть мир «${w.name}»? Он исчезнет из списка; вернуться можно по коду приглашения.`)) return;
  try {
    await Api.leaveWorld(w.id);
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

async function submitJoin(e) {
  e.preventDefault();
  const err = $('#join-error');
  err.textContent = '';
  const code = $('#join-code').value.trim();
  if (!code) { err.textContent = 'Введите код приглашения.'; return; }
  try {
    const { world } = await Api.joinWorld(code);
    $('#join-code').value = '';
    await refresh();
    err.textContent = `Вы присоединились к миру «${world.name}».`;
  } catch (ex) {
    err.textContent = ex.message;
  }
}

async function removeWorld(w) {
  if (!confirm(`Удалить мир «${w.name}»? Персонажи сохранятся, но их позиция в этом мире будет потеряна.`)) return;
  try {
    await Api.deleteWorld(w.id);
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

async function submitWorld(e) {
  e.preventDefault();
  const err = $('#world-error');
  err.textContent = '';
  const params = {
    name: $('#world-name').value,
    seed: $('#world-seed').value.trim(),
    size: $('#world-size').value,
    shape: $('#world-shape').value,
    waterMode:$('#world-water').value,
    enemyDensity: $('#world-enemies').value,
    hordeFrequency: $('#world-hordes').value,
    dragons: Number($('#world-dragons').value),
    survival: $('#world-survival').checked,
    survivalDifficulty: $('#world-survival-diff').value,
    difficulty:$('#world-difficulty').value,
  };
  const res = G.validateParams(params);
  if (!res.ok) { err.textContent = res.errors.join('\n'); return; }
  const btn = $('#btn-world-create');
  btn.disabled = true;
  btn.textContent = 'Генерация...';
  try {
    const selected={...res.value,difficulty:params.difficulty};
    await Api.createWorld($('#world-ngplus').checked ? { ...selected, newGamePlus: true, characterId: character.id } : selected);
    resetForm();
    await refresh();
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Создать мир';
  }
}
