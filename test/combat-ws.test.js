'use strict';
// Бой по WebSocket: синхронизация у двух клиентов, убийство, опыт, добыча, защита от подделок (скорость и дальность атак),
// патроны и перезарядка, попадание снарядом, PvP, смерть и возрождение, уровни и очки, команды администратора и журнал.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');

const params = (o = {}) => ({ name: 'Арена', seed: 'arena-1', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false, ...o });
// Сильный удар (враг — с одного удара), всегда есть добыча, быстрый рост уровня и быстрое возрождение
const ARGS = ['--set', 'game.meleeBonusPerStrength=60', '--set', 'game.lootChanceFactor=100', '--set', 'game.xpBase=5', '--set', 'game.respawnSec=0.4', '--set', 'game.pickupRange=4', '--set', 'game.chatRateCount=50', '--set', 'game.netDelta=false'];

async function setup({ args = ARGS, world = {} } = {}) {
  const s = await startServer(args);
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const bob = await newPlayer(b, 'bob', 'Боб');
  const w = (await api(b, 'POST', '/api/worlds', params(world), admin.token)).data.world;
  const code = (await api(b, 'POST', `/api/worlds/${w.id}/share`, { open: true, invite: 'new' }, admin.token)).data.world.inviteCode;
  await api(b, 'POST', '/api/worlds/join', { code }, bob.token);
  const A = await joinWorld(b, admin, w.id);
  const B = await joinWorld(b, bob, w.id);
  return { s, b, w, admin, bob, A, B };
}
const say = (c, text) => c.send({ t: 'chat', text });
const sys = (c, re) => c.next((m) => m.t === 'chat' && m.m.channel === 'system' && re.test(m.m.text));
// события боя приходят пачками (одно сообщение fx за тик) — ищем событие во всех сообщениях начиная с отметки from
async function fxOf(c, pred, from = 0, timeout = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    for (let i = from; i < c.messages.length; i++) {
      const m = c.messages[i];
      const e = m.t === 'fx' && m.ev.find(pred);
      if (e) return e;
    }
    await sleep(25);
  }
  throw new Error('Не дождались события боя');
}
const mark = (c) => c.messages.length;
const me = (c, pred = () => true, timeout = 3000) => c.next((m) => m.t === 'me' && pred(m), timeout);
const posOf = (c, id) => c.next((m) => m.t === 'state' && m.players.some((p) => p.id === id)).then((m) => m.players.find((p) => p.id === id));
const readLog = (s) => fs.readFileSync(path.join(s.dataDir, 'admin-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const charFile = (s, acc) => JSON.parse(fs.readFileSync(path.join(s.dataDir, 'characters', acc + '.json'), 'utf8')).characters[0];
async function give(b, token, username, item, count = 1) {
  const r = await api(b, 'POST', '/api/admin/items/give', { username, item, count }, token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
}
async function equipMain(c, id) {
  const inv = await c.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === id));
  const i = inv.inventory.cells.findIndex((x) => x && x.id === id);
  c.send({ t: 'inv', a: { type: 'equip', from: { c: 'cell', i }, slot: 'mainHand' } });
  await c.next((m) => m.t === 'inv' && m.inventory.equipment.mainHand && m.inventory.equipment.mainHand.id === id);
}
// ждать, пока враг подойдёт к герою ближе d
async function enemyNear(c, id, hero, d) {
  for (let i = 0; i < 100; i++) {
    const st = await c.next('state');
    const e = st.e.find((x) => x[0] === id);
    const h = st.players.find((p) => p.id === hero);
    if (e && Math.hypot(e[1] - h.x, e[2] - h.y) <= d) return e;
  }
  throw new Error('враг не подошёл');
}

test('WS бой: враг виден обоим, удар, смерть врага, опыт, новый уровень и добыча у обоих клиентов', async (t) => {
  const { s, A, B } = await setup();
  t.after(() => s.stop());
  assert.deepEqual(A.welcome.enemies, []);
  assert.equal(A.welcome.pvp, false);
  assert.ok(A.welcome.me.hp > 0 && A.welcome.me.lvl === 1);
  say(A, '/spawn zombie');
  const addA = await A.next('enemy-add');
  const addB = await B.next('enemy-add');
  assert.equal(addA.enemy.id, addB.enemy.id);
  assert.equal(addA.enemy.type, 'zombie');
  assert.match((await sys(A, /Создано/)).m.text, /Ходячий мертвец × 1/);
  const id = addA.enemy.id;
  // позиции врагов идут в state обоим
  const stB = await B.next((m) => m.t === 'state' && m.e.some((x) => x[0] === id));
  assert.equal(stB.e.find((x) => x[0] === id)[3], 100, 'здоровье в процентах');
  // зомби подходит (он видит героя даже у точки появления — создан администратором)
  await enemyNear(A, id, A.welcome.you, 1.8);
  const mA = mark(A), mB = mark(B);
  A.send({ t: 'atk', slot: 'main', target: id, tk: 'e' });
  const hitB = await fxOf(B, (e) => e.k === 'hit' && e.id === id, mB);
  assert.ok(hitB.n > 0);
  await B.next((m) => m.t === 'enemy-remove' && m.id === id && m.dead === 1);
  await A.next((m) => m.t === 'enemy-remove' && m.id === id);
  // опыт и новый уровень (xpBase = 5)
  const up = await fxOf(A, (e) => e.k === 'levelup' && e.id === A.welcome.you, mA);
  assert.ok(up.lvl >= 2);
  const m = await me(A, (x) => x.lvl >= 2);
  assert.ok(m.pts > 0);
  // добыча лежит на земле у обоих
  const gA = await A.next('ground-add');
  const gB = await B.next('ground-add');
  assert.equal(gA.item.gid, gB.item.gid);
  assert.equal(gA.item.by, 'Ходячий мертвец');
  // уровень сохранён в файле
  await sleep(100);
  assert.ok(charFile(s, A.welcome.you).level >= 2);
});

test('WS бой: сервер отвергает слишком частые атаки и удар издалека', async (t) => {
  const { s, A } = await setup();
  t.after(() => s.stop());
  say(A, '/spawn zombie');
  const id = (await A.next('enemy-add')).enemy.id;
  // сразу после появления зомби в 2.5+ клетках — нож не достаёт
  A.send({ t: 'atk', slot: 'main', target: id, tk: 'e' });
  const r1 = await A.next('atk-reject');
  assert.equal(r1.reason, 'range');
  await enemyNear(A, id, A.welcome.you, 1.8);
  // слишком частые удары (вторая атака сразу за первой)
  say(A, '/spawn zombie'); // второй — чтобы было кого бить после первого удара
  const id2 = (await A.next('enemy-add')).enemy.id;
  A.send({ t: 'atk', slot: 'main', target: id, tk: 'e' });
  A.send({ t: 'atk', slot: 'main', target: id2, tk: 'e' });
  const r2 = await A.next((m) => m.t === 'atk-reject' && m.reason === 'cooldown');
  assert.match(r2.message, /быстро/);
  // несуществующая цель
  await sleep(1000);
  A.send({ t: 'atk', slot: 'main', target: 'nope', tk: 'e' });
  assert.equal((await A.next('atk-reject')).reason, 'target');
});

test('WS бой: патроны, перезарядка (R), снаряд попадает во врага, нет патронов', async (t) => {
  const { s, b, A, admin } = await setup({ args: [...ARGS, '--set', 'game.meleeBonusPerStrength=0.04'] });
  t.after(() => s.stop());
  await give(b, admin.token, 'admin', 'pistol_nail');
  await equipMain(A, 'pistol_nail');
  await give(b, admin.token, 'admin', 'ammo_9mm', 14);
  await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'ammo_9mm'));
  const hero = await posOf(A, A.welcome.you);
  // пустой магазин — выстрел запускает перезарядку
  A.send({ t: 'atk', slot: 'main', x: hero.x + 5, y: hero.y });
  assert.equal((await A.next('atk-reject')).reason, 'reload');
  const rl = await me(A, (m) => m.reload);
  assert.equal(rl.reload.total, 1500);
  const full = await me(A, (m) => m.mag.main && m.mag.main.n === 12, 4000);
  assert.equal(full.mag.main.have, 2, '12 патронов из 14 ушли в магазин');
  // R при полном магазине
  A.send({ t: 'reload' });
  assert.match((await A.next('atk-reject')).message, /полон/);
  // выстрел по врагу издалека — снаряд попадает
  say(A, '/spawn zombie');
  const e = (await A.next('enemy-add')).enemy;
  const m0 = mark(A);
  A.send({ t: 'atk', slot: 'main', target: e.id, tk: 'e' });
  const shot = await fxOf(A, (x) => x.k === 'shot', m0);
  assert.equal(shot.f, 'bullet');
  const hit = await fxOf(A, (x) => x.k === 'hit' && x.id === e.id, m0);
  assert.ok(hit.n > 0);
  assert.equal((await me(A, (m) => m.mag && m.mag.main && m.mag.main.n === 11)).mag.main.n, 11);
  // забрать все патроны и опустошить магазин — «нет боеприпасов»
  await api(b, 'POST', '/api/admin/items/take', { username: 'admin', item: 'ammo_9mm', count: 2 }, admin.token);
  say(A, '/kill all');
  await sys(A, /Убрано врагов/);
  for (let i = 0; i < 11; i++) {
    await sleep(560);
    A.send({ t: 'atk', slot: 'main', x: hero.x + 5, y: hero.y + 0.1 });
  }
  await me(A, (m) => m.mag.main.n === 0, 8000);
  await sleep(560);
  A.drain();
  A.send({ t: 'atk', slot: 'main', x: hero.x + 5, y: hero.y });
  const r = await A.next('atk-reject');
  assert.equal(r.reason, 'noammo');
  assert.match(r.message, /Патроны 9 мм/);
});

