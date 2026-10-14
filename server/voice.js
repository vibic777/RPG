'use strict';
// Голосовой чат на сервере (шаг 18): только сигналинг WebRTC через уже открытый WebSocket. Звук идёт напрямую между
// браузерами (сетка: каждый соединён с каждым, до game.voiceMaxPeers в канале). Сервер решает, КТО с кем может
// соединиться: только игроки одного мира и одного канала («world» — весь мир, «party:<код>» — группа по коду),
// не заглушённые администратором и не заблокированные. Переход между уровнями мира голос не рвёт.
// Сообщения клиента: { t: 'vc', a: 'join', ch } | { a: 'leave' } | { a: 'sig', to, kind: offer|answer|ice, data } | { a: 'speak', on }
// Ответы: vc-peers (вошёл: участники и ICE-серверы), vc-join / vc-leave (другие), vc-sig (сигнал от участника),
// vc-speak (говорит / замолчал), vc-muted / vc-unmuted (решение администратора), vc-reject (отказ с причиной).
const realtime = require('./realtime');
const auth = require('./auth');
const config = require('./config');
const V = require('../shared/voice');

const chans = new Map(); // worldId → Map(accountId → { ch, speak, at })
const log = []; // последние события голоса для панели ГМ
const LOG_MAX = 100;
const KINDS = new Set(['offer', 'answer', 'ice']);
const on = () => V.settings.voiceEnabled;
const wid = (c) => (c && c.room ? c.room.worldId || c.room.id : null);
const note = (ev, c, extra = {}) => {
  log.push({ at: Date.now(), ev, username: c ? c.account.username : null, name: c ? c.character.name : null, ...extra });
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
};
const reject = (c, message) => { realtime.send(c, { t: 'vc-reject', message }); return message; };

function memberOf(c) { const m = chans.get(wid(c)); return m ? m.get(c.account.id) || null : null; }
// Участники канала ch в мире worldId (только те, кто сейчас в этом мире)
function inChannel(worldId, ch) {
  const m = chans.get(worldId), out = [];
  if (!m) return out;
  for (const [id, rec] of m) {
    if (rec.ch !== ch) continue;
    const c = realtime.byAccount.get(id);
    if (c && wid(c) === worldId) out.push(c);
  }
  return out;
}
const pub = (c) => ({ id: c.account.id, name: c.character.name, account: c.account.username });
function ice() { const cfg = config.get(); return V.iceServers(V.settings.voiceStunUrls, cfg.voiceTurnUrl, cfg.voiceTurnUser, cfg.voiceTurnPass); }

