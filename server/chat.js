'use strict';
// Текстовый чат в мире: каналы «всем в мире», личные сообщения (/w), системные сообщения,
// объявления администратора. Подключается к модулю реального времени как расширение.
const config = require('./config');
const auth = require('./auth');
const realtime = require('./realtime');

const history = new Map(); // worldId -> последние сообщения (кроме личных)
let nextId = 1;
const cfg = () => config.get().game;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// Базовое экранирование HTML: клиент вставляет текст как разметку, поэтому всё пользовательское экранируется здесь
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
// Управляющие символы → пробел, обрезка краёв
const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim();

function who(c) {
  return { id: c.account.id, name: escapeHtml(c.character.name), account: escapeHtml(c.account.username), admin: c.account.role === 'admin' };
}

function makeMsg(channel, text, from = null, to = null) {
  return { id: nextId++, time: Date.now(), channel, from, to, text: escapeHtml(text) };
}

function remember(worldId, m) {
  const list = history.get(worldId) || [];
  list.push(m);
  const max = Math.max(0, cfg().chatHistory);
  while (list.length > max) list.shift();
  history.set(worldId, list);
}

// Сообщение всему миру: поверхности и всем открытым уровням (шаг 13)
function toRoom(room, m) {
  const wid = room.worldId || room.id;
  remember(wid, m);
  for (const r of realtime.worldRooms ? realtime.worldRooms(wid) : [room]) r.broadcast({ t: 'chat', m });
}

function toClient(c, m) { realtime.send(c, { t: 'chat', m }); }

// Системное сообщение одному игроку (ошибка команды, подсказка)
function tell(c, text) { toClient(c, makeMsg('system', text)); }

// ---------- Точки расширения для панели администратора (шаг 7) ----------

// Системное сообщение всем в мире
function system(worldId, text) {
  worldId = String(worldId).split('~')[0]; // id комнаты уровня — сообщение всему миру
  const room = realtime.worldRooms(worldId)[0];
  const m = makeMsg('system', text);
  if (room) toRoom(room, m); else remember(worldId, m);
  return m;
}

// Объявление администратора: во все активные миры или в один
function announce(admin, text, worldId = null) {
  const t = clean(text || '');
  if (!t) throw new auth.HttpError(400, 'Пустое объявление.');
  if (t.length > cfg().chatMaxLength) throw new auth.HttpError(400, `Объявление длиннее ${cfg().chatMaxLength} символов.`);
  const from = { id: admin.id, name: escapeHtml(admin.username), account: escapeHtml(admin.username), admin: true };
  let rooms = 0, players = 0;
  const seen = new Set();
  for (const room of realtime.rooms.values()) {
    if (worldId && room.worldId !== worldId) continue;
    rooms++; players += room.players.size;
    if (seen.has(room.worldId)) continue; // toRoom рассылает всему миру сразу
    seen.add(room.worldId);
    toRoom(room, makeMsg('announce', t, from));
  }
  auth.logAdmin(admin, 'announce', { text: t, worldId: worldId || null, rooms, players });
  return { rooms, players };
}

// Личное сообщение от администратора одному игроку (канал announce — видно как объявление, адресовано ему)
function adminMessage(adminName, c, text) {
  const t = clean(text || '');
  if (!t) throw new auth.HttpError(400, 'Пустое сообщение.');
  if (t.length > cfg().chatMaxLength) throw new auth.HttpError(400, `Сообщение длиннее ${cfg().chatMaxLength} символов.`);
  const from = { name: escapeHtml(adminName), account: escapeHtml(adminName), admin: true };
  toClient(c, makeMsg('announce', t, from, { name: escapeHtml(c.character.name), account: escapeHtml(c.account.username) }));
}

// ---------- Команды ----------

const HELP_TEXT = 'Команды: /w <имя> <текст> — личное сообщение (имя героя или аккаунта; имя с пробелом — в кавычках); ' +
  '/r <текст> — ответить на последнее личное; /who — кто в мире; /help — эта справка' +
  '; администратору: /announce <текст> — объявление во все миры';

// Найти адресата: "имя в кавычках" или самое длинное совпадение имени героя / аккаунта в начале строки
function parseTarget(room, rest) {
  const players = [...room.players.values()];
  const q = /^"([^"]+)"\s*(.*)$/s.exec(rest);
  if (q) {
    const name = q[1].trim().toLowerCase();
    const p = players.find((c) => c.character.name.toLowerCase() === name || c.account.username.toLowerCase() === name);
    return { target: p || null, name: q[1], text: q[2] };
  }
  const low = rest.toLowerCase();
  let best = null;
  for (const c of players) {
    for (const n of [c.character.name, c.account.username]) {
      const nl = n.toLowerCase();
      if ((low === nl || low.startsWith(nl + ' ')) && (!best || nl.length > best.len)) best = { target: c, len: nl.length };
    }
  }
  if (best) return { target: best.target, text: rest.slice(best.len).trim() };
  return { target: null, name: rest.split(/\s+/)[0], text: '' };
}

