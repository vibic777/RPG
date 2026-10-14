// Голосовой чат на клиенте (шаг 18). Звук — напрямую между браузерами (WebRTC, сетка: каждый с каждым), сервер только
// пересылает сигналы по WebSocket (server/voice.js) и решает, кто с кем может соединиться (один мир и один канал,
// не заглушённые администратором). Здесь:
//  - VoiceEngine — соединения, микрофон, рация / голосовая активация, громкости. Всё внешнее (RTCPeerConnection,
//    getUserMedia, AudioContext, <audio>, localStorage, таймеры) передаётся через env — так движок проверяется в тестах
//    на заглушках без браузера;
//  - панель голоса (F4 или 🎙): настройки и участники; значок 🔊 над головой говорящего; справка.
// Без микрофона или без разрешения — «только слушать»: соединения создаются на приём.
const VV = () => window.Voice;
const STORE_KEY = 'rpg.voice';

// Ошибка getUserMedia → понятная причина
export function micErrorText(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'доступ к микрофону запрещён (разрешите его в настройках сайта)';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'микрофон не найден';
  if (n === 'NotReadableError') return 'микрофон занят другой программой';
  if (n === 'NoApi') return 'браузер не даёт доступа к микрофону (нужен https или localhost)';
  return 'микрофон недоступен';
}

export class VoiceEngine {
  // env: { RTCPeerConnection, getUserMedia(c), enumerateDevices(), AudioContext, makeAudio(), storage, setTimeout, clearTimeout, setInterval, clearInterval, now() }
  constructor(env, send, onChange = () => {}) {
    this.env = env; this.send = send; this.onChange = onChange;
    this.prefs = VV().sanitizePrefs(this.load());
    this.prefs.on = false; // входить в голос — только по действию игрока (браузер всё равно спросит микрофон)
    this.joined = false; this.ch = 'world'; this.ice = []; this.peers = new Map();
    this.stream = null; this.hasMic = false; this.micError = ''; this.serverMuted = null; this.enabled = true;
    this.pttHeld = false; this.vad = { open: false, until: 0 }; this.level = 0; this.tx = false; this.lastError = '';
    this.analyser = null; this.ctx = null; this.vadTimer = null;
  }
  load() { try { return JSON.parse((this.env.storage && this.env.storage.getItem(STORE_KEY)) || 'null'); } catch { return null; } }
  save() { try { if (this.env.storage) this.env.storage.setItem(STORE_KEY, JSON.stringify(this.prefs)); } catch { /* полный localStorage */ } }

  // ----- вход и выход -----
  async start() {
    if (!this.enabled) { this.lastError = 'Голосовой чат отключён на сервере.'; this.onChange(); return false; }
    if (this.serverMuted) { this.lastError = this.serverMuted.message || 'Голос заглушён администратором.'; this.onChange(); return false; }
    this.prefs.on = true;
    await this.openMic();
    this.ch = VV().channelOf(this.prefs);
    this.send({ t: 'vc', a: 'join', ch: this.ch });
    this.onChange();
    return true;
  }
  stop(sendLeave = true) {
    if (sendLeave && this.joined) this.send({ t: 'vc', a: 'leave' });
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.joined = false; this.prefs.on = false; this.pttHeld = false;
    this.closeMic();
    this.setTransmit();
    this.onChange();
  }
  async openMic() {
    this.closeMic();
    const constraints = { audio: this.prefs.device ? { deviceId: { exact: this.prefs.device }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true, noiseSuppression: true }, video: false };
    try {
      if (!this.env.getUserMedia) throw Object.assign(new Error('no api'), { name: 'NoApi' });
      this.stream = await this.env.getUserMedia(constraints);
      this.hasMic = true; this.micError = '';
      for (const t of this.stream.getAudioTracks()) t.enabled = false; // до рации — тишина
      this.startVad();
    } catch (e) {
      this.stream = null; this.hasMic = false; this.micError = micErrorText(e);
    }
    return this.hasMic;
  }
  closeMic() {
    if (this.vadTimer) { this.env.clearInterval(this.vadTimer); this.vadTimer = null; }
    if (this.ctx && this.ctx.close) { try { this.ctx.close(); } catch { /* уже закрыт */ } }
    this.ctx = null; this.analyser = null;
    if (this.stream) for (const t of this.stream.getTracks()) { try { t.stop(); } catch { /* уже остановлен */ } }
    this.stream = null; this.hasMic = false;
  }
  // Голосовая активация: громкость микрофона (RMS) раз в 50 мс
  startVad() {
    if (!this.env.AudioContext || !this.stream) return;
    try {
      this.ctx = new this.env.AudioContext();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      const buf = new Float32Array(this.analyser.fftSize);
      this.vadTimer = this.env.setInterval(() => {
        this.analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        this.vadTick(Math.sqrt(sum / buf.length), this.env.now());
      }, 50);
    } catch { this.analyser = null; }
  }
  vadTick(level, now) {
    this.level = level;
    this.vad = VV().vadStep(this.vad, level, now, this.prefs.vad);
    this.setTransmit();
  }

