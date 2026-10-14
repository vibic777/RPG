'use strict';
// Текстовый чат: канал мира, личные сообщения, системные, ограничение частоты и длины, экранирование, история, объявления.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');

const params = { name: 'Чат-мир', seed: 'chat', size: 'small', enemyDensity: 'normal', hordeFrequency: 'rare', dragons: 0, scaleToLevel: false };
const chatOf = async (c, pred) => (await c.next((m) => m.t === 'chat' && pred(m.m))).m;

// Мир с тремя игроками: admin (первый аккаунт — администратор), bob, carl
async function setup(args = []) {
  const s = await startServer(args);
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const bob = await newPlayer(b, 'bob', 'Боб Строитель');
  const carl = await newPlayer(b, 'carl', 'Карл');
  const w = (await api(b, 'POST', '/api/worlds', params, admin.token)).data.world;
  const code = (await api(b, 'POST', `/api/worlds/${w.id}/share`, { open: true, invite: 'new' }, admin.token)).data.world.inviteCode;
  for (const p of [bob, carl]) await api(b, 'POST', '/api/worlds/join', { code }, p.token);
  const A = await joinWorld(b, admin, w.id);
  const B = await joinWorld(b, bob, w.id);
  const C = await joinWorld(b, carl, w.id);
  return { s, b, w, admin, bob, carl, A, B, C, players: { admin, bob, carl } };
}

test('чат: всем в мире, системные сообщения о входе/выходе, экранирование HTML', async (t) => {
  const { s, A, B, C } = await setup();
  t.after(() => s.stop());
  // A видит системные сообщения о входе Боба и Карла
  assert.match((await chatOf(A, (m) => m.channel === 'system' && /Боб Строитель/.test(m.text))).text, /входит в мир/);
  await chatOf(A, (m) => m.channel === 'system' && /Карл/.test(m.text));

  B.send({ t: 'chat', text: '  привет всем  ' });
  for (const c of [A, B, C]) {
    const m = await chatOf(c, (x) => x.channel === 'world');
    assert.equal(m.text, 'привет всем', 'пробелы по краям обрезаны');
    assert.equal(m.from.name, 'Боб Строитель');
    assert.equal(m.from.account, 'bob');
    assert.equal(m.from.admin, false);
  }
  // сообщения администратора помечены
  A.send({ t: 'chat', text: 'я админ' });
  assert.equal((await chatOf(B, (x) => x.channel === 'world' && x.text === 'я админ')).from.admin, true);

  // экранирование
  C.send({ t: 'chat', text: '<script>alert(1)</script> & "кавычки" \'x\'' });
  const esc = await chatOf(A, (x) => x.channel === 'world' && x.from.account === 'carl');
  assert.equal(esc.text, '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;кавычки&quot; &#39;x&#39;');
  assert.ok(!esc.text.includes('<'));

  // управляющие символы заменены, пустое сообщение игнорируется
  C.send({ t: 'chat', text: 'a\u0000b\nc' });
  assert.equal((await chatOf(A, (x) => x.channel === 'world' && x.from.account === 'carl' && x.text.startsWith('a'))).text, 'a b c');
  C.send({ t: 'chat', text: '   ' });
  C.send({ t: 'chat', text: 42 });
  assert.match((await chatOf(C, (x) => x.channel === 'system')).text, /Некорректное/);

  // выход — системное сообщение остальным
  await C.close();
  assert.match((await chatOf(A, (m) => m.channel === 'system' && /Карл покидает/.test(m.text))).text, /покидает мир/);
});

test('чат: личные сообщения (/w, имя с пробелом, кавычки, /r), /who, /help, неизвестная команда', async (t) => {
  const { s, A, B, C } = await setup();
  t.after(() => s.stop());
  const seenByCarl = () => C.messages.filter((m) => m.t === 'chat' && m.m.channel === 'whisper');

  A.send({ t: 'chat', text: '/w bob секрет' });
  let m = await chatOf(B, (x) => x.channel === 'whisper');
  assert.equal(m.text, 'секрет');
  assert.equal(m.from.name, 'Алиса');
  assert.equal(m.to.account, 'bob');
  assert.equal((await chatOf(A, (x) => x.channel === 'whisper')).to.name, 'Боб Строитель', 'отправитель видит копию');

  // по имени героя с пробелом и в кавычках, русский псевдоним команды
  A.send({ t: 'chat', text: '/w Боб Строитель второй' });
  assert.equal((await chatOf(B, (x) => x.channel === 'whisper' && x.text === 'второй')).from.account, 'admin');
  A.send({ t: 'chat', text: '/ш "боб строитель" третий' });
  await chatOf(B, (x) => x.channel === 'whisper' && x.text === 'третий');

  // ответ /r
  B.send({ t: 'chat', text: '/r понял' });
  m = await chatOf(A, (x) => x.channel === 'whisper' && x.text === 'понял');
  assert.equal(m.from.account, 'bob');

  // ошибки: нет такого игрока, самому себе, пустой текст
  A.send({ t: 'chat', text: '/w никто привет' });
  assert.match((await chatOf(A, (x) => x.channel === 'system' && /не найден/.test(x.text))).text, /никто/);
  A.send({ t: 'chat', text: '/w admin себе' });
  assert.match((await chatOf(A, (x) => x.channel === 'system' && /самому себе/.test(x.text))).text, /самому/);
  C.send({ t: 'chat', text: '/r привет' });
  assert.match((await chatOf(C, (x) => x.channel === 'system' && /Некому/.test(x.text))).text, /Некому/);

  // /who, /help, неизвестная команда — только запросившему
  C.send({ t: 'chat', text: '/кто' });
  const whoMsg = await chatOf(C, (x) => x.channel === 'system' && /В мире 3/.test(x.text));
  assert.match(whoMsg.text, /Боб Строитель \(bob\)/);
  assert.match(whoMsg.text, /админ/);
  C.send({ t: 'chat', text: '/help' });
  assert.match((await chatOf(C, (x) => x.channel === 'system' && /Команды/.test(x.text))).text, /\/w/);
  C.send({ t: 'chat', text: '/танцевать' });
  assert.match((await chatOf(C, (x) => x.channel === 'system' && /Неизвестная команда/.test(x.text))).text, /танцевать/);

  await sleep(200);
  assert.equal(seenByCarl().length, 0, 'Карл не видит чужих личных сообщений');
  assert.equal(A.messages.filter((x) => x.t === 'chat' && /Неизвестная/.test(x.m.text)).length, 0, 'ответы на команды — только автору');
});