test('WS бой: кооператив — PvP выключен всегда, даже в мире, созданном с pvp: true (старые сохранения)', async (t) => {
  const off = await setup();
  t.after(() => off.s.stop());
  off.A.send({ t: 'atk', slot: 'main', target: off.B.welcome.you, tk: 'p' });
  const r = await off.A.next('atk-reject');
  assert.equal(r.reason, 'pvp');
  assert.match(r.message, /PvP выключен/);
  await off.s.stop();

  const on = await setup({ args: [...ARGS, '--set', 'game.meleeBonusPerStrength=0.04'], world: { pvp: true } });
  t.after(() => on.s.stop());
  assert.equal(on.A.welcome.pvp, false, 'pvp: true из параметров мира не включает урон по игрокам');
  await give(on.b, on.admin.token, 'admin', 'pistol_nail');
  await equipMain(on.A, 'pistol_nail');
  await give(on.b, on.admin.token, 'admin', 'ammo_9mm', 12);
  on.A.send({ t: 'reload' });
  await me(on.A, (m) => m.mag.main && m.mag.main.n === 12, 4000);
  on.A.send({ t: 'atk', slot: 'main', target: on.B.welcome.you, tk: 'p' });
  const r2 = await on.A.next('atk-reject');
  assert.equal(r2.reason, 'pvp');
});