  // ----- передача -----
  transmitting() {
    return VV().transmitting({ joined: this.joined, hasMic: this.hasMic, muted: this.prefs.muted, serverMuted: Boolean(this.serverMuted), mode: this.prefs.mode, pttHeld: this.pttHeld, vadOpen: this.vad.open });
  }
  setTransmit() {
    const want = this.transmitting();
    if (this.stream) for (const t of this.stream.getAudioTracks()) t.enabled = want;
    if (want === this.tx) return;
    this.tx = want;
    if (this.joined) this.send({ t: 'vc', a: 'speak', on: want });
    this.onChange();
  }
  ptt(ev) { this.pttHeld = VV().pttReduce(this.pttHeld, ev); this.setTransmit(); }

  // ----- соединения -----
  createPeer(id, name, initiator) {
    if (this.peers.has(id)) this.closePeer(id);
    const pc = new this.env.RTCPeerConnection({ iceServers: this.ice });
    const p = { id, name: name || '?', pc, audio: null, speaking: false, gain: 1, pendingIce: [], iceOut: [], iceTimer: null, state: 'new' };
    this.peers.set(id, p);
    if (this.stream) for (const t of this.stream.getAudioTracks()) pc.addTrack(t, this.stream);
    else if (pc.addTransceiver) pc.addTransceiver('audio', { direction: 'recvonly' }); // только слушать
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      p.iceOut.push(e.candidate.toJSON ? e.candidate.toJSON() : { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex });
      if (!p.iceTimer) p.iceTimer = this.env.setTimeout(() => { p.iceTimer = null; const list = p.iceOut.splice(0); if (list.length && this.peers.get(id) === p) this.send({ t: 'vc', a: 'sig', to: id, kind: 'ice', data: list }); }, 100); // пачкой — меньше сообщений
    };
    pc.ontrack = (e) => {
      if (!p.audio) p.audio = this.env.makeAudio();
      p.audio.srcObject = (e.streams && e.streams[0]) || null;
      p.audio.volume = p.gain;
      const r = p.audio.play && p.audio.play();
      if (r && r.catch) r.catch(() => { this.lastError = 'Браузер не дал включить звук — щёлкните по странице.'; this.onChange(); });
    };
    pc.onconnectionstatechange = () => { p.state = pc.connectionState; this.onChange(); };
    if (initiator) this.offer(p);
    this.onChange();
    return p;
  }
  async offer(p) {
    try {
      const o = await p.pc.createOffer();
      await p.pc.setLocalDescription(o);
      this.send({ t: 'vc', a: 'sig', to: p.id, kind: 'offer', data: { type: o.type, sdp: o.sdp } });
    } catch (e) { this.lastError = 'Не удалось начать соединение: ' + (e && e.message); this.onChange(); }
  }
  closePeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    if (p.iceTimer) this.env.clearTimeout(p.iceTimer);
    try { p.pc.close(); } catch { /* уже закрыто */ }
    if (p.audio) { try { p.audio.pause && p.audio.pause(); } catch { /* нет */ } p.audio.srcObject = null; }
    this.onChange();
  }
  async onSig(from, kind, data) {
    let p = this.peers.get(from);
    if (!p && kind === 'offer') p = this.createPeer(from, null, false);
    if (!p) return;
    const pc = p.pc;
    try {
      if (kind === 'offer' || kind === 'answer') {
        await pc.setRemoteDescription(data);
        for (const c of p.pendingIce.splice(0)) await pc.addIceCandidate(c);
        if (kind === 'offer') {
          const a = await pc.createAnswer();
          await pc.setLocalDescription(a);
          this.send({ t: 'vc', a: 'sig', to: from, kind: 'answer', data: { type: a.type, sdp: a.sdp } });
        }
      } else if (kind === 'ice') {
        for (const c of Array.isArray(data) ? data : [data]) {
          if (pc.remoteDescription) await pc.addIceCandidate(c); else p.pendingIce.push(c);
        }
      }
    } catch (e) { this.lastError = 'Ошибка соединения: ' + (e && e.message); this.onChange(); }
  }

  // ----- сообщения сервера -----
  onMessage(m) {
    switch (m.t) {
      case 'vc-peers': {
        // fresh — новый вход в канал: звоним всем заново; иначе (переход по уровням мира) живые соединения остаются
        this.joined = true; this.ice = Array.isArray(m.ice) ? m.ice : []; this.ch = m.ch; this.lastError = '';
        const ids = new Set((m.peers || []).map((x) => x.id));
        for (const id of [...this.peers.keys()]) if (m.fresh !== false || !ids.has(id)) this.closePeer(id);
        for (const peer of m.peers || []) if (!this.peers.has(peer.id)) this.createPeer(peer.id, peer.name, true); // новичок звонит всем
        this.setTransmit();
        break;
      }
      case 'vc-join': if (this.joined) this.createPeer(m.peer.id, m.peer.name, false); break;
      case 'vc-leave': this.closePeer(m.id); break;
      case 'vc-sig': if (this.joined) return this.onSig(m.from, m.kind, m.data); break;
      case 'vc-speak': { const p = this.peers.get(m.id); if (p) { p.speaking = Boolean(m.on); this.onChange(); } break; }
      case 'vc-muted':
        this.serverMuted = { until: m.until, reason: m.reason, message: m.message };
        this.lastError = m.message || 'Голос заглушён администратором.';
        this.stop(false);
        break;
      case 'vc-unmuted': this.serverMuted = null; this.lastError = ''; this.onChange(); break;
      case 'vc-reject': this.lastError = m.message; if (!this.joined) this.prefs.on = false; this.onChange(); break;
      default: return false;
    }
    return true;
  }

  // ----- громкости -----
  // pos(id) → { x, y } игрока на этом же уровне или null (другой уровень мира); self — { x, y } героя
  updateGains(self, pos) {
    for (const p of this.peers.values()) {
      const q = pos(p.id);
      const dist = q && self ? Math.hypot(q.x - self.x, q.y - self.y) : Infinity;
      p.gain = VV().peerGain(this.prefs, p.id, dist, Boolean(q));
      if (p.audio) p.audio.volume = p.gain;
    }
  }
  setPrefs(patch) {
    const before = this.prefs;
    this.prefs = VV().sanitizePrefs({ ...before, ...patch });
    this.save();
    if (this.joined && VV().channelOf(this.prefs) !== this.ch) { // другой канал: заново
      for (const id of [...this.peers.keys()]) this.closePeer(id);
      this.joined = false;
      this.ch = VV().channelOf(this.prefs);
      this.send({ t: 'vc', a: 'leave' });
      this.send({ t: 'vc', a: 'join', ch: this.ch });
    }
    if (this.prefs.on && before.device !== this.prefs.device) this.switchMic();
    this.setTransmit();
    this.onChange();
  }
  setPeer(id, patch) {
    const cur = this.prefs.peers[id] || { vol: 1, mute: false };
    this.setPrefs({ peers: { ...this.prefs.peers, [id]: { ...cur, ...patch } } });
  }
  async switchMic() {
    await this.openMic();
    const track = this.stream && this.stream.getAudioTracks()[0];
    for (const p of this.peers.values()) {
      const sender = p.pc.getSenders ? p.pc.getSenders().find((s) => s.track || s.kind === 'audio') : null;
      if (sender && sender.replaceTrack) await sender.replaceTrack(track || null);
      else if (track && !sender) { p.pc.addTrack(track, this.stream); this.offer(p); }
    }
    this.setTransmit();
    this.onChange();
  }
  async devices() {
    try { return (await this.env.enumerateDevices()).filter((d) => d.kind === 'audioinput'); } catch { return []; }
  }
  speaking(id) { const p = this.peers.get(id); return Boolean(p && p.speaking); }
  status() {
    if (!this.enabled) return 'Голосовой чат отключён на сервере.';
    if (this.serverMuted) return '🔇 ' + (this.serverMuted.message || 'Голос заглушён администратором.');
    if (!this.joined) return this.prefs.on ? 'Подключение…' : 'Вы не в голосовом чате.';
    const where = this.ch === 'world' ? 'весь мир' : 'группа «' + this.ch.slice(6) + '»';
    const mic = this.hasMic ? (this.prefs.muted ? 'микрофон выключен' : this.tx ? '🎙 говорите' : this.prefs.mode === 'ptt' ? 'рация: зажмите ' + VV().keyLabel(this.prefs.pttKey) : 'голосовая активация') : 'только слушаете: ' + this.micError;
    return `Канал: ${where} · участников: ${this.peers.size + 1} · ${mic}`;
  }
}

