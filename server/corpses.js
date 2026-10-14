'use strict';
const crypto = require('crypto');
const realtime = require('./realtime');
const config = require('./config');
const seconds = () => config.get().game.corpseLifetimeSec;
const bodies = room => room.corpses || (room.corpses = new Map());
function add(room, figure) {
  if (!seconds()) return;
  const corpse = { items: [], levelKey: room.level && room.level.key || null, ...figure, id: 'body-' + crypto.randomBytes(6).toString('hex'), born: Date.now() };
  bodies(room).set(corpse.id, corpse);
  room.broadcast({ t: 'corpse-add', corpse });
  return corpse;
}
function purge(room, now = Date.now()) {
  if (!room.corpses) return;
  const lifetime = seconds() * 1000;
  for (const [id, corpse] of room.corpses) if (!lifetime || now - corpse.born >= lifetime) {
    room.corpses.delete(id); room.broadcast({ t: 'corpse-remove', id });
  }
}
function setLifetime(value) {
  if (!Number.isInteger(value) || value < 0 || value > 65536) throw new Error('Время трупов: целое число от 0 до 65536 секунд.');
  config.get().game.corpseLifetimeSec = value;
  for (const room of realtime.rooms.values()) {
    purge(room);
    room.broadcast({ t: 'corpse-settings', seconds: value });
  }
  return value;
}
function restore(room, list) {
  for (const body of Array.isArray(list) ? list : []) if (body && typeof body.id === 'string' && Number.isFinite(body.born) && Number.isFinite(body.x) && Number.isFinite(body.y) && seconds() > 0 && Date.now() - body.born < seconds() * 1000) {
    const items = (Array.isArray(body.items) ? body.items : []).filter(x => x && Items.get(x.id) && Number.isSafeInteger(x.n) && x.n > 0).slice(0, 256);
    bodies(room).set(body.id, { ...body, items });
  }
}
function itemList(body) { return body.items.map((x, i) => ({ uid: x.uid || `body-${i}`, id: x.id, n: x.n, dur: x.dur, made: x.made, mag: x.mag, tier: x.tier })); }
function adminList(room) {
  purge(room);
  return [...bodies(room).values()].filter((b) => b.kind === 'creature' && b.def).map((b) => ({ id: b.id, name: b.name, def: b.def, level: b.level || 1, x: b.x, y: b.y, levelKey: b.levelKey || null, born: b.born }));
}
function adminAct(admin, room, body = {}) {
  const id = String(body.id || ''), corpse = bodies(room).get(id);
  if (!corpse || corpse.kind !== 'creature' || !corpse.def) throw new Error('Труп существа не найден (возможно, он уже исчез).');
  if (corpse.levelKey !== (room.level && room.level.key || null)) throw new Error('Труп находится на другом уровне.');
  const Enemies = require('../shared/enemies'), def = Enemies.get(corpse.def);
  if (!def) throw new Error('Для этого трупа нет записи в бестиарии.');
  let result;
  if (body.action === 'revive') {
    bodies(room).delete(id); room.broadcast({ t: 'corpse-remove', id });
    const enemy = require('./combat').spawnEnemy(room, def, corpse.level || def.level[0], corpse.x, corpse.y, null, { ignoreSafe: true });
    result = { action: 'revive', id: enemy.id, name: def.name };
  } else if (body.action === 'recruit') {
    const companion = require('./companions').adminGive({ username: body.username, character: body.character, def: def.id, level: corpse.level || def.level[0], out: true, cheat: true, x: corpse.x, y: corpse.y }, true);
    bodies(room).delete(id); room.broadcast({ t: 'corpse-remove', id });
    result = { action: 'recruit', companion: companion.companion, username: companion.username, character: companion.character };
  } else throw new Error('Действие должно быть revive или recruit.');
  require('./auth').logAdmin(admin, `corpse-${body.action}`, { worldId: room.id, corpse: id, enemy: def.id, target: body.username || null });
  return result;
}
function playerCanReach(c, body) {
  if (body.levelKey !== (c.room.level && c.room.level.key || null)) return false;
  const range = require('../shared/inventory').settings.pickupRange;
  return Math.hypot(c.pos.x - body.x, c.pos.y - body.y) <= range;
}
function view(c, body) {
  realtime.send(c, { t: 'corpse-inventory', id: body.id, items: itemList(body), born: body.born, secondsLeft: Math.max(0, Math.ceil(seconds() - (Date.now() - body.born) / 1000)) });
}
function act(c, msg) {
  const body = c.room && bodies(c.room).get(String(msg.id || ''));
  if (!body || !playerCanReach(c, body)) throw new Error('Подойдите к трупу ближе.');
  if (require('./combat').cbOf(c).dead) throw new Error('Мёртвый персонаж не может обыскивать труп.');
  if (msg.action === 'view') { view(c, body); return; }
  if (body.ownerLocked && body.player === c.account.id) throw new Error('В хардкоре вещи из старого трупа нельзя вернуть своему герою.');
  const inventory = require('./inventory'), Inv = require('../shared/inventory');
  if (msg.action === 'take') {
    const index = Number.isInteger(msg.index) ? msg.index : body.items.findIndex(x => x.uid === msg.uid);
    const item = body.items[index];
    if (!item) throw new Error('Такого предмета в трупе нет.');
    const n = msg.count == null ? item.n : Number(msg.count);
    if (!Number.isSafeInteger(n) || n < 1 || n > item.n) throw new Error('Неверное количество.');
    const copy = { ...item, n };
    const error = Inv.add(c.character, item.id, n, item.dur, copy);
    if (error) throw new Error(error);
    if (n === item.n) body.items.splice(index, 1); else item.n -= n;
    inventory.events.emit('changed', c.account.id, c.character);
    view(c, body);
    return;
  }
  if (msg.action === 'take-all') {
    let taken = 0;
    for (let i = 0; i < body.items.length;) {
      const item = body.items[i];
      const actionMax = item.id === 'caps' ? Number.MAX_SAFE_INTEGER : Inv.settings.itemActionMax;
      let low = 0, high = Math.min(item.n, actionMax);
      while (low < high) {
        const amount = Math.ceil((low + high) / 2);
        const probe = { ...c.character, inventory: {
          ...c.character.inventory,
          cells: c.character.inventory.cells.map(x => x ? { ...x } : null),
          equipment: Object.fromEntries(Object.entries(c.character.inventory.equipment || {}).map(([slot, x]) => [slot, x && { ...x }])),
        } };
        if (!Inv.add(probe, item.id, amount, item.dur, { ...item, n: amount })) low = amount; else high = amount - 1;
      }
      const moved = low;
      if (moved) Inv.add(c.character, item.id, moved, item.dur, { ...item, n: moved });
      if (!moved) { i++; continue; }
      item.n -= moved; taken += moved;
      if (!item.n) body.items.splice(i, 1); else i++;
    }
    if (taken) inventory.events.emit('changed', c.account.id, c.character);
    const left = body.items.reduce((sum, item) => sum + item.n, 0);
    realtime.send(c, { t: 'corpse-take-result', count: taken, left });
    view(c, body);
    return;
  }
  if (msg.action === 'put-equip') {
    const slot = String(msg.slot || ''), item = c.character.inventory.equipment && c.character.inventory.equipment[slot];
    if (!item || item.id === 'underwear_base') throw new Error('В этом слоте нет предмета.');
    if (body.items.length >= 256 && !body.items.some(x => x.id === item.id && Items.get(item.id)?.stackable && x.n < Items.get(item.id).stack)) throw new Error('В трупе закончилось место (256 ячеек).');
    const removed = Inv.removeAt(c.character, { c: 'eq', s: slot });
    if (removed.error) throw new Error(removed.error);
    const moved = removed.item;
    const def = Items.get(moved.id), stack = def && def.stackable && body.items.find(x => x.id === moved.id && x.n < def.stack);
    if (stack) { const count = Math.min(moved.n, def.stack - stack.n); stack.n += count; if (count < moved.n) body.items.push({ ...moved, n: moved.n - count, uid: crypto.randomBytes(8).toString('hex') }); }
    else body.items.push(moved);
    inventory.events.emit('changed', c.account.id, c.character); view(c, body); return;
  }
  if (msg.action === 'put') {
    const index = Number(msg.cell), from = { c: 'cell', i: index };
    const item = Inv.getAt(c.character, from);
    if (!item || item.id === 'underwear_base') throw new Error('Предмет не найден в сумке.');
    if (body.items.length >= 256 && !body.items.some(x => x.id === item.id && Items.get(item.id)?.stackable && x.n < Items.get(item.id).stack)) throw new Error('В трупе закончилось место (256 ячеек).');
    const n = msg.count == null ? item.n : Number(msg.count);
    const removed = Inv.removeAt(c.character, from, n);
    if (removed.error) throw new Error(removed.error);
    const obj = removed.item;
    if (obj.uid && body.items.some(x => x.uid === obj.uid)) obj.uid = require('crypto').randomBytes(8).toString('hex');
    const def = Items.get(obj.id);
    const stack = def && def.stackable && body.items.find(x => x.id === obj.id && x.n < def.stack);
    if (stack) { const moved = Math.min(obj.n, def.stack - stack.n); stack.n += moved; if (moved < obj.n) body.items.push({ ...obj, n: obj.n - moved, uid: require('crypto').randomBytes(8).toString('hex') }); }
    else body.items.push(obj);
    inventory.events.emit('changed', c.account.id, c.character);
    view(c, body);
    return;
  }
  throw new Error('Неизвестное действие с трупом.');
}
realtime.use({
  welcome: room => { purge(room); return { corpses: [...bodies(room).values()], corpseLifetimeSec: seconds() }; },
  tick: (room, dt, now) => { if (now >= (room.corpsePurgeAt || 0)) { room.corpsePurgeAt = now + 1000; purge(room, now); } },
  handlers: { 'corpse-settings': (c, msg) => {
    try { setLifetime(Number(msg.seconds)); }
    catch (e) { realtime.send(c, { t: 'corpse-error', message: e.message }); }
  }, 'corpse-act': (c, msg) => {
    try { act(c, msg); }
    catch (e) { realtime.send(c, { t: 'corpse-error', message: e.message }); }
  } },
});
const Items = require('../shared/items');
module.exports = { add, purge, setLifetime, restore, itemList, act, adminList, adminAct };
