// Чит-панель (шаг 20–21): F9 или 🧪 — администратору, а при game.cheatsForAll = true — всем (сервер проверяет доступ на каждое действие
// и пишет его в журнал администратора). Вкладки: «Я» (режим бога, герой, телепорт и время суток, предметы, спавн, знания и сюжет),
// «Персонажи» (любая цель: игрок — те же разделы «как для себя» с полем who; спутник, житель, враг — лечение, бессмертие, правка,
// приручение, клон…), «Стройка» (F7: поставить что угодно у курсора с призраком и поворотом R, ластик).
// Списки — с поиском по названию и id. «По щелчку» — следующий щелчок по карте выбирает точку (телепорт, спавн у курсора).
import { weSetGhost, weSetHighlight } from './game/worldedit-ui.js';
import { floatingWindow,replacePanelContents } from './floating-window.js';
const $ = (sel) => document.querySelector(sel);

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v; else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}
const btn = (text, title, onclick) => h('button', { type: 'button', className: 'btn small', title, onclick }, text);
const num = (value, min, max, title, width = '5em') => h('input', { type: 'number', value, min, max, title, style: `width:${width}` });
const row = (...kids) => h('div', { className: 'cheat-row' }, ...kids);
const section = (title, tip, ...kids) => h('fieldset', { className: 'cheat-sec', title: tip }, h('legend', {}, title), ...kids);

// Список с поиском: [{ id, name, hint? }] → { el, value() }
export function searchList(list, placeholder, size = 6) {
  const q = h('input', { type: 'search', placeholder, title: 'Поиск по названию или id' });
  const sel = h('select', { size, className: 'cheat-list' });
  let page=0,matches=list;
  const status=h('span',{className:'small muted','aria-live':'polite'});
  const previous=btn('◀','Предыдущие 300 предметов',()=>{page=Math.max(0,page-1);fill();});
  const next=btn('▶','Следующие 300 предметов',()=>{page++;fill();});
  previous.dataset.nativeIcon=next.dataset.nativeIcon='true';
  const fill = () => {
    matches=filterList(list,q.value.trim().toLowerCase());const pages=Math.max(1,Math.ceil(matches.length/300));page=Math.min(page,pages-1);
    const selected=sel.value;
    sel.replaceChildren(...matches.slice(page*300,(page+1)*300).map(x=>h('option',{value:x.id,title:x.hint||x.id},`${x.name} · ${x.id}`)));
    if([...sel.options].some(o=>o.value===selected))sel.value=selected;else if(sel.options.length)sel.selectedIndex=0;
    status.textContent=`${matches.length} найдено · ${page+1}/${pages}`;previous.disabled=page===0;next.disabled=page===pages-1;
  };
  q.addEventListener('input',()=>{page=0;fill();});fill();
  return {el:h('div',{className:'cheat-search'},q,sel,row(previous,status,next)),value:()=>sel.value};
}
export const filterList = (list,s) => {
  const norm=v=>v.toLowerCase().replaceAll('ё','е');const words=norm(s).split(/\s+/).filter(Boolean);
  return words.length?list.filter(x=>{const haystack=norm(x.name+' '+x.id);return words.every(word=>haystack.includes(word));}):list;
};

let ctx = null; // { send, toast, renderer(), character(), mouse() }
let info = null, pick = null;
let tab = 'me'; // me | chars | build
let rowsAll = [], target = null, whois = null, listQuery = '';
const bs = { cat: 'enemy', id: '', name: '', rot: 0, level: 1, elite: false, count: 1, repeat: true, mode: null }; // стройка; mode: place | erase | null
let refillList = null, listTimer = null;
let cheatWindow = null;