// ---------- Окружение браузера ----------
export function browserEnv() {
  const md = typeof navigator !== 'undefined' && navigator.mediaDevices;
  return {
    RTCPeerConnection: window.RTCPeerConnection,
    getUserMedia: md && md.getUserMedia ? (c) => md.getUserMedia(c) : null,
    enumerateDevices: md && md.enumerateDevices ? () => md.enumerateDevices() : async () => [],
    AudioContext: window.AudioContext || window.webkitAudioContext,
    makeAudio: () => { const a = new Audio(); a.autoplay = true; return a; },
    storage: window.localStorage,
    setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t),
    setInterval: (f, ms) => setInterval(f, ms), clearInterval: (t) => clearInterval(t),
    now: () => performance.now(),
  };
}

// ---------- Панель голоса и клавиши ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let api = null; // { send, toast, hero(), others() }
let eng = null;
const ui = { open: false, capture: false, devs: [], gainTimer: null, renderQueued: false };

export function voiceEngine() { return eng; }
export function voiceAttach(a, env = null) {
  api = a;
  if (!eng) {
    eng = new VoiceEngine(env || browserEnv(), (m) => api.send(m), queueRender);
    if (!eng.env.RTCPeerConnection) { eng.enabled = false; eng.lastError = 'Браузер не поддерживает WebRTC — голосовой чат недоступен.'; }
  }
  const b = $('#btn-voice');
  if (b && !b.dataset.bound) { b.dataset.bound = '1'; b.addEventListener('click', () => voiceToggle()); }
  const x = $('#btn-voice-close');
  if (x && !x.dataset.bound) { x.dataset.bound = '1'; x.addEventListener('click', () => voiceToggle(false)); }
  const body = $('#voice-body');
  if (body && !body.dataset.bound) { body.dataset.bound = '1'; body.addEventListener('change', onPanelChange); body.addEventListener('input', onPanelInput); body.addEventListener('click', onPanelClick); }
  if (!ui.gainTimer) ui.gainTimer = eng.env.setInterval(voiceTick, 200);
}
export function voiceOnWelcome(msg) {
  if (!eng) return;
  const vc = msg.vc || { on: false };
  eng.enabled = Boolean(vc.on) && Boolean(eng.env.RTCPeerConnection);
  eng.serverMuted = vc.muted || null;
  if ((!eng.enabled || eng.serverMuted) && (eng.joined || eng.prefs.on)) eng.stop(false);
  // переход на другой уровень или переподключение: повторить вход в тот же канал — сервер ответит, новый ли это вход
  else if (eng.joined) eng.send({ t: 'vc', a: 'join', ch: eng.ch });
  else if (eng.prefs.on) eng.start();
  render();
}
export function voiceOnMessage(msg) {
  if (!eng) return false;
  const r = eng.onMessage(msg);
  if (msg.t === 'vc-muted') api.toast('🔇 ' + (msg.message || 'Голос заглушён администратором.'), 5000);
  if (msg.t === 'vc-unmuted') api.toast('🎙 ' + msg.message, 3000);
  if (msg.t === 'vc-reject') api.toast(msg.message, 3500);
  return r;
}
export function voiceLeaveWorld() { if (eng) eng.stop(false); } // сервер сам убирает ушедшего из канала
export const voiceIsOpen = () => ui.open;
export function voiceToggle(on = !ui.open) {
  ui.open = on;
  const w = $('#voice-window');
  if (w) w.classList.toggle('hidden', !on);
  if (on && eng) eng.devices().then((d) => { ui.devs = d; render(); });
  render();
}
// Нажатие клавиши: F4 — панель; захват новой клавиши рации; сама рация (без Shift/Ctrl/Alt — Shift+V остаётся приказом спутникам)
export function voiceKey(e) {
  if (!eng) return false;
  if (ui.capture) {
    e.preventDefault();
    ui.capture = false;
    if (e.code !== 'Escape') {
      if (VV().validKey(e.code)) { eng.setPrefs({ pttKey: e.code }); api.toast('Клавиша рации: ' + VV().keyLabel(e.code), 2000); } else api.toast('Эту клавишу нельзя назначить рации.', 2500);
    }
    render();
    return true;
  }
  if (e.code === 'Escape' && ui.open) { e.preventDefault(); voiceToggle(false); return true; }
  if (e.code === 'Escape') return false;
  if (e.code === 'F4') { e.preventDefault(); voiceToggle(); return true; }
  const mod = /^(Shift|Control|Alt)/.test(eng.prefs.pttKey);
  if (eng.joined && eng.prefs.mode === 'ptt' && e.code === eng.prefs.pttKey && (mod || (!e.shiftKey && !e.ctrlKey && !e.altKey))) {
    e.preventDefault();
    if (!e.repeat) eng.ptt('down');
    return true;
  }
  return false;
}
export function voiceKeyUp(e) { if (eng && e.code === eng.prefs.pttKey && eng.pttHeld) { eng.ptt('up'); return true; } return false; }
export function voiceBlur() { if (eng && eng.pttHeld) eng.ptt('blur'); }
// Громкость по расстоянию и значки 🔊 над головами (каждые 200 мс)
export function voiceTick() {
  if (!eng || !api) return;
  const others = api.others ? api.others() : new Map();
  const hero = api.hero ? api.hero() : null;
  eng.updateGains(hero, (id) => { const o = others.get(id); return o ? { x: o.x, y: o.y } : null; });
  for (const [id, o] of others) o.vc = eng.speaking(id);
  if (hero) hero.vc = eng.tx;
}
export const voiceSpeaking = (id) => Boolean(eng && eng.speaking(id));

