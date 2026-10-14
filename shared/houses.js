// Дома городов и хуторов: каждый дом — настоящая постройка, в которую можно войти (U у двери).
// Детерминированно по сиду мира (сервер и клиенты строят одно и то же без передачи данных):
//   • дом занимает участок по габаритам фасада и не даёт пройти (map.walls); вокруг него всегда свободное кольцо клеток,
//     поэтому дома никогда не перекрывают проходы;
//   • этажей 1…5 (z 0…этажи−1), крыша — уровень z = этажи (не выше +5), подвалы — до −5;
//   • снаружи: рядов окон столько же, сколько этажей, над ними крыша; есть подвал — у цоколя полуподвальные окна;
//   • внутри — комнаты с дверными проёмами, лестницы вверх и вниз в одном и том же месте каждого этажа,
//     мебель (столы, стулья, кровати, компьютеры, шкафы…), сундуки с добычей, хлам;
//     иногда враги, иногда нейтральные бродяги, иногда мирные жильцы.
// Общий файл: shared/levels.js (ключи уровней «h<клетка>.<z>»), сервер (заселение) и клиент (фасады, мебель).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./worldgen'));
  else root.Houses = factory(root.WorldGen);
})(typeof self !== 'undefined' ? self : this, function (WorldGen) {
  'use strict';
  const { B, BIOMES, mulberry32, hashString } = WorldGen;

  // Настраиваемые значения (config.game, «--help» сервера)
  const settings = {
    housesEnabled: true, // дома с интерьерами на карте
    houseCityChance: 0.12, // реже ставим здания, чтобы между ними оставались улицы и открытые площадки
    houseWildChance: 0.006, // то же на пустоши/в лесу/предгорьях/пустыне — одинокие хутора
    houseMaxFloors: 5, // предел этажей (крыша — на уровне этажей, не выше +5)
    houseMaxBasement: 5, // предел подвалов (не глубже −5)
    houseEnemyChance: 0.3, // доля этажей с врагами
    houseNeutralChance: 0.15, // доля этажей с нейтральными бродягами (не нападают первыми)
    houseResidentChance: 0.3, // доля этажей с мирными жильцами
  };
  function configure(o = {}) {
    for (const k of Object.keys(settings)) if (o && o[k] !== undefined && typeof o[k] === typeof settings[k]) settings[k] = o[k];
    settings.houseMaxFloors = Math.max(1, Math.min(5, Math.floor(settings.houseMaxFloors)));
    settings.houseMaxBasement = Math.max(0, Math.min(5, Math.floor(settings.houseMaxBasement)));
  }

  // Виды домов: city — для городских руин; roof — плоская (flat) или двускатная (gable); win — окон в ряду фасада
  const STYLES = {
    block: { name: 'Жилой дом', city: true, roof: 'flat', win: 3, color: '#8c877c', rooms: ['living', 'bedroom', 'kitchen', 'bedroom', 'bath'] },
    office: { name: 'Контора', city: true, roof: 'flat', win: 4, color: '#6f7a80', rooms: ['office', 'office', 'meeting', 'storage'] },
    shop: { name: 'Магазин с квартирами', city: true, roof: 'flat', win: 3, color: '#97806a', rooms: ['living', 'bedroom', 'kitchen'], ground: ['shop', 'storage'] },
    cottage: { name: 'Дом', city: false, roof: 'gable', win: 2, color: '#a08566', rooms: ['living', 'bedroom', 'kitchen'] },
    farm: { name: 'Хутор', city: false, roof: 'gable', win: 2, color: '#8b5a48', rooms: ['kitchen', 'bedroom', 'storage'] },
  };
  // Мебель: name — подсказка, block — загораживает клетку
  const FURNITURE = {
    table: { name: 'Стол', block: true }, chair: { name: 'Стул', block: false }, bed: { name: 'Кровать', block: true },
    computer: { name: 'Стол с компьютером', block: true }, sofa: { name: 'Диван', block: true }, wardrobe: { name: 'Шкаф', block: true },
    shelf: { name: 'Стеллаж', block: true }, stove: { name: 'Плита', block: true }, fridge: { name: 'Холодильник', block: true },
    counter: { name: 'Прилавок', block: true }, tv: { name: 'Телевизор', block: true }, sink: { name: 'Умывальник', block: true },
    crate: { name: 'Ящик', block: true }, barrel: { name: 'Бочка', block: true }, boiler: { name: 'Котёл', block: true },
    vent: { name: 'Вентиляция', block: true }, tank: { name: 'Бак с водой', block: true }, antenna: { name: 'Антенна', block: true },
    chest: { name: 'Сундук', block: false }, junk: { name: 'Хлам', block: false },
    stairs_up: { name: 'Лестничный пролёт вверх', block: false }, stairs_down: { name: 'Лестничный пролёт вниз', block: false }, stair_landing: { name: 'Площадка лестницы', block: false },
  };
  // Что ставить в комнате: [вид, сколько] — у стен; table/sofa — ближе к середине
  const ROOMS = {
    living: [['sofa', 1], ['table', 1], ['chair', 2], ['tv', 1], ['shelf', 1]],
    bedroom: [['bed', 1], ['wardrobe', 1], ['chair', 1], ['bed', 1]],
    kitchen: [['table', 1], ['chair', 3], ['stove', 1], ['fridge', 1], ['sink', 1]],
    bath: [['sink', 1], ['shelf', 1]],
    office: [['computer', 2], ['chair', 2], ['shelf', 1], ['computer', 1]],
    meeting: [['table', 2], ['chair', 4], ['computer', 1]],
    shop: [['counter', 1], ['shelf', 4], ['crate', 1]],
    storage: [['shelf', 2], ['crate', 2], ['barrel', 1]],
    boiler: [['boiler', 1], ['barrel', 2], ['crate', 1]],
  };
  const ROOM_NAMES = { living: 'гостиная', bedroom: 'спальня', kitchen: 'кухня', bath: 'ванная', office: 'кабинет', meeting: 'переговорная', shop: 'торговый зал', storage: 'кладовая', boiler: 'котельная' };

  const h01 = (seed, x, y, salt) => { let h = Math.imul(seed ^ salt, 0x9e3779b1) ^ Math.imul(x, 0x85ebca6b) ^ Math.imul(y, 0xc2b2ae35); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
  const chanceOf = (t) => (t === B.CITY ? settings.houseCityChance : t === B.WASTE ? settings.houseWildChance : t === B.FOREST || t === B.HILLS || t === B.DESERT ? settings.houseWildChance * 0.5 : 0);

  // ---------- Расстановка по карте ----------
  const cache = new WeakMap();
  // avoid — точки, рядом с которыми домов нет (входы уровней shared/levels.js и их вторые выходы)
  function place(map, avoid = []) {
    let c = cache.get(map);
    if (c) return c;
    c = { list: [], byIndex: new Map(), coverage:new Map() };
    cache.set(map, c);
    if (!settings.housesEnabled || !map || !map.tiles || map.level || map.z) return c;
    const W = map.width, H = map.height, T = map.tiles, seed = hashString(String(map.seed)) ^ 0x4f1bbcdc;
    const at = (x, y) => T[y * W + x];
    const sp = map.spawn || { x: W >> 1, y: H >> 1 };
    const bad = new Uint8Array(W * H); // вокруг особых мест — без домов
    const mark = (x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H) bad[Y * W + X] = 1; } };
    mark(sp.x, sp.y, 4);
    for (const s of map.settlements || []) mark(s.x, s.y, Math.max(18,(map.towns||[]).find(t=>t.id===s.id)?.r+3||18));
    for (const d of map.depots || []) mark(d.x, d.y, 3);
    for (const l of map.lairs || []) mark(l.x, l.y, 3);
    for (const p of avoid) mark(p.x, p.y, 2);
    const ok = (x, y) => {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      const i = y * W + x;
      if (!BIOMES[T[i]].walkable || T[i] === B.ROAD || (map.walls && map.walls.has(i)) || (map.playMask && !map.playMask[i])) return false;
      return !map.region || map.region[i] === map.mainRegion;
    };
    const score = (x, y) => h01(seed, x, y, 0x51);
    const cand = (x, y) => {
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) return false;
      const i = y * W + x;
      if (bad[i] || !(score(x, y) < chanceOf(T[i])) || !ok(x, y)) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !ok(x + dx, y + dy)) return false; // свободное кольцо
      return true;
    };
    // Reserve the real footprint and a two-cell service lane around each building.
    const reserved=new Set();
    for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){
      if(chanceOf(at(x,y))<=0||!cand(x,y))continue;
      const h=make(map,seed,x,y,at(x,y)===B.CITY),b=h.bounds;
      let clear=true;
      for(let yy=b.y-2;yy<b.y+b.h+2&&clear;yy++)for(let xx=b.x-2;xx<b.x+b.w+2;xx++){
        const index=yy*W+xx;
        if(!ok(xx,yy)||bad[index]||reserved.has(index)){clear=false;break;}
      }
      if(!clear)continue;
      c.list.push(h);c.byIndex.set(h.i,h);
      for(let yy=b.y;yy<b.y+b.h;yy++)for(let xx=b.x;xx<b.x+b.w;xx++)c.coverage.set(yy*W+xx,h);
      for(let yy=b.y-2;yy<b.y+b.h+2;yy++)for(let xx=b.x-2;xx<b.x+b.w+2;xx++)reserved.add(yy*W+xx);
    }
    return c;
  }
  function make(map, seed, x, y, city) {
    const i = y * map.width + x, rnd = mulberry32(seed ^ Math.imul(i + 1, 2654435761));
    const keys = Object.keys(STYLES).filter((k) => STYLES[k].city === city);
    const style = keys[Math.floor(rnd() * keys.length)];
    let floors;
    if (city) { const r = rnd(); floors = r < 0.15 ? 1 : r < 0.4 ? 2 : r < 0.65 ? 3 : r < 0.85 ? 4 : 5; }
    else floors = rnd() < 0.6 ? 1 : 2;
    const r = rnd();
    let basement = r < 0.55 ? 0 : r < 0.8 ? 1 : r < 0.92 ? 2 : 3 + Math.floor(rnd() * 3);
    floors = Math.min(settings.houseMaxFloors, floors);
    basement = Math.min(settings.houseMaxBasement, basement);
    const big = style === 'block' || style === 'office';
    const v = rnd();
    const w = big ? 18 + Math.floor(v * 7) : city ? 15 + Math.floor(v * 5) : 12 + Math.floor(v * 4);
    const h = big ? 15 + Math.floor(rnd() * 6) : city ? 13 + Math.floor(rnd() * 4) : 11 + Math.floor(rnd() * 3);
    const sx = 2 + Math.floor(rnd() * Math.max(1, w - 8));
    const damage = rnd();
    const condition = damage < 0.08 ? 'ruined' : damage < 0.3 ? 'damaged' : damage < 0.58 ? 'weathered' : 'intact';
    const [fw,fh]=({block:[11,9],office:[13,11],shop:[9,7],cottage:[5,5],farm:[7,5]})[style];
    const bounds={x:x-Math.floor(fw/2),y:y-Math.floor(fh/2),w:fw,h:fh};
    return { id: 'h' + i, i, x, y, footprint:{w:fw,h:fh},bounds,door: { x, y:bounds.y+fh }, style, name: STYLES[style].name, floors, basement, condition, variant: Math.round(v * 1000) / 1000, w, h, sx, sy: 2 };
  }
  const list = (map, avoid) => place(map, avoid).list;
  const at = (map, x, y) => (map && !map.level && cache.get(map) ? cache.get(map).byIndex.get(y * map.width + x) || null : null);
  const covering=(map,x,y)=>map&&!map.level?cache.get(map)?.coverage.get(Math.floor(y)*map.width+Math.floor(x))||null:null;
  const byId = (map, id) => { const m = /^h(\d{1,7})$/.exec(String(id || '')); if (!m || !map || !cache.get(map)) return null; return cache.get(map).byIndex.get(Number(m[1])) || null; };
  // Дома в радиусе r клеток от точки (поиск по клеткам вокруг, а не по всему списку)
  function near(map, x, y, r = 2) {
    const out = [],seen=new Set(), cx = Math.floor(x), cy = Math.floor(y), R = Math.ceil(r) + 1;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const h = covering(map, cx + dx, cy + dy); if (h&&!seen.has(h.id)){seen.add(h.id);out.push(h);} }
    return out;
  }
  // Слой непроходимых клеток: дома добавляются к map.walls (стены поселений — shared/settlements.js)
  function apply(map, avoid) {
    const c = place(map, avoid);
    if (!c.list.length) return map;
    if (!map.walls) map.walls = new Set();
    for (const i of c.coverage.keys()) map.walls.add(i);
    return map;
  }

  // ---------- Фасад: ряды окон = этажи, крыша над ними ----------
  function facade(house) {
    const st = STYLES[house.style];
    return { rows: house.floors, roofZ: house.floors, roof: st.roof, windowsPerRow: st.win, basementWindows: house.basement > 0, color: st.color };
  }
  // Высота препятствия на клетке поверхности для низкого полёта (z): дом — до крыши, лес — +2, горы — +4, стены поселений — +1
  const heightMeters=h=>(h.floors*1.7+.3+(h.condition==='ruined'?.1:STYLES[h.style]?.roof==='gable'?1.6:h.floors>=3?.95:.43))*3/1.7;
  function obstacleZ(map, x, y) {
    if (!map || map.level) return 0;
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
    const h = covering(map, x, y);
    if (h) return Math.ceil(heightMeters(h)/1.7);
    for(const town of map.towns||[])for(const b of town.buildings||[])if(b.built&&x>=b.x&&y>=b.y&&x<b.x+b.w&&y<b.y+b.h){
      const style=b.kind==='market'?'shop':b.kind==='tower'?'office':town.style==='wood'?'farm':b.kind==='house'?'cottage':'block';
      return Math.ceil(heightMeters({floors:b.kind==='tower'?3:1,style,condition:'weathered'})/1.7);
    }
    const t = map.tiles[y * map.width + x];
    if (t === B.MOUNTAIN) return 4;
    if (t === B.FOREST) return 2;
    if (map.walls && map.walls.has(y * map.width + x)) return 1;
    return 0;
  }
  function obstacleName(map, x, y) {
    const h = covering(map, Math.floor(x), Math.floor(y));
    if (h) return `${h.name.toLowerCase()} (${h.floors} эт., крыша +${h.floors})`;
    const t = WorldGen.tileAt(map, Math.floor(x), Math.floor(y));
    return t === B.MOUNTAIN ? 'скалы (до +4)' : t === B.FOREST ? 'деревья (до +2)' : 'стену (+1)';
  }

  // ---------- Ключи уровней ----------
  const KEY_RE = /^h(\d{1,7})\.(-?\d)$/;
  const keyOf = (house, z) => `h${house.i}.${z}`;
  function parseKey(map, key) {
    const m = KEY_RE.exec(String(key || ''));
    if (!m) return null;
    const house = byId(map, 'h' + m[1]);
    const z = Number(m[2]);
    if (!house || z > house.floors || z < -house.basement) return null;
    return { house, z };
  }
  const floorName = (house, z) => (z === house.floors ? 'крыша' : z < 0 ? (z === -1 ? 'подвал' : `подвал ${-z}`) : `${z + 1}-й этаж`);

  // ---------- Интерьер этажа ----------
  function interior(map, house, z) {
    const W = house.w, H = house.h, roof = z === house.floors, under = z < 0;
    const rnd = mulberry32(hashString(String(map.seed) + '|house|' + house.i + '|' + z + '|' + (house.condition || 'intact')));
    const tiles = new Uint8Array(W * H).fill(roof ? B.SKY : B.WALL);
    const I = (x, y) => y * W + x, P = (i) => ({ x: i % W, y: (i / W) | 0 });
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) tiles[I(x, y)] = roof ? B.ROOF : B.FLOOR;
    const reserved = new Set(); // проходы: не загораживать
    const reserve = (x, y) => { for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) reserved.add(I(x + dx, y + dy)); };
    // комнаты: деление прямоугольника стенами с дверным проёмом в каждой
    const rooms = [];
    function split(x0, y0, x1, y1, depth) {
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const canV = w >= 9, canH = h >= 9;
      if (depth > 4 || (!canV && !canH) || (depth > 1 && rnd() < 0.2)) { rooms.push({ x0, y0, x1, y1 }); return; }
      if (canV && (!canH || w >= h)) {
        const cx = x0 + 4 + Math.floor(rnd() * (w - 8));
        const door = y0 + Math.floor(rnd() * h);
        for (let y = y0; y <= y1; y++) if (y !== door) tiles[I(cx, y)] = B.WALL;
        reserve(cx, door);
        split(x0, y0, cx - 1, y1, depth + 1); split(cx + 1, y0, x1, y1, depth + 1);
      } else {
        const cy = y0 + 4 + Math.floor(rnd() * (h - 8));
        const door = x0 + Math.floor(rnd() * w);
        for (let x = x0; x <= x1; x++) if (x !== door) tiles[I(x, cy)] = B.WALL;
        reserve(door, cy);
        split(x0, y0, x1, cy - 1, depth + 1); split(x0, cy + 1, x1, y1, depth + 1);
      }
    }
    if (!roof) split(1, 1, W - 2, H - 2, 0);
    else rooms.push({ x0: 1, y0: 1, x1: W - 2, y1: H - 2 });
    // лестничная клетка — в одном месте на всех этажах
    const sx = house.sx, sy = house.sy;
    const floorT = roof ? B.ROOF : B.FLOOR;
    for (let y = sy - 1; y <= sy + 1; y++) for (let x = sx - 1; x <= sx + 3; x++) if (x > 0 && y > 0 && x < W - 1 && y < H - 1) { tiles[I(x, y)] = floorT; reserved.add(I(x, y)); }
    reserve(sx, sy + 2); reserve(sx + 2, sy + 2);
    const exits = [];
    const door = { x: W >> 1, y: H - 2 };
    if (z === 0) {
      tiles[I(door.x, door.y)] = floorT; tiles[I(door.x, door.y - 1)] = floorT;
      reserve(door.x, door.y); reserve(door.x, door.y - 1);
      exits.push({ x: door.x, y: door.y, kind: 'door', to: { key: 'ground', x: house.door.x, y: house.door.y } });
    }
    if (z === house.floors && house.variant < 0.24) exits.push({ x: sx + 1, y: sy - 1, kind: 'fire_escape', to: { key: 'ground', x: house.bounds?house.bounds.x+house.bounds.w:house.x+1, y: house.y } });
    if (z < house.floors) exits.push({ x: sx, y: sy, kind: 'ladder', to: { key: keyOf(house, z + 1), at: 'stairs' } });
    if (z > -house.basement) exits.push({ x: sx + 2, y: sy, kind: 'stairs', to: { key: keyOf(house, z - 1), at: 'ladder' } });
    // Проходимый пролёт с промежуточной площадкой; переход на другой этаж происходит с его конца.
    const stairRun = [
      { x: sx, y: sy + 1, key: 'stairs_up' }, { x: sx + 1, y: sy + 1, key: 'stairs_up' },
      { x: sx + 1, y: sy, key: 'stair_landing' },
      { x: sx + 2, y: sy + 1, key: 'stairs_down' }, { x: sx + 2, y: sy, key: 'stairs_down' },
    ].filter((p) => p.x > 0 && p.y > 0 && p.x < W - 1 && p.y < H - 1);
    for (const p of stairRun) reserved.add(I(p.x, p.y));
    // связность: где деление комнат отрезало кусок — пробить проём
    const walkable = (i) => BIOMES[tiles[i]].walkable;
    const start = z === 0 ? I(door.x, door.y) : I(sx, sy);
    const reach = (blocked) => {
      const seen = new Uint8Array(W * H), q = [start];
      seen[start] = 1;
      for (let k = 0; k < q.length; k++) {
        const { x, y } = P(q[k]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = I(x + dx, y + dy);
          if (!seen[j] && walkable(j) && !(blocked && blocked.has(j))) { seen[j] = 1; q.push(j); }
        }
      }
      return { seen, n: q.length };
    };
    for (let guard = 0; guard < 40; guard++) {
      const { seen } = reach();
      let fixed = false;
      for (let y = 1; y < H - 1 && !fixed; y++) for (let x = 1; x < W - 1 && !fixed; x++) {
        const i = I(x, y);
        if (walkable(i) || x === 0 || y === 0) continue;
        const a = [I(x - 1, y), I(x + 1, y)], b = [I(x, y - 1), I(x, y + 1)];
        for (const [p, q] of [a, b]) {
          if (walkable(p) && walkable(q) && seen[p] !== seen[q] && x > 0 && y > 0 && x < W - 1 && y < H - 1) { tiles[i] = floorT; reserve(x, y); fixed = true; break; }
        }
      }
      if (!fixed) break;
    }
    { const { seen } = reach(); for (let i = 0; i < W * H; i++) if (walkable(i) && !seen[i]) tiles[i] = roof ? B.SKY : B.WALL; } // недостижимое — закрыть
    // края крыши — спрыгнуть вниз (урон от падения)
    if (roof) {
      for (const [x, y] of [[W - 2, H >> 1], [1, H - 3], [W >> 1, H - 2]]) {
        if (reserved.has(I(x, y))) continue;
        exits.push({ x, y, kind: 'jump', to: { key: 'ground', x: house.door.x, y: house.door.y, fall: house.floors } });
        reserve(x, y);
      }
    }
    for (const e of exits) reserve(e.x, e.y);
    // мебель
    const walls = new Set(), props = stairRun.map((p) => ({ ...p, i: I(p.x, p.y) }));
    const free = (i) => walkable(i) && !reserved.has(i) && !walls.has(i) && !props.some((p) => p.i === i);
    const nearWall = (i) => { const { x, y } = P(i); return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !walkable(I(x + dx, y + dy))); };
    const total = reach().n;
    const put = (i, key) => {
      const f = FURNITURE[key];
      if (f.block) { walls.add(i); if (reach(walls).n !== total - walls.size) { walls.delete(i); return false; } }
      props.push({ i, x: i % W, y: (i / W) | 0, key });
      return true;
    };
    const st = STYLES[house.style];
    const kinds = roof ? [] : under ? ['storage', 'boiler', 'storage'] : z === 0 && st.ground ? st.ground.concat(st.rooms) : st.rooms;
    rooms.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
    const named = [];
    rooms.forEach((r, k) => {
      const kind = roof ? 'roof' : kinds[k % kinds.length];
      named.push({ ...r, kind, name: ROOM_NAMES[kind] || 'крыша' });
      const cells = [];
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) cells.push(I(x, y));
      const along = cells.filter((i) => nearWall(i)), mid = cells.filter((i) => !nearWall(i));
      const pick = (arr) => { for (let t = 0; t < 12 && arr.length; t++) { const i = arr[Math.floor(rnd() * arr.length)]; if (free(i)) return i; } return -1; };
      const plan = roof ? [['vent', 2], ['tank', 1], ['antenna', 1]] : ROOMS[kind] || [];
      for (const [key, n] of plan) for (let m = 0; m < n; m++) {
        const centre = key === 'table' || key === 'sofa' || key === 'chair';
        let i = -1;
        if (key === 'chair') { // стул — у стола
          const t = props.filter((p) => (p.key === 'table' || p.key === 'computer') && cells.includes(p.i));
          for (const p of t) { for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) { const j = I(p.x + dx, p.y + dy); if (cells.includes(j) && free(j)) { i = j; break; } } if (i >= 0) break; }
        }
        if (i < 0) i = pick(centre && mid.length ? mid : along);
        if (i >= 0) put(i, key);
      }
    });
    // сундуки (тайники с добычей) и хлам
    const caches = [];
    const floorCells = [];
    for (let i = 0; i < W * H; i++) if (walkable(i)) floorCells.push(i);
    const wantChests = roof ? (rnd() < 0.35 ? 1 : 0) : 1 + (rnd() < 0.45 ? 1 : 0) + (under ? 1 : 0);
    for (let t = 0; t < 200 && caches.length < wantChests; t++) {
      const i = floorCells[Math.floor(rnd() * floorCells.length)];
      if (!free(i) || !nearWall(i) || caches.some((c) => Math.abs(c.x - (i % W)) + Math.abs(c.y - ((i / W) | 0)) < 5)) continue;
      put(i, 'chest'); caches.push(P(i));
    }
    const debrisChance = house.condition === 'ruined' ? 0.22 : house.condition === 'damaged' ? 0.14 : under ? 0.09 : 0.06;
    for (const i of floorCells) if (free(i) && rnd() < debrisChance) put(i, 'junk');
    // кто здесь: враги / нейтральные / жильцы / никого
    const spots = [], residents = [];
    const away = floorCells.filter((i) => free(i) && Math.abs((i % W) - P(start).x) + Math.abs(((i / W) | 0) - P(start).y) >= 5);
    const spot = () => { for (let t = 0; t < 30 && away.length; t++) { const i = away[Math.floor(rnd() * away.length)]; const p = P(i); if (![...spots, ...residents].some((s) => Math.abs(s.x - p.x) + Math.abs(s.y - p.y) < 3)) return p; } return null; };
    const r = rnd(), e = settings.houseEnemyChance, n = settings.houseNeutralChance, res = settings.houseResidentChance;
    let who = 'empty';
    if (r < e) who = 'enemies';
    else if (!roof && r < e + n) who = 'neutral';
    else if (!roof && r < e + n + res) who = 'resident';
    const count = who === 'enemies' ? 1 + (rnd() < 0.4 ? 1 : 0) : who === 'empty' ? 0 : 1 + Math.floor(rnd() * (who === 'resident' ? 3 : 2));
    for (let k = 0; k < count; k++) { const p = spot(); if (!p) break; if (who === 'enemies') spots.push(p); else residents.push({ ...p, kind: who }); }
    const spawn = z === 0 ? { x: door.x, y: door.y - 1 } : P(start);
    return { width: W, height: H, tiles, exits, walls, props: props.map(({ x, y, key }) => ({ x, y, key })), caches, spots, residents, rooms: named, spawn, occupants: who };
  }

  return { settings, configure, STYLES, FURNITURE, ROOMS, ROOM_NAMES, place, list, at, covering,byId, near, apply, facade,heightMeters, obstacleZ, obstacleName, KEY_RE, keyOf, parseKey, floorName, interior };
});
