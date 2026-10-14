'use strict';
// Правила инвентаря (shared/inventory.js), стартовый набор и REST-действия
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Inv = require('../shared/inventory');
const Items = require('../shared/items');
const { startServer, api, newPlayer, validCharacter } = require('./helpers');

const KIT = 'knife_rusty,shirt_canvas,pants_burlap,feet_wraps,bag_canvas,ration*2,water_flask*2';
Inv.configure({ baseSlots: 8, baseCarryKg: 20, carryPerStrength: 5, startingKit: KIT, itemActionMax: 9999 });

function hero(stats = {}, level = 1) {
  const base = { strength: 3, magic: 1, intellect: 1, stealth: 1, persuasion: 1, hacking: 1, engineering: 1, builder: 1, suggestion: 1, taming: 1, companions: 1 };
  const ch = { level, stats: { ...base, ...stats }, vitals: { hp: 10, stamina: 10, mp: 0 } };
  Inv.ensure(ch);
  return ch;
}
const cell = (i) => ({ c: 'cell', i });
const eq = (s) => ({ c: 'eq', s });
const clone = (x) => structuredClone(x);
const give = (ch, id, n) => { const e = Inv.add(ch, id, n); assert.equal(e, null, e); };
const find = (ch, id) => ch.inventory.cells.findIndex((c) => c && c.id === id);

test('инвентарь: пустой герой — только бельё, 8 ячеек, 10 клавиш', () => {
  const ch = hero();
  assert.equal(ch.inventory.cells.length, 8);
  assert.equal(ch.inventory.equipment.underwear.id, 'underwear_base');
  assert.equal(ch.inventory.hotbar.length, 10);
  for (const s of Inv.SLOT_IDS) assert.ok(s in ch.inventory.equipment, s);
  assert.equal(Inv.weight(ch), 0);
  assert.equal(Inv.carryLimit(ch), 20 + 3 * 5);
});

test('инвентарь: бельё нельзя снять, заменить, выбросить или забрать', () => {
  const ch = hero();
  assert.match(Inv.unequip(ch, eq('underwear')), /бельё/i);
  assert.match(Inv.move(ch, eq('underwear'), cell(0)), /бельё/i);
  assert.match(Inv.removeAt(ch, eq('underwear')).error, /бельё/i);
  assert.match(Inv.add(ch, 'underwear_base', 1), /нельзя/);
  give(ch, 'shirt_canvas', 1);
  assert.match(Inv.move(ch, cell(0), eq('underwear')), /бельё/i);
  assert.equal(Inv.takeById(ch, 'underwear_base', 1), 0);
  assert.equal(ch.inventory.equipment.underwear.id, 'underwear_base');
  // даже испорченная запись восстанавливается
  ch.inventory.equipment.underwear = null;
  Inv.ensure(ch);
  assert.equal(ch.inventory.equipment.underwear.id, 'underwear_base');
});

test('инвентарь: совместимость слотов', () => {
  const ch = hero();
  give(ch, 'shirt_canvas', 1); give(ch, 'feet_boots', 1); give(ch, 'ring_copper', 2); give(ch, 'ration', 1); give(ch, 'mine_clapper', 1);
  assert.match(Inv.move(ch, cell(0), eq('feet')), /нельзя надеть/);
  assert.equal(Inv.move(ch, cell(0), eq('shirt')), null);
  assert.equal(ch.inventory.equipment.shirt.id, 'shirt_canvas');
  assert.equal(Inv.equip(ch, cell(find(ch, 'feet_boots'))), null);
  assert.equal(ch.inventory.equipment.feet.id, 'feet_boots');
  // два кольца — в два слота
  assert.equal(Inv.equip(ch, cell(find(ch, 'ring_copper'))), null);
  assert.equal(Inv.equip(ch, cell(find(ch, 'ring_copper'))), null);
  assert.ok(ch.inventory.equipment.ring1 && ch.inventory.equipment.ring2);
  assert.match(Inv.equip(ch, cell(find(ch, 'ration'))), /не надевается/);
  assert.match(Inv.move(ch, cell(find(ch, 'ration')), eq('mainHand')), /нельзя надеть/);
  assert.match(Inv.equip(ch, cell(find(ch, 'mine_clapper'))), /устанавливают/);
  // обмен руками
  give(ch, 'knife_fang', 1); give(ch, 'club_plain', 1);
  assert.equal(Inv.move(ch, cell(find(ch, 'knife_fang')), eq('mainHand')), null);
  assert.equal(Inv.move(ch, cell(find(ch, 'club_plain')), eq('offHand')), null);
  assert.equal(Inv.move(ch, eq('mainHand'), eq('offHand')), null);
  assert.equal(ch.inventory.equipment.mainHand.id, 'club_plain');
  assert.equal(ch.inventory.equipment.offHand.id, 'knife_fang');
  assert.match(Inv.unequip(ch, eq('amulet')), /пуст/);
  assert.match(Inv.move(ch, cell(99), cell(0)), /Некорректное/);
  assert.match(Inv.move(ch, eq('pocket'), cell(0)), /Некорректное/);
});