export function initCheats() {
  $('#btn-cheat').addEventListener('click', () => cheatToggle());
  cheatWindow = floatingWindow($('#cheat-panel'), { header: '.gm-head' });
}
function windowHeader() {
  const heal = btn('❤ Вылечить себя', 'Полное лечение и воскрешение своего героя', () => send({ a: 'heal' }));
  heal.classList.add('floating-expanded-only');
  return h('div', { className: 'gm-head' }, h('b', {}, '🧪 Чит-панель'), heal,
    h('button', { type: 'button', className: 'btn small', 'data-window-minimize': '', title: 'Свернуть', 'aria-label': 'Свернуть' }, '−'),
    btn('✕', 'Закрыть (F9 / Esc)', () => cheatToggle(false)));
}
function corpsesSection() {
  const seconds = num(window.GameSettings.corpseLifetimeSec ?? 60, 0, 65536, '0 — исчезают сразу; настройка общая для всех игроков'); seconds.dataset.serverSetting = 'corpseLifetimeSec';
  const difficulty = h('select', { title: 'Сложность общая для всего сервера' }, window.Difficulty.MODES.map(x => h('option', { value: x.id }, x.label)));
  difficulty.value = window.GameSettings.difficulty || 'normal'; difficulty.dataset.serverSetting = 'difficulty';
  const groundTtl = num(window.GameSettings.groundItemTtlSec ?? 7200, 0, 65536, 'срок выпавших предметов; постоянные тайники сохраняются'); groundTtl.dataset.serverSetting = 'groundItemTtlSec';
  const npcRespawn = num(window.GameSettings.settlementNpcRespawnSec ?? 300, 0, 65536, 'возврат жителей после смерти; 0 — сразу'); npcRespawn.dataset.serverSetting = 'settlementNpcRespawnSec';
  const questItemRespawn = num(window.GameSettings.questItemRespawnSec ?? 300, 0, 65536, 'повторная выдача активных сюжетных материалов после поднятия; 0 — сразу'); questItemRespawn.dataset.serverSetting = 'questItemRespawnSec';
  return section('Сложность и сроки', 'Общие параметры сервера. На тяжёлых режимах вещи могут выпадать при смерти, хардкор сбрасывает героя до начала.',
    row('Режим:', difficulty), row('Время трупа, с:', seconds, 'Выпавшие вещи, с:', groundTtl),
    row('Возврат важных жителей, с:', npcRespawn, 'Сюжетные материалы, с:', questItemRespawn),
    btn('Применить', 'Настроить сервер и обновить параметры для всех миров', () => send({ a: 'difficulty', difficulty: difficulty.value, groundItemTtlSec: Number(groundTtl.value), corpseLifetimeSec: Number(seconds.value), enemyRespawnSec: Number(window.GameSettings.enemyRespawnSec ?? 90), enemyPopulation: Number(window.GameSettings.enemyPopulation ?? 100), settlementNpcRespawnSec: Number(npcRespawn.value), questItemRespawnSec: Number(questItemRespawn.value) })));
}
export function cheatAttach(c) {
  ctx = c;
  $('#btn-cheat').classList.toggle('hidden', !c.allowed);
  if (!c.allowed) cheatToggle(false);
}
export function cheatDetach() { ctx = null; info = null; pick = null; target = null; whois = null; stopBuild(); cheatToggle(false); $('#btn-cheat').classList.add('hidden'); }
export const cheatIsOpen = () => !$('#cheat-panel').classList.contains('hidden');
export function cheatToggle(force, toTab) {
  if (!ctx || !ctx.allowed) force = false;
  const p = $('#cheat-panel');
  const open = force === undefined ? p.classList.contains('hidden') : force;
  const wasClosed = p.classList.contains('hidden');
  p.classList.toggle('hidden', !open);
  if (open && wasClosed) cheatWindow?.open();
  if (!open) cheatWindow?.close();
  $('#btn-cheat').classList.toggle('active', open);
  if (toTab) tab = toTab;
  clearInterval(listTimer); listTimer = null;
  if (open) {
    if (!info) replacePanelContents(p,windowHeader(), h('p', {}, 'Загрузка…'));
    else render();
    cheatWindow?.refresh();
    ctx.send({ t: 'cheat', a: 'info' });
    listTimer = setInterval(() => { if (tab === 'chars' && cheatIsOpen()) send({ a: 'list' }); }, 2000); // положение и здоровье целей
  } else { pick = null; stopBuild(); }
  updateHighlight();
}
export function cheatsCanOpen() { return Boolean(ctx && ctx.allowed); }
const send = (msg) => ctx && ctx.send({ t: 'cheat', ...msg });
// Щелчок по карте поглощён панелью, если ждём точку или включена стройка
export function cheatMapClick(w) {
  const pt = { x: Math.round(w.x * 100) / 100, y: Math.round(w.y * 100) / 100 };
  if (pick) { const cb = pick; pick = null; cb(pt); return true; }
  if (!bs.mode || !cheatIsOpen()) return false;
  if (bs.mode === 'erase') send({ a: 'erase', ...pt });
  else if (bs.id) send({ a: 'place', cat: bs.cat, id: bs.id, rot: bs.rot, level: bs.level, elite: bs.elite, count: bs.count, ...pt });
  if (!bs.repeat) stopBuild();
  return true;
}
function pickPoint(what, cb) { pick = cb; ctx.toast(`Щёлкните по карте: ${what}. Esc — отмена.`, 3000); }
export function cheatCancelPick() {
  if (pick) { pick = null; return true; }
  if (bs.mode) { stopBuild(); if (cheatIsOpen() && tab === 'build') render(); return true; }
  return false;
}
function stopBuild() { bs.mode = null; weSetGhost(null); }
function syncGhost() { weSetGhost(bs.mode ? { cat: bs.cat, id: bs.id, rot: bs.rot, name: bs.name, erase: bs.mode === 'erase' } : null); }
// Клавиши, пока стройка включена: R — поворот (true — клавиша поглощена)
export function cheatKey(e) {
  if (!bs.mode || e.code !== 'KeyR' || e.ctrlKey || e.altKey) return false;
  bs.rot = (bs.rot + 1) % 4; syncGhost();
  const r = document.querySelector('#cheat-rot'); if (r) r.textContent = `${bs.rot * 90}°`;
  return true;
}
function updateHighlight() {
  weSetHighlight(cheatIsOpen() && tab === 'chars' && target ? () => (target && target.x != null ? { x: target.x, y: target.y } : null) : null);
}

