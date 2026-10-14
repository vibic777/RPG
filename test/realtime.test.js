'use strict';
// Реальное время: вход по сессии, баны, предел игроков, доступ по коду, серверное движение, рассылка позиций.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../shared/worldgen');
const M = require('../shared/movement');
const P = require('../shared/protocol');
const { startServer, api, wsClient, newPlayer, joinWorld, sleep } = require('./helpers');

const params = (patch = {}) => ({ name: 'Кооп', seed: 'abc', size: 'small', enemyDensity: 'normal', hordeFrequency: 'rare', dragons: 1, scaleToLevel: false, ...patch });

async function openWorld(base, owner) {
  const w = (await api(base, 'POST', '/api/worlds', params(), owner.token)).data.world;
  const code = (await api(base, 'POST', `/api/worlds/${w.id}/share`, { open: true, invite: 'new' }, owner.token)).data.world.inviteCode;
  return { world: w, code };
}

// Ближайшая к точке появления проходимая клетка на расстоянии ~dist и путь до неё
function pathFromSpawn(map, dist = 5) {
  const grid = M.gridFromWorld(map);
  const { x: sx, y: sy } = map.spawn;
  for (let r = dist; r < dist + 20; r++) {
    for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, -r]]) {
      const p = M.findPath(grid, sx, sy, sx + dx, sy + dy);
      if (p && p.length >= dist) return p;
    }
  }
  throw new Error('нет пути от точки появления');
}

test('протокол: коды закрытия и задержки переподключения', () => {
  assert.equal(P.shouldReconnect(1006), true, 'обрыв связи — переподключаться');
  assert.equal(P.shouldReconnect(P.CLOSE.SHUTDOWN), true);
  for (const c of [P.CLOSE.AUTH, P.CLOSE.BANNED, P.CLOSE.FULL, P.CLOSE.REPLACED, P.CLOSE.NO_ACCESS, P.CLOSE.NORMAL]) assert.equal(P.shouldReconnect(c), false);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((a) => P.backoffDelay(a, 500, 8000)), [500, 1000, 2000, 4000, 8000, 8000]);
  const j = P.backoffDelay(2, 500, 8000, 1);
  assert.equal(j, 2500, 'разброс до +25%');
  for (const code of Object.values(P.CLOSE)) assert.ok(P.CLOSE_TEXT[code], 'у каждого кода есть текст: ' + code);
});

test('WS: вход по сессии, неверный токен, нет приветствия, чужой персонаж, неверный путь', async (t) => {
  const s = await startServer(['--set', 'wsAuthTimeoutSec=1']);
  t.after(() => s.stop());
  const b = s.base;
  const owner = await newPlayer(b, 'owner');
  const other = await newPlayer(b, 'other');
  const { world } = await openWorld(b, owner);

  // неверный токен
  let c = wsClient(b);
  await c.opened;
  c.send({ t: 'hello', token: 'nope', worldId: world.id, characterId: owner.characterId });
  assert.equal(await c.closed, P.CLOSE.AUTH);
  assert.equal(c.messages[0].t, 'kicked');

  // нет приветствия — отключение по таймауту
  c = wsClient(b);
  await c.opened;
  assert.equal(await c.closed, P.CLOSE.PROTOCOL);

  // сообщение до приветствия
  c = wsClient(b);
  await c.opened;
  c.send({ t: 'path', path: [[1, 1]] });
  assert.equal(await c.closed, P.CLOSE.PROTOCOL);

  // чужой персонаж и мир без доступа
  c = await joinWorld(b, { token: owner.token, characterId: other.characterId }, world.id);
  assert.equal(c.welcome, null);
  assert.equal(c.closeCode, P.CLOSE.NO_ACCESS);
  c = await joinWorld(b, other, world.id);
  assert.equal(c.closeCode, P.CLOSE.NO_ACCESS, 'не участник мира');

  // неверный путь WebSocket
  const bad = wsClient(b, { path: '/nope' });
  await assert.rejects(bad.opened);

  // успешный вход: позиция — точка появления
  c = await joinWorld(b, owner, world.id);
  assert.ok(c.welcome, 'welcome получен');
  assert.equal(c.welcome.you, (await api(b, 'GET', '/api/me', undefined, owner.token)).data.account.id);
  assert.equal(c.welcome.players.length, 1);
  assert.equal(c.welcome.players[0].x, world.spawn.x + 0.5);
  assert.equal(c.welcome.players[0].name, 'Герой owner');
  const st = await c.next('state');
  assert.equal(st.players.length, 1);
  // список миров показывает, сколько игроков онлайн
  assert.equal((await api(b, 'GET', '/api/worlds', undefined, owner.token)).data.worlds[0].online, 1);
  await c.close();
});