test('инвентарь: двуручное оружие', () => {
  const ch = hero({ strength: 6 }, 5);
  give(ch, 'knife_fang', 1); give(ch, 'sword_short', 1); give(ch, 'sword_mountain', 1);
  assert.equal(Inv.move(ch, cell(find(ch, 'knife_fang')), eq('mainHand')), null);
  assert.equal(Inv.move(ch, cell(find(ch, 'sword_short')), eq('offHand')), null);
  assert.match(Inv.move(ch, cell(find(ch, 'sword_mountain')), eq('offHand')), /нельзя надеть/, 'двуручное — только в правую руку');
  // двуручное в правую руку: нож возвращается в ячейку, меч из левой руки убирается в свободную ячейку
  assert.equal(Inv.move(ch, cell(find(ch, 'sword_mountain')), eq('mainHand')), null);
  assert.equal(ch.inventory.equipment.mainHand.id, 'sword_mountain');
  assert.equal(ch.inventory.equipment.offHand, null);
  assert.ok(find(ch, 'sword_short') >= 0 && find(ch, 'knife_fang') >= 0);
  // пока в руках двуручное — левая рука недоступна
  assert.match(Inv.move(ch, cell(find(ch, 'knife_fang')), eq('offHand')), /двуручное/);
  assert.match(Inv.canEquip(ch, Items.get('knife_fang'), 'offHand'), /двуручное/);
  // если убрать левую руку некуда — отказ, ничего не меняется
  const ch2 = hero({ strength: 6 }, 5);
  give(ch2, 'knife_fang', 1); give(ch2, 'sword_short', 1);
  Inv.move(ch2, cell(0), eq('mainHand')); Inv.move(ch2, cell(1), eq('offHand'));
  give(ch2, 'sword_mountain', 1);
  for (const id of ['scrap_metal', 'cloth', 'planks', 'chitin', 'electronics', 'gold_nugget', 'platinum']) give(ch2, id, 1); // заполнить сумку
  assert.ok(ch2.inventory.cells.every(Boolean), 'сумка полна');
  const before = clone(ch2.inventory);
  const r = Inv.move(ch2, cell(find(ch2, 'sword_mountain')), eq('mainHand'));
  assert.match(r || '', /некуда|ячейк/);
  assert.deepEqual(before.equipment.offHand.id, 'sword_short');
});

test('инвентарь: требования уровня и характеристик', () => {
  const weak = hero({ strength: 2 });
  give(weak, 'revolver_thunder', 1); // Сила 3
  const err = Inv.equip(weak, cell(0));
  assert.match(err, /Сила 3 \(у вас 2\)/);
  assert.deepEqual(Inv.unmet(weak, Items.get('revolver_thunder')).map((u) => u.key), ['strength']);
  const low = hero({ strength: 9 });
  give(low, 'sword_adamant', 1); // уровень 15
  assert.match(Inv.equip(low, cell(0)), /Уровень 15 \(у вас 1\)/);
  const ok = hero({ strength: 5 }, 15);
  give(ok, 'sword_adamant', 1);
  assert.equal(Inv.equip(ok, cell(0)), null);
});

