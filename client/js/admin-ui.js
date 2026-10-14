// Панель администратора (ГМ): F10 или 🛡 — только для роли admin (сервер проверяет роль на каждом запросе).
// Вкладки: Игроки, Персонажи, Спавн, Сообщения, События, Журнал, Мир; сверху — режим бога.
// Панель сбоку и не закрывает карту: можно выбрать точку щелчком (спавн «по щелчку»), а при включённом полёте —
// Alt + щелчок по карте переносит героя сквозь препятствия.
import { api } from './api.js';
import {restorePanel,replacePanelContents} from './floating-window.js';

const $ = (sel) => document.querySelector(sel);
const Items = window.Items;
const Enemies = window.Enemies;
const R = window.CharacterRules;

// Мини-конструктор DOM: h('button', { className, onclick, title }, 'текст', ...)
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k in e && k !== 'list') e[k] = v; else e.setAttribute(k, v); // list у input — только атрибут
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}
const btn = (text, title, onclick, cls = 'btn small') => h('button', { type: 'button', className: cls, title, onclick }, text);
const field = (label, input, title) => h('label', { className: 'gm-field', title }, h('span', {}, label), input);
const when = (t) => (t ? new Date(t).toLocaleString('ru-RU') : '—');

let ctx = null; // { send, toast, worldId, isAdmin }
let tab = 'players';
let pickCb = null; // ожидание щелчка по карте
let logQuery = { page: 1 };

const TABS = [
  ['players', 'Игроки', 'Все аккаунты и кто где в сети: к игроку, призвать, выгнать, бан, роль'],
  ['chars', 'Персонажи', 'Характеристики, уровень, опыт, здоровье героя; выдать и забрать предметы'],
  ['spawn', 'Спавн', 'Создать врагов, боссов или предметы — у себя, по щелчку на карте или у игрока'],
  ['msg', 'Сообщения', 'Личное сообщение игроку, объявление миру или всем, отложенные сообщения'],
  ['events', 'События', 'Игровые события по расписанию или вручную: супер-босс, дракон, орда, двойной лут…'],
  ['log', 'Журнал', 'Журнал действий администраторов: фильтры и страницы'],
  ['world', 'Мир', 'Миры сервера, сохранить сейчас, резервные копии'],
  ['server', 'Сервер', 'Общие параметры и уровни журнала в серверной консоли'],
  ['bases', 'Базы', 'Базы игроков: где стоят, сколько построек; удалить базу'],
  ['vehicles', 'Техника', 'Транспорт этого мира: создать рядом (целый или обломок), починить, заправить, убрать'],
  ['settlements', 'Поселения', 'Поселения этого мира: репутация героев, обновить товар, отстроить, устроить набег'],
  ['quests', 'Задания', 'Задания и сюжет этого мира: выдать, завершить, сбросить; репутация фракций; концовка'],
  ['family', 'Семья', 'Семья героя: отношения с жителями (симпатия, стадия), члены семьи — добавить и убрать'],
  ['voice', 'Голос', 'Голосовой чат: кто в каких каналах, заглушить голос игрока (на время или бессрочно), вернуть, журнал'],
];
const BAN_PRESETS = [['15', '15 минут'], ['60', '1 час'], ['1440', '1 день'], ['10080', '7 дней'], ['', 'навсегда']];

export function initAdmin() {
  $('#btn-admin').addEventListener('click', () => adminToggle());
}
export function adminAttach(c) {
  ctx = c;
  $('#btn-admin').classList.toggle('hidden', !c.isAdmin);
  if (!c.isAdmin) adminToggle(false);
}
export function adminDetach() { ctx = null; pickCb = null; adminToggle(false); $('#btn-admin').classList.add('hidden'); }
export const adminIsOpen = () => !$('#admin-panel').classList.contains('hidden');
export function adminToggle(force) {
  if (!ctx || !ctx.isAdmin) force = false;
  const p = $('#admin-panel');
  const open = force === undefined ? p.classList.contains('hidden') : force;
  p.classList.toggle('hidden', !open);
  $('#btn-admin').classList.toggle('active', open);
  if (open){render();restorePanel('admin-panel');}
  else pickCb = null;
}
export function adminCanOpen() { return Boolean(ctx && ctx.isAdmin); }
// Щелчок по карте: true — поглощён панелью (выбор точки / телепорт полёта)
export function adminMapClick(e, w) {
  if (!ctx || !ctx.isAdmin) return false;
  if (pickCb) { const cb = pickCb; pickCb = null; cb(w); return true; }
  if (e.altKey && ctx.god && ctx.god.fly) { ctx.send({ t: 'gm', a: 'tp', x: Math.round(w.x * 100) / 100, y: Math.round(w.y * 100) / 100 }); return true; }
  return false;
}
export function adminOnGod(god) { if (ctx) { ctx.god = god; if (adminIsOpen()) renderGod(); } }

async function call(method, url, body) {
  try { return await api(method, url, body); } catch (e) { ctx && ctx.toast(e.message, 3500); throw e; }
}
const done = (text) => ctx && ctx.toast(text, 2200);

function render() {
  const p = $('#admin-panel');
  replacePanelContents(p,
    h('div', { className: 'gm-head' }, h('b', {}, '🛡 Панель ГМ'), btn('✕', 'Закрыть (F10 или Esc)', () => adminToggle(false))),
    h('div', { id: 'gm-god', className: 'gm-god' }),
    h('div', { className: 'gm-tabs' }, TABS.map(([id, label, title]) => h('button', { type: 'button', className: 'btn small' + (id === tab ? ' active' : ''), title, onclick: () => { tab = id; render(); } }, label))),
    h('div', { id: 'gm-body', className: 'gm-body' }, 'Загрузка...'),
  );
  renderGod();
  ({ players, chars, spawn, msg, events, log, world, server, bases, vehicles, settlements, quests, family, voice })[tab]().catch((e) => { if (!e.status) console.error(e); }); // ошибки API уже показаны
}

function renderGod() {
  const box = $('#gm-god');
  if (!box) return;
  const g = (ctx && ctx.god) || {};
  const chk = (k, label, title) => h('label', { className: 'check', title }, h('input', { type: 'checkbox', checked: Boolean(g[k]), onchange: (e) => ctx.send({ t: 'gm', a: 'god', god: { [k]: e.target.checked } }) }), ' ' + label);
  box.textContent = '';
  box.append(
    chk('invisible', 'Невидимость', 'Игроки (кроме администраторов) и враги вас не видят'),
    chk('invulnerable', 'Неуязвимость', 'Урон, яд и горение не действуют'),
    chk('fly', 'Полёт', 'Alt + щелчок по карте — мгновенно переместиться туда, даже через воду и горы'),
  );
}

const body = () => $('#gm-body');
function fill(...nodes) { const b = body(); if (!b) return; b.textContent = ''; b.append(...nodes); }

