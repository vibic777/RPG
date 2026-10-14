'use strict';
// Общие помощники тестов: запуск сервера на свободном порту с временной папкой данных.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server', 'index.js');
const MAKE_ADMIN = path.join(ROOT, 'server', 'tools', 'make-admin.js');

function tmpDir(prefix = 'rm-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

// Окружение без переменных, влияющих на настройки
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'PORT' || k === 'HOST' || k === 'DATA_DIR' || k.startsWith('RM_')) delete env[k];
  return { ...env, ...extra };
}

// Пустой файл настроек, чтобы локальный config.json разработчика не влиял на тесты
function emptyConfig(dir) {
  const f = path.join(dir, 'config.test.json');
  fs.writeFileSync(f, '{}');
  return f;
}

// Запускает сервер. Возвращает { base, port, dataDir, proc, stop() }
function startServer(args = [], { env = {}, ipc = false } = {}) {
  const dir = tmpDir();
  const dataDir = path.join(dir, 'data');
  const proc = spawn(process.execPath, [SERVER, '--port', '0', '--host', '127.0.0.1', '--data', dataDir, '--config', emptyConfig(dir), ...args], {
    env: cleanEnv(env), stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Сервер не запустился:\n' + out)); }, 10000);
    const onData = (chunk) => {
      out += chunk;
      const m = /http:\/\/localhost:(\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        const port = Number(m[1]);
        resolve({
          base: `http://127.0.0.1:${port}`, port, dataDir, dir, proc,
          output: () => out,
          stop: () => new Promise((res) => {
            // уже остановлен (на Windows после kill() exitCode остаётся null, а signalCode — 'SIGTERM')
            if (proc.exitCode !== null || proc.signalCode !== null) { rmDir(dir); return res(); }
            proc.once('exit', () => { rmDir(dir); res(); });
            proc.kill();
          }),
        });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (c) => { out += c; });
    proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Сервер завершился (код ${code}):\n${out}`)); });
  });
}

// Синхронный запуск CLI (make-admin, server --help и т. п.)
function runCli(script, args = [], env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { env: cleanEnv(env), encoding: 'utf8', timeout: 15000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: r.stdout + r.stderr };
}

// JSON-запрос к API
async function api(base, method, url, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* не JSON */ }
  return { status: res.status, data, headers: res.headers };
}

// «Сырой» GET без нормализации пути (для проверки обхода каталогов)
function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Корректные данные персонажа для тестов
function validCharacter(name = 'Айра Ржавая') {
  return {
    name,
    appearance: {
      gender: 'female', body: 'athletic', face: 'heart', hair: 'braids', hairColor: 'red', skin: 'tan', eyes: 'green',
      underwear: 'black', scars: ['cheek'], tattoos: ['armLeft'], implants: ['eye', 'armRight'],
    },
    stats: {
      strength: 3, magic: 2, intellect: 2, stealth: 2, persuasion: 1, hacking: 3, engineering: 2,
      builder: 1, suggestion: 1, taming: 2, companions: 3,
    },
  };
}

// Клиент WebSocket для тестов: очередь сообщений, ожидание нужного типа, код закрытия.
// autoPong: false — не отвечать на ping (как «зависший» браузер или пропавшая сеть)
function wsClient(base, { path = '/ws', autoPong = true } = {}) {
  const WebSocket = require('ws');
  const ws = new WebSocket(base.replace(/^http/, 'ws') + path, { autoPong });
  const queue = [];
  const waiters = [];
  const c = {
    ws, messages: [], closeCode: null,
    opened: new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }),
    closed: new Promise((res) => ws.once('close', (code) => { c.closeCode = code; res(code); })),
    send: (msg) => ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)),
    // ждать сообщение, подходящее под условие (тип или функция); уже полученные тоже учитываются
    next(match, timeout = 3000) {
      const test = typeof match === 'function' ? match : (m) => m.t === match;
      const i = queue.findIndex(test);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((res, rej) => {
        const w = { test, res };
        waiters.push(w);
        setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); rej(new Error('Не дождались сообщения: ' + (typeof match === 'string' ? match : 'условие') + '. Получено: ' + JSON.stringify(c.messages.slice(-5)))); } }, timeout);
      });
    },
    drain() { queue.length = 0; },
    close: () => { try { ws.close(); } catch { /* ignore */ } return c.closed; },
  };
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    c.messages.push(m);
    const k = waiters.findIndex((w) => w.test(m));
    if (k >= 0) waiters.splice(k, 1)[0].res(m);
    else queue.push(m);
  });
  return c;
}

// Зарегистрировать аккаунт и создать персонажа: { token, characterId }
async function newPlayer(base, username, charName = 'Герой ' + username) {
  const token = (await api(base, 'POST', '/api/register', { username, password: 'secret123' })).data.token;
  const ch = await api(base, 'POST', '/api/characters', validCharacter(charName), token);
  return { token, characterId: ch.data.character.id, username };
}

// Подключиться к миру: вернуть клиента после welcome (или после закрытия, если вход отклонён)
async function joinWorld(base, player, worldId, opts = {}) {
  const c = wsClient(base, opts);
  await c.opened;
  c.send({ t: 'hello', token: player.token, worldId, characterId: player.characterId });
  c.welcome = await Promise.race([c.next('welcome', 5000), c.closed.then(() => null)]);
  return c;
}

module.exports = {
  ROOT, SERVER, MAKE_ADMIN, tmpDir, rmDir, cleanEnv, emptyConfig, startServer, runCli, api, rawGet, sleep, validCharacter,
  wsClient, newPlayer, joinWorld,
};