test('инвентарь: силовая броня блокирует верхнюю одежду и плащ', () => {
  const ch = hero({ strength: 7, engineering: 4 }, 12);
  give(ch, 'outer_leather', 1); give(ch, 'armor_power', 1); give(ch, 'back_cloak', 1);
  assert.equal(Inv.equip(ch, cell(find(ch, 'outer_leather'))), null);
  assert.match(Inv.equip(ch, cell(find(ch, 'armor_power'))), /вместе с «Кожаная куртка»/);
  assert.equal(Inv.unequip(ch, eq('outer')), null);
  assert.equal(Inv.equip(ch, cell(find(ch, 'armor_power'))), null);
  assert.match(Inv.equip(ch, cell(find(ch, 'outer_leather'))), /недоступен, пока надето «Силовая броня/);
  assert.match(Inv.equip(ch, cell(find(ch, 'back_cloak'))), /недоступен/);
});

test('инвентарь: стопки — объединение, разделение, предел стопки, обмен', () => {
  const ch = hero();
  give(ch, 'ammo_9mm', 150);
  assert.equal(ch.inventory.cells[0].n, 150);
  give(ch, 'ammo_9mm', 100); // предел стопки 200 → 200 + 50
  assert.deepEqual(ch.inventory.cells.filter(Boolean).map((c) => c.n), [200, 50]);
  // разделение: 20 патронов в пустую ячейку
  assert.equal(Inv.move(ch, cell(1), cell(5), 20), null);
  assert.equal(ch.inventory.cells[1].n, 30);
  assert.equal(ch.inventory.cells[5].n, 20);
  assert.notEqual(ch.inventory.cells[5].uid, ch.inventory.cells[1].uid);
  // объединение
  assert.equal(Inv.move(ch, cell(5), cell(1)), null);
  assert.equal(ch.inventory.cells[1].n, 50);
  assert.equal(ch.inventory.cells[5], null);
  // в полную стопку нельзя
  assert.match(Inv.move(ch, cell(1), cell(0)), /полная/);
  // разделение в занятую ячейку — отказ
  give(ch, 'ration', 1);
  assert.match(Inv.move(ch, cell(0), cell(find(ch, 'ration')), 5), /пустую ячейку/);
  // неверное количество
  assert.match(Inv.move(ch, cell(0), cell(6), 0), /количество/);
  assert.match(Inv.move(ch, cell(0), cell(6), 999), /количество/);
  assert.match(Inv.move(ch, cell(0), cell(6), 1.5), /количество/);
  // обмен разных предметов
  const r = find(ch, 'ration');
  assert.equal(Inv.move(ch, cell(0), cell(r)), null);
  assert.equal(ch.inventory.cells[0].id, 'ration');
  assert.equal(ch.inventory.cells[r].id, 'ammo_9mm');
  // неразделяемые предметы не складываются
  give(ch, 'knife_fang', 2);
  assert.equal(ch.inventory.cells.filter((c) => c && c.id === 'knife_fang').length, 2);
});

test('инвентарь: вес — Сила и рюкзак, перегруз запрещён', () => {
  const ch = hero({ strength: 1 }); // 25 кг
  assert.equal(Inv.carryLimit(ch), 25);
  assert.match(Inv.add(ch, 'turret_watchman', 2), /Слишком тяжело: 36/);
  assert.equal(Inv.add(ch, 'turret_watchman', 1), null); // 18 кг
  assert.match(Inv.add(ch, 'hammer_sledge', 2), /Слишком тяжело/);
  assert.equal(Inv.weight(ch), 18);
  const strong = hero({ strength: 6 });
  assert.equal(Inv.carryLimit(strong), 50);
  give(strong, 'backpack_tourist', 1);
  assert.equal(Inv.equip(strong, cell(0)), null);
  assert.equal(Inv.carryLimit(strong), 60);
  assert.equal(Inv.capacity(strong), 16);
});