// ---------- Игроки ----------
async function players() {
  const { players: list } = await call('GET', '/api/admin/players');
  const reason = h('input', { placeholder: 'Причина (для бана и «выгнать»)', maxLength: 200 });
  const preset = h('select', { title: 'Срок бана' }, BAN_PRESETS.map(([v, l]) => h('option', { value: v }, l)));
  const rows = list.map((a) => {
    const o = a.online;
    const act = h('div', { className: 'gm-actions' });
    if (o) {
      act.append(
        btn('К нему', 'Переместиться к игроку (в том же мире)', () => call('POST', '/api/admin/teleport', { to: a.username }).then(() => done('Вы рядом с игроком.'))),
        btn('Призвать', 'Переместить игрока к себе', () => call('POST', '/api/admin/teleport', { username: a.username }).then(() => done('Игрок перемещён к вам.'))),
        btn('Выгнать', 'Отключить от мира (войти снова можно сразу)', () => call('POST', '/api/admin/kick', { username: a.username, reason: reason.value }).then(() => { done('Игрок отключён.'); players(); })),
      );
    }
    act.append(
      a.banned ? btn('Разбан', 'Снять блокировку', () => call('POST', '/api/admin/unban', { username: a.username }).then(() => { done('Бан снят.'); players(); }))
        : btn('Бан', 'Заблокировать на срок из списка сверху (или навсегда) с причиной', () => {
          if (!confirm(`Заблокировать ${a.username} (${preset.selectedOptions[0].textContent})?`)) return;
          call('POST', '/api/admin/ban', { username: a.username, minutes: preset.value ? Number(preset.value) : null, reason: reason.value }).then(() => { done('Аккаунт заблокирован.'); players(); });
        }, 'btn small danger'),
      a.voiceMuted ? btn('Вернуть голос', 'Снять заглушение голосового чата', () => call('POST', '/api/admin/voice/unmute', { username: a.username }).then(() => { done('Голос возвращён.'); players(); }))
        : btn('Заглушить голос', 'Заглушить голосовой чат на срок из списка сверху (или навсегда) с причиной: сервер разорвёт голосовые соединения и не будет соединять снова', () => {
          call('POST', '/api/admin/voice/mute', { username: a.username, minutes: preset.value ? Number(preset.value) : 0, reason: reason.value }).then(() => { done('Голос заглушён.'); players(); });
        }, 'btn small danger'),
      btn(a.role === 'admin' ? 'В игроки' : 'В админы', 'Сменить роль аккаунта', () => call('POST', '/api/admin/role', { username: a.username, role: a.role === 'admin' ? 'player' : 'admin' }).then(() => { done('Роль изменена.'); players(); })),
      btn('Герои', 'Открыть героев аккаунта на вкладке «Персонажи»', () => { charsUser = a.username; tab = 'chars'; render(); }),
    );
    return h('div', { className: 'gm-row' + (o ? ' online' : '') },
      h('div', {}, h('b', {}, a.username), a.role === 'admin' ? ' 🛡' : '', a.banned ? h('span', { className: 'error' }, ` · бан${a.bannedUntil ? ' до ' + when(a.bannedUntil) : ' навсегда'}`) : '',
        a.voiceMuted ? h('span', { className: 'error', title: a.voiceMuteReason || '' }, ` · 🔇 голос${a.voiceMutedUntil ? ' до ' + when(a.voiceMutedUntil) : ' навсегда'}`) : '',
        h('div', { className: 'small muted' }, o ? `в мире «${o.worldName}»: ${o.character}, ур. ${o.level} (${o.x}, ${o.y})` : 'не в сети')),
      act);
  });
  fill(h('div', { className: 'gm-actions' }, preset, reason, btn('Обновить', 'Перечитать список', players)), ...rows);
}

// ---------- Персонажи ----------
let charsUser = '';
async function chars() {
  const { players: list } = await call('GET', '/api/admin/players');
  const dl = h('datalist', { id: 'gm-accounts' }, list.map((a) => h('option', { value: a.username })));
  const user = h('input', { value: charsUser, placeholder: 'Аккаунт', list: 'gm-accounts' });
  const out = h('div');
  const load = async () => {
    charsUser = user.value.trim();
    if (!charsUser) return;
    const r = await call('GET', `/api/admin/accounts/${encodeURIComponent(charsUser)}/characters`);
    out.textContent = '';
    if (!r.characters.length) out.append(h('p', { className: 'muted' }, 'У аккаунта нет героев.'));
    for (const ch of r.characters) out.append(charForm(charsUser, ch));
  };
  fill(dl, h('div', { className: 'gm-actions' }, user, btn('Открыть', 'Показать героев аккаунта', load)), out);
  if (charsUser) load();
}

function num(value, min, max, title) { return h('input', { type: 'number', value, min, max, step: 1, title, className: 'gm-num' }); }
function itemPicker() {
  const dl = h('datalist', { id: 'gm-items' }, Items.ITEMS.filter((i) => !i.fixed).map((i) => h('option', { value: `${i.name} [${i.id}]` })));
  const input = h('input', { placeholder: 'Поиск предмета: название или id', list: 'gm-items', className: 'gm-wide' });
  const id = () => { const m = /\[([^\]]+)\]$/.exec(input.value.trim()); return m ? m[1] : input.value.trim(); };
  return { dl, input, id };
}

