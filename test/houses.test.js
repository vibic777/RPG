'use strict';
// Дома с интерьерами (shared/houses.js): расстановка по карте, этажи и подвалы (до +5 / −5), фасад = этажи,
// генерация этажей (комнаты, лестницы, мебель, сундуки, хлам, обитатели), двери и переходы, препятствия низкого полёта.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../shared/worldgen');
const L = require('../shared/levels');
const Hs = require('../shared/houses');
require('../shared/settlements');

const map = G.generate({ seed: 'houses-1', size: 'medium', name: 'Дома' });
const houses = Hs.list(map);

test('дома: детерминированы, на проходимых клетках, со свободным кольцом и не вплотную; дом непроходим', () => {
  assert.ok(houses.length>40&&houses.reduce((n,h)=>n+h.footprint.w*h.footprint.h,0)>2500,'город застроен зданиями настоящего размера: '+houses.length);
  const again = G.generate({ seed: 'houses-1', size: 'medium', name: 'Дома' });
  assert.deepEqual(Hs.list(again).map((h) => [h.x, h.y, h.floors, h.basement, h.style]), houses.map((h) => [h.x, h.y, h.floors, h.basement, h.style]));
  const W = map.width, city = houses.filter((h) => map.tiles[h.y * W + h.x] === G.B.CITY).length;
  assert.ok(city>=10,'городские кварталы содержат полноразмерные дома');
  const styles = new Set(houses.map((h) => h.style));
  assert.ok(styles.size >= 4, 'дома разные: ' + [...styles]);
  for (const h of houses) {
    assert.ok(map.walls.has(h.y * W + h.x) && !G.isWalkable(map, h.x, h.y), 'дом не пройти насквозь');
    assert.ok(G.isWalkable(map, h.door.x, h.door.y), 'перед дверью — проходимая клетка');
    const b=h.bounds;
    for(let y=b.y;y<b.y+b.h;y++)for(let x=b.x;x<b.x+b.w;x++){
      assert.equal(Hs.covering(map,x,y),h);assert.ok(map.walls.has(y*W+x),'entire footprint blocks movement');
    }
    for(let y=b.y-1;y<=b.y+b.h;y++)for(let x=b.x-1;x<=b.x+b.w;x++)if(x===b.x-1||x===b.x+b.w||y===b.y-1||y===b.y+b.h){
      assert.ok(G.isWalkable(map,x,y),'walkable lane around the real footprint');
      assert.equal(Hs.covering(map,x,y),null);
    }
    assert.ok(Math.abs(h.x - map.spawn.x) + Math.abs(h.y - map.spawn.y) > 4, 'не у точки появления');
  }
  for (const e of L.entrances(map)) assert.ok(!Hs.near(map, e.x, e.y, 1).length, 'входы уровней не заняты домами');
});

test('этажи: 1…5 и подвалы 0…5; крыша — уровень +этажей (не выше +5); фасад: рядов окон = этажей', () => {
  const floors = new Set(houses.map((h) => h.floors));
  for (const f of [1, 2, 3, 4, 5]) assert.ok(floors.has(f), 'есть дома в ' + f + ' эт.');
  assert.ok(houses.some((h) => h.basement > 0) && houses.some((h) => h.basement === 0));
  for (const h of houses) {
    assert.ok(h.floors >= 1 && h.floors <= 5 && h.basement >= 0 && h.basement <= 5);
    const f = Hs.facade(h);
    assert.equal(f.rows, h.floors, 'рядов окон столько же, сколько этажей');
    assert.equal(f.roofZ, h.floors, 'крыша над верхним рядом окон');
    assert.equal(f.basementWindows, h.basement > 0);
    assert.ok(Hs.parseKey(map, Hs.keyOf(h, h.floors)), 'крыша — уровень');
    assert.equal(Hs.parseKey(map, Hs.keyOf(h, h.floors + 1)), null, 'выше крыши — ничего');
    assert.equal(Hs.parseKey(map, Hs.keyOf(h, -h.basement - 1)), null, 'ниже последнего подвала — ничего');
  }
  const h3 = houses.find((h) => h.floors === 3);
  const keys = [0, 1, 2, 3].map((z) => L.level(map, Hs.keyOf(h3, z)));
  assert.ok(keys.every(Boolean));
  assert.deepEqual(keys.map((lv) => lv.roof), [false, false, false, true], '3 этажа + крыша');
  const h5 = houses.find((h) => h.floors === 5);
  assert.ok(L.level(map, Hs.keyOf(h5, 5)).roof && L.level(map, Hs.keyOf(h5, 5)).z === 5, '5 этажей — крыша на +5 (шестой уровень)');
  assert.ok(L.parseKey(map, Hs.keyOf(h3, 0)), 'ключ дома понимает и shared/levels.js');
  assert.equal(L.Z_MIN, -5);
});