test('инвентарь: смена рюкзака меняет вместимость; снять нельзя, если вещи не помещаются', () => {
  const ch = hero({ strength: 5 });
  give(ch, 'bag_canvas', 1); give(ch, 'backpack_tourist', 1);
  assert.equal(Inv.equip(ch, cell(0)), null); // сумка: 8 + 4
  assert.equal(Inv.capacity(ch), 12);
  assert.equal(ch.inventory.cells.length, 12);
  // смена сумки на рюкзак: сумка встаёт на место рюкзака
  assert.equal(Inv.move(ch, cell(find(ch, 'backpack_tourist')), eq('backpack')), null);
  assert.equal(ch.inventory.equipment.backpack.id, 'backpack_tourist');
  assert.equal(Inv.capacity(ch), 16);
  assert.ok(find(ch, 'bag_canvas') >= 0);
  // заполним 14 ячеек разными предметами
  const ids = ['cloth', 'planks', 'chitin', 'electronics', 'gold_nugget', 'platinum', 'scrap_metal', 'ration', 'canned', 'medkit', 'stim', 'mana_tonic', 'water_clean'];
  for (const id of ids) give(ch, id, 1);
  assert.equal(Inv.used(ch), 14);
  // снять рюкзак в ячейку нельзя: останется 8 ячеек, а занято 14 (+ сам рюкзак)
  assert.match(Inv.unequip(ch, eq('backpack')), /Не хватает ячеек/);
  // заменить на сумку тоже нельзя (12 < 14)
  assert.match(Inv.move(ch, cell(find(ch, 'bag_canvas')), eq('backpack')), /Не хватает ячеек/);
  assert.equal(ch.inventory.equipment.backpack.id, 'backpack_tourist');
  // выбросить рюкзак тоже нельзя
  assert.match(Inv.removeAt(ch, eq('backpack')).error, /Не хватает ячеек/);
  // освободили место — сумка встаёт, ячейки сдвигаются к началу
  for (const id of ids.slice(0, 5)) Inv.removeAt(ch, cell(find(ch, id)));
  assert.equal(Inv.move(ch, cell(find(ch, 'bag_canvas')), eq('backpack')), null);
  assert.equal(Inv.capacity(ch), 12);
  assert.equal(ch.inventory.cells.length, 12);
  assert.equal(Inv.used(ch), 9);
  // рюкзак со снижением переносимого веса: перегруз после смены запрещён
  const w = hero({ strength: 1 }); // 25 кг
  give(w, 'backpack_tourist', 1);
  Inv.equip(w, cell(0)); // 35 кг
  give(w, 'turret_watchman', 1); give(w, 'hammer_sledge', 1); give(w, 'planks', 4); // 18 + 6 + 8 + 1.5 = 33.5
  assert.match(Inv.unequip(w, eq('backpack')), /Слишком тяжело/);
});

test('инвентарь: расходуемое и панель 1–0', () => {
  const ch = hero();
  give(ch, 'ration', 2); give(ch, 'knife_fang', 1);
  assert.equal(Inv.use(ch, cell(0)), null);
  assert.equal(ch.vitals.hp, 35);
  assert.equal(ch.inventory.cells[0].n, 1);
  assert.match(Inv.use(ch, cell(1)), /нельзя использовать/);
  assert.equal(Inv.setHotbar(ch, 1, 'ration'), null);
  assert.equal(Inv.setHotbar(ch, 0, 'knife_fang'), null);
  assert.match(Inv.setHotbar(ch, 2, 'medkit'), /нет/);
  assert.match(Inv.setHotbar(ch, 10, 'ration'), /клавиша/);
  assert.match(Inv.setHotbar(ch, 3, 'nope'), /Неизвестный/);
  assert.equal(Inv.hotkey(ch, 1), null); // съесть последний паёк
  assert.equal(ch.inventory.cells[0], null);
  assert.match(Inv.hotkey(ch, 1), /нет в инвентаре/);
  assert.equal(Inv.hotkey(ch, 0), null); // взять нож
  assert.equal(ch.inventory.equipment.mainHand.id, 'knife_fang');
  assert.equal(Inv.hotkey(ch, 0), null); // убрать нож
  assert.equal(ch.inventory.equipment.mainHand, null);
  assert.match(Inv.hotkey(ch, 5), /ни к чему не привязана/);
  const full = hero(); full.vitals = { hp: 116, stamina: 82, mp: 40 };
  give(full, 'ration', 1);
  assert.match(Inv.use(full, cell(0)), /ничего не даст/);
});

