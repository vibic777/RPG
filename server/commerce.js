'use strict';
// Личные лавки, возвраты и обмен с двумя подтверждениями. Товары лавки — отдельный склад.
const crypto = require('crypto');
const { JsonFile, registerSchema } = require('./store');
const config = require('./config');
const characters = require('./characters');
const inventory = require('./inventory');
const realtime = require('./realtime');
const worlds = require('./worlds');
const Inv = require('../shared/inventory');
const Items = require('../shared/items');
registerSchema('commerce', 1);
const file = new JsonFile('commerce.json', { shops: [], mail: {}, pending: null }, { kind: 'commerce' });
const trades = new Map();
const settings = () => config.get().game;
const fail = message => { throw new Error(message); };
const integer = (value, min = 1) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min) fail('Нужно целое число в допустимом диапазоне.');
  return n;
};
const alive = c => c.room && !(c.cb && c.cb.dead) && c.ws.readyState === 1;
const limit = ch => Math.max(1, Math.min(5, Math.floor(ch.stats.shops || 1)));
characters.addMigration(ch => {
  const n = limit(ch);
  if (ch.stats.shops === n) return false;
  ch.stats.shops = n; return true;
});

// Журнал с готовыми записями позволяет завершить сделку после перезапуска,
// даже если между сохранениями двух персонажей пропало питание.
function recover() {
  const db = file.get();
  if (!db.pending) return db;
  for (const change of db.pending) {
    const ch = structuredClone(change.record);
    if (!characters.persist({ id: change.account }, ch)) fail('Не удалось восстановить запись участника сделки.');
    inventory.events.emit('changed', change.account, ch);
  }
  db.pending = null; file.data = db; file.save();
  return db;
}
function commit(next, changes = []) {
  next.pending = changes.map(({ c, ch }) => ({ account: c.account.id, record: ch }));
  file.data = next; file.save();
  recover();
  publish();
}
const inbox = (db, id) => db.mail[id] || (db.mail[id] = { items: [], money: 0 });
function moneyAdd(box, amount) {
  if (!Number.isSafeInteger(box.money + amount)) fail('Достигнут предел суммы денег.');
  box.money += amount;
}
function addInstance(ch, item) {
  const extra = { ...item }; delete extra.id; delete extra.n;
  return Inv.add(ch, item.id, item.n, item.dur, extra);
}
function pay(ch, n, free = false) {
  if (free) return;
  if (Inv.count(ch, 'caps') < n) fail('Не хватает крышек.');
  if (n) Inv.takeById(ch, 'caps', n);
}
function receive(ch, n) {
  if(!Number.isSafeInteger(Inv.count(ch,'caps') + n))fail('Достигнут предел денег в кошельке. Заберите выручку позже.');
  if (n) { const err = Inv.add(ch, 'caps', n); if (err) fail(err); }
}
function rowsOf(ch, rows, priced = false) {
  if (!Array.isArray(rows) || !rows.length || rows.length > settings().shopItemsMax) fail('Выберите товары (не больше ' + settings().shopItemsMax + ' позиций).');
  const seen = new Set();
  return rows.map(row => {
    const index = row.uid ? ch.inventory.cells.findIndex(x => x && x.uid === row.uid) : row.cell;
    if (!Number.isInteger(index) || index < 0 || index >= ch.inventory.cells.length) fail('Неверная ячейка.');
    const item = ch.inventory.cells[index], def = item && Items.get(item.id);
    if (!item || !def || def.fixed || item.id === 'caps' || seen.has(item.uid)) fail('Недоступный или повторяющийся предмет.');
    seen.add(item.uid);
    const count = integer(row.count);
    if (count > item.n) fail('В ячейке недостаточно предметов.');
    return { uid: item.uid, cell: index, count, snapshot: JSON.stringify(item), ...(priced ? { price: integer(row.price) } : {}) };
  });
}
function takeRows(ch, rows) {
  return rows.map(row => {
    const i = ch.inventory.cells.findIndex(x => x && x.uid === row.uid);
    if (i < 0) fail('Предложенный предмет уже перемещён или потрачен. Обновите предложение.');
    if (ch.inventory.cells[i].n < row.count || JSON.stringify(ch.inventory.cells[i]) !== row.snapshot) fail('Состояние предложенного предмета изменилось. Обновите предложение.');
    const result = Inv.removeAt(ch, { c: 'cell', i }, row.count);
    if (result.error) fail(result.error);
    return result.item;
  });
}
function publicShop(s) {
  return { id: s.id, room: s.room, world: s.world, worldName: s.worldName, location: s.location, owner: s.owner, name: s.name, title: s.title, x: s.x, y: s.y,
    items: s.items.map(x => ({ id: x.id, item: x.item, price: x.price })) };
}
function state(c, db = file.get()) {
  const mail = db.mail[c.character.id] || { items: [], money: 0 };
  return { t: 'commerce', shops: db.shops.filter(s => s.room === c.room.id).map(publicShop),
    own: db.shops.filter(s => s.owner === c.character.id).map(s => ({ ...publicShop(s), money: s.money })),
    limit: limit(c.character), inbox: mail };
}
function publish() {
  for (const c of realtime.byAccount.values()) if (c.room) realtime.send(c, state(c));
}
function closeShop(db, shop) {
  const mail = inbox(db, shop.owner);
  mail.items.push(...shop.items.map(x => ({ ...x.item, returnId: crypto.randomUUID() })));
  moneyAdd(mail, shop.money);
  db.shops = db.shops.filter(s => s.id !== shop.id);
}
function createShop(c, msg) {
  if (!Number.isFinite(c.pos.x) || !Number.isFinite(c.pos.y) || c.pos.x < 0 || c.pos.y < 0 || c.pos.x >= c.room.map.width || c.pos.y >= c.room.map.height) fail('Позиция лавки вне карты.');
  const db = structuredClone(recover());
  if (db.shops.filter(s => s.owner === c.character.id).length >= limit(c.character)) fail('Достигнут предел лавок. Развивайте «Количество лавок» или сверните одну из существующих.');
  const ch = structuredClone(c.character), rows = rowsOf(ch, msg.items, true), items = takeRows(ch, rows);
  db.shops.push({ id: crypto.randomUUID(), owner: ch.id, account: c.account.id, name: ch.name,
    title: String(msg.title || 'Лавка ' + ch.name).trim().slice(0, 60) || 'Лавка', room: c.room.id, world: c.room.worldId,
    worldName: c.room.world.name, location: c.room.level ? c.room.level.name : 'Поверхность',
    x: c.pos.x, y: c.pos.y, money: 0, items: items.map((item, i) => ({ id: crypto.randomUUID(), item, price: rows[i].price })) });
  commit(db, [{ c, ch }]);
}
function buy(c, msg) {
  const db = structuredClone(recover()), shop = db.shops.find(s => s.id === msg.shop);
  if (!shop || shop.room !== c.room.id) fail('Этой лавки здесь уже нет.');
  if (shop.owner === c.character.id) fail('Нельзя покупать в собственной лавке.');
  if (Math.hypot(shop.x - c.pos.x, shop.y - c.pos.y) > settings().shopBuyRange) fail('Подойдите к лавке ближе.');
  const row = shop.items.find(x => x.id === msg.item);
  if (!row) fail('Этот товар уже продан.');
  const n = integer(msg.count || 1);
  if (n > row.item.n) fail('Такого количества уже нет.');
  const total = row.price * n;
  if (!Number.isSafeInteger(total)) fail('Сумма покупки слишком большая.');
  const ch = structuredClone(c.character);
  pay(ch, total, realtime.godOf(c.account.id).infiniteMoney);
  const error = addInstance(ch, { ...row.item, n }); if (error) fail(error);
  moneyAdd(shop, total);
  row.item.n -= n;
  shop.items = shop.items.filter(x => x.item.n > 0);
  if (!shop.items.length) closeShop(db, shop);
  commit(db, [{ c, ch }]);
}
function closeOwned(c, msg) {
  const db = structuredClone(recover());
  const list = db.shops.filter(s => s.owner === c.character.id && (msg.all || s.id === msg.shop));
  if (!list.length) fail('Лавка не найдена.');
  for (const shop of list) closeShop(db, shop);
  commit(db);
}
function collect(c, msg) {
  const db = structuredClone(recover()), ch = structuredClone(c.character), mail = inbox(db, ch.id);
  const own = db.shops.filter(s => s.owner === ch.id && (!msg.shop || s.id === msg.shop));
  if (msg.money) {
    const sum = own.reduce((n,s) => n + s.money, msg.shop ? 0 : mail.money);
    if (!Number.isSafeInteger(sum)) fail('Сумма выше безопасного предела.');
    receive(ch, sum); if(!msg.shop)mail.money = 0; for (const s of own) s.money = 0;
  } else {
    const items = msg.item ? mail.items.filter(x => x.returnId === msg.item) : mail.items;
    if (!items.length) fail('Нет возвращённых вещей.');
    for (const item of items) { const x = { ...item }; delete x.returnId; const err = addInstance(ch, x); if (err) fail(err); }
    const ids = new Set(items.map(x => x.returnId)); mail.items = mail.items.filter(x => !ids.has(x.returnId));
  }
  commit(db, [{ c, ch }]);
}