test('WS: бан — отключение сразу (через API) и при перепроверке (правка файла), повторный вход отклонён', async (t) => {
  const s = await startServer(['--set', 'wsBanCheckSec=1']);
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin'); // первый аккаунт — администратор
  const bad = await newPlayer(b, 'badguy');
  const sneaky = await newPlayer(b, 'sneaky');
  const { world, code } = await openWorld(b, admin);
  await api(b, 'POST', '/api/worlds/join', { code }, bad.token);
  await api(b, 'POST', '/api/worlds/join', { code }, sneaky.token);

  const a = await joinWorld(b, admin, world.id);
  const c = await joinWorld(b, bad, world.id);
  assert.ok(c.welcome);
  await api(b, 'POST', '/api/admin/ban', { username: 'badguy', reason: 'читы' }, admin.token);
  const kicked = await c.next('kicked');
  assert.equal(kicked.code, P.CLOSE.BANNED);
  assert.match(kicked.message, /читы/);
  assert.equal(await c.closed, P.CLOSE.BANNED);
  const left = await a.next('leave');
  assert.equal(left.name, 'Герой badguy');
  // повторный вход с тем же токеном — отказ (сессии заблокированного удалены)
  const again = await joinWorld(b, bad, world.id);
  assert.equal(again.welcome, null);
  assert.ok([P.CLOSE.AUTH, P.CLOSE.BANNED].includes(again.closeCode));

  // бан правкой accounts.json (сессия остаётся): отключение при перепроверке и отказ при входе с понятной причиной
  const d = await joinWorld(b, sneaky, world.id);
  assert.ok(d.welcome);
  const file = path.join(s.dataDir, 'accounts.json');
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(db.users.sneaky, { banned: true, bannedUntil: null, banReason: 'правка файла' });
  fs.writeFileSync(file, JSON.stringify(db));
  const k2 = await d.next('kicked', 4000);
  assert.equal(k2.code, P.CLOSE.BANNED);
  assert.match(k2.message, /правка файла/);
  const e = await joinWorld(b, sneaky, world.id);
  assert.equal(e.closeCode, P.CLOSE.BANNED);
  assert.match(e.messages[0].message, /заблокирован/);
  await a.close();
});

