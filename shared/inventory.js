// Правила инвентаря и экипировки — общие для сервера (проверка) и клиента (подсказки, подсветка слотов).
// Сервер — единственный источник истины: клиент только отправляет действия.
//
// character.inventory = {
//   cells:     [предмет | null, ...]   — ячейки сумки; их число = baseSlots + ячейки рюкзака + ячейки пояса
//   equipment: { слот: предмет | null } — слои одежды, броня, руки; underwear всегда занят
//   hotbar:    [id предмета | null] × 10 — клавиши 1…0
// }
// предмет = { uid, id, n (количество), dur? (прочность) }
// место (loc) = { c: 'cell', i } | { c: 'eq', s }
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./items'), require('./character-rules'));
  else root.Inventory = factory(root.Items, root.CharacterRules);
})(typeof self !== 'undefined' ? self : this, function (Items, Rules) {
  'use strict';

  const HOTBAR_SIZE = 10; // клавиши 1…0
  const SPELL_RE = /^spell:[a-z_]+$/; // заклинание на панели (шаг 12)
  const settings = {
    baseSlots: 1024, // базовые ячейки без рюкзака
    maxInventorySlots: 65536,
    baseCarryKg: 1000000000,
    carryPerStrength: 1000000,
    pickupRange: 1.6, // дальность подбора, клеток
    itemActionMax: 9999, // предел количества обычных предметов в одном действии (выдача, подбор)
    startingKit: '',
  };
  function configure(game) {
    for (const k of Object.keys(settings)) if (game && game[k] !== undefined) settings[k] = game[k];
    settings.maxInventorySlots = Math.max(1, Math.min(65536, Math.floor(settings.maxInventorySlots)));
    settings.baseSlots = Math.max(1, Math.min(settings.maxInventorySlots, Math.floor(settings.baseSlots)));
  }

  let uidFn = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const setUidGenerator = (fn) => { uidFn = fn; };

  const SLOT_IDS = Items.SLOTS.map((s) => s.id);
  const slotName = (s) => (Items.slotById(s) || { name: s }).name;
  const UNDERWEAR = 'underwear';
  const E_UNDERWEAR = 'Нижнее бельё — базовый слой: его нельзя снять, заменить или выбросить.';

  function makeItem(id, n = 1) {
    const it = Items.get(id);
    if (!it) return null;
    const x = { uid: uidFn(), id, n };
    if (it.durability) x.dur = it.durability;
    if (it.spoils) x.made = Date.now(); // порча сырой еды (shared/survival.js)
    return x;
  }

  function empty() {
    const equipment = {};
    for (const s of SLOT_IDS) equipment[s] = null;
    equipment.underwear = { uid: 'underwear', id: 'underwear_base', n: 1 };
    return { cells: Array(settings.baseSlots).fill(null), equipment, hotbar: Array(HOTBAR_SIZE).fill(null) };
  }

  // Приводит инвентарь к текущему формату. true — инвентаря не было (новый или старый формат персонажа)
  function ensure(ch) {
    let fresh = false;
    const inv = ch.inventory;
    if (!inv || Array.isArray(inv) || !Array.isArray(inv.cells) || !inv.equipment) {
      ch.inventory = empty();
      fresh = true;
    }
    delete ch.equipment; // заготовки прежнего формата
    delete ch.hotbar;
    const x = ch.inventory;
    x.slotBonus = Math.max(0, Math.min(settings.maxInventorySlots, Math.floor(Number(x.slotBonus) || 0)));
    for (const s of SLOT_IDS) if (!(s in x.equipment)) x.equipment[s] = null;
    x.equipment.underwear = { uid: 'underwear', id: 'underwear_base', n: 1 };
    if (!Array.isArray(x.hotbar)) x.hotbar = [];
    x.hotbar = Array.from({ length: HOTBAR_SIZE }, (_, i) => (typeof x.hotbar[i] === 'string' && (Items.get(x.hotbar[i]) || SPELL_RE.test(x.hotbar[i])) ? x.hotbar[i] : null));
    x.cells = x.cells.map((c) => (c && Items.get(c.id) ? c : null));
    fitCells(ch);
    if (!ch.vitals) {
      const d = Rules.derive(ch.stats, ch.level);
      ch.vitals = { hp: d.maxHp, stamina: d.maxStamina, mp: d.maxMp };
    }
    return fresh;
  }

  const itemOf = (x) => (x ? Items.get(x.id) : null);
  const eqItem = (ch, s) => itemOf(ch.inventory.equipment[s]);

  function capacity(ch) {
    const bp = eqItem(ch, 'backpack');
    const belt = eqItem(ch, 'belt');
    const bonus = bp && bp.slots ? bp.slots : 0;
    const beltBonus = belt && belt.slots ? belt.slots : 0;
    return Math.max(0, Math.min(settings.maxInventorySlots, (ch.inventory.slotBonus || 0) + settings.baseSlots + bonus + beltBonus));
  }
  function carryLimit(ch) {
    const bp = eqItem(ch, 'backpack');
    const str = (ch.stats && ch.stats.strength) || 0;
    return Math.round((settings.baseCarryKg + str * settings.carryPerStrength + (bp && bp.carry ? bp.carry : 0)) * 100) / 100;
  }
  function all(ch) {
    const inv = ch.inventory;
    return [...inv.cells.filter(Boolean), ...Object.values(inv.equipment).filter(Boolean)];
  }
  function weight(ch) {
    let w = 0;
    for (const x of ch.inventory.cells) { if (x) { const it = itemOf(x); if (it) w += it.weight * x.n; } }
    for (const x of Object.values(ch.inventory.equipment)) { if (x) { const it = itemOf(x); if (it) w += it.weight * x.n; } }
    return Math.round(w * 100) / 100;
  }
  const used = (ch) => { let n = 0; for (const x of ch.inventory.cells) if (x) n++; return n; };
  function count(ch, id) {
    let n = 0;
    for (const x of ch.inventory.cells) if (x && x.id === id) n += x.n;
    for (const x of Object.values(ch.inventory.equipment)) if (x && x.id === id) n += x.n;
    return n;
  }

  // Длина массива ячеек = вместимость; при уменьшении предметы сдвигаются к началу.
  // Если предметов больше, чем ячеек (перегруз после изменения правил), лишние остаются в конце.
  function fitCells(ch) {
    const inv = ch.inventory;
    const cap = capacity(ch);
    if (inv.cells.length < cap) while (inv.cells.length < cap) inv.cells.push(null);
    else if (inv.cells.length > cap) {
      if (inv.cells.slice(cap).every((c) => !c)) inv.cells.length = cap;
      else {
        const items = inv.cells.filter(Boolean);
        inv.cells = items.length <= cap ? items.concat(Array(cap - items.length).fill(null)) : items;
      }
    }
  }

  function setSlotBonus(ch, value) {
    if (!Number.isInteger(value) || value < 0 || value > settings.maxInventorySlots) return `Дополнительные ячейки: целое от 0 до ${settings.maxInventorySlots}.`;
    ch.inventory.slotBonus = value;
    fitCells(ch);
    return null;
  }

  // Невыполненные требования: [{ key, label, need, have }]
  function unmet(ch, it) {
    const out = [];
    if (!it) return out;
    if (it.level > (ch.level || 1)) out.push({ key: 'level', label: 'Уровень', need: it.level, have: ch.level || 1 });
    for (const [k, v] of Object.entries(it.req || {})) {
      const have = (ch.stats && ch.stats[k]) || 0;
      if (have < v) out.push({ key: k, label: (Rules.STATS.find((s) => s.id === k) || { label: k }).label, need: v, have });
    }
    return out;
  }
  const unmetText = (u) => u.map((r) => `${r.label} ${r.need} (у вас ${r.have})`).join(', ');

  // Можно ли надеть предмет в слот (без учёта того, что уже лежит в самом слоте)
  function canEquip(ch, it, slot) {
    if (!it) return 'Нет предмета.';
    if (!SLOT_IDS.includes(slot)) return 'Неизвестный слот.';
    if (slot === UNDERWEAR) return E_UNDERWEAR;
    if (!Items.slotsFor(it).includes(slot)) {
      return it.placeable ? `«${it.name}» не надевается — его устанавливают на землю: привяжите к клавише панели 1–0 и нажмите её в мире.`
        : `«${it.name}» нельзя надеть в слот «${slotName(slot)}».`;
    }
    const u = unmet(ch, it);
    if (u.length) return `Не выполнены требования для «${it.name}»: ${unmetText(u)}.`;
    const eq = ch.inventory.equipment;
    for (const b of it.blocks || []) {
      if (b !== slot && eq[b]) return `«${it.name}» не надевается вместе с «${itemOf(eq[b]).name}» (слот «${slotName(b)}») — сначала снимите его.`;
    }
    for (const s of SLOT_IDS) {
      const other = s !== slot && eqItem(ch, s);
      if (other && (other.blocks || []).includes(slot)) return `Слот «${slotName(slot)}» недоступен, пока надето «${other.name}».`;
    }
    if (slot === 'offHand') {
      const main = eqItem(ch, 'mainHand');
      if (main && main.twoHanded) return `Левая рука занята: «${main.name}» — двуручное оружие.`;
    }
    return null;
  }

  // Лучший слот для предмета: свободный из подходящих, иначе первый
  function bestSlot(ch, it) {
    const slots = Items.slotsFor(it);
    if (!slots.length) return null;
    return slots.find((s) => !ch.inventory.equipment[s] && !canEquip(ch, it, s)) || slots.find((s) => !canEquip(ch, it, s)) || slots[0];
  }

  // ---------- Места ----------
  function validLoc(ch, loc) {
    if (!loc || typeof loc !== 'object') return false;
    if (loc.c === 'cell') return Number.isInteger(loc.i) && loc.i >= 0 && loc.i < ch.inventory.cells.length;
    if (loc.c === 'eq') return SLOT_IDS.includes(loc.s);
    return false;
  }
  const getAt = (ch, loc) => (loc.c === 'cell' ? ch.inventory.cells[loc.i] : ch.inventory.equipment[loc.s]) || null;
  function setAt(ch, loc, v) { if (loc.c === 'cell') ch.inventory.cells[loc.i] = v; else ch.inventory.equipment[loc.s] = v; }
  const sameLoc = (a, b) => a.c === b.c && (a.c === 'cell' ? a.i === b.i : a.s === b.s);
  const firstFree = (ch) => ch.inventory.cells.findIndex((c) => !c);

  function snapshot(ch) {
    return { w: weight(ch), L: carryLimit(ch), eq: Object.fromEntries(SLOT_IDS.map((s) => [s, ch.inventory.equipment[s] && ch.inventory.equipment[s].uid])) };
  }

  // Проверка состояния после действия. Возвращает текст ошибки или null.
  function validateAfter(ch, before, { skipCapacity = false } = {}) {
    const eq = ch.inventory.equipment;
    if (!eq.underwear || eq.underwear.id !== 'underwear_base') return E_UNDERWEAR;
    // новые предметы в слотах — полная проверка
    for (const s of SLOT_IDS) {
      const x = eq[s];
      if (!x || s === UNDERWEAR || before.eq[s] === x.uid) continue;
      const err = canEquip(ch, itemOf(x), s);
      if (err) return err;
    }
    const main = eqItem(ch, 'mainHand');
    if (main && main.twoHanded && eq.offHand) return `«${main.name}» — двуручное оружие: левая рука должна быть свободна.`;
    for (const s of SLOT_IDS) {
      const it = eqItem(ch, s);
      for (const b of (it && it.blocks) || []) if (eq[b]) return `«${it.name}» не надевается вместе с «${itemOf(eq[b]).name}».`;
    }
    const n = used(ch);
    fitCells(ch);
    if (!skipCapacity && n > capacity(ch)) return `Не хватает ячеек: занято ${n}, а без этого предмета будет только ${capacity(ch)}. Сначала освободите место.`;
    const w = weight(ch), L = carryLimit(ch);
    if (w > L + 1e-9 && (w > before.w + 1e-9 || L < before.L - 1e-9)) return `Слишком тяжело: ${fmtKg(w)} из ${fmtKg(L)} кг.`;
    return null;
  }
  const fmtKg = (v) => (Math.round(v * 10) / 10).toLocaleString('ru-RU');

  // Перемещение: ячейка↔ячейка (перенос, стопка, обмен, разделение count), надеть, снять, обмен слотов
  function move(ch, from, to, count) {
    if (!validLoc(ch, from) || !validLoc(ch, to)) return 'Некорректное место.';
    const a = getAt(ch, from);
    if (!a) return 'Там нет предмета.';
    if (sameLoc(from, to)) return 'Предмет уже здесь.';
    if ((from.c === 'eq' && from.s === UNDERWEAR) || (to.c === 'eq' && to.s === UNDERWEAR)) return E_UNDERWEAR;
    const n = count == null ? a.n : count;
    if (!Number.isInteger(n) || n < 1 || n > a.n) return 'Неверное количество.';
    const itA = itemOf(a);
    const b = getAt(ch, to);
    const before = snapshot(ch);

    if (b && b.id === a.id && itA.stackable) {
      const space = itA.stack - b.n;
      if (space <= 0) return 'Стопка уже полная.';
      const k = Math.min(n, space);
      b.n += k; a.n -= k;
      if (Number.isFinite(a.made) || Number.isFinite(b.made)) b.made = Math.min(a.made ?? Infinity, b.made ?? Infinity); // стопка — по самому старому
      if (a.n === 0) setAt(ch, from, null);
    } else if (n < a.n) {
      // разделение: часть — в пустое место (или в слот; тогда прежний предмет слота — в свободную ячейку)
      if (b && to.c === 'cell') return 'Разделить стопку можно только в пустую ячейку.';
      if (b) {
        const i = firstFree(ch);
        if (i < 0) return 'Нет свободной ячейки для снятого предмета.';
        ch.inventory.cells[i] = b;
      }
      setAt(ch, to, { ...a, uid: uidFn(), n });
      a.n -= n;
    } else {
      setAt(ch, to, a);
      setAt(ch, from, b);
    }
    // двуручное оружие освобождает левую руку, если есть куда убрать
    const main = eqItem(ch, 'mainHand');
    const off = ch.inventory.equipment.offHand;
    if (main && main.twoHanded && off && before.eq.offHand === off.uid) {
      const i = firstFree(ch);
      if (i < 0) return `«${main.name}» — двуручное оружие, а убрать «${itemOf(off).name}» из левой руки некуда: нет свободной ячейки.`;
      ch.inventory.cells[i] = off;
      ch.inventory.equipment.offHand = null;
    }
    return validateAfter(ch, before);
  }

  // Надеть в лучший слот / снять в свободную ячейку (двойной щелчок)
  function equip(ch, from, slot) {
    if (!validLoc(ch, from)) return 'Некорректное место.';
    const a = getAt(ch, from);
    if (!a) return 'Там нет предмета.';
    const it = itemOf(a);
    const s = slot || bestSlot(ch, it);
    if (!s) return it.placeable ? canEquip(ch, it, 'mainHand') : `«${it.name}» не надевается.`;
    return move(ch, from, { c: 'eq', s });
  }
  function unequip(ch, from) {
    if (!validLoc(ch, from) || from.c !== 'eq') return 'Некорректное место.';
    if (from.s === UNDERWEAR) return E_UNDERWEAR;
    if (!getAt(ch, from)) return 'Слот пуст.';
    const i = firstFree(ch);
    if (i < 0) return 'Нет свободной ячейки.';
    return move(ch, from, { c: 'cell', i });
  }

  // Использовать расходуемое (еда, вода, аптечка, зелья)
  // Обработчик использования (сервер: выживание, костёр, готовка). hook(ch, inst, it, ctx, take) →
  // undefined — обычное использование; строка — ошибка; null — обработано (take() забирает один предмет)
  // Обработчиков может быть несколько (выживание, строительство, крафт): первый, вернувший не undefined, решает
  const useHooks = [];
  const setUseHook = (fn, first = false) => { if (!useHooks.includes(fn)) useHooks[first ? 'unshift' : 'push'](fn); };

  function use(ch, from, ctx) {
    if (!validLoc(ch, from)) return 'Некорректное место.';
    const a = getAt(ch, from);
    if (!a) return 'Там нет предмета.';
    const it = itemOf(a);
    if (!it.effect) return `«${it.name}» нельзя использовать.`;
    for (const hook of useHooks) {
      const r = hook(ch, a, it, ctx, () => { a.n -= 1; if (a.n <= 0) setAt(ch, from, null); });
      if (r !== undefined) return r;
    }
    const d = Rules.derive(ch.stats, ch.level);
    const max = { hp: d.maxHp, stamina: d.maxStamina, mp: d.maxMp };
    let gain = 0;
    const next = { ...ch.vitals };
    for (const [k, v] of Object.entries(it.effect)) {
      if (!(k in max)) continue; // шкалы выживания считает сервер (useHook)
      const nv = Math.min(max[k], (next[k] || 0) + v);
      gain += nv - (next[k] || 0);
      next[k] = nv;
    }
    if (gain <= 0) return `Сейчас «${it.name}» ничего не даст: показатели уже полные.`;
    ch.vitals = next;
    a.n -= 1;
    if (a.n <= 0) setAt(ch, from, null);
    return null;
  }

  // Привязать предмет к клавише 1…0 (key 0…9) или очистить (id = null)
  function setHotbar(ch, key, id) {
    if (!Number.isInteger(key) || key < 0 || key >= HOTBAR_SIZE) return 'Неверная клавиша.';
    if (id === null) { ch.inventory.hotbar[key] = null; return null; }
    if (SPELL_RE.test(id)) { // заклинание (шаг 12): «spell:<id>»
      if (!(Array.isArray(ch.spells) && ch.spells.includes(id.slice(6)))) return 'Это заклинание не изучено.';
      ch.inventory.hotbar[key] = id;
      return null;
    }
    const it = Items.get(id);
    if (!it) return 'Неизвестный предмет.';
    if (!count(ch, id)) return `У вас нет «${it.name}».`;
    ch.inventory.hotbar[key] = id;
    return null;
  }
  const keyLabel = (key) => String((key + 1) % 10);

  // Нажатие клавиши 1…0: оружие и одежда — надеть / убрать, расходуемое — использовать
  function hotkey(ch, key, ctx) {
    if (!Number.isInteger(key) || key < 0 || key >= HOTBAR_SIZE) return 'Неверная клавиша.';
    const id = ch.inventory.hotbar[key];
    if (!id) return `Клавиша ${keyLabel(key)} ни к чему не привязана. Перетащите предмет из инвентаря (I) на панель.`;
    if (SPELL_RE.test(id)) return `На клавише ${keyLabel(key)} заклинание — оно читается в мире.`;
    const it = Items.get(id);
    const inCells = ch.inventory.cells.findIndex((c) => c && c.id === id);
    const eqSlot = SLOT_IDS.find((s) => ch.inventory.equipment[s] && ch.inventory.equipment[s].id === id);
    if (inCells < 0 && !eqSlot) return `«${it.name}» нет в инвентаре.`;
    if (it.effect) return use(ch, inCells >= 0 ? { c: 'cell', i: inCells } : { c: 'eq', s: eqSlot }, ctx);
    if (it.placeable) return `«${it.name}» устанавливается на землю: нажмите эту клавишу в мире — предмет встанет у ваших ног.`;
    if (eqSlot) return unequip(ch, { c: 'eq', s: eqSlot });
    if (!it.slot) return `«${it.name}» нельзя надеть или использовать.`;
    return equip(ch, { c: 'cell', i: inCells });
  }

  // Забрать предмет из места (выбросить на землю). Возвращает { item } или { error }
  function removeAt(ch, from, n) {
    if (!validLoc(ch, from)) return { error: 'Некорректное место.' };
    const a = getAt(ch, from);
    if (!a) return { error: 'Там нет предмета.' };
    if (from.c === 'eq' && from.s === UNDERWEAR) return { error: E_UNDERWEAR };
    const k = n == null ? a.n : n;
    if (!Number.isInteger(k) || k < 1 || k > a.n) return { error: 'Неверное количество.' };
    const before = snapshot(ch);
    let item;
    if (k === a.n) { item = a; setAt(ch, from, null); } else { item = { ...a, uid: uidFn(), n: k }; a.n -= k; }
    const err = validateAfter(ch, before);
    return err ? { error: err } : { item };
  }

  // Добавить предметы атомарно: при отказе восстанавливаем только затронутые ячейки.
  // extra — дополнительные свойства штучного предмета (например уровень улучшения турели)
  function add(ch, id, n = 1, dur, extra = null) {
    const it = Items.get(id);
    if (!it) return 'Неизвестный предмет.';
    if (it.fixed) return `«${it.name}» нельзя выдать или подобрать.`;
    const actionMax = id === 'caps' ? Number.MAX_SAFE_INTEGER : settings.itemActionMax;
    if (!Number.isSafeInteger(n) || n < 1 || n > actionMax) return 'Неверное количество.';
    const before = snapshot(ch);
    let left = n;
    const cells = ch.inventory.cells;
    const changes = [], originalLength = cells.length;
    const rollback = (error) => {
      for (const [i, old] of changes) cells[i] = old;
      cells.length = originalLength;
      ch.inventory.cells = cells;
      return error;
    };
    if (it.stackable) {
      for (let i = 0; i < cells.length && left; i++) {
        const c = cells[i];
        if (left && c && c.id === id && c.n < it.stack) {
          changes.push([i, c]);
          cells[i] = { ...c };
          const target = cells[i];
          const k = Math.min(left, it.stack - target.n); target.n += k; left -= k;
          if (it.spoils) target.made = Math.min(target.made ?? Date.now(), (extra && extra.made) ?? Date.now());
        }
      }
    }
    let nextFree = 0;
    while (left > 0) {
      while (nextFree < cells.length && cells[nextFree]) nextFree++;
      const i = nextFree++;
      if (i >= cells.length) return rollback(`Нет места в сумке для «${it.name}»${n > 1 ? ` × ${n}` : ''}.`);
      const k = it.stackable ? Math.min(left, it.stack) : 1;
      const x = makeItem(id, k);
      if (dur != null && x.dur != null) x.dur = Math.max(1, Math.min(x.dur, dur));
      if (extra && !it.stackable) Object.assign(x, extra);
      if (it.spoils && extra && Number.isFinite(extra.made)) x.made = extra.made;
      changes.push([i, cells[i]]);
      cells[i] = x;
      left -= k;
    }
    const error = validateAfter(ch, before);
    return error ? rollback(error) : null;
  }

  // Забрать предметы по id (администратор): сначала из ячеек, затем из экипировки. Возвращает число забранных
  function takeById(ch, id, n) {
    let left = n;
    const inv = ch.inventory;
    for (let i = inv.cells.length - 1; i >= 0 && left > 0; i--) {
      const c = inv.cells[i];
      if (c && c.id === id) { const k = Math.min(left, c.n); c.n -= k; left -= k; if (!c.n) inv.cells[i] = null; }
    }
    for (const s of SLOT_IDS) {
      const c = inv.equipment[s];
      if (left > 0 && s !== UNDERWEAR && c && c.id === id) { const k = Math.min(left, c.n); c.n -= k; left -= k; if (!c.n) inv.equipment[s] = null; }
    }
    fitCells(ch);
    return n - left;
  }

  // ---------- Заряды боеприпасов ----------
  // Энергоячейка или баллон горючего дают несколько зарядов (rounds). Вскрытый предмет не пропадает:
  // неизрасходованный остаток хранится в ch.ammoOpen[id] и тратится первым при следующей перезарядке.
  const perItem = (id) => { const it = Items.get(id); return (it && it.rounds) || 1; };
  function rounds(ch, id) { return count(ch, id) * perItem(id) + ((ch.ammoOpen && ch.ammoOpen[id]) || 0); }
  // Забрать до need зарядов; возвращает сколько взято (столько, сколько есть, не больше need)
  function takeRounds(ch, id, need) {
    const per = perItem(id);
    ch.ammoOpen = ch.ammoOpen || {};
    let open = ch.ammoOpen[id] || 0, got = Math.min(open, need);
    open -= got;
    if (got < need) {
      const items = takeById(ch, id, Math.ceil((need - got) / per));
      const add = items * per;
      const use = Math.min(add, need - got);
      got += use;
      open += add - use;
    }
    if (open > 0) ch.ammoOpen[id] = open; else delete ch.ammoOpen[id];
    return got;
  }

  // ---------- Стартовый набор ----------
  // Формат: "id,id*2,id:3" — через запятую, количество после * или :
  function parseKit(str) {
    const items = [], errors = [];
    for (const part of String(str || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      const m = /^([a-z0-9_]+)(?:[*:](\d+))?$/.exec(part);
      if (!m) { errors.push(`не разобрано: «${part}»`); continue; }
      const it = Items.get(m[1]);
      const n = m[2] ? Number(m[2]) : 1;
      if (!it) errors.push(`неизвестный предмет «${m[1]}»`);
      else if (it.fixed) errors.push(`«${m[1]}» выдаётся всегда`);
      else if (n < 1) errors.push(`количество «${part}»`);
      else items.push({ id: m[1], n });
    }
    return { items, errors };
  }

  // Выдать стартовый набор: носимое надевается (если слот свободен и требования выполнены), остальное — в сумку;
  // первое оружие и расходуемое привязываются к клавишам 1, 2, 3…
  function applyKit(ch, kitStr = settings.startingKit) {
    const { items } = parseKit(kitStr);
    const inv = ch.inventory;
    // сначала рюкзак и пояс — они добавляют ячейки
    const order = items.slice().sort((a, b) => rank(a.id) - rank(b.id));
    for (const { id, n } of order) {
      const it = Items.get(id);
      const slot = it.slot ? Items.slotsFor(it).find((s) => !inv.equipment[s] && !canEquip(ch, it, s)) : null;
      if (slot && (n === 1 || it.stackable)) {
        const k = it.stackable ? Math.min(n, it.stack) : 1;
        inv.equipment[slot] = makeItem(id, k);
        fitCells(ch);
        if (n > k) add(ch, id, n - k);
      } else add(ch, id, n);
    }
    fitCells(ch);
    let key = 0;
    const main = inv.equipment.mainHand;
    if (main) inv.hotbar[key++] = main.id;
    const seen = new Set();
    for (const c of inv.cells) {
      if (c && Items.get(c.id).effect && !seen.has(c.id) && key < HOTBAR_SIZE) { seen.add(c.id); inv.hotbar[key++] = c.id; }
    }
  }
  const rank = (id) => { const s = Items.get(id).slot; return s === 'backpack' ? 0 : s === 'belt' ? 1 : 2; };

  // ---------- Внешний вид (для рисования героя) ----------
  const LOOK_SLOTS = ['shirt', 'pants', 'outer', 'armor', 'head', 'face', 'hands', 'feet', 'back', 'belt', 'backpack', 'amulet', 'mainHand', 'offHand'];
  function look(ch) {
    const out = {};
    const eq = ch && ch.inventory && ch.inventory.equipment;
    if (!eq) return out;
    for (const s of LOOK_SLOTS) {
      const it = itemOf(eq[s]);
      if (!it) continue;
      const v = { id: it.id, shape: it.icon.shape, color: it.icon.color, rarity: it.rarity, set: it.set, material: it.material, school: it.school, energy: Boolean(it.icon.energy) };
      if (it.icon.color2) v.color2 = it.icon.color2;
      if (it.twoHanded) v.twoHanded = true;
      if ((it.flags || []).includes('power')) v.power = true;
      if (it.weapon && (it.weapon.flags || []).includes('glow')) v.glow = true;
      out[s] = v;
    }
    const set = Items.setEffects(ch);
    const gear=Items.flightGear(ch);
    if(gear?.flight==='jetpack')out.jetpack={...gear.icon};
    else if(gear)out.wings={...gear.icon,kind:gear.flight};
    else if (set.fly) out.jetpack = { shape: 'jetpack', color: '#41647d', color2: '#90e9ff' };
    if (set.invisible) out.invisible = true;
    return out;
  }

  // ---------- Сортировка сумки ----------
  // Режимы: logical — по порядку (тип → качество → уровень → цена, лучшее первым), quality — качество (редкость,
  // затем уровень), type — тип (оружие, броня, одежда, украшения, рюкзаки, боеприпасы, еда и лекарства, материалы),
  // count — количество, price — цена за штуку, weight — вес стопки, name — название. dir: 'asc' | 'desc'
  // (по умолчанию — у каждого режима свой естественный порядок: лучшее, дорогое и большее — первым).
  const SORT_MODES = {
    logical: { name: 'По порядку: тип → качество → уровень', dir: 'asc' },
    quality: { name: 'Качество (редкость, уровень)', dir: 'desc' },
    type: { name: 'Тип', dir: 'asc' },
    count: { name: 'Количество', dir: 'desc' },
    price: { name: 'Цена', dir: 'desc' },
    weight: { name: 'Вес', dir: 'desc' },
    name: { name: 'Название', dir: 'asc' },
  };
  const TYPE_ORDER = ['weapon', 'armor', 'clothing', 'accessory', 'backpack', 'ammo', 'consumable', 'material'];
  const typeRank = (it) => { const k = TYPE_ORDER.indexOf(it.category); return k < 0 ? TYPE_ORDER.length : k; };
  const rarityRank = (it) => Math.max(0, Object.keys(Items.RARITIES).indexOf(it.rarity || 'common'));
  const qualityOf = (it, x) => rarityRank(it) * 1000 + (Number(x.tier) || 0) * 100 + (it.level || 0);
  // Порядок «по смыслу» (он же — разбор равных в остальных режимах): тип, качество лучше, уровень выше, дороже, по алфавиту
  function logicalCmp(a, b) {
    const ia = itemOf(a), ib = itemOf(b);
    return typeRank(ia) - typeRank(ib) || qualityOf(ib, b) - qualityOf(ia, a) || (ib.value || 0) - (ia.value || 0)
      || String(ia.name).localeCompare(String(ib.name), 'ru') || String(a.id).localeCompare(String(b.id)) || (b.n || 0) - (a.n || 0) || String(a.uid || '').localeCompare(String(b.uid || ''));
  }
  const SORT_KEY = {
    quality: (x, it) => qualityOf(it, x), type: (x, it) => typeRank(it), count: (x) => x.n || 1, price: (x, it) => it.value || 0,
    weight: (x, it) => (it.weight || 0) * (x.n || 1),
  };
  // Простые стопки одного предмета (без прочности и особых свойств) складываются вместе
  const plainStack = (x, it) => it.stackable && Object.keys(x).every((k) => k === 'uid' || k === 'id' || k === 'n');
  function sortCells(ch, mode = 'logical', dir) {
    const m = SORT_MODES[mode];
    if (!m) return 'Неизвестный порядок сортировки.';
    if (dir !== undefined && dir !== 'asc' && dir !== 'desc') return 'Направление сортировки — asc или desc.';
    const sign = (dir || m.dir) === 'desc' ? -1 : 1;
    const inv = ch.inventory, list = [];
    const open = new Map();
    for (const x of inv.cells) {
      if (!x) continue;
      const it = itemOf(x);
      if (!it) { list.push(x); continue; }
      if (plainStack(x, it)) {
        const prev = open.get(x.id);
        if (prev && prev.n < (it.stack || 1)) {
          const k = Math.min((it.stack || 1) - prev.n, x.n);
          prev.n += k;
          if (x.n - k <= 0) continue;
          const rest = { ...x, n: x.n - k }; list.push(rest); open.set(x.id, rest); continue;
        }
        list.push(x); open.set(x.id, x); continue;
      }
      list.push(x);
    }
    const key = SORT_KEY[mode];
    list.sort((a, b) => {
      if (mode === 'logical') return sign * logicalCmp(a, b);
      if (mode === 'name') return sign * String(itemOf(a).name).localeCompare(String(itemOf(b).name), 'ru') || logicalCmp(a, b);
      return sign * (key(a, itemOf(a)) - key(b, itemOf(b))) || logicalCmp(a, b);
    });
    const total = inv.cells.length;
    inv.cells = list.concat(Array(Math.max(0, total - list.length)).fill(null));
    return null;
  }

  // Сводка для интерфейса
  function summary(ch) {
    return { weight: weight(ch), carry: carryLimit(ch), used: used(ch), capacity: capacity(ch), slotBonus: ch.inventory.slotBonus || 0 };
  }

  // Все изменяющие действия — «всё или ничего»: при ошибке инвентарь и показатели возвращаются как были
  function tx(fn, pick = (r) => r) {
    return function (ch, ...args) {
      const saved = JSON.stringify({ inventory: ch.inventory, vitals: ch.vitals });
      const r = fn(ch, ...args);
      if (pick(r)) { const o = JSON.parse(saved); ch.inventory = o.inventory; ch.vitals = o.vitals; }
      return r;
    };
  }
  const T = {
    move: tx(move), equip: tx(equip), unequip: tx(unequip), use: tx(use), setHotbar: tx(setHotbar),
    hotkey: tx(hotkey), add, removeAt: tx(removeAt, (r) => r.error), sortCells: tx(sortCells),
  };

  return {
    HOTBAR_SIZE, settings, configure, setUidGenerator, setUseHook, SLOT_IDS, slotName,
    empty, ensure, makeItem, capacity, carryLimit, weight, used, count, unmet, unmetText, canEquip, bestSlot, setSlotBonus,
    validLoc, getAt, ...T, takeById, rounds, takeRounds, perItem,
    parseKit, applyKit, look, summary, fitCells, keyLabel, SORT_MODES, TYPE_ORDER,
  };
});
