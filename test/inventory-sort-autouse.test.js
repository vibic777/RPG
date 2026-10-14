'use strict';
// Сортировка сумки (shared/inventory.js sortCells) и автопомощь из сумки (server/autouse.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const Inv = require('../shared/inventory');
const I = require('../shared/items');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');

let uid = 0;
Inv.setUidGenerator(() => 'u' + (++uid));
function bag(ids) {
  const ch = { stats: {}, level: 1 }; Inv.ensure(ch);
  ch.inventory.cells = Array(40).fill(null);
  ids.forEach(([id, n], i) => { ch.inventory.cells[i * 2] = { ...Inv.makeItem(id, n) }; }); // с дырками
  return ch;
}
const pick = (ch) => ch.inventory.cells.filter(Boolean);
const rank = (it) => Object.keys(I.RARITIES).indexOf(it.rarity || 'common');

test('сортировка: по порядку (тип → качество → уровень), качество, тип, количество, цена, вес, название; ↑/↓; стопки складываются', () => {
  assert.deepEqual(Object.keys(Inv.SORT_MODES), ['logical', 'quality', 'type', 'count', 'price', 'weight', 'name']);
  const weapons = I.ITEMS.filter((i) => i.category === 'weapon').slice(0, 6).map((i) => [i.id, 1]);
  const ch = bag([['ration', 3], ...weapons, ['medkit', 1], ['ration', 4], ['antirad', 2], ['veh_parts', 5], ['water_clean', 2]]);
  const total = ch.inventory.cells.length;
  assert.equal(Inv.sortCells(ch, 'logical'), null);
  assert.equal(ch.inventory.cells.length, total, 'ячеек столько же');
  const list = pick(ch), n = list.length;
  assert.ok(ch.inventory.cells.slice(0, n).every(Boolean) && ch.inventory.cells.slice(n).every((x) => !x), 'пустые — в конце');
  assert.equal(list.filter((x) => x.id === 'ration').length, 1, 'две стопки пайков сложились');
  assert.equal(list.find((x) => x.id === 'ration').n, 7);
  const tr = (x) => Inv.TYPE_ORDER.indexOf(I.get(x.id).category);
  for (let i = 1; i < n; i++) {
    assert.ok(tr(list[i - 1]) <= tr(list[i]), 'по типу: оружие → … → еда → материалы');
    if (tr(list[i - 1]) === tr(list[i])) assert.ok(rank(I.get(list[i - 1].id)) >= rank(I.get(list[i].id)), 'внутри типа — лучшее первым');
  }
  assert.equal(I.get(list[0].id).category, 'weapon');
  assert.equal(I.get(list[n - 1].id).category, 'material');
  Inv.sortCells(ch, 'count');
  const cnt = pick(ch).map((x) => x.n);
  assert.deepEqual(cnt, [...cnt].sort((a, b) => b - a), 'количество — по убыванию по умолчанию');
  Inv.sortCells(ch, 'count', 'asc');
  assert.deepEqual(pick(ch).map((x) => x.n), [...cnt].sort((a, b) => a - b), 'и по возрастанию');
  Inv.sortCells(ch, 'price');
  const pr = pick(ch).map((x) => I.get(x.id).value || 0);
  assert.deepEqual(pr, [...pr].sort((a, b) => b - a), 'цена — дорогое первым');
  Inv.sortCells(ch, 'quality');
  const q = pick(ch).map((x) => rank(I.get(x.id)));
  assert.deepEqual(q, [...q].sort((a, b) => b - a), 'качество — лучшее первым');
  Inv.sortCells(ch, 'name');
  const names = pick(ch).map((x) => I.get(x.id).name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'ru')));
  Inv.sortCells(ch, 'type', 'desc');
  assert.equal(I.get(pick(ch)[0].id).category, 'material', 'тип по убыванию — материалы первыми');
  assert.match(Inv.sortCells(ch, 'nope'), /Неизвестный/);
  assert.match(Inv.sortCells(ch, 'type', 'up'), /asc или desc/);
  // вещи с прочностью и особыми свойствами не сливаются
  const w = weapons[0][0], ch2 = bag([[w, 1], [w, 1]]);
  Inv.sortCells(ch2, 'logical');
  assert.equal(pick(ch2).length, 2);
});