test('WS: предел игроков в мире, закрытие и удаление мира, вход из второй вкладки', async (t) => {
  const s = await startServer(['--set', 'game.maxPlayers=2']);
  t.after(() => s.stop());
  const b = s.base;
  const owner = await newPlayer(b, 'owner');
  const g1 = await newPlayer(b, 'guest1');
  const g2 = await newPlayer(b, 'guest2');
  const { world, code } = await openWorld(b, owner);
  for (const g of [g1, g2]) assert.equal((await api(b, 'POST', '/api/worlds/join', { code }, g.token)).status, 200);

  const o = await joinWorld(b, owner, world.id);
  const c1 = await joinWorld(b, g1, world.id);
  assert.ok(c1.welcome);
  const c2 = await joinWorld(b, g2, world.id);
  assert.equal(c2.closeCode, P.CLOSE.FULL, 'третий игрок при пределе 2');
  assert.match(c2.messages[0].message, /2/);

  // место освободилось
  await c1.close();
  await o.next('leave');
  const c2b = await joinWorld(b, g2, world.id);
  assert.ok(c2b.welcome);
  assert.equal(c2b.welcome.players.length, 2);

  // тот же аккаунт из второй вкладки: старое соединение закрывается
  const c2c = await joinWorld(b, g2, world.id);
  assert.ok(c2c.welcome);
  assert.equal(await c2b.closed, P.CLOSE.REPLACED);

  // владелец закрыл мир — гость отключён, владелец остаётся
  await api(b, 'POST', `/api/worlds/${world.id}/share`, { open: false }, owner.token);
  const k = await c2c.next('kicked');
  assert.equal(k.code, P.CLOSE.NO_ACCESS);
  assert.match(k.message, /закрыл/);
  assert.equal(o.closeCode, null);
  const denied = await joinWorld(b, g1, world.id);
  assert.equal(denied.closeCode, P.CLOSE.NO_ACCESS, 'в закрытый мир гостю нельзя');

  // мир удалён — отключаются все
  await api(b, 'DELETE', `/api/worlds/${world.id}`, undefined, owner.token);
  assert.equal(await o.closed, P.CLOSE.NO_ACCESS);
});

test('WS: настройка requireOwnerOnline — гости только при владельце', async (t) => {
  const s = await startServer(['--set', 'game.requireOwnerOnline=true']);
  t.after(() => s.stop());
  const b = s.base;
  const owner = await newPlayer(b, 'owner');
  const guest = await newPlayer(b, 'guest');
  const { world, code } = await openWorld(b, owner);
  await api(b, 'POST', '/api/worlds/join', { code }, guest.token);
  const early = await joinWorld(b, guest, world.id);
  assert.equal(early.closeCode, P.CLOSE.HOST_OFFLINE);
  const o = await joinWorld(b, owner, world.id);
  const g = await joinWorld(b, guest, world.id);
  assert.ok(g.welcome);
  await o.close();
  assert.equal(await g.closed, P.CLOSE.HOST_OFFLINE, 'владелец ушёл — гость отключён');
});