function charForm(username, ch) {
  const stats = {};
  const grid = h('div', { className: 'gm-grid' });
  for (const s of R.STATS) { stats[s.id] = num(ch.stats[s.id], 1, R.statCap(s.id, false), `${s.label}: от 1`); grid.append(field(s.label, stats[s.id], s.desc)); }
  const f = {
    level: num(ch.level, 1, window.Combat.settings.maxLevel, 'Уровень'),
    xp: num(ch.xp, 0, ch.xpToNext - 1, `Опыт: меньше ${ch.xpToNext} для этого уровня`),
    hp: num(ch.vitals ? ch.vitals.hp : ch.max.hp, 1, ch.max.hp, `Здоровье: от 1 до ${ch.max.hp}`),
    mp: num(ch.vitals ? ch.vitals.mp : ch.max.mp, 0, ch.max.mp, `Мана: до ${ch.max.mp}`),
    stamina: num(ch.vitals ? ch.vitals.stamina : ch.max.stamina, 0, ch.max.stamina, `Выносливость: до ${ch.max.stamina}`),
    unspentPoints: num(ch.unspentPoints || 0, 0, 9999, 'Свободные очки характеристик'),
    deaths: num(ch.deaths || 0, 0, 1e9, 'Число смертей'),
    // выживание: шкалы 0…100
    food: num(Math.round(ch.survival ? ch.survival.food : 100), 0, 100, 'Сытость: 0…100 (мало — нет восстановления здоровья, 0 — здоровье убывает)'),
    water: num(Math.round(ch.survival ? ch.survival.water : 100), 0, 100, 'Вода: 0…100 (мало — меньше выносливости)'),
    rest: num(Math.round(ch.survival ? ch.survival.rest : 100), 0, 100, 'Бодрость: 0…100 (мало — меньше маны, 0 — штраф к урону и скорости)'),
    rad: num(Math.round(ch.survival ? ch.survival.rad : 0), 0, 100, 'Радиация: 0…100 (от порога — лучевая болезнь)'),
  };
  const labels = { level: 'Уровень', xp: 'Опыт', hp: 'Здоровье', mp: 'Мана', stamina: 'Выносл.', unspentPoints: 'Очки', deaths: 'Смерти', food: 'Сытость', water: 'Вода', rest: 'Бодрость', rad: 'Радиация' };
  const grid2 = h('div', { className: 'gm-grid' }, Object.entries(f).map(([k, inp]) => field(labels[k], inp, inp.title)));
  const cure = h('input', { type: 'checkbox', title: 'Снять болезнь (от грязной воды, сырого или испорченного)' });
  const ill = ch.survival && ch.survival.illUntil > Date.now();
  grid2.append(h('label', { className: 'check small', title: cure.title }, cure, ill ? ' Вылечить (болен)' : ' Вылечить'));
  const save = btn('Сохранить героя', 'Проверить и применить изменения (герой в сети получит их сразу)', async () => {
    const body = { username, characterId: ch.id, stats: {} };
    for (const s of R.STATS) body.stats[s.id] = Number(stats[s.id].value);
    for (const [k, inp] of Object.entries(f)) body[k] = Number(inp.value);
    if (cure.checked) body.ill = false;
    await call('POST', '/api/admin/characters/edit', body);
    done('Герой сохранён.');
    chars();
  }, 'btn small primary');
  const pick = itemPicker();
  const count = num(1, 1, 999, 'Количество');
  const give = (url, verb) => btn(verb, `${verb} предмет у героя`, () => call('POST', url, { username, character: ch.id, item: pick.id(), count: Number(count.value) })
    .then((r) => done(`${verb}: ${r.name} × ${r.count}`)));
  return h('details', { className: 'gm-char', open: true },
    h('summary', {}, `${ch.name} — ур. ${ch.level}${ch.online ? ' · в сети' : ''}`),
    grid, grid2, save,
    h('div', { className: 'gm-actions' }, btn('🚩', 'Выдать этому герою флаг базы', () => call('POST','/api/admin/items/give',{username,character:ch.id,item:'base_flag',count:1}).then(()=>done('Флаг базы выдан.'))), pick.dl, pick.input, count, give('/api/admin/items/give', 'Выдать'), give('/api/admin/items/take', 'Забрать')),
    recipeGiver(username, ch), companionEditor(username, ch), spellEditor(username, ch));
}

// Спутники героя (шаг 11): список, выдать (в контейнер или рядом), призвать приручённого рядом с героем в мире, убрать
function companionEditor(username, ch) {
  const Cm = window.Companions;
  const box = h('div', { className: 'gm-actions', title: 'Спутники героя: звери, люди, машины, драконы' });
  const sel = h('select', { title: 'Существо (только те, кто может стать спутником)' },
    Enemies.ENEMIES.filter((e) => Cm && Cm.kindOf(e) && Cm.methodsFor(e).length).map((e) => h('option', { value: e.id }, `${e.name} (ур. ${e.level[0]}–${e.level[1]})`)));
  const lvl = h('input', { type: 'number', min: 1, max: 40, value: 5, style: 'width:60px', title: 'Уровень спутника' });
  const list = h('div', { className: 'small' }, 'Загрузка спутников...');
  const load = () => call('POST', '/api/admin/companions/list', { username, character: ch.id }).then((r) => {
    list.textContent = '';
    list.append(h('div', { className: 'muted' }, `Спутники: ${r.list.length}, мест: ${r.slots}${r.shrinker ? ', есть контейнер' : ', без контейнера'}`));
    for (const c of r.list) {
      list.append(h('div', {}, `${c.name} ур. ${c.lvl} · ${c.hp}/${c.max} · ${c.down ? 'ранен' : c.out ? 'рядом' : 'в контейнере'} `,
        btn('Убрать', 'Забрать спутника у героя', () => call('POST', '/api/admin/companions/remove', { username, character: ch.id, id: c.id }).then(() => { done('Спутник убран.'); load(); }), 'btn small danger')));
    }
  });
  box.append(h('span', { className: 'small muted' }, 'Спутники:'), sel, lvl,
    btn('Выдать', 'Добавить спутника (есть место — рядом, иначе в контейнер)', () => call('POST', '/api/admin/companions/give', { username, character: ch.id, def: sel.value, level: Number(lvl.value) }).then((r) => { done(`${r.character}: ${r.companion.name}`); load(); })),
    btn('Призвать рядом', 'Приручённый спутник сразу появится рядом с героем (герой должен быть в мире)', () => call('POST', '/api/admin/companions/spawn', { username, character: ch.id, def: sel.value, level: Number(lvl.value) }).then((r) => { done(`${r.character}: ${r.companion.name} рядом`); load(); })),
    list);
  load().catch(() => { list.textContent = ''; });
  return box;
}

// Выдать рецепт (или все) — шаг 10
function recipeGiver(username, ch) {
  const C = window.Crafting;
  const sel = h('select', { title: 'Рецепт: откроется в книге рецептов (K); чертёж — постройка в режиме строительства (B)' },
    h('option', { value: 'all' }, 'все рецепты'), C.RECIPES.filter((r) => !r.start).map((r) => h('option', { value: r.id }, r.name)));
  const known = (ch.recipes || []).length;
  return h('div', { className: 'gm-actions', title: 'Изученные рецепты героя' }, h('span', { className: 'small muted' }, `Рецептов изучено: ${known} (+ стартовые)`), sel,
    btn('Научить', 'Добавить рецепт герою (в сети — сразу)', () => call('POST', '/api/admin/recipes/give', { username, character: ch.id, recipe: sel.value }).then((r) => done(`${r.character}: рецептов выдано ${r.recipes}`))));
}

// Заклинания героя (шаг 12): научить (одно или все) и стереть; то же — зацепка магов-наставников поселений
function spellEditor(username, ch) {
  const Mg = window.Magic;
  if (!Mg) return h('div');
  const known = Mg.known(ch);
  const sel = h('select', { title: 'Заклинание: появится в книге заклинаний (P); требования статов не проверяются' },
    h('option', { value: 'all' }, 'все заклинания'), Mg.SPELLS.map((sp) => h('option', { value: sp.id }, `${Mg.SCHOOLS[sp.school].name}: ${sp.name}${known.includes(sp.id) ? ' ✓' : ''}`)));
  return h('div', { className: 'gm-actions', title: 'Изученные заклинания героя' },
    h('span', { className: 'small muted' }, `Заклинаний: ${known.length}${ch.magicPower ? `, сила убитых магов ${ch.magicPower}` : ''}`), sel,
    btn('Научить', 'Научить героя заклинанию (в сети — сразу)', () => call('POST', '/api/admin/spells/teach', { username, character: ch.id, spell: sel.value }).then((r) => done(`${r.character}: заклинаний ${r.spells}`))),
    btn('Стереть', 'Стереть заклинание (все — ещё и сила убитых магов); убирается и с панели 1–0', () => call('POST', '/api/admin/spells/remove', { username, character: ch.id, spell: sel.value }).then((r) => done(`${r.character}: заклинаний ${r.spells}`))));
}

