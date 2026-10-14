'use strict';
// Шаг 18 по WebSocket: сигналинг голосового чата — вход в канал, пересылка offer/answer/ICE только внутри мира и канала,
// чужой мир и чужой канал — отказ, лимит участников, «говорит», большой сигнал, переход на другой уровень не рвёт голос,
// заглушение администратором (сигналинг не соединяет, соседи получают vc-leave), возврат голоса, блокировка аккаунта,
// TURN не попадает в общие настройки, панель ГМ и журнал.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');

const params = (o = {}) => ({ name: 'Голос', seed: 'voice-1', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false, ...o });
const args = ['--set', 'game.voiceMaxPeers=3', '--set', 'game.voiceStunUrls=stun:stun.example:3478', '--set', 'voiceTurnUrl=turn:turn.example:3478', '--set', 'voiceTurnUser=rpg', '--set', 'voiceTurnPass=tajna',
  '--set', 'game.survivalFoodPerMin=0', '--set', 'game.survivalWaterPerMin=0', '--set', 'game.survivalRestPerMin=0'];
const vc = (c, o) => c.send({ t: 'vc', ...o });
const rej = async (c, re) => assert.match((await c.next('vc-reject', 3000)).message, re);

test('WS голос: сигналинг, каналы, лимит, уровни, заглушение, блокировка, ГМ', async (t) => {
  const s = await startServer(args);
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const bob = await newPlayer(b, 'bob', 'Боб');
  const carl = await newPlayer(b, 'carl', 'Карл');
  const dave = await newPlayer(b, 'dave', 'Дэйв');
  const eve = await newPlayer(b, 'eve', 'Ева');
  const pub = (await api(b, 'GET', '/api/config')).data;
  assert.equal(pub.game.voicePttKey, 'KeyV');
  assert.ok(!JSON.stringify(pub).includes('tajna'), 'пароль TURN не уходит в общие настройки');
  const w = (await api(b, 'POST', '/api/worlds', params(), admin.token)).data.world;
  const code = (await api(b, 'POST', `/api/worlds/${w.id}/share`, { open: true, invite: 'new' }, admin.token)).data.world.inviteCode;
  for (const p of [bob, carl, dave]) assert.equal((await api(b, 'POST', '/api/worlds/join', { code }, p.token)).status, 200);
  const w2 = (await api(b, 'POST', '/api/worlds', params({ name: 'Другой' }), eve.token)).data.world;
  const A = await joinWorld(b, admin, w.id);
  const B = await joinWorld(b, bob, w.id);
  const C = await joinWorld(b, carl, w.id);
  const D = await joinWorld(b, dave, w.id);
  const E = await joinWorld(b, eve, w2.id);
  const [ida, idb, idc, idd, ide] = [A, B, C, D, E].map((c) => c.welcome.you);
  assert.deepEqual(A.welcome.vc, { on: true, muted: null });

  // до входа в канал сигналы не пересылаются
  vc(B, { a: 'sig', to: ida, kind: 'offer', data: { sdp: 'x' } });
  await rej(B, /Сначала войдите/);
  // вход: список участников и ICE-серверы (с TURN — только вошедшим)
  vc(A, { a: 'join' });
  const pa = await A.next('vc-peers');
  assert.deepEqual(pa.peers, []);
  assert.equal(pa.fresh, true);
  assert.equal(pa.ch, 'world');
  assert.deepEqual(pa.ice, [{ urls: ['stun:stun.example:3478'] }, { urls: ['turn:turn.example:3478'], username: 'rpg', credential: 'tajna' }]);
  vc(B, { a: 'join', ch: 'world' });
  const pb = await B.next('vc-peers');
  assert.deepEqual(pb.peers.map((p) => p.id), [ida]);
  assert.equal((await A.next('vc-join')).peer.id, idb);
  // offer → answer → ICE
  vc(B, { a: 'sig', to: ida, kind: 'offer', data: { type: 'offer', sdp: 'v=0 b' } });
  const so = await A.next('vc-sig');
  assert.deepEqual([so.from, so.kind, so.data.sdp], [idb, 'offer', 'v=0 b']);
  vc(A, { a: 'sig', to: idb, kind: 'answer', data: { type: 'answer', sdp: 'v=0 a' } });
  assert.equal((await B.next('vc-sig')).kind, 'answer');
  vc(A, { a: 'sig', to: idb, kind: 'ice', data: [{ candidate: 'c1' }, { candidate: 'c2' }] });
  assert.equal((await B.next('vc-sig')).data.length, 2);
  vc(A, { a: 'sig', to: idb, kind: 'hack', data: 1 });
  await rej(A, /Неизвестный сигнал/);
  vc(B, { a: 'sig', to: ida, kind: 'ice', data: 'x'.repeat(17 * 1024) });
  await rej(B, /Слишком большой/);
  vc(A, { a: 'sig', to: ida, kind: 'offer', data: {} });
  await rej(A, /не в вашем/, 'себе — нельзя');

  // чужой мир: тот же канал «world», но сигнал не проходит в обе стороны
  vc(E, { a: 'join' });
  assert.deepEqual((await E.next('vc-peers')).peers, []);
  vc(E, { a: 'sig', to: ida, kind: 'offer', data: {} });
  await rej(E, /не в вашем/);
  vc(A, { a: 'sig', to: ide, kind: 'offer', data: {} });
  await rej(A, /не в вашем/);
  // группа по коду: отдельный канал
  vc(C, { a: 'join', ch: 'party:Отряд' });
  const pc = await C.next('vc-peers');
  assert.equal(pc.ch, 'party:отряд');
  assert.deepEqual(pc.peers, []);
  vc(B, { a: 'sig', to: idc, kind: 'offer', data: {} });
  await rej(B, /не в вашем/);
  // лимит канала (3): Дэйв — третий, Карл в «world» уже не помещается
  vc(D, { a: 'join' });
  assert.deepEqual((await D.next('vc-peers')).peers.map((p) => p.id).sort(), [ida, idb].sort());
  vc(C, { a: 'join', ch: 'world' });
  await rej(C, /полон \(3/);
  // «говорит»: только своему каналу
  C.messages.length = 0;
  vc(B, { a: 'speak', on: true });
  assert.deepEqual(await A.next('vc-speak'), { t: 'vc-speak', id: idb, on: true });
  assert.equal((await D.next('vc-speak')).id, idb);
  vc(B, { a: 'speak', on: true }); // повтор — без рассылки
  vc(B, { a: 'speak', on: false });
  assert.equal((await A.next('vc-speak')).on, false);
  await sleep(150);
  assert.ok(!C.messages.some((m) => m.t === 'vc-speak'), 'в другой канал «говорит» не уходит');

  // переход на другой уровень мира голос не рвёт
  B.messages.length = 0;
  let tp = await api(b, 'POST', '/api/admin/teleport', { level: '-1' }, admin.token);
  if (tp.status === 404) tp = await api(b, 'POST', '/api/admin/teleport', { level: '1' }, admin.token);
  assert.equal(tp.status, 200, JSON.stringify(tp.data));
  await A.next('welcome', 5000);
  vc(B, { a: 'sig', to: ida, kind: 'ice', data: [{ candidate: 'после перехода' }] });
  assert.equal((await A.next((m) => m.t === 'vc-sig' && m.kind === 'ice', 3000)).data[0].candidate, 'после перехода');
  assert.ok(!B.messages.some((m) => m.t === 'vc-leave'), 'уход на уровень — не выход из голоса');
  // клиент после перехода повторяет вход в тот же канал — сервер отвечает «не новый вход», соседям ничего не приходит
  vc(A, { a: 'join', ch: 'world' });
  const again = await A.next('vc-peers');
  assert.equal(again.fresh, false);
  assert.deepEqual(again.peers.map((p) => p.id).sort(), [idb, idd].sort());
  await sleep(100);
  assert.ok(!B.messages.some((m) => m.t === 'vc-join'), 'повторный вход — без vc-join');

  // заглушение администратором
  assert.equal((await api(b, 'POST', '/api/admin/voice/mute', { username: 'bob' }, bob.token)).status, 403);
  assert.equal((await api(b, 'POST', '/api/admin/voice/mute', { username: 'admin' }, admin.token)).status, 400, 'себя — нельзя');
  const mu = await api(b, 'POST', '/api/admin/voice/mute', { username: 'bob', minutes: 5, reason: 'шум' }, admin.token);
  assert.equal(mu.status, 200, JSON.stringify(mu.data));
  assert.equal(mu.data.account.voiceMuted, true);
  assert.equal(mu.data.muted[0].username, 'bob');
  assert.match((await B.next('vc-muted')).message, /заглушён.*шум/);
  assert.deepEqual(await A.next('vc-leave'), { t: 'vc-leave', id: idb, why: 'muted' });
  assert.equal((await D.next('vc-leave')).id, idb);
  vc(B, { a: 'join' });
  await B.next('vc-muted');
  vc(B, { a: 'sig', to: ida, kind: 'offer', data: {} });
  await rej(B, /Сначала войдите/);
  // теперь место в канале есть — Карл входит
  vc(C, { a: 'join', ch: 'world' });
  assert.deepEqual((await C.next('vc-peers')).peers.map((p) => p.id).sort(), [ida, idd].sort());
  const list = (await api(b, 'POST', '/api/admin/voice/list', {}, admin.token)).data;
  assert.equal(list.enabled, true);
  const chW = list.channels.find((x) => x.worldId === w.id && x.ch === 'world');
  assert.deepEqual(chW.members.map((m) => m.account).sort(), ['admin', 'carl', 'dave']);
  assert.ok(list.channels.some((x) => x.worldId === w2.id));
  assert.ok(list.log.some((e) => e.ev === 'reject-muted' && e.username === 'bob'));
  assert.ok(list.log.some((e) => e.ev === 'leave' && e.why === 'muted'));
  const alog = (await api(b, 'GET', '/api/admin/log?limit=50', undefined, admin.token)).data;
  assert.ok(JSON.stringify(alog).includes('voice-mute'), 'действие в журнале администратора');
  const acc = (await api(b, 'GET', '/api/admin/accounts', undefined, admin.token));
  assert.ok(acc.data.accounts.find((a) => a.username === 'bob').voiceMuted, 'заглушение видно в списке аккаунтов');
  // вернуть голос
  assert.equal((await api(b, 'POST', '/api/admin/voice/unmute', { username: 'bob' }, admin.token)).status, 200);
  await B.next('vc-unmuted');
  vc(B, { a: 'join' });
  await rej(B, /полон/);

  // блокировка аккаунта убирает из голоса
  assert.equal((await api(b, 'POST', '/api/admin/ban', { username: 'dave', minutes: 5 }, admin.token)).status, 200);
  assert.deepEqual(await A.next((m) => m.t === 'vc-leave' && m.id === idd, 3000), { t: 'vc-leave', id: idd, why: 'banned' });
  vc(B, { a: 'join' });
  assert.ok((await B.next('vc-peers')).peers.some((p) => p.id === ida));
  // выход из канала
  vc(C, { a: 'leave' });
  assert.equal((await A.next((m) => m.t === 'vc-leave' && m.id === idc)).why, 'leave');
  vc(A, { a: 'nope' });
  await rej(A, /Неизвестное действие/);
  B.ws.close();
  assert.equal((await A.next((m) => m.t === 'vc-leave' && m.id === idb, 3000)).why, 'left');
});