test('WS: серверное движение — отклонение недопустимых путей, движение по пути и направлению, скорость', async (t) => {
  const s = await startServer(['--set', 'game.tickRate=20', '--set', 'game.maxPathLength=40']);
  t.after(() => s.stop());
  const b = s.base;
  const owner = await newPlayer(b, 'walker');
  const { world } = await openWorld(b, owner);
  const map = G.generate(world);
  const c = await joinWorld(b, owner, world.id);
  const start = { x: world.spawn.x + 0.5, y: world.spawn.y + 0.5 };
  const { x: sx, y: sy } = world.spawn;

  const expectReject = async (msg, re) => {
    c.drain();
    c.send(msg);
    const r = await c.next('reject');
    assert.match(r.reason, re);
    assert.equal(r.x, start.x);
    assert.equal(r.y, start.y);
  };
  await expectReject({ t: 'path', path: [[sx + 9, sy + 9]] }, /Разрыв/);
  await expectReject({ t: 'path', path: [[sx + 1, sy], [sx + 5, sy]] }, /Разрыв/);
  await expectReject({ t: 'path', path: [[sx + 0.5, sy]] }, /Некорректная/);
  await expectReject({ t: 'path', path: 'туда' }, /Пустой/);
  await expectReject({ t: 'path', path: new Array(41).fill([sx, sy]) }, /длинный/);
  // путь в непроходимую клетку: дойти до соседа ближайшей непроходимой клетки и шагнуть в неё
  const grid = M.gridFromWorld(map);
  let blocked = null;
  for (let r = 1; r < 40 && !blocked; r++) {
    for (let dx = -r; dx <= r && !blocked; dx++) {
      for (const dy of [-r, r]) {
        const x = sx + dx, y = sy + dy;
        if (G.isWalkable(map, x, y)) continue;
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ax, ay]) => [x + ax, y + ay]).find(([ax, ay]) => G.isWalkable(map, ax, ay) && M.findPath(grid, sx, sy, ax, ay));
        if (nb) { blocked = { cell: [x, y], path: M.findPath(grid, sx, sy, nb[0], nb[1]) }; break; }
      }
    }
  }
  assert.ok(blocked, 'рядом есть непроходимая клетка');
  if (blocked.path.length < 40) await expectReject({ t: 'path', path: [...blocked.path, blocked.cell] }, /непроходим/);
  // после всех отказов герой на месте
  c.drain();
  let st = await c.next('state');
  assert.deepEqual([st.players[0].x, st.players[0].y], [start.x, start.y]);

  // допустимый путь: герой приходит в центр последней клетки, скорость не превышена
  const p = pathFromSpawn(map, 5);
  c.drain();
  c.send({ t: 'path', path: p });
  const goal = p.at(-1);
  let prev = null;
  const deadline = Date.now() + 8000;
  for (;;) {
    st = await c.next('state');
    const me = st.players[0];
    if (prev) {
      const dt = (st.time - prev.time) / 1000;
      const dist = Math.hypot(me.x - prev.x, me.y - prev.y);
      assert.ok(dist <= M.settings.heroSpeed * dt * 1.6 + 0.05, `скорость: ${dist} за ${dt} с`);
    }
    prev = { x: me.x, y: me.y, time: st.time };
    if (me.x === goal[0] + 0.5 && me.y === goal[1] + 0.5 && !me.m) break;
    assert.ok(Date.now() < deadline, 'герой дошёл до цели');
  }

  // начало пути отстаёт от позиции (задержка сети) — сервер достраивает мостик
  const back = M.findPath(grid, goal[0], goal[1], sx, sy);
  if (back.length >= 3) {
    const seen = c.messages.length;
    c.send({ t: 'path', path: back.slice(1) }); // первая клетка через одну от текущей
    await sleep(200);
    assert.equal(c.messages.slice(seen).filter((m) => m.t === 'reject').length, 0, 'мостик достроен, путь принят');
  }
  c.send({ t: 'stop' });

  // направление (клавиши): движение и остановка
  await sleep(100);
  c.drain();
  const before = (await c.next('state')).players[0];
  c.send({ t: 'dir', dx: 1, dy: 1 });
  await sleep(400);
  c.send({ t: 'dir', dx: 0, dy: 0 });
  await sleep(150);
  c.drain();
  const after = (await c.next('state')).players[0];
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 0 || !G.isWalkable(map, Math.floor(before.x + 1), Math.floor(before.y + 1)), 'герой сдвинулся по направлению (если не упёрся)');
  const still = (await c.next('state')).players[0];
  assert.deepEqual([still.x, still.y], [after.x, after.y], 'после «стоп» стоит');
  c.send({ t: 'dir', dx: 'x', dy: null });
  assert.match((await c.next('error')).message, /направление/);
  c.send('не json');
  assert.match((await c.next('error')).message, /Некорректное/);
  await c.close();
});

