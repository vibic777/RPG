import {tooltipSettings} from './tooltip-settings.js';
// Окно инвентаря (клавиша I): кукла героя со слоями экипировки, ячейки сумки, вес и вместимость,
// подсказки к предметам (невыполненные требования — красным), перетаскивание, панель быстрых действий 1–0.
// Все действия отправляются на сервер; окно перерисовывается по его ответу.
import { iconUrl } from './icons.js';
import { drawCharacter } from './preview.js';
import { floatingWindow } from './floating-window.js';

const I = window.Items;
const Inv = window.Inventory;
const R = window.CharacterRules;
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('ru-RU');

// Раскладка куклы: левый и правый столбцы, руки и бельё внизу
const LEFT = ['head', 'face', 'amulet', 'back', 'outer', 'armor', 'belt'];
const RIGHT = ['shirt', 'pants', 'hands', 'feet', 'backpack', 'ring1', 'ring2'];
const BOTTOM = ['mainHand', 'offHand', 'underwear'];
const SLOT_ICON = {
  underwear: '🩲', shirt: '👕', pants: '👖', outer: '🧥', armor: '🛡', head: '⛑', face: '🥽', hands: '🧤', feet: '🥾',
  back: '🧣', belt: '🎗', backpack: '🎒', ring1: '💍', ring2: '💍', amulet: '📿', mainHand: '🗡', offHand: '✋',
};
const FLAG_NAMES = {
  automatic: 'автоматический огонь', burst: 'очередями', spread: 'разброс дроби', scope: 'оптический прицел', silent: 'бесшумное',
  heavy: 'тяжёлое', area: 'урон по площади', explosive: 'взрывное', stun: 'оглушает', bleed: 'кровотечение', poison: 'отравляет',
  cleave: 'задевает соседних', reach: 'длинная досягаемость', armorPiercing: 'пробивает броню', thrown: 'метательное',
  returns: 'возвращается в руку', glow: 'светится', pull: 'притягивает и связывает цель', magic: 'магическое', burn: 'поджигает',
  spray: 'струя', burnsWebs: 'выжигает паутину', deployable: 'устанавливается на землю', trigger: 'срабатывает при приближении',
  immobilize: 'обездвиживает', turret: 'стреляет сама', emp: 'выводит из строя роботов и киборгов', nonLethal: 'не убивает',
  beam: 'непрерывный луч', chain: 'разряд перескакивает на соседей', knockback: 'отбрасывает', power: 'силовая броня', stealth: 'помогает прятаться',
};

let ctx = null; // { getCharacter, send, toast }
let dragFrom = null; // место перетаскиваемого предмета
let shiftDrag = false;
const CELL_PAGE = 512;
const CELL_WIDTH = 50, CELL_HEIGHT = 42, CELL_GAP = 4;
let cellRenderFrame = 0;
let cellViewMode = localStorage.getItem('invCellViewMode') === 'pages' ? 'pages' : 'scroll';
let cellPage = 0;
let inventoryWindow = null;