test('инвентарь: стартовый набор', () => {
  const ch = hero();
  Inv.applyKit(ch, KIT);
  const e = ch.inventory.equipment;
  assert.equal(e.mainHand.id, 'knife_rusty');
  assert.equal(e.shirt.id, 'shirt_canvas');
  assert.equal(e.pants.id, 'pants_burlap');
  assert.equal(e.feet.id, 'feet_wraps');
  assert.equal(e.backpack.id, 'bag_canvas');
  assert.equal(Inv.capacity(ch), 12);
  assert.equal(Inv.count(ch, 'ration'), 2);
  assert.equal(Inv.count(ch, 'water_flask'), 2);
  assert.deepEqual(ch.inventory.hotbar.slice(0, 3), ['knife_rusty', 'ration', 'water_flask']);
  assert.deepEqual(Inv.parseKit('knife_rusty, ration:3,bogus,ration*x').errors.length, 2);
  assert.deepEqual(Inv.parseKit('club_plain,ration:3').items, [{ id: 'club_plain', n: 1 }, { id: 'ration', n: 3 }]);
  const look = Inv.look(ch);
  assert.equal(look.mainHand.shape, 'knife');
  assert.equal(look.shirt.color, Items.get('shirt_canvas').icon.color);
});

test('REST: стартовый набор у нового персонажа, действия, отказы, сохранение', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const p = await newPlayer(s.base, 'invrest', 'Инна Сумкина');
  const url = `/api/characters/${p.characterId}/inventory`;
  const ch = (await api(s.base, 'GET', `/api/characters/${p.characterId}`, undefined, p.token)).data.character;
  assert.equal(ch.inventory.equipment.mainHand.id, 'knife_rusty');
  assert.equal(ch.inventory.equipment.backpack.id, 'bag_canvas');
  assert.equal(ch.inventory.equipment.underwear.id, 'underwear_base');
  const ration = ch.inventory.cells.findIndex((c) => c && c.id === 'ration');
  // снять нож в свободную ячейку
  let r = await api(s.base, 'POST', url, { type: 'unequip', from: { c: 'eq', s: 'mainHand' } }, p.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.inventory.equipment.mainHand, null);
  // базовые ячейки сервера (game.baseSlots из /api/config) + 4 ячейки холщовой сумки
  const cfg = (await api(s.base, 'GET', '/api/config')).data;
  assert.ok(r.data.summary.capacity === cfg.game.baseSlots + Items.get('bag_canvas').slots && r.data.summary.weight > 0, JSON.stringify(r.data.summary));
  // бельё — нельзя
  r = await api(s.base, 'POST', url, { type: 'unequip', from: { c: 'eq', s: 'underwear' } }, p.token);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /бельё/i);
  // разделить стопку пайков
  r = await api(s.base, 'POST', url, { type: 'move', from: { c: 'cell', i: ration }, to: { c: 'cell', i: 11 }, count: 1 }, p.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.inventory.cells[11].n, 1);
  // выбросить вне мира — нельзя
  r = await api(s.base, 'POST', url, { type: 'drop', from: { c: 'cell', i: 11 } }, p.token);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /только в мире/);
  r = await api(s.base, 'POST', url, { type: 'fly' }, p.token);
  assert.equal(r.status, 400);
  // чужой персонаж и без входа
  const q = await newPlayer(s.base, 'invrest2', 'Пётр Чужой');
  assert.equal((await api(s.base, 'POST', url, { type: 'unequip', from: { c: 'eq', s: 'shirt' } }, q.token)).status, 404);
  assert.equal((await api(s.base, 'POST', url, { type: 'unequip', from: { c: 'eq', s: 'shirt' } })).status, 401);
  // надеть предмет, которого нет — отказ
  r = await api(s.base, 'POST', url, { type: 'equip', from: { c: 'cell', i: 9 } }, p.token);
  assert.equal(r.status, 400);
  // изменения сохранены в файле персонажа
  const file = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'characters', ch.accountId + '.json'), 'utf8'));
  const saved = file.characters[0].inventory;
  assert.equal(saved.equipment.mainHand, null);
  assert.equal(saved.cells[11].id, 'ration');
});

