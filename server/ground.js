'use strict';
// Предметы на земле: data/worlds/<id мира>.ground.json — { items: [{ gid, id, n, dur?, x, y, t, by }] }.
// Предметы видят все игроки мира; временные выпавшие предметы исчезают по groundItemTtlSec.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { JsonFile, dataPath } = require('./store');

const files = new Map();
const cfg = () => config.get().game;

function fileFor(worldId) {
  if (!require('./room-key').room(worldId)) throw new Error('Некорректный мир.');
  if (!files.has(worldId)) files.set(worldId, new JsonFile(`worlds/${worldId}.ground.json`, { items: [] }, { kind: 'ground' }));
  return files.get(worldId);
}

function list(worldId) {
  const db = fileFor(worldId).get(); let changed = false;
  for (const item of db.items) if (item.by === 'Тайник' && !item.permanent) { item.permanent = true; changed = true; }
  if (changed) fileFor(worldId).save();
  return db.items;
}
function find(worldId, gid) { return list(worldId).find((g) => g.gid === gid) || null; }
const isFull = (worldId) => list(worldId).length >= cfg().groundItemsMax;

function add(worldId, item, pos, by, options = {}) {
  return addMany(worldId, [{ item, pos, by, ...options }])[0];
}
function addMany(worldId, rows) {
  const f = fileFor(worldId);
  const ttl = cfg().groundItemTtlSec ?? Math.max(0, (cfg().groundItemTtlMin || 0) * 60);
  const added = rows.map(({ item, pos, by, permanent = false }) => {
    const g = { gid: crypto.randomBytes(6).toString('hex'), id: item.id, n: item.n, x: pos.x, y: pos.y, t: Date.now(), by };
    if (permanent) g.permanent = true;
    if (item.dur != null) g.dur = item.dur;
    if (Number.isFinite(item.made)) g.made = item.made;
    if (item.tier > 1) g.tier = item.tier;
    if (item.uid) { g.data = { ...item }; delete g.data.id; delete g.data.n; }
    return g;
  });
  if (added.length) { f.get().items.push(...added); f.save(); }
  return added;
}

function remove(worldId, gid) {
  const f = fileFor(worldId);
  const items = f.get().items;
  const i = items.findIndex((g) => g.gid === gid);
  if (i < 0) return null;
  const [g] = items.splice(i, 1);
  f.save();
  return g;
}

// Убрать исчезнувшие предметы; возвращает их gid
function purge(worldId, now = Date.now()) {
  const ttl = cfg().groundItemTtlSec ?? Math.max(0, (cfg().groundItemTtlMin || 0) * 60);
  list(worldId); // пометить тайники из старых сохранений как постоянные до очистки
  const f = fileFor(worldId);
  const db = f.get();
  const gone = db.items.filter((g) => !g.permanent && now - g.t >= ttl * 1000).map((g) => g.gid);
  if (gone.length) { db.items = db.items.filter((g) => !gone.includes(g.gid)); f.save(); }
  return gone;
}

// Удалить предметы мира и всех его уровней (шаг 13: «<id>~<ключ>.ground.json»)
function removeWorld(worldId) {
  const dir = path.join(dataPath(), 'worlds');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* нет папки */ }
  for (const n of names) {
    if (n !== `${worldId}.ground.json` && !(n.startsWith(worldId + '~') && n.endsWith('.ground.json'))) continue;
    files.delete(n.slice(0, -'.ground.json'.length));
    try { fs.unlinkSync(path.join(dir, n)); } catch { /* нет файла */ }
  }
  files.delete(worldId);
}

module.exports = { list, find, add, addMany, remove, purge, removeWorld, isFull,release:worldId=>files.delete(worldId) };