test('WS смерть: −1 к характеристике, экран смерти, счётчик, возрождение у точки появления после таймера', async (t) => {
  const { s, A, B, bob } = await setup();
  t.after(() => s.stop());
  const accId = B.welcome.you;
  const before = charFile(s, accId).stats;
  say(A, '/kill Боб');
  const dead = await B.next('dead');
  assert.ok(dead.stat, 'потеряна характеристика');
  assert.ok(before[dead.stat] > 1);
  assert.equal(dead.stats[dead.stat], before[dead.stat] - 1);
  assert.ok(dead.statLabel);
  assert.equal(dead.deaths, 1);
  await fxOf(A, (e) => e.k === 'die' && e.t === 'p' && e.id === B.welcome.you, 0);
  await sleep(100);
  const saved = charFile(s, accId);
  assert.equal(saved.deaths, 1);
  assert.equal(saved.stats[dead.stat], before[dead.stat] - 1);
  assert.ok(Object.values(saved.stats).every((v) => v >= 1));
  // мёртвый не атакует и не возрождается раньше таймера
  B.send({ t: 'atk', slot: 'main', x: 1, y: 1 });
  assert.equal((await B.next('atk-reject')).reason, 'dead');
  B.send({ t: 'respawn' });
  assert.match((await B.next('atk-reject')).message, /через/);
  // другие видят мёртвого в state
  const st = await A.next((m) => m.t === 'state' && m.players.some((p) => p.id === B.welcome.you && p.d === 1));
  assert.ok(st);
  await sleep(450);
  B.send({ t: 'respawn' });
  const rs = await A.next((m) => m.t === 'respawned' && m.id === B.welcome.you);
  const w = await api(s.base, 'GET', `/api/worlds/${A.welcome.worldId}`, undefined, bob.token);
  assert.ok(w.status === 200);
  const m = await me(B, (x) => !x.dead);
  assert.equal(m.hp, m.mhp);
  assert.ok(Number.isFinite(rs.x));
  // убить мёртвого второй раз нельзя; после возрождения — снова можно, счётчик растёт
  say(A, '/kill Боб');
  assert.equal((await B.next('dead')).deaths, 2);
});