// ---------- Базы (шаг 10) ----------
async function bases() {
  const body = $('#gm-body');
  const r = await call('GET', '/api/admin/bases');
  body.textContent = '';
  if (!r.bases.length) { body.append(h('div', { className: 'muted small' }, 'Баз пока нет. Игрок ставит базу, используя «Флаг базы» в мире.')); return; }
  body.append(h('table', { className: 'gm-table small' },
    h('tr', {}, ['База', 'Хозяин', 'Где', 'Построек', 'Изменена', ''].map((t) => h('th', {}, t))),
    r.bases.map((b) => h('tr', {},
      h('td', {}, b.name), h('td', {}, b.ownerName || b.ownerId.slice(0, 8)),
      h('td', { title: b.placed ? `мир ${b.placed.worldId}` : '' }, b.placed ? `${b.placed.x}, ${b.placed.y} (r ${b.placed.r})` : 'свёрнута'),
      h('td', {}, String(b.structures)), h('td', {}, when(b.updatedAt)),
      h('td', {}, btn('Удалить', 'Удалить базу со всеми постройками и содержимым сундуков (без возврата)', async () => {
        if (!confirm(`Удалить базу «${b.name}»? Это необратимо.`)) return;
        await call('POST', '/api/admin/bases/remove', { id: b.id });
        done('База удалена.');
        bases();
      }, 'btn small danger'))))));
}

// ---------- Техника (шаг 14) ----------
async function vehicles() {
  const r = await call('POST', '/api/admin/vehicles/list', { worldId: ctx.worldId });
  const sel = h('select', { title: 'Какую технику создать' }, r.catalogue.map((d) => h('option', { value: d.id }, d.name)));
  const wreck = h('input', { type: 'checkbox' });
  const own = h('input', { type: 'checkbox', checked: true });
  const act = (v, op) => call('POST', '/api/admin/vehicles/act', { id: v.id, op }).then(() => { done('Готово.'); vehicles(); });
  fill(
    h('div', { className: 'gm-actions' }, sel,
      h('label', { className: 'check', title: 'Создать разбитой (15% прочности, нужен ремонт)' }, wreck, ' обломок'),
      h('label', { className: 'check', title: 'Хозяин — вы' }, own, ' моя'),
      btn('Создать рядом', 'Создать технику рядом с собой (лодки — на ближайшей воде), с полным баком', () => call('POST', '/api/admin/vehicles/spawn', { def: sel.value, wreck: wreck.checked, own: own.checked }).then((x) => { done(`Создано: ${x.vehicle.def}`); vehicles(); }), 'btn small primary')),
    h('table', { className: 'gm-table small' },
      h('tr', {}, ['Машина', 'Где', 'Прочн.', 'Топливо', 'Хозяин', ''].map((t) => h('th', {}, t))),
      r.vehicles.map((v) => h('tr', {},
        h('td', { title: v.id }, v.name + (v.wreck ? ' (обломок)' : '')), h('td', {}, `${v.room === 'ground' ? '' : v.room + ' · '}${Math.floor(v.x)}, ${Math.floor(v.y)}`),
        h('td', {}, `${v.hp}/${v.maxHp}`), h('td', {}, v.cap ? `${Math.floor(v.fuel)}/${v.cap}` : '—'), h('td', {}, (v.ownerName || '—') + (v.locked ? ' 🔒' : '')),
        h('td', {}, btn('Починить', 'Полная прочность', () => act(v, 'repair')), btn('Заправить', 'Полный бак', () => act(v, 'refuel')),
          btn('Убрать', 'Удалить машину из мира (седоки выйдут)', () => act(v, 'remove'), 'btn small danger'))))),
    h('p', { className: 'small muted' }, 'Техника мира хранится в data/worlds/<мир>.vehicles.json. Без игроков мир выгружается — список показывает сохранённое.'));
}

// ---------- Поселения (шаг 15) ----------
async function settlements() {
  const r = await call('POST', '/api/admin/settlements/list', { worldId: ctx.worldId });
  const act = (t, body, msg) => call('POST', '/api/admin/settlements/act', { worldId: ctx.worldId, sid: t.id, ...body }).then(() => { done(msg || 'Готово.'); settlements(); });
  const setRep = (t, who) => {
    const username = (who && who.username) || prompt('Логин игрока:');
    if (!username) return;
    const character = who ? who.id : prompt('Имя персонажа (пусто — текущий):') || undefined;
    const v = prompt(`Репутация в «${t.name}» (-100…100):`, who ? String(who.rep) : '0');
    if (v === null || v.trim() === '' || isNaN(Number(v))) return;
    act(t, { act: 'rep', username, character, value: Number(v) }, 'Репутация изменена.');
  };
  fill(
    h('table', { className: 'gm-table small' },
      h('tr', {}, ['Поселение', 'Где', 'Целость', 'Набег', 'Репутация героев', ''].map((x) => h('th', {}, x))),
      r.towns.map((t) => h('tr', {},
        h('td', { title: `#${t.id}` }, `${t.name} (${t.kindName})`), h('td', {}, `${t.x}, ${t.y}`),
        h('td', { title: 'Ниже 50 — цены выше, пока поселение отстраивается' }, `${t.hp}%`), h('td', {}, t.raid ? `идёт: ${t.raid} налётч.` : '—'),
        h('td', {}, t.reps.length ? t.reps.map((x) => h('div', { title: 'Щёлкните, чтобы изменить', className: 'clickable', onclick: () => setRep(t, x) }, `${x.name}: ${x.rep} (${x.tierName})`)) : '—'),
        h('td', {}, btn('Репутация…', 'Задать репутацию героя в этом поселении', () => setRep(t)),
          btn('Товар', 'Обновить товар у торговцев сейчас', () => act(t, { act: 'restock' }, 'Товар обновлён.')),
          btn('Отстроить', 'Целость 100% (обычные цены)', () => act(t, { act: 'repair' })),
          btn('Набег', 'Немедленно напасть на поселение (нужны игроки на поверхности)', () => act(t, { act: 'raid' }, 'Набег начался.'), 'btn small danger'))))),
    h('p', { className: 'small muted' }, 'Состояние поселений хранится в data/worlds/<мир>.settlements.json; планировка строится из зерна мира.'));
}

