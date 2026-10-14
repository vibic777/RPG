'use strict';
// Шаг 20: сеть и надёжность сервера — радиус интереса и дельта в state, сон ИИ, замер тика и трафика (perf),
// сбой обработчика не роняет сервер, переподключение с продолжением, адреса локальной сети
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');
const NetFilter = require('../server/netfilter');
const { lanLines } = require('../server/netinfo');
const WorldGen = require('../shared/worldgen');

test('сеть: фильтр строк state — радиус, дельта, опорный кадр, забывание ушедших', () => {
  const seen = new Map(), pos = { x: 50, y: 50 };
  const rows = [['a', 52, 50, 100, 0], ['b', 95, 50, 100, 0], ['c', 50, 88, 90, 1]];
  let out = NetFilter.filterRows(rows, pos, seen, { radius: 40 });
  assert.deepEqual(out.map((r) => r[0]), ['a', 'c'], 'дальний (45 клеток по x) не отправлен');
  out = NetFilter.filterRows(rows, pos, seen, { radius: 40 });
  assert.deepEqual(out, [], 'без изменений — ничего');
  out = NetFilter.filterRows([['a', 52.5, 50, 100, 0], rows[1], rows[2]], pos, seen, { radius: 40 });
  assert.deepEqual(out.map((r) => r[0]), ['a'], 'сдвинулся — только он');
  out = NetFilter.filterRows([['a', 52.5, 50, 100, 0], rows[1], ['c', 50, 88, 80, 1]], pos, seen, { radius: 40 });
  assert.deepEqual(out.map((r) => r[0]), ['c'], 'здоровье изменилось — отправлен');
  out = NetFilter.filterRows([['a', 52.5, 50, 100, 0], ['c', 50, 88, 80, 1]], pos, seen, { radius: 40, keyframe: true });
  assert.equal(out.length, 2, 'опорный кадр — все ближние');
  NetFilter.filterRows([['c', 50, 88, 80, 1]], pos, seen, { radius: 40 });
  assert.ok(!seen.has('a'), 'исчезнувший забыт');
  out = NetFilter.filterRows([['a', 52.5, 50, 100, 0]], pos, seen, { radius: 40 });
  assert.equal(out.length, 1, 'вернувшийся отправлен заново');
  assert.equal(NetFilter.filterRows(rows, pos, new Map(), { radius: 40, delta: false }).length, 2);
  assert.equal(NetFilter.filterRows(rows, pos, new Map(), { radius: 0 }).length, 3, 'радиус 0 — без ограничения');
  assert.ok(NetFilter.isKeyframe(10, 0, 10) && !NetFilter.isKeyframe(11, 0, 10) && NetFilter.isKeyframe(9, 1, 10) && NetFilter.isKeyframe(3, 0, 1));
});

test('сеть: адреса локальной сети при запуске', () => {
  const nets = { lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], eth0: [{ family: 'IPv4', address: '192.168.1.5', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }], radmin: [{ family: 4, address: '26.1.2.3', internal: false }] };
  const lines = lanLines('0.0.0.0', 3000, nets).join('\n');
  assert.match(lines, /http:\/\/192\.168\.1\.5:3000/);
  assert.match(lines, /http:\/\/26\.1\.2\.3:3000/);
  assert.doesNotMatch(lines, /127\.0\.0\.1|fe80/);
  assert.match(lanLines('127.0.0.1', 3000, nets).join(''), /только 127\.0\.0\.1/);
  assert.match(lanLines('0.0.0.0', 3000, {}).join(''), /только на этом компьютере/);
});

test('сеть: сбой в обработчике не роняет — guard и счётчик ошибок', () => {
  const realtime = require('../server/realtime');
  const before = realtime.errStats.count;
  const orig = console.error; console.error = () => {};
  try { assert.equal(realtime.guard('проверка', () => { throw new Error('бум'); }), undefined); } finally { console.error = orig; }
  assert.equal(realtime.errStats.count, before + 1);
  assert.match(realtime.errStats.last, /проверка: бум/);
  assert.equal(realtime.guard('ок', () => 7), 7);
});

const params = { name: 'Сеть', seed: 'net-perf', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false };
// Жители выключены: стража стартового поселения иначе успевает зарубить зомби рядом с героем
// (под нагрузкой полного прогона — до замера perf), и врагов в комнате становится меньше
const SET = ['--set', 'game.settlementsEnabled=false', '--set', 'game.netViewRadius=20', '--set', 'game.aiSleepRadius=25', '--set', 'game.netKeyframeSec=1', '--set', 'game.survivalFoodPerMin=0', '--set', 'game.survivalWaterPerMin=0', '--set', 'game.depotsPer256=0'];