test('WS уровни: /setlevel, вложение очков по WS и через API, выход мёртвым', async (t) => {
  const { s, b, A, B, bob } = await setup();
  t.after(() => s.stop());
  const pts0 = B.welcome.me.pts;
  say(A, '/setlevel Боб 3');
  const m = await me(B, (x) => x.lvl === 3);
  assert.equal(m.pts, pts0 + 2 * 3);
  assert.match((await sys(A, /уровень 1 → 3/)).m.text, /Боб/);
  const str0 = (await api(b, 'GET', `/api/characters/${bob.characterId}`, undefined, bob.token)).data.character.stats.strength;
  B.send({ t: 'alloc', stat: 'strength' });
  const st = await B.next('stats');
  assert.equal(st.stats.strength, str0 + 1);
  assert.equal(st.pts, pts0 + 5);
  B.send({ t: 'alloc', stat: 'luck' });
  assert.match((await B.next('atk-reject')).message, /Неизвестная/);
  // через API (герой в мире — меняется живая запись)
  const r = await api(b, 'POST', `/api/characters/${bob.characterId}/stats`, { stat: 'magic' }, bob.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.character.unspentPoints, pts0 + 4);
  // выход мёртвым — вход живым
  say(A, '/kill Боб');
  await B.next('dead');
  await B.close();
  await sleep(200);
  const B2 = await joinWorld(b, bob, A.welcome.worldId);
  t.after(() => B2.close());
  assert.ok(B2.welcome.me.hp > 0);
  assert.equal(B2.welcome.me.dead, 0);
  assert.equal(B2.welcome.me.lvl, 3);
  // вне мира
  await B2.close();
  await sleep(200);
  const r2 = await api(b, 'POST', `/api/characters/${bob.characterId}/stats`, { stat: 'magic', count: 2 }, bob.token);
  assert.equal(r2.data.character.unspentPoints, pts0 + 2);
  const r3 = await api(b, 'POST', `/api/characters/${bob.characterId}/stats`, { stat: 'magic', count: 99 }, bob.token);
  assert.equal(r3.status, 400);
});

test('WS администратор: /spawn /kill /heal /setlevel только для администратора и пишутся в журнал', async (t) => {
  const { s, A, B } = await setup();
  t.after(() => s.stop());
  for (const cmd of ['/spawn wolf', '/kill', '/heal', '/setlevel Боб 5']) {
    say(B, cmd);
    assert.match((await sys(B, /только администратору/)).m.text, /администратору/);
  }
  say(A, '/spawn "Серый волк" 3');
  assert.match((await sys(A, /Создано/)).m.text, /× 3/);
  say(A, '/spawn dragon');
  assert.match((await sys(A, /Неизвестный враг/)).m.text, /dragon/);
  say(A, '/spawn wolf 999');
  assert.match((await sys(A, /Количество/)).m.text, /от 1/);
  say(A, '/kill');
  assert.match((await sys(A, /Убрано врагов: 3/)).m.text, /3/);
  say(A, '/heal Боб');
  await sys(A, /восстановлены/);
  say(A, '/setlevel Боб 2');
  await sys(A, /уровень 1 → 2/);
  const log = readLog(s);
  const actions = log.map((l) => l.action);
  for (const a of ['spawn', 'kill-enemies', 'heal', 'setlevel']) assert.ok(actions.includes(a), a);
  const sp = log.find((l) => l.action === 'spawn');
  assert.equal(sp.admin, 'admin');
  assert.equal(sp.enemy, 'wolf');
  assert.equal(sp.count, 3);
  assert.equal(log.find((l) => l.action === 'setlevel').to, 2);
  // бег тратит выносливость: признак бега приходит в личных показателях
  A.send({ t: 'sprint', on: true });
  assert.equal((await me(A, (m) => m.sprint === 1)).sprint, 1);
});

