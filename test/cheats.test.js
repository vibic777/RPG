'use strict';
// Чит-панель (шаг 20): доступ (администратор / все при game.cheatsForAll), действия и журнал администратора
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');

const params = (seed) => ({ name: 'Читы', seed, size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false });
const SET = ['--set', 'game.survivalFoodPerMin=0', '--set', 'game.survivalWaterPerMin=0', '--set', 'game.depotsPer256=0'];
async function cheat(C, msg) {
  C.drain();
  C.send({ t: 'cheat', ...msg });
  const m = await C.next((x) => x.t === 'cheat-ok' || x.t === 'cheat-err', 4000);
  return m.t === 'cheat-err' ? { err: m.message } : m;
}

test('WS чит-панель: администратор может, обычный игрок — нет; действия работают и пишутся в журнал', async (t) => {
  const s = await startServer(SET);
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const bob = await newPlayer(b, 'bob', 'Боб');
  const w = (await api(b, 'POST', '/api/worlds', params('cheat-a'), admin.token)).data.world;
  const wb = (await api(b, 'POST', '/api/worlds', params('cheat-b'), bob.token)).data.world;
  const B = await joinWorld(b, bob, wb.id);
  assert.equal(B.welcome.cheats, false, 'обычному игроку панель не положена');
  B.send({ t: 'cheat', a: 'give', item: 'caps', count: 5 });
  assert.match((await B.next('cheat-err')).message, /только администратору/);
  await B.close();

  const A = await joinWorld(b, admin, w.id);
  assert.equal(A.welcome.cheats, true);
  A.send({ t: 'cheat', a: 'info' });
  const info = await A.next('cheat-info');
  assert.ok(info.allowed && info.schools.includes('fire') && info.roles.some((r) => r.id === 'guard'));
  assert.ok(!(await cheat(A, { a: 'give', item: 'caps', count: 7 })).err);
  assert.match((await cheat(A, { a: 'money', count: 300 })).text, /× 300/);
  assert.match((await cheat(A, { a: 'give', item: 'нет_такого' })).err, /Неизвестный предмет/);
  // режим бога: скорость (ограничена cheatSpeedMax), бесконечные шкалы, сквозь препятствия, стройка без ресурсов
  const g = await cheat(A, { a: 'god', god: { speed: 99, infinite: true, noclip: true, freeBuild: true, invulnerable: true } });
  assert.deepEqual([g.god.speed, g.god.infinite, g.god.noclip, g.god.freeBuild, g.god.invulnerable], [5, true, true, true, true]);
  assert.equal((await cheat(A, { a: 'god', god: { speed: 1, infinite: false, noclip: false, freeBuild: false, invulnerable: false } })).god.speed, 1);
  // правка героя и лечение
  { const r = await cheat(A, { a: 'edit', edit: { level: 12, stats: { strength: 9, taming: 7 }, food: 10 } }); assert.ok(!r.err, r.err); }
  A.send({ t: 'perf', echo: 1 }); await A.next('perf');
  assert.match((await cheat(A, { a: 'heal' })).text, /здоровы/);
  // спавн врага рядом и «убить всех рядом»
  assert.match((await cheat(A, { a: 'spawn', kind: 'enemy', id: 'zombie', count: 2 })).text, /× 2/);
  await sleep(200);
  assert.match((await cheat(A, { a: 'kill' })).text, /рядом: 2/);
  assert.match((await cheat(A, { a: 'spawn', kind: 'item', id: 'caps', count: 3 })).text, /На земле/);
  assert.match((await cheat(A, { a: 'spawn', kind: 'vehicle', id: 'bicycle' })).text, /Техника/);
  // рецепты, школа магии, телепорт
  assert.match((await cheat(A, { a: 'recipes' })).text, /Открыто рецептов: \d+/);
  assert.match((await cheat(A, { a: 'spells', school: 'fire' })).text, /изучено \d+/);
  const me = A.welcome.players.find((p) => p.id === A.welcome.you);
  const tp = await cheat(A, { a: 'tp', x: me.x, y: me.y });
  assert.equal(tp.text, 'Телепорт.');
  assert.ok(info.towns.length, 'в мире есть поселения');
  {
    { const r = await cheat(A, { a: 'tp', town: info.towns[0].id }); assert.match(r.text || r.err, /Телепорт в/); }
    assert.match((await cheat(A, { a: 'spawn', kind: 'npc', id: 'guard' })).text, /Житель/);
  }
  assert.match((await cheat(A, { a: 'rep', sid: info.towns[0].id, value: 80 })).text, /: 80\./);
  assert.match((await cheat(A, { a: 'quests' })).text, /заданий/);
  assert.match((await cheat(A, { a: 'nope' })).err, /Неизвестное/);
  await A.close();
  const log = (await api(b, 'GET', '/api/admin/log?action=cheat-money', undefined, admin.token)).data;
  const entries = log.entries || log.items || log;
  assert.ok(JSON.stringify(entries).includes('cheat-money'), 'чит записан в журнал: ' + JSON.stringify(log).slice(0, 200));
});

test('WS чит-панель: game.cheatsForAll открывает панель всем', async (t) => {
  const s = await startServer([...SET, '--set', 'game.cheatsForAll=true']);
  t.after(() => s.stop());
  const b = s.base;
  await newPlayer(b, 'admin', 'Алиса');
  const bob = await newPlayer(b, 'bob', 'Боб');
  const wb = (await api(b, 'POST', '/api/worlds', params('cheat-c'), bob.token)).data.world;
  const B = await joinWorld(b, bob, wb.id);
  assert.equal(B.welcome.cheats, true);
  assert.match((await cheat(B, { a: 'money', count: 50 })).text, /× 50/);
  await B.close();
});

test('чит-панель (клиент): поиск по спискам — по названию и id, без учёта регистра', async () => {
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const { filterList } = await import(pathToFileURL(path.join(__dirname, '..', 'client', 'js', 'cheat-ui.js')).href);
  const Items = require('../shared/items.js');
  const list = Items.ITEMS.map((i) => ({ id: i.id, name: i.name }));
  assert.equal(filterList(list, '').length, list.length);
  assert.ok(filterList(list, 'caps').some((x) => x.id === 'caps'), 'по id');
  const cap = Items.get('caps').name.toLowerCase();
  assert.ok(filterList(list, cap.slice(0, 4)).some((x) => x.id === 'caps'), 'по названию');
  assert.equal(filterList(list, 'нет-такого-предмета').length, 0);
});
