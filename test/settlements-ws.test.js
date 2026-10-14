'use strict';
// Шаг 15 по WebSocket: жители появляются у поселения, разговор, торговля (атомарно, по формуле цены), лекарь, маг-наставник,
// рецепты, репутация (торговля, преступление, враждебность), стража, мирная зона, набег с наградой, сохранение, панель ГМ.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');
const G = require('../shared/worldgen');
const S = require('../shared/settlements');
const Items = require('../shared/items');

const SEED = 'stl-1';
const params = (o = {}) => ({ name: 'Поселения', seed: SEED, size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false, ...o });
const set = (o) => Object.entries({
  netDelta: false /* полные списки state в каждом тике: тест читает позиции из любого сообщения */, survivalFoodPerMin: 0, survivalWaterPerMin: 0, survivalRestPerMin: 0, chatRateCount: 500, stunChance: 0, depotsPer256: 0, respawnSec: 0, wantedSec: 3, repTradePer: 100, ...o,
}).flatMap(([k, v]) => ['--set', `game.${k}=${v}`]);
const reject = (c, re) => c.next((m) => m.t === 'npc-reject', 4000).catch(() => { throw new Error('нет отказа ' + re + ' ' + JSON.stringify(c.messages.slice(-4))); }).then((m) => { assert.match(m.message, re); return m; });
const offer = (c, what) => c.next((m) => m.t === 'npc-offer' && m.what === what, 4000);
const money = (inv) => inv.cells.filter((x) => x && x.id === 'caps').reduce((a, x) => a + x.n, 0) + 100 * inv.cells.filter((x) => x && x.id === 'gold_nugget').reduce((a, x) => a + x.n, 0);
const lastInv = (c) => c.next((m) => m.t === 'inv', 4000).then((m) => m.inventory);