export function initInventory() {
  const col = (list) => list.map((s) => slotHtml(s)).join('');
  $('#inv-col-left').innerHTML = col(LEFT);
  $('#inv-col-right').innerHTML = col(RIGHT);
  $('#inv-hands').innerHTML = col(BOTTOM);
  $('#btn-inv-close').addEventListener('click', () => invToggle(false));
  $('#btn-inventory').addEventListener('click', () => invToggle());
  $('#auto-loot-controls').addEventListener('click', (e) => {
    const b = e.target.closest('[data-loot]');
    if (!b || !ctx) return;
    const modes = { all: false, needed: false, best: false, ...ctx.getCharacter().autoLoot };
    modes[b.dataset.loot] = !modes[b.dataset.loot];
    ctx.getCharacter().autoLoot = modes;
    renderAutoLoot();
    send({ type: 'autoLoot', modes });
  });
  // Автопомощь из сумки (server/autouse.js): каждая шкала — отдельный переключатель
  $('#auto-use-controls').addEventListener('click', (e) => {
    const b = e.target.closest('[data-autouse]');
    if (!b || !ctx) return;
    const modes = { ...(ctx.getCharacter().autoUse || {}) };
    modes[b.dataset.autouse] = !modes[b.dataset.autouse];
    ctx.getCharacter().autoUse = modes;
    renderAutoUse();
    send({ type: 'autoUse', modes });
  });
  // Сортировка сумки: режим и направление запоминаются; «⇅» — отсортировать (сервер, shared/inventory.js sortCells)
  const sortSel = $('#inv-sort-mode'), dirBtn = $('#inv-sort-dir');
  if (sortSel && Inv.SORT_MODES) {
    sortSel.innerHTML = Object.entries(Inv.SORT_MODES).map(([k, m]) => `<option value="${k}">${m.name}</option>`).join('');
    sortSel.value = Inv.SORT_MODES[sortPrefs.mode] ? sortPrefs.mode : 'logical';
    const syncDir = () => { const dir = sortPrefs.dir || Inv.SORT_MODES[sortSel.value].dir; dirBtn.textContent = dir === 'desc' ? '↓' : '↑'; dirBtn.title = dir === 'desc' ? 'Сейчас: по убыванию (лучшее, дорогое, большее — первым). Нажмите — по возрастанию' : 'Сейчас: по возрастанию. Нажмите — по убыванию'; dirBtn.setAttribute('aria-label', dirBtn.title); };
    sortSel.addEventListener('change', () => { sortPrefs = { mode: sortSel.value, dir: null }; saveSort(); syncDir(); });
    dirBtn.addEventListener('click', () => { const cur = sortPrefs.dir || Inv.SORT_MODES[sortSel.value].dir; sortPrefs = { mode: sortSel.value, dir: cur === 'desc' ? 'asc' : 'desc' }; saveSort(); syncDir(); });
    $('#btn-inv-sort').addEventListener('click', () => sortBag(sortSel.value, sortPrefs.dir || undefined));
    syncDir();
  }
  $('#inv-view-mode').value = cellViewMode;
  const cellViewport = $('#inv-grid').parentElement;
  $('#inv-view-mode').addEventListener('change', (e) => { cellViewMode = e.target.value; localStorage.setItem('invCellViewMode', cellViewMode); cellPage = 0; cellViewport.scrollTop = 0; render(); });
  $('#inv-prev-page').addEventListener('click', () => { cellPage = Math.max(0, cellPage - 1); cellViewport.scrollTop = 0; render(); });
  $('#inv-next-page').addEventListener('click', () => { cellPage++; cellViewport.scrollTop = 0; render(); });
  const queueCells = () => {
    if (cellRenderFrame) return;
    cellRenderFrame = requestAnimationFrame(() => { cellRenderFrame = 0; renderCells(); });
  };
  cellViewport.addEventListener('scroll', queueCells, { passive: true });
  new ResizeObserver(queueCells).observe(cellViewport);
  const win = $('#inv-window');
  inventoryWindow = floatingWindow(win, { header: '.inv-head', onRestore: render, onMinimize: hideTip });
  // перетаскивание
  win.addEventListener('dragstart', onDragStart);
  document.addEventListener('dragend', () => { dragFrom = null; clearMarks(); });
  for (const el of [win, $('#hotbar'), $('#game-canvas')]) {
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
  }
  win.addEventListener('dragleave', (e) => { const t = e.target.closest('[data-loc]'); if (t) t.classList.remove('drop-ok', 'drop-bad'); });
  win.addEventListener('dblclick', onDblClick);
  // подсказки
  for (const el of [win, $('#hotbar')]) {
    el.addEventListener('mousemove', onTipMove);
    el.addEventListener('mouseleave', (e) => { if (!e.relatedTarget?.closest?.('#item-tip')) hideTip(); });
  }
  $('#item-tip').style.pointerEvents = 'auto';
  $('#item-tip').addEventListener('mouseleave', (e) => { if (!e.relatedTarget?.closest?.('#inv-window, #hotbar')) hideTip(); });
  $('#hotbar').addEventListener('click', (e) => { const s = e.target.closest('.slot'); if (s && ctx) hotkey(keyIndex(s.dataset.key)); });
  $('#hotbar').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const s = e.target.closest('.slot');
    if (s && ctx) send({ type: 'hotbar', key: keyIndex(s.dataset.key), item: null });
  });
  $('#hotbar').addEventListener('dragstart', (e) => e.preventDefault());
}

// клавиша на панели: '1'…'9','0' → индекс 0…9
const keyIndex = (k) => (Number(k) + 9) % 10;

function slotHtml(s) {
  const def = I.slotById(s);
  return `<div class="inv-slot${def.fixed ? ' fixed' : ''}" data-loc='${JSON.stringify({ c: 'eq', s })}' data-slot="${s}"></div>`;
}

export function invAttach(api) {
  ctx = api;
  renderAutoLoot();
  renderAutoUse();
  render();
  renderHotbar();
}
export function invDetach() { ctx = null; invToggle(false); hideTip(); }
export const invIsOpen = () => !$('#inv-window').classList.contains('hidden');