test('WS: сортировка по действию, автопомощь — лечение и еда из сумки по порогу, переключатели запоминаются', async (t) => {
  const s = await startServer(['--set', 'game.cheatsForAll=true', '--set', 'game.survivalFoodPerMin=0', '--set', 'game.survivalWaterPerMin=0', '--set', 'game.autoUseIntervalSec=0.3', '--set', 'game.depotsPer256=0']);
  t.after(() => s.stop());
  const b = s.base, admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', { name: 'Сумка', seed: 'sort-1', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false }, admin.token)).data.world;
  const A = await joinWorld(b, admin, w.id);
  assert.deepEqual(A.welcome.inv.autoUse, { hp: false, mp: false, stamina: false, food: false, water: false, rest: false, rad: false, air: false, vehFuel: false, vehRepair: false });
  const cheat = async (msg) => { A.send({ t: 'cheat', ...msg }); const m = await A.next((x) => x.t === 'cheat-ok' || x.t === 'cheat-err', 4000); assert.equal(m.t, 'cheat-ok', m.message); return m; };
  await cheat({ a: 'give', item: 'medkit', count: 2 });
  await cheat({ a: 'give', item: 'herbs', count: 3 });
  await cheat({ a: 'give', item: 'ration', count: 3 });
  // сортировка
  A.send({ t: 'inv', a: { type: 'sort', mode: 'logical' } });
  const sorted = await A.next((m) => m.t === 'inv' && m.inventory, 3000);
  const cells = sorted.inventory.cells, n = cells.filter(Boolean).length;
  assert.ok(cells.slice(0, n).every(Boolean), 'после сортировки предметы подряд с начала');
  A.send({ t: 'inv', a: { type: 'sort', mode: 'bogus' } });
  assert.match((await A.next('inv-error', 3000)).message, /Неизвестный порядок/);
  // автопомощь
  A.send({ t: 'inv', a: { type: 'autoUse', modes: { hp: true, food: true } } });
  const on = await A.next((m) => m.t === 'inv' && m.autoUse && m.autoUse.hp, 3000);
  assert.equal(on.autoUse.food, true);
  assert.equal(on.autoUse.mp, false);
  A.send({ t: 'inv', a: { type: 'autoUse', modes: { hp: 'да' } } });
  assert.match((await A.next('inv-error', 3000)).message, /режимы автопомощи/);
  const has = (inv, id) => inv.cells.filter((x) => x && x.id === id).reduce((a, x) => a + x.n, 0);
  const inv0 = A.messages.filter((m) => m.t === 'inv' && m.inventory).pop().inventory;
  const herbs0 = has(inv0, 'herbs'), med0 = has(inv0, 'medkit'), ration0 = has(inv0, 'ration');
  await cheat({ a: 'edit', edit: { hp: 30, food: 10 } });
  const used = await A.next((m) => m.t === 'chat' && /Автопомощь/.test(m.m.text), 5000);
  assert.match(used.m.text, /«[^»]+» — (здоровье|сытость) \d+%/);
  // и здоровье, и сытость восстановлены предметами из сумки
  let inv = null;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const last = A.messages.filter((m) => m.t === 'inv' && m.inventory).pop();
    inv = last && last.inventory;
    const cnt = (id) => inv.cells.filter((x) => x && x.id === id).reduce((a, x) => a + x.n, 0);
    if (cnt('ration') < ration0 && (cnt('medkit') < med0 || cnt('herbs') < herbs0)) break;
  }
  const cnt = (id) => inv.cells.filter((x) => x && x.id === id).reduce((a, x) => a + x.n, 0);
  assert.ok(cnt('ration') < ration0, 'поел паёк');
  assert.ok(cnt('medkit') < med0 || cnt('herbs') < herbs0, 'подлечился');
  // выключено — не трогает
  A.send({ t: 'inv', a: { type: 'autoUse', modes: {} } });
  await A.next((m) => m.t === 'inv' && m.autoUse && !m.autoUse.hp, 3000);
  const r0 = cnt('ration');
  await cheat({ a: 'edit', edit: { food: 5 } });
  await sleep(1200);
  const last = A.messages.filter((m) => m.t === 'inv' && m.inventory).pop().inventory;
  assert.equal(last.cells.filter((x) => x && x.id === 'ration').reduce((a, x) => a + x.n, 0), r0, 'выключенная автопомощь ничего не ест');
  await A.close();
});

test('интерфейс: панель «Автопомощь» и сортировка сумки — у каждой кнопки подсказка, настройки с --help', () => {
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '../client/index.html'), 'utf8');
  const AU = require('../server/autouse');
  for (const k of AU.KINDS) {
    const m = html.match(new RegExp(`<button[^>]*data-autouse="${k}"[^>]*>`));
    assert.ok(m, 'кнопка ' + k);
    assert.match(m[0], /title="[^"]{10,}"/, 'подсказка у ' + k);
  }
  assert.match(html, /id="inv-sort-mode"/);
  assert.match(html, /id="btn-inv-sort"[^>]*title="[^"]{10,}"/);
  const cfg = fs.readFileSync(path.join(__dirname, '../server/config.js'), 'utf8');
  for (const k of ['autoUseEnabled', 'autoUseThresholdPct', 'autoUseRadAt', 'autoUseIntervalSec', 'autoUseRetrySec']) assert.match(cfg, new RegExp(`'game\\.${k}': '`), '--help для ' + k);
  const help = fs.readFileSync(path.join(__dirname, '../client/js/help.js'), 'utf8');
  assert.match(help, /Автопомощь/);
  assert.match(help, /Сортировка сумки/);
});