function join(c, msg) {
  if (!on()) return reject(c, 'Голосовой чат отключён на сервере.');
  if (auth.isBanned(c.account)) return reject(c, 'Аккаунт заблокирован.');
  if (auth.isVoiceMuted(c.account)) { mutedNotice(c); note('reject-muted', c); return 'muted'; }
  const worldId = wid(c);
  const ch = V.normChannel(msg.ch);
  const cur = memberOf(c);
  if (cur && cur.ch !== ch) leave(c, 'channel');
  const others = inChannel(worldId, ch).filter((x) => x !== c);
  if (!memberOf(c) && others.length >= V.settings.voiceMaxPeers) return reject(c, `Голосовой канал полон (${V.settings.voiceMaxPeers} игроков).`);
  if (!chans.has(worldId)) chans.set(worldId, new Map());
  const fresh = !memberOf(c);
  chans.get(worldId).set(c.account.id, { ch, speak: false, at: Date.now() });
  realtime.send(c, { t: 'vc-peers', ch, fresh, ice: ice(), peers: others.map(pub), max: V.settings.voiceMaxPeers });
  if (fresh) {
    for (const o of others) realtime.send(o, { t: 'vc-join', ch, peer: pub(c) });
    note('join', c, { ch });
  }
  return null;
}
function leave(c, why = 'leave') {
  const worldId = wid(c) || c.vcWorld;
  const m = chans.get(worldId);
  const rec = m && m.get(c.account.id);
  if (!rec) return null;
  m.delete(c.account.id);
  if (!m.size) chans.delete(worldId);
  for (const o of inChannel(worldId, rec.ch)) realtime.send(o, { t: 'vc-leave', id: c.account.id, why });
  note('leave', c, { ch: rec.ch, why });
  return null;
}
function sig(c, msg) {
  const me = memberOf(c);
  if (!me) return reject(c, 'Сначала войдите в голосовой канал.');
  if (auth.isVoiceMuted(c.account)) { leave(c, 'muted'); mutedNotice(c); return 'muted'; }
  if (!KINDS.has(msg.kind)) return reject(c, 'Неизвестный сигнал.');
  const to = typeof msg.to === 'string' ? realtime.byAccount.get(msg.to) : null;
  const them = to && wid(to) === wid(c) ? memberOf(to) : null;
  if (!them || them.ch !== me.ch || to === c) { note('reject-route', c, { to: String(msg.to || '').slice(0, 40) }); return reject(c, 'Этот игрок не в вашем голосовом канале.'); }
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(msg.data === undefined ? null : msg.data)); } catch { size = Infinity; }
  if (size > V.settings.voiceMaxSigKb * 1024) return reject(c, 'Слишком большой сигнал.');
  realtime.send(to, { t: 'vc-sig', from: c.account.id, kind: msg.kind, data: msg.data });
  return null;
}
function speak(c, msg) {
  const me = memberOf(c);
  if (!me) return null;
  const v = Boolean(msg.on) && !auth.isVoiceMuted(c.account);
  if (me.speak === v) return null;
  me.speak = v;
  for (const o of inChannel(wid(c), me.ch)) if (o !== c) realtime.send(o, { t: 'vc-speak', id: c.account.id, on: v });
  return null;
}
function mutedNotice(c) {
  const a = c.account;
  realtime.send(c, { t: 'vc-muted', until: a.voiceMutedUntil ?? null, reason: a.voiceMuteReason ?? null, message: auth.voiceMuteMessage(a) });
}

// Решения администратора: заглушить — выкинуть из канала (соседи закрывают соединения), вернуть — сообщить
auth.events.on('voice-mute', (a) => {
  const c = realtime.byAccount.get(a.id);
  if (!c) return;
  leave(c, 'muted');
  mutedNotice(c);
});
auth.events.on('voice-unmute', (a) => {
  const c = realtime.byAccount.get(a.id);
  if (c) realtime.send(c, { t: 'vc-unmuted', message: 'Администратор вернул вам голос.' });
});

// Панель ГМ: каналы по мирам, заглушённые аккаунты, последние события
function adminList() {
  const channels = [];
  for (const [worldId, m] of chans) {
    const by = new Map();
    for (const [id, rec] of m) {
      const c = realtime.byAccount.get(id);
      if (!c || wid(c) !== worldId) continue;
      if (!by.has(rec.ch)) by.set(rec.ch, []);
      by.get(rec.ch).push({ ...pub(c), speak: rec.speak, since: rec.at });
    }
    const room = realtime.worldRooms(worldId)[0];
    for (const [ch, members] of by) channels.push({ worldId, world: room && room.world ? room.world.name : worldId, ch, members });
  }
  const muted = auth.listAccounts().filter((a) => a.voiceMuted).map((a) => ({ username: a.username, until: a.voiceMutedUntil, reason: a.voiceMuteReason }));
  return { enabled: on(), maxPeers: V.settings.voiceMaxPeers, channels, muted, log: log.slice(-50).reverse() };
}

realtime.use({
  welcome: (room, c) => ({ vc: { on: on(), muted: auth.isVoiceMuted(c.account) ? { until: c.account.voiceMutedUntil ?? null, reason: c.account.voiceMuteReason ?? null, message: auth.voiceMuteMessage(c.account) } : null } }),
  beforeLeave: (room, c) => { c.vcWorld = room.worldId || room.id; },
  onLeave: (room, c, reason) => { if (reason !== 'level') leave(c, reason === 'banned' ? 'banned' : 'left'); },
  handlers: {
    vc: (c, m) => {
      const msg = m && typeof m === 'object' ? m : {};
      if (!c.room) return;
      switch (msg.a) {
        case 'join': return join(c, msg);
        case 'leave': return leave(c, 'leave');
        case 'sig': return sig(c, msg);
        case 'speak': return speak(c, msg);
        default: return reject(c, 'Неизвестное действие голоса.');
      }
    },
  },
});

module.exports = { adminList, inChannel, memberOf, chans };