export function invToggle(force) {
  const win = $('#inv-window');
  const open = force === undefined ? win.classList.contains('hidden') : force;
  const wasClosed = win.classList.contains('hidden');
  win.classList.toggle('hidden', !open);
  if (open && wasClosed) inventoryWindow?.open();
  if (!open) inventoryWindow?.close();
  $('#btn-inventory').classList.toggle('active', open);
  if (open) render();
  else hideTip();
}

const send = (a) => ctx && ctx.send(a);
// Клавиша панели: мина, ловушка или турель устанавливается на землю, остальное — сервер решит (надеть / использовать)
export const hotkey = (key) => {
  const id = ctx && ctx.getCharacter().inventory.hotbar[key];
  if (typeof id === 'string' && id.startsWith('spell:')) { if (ctx.cast) ctx.cast(id.slice(6)); return; } // заклинание (шаг 12)
  const it = id && I.get(id);
  if (it && it.placeable && ctx.place) return ctx.place(id);
  send({ type: 'hotkey', key });
};

// Сообщения сервера об инвентаре. true — обработано
export function invOnMessage(msg) {
  if (!ctx || (msg.t !== 'inv' && msg.t !== 'inv-error')) return false;
  if (msg.settings) Inv.configure(msg.settings);
  const ch = ctx.getCharacter();
  if (msg.autoLoot) { ch.autoLoot = msg.autoLoot; renderAutoLoot(); }
  if (msg.autoUse) { ch.autoUse = msg.autoUse; renderAutoUse(); }
  if (msg.inventory) ch.inventory = msg.inventory;
  if (msg.vitals) ch.vitals = msg.vitals;
  if (msg.t === 'inv-error') ctx.toast(msg.message, 3000);
  if (ctx.onChange) ctx.onChange();
  render();
  renderHotbar();
  return true;
}

// ---------- Сортировка ----------
let sortPrefs = (() => { try { return JSON.parse(localStorage.getItem('rpg.invSort') || '{}') || {}; } catch { return {}; } })();
function saveSort() { try { localStorage.setItem('rpg.invSort', JSON.stringify(sortPrefs)); } catch { /* без сохранения */ } }
export function sortBag(mode = sortPrefs.mode || 'logical', dir = sortPrefs.dir || undefined) {
  if (!Inv.SORT_MODES || !Inv.SORT_MODES[mode]) mode = 'logical';
  send({ type: 'sort', mode, ...(dir ? { dir } : {}) });
}

function renderAutoUse() {
  if (!ctx) return;
  const modes = ctx.getCharacter().autoUse || {};
  for (const b of document.querySelectorAll('[data-autouse]')) { const on = Boolean(modes[b.dataset.autouse]); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); }
}

function renderAutoLoot() {
  if (!ctx) return;
  const modes = ctx.getCharacter().autoLoot || {};
  for (const b of document.querySelectorAll('[data-loot]')) { const on = Boolean(modes[b.dataset.loot]); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); }
}

// ---------- Отрисовка ----------

function itemAt(ch, loc) { const x = Inv.getAt(ch, loc); return x ? { inst: x, item: I.get(x.id) } : null; }

function cellContent(inst, item) {
  if (!inst) return '';
  const dur = item.durability && inst.dur != null ? inst.dur / item.durability : 1;
  return `<img src="${iconUrl(item)}" alt="" draggable="true">` +
    (inst.n > 1 ? `<span class="inv-count">${inst.n}</span>` : '') +
    (dur < 0.999 ? `<span class="inv-dur" style="width:${Math.max(4, dur * 100)}%;background:${dur < 0.25 ? '#e0533a' : dur < 0.6 ? '#e0b43a' : '#6fcf5a'}"></span>` : '') +
    `<span class="inv-rarity" style="background:${I.RARITIES[item.rarity].color}"></span>`;
}