test('WS оружие: метательное оружие (топорики, звёздочки) не расходуется, огнемёт бьёт конусом, мина срабатывает на враге, турель стреляет сама', async (t) => {
  const { s, b, A, admin } = await setup({ args: [...ARGS, '--set', 'game.meleeBonusPerStrength=0.04', '--set', 'game.trapArmSec=0', '--set', 'game.trapTriggerRadius=1.5', '--set', 'game.thrownRecoverChance=1'] });
  t.after(() => s.stop());
  const me0 = A.welcome.you;
  const hero = await posOf(A, me0);
  // метательные топорики: бросок не тратит оружие и ничего не роняет на землю
  await give(b, admin.token, 'admin', 'axe_throwing', 5);
  await equipMain(A, 'axe_throwing');
  say(A, '/spawn zombie');
  let e = (await A.next('enemy-add')).enemy;
  let m0 = mark(A);
  A.send({ t: 'atk', slot: 'main', target: e.id, tk: 'e' });
  await fxOf(A, (x) => x.k === 'shot' && x.f === 'weaponThrow' && x.item === 'axe_throwing', m0); // метательное оружие летит своим спрайтом
  await sleep(300);
  assert.ok(!A.messages.slice(m0).some((m) => m.t === 'ground-add' && m.item.id === 'axe_throwing'), 'топорик не падает');
  assert.ok(!A.messages.slice(m0).some((m) => m.t === 'inv' && m.inventory.equipment.mainHand && m.inventory.equipment.mainHand.id === 'axe_throwing' && m.inventory.equipment.mainHand.n < 5), 'топорики не тратятся');
  // звёздочки (диски) возвращаются в руку и не расходуются
  await give(b, admin.token, 'admin', 'star_steel', 5);
  await equipMain(A, 'star_steel');
  await sleep(400);
  m0 = mark(A);
  A.send({ t: 'atk', slot: 'main', target: e.id, tk: 'e' });
  await fxOf(A, (x) => x.k === 'shot' && x.f === 'weaponThrow' && x.item === 'star_steel', m0);
  await sleep(300);
  assert.ok(!A.messages.slice(m0).some((m) => m.t === 'ground-add' && m.item.id === 'star_steel'), 'звёздочка не падает');
  assert.ok(!A.messages.slice(m0).some((m) => m.t === 'inv' && m.inventory.equipment.mainHand && m.inventory.equipment.mainHand.id === 'star_steel' && m.inventory.equipment.mainHand.n < 5), 'звёздочки не тратятся');
  say(A, '/kill all');
  await sys(A, /Убрано/);
  // огнемёт: конус задевает врага рядом
  await give(b, admin.token, 'admin', 'flamer_torch');
  await equipMain(A, 'flamer_torch');
  await give(b, admin.token, 'admin', 'ammo_fuel', 2);
  A.send({ t: 'reload' });
  const loaded = await me(A, (m) => m.mag.main && m.mag.main.n === 50, 6000);
  assert.equal(loaded.mag.main.have, 0, 'два баллона по 25 зарядов');
  say(A, '/spawn zombie');
  e = (await A.next('enemy-add')).enemy;
  const near = await enemyNear(A, e.id, me0, 1.8);
  m0 = mark(A);
  A.send({ t: 'atk', slot: 'main', target: e.id, tk: 'e' });
  const cone = await fxOf(A, (x) => x.k === 'cone', m0);
  assert.equal(cone.f, 'flame');
  assert.ok((await fxOf(A, (x) => x.k === 'hit' && x.id === e.id, m0)).n > 0);
  assert.ok(near);
  say(A, '/kill all');
  await sys(A, /Убрано/);
  // мина: ставится рядом, срабатывает, когда враг подходит
  await give(b, admin.token, 'admin', 'mine_clapper', 2);
  await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'mine_clapper'));
  A.send({ t: 'place', item: 'mine_clapper', x: hero.x + 0.5, y: hero.y });
  const trap = await A.next('trap-add');
  assert.equal(trap.trap.item, 'mine_clapper');
  await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'mine_clapper' && x.n === 1));
  m0 = mark(A);
  say(A, '/spawn zombie');
  e = (await A.next('enemy-add')).enemy;
  const fired = await A.next((m) => m.t === 'trap-remove' && m.fired === 1, 8000);
  assert.equal(fired.id, trap.trap.id);
  await fxOf(A, (x) => x.k === 'boom', m0);
  say(A, '/kill all');
  await sys(A, /Убрано/);
  // турель: заряжается патронами владельца и стреляет по врагам сама
  await give(b, admin.token, 'admin', 'turret_watchman');
  await give(b, admin.token, 'admin', 'ammo_556', 50);
  await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'ammo_556'));
  A.send({ t: 'place', item: 'turret_watchman' });
  const tur = await A.next('turret-add');
  assert.equal(tur.turret.mag, 50);
  assert.equal(tur.turret.tier, 1);
  assert.equal(tur.turret.hp, tur.turret.maxHp);
  // владелец рядом меняет режим цели — видят все
  A.send({ t: 'turret', id: tur.turret.id, a: 'mode', mode: 'weakest' });
  assert.equal((await A.next('turret-upd')).turret.mode, 'weakest');
  m0 = mark(A);
  say(A, '/spawn zombie');
  e = (await A.next('enemy-add')).enemy;
  assert.ok((await fxOf(A, (x) => x.k === 'hit' && x.id === e.id, m0, 5000)).n > 0);
  // выход владельца — турель сворачивается в предмет на земле
  await A.close();
});