test('REST: персонаж старого формата получает инвентарь и набор; набор из настроек; ошибка набора — ошибка запуска', async (t) => {
  const s = await startServer(['--set', 'game.startingKit=club_plain,canned*3', '--set', 'game.baseSlots=6']);
  t.after(() => s.stop());
  const p = await newPlayer(s.base, 'oldfmt', 'Старый Формат');
  let ch = (await api(s.base, 'GET', `/api/characters/${p.characterId}`, undefined, p.token)).data.character;
  assert.equal(ch.inventory.equipment.mainHand.id, 'club_plain');
  assert.equal(ch.inventory.cells.length, 6);
  assert.equal(ch.inventory.cells.find(Boolean).n, 3);
  // превратить запись в старый формат (как до этапа инвентаря)
  const f = path.join(s.dataDir, 'characters', ch.accountId + '.json');
  const db = JSON.parse(fs.readFileSync(f, 'utf8'));
  db.characters[0].inventory = [];
  db.characters[0].equipment = { underwear: 'basic', clothes: null };
  db.characters[0].hotbar = Array(10).fill(null);
  fs.writeFileSync(f, JSON.stringify(db));
  ch = (await api(s.base, 'GET', '/api/characters', undefined, p.token)).data.characters[0];
  assert.equal(ch.inventory.equipment.mainHand.id, 'club_plain');
  assert.equal(ch.equipment, undefined);
  assert.equal(ch.hotbar, undefined);

  const bad = await startServer(['--set', 'game.startingKit=knife_rusty,laser_banana']).catch((e) => e);
  assert.ok(bad instanceof Error, 'сервер не должен запуститься');
  assert.match(bad.message, /startingKit.*laser_banana/);
});

test('REST: validCharacter создаётся с бельём и без старых полей', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const reg = await api(s.base, 'POST', '/api/register', { username: 'plain', password: 'secret123' });
  const c = await api(s.base, 'POST', '/api/characters', validCharacter('Простой Герой'), reg.data.token);
  assert.equal(c.data.character.inventory.equipment.underwear.id, 'underwear_base');
  assert.equal(c.data.character.equipment, undefined);
});

test('инвентарь: заряды ячеек и баллонов тратятся частично, остаток вскрытого не пропадает', () => {
  const ch = { stats: validCharacter().stats, level: 1, inventory: Inv.empty() };
  Inv.add(ch, 'ammo_fuel', 3); // 3 × 25 = 75 зарядов
  assert.equal(Inv.rounds(ch, 'ammo_fuel'), 75);
  assert.equal(Inv.takeRounds(ch, 'ammo_fuel', 30), 30);
  assert.equal(Inv.count(ch, 'ammo_fuel'), 1, 'вскрыто два баллона');
  assert.equal(ch.ammoOpen.ammo_fuel, 20, 'остаток второго баллона сохранён');
  assert.equal(Inv.rounds(ch, 'ammo_fuel'), 45, 'ничего не потеряно');
  assert.equal(Inv.takeRounds(ch, 'ammo_fuel', 10), 10);
  assert.equal(Inv.count(ch, 'ammo_fuel'), 1, 'сначала тратится вскрытый');
  assert.equal(Inv.takeRounds(ch, 'ammo_fuel', 100), 35, 'больше, чем есть, — не взять');
  assert.equal(Inv.rounds(ch, 'ammo_fuel'), 0);
  assert.ok(!('ammo_fuel' in ch.ammoOpen));
  // обычные патроны: 1 предмет = 1 заряд
  Inv.add(ch, 'ammo_9mm', 5);
  assert.equal(Inv.takeRounds(ch, 'ammo_9mm', 3), 3);
  assert.equal(Inv.count(ch, 'ammo_9mm'), 2);
});