// Высота сетки соответствует всем ячейкам, в DOM находятся только видимые строки.
// Пустые слоты сохраняют свои индексы и доступны для переноса вещей до самого конца.
function renderCells() {
  if (!ctx || !invIsOpen() || $('#inv-window').classList.contains('window-minimized')) return;
  const ch = ctx.getCharacter(), inv = ch.inventory;
  const grid = $('#inv-grid'), viewport = grid.parentElement;
  const cap = Inv.capacity(ch), pages = Math.max(1, Math.ceil(inv.cells.length / CELL_PAGE));
  cellPage = Math.min(cellPage, pages - 1);
  let start = cellPage * CELL_PAGE, end = Math.min(inv.cells.length, start + CELL_PAGE), before = 0, after = 0;
  if (cellViewMode === 'scroll') {
    const columns = Math.max(1, Math.floor((grid.clientWidth + CELL_GAP) / (CELL_WIDTH + CELL_GAP)));
    const stride = CELL_HEIGHT + CELL_GAP, rows = Math.ceil(inv.cells.length / columns);
    // При уменьшении вместимости не оставляем окно за пределами новой сетки.
    const top = Math.min(viewport.scrollTop, Math.max(0, rows * stride + 4 - viewport.clientHeight));
    const first = Math.max(0, Math.floor(Math.max(0, top - 4) / stride) - 3);
    const last = Math.min(rows, Math.ceil((top + viewport.clientHeight) / stride) + 3);
    start = first * columns; end = Math.min(inv.cells.length, last * columns);
    before = first * stride; after = (rows - last) * stride;
  }
  let html = before ? `<div class="inv-grid-spacer" aria-hidden="true" style="height:${before - CELL_GAP}px"></div>` : '';
  for (let i = start; i < end; i++) {
    const x = inv.cells[i];
    html += `<div class="inv-cell${i >= cap ? ' over' : ''}" data-loc='${JSON.stringify({ c: 'cell', i })}'${x ? ` data-item="${x.id}"` : ` data-tip="Ячейка ${i + 1}"`}>${x ? cellContent(x, I.get(x.id)) : ''}</div>`;
  }
  if (after) html += `<div class="inv-grid-spacer" aria-hidden="true" style="height:${after - CELL_GAP}px"></div>`;
  grid.innerHTML = html;
  viewport.classList.toggle('paged', cellViewMode === 'pages');
  $('#inv-prev-page').classList.toggle('hidden', cellViewMode !== 'pages');
  $('#inv-next-page').classList.toggle('hidden', cellViewMode !== 'pages');
  $('#inv-page-label').textContent = cellViewMode === 'pages' ? `Страница ${cellPage + 1} / ${pages}` : `${fmt(inv.cells.length, 0)} ячеек`;
  $('#inv-prev-page').disabled = cellPage === 0;
  $('#inv-next-page').disabled = cellPage >= pages - 1;
}