// Ответы сервера: cheat-info, cheat-ok, cheat-err; god — обновить флажки
export function cheatOnMsg(msg) {
  if (!ctx) return false;
  if (msg.t === 'cheat-info') { info = msg; render(); if (tab === 'chars') send({ a: 'list' }); return true; }
  if (msg.t === 'cheat-ok') {
    if (msg.text && msg.a !== 'list' && msg.a !== 'whois') ctx.toast('🧪 ' + msg.text, 2500);
    if (msg.god && info) info.god = msg.god;
    if (msg.a === 'list') { rowsAll = msg.list || []; if (target) { const t = rowsAll.find((r) => r.k === target.k && r.id === target.id); if (t) target = t; } if (refillList) refillList(); return true; }
    if (msg.a === 'whois') { whois = msg.whois; if (tab === 'chars') render(); return true; }
    if (msg.tgod && whois && msg.who === whois.id) whois.god = msg.tgod;
    if (msg.a === 'pick' && msg.target) { selectTarget(msg.target); return true; }
    if (msg.a === 't' || msg.a === 'allmine' || msg.a === 'place' || (target && target.k === 'p' && ['god', 'edit', 'heal'].includes(msg.a))) {
      if (msg.a === 't') { target = msg.target || null; updateHighlight(); }
      if (tab === 'chars') { send({ a: 'list' }); if (target && target.k === 'p' && target.kind !== 'вы') send({ a: 'whois', who: target.id }); else if (msg.a === 't') render(); }
    }
    return true;
  }
  if (msg.t === 'cheat-err') { ctx.toast('🧪 ' + msg.message, 3500); return true; }
  return false;
}
export function cheatOnGod(god) { if (info) { info.god = god; if (cheatIsOpen() && tab === 'me') render(); } }
function selectTarget(r) {
  target = r; whois = null;
  if (r && r.k === 'p') send({ a: 'whois', who: r.id });
  updateHighlight();
  render();
}

// ---------- Разделы «как для себя»; who — id игрока-цели (нет — вы) ----------
function godSection(who, g) {
  g = g || {};
  const w = who ? { who } : {};
  const chk = (k, label, tip) => h('label', { className: 'check', title: tip }, h('input', { type: 'checkbox', checked: Boolean(g[k]), onchange: (e) => send({ a: 'god', god: { [k]: e.target.checked }, ...w }) }), ' ' + label);
  const flagSet = (keys, on) => send({ a: 'god', god: Object.fromEntries(keys.map((key) => [key, on])), ...w });
  const allGod = ['invulnerable','infinite','infiniteAmmo','infiniteMoney','superAttack','instantMagic','noclip','freeBuild','invisible','nofog'];
  const sp = h('input', { type: 'range', min: 1, max: info.speedMax || 5, step: 0.5, value: g.speed || 1, title: 'Множитель скорости (1 — обычная)' });
  const spv = h('span', {}, `×${g.speed || 1}`);
  sp.addEventListener('input', () => { spv.textContent = `×${sp.value}`; });
  sp.addEventListener('change', () => send({ a: 'god', god: { speed: Number(sp.value) }, ...w }));
  return section('Режим бога', 'Флаги действуют, пока игрок в сети; сервер проверяет их сам',
    row(btn('Выбрать всё', 'Включить все переключатели режима бога', () => flagSet(allGod, true)), btn('Снять всё', 'Выключить все переключатели режима бога', () => flagSet(allGod, false))),
    row(chk('invulnerable', 'Бессмертие', 'Не получать урона ни от кого'), chk('infinite', 'Бесконечные шкалы', 'Выносливость и мана всегда полные'), chk('infiniteAmmo', 'Герой: бесконечные патроны', 'Стрелять из оружия героя без расхода боеприпасов; работает независимо от бесконечных шкал'), chk('infiniteMoney', 'Бесконечные деньги', 'Покупки у торговцев, лекарей, магов и мастеров бесплатны'), chk('superAttack', 'Суперудар всегда готов', 'Суперудар без накопления: кнопка звезды в панели боя'), chk('instantMagic', 'Мгновенная магия', 'Без чтения, перезарядки и расхода маны'), chk('noclip', 'Сквозь препятствия', 'Ходить по воде, горам и скалам; телепорт в любую точку')),
    row(chk('freeBuild', 'Стройка бесплатно', 'Строительство (B) без ресурсов и чертежей — на своей базе'), chk('invisible', 'Невидимость', 'Враги и игроки не видят'), chk('nofog', 'Без тумана', 'Туман войны выключен: видна вся карта и все враги в радиусе интереса (шаг 22)')),
    row(h('span', { title: 'Быстрое передвижение' }, 'Скорость: '), sp, spv));
}

function vehicleCheatsSection(god) {
  god = god || {};
  const allVehicles = ['vehicleInvulnerable','vehicleFuel','vehicleParts','vehicleAmmo'];
  const toggle = (key, label, title) => h('label', { className: 'check', title },
    h('input', { type: 'checkbox', checked: Boolean(god[key]), onchange: (e) => send({ a: 'god', god: { [key]: e.target.checked } }) }), ' ' + label);
  return section('Транспорт', 'Действия применяются к машине, в которой вы сидите, или к ближайшей машине. Бесконечные топливо и боезапас — отдельные переключатели.',
    row(btn('Выбрать всё', 'Включить все переключатели читов транспорта', () => send({ a: 'god', god: Object.fromEntries(allVehicles.map((key) => [key, true])) })), btn('Снять всё', 'Выключить все переключатели читов транспорта', () => send({ a: 'god', god: Object.fromEntries(allVehicles.map((key) => [key, false])) }))),
    row(toggle('vehicleInvulnerable', 'Машина не получает урон', 'Машина не ломается, пока вы находитесь в ней'), toggle('vehicleFuel', 'Бесконечное топливо', 'Для техники, в которой вы сидите: бак не расходуется и остаётся полным'), toggle('vehicleParts', 'Бесконечные запчасти', 'Ремонт транспорта не тратит автозапчасти'), toggle('vehicleAmmo', 'Бесконечный бортовой боезапас', 'Оружие машины стреляет без расхода патронов')),
    row(btn('🔧 Полностью починить', 'Восстановить всю прочность ближайшей или занятой машины', () => send({ a: 'vehicle', op: 'repair' })),
      btn('⛽ Заполнить бак', 'Мгновенно заполнить бак занятой или ближайшей машины', () => send({ a: 'vehicle', op: 'refuel' })),
      btn('🎯 Пополнить боезапас', 'Добавить в сумку один полный боекомплект для бортового оружия машины', () => send({ a: 'vehicle', op: 'ammo' }))),
    h('p', { className: 'hint' }, 'Чтобы выбрать ближайшую машину, подойдите к ней. Если вы уже внутри, действия применятся к ней. Бесконечное топливо и бортовые патроны можно включать и выключать отдельно.'));
}