// Обмен: вещи не исчезают до окончательной проверки и двух подтверждений.
const tradeOf = c => [...trades.values()].find(t => t.players.includes(c.account.id));
const participants = t => t.players.map(id => realtime.byAccount.get(id));
function tradeState(t) {
  const players = participants(t);
  const offers = t.players.map((id, i) => ({ player: id, name: players[i]?.character.name || 'Игрок', money: t.offers[id]?.money || 0,
    items: (t.offers[id]?.rows || []).map(row => {
      const item = players[i]?.character.inventory.cells.find(x => x && x.uid === row.uid);
      return { uid: row.uid, id: item?.id, count: row.count, dur: item?.dur };
    }), submitted: Boolean(t.offers[id]), confirmed: t.confirmed.includes(id) }));
  for (const c of players) if (c) realtime.send(c, { t: 'trade', id: t.id, phase: t.phase, revision: t.revision, inviter: t.players[0], offers, expires: t.expires });
}
function cancelTrade(t, message = 'Обмен отменён.') {
  trades.delete(t.id);
  for (const c of participants(t)) if (c) realtime.send(c, { t: 'trade-end', message });
}
function validTrade(t) {
  const [a,b] = participants(t);
  return a && b && alive(a) && alive(b) && a.room === b.room && Math.hypot(a.pos.x-b.pos.x,a.pos.y-b.pos.y) <= settings().tradeRange;
}
function invite(c, msg) {
  const other = realtime.byAccount.get(String(msg.player));
  if (!other || other === c || !alive(other) || other.room !== c.room || Math.hypot(c.pos.x-other.pos.x,c.pos.y-other.pos.y) > settings().tradeRange) fail('Выберите живого игрока рядом.');
  if (tradeOf(c) || tradeOf(other)) fail('Один из игроков уже занят обменом.');
  const t = { id: crypto.randomUUID(), players: [c.account.id, other.account.id], phase: 'invite', revision: 0, offers: {}, confirmed: [], expires: Date.now() + settings().tradeLifetimeSec * 1000 };
  trades.set(t.id,t); tradeState(t);
}
function exchange(c, msg) {
  if (msg.a === 'invite') return invite(c,msg);
  const t = tradeOf(c);
  if (!t || t.id !== msg.trade) fail('Этот обмен уже завершён.');
  if (msg.a === 'cancel') return cancelTrade(t);
  if (!validTrade(t) || Date.now() > t.expires) { cancelTrade(t, 'Обмен отменён: участник отошёл, погиб или время истекло.'); return; }
  if (msg.a === 'accept') {
    if (t.phase !== 'invite' || c.account.id === t.players[0]) fail('Нет входящего приглашения.');
    t.phase = 'offer'; tradeState(t); return;
  }
  if (t.phase !== 'offer') fail('Дождитесь принятия приглашения.');
  if (msg.a === 'offer') {
    const rows = Array.isArray(msg.items) && !msg.items.length ? [] : rowsOf(c.character,msg.items);
    const money = integer(msg.money || 0,0);
    if (Inv.count(c.character,'caps') < money) fail('Не хватает крышек для предложения.');
    t.offers[c.account.id] = { rows, money }; t.confirmed = [];
    t.revision++;
    t.expires = Date.now() + settings().tradeLifetimeSec * 1000; tradeState(t); return;
  }
  if (msg.a !== 'confirm') fail('Неизвестное действие обмена.');
  if (msg.revision !== t.revision) { tradeState(t); fail('Предложение изменилось. Просмотрите новые условия и подтвердите снова.'); }
  if (!t.players.every(id => t.offers[id])) fail('Оба участника должны отправить свои предложения (можно пустое).');
  if (!t.confirmed.includes(c.account.id)) t.confirmed.push(c.account.id);
  if (t.confirmed.length !== 2) { tradeState(t); return; }
  let transactionStarted = false;
  try {
    const db = structuredClone(recover()), players = participants(t), copies = players.map(p => structuredClone(p.character));
    const outgoing = copies.map((ch,i) => { const offer = t.offers[t.players[i]]; pay(ch, offer.money); return takeRows(ch,offer.rows); });
    copies.forEach((ch,i) => {
      for (const item of outgoing[1-i]) { const err = addInstance(ch,item); if (err) fail(err); }
      receive(ch,t.offers[t.players[1-i]].money);
    });
    // После записи журнала эта сделка не должна исполняться повторно,
    // в том числе обмен, содержащий только деньги.
    trades.delete(t.id); transactionStarted = true;
    commit(db, players.map((p,i) => ({ c:p, ch:copies[i] })));
    cancelTrade(t,'Обмен завершён.');
  } catch (error) {
    if(transactionStarted)cancelTrade(t,'Обмен закрыт после ошибки сохранения. Обновите инвентарь.');
    else { t.confirmed = []; tradeState(t); }
    throw error;
  }
}
function handle(c, msg) {
  try {
    recover();
    if (msg.a === 'list') { realtime.send(c,state(c)); return; }
    if (['close','closeAll'].includes(msg.a)) { closeOwned(c,{ ...msg, all:msg.a==='closeAll' }); return; }
    if (msg.a === 'collect') { collect(c,msg); return; }
    if (!alive(c)) fail('Это действие недоступно погибшему герою.');
    if (msg.a === 'create') createShop(c,msg);
    else if (msg.a === 'buy') buy(c,msg);
    else if (msg.a === 'trade') exchange(c,{ ...msg, a:msg.action });
    else fail('Неизвестное действие торговли.');
  } catch (error) { realtime.send(c,{ t:'commerce-error', message:error.message }); }
}
let checked = 0;
realtime.use({ name:'обмен и лавки', handlers:{ commerce:handle },
  welcome:(room,c) => ({ commerce:state(c,recover()) }),
  beforeLeave:(room,c) => { const t=tradeOf(c); if(t)cancelTrade(t,'Участник вышел — обмен отменён.'); },
  tick:(room,dt,now) => {
    if(now<checked)return; checked=now+1000;
    for(const t of trades.values())if(now>t.expires||!validTrade(t))cancelTrade(t,'Обмен отменён: участники отошли или время истекло.');
  },
});
worlds.on('removed',world => {
  const db=structuredClone(recover());
  for(const shop of db.shops.filter(s=>s.world===world.id))closeShop(db,shop);
  commit(db);
});
recover();
module.exports = { limit, recover, state };