function render() {
  if (!ctx || !invIsOpen() || $('#inv-window').classList.contains('window-minimized')) return;
  const ch = ctx.getCharacter();
  const inv = ch.inventory;
  // слоты экипировки
  for (const el of document.querySelectorAll('#inv-window .inv-slot')) {
    const s = el.dataset.slot;
    const x = inv.equipment[s];
    const it = x && I.get(x.id);
    const def = I.slotById(s);
    const blocked = !x && Inv.SLOT_IDS.some((o) => { const e = inv.equipment[o]; return e && (I.get(e.id).blocks || []).includes(s); });
    const twoHandBlocked = s === 'offHand' && !x && inv.equipment.mainHand && I.get(inv.equipment.mainHand.id).twoHanded;
    el.classList.toggle('empty', !x);
    el.classList.toggle('blocked', Boolean(blocked || twoHandBlocked));
    el.innerHTML = x ? cellContent(x, it) + (def.fixed ? '<span class="inv-lock">🔒</span>' : '')
      : `<span class="inv-slot-ph">${SLOT_ICON[s] || ''}</span>`;
    el.dataset.tip = x ? '' : `${def.name}: ${def.hint}.${twoHandBlocked ? ' Сейчас занята двуручным оружием.' : blocked ? ' Сейчас недоступно из-за надетой брони.' : ''}`;
    if (def.fixed) el.querySelector('img') && el.querySelector('img').setAttribute('draggable', 'false');
  }
  // ячейки
  renderCells();
  // вес и ячейки
  const sm = Inv.summary(ch);
  const wPct = Math.min(100, (sm.weight / sm.carry) * 100);
  const wBar = $('#inv-weight');
  wBar.querySelector('.fill').style.width = wPct + '%';
  wBar.classList.toggle('warn', wPct > 80);
  wBar.querySelector('.val').textContent = `Вес: ${fmt(sm.weight)} / ${fmt(sm.carry)} кг`;
  const bp = inv.equipment.backpack && I.get(inv.equipment.backpack.id);
  wBar.title = `Переносимый вес: ${fmt(Inv.settings.baseCarryKg)} кг + Сила ${ch.stats.strength} × ${fmt(Inv.settings.carryPerStrength)} кг` +
    (bp ? ` + рюкзак ${fmt(bp.carry || 0)} кг` : '') + '. Надетые вещи тоже учитываются. Больше предела поднять нельзя.';
  const cBar = $('#inv-cells-count');
  cBar.querySelector('.fill').style.width = Math.min(100, (sm.used / sm.capacity) * 100) + '%';
  cBar.querySelector('.val').textContent = `Ячейки: ${sm.used} / ${sm.capacity}`;
  const belt = inv.equipment.belt && I.get(inv.equipment.belt.id);
  cBar.title = `Ячейки: ${Inv.settings.baseSlots} базовых + ${sm.slotBonus || 0} навыка` + (bp ? ` + ${bp.slots} рюкзака` : ' (рюкзака нет)') + (belt ? ` + ${belt.slots} пояса` : '') + `. Максимум ${Inv.settings.maxInventorySlots}.`;
  // сводка защиты
  let def = 0;
  const res = {};
  for (const x of Object.values(inv.equipment)) {
    const it = x && I.get(x.id);
    if (!it || !it.armor) continue;
    def += it.armor.defense || 0;
    for (const [k, v] of Object.entries(it.armor.resist || {})) res[k] = (res[k] || 0) + v;
  }
  const d = R.derive(ch.stats, ch.level);
  def += I.setEffects(ch).defense;
  $('#inv-stats').innerHTML = `<span title="Сумма защиты надетой одежды и брони (будет снижать урон в бою)">🛡 Защита: <b>${def}</b></span>` +
    Object.entries(res).map(([k, v]) => ` · <span title="Сопротивление урону: ${I.DAMAGE_TYPES[k]}">${I.DAMAGE_TYPES[k]} ${Math.round(Math.min(0.9, v) * 100)}%</span>`).join('') +
    `<br><span title="Здоровье / выносливость / мана">❤ ${Math.round(ch.vitals.hp)}/${d.maxHp} · ⚡ ${Math.round(ch.vitals.stamina)}/${d.maxStamina} · ✦ ${Math.round(ch.vitals.mp)}/${d.maxMp}</span>`;
  $('#inv-stats').innerHTML += I.setState(ch).map((s) => `<div class="inv-set"><b>${esc(s.name)} — ${s.armorPieces}/4${s.pieces === 5 ? ' + оружие' : ''}</b>${s.bonuses.map((b) => `<div class="${b.active ? 'set-active' : 'muted'}">${b.active ? '✓' : '○'} ${b.pieces === 5 ? '4 + оружие' : b.pieces + '/4'}: ${esc(b.text)}</div>`).join('')}</div>`).join('');
  // кукла
  drawCharacter($('#inv-doll-canvas'), ch.appearance, { look: Inv.look(ch) });
}

// Панель 1–0: иконки привязанных предметов и количество
export function renderHotbar() {
  if (!ctx) return;
  const ch = ctx.getCharacter();
  for (const el of document.querySelectorAll('#hotbar .slot')) {
    const key = keyIndex(el.dataset.key);
    const id = ch.inventory.hotbar[key];
    el.dataset.loc = JSON.stringify({ c: 'hotbar', key });
    if (typeof id === 'string' && id.startsWith('spell:')) { // заклинание: руна школы, откат рисует magic-ui
      const sid = id.slice(6);
      el.dataset.spell = sid;
      el.classList.add('bound'); el.classList.remove('missing', 'worn');
      el.innerHTML = `<span class="slot-key">${el.dataset.key}</span>` + (ctx.spellIcon ? `<img src="${ctx.spellIcon(sid)}" alt="">` : '');
      el.title = ''; el.dataset.tip = '';
      continue;
    }
    delete el.dataset.spell;
    const it = id && I.get(id);
    const n = id ? Inv.count(ch, id) : 0;
    const worn = id && Inv.SLOT_IDS.some((s) => ch.inventory.equipment[s] && ch.inventory.equipment[s].id === id);
    el.dataset.loc = JSON.stringify({ c: 'hotbar', key });
    el.classList.toggle('bound', Boolean(it));
    el.classList.toggle('missing', Boolean(it && !n));
    el.classList.toggle('worn', Boolean(worn));
    el.innerHTML = `<span class="slot-key">${el.dataset.key}</span>` + (it ? `<img src="${iconUrl(it)}" alt="">${n > 1 ? `<span class="inv-count">${n}</span>` : ''}` : '');
    el.title = '';
    el.dataset.tip = it ? '' : `Клавиша ${el.dataset.key}: пусто. Перетащите сюда предмет из инвентаря (I): оружие — взять в руку / убрать, еда и лекарства — использовать. Заклинание — из книги заклинаний (P). Правый щелчок — очистить.`;
  }
}