function queueRender() { if (ui.renderQueued) return; ui.renderQueued = true; Promise.resolve().then(() => { ui.renderQueued = false; render(); }); }
function badge() {
  const b = $('#btn-voice');
  if (!b || !eng) return;
  b.classList.toggle('on', eng.joined);
  b.textContent = eng.serverMuted ? '🔇' : eng.tx ? '🔊' : '🎙';
}
function render() {
  badge();
  const el = $('#voice-body');
  if (!el || !eng || !ui.open) return;
  const s = VV().settings, p = eng.prefs;
  const can = eng.enabled && !eng.serverMuted;
  const rows = [...eng.peers.values()].map((x) => {
    const pp = p.peers[x.id] || { vol: 1, mute: false };
    return `<tr data-id="${esc(x.id)}"><td>${x.speaking ? '🔊' : '·'}</td><td title="Состояние соединения: ${esc(x.state)}">${esc(x.name)}</td>
      <td><label title="Не слышать этого игрока (только у вас)"><input type="checkbox" data-peer-mute ${pp.mute ? 'checked' : ''}> заглушить</label></td>
      <td><input type="range" min="0" max="100" value="${Math.round(pp.vol * 100)}" data-peer-vol title="Громкость этого игрока (только у вас)"></td>
      <td class="muted" title="Слышно сейчас (с учётом расстояния)">${Math.round(x.gain * 100)}%</td></tr>`;
  }).join('');
  const devs = ['<option value="">Микрофон по умолчанию</option>', ...ui.devs.map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === p.device ? 'selected' : ''}>${esc(d.label || 'Микрофон ' + (i + 1))}</option>`)].join('');
  el.innerHTML = `
    <div class="vc-status ${eng.serverMuted ? 'bad' : ''}">${esc(eng.status())}</div>
    ${eng.lastError && eng.lastError !== (eng.serverMuted && eng.serverMuted.message) ? `<div class="bad">${esc(eng.lastError)}</div>` : ''}
    <div class="vc-row">${eng.prefs.on || eng.joined
    ? '<button type="button" class="btn" data-act="leave" title="Выйти из голосового чата: соединения закрываются, микрофон отпускается">Выйти из голоса</button>'
    : `<button type="button" class="btn primary" data-act="join" ${can ? '' : 'disabled'} title="Войти в голосовой чат: браузер спросит разрешение на микрофон. Без микрофона можно только слушать">Войти в голос</button>`}
      <label title="Выключить свой микрофон (вас не слышно, вы слышите всех)"><input type="checkbox" data-pref="muted" ${p.muted ? 'checked' : ''}> заглушить себя</label></div>
    <div class="vc-row"><label title="Рация — говорить, пока зажата клавиша; голосовая активация — передача, когда микрофон громче порога">Режим
      <select data-pref="mode">${Object.entries(VV().MODES).map(([k, v]) => `<option value="${k}" ${p.mode === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label></div>
    <div class="vc-row">${p.mode === 'ptt'
    ? `Клавиша рации: <b>${esc(VV().keyLabel(p.pttKey))}</b> <button type="button" class="btn small" data-act="key" title="Нажмите, затем нужную клавишу (Esc — отмена)">${ui.capture ? 'Нажмите клавишу…' : 'Сменить'}</button>`
    : `<label title="Чем меньше порог, тем тише голос, который включает передачу">Порог <input type="range" min="1" max="30" value="${Math.round(p.vad * 100)}" data-pref="vad"></label> <span class="muted" title="Громкость микрофона сейчас">${eng.hasMic ? 'уровень ' + Math.round(eng.level * 100) : ''}</span>`}</div>
    <div class="vc-row"><label title="Весь мир — все игроки мира, кто в голосе; группа — только те, кто ввёл тот же код">Канал
      <select data-pref="channel"><option value="world" ${p.channel === 'world' ? 'selected' : ''}>весь мир</option><option value="party" ${p.channel === 'party' ? 'selected' : ''}>группа по коду</option></select></label>
      <input type="text" maxlength="16" placeholder="код группы" value="${esc(p.party)}" data-pref="party" title="Код группы: буквы, цифры, «-» и «_», до 16 знаков"></div>
    <div class="vc-row"><label title="Рядом — громкость по расстоянию: полная до ${s.voiceProximityFull} клеток, тишина дальше ${s.voiceProximityRadius}; на другом уровне мира не слышно. Иначе слышно весь канал одинаково"><input type="checkbox" data-pref="proximity" ${p.proximity ? 'checked' : ''}> громкость по расстоянию</label>
      <label title="Общая громкость голосов">Громкость <input type="range" min="0" max="100" value="${Math.round(p.volume * 100)}" data-pref="volume"></label></div>
    <div class="vc-row"><label title="Какой микрофон использовать (названия видны после разрешения доступа)">Микрофон <select data-pref="device">${devs}</select></label></div>
    <h3>Участники</h3>
    ${rows ? `<table class="vc-peers">${rows}</table>` : '<div class="muted">Пока никого — в голосе только вы.</div>'}
    <div class="muted">F4 — эта панель · ${esc(VV().keyLabel(p.pttKey))} — рация · Shift+V — приказ спутникам, пока включена рация на V</div>`;
}
function readPref(t) {
  const k = t.dataset.pref;
  if (t.type === 'checkbox') return { [k]: t.checked };
  if (t.type === 'range') return { [k]: Number(t.value) / 100 };
  return { [k]: t.value };
}
function onPanelChange(e) {
  const t = e.target;
  if (t.dataset.pref) { eng.setPrefs(readPref(t)); render(); return; }
  const tr = t.closest('tr[data-id]');
  if (tr && t.hasAttribute('data-peer-mute')) { eng.setPeer(tr.dataset.id, { mute: t.checked }); render(); }
}
function onPanelInput(e) {
  const t = e.target;
  if (t.type !== 'range') return;
  if (t.dataset.pref) eng.setPrefs(readPref(t)); // без перерисовки — ползунок не прыгает
  const tr = t.closest('tr[data-id]');
  if (tr && t.hasAttribute('data-peer-vol')) eng.setPeer(tr.dataset.id, { vol: Number(t.value) / 100 });
}
function onPanelClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  if (b.dataset.act === 'join') eng.start().then(() => { if (!eng.hasMic) api.toast('Без микрофона: ' + eng.micError + '. Вы только слушаете.', 5000); render(); });
  else if (b.dataset.act === 'leave') eng.stop(true);
  else if (b.dataset.act === 'key') { ui.capture = true; render(); }
  render();
}

// Раздел справки
export function voiceHelp() {
  if (!VV()) return '';
  const s = VV().settings;
  return `<h3 id="h-voice">Голосовой чат</h3>
  <ul>
    <li><b>Панель голоса</b> — <b>F4</b> или кнопка 🎙. «Войти в голос» — браузер спросит доступ к микрофону. Голос идёт напрямую между браузерами (WebRTC), сервер только соединяет игроков <b>одного мира</b>; в канале до ${s.voiceMaxPeers} игроков.</li>
    <li><b>Рация</b> (по умолчанию): говорите, пока зажата клавиша <b>${VV().keyLabel(s.voicePttKey)}</b> — её можно сменить в панели. Пока рация на V, приказ всем спутникам — <b>Shift+V</b>. <b>Голосовая активация</b> — передача включается сама, когда микрофон громче порога.</li>
    <li><b>Заглушить себя</b> — вас не слышно; <b>громкость и заглушение каждого игрока</b> — в списке участников (только у вас).</li>
    <li><b>Каналы:</b> «весь мир» или «группа по коду» — слышат только те, кто ввёл тот же код. <b>Громкость по расстоянию:</b> полная до ${s.voiceProximityFull} клеток, тишина дальше ${s.voiceProximityRadius}, на другом уровне мира не слышно; без неё весь канал слышно одинаково.</li>
    <li>Говорящий отмечен <b>🔊</b> над головой и в списке участников; ваша кнопка 🎙 становится 🔊, пока вы в эфире.</li>
    <li><b>Нет микрофона или доступ запрещён</b> — можно только слушать. Можно выбрать другой микрофон в панели.</li>
    <li>Администратор может <b>заглушить голос</b> игрока (на время или бессрочно): сервер больше не соединяет его ни с кем. Заблокированный игрок выходит и из голоса.</li>
  </ul>`;
}
