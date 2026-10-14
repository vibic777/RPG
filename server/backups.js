'use strict';
// Резервные копии папки данных: создание (с ротацией — хранятся последние backupKeep), список, восстановление.
// Копия — папка <backupPath>/<время>[-метка]/ с файлами данных и manifest.json (когда, сколько файлов, версии схем).
// Восстановление сначала делает копию текущего состояния («before-restore»), затем заменяет папку данных.
// Пока работает сервер, в папке данных лежит server.lock — восстанавливать можно только остановленный сервер.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const LOCK = 'server.lock';
const MANIFEST = 'manifest.json';
const cfg = () => config.get();
const ID_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}(-[a-z0-9-]{1,32})?$/;

function walk(dir, base = dir, out = []) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walk(full, base, out);
    else if (d.isFile() && !d.name.endsWith('.tmp') && d.name !== LOCK) out.push(path.relative(base, full));
  }
  return out;
}

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

// Создать копию. label — метка латиницей (auto, manual, start, before-restore…). Возвращает запись списка
function create(label = 'manual', { rotate: doRotate = true } = {}) {
  const c = cfg();
  const safe = String(label || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32);
  let id = stamp() + (safe ? '-' + safe : '');
  while (fs.existsSync(path.join(c.backupPath, id))) id = stamp(new Date(Date.now() + 1)) + (safe ? '-' + safe : '');
  const dest = path.join(c.backupPath, id);
  const files = walk(c.dataPath);
  let bytes = 0;
  for (const rel of files) {
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(c.dataPath, rel), to);
    bytes += fs.statSync(to).size;
  }
  fs.mkdirSync(dest, { recursive: true });
  const versions = Object.fromEntries([...require('./store').schemas].map(([k, s]) => [k, s.version]));
  fs.writeFileSync(path.join(dest, MANIFEST), JSON.stringify({ id, label: safe, created: Date.now(), files: files.length, bytes, versions }, null, 2));
  if (doRotate) rotate();
  return info(id);
}

function info(id) {
  const dir = path.join(cfg().backupPath, id);
  let m = {};
  try { m = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')); } catch { /* копия без описания */ }
  return { id, label: m.label || '', created: m.created || 0, files: m.files ?? walk(dir).length - 1, bytes: m.bytes || 0, dir };
}

// Список копий: новые первыми
function list() {
  let names = [];
  try { names = fs.readdirSync(cfg().backupPath).filter((n) => ID_RE.test(n)); } catch { /* копий ещё нет */ }
  return names.sort().reverse().map(info);
}

// Оставить последние backupKeep копий
function rotate(keep = cfg().backupKeep) {
  const all = list();
  const removed = [];
  for (const b of all.slice(Math.max(1, keep))) {
    fs.rmSync(b.dir, { recursive: true, force: true });
    removed.push(b.id);
  }
  return removed;
}

// Работает ли сервер с этой папкой данных (живой процесс из server.lock)
function serverRunning() {
  try {
    const { pid } = JSON.parse(fs.readFileSync(path.join(cfg().dataPath, LOCK), 'utf8'));
    if (!pid || pid === process.pid) return false;
    process.kill(pid, 0);
    return pid;
  } catch { return false; }
}
function lock(extra = {}) {
  fs.mkdirSync(cfg().dataPath, { recursive: true });
  fs.writeFileSync(path.join(cfg().dataPath, LOCK), JSON.stringify({ ...extra, pid: process.pid, started: Date.now() }));
}
function unlock() {
  try {
    const f = path.join(cfg().dataPath, LOCK);
    if (JSON.parse(fs.readFileSync(f, 'utf8')).pid === process.pid) fs.unlinkSync(f);
  } catch { /* уже нет */ }
}

// Восстановить копию id ('latest' — последнюю). force — даже если сервер работает (не рекомендуется)
function restore(id, { force = false } = {}) {
  const all = list();
  const b = id === 'latest' ? all[0] : all.find((x) => x.id === id);
  if (!b) throw new Error(id === 'latest' ? 'Резервных копий нет.' : `Копия «${id}» не найдена. Список: node server/backup.js list`);
  const pid = serverRunning();
  if (pid && !force) throw new Error(`Сервер работает (процесс ${pid}). Остановите его перед восстановлением или добавьте --force.`);
  const before = create('before-restore', { rotate: false }); // ротация — после, чтобы не удалить восстанавливаемую копию
  const data = cfg().dataPath;
  for (const rel of walk(data)) fs.rmSync(path.join(data, rel), { force: true });
  for (const rel of walk(b.dir)) {
    if (rel === MANIFEST) continue;
    const to = path.join(data, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(b.dir, rel), to);
  }
  rotate();
  return { restored: b, before };
}

module.exports = { create, list, rotate, restore, info, lock, unlock, serverRunning, stamp };