// ---------- Подсказка к предмету ----------

const STAT_LABEL = Object.fromEntries(R.STATS.map((s) => [s.id, s.label]));

export function itemTooltip(item, inst, ch) {
  const r = I.RARITIES[item.rarity];
  const unmet = ch ? Inv.unmet(ch, item).map((u) => u.key) : [];
  const req = [];
  if (item.level > 1) req.push(`<span class="${unmet.includes('level') ? 'bad' : 'ok'}">уровень ${item.level}</span>`);
  for (const [k, v] of Object.entries(item.req)) req.push(`<span class="${unmet.includes(k) ? 'bad' : 'ok'}">${STAT_LABEL[k] || k} ${v}${ch ? ` (у вас ${ch.stats[k]})` : ''}</span>`);
  const cls = item.weapon ? I.WEAPON_CLASSES[item.weapon.class].name : I.CATEGORIES[item.category];
  const rows = [];
  if (item.material) rows.push(['Материал',esc(I.WEAPON_MATERIALS.find(m=>m[0]===item.material)?.[1]||item.material)]);
  if (item.school && item.school!=='none') rows.push(['Чары',esc(I.EQUIPMENT_SCHOOLS.find(s=>s.id===item.school)?.name||item.school)]);
  if (item.weapon && window.Combat.canThrow(item)) rows.push(['Метание','Не расходует оружие; две руки — по очереди или одновременно']);
  if (item.weapon && item.affinity) rows.push(['Уберкомплект','Подходит к полному комплекту того же материала и школы']);
  if (item.set) {
    const set = I.SETS.find((s) => s.id === item.set);
    const equipped = ch && I.setState(ch).find((s) => s.id === item.set);
    rows.push(['Комплект', `${esc(set.name)} · ${equipped ? equipped.armorPieces : 0}/4 доспехов`]);
    for (const b of set.bonuses) rows.push([b.pieces === 5 ? '4 + оружие' : `${b.pieces}/4`, `${equipped && equipped.pieces >= b.pieces ? '✓ ' : '○ '}${esc(b.text)}`]);
    rows.push(['Детали', set.items.slice(0,4).map((id) => esc(I.get(id).name)).join('<br>')]);
    if(set.affinity) rows.push(['Оружие','Любое того же материала и школы, включая огнестрельное']);
  }
  const w = item.weapon;
  if (w) {
    rows.push(['Урон', `${w.damage[0]}–${w.damage[1]} · ${I.DAMAGE_TYPES[w.damageType]}`]);
    const prof = window.Combat && window.Combat.profile(item);
    if (prof) rows.push(['Атака', window.Combat.KIND_NAMES[prof.kind] || prof.kind]);
    if (w.speed) rows.push(['Скорость', `${fmt(w.speed)} атак/с`]);
    rows.push(['Дальность', `${fmt(w.range)} кл.`]);
    if (w.ammo) rows.push(['Боеприпасы', esc(I.get(w.ammo).name)]);
    if (w.magazine) rows.push(['Магазин', `${inst && inst.mag != null ? `${inst.mag} / ` : ''}${w.magazine}${w.reload ? ` · перезарядка ${fmt(w.reload)} с (R)` : ''}`]);
    rows.push(['Хват', item.placeable ? 'устанавливается на землю' : item.twoHanded ? 'двуручное (обе руки)' : 'одноручное']);
    if (w.flags.length) rows.push(['Свойства', w.flags.map((f) => FLAG_NAMES[f] || f).join(', ')]);
  }
  if (item.armor) {
    if (item.armor.defense) rows.push(['Защита', item.armor.defense]);
    const rs = Object.entries(item.armor.resist || {});
    if (rs.length) rows.push(['Сопротивление', rs.map(([k, v]) => `${I.DAMAGE_TYPES[k]} ${Math.round(v * 100)}%`).join(', ')]);
  }
  if (item.slots && item.slot) rows.push(['Ячейки', `+${item.slots}`]);
  if (inst && inst.tier > 1) rows.push(['Уровень улучшения', `${'★'.repeat(inst.tier)} (сильнее и крепче)`]);
  if (item.rounds > 1) rows.push(['Зарядов', `${item.rounds} в одном предмете (остаток вскрытого не пропадает)`]);
  if (item.carry) rows.push(['Переносимый вес', `+${fmt(item.carry)} кг`]);
  if (item.effect) {
    const EF = { hp: 'здоровье', stamina: 'выносливость', mp: 'ману', food: 'сытость', water: 'воду', rest: 'бодрость' };
    const ef = Object.entries(item.effect).filter(([k]) => EF[k]).map(([k, v]) => `${EF[k]} +${v}`);
    if (ef.length) rows.push(['Восстанавливает', ef.join(', ')]);
    if (item.effect.rad) rows.push(['Радиация', item.effect.rad > 0 ? `+${item.effect.rad}` : `${item.effect.rad} (выводит)`]);
  }
  // выживание: болезнь, лечение, порча, готовка у костра, спальник
  if (item.ill) rows.push(['Риск болезни', `${Math.round(item.ill * 100)}%`]);
  if (item.cure) rows.push(['Лечит', 'болезнь']);
  if (item.cook) rows.push(['У костра', `использовать — «${esc(I.get(item.cook).name)}»`]);
  if (item.camp) rows.push(['Использовать', 'развести костёр у ног']);
  if (item.bedroll) rows.push(['В сумке', 'отдых (Z) становится сном — бодрость быстрее']);
  if (item.spoils && window.Survival) {
    const left = window.Survival.spoilLeftMs(item, inst);
    if (left != null) rows.push(['Свежесть', left > 0 ? `испортится через ${Math.ceil(left / 60000)} мин` : 'испорчено: пользы вдвое меньше, риск болезни']);
  }
  if (item.blocks.length) rows.push(['Нельзя вместе с', item.blocks.map((b) => I.slotById(b).name.toLowerCase()).join(', ')]);
  if (item.slot && !w) rows.push(['Слот', I.slotsFor(item).map((s) => I.slotById(s).name).filter((v, i, a) => a.indexOf(v) === i).join(' / ')]);
  if (item.flags.length && !w) rows.push(['Свойства', item.flags.map((f) => FLAG_NAMES[f] || f).join(', ')]);
  const n = inst ? inst.n : 1;
  rows.push(['Вес', `${fmt(item.weight, 2)} кг${n > 1 ? ` (всего ${fmt(item.weight * n, 2)})` : ''}`]);
  rows.push(['Цена', `${item.value}${n > 1 ? ` (всего ${item.value * n})` : ''}`]);
  if (item.stackable) rows.push(['В стопке', `${n} / ${item.stack}`]);
  if (item.durability) rows.push(['Прочность', `${inst && inst.dur != null ? inst.dur : item.durability} / ${item.durability}`]);
  return `<div class="tip-name" style="color:${r.color}">${esc(item.name)}</div>
    <div class="tip-sub">${esc(cls)} · ${r.name}</div>
    <div class="tip-desc">${esc(item.desc)}</div>
    <table class="tip-stats">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
    ${req.length ? `<div class="tip-req">Требования: ${req.join(', ')}</div>` : ''}
    ${item.fixed ? '<div class="tip-hint">Снять или выбросить нельзя.</div>' : ''}`;
}

