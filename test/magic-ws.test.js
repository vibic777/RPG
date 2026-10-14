'use strict';
// Магия по WebSocket: свиток → изучение, заклинание на панели 1–0, чтение с тратой маны и откатом, читы (не изучено, чужая цель,
// мусор), телепатия и передача между игроками, кража у мага, сохранение после перезахода, панель ГМ (научить / стереть / права).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');
const Enemies = require('../shared/enemies');

const params = (o = {}) => ({ name: 'Магия', seed: 'magic-1', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false, ...o });
const set = (o) => Object.entries({
  survivalFoodPerMin: 0, survivalWaterPerMin: 0, survivalRestPerMin: 0, chatRateCount: 200, stunChance: 0, depotsPer256: 0, ...o,
}).flatMap(([k, v]) => ['--set', `game.${k}=${v}`]);
const say = (c, text) => c.send({ t: 'chat', text });
const reject = async (c, re) => assert.match((await c.next('cast-reject', 8000)).message, re);
const magic = (c, pred = () => true) => c.next((m) => m.t === 'magic' && pred(m), 8000);

test('WS магия: свиток, панель 1–0, чтение, откат, читы, телепатия, передача, кража, сохранение, панель ГМ', async (t) => {
  const s = await startServer(set({ magicChanceMin: 1, magicChanceMax: 1, magicStealCooldownSec: 0 }));
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const bob = await newPlayer(b, 'bob', 'Боб');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  const A = await joinWorld(b, admin, w.id);
  const first = await magic(A);
  assert.deepEqual(first.spells, []);
  // свиток огненной стрелы: использовать — выучить (свиток тратится)
  assert.equal((await api(b, 'POST', '/api/admin/characters/edit', { username: 'admin', characterId: admin.characterId, stats: { magic: 3, intellect: 2 } }, admin.token)).status, 200);
  assert.equal((await api(b, 'POST', '/api/admin/items/give', { username: 'admin', item: 'spell_fire_bolt', count: 1 }, admin.token)).status, 200);
  const inv = await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'spell_fire_bolt'));
  A.send({ t: 'inv', a: { type: 'use', from: { c: 'cell', i: inv.inventory.cells.findIndex((x) => x && x.id === 'spell_fire_bolt') } } });
  assert.equal((await A.next('magic-learn')).spell, 'fire_bolt');
  const after = await A.next((m) => m.t === 'inv' && !m.inventory.cells.some((x) => x && x.id === 'spell_fire_bolt'));
  assert.ok(after);
  await magic(A, (m) => m.spells.includes('fire_bolt'));
  // книга 3-го круга не по силам — ошибка, книга остаётся
  await api(b, 'POST', '/api/admin/items/give', { username: 'admin', item: 'spell_meteor', count: 1 }, admin.token);
  const inv2 = await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'spell_meteor'));
  A.send({ t: 'inv', a: { type: 'use', from: { c: 'cell', i: inv2.inventory.cells.findIndex((x) => x && x.id === 'spell_meteor') } } });
  assert.match((await A.next('inv-error')).message, /Магия 6/);
  // панель 1–0: изученное — можно, неизученное — нет
  A.send({ t: 'inv', a: { type: 'hotbar', key: 0, item: 'spell:fire_bolt' } });
  assert.equal((await A.next((m) => m.t === 'inv' && m.inventory.hotbar[0] === 'spell:fire_bolt')).inventory.hotbar[0], 'spell:fire_bolt');
  A.send({ t: 'inv', a: { type: 'hotbar', key: 1, item: 'spell:heal' } });
  assert.match((await A.next('inv-error')).message, /не изучено/);
  // чтение: враг рядом, мана тратится, откат, снаряд
  say(A, '/spawn zombie');
  const z = (await A.next((m) => m.t === 'enemy-add' && m.enemy.type === 'zombie')).enemy;
  const mp0 = (await A.next('me')).mp;
  A.send({ t: 'cast', spell: 'fire_bolt', target: z.id });
  await A.next((m) => m.t === 'fx' && m.ev.some((f) => f.k === 'cast' && f.s === 'fire_bolt'));
  await A.next((m) => m.t === 'fx' && m.ev.some((f) => f.k === 'shot' && f.f === require('../shared/magic').get('fire_bolt').fx), 3000); // огненная стрела (fireArrow)
  const me = await A.next((m) => m.t === 'me' && m.mp < mp0);
  assert.ok(mp0 - me.mp >= 8 - 1);
  A.send({ t: 'cast', spell: 'fire_bolt', target: z.id });
  await reject(A, /ещё не готово|Слишком быстро/);
  // читы: неизученное, мусор, неизвестное действие
  A.send({ t: 'cast', spell: 'meteor', x: 1, y: 1 });
  await reject(A, /не изучено/);
  A.send({ t: 'cast', spell: { x: 1 }, target: [1] });
  await reject(A, /Неизвестное заклинание/);
  A.send({ t: 'magic', a: '__proto__' });
  await reject(A, /Неизвестное действие/);
  A.send({ t: 'cast' });
  await reject(A, /Неизвестное/);
  // кража у мага (шанс 100 % настройкой)
  say(A, '/kill all');
  await sleep(200);
  say(A, '/spawn mage_water');
  const mw = (await A.next((m) => m.t === 'enemy-add' && m.enemy.type === 'mage_water')).enemy;
  A.send({ t: 'magic', a: 'steal', target: mw.id });
  const st = await A.next('magic-steal');
  assert.equal(st.ok, 1);
  const learned = await A.next('magic-learn');
  assert.equal(learned.how, 'steal');
  assert.ok(Enemies.get('mage_water').spells.includes(learned.spell), learned.spell); // любое заклинание из книги водного мага
  say(A, '/kill all');
  // телепатия: Боб просит у Алисы огненную стрелу, Алиса разрешает
  const code = (await api(b, 'POST', `/api/worlds/${w.id}/share`, { open: true, invite: 'new' }, admin.token)).data.world.inviteCode;
  assert.equal((await api(b, 'POST', '/api/worlds/join', { code }, bob.token)).status, 200);
  const B = await joinWorld(b, bob, w.id);
  await api(b, 'POST', '/api/admin/characters/edit', { username: 'bob', characterId: bob.characterId, stats: { magic: 2 } }, admin.token);
  await sleep(300);
  const near = await magic(B, (m) => m.near.some((p) => p.id === A.welcome.you.id || p.name === 'Алиса'));
  const alice = near.near.find((p) => p.name === 'Алиса');
  assert.ok(alice.spells.includes('fire_bolt'));
  B.send({ t: 'magic', a: 'ask', from: alice.id, spell: 'fire_bolt' });
  const ask = await magic(A, (m) => m.asks.length > 0);
  assert.equal(ask.asks[0].spell, 'fire_bolt');
  A.send({ t: 'magic', a: 'allow', from: ask.asks[0].from, spell: 'fire_bolt' });
  assert.equal((await B.next('magic-learn')).how, 'telepathy');
  // просить то, чего учитель не знает, — нельзя
  B.send({ t: 'magic', a: 'ask', from: alice.id, spell: 'meteor' });
  await reject(B, /не знает/);
  // передача от мага к магу: Алиса сама учит Боба украденному заклинанию (если хватает статов)
  A.send({ t: 'magic', a: 'teach', to: ask.asks[0].from, spell: learned.spell });
  const taught = await Promise.race([B.next('magic-learn', 5000).then((m) => m.spell), A.next('cast-reject', 5000).then((m) => 'reject:' + m.message)]);
  assert.ok(taught === learned.spell || /Нужн/.test(taught), taught); // «Нужно: стат» или «Нужен уровень» — зависит от круга украденного
  B.close();
  // панель ГМ: права, научить всем, стереть одно, список
  assert.equal((await api(b, 'POST', '/api/admin/spells/teach', { username: 'admin', spell: 'all' }, bob.token)).status, 403);
  assert.equal((await api(b, 'POST', '/api/admin/spells/teach', { username: 'admin', spell: 'nope' }, admin.token)).status, 400);
  const all = await api(b, 'POST', '/api/admin/spells/teach', { username: 'admin', spell: 'all' }, admin.token);
  assert.equal(all.status, 200);
  await magic(A, (m) => m.spells.length === all.data.spells && m.spells.includes('meteor'));
  const rm = await api(b, 'POST', '/api/admin/spells/remove', { username: 'admin', spell: 'fire_bolt' }, admin.token);
  assert.equal(rm.status, 200);
  await magic(A, (m) => !m.spells.includes('fire_bolt'));
  await A.next((m) => m.t === 'inv' && m.inventory.hotbar[0] === null); // стёртое ушло с панели
  const ls = await api(b, 'POST', '/api/admin/spells/list', { username: 'admin' }, admin.token);
  assert.equal(ls.data.spells.length, all.data.spells - 1);
  assert.ok(ls.data.all.length >= 29);
  // сохранение: перезашёл — заклинания на месте
  A.close();
  await sleep(300);
  const A2 = await joinWorld(b, admin, w.id);
  const back = await magic(A2);
  assert.equal(back.spells.length, all.data.spells - 1);
  A2.close();
  // и в файле героя
  const r = await api(b, 'GET', '/api/characters', undefined, admin.token);
  const ch = r.data.characters.find((x) => x.id === admin.characterId);
  assert.equal(ch.spells.length, all.data.spells - 1);
});