test('WS поселения: жители, разговор, торговля, лекарь, маг, рецепты, репутация, стража, мирная зона, набег, сохранение, ГМ', async (t) => {
  let stage = 'начало';
  process.on('exit', (code) => { if (code) console.error('этап:', stage, JSON.stringify((globalThis.__A || { messages: [] }).messages.filter((m) => /npc-[ors]|reject|craft/.test(m.t)).slice(-4).map((m) => JSON.stringify(m).slice(0, 300)))); });
  const s = await startServer(set({}));
  t.after(() => { console.log(s.output().split('\n').filter((l) => l.includes('DBG')).join('\n')); return s.stop(); });
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  G.configure({ depotsPer256: 0 });
  const map = G.generate({ ...w }); // как клиент: по записи мира (форма карты, водоёмы)
  assert.equal(G.mapHash(map), w.mapHash);
  const town = map.towns.find((x) => x.kind === 'town');
  const A = await joinWorld(b, admin, w.id);
  globalThis.__A = A;
  assert.equal(A.welcome.towns.length, map.towns.length);
  assert.deepEqual(A.welcome.npcs, []);
  const tp = async (x, y) => { const r = await api(b, 'POST', '/api/admin/teleport', { username: 'admin', x, y }, admin.token); assert.equal(r.status, 200, JSON.stringify(r.data)); await sleep(150); };
  const give = async (item, count) => { const r = await api(b, 'POST', '/api/admin/items/give', { username: 'admin', item, count }, admin.token); assert.equal(r.status, 200, JSON.stringify(r.data)); };
  const npc = (role) => town.npcs.find((n) => n.role === role);

  stage = 'жители появляются';
  await tp(npc('trader').x, npc('trader').y);
  const added = new Set();
  while (added.size < town.npcs.length) added.add((await A.next((m) => m.t === 'npc-add' && m.npc.sid === town.id, 4000)).npc.id);
  const trader = npc('trader');

  stage = 'разговор';
  A.send({ t: 'npc', a: 'talk', id: trader.id });
  const talk = await A.next('npc-talk');
  assert.equal(talk.dlg, 'trader');
  assert.equal(talk.town.tier, 'neutral');
  A.send({ t: 'npc', a: 'talk', id: npc('mage').id }); // далеко
  await reject(A, /Подойдите ближе/);

  stage = 'торговля';
  A.send({ t: 'npc', a: 'trade', id: trader.id });
  let o = await offer(A, 'trade');
  assert.ok(o.stock.length >= 5);
  const item = o.stock.find((x) => x.price <= 300 && x.n >= 2) || o.stock.find((x) => x.price <= 900);
  assert.equal(item.price, S.price(Items.get(item.id), 'buy', { rep: 0 }));
  A.send({ t: 'npc', a: 'buy', id: trader.id, item: item.id, n: 1 });
  await reject(A, /Не хватает денег/); // денег нет — ничего не меняется
  await give('gold_nugget', 10);
  let inv = await lastInv(A);
  assert.equal(money(inv), 1000);
  A.drain();
  A.send({ t: 'npc', a: 'buy', id: trader.id, item: item.id, n: 1 });
  inv = await lastInv(A);
  assert.equal(money(inv), 1000 - item.price);
  assert.ok(inv.cells.some((x) => x && x.id === item.id));
  o = await offer(A, 'trade');
  assert.equal((o.stock.find((x) => x.id === item.id) || { n: 0 }).n, item.n - 1);
  A.send({ t: 'npc', a: 'buy', id: trader.id, item: item.id, n: 999 });
  await reject(A, /В наличии только|Этого товара нет/);
  // продажа: цена по формуле (новая вещь)
  await give('scrap_metal', 5);
  inv = await lastInv(A);
  const before = money(inv), cell = inv.cells.findIndex((x) => x && x.id === 'scrap_metal');
  A.drain();
  A.send({ t: 'npc', a: 'sell', id: trader.id, i: cell, n: 5 });
  inv = await lastInv(A);
  assert.equal(money(inv), before + 5 * S.price(Items.get('scrap_metal'), 'sell', { rep: 0 }));
  assert.ok(!inv.cells.some((x) => x && x.id === 'scrap_metal'));
  A.send({ t: 'npc', a: 'sell', id: trader.id, i: inv.cells.findIndex((x) => x && x.id === 'caps'), n: 1 });
  await reject(A, /не берёт/);

  stage = 'лекарь';
  const healer = npc('healer');
  await tp(healer.x, healer.y);
  assert.equal((await api(b, 'POST', '/api/admin/characters/edit', { username: 'admin', characterId: admin.characterId, hp: 20, rad: 40 }, admin.token)).status, 200);
  A.send({ t: 'npc', a: 'heal', id: healer.id });
  o = await offer(A, 'heal');
  assert.ok(o.heal.miss > 0 && o.heal.price > 0 && o.cure.need === 1);
  A.drain();
  A.send({ t: 'npc', a: 'heal', id: healer.id, go: 1 });
  await A.next((m) => m.t === 'me' && m.hp >= m.mhp, 4000);
  await offer(A, 'heal');
  A.send({ t: 'npc', a: 'cure', id: healer.id });
  o = await offer(A, 'heal');
  assert.equal(o.cure.need, 0);
  A.send({ t: 'npc', a: 'cure', id: healer.id });
  await reject(A, /не больны/);

  stage = 'маг-наставник';
  const mage = npc('mage');
  await tp(mage.x, mage.y);
  await give('gold_nugget', 20);
  A.send({ t: 'npc', a: 'learn', id: mage.id });
  o = await offer(A, 'learn');
  assert.ok(o.spells.every((x) => x.tier <= S.KINDS.town.spellTier));
  const sp = o.spells.find((x) => !x.known && !x.err);
  assert.ok(sp, 'есть чему учиться: ' + JSON.stringify(o.spells.slice(0, 3)));
  A.send({ t: 'npc', a: 'learn', id: mage.id, spell: sp.id });
  await A.next((m) => m.t === 'magic-learn' && m.spell === sp.id && m.how === 'mage', 4000);
  const tier3 = require('../shared/magic').SPELLS.find((x) => x.tier === 3);
  A.send({ t: 'npc', a: 'learn', id: mage.id, spell: tier3.id });
  await reject(A, /не учат/);

  stage = 'рецепты';
  const rc = npc('recipes');
  await tp(rc.x, rc.y);
  A.send({ t: 'npc', a: 'recipes', id: rc.id });
  o = await offer(A, 'recipes');
  const rec = o.recipes.find((x) => !x.known && x.price <= 1500);
  A.send({ t: 'npc', a: 'recipes', id: rc.id, recipe: rec.id });
  const craft = await A.next((m) => m.t === 'craft' && m.known && m.known.includes(rec.id), 4000).catch(() => null);
  if (!craft) { A.send({ t: 'npc', a: 'recipes', id: rc.id }); o = await offer(A, 'recipes'); assert.equal(o.recipes.find((x) => x.id === rec.id).known, 1); }
  A.send({ t: 'npc', a: 'recipes', id: rc.id, recipe: rec.id });
  await reject(A, /уже известен/);
  // мастерская поселения — общий верстак
  const ws = town.buildings.find((x) => x.kind === 'workshop' && x.built);
  if (ws) { await tp(ws.inner.x + 0.5, ws.inner.y + 0.5); A.send({ t: 'craft', a: 'list' }); const cr = await A.next((m) => m.t === 'craft' && m.stations, 4000); assert.ok(cr.stations.includes('workbench')); }

  stage = 'репутация за торговлю';
  const list0 = (await api(b, 'POST', '/api/admin/settlements/list', { worldId: w.id }, admin.token)).data;
  const me0 = list0.towns[town.id].reps.find((x) => x.name === 'Алиса');
  assert.ok(me0 && me0.rep >= 1, 'торговля подняла репутацию: ' + JSON.stringify(list0.towns[town.id]));

  stage = 'мирная зона';
  await tp(town.x + 0.5, town.y + 0.5);
  await give('mine_frag', 1).catch(() => give(Items.ITEMS.find((x) => x.placeable && x.weapon).id, 1));
  const mine = Items.ITEMS.find((x) => x.placeable && x.weapon);
  A.send({ t: 'place', item: mine.id });
  assert.match((await A.next((m) => m.t === 'atk-reject' && m.reason === 'place', 4000)).message, /мирная зона/);

  stage = 'преступление';
  const civ = npc('civilian');
  const st = await A.next((m) => m.t === 'state' && m.np && m.np.some((x) => x[0] === civ.id), 4000);
  const cpos = st.np.find((x) => x[0] === civ.id);
  await tp(cpos[1], cpos[2]);
  A.drain();
  A.send({ t: 'atk', slot: 'main', target: civ.id, tk: 'n' });
  await A.next((m) => m.t === 'fx' && m.ev.some((e) => e.k === 'hit' && e.t === 'n' && e.id === civ.id), 4000);
  const tw = await A.next((m) => m.t === 'stl-town' && m.town.id === town.id, 4000);
  assert.ok(tw.town.rep < me0.rep);
  // стражник идёт наказывать
  await A.next((m) => m.t === 'fx' && m.ev.some((e) => e.k === 'hit' && e.t === 'p' && e.id === A.welcome.you), 12000);
  // в розыске с вами не торгуют
  A.send({ t: 'npc', a: 'talk', id: civ.id });
  A.send({ t: 'npc', a: 'trade', id: civ.id });
  await reject(A, /стражей|не торгует/);

  stage = 'враждебность';
  assert.equal((await api(b, 'POST', '/api/admin/settlements/act', { worldId: w.id, sid: town.id, act: 'rep', username: 'admin', value: -80 }, admin.token)).status, 200);
  const tw2 = await A.next((m) => m.t === 'stl-town' && m.town.tier === 'hostile', 4000);
  assert.ok(tw2.town.rep <= -80); // + доля репутации Союза поселений (шаг 16: упала от преступления)
  const lst = await api(b, 'POST', '/api/admin/settlements/list', { worldId: w.id }, admin.token);
  const me = lst.data.towns.find((t) => t.id === town.id).reps.find((x) => x.rep === -80);
  assert.ok(me && me.username === 'admin' && me.tier === 'hostile' && me.tierName, JSON.stringify(lst.data.towns[town.id]));
  await tp(trader.x, trader.y);
  A.send({ t: 'npc', a: 'trade', id: trader.id });
  await reject(A, /врагом/);
  // фракция: в другом поселении того же рода тоже упало (часть изменения от преступления)
  assert.equal((await api(b, 'POST', '/api/admin/settlements/act', { worldId: w.id, sid: town.id, act: 'rep', username: 'admin', value: 0 }, admin.token)).status, 200);
  await sleep(3500); // розыск закончился
  say(A, '/heal');

  stage = 'набег';
  const raid = await api(b, 'POST', '/api/admin/settlements/act', { worldId: w.id, sid: town.id, act: 'raid', count: 2 }, admin.token);
  assert.equal(raid.status, 200, JSON.stringify(raid.data));
  await A.next((m) => m.t === 'chat' && /Набег на/.test(m.text || (m.msg && m.msg.text) || JSON.stringify(m)), 4000);
  const tr = await A.next((m) => m.t === 'stl-town' && m.town.raid === 1, 4000);
  assert.equal(tr.town.id, town.id);
  await tp(town.x + 0.5, town.y + 0.5);
  inv = await lastInv(A).catch(() => null);
  const gold0 = (A.messages.filter((m) => m.t === 'inv').pop().inventory.cells.filter((x) => x && x.id === 'gold_nugget').reduce((a, x) => a + x.n, 0));
  say(A, '/kill all');
  await A.next((m) => m.t === 'chat' && /отбит/.test(JSON.stringify(m)), 6000);
  const inv2 = await A.next((m) => m.t === 'inv' && m.inventory.cells.filter((x) => x && x.id === 'gold_nugget').reduce((a, x) => a + x.n, 0) === gold0 + S.settings.raidRewardGold, 4000);
  assert.ok(inv2);
  const tw3 = await A.next((m) => m.t === 'stl-town' && m.town.id === town.id && m.town.raid === 0 && m.town.rep >= S.settings.repDefend, 4000);
  assert.ok(tw3);

  stage = 'ГМ и сохранение';
  assert.equal((await api(b, 'POST', '/api/admin/settlements/act', { worldId: w.id, sid: town.id, act: 'restock' }, admin.token)).data.stockN, 1);
  assert.equal((await api(b, 'POST', '/api/admin/settlements/act', { worldId: w.id, sid: town.id, act: 'nope' }, admin.token)).status, 400);
  assert.equal((await api(b, 'POST', '/api/admin/settlements/act', { worldId: w.id, sid: 999, act: 'restock' }, admin.token)).status, 404);
  const bob = await newPlayer(b, 'bob', 'Боб');
  assert.equal((await api(b, 'POST', '/api/admin/settlements/list', { worldId: w.id }, bob.token)).status, 403);
  await A.close();
  await sleep(300);
  const fs = require('fs'), path = require('path');
  const file = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'worlds', `${w.id}.settlements.json`), 'utf8'));
  const repSaved = file.towns[town.id].rep[admin.characterId];
  assert.ok(repSaved >= S.settings.repDefend);
  const list1 = (await api(b, 'POST', '/api/admin/settlements/list', { worldId: w.id }, admin.token)).data;
  assert.equal(list1.towns[town.id].reps.find((x) => x.name === 'Алиса').rep, repSaved);
  assert.equal(list1.towns[town.id].stockN, 1);
});
function say(c, text) { c.send({ t: 'chat', text }); }
