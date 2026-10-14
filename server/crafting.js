'use strict';
// Крафт (данные — shared/crafting.js). Очередь — у героя (ch.craft), поэтому переживает выход и перезапуск:
// каждый заказ { id, r, n, done } — рецепт, сколько раз, когда готов. Материалы списываются сразу при заказе
// (атомарно, одной записью героя), готовое кладётся в сумку (не влезло — на землю под ноги).
// Изучение: свитки рецептов (предмет с полем teaches), администратор (выдать рецепт).
const crypto = require('crypto');
const realtime = require('./realtime');
const chat = require('./chat');
const { HttpError } = require('./auth');
const inventory = require('./inventory');
const building = require('./building');
const C = require('../shared/crafting');
const Inv = require('../shared/inventory');
const Items = require('../shared/items');

const queueOf = (ch) => (Array.isArray(ch.craft) ? ch.craft : []);
const publicQueue = (ch) => queueOf(ch).map((q) => ({ id: q.id, r: q.r, n: q.n, done: q.done }));
const view = (ch) => ({ known: [...C.known(ch)], queue: publicQueue(ch) });
const sendView = (c) => realtime.send(c, { t: 'craft', ...view(c.character) });

// Поставить в очередь: stations — Set станков рядом (в мире — server/building.js stationsNear)
function enqueue(account, charId, recipeId, times, stations, factor = 1) {
  const r = C.get(String(recipeId || ''));
  const n = Number(times == null ? 1 : times);
  if (!Number.isInteger(n) || n < 1 || n > 20) return { error: 'Сколько раз — от 1 до 20.' };
  let order = null;
  try {
    inventory.mutate(account, charId, (ch) => {
      const err = C.check(ch, r, n, { stations });
      if (err) return err;
      const q = queueOf(ch);
      if (q.length >= C.settings.craftQueueMax) return `В очереди уже ${C.settings.craftQueueMax} заказов.`;
      for (const [id, k] of Object.entries(r.in)) if (Inv.takeById(ch, id, k * n) !== k * n) return 'Материалы изменились — попробуйте ещё раз.';
      const start = Math.max(Date.now(), q.length ? q[q.length - 1].done : 0);
      order = { id: 'q' + crypto.randomBytes(3).toString('hex'), r: r.id, n, done: start + Math.round(r.time * n * C.settings.craftTimeFactor * factor * 1000) }; // factor — помощник-ремесленник семьи (шаг 17)
      ch.craft = [...q, order];
      return null;
    });
  } catch (e) { return { error: e.message }; }
  return { order };
}

// Отменить заказ: материалы возвращаются (что не влезло — на землю, если герой в мире)
function cancel(c, id) {
  let back = [];
  inventory.mutate(c.account, c.character.id, (ch) => {
    const q = queueOf(ch), o = q.find((x) => x.id === id);
    if (!o) return 'Такого заказа нет.';
    ch.craft = q.filter((x) => x !== o);
    // следующие заказы сдвигаются раньше
    const r = C.get(o.r), dt = Math.max(0, o.done - Math.max(Date.now(), o.done - Math.round(r.time * o.n * C.settings.craftTimeFactor * 1000)));
    for (const x of ch.craft) if (x.done > o.done) x.done -= dt;
    back = Object.entries(r.in).map(([k, v]) => ({ id: k, n: v * o.n }));
    return null;
  });
  giveOrDrop(c, back);
}

function giveOrDrop(c, items) {
  const rest = [];
  inventory.mutate(c.account, c.character.id, (ch) => { for (const x of items) if (Inv.add(ch, x.id, x.n)) rest.push(x); return null; });
  if (rest.length && c.room) {
    const ground = require('./ground');
    for (const x of rest) {
      if (ground.isFull(c.room.id)) break;
      const it = Items.get(x.id);
      const g = ground.add(c.room.id, { id: x.id, n: x.n, dur: it.durability || undefined, made: it.spoils ? Date.now() : undefined }, { x: Math.round(c.pos.x * 100) / 100, y: Math.round(c.pos.y * 100) / 100 }, c.character.name);
      c.room.broadcast({ t: 'ground-add', item: g });
    }
  }
  return rest;
}

// Выдать готовые заказы подключённому герою
function deliver(c, now = Date.now()) {
  const ready = queueOf(c.character).filter((q) => q.done <= now);
  if (!ready.length) return 0;
  const ids = new Set(ready.map((q) => q.id));
  inventory.mutate(c.account, c.character.id, (ch) => { ch.craft = queueOf(ch).filter((q) => !ids.has(q.id)); return null; });
  const items = ready.map((q) => { const r = C.get(q.r); return r && r.out ? { id: r.out.id, n: r.out.n * q.n } : null; }).filter(Boolean);
  const rest = giveOrDrop(c, items);
  require('./quests').onCraft(c.room, c, items); // цели заданий «изготовить» (шаг 16)
  for (const q of ready) chat.tell(c, `Готово: ${C.get(q.r).name}${q.n > 1 ? ` × ${q.n}` : ''}.`);
  if (rest.length) chat.tell(c, 'Не хватило места в сумке — часть готового лежит на земле.');
  sendView(c);
  return ready.length;
}

