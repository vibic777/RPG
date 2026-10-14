'use strict';

// Файловый сборщик вывода сервера. По умолчанию ничего не создаёт и не пишет.
const fs = require('fs');
const path = require('path');
const util = require('util');
const ROOT = path.join(__dirname, '..');
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
let options = null;
let stream = null;
let streamDay = '';
let streamPath = '';
let writeFailed = false;

function configure(value = {}) {
  options = {
    enabled: value.enabled === true,
    directory: typeof value.directory === 'string' && value.directory.trim() ? value.directory.trim() : 'log',
    levels: Object.fromEntries(LEVELS.map((level) => [level, !value.levels || value.levels[level] !== false])),
  };
  if (!options.enabled) close();
  return status();
}

function status() { return options ? { enabled: options.enabled, directory: options.directory, levels: { ...options.levels } } : { enabled: false, directory: 'log', levels: Object.fromEntries(LEVELS.map((x) => [x, true])) }; }

function close() {
  if (!stream) return;
  const old = stream;
  stream = null;
  streamPath = '';
  old.end();
}

function ensureStream(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  if (stream && streamDay === day) return stream;
  close();
  const directory = path.resolve(ROOT, options.directory);
  fs.mkdirSync(directory, { recursive: true });
  streamPath = path.join(directory, `server-${day}.log`);
  streamDay = day;
  stream = fs.createWriteStream(streamPath, { flags: 'a', encoding: 'utf8' });
  stream.on('error', (err) => {
    if (!writeFailed) {
      writeFailed = true;
      try { process.stderr.write(`[logger] Не удалось записать ${streamPath}: ${err.message}\n`); } catch {}
    }
  });
  writeFailed = false;
  return stream;
}

function categoryOf(args) {
  const first = args[0];
  if (typeof first === 'string') {
    const m = /^\[([^\]]+)\]/.exec(first);
    if (m) return m[1].toLowerCase();
    if (/^(fatal|критическ)/i.test(first)) return 'server';
  }
  return 'server';
}

function record(level, args, now = new Date()) {
  if (!options || !options.enabled || !options.levels[level]) return;
  try {
    const message = util.format(...args) + (level === 'trace' ? `\n${new Error().stack}` : '');
    const entry = { time: now.toISOString(), level, category: categoryOf(args), pid: process.pid, message };
    ensureStream(now).write(JSON.stringify(entry) + '\n');
  } catch (err) {
    if (!writeFailed) {
      writeFailed = true;
      try { process.stderr.write(`[logger] Ошибка журналирования: ${err.message}\n`); } catch {}
    }
  }
}

function install(value) {
  configure(value);
  const aliases = { log: 'info', info: 'info', debug: 'debug', trace: 'trace', warn: 'warn', error: 'error' };
  for (const [method, level] of Object.entries(aliases)) {
    const original = console[method];
    if (typeof original !== 'function' || original.__fileLoggerWrapped) continue;
    const wrapped = function (...args) {
      const actualLevel = level === 'error' && typeof args[0] === 'string' && /^\[(?:сбой|fatal)\]/i.test(args[0]) ? 'fatal' : level;
      if (options && options.levels[actualLevel] === false) return;
      record(actualLevel, args);
      return original.apply(console, args);
    };
    Object.defineProperty(wrapped, '__fileLoggerWrapped', { value: true });
    console[method] = wrapped;
  }
  process.on('exit', close);
  return status();
}

function write(level, ...args) {
  if (!LEVELS.includes(level)) throw new TypeError(`Неизвестный уровень журнала: ${level}`);
  record(level, args);
}

module.exports = { LEVELS, install, configure, status, write, close };