test('чат: ограничение частоты и длины (из настроек)', async (t) => {
  const { s, A, B } = await setup(['--set', 'game.chatRateCount=3', '--set', 'game.chatRateWindowSec=30', '--set', 'game.chatMaxLength=20']);
  t.after(() => s.stop());
  B.send({ t: 'chat', text: 'x'.repeat(21) });
  assert.match((await chatOf(B, (x) => x.channel === 'system' && /длиннее/.test(x.text))).text, /20/);
  B.send({ t: 'chat', text: 'y'.repeat(20) });
  await chatOf(A, (x) => x.channel === 'world' && x.text === 'y'.repeat(20));
  for (const n of [1, 2, 3]) B.send({ t: 'chat', text: 'флуд ' + n });
  assert.match((await chatOf(B, (x) => x.channel === 'system' && /Слишком часто/.test(x.text))).text, /Подождите \d+ с/);
  await sleep(200);
  const got = A.messages.filter((m) => m.t === 'chat' && m.m.channel === 'world' && m.m.from.account === 'bob').map((m) => m.m.text);
  assert.deepEqual(got, ['y'.repeat(20), 'флуд 1', 'флуд 2'], 'третье сообщение за окно отброшено (предел 3, считая первое)');
});

test('чат: история последних N сообщений при входе (без личных)', async (t) => {
  const { s, b, w, A, B, C, players } = await setup(['--set', 'game.chatHistory=3']);
  t.after(() => s.stop());
  for (const txt of ['раз', 'два', 'три', 'четыре']) {
    A.send({ t: 'chat', text: txt });
    await chatOf(B, (x) => x.text === txt);
  }
  A.send({ t: 'chat', text: '/w bob тайна' });
  await chatOf(B, (x) => x.channel === 'whisper');
  await C.close();
  await chatOf(A, (x) => /Карл покидает/.test(x.text));
  const C2 = await joinWorld(b, players.carl, w.id);
  const hist = C2.welcome.chat;
  assert.equal(hist.length, 3);
  assert.deepEqual(hist.map((m) => m.text), ['три', 'четыре', 'Карл покидает мир.']);
  assert.ok(!hist.some((m) => m.channel === 'whisper'));
  await C2.close();
});

test('чат: объявления администратора (команда и API), права, журнал', async (t) => {
  const { s, b, admin, bob, A, B, C } = await setup();
  t.after(() => s.stop());
  // второй мир с игроком — объявление приходит во все миры
  const w2 = (await api(b, 'POST', '/api/worlds', { ...params, name: 'Второй', seed: 'chat2' }, bob.token)).data.world;
  B.send({ t: 'bye' });
  await B.closed;
  const B2 = await joinWorld(b, bob, w2.id);

  C.send({ t: 'chat', text: '/announce я не админ' });
  assert.match((await chatOf(C, (x) => x.channel === 'system' && /администратору/.test(x.text))).text, /только/);

  A.send({ t: 'chat', text: '/объявление Рестарт в 22:00' });
  for (const c of [A, C, B2]) {
    const m = await chatOf(c, (x) => x.channel === 'announce');
    assert.equal(m.text, 'Рестарт в 22:00');
    assert.equal(m.from.admin, true);
  }

  // API: только администратор, экранирование, ответ с числом получателей
  assert.equal((await api(b, 'POST', '/api/admin/announce', { text: 'x' }, bob.token)).status, 403);
  assert.equal((await api(b, 'POST', '/api/admin/announce', { text: '  ' }, admin.token)).status, 400);
  const r = await api(b, 'POST', '/api/admin/announce', { text: '<b>Важно</b>', worldId: w2.id }, admin.token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { rooms: 1, players: 1 });
  assert.equal((await chatOf(B2, (x) => x.channel === 'announce' && /Важно/.test(x.text))).text, '&lt;b&gt;Важно&lt;/b&gt;');
  await sleep(150);
  assert.ok(!A.messages.some((m) => m.t === 'chat' && /Важно/.test(m.m.text)), 'объявление для одного мира не уходит в другие');

  const log = fs.readFileSync(path.join(s.dataDir, 'admin-log.jsonl'), 'utf8');
  assert.match(log, /"action":"announce"/);
  await B2.close();
});
