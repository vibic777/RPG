'use strict';
// Инвентарь в мире: WebSocket-действия, предметы на земле у двух клиентов, защита от подделок,
// выдача и изъятие предметов администратором (API, журнал, /give и /take).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');

const params = { name: 'Склад', seed: 'inv-ws', size: 'small', enemyDensity: 'normal', hordeFrequency: 'rare', dragons: 0, scaleToLevel: false };

// Мир с двумя игроками: admin (первый аккаунт — администратор) и bob
async function setup(args = ['--set', 'game.pickupRange=4']) {
  const s = await startServer(args);
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const bob = await newPlayer(b, 'bob', 'Боб Строитель');
  const w = (await api(b, 'POST', '/api/worlds', params, admin.token)).data.world;
  const code = (await api(b, 'POST', `/api/worlds/${w.id}/share`, { open: true, invite: 'new' }, admin.token)).data.world.inviteCode;
  await api(b, 'POST', '/api/worlds/join', { code }, bob.token);
  const A = await joinWorld(b, admin, w.id);
  const B = await joinWorld(b, bob, w.id);
  return { s, b, w, admin, bob, A, B };
}
const inv = (c, pred = () => true) => c.next((m) => m.t === 'inv' && pred(m));
const invErr = (c) => c.next('inv-error');
const cellOf = (inventory, id) => inventory.cells.findIndex((x) => x && x.id === id);
const count = (inventory, id) => [...inventory.cells, ...Object.values(inventory.equipment)].filter((x) => x && x.id === id).reduce((a, x) => a + x.n, 0);
const sys = (c, re) => c.next((m) => m.t === 'chat' && m.m.channel === 'system' && re.test(m.m.text));

test('WS: при входе — инвентарь, предметы на земле и внешний вид игроков', async (t) => {
  const { s, A, B } = await setup();
  t.after(() => s.stop());
  const wA = A.welcome;
  assert.equal(wA.inv.inventory.equipment.mainHand.id, 'knife_rusty');
  assert.equal(wA.inv.inventory.equipment.underwear.id, 'underwear_base');
  assert.deepEqual(wA.ground, []);
  assert.ok(wA.inv.summary.capacity >= 12);
  const bobSeen = B.welcome.players.find((p) => p.account === 'admin');
  assert.equal(bobSeen.look.mainHand.shape, 'knife');
  assert.equal(bobSeen.look.shirt.id, 'shirt_canvas');
  const join = await A.next('join');
  assert.equal(join.player.look.backpack.id, 'bag_canvas');
});

test('WS: выбросить и поднять — видно обоим клиентам, сохраняется в файле мира', async (t) => {
  const { s, w, admin, bob, A, B } = await setup();
  t.after(() => s.stop());
  const i = cellOf(A.welcome.inv.inventory, 'ration');
  A.send({ t: 'inv', a: { type: 'drop', from: { c: 'cell', i }, count: 1 } });
  const mine = await inv(A);
  assert.equal(count(mine.inventory, 'ration'), 1);
  const addA = await A.next('ground-add');
  const addB = await B.next('ground-add');
  assert.deepEqual(addA.item, addB.item);
  assert.equal(addB.item.id, 'ration');
  assert.equal(addB.item.n, 1);
  assert.equal(addB.item.by, 'Алиса');
  const alice = A.welcome.players.find((p) => p.id === A.welcome.you);
  assert.ok(addB.item.x > alice.x && addB.item.y > alice.y, 'предмет ложится перед героем, а не под ним');
  const file = path.join(s.dataDir, 'worlds', w.id + '.ground.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).items.length, 1);

  // Боб поднимает
  B.send({ t: 'inv', a: { type: 'pickup', gid: addB.item.gid } });
  const got = await inv(B);
  assert.equal(count(got.inventory, 'ration'), 3);
  assert.equal((await A.next('ground-remove')).gid, addB.item.gid);
  assert.equal((await B.next('ground-remove')).gid, addB.item.gid);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).items.length, 0);
  // второй раз поднять нельзя
  A.send({ t: 'inv', a: { type: 'pickup', gid: addB.item.gid } });
  assert.match((await invErr(A)).message, /уже нет/);

  // выбросить надетое (нож) — внешний вид меняется у всех
  A.send({ t: 'inv', a: { type: 'drop', from: { c: 'eq', s: 'mainHand' } } });
  const look = await B.next((m) => m.t === 'look' && m.id === A.welcome.you);
  assert.equal(look.look.mainHand, undefined);
  const knife = (await B.next('ground-add')).item;
  assert.equal(knife.id, 'knife_rusty');
  assert.ok(knife.dur > 0, 'прочность сохраняется');
  // бельё выбросить нельзя
  A.send({ t: 'inv', a: { type: 'drop', from: { c: 'eq', s: 'underwear' } } });
  assert.match((await invErr(A)).message, /бельё/i);

  // предметы на земле переживают перезаход
  await B.close();
  const again = await joinWorld(s.base, bob, w.id);
  assert.deepEqual(again.welcome.ground.map((g) => g.gid), [knife.gid]);
  again.close();

  // удаление мира удаляет и предметы на земле
  await A.close();
  await sleep(100);
  const del = await api(s.base, 'DELETE', `/api/worlds/${w.id}`, undefined, admin.token);
  assert.equal(del.status, 200);
  assert.ok(!fs.existsSync(file));
});

