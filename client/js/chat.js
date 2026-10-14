import { restorePanel } from './floating-window.js';
// Чат в игре: окно сообщений (скрывается кнопкой 💬 или клавишей L), ввод по Enter,
// каналы: всем в мире, личные (/w), системные, объявления администратора.
// Текст сообщений и имена приходят с сервера уже экранированными (HTML-сущности), поэтому вставляются как разметка.
const $ = (sel) => document.querySelector(sel);
const cfg = () => window.GameSettings || {};

let net = null;
let unread = 0;
let bannerTimer = 0;

const hhmm = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const isHidden = () => ['collapsed','hidden','window-collapsed','window-iconified'].some(c=>$('#chat').classList.contains(c));

export function initChat() {
  $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendInput(); });
  $('#btn-chat-toggle').addEventListener('click', () => toggleLog());
  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeInput(); }
  });
  $('#chat-input').addEventListener('blur', () => { if (!$('#chat-input').value) closeInput(); });
  // щелчок по имени — начать личное сообщение
  $('#chat-log').addEventListener('click', (e) => {
    const n = e.target.closest('[data-account]');
    if (n) openInput(`/w ${n.dataset.account} `);
  });
}

export function chatAttach(n) {
  net = n;
  $('#chat-log').textContent = '';
  $('#chat-input').maxLength = cfg().chatMaxLength || 300;
  unread = 0;
  updateUnread();
  closeInput();
}

export function chatDetach() {
  net = null;
  closeInput();
  $('#announce-banner').classList.add('hidden');
}

export const chatIsTyping = () => document.activeElement === $('#chat-input');

// Клавиши игры: Enter — открыть ввод, L — окно чата. Возвращает true, если клавиша обработана.
export function chatHandleKey(e) {
  if (chatIsTyping()) return true; // пока печатаем, игра клавиши не получает
  if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); openInput(''); return true; }
  if (e.code === 'KeyL') { toggleLog(); return true; }
  return false;
}

function openInput(prefill) {
  const form = $('#chat-form'), input = $('#chat-input');
  if (isHidden()) toggleLog(false);
  form.classList.remove('hidden');
  if (prefill) input.value = prefill;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function closeInput() {
  $('#chat-form').classList.add('hidden');
  $('#chat-input').value = '';
  if (chatIsTyping()) $('#chat-input').blur();
}

function sendInput() {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (text && net) {
    if (!net.send({ t: 'chat', text })) addLine({ channel: 'system', time: Date.now(), text: 'Нет связи с сервером — сообщение не отправлено.' });
  }
  closeInput();
}

function toggleLog(force) {
  const hide = force === undefined ? !isHidden() : force;
  if(!hide)restorePanel('chat');
  $('#chat').classList.toggle('collapsed', hide);
  $('#btn-chat-toggle').setAttribute('aria-pressed', String(!hide));
  if (!hide) { unread = 0; updateUnread(); scrollDown(); }
}

function updateUnread() {
  const b = $('#chat-unread');
  b.textContent = unread > 99 ? '99+' : String(unread);
  b.classList.toggle('hidden', unread === 0);
}

function scrollDown() { const log = $('#chat-log'); log.scrollTop = log.scrollHeight; }

// Имя (уже экранировано сервером); щелчок — личное сообщение
const nameHtml = (p) => p ? `<span class="chat-name${p.admin ? ' admin' : ''}" data-account="${p.account}" title="${p.admin ? 'Администратор. ' : ''}Аккаунт: ${p.account}. Щелчок — личное сообщение">${p.admin ? '🛡 ' : ''}${p.name}</span>` : '';

function lineHtml(m, youId) {
  switch (m.channel) {
    case 'world': return `${nameHtml(m.from)}: ${m.text}`;
    case 'whisper': return m.from && m.from.id === youId
      ? `<span class="chat-tag">[ЛС для</span> ${nameHtml(m.to)}<span class="chat-tag">]</span> ${m.text}`
      : `<span class="chat-tag">[ЛС от</span> ${nameHtml(m.from)}<span class="chat-tag">]</span> ${m.text}`;
    case 'announce': return `📢 <b>Объявление администратора${m.from ? ' ' + m.from.name : ''}:</b> ${m.text}`;
    default: return m.text; // system
  }
}

const TITLES = { world: 'Всем в мире', whisper: 'Личное сообщение', system: 'Системное сообщение', announce: 'Объявление администратора' };

function addLine(m, youId) {
  const log = $('#chat-log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  const div = document.createElement('div');
  div.className = 'chat-line ch-' + m.channel + (m.from && m.from.admin ? ' from-admin' : '');
  div.title = `${TITLES[m.channel] || ''} · ${hhmm(m.time)}`;
  div.innerHTML = `<span class="chat-time">${hhmm(m.time)}</span> ${lineHtml(m, youId)}`;
  log.append(div);
  const max = cfg().chatLogLines || 200;
  while (log.children.length > max) log.firstChild.remove();
  if (atBottom) scrollDown();
}

// История при входе (и после переподключения)
export function chatOnWelcome(list, youId) {
  $('#chat-log').textContent = '';
  for (const m of list || []) addLine(m, youId);
  addLine({ channel: 'system', time: Date.now(), text: 'Enter — написать всем в мире, /w имя текст — личное, /help — команды.' });
  scrollDown();
}

export function chatOnMessage(msg, youId) {
  if (msg.t !== 'chat') return false;
  const m = msg.m;
  addLine(m, youId);
  if (isHidden() && m.channel !== 'system') { unread++; updateUnread(); }
  if (m.channel === 'announce') {
    const b = $('#announce-banner');
    b.innerHTML = `📢 ${m.text}`;
    b.classList.remove('hidden');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.add('hidden'), 10000);
  }
  return true;
}
