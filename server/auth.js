'use strict';
// Аккаунты, пароли (scrypt + соль), сессии, баны.
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { accounts, sessions, appendLog } = require('./store');
const config = require('./config');

const SCRYPT_KEYLEN = 64; // параметр алгоритма, не настройка: смена сломает сохранённые пароли

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt)).toString('hex');
  return { salt, hash };
}

async function verifyPassword(password, salt, hash) {
  const key = await scrypt(password, salt);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(key, expected);
}

const keyOf = (username) => String(username).toLowerCase();
const tokenId = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function publicAccount(a) {
  return {
    id: a.id,
    username: a.username,
    role: a.role,
    createdAt: a.createdAt,
    banned: isBanned(a),
    bannedUntil: a.bannedUntil ?? null,
    banReason: a.banReason ?? null,
    voiceMuted: isVoiceMuted(a),
    voiceMutedUntil: isVoiceMuted(a) ? a.voiceMutedUntil ?? null : null,
    voiceMuteReason: isVoiceMuted(a) ? a.voiceMuteReason ?? null : null,
  };
}

// ---------- Баны ----------

function isBanned(a, now = Date.now()) {
  if (!a.banned) return false;
  return a.bannedUntil == null || now < a.bannedUntil;
}

// «2 д 3 ч», «5 ч 10 мин», «3 мин»
function formatDuration(ms) {
  let m = Math.max(1, Math.ceil(ms / 60000));
  const d = Math.floor(m / 1440); m -= d * 1440;
  const h = Math.floor(m / 60); m -= h * 60;
  const parts = [];
  if (d) parts.push(d + ' д');
  if (h) parts.push(h + ' ч');
  if (m && !d) parts.push(m + ' мин');
  return parts.join(' ');
}

function banMessage(a) {
  const reason = a.banReason ? `Причина: ${a.banReason}.` : 'Причина не указана.';
  if (a.bannedUntil == null) return `Аккаунт заблокирован бессрочно. ${reason}`;
  return `Аккаунт заблокирован. ${reason} До разблокировки: ${formatDuration(a.bannedUntil - Date.now())}.`;
}

// Снимает истёкший бан. Возвращает true, если аккаунт изменён.
function clearExpiredBan(a) {
  if (a.banned && !isBanned(a)) {
    a.banned = false;
    a.bannedUntil = null;
    a.banReason = null;
    return true;
  }
  return false;
}

// ---------- Регистрация / вход ----------

function validateCredentials(username, password) {
  const c = config.get();
  const re = new RegExp(`^[A-Za-zА-Яа-яЁё0-9_-]{${c.usernameMin},${c.usernameMax}}$`);
  if (typeof username !== 'string' || !re.test(username)) {
    throw new HttpError(400, `Имя: ${c.usernameMin}–${c.usernameMax} символов, буквы, цифры, «_» или «-».`);
  }
  if (typeof password !== 'string' || password.length < c.passwordMin || password.length > c.passwordMax) {
    throw new HttpError(400, `Пароль должен содержать от ${c.passwordMin} до ${c.passwordMax} символов.`);
  }
}

async function register(username, password) {
  validateCredentials(username, password);
  const db = accounts.get();
  const key = keyOf(username);
  if (db.users[key]) throw new HttpError(409, 'Это имя уже занято.');
  const { salt, hash } = await hashPassword(password);
  // повторная проверка: пока считался хэш, мог появиться такой же аккаунт
  if (db.users[key]) throw new HttpError(409, 'Это имя уже занято.');
  const isFirst = Object.keys(db.users).length === 0;
  const account = {
    id: crypto.randomUUID(),
    username,
    salt,
    hash,
    role: isFirst ? 'admin' : 'player', // первый аккаунт — администратор
    banned: false,
    bannedUntil: null,
    banReason: null,
    createdAt: Date.now(),
  };
  db.users[key] = account;
  accounts.save();
  return account;
}

// Простая защита от перебора: ограничение неудачных попыток на IP+имя (loginFailLimit за loginFailWindowMin)
const failed = new Map();
const failWindowMs = () => config.get().loginFailWindowMin * 60000;

function checkThrottle(key) {
  const f = failed.get(key);
  if (f && Date.now() - f.first < failWindowMs() && f.count >= config.get().loginFailLimit) {
    throw new HttpError(429, 'Слишком много неудачных попыток. Подождите несколько минут.');
  }
}

function noteFailure(key) {
  const f = failed.get(key);
  if (!f || Date.now() - f.first >= failWindowMs()) failed.set(key, { first: Date.now(), count: 1 });
  else f.count++;
}

async function login(username, password, ip = '') {
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw new HttpError(400, 'Введите имя и пароль.');
  }
  const throttleKey = ip + '|' + keyOf(username);
  checkThrottle(throttleKey);
  const db = accounts.get();
  const a = db.users[keyOf(username)];
  const ok = a ? await verifyPassword(password, a.salt, a.hash) : false;
  if (!ok) {
    noteFailure(throttleKey);
    throw new HttpError(401, 'Неверное имя или пароль.');
  }
  failed.delete(throttleKey);
  if (clearExpiredBan(a)) accounts.save();
  if (isBanned(a)) {
    throw new HttpError(403, banMessage(a), { bannedUntil: a.bannedUntil, banReason: a.banReason });
  }
  return { token: createSession(a), account: a };
}

// ---------- Сессии ----------

function createSession(a) {
  const token = crypto.randomBytes(32).toString('hex');
  const s = sessions.get();
  const now = Date.now();
  for (const [id, sess] of Object.entries(s.sessions)) {
    if (sess.expires < now) delete s.sessions[id];
  }
  s.sessions[tokenId(token)] = { accountKey: keyOf(a.username), created: now, expires: now + config.get().sessionTtlDays * 86400000 };
  sessions.save();
  return token;
}

