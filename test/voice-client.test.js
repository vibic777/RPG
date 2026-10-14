'use strict';
// Шаг 18: клиент голосового чата без браузера — движок на заглушках RTCPeerConnection, getUserMedia, <audio>, таймеров
// и localStorage (offer/answer/ICE, ICE пачкой, отложенные кандидаты, рация, голосовая активация, громкость по
// расстоянию, смена канала, переход по уровням, заглушение администратором, «только слушать» без микрофона), панель
// голоса на заглушке DOM (вход, смена клавиши рации, рация с клавиатуры, Shift+V не перехватывается, значки 🔊).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Voice = require('../shared/voice.js');

globalThis.window = globalThis.window || {};
globalThis.window.Voice = Voice;
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'client', 'js', f)).href);
const tick = () => new Promise((r) => setImmediate(r));

class FakePC {
  constructor(cfg) { this.cfg = cfg; this.tracks = []; this.trans = []; this.local = null; this.remoteDescription = null; this.ice = []; this.closed = false; FakePC.all.push(this); }
  addTrack(t) { this.tracks.push(t); }
  addTransceiver(kind, o) { this.trans.push([kind, o]); }
  getSenders() { return this.tracks.map((t) => ({ track: t, replaceTrack: async (n) => { this.replaced = n; } })); }
  async createOffer() { return { type: 'offer', sdp: 'sdp-o' }; }
  async createAnswer() { return { type: 'answer', sdp: 'sdp-a' }; }
  async setLocalDescription(d) { this.local = d; }
  async setRemoteDescription(d) { this.remoteDescription = d; }
  async addIceCandidate(c) { this.ice.push(c); }
  close() { this.closed = true; }
}
FakePC.all = [];
function makeEnv({ mic = true, err = null } = {}) {
  const timers = [], store = {};
  const env = {
    RTCPeerConnection: FakePC,
    getUserMedia: mic ? async (c) => { env.lastConstraints = c; if (err) throw Object.assign(new Error(err), { name: err }); const t = { enabled: true, stop() { this.stopped = true; } }; env.track = t; return { getAudioTracks: () => [t], getTracks: () => [t] }; } : null,
    enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'm1', label: 'USB' }, { kind: 'videoinput', deviceId: 'v' }],
    AudioContext: null,
    makeAudio: () => ({ volume: 1, srcObject: null, played: 0, play() { this.played++; return Promise.resolve(); }, pause() {} }),
    storage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {},
    setInterval: () => 1, clearInterval: () => {},
    now: () => 0,
    flush: () => { for (const f of timers.splice(0)) f(); },
    store,
  };
  return env;
}

