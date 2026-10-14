'use strict';
// JSON-хранилище в папке data/.
// Надёжность: запись атомарная (временный файл → fsync → rename; старый файл не портится при сбое посреди записи).
// Версии схемы: файл-контейнер хранит поле _v; при чтении старого файла по очереди применяются миграции его вида
// (registerSchema) и файл сразу пересохраняется в новой версии. Файл перечитывается, если его изменили извне
// (например, скрипт make-admin или восстановление из резервной копии).
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Папка данных берётся из настроек при первом обращении
const dataPath = () => config.get().dataPath;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Атомарная запись текста: tmp + fsync + rename (в Windows rename может мешать антивирус — несколько попыток)
function writeAtomic(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i >= 4) { // последний шанс: прямая запись, временный файл убрать
        fs.writeFileSync(file, text, 'utf8');
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        return;
      }
      const until = Date.now() + 20 * (i + 1);
      while (Date.now() < until) { /* короткая пауза */ }
    }
  }
}

// Виды файлов: { version, migrations: { [версия]: (data) => void } } — миграция N переводит данные из N−1 в N
const schemas = new Map();
function registerSchema(kind, version, migrations = {}) {
  schemas.set(kind, { version, migrations });
}
// Применить миграции к данным вида kind. Возвращает true, если данные изменились
function migrate(kind, data) {
  const s = schemas.get(kind);
  if (!s || !data || typeof data !== 'object') return false;
  const from = Number.isInteger(data._v) ? data._v : 1;
  if (from > s.version) throw new Error(`Файл вида «${kind}» новее сервера (версия ${from} > ${s.version}). Обновите игру.`);
  if (from === s.version && data._v === s.version) return false;
  for (let v = from + 1; v <= s.version; v++) if (s.migrations[v]) s.migrations[v](data);
  data._v = s.version;
  return true;
}

class JsonFile {
  // opts.kind — вид файла для версий и миграций
  constructor(name, defaults, opts = {}) {
    this.name = name;
    this.defaults = defaults;
    this.kind = opts.kind || null;
    this.data = null;
    this.mtime = 0;
  }

  get file() {
    return path.join(dataPath(), this.name);
  }

  get() {
    let st = null;
    try { st = fs.statSync(this.file); } catch { /* файла ещё нет */ }
    if (!st) {
      if (!this.data) {
        this.data = structuredClone(this.defaults);
        if (this.kind && this.data) migrate(this.kind, this.data);
      }
      return this.data;
    }
    if (!this.data || st.mtimeMs !== this.mtime) {
      let data;
      try { data = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')); } catch (e) {
        throw new Error(`Файл данных повреждён: ${this.file} (${e.message}). Восстановите его из резервной копии: node server/backup.js list`);
      }
      this.data = data;
      this.mtime = st.mtimeMs;
      if (this.kind && migrate(this.kind, this.data)) this.save();
    }
    return this.data;
  }

  save() {
    if (this.kind && this.data && typeof this.data === 'object' && this.data._v === undefined) migrate(this.kind, this.data);
    writeAtomic(this.file, JSON.stringify(this.data, null, 2));
    this.mtime = fs.statSync(this.file).mtimeMs;
  }

  // Забыть кэш (после восстановления из копии)
  reset() { this.data = null; this.mtime = 0; }
}

function appendLog(name, entry) {
  ensureDir(dataPath());
  fs.appendFileSync(path.join(dataPath(), name), JSON.stringify(entry) + '\n', 'utf8');
}

// Версии файлов-контейнеров (при изменении формата — повысить версию и добавить миграцию)
registerSchema('accounts', 1);
registerSchema('sessions', 1);
registerSchema('characters', 1);
registerSchema('ground', 1);
registerSchema('world', 1);

// accounts.json: { users: { [имя в нижнем регистре]: account } }
// Персонажи, базы и миры хранятся отдельно (characters/, bases/, worlds/).
const accounts = new JsonFile('accounts.json', { users: {} }, { kind: 'accounts' });
const sessions = new JsonFile('sessions.json', { sessions: {} }, { kind: 'sessions' });

module.exports = { dataPath, JsonFile, accounts, sessions, appendLog, writeAtomic, registerSchema, migrate, schemas };
