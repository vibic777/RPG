'use strict';
// Останавливает только процесс из server.lock выбранной папки данных.
const fs = require('fs');
const path = require('path');
const net = require('net');
const { execFileSync } = require('child_process');
const config = require('../config');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function running(pid) {
  try { process.kill(pid, 0); return true; } catch (err) {
    if (err.code === 'ESRCH') return false;
    throw err;
  }
}
async function main() {
  const argv = process.argv.slice(2);
  if (/^\d+$/.test(argv[0] || '')) argv.splice(0, 1, '--port', argv[0]);
  const args = config.parseArgs(argv, { flags: {
    '--port': { arg: '<порт>', key: 'port' },
    '--host': { arg: '<адрес>', key: 'host' },
    '--auto-port': { key: 'autoPort' },
    '--open': { key: 'open' },
  } });
  if (args.positional.length) throw new Error('Неизвестный аргумент: ' + args.positional[0]);
  const cfg = config.load({ overrides: args.overrides, configFile: args.configFile });
  let lock;
  try { lock = JSON.parse(fs.readFileSync(path.join(cfg.dataPath, 'server.lock'), 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return; throw err; }
  if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0 || !Number.isFinite(lock.started)) {
    throw new Error('Некорректный server.lock.');
  }
  if (!running(lock.pid)) return;
  // Проверяем имя и время запуска: устаревший PID может принадлежать другой программе.
  const verify = `$p = Get-Process -Id ${lock.pid} -ErrorAction Stop; ` +
    `if ($p.ProcessName -ne 'node' -or [Math]::Abs(([DateTimeOffset]$p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() - ${Math.trunc(lock.started)}) -gt 30000) { throw 'server.lock does not match the running Node process' }`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', verify], { stdio: 'pipe', windowsHide: true });
  console.log('Останавливаю предыдущий сервер...');
  let graceful = false;
  if (typeof lock.restartPipe === 'string' && lock.restartPipe.startsWith('\\\\.\\pipe\\rust-magic-') && typeof lock.restartToken === 'string') {
    graceful = await new Promise((resolve) => {
      const socket = net.createConnection(lock.restartPipe);
      let response = '';
      const finish = (ok) => { socket.destroy(); resolve(ok); };
      socket.setTimeout(2500, () => finish(false));
      socket.on('connect', () => socket.write(lock.restartToken + '\n'));
      socket.on('data', (data) => { response += data; if (response.includes('OK\n')) finish(true); });
      socket.on('error', () => finish(false));
      socket.on('end', () => finish(response.includes('OK\n')));
    });
  }
  if (!graceful && running(lock.pid)) {
    console.log('Старая версия сервера: остановка процесса. Следующие перезапуски будут с сохранением игроков.');
    execFileSync('taskkill.exe', ['/PID', String(lock.pid), '/F'], { stdio: 'pipe', windowsHide: true });
  }
  const deadline = Date.now() + 10000;
  while (running(lock.pid)) {
    if (Date.now() > deadline) throw new Error('Сервер не завершился за 10 секунд. Новый экземпляр не запущен.');
    await delay(100);
  }
  console.log('Предыдущий сервер остановлен. Запускаю новый...');
}
main().catch((err) => { console.error('Ошибка перезапуска:', err.message); process.exitCode = 1; });