test('WS сеть: в state только ближние враги, дальние спят; perf — тик, трафик, пинг; переподключение продолжает игру', async (t) => {
  const s = await startServer(SET);
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params, admin.token)).data.world;
  const map = WorldGen.generate({ ...w });
  const A = await joinWorld(b, admin, w.id);
  const me = A.welcome.players.find((p) => p.id === A.welcome.you);
  // точка далеко от героя (≥ 40 клеток), проходимая
  let far = null;
  for (let y = 4; y < map.height - 4 && !far; y++) for (let x = 4; x < map.width - 4 && !far; x++) if (Math.max(Math.abs(x - me.x), Math.abs(y - me.y)) >= 40 && WorldGen.isWalkable(map, x, y)) far = { x: x + 0.5, y: y + 0.5 };
  assert.ok(far, 'есть далёкая точка');
  assert.equal((await api(b, 'POST', '/api/admin/spawn', { kind: 'enemy', id: 'zombie', count: 1, at: 'point', x: far.x, y: far.y }, admin.token)).status, 200);
  assert.equal((await api(b, 'POST', '/api/admin/spawn', { kind: 'enemy', id: 'zombie', count: 1, at: 'me' }, admin.token)).status, 200);
  const adds = [await A.next('enemy-add'), await A.next('enemy-add')].map((m) => m.enemy);
  const farE = adds.find((e) => Math.abs(e.x - far.x) < 5 && Math.abs(e.y - far.y) < 5), nearE = adds.find((e) => e !== farE);
  assert.ok(farE && nearE, 'оба врага появились');
  await sleep(1500);
  A.drain();
  const states = [];
  for (let i = 0; i < 12; i++) states.push(await A.next('state', 2000));
  assert.ok(states.some((m) => m.e.some((r) => r[0] === nearE.id)), 'ближний враг приходит в state');
  assert.ok(!states.some((m) => m.e.some((r) => r[0] === farE.id)), 'дальний враг в state не приходит');
  // perf: тик, враги (бодрые / все), трафик, эхо для пинга
  A.send({ t: 'perf', echo: 12345 });
  const p = await A.next('perf', 3000);
  assert.equal(p.echo, 12345);
  assert.ok(p.tickMs >= 0 && p.tickMax >= p.tickMs * 0.5, JSON.stringify(p));
  assert.equal(p.enemies, 2);
  assert.equal(p.awake, 1, 'дальний враг спит');
  assert.ok(p.kbps > 0 && p.kbps < 50, 'трафик посчитан: ' + p.kbps);
  // обрыв без закрытия и вход снова тем же токеном — герой там же, мир продолжает
  const before = A.welcome.players.find((x) => x.id === A.welcome.you);
  A.ws.terminate();
  await sleep(300);
  const A2 = await joinWorld(b, admin, w.id);
  assert.ok(A2.welcome, 'вход после обрыва');
  const again = A2.welcome.players.find((x) => x.id === A2.welcome.you);
  assert.ok(Math.abs(again.x - before.x) < 1.5 && Math.abs(again.y - before.y) < 1.5, 'позиция сохранилась');
  // неизвестное и битое сообщение — ответ ошибкой, сервер жив
  A2.send('{не json');
  assert.equal((await A2.next('error')).message, 'Некорректное сообщение.');
  A2.send({ t: 'perf', echo: 1 });
  assert.equal((await A2.next('perf')).echo, 1);
  await A2.close();
});

test('LAN: подсказка про брандмауэр Windows и firewall-allow.bat (правило на порт для всех профилей сети)', () => {
  const fs = require('fs'), path = require('path');
  const bat = fs.readFileSync(path.join(__dirname, '../firewall-allow.bat'), 'utf8');
  assert.match(bat, /New-NetFirewallRule[^\n]*-LocalPort %PORT%[^\n]*-Profile Domain,Private,Public/);
  assert.match(bat, /--help/);
  assert.match(bat, /-Verb RunAs/);
  const nets = { eth: [{ family: 'IPv4', internal: false, address: '192.168.1.5' }] };
  const win = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try { assert.match(lanLines('0.0.0.0', 3333, nets).join('\n'), /firewall-allow\.bat[^\n]*3333/); }
  finally { Object.defineProperty(process, 'platform', win); }
  assert.match(fs.readFileSync(path.join(__dirname, '../build-release.ps1'), 'utf8'), /'firewall-allow\.bat'/);
});

test('LAN: lan-setup.bat — спрашивает IP и порт по-русски, добавляет то же правило брандмауэра, проверяет сервер', () => {
  const fs = require('fs'), path = require('path');
  const ps = fs.readFileSync(path.join(__dirname, '../lan-setup.ps1'), 'utf8');
  const bat = fs.readFileSync(path.join(__dirname, '../lan-setup.bat'), 'utf8');
  assert.equal(ps.charCodeAt(0), 0xfeff, 'UTF-8 с BOM — иначе Windows PowerShell 5 исказит русский текст');
  assert.match(ps, /Read-Host "IP-адрес сервера/);
  assert.match(ps, /Read-Host "Порт сервера/);
  assert.match(ps, /\$name = "Nasledie RPG server TCP \$Port"/, 'то же имя правила, что у firewall-allow.bat');
  assert.match(ps, /New-NetFirewallRule -DisplayName \$name[^\n]*-LocalPort \$Port[^\n]*-Profile Domain,Private,Public/);
  assert.match(ps, /-Verb RunAs/);
  assert.match(ps, /Get-NetTCPConnection -LocalPort \$Port -State Listen/);
  assert.match(ps, /Test-NetConnection/);
  assert.match(ps, /lan-setup\.bat \[IP\] \[порт\]/);
  assert.match(bat, /--help/);
  assert.match(bat, /lan-setup\.ps1/);
  assert.match(bat, /\r\n/, 'bat — с переводами строк Windows');
  assert.match(fs.readFileSync(path.join(__dirname, '../firewall-allow.bat'), 'utf8'), /lan-setup\.bat/);
  assert.match(fs.readFileSync(path.join(__dirname, '../build-release.ps1'), 'utf8'), /'lan-setup\.bat', 'lan-setup\.ps1'/);
  assert.match(fs.readFileSync(path.join(__dirname, '../server/netinfo.js'), 'utf8'), /lan-setup\.bat — спросит IP и порт/);
});
