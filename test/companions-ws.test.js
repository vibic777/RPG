'use strict';
// Спутники по WebSocket: приручение связанного лассо зверя, места «Напарников», контейнер-уменьшитель, договор с оплатой,
// взлом, внушение (временно), дракон (контейнер, навык, амулет), верховой дракон, переход в другой мир, панель ГМ, военный склад.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');
const WorldGen = require('../shared/worldgen');

const params = (o = {}) => ({ name: 'Спутники', seed: 'comp-1', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false, ...o });
const set = (o) => Object.entries({
  netDelta: false /* полные списки state в каждом тике: тест читает позиции из любого сообщения */, survivalFoodPerMin: 0, survivalWaterPerMin: 0, survivalRestPerMin: 0, chatRateCount: 200, lassoHoldSec: 30, stunChance: 0,
  compChanceMin: 1, compTryCooldownSec: 0, compTameRange: 6, depotsPer256: 0, ...o,
}).flatMap(([k, v]) => ['--set', `game.${k}=${v}`]);
const say = (c, text) => c.send({ t: 'chat', text });
const reject = async (c, re) => assert.match((await c.next('comp-reject', 8000)).message, re);
const list = (c, pred = () => true) => c.next((m) => m.t === 'comp-list' && pred(m), 8000);
async function give(b, token, item, count = 1) {
  const r = await api(b, 'POST', '/api/admin/items/give', { username: 'admin', item, count }, token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
}
const stats = (b, admin, st) => api(b, 'POST', '/api/admin/characters/edit', { username: 'admin', characterId: admin.characterId, stats: st }, admin.token);
async function lassoReady(c, b, admin) {
  say(c, '/setlevel Алиса 6');
  await c.next((m) => m.t === 'me' && m.lvl === 6);
  await give(b, admin.token, 'lasso_arkan');
  const inv = await c.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'lasso_arkan'));
  c.send({ t: 'inv', a: { type: 'equip', from: { c: 'cell', i: inv.inventory.cells.findIndex((x) => x && x.id === 'lasso_arkan') }, slot: 'mainHand' } });
  await c.next((m) => m.t === 'inv' && m.inventory.equipment.mainHand && m.inventory.equipment.mainHand.id === 'lasso_arkan');
  await give(b, admin.token, 'ammo_cell', 60); // запас: под нагрузкой лассо чаще промахивается по дракону
  await c.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'ammo_cell'));
  c.send({ t: 'reload' });
  await c.next((m) => m.t === 'me' && m.mag.main && m.mag.main.n > 0, 5000);
}
// Вызвать существо и связать его лассо
async function spawnBound(c, id) {
  say(c, '/spawn ' + id);
  let e = (await c.next((m) => m.t === 'enemy-add' && m.enemy.type === id)).enemy;
  for (let i = 0; i < 20; i++) { // лассо может промахнуться по летящему дракону — пробуем дольше
    const n1 = c.messages.length;
    c.send({ t: 'atk', slot: 'main', target: e.id, tk: 'e' });
    try { await c.next((m) => m.t === 'state' && m.e.some((x) => x[0] === e.id && x[4] & 16), 2500); return e; } catch {
      // под нагрузкой (параллельный npm test) магазин пустеет: ждём настоящей перезарядки, а не фиксированную паузу
      // под нагрузкой существо успевает погибнуть или исчезнуть («Цель уже недоступна») — вызываем новое
      if (c.messages.slice(n1).some((m) => m.t === 'atk-reject' && m.reason === 'target')) {
        say(c, '/spawn ' + id);
        e = (await c.next((m) => m.t === 'enemy-add' && m.enemy.type === id && m.enemy.id !== e.id)).enemy;
      }
      // летящий дракон под нагрузкой уходит из-под петли — подойти к нему вплотную (телепорт чит-панели)
      const st = c.messages.filter((m) => m.t === 'state' && m.e && m.e.some((x) => x[0] === e.id)).pop();
      if (st && i % 2 === 1) { const x = st.e.find((q) => q[0] === e.id); c.send({ t: 'cheat', a: 'tp', x: x[1] + 1.2, y: x[2] }); await sleep(300); }
      const n0 = c.messages.length;
      c.send({ t: 'reload' });
      try { await c.next((m) => m.t === 'me' && m.mag && m.mag.main && m.mag.main.n > 0 && c.messages.indexOf(m) >= n0, 6000); } catch { await sleep(1600); }
    }
  }
  throw new Error('не связали ' + id + ' ' + JSON.stringify(c.messages.filter((m) => m.t === 'atk-reject').slice(-3)));
}
async function spawnFree(c, id) {
  say(c, '/spawn ' + id);
  return (await c.next((m) => m.t === 'enemy-add' && m.enemy.type === id)).enemy;
}