function destroySession(token) {
  const s = sessions.get();
  if (s.sessions[tokenId(token)]) {
    delete s.sessions[tokenId(token)];
    sessions.save();
  }
}

function destroyAllSessions(accountKey) {
  const s = sessions.get();
  let changed = false;
  for (const [id, sess] of Object.entries(s.sessions)) {
    if (sess.accountKey === accountKey) { delete s.sessions[id]; changed = true; }
  }
  if (changed) sessions.save();
}

// Проверка токена: { account } | { error: 'invalid' } | { error: 'banned', message }
function resolveToken(token) {
  if (!token || typeof token !== 'string') return { error: 'invalid' };
  const sess = sessions.get().sessions[tokenId(token)];
  if (!sess || sess.expires < Date.now()) return { error: 'invalid' };
  const a = accounts.get().users[sess.accountKey];
  if (!a) return { error: 'invalid' };
  if (clearExpiredBan(a)) accounts.save();
  if (isBanned(a)) return { error: 'banned', message: banMessage(a), account: a };
  return { account: a };
}

// Возвращает аккаунт по токену или null
function accountByToken(token) {
  const r = resolveToken(token);
  return r.error ? null : r.account;
}

// События аккаунтов: 'ban' (account) — чтобы сразу отключить игрока из мира
const events = new EventEmitter();

// ---------- Администрирование ----------

function findAccount(username) {
  const a = typeof username === 'string' ? accounts.get().users[keyOf(username)] : null;
  if (!a) throw new HttpError(404, 'Аккаунт не найден.');
  return a;
}

function logAdmin(admin, action, details) {
  appendLog('admin-log.jsonl', { time: new Date().toISOString(), admin: admin.username, action, ...details });
}

// minutes: число минут или null/0/не задано — бессрочно
function ban(admin, username, minutes, reason) {
  const a = findAccount(username);
  if (a.id === admin.id) throw new HttpError(400, 'Нельзя заблокировать самого себя.');
  const mins = Number(minutes);
  const temporary = minutes != null && minutes !== '' && Number.isFinite(mins) && mins > 0;
  a.banned = true;
  a.bannedUntil = temporary ? Date.now() + Math.round(mins * 60000) : null;
  a.banReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : null;
  accounts.save();
  destroyAllSessions(keyOf(a.username));
  logAdmin(admin, 'ban', { target: a.username, minutes: temporary ? mins : null, reason: a.banReason });
  events.emit('ban', a);
  return a;
}

function unban(admin, username) {
  const a = findAccount(username);
  a.banned = false;
  a.bannedUntil = null;
  a.banReason = null;
  accounts.save();
  logAdmin(admin, 'unban', { target: a.username });
  return a;
}

// ---------- Заглушение голоса (шаг 18) ----------
// Как блокировка, но только для голосового чата: сигналинг не соединяет заглушённого ни с кем, текущие соединения рвутся.
function isVoiceMuted(a, now = Date.now()) {
  if (!a || !a.voiceMuted) return false;
  return a.voiceMutedUntil == null || now < a.voiceMutedUntil;
}
function voiceMuteMessage(a) {
  const reason = a.voiceMuteReason ? ` Причина: ${a.voiceMuteReason}.` : '';
  if (a.voiceMutedUntil == null) return `Голос заглушён администратором бессрочно.${reason}`;
  return `Голос заглушён администратором.${reason} Осталось: ${formatDuration(a.voiceMutedUntil - Date.now())}.`;
}
// minutes: число минут или null/0/не задано — бессрочно
function voiceMute(admin, username, minutes, reason) {
  const a = findAccount(username);
  if (a.id === admin.id) throw new HttpError(400, 'Нельзя заглушить самого себя.');
  const mins = Number(minutes);
  const temporary = minutes != null && minutes !== '' && Number.isFinite(mins) && mins > 0;
  a.voiceMuted = true;
  a.voiceMutedUntil = temporary ? Date.now() + Math.round(mins * 60000) : null;
  a.voiceMuteReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : null;
  accounts.save();
  logAdmin(admin, 'voice-mute', { target: a.username, minutes: temporary ? mins : null, reason: a.voiceMuteReason });
  events.emit('voice-mute', a);
  return a;
}
function voiceUnmute(admin, username) {
  const a = findAccount(username);
  a.voiceMuted = false;
  a.voiceMutedUntil = null;
  a.voiceMuteReason = null;
  accounts.save();
  logAdmin(admin, 'voice-unmute', { target: a.username });
  events.emit('voice-unmute', a);
  return a;
}

// Роль аккаунта: 'player' | 'admin'. Себя разжаловать нельзя (чтобы не остаться без администратора).
function setRole(admin, username, role) {
  const a = findAccount(username);
  if (!['player', 'admin'].includes(role)) throw new HttpError(400, 'Роль — player или admin.');
  if (a.id === admin.id && role !== 'admin') throw new HttpError(400, 'Нельзя снять роль администратора с самого себя.');
  const from = a.role;
  a.role = role;
  accounts.save();
  logAdmin(admin, 'role', { target: a.username, from, to: role });
  events.emit('role', a);
  return a;
}

function listAccounts() {
  return Object.values(accounts.get().users).map(publicAccount);
}

module.exports = {
  HttpError, register, login, accountByToken, resolveToken, events, destroySession, publicAccount,
  ban, unban, setRole, logAdmin, findAccount, listAccounts, isBanned, banMessage, formatDuration,
  voiceMute, voiceUnmute, isVoiceMuted, voiceMuteMessage,
};