test('голос, клиент: соединения, сигналы, ICE, рация, активация, громкость, каналы, уровни, заглушение', async () => {
  const { VoiceEngine } = await load('game/voice.js');
  FakePC.all.length = 0;
  const env = makeEnv(), sent = [];
  const e = new VoiceEngine(env, (m) => sent.push(m));
  assert.equal(e.prefs.mode, 'ptt');
  assert.equal(await e.start(), true);
  assert.equal(e.hasMic, true);
  assert.equal(env.track.enabled, false, 'до рации микрофон молчит');
  assert.deepEqual(sent.pop(), { t: 'vc', a: 'join', ch: 'world' });
  // вход: новичок звонит всем
  e.onMessage({ t: 'vc-peers', ch: 'world', fresh: true, ice: [{ urls: ['stun:x'] }], peers: [{ id: 'b', name: 'Боб' }] });
  await tick();
  const pb = FakePC.all[0];
  assert.deepEqual(pb.cfg.iceServers, [{ urls: ['stun:x'] }]);
  assert.equal(pb.tracks.length, 1);
  assert.deepEqual(sent.find((m) => m.kind === 'offer'), { t: 'vc', a: 'sig', to: 'b', kind: 'offer', data: { type: 'offer', sdp: 'sdp-o' } });
  await e.onMessage({ t: 'vc-sig', from: 'b', kind: 'answer', data: { type: 'answer', sdp: 'x' } });
  assert.equal(pb.remoteDescription.sdp, 'x');
  // ICE пачкой
  sent.length = 0;
  pb.onicecandidate({ candidate: { candidate: 'c1', sdpMid: '0', sdpMLineIndex: 0 } });
  pb.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'c2' }) } });
  pb.onicecandidate({ candidate: null });
  assert.equal(sent.length, 0);
  env.flush();
  assert.deepEqual(sent, [{ t: 'vc', a: 'sig', to: 'b', kind: 'ice', data: [{ candidate: 'c1', sdpMid: '0', sdpMLineIndex: 0 }, { candidate: 'c2' }] }]);
  // второй участник: ICE до offer откладывается
  e.onMessage({ t: 'vc-join', ch: 'world', peer: { id: 'c', name: 'Карл' } });
  const pc = FakePC.all[1];
  await e.onMessage({ t: 'vc-sig', from: 'c', kind: 'ice', data: [{ candidate: 'early' }] });
  assert.deepEqual(pc.ice, []);
  sent.length = 0;
  await e.onMessage({ t: 'vc-sig', from: 'c', kind: 'offer', data: { type: 'offer', sdp: 'oc' } });
  assert.deepEqual(pc.ice, [{ candidate: 'early' }]);
  assert.deepEqual(sent, [{ t: 'vc', a: 'sig', to: 'c', kind: 'answer', data: { type: 'answer', sdp: 'sdp-a' } }]);
  // звук и громкость по расстоянию
  pb.ontrack({ streams: ['S'] });
  const audio = e.peers.get('b').audio;
  assert.equal(audio.srcObject, 'S');
  assert.equal(audio.played, 1);
  const pos = { b: { x: 14, y: 0 }, c: null };
  e.updateGains({ x: 0, y: 0 }, (id) => pos[id]);
  assert.equal(audio.volume, 0.5);
  assert.equal(e.peers.get('c').gain, 0, 'другой уровень мира');
  e.setPeer('b', { vol: 0.5 });
  e.updateGains({ x: 0, y: 0 }, (id) => pos[id]);
  assert.equal(audio.volume, 0.25);
  e.setPeer('b', { mute: true });
  e.updateGains({ x: 0, y: 0 }, (id) => pos[id]);
  assert.equal(audio.volume, 0);
  e.setPrefs({ proximity: false, peers: {}, volume: 0.8 });
  e.updateGains({ x: 0, y: 0 }, (id) => pos[id]);
  assert.equal(audio.volume, 0.8);
  assert.equal(e.peers.get('c').gain, 0.8, 'весь канал — и с другого уровня');
  assert.equal(JSON.parse(env.store['rpg.voice']).volume, 0.8, 'настройки сохраняются');
  // рация
  sent.length = 0;
  e.ptt('down');
  assert.equal(env.track.enabled, true);
  assert.equal(e.tx, true);
  e.ptt('down');
  e.ptt('up');
  assert.equal(env.track.enabled, false);
  assert.deepEqual(sent, [{ t: 'vc', a: 'speak', on: true }, { t: 'vc', a: 'speak', on: false }]);
  e.setPrefs({ muted: true });
  e.ptt('down');
  assert.equal(e.tx, false, 'заглушил себя');
  e.ptt('blur');
  e.setPrefs({ muted: false, mode: 'vad' });
  e.vadTick(0.2, 1000);
  assert.equal(e.tx, true, 'голосовая активация');
  e.vadTick(0, 1200);
  assert.equal(e.tx, true, 'держится после тишины');
  e.vadTick(0, 2000);
  assert.equal(e.tx, false);
  // «говорит» и уход
  e.onMessage({ t: 'vc-speak', id: 'b', on: true });
  assert.equal(e.speaking('b'), true);
  e.onMessage({ t: 'vc-leave', id: 'c' });
  assert.equal(pc.closed, true);
  assert.ok(!e.peers.has('c'));
  // переход по уровням: тот же канал, живые соединения остаются, новые — звоним
  e.onMessage({ t: 'vc-peers', ch: 'world', fresh: false, ice: [], peers: [{ id: 'b', name: 'Боб' }, { id: 'd', name: 'Дэйв' }] });
  assert.equal(e.peers.get('b').pc, pb, 'соединение с Бобом не пересоздано');
  assert.ok(e.peers.has('d'));
  // смена канала: заново
  sent.length = 0;
  e.setPrefs({ channel: 'party', party: 'Отряд' });
  assert.equal(pb.closed, true);
  assert.deepEqual(sent.slice(0, 2), [{ t: 'vc', a: 'leave' }, { t: 'vc', a: 'join', ch: 'party:отряд' }]);
  assert.equal(e.peers.size, 0);
  e.onMessage({ t: 'vc-peers', ch: 'party:отряд', fresh: true, ice: [], peers: [{ id: 'b', name: 'Боб' }] });
  // заглушение администратором
  e.onMessage({ t: 'vc-muted', until: null, reason: 'шум', message: 'Голос заглушён администратором бессрочно. Причина: шум.' });
  assert.equal(e.joined, false);
  assert.equal(e.peers.size, 0);
  assert.equal(env.track.stopped, true, 'микрофон отпущен');
  assert.match(e.status(), /заглушён/);
  assert.equal(await e.start(), false);
  e.onMessage({ t: 'vc-unmuted', message: 'ok' });
  assert.equal(e.serverMuted, null);
  // новый движок берёт сохранённые настройки, но в голос сам не входит
  const e2 = new VoiceEngine(env, () => {});
  assert.equal(e2.prefs.channel, 'party');
  assert.equal(e2.prefs.on, false);
});

