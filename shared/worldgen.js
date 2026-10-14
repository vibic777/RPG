// Детерминированный генератор мира: сид -> одинаковая карта на сервере и у всех клиентов.
// Только целочисленная и базовая арифметика (без Math.sin и т. п.), чтобы результат не зависел от движка JS.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorldGen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GEN_VERSION = 4; // версия с городскими дорогами; старые карты сохраняют исходную раскладку

  // ---------- Биомы ----------
  const BIOMES = [
    { id: 0, key: 'water', name: 'Море / озеро', walkable: false, swim: true, speed: 0, color: '#1f4e6e', hint: 'Глубокая вода: герой плывёт медленно и тратит выносливость (без сил — тонет). Отмеченные места позволяют нырнуть на подводные уровни.' },
    { id: 1, key: 'river', name: 'Река', walkable: false, swim: true, speed: 0, color: '#2f6f8f', hint: 'Река: можно переплыть — медленно и с тратой выносливости.' },
    { id: 2, key: 'desert', name: 'Пустыня', walkable: true, speed: 0.85, color: '#c8a45a', hint: 'Пустыня: песок замедляет, мало воды.' },
    { id: 3, key: 'waste', name: 'Пустошь', walkable: true, speed: 1, color: '#8a7b58', hint: 'Пустошь: выжженная земля, здесь бродят орды зомби.' },
    { id: 4, key: 'forest', name: 'Лес', walkable: true, speed: 0.8, color: '#3f5a2c', hint: 'Лес: густые заросли замедляют движение.' },
    { id: 5, key: 'city', name: 'Руины города', walkable: true, speed: 0.9, color: '#77746c', hint: 'Руины довоенного города: добыча, зомби и банды.' },
    { id: 6, key: 'hills', name: 'Предгорья', walkable: true, speed: 0.6, color: '#7d6a4f', hint: 'Предгорья: крутые склоны сильно замедляют.' },
    { id: 7, key: 'mountain', name: 'Горы', walkable: false, blocks: true, speed: 0, color: '#8f8a84', hint: 'Горы: непроходимы (на вершины ведут отмеченные тропы). Здесь гнездятся драконы.' },
    { id: 8, key: 'settlement', name: 'Поселение', walkable: true, speed: 1.1, color: '#9b8062', hint: 'Поселение: торговцы, лекари, маги, стража; мирная зона (T — поговорить с жителем).' },
    // Клетки вертикальных уровней (шаг 13, shared/levels.js) — генератор поверхности их не ставит (level: true)
    { id: 9, key: 'cave', name: 'Пол пещеры', walkable: true, level: true, speed: 0.9, color: '#4a4038', hint: 'Подземелье: пещера мутантов или гнездо. Чем глубже, тем опаснее и богаче добыча.' },
    { id: 10, key: 'floor', name: 'Бетонный пол', walkable: true, level: true, speed: 1, color: '#6a6e72', hint: 'Бункер или хранилище: комнаты и коридоры, охрана, тайники.' },
    { id: 11, key: 'seabed', name: 'Морское дно', walkable: true, level: true, underwater: true, speed: 0.6, color: '#2a5a6a', hint: 'Под водой: расходуется воздух (шкала «Воздух»), без него — удушье. Акваланг и баллоны продлевают погружение.' },
    { id: 12, key: 'roof', name: 'Крыша', walkable: true, level: true, speed: 1, color: '#8a7a6a', hint: 'Крыша руин или башни: снайперы и добыча. С края можно спрыгнуть — урон от падения.' },
    { id: 13, key: 'wall', name: 'Стена / скала', walkable: false, level: true, blocks: true, speed: 0, color: '#2a2622', hint: 'Стена подземелья или скала: не пройти и не прострелить.' },
    { id: 14, key: 'sky', name: 'Пропасть', walkable: false, level: true, speed: 0, color: '#9ac8e8', hint: 'Пустота вокруг высотного уровня: сюда не шагнуть, но пули пролетают.' },
    { id: 15, key: 'nest', name: 'Слизь гнезда', walkable: true, level: true, speed: 0.8, color: '#5a3a5a', hint: 'Гнездо пришельцев: липкая слизь замедляет.' },
    { id: 16, key: 'ledge', name: 'Скальный уступ', walkable: true, level: true, speed: 0.85, color: '#8a8478', hint: 'Горная вершина: уступы, снайперы, ветер. С края — долгое падение.' },
    { id: 17, key: 'road', name: 'Разбитый асфальт', walkable: true, speed: 1, color: '#454644', hint: 'Старая городская дорога: асфальт в трещинах, местами завален обломками.' },
  ];
  const B = Object.fromEntries(BIOMES.map((b) => [b.key.toUpperCase(), b.id]));

  const SETTLEMENT_TYPES = [
    { key: 'village', name: 'Деревня' },
    { key: 'town', name: 'Поселение' },
    { key: 'base', name: 'База' },
    { key: 'vault', name: 'Убежище' },
  ];
  const DRAGON_TYPES = [
    { key: 'fire', name: 'Огненный дракон' },
    { key: 'ice', name: 'Ледяной дракон' },
    { key: 'lava', name: 'Лавовый дракон' },
    { key: 'water', name: 'Водный дракон' },
    ...[['air','Воздушный'],['earth','Земляной'],['electricity','Грозовой'],['blood','Кровавый'],['shadow','Теневой']].map(([key,name])=>({key,name:name+' дракон'})),
  ];

  // ---------- Параметры мира ----------
  const settings = {
    worldSizes: { small: 128, medium: 256, large: 512, huge: 1024 },
    maxDragons: 20,
    maxWorlds: 10,
    depotsPer256: 2, // военные склады под охраной шагоходов (шаг 11)
  };
  function configure(o = {}) {
    if (o.worldSizes && typeof o.worldSizes === 'object') settings.worldSizes = { ...o.worldSizes };
    if (Number.isFinite(o.maxDragons)) settings.maxDragons = o.maxDragons;
    if (Number.isFinite(o.maxWorlds)) settings.maxWorlds = o.maxWorlds;
    if (Number.isFinite(o.depotsPer256)) settings.depotsPer256 = o.depotsPer256;
  }

  const SIZE_LABELS = { small: 'Маленький', medium: 'Средний', large: 'Большой', huge: 'Огромный' };
  const ENEMY_DENSITY = [
    { id: 'none', label: 'Нет' }, { id: 'low', label: 'Низкая' }, { id: 'normal', label: 'Обычная' }, { id: 'high', label: 'Высокая' },
  ];
  const HORDE_FREQUENCY = [
    { id: 'never', label: 'Никогда' }, { id: 'rare', label: 'Редко' }, { id: 'normal', label: 'Обычно' }, { id: 'often', label: 'Часто' },
  ];
  const MAP_SHAPES = [
    {id:'rectangle',label:'Прямоугольник'},{id:'continent',label:'Материк с неровным берегом'},
    { id: 'square', label: 'Квадрат' }, { id: 'long', label: 'Длинный путь' }, { id: 'circle', label: 'Круг' },
    { id: 'oval', label: 'Овал' }, { id: 'chaos', label: 'Хаос' }, { id: 'islands', label: 'Острова' },
  ];
  const WATER_MODES=[{id:'auto',label:'По форме карты'},{id:'inland',label:'Суша без островов'},{id:'lakes',label:'Суша с озёрами'},{id:'sea',label:'Материк, море вокруг'},{id:'archipelago',label:'Архипелаг в море'}];
  function dimensions(size,shape){return {width:shape==='long'?size*2:shape==='rectangle'?Math.round(size*1.5):size,height:shape==='long'?Math.max(64,Math.floor(size/2)):shape==='rectangle'?Math.max(16,Math.round(size*2/3)):size};}
  // Выживание в мире (голод, жажда, усталость, радиация): сложность множит расход шкал (shared/survival.js)
  const SURVIVAL_DIFFICULTY = [
    { id: 'easy', label: 'Лёгкое' }, { id: 'normal', label: 'Обычное' }, { id: 'hard', label: 'Тяжёлое' }, { id: 'brutal', label: 'Суровое' },
  ];
  const SEED_RE = /^[A-Za-zА-Яа-яЁё0-9_-]{1,32}$/;
  const NAME_RE = /^[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9 '.,!-]{1,31}$/;

  function randomSeed(rnd = Math.random) {
    const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 8; i++) s += abc[Math.floor(rnd() * abc.length)];
    return s;
  }

  function validateParams(input) {
    const src = input && typeof input === 'object' ? input : {};
    const errors = [];
    const name = typeof src.name === 'string' ? src.name.trim().replace(/\s+/g, ' ') : '';
    if (!NAME_RE.test(name)) errors.push('Название мира: 2–32 символа, начинается с буквы или цифры.');
    const seed = typeof src.seed === 'string' ? src.seed.trim() : '';
    if (!SEED_RE.test(seed)) errors.push('Сид: 1–32 символа — буквы, цифры, «_» или «-».');
    const size = src.size;
    if (!Object.prototype.hasOwnProperty.call(settings.worldSizes, size)) errors.push('Недопустимый размер мира.');
    const enemyDensity = src.enemyDensity;
    if (!ENEMY_DENSITY.some((o) => o.id === enemyDensity)) errors.push('Недопустимая плотность врагов.');
    const hordeFrequency = src.hordeFrequency;
    if (!HORDE_FREQUENCY.some((o) => o.id === hordeFrequency)) errors.push('Недопустимая частота орд зомби.');
    const shape = src.shape === undefined ? 'square' : src.shape;
    if (!MAP_SHAPES.some((o) => o.id === shape)) errors.push('Недопустимая форма карты.');
    const waterMode=src.waterMode===undefined?'auto':src.waterMode;
    if(!WATER_MODES.some(o=>o.id===waterMode))errors.push('Недопустимый режим водоёмов.');
    const dragons = src.dragons;
    if (!Number.isInteger(dragons) || dragons < 0 || dragons > settings.maxDragons) errors.push(`Число драконов: от 0 до ${settings.maxDragons}.`);
    const scaleToLevel = true; // совместимость со старыми сохранениями: баланс теперь всегда масштабируется по группе
    const pvp = false; // кооператив против мира, без дружественного огня
    const survival = src.survival === undefined ? true : src.survival; // выживание (по умолчанию включено)
    if (typeof survival !== 'boolean') errors.push('«Выживание» — да или нет.');
    const survivalDifficulty = src.survivalDifficulty === undefined ? 'normal' : src.survivalDifficulty;
    if (!SURVIVAL_DIFFICULTY.some((o) => o.id === survivalDifficulty)) errors.push('Недопустимая сложность выживания.');
    return { ok: !errors.length, errors, value: { name, seed, size, shape,waterMode, enemyDensity, hordeFrequency, dragons, scaleToLevel, pvp, survival, survivalDifficulty } };
  }

  // ---------- ГПСЧ и шум ----------
  function hashString(str) { // FNV-1a
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y, seed) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function valueNoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
    const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, seed, octaves) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * valueNoise(x * freq, y * freq, (seed + i * 1013) | 0);
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }
  // Порог по доле: значение, ниже которого лежит frac всех значений (гистограмма)
  function quantile(values, frac, mask) {
    const bins = new Uint32Array(1024);
    let total = 0;
    for (let i = 0; i < values.length; i++) {
      if (mask && !mask(i)) continue;
      bins[Math.min(1023, Math.max(0, Math.floor(values[i] * 1024)))]++;
      total++;
    }
    const target = total * frac;
    let acc = 0;
    for (let i = 0; i < 1024; i++) { acc += bins[i]; if (acc >= target) return (i + 1) / 1024; }
    return 1;
  }

  // ---------- Генерация ----------
  const SYL1 = ['Ржав', 'Пыль', 'Стал', 'Сух', 'Кам', 'Мох', 'Гор', 'Пепел', 'Кисл', 'Хром', 'Медн', 'Свинц', 'Жар', 'Туман'];
  const SYL2 = ['ово', 'ск', 'град', 'ище', 'ная Балка', 'ий Яр', 'ов Круг', 'ая Гавань', 'ый Форт', 'ино'];

  function generate(params) {
    const size = settings.worldSizes[params.size] || params.width;
    if (!Number.isInteger(size) || size < 16) throw new Error('Некорректный размер мира');
    const shape = MAP_SHAPES.some(x => x.id === params.shape) ? params.shape : 'square';
    const dim=dimensions(size,shape),W=dim.width,H=dim.height,N=W*H;
    const seedNum = hashString(String(params.seed));
    const rnd = mulberry32(seedNum ^ 0x9E3779B9);
    const sElev = seedNum | 0, sMoist = (seedNum ^ 0x5bd1e995) | 0, sUrban = (seedNum ^ 0x27d4eb2f) | 0;

    const elev = new Float32Array(N), moist = new Float32Array(N), urban = new Float32Array(N);
    const playMask=params.waterMode&&['circle','oval'].includes(shape)?new Uint8Array(N):null;
    const f = 5 / size; // крупные формы рельефа
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if(playMask){const dx=((x+.5)/W)*2-1,dy=(((y+.5)/H)*2-1)/(shape==='oval'?.62:1);playMask[i]=Math.hypot(dx,dy)<.98?1:0;}
        const nx = (x / W) * 2 - 1, ny = (y / H) * 2 - 1;
        const dx = nx, dy = ny / (shape === 'oval' ? 0.62 : 1);
        const edge = shape === 'circle' || shape === 'oval' ? Math.sqrt(dx * dx + dy * dy) : Math.max(Math.abs(nx), Math.abs(ny));
        let e = fbm(x * f, y * f, sElev, 5);
        const islandNoise = fbm(x * f * 1.7 + 41, y * f * 1.7 - 29, sElev ^ 0x6d2b79f5, 3);
        if (shape === 'circle' || shape === 'oval' || shape === 'long') {
          if (edge > 0.68) { const t = (edge - 0.68) / 0.32; e -= t * t * 1.1; }
        } else if (shape === 'islands') {
          e += (islandNoise - 0.5) * 0.65;
          if (edge > 0.94) e -= (edge - 0.94) * 3;
        } else if (shape === 'chaos') {
          e += (islandNoise - 0.5) * 0.38;
          if (edge > 0.83) { const t = (edge - 0.83) / 0.17; e -= t * t * 0.65; }
        } else if (edge > 0.7) { const t = (edge - 0.7) / 0.3; e -= t * t * 0.9; }
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) e = 0; // граница карты всегда вода
        elev[i] = Math.max(0, Math.min(0.999, e));
        moist[i] = fbm(x * f * 0.8 + 100, y * f * 0.8 + 100, sMoist, 4);
        urban[i] = fbm(x * f * 2.2, y * f * 2.2, sUrban, 3);
      }
    }
    const seaLevel = quantile(elev, 0.2);
    const land = (i) => elev[i] >= seaLevel;
    const mountainLevel = quantile(elev, 0.93, land);
    const hillLevel = quantile(elev, 0.84, land);
    const dryLevel = quantile(moist, 0.25, land);
    const wetLevel = quantile(moist, 0.68, land);
    const urbanLevel = quantile(urban, 0.9, land);

    // Реки: от предгорий вниз по склону
    const river = new Uint8Array(N);
    const riverCount = Math.max(2, Math.round(size / 48));
    const lowestNeighbor = (x, y, visited) => {
      let best = -1, bestE = Infinity;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const j = Y * W + X;
        if (visited.has(j)) continue;
        const e = elev[j] + hash2(X, Y, sElev ^ 77) * 0.004;
        if (e < bestE) { bestE = e; best = j; }
      }
      return best;
    };
    for (let r = 0, tries = 0; r < riverCount && tries < 400; tries++) {
      const x0 = Math.floor(rnd() * W), y0 = Math.floor(rnd() * H);
      const i0 = y0 * W + x0;
      if (elev[i0] < hillLevel || elev[i0] >= mountainLevel) continue;
      r++;
      const visited = new Set([i0]);
      let cur = i0;
      for (let step = 0; step < size * 3; step++) {
        river[cur] = 1;
        if (elev[cur] < seaLevel) break;
        const next = lowestNeighbor(cur % W, (cur / W) | 0, visited);
        if (next < 0) break;
        visited.add(next);
        cur = next;
      }
    }

    // Биомы
    const tiles = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const e = elev[i];
      let t;
      if (e < seaLevel) t = B.WATER;
      else if (e >= mountainLevel) t = B.MOUNTAIN;
      else if (river[i]) t = B.RIVER;
      else if (e >= hillLevel) t = B.HILLS;
      else if (urban[i] >= urbanLevel) t = B.CITY;
      else if (moist[i] < dryLevel) t = B.DESERT;
      else if (moist[i] >= wetLevel) t = B.FOREST;
      else t = B.WASTE;
      if ((params.genVersion || 0) >= 4 && t === B.CITY) {
        const x=i%W,y=Math.floor(i/W);
        const bendX = Math.round((moist[i] - 0.5) * 5), bendY = Math.round((urban[i] - 0.5) * 5);
        const laneX = ((x - bendX) % 20 + 20) % 20, laneY = ((y - bendY) % 18 + 18) % 18;
        if (laneX <= 1 || laneX >= 19 || laneY <= 1 || laneY >= 17) t = B.ROAD;
      }
      tiles[i] = t;
    }

    // Новые водные профили: старые миры без waterMode сохраняют исходную генерацию.
    if(params.waterMode||shape==='continent'||shape==='rectangle'){
      const mode=!params.waterMode||params.waterMode==='auto'?(shape==='islands'?'archipelago':shape==='continent'?'sea':'lakes'):params.waterMode;
      const ponds=Array.from({length:Math.max(3,Math.round(size/48))},()=>({x:.18+rnd()*.64,y:.18+rnd()*.64,rx:.025+rnd()*.045,ry:.025+rnd()*.045}));
      const islands=[];for(let iy=0;iy<4;iy++)for(let ix=0;ix<4;ix++)islands.push({x:(ix+.5+(rnd()-.5)*.25)/4,y:(iy+.5+(rnd()-.5)*.25)/4,rx:.055+rnd()*.035,ry:.055+rnd()*.035});
      for(let y=0;y<H;y++)for(let x=0;x<W;x++){
        const i=y*W+x,nx=(x+.5)/W,ny=(y+.5)/H,dx=nx*2-1,dy=(ny*2-1)/(shape==='oval'?.62:1),rad=Math.hypot(dx,dy),angle=Math.atan2(dy,dx);
        let inside=x>0&&y>0&&x<W-1&&y<H-1;
        if(shape==='circle'||shape==='oval')inside=inside&&rad<.94;
        if(shape==='continent'||mode==='sea')inside=inside&&rad<.73+.08*Math.sin(angle*3+seedNum%13)+.045*Math.sin(angle*7+seedNum%7);
        if(shape==='chaos')inside=inside&&rad<.78+.12*Math.sin(angle*5+seedNum%19)+.06*Math.sin(angle*9);
        if(mode==='archipelago')inside=inside&&islands.some(a=>((nx-a.x)/a.rx)**2+((ny-a.y)/a.ry)**2<1);
        if(!inside){tiles[i]=B.WATER;continue;}
        // Единая суша: шум не создаёт случайных островов внутри материка.
        if(tiles[i]===B.WATER||tiles[i]===B.RIVER)tiles[i]=moist[i]>=wetLevel?B.FOREST:B.WASTE;
        if(mode==='lakes'&&ponds.some(a=>((nx-a.x)/a.rx)**2+((ny-a.y)/a.ry)**2<1))tiles[i]=B.WATER;
      }
    }

    // Связные области проходимой суши (4-соседство)
    const walkable = (t) => BIOMES[t].walkable;
    const { region, sizes } = labelRegions(tiles, W, H, walkable);
    let main = 0;
    for (let r = 1; r < sizes.length; r++) if (sizes[r] > sizes[main]) main = r;
    const inMain = (x, y) => x >= 0 && y >= 0 && x < W && y < H && region[y * W + x] === main;

    // Точка появления: ближайшая к центру клетка главной области
    let spawn = null, best = Infinity;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!inMain(x, y)) continue;
      const d = (x - W / 2) ** 2 + (y - H / 2) ** 2;
      if (d < best) { best = d; spawn = { x, y, z: 0 }; }
    }

    // Поселения
    const settlements = [];
    const settlementCount = Math.max(3, Math.min(40, Math.round(N / 12000)));
    const minDist = Math.max(8, Math.floor(size / 8));
    for (let tries = 0; settlements.length < settlementCount && tries < 3000; tries++) {
      const x = 2 + Math.floor(rnd() * (W - 4)), y = 2 + Math.floor(rnd() * (H - 4));
      if (!inMain(x, y)) continue;
      const tooClose = settlements.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) < minDist * (tries > 1500 ? 0.5 : 1));
      if (tooClose || Math.abs(spawn.x - x) + Math.abs(spawn.y - y) < 6) continue;
      const type = SETTLEMENT_TYPES[Math.floor(rnd() * SETTLEMENT_TYPES.length)];
      const name = SYL1[Math.floor(rnd() * SYL1.length)] + SYL2[Math.floor(rnd() * SYL2.length)];
      settlements.push({ id: settlements.length, type: type.key, typeName: type.name, name, x, y, z: 0 });
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = (y + dy) * W + (x + dx);
        if (walkable(tiles[j])) tiles[j] = B.SETTLEMENT;
      }
    }
    // Сюжетный проводник должен быть достижим из стартовой области, а не только где-то на материке.
    const hubRange = Math.max(18, Math.min(36, Math.floor(size / 6)));
    if (!settlements.some((s) => Math.hypot(s.x - spawn.x, s.y - spawn.y) <= hubRange)) {
      let pick = null, bestD = Infinity;
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        const d = Math.hypot(x - spawn.x, y - spawn.y);
        if (d < 7 || d > hubRange || !inMain(x, y) || !walkable(tiles[y * W + x]) || settlements.some((s) => Math.hypot(s.x - x, s.y - y) < 8)) continue;
        if (d < bestD) { pick = { x, y }; bestD = d; }
      }
      if (pick) {
        const type = SETTLEMENT_TYPES.find((x) => x.key === 'town');
        const name = SYL1[Math.floor(rnd() * SYL1.length)] + SYL2[Math.floor(rnd() * SYL2.length)];
        settlements.push({ id: settlements.length, type: type.key, typeName: type.name, name, x: pick.x, y: pick.y, z: 0 });
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const i = (pick.y + dy) * W + pick.x + dx;
          if (walkable(tiles[i])) tiles[i] = B.SETTLEMENT;
        }
      }
    }
    // Минимум три поселения с квестовыми жителями гарантированы даже на редкой суше.
    // Сначала ищем рядом с появлением, затем ослабляем только расстояние между точками.
    while (settlements.length < 3) {
      let pick = null, bestD = Infinity;
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        if (!inMain(x, y) || !walkable(tiles[y * W + x]) || Math.abs(spawn.x - x) + Math.abs(spawn.y - y) < 6) continue;
        if (settlements.some((s) => Math.hypot(s.x - x, s.y - y) < Math.max(4, minDist * 0.5))) continue;
        const d = Math.abs(spawn.x - x) + Math.abs(spawn.y - y);
        if (d < bestD) { pick = { x, y }; bestD = d; }
      }
      if (!pick) break;
      const type = SETTLEMENT_TYPES.find((x) => x.key === 'town');
      const name = SYL1[Math.floor(rnd() * SYL1.length)] + SYL2[Math.floor(rnd() * SYL2.length)];
      settlements.push({ id: settlements.length, type: type.key, typeName: type.name, name, x: pick.x, y: pick.y, z: 0 });
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const i = (pick.y + dy) * W + pick.x + dx;
        if (walkable(tiles[i])) tiles[i] = B.SETTLEMENT;
      }
    }

    // Логова драконов (пока только метки): предгорья рядом с горами
    const lairs = [];
    for (let tries = 0; lairs.length < (params.dragons || 0) && tries < 5000; tries++) {
      const x = 1 + Math.floor(rnd() * (W - 2)), y = 1 + Math.floor(rnd() * (H - 2));
      const i = y * W + x;
      if (tiles[i] !== B.HILLS && !(tries > 2500 && walkable(tiles[i]))) continue;
      if (lairs.some((l) => Math.abs(l.x - x) + Math.abs(l.y - y) < minDist / 2)) continue;
      let nearWater = false, nearDesert = false;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const t = tiles[Y * W + X];
        if (t === B.WATER || t === B.RIVER) nearWater = true;
        if (t === B.DESERT) nearDesert = true;
      }
      const type = nearWater ? 'water' : nearDesert ? 'lava' : rnd() < 0.5 ? 'fire' : 'ice';
      lairs.push({ id: lairs.length, type, name: DRAGON_TYPES.find((d) => d.key === type).name, x, y, z: 0 });
    }

    // Военные склады (шаг 11): руины города или пустошь в главной области, вдали от точки появления и поселений.
    // Свой генератор случайных чисел — остальная карта (и её контрольная сумма) от складов не зависит.
    const depots = [];
    const drnd = mulberry32(seedNum ^ 0x3c6ef372);
    const wantDepots = Math.max(0, Math.round((settings.depotsPer256 * N) / 65536));
    for (let tries = 0; depots.length < wantDepots && tries < 4000; tries++) {
      const x = 2 + Math.floor(drnd() * (W - 4)), y = 2 + Math.floor(drnd() * (H - 4));
      const i = y * W + x;
      if ((tiles[i] !== B.CITY && tiles[i] !== B.WASTE && !(tries > 2000 && walkable(tiles[i]))) || region[i] !== main) continue;
      if (Math.hypot(x - spawn.x, y - spawn.y) < Math.min(40, W / 5)) continue;
      if (settlements.some((st) => Math.hypot(st.x - x, st.y - y) < 16) || depots.some((d) => Math.hypot(d.x - x, d.y - y) < minDist / 2)) continue;
      depots.push({ id: depots.length, x, y });
    }

    if(params.regionRoads){
      const cx=Math.floor(W/2),cy=Math.floor(H/2),sx=spawn.x,sy=spawn.y;
      const road=(x,y)=>Math.abs(x-cx)<=9||Math.abs(y-cy)<=9||(Math.abs(y-sy)<=9&&x>=Math.min(sx,cx)-9&&x<=Math.max(sx,cx)+9);
      for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(road(x,y))tiles[y*W+x]=B.ROAD;
      for(let i=settlements.length-1;i>=0;i--)if(Math.abs(settlements[i].x-cx)<30||Math.abs(settlements[i].y-cy)<30||Math.abs(settlements[i].y-sy)<30)settlements.splice(i,1);
      settlements.forEach((s,i)=>s.id=i);
      if(!settlements.length){const x=Math.floor(W*.25),y=Math.floor(H*.25);for(let Y=y-24;Y<=y+24;Y++)for(let X=x-24;X<=x+24;X++)tiles[Y*W+X]=B.WASTE;for(let X=x;X<=cx;X++)for(let Y=y-4;Y<=y+4;Y++)tiles[Y*W+X]=B.ROAD;settlements.push({id:0,type:'town',typeName:'Поселение',name:'Дорожный приют',x,y,z:0});}
      const lr=labelRegions(tiles,W,H,v=>BIOMES[v].walkable);region.set(lr.region);main=region[sy*W+sx];
    }
    // После размещения поселений области не меняются (заменялись только проходимые клетки)
    const world = {
      genVersion:Number.isInteger(params.genVersion)?params.genVersion:(params.waterMode?GEN_VERSION:2),
      seed: String(params.seed), shape,waterMode:params.waterMode||null,
      width: W, height: H,
      z: 0, // вертикальный уровень карты (планируется от -5 до +10)
      tiles, region, mainRegion: main,playMask,
      spawn, settlements, lairs, depots,
    };
    // Дополнения поверх карты (шаг 15: застройка поселений, shared/settlements.js) — клетки и контрольная сумма не меняются
    for (const fn of postGen) fn(world);
    return world;
  }
  const postGen = [];
  const addPostGen = (fn) => { if (!postGen.includes(fn)) postGen.push(fn); };

  function labelRegions(tiles, W, H, walkable) {
    const N = W * H;
    const region = new Int32Array(N).fill(-1);
    const queue = new Int32Array(N);
    const sizes = [];
    for (let s = 0; s < N; s++) {
      if (region[s] !== -1 || !walkable(tiles[s])) continue;
      const id = sizes.length;
      let head = 0, tail = 0, count = 0;
      queue[tail++] = s; region[s] = id;
      while (head < tail) {
        const i = queue[head++]; count++;
        const x = i % W, y = (i / W) | 0;
        if (x > 0 && region[i - 1] === -1 && walkable(tiles[i - 1])) { region[i - 1] = id; queue[tail++] = i - 1; }
        if (x < W - 1 && region[i + 1] === -1 && walkable(tiles[i + 1])) { region[i + 1] = id; queue[tail++] = i + 1; }
        if (y > 0 && region[i - W] === -1 && walkable(tiles[i - W])) { region[i - W] = id; queue[tail++] = i - W; }
        if (y < H - 1 && region[i + W] === -1 && walkable(tiles[i + W])) { region[i + W] = id; queue[tail++] = i + W; }
      }
      sizes.push(count);
    }
    return { region, sizes };
  }

  // Контрольная сумма карты — сервер хранит её, клиент сверяет после генерации
  function mapHash(world) {
    let h = 2166136261;
    const t = world.tiles;
    for (let i = 0; i < t.length; i++) { h ^= t[i]; h = Math.imul(h, 16777619); }
    const extra = JSON.stringify([world.width, world.height, world.shape, world.spawn, world.settlements.map((s) => [s.x, s.y, s.type]), world.lairs.map((l) => [l.x, l.y, l.type])]);
    for (let i = 0; i < extra.length; i++) { h ^= extra.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  const tileAt = (world, x, y) => (x < 0 || y < 0 || x >= world.width || y >= world.height ? B.WATER : world.tiles[y * world.width + x]);
  // Слой построек (shared/building.js): world.blocks — Map индекс клетки → блок; world.actor — кто идёт (null — враги)
  let blockCheck = null;
  const setBlockCheck = (fn) => { blockCheck = fn; };
  // world.swimmer — движется герой (шаг 13): вода и реки проходимы вплавь (медленно, см. shared/movement.js)
  // world.flyer — сейчас движется летун (верховой дракон, спутник-дракон): вода и горы проходимы, край карты — нет
  // world.drive — едет техника (шаг 14, shared/vehicles.js): проходимость по правилам местности машины
  const isWalkable = (world, x, y) => {
    if(world.playMask&&(x<0||y<0||x>=world.width||y>=world.height||!world.playMask[y*world.width+x]))return false;
    if(world.buildElevation && !world.drive && !world.flyer)return x>=0&&y>=0&&x<world.width&&y<world.height&&Boolean(world.walkways&&world.walkways.has(y*world.width+x));
    if (world.drive) { if (x < 0 || y < 0 || x >= world.width || y >= world.height || !world.drive.walk(tileAt(world, x, y))) return false; }
    else if (world.flyer) { if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false; }
    else { const bt = BIOMES[tileAt(world, x, y)]; if (!bt.walkable && !(world.swimmer && bt.swim && x >= 0 && y >= 0 && x < world.width && y < world.height)) return false; }
    const wallId = y * world.width + x;
    if (world.walls && !world.flyer && !(world.drive && world.drive.air) && world.walls.has(wallId) && !(world.openGates && world.openGates.has(wallId))) return false; // стены, дома и открытые ворота поселений
    const b = world.blocks && world.blocks.size && !world.ignoreBlocks ? world.blocks.get(y * world.width + x) : null;
    return !b || !blockCheck || blockCheck(b, world.actor == null ? null : world.actor, world);
  };

  return {
    GEN_VERSION, BIOMES, B, SETTLEMENT_TYPES, DRAGON_TYPES, SIZE_LABELS, ENEMY_DENSITY, HORDE_FREQUENCY, SURVIVAL_DIFFICULTY, MAP_SHAPES,WATER_MODES,dimensions,
    settings, configure, validateParams, randomSeed, generate, mapHash, tileAt, isWalkable, setBlockCheck, addPostGen,
    hashString, mulberry32, hash2, valueNoise, fbm, labelRegions,
  };
});