function heroSection(who, ch) {
  const R = window.CharacterRules, max = window.Combat.settings.maxLevel, w = who ? { who } : {};
  ch = ch || {};
  const lv = num(ch.level || 1, 1, max, `Уровень 1…${max}`), xp = num('', 0, 1e9, 'Опыт внутри уровня (пусто — не менять)'), pts = num('', 0, 999, 'Свободные очки характеристик (пусто — не менять)');
  const stats = R.STATS.map((s) => [s.id, num((ch.stats || {})[s.id] || 1, R.STAT_MIN, 1000000, `${s.label}: чит-значение до 1000000; обычные игровые пределы сняты`, '5em'), s.label]);
  const slotMin = (window.Inventory && window.Inventory.settings.baseSlots) || 1024;
  const slots = num('', slotMin, 65536, `Навык «Инвентарь»: ячеек ${slotMin}…65536; сейчас ${ch.inventorySlots || (ch.inventory && ch.inventory.cells && ch.inventory.cells.length) || slotMin}`, '7em');
  const vit = [['hp', 'Здоровье'], ['stamina', 'Выносл.'], ['mp', 'Мана'], ['food', 'Сытость'], ['water', 'Вода'], ['rest', 'Бодрость'], ['rad', 'Радиация']].map(([k, l]) => [k, num('', 0, 9999, `${l} (пусто — не менять; сытость, вода, бодрость, радиация — 0…100)`, '4.5em'), l]);
  const apply = () => {
    const edit = { level: Number(lv.value), stats: Object.fromEntries(stats.map(([k, i]) => [k, Number(i.value)])) };
    if (slots.value !== '') edit.inventorySlots = Number(slots.value);
    if (xp.value !== '') edit.xp = Number(xp.value);
    if (pts.value !== '') edit.unspentPoints = Number(pts.value);
    for (const [k, i] of vit) if (i.value !== '') edit[k] = Number(i.value);
    edit.cheat = true; // чит-панель может превышать обычные игровые пределы характеристик
    send({ a: 'edit', edit, ...w });
  };
  return section('Герой', 'Уровень, опыт, очки, характеристики и шкалы — как в панели администратора «Персонажи»',
    row('Уровень ', lv, ' опыт ', xp, ' очки ', pts),
    h('div', { className: 'cheat-grid' }, stats.map(([, i, l]) => h('label', { title: i.title }, l, i))),
    row('Ячейки инвентаря ', slots),
    h('div', { className: 'cheat-grid' }, vit.map(([, i, l]) => h('label', { title: i.title }, l, i))),
    row(btn('Применить', 'Сохранить уровень, характеристики и шкалы', apply), btn('❤ Лечение / воскрешение', 'Здоровье, выносливость, мана, сытость, вода, бодрость — полные; радиация и болезнь сняты; мёртвый — воскрешён', () => send({ a: 'heal', ...w }))));
}

function travelSection() {
  const towns = h('select', { title: 'Поселение этого мира' }, (info.towns || []).map((t) => h('option', { value: t.id }, t.name)));
  const z = num(0, -9, 9, 'Уровень по высоте: 0 — поверхность, −1 — подземелье под ближайшим входом, 1 — вверх');
  const hour = h('input', { type: 'range', min: 0, max: 24, step: 0.5, value: 12, title: 'Час суток (только освещение на вашем экране)' });
  const hv = h('span', {}, 'как в мире');
  const r = ctx.renderer();
  if (r && typeof r.phaseOverride === 'number') { hour.value = r.phaseOverride * 24; hv.textContent = `${hour.value} ч`; }
  hour.addEventListener('input', () => { const rr = ctx.renderer(); if (rr) rr.phaseOverride = Number(hour.value) / 24; hv.textContent = `${hour.value} ч`; });
  return section('Перемещение и время', 'Телепорт по щелчку, в поселение или на другой уровень; время суток',
    row(btn('📍 По щелчку', 'Следующий щелчок по карте — телепорт туда (в непроходимое место — с «Сквозь препятствия»)', () => pickPoint('куда телепортироваться', (p) => send({ a: 'tp', ...p }))),
      towns, btn('В поселение', 'Телепорт к выбранному поселению', () => send({ a: 'tp', town: Number(towns.value) }))),
    row('Уровень ', z, btn('Перейти', 'Сменить уровень: подземелье, бункер, башня', () => send({ a: 'tp', level: z.value }))),
    row('Время суток ', hour, hv, btn('Как в мире', 'Вернуть настоящий цикл дня и ночи', () => { const rr = ctx.renderer(); if (rr) rr.phaseOverride = null; hv.textContent = 'как в мире'; })),
    h('p', { className: 'hint' }, 'Время суток меняет только освещение на вашем экране (художественная графика): сервер не ведёт общего времени суток.'));
}