// ---------- Задания, фракции, концовки (шаг 16) ----------
async function quests() {
  const r = await call('POST', '/api/admin/quests/list', { worldId: ctx.worldId });
  const act = (body, msg) => call('POST', '/api/admin/quests/act', { worldId: ctx.worldId, ...body }).then(() => { done(msg || 'Готово.'); quests(); });
  const stateName = { done: 'выполнено', active: 'взято', next: 'следующее', locked: 'впереди' };
  const fac = h('select', {}, r.factions.filter((f) => !f.locked).map((f) => h('option', { value: f.id }, f.name)));
  const end = h('select', {}, r.endings.map((e) => h('option', { value: e.id }, `${e.name} (${e.id})`)));
  const user = h('input', { placeholder: 'логин игрока' }), val = h('input', { type: 'number', min: -100, max: 100, value: '0', style: 'width:70px' });
  const user2 = h('input', { placeholder: 'логин игрока' });
  fill(
    h('p', {}, `Мир «${r.world}»: сюжет ${Math.min(r.main, r.mainTotal)}/${r.mainTotal}, Патриарх — ${r.story.patriarch}${r.story.ending ? `, концовка: ${r.story.ending}` : ''}; выполнено заданий: ${r.completed}; невыданных наград: ${r.pending}.`),
    h('h4', {}, 'Сюжет'),
    h('table', { className: 'gm-table small' }, h('tr', {}, ['Задание', 'Состояние', ''].map((x) => h('th', {}, x))),
      r.mainQuests.map((q) => h('tr', {}, h('td', { title: q.id }, q.name), h('td', {}, stateName[q.state] || q.state),
        h('td', {}, q.state !== 'active' ? btn('Выдать', 'Сделать текущим и взять (нужен игрок на поверхности; более ранние считаются выполненными)', () => act({ act: 'grant', id: q.id }, 'Задание выдано.')) : '')))),
    h('h4', {}, 'Взятые задания'),
    r.active.length ? h('table', { className: 'gm-table small' }, h('tr', {}, ['Задание', 'Цели', 'Участники', ''].map((x) => h('th', {}, x))),
      r.active.map((q) => h('tr', {}, h('td', { title: q.id }, `${q.main ? '★ ' : ''}${q.name}`), h('td', {}, (q.goals || []).map((g) => h('div', {}, `${g.done ? '✔' : '○'} ${g.text}`))), h('td', {}, String(q.party)),
        h('td', {}, btn('Завершить', 'Засчитать и выдать награды участникам', () => act({ act: 'complete', id: q.id }, 'Задание завершено.')),
          btn('Сбросить', 'Убрать задание без наград', () => act({ act: 'reset', id: q.id }, 'Задание сброшено.'), 'btn small danger'))))) : h('p', { className: 'muted' }, 'Нет взятых заданий.'),
    h('p', {}, btn('Сбросить всё', 'Сбросить сюжет, задания и концовку мира (репутация героев не меняется)', () => { if (confirm('Сбросить все задания и сюжет мира?')) act({ act: 'reset', id: 'all' }, 'Задания мира сброшены.'); }, 'btn small danger')),
    h('h4', {}, 'Репутация у фракции'),
    h('p', {}, user, ' ', fac, ' ', val, ' ', btn('Задать', 'Задать репутацию текущего героя игрока (-100…100), без разноса союзникам', () => { if (user.value.trim()) act({ act: 'faction', username: user.value.trim(), faction: fac.value, value: Number(val.value) }, 'Репутация изменена.'); })),
    h('h4', {}, 'Концовка'),
    h('p', {}, user2, ' ', end, ' ', btn('Устроить', 'Завершить историю мира этой концовкой: экран итогов и отметка «Новой игры+» всем игрокам мира', () => { if (user2.value.trim() && confirm('Завершить историю мира?')) act({ act: 'ending', username: user2.value.trim(), ending: end.value }, 'Концовка отмечена.'); }, 'btn small danger')),
    h('p', { className: 'small muted' }, 'Задания мира хранятся в data/worlds/<мир>.quests.json; репутация фракций — у героя.'));
}

// ---------- Семья (шаг 17) ----------
let famUser = '';
async function family() {
  const user = h('input', { placeholder: 'логин игрока', value: famUser });
  const show = btn('Показать', 'Семья текущего героя игрока', () => { famUser = user.value.trim(); family(); });
  if (!famUser) { fill(h('p', {}, user, ' ', show), h('p', { className: 'small muted' }, 'Семья хранится на герое (ch.family) и переезжает в «Новую игру+».')); return; }
  const r = await call('POST', '/api/admin/family/list', { username: famUser });
  const act = (body, msg) => call('POST', '/api/admin/family/act', { username: famUser, ...body }).then(() => { done(msg || 'Готово.'); family(); });
  const kind = h('select', {}, r.kinds.map((k) => h('option', { value: k }, ({ partner: 'супруг(а)', child: 'ребёнок', elder: 'старейшина' })[k] || k)));
  const role = h('select', {}, r.roles.map((k) => h('option', { value: k }, k)));
  const name = h('input', { placeholder: 'имя' }), age = h('input', { type: 'number', min: 0, max: 99, value: '8', style: 'width:60px', title: 'Возраст (для ребёнка — растёт со временем)' });
  fill(
    h('p', {}, user, ' ', show),
    h('p', {}, `Герой «${r.character}»${r.online ? ' (в игре)' : ''}${r.bond ? `; союз с игроком: ${r.bond.name}` : ''}${r.invites.length ? `; приглашения: ${r.invites.join(', ')}` : ''}.`),
    h('h4', {}, 'Члены семьи'),
    r.members.length ? h('table', { className: 'gm-table small' }, h('tr', {}, ['Кто', 'Возраст', 'Дело', 'Уровень', ''].map((x) => h('th', {}, x))),
      r.members.map((m) => h('tr', {}, h('td', { title: m.origin }, `${m.name} (${m.kind})${m.out ? ' — в походе' : ''}`), h('td', {}, `${m.age}${m.adult ? '' : ' (ребёнок)'}`), h('td', {}, m.role || (m.study ? `учится: ${m.study}` : '—')), h('td', {}, String(m.level)),
        h('td', {}, btn('Убрать', 'Убрать из семьи (и из спутников)', () => { if (confirm(`Убрать ${m.name} из семьи?`)) act({ act: 'remove', id: m.id }, 'Убран(а) из семьи.'); }, 'btn small danger'))))) : h('p', { className: 'muted' }, 'Нет членов семьи.'),
    h('p', {}, kind, ' ', name, ' ', age, ' ', role, ' ', btn('Добавить', 'Добавить члена семьи (ребёнку дело — то, чему он учится)', () => { if (name.value.trim()) act({ act: 'add', kind: kind.value, name: name.value.trim(), age: Number(age.value), role: role.value }, 'Добавлен(а) в семью.'); }),
      ' ', btn('Приглашение Патриарха', 'Выдать приглашение Железного Патриарха (как после концовки «Семья»)', () => act({ act: 'invite' }, 'Приглашение выдано.'))),
    h('h4', {}, 'Отношения с жителями'),
    r.rel.length ? h('table', { className: 'gm-table small' }, h('tr', {}, ['Житель', 'Поселение', 'Симпатия', 'Стадия', ''].map((x) => h('th', {}, x))),
      r.rel.map((x) => {
        const st = h('select', {}, r.stages.map((s2) => h('option', { value: s2, selected: s2 === x.stage }, s2)));
        return h('tr', {}, h('td', { title: x.key }, x.name), h('td', {}, x.town),
          h('td', { className: 'clickable', title: 'Щёлкните, чтобы изменить', onclick: () => { const v = prompt(`Симпатия ${x.name} (0…100):`, String(x.affinity)); if (v !== null && v.trim() !== '') act({ act: 'rel', key: x.key, affinity: Number(v) }, 'Симпатия изменена.'); } }, String(x.affinity)),
          h('td', {}, st, ' ', btn('Задать', 'Задать стадию отношений', () => act({ act: 'rel', key: x.key, stage: st.value }, 'Стадия изменена.'))),
          h('td', {}, btn('Забыть', 'Удалить отношения', () => act({ act: 'relDel', key: x.key }, 'Отношения удалены.'), 'btn small danger')));
      })) : h('p', { className: 'muted' }, 'Нет отношений с жителями.'));
}

