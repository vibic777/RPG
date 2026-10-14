'use strict';
// Состояние мира между сеансами: data/worlds/<id>.state.json — живые враги (в том числе боссы и их свита),
// турели, мины и ловушки, таймер орд. Сохраняется автоматически (game.autosaveSec, при уходе последнего игрока,
// при остановке сервера, по кнопке «Сохранить») и восстанавливается, когда в мир снова кто-то входит.
// Предметы на земле хранятся отдельно (server/ground.js).
const fs = require('fs');
const { JsonFile, registerSchema } = require('./store');

registerSchema('worldstate', 1);
const files = new Map();
const ID_RE = /^[0-9a-f-]{36}(~(?:[a-z]{1,2}\d{1,3}\.\d|h\d{1,7}\.-?\d))?$/;

function fileFor(worldId) {
  if (!require('./room-key').room(worldId)) throw new Error('Некорректный мир.');
  if (!files.has(worldId)) files.set(worldId, new JsonFile(`worlds/${worldId}.state.json`, null, { kind: 'worldstate' }));
  return files.get(worldId);
}

// Сохранённое состояние или null
function load(worldId) {
  const f = fileFor(worldId);
  return f.get();
}

function save(worldId, state) {
  const f = fileFor(worldId);
  f.data = { ...state, savedAt: Date.now() };
  f.save();
  return f.data.savedAt;
}

// Удалить состояние мира и всех его уровней (шаг 13: «<id>~<ключ>.state.json»)
function remove(worldId) {
  const f = fileFor(worldId);
  try { fs.unlinkSync(f.file); } catch { /* файла нет */ }
  files.delete(worldId);
  const dir = require('path').dirname(f.file);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* нет папки */ }
  for (const n of names) {
    if (!n.startsWith(worldId + '~') || !n.endsWith('.state.json')) continue;
    files.delete(n.slice(0, -'.state.json'.length));
    try { fs.unlinkSync(require('path').join(dir, n)); } catch { /* файла нет */ }
  }
}

module.exports = { load, save, remove,release:worldId=>files.delete(worldId) };
