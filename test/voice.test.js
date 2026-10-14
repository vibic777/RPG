'use strict';
// Шаг 18: правила голосового чата — громкость по расстоянию, очистка настроек игрока, рация и голосовая активация,
// каналы, ICE-серверы, настройки сервера с описаниями.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const V = require('../shared/voice');
const config = require('../server/config');

test('голос: громкость по расстоянию и итоговая громкость собеседника', () => {
  assert.equal(V.proximityGain(0, 24, 4), 1);
  assert.equal(V.proximityGain(4, 24, 4), 1);
  assert.equal(V.proximityGain(14, 24, 4), 0.5);
  assert.equal(V.proximityGain(24, 24, 4), 0);
  assert.equal(V.proximityGain(100, 24, 4), 0);
  assert.equal(V.proximityGain(NaN), 0);
  assert.equal(V.proximityGain(-1), 0);
  assert.equal(V.proximityGain(3, 2, 5), 0, 'полная зона не больше радиуса');
  assert.equal(V.proximityGain(9), 0.75, 'по умолчанию 4…24 клетки');
  const p = V.sanitizePrefs({ proximity: true, volume: 0.5, peers: { a: { vol: 0.5 }, b: { mute: true } } });
  assert.equal(V.peerGain(p, 'a', 0), 0.25);
  assert.equal(V.peerGain(p, 'b', 0), 0, 'заглушён');
  assert.equal(V.peerGain(p, 'c', 14), 0.25);
  assert.equal(V.peerGain(p, 'c', 1, false), 0, 'другой уровень мира — не слышно в режиме «рядом»');
  const g = V.sanitizePrefs({ proximity: false });
  assert.equal(V.peerGain(g, 'c', 500, false), 1, 'весь канал — громкость без расстояния');
});

test('голос: очистка настроек игрока', () => {
  const d = V.sanitizePrefs(null);
  assert.deepEqual(d, V.defaults());
  assert.equal(d.mode, 'ptt');
  assert.equal(d.pttKey, 'KeyV');
  assert.equal(d.on, false);
  const bad = V.sanitizePrefs({ on: 'yes', mode: 'shout', pttKey: 'Escape', muted: 1, proximity: 'no', channel: 'party', party: 'с пробелом!', volume: 7, vad: -1, device: 42, peers: { x: { vol: -3, mute: 'y' }, ['z'.repeat(80)]: { vol: 0.2 }, y: 5 }, junk: 1 });
  assert.deepEqual(bad, { on: false, mode: 'ptt', pttKey: 'KeyV', muted: false, proximity: true, channel: 'world', party: '', volume: 1, vad: 0.005, device: '', peers: { x: { vol: 0, mute: false } } });
  const ok = V.sanitizePrefs({ on: true, mode: 'vad', pttKey: 'CapsLock', muted: true, proximity: false, channel: 'party', party: ' Отряд-1 ', volume: 0.3, vad: 0.1, device: 'mic1', peers: { a: { vol: 1, mute: false } } });
  assert.equal(ok.mode, 'vad');
  assert.equal(ok.pttKey, 'CapsLock');
  assert.equal(ok.party, 'отряд-1');
  assert.equal(V.channelOf(ok), 'party:отряд-1');
  assert.deepEqual(ok.peers, {}, 'обычные громкости не хранятся');
  const many = {}; for (let i = 0; i < 200; i++) many['p' + i] = { mute: true };
  assert.equal(Object.keys(V.sanitizePrefs({ peers: many }).peers).length, 64);
  assert.equal(V.normChannel('party:AB'), 'party:ab');
  assert.equal(V.normChannel('party:'), 'world');
  assert.equal(V.normChannel('admins'), 'world');
  assert.equal(V.keyLabel('KeyV'), 'V');
  assert.equal(V.keyLabel('CapsLock'), 'Caps Lock');
  assert.ok(!V.validKey('Enter') && !V.validKey('Escape') && V.validKey('F4') && !V.validKey('F13'));
});

test('голос: рация, голосовая активация и «идёт передача»', () => {
  let held = false;
  for (const [ev, want] of [['down', true], ['down', true], ['up', false], ['down', true], ['blur', false], ['noise', false]]) {
    held = V.pttReduce(held, ev);
    assert.equal(held, want, ev);
  }
  let s = V.vadStep(null, 0.2, 1000, 0.05, 400);
  assert.deepEqual(s, { open: true, until: 1400 });
  s = V.vadStep(s, 0.01, 1300, 0.05, 400);
  assert.equal(s.open, true, 'держится после тишины');
  s = V.vadStep(s, 0.01, 1500, 0.05, 400);
  assert.equal(s.open, false);
  const base = { joined: true, hasMic: true, mode: 'ptt', pttHeld: true };
  assert.equal(V.transmitting(base), true);
  assert.equal(V.transmitting({ ...base, pttHeld: false }), false);
  assert.equal(V.transmitting({ ...base, muted: true }), false, 'заглушил себя');
  assert.equal(V.transmitting({ ...base, serverMuted: true }), false, 'заглушён администратором');
  assert.equal(V.transmitting({ ...base, hasMic: false }), false, 'без микрофона — только слушать');
  assert.equal(V.transmitting({ ...base, joined: false }), false);
  assert.equal(V.transmitting({ ...base, mode: 'vad', vadOpen: true, pttHeld: false }), true);
  assert.equal(V.transmitting({ ...base, mode: 'vad', vadOpen: false }), false);
});

test('голос: ICE-серверы и настройки сервера', () => {
  assert.deepEqual(V.iceServers('', '', '', ''), []);
  assert.deepEqual(V.iceServers('stun:a.example:3478, http://bad, stuns:b.example', 'turn:t.example:3478', 'u', 'p'), [
    { urls: ['stun:a.example:3478', 'stuns:b.example'] },
    { urls: ['turn:t.example:3478'], username: 'u', credential: 'p' },
  ]);
  assert.deepEqual(V.iceServers('', 'ftp://x', 'u', 'p'), []);
  const cfg = config.load({ configFile: null });
  for (const k of Object.keys(V.settings)) {
    assert.ok(k in cfg.game, 'game.' + k);
    assert.ok(config.DESCRIPTIONS['game.' + k], 'описание game.' + k);
  }
  for (const k of ['voiceTurnUrl', 'voiceTurnUser', 'voiceTurnPass']) {
    assert.ok(k in cfg && config.DESCRIPTIONS[k], k);
    assert.ok(!(k in config.publicConfig(cfg).game), 'TURN не уходит в общие настройки клиента');
  }
  // справка целиком доходит через конвейер (раньше длинный --help обрезался)
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'server', 'index.js'), '--help'], { encoding: 'utf8' });
  assert.match(out, /game\.voicePttKey .*клавиша рации/);
  assert.match(out, /voiceTurnPass .*пароль TURN/);
});