// ---------- Голосовой чат (шаг 18) ----------
const fmtTime = (t) => (t ? new Date(t).toLocaleString('ru-RU') : 'бессрочно');
async function voice() {
  const r = await call('POST', '/api/admin/voice/list', {});
  const re = (p) => p.then((x) => { done('Готово.'); voice(); return x; });
  const user = h('input', { placeholder: 'логин игрока', list: 'gm-accounts' });
  const mins = h('input', { type: 'number', min: 0, value: String((window.Voice && window.Voice.settings.voiceMuteDefaultMin) || 60), style: 'width:70px', title: 'Минут (0 — бессрочно)' });
  const reason = h('input', { placeholder: 'причина (видна игроку)' });
  const mute = (username) => re(call('POST', '/api/admin/voice/mute', { username, minutes: Number(mins.value) || 0, reason: reason.value.trim() }));
  const unmute = (username) => re(call('POST', '/api/admin/voice/unmute', { username }));
  fill(
    h('p', {}, r.enabled ? `Голосовой чат включён, до ${r.maxPeers} игроков в канале. Звук идёт между браузерами напрямую — сервер только соединяет.` : 'Голосовой чат отключён настройкой game.voiceEnabled.'),
    h('h4', {}, 'Каналы'),
    r.channels.length ? h('table', { className: 'gm-table small' }, h('tr', {}, ['Мир', 'Канал', 'Участники'].map((x) => h('th', {}, x))),
      r.channels.map((c) => h('tr', {}, h('td', { title: c.worldId }, c.world), h('td', {}, c.ch === 'world' ? 'весь мир' : 'группа «' + c.ch.slice(6) + '»'),
        h('td', {}, ...c.members.flatMap((m) => [(m.speak ? '🔊 ' : '') + `${m.name} (${m.account}) `, btn('Заглушить', 'Заглушить голос игрока: сервер разорвёт его соединения и больше не будет соединять', () => mute(m.account), 'btn small danger'), ' ']))))) : h('p', { className: 'muted' }, 'Сейчас никто не в голосовом чате.'),
    h('h4', {}, 'Заглушить голос'),
    h('p', {}, user, ' ', mins, ' мин ', reason, ' ', btn('Заглушить', 'Заглушить голос игрока (на время или бессрочно). Как блокировка, но только для голоса', () => { if (user.value.trim()) mute(user.value.trim()); }, 'btn small danger')),
    h('h4', {}, 'Заглушённые'),
    r.muted.length ? h('table', { className: 'gm-table small' }, h('tr', {}, ['Игрок', 'До', 'Причина', ''].map((x) => h('th', {}, x))),
      r.muted.map((m) => h('tr', {}, h('td', {}, m.username), h('td', {}, fmtTime(m.until)), h('td', {}, m.reason || '—'), h('td', {}, btn('Вернуть голос', 'Снять заглушение', () => unmute(m.username)))))) : h('p', { className: 'muted' }, 'Никто не заглушён.'),
    h('h4', {}, 'Журнал голоса'),
    r.log.length ? h('table', { className: 'gm-table small' }, h('tr', {}, ['Время', 'Событие', 'Игрок', 'Подробно'].map((x) => h('th', {}, x))),
      r.log.map((e) => h('tr', {}, h('td', {}, new Date(e.at).toLocaleTimeString('ru-RU')), h('td', {}, ({ join: 'вошёл', leave: 'вышел', 'reject-muted': 'не пущен: заглушён', 'reject-route': 'сигнал не туда' })[e.ev] || e.ev),
        h('td', {}, `${e.name || ''} (${e.username || ''})`), h('td', {}, [e.ch, e.why, e.to].filter(Boolean).join(' · ') || '')))) : h('p', { className: 'muted' }, 'Пусто.'),
    h('p', { className: 'small muted' }, 'Заглушения и их снятие пишутся в общий журнал администратора (вкладка «Журнал»). Заблокированный аккаунт выходит и из голоса.'));
}

// ---------- Спавн ----------
async function spawn() {
  const kind = h('select', {}, h('option', { value: 'enemy' }, 'Враг / босс'), h('option', { value: 'item' }, 'Предмет'));
  const dlE = h('datalist', { id: 'gm-enemies' }, Enemies.ENEMIES.map((e) => h('option', { value: `${e.name} [${e.id}]` })));
  const pick = itemPicker();
  const what = h('input', { placeholder: 'Поиск: название или id', list: 'gm-enemies', className: 'gm-wide' });
  kind.addEventListener('change', () => { what.value = ''; what.setAttribute('list', kind.value === 'item' ? 'gm-items' : 'gm-enemies'); });
  const count = num(1, 1, 500, 'Количество');
  const at = h('select', { title: 'Где создать' }, h('option', { value: 'me' }, 'рядом со мной'), h('option', { value: 'point' }, 'по щелчку на карте'), h('option', { value: 'player' }, 'у игрока'));
  const user = h('input', { placeholder: 'Аккаунт игрока', list: 'gm-accounts' });
  const attack = h('input', { type: 'checkbox', checked: true });
  const id = () => { const m = /\[([^\]]+)\]$/.exec(what.value.trim()); return m ? m[1] : what.value.trim(); };
  const go = () => {
    const body = { kind: kind.value, id: id(), count: Number(count.value), at: at.value, username: user.value.trim(), attack: attack.checked };
    const send = (extra = {}) => call('POST', '/api/admin/spawn', { ...body, ...extra }).then((r) => done(`Создано: ${r.name} × ${r.count}`));
    if (at.value === 'point') { pickCb = (w) => send({ x: w.x, y: w.y, worldId: ctx.worldId }); done('Щёлкните по карте, где создать.'); } else send();
  };
  const { players: list } = await call('GET', '/api/admin/players');
  fill(dlE, pick.dl, h('datalist', { id: 'gm-accounts' }, list.map((a) => h('option', { value: a.username }))),
    h('div', { className: 'gm-actions' }, kind, what),
    h('div', { className: 'gm-actions' }, field('Сколько', count), at, user, h('label', { className: 'check', title: 'Враги сразу идут на игрока' }, attack, ' напасть на игрока')),
    btn('Создать', 'Создать выбранное', go, 'btn small primary'),
    h('p', { className: 'small muted' }, 'Главари банд приходят со свитой. Предметы ложатся на землю стопками.'));
}