test('WS: действия с инвентарём и рассылка внешнего вида; изменения по REST тоже доходят', async (t) => {
  const { s, bob, A, B } = await setup();
  t.after(() => s.stop());
  B.send({ t: 'inv', a: { type: 'unequip', from: { c: 'eq', s: 'shirt' } } });
  const r = await inv(B);
  assert.equal(r.inventory.equipment.shirt, null);
  assert.equal((await A.next((m) => m.t === 'look' && m.id === B.welcome.you)).look.shirt, undefined);
  // REST, пока игрок в мире
  const rest = await api(s.base, 'POST', `/api/characters/${bob.characterId}/inventory`, { type: 'equip', from: { c: 'cell', i: cellOf(r.inventory, 'shirt_canvas') } }, bob.token);
  assert.equal(rest.status, 200, JSON.stringify(rest.data));
  assert.equal((await inv(B)).inventory.equipment.shirt.id, 'shirt_canvas');
  assert.equal((await A.next((m) => m.t === 'look' && m.id === B.welcome.you)).look.shirt.id, 'shirt_canvas');
  // панель 1–0: съесть паёк клавишей 2 (выносливость и здоровье полные — отказ), привязать
  B.send({ t: 'inv', a: { type: 'hotkey', key: 1 } });
  assert.match((await invErr(B)).message, /ничего не даст/);
  B.send({ t: 'inv', a: { type: 'hotbar', key: 5, item: 'shirt_canvas' } });
  assert.equal((await inv(B)).inventory.hotbar[5], 'shirt_canvas');
});

test('WS: сервер отклоняет подделки — чужие и несуществующие предметы, перегруз, нет места, далеко', async (t) => {
  const { s, w, admin, bob, A, B } = await setup(['--set', 'game.pickupRange=2.6', '--set', 'game.baseSlots=8', '--set', 'game.baseCarryKg=20', '--set', 'game.carryPerStrength=5']);
  t.after(() => s.stop());
  const empty = B.welcome.inv.inventory.cells.findIndex((x) => !x);
  const attempts = [
    { type: 'equip', from: { c: 'cell', i: empty }, item: { id: 'sword_adamant', n: 1 } }, // «надеть» предмет из пустой ячейки
    { type: 'move', from: { c: 'cell', i: 999 }, to: { c: 'eq', s: 'mainHand' } },
    { type: 'move', from: { c: 'cell', i: -1 }, to: { c: 'cell', i: 0 } },
    { type: 'move', from: { c: 'eq', s: 'hack' }, to: { c: 'cell', i: 0 } },
    { type: 'hotbar', key: 0, item: 'sword_adamant' }, // привязать то, чего нет
    { type: 'add', item: 'sword_adamant' }, // игрок не может выдавать себе предметы
    { type: 'pickup', gid: 'nope' },
    { type: 'use', from: 'cell0' },
  ];
  for (const a of attempts) {
    B.send({ t: 'inv', a });
    const e = await invErr(B);
    assert.ok(e.message, JSON.stringify(a));
    assert.equal(count(e.inventory, 'sword_adamant'), 0);
  }
  B.send({ t: 'inv', a: 'мусор' });
  await invErr(B);

  // перегруз: выдача сверх предела веса отклоняется
  const heavy = await api(s.base, 'POST', '/api/admin/items/give', { username: 'bob', item: 'turret_watchman', count: 3 }, admin.token);
  assert.equal(heavy.status, 400);
  assert.match(heavy.data.error, /Слишком тяжело/);

  // далеко: предмет на земле дальше, чем pickupRange
  A.send({ t: 'inv', a: { type: 'drop', from: { c: 'eq', s: 'mainHand' } } }); // нож: не складывается в стопку
  const g = (await B.next('ground-add')).item;
  const file = path.join(s.dataDir, 'worlds', w.id + '.ground.json');
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  db.items[0].x += 30;
  await sleep(20);
  fs.writeFileSync(file, JSON.stringify(db));
  B.send({ t: 'inv', a: { type: 'pickup', gid: g.gid } });
  assert.match((await invErr(B)).message, /далеко/);
  db.items[0].x -= 30;
  await sleep(20);
  fs.writeFileSync(file, JSON.stringify(db));

  // нет места: заполнить сумку Боба до отказа
  const cells = (await api(s.base, 'GET', '/api/characters', undefined, bob.token)).data.characters[0].inventory.cells;
  const free = cells.filter((x) => !x).length;
  const fill = await api(s.base, 'POST', '/api/admin/items/give', { username: 'bob', item: 'knife_fang', count: free }, admin.token);
  assert.equal(fill.status, 200, JSON.stringify(fill.data));
  await inv(B, (m) => m.inventory.cells.every(Boolean));
  const more = await api(s.base, 'POST', '/api/admin/items/give', { username: 'bob', item: 'knife_fang' }, admin.token);
  assert.equal(more.status, 400);
  assert.match(more.data.error, /Нет места/);
  B.send({ t: 'inv', a: { type: 'pickup', gid: g.gid } });
  assert.match((await invErr(B)).message, /Нет места/);
});

