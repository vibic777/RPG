// Голосовой чат (шаг 18): общие правила сервера и клиента. Голос идёт напрямую между браузерами (WebRTC, сетка до
// game.voiceMaxPeers участников), сервер только пересылает сигналы (offer/answer/ICE) по уже открытому WebSocket.
// Здесь — ДАННЫЕ и чистые расчёты: настройки игрока (рация / голосовая активация, клавиша, канал, громкости, микрофон)
// с очисткой, громкость по расстоянию, логика рации и голосовой активации, имя канала, список ICE-серверов.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Voice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const settings = {
    voiceEnabled: true, // голосовой чат включён
    voiceMaxPeers: 8, // сколько игроков может быть в одном голосовом канале (сетка: каждый соединён с каждым)
    voiceProximityRadius: 24, // режим «рядом»: дальше стольких клеток игрока не слышно
    voiceProximityFull: 4, // режим «рядом»: ближе стольких клеток — полная громкость
    voiceDefaultMode: 'ptt', // режим по умолчанию: ptt — рация (говорить, пока зажата клавиша), vad — голосовая активация
    voicePttKey: 'KeyV', // клавиша рации по умолчанию (код клавиши KeyboardEvent.code)
    voiceStunUrls: '', // STUN-серверы через запятую (пусто — без них: работает в локальной сети)
    voiceMaxSigKb: 16, // наибольший размер одного сигнала (описание соединения или ICE-кандидат), КБ
    voiceVadThreshold: 0.05, // порог голосовой активации по умолчанию (громкость микрофона 0…1)
    voiceVadHangMs: 400, // голосовая активация: держать передачу ещё столько мс после тишины
    voiceMuteDefaultMin: 60, // заглушение голоса администратором по умолчанию, минут (0 — бессрочно)
  };
  function configure(game) {
    for (const k of Object.keys(settings)) if (game && game[k] !== undefined) settings[k] = game[k];
  }

  const MODES = { ptt: 'Рация (говорить, пока зажата клавиша)', vad: 'Голосовая активация (по громкости)' };
  const PEER_LIMIT = 64; // сколько записей «громкость игрока» хранить
  const KEY_RE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-2])|Backquote|CapsLock|Tab|AltLeft|AltRight|ControlLeft|ControlRight|ShiftLeft|ShiftRight|Backslash|BracketLeft|BracketRight|Semicolon|Quote|Comma|Period|Slash|Minus|Equal)$/;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  // Код группы: буквы, цифры, «_» и «-», до 16 знаков, без учёта регистра; иначе пусто
  function partyCode(s) {
    const t = String(s == null ? '' : s).trim().toLowerCase();
    return /^[a-z0-9а-яё_-]{1,16}$/.test(t) ? t : '';
  }
  // Имя канала: «world» (все в мире) или «party:<код>» (только знающие код)
  function normChannel(ch) {
    const s = String(ch == null ? '' : ch);
    if (s.startsWith('party:')) { const c = partyCode(s.slice(6)); return c ? 'party:' + c : 'world'; }
    return 'world';
  }
  function channelOf(prefs) { return prefs && prefs.channel === 'party' && partyCode(prefs.party) ? 'party:' + partyCode(prefs.party) : 'world'; }
  const validKey = (k) => typeof k === 'string' && KEY_RE.test(k);
  function keyLabel(code) {
    const s = String(code || '');
    if (/^Key[A-Z]$/.test(s)) return s.slice(3);
    if (/^Digit[0-9]$/.test(s)) return s.slice(5);
    if (/^Numpad[0-9]$/.test(s)) return 'Num ' + s.slice(6);
    return { Backquote: '`', CapsLock: 'Caps Lock', AltLeft: 'левый Alt', AltRight: 'правый Alt', ControlLeft: 'левый Ctrl', ControlRight: 'правый Ctrl', ShiftLeft: 'левый Shift', ShiftRight: 'правый Shift' }[s] || s;
  }

  function defaults() {
    return { on: false, mode: settings.voiceDefaultMode === 'vad' ? 'vad' : 'ptt', pttKey: validKey(settings.voicePttKey) ? settings.voicePttKey : 'KeyV', muted: false, proximity: true, channel: 'world', party: '', volume: 1, vad: clamp(num(settings.voiceVadThreshold, 0.05), 0.005, 0.5), device: '', peers: {} };
  }
  // Очистка настроек игрока (из localStorage или из панели): всё лишнее и неверное — к значениям по умолчанию
  function sanitizePrefs(raw) {
    const d = defaults(), r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = {
      on: r.on === true,
      mode: MODES[r.mode] ? r.mode : d.mode,
      pttKey: validKey(r.pttKey) ? r.pttKey : d.pttKey,
      muted: r.muted === true,
      proximity: typeof r.proximity === 'boolean' ? r.proximity : d.proximity,
      channel: r.channel === 'party' ? 'party' : 'world',
      party: partyCode(r.party),
      volume: clamp(num(r.volume, d.volume), 0, 1),
      vad: clamp(num(r.vad, d.vad), 0.005, 0.5),
      device: typeof r.device === 'string' ? r.device.slice(0, 200) : '',
      peers: {},
    };
    if (out.channel === 'party' && !out.party) out.channel = 'world';
    const peers = r.peers && typeof r.peers === 'object' && !Array.isArray(r.peers) ? r.peers : {};
    for (const id of Object.keys(peers).slice(0, PEER_LIMIT)) {
      const p = peers[id];
      if (!id || id.length > 64 || !p || typeof p !== 'object') continue;
      const vol = clamp(num(p.vol, 1), 0, 1), mute = p.mute === true;
      if (vol !== 1 || mute) out.peers[id] = { vol, mute };
    }
    return out;
  }

  // Громкость по расстоянию: полная до voiceProximityFull, линейно затухает до нуля к voiceProximityRadius
  function proximityGain(dist, radius = settings.voiceProximityRadius, full = settings.voiceProximityFull) {
    if (typeof dist !== 'number' || !Number.isFinite(dist) || dist < 0) return 0;
    const R = Math.max(0, num(radius, 0)), F = clamp(num(full, 0), 0, R);
    if (dist <= F) return 1;
    if (dist >= R) return 0;
    return clamp(1 - (dist - F) / (R - F), 0, 1);
  }
  // Итоговая громкость собеседника: заглушён → 0; режим «рядом» — по расстоянию (другой уровень мира — не слышно);
  // × громкость игрока × общая громкость
  function peerGain(prefs, peerId, dist, sameLevel = true) {
    const p = prefs || defaults(), per = (p.peers && p.peers[peerId]) || { vol: 1, mute: false };
    if (per.mute) return 0;
    const base = p.proximity ? (sameLevel ? proximityGain(dist) : 0) : 1;
    return clamp(base * clamp(num(per.vol, 1), 0, 1) * clamp(num(p.volume, 1), 0, 1), 0, 1);
  }

  // Рация: состояние «клавиша зажата». Повтор клавиши ничего не меняет, потеря фокуса окна отпускает рацию
  function pttReduce(held, ev) {
    switch (ev) {
      case 'down': return true;
      case 'up': case 'blur': case 'leave': return false;
      default: return Boolean(held);
    }
  }
  // Голосовая активация: громче порога — передача открыта; после тишины держится ещё voiceVadHangMs
  function vadStep(state, level, now, threshold, hangMs = settings.voiceVadHangMs) {
    const s = state || { open: false, until: 0 };
    if (num(level, 0) >= threshold) return { open: true, until: now + hangMs };
    if (s.open && now < s.until) return { open: true, until: s.until };
    return { open: false, until: 0 };
  }
  // Идёт ли передача голоса сейчас
  function transmitting(o) {
    if (!o || !o.joined || !o.hasMic || o.muted || o.serverMuted) return false;
    return o.mode === 'vad' ? Boolean(o.vadOpen) : Boolean(o.pttHeld);
  }

  // Список ICE-серверов для RTCPeerConnection: STUN из настроек + TURN (адрес, имя, пароль), только верные адреса
  function iceServers(stunCsv, turnUrl, turnUser, turnPass) {
    const out = [];
    const urls = String(stunCsv || '').split(',').map((s) => s.trim()).filter((u) => /^stuns?:[^\s]+$/.test(u)).slice(0, 8);
    if (urls.length) out.push({ urls });
    const t = String(turnUrl || '').trim();
    if (/^turns?:[^\s]+$/.test(t)) out.push({ urls: [t], username: String(turnUser || ''), credential: String(turnPass || '') });
    return out;
  }

  return { settings, configure, MODES, partyCode, normChannel, channelOf, validKey, keyLabel, defaults, sanitizePrefs, proximityGain, peerGain, pttReduce, vadStep, transmitting, iceServers };
});