// Свиток рецепта: использование предмета
function onUse(ch, inst, it, ctx, take) {
  if (!it.teaches) return undefined;
  const err = C.learn(ch, it.teaches);
  if (err) return err;
  take();
  const c = ctx && ctx.client;
  if (c) { chat.tell(c, `Изучен рецепт: ${C.get(it.teaches).name}. Книга рецептов — K.`); setImmediate(() => { if (c.character) sendView(c); }); }
  return null;
}
Inv.setUseHook(onUse, true);

// Администратор: выдать рецепт (или все: recipe = 'all')
function adminGive(admin, body = {}) {
  const { acc, ch } = inventory.resolveTarget(body.username, body.character);
  const id = String(body.recipe || '').trim();
  const list = id === 'all' ? C.RECIPES.map((r) => r.id) : [id];
  if (id !== 'all' && !C.get(id)) throw new HttpError(400, `Неизвестный рецепт «${id}».`);
  const { record } = inventory.mutate(acc, ch.id, (x) => { x.recipes = [...new Set([...(Array.isArray(x.recipes) ? x.recipes : []), ...list])]; return null; });
  inventory.notify(acc.id, record.id, id === 'all' ? 'Администратор открыл вам все рецепты.' : `Администратор научил вас рецепту: ${C.get(id).name}.`);
  const c = realtime.byAccount.get(acc.id);
  if (c && c.character && c.character.id === record.id) sendView(c);
  return { username: acc.username, character: record.name, recipes: list.length };
}

function workshop(c,m) {
  if(!c.room||c.cb?.dead)return 'Мастерская доступна живому герою в мире.';
  const item=Items.get(String(m.item||'')),plan=C.workshopPlan(item);
  if(!plan)return 'Этот предмет нельзя изготовить в мастерской.';
  if(!building.stationsNear(c.room,c).has(plan.station))return 'Подойдите к станку: '+C.STATIONS[plan.station].name;
  if(Date.now()<(c.workshopNext||0))return 'Подождите завершения работы инструмента.';
  inventory.mutate(c.account,c.character.id,ch=>{
    let old=null,i=null;
    if(m.upgrade){
      i=Number(m.cell);if(!Number.isInteger(i)||i<0||i>=ch.inventory.cells.length)return 'Выберите ячейку предмета для улучшения.';
      old=ch.inventory.cells[i];const def=old&&Items.get(old.id);
      if(!def||old.n!==1||def.category!==item.category||def.slot!==item.slot||Boolean(def.weapon)!==Boolean(item.weapon)||def.weapon&&def.weapon.class!==item.weapon.class)return 'Для улучшения нужен предмет того же типа и слота, один в стопке.';
      if(old.id===item.id)return 'Это уже выбранная модель.';
      if(!C.workshopPlan(def))return 'Этот предмет не улучшается.';
    }
    for(const [id,n]of Object.entries(plan.cost))if(Inv.count(ch,id)<n)return 'Не хватает: '+Items.get(id).name+' × '+n;
    for(const [id,n]of Object.entries(plan.cost))Inv.takeById(ch,id,n);
    if(old){const next=Inv.makeItem(item.id);ch.inventory.cells[i]={...next,uid:old.uid,n:1};}
    else {const err=Inv.add(ch,item.id,1);if(err)return err;}
    return null;
  });
  c.workshopNext=Date.now()+1000;chat.tell(c,(m.upgrade?'Улучшено: ':'Изготовлено: ')+item.name);return null;
}
realtime.use({
  welcome: (room, c) => ({ craft: view(c.character) }),
  tick: (room, dt, now) => {
    if (!room.craftNext || now >= room.craftNext) {
      room.craftNext = now + 500;
      for (const c of room.players.values()) if (queueOf(c.character).some((q) => q.done <= now)) { try { deliver(c, now); } catch (e) { console.warn('[crafting]', e.message); } }
    }
  },
  handlers: {
    craft: (c, msg) => {
      const m = msg && typeof msg === 'object' ? msg : {};
      try {
        if(m.a==='workshop'){const err=workshop(c,m);if(err)return realtime.send(c,{t:'craft-reject',message:err});}
        else if (m.a === 'cancel') cancel(c, String(m.id || ''));
        else if (m.a === 'list') { /* только прислать книгу */ } else {
          const r = enqueue(c.account, c.character.id, m.recipe, m.n, building.stationsNear(c.room, c), require('./family').craftFactor(c));
          if (r.error) return realtime.send(c, { t: 'craft-reject', message: r.error });
          const rec = C.get(r.order.r);
          chat.tell(c, `В работе: ${rec.name}${r.order.n > 1 ? ` × ${r.order.n}` : ''} — ${Math.ceil((r.order.done - Date.now()) / 1000)} с.`);
        }
      } catch (e) { return realtime.send(c, { t: 'craft-reject', message: e.message }); }
      realtime.send(c, { t: 'craft', ...view(c.character), stations: [...building.stationsNear(c.room, c)] });
    },
  },
});

module.exports = { enqueue, cancel, deliver, view, adminGive, onUse };