function itemsSection(who) {
  const w = who ? { who } : {};
  const list = searchList(window.Items.ITEMS.filter((i) => !i.fixed).map((i) => ({ id: i.id, name: i.name, hint: i.desc })), 'Найти предмет…');
  const n = num(1, 1, (window.Inventory && window.Inventory.settings.itemActionMax) || 9999, 'Количество');
  const money = num(1000, 1, Number.MAX_SAFE_INTEGER - 100, 'Сколько денег (крышки)');
  return section('Предметы', 'Любой предмет из каталога — в сумку, из сумки или на землю',
    btn('🚩', 'Выдать флаг базы в сумку: используйте его на свободном участке', () => send({a:'give',item:'base_flag',count:1,...w})),
    list.el, row('Кол-во ', n, btn('В сумку', 'Выдать в инвентарь', () => send({ a: 'give', item: list.value(), count: Number(n.value), ...w })),
      btn('Забрать', 'Забрать из инвентаря (сколько есть, не больше указанного)', () => send({ a: 'take', item: list.value(), count: Number(n.value), ...w })),
      who ? null : btn('На землю у курсора', 'Щёлкните по карте — предмет появится там', () => pickPoint('где положить предмет', (p) => send({ a: 'spawn', kind: 'item', id: list.value(), count: Number(n.value), ...p })))),
    row('Деньги ', money, btn('💰 Добавить', 'Крышки — в сумку', () => send({ a: 'money', count: Number(money.value), ...w }))));
}

// Списки существ для спавна и стройки
function spawnKinds() {
  const E = window.Enemies.ENEMIES, Cm = window.Companions;
  return {
    enemy: E.map((e) => ({ id: e.id, name: e.name + (e.tags && e.tags.includes('dragon') ? ' 🐉' : e.boss ? ' 👑' : ''), hint: e.desc })),
    companion: E.filter((e) => Cm && Cm.kindOf(e)).map((e) => ({ id: e.id, name: e.name + (e.tags && e.tags.includes('dragon') ? ' 🐉' : ''), hint: e.desc })),
    npc: (info.roles || []).map((r) => ({ id: r.id, name: r.name })),
    vehicle: window.Vehicles.LIST.map((v) => ({ id: v.id, name: v.name, hint: v.desc })),
  };
}
const lvlInput = (v, kind = 'enemy') => num(v, 1, kind === 'enemy' ? ((window.GameSettings && window.GameSettings.maxEnemyLevel) || 99) : ((window.Combat && window.Combat.settings.maxLevel) || 999), kind === 'enemy' ? 'Уровень врага (макс. 99)' : 'Уровень существа', '4em');
const eliteBox = (v) => h('input', { type: 'checkbox', checked: v, title: 'Элита (только враги): здоровье ×2, урон ×1.5, опыт ×2' });

function spawnSection() {
  const kinds = spawnKinds();
  const names = { enemy: 'Враг / дракон / босс', companion: 'Спутник (и дракон)', npc: 'Житель (стражник, торговец…)', vehicle: 'Техника (ваша)' };
  const kind = h('select', { title: 'Кого создать' }, Object.entries(names).map(([k, l]) => h('option', { value: k }, l)));
  const box = h('div');
  const n = num(1, 1, 50, 'Сколько (враги)', '4em'), lv = lvlInput(1, 'enemy'), el = eliteBox(false);
  let list = null;
  const fill = () => { list = searchList(kinds[kind.value], 'Найти…'); box.replaceChildren(list.el); };
  kind.addEventListener('change', fill);
  fill();
  const go = (p) => send({ a: 'spawn', kind: kind.value, id: list.value(), count: Number(n.value), level: Number(lv.value), elite: el.checked, ...(p || {}) });
  const respawn = num(window.GameSettings.enemyRespawnSec ?? 90, 0, 65536, 'таймер возрождения после зачистки, 0 — сразу', '5em'); respawn.dataset.spawnSetting = 'enemyRespawnSec'; respawn.dataset.serverSetting = 'enemyRespawnSec';
  const population = num(window.GameSettings.enemyPopulation ?? 100, 0, 250, 'целевая численность на активной карте; случайная цель ±10%', '5em'); population.dataset.spawnSetting = 'enemyPopulation'; population.dataset.serverSetting = 'enemyPopulation';
  return section('Спавн', 'Общие для мира настройки: освобождённые участки возрождаются по таймеру; случайные группы постепенно заполняют активную карту до цели ±10%. Враги, драконы, спутники, жители и техника — рядом или у курсора.',
    row('Таймер, с ', respawn, ' Цель врагов ', population, btn('Применить для всех', 'Применить настройки спавна в мире', () => send({ a: 'spawning', enemyRespawnSec: Number(respawn.value), enemyPopulation: Number(population.value) }))),
    row(kind, ' кол-во ', n), row('Уровень ', lv, h('label', { className: 'check', title: el.title }, el, ' элита')), box,
    row(btn('Рядом со мной', 'Создать рядом с героем', () => go()), btn('У курсора', 'Щёлкните по карте — создать там', () => pickPoint('где создать', go)),
      btn(`☠ Убить всех рядом`, `Убить врагов в радиусе ${info.killRadius} клеток (с наградой)`, () => send({ a: 'kill' }))));
}