test('интерьер: комнаты, лестницы в одном месте, мебель, сундуки, хлам и обитатели; всё достижимо', () => {
  const seen = { furniture: new Set(), occupants: new Set(), rooms: new Set() };
  let floorsChecked = 0;
  for (const h of houses.slice(0, 80)) {
    for (let z = -h.basement; z <= h.floors; z++) {
      const lv = L.level(map, Hs.keyOf(h, z));
      assert.ok(lv && lv.house === h && lv.type === 'house', 'этаж есть');
      floorsChecked++;
      const W = lv.width, idx = (p) => p.y * W + p.x;
      // лестницы: вверх — на всех, кроме крыши; вниз — на всех, кроме нижнего подвала; дверь — на первом этаже
      const ladder = lv.exits.find((e) => e.kind === 'ladder'), stairs = lv.exits.find((e) => e.kind === 'stairs'), door = lv.exits.find((e) => e.kind === 'door');
      assert.equal(Boolean(ladder), z < h.floors);
      assert.equal(Boolean(stairs), z > -h.basement);
      assert.equal(Boolean(door), z === 0);
      if (ladder) { assert.deepEqual([ladder.x, ladder.y], [h.sx, h.sy], 'лестница на одном месте каждого этажа'); const a = L.arrival(map, ladder.to); assert.equal(a.z, z + 1); assert.deepEqual([a.x, a.y], [h.sx + 2, h.sy], 'поднялись — у лестницы вниз'); }
      if (stairs) { const a = L.arrival(map, stairs.to); assert.equal(a.z, z - 1); assert.deepEqual([a.x, a.y], [h.sx, h.sy]); }
      if (door) assert.deepEqual([door.to.x, door.to.y], [h.door.x, h.door.y], 'дверь ведёт на улицу перед домом');
      if (lv.roof) assert.ok(lv.exits.some((e) => e.kind === 'jump' && e.to.fall === h.floors), 'с крыши можно спрыгнуть');
      // достижимость с учётом мебели (lv.walls)
      const reach = new Set([idx(lv.spawn)]), q = [lv.spawn];
      while (q.length) { const p = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = { x: p.x + dx, y: p.y + dy }; if (!reach.has(idx(n)) && G.isWalkable(lv, n.x, n.y)) { reach.add(idx(n)); q.push(n); } } }
      for (const e of lv.exits) assert.ok(reach.has(idx(e)), `выход ${e.kind} достижим (${lv.key})`);
      for (const c of lv.caches) assert.ok(reach.has(idx(c)), 'сундук достижим');
      for (const p of [...lv.spots, ...lv.residents]) assert.ok(reach.has(idx(p)), 'обитатель стоит в доступной комнате');
      let walk = 0; for (let i = 0; i < W * lv.height; i++) if (G.isWalkable(lv, i % W, (i / W) | 0)) walk++;
      assert.equal(reach.size, walk, 'мебель не отрезает части этажа');
      for (const p of lv.props) { seen.furniture.add(p.key); assert.equal(lv.walls.has(idx(p)), Hs.FURNITURE[p.key].block); }
      if (!lv.roof) { assert.ok(lv.rooms.length >= 1); assert.ok(lv.caches.length >= 1, 'на этаже есть сундук'); for (const r of lv.rooms) seen.rooms.add(r.kind); }
      if (lv.spots.length) seen.occupants.add('enemies');
      for (const r of lv.residents) seen.occupants.add(r.kind);
    }
  }
  assert.ok(floorsChecked > 150);
  for (const k of ['table', 'chair', 'bed', 'computer', 'chest', 'junk', 'shelf', 'wardrobe']) assert.ok(seen.furniture.has(k), 'есть ' + k);
  for (const k of ['enemies', 'neutral', 'resident']) assert.ok(seen.occupants.has(k), 'бывают ' + k);
  for (const k of ['living', 'bedroom', 'kitchen', 'office', 'storage']) assert.ok(seen.rooms.has(k), 'есть комната ' + k);
  const sample = L.level(map, Hs.keyOf(houses[0], 0));
  assert.deepEqual(L.level(G.generate({ seed: 'houses-1', size: 'medium', name: 'Дома' }), Hs.keyOf(houses[0], 0)).props, sample.props, 'интерьер детерминирован');
});

