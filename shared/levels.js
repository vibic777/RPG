// Вертикальные уровни (шаг 13): 16 уровней от −5 до +10.
//   −5…−1 — под землёй (подземелья: бункеры, хранилища, пещеры мутантов, гнёзда пришельцев) или под водой (подводье,
//            затопленные пещеры, выходящие на сушу у охраняемых мест); 0 — поверхность;
//   +1…+5 — над землёй (крыши руин и башен, горные вершины: снайперы и добыча);
//   +6…+10 — в воздухе над постройками. Высота полёта (дракон, ранец, техника) — прямо z: на +1…+5 летун среди домов и деревьев
//            (технику бьёт о стены и кроны, shared/houses.js obstacleZ), с +6 — свободное небо.
// Уровни ниже и выше поверхности — отдельные небольшие карты («экземпляры»), детерминированные по сиду мира и id входа:
// сервер и все клиенты строят одинаковую карту без передачи клеток. Входы (лестницы, люки, пещеры, места погружения,
// тропы на вершины, лифт — заготовка) расставляются по карте поверхности своим генератором случайных чисел,
// поэтому сама поверхность (и её контрольная сумма) от уровней не зависит.
// Общий файл: сервер (переходы, враги, тайники, дыхание, падение) и клиент (карта уровня, мини-карта, подсказки).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./worldgen'), require('./houses'),require('./regions'));
  else root.Levels = factory(root.WorldGen, root.Houses,root.Regions);
})(typeof self !== 'undefined' ? self : this, function (WorldGen, Houses,Regions) {
  'use strict';
  const { B, BIOMES, mulberry32, hashString } = WorldGen;

  const LEVELS_VERSION = 3;
  const Z_MIN = -5, Z_MAX = 10, GROUND_TOP = 5; // +1…+5 — над землёй, +6…+10 — воздух

  // Настраиваемые значения (config.game)
  const settings = {
    levelsEnabled: true, // вертикальные уровни включены
    levelEntrancesPer256: 10, // входов в подземелья/на высоты на карту 256×256 (пропорционально площади)
    levelSize: 48, // сторона карты подземного/подводного уровня, клеток
    levelDepthEnemyBonus: 2, // +уровней врагам за каждый уровень глубины (высоты)
    levelEnemiesBase: 5, // групп врагов на первом уровне подземелья
    levelEnemiesPerDepth: 2, // +групп за каждый следующий уровень
    levelCacheBase: 1, // тайников на уровне
    levelCachePerDepth: 1, // +тайников за уровень глубины (через один)
    levelEntranceRadius: 1.6, // как близко подойти ко входу/выходу, клеток
    breathSec: 25, // запас воздуха без снаряжения, секунд
    scubaBreathSec: 150, // +воздуха с аквалангом, секунд
    airTankSec: 90, // баллон с воздухом добавляет секунд
    breathRegenPerSec: 20, // восстановление воздуха на поверхности, секунд в секунду
    drownDamagePct: 8, // урон удушья в секунду, % от макс. здоровья
    diveFreeDepth: 1, // глубже этого уровня без акваланга не нырнуть
    swimStaminaPerSec: 4, // вплавь тратится выносливости в секунду
    fallDamagePct: 12, // урон от падения за каждый уровень высоты, % от макс. здоровья
    airDismount: 'block', // слезть с дракона в воздухе: block — нельзя, fall — падение с уроном
    airMaxAltitude: 5, // сколько воздушных уровней над поверхностью (+6…+10)
  };
  function configure(o = {}) {
    for (const k of Object.keys(settings)) if (o && o[k] !== undefined && typeof o[k] === typeof settings[k]) settings[k] = o[k];
  }

  // Название уровня по z
  function zName(z) {
    if (z === 0) return 'Поверхность';
    if (z < 0) return `Глубина ${-z}`;
    if (z <= GROUND_TOP) return `Высота ${z}`;
    return `Небо ${z - GROUND_TOP}`;
  }
  // Потолок полёта: уровни +1…+5 (среди домов и деревьев) и ещё airMax воздушных (+6…+10)
  const airTop = (airMax = settings.airMaxAltitude) => GROUND_TOP + Math.max(0, Math.min(Z_MAX - GROUND_TOP, Math.floor(Number(airMax) || 0)));
  const zLabel = (z) => (z > 0 ? '+' + z : String(z));

  // Виды входов (рисунок и подсказка)
  const KINDS = {
    travel:{name:'Переход в соседний регион',icon:'➜',hint:'Загрузить другую часть большого мира.'},
    stairs: { name: 'Лестница вниз', icon: '▼', hint: 'Спуск на уровень ниже.' },
    hatch: { name: 'Люк', icon: '▣', hint: 'Люк в бункер или хранилище.' },
    cave: { name: 'Вход в пещеру', icon: '◖', hint: 'Пещера уходит вглубь земли.' },
    dive: { name: 'Место погружения', icon: '≈', hint: 'Нырнуть под воду (нужен воздух; глубже — акваланг).' },
    ladder: { name: 'Лестница наверх', icon: '▲', hint: 'Подъём на крышу руин или башни.' },
    ramp: { name: 'Спуск по уклону', icon: '↘', hint: 'Проходимый наклонный ход ведёт на уровень ниже.' },
    climb: { name: 'Тропа на вершину', icon: '⛰', hint: 'Подъём на горную вершину.' },
    up: { name: 'Выход наверх', icon: '▲', hint: 'Вернуться на уровень выше.' },
    down: { name: 'Проход вниз', icon: '▼', hint: 'Спуститься глубже: опаснее, но добыча лучше.' },
    jump: { name: 'Край', icon: '⤓', hint: 'Спрыгнуть вниз, на поверхность: урон от падения за каждый уровень высоты.' },
    door: { name: 'Дверь дома', icon: '⌂', hint: 'U — войти в дом / выйти на улицу. Внутри: комнаты, лестницы на этажи, на крышу и в подвал.' },
    elevator: { name: 'Лифт', icon: '⇅', hint: 'Довоенный лифт у бункера: U — спуститься сразу на самый нижний уровень (к боссу). Обратно — по лестницам.' },
  };

  // Типы уровней. dir: -1 — вниз, +1 — вверх; gen — алгоритм; floor — клетка пола;
  // enemies — кто живёт (id из shared/enemies.js), boss — главарь самого глубокого уровня; depth — [мин, макс] уровней
  const TYPES = {
    bunker: { name: 'Бункер', dir: -1, gen: 'rooms', floor: B.FLOOR, kind: 'hatch', depth: [2, 4], enemies: ['raider_thug', 'raider_gunner', 'raider_marauder', 'cyborg_ripper', 'cyborg_gunner'], boss: 'boss_raider', desc: 'Довоенный бункер, занятый бандой. Комнаты и коридоры, в тупиках — тайники.' },
    vault: { name: 'Военный склад', dir: -1, gen: 'rooms', floor: B.FLOOR, kind: 'hatch', depth: [3, 5], enemies: ['walker_patrol', 'droid_repair', 'droid_protocol', 'cyborg_gunner'], boss: 'boss_vault', desc: 'Большой подземный комплекс довоенных складов. Военная охрана, ремонтные и сервисные дроиды, богатые тайники.', lootBonus: 2 },
    cave: { name: 'Пещера мутантов', dir: -1, gen: 'cave', floor: B.CAVE, kind: 'cave', depth: [2, 5], enemies: ['mutant_irradiated', 'mutant_slasher', 'mutant_brute', 'spider_weaver'], boss: 'boss_mutant', desc: 'Извилистые пещеры в предгорьях, логово мутантов.' },
    nest: { name: 'Гнездо пришельцев', dir: -1, gen: 'cave', floor: B.NEST, kind: 'cave', depth: [3, 5], enemies: ['alien_drone', 'alien_spitter', 'alien_hunter'], boss: 'alien_queen', desc: 'Гнездо пришельцев в пустыне: слизь, коконы и матка на самом дне.' },
    underwater: { name: 'Подводье', dir: -1, gen: 'sea', floor: B.SEABED, kind: 'dive', depth: [1, 5], enemies: ['mutant_eel', 'crab_mutant'], boss: 'leviathan', underwater: true, desc: 'Дно моря или озера: водные мутанты и затонувшие тайники. Нужен воздух.' },
    flooded: { name: 'Затопленная пещера', dir: -1, gen: 'cave', floor: B.SEABED, kind: 'dive', depth: [1, 1], enemies: ['mutant_eel', 'crab_mutant'], boss: null, underwater: true, desc: 'Тайный подводный ход из озера на сушу — к охраняемому месту. По пути — тайник.' },
    tower: { name: 'Руины башни', dir: 1, gen: 'tower', floor: B.ROOF, kind: 'ladder', depth: [2, 5], enemies: ['raider_sniper', 'raider_gunner', 'mutant_irradiated'], boss: null, desc: 'Этажи и крыша довоенной высотки: снайперы и добыча. С края — падение.' },
    house: { name: 'Дом', dir: 1, gen: 'house', floor: B.FLOOR, kind: 'door', depth: [1, 5], enemies: ['raider_thug', 'raider_gunner', 'raider_marauder', 'zombie', 'zombie_runner', 'mutant_irradiated'], roofEnemies: ['raider_sniper', 'raider_gunner'], boss: null, house: true, desc: 'Жилой дом, контора, магазин или хутор: этажи (до 5), крыша, подвалы (до 5). Комнаты с мебелью, сундуки, хлам; иногда враги, бродяги или мирные жильцы.' },
    peak: { name: 'Горная вершина', dir: 1, gen: 'peak', floor: B.LEDGE, kind: 'climb', depth: [1, 3], enemies: ['raider_sniper', 'mage_air', 'mage_earth'], boss: null, desc: 'Уступы горной вершины: снайперы, маги и гнёзда с добычей.' },
  };

  // ---------- Входы на карте поверхности ----------
  const cache = new WeakMap(); // карта поверхности -> { entrances, byId, levels: Map }
  function info(map) {
    let x = cache.get(map);
    if (!x) { x = { entrances: null, byId: null, levels: new Map() }; cache.set(map, x); }
    return x;
  }

  // Пул типов с долями (в сумме 20)
  const MIX = [['bunker', 4], ['vault', 2], ['cave', 4], ['nest', 2], ['underwater', 3], ['flooded', 1], ['tower', 3], ['peak', 1]];

  function entrances(map) {
    const inf = info(map);
    if (inf.entrances) return inf.entrances;
    const out = [];
    if (!map || map.z || map.level || !settings.levelsEnabled) { inf.entrances = out; inf.byId = new Map(); return out; }
    const W = map.width, H = map.height, T = map.tiles;
    const rnd = mulberry32(hashString(String(map.seed)) ^ 0x51ed270b);
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? B.WATER : T[y * W + x]);
    const main = (x, y) => map.region && map.region[y * W + x] === map.mainRegion;
    const near = (x, y, t, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (at(x + dx, y + dy) === t) return true; return false; };
    const landNextTo = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => BIOMES[at(x + dx, y + dy)].walkable && main(x + dx, y + dy));
    const sp = map.spawn || { x: W >> 1, y: H >> 1 };
    const total = Math.max(MIX.length, Math.round((settings.levelEntrancesPer256 * W * H) / 65536));
    const far = (x, y, d) => Math.abs(x - sp.x) + Math.abs(y - sp.y) >= d
      && !(map.settlements || []).some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) < 8)
      && !out.some((e) => Math.abs(e.x - x) + Math.abs(e.y - y) < 10 || (e.exit && Math.abs(e.exit.x - x) + Math.abs(e.exit.y - y) < 6));
    const want = [];
    for (const [type, share] of MIX) want.push([type, Math.max(1, Math.round((total * share) / 20))]);
    const counters = {};
    for (const [type, n] of want) {
      counters[type] = 0;
      for (let tries = 0; counters[type] < n && tries < 6000; tries++) {
        const x = 2 + Math.floor(rnd() * (W - 4)), y = 2 + Math.floor(rnd() * (H - 4));
        const t = at(x, y), late = tries > 3000;
        const minD = Math.min(24, W >> 3);
        let ok = false, exit = null;
        if (type === 'bunker' || type === 'vault') ok = (t === B.CITY || t === B.WASTE || (late && BIOMES[t].walkable && t !== B.SETTLEMENT)) && main(x, y);
        else if (type === 'cave') ok = (t === B.HILLS && near(x, y, B.MOUNTAIN, 2)) || (late && t === B.HILLS) ? main(x, y) : false;
        else if (type === 'nest') ok = (t === B.DESERT || (late && t === B.WASTE)) && main(x, y);
        else if (type === 'tower') ok = (t === B.CITY || (late && t === B.WASTE)) && main(x, y);
        else if (type === 'peak') ok = (t === B.HILLS && near(x, y, B.MOUNTAIN, 1)) || (late && t === B.HILLS) ? main(x, y) : false;
        else if (type === 'underwater' || type === 'flooded') {
          ok = t === B.WATER && Boolean(landNextTo(x, y));
          if (ok && type === 'flooded') { // второй выход — пещера на суше у военного склада (или вглубь суши)
            const target = (map.depots || [])[counters[type] % Math.max(1, (map.depots || []).length)];
            for (let k = 0; k < 200 && !exit; k++) {
              const ex = target ? target.x + Math.floor(rnd() * 13) - 6 : x + Math.floor(rnd() * 41) - 20;
              const ey = target ? target.y + Math.floor(rnd() * 13) - 6 : y + Math.floor(rnd() * 41) - 20;
              if (ex > 1 && ey > 1 && ex < W - 2 && ey < H - 2 && BIOMES[at(ex, ey)].walkable && main(ex, ey) && Math.abs(ex - x) + Math.abs(ey - y) >= 8
                && !(target && ex === target.x && ey === target.y)) exit = { x: ex, y: ey };
            }
            ok = Boolean(exit);
          }
        }
        if (!ok || !far(x, y, minD)) continue;
        const def = TYPES[type];
        const depth = def.depth[0] + Math.floor(rnd() * (def.depth[1] - def.depth[0] + 1));
        const id = type[0] + (type === 'flooded' ? 'f' : '') + counters[type];
        const e = { id, type, kind: def.kind, x, y, depth, dir: def.dir };
        if (exit) e.exit = { ...exit, kind: 'cave' };
        out.push(e);
        counters[type]++;
      }
    }
    // Сюжетная цепочка требует спуск в бункер. Если случайная выборка не нашла место
    // (необычная форма берега/биома), гарантируем одну доступную точку в главной области.
    if (!out.some((e) => e.type === 'bunker')) {
      let fallback = null, score = -1;
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        const t = at(x, y);
        if (!main(x, y) || !BIOMES[t].walkable || t === B.SETTLEMENT || !far(x, y, Math.min(24, W >> 3))) continue;
        const d = Math.abs(x - sp.x) + Math.abs(y - sp.y);
        if (d > score) { fallback = { x, y }; score = d; }
      }
      if (fallback) out.push({ id: 'b999', type: 'bunker', kind: TYPES.bunker.kind, x: fallback.x, y: fallback.y, depth: 3, dir: TYPES.bunker.dir, story: true });
    }
    // Лифт — заготовка: рядом с первым бункером, обесточен
    const bunker = out.find((e) => e.type === 'bunker');
    if (bunker) {
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 0], [0, 3]]) {
        const x = bunker.x + dx, y = bunker.y + dy;
        if (BIOMES[at(x, y)].walkable) { out.push({ id: 'el0', type: 'bunker', kind: 'elevator', x, y, depth: 0, dir: -1, disabled: true, of: bunker.id }); break; }
      }
    }
    // Каждому складу на поверхности соответствует отдельный вход в большой подземный комплекс.
    for (const d of map.depots || []) {
      if (!BIOMES[at(d.x, d.y)].walkable || !main(d.x, d.y)) continue;
      const id = `d${d.id}`;
      if (out.some(e => Math.hypot(e.x - d.x, e.y - d.y) < 4)) continue;
      out.push({ id, type: 'vault', kind: 'hatch', x: d.x, y: d.y, depth: 4, dir: -1, depotId: d.id });
    }
    inf.entrances = out;
    inf.byId = new Map(out.map((e) => [e.id, e]));
    return out;
  }
  // Дом как «вход»: дверь на улице (клетка перед домом), этажи — depth
  function houseEntrance(map, id) {
    const h = Houses && Houses.byId(map, id);
    return h ? { id: h.id, type: 'house', kind: 'door', x: h.door.x, y: h.door.y, depth: h.floors, basement: h.basement, dir: 1, house: h } : null;
  }
  const entranceById = (map, id) => { entrances(map); return info(map).byId.get(id) || houseEntrance(map, id); };

  // Ключ уровня: «<id входа>.<номер>», номер 1…depth (1 — ближний к поверхности)
  const KEY_RE = /^([a-z]{1,2}\d{1,3})\.(\d)$/;
  function parseKey(map, key) {
    if(Regions&&String(key).startsWith('region_')){const p=Regions.parse(key);if(!p)return null;const m=Regions.map(map,p.key);return p.local?parseKey(m,p.local):{surfaceRegion:true,regionKey:p.key,n:0,z:0};}
    const hk = Houses && Houses.parseKey(map, key);
    if (hk) return { ent: houseEntrance(map, hk.house.id), n: Math.abs(hk.z), z: hk.z, house: hk.house };
    const m = KEY_RE.exec(String(key || ''));
    if (!m) return null;
    const ent = entranceById(map, m[1]);
    const n = Number(m[2]);
    if (!ent || ent.disabled || n < 1 || n > ent.depth) return null;
    return { ent, n, z: ent.dir * n };
  }
  const keyOf = (ent, n) => `${ent.id}.${n}`;

  // Уровень врагов у входа (как «уровень зоны» поверхности) и на глубине n
  function difficulty(map, ent, n, levelPerTiles = 12) {
    const s = map.spawn || { x: 0, y: 0 };
    const zone = 1 + Math.floor(Math.hypot(ent.x - s.x, ent.y - s.y) / Math.max(1, levelPerTiles));
    return zone + n * settings.levelDepthEnemyBonus;
  }

  // ---------- Генераторы ----------
  function newGrid(W, H, fill) { const t = new Uint8Array(W * H); t.fill(fill); return t; }

  function bfs(tiles, W, H, sx, sy) {
    const dist = new Int32Array(W * H).fill(-1);
    const q = [sy * W + sx];
    dist[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const j = Y * W + X;
        if (dist[j] >= 0 || !BIOMES[tiles[j]].walkable) continue;
        dist[j] = dist[i] + 1;
        q.push(j);
      }
    }
    return dist;
  }

  // Комнаты и коридоры (бункер, хранилище)
  function genRooms(W, H, rnd, floor) {
    const t = newGrid(W, H, B.WALL);
    const rooms = [];
    for (let tries = 0; rooms.length < 12 && tries < 400; tries++) {
      const w = 4 + Math.floor(rnd() * 6), h = 4 + Math.floor(rnd() * 5);
      const x = 2 + Math.floor(rnd() * (W - w - 4)), y = 2 + Math.floor(rnd() * (H - h - 4));
      if (rooms.some((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
      rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
    }
    for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) t[y * W + x] = floor;
    const dig = (x, y) => { if (x > 0 && y > 0 && x < W - 1 && y < H - 1) t[y * W + x] = floor; };
    for (let i = 1; i < rooms.length; i++) { // каждая комната соединена с предыдущей коридором «Г»
      const a = rooms[i - 1], b = rooms[i];
      const horizFirst = rnd() < 0.5;
      if (horizFirst) { for (let x = Math.min(a.cx, b.cx); x <= Math.max(a.cx, b.cx); x++) dig(x, a.cy); for (let y = Math.min(a.cy, b.cy); y <= Math.max(a.cy, b.cy); y++) dig(b.cx, y); }
      else { for (let y = Math.min(a.cy, b.cy); y <= Math.max(a.cy, b.cy); y++) dig(a.cx, y); for (let x = Math.min(a.cx, b.cx); x <= Math.max(a.cx, b.cx); x++) dig(x, b.cy); }
    }
    return { tiles: t, rooms };
  }

  // Клеточный автомат (пещеры, гнёзда, затопленные пещеры, дно)
  function genCave(W, H, rnd, floor, fillPct = 45, steps = 5) {
    let t = newGrid(W, H, B.WALL);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) t[y * W + x] = rnd() * 100 < fillPct ? B.WALL : floor;
    for (let s = 0; s < steps; s++) {
      const n = newGrid(W, H, B.WALL);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        let walls = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && t[(y + dy) * W + x + dx] === B.WALL) walls++;
        n[y * W + x] = walls >= 5 || (walls === 0 && s < 2 && rnd() < 0.3) ? B.WALL : floor;
      }
      t = n;
    }
    // оставить только самую большую связную пещеру
    const { region, sizes } = WorldGen.labelRegions(t, W, H, (v) => BIOMES[v].walkable);
    let main = 0;
    for (let r = 1; r < sizes.length; r++) if (sizes[r] > sizes[main]) main = r;
    for (let i = 0; i < t.length; i++) if (BIOMES[t[i]].walkable && region[i] !== main) t[i] = B.WALL;
    return { tiles: t };
  }

  // Высотка: площадка-крыша среди пропасти, ящики и обломки
  function genTower(W, H, rnd, floor, peak) {
    const t = newGrid(W, H, B.SKY);
    const m = 3;
    for (let y = m; y < H - m; y++) for (let x = m; x < W - m; x++) {
      const edge = Math.min(x - m, y - m, W - m - 1 - x, H - m - 1 - y);
      if (peak && edge < 2 && rnd() < 0.45) continue; // рваный край скалы
      t[y * W + x] = floor;
    }
    for (let k = 0; k < (W * H) / 40; k++) { // укрытия
      const x = m + 2 + Math.floor(rnd() * (W - 2 * m - 4)), y = m + 2 + Math.floor(rnd() * (H - 2 * m - 4));
      t[y * W + x] = B.WALL;
    }
    return { tiles: t };
  }

  // Карта уровня по ключу: { width, height, tiles, region, spawn, exits, caches, spots, boss, ... } или null
  function level(map, key) {
    if(Regions&&String(key).startsWith('region_')){
      const p=Regions.parse(key);if(!p)return null;const m=Regions.map(map,p.key);if(!p.local)return m;
      const local=level(m,p.local);if(!local)return null;
      const inf=info(map);if(inf.levels.has(key))return inf.levels.get(key);
      const qualified={...local,key,regionKey:p.key,exits:local.exits.map(e=>({...e,to:{...e.to,key:Regions.qualify(p.key,e.to.key)}}))};inf.levels.set(key,qualified);return qualified;
    }
    const pk = parseKey(map, key);
    if (!pk) return null;
    const inf = info(map);
    if (inf.levels.has(key)) return inf.levels.get(key);
    if (pk.house) return houseLevel(map, key, pk);
    const { ent, n } = pk;
    const def = TYPES[ent.type];
    const up = def.dir > 0;
    const side = settings.levelSize + (ent.type === 'vault' ? 16 : 0);
    const W = up ? 20 + Math.min(10, ent.depth * 2) - n : side, H = up ? W : side;
    const rnd = mulberry32(hashString(String(map.seed) + '|' + key + '|' + LEVELS_VERSION));
    let g;
    if (def.gen === 'rooms') g = genRooms(W, H, rnd, def.floor);
    else if (def.gen === 'cave') g = genCave(W, H, rnd, def.floor, 45, 5);
    else if (def.gen === 'sea') g = genCave(W, H, rnd, def.floor, 36, 4);
    else g = genTower(W, H, rnd, def.floor, def.gen === 'peak');
    const tiles = g.tiles;
    const walk = (i) => BIOMES[tiles[i]].walkable;
    // вход сверху: первая комната или проходимая клетка ближе всего к углу (2, 2)
    let s0 = -1;
    if (g.rooms && g.rooms.length) s0 = g.rooms[0].cy * W + g.rooms[0].cx;
    else { // самая большая связная область, клетка ближе всего к углу (2, 2)
      const lr = WorldGen.labelRegions(tiles, W, H, (v) => BIOMES[v].walkable);
      let big = 0;
      for (let r = 1; r < lr.sizes.length; r++) if (lr.sizes[r] > lr.sizes[big]) big = r;
      let best = Infinity;
      for (let i = 0; i < tiles.length; i++) if (walk(i) && lr.region[i] === big) { const x = i % W, y = (i / W) | 0, d = x + y; if (d < best) { best = d; s0 = i; } }
    }
    if (s0 < 0) { tiles[(H >> 1) * W + (W >> 1)] = def.floor; s0 = (H >> 1) * W + (W >> 1); }
    const dist = bfs(tiles, W, H, s0 % W, (s0 / W) | 0);
    for (let i = 0; i < tiles.length; i++) if (walk(i) && dist[i] < 0) tiles[i] = up ? B.SKY : B.WALL; // недостижимое — закрыть
    const reach = [];
    for (let i = 0; i < tiles.length; i++) if (dist[i] >= 0) reach.push(i);
    reach.sort((a, b) => dist[b] - dist[a] || a - b); // дальние — первыми
    const P = (i) => ({ x: i % W, y: (i / W) | 0 });
    const spawn = { ...P(s0), z: pk.z };
    const exits = [];
    // Route artwork is selected from a separate hash so adding it never changes
    // the seeded cave layout, enemy positions, or loot.
    const routeFor = (part) => {
      const styles = def.gen === 'cave' ? ['stone_ramp', 'stone_steps', 'rope_ladder', 'vertical_ladder', 'timber_stairs']
        : def.gen === 'rooms' ? ['metal_hatch', 'vertical_ladder', 'timber_stairs', 'rope_ladder']
          : def.gen === 'tower' || def.gen === 'peak' ? ['vertical_ladder', 'rope_ladder', 'timber_stairs', 'stone_steps'] : [];
      if (!styles.length) return null;
      return styles[(hashString(`${map.seed}|route|${key}|${part}`) >>> 0) % styles.length];
    };
    const toParent = n === 1 ? { key: 'ground', x: ent.x, y: ent.y } : { key: keyOf(ent, n - 1), at: 'down' };
    exits.push({ ...P(s0), kind: 'up', route: routeFor('up'), to: toParent });
    const farthest = reach[0];
    if (n < ent.depth) exits.push({ ...P(farthest), kind: up ? 'ladder' : (def.gen === 'cave' ? 'ramp' : 'down'), route: routeFor('down'), to: { key: keyOf(ent, n + 1), at: 'up' } });
    if (ent.exit && n === 1) { // затопленная пещера: тайный выход на сушу
      exits.push({ ...P(farthest), kind: 'up', secret: true, to: { key: 'ground', x: ent.exit.x, y: ent.exit.y } });
    }
    const used = new Set([s0, farthest]);
    const farFrom = (i, pts, d) => pts.every((p) => Math.abs((i % W) - p.x) + Math.abs(((i / W) | 0) - p.y) >= d);
    // босс на самом глубоком уровне — в самой дальней точке (или рядом с ней)
    let boss = null;
    if (def.boss && n === ent.depth) { boss = P(farthest); }
    // края для прыжка (высоты): клетки у пропасти
    if (up) {
      const edges = reach.filter((i) => { const x = i % W, y = (i / W) | 0; return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tiles[(y + dy) * W + x + dx] === B.SKY); });
      const picks = [];
      for (const i of edges) { if (picks.length >= 3) break; if (!used.has(i) && farFrom(i, picks.map(P).concat([spawn]), 6)) picks.push(i); }
      for (const i of picks) { used.add(i); exits.push({ ...P(i), kind: 'jump', to: { key: 'ground', x: ent.x, y: ent.y, fall: n } }); }
    }
    // тайники: тупики (много стен вокруг), подальше от входа
    const nWalls = (i) => { const x = i % W, y = (i / W) | 0; let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !BIOMES[tiles[(y + dy) * W + x + dx] ?? B.WALL].walkable) c++; return c; };
    const wantCaches = settings.levelCacheBase + Math.floor((n * settings.levelCachePerDepth) / 2) + (ent.exit ? 1 : 0) + (ent.type === 'vault' ? 6 : 0);
    const caches = [];
    for (const minWalls of [6, 5, 4, 0]) {
      for (const i of reach) {
        if (caches.length >= wantCaches) break;
        if (used.has(i) || dist[i] < 8 || nWalls(i) < minWalls || !farFrom(i, caches, 8)) continue;
        caches.push(P(i)); used.add(i);
      }
    }
    // места врагов: группы подальше от входа и друг от друга
    const wantSpots = up ? 2 + n : settings.levelEnemiesBase + (n - 1) * settings.levelEnemiesPerDepth;
    const spots = [];
    for (const gap of [7, 5, 3]) {
      for (let k = 0; k < reach.length && spots.length < wantSpots; k++) {
        const i = reach[(k * 7919) % reach.length];
        if (used.has(i) || dist[i] < 9 || !farFrom(i, spots, gap)) continue;
        spots.push(P(i)); used.add(i);
      }
    }
    const { region, sizes } = WorldGen.labelRegions(tiles, W, H, (v) => BIOMES[v].walkable);
    const mainRegion = region[s0];
    const lv = {
      genVersion: WorldGen.GEN_VERSION, levelsVersion: LEVELS_VERSION, seed: map.seed, key, level: true,
      width: W, height: H, tiles, region, mainRegion, regionSizes: sizes,
      z: pk.z, n, depth: ent.depth, type: ent.type, typeName: def.name, entrance: ent.id,
      underwater: Boolean(def.underwater), high: up,
      spawn, settlements: [], lairs: [], depots: [], exits, props: exits.filter((e) => e.route).map((e) => ({ x: e.x, y: e.y, key: e.route })), caches, spots, boss,
      enemyLevel: difficulty(map, ent, n), safeRadius: 3,
      name: `${def.name}: ${zName(pk.z).toLowerCase()}`,
    };
    inf.levels.set(key, lv);
    return lv;
  }

  // Этаж дома (shared/houses.js): комнаты, мебель (lv.props, загораживающая — lv.walls), сундуки, жильцы
  function houseLevel(map, key, pk) {
    const inf = info(map), h = pk.house, z = pk.z, def = TYPES.house;
    const g = Houses.interior(map, h, z);
    const { region, sizes } = WorldGen.labelRegions(g.tiles, g.width, g.height, (v) => BIOMES[v].walkable);
    const ent = pk.ent;
    const lv = {
      genVersion: WorldGen.GEN_VERSION, levelsVersion: LEVELS_VERSION, seed: map.seed, key, level: true,
      width: g.width, height: g.height, tiles: g.tiles, region, mainRegion: region[g.spawn.y * g.width + g.spawn.x], regionSizes: sizes,
      z, n: Math.abs(z), depth: h.floors, type: 'house', typeName: h.name, entrance: h.id, house: h,
      underwater: false, high: z > 0, roof: z === h.floors,
      spawn: { ...g.spawn, z }, settlements: [], lairs: [], depots: [], exits: g.exits, caches: g.caches, spots: g.spots, boss: null,
      residents: g.residents, occupants: g.occupants, props: g.props, walls: g.walls, rooms: g.rooms,
      enemyLevel: difficulty(map, ent, Math.abs(z)), safeRadius: 1,
      name: `${h.name}: ${Houses.floorName(h, z)}`,
    };
    inf.levels.set(key, lv);
    return lv;
  }

  // Куда попадёт герой, пройдя через выход exit (или вход ent на поверхности): { key: 'ground' | ключ, x, y }
  function arrival(map, to) {
    if (to.key === 'ground') return { key: 'ground', x: to.x, y: to.y, z: 0 };
    const lv = level(map, to.key);
    if (!lv) return null;
    if(lv.surfaceRegion&&Number.isFinite(to.x)&&Number.isFinite(to.y))return{key:to.key,x:to.x,y:to.y,z:0};
    if (to.at && to.at !== 'up' && to.at !== 'down') { const ex = lv.exits.find((e) => e.kind === to.at); if (ex) return { key: to.key, x: ex.x, y: ex.y, z: lv.z }; }
    if (to.at === 'down') { const ex = lv.exits.find((e) => e.kind === 'down' || e.kind === 'ramp' || e.kind === 'ladder'); if (ex) return { key: to.key, x: ex.x, y: ex.y, z: lv.z }; }
    return { key: to.key, x: lv.spawn.x, y: lv.spawn.y, z: lv.z };
  }

  // Ближайший вход (поверхность) или выход (уровень) в радиусе levelEntranceRadius
  function nearbyPortal(map, lv, x, y, r = settings.levelEntranceRadius) {
    if(Regions&&lv?.surfaceRegion){const p=nearbyPortal(lv,null,x,y,r);return p?{...p,regionKey:lv.key}:null;}
    const list = lv ? lv.exits.map((e) => ({ ...e, from: lv.key })) : entrances(map).map((e) => ({ ...e, from: 'ground' }));
    const extra = lv ? [] : entrances(map).filter((e) => e.exit).map((e) => ({ ...e.exit, id: e.id, type: e.type, kind: 'cave', secret: true, exitOf: e.id, from: 'ground', depth: e.depth, dir: -1 }));
    if(!lv&&Regions)extra.push(...Regions.portals(map));
    if (!lv && Houses) for (const h of Houses.near(map, x, y, r)) {
      extra.push({ id: h.id, type: 'house', kind: 'door', x: h.door.x, y: h.door.y, from: 'ground', depth: h.floors, dir: 1, house: true });
      if (h.variant < 0.24 && h.condition !== 'ruined' && h.x + 1 < map.width) extra.push({ id: h.id, type: 'house', kind: 'ladder', x: h.x + 1, y: h.y, from: 'ground', depth: h.floors, dir: 1, houseRoof: true });
    }
    let best = null, bd = Infinity;
    for (const p of list.concat(extra)) {
      const d = Math.hypot(p.x + 0.5 - x, p.y + 0.5 - y);
      if (d <= r && d < bd) { bd = d; best = p; }
    }
    return best;
  }
  // Цель входа на поверхности: первый уровень подземелья/высоты
  function portalTarget(map, p) {
    if(Regions&&p.kind==='travel')return Regions.target(map,p.regionKey||'ground',p);
    if(Regions&&p.regionKey){const m=Regions.map(map,p.regionKey),target=portalTarget(m,{...p,regionKey:null});return target?{...target,key:Regions.qualify(p.regionKey,target.key)}:null;}
    if (p.from === 'ground' && p.houseRoof) {
      const h = Houses.byId(map, p.id);
      return h ? arrival(map, { key: Houses.keyOf(h, h.floors), at: 'fire_escape' }) : null;
    }
    if (p.from === 'ground' && p.house) {
      const h = Houses.byId(map, p.id);
      return h ? arrival(map, { key: Houses.keyOf(h, 0), at: 'door' }) : null;
    }
    if (p.from === 'ground') {
      const ent = entranceById(map, p.exitOf || p.id);
      if (!ent || ent.disabled) return null;
      if (p.exitOf) { // сухой вход затопленной пещеры — к дальнему концу
        const lv = level(map, keyOf(ent, 1));
        const ex = lv && lv.exits.find((e) => e.secret);
        return ex ? { key: lv.key, x: ex.x, y: ex.y, z: lv.z } : null;
      }
      return arrival(map, { key: keyOf(ent, 1), at: 'up' });
    }
    return arrival(map, p.to);
  }

  // ---------- Дыхание, плавание, падение (чистые функции: сервер и тесты) ----------
  function breathMax(scuba) { return settings.breathSec + (scuba ? settings.scubaBreathSec : 0); }
  // Шаг дыхания: st { breath }; opts { underwater, scuba, maxHp }. Возвращает урон удушья за шаг (0 — дышит)
  function stepBreath(st, dt, opts) {
    const max = breathMax(opts.scuba);
    if (!Number.isFinite(st.breath)) st.breath = max;
    if (!opts.underwater) { st.breath = Math.min(max, st.breath + settings.breathRegenPerSec * dt); return 0; }
    st.breath = Math.min(max, st.breath);
    if (st.breath > 0) { st.breath = Math.max(0, st.breath - dt); return 0; }
    return ((opts.maxHp || 100) * settings.drownDamagePct / 100) * dt;
  }
  // Урон от падения с высоты levels уровней
  const fallDamage = (levels, maxHp) => (levels > 0 ? Math.round(maxHp * Math.min(1, (settings.fallDamagePct * levels) / 100)) : 0);
  // Можно ли нырнуть на уровень z (под воду) — без акваланга только до diveFreeDepth
  const canDive = (z, scuba) => scuba || -z <= settings.diveFreeDepth;

  // Дома поверхности: после генерации карты — расстановка (подальше от входов уровней) и слой непроходимых клеток
  if (Houses && WorldGen.addPostGen) WorldGen.addPostGen((map) => {
    if (!map || map.level || map.z) return map;
    const avoid = [];
    for (const e of entrances(map)) { avoid.push(e); if (e.exit) avoid.push(e.exit); }
    return Houses.apply(map, avoid);
  });

  function releaseRegion(map,key){
    if(!Regions)return;
    const p=Regions.parse(key);if(!p||p.key==='ground')return;
    for(const id of info(map).levels.keys())if(id===p.key||id.startsWith(p.key+'!'))info(map).levels.delete(id);
    Regions.release(map,p.key);
  }
  return {
    LEVELS_VERSION, Z_MIN, Z_MAX, GROUND_TOP, settings, configure, KINDS, TYPES, zName, zLabel, airTop,
    entrances, entranceById, parseKey, keyOf, level, arrival, nearbyPortal, portalTarget, difficulty,releaseRegion,
    breathMax, stepBreath, fallDamage, canDive,
  };
});