test('WS лассо: притягивает и связывает врага — он не двигается и не бьёт, в состоянии флаг «связан»', async (t) => {
  const { s, b, A, admin } = await setup({ args: [...ARGS, '--set', 'game.meleeBonusPerStrength=0', '--set', 'game.lassoHoldSec=4', '--set', 'game.stunChance=0'] });
  t.after(() => s.stop());
  // лассо требует 6 уровня и Приручения 2
  say(A, '/setlevel Алиса 6');
  await me(A, (x) => x.lvl === 6);
  A.send({ t: 'alloc', stat: 'taming' });
  await A.next('stats');
  await give(b, admin.token, 'admin', 'lasso_arkan');
  await equipMain(A, 'lasso_arkan');
  await give(b, admin.token, 'admin', 'ammo_cell', 2);
  await A.next((m) => m.t === 'inv' && m.inventory.cells.some((x) => x && x.id === 'ammo_cell'));
  const hero = await posOf(A, A.welcome.you);
  A.send({ t: 'reload' });
  await me(A, (m) => m.mag.main && m.mag.main.n > 0, 5000);
  say(A, '/spawn bear');
  const e = (await A.next('enemy-add')).enemy;
  const m0 = mark(A);
  A.send({ t: 'atk', slot: 'main', target: e.id, tk: 'e' });
  await fxOf(A, (x) => x.k === 'hit' && x.id === e.id, m0);
  const st = await A.next((m) => m.t === 'state' && m.e.some((x) => x[0] === e.id && x[4] & 16), 2000);
  const p1 = st.e.find((x) => x[0] === e.id);
  // связанный враг стоит на месте и не атакует
  await sleep(1200);
  A.drain();
  const st2 = await A.next((m) => m.t === 'state' && m.e.some((x) => x[0] === e.id));
  const p2 = st2.e.find((x) => x[0] === e.id);
  assert.ok(p2[4] & 16, 'всё ещё связан');
  assert.ok(Math.hypot(p2[1] - p1[1], p2[2] - p1[2]) < 0.05, 'не двигается');
  assert.ok(!A.messages.slice(m0).some((m) => m.t === 'fx' && m.ev.some((x) => x.k === 'hit' && x.t === 'p')), 'не бьёт героя');
  assert.ok(Math.hypot(p1[1] - hero.x, p1[2] - hero.y) < 5, 'притянут к герою');
});