test('голос, клиент: без микрофона — только слушать; выбор микрофона', async () => {
  const { VoiceEngine, micErrorText } = await load('game/voice.js');
  FakePC.all.length = 0;
  const env = makeEnv({ err: 'NotAllowedError' }), sent = [];
  const e = new VoiceEngine(env, (m) => sent.push(m));
  await e.start();
  assert.equal(e.hasMic, false);
  assert.match(e.micError, /запрещён/);
  assert.deepEqual(sent.pop(), { t: 'vc', a: 'join', ch: 'world' }, 'всё равно входит — слушать');
  e.onMessage({ t: 'vc-peers', ch: 'world', fresh: true, ice: [], peers: [{ id: 'b', name: 'Боб' }] });
  assert.deepEqual(FakePC.all[0].trans, [['audio', { direction: 'recvonly' }]]);
  e.ptt('down');
  assert.equal(e.tx, false);
  assert.match(e.status(), /только слушаете/);
  assert.match(micErrorText({ name: 'NoApi' }), /https/);
  assert.match(micErrorText({ name: 'NotFoundError' }), /не найден/);
  const none = new VoiceEngine(makeEnv({ mic: false }), () => {});
  await none.start();
  assert.match(none.micError, /https или localhost/);
  // выбор микрофона: только устройства ввода звука; новый трек — в соединения
  const env2 = makeEnv();
  const m = new VoiceEngine(env2, () => {});
  assert.deepEqual((await m.devices()).map((d) => d.deviceId), ['m1']);
  await m.start();
  m.onMessage({ t: 'vc-peers', ch: 'world', fresh: true, ice: [], peers: [{ id: 'b', name: 'Боб' }] });
  m.setPrefs({ device: 'm1' });
  await tick(); await tick();
  assert.deepEqual(env2.lastConstraints.audio.deviceId, { exact: 'm1' });
  assert.equal(FakePC.all.at(-1).replaced, env2.track);
});