test('WS спутники: приручение, места, контейнер, договор, взлом, внушение, дракон и полёт, другой мир, панель ГМ', async (t) => {
  const s = await startServer(set({ compSuggestSec: 1, compSuggestSecPerStat: 0, compSuggestMpCost: 5 }));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  const A = await joinWorld(b, admin, w.id);
  assert.deepEqual(A.welcome.comps, []);
  await lassoReady(A, b, admin);
  assert.equal((await stats(b, admin, { taming: 3, companions: 1, persuasion: 3, hacking: 3, suggestion: 3 })).status, 200);

  // не связанного не приручить
  const free = await spawnFree(A, 'boar');
  A.send({ t: 'tame', target: free.id, method: 'tame' });
  await reject(A, /свяжите/);
  say(A, '/kill all');
  // связанный волк — ручной
  const wolf = await spawnBound(A, 'wolf');
  A.send({ t: 'tame', target: wolf.id });
  const ok = await A.next('comp-try');
  assert.equal(ok.ok, 1);
  await A.next((m) => m.t === 'enemy-remove' && m.id === wolf.id);
  await A.next((m) => m.t === 'comp-add' && m.comp.def === 'wolf');
  let L = await list(A, (m) => m.list.length === 1);
  assert.equal(L.list[0].out, 1);
  assert.equal(L.slots, 1);
  assert.equal(L.shrinker, 0);
  const wolfId = L.list[0].id;
  // места кончились — нельзя; вся команда (и спутники в контейнере) ограничена «Напарниками»
  const bear = await spawnBound(A, 'bear');
  A.send({ t: 'tame', target: bear.id });
  await reject(A, /Команда заполнена/);
  // спрятать без контейнера нельзя
  A.send({ t: 'comp', a: 'store', id: wolfId });
  await reject(A, /контейнер/);
  // с контейнером волк прячется, но место за ним остаётся
  await give(b, admin.token, 'shrinker');
  await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'shrinker'));
  A.send({ t: 'comp', a: 'store', id: wolfId });
  L = await list(A, (m) => m.list.length === 1 && m.list[0].out === 0);
  A.send({ t: 'tame', target: bear.id });
  await reject(A, /контейнер места не освобождает/);
  // второе место — медведь в команде и рядом, волк в контейнере
  assert.equal((await stats(b, admin, { companions: 2 })).status, 200);
  A.send({ t: 'tame', target: bear.id });
  assert.equal((await A.next('comp-try')).ok, 1);
  L = await list(A, (m) => m.list.length === 2);
  const bearRec = L.list.find((x) => x.def === 'bear');
  assert.equal(bearRec.out, 1);
  // «Напарники» снижены до 1: рядом уже медведь — волка не призвать
  assert.equal((await stats(b, admin, { companions: 1 })).status, 200);
  A.send({ t: 'comp', a: 'summon', id: wolfId });
  await reject(A, /места заняты/);
  // приказы и стойка (приказ «всем» — тем, кто рядом: медведю)
  A.send({ t: 'comp', a: 'order', id: 'all', order: 'guard' });
  L = await list(A, (m) => (m.list.find((x) => x.id === bearRec.id) || {}).order === 'guard');
  A.send({ t: 'comp', a: 'stance', id: bearRec.id, stance: 'passive' });
  await list(A, (m) => (m.list.find((x) => x.id === bearRec.id) || {}).stance === 'passive');

  // договор с оплатой: без золота — отказ, с золотом — завербован, золото потрачено
  assert.equal((await stats(b, admin, { companions: 11 })).status, 200);
  const thug = await spawnFree(A, 'raider_thug');
  A.send({ t: 'tame', target: thug.id, method: 'persuade', pay: true });
  await reject(A, /самородков/);
  await give(b, admin.token, 'gold_nugget', 10);
  await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'gold_nugget'));
  A.send({ t: 'tame', target: thug.id, method: 'persuade', pay: true });
  assert.equal((await A.next('comp-try')).method, 'persuade');
  const inv = await A.next((m) => m.t === 'inv' && m.inventory.cells.reduce((a, x) => a + (x && x.id === 'gold_nugget' ? x.n : 0), 0) < 10);
  assert.ok(inv);
  // взлом робота — тратит электронику
  const bot = await spawnFree(A, 'walker_patrol');
  A.send({ t: 'tame', target: bot.id, method: 'hack' });
  await reject(A, /электроник/);
  await give(b, admin.token, 'electronics', 2);
  await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'electronics'));
  A.send({ t: 'tame', target: bot.id, method: 'hack' });
  assert.equal((await A.next('comp-try')).method, 'hack');
  // зомби тоже приручается, но, как и зверя, его сперва нужно связать лассо
  const z = await spawnFree(A, 'zombie');
  A.send({ t: 'tame', target: z.id });
  await reject(A, /свяжите/);
  say(A, '/kill all');
  // внушение: временно, потом существо снова враг
  const boar = await spawnFree(A, 'boar');
  A.send({ t: 'tame', target: boar.id, method: 'suggest' });
  const sg = await A.next('comp-try');
  assert.equal(sg.method, 'suggest');
  await A.next((m) => m.t === 'comp-remove' && m.id === sg.id, 5000);
  await A.next((m) => m.t === 'enemy-add' && m.enemy.type === 'boar', 3000);
  say(A, '/kill all');

  // дракон: нужен контейнер (есть), Приручение ≥ 5 и драконий амулет; в команде волк, медведь, бандит и робот — дракону пятое место
  assert.equal((await stats(b, admin, { companions: 5 })).status, 200);
  // драконы теперь колдуют (ледяные чары): под нагрузкой полного прогона герой успевал погибнуть, пока ловил дракона лассо
  A.send({ t: 'gm', a: 'god', god: { invulnerable: true, noclip: true } });
  await A.next((m) => m.t === 'god' && m.god.invulnerable);
  const dragon = await spawnBound(A, 'dragon_ice');
  A.send({ t: 'tame', target: dragon.id });
  await reject(A, /Приручение/);
  assert.equal((await stats(b, admin, { taming: 6 })).status, 200);
  A.send({ t: 'tame', target: dragon.id });
  await reject(A, /Драконий амулет/);
  await give(b, admin.token, 'dragon_charm');
  await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'dragon_charm'));
  A.send({ t: 'tame', target: dragon.id });
  assert.equal((await A.next('comp-try')).ok, 1);
  await A.next((m) => m.t === 'inv' && !m.inventory.cells.some((x) => x && x.id === 'dragon_charm'));
  L = await list(A, (m) => m.list.some((x) => x.def === 'dragon_ice'));
  const dr = L.list.find((x) => x.def === 'dragon_ice');
  // спрятать всех и призвать одного дракона
  for (const x of L.list.filter((y) => y.out)) A.send({ t: 'comp', a: 'store', id: x.id });
  await list(A, (m) => !m.list.some((x) => x.out));
  A.send({ t: 'comp', a: 'summon', id: dr.id });
  await A.next((m) => m.t === 'comp-add' && m.comp.id === dr.id);
  A.send({ t: 'comp', a: 'mount', id: dr.id });
  const mt = await A.next('comp-mount');
  assert.equal(mt.id, dr.id);
  assert.equal(mt.fly, 1);
  assert.ok(mt.speed > 1);
  A.send({ t: 'comp', a: 'breath', x: 0, y: 0 });
  await A.next('comp-breath');
  A.send({ t: 'comp', a: 'mount' }); // повторно — слезть
  assert.equal((await A.next('comp-mount')).id, null);

  // спутники хранятся на герое и переходят в другой мир
  const w2 = (await api(b, 'POST', '/api/worlds', params({ name: 'Второй', seed: 'comp-2' }), admin.token)).data.world;
  A.close();
  await sleep(300);
  const cdir = path.join(s.dataDir, 'characters');
  const file = fs.readdirSync(cdir).map((f) => JSON.parse(fs.readFileSync(path.join(cdir, f), 'utf8')).characters[0]).find((x) => x && x.id === admin.characterId);
  assert.equal(file.companions.length, 5);
  assert.equal(file.companions.find((x) => x.id === dr.id).out, true);
  const A2 = await joinWorld(b, admin, w2.id);
  await A2.next((m) => m.t === 'comp-add' && m.comp.id === dr.id);
  L = await list(A2);
  assert.equal(L.list.length, 5);
  assert.equal(L.list.filter((x) => x.out).length, 1);

  // панель ГМ: список, выдать, призвать рядом, убрать
  let r = await api(b, 'POST', '/api/admin/companions/list', { username: 'admin' }, admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.list.length, 5);
  assert.equal(r.data.online, true);
  r = await api(b, 'POST', '/api/admin/companions/give', { username: 'admin', def: 'nope' }, admin.token);
  assert.equal(r.status, 400);
  // команда 5 из 5 — выдать нельзя даже ГМ (контейнер места не освобождает)
  r = await api(b, 'POST', '/api/admin/companions/give', { username: 'admin', def: 'wolf_mutant', level: 7 }, admin.token);
  assert.notEqual(r.status, 200, JSON.stringify(r.data));
  assert.match(JSON.stringify(r.data), /Команда заполнена/);
  assert.equal((await stats(b, admin, { companions: 6 })).status, 200);
  r = await api(b, 'POST', '/api/admin/companions/give', { username: 'admin', def: 'wolf_mutant', level: 7 }, admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.companion.lvl, 7);
  r = await api(b, 'POST', '/api/admin/companions/remove', { username: 'admin', id: dr.id }, admin.token);
  assert.equal(r.status, 200);
  await A2.next((m) => m.t === 'comp-remove' && m.id === dr.id);
  r = await api(b, 'POST', '/api/admin/companions/spawn', { username: 'admin', def: 'bear_mutant', level: 9 }, admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await A2.next((m) => m.t === 'comp-add' && m.comp.def === 'bear_mutant');
  const log = fs.readFileSync(path.join(s.dataDir, 'admin-log.jsonl'), 'utf8');
  assert.match(log, /companion-give/);
  assert.match(log, /companion-remove/);
  assert.match(log, /companion-spawn/);
  A2.close();
});