test('WS: два игрока — появление, рассылка позиций, уход, сохранение позиции при отключении', async (t) => {
  const s = await startServer(['--set', 'game.tickRate=20']);
  t.after(() => s.stop());
  const b = s.base;
  const A = await newPlayer(b, 'alice', 'Алиса');
  const B = await newPlayer(b, 'bob', 'Боб');
  const { world, code } = await openWorld(b, A);
  await api(b, 'POST', '/api/worlds/join', { code }, B.token);
  const map = G.generate(world);

  const a = await joinWorld(b, A, world.id);
  const bc = await joinWorld(b, B, world.id);
  assert.equal(bc.welcome.players.length, 2);
  const [pa, pb] = bc.welcome.players;
  assert.notDeepEqual([Math.floor(pa.x), Math.floor(pa.y)], [Math.floor(pb.x), Math.floor(pb.y)], 'второй игрок появляется на соседней свободной клетке');
  assert.ok(G.isWalkable(map, Math.floor(pb.x), Math.floor(pb.y)));
  const joined = await a.next('join');
  assert.equal(joined.player.name, 'Боб');
  assert.equal(joined.player.account, 'bob');
  assert.ok(joined.player.appearance, 'внешность для отрисовки фигуры');

  // Алиса идёт — Боб видит её новые позиции
  const p = pathFromSpawn(map, 4);
  a.send({ t: 'path', path: p });
  const aliceId = a.welcome.you;
  const goal = p.at(-1);
  await bc.next((m) => m.t === 'state' && m.players.some((pl) => pl.id === aliceId && pl.x === goal[0] + 0.5 && pl.y === goal[1] + 0.5), 8000);

  // Алиса выходит (bye) — Боб получает уход, позиция Алисы сохранена
  a.send({ t: 'bye' });
  assert.equal(await a.closed, P.CLOSE.NORMAL);
  const left = await bc.next('leave');
  assert.equal(left.id, aliceId);
  const ch = (await api(b, 'GET', `/api/characters/${A.characterId}`, undefined, A.token)).data.character;
  assert.deepEqual([ch.positions[world.id].x, ch.positions[world.id].y], [goal[0] + 0.5, goal[1] + 0.5]);
  // при повторном входе — там же
  const a2 = await joinWorld(b, A, world.id);
  const me = a2.welcome.players.find((pl) => pl.id === aliceId);
  assert.deepEqual([me.x, me.y], [goal[0] + 0.5, goal[1] + 0.5]);
  await a2.close();
  await bc.close();
});

test('WS: молчащее соединение (закрытый браузер, пропала сеть) обрывается по wsPongTimeoutSec — герой исчезает у других', async (t) => {
  const s = await startServer(['--set', 'wsPingSec=0.2', '--set', 'wsPongTimeoutSec=0.7']);
  t.after(() => s.stop());
  const b = s.base;
  const A = await newPlayer(b, 'alice', 'Алиса');
  const B = await newPlayer(b, 'bob', 'Боб');
  const { world, code } = await openWorld(b, A);
  await api(b, 'POST', '/api/worlds/join', { code }, B.token);
  const a = await joinWorld(b, A, world.id);
  const bc = await joinWorld(b, B, world.id, { autoPong: false }); // Боб «завис»
  const started = Date.now();
  const left = await a.next('leave', 4000);
  assert.equal(left.id, bc.welcome.you);
  assert.equal(left.reason, 'timeout');
  assert.ok(Date.now() - started < 3000, 'убран быстро');
  await sleep(600);
  assert.ok(!a.messages.some((m) => m.t === 'leave' && m.id === a.welcome.you), 'отвечающий на ping игрок остаётся');
  await a.close();
});

test('WS: остановка сервера — игроки предупреждены (можно переподключиться), позиции сохранены', async () => {
  // корректная остановка по IPC-сообщению (в Windows SIGTERM завершает процесс без обработчиков)
  const s = await startServer(['--set', 'game.tickRate=20'], { ipc: true });
  const b = s.base;
  const A = await newPlayer(b, 'saver');
  const { world } = await openWorld(b, A);
  const map = G.generate(world);
  const a = await joinWorld(b, A, world.id);
  const p = pathFromSpawn(map, 3);
  a.send({ t: 'path', path: p });
  const goal = p.at(-1);
  await a.next((m) => m.t === 'state' && m.players[0].x === goal[0] + 0.5 && m.players[0].y === goal[1] + 0.5, 8000);
  const accountId = a.welcome.you;
  const exited = new Promise((r) => s.proc.once('exit', r));
  s.proc.send('shutdown');
  const k = await a.next('kicked');
  assert.equal(k.code, P.CLOSE.SHUTDOWN);
  assert.equal(P.shouldReconnect(await a.closed), true);
  await exited;
  const saved = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'characters', accountId + '.json'), 'utf8')).characters[0].positions[world.id];
  assert.deepEqual([saved.x, saved.y], [goal[0] + 0.5, goal[1] + 0.5]);
  await s.stop();
});