function knowSection(who) {
  const w = who ? { who } : {};
  const schools = h('select', { title: 'Школа магии' }, h('option', { value: 'all' }, 'все школы'), (info.schools || []).map((s) => h('option', { value: s }, s)));
  return section('Знания и карта', 'Открыть рецепты, выучить заклинания школ магии, открыть карту (туман войны)',
    row(btn('📜 Все рецепты', 'Открыть все рецепты крафта и чертежи', () => send({ a: 'recipes', ...w })), schools, btn('✨ Изучить', 'Изучить все заклинания выбранной школы', () => send({ a: 'spells', school: schools.value, ...w }))),
    row(btn('🗺 Открыть карту', 'Разведать всю карту текущего уровня (туман войны; при общей разведке — для всех в мире)', () => send({ a: 'reveal', ...w }))));
}

function worldSection() {
  const towns = h('select', { title: 'Поселение' }, (info.towns || []).map((t) => h('option', { value: t.id }, t.name)));
  const rep = num(100, -100, 100, 'Репутация −100…100');
  const fac = h('select', { title: 'Фракция' }, h('option', { value: '' }, '— поселение —'), (info.factions || []).map((f) => h('option', { value: f.id }, f.name)));
  const end = h('select', { title: 'Какая концовка' }, (info.endings || []).map((e) => h('option', { value: e.id }, e.name)));
  return section('Репутация и сюжет', 'Задать репутацию, завершить задания, запустить концовку',
    row(fac, towns, rep, btn('Задать', 'Репутация у фракции (если выбрана) или в поселении', () => send({ a: 'rep', faction: fac.value || undefined, sid: Number(towns.value), value: Number(rep.value) }))),
    row(btn('✔ Завершить задания', 'Завершить все взятые задания мира (с наградой)', () => send({ a: 'quests' })), end, btn('Концовка', 'Запустить выбранную концовку (титры, Новая игра+)', () => { if (confirm('Запустить концовку?')) send({ a: 'ending', ending: end.value }); })));
}