test('WS военный склад: охрана шагоходов появляется при подходе, открыть можно только после неё, внутри — контейнер', async (t) => {
  const s = await startServer(set({ depotsPer256: 4, depotGuards: 2 }));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params({ seed: 'depot-2' }), admin.token)).data.world;
  WorldGen.configure({ depotsPer256: 4 });
  const map = WorldGen.generate({ ...w });
  WorldGen.configure({ depotsPer256: 2 });
  const A = await joinWorld(b, admin, w.id);
  assert.ok(A.welcome.depots.length >= 1);
  assert.deepEqual(A.welcome.depots, map.depots);
  const d = map.depots[0];
  A.send({ t: 'comp', a: 'depot', id: d.id });
  await reject(A, /Подойдите/);
  const r = await api(b, 'POST', '/api/admin/teleport', { x: d.x + 0.5, y: d.y + 1.5 }, admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await A.next((m) => m.t === 'enemy-add' && m.enemy.type === 'walker_patrol', 4000);
  A.send({ t: 'comp', a: 'depot', id: d.id });
  await reject(A, /охраняют/);
  say(A, '/kill all');
  await A.next((m) => m.t === 'enemy-remove');
  await sleep(200);
  A.send({ t: 'comp', a: 'depot', id: d.id });
  await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'shrinker'), 4000);
  A.send({ t: 'comp', a: 'depot', id: d.id });
  await reject(A, /пуст/);
  A.close();
});