// ---------- Сообщения ----------
async function msg() {
  const { players: list } = await call('GET', '/api/admin/players');
  const user = h('input', { placeholder: 'Аккаунт', list: 'gm-accounts' });
  const text = h('input', { placeholder: 'Текст', maxLength: 300, className: 'gm-wide' });
  const inMin = num(0, 0, 100000, 'Через сколько минут (0 — сейчас; если игрок не в мире — дойдёт, когда войдёт)');
  const atext = h('input', { placeholder: 'Текст объявления', maxLength: 300, className: 'gm-wide' });
  const scope = h('select', {}, h('option', { value: 'world' }, 'в этот мир'), h('option', { value: 'all' }, 'во все миры'));
  const ain = num(0, 0, 100000, 'Через сколько минут (0 — сейчас)');
  const every = num(0, 0, 100000, 'Повторять каждые N минут (0 — один раз)');
  fill(h('datalist', { id: 'gm-accounts' }, list.map((a) => h('option', { value: a.username }))),
    h('h4', {}, 'Личное сообщение'),
    h('div', { className: 'gm-actions' }, user, text, field('через, мин', inMin),
      btn('Отправить', 'Отправить игроку', () => call('POST', '/api/admin/message', { username: user.value.trim(), text: text.value, inMin: Number(inMin.value) })
        .then((r) => done(r.delivered ? 'Доставлено.' : 'Сохранено: дойдёт, когда игрок будет в мире.')), 'btn small primary')),
    h('h4', {}, 'Объявление'),
    h('div', { className: 'gm-actions' }, atext, scope, field('через, мин', ain), field('каждые, мин', every),
      btn('Объявить', 'Объявление в чат (сейчас или по расписанию)', () => {
        const worldId = scope.value === 'world' ? ctx.worldId : null;
        if (!Number(ain.value) && !Number(every.value)) return call('POST', '/api/admin/announce', { text: atext.value, worldId }).then((r) => done(`Объявлено: миров ${r.rooms}, игроков ${r.players}.`));
        return call('POST', '/api/admin/events', { type: 'announce', text: atext.value, worldId, inMin: Number(ain.value), everyMin: Number(every.value) }).then(() => done('Объявление запланировано (вкладка «События»).'));
      }, 'btn small primary')));
}

// ---------- События ----------
async function events() {
  const r = await call('GET', '/api/admin/events');
  const type = h('select', {}, r.types.map((t) => h('option', { value: t.id }, `${t.label} (${t.id})`)));
  const scope = h('select', {}, h('option', { value: 'world' }, 'этот мир'), h('option', { value: 'all' }, 'все миры'));
  const inMin = num(0, 0, 100000, 'Через сколько минут');
  const every = num(0, 0, 100000, 'Повтор каждые N минут (0 — один раз)');
  const dur = num(30, 1, 1440, 'Длительность, минут (двойной лут)');
  const extra = h('input', { placeholder: 'Текст / враг (boss, dragon) / адресат (message)', className: 'gm-wide' });
  const add = () => {
    const t = type.value, v = extra.value.trim();
    const body = { type: t, worldId: scope.value === 'world' ? ctx.worldId : null, inMin: Number(inMin.value), everyMin: Number(every.value), durationMin: Number(dur.value) };
    if (t === 'boss' || t === 'dragon') body.enemy = v || null;
    else if (t === 'message') { const [who, ...rest] = v.split(/\s+/); body.target = who; body.text = rest.join(' '); body.worldId = null; }
    else body.text = v;
    call('POST', '/api/admin/events', body).then(() => { done('Событие добавлено.'); events(); });
  };
  const rows = r.events.slice().reverse().map((e) => h('div', { className: 'gm-row' + (e.status === 'scheduled' ? ' online' : '') },
    h('div', {}, h('b', {}, `${e.type}`), ` · ${e.id} · ${{ scheduled: 'ждёт', done: 'выполнено', cancelled: 'отменено' }[e.status]}`,
      h('div', { className: 'small muted' }, `${e.worldId ? 'один мир' : 'все миры'} · ${e.status === 'scheduled' ? 'запуск ' + when(e.at) : 'последний ' + when(e.lastRunAt)}${e.everyMin ? ` · каждые ${e.everyMin} мин` : ''}${e.durationMin ? ` · ${e.durationMin} мин` : ''} · запусков ${e.runs}${e.target ? ' · для ' + e.target : ''}${e.lastResult ? ' · ' + e.lastResult : ''}`)),
    e.status === 'scheduled' ? h('div', { className: 'gm-actions' },
      btn('Запустить', 'Запустить сейчас', () => call('POST', `/api/admin/events/${e.id}/run`, {}).then((x) => { done(x.ran ? 'Сработало.' : 'Не сработало: нет игроков или места.'); events(); })),
      btn('Отменить', 'Отменить событие', () => call('DELETE', `/api/admin/events/${e.id}`).then(() => events()), 'btn small danger')) : ''));
  fill(h('div', { className: 'gm-actions' }, type, scope, field('через, мин', inMin), field('каждые, мин', every), field('длит., мин', dur)),
    h('div', { className: 'gm-actions' }, extra, btn('Добавить', 'Запланировать событие', add, 'btn small primary')),
    h('p', { className: 'small muted' }, 'Разовое событие ждёт, пока в мире есть игроки. Расписание хранится на сервере.'), ...rows);
}