// ---------- Вкладка «Персонажи» ----------
const ICONS = { p: '🧑', c: '🐾', n: '🏘', e: '👹', d: '☠' };
const rowText = (r) => `${ICONS[r.k] || ''} ${r.name} · ${r.kind}${r.mine ? ' (мой)' : r.owner ? ` (${r.owner})` : ''} · ур.${r.lvl} · ${r.hp}/${r.max}${r.down ? ' ☠' : ''}${r.god ? ' 🛡' : ''}${r.out === 0 ? ' · не в мире' : ''}`;
function charsTab() {
  const q = h('input', { type: 'search', placeholder: 'Найти цель…', value: listQuery, title: 'Поиск по имени и виду' });
  const sel = h('select', { size: 8, className: 'cheat-list', title: 'Игроки, спутники (свои и чужие, драконы), семья и жители, враги рядом' });
  refillList = () => {
    const s = listQuery.trim().toLowerCase();
    const list = rowsAll.filter((r) => !s || r.name.toLowerCase().includes(s) || r.kind.toLowerCase().includes(s));
    const cur = target ? target.k + ':' + target.id : '';
    sel.replaceChildren(...list.map((r) => h('option', { value: r.k + ':' + r.id, selected: r.k + ':' + r.id === cur }, rowText(r))));
    const head = document.querySelector('#cheat-target-head');
    if (head && target) head.textContent = rowText(target);
  };
  q.addEventListener('input', () => { listQuery = q.value; refillList(); });
  sel.addEventListener('change', () => { const [k, ...rest] = sel.value.split(':'); const r = rowsAll.find((x) => x.k === k && x.id === rest.join(':')); if (r) selectTarget(r); });
  refillList();
  const out = [
    section('Цель', 'Выберите персонажа из списка или щелчком по миру (подсвечивается в мире)',
      q, sel,
      row(btn('🎯 Щелчком по миру', 'Следующий щелчок по персонажу на карте — выбрать его целью', () => pickPoint('по персонажу', (p) => send({ a: 'pick', ...p }))),
        btn('↻ Обновить', 'Обновить список (обновляется сам каждые 2 с)', () => send({ a: 'list' })),
        btn('Я', 'Выбрать целью себя', () => { const me = rowsAll.find((r) => r.k === 'p' && r.kind === 'вы'); if (me) selectTarget(me); }))),
    section('Все мои спутники', 'Сразу для всех ваших спутников',
      row(btn('❤ Вылечить всех', 'Поднять и вылечить всех спутников', () => send({ a: 'allmine', what: 'heal' })),
        btn('🛡 Бессмертие всем', 'Включить бессмертие всем спутникам', () => send({ a: 'allmine', what: 'god', on: true })),
        btn('Снять', 'Выключить бессмертие всем спутникам', () => send({ a: 'allmine', what: 'god', on: false })))),
  ];
  if (target) out.push(...targetCard(target));
  return out;
}
function targetCard(t) {
  const T = (op, extra) => send({ a: 't', k: t.k, id: t.id, op, ...(extra || {}) });
  const head = h('p', { id: 'cheat-target-head', className: 'cheat-target' }, rowText(t));
  if (t.k === 'd') {
    const lv = num(t.lvl || 1, 1, 100000, 'Уровень существа', '5em');
    const def = searchList(window.Enemies.ENEMIES.map((e) => ({ id: e.id, name: e.name, hint: e.desc })), 'Заменить вид существа…');
    const players = rowsAll.filter((r) => r.k === 'p');
    const owner = h('select', { title: 'Игрок, которому отдать существо как спутника' }, players.map((r) => h('option', { value: r.id }, r.name)));
    return [section('Труп существа', 'Измените вид и уровень, воскресите врагом или сделайте спутником выбранного игрока. При вербовке трофеи трупа исчезают.',
      head, row(def.el, 'Уровень ', lv), row('Спутник игроку ', owner,
        btn('Сохранить правку', 'Изменить вид и уровень трупа', () => T('edit', { edit: { level: Number(lv.value), def: def.value() } })),
        btn('Воскресить врагом', 'Поднять существо врагом с сохранёнными параметрами', () => T('revive')),
        btn('Сделать спутником', 'Добавить существо в команду выбранного игрока, включая команды больше 11', () => T('recruit', { who: owner.value })) ))];
  }
  const common = row(
    btn('📍 Ко мне', 'Перенести цель к вам', () => T('tphere')), btn('➜ К цели', 'Телепорт к цели', () => T('tpto')),
    btn('☠ Убить', t.k === 'c' ? 'Спутник — без сознания' : 'Убить (враг — с наградой)', () => T('kill')));
  if (t.k === 'p') {
    const isMe = t.kind === 'вы';
    if (!isMe && !whois) return [section('Игрок', '', head, common, h('p', {}, 'Загрузка…'))];
    const who = isMe ? null : t.id;
    return [section('Игрок', 'Всё — как для себя: режим бога, герой, предметы, знания', head, common),
      godSection(who, isMe ? info.god : whois.god), heroSection(who, isMe ? ctx.character() : whois), itemsSection(who), knowSection(who)];
  }
  const lv = t.k === 'c' ? num(t.lvl || 1, 1, 100000, 'Уровень спутника — расширенный чит-диапазон', '4em') : lvlInput(t.lvl || 1, t.k === 'e' ? 'enemy' : t.k === 'p' ? 'hero' : 'other'), mhp = num('', 1, 1000000000, 'Макс. здоровье (пусто — не менять)', '5.5em'), hp = num('', 0, 1000000000, 'Здоровье сейчас (пусто — не менять)', '5.5em');
  const dmg = num('', 0.1, 100000, 'Урон — множитель (1 — обычный; пусто — не менять)', '4em'), spd = num('', 0.1, 100000, 'Скорость — множитель (пусто — не менять)', '4em'), skill = t.k === 'c' ? num('', 0.1, 100000, 'Навык спутника — множитель урона', '4em') : null;
  dmg.step = 0.1; spd.step = 0.1;
  const extra = t.k === 'c' ? ['Сытость', num('', 0, 100, 'Сытость спутника 0…100 (вместо верности)', '4em'), 'food']
    : t.k === 'n' ? ['Отношение', num('', -100, 100, 'Отношение жителя к вам −100…100 (симпатия)', '4em'), 'affinity'] : null;
  const el = t.k === 'e' ? eliteBox(/элита/.test(t.name)) : null;
  const apply = () => {
    const edit = { level: Number(lv.value) };
    for (const [k, i] of [['maxHp', mhp], ['hp', hp], ['dmg', dmg], ['speed', spd], ['skill', skill]]) if (i && i.value !== '') edit[k] = Number(i.value);
    if (extra && extra[1].value !== '') edit[extra[2]] = Number(extra[1].value);
    if (el) edit.elite = el.checked;
    T('edit', { edit });
  };
  const names = { c: 'Спутник', n: 'Житель', e: 'Враг' };
  return [section(names[t.k], 'Лечение, бессмертие, правка характеристик и другие действия над целью', head,
    row(btn(t.down ? '❤ Поднять' : '❤ Вылечить', 'Полное здоровье; спутник без сознания — снова на ногах', () => T('heal')),
      h('label', { className: 'check', title: 'Бессмертие цели: урон не проходит' }, h('input', { type: 'checkbox', checked: Boolean(t.god), onchange: (e) => T('god', { on: e.target.checked }) }), ' бессмертие')),
    common,
    h('div', { className: 'cheat-grid' }, h('label', { title: lv.title }, 'Уровень', lv), h('label', { title: mhp.title }, 'Макс. HP', mhp), h('label', { title: hp.title }, 'HP', hp),
      h('label', { title: dmg.title }, 'Урон ×', dmg), h('label', { title: spd.title }, 'Скорость ×', spd),
      skill ? h('label', { title: skill.title }, 'Навык ×', skill) : null,
      extra ? h('label', { title: extra[1].title }, extra[0], extra[1]) : null, el ? h('label', { title: el.title }, 'Элита', el) : null),
    row(btn('Применить', 'Сохранить уровень и характеристики цели (по правилам роста уровня)', apply),
      btn('⧉ Клон', 'Создать копию рядом', () => T('clone')),
      t.k === 'e' ? btn('🤝 Приручить', 'Сделать вашим спутником сразу (если вид приручаемый)', () => T('tame')) : null,
      t.k === 'c' ? btn('Отпустить', 'Спутник уходит навсегда', () => { if (confirm(`Отпустить ${t.name}?`)) T('dismiss'); }) : null,
      t.k !== 'c' ? btn('Убрать', 'Убрать из мира без награды', () => T('dismiss')) : null))];
}

