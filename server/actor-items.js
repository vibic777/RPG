'use strict';
// Вещи существ — настоящие экземпляры предметов, отдельно от таблицы случайного лута.
const Items = require('../shared/items');
const Inv = require('../shared/inventory');
const pools = new Map();
const humanoid = def => def && (['human', 'mutant', 'mage', 'cyborg', 'undead', 'zombie'].includes(def.family) && (!def.look || ['humanoid', 'cyborg', 'zombie'].includes(def.look.shape)));
function generate(def, level = 1) {
  const equip = {}, bag = [];
  if (!humanoid(def)) return { equip, bag };
  const choose = (slot) => {
    const key = [def.family, def.look && def.look.weapon, def.attack && def.attack.kind, level, slot].join('|');
    if (pools.has(key)) { const pool = pools.get(key); return pool.length ? Inv.makeItem(pool[Math.floor(Math.random() * pool.length)].id) : null; }
    let pool = Items.ITEMS.filter(it => !it.fixed && !it.set && (it.level || 1) <= level && Items.slotsFor(it).includes(slot) && !it.placeable);
    if (slot === 'mainHand' && def.look && def.look.weapon) {
      const matching = pool.filter(it => it.icon.shape === def.look.weapon);
      if (matching.length) pool = matching;
      else if (def.attack) pool = pool.filter(it => require('../shared/combat').profile(it).kind === def.attack.kind);
    }
    if (pools.size >= 2048) pools.clear();
    pools.set(key, pool);
    return pool.length ? Inv.makeItem(pool[Math.floor(Math.random() * pool.length)].id) : null;
  };
  for (const slot of ['shirt', 'pants', 'feet']) { const x = choose(slot); if (x) equip[slot] = x; }
  const weapon = choose('mainHand'); if (weapon) {
    equip.weapon = weapon;
    const ammo = Items.get(weapon.id).weapon && Items.get(weapon.id).weapon.ammo;
    if (ammo && Items.get(ammo)) bag.push(Inv.makeItem(ammo, Math.min(10, Items.get(ammo).stack)));
  }
  for (const slot of ['armor', 'head', 'outer', 'hands', 'back']) if (Math.random() < 0.35) { const x = choose(slot); if (x) equip[slot] = x; }
  const supplies = supplyPool;
  if (supplies.length && Math.random() < 0.5) bag.push(Inv.makeItem(supplies[Math.floor(Math.random() * supplies.length)].id));
  return { equip, bag };
}
const supplyPool = Items.ITEMS.filter(it => !it.fixed && it.category === 'consumable' && it.effect && (it.effect.food > 0 || it.effect.water > 0));
function look(equip = {}) {
  const equipment = { ...equip, mainHand: equip.weapon || equip.mainHand };
  return { ...Object.fromEntries(Inv.SLOT_IDS.map(s => [s, null])), ...Inv.look({ inventory: { equipment, cells: [] }, stats: {} }) };
}
function belongings(actor) { return [...Object.values(actor.equip || {}), ...(actor.bag || [])].filter(x => x && Items.get(x.id) && !Items.get(x.id).fixed); }
// Guaranteed harvest is separate from random loot; generated once at death.
function harvest(def, rnd = Math.random) {
  if (!def) return [];
  const size = Math.max(0.4, Math.min(3, Number(def.look?.size) || 1));
  const meat = () => ({ id:'meat_raw',n:Math.max(1,Math.round(size*(1+rnd()*2))),made:Date.now() });
  if (def.family === 'insect' || def.id === 'crab_mutant') return [meat(),{id:'chitin',n:Math.max(1,Math.round(size))}];
  if (def.family !== 'animal' && def.family !== 'dragon') return [];
  if (def.id === 'mutant_eel') return [meat()];
  return [meat(),{id:'hide',n:Math.max(1,Math.round(size))}];
}
function drop(room, actor, pos, owner) {
  const ground = require('./ground');
  for (const x of belongings(actor)) {
    if (ground.isFull(room.id)) break;
    const item = ground.add(room.id, { ...x }, { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100 }, owner);
    room.broadcast({ t: 'ground-add', item });
  }
}
module.exports = { generate, look, belongings, harvest, drop };