test('голос, клиент: панель на заглушке DOM, клавиши, значки', async () => {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '', dataset: {}, listeners: {}, cls: new Set(['hidden']), classList: { toggle(c, on) { const s = els[id].cls; if (on === undefined ? !s.has(c) : on) s.add(c); else s.delete(c); }, contains: (c) => els[id].cls.has(c) }, addEventListener(t, f) { this.listeners[t] = f; } });
  globalThis.document = { querySelector: (s) => (s.startsWith('#') ? el(s.slice(1)) : null) };
  const V = await load('game/voice.js');
  const env = makeEnv(), sent = [], toasts = [];
  const hero = { x: 0, y: 0 }, others = new Map([['b', { x: 2, y: 0, name: 'Боб' }]]);
  V.voiceAttach({ send: (m) => sent.push(m), toast: (t) => toasts.push(t), hero: () => hero, others: () => others }, env);
  V.voiceOnWelcome({ vc: { on: true, muted: null } });
  const key = (code, o = {}) => V.voiceKey({ code, preventDefault() {}, ...o });
  assert.equal(key('F4'), true);
  await tick();
  assert.equal(els['voice-window'].cls.has('hidden'), false);
  assert.match(els['voice-body'].innerHTML, /Войти в голос/);
  assert.match(els['voice-body'].innerHTML, /USB/, 'список микрофонов');
  // вход кнопкой
  els['voice-body'].listeners.click({ target: { closest: () => ({ dataset: { act: 'join' } }) } });
  await tick(); await tick();
  assert.deepEqual(sent.find((m) => m.a === 'join'), { t: 'vc', a: 'join', ch: 'world' });
  V.voiceOnMessage({ t: 'vc-peers', ch: 'world', fresh: true, ice: [], peers: [{ id: 'b', name: 'Боб' }] });
  await tick();
  assert.match(els['voice-body'].innerHTML, /Боб/);
  assert.match(els['voice-body'].innerHTML, /Выйти из голоса/);
  // смена клавиши рации
  els['voice-body'].listeners.click({ target: { closest: () => ({ dataset: { act: 'key' } }) } });
  assert.equal(key('Enter'), true);
  assert.match(toasts.at(-1), /нельзя/);
  els['voice-body'].listeners.click({ target: { closest: () => ({ dataset: { act: 'key' } }) } });
  key('KeyB');
  assert.equal(V.voiceEngine().prefs.pttKey, 'KeyB');
  // рация с клавиатуры; Shift+B не перехватывается (приказы и т. п.)
  sent.length = 0;
  assert.equal(key('KeyB'), true);
  assert.deepEqual(sent, [{ t: 'vc', a: 'speak', on: true }]);
  V.voiceTick();
  assert.equal(hero.vc, true, 'значок над своей головой');
  assert.equal(V.voiceKeyUp({ code: 'KeyB' }), true);
  assert.equal(V.voiceEngine().tx, false);
  assert.equal(key('KeyB', { shiftKey: true }), false);
  assert.equal(key('KeyV'), false, 'V теперь свободна');
  key('KeyB');
  V.voiceBlur();
  assert.equal(V.voiceEngine().tx, false, 'потеря фокуса отпускает рацию');
  // «говорит» другой — значок над головой и в списке
  V.voiceOnMessage({ t: 'vc-speak', id: 'b', on: true });
  V.voiceTick();
  assert.equal(others.get('b').vc, true);
  await tick();
  assert.match(els['voice-body'].innerHTML, /🔊/);
  assert.equal(V.voiceSpeaking('b'), true);
  // заглушение администратором — уведомление и кнопка 🔇
  V.voiceOnMessage({ t: 'vc-muted', until: null, reason: null, message: 'Голос заглушён администратором бессрочно.' });
  await tick();
  assert.match(toasts.at(-1), /заглушён/);
  assert.equal(els['btn-voice'].textContent, '🔇');
  assert.equal(key('Escape'), true);
  assert.equal(els['voice-window'].cls.has('hidden'), true);
  assert.match(V.voiceHelp(), /id="h-voice"/);
  delete globalThis.document;
});