test('администратор: выдать и забрать предметы через API, журнал, уведомление игрока', async (t) => {
  const { s, admin, bob, B } = await setup();
  t.after(() => s.stop());
  const r = await api(s.base, 'POST', '/api/admin/items/give', { username: 'bob', character: 'Боб Строитель', item: 'Патроны 9 мм', count: 250 }, admin.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.item, 'ammo_9mm');
  const got = await inv(B, (m) => count(m.inventory, 'ammo_9mm') === 250);
  assert.equal(got.inventory.cells.filter((x) => x && x.id === 'ammo_9mm').length, 2, 'две стопки: 200 + 50');
  await sys(B, /выдал вам: Патроны 9 мм × 250/);

  const tk = await api(s.base, 'POST', '/api/admin/items/take', { username: 'bob', item: 'ammo_9mm', count: 60 }, admin.token);
  assert.equal(tk.status, 200, JSON.stringify(tk.data));
  assert.equal(tk.data.count, 60);
  await inv(B, (m) => count(m.inventory, 'ammo_9mm') === 190);
  await sys(B, /забрал у вас/);
  // забрать больше, чем есть — забирается сколько есть
  const all = await api(s.base, 'POST', '/api/admin/items/take', { username: 'bob', item: 'ammo_9mm', count: 1000 }, admin.token);
  assert.equal(all.data.count, 190);
  // ошибки
  assert.equal((await api(s.base, 'POST', '/api/admin/items/take', { username: 'bob', item: 'ammo_9mm' }, admin.token)).status, 400, 'нечего забирать');
  assert.equal((await api(s.base, 'POST', '/api/admin/items/take', { username: 'bob', item: 'underwear_base' }, admin.token)).status, 400, 'бельё не забирается');
  assert.equal((await api(s.base, 'POST', '/api/admin/items/give', { username: 'bob', item: 'нет такого' }, admin.token)).status, 400);
  assert.equal((await api(s.base, 'POST', '/api/admin/items/give', { username: 'bob', item: 'ration', count: 0 }, admin.token)).status, 400);
  assert.equal((await api(s.base, 'POST', '/api/admin/items/give', { username: 'nobody', item: 'ration' }, admin.token)).status, 404);
  assert.equal((await api(s.base, 'POST', '/api/admin/items/give', { username: 'bob', character: 'Никто', item: 'ration' }, admin.token)).status, 404);
  // не администратор — 403, без входа — 401
  assert.equal((await api(s.base, 'POST', '/api/admin/items/give', { username: 'bob', item: 'ration' }, bob.token)).status, 403);
  assert.equal((await api(s.base, 'POST', '/api/admin/items/give', { username: 'bob', item: 'ration' })).status, 401);
  // у аккаунта два персонажа — нужно указать
  await api(s.base, 'POST', '/api/characters', { ...require('./helpers').validCharacter('Второй Боб') }, bob.token);
  const amb = await api(s.base, 'POST', '/api/admin/items/give', { username: 'bob', item: 'ration' }, admin.token);
  assert.equal(amb.status, 400);
  assert.match(amb.data.error, /Укажите персонажа/);
  // выдача офлайн-персонажу сохраняется в файле
  const off = await api(s.base, 'POST', '/api/admin/items/give', { username: 'bob', character: 'Второй Боб', item: 'medkit', count: 2 }, admin.token);
  assert.equal(off.status, 200);
  const list = (await api(s.base, 'GET', '/api/characters', undefined, bob.token)).data.characters;
  assert.equal(count(list.find((c) => c.name === 'Второй Боб').inventory, 'medkit'), 2);
  // журнал действий
  const log = fs.readFileSync(path.join(s.dataDir, 'admin-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const gives = log.filter((e) => e.action === 'give');
  const takes = log.filter((e) => e.action === 'take');
  assert.equal(gives.length, 2);
  assert.deepEqual([gives[0].admin, gives[0].username, gives[0].character, gives[0].item, gives[0].count], ['admin', 'bob', 'Боб Строитель', 'ammo_9mm', 250]);
  assert.deepEqual(takes.map((e) => e.count), [60, 190]);
});

test('администратор: команды /give и /take в чате', async (t) => {
  const { s, A, B } = await setup(['--set', 'game.chatRateCount=100']);
  t.after(() => s.stop());
  A.send({ t: 'chat', text: '/give bob knife_fang' });
  await sys(A, /Выдано: Клык × 1 — Боб Строитель/);
  await inv(B, (m) => count(m.inventory, 'knife_fang') === 1);
  A.send({ t: 'chat', text: '/выдать "Боб Строитель" Патроны 9 мм 30' });
  await sys(A, /Выдано: Патроны 9 мм × 30/);
  await inv(B, (m) => count(m.inventory, 'ammo_9mm') === 30);
  A.send({ t: 'chat', text: '/take Боб Строитель ammo_9mm 10' });
  await sys(A, /Забрано: Патроны 9 мм × 10/);
  await inv(B, (m) => count(m.inventory, 'ammo_9mm') === 20);
  A.send({ t: 'chat', text: '/give bob бластер_мечты 1' });
  await sys(A, /Неизвестный предмет/);
  A.send({ t: 'chat', text: '/give кто-то ration' });
  await sys(A, /не найден/);
  A.send({ t: 'chat', text: '/give bob' });
  await sys(A, /Какой предмет/);
  // не администратор
  B.send({ t: 'chat', text: '/give admin sword_adamant' });
  await sys(B, /только администратору/);
  B.send({ t: 'chat', text: '/take admin knife_rusty' });
  await sys(B, /только администратору/);
  // /help у администратора упоминает /give
  A.send({ t: 'chat', text: '/help' });
  await sys(A, /\/give/);
  const log = fs.readFileSync(path.join(s.dataDir, 'admin-log.jsonl'), 'utf8');
  assert.match(log, /"action":"give".*"item":"knife_fang"/);
  assert.match(log, /"action":"take".*"count":10/);
});

test('земля: предмет исчезает через game.groundItemTtlMin, предел предметов в мире', async (t) => {
  const s = await startServer(['--set', 'game.groundItemTtlMin=0.01', '--set', 'game.groundPurgeSec=1', '--set', 'game.groundItemsMax=2']);
  t.after(() => s.stop());
  const p = await newPlayer(s.base, 'solo', 'Одиночка');
  const w = (await api(s.base, 'POST', '/api/worlds', params, p.token)).data.world;
  const C = await joinWorld(s.base, p, w.id);
  const water = cellOf(C.welcome.inv.inventory, 'water_flask');
  C.send({ t: 'inv', a: { type: 'drop', from: { c: 'cell', i: water }, count: 1 } });
  const g1 = (await C.next('ground-add')).item;
  C.send({ t: 'inv', a: { type: 'drop', from: { c: 'cell', i: water }, count: 1 } });
  await C.next('ground-add');
  const ration = cellOf((await inv(C, (m) => count(m.inventory, 'water_flask') === 0)).inventory, 'ration');
  C.send({ t: 'inv', a: { type: 'drop', from: { c: 'cell', i: ration }, count: 1 } });
  assert.match((await invErr(C)).message, /слишком много|не поместится/);
  assert.equal((await C.next('ground-remove', 4000)).gid, g1.gid);
});