// ---------- Вкладка «Стройка» ----------
function buildItems(cat) {
  const W = window.WorldEdit;
  if (cat === 'piece') return (window.Building ? window.Building.PIECES : []).map((p) => ({ id: p.id, name: p.name, hint: p.desc }));
  if (cat === 'obj') return Object.entries(W.OBJECTS).map(([id, name]) => ({ id, name }));
  if (cat === 'bld') return Object.entries(W.BUILDINGS).map(([id, name]) => ({ id, name, hint: 'Здание 4×4, дверь с юга (R — поворот); вид как в поселении, без жителей' }));
  if (cat === 'cache') return Object.entries(W.CACHES).map(([id, name]) => ({ id, name, hint: 'Щелчок рядом — открыть, добыча высыпается (уровень — сила добычи)' }));
  if (cat === 'node') return Object.entries(W.NODES).map(([id, n]) => ({ id, name: n.name, hint: 'Добывается как обычная ресурсная точка' }));
  return spawnKinds()[cat] || [];
}
function buildTab() {
  const W = window.WorldEdit;
  const cat = h('select', { title: 'Категория' }, Object.entries(W.CATS).map(([k, l]) => h('option', { value: k, selected: k === bs.cat }, l)));
  const box = h('div');
  let list = null;
  const choose = () => { bs.id = list.value(); const it = buildItems(bs.cat).find((x) => x.id === bs.id); bs.name = it ? it.name : bs.id; syncGhost(); };
  const fill = () => {
    list = searchList(buildItems(bs.cat), 'Найти…', 8);
    box.replaceChildren(list.el);
    const sel = list.el.querySelector('select');
    if (bs.id && [...sel.options].some((o) => o.value === bs.id)) sel.value = bs.id;
    sel.addEventListener('change', choose);
    list.el.querySelector('input').addEventListener('input', choose);
    choose();
  };
  cat.addEventListener('change', () => { bs.cat = cat.value; bs.id = ''; fill(); });
  fill();
  const lv = lvlInput(bs.level), el = eliteBox(bs.elite), n = num(bs.count, 1, 50, 'Сколько за щелчок (враги)', '4em');
  lv.addEventListener('change', () => { bs.level = Number(lv.value) || 1; });
  el.addEventListener('change', () => { bs.elite = el.checked; });
  n.addEventListener('change', () => { bs.count = Number(n.value) || 1; });
  const rep = h('input', { type: 'checkbox', checked: bs.repeat, title: 'Каждый щелчок ставит ещё (до Esc); выключено — один раз' });
  rep.addEventListener('change', () => { bs.repeat = rep.checked; });
  const mode = (m) => { bs.mode = bs.mode === m ? null : m; syncGhost(); render(); };
  return [section('Стройка', 'Поставить что угодно у курсора: призрак показывает место, R — поворот, Esc — выход. Всё сохраняется в мире',
    row(cat), box,
    row('Уровень ', lv, h('label', { className: 'check', title: el.title }, el, ' элита'), ' кол-во ', n),
    row(h('span', { title: 'Поворот (R)' }, 'Поворот: '), h('b', { id: 'cheat-rot' }, `${bs.rot * 90}°`), btn('⟳', 'Повернуть (R)', () => { bs.rot = (bs.rot + 1) % 4; syncGhost(); render(); }),
      h('label', { className: 'check', title: rep.title }, rep, ' повторять')),
    row(btn(bs.mode === 'place' ? '⏹ Хватит ставить' : '🏗 Ставить щелчком', 'Включить постановку: щёлкайте по карте (Esc — выход)', () => mode('place')),
      btn(bs.mode === 'erase' ? '⏹ Выключить ластик' : '🧽 Ластик', 'Щелчок убирает объект стройки, деталь базы, врага, жителя, пустую технику, предмет с земли; иначе — скрывает дерево, скалу и т. п. на клетке', () => mode('erase'))),
    h('p', { className: 'hint' }, 'Детали базы — бесплатно; если базы в этом мире нет, рядом сам ставится флаг. Объекты мира — украшение (ходить не мешают), здания — вид без жителей. F7 — открыть эту вкладку.'))];
}

function render() {
  if (!info || !ctx) return;
  refillList = null;
  const tb = (id, label, tip) => h('button', { type: 'button', className: 'btn small' + (tab === id ? ' active' : ''), title: tip, onclick: () => { tab = id; if (id !== 'build') stopBuild(); if (id === 'chars') send({ a: 'list' }); updateHighlight(); render(); } }, label);
  const body = tab === 'chars' ? charsTab() : tab === 'build' ? buildTab()
    : [godSection(null, info.god), vehicleCheatsSection(info.god), heroSection(null, ctx.character()), travelSection(), itemsSection(null), spawnSection(), knowSection(null), worldSection(), corpsesSection()];
  replacePanelContents($('#cheat-panel'),
    windowHeader(),
    h('div', { className: 'cheat-tabs' }, tb('me', 'Я', 'Режим бога, герой, перемещение, предметы, спавн, знания и сюжет — для себя'), tb('chars', 'Персонажи', 'Любой персонаж: игроки, спутники, жители, враги — то же, что для себя, и больше'), tb('build', 'Стройка', 'Поставить что угодно у курсора, ластик (F7)')),
    ...body);
  cheatWindow?.refresh();
}