function onTipMove(e) {
  if(!tooltipSettings().enabled)return hideTip();
  const el = e.target.closest('[data-loc]');
  if (!el || !ctx || dragFrom) return hideTip();
  const loc = JSON.parse(el.dataset.loc);
  const ch = ctx.getCharacter();
  let html = el.dataset.tip || '';
  if (loc.c === 'hotbar') {
    const id = ch.inventory.hotbar[loc.key];
    if (typeof id === 'string' && id.startsWith('spell:')) html = (ctx.spellTip ? ctx.spellTip(id.slice(6), ch) : '') + `<div class="tip-hint">Клавиша ${Inv.keyLabel(loc.key)} · щелчок — прочитать · правый щелчок — убрать с панели</div>`;
    else if (id) html = itemTooltip(I.get(id), null, ch) + `<div class="tip-hint">Клавиша ${Inv.keyLabel(loc.key)} · щелчок — применить · правый щелчок — очистить${Inv.count(ch, id) ? '' : ' · <span class="bad">нет в инвентаре</span>'}</div>`;
  } else {
    const x = itemAt(ch, loc);
    if (x) html = itemTooltip(x.item, x.inst, ch) + `<div class="tip-hint">${hintFor(loc, x.item)}</div>`;
  }
  if (!html) return hideTip();
  const rich=document.createElement('div');rich.innerHTML=html;
  rich.querySelectorAll('div,tr,p,li').forEach(node=>node.append(' · '));
  let topic='h-inventory';
  if(loc.c==='hotbar'){const id=ch.inventory.hotbar[loc.key];if(id)topic=String(id).startsWith('spell:')?id:'item:'+id;}
  else {const x=itemAt(ch,loc);if(x)topic='item:'+x.item.id;}
  window.dispatchEvent(new CustomEvent('rpg-ui-tooltip',{detail:{element:el,text:rich.textContent,topic,key:el.dataset.loc}}));

}
function hintFor(loc, item) {
  if (item.fixed) return 'Базовый слой.';
  const parts = ['перетащите, чтобы переложить'];
  if (loc.c === 'eq') parts.unshift('двойной щелчок — снять');
  else if (item.effect) parts.unshift('двойной щелчок — использовать');
  else if (item.placeable) parts.unshift('двойной щелчок — установить на землю');
  else if (item.slot) parts.unshift('двойной щелчок — надеть');
  if (item.stackable) parts.push('Shift — половину стопки');
  parts.push('на панель 1–0 — привязать', 'за пределы окна — выбросить');
  return parts.join(' · ');
}
export function hideTip() { const t = $('#item-tip'); if (t) { t.classList.add('hidden'); t.dataset.key = ''; } }