// ---------- Журнал ----------
async function log() {
  const q = new URLSearchParams(Object.entries(logQuery).filter(([, v]) => v !== '' && v != null)).toString();
  const r = await call('GET', '/api/admin/log?' + q);
  const action = h('select', {}, h('option', { value: '' }, 'все действия'), r.actions.map((a) => h('option', { value: a, selected: a === logQuery.action }, a)));
  const target = h('input', { placeholder: 'Цель (аккаунт)', value: logQuery.target || '' });
  const who = h('input', { placeholder: 'Администратор', value: logQuery.admin || '' });
  const text = h('input', { placeholder: 'Текст', value: logQuery.text || '' });
  const apply = (page = 1) => { logQuery = { action: action.value, target: target.value.trim(), admin: who.value.trim(), text: text.value.trim(), page }; log(); };
  const rows = r.entries.map((e) => {
    const { time, admin, action: a, ...rest } = e;
    return h('div', { className: 'gm-row small' }, h('div', {}, h('b', {}, a), ` · ${admin} · ${new Date(time).toLocaleString('ru-RU')}`,
      h('div', { className: 'muted gm-json' }, Object.entries(rest).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '))));
  });
  fill(h('div', { className: 'gm-actions' }, action, target, who, text, btn('Найти', 'Применить фильтры', () => apply(1))),
    h('div', { className: 'gm-actions' }, btn('←', 'Новее', () => apply(r.page - 1)), `стр. ${r.page} из ${r.pages} · записей ${r.total}`, btn('→', 'Старее', () => apply(r.page + 1))),
    ...rows);
}

// ---------- Мир ----------
async function world() {
  const [w, b] = await Promise.all([call('GET', '/api/admin/worlds'), call('GET', '/api/admin/backups')]);
  const rows = w.worlds.map((x) => h('div', { className: 'gm-row' + (x.active ? ' online' : '') },
    h('div', {}, h('b', {}, x.name), x.id === ctx.worldId ? ' (вы здесь)' : '', ` · ${x.ownerName}`,
      h('div', { className: 'small muted' }, `${x.size} ${x.width}×${x.height} · сид ${x.seed} · враги ${x.enemyDensity} · орды ${x.hordeFrequency} · драконов ${x.dragons}${x.scaleToLevel ? ' · под уровень' : ''}${x.survival === false ? ' · без выживания' : ''}${x.ngPlus ? ' · НИ+' : ''} · ${x.open ? 'открыт' : 'закрыт'} · участников ${x.members} · в сети ${x.online}${x.enemies != null ? ` · врагов ${x.enemies}` : ''} · сохранён ${when(x.stateSavedAt)}`)),
    x.active ? btn('Сохранить', 'Сохранить мир сейчас (герои, враги, турели)', () => call('POST', `/api/admin/worlds/${x.id}/save`, {}).then(() => { done('Мир сохранён.'); world(); })) : ''));
  const label = h('input', { placeholder: 'Метка копии (латиница)', maxLength: 32 });
  fill(h('h4', {}, 'Миры'), ...rows,
    h('h4', {}, `Резервные копии (хранятся последние ${b.keep})`),
    h('div', { className: 'gm-actions' }, label, btn('Создать копию', 'Скопировать папку данных сейчас', () => call('POST', '/api/admin/backups', { label: label.value }).then(() => { done('Копия создана.'); world(); }), 'btn small primary')),
    h('p', { className: 'small muted' }, 'Восстановление — только при остановленном сервере: node server/backup.js restore <копия>.'),
    ...b.backups.slice(0, 20).map((x) => h('div', { className: 'gm-row small' }, `${x.id} · ${x.files} файлов · ${Math.round(x.bytes / 1024)} КБ`)));
}

async function server() {
  const worldId=ctx?.worldId||null;
  const { settings } = await call('GET', '/api/admin/server-settings'+(worldId?'?worldId='+encodeURIComponent(worldId):''));
  const difficulty = h('select', { className: 'gm-wide' }, window.Difficulty.MODES.map(x => h('option', { value: x.id }, x.label)));
  difficulty.value = settings.difficulty; difficulty.dataset.serverSetting = 'difficulty';
  const corpse = num(settings.corpseLifetimeSec, 0, 65536, '0 — трупы удаляются сразу');
  const respawn = num(settings.enemyRespawnSec, 0, 65536, '0 — готовые участки пополняются при ближайшей проверке');
  const population = num(settings.enemyPopulation, 0, 250, 'Цель колеблется на ±10%, плотность мира масштабирует её');
  const groundTtl = num(settings.groundItemTtlSec, 0, 65536, '0 — пропавшие предметы удаляются при следующей проверке сервера');
  const npcRespawn = num(settings.settlementNpcRespawnSec, 0, 65536, '0 — жители возвращаются при ближайшем тике');
  const questItemRespawn = num(settings.questItemRespawnSec, 0, 65536, '0 — сюжетный запас появляется снова при ближайшей проверке');
  corpse.dataset.serverSetting = 'corpseLifetimeSec'; respawn.dataset.serverSetting = 'enemyRespawnSec'; population.dataset.serverSetting = 'enemyPopulation'; groundTtl.dataset.serverSetting = 'groundItemTtlSec'; npcRespawn.dataset.serverSetting = 'settlementNpcRespawnSec'; questItemRespawn.dataset.serverSetting = 'questItemRespawnSec';
  const logging=settings.logging||{enabled:false,levels:{trace:true,debug:true,info:true,warn:true,error:true,fatal:true}};
  const logEnabled=h('input',{type:'checkbox',checked:logging.enabled});
  const logChecks=Object.fromEntries(['trace','debug','info','warn','error','fatal'].map(level=>[level,h('input',{type:'checkbox',checked:logging.levels[level]!==false})]));
  const save = () => call('POST', '/api/admin/server-settings', { worldId, difficulty: difficulty.value, corpseLifetimeSec: Number(corpse.value), enemyRespawnSec: Number(respawn.value), enemyPopulation: Number(population.value), groundItemTtlSec: Number(groundTtl.value), settlementNpcRespawnSec: Number(npcRespawn.value), questItemRespawnSec: Number(questItemRespawn.value), logging:{enabled:logEnabled.checked,levels:Object.fromEntries(Object.entries(logChecks).map(([k,v])=>[k,v.checked]))} })
    .then(r => { corpse.value = r.settings.corpseLifetimeSec; respawn.value = r.settings.enemyRespawnSec; population.value = r.settings.enemyPopulation; groundTtl.value = r.settings.groundItemTtlSec; npcRespawn.value = r.settings.settlementNpcRespawnSec; questItemRespawn.value = r.settings.questItemRespawnSec; difficulty.value = r.settings.difficulty; done('Настройки и уровни журнала применены сразу.'); });
  fill(h('h4', {}, 'Общие игровые настройки'),
    field('Сложность сервера', difficulty, 'Влияет на уровни и характеристики врагов, потери вещей при смерти и хардкорный сброс'),
    field('Хранить труп, секунд (0–65536)', corpse),
    field('Возрождение врагов, секунд (0–65536)', respawn),
    field('Цель врагов на активной карте (0–250)', population),
    field('Срок выпавших вещей, секунд (0–65536)', groundTtl, 'Постоянные предметы из тайников и заранее сгенерированных наград не удаляются'),
    field('Возрождение важных жителей, секунд (0–65536)', npcRespawn),
    field('Возрождение сюжетных материалов, секунд (0–65536)', questItemRespawn),
    h('h4', {}, 'Журнал сервера'),
    field('Сохранять копию журнала в log/', logEnabled, 'Выключите, чтобы оставлять записи только в консоли сервера.'),
    ...Object.entries(logChecks).map(([level,input])=>field(`Уровень ${level}`,input,'Показывать в серверной консоли и сохранять в файл, если он включён.')),
    btn('Применить', 'Изменить текущие настройки сервера и разослать их всем подключённым игрокам', save, 'btn small primary'),
    h('p', { className: 'small muted' }, 'Сложность и таймеры общие для сервера. Хардкор сбрасывает погибшего героя до 1-го уровня и стартового набора. При изменении численности сервер пересчитает цель для каждого открытого мира. Настройки по умолчанию задаются в config.json или при запуске через --set.'));
}
