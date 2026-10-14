'use strict';
// Поселения (шаг 15): застройка по сиду, данные жителей и диалогов, цены, товар, репутация
const test = require('node:test');
const assert = require('node:assert');
const WorldGen = require('../shared/worldgen');
const S = require('../shared/settlements');
const Items = require('../shared/items');

test('поселения: каталог и диалоги без ошибок; кривой диалог ловится', () => {
  assert.deepEqual(S.validate(), []);
  const bad = { start: 'a', nodes: { a: { text: 'x', options: [{ text: 'y', next: 'nope' }, { text: 'z', action: 'fly' }, { text: 'w', next: 'a', action: 'bye' }] }, lost: { text: 'q', options: [{ text: 'ok', action: 'bye' }] } } };
  const errs = S.validateDialogue(bad, 'bad').join('\n');
  for (const re of [/несуществующий узел nope/, /неизвестное действие fly/, /ровно одно/, /lost: узел недостижим/]) assert.match(errs, re);
  assert.match(S.validateDialogue({ start: 'x', nodes: {} }, 'e')[0], /нет стартового узла/);
  // условия вариантов и подстановка
  const node = S.DIALOGUES.trader.nodes.hi;
  assert.ok(S.optionsFor(node, { tier: 'neutral' }).some((o) => o.action === 'trade'));
  assert.ok(!S.optionsFor(node, { tier: 'hostile' }).some((o) => o.action === 'trade'));
  assert.equal(S.fill('{npc} в {town}: {tier}', { npc: 'Ефим', town: 'Ржавово', tier: 'friendly' }), 'Ефим в Ржавово: дружба');
});

test('поселения: застройка детерминирована, из центра есть выход, жители не в стенах, клетки карты не меняются', () => {
  for (const seed of ['alpha', 'beta', 'gamma', 'delta']) {
    const a = WorldGen.generate({ seed, size: 'small' }), b = WorldGen.generate({ seed, size: 'small' });
    assert.deepEqual(a.towns, b.towns);
    assert.equal(a.towns.length, a.settlements.length);
    // Friendly approach opens gates; closed gates intentionally block the perimeter.
    a.openGates = new Set(a.towns.flatMap(t => t.gateCells || []));
    for (const t of a.towns) {
      assert.ok(S.reachesOutside(a, new Set([...(a.walls || [])].filter(j => !(t.gateCells || []).includes(j))), t.x, t.y, t.r), `${seed}/${t.id}: центр замурован`);
      assert.equal(t.npcs.length, S.KINDS[t.kind].roles.length);
      for (const n of t.npcs) assert.ok(WorldGen.isWalkable(a, Math.floor(n.x), Math.floor(n.y)), `${seed}/${t.id}: ${n.role} в стене`);
      assert.ok(WorldGen.isWalkable(a, t.x, t.y));
      assert.equal(S.at(a, t.x + 0.5, t.y + 0.5), t);
      assert.notStrictEqual(S.at(a,t.x+t.zone+3,t.y),t);
    }
    assert.ok(WorldGen.isWalkable(a, a.spawn.x, a.spawn.y));
  }
  // стены — отдельный слой: контрольная сумма карты та же, что без застройки
  const m = WorldGen.generate({ seed: 'alpha', size: 'small' });
  assert.ok(m.walls && m.walls.size > 0);
  const hash = WorldGen.mapHash(m);
  delete m.walls; delete m.towns;
  assert.equal(WorldGen.mapHash(m), hash);
  // в укреплённой базе — кольцо стен с воротами
  let ring = false;
  for (const seed of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) {
    const w = WorldGen.generate({ seed, size: 'small' });
    for (const t of w.towns) if (t.kind === 'base' && t.walls.length > 30) ring = true;
  }
  assert.ok(ring, 'нет ни одной базы со стеной');
  // без застройки — ни стен, ни домов
  S.configure({ settlementLayout: false });
  try { const w = WorldGen.generate({ seed: 'alpha', size: 'small' }); assert.ok(!w.walls); assert.ok(w.towns.every((t) => t.buildings.every((b) => !b.built))); } finally { S.configure({ settlementLayout: true }); }
});

test('поселения: цены по редкости и репутации, товар по сиду, ступени репутации', () => {
  const common = Items.get('ration'), rare = Items.get('pistol_warden');
  const buy = S.price(common, 'buy', { rep: 0 }), sell = S.price(common, 'sell', { rep: 0 });
  assert.equal(buy, Math.ceil(common.value * 1 * S.settings.tradeBuyFactor));
  assert.ok(sell < buy && sell >= 1);
  assert.equal(S.price(rare, 'buy', { rep: 0 }), Math.ceil(rare.value * S.RARITY_MUL.rare * S.settings.tradeBuyFactor));
  assert.ok(S.price(rare, 'buy', { rep: 100 }) < S.price(rare, 'buy', { rep: 0 }));
  assert.ok(S.price(rare, 'buy', { rep: -100 }) > S.price(rare, 'buy', { rep: 0 }));
  assert.ok(S.price(rare, 'sell', { rep: 100 }) > S.price(rare, 'sell', { rep: 0 }));
  assert.ok(S.price(rare, 'buy', { rep: 0, damaged: true }) > S.price(rare, 'buy', { rep: 0 }));
  assert.ok(!S.tradable(Items.get('caps')) && !S.tradable(Items.get('gold_nugget')));
  // продавать дороже, чем покупать, нельзя ни при какой репутации
  for (const it of Items.ITEMS.filter(S.tradable)) assert.ok(S.price(it, 'sell', { rep: 100 }) <= S.price(it, 'buy', { rep: 100 }), it.id);
  const town = { id: 3, type: 'town' };
  const s1 = S.stockFor('seed', town, 'trader', 0);
  assert.deepEqual(S.stockFor('seed', town, 'trader', 0), s1);
  assert.notDeepEqual(S.stockFor('seed', town, 'trader', 1), s1);
  assert.ok(Object.keys(s1).length >= 8);
  for (const id of Object.keys(s1)) assert.ok(['common', 'uncommon', 'rare'].includes(Items.get(id).rarity));
  const meds = S.stockFor('seed', town, 'healer', 0);
  for (const id of Object.keys(meds)) assert.equal(Items.get(id).category, 'consumable');
  assert.equal(S.tierOf(-60), 'hostile'); assert.equal(S.tierOf(-20), 'unfriendly'); assert.equal(S.tierOf(0), 'neutral');
  assert.equal(S.tierOf(30), 'friendly'); assert.equal(S.tierOf(80), 'honored');
  assert.equal(S.tierBonus(80), 2); assert.equal(S.tierBonus(-60), -2);
  assert.equal(S.clampRep(500), 100);
});