// ---------- Перетаскивание и двойной щелчок ----------

function onDragStart(e) {
  const el = e.target.closest('[data-loc]');
  if (!el || !ctx) return;
  const loc = JSON.parse(el.dataset.loc);
  const x = itemAt(ctx.getCharacter(), loc);
  if (!x || x.item.fixed) { e.preventDefault(); return; }
  dragFrom = loc;
  hideTip();
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', el.dataset.loc);
  const img = el.querySelector('img');
  if (img) e.dataTransfer.setDragImage(img, 20, 20);
  // подсветить подходящие слоты
  const ch = ctx.getCharacter();
  for (const s of document.querySelectorAll('#inv-window .inv-slot')) {
    const ok = I.slotsFor(x.item).includes(s.dataset.slot) && !Inv.canEquip(ch, x.item, s.dataset.slot);
    s.classList.toggle('can', ok);
  }
}

function clearMarks() {
  for (const el of document.querySelectorAll('.drop-ok, .drop-bad, .can')) el.classList.remove('drop-ok', 'drop-bad', 'can');
}

function onDragOver(e) {
  if (!dragFrom || !ctx) return;
  e.preventDefault();
  shiftDrag = e.shiftKey;
  const el = e.target.closest('[data-loc], #inv-drop, #game-canvas');
  for (const o of document.querySelectorAll('.drop-ok, .drop-bad')) if (o !== el) o.classList.remove('drop-ok', 'drop-bad');
  if (!el || !el.dataset.loc) { if (el) el.classList.add('drop-ok'); return; }
  const to = JSON.parse(el.dataset.loc);
  let ok = true;
  if (to.c === 'eq') {
    const x = itemAt(ctx.getCharacter(), dragFrom);
    ok = Boolean(x) && !Inv.canEquip(ctx.getCharacter(), x.item, to.s);
  }
  el.classList.toggle('drop-ok', ok);
  el.classList.toggle('drop-bad', !ok);
}

function onDrop(e) {
  if (!dragFrom || !ctx) return;
  e.preventDefault();
  const from = dragFrom;
  dragFrom = null;
  clearMarks();
  const ch = ctx.getCharacter();
  const x = itemAt(ch, from);
  if (!x) return;
  const half = (e.shiftKey || shiftDrag) && x.inst.n > 1 ? Math.ceil(x.inst.n / 2) : undefined;
  const el = e.target.closest('[data-loc], #inv-drop');
  if (!el) {
    if (e.target.closest('#inv-window, #hotbar')) return; // мимо ячеек внутри окна — ничего
    return send({ type: 'drop', from, count: half }); // на карту — выбросить под ноги
  }
  if (el.id === 'inv-drop') return send({ type: 'drop', from, count: half });
  const to = JSON.parse(el.dataset.loc);
  if (to.c === 'hotbar') return send({ type: 'hotbar', key: to.key, item: x.inst.id });
  if (to.c === from.c && (to.i === from.i && to.s === from.s)) return;
  send({ type: 'move', from, to, count: half });
}

function onDblClick(e) {
  const el = e.target.closest('[data-loc]');
  if (!el || !ctx) return;
  const loc = JSON.parse(el.dataset.loc);
  const x = itemAt(ctx.getCharacter(), loc);
  if (!x) return;
  if (loc.c === 'eq') send({ type: 'unequip', from: loc });
  else if (x.item.effect) send({ type: 'use', from: loc });
  else if (x.item.slot) send({ type: 'equip', from: loc });
  else if (x.item.placeable && ctx.place) ctx.place(x.item.id);
  else ctx.toast(`«${x.item.name}» нельзя надеть или использовать.`);
}