test('дверь: U у дома ведёт на первый этаж, оттуда — на улицу; дом — «вход» для возрождения', () => {
  const h = houses[0];
  const p = L.nearbyPortal(map, null, h.door.x + 0.5, h.door.y + 0.5);
  assert.ok(p && p.house && p.id === h.id && p.kind === 'door');
  const t = L.portalTarget(map, p);
  const lv = L.level(map, t.key);
  assert.equal(t.key, Hs.keyOf(h, 0));
  assert.deepEqual([t.x, t.y], [lv.exits.find((e) => e.kind === 'door').x, lv.exits.find((e) => e.kind === 'door').y]);
  const back = L.portalTarget(map, { ...L.nearbyPortal(map, lv, t.x + 0.5, t.y + 0.5), from: lv.key });
  assert.deepEqual(back, { key: 'ground', x: h.door.x, y: h.door.y, z: 0 });
  const ent = L.entranceById(map, h.id);
  assert.deepEqual([ent.x, ent.y, ent.type], [h.door.x, h.door.y, 'house']);
  assert.ok(L.KINDS.door && L.TYPES.house.house);
});

test('низкий полёт: дом — до крыши, лес — +2, горы — +4; над ними свободно', () => {
  const h = houses.find((x) => x.floors === 4);
  assert.equal(Hs.obstacleZ(map,h.x,h.y),Math.ceil(Hs.heightMeters(h)/1.7));
  assert.match(Hs.obstacleName(map, h.x, h.y), /4 эт/);
  const W = map.width, at = (b) => { const i = map.tiles.findIndex((t, j) => t === b && !Hs.covering(map, j % W, (j / W) | 0)); return { x: i % W, y: (i / W) | 0 }; };
  const f = at(G.B.FOREST), m = at(G.B.MOUNTAIN), wst = at(G.B.WASTE);
  assert.equal(Hs.obstacleZ(map, f.x, f.y), 2);
  assert.equal(Hs.obstacleZ(map, m.x, m.y), 4);
  assert.equal(Hs.obstacleZ(map, wst.x, wst.y), 0);
  assert.equal(Hs.obstacleZ(L.level(map, Hs.keyOf(h, 0)), 1, 1), 0, 'внутри уровней препятствий для полёта нет');
});

test('настройки домов: выключить; пределы этажей и подвалов', () => {
  const keep = { ...Hs.settings };
  try {
    Hs.configure({ housesEnabled: false });
    assert.equal(Hs.list(G.generate({ seed: 'houses-2', size: 'small', name: 'Пусто' })).length, 0);
    Hs.configure({ housesEnabled: true, houseMaxFloors: 2, houseMaxBasement: 0 });
    const hs = Hs.list(G.generate({ seed: 'houses-3', size: 'small', name: 'Низкие' }));
    assert.ok(hs.length && hs.every((h) => h.floors <= 2 && h.basement === 0));
    Hs.configure({ houseMaxFloors: 99, houseMaxBasement: -3 });
    assert.equal(Hs.settings.houseMaxFloors, 5);
    assert.equal(Hs.settings.houseMaxBasement, 0);
  } finally { Hs.configure(keep); }
});