function whisper(from, target, text) {
  if (!text) return tell(from, 'Пустое сообщение. Пример: /w Имя привет');
  if (target === from) return tell(from, 'Нельзя отправить личное сообщение самому себе.');
  const m = makeMsg('whisper', text, who(from), who(target));
  toClient(target, m);
  toClient(from, m);
  target.lastWhisperFrom = from.account.id;
}

const COMMANDS = {
  w(c, rest) {
    const r = parseTarget(c.room, rest);
    if (!r.target) return tell(c, r.name ? `Игрок «${r.name}» не найден в этом мире. /who — список игроков.` : 'Кому? Пример: /w Имя привет');
    whisper(c, r.target, r.text);
  },
  r(c, rest) {
    const t = c.lastWhisperFrom && c.room.players.get(c.lastWhisperFrom);
    if (!t) return tell(c, 'Некому отвечать: собеседник не в мире или личных сообщений ещё не было.');
    whisper(c, t, rest);
  },
  who(c) {
    const list = [...c.room.players.values()].map((p) => `${p.character.name} (${p.account.username}${p.account.role === 'admin' ? ', админ' : ''})`);
    tell(c, `В мире ${list.length} из ${cfg().maxPlayers}: ${list.join(', ')}.`);
  },
  help(c) { tell(c, HELP_TEXT + (c.account.role === 'admin' && extraHelp.length ? '; ' + extraHelp.join('; ') : '') + '.'); },
  announce(c, rest) {
    if (c.account.role !== 'admin') return tell(c, 'Команда доступна только администратору.');
    try { announce(c.account, rest); } catch (e) { tell(c, e.message); }
  },
};
const ALIASES = {
  w: 'w', 'ш': 'w', 'лс': 'w', whisper: 'w', msg: 'w', tell: 'w',
  r: 'r', 'о': 'r', reply: 'r', 'ответ': 'r',
  who: 'who', 'кто': 'who',
  help: 'help', 'помощь': 'help', '?': 'help',
  announce: 'announce', 'объявление': 'announce',
};

// Команды других модулей (например, /give и /take из server/inventory.js)
const extraHelp = [];
function addCommand(name, aliases, fn, help) {
  COMMANDS[name] = fn;
  for (const a of [name, ...aliases]) ALIASES[a] = name;
  if (help) extraHelp.push(help);
}

// Ограничение частоты: не больше chatRateCount сообщений за chatRateWindowSec
function rateLimited(c) {
  const now = Date.now();
  const win = cfg().chatRateWindowSec * 1000;
  c.chatTimes = (c.chatTimes || []).filter((t) => now - t < win);
  if (c.chatTimes.length >= cfg().chatRateCount) {
    const wait = Math.ceil((win - (now - c.chatTimes[0])) / 1000);
    tell(c, `Слишком часто. Подождите ${wait} с.`);
    return true;
  }
  c.chatTimes.push(now);
  return false;
}

function onChat(c, msg) {
  if (typeof msg.text !== 'string') return tell(c, 'Некорректное сообщение.');
  const text = clean(msg.text);
  if (!text) return;
  if (text.length > cfg().chatMaxLength) return tell(c, `Сообщение длиннее ${cfg().chatMaxLength} символов — сократите его.`);
  if (rateLimited(c)) return;
  if (text.startsWith('/')) {
    const m = /^\/(\S+)\s*(.*)$/s.exec(text);
    const cmd = m && ALIASES[m[1].toLowerCase()];
    if (!cmd) return tell(c, `Неизвестная команда «${m ? m[1] : text}». /help — список команд.`);
    return COMMANDS[cmd](c, m[2].trim());
  }
  toRoom(c.room, makeMsg('world', text, who(c)));
}

realtime.use({
  welcome: (room) => ({ chat: history.get(room.worldId || room.id) || [] }),
  onJoin: (room, c) => {
    if (realtime.godOf(c.account.id).invisible || c.levelMove) return; // невидимый администратор входит молча; смена уровня — не вход
    const m = makeMsg('system', `${c.character.name} (${c.account.username}) входит в мир.`);
    remember(room.worldId || room.id, m);
    for (const r of realtime.worldRooms(room.worldId || room.id)) r.broadcast({ t: 'chat', m }, c);
  },
  onLeave: (room, c, reason) => {
    if (realtime.godOf(c.account.id).invisible || reason === 'level') return;
    const why = { banned: ' (заблокирован)', replaced: ' (вход из другого места)', closed: ' (мир закрыт)', 'host-offline': ' (владелец вышел)', disconnect: ' (обрыв связи)' }[reason] || '';
    toRoom(room, makeMsg('system', `${c.character.name} покидает мир${why}.`));
  },
  handlers: { chat: onChat },
});

module.exports = { adminMessage, escapeHtml, system, announce, history, tell, parseTarget, addCommand };
