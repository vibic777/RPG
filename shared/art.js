// Художественный проход (шаг 19): ДАННЫЕ и чистые расчёты арта — общий файл сервера, клиента и тестов.
// Всё рисуется кодом (никаких покупных или скачиваемых картинок): текстуры клеток — детерминированный шум по палитре
// биома, объекты — по рецептам, спрайты каталога — по ключам рисовальщиков (icons.js, enemy-draw.js, art.js).
// Здесь: уровни качества и их очистка, палитры биомов и пиксели текстур, карта спрайтов для всего каталога,
// анимации по типу тела, освещение (день/ночь, уровни мира), частицы эффектов, внешность детей по возрасту.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Art = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const settings = {
    graphicsRenderer: 'art', // рендер: art — новый художественный, classic — прежний простой (запасной)
    graphicsQuality: 'medium', // качество по умолчанию: low, medium, high (игрок может сменить в меню)
    artDayMin: 30, // длина суток для освещения, минут реального времени (0 — всегда день)
    artNightDark: 0.45, // насколько темнеет ночью (0…0,8)
    artUnderLight: 7, // радиус света вокруг героя в подземельях, клеток
    artParticleMax: 300, // наибольшее число частиц эффектов на экране (на высоком качестве)
    artTextureSize: 32, // размер текстуры клетки, пикселей (больше — детальнее и тяжелее)
    // шаг 20: значения по умолчанию для кадров (игрок меняет в меню)
    fpsCap: 60, fpsIdle: 20, idleAfterSec: 3, autoQualityFps: 24, batterySaver: true, perfOverlay: false,
    cameraEdgeScroll: false, // шаг 22: прокрутка обзора у края экрана по умолчанию (игрок меняет в меню)
    cameraArrowKeys: true, // стрелки двигают обзор (камеру), WASD — героя; false — стрелки ведут героя, как WASD (игрок меняет в меню)
  };
  // Значения сервера; неверные — в допустимые пределы (рендер и качество — к значениям по умолчанию)
  const LIMITS = { fpsIdle: [1, 60], idleAfterSec: [0.5, 600], autoQualityFps: [0, 60], artDayMin: [0, 1440], artNightDark: [0, 0.9], artUnderLight: [2, 30], artParticleMax: [0, 2000], artTextureSize: [8, 64] };
  function configure(game) {
    for (const k of Object.keys(settings)) if (game && game[k] !== undefined) settings[k] = game[k];
    for (const [k, [lo, hi]] of Object.entries(LIMITS)) { const v = Number(settings[k]); settings[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo; }
    if (!QUALITY[settings.graphicsQuality]) settings.graphicsQuality = 'medium';
    if (!RENDERERS[settings.graphicsRenderer]) settings.graphicsRenderer = 'art';
    if (!FPS_CAPS.includes(Number(settings.fpsCap))) settings.fpsCap = 60;
    settings.batterySaver = settings.batterySaver !== false; settings.perfOverlay = settings.perfOverlay === true; settings.cameraEdgeScroll = settings.cameraEdgeScroll === true; settings.cameraArrowKeys = settings.cameraArrowKeys !== false;
  }

  // ---------- Качество ----------
  const QUALITY = {
    // dpr — предел плотности пикселей холста (на экранах 4K / 150 % — главный расход): низкое — 1, среднее — 1,5
    low: { name: 'Низкое', variants: 2, transitions: false, particles: 0, lighting: 'flat', shadows: false, detail: false, dpr: 1 },
    medium: { name: 'Среднее', variants: 4, transitions: true, particles: 0.5, lighting: 'full', shadows: true, detail: false, dpr: 1.5 },
    high: { name: 'Высокое', variants: 6, transitions: true, particles: 1, lighting: 'full', shadows: true, detail: true, dpr: 2 },
  };
  const RENDERERS = { art: 'Художественный', classic: 'Простой (прежний)' };
  // Настройки графики игрока (из localStorage или меню): неверное — к значениям сервера
  function sanitizeGfx(raw) {
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const defR = RENDERERS[settings.graphicsRenderer] ? settings.graphicsRenderer : 'art';
    const defQ = QUALITY[settings.graphicsQuality] ? settings.graphicsQuality : 'medium';
    const fps = Number(r.fps);
    return {
      renderer: RENDERERS[r.renderer] ? r.renderer : defR, quality: QUALITY[r.quality] ? r.quality : defQ,
      fps: FPS_CAPS.includes(fps) && r.fps !== null && r.fps !== '' ? fps : settings.fpsCap, // 30, 60 или 0 — без ограничения
      battery: typeof r.battery === 'boolean' ? r.battery : settings.batterySaver, // экономия батареи
      auto: typeof r.auto === 'boolean' ? r.auto : settings.autoQualityFps > 0, // автоснижение качества при низком FPS
      overlay: typeof r.overlay === 'boolean' ? r.overlay : settings.perfOverlay, // оверлей FPS / пинг (F8)
      edge: typeof r.edge === 'boolean' ? r.edge : settings.cameraEdgeScroll, // прокрутка обзора у края экрана (шаг 22)
      arrows: typeof r.arrows === 'boolean' ? r.arrows : settings.cameraArrowKeys, // стрелки — камера (true) или движение героя (false)
    };
  }
  const FPS_CAPS = [30, 60, 0];
  // Шаг 20: что применять на деле — от батареи (экономия включена) — низкое качество и не больше 30 FPS
  function effectiveGfx(gfx, onBattery) {
    const g = sanitizeGfx(gfx);
    if (!(g.battery && onBattery)) return { ...g, saver: false };
    return { ...g, quality: 'low', fps: g.fps === 0 || g.fps > 30 ? 30 : g.fps, saver: true };
  }
  const lowerQuality = (q) => (q === 'high' ? 'medium' : q === 'medium' ? 'low' : null);
  const quality = (q) => QUALITY[q] || QUALITY.medium;

  // ---------- Случайность ----------
  function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));

  // ---------- Биомы: палитры и тип текстуры ----------
  // индексы как в WorldGen.B: вода, река, пустыня, пустошь, лес, руины города, холмы, горы, поселение, пещера, пол бункера,
  // морское дно, крыша, стена, небо, гнездо, уступ, разбитый асфальт
  const BIOMES = [
    { id: 'water', base: '#1f4e6e', dark: '#163a54', light: '#3a7a9a', tex: 'water' },
    { id: 'river', base: '#2f6f8f', dark: '#245a75', light: '#5a9ab8', tex: 'water' },
    { id: 'desert', base: '#ad9569', dark: '#796d50', light: '#c8b18a', tex: 'sand' },
    { id: 'waste', base: '#8a7b58', dark: '#5e5440', light: '#a8996e', tex: 'ash' },
    { id: 'forest', base: '#536044', dark: '#354332', light: '#798359', tex: 'grass' },
    { id: 'city', base: '#77766a', dark: '#53574d', light: '#a09a85', tex: 'rubble' },
    { id: 'hills', base: '#7d6a4f', dark: '#5e4f3a', light: '#9a8664', tex: 'dirt' },
    { id: 'mountain', base: '#8f8a84', dark: '#6a6560', light: '#b0aba4', tex: 'rock' },
    { id: 'settlement', base: '#9b8062', dark: '#7a644c', light: '#b49a78', tex: 'plank' },
    { id: 'cave', base: '#4a4038', dark: '#332b25', light: '#5e5348', tex: 'cave' },
    { id: 'floor', base: '#6a6e72', dark: '#4e5256', light: '#8a8e92', tex: 'metal' },
    { id: 'seabed', base: '#2a5a6a', dark: '#1d4250', light: '#3e7888', tex: 'sand' },
    { id: 'roof', base: '#8a7a6a', dark: '#665a4e', light: '#a49484', tex: 'metal' },
    { id: 'wall', base: '#2a2622', dark: '#1a1714', light: '#3e3832', tex: 'rock' },
    { id: 'sky', base: '#9ac8e8', dark: '#7aaccc', light: '#c4e2f4', tex: 'cloud' },
    { id: 'nest', base: '#5a3a5a', dark: '#3e263e', light: '#7a5478', tex: 'slime' },
    { id: 'ledge', base: '#8a8478', dark: '#68635a', light: '#a8a296', tex: 'rock' },
    { id: 'road', base: '#454644', dark: '#292b2b', light: '#66665f', tex: 'metal' },
  ];
  const TEXTURES = ['water', 'sand', 'ash', 'grass', 'rubble', 'dirt', 'rock', 'plank', 'cave', 'metal', 'cloud', 'slime'];
  // Объекты на клетках по биому (ключи рисовальщика client/js/game/art.js)
  const BIOME_OBJECTS = {
    forest: ['tree_pine', 'tree_oak', 'tree_twisted'], mountain: ['peak'], hills: ['mound', 'boulder'], city: ['ruin_block', 'rubble', 'rusted_car'],
    desert: ['cactus', 'bones', 'dune'], waste: ['tree_dead', 'barrel', 'tire'], cave: ['stalagmite', 'mushroom'], nest: ['cocoon'], seabed: ['kelp', 'shell'],
    sky: ['cloud'], ledge: ['boulder'], roof: ['vent'], floor: ['crate'], wall: ['wall_block'], water: [], river: [], settlement: [],
  };
  const OBJECT_KEYS = ['tree_pine', 'tree_oak', 'tree_twisted', 'tree_dead', 'peak', 'mound', 'boulder', 'ruin_block', 'rubble', 'rusted_car', 'cactus', 'bones', 'dune', 'barrel', 'tire', 'stalagmite', 'mushroom', 'cocoon', 'kelp', 'shell', 'cloud', 'vent', 'crate', 'wall_block',
    'settlement', 'depot', 'portal', 'lair', 'node_tree', 'node_rock', 'node_ruin'];

  // Пиксели текстуры клетки (квадрат size×size, RGBA): шум значений + узор по типу текстуры. Детерминированно.
  function texturePixels(biome, variant = 0, size = settings.artTextureSize) {
    const b = BIOMES[biome] || BIOMES[0];
    const n = Math.max(8, Math.min(128, Math.round(size)));
    const R = rng(hash(b.id + ':' + variant + ':' + n));
    const base = hexRgb(b.base), dark = hexRgb(b.dark), light = hexRgb(b.light);
    // крупный шум: решётка 5×5 со сглаживанием (бесшовно — по модулю)
    const G = 5, grid = Array.from({ length: G * G }, () => R());
    const noise = (x, y) => {
      const gx = (x / n) * G, gy = (y / n) * G, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
      const v = (i, j) => grid[((j % G + G) % G) * G + ((i % G + G) % G)];
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      return (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) + (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
    };
    const px = new Uint8ClampedArray(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const k = noise(x, y), fine = R();
      let c = k < 0.5 ? mix(dark, base, k * 2) : mix(base, light, (k - 0.5) * 2 * 0.7);
      switch (b.tex) {
        case 'water': c = mix(c, light, Math.max(0, Math.sin((x + y * 2 + k * 9) * 0.6)) * 0.25); break;
        case 'sand': if (fine > 0.93) c = mix(c, light, 0.5); if (Math.sin((y + k * 6) * 0.9) > 0.85) c = mix(c, dark, 0.25); break;
        case 'grass': if (fine > 0.8) c = mix(c, fine > 0.95 ? light : dark, 0.45); break;
        case 'ash': if (fine > 0.9) c = mix(c, dark, 0.6); if (Math.abs(noise(x * 3, y * 3) - 0.5) < 0.02) c = mix(c, [40, 34, 26], 0.6); break;
        case 'rubble': if (fine > 0.86) c = mix(c, fine > 0.97 ? [140, 70, 40] : dark, 0.5); break; // ржавые крошки
        case 'dirt': if (fine > 0.9) c = mix(c, dark, 0.4); break;
        case 'rock': if (Math.abs(noise(x * 2, y * 2) - 0.5) < 0.03) c = mix(c, dark, 0.7); else if (fine > 0.95) c = mix(c, light, 0.4); break;
        case 'plank': c = mix(c, dark, (y % 8 === 0 ? 0.5 : 0) + Math.sin(x * 0.7 + y) * 0.05); break;
        case 'cave': if (fine > 0.97) c = mix(c, [120, 200, 160], 0.35); break; // светящиеся крупинки
        case 'metal': if (x % 16 === 0 || y % 16 === 0) c = mix(c, dark, 0.5); else if (fine > 0.97) c = mix(c, [150, 80, 40], 0.5); break;
        case 'cloud': c = mix(c, [255, 255, 255], Math.max(0, k - 0.45) * 0.9); break;
        case 'slime': if (Math.abs(k - 0.6) < 0.04) c = mix(c, [180, 240, 120], 0.5); break;
        default:
      }
      c = mix(base,c,0.6); // Restrained microtexture keeps terrain from looking like a noisy tiled carpet.
      const i = (y * n + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
    return { size: n, data: px };
  }
  // Отпечаток всего атласа текстур (для тестов детерминизма и кэша)
  function atlasHash(size = settings.artTextureSize, variants = 6) {
    let h = 2166136261;
    for (let b = 0; b < BIOMES.length; b++) for (let v = 0; v < variants; v++) {
      const { data } = texturePixels(b, v, size);
      for (let i = 0; i < data.length; i += 7) { h ^= data[i]; h = Math.imul(h, 16777619); }
    }
    return (h >>> 0).toString(16);
  }

  // ---------- Карта спрайтов каталога ----------
  // Ключи, которые умеют рисовать клиентские рисовальщики (проверяется тестами по исходникам рисовальщиков)
  const ICON_SHAPES = ['pistol', 'smg', 'rifle', 'sniper', 'shotgun', 'mg', 'launcher', 'knife', 'club', 'mace', 'hammer', 'baton', 'sword', 'greatsword', 'axe', 'greataxe', 'spear', 'halberd', 'bow', 'blowgun', 'crossbow', 'disc', 'star', 'laser_pistol', 'laser_rifle', 'lsword', 'dlsword', 'laser_axe', 'lasso', 'staff', 'wand', 'flamer', 'mine', 'trap', 'net', 'tripwire', 'turret',
    'bullet', 'shell', 'grenade', 'rocket', 'arrow', 'cell', 'fuel', 'underwear', 'shirt', 'pants', 'jacket', 'coat', 'bandana', 'helmet', 'hood', 'helmet_full', 'goggles', 'mask', 'gloves', 'boots', 'cloak', 'belt', 'armor', 'vest', 'power_armor', 'bag', 'backpack', 'ring', 'amulet',
    'food', 'can', 'meat', 'flask', 'bottle', 'medkit', 'potion', 'syringe', 'planks', 'cloth', 'scroll', 'book', 'scrap', 'chip', 'nugget', 'plate',
    'pecheneg', 'm240', 'gatling', 'tanto', 'wakizashi', 'katana', 'nodachi', 'tomahawk', 'nunchaku', 'robe', 'jetpack', 'wings'];
  const ENEMY_SHAPES = ['humanoid', 'cyborg', 'zombie', 'quadruped', 'scorpion', 'ant', 'spider', 'mantis', 'walker', 'alien', 'dragon', 'drone'];
  // Анимации по типу тела: покачивание при ходьбе, шаг, длительность удара и попадания, вид смерти
  const ANIMS = {
    humanoid: { bob: 0.12, step: 0.25, attackMs: 260, hitMs: 160, death: 'fall' }, cyborg: { bob: 0.08, step: 0.22, attackMs: 220, hitMs: 140, death: 'sparks' },
    zombie: { bob: 0.16, step: 0.18, attackMs: 340, hitMs: 180, death: 'crumble' }, quadruped: { bob: 0.18, step: 0.3, attackMs: 240, hitMs: 150, death: 'fall' },
    scorpion: { bob: 0.06, step: 0.2, attackMs: 300, hitMs: 140, death: 'fade' }, ant: { bob: 0.05, step: 0.2, attackMs: 220, hitMs: 120, death: 'fade' },
    spider: { bob: 0.05, step: 0.24, attackMs: 240, hitMs: 120, death: 'curl' }, mantis: { bob: 0.08, step: 0.2, attackMs: 200, hitMs: 140, death: 'fade' },
    walker: { bob: 0.1, step: 0.2, attackMs: 300, hitMs: 160, death: 'sparks' }, alien: { bob: 0.14, step: 0.22, attackMs: 260, hitMs: 160, death: 'melt' },
    dragon: { bob: 0.3, step: 0, attackMs: 420, hitMs: 200, death: 'fall' },
    drone: { bob: 0.2, step: 0, attackMs: 240, hitMs: 120, death: 'sparks' }, // дроны висят в воздухе и сыплют искрами
  };
  // Транспорт: силуэт и окраска (постапокалиптическая ржавчина + заплатки)
  const VEHICLES = {
    bicycle: { body: 'frame', paint: '#7a3a2a', rust: 0.3 }, motorcycle: { body: 'bike', paint: '#3a3a3e', rust: 0.35 }, car: { body: 'sedan', paint: '#8a5a3a', rust: 0.5 },
    truck: { body: 'truck', paint: '#5a6a4a', rust: 0.45 }, apc: { body: 'apc', paint: '#4a5238', rust: 0.25 }, tank: { body: 'tank', paint: '#47503a', rust: 0.2 },
    rowboat: { body: 'rowboat', paint: '#7a5a3a', rust: 0 }, boat: { body: 'boat', paint: '#d8d0c0', rust: 0.3 }, jetski: { body: 'jetski', paint: '#c84a2a', rust: 0.2 },
    submarine: { body: 'sub', paint: '#3a4a5a', rust: 0.4 }, helicopter: { body: 'heli', paint: '#4a5a4a', rust: 0.3 }, plane: { body: 'plane', paint: '#8a8a7a', rust: 0.35 },
    // ездовые звери, колёсная и гусеничная техника, шагоходы (меши — client/js/game/vehicle-art.js)
    horse: { body: 'mount', paint: '#7a5634', rust: 0 }, mutant_mount: { body: 'mount', paint: '#6a6a3a', rust: 0 },
    sedan: { body: 'sedan', paint: '#5a6a7a', rust: 0.4 }, armored_car: { body: 'apc', paint: '#4f5640', rust: 0.25 },
    cargo_truck: { body: 'truck', paint: '#5a5f45', rust: 0.45 }, semi_truck: { body: 'truck', paint: '#7a3a2a', rust: 0.4 },
    bus: { body: 'bus', paint: '#c8a032', rust: 0.5 }, armored_bus: { body: 'bus', paint: '#4a5238', rust: 0.3 },
    ifv: { body: 'apc', paint: '#4a5238', rust: 0.2 }, light_tank: { body: 'tank', paint: '#56603f', rust: 0.2 },
    deep_submarine: { body: 'sub', paint: '#2a3440', rust: 0.3 },
    mech_sentinel: { body: 'walker', paint: '#5a5f66', rust: 0.25 }, chicken_walker: { body: 'walker', paint: '#6a6050', rust: 0.3 }, elephant_walker: { body: 'walker', paint: '#4a4f48', rust: 0.3 },
  };
  // Постройки базы и поселений: тип рисунка
  const PIECE_STYLE = { foundation: 'tile', roof: 'roof', wall_wood: 'wall', wall_stone: 'wall', door: 'door', window: 'window', fence: 'fence', gate: 'door', spikes: 'spikes', barricade: 'barricade', stairs: 'stairs', flag: 'flag', bed: 'bed', lamp: 'lamp', campfire_pit: 'fire', chest: 'box', generator: 'machine',
    moat: 'tile', bridge: 'tile', castle_wall: 'wall', tower: 'wall', magic_table: 'bench', technical_table: 'bench', garage: 'machine', double_bed: 'bed' };
  const BUILDING_STYLE = { market: 'stall', clinic: 'tent', tower: 'tower', workshop: 'shed', barracks: 'bunker', house: 'hut' };
  const FAMILY_STYLE = { partner: 'adult', child: 'child', elder: 'elder' };

  // Спрайт сущности: { sheet, key, ... } или null (нет рисунка — ошибка каталога)
  function spriteOf(kind, e) {
    if (e == null) return null;
    switch (kind) {
      case 'item': { const sh = e.icon && e.icon.shape; return ICON_SHAPES.includes(sh) ? { sheet: 'icons', key: sh, rarity: e.rarity || 'common' } : null; }
      case 'enemy': { const sh = e.look && e.look.shape; return ENEMY_SHAPES.includes(sh) ? { sheet: 'enemies', key: sh, anim: ANIMS[sh] } : null; }
      case 'biome': { const b = typeof e === 'number' ? BIOMES[e] : BIOMES.find((x) => x.id === e.id); return b ? { sheet: 'tiles', key: b.id, tex: b.tex, objects: BIOME_OBJECTS[b.id] } : null; }
      case 'vehicle': { const v = VEHICLES[e.id]; return v ? { sheet: 'vehicles', key: v.body, paint: v.paint, rust: v.rust } : null; }
      case 'piece': { const st = PIECE_STYLE[e.id] || (/bench|forge|lab/.test(e.id) ? 'bench' : null); return st ? { sheet: 'base', key: st, color: e.color } : null; }
      case 'building': { const st = BUILDING_STYLE[e.id]; return st ? { sheet: 'buildings', key: st, color: e.color } : null; }
      case 'node': return ['tree', 'rock', 'ruin'].includes(e.id) ? { sheet: 'objects', key: 'node_' + e.id } : null;
      case 'object': return OBJECT_KEYS.includes(e.id) ? { sheet: 'objects', key: e.id } : null;
      case 'family': return FAMILY_STYLE[e.id] ? { sheet: 'people', key: FAMILY_STYLE[e.id] } : null;
      default: return null;
    }
  }
  // Каких сущностей каталога нет в карте спрайтов: [{ kind, id }]
  function coverage(cat) {
    const miss = [];
    const each = (kind, list) => { for (const e of list || []) if (!spriteOf(kind, e)) miss.push({ kind, id: e.id }); };
    each('item', cat.items); each('enemy', cat.enemies); each('vehicle', cat.vehicles); each('piece', cat.pieces);
    each('building', cat.buildings); each('node', cat.nodes); each('family', cat.family);
    (cat.biomes || []).forEach((b, i) => { if (!spriteOf('biome', i)) miss.push({ kind: 'biome', id: b.id }); });
    for (const b of BIOMES) for (const o of BIOME_OBJECTS[b.id] || []) if (!OBJECT_KEYS.includes(o)) miss.push({ kind: 'object', id: o });
    return miss;
  }

  // ---------- Освещение ----------
  // Фаза суток 0…1 (0 — полночь, 0,5 — полдень) по реальному времени; artDayMin 0 — всегда полдень
  function dayPhase(nowMs, dayMin = settings.artDayMin) {
    if (!(dayMin > 0)) return 0.5;
    const len = dayMin * 60000;
    return ((nowMs % len) + len) % len / len;
  }
  // Свет: { tint (цвет поверх сцены), alpha, radius (клеток света вокруг героя или 0), name }
  // env: { phase, z, type } — type уровня (bunker, cave, underwater, tower, peak…), z — высота (0 — поверхность)
  function light(env, q = 'medium') {
    const e = env || {}, Q = quality(q);
    const water = e.type === 'underwater' || e.type === 'flooded';
    if (Q.lighting === 'flat') return { tint: water ? '#0a3a5a' : '#000000', alpha: water ? 0.18 : 0, radius: 0, name: water ? 'подводье' : 'ровный свет' };
    if (e.z < 0) {
      if (water) return { tint: '#06304e', alpha: 0.35, radius: settings.artUnderLight * 1.3, name: 'подводье' };
      return { tint: '#05060a', alpha: e.type === 'cave' || e.type === 'nest' ? 0.72 : 0.6, radius: settings.artUnderLight, name: 'подземелье' };
    }
    if (e.z > 0) return { tint: '#fff4d8', alpha: 0.06, radius: 0, name: 'высота' };
    const p = typeof e.phase === 'number' ? e.phase : 0.5;
    const sun = Math.cos((p - 0.5) * Math.PI * 2); // 1 — полдень, −1 — полночь
    const night = Math.max(0, Math.min(1, -sun / 0.6)); // темнеет, когда солнце ниже горизонта
    const dusk = Math.max(0, 1 - Math.abs(sun - 0.05) / 0.3); // рассвет/закат
    const dark = Math.min(0.8, settings.artNightDark) * night;
    if (dark > dusk * 0.12) return { tint: '#0a1030', alpha: +dark.toFixed(3), radius: night > 0.6 ? settings.artUnderLight + 3 : 0, name: 'ночь' };
    if (dusk > 0.05) return { tint: '#ff8a3a', alpha: +(dusk * 0.12).toFixed(3), radius: 0, name: p < 0.5 ? 'рассвет' : 'закат' };
    return { tint: '#000000', alpha: 0, radius: 0, name: 'день' };
  }

  // ---------- Частицы ----------
  const PARTICLES = {
    hit: { n: 6, colors: ['#ffffff', '#ffd8a0'], speed: 2.2, life: 280, size: 2, gravity: 0 },
    crit: { n: 12, colors: ['#ffd83a', '#ffffff'], speed: 3, life: 380, size: 2.5, gravity: 0 },
    blood: { n: 10, colors: ['#a01818', '#701010'], speed: 2, life: 500, size: 2.5, gravity: 6 },
    spark: { n: 8, colors: ['#ffe08a', '#ff9a3a'], speed: 3.5, life: 260, size: 1.5, gravity: 4 },
    smoke: { n: 10, colors: ['#5a5550', '#3a3632'], speed: 0.8, life: 900, size: 5, gravity: -1.5 },
    fire: { n: 12, colors: ['#ffb03a', '#ff5a1a', '#ffe07a'], speed: 1.4, life: 600, size: 3, gravity: -3 },
    frost: { n: 10, colors: ['#bfe8ff', '#ffffff'], speed: 1.2, life: 700, size: 2, gravity: 0.5 },
    poison: { n: 10, colors: ['#8ee05a', '#4a8a2a'], speed: 0.9, life: 800, size: 3, gravity: -1 },
    arcane: { n: 14, colors: ['#c08aff', '#7ad0ff', '#ffffff'], speed: 1.8, life: 650, size: 2, gravity: -0.5 },
    heal: { n: 10, colors: ['#6ff08a', '#d8ffd8'], speed: 0.8, life: 800, size: 2, gravity: -2 },
    levelup: { n: 24, colors: ['#ffd27a', '#fff2c0'], speed: 1.5, life: 1100, size: 2.5, gravity: -2.5 },
    dust: { n: 4, colors: ['#a89878', '#8a7a5a'], speed: 0.5, life: 400, size: 2, gravity: -0.3 },
  };
  // Частицы вспышки: детерминированно по сиду; n умножается на долю качества (low — ни одной)
  function burst(kind, seed, q = 'medium', color = null) {
    const P = PARTICLES[kind];
    if (!P) return [];
    const k = quality(q).particles, n = Math.round(P.n * k);
    const R = rng(hash(kind + ':' + seed)), out = [];
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, sp = P.speed * (0.4 + R() * 0.8);
      out.push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - (P.gravity < 0 ? R() * 0.6 : 0), life: Math.round(P.life * (0.6 + R() * 0.6)), size: P.size * (0.6 + R() * 0.8), color: color && R() < 0.6 ? color : P.colors[Math.floor(R() * P.colors.length)], g: P.gravity });
    }
    return out;
  }
  // Какой вид частиц у события боя / магии (fx с сервера)
  function fxKind(ev) {
    if (!ev) return null;
    if (ev.k === 'hit') return ev.dot === 'burn' ? 'fire' : ev.dot === 'poison' ? 'poison' : ev.dot === 'bleed' ? 'blood' : ev.c ? 'crit' : 'hit';
    if (ev.k === 'impact') return ev.f === 'fire' || ev.f === 'flame' ? 'fire' : ev.f === 'frost' || ev.f === 'ice' ? 'frost' : 'spark';
    if (ev.k === 'boom') return ev.f === 'blood' ? 'blood' : 'smoke';
    if (ev.k === 'spell') return ev.school === 'fire' ? 'fire' : ev.school === 'water' ? 'frost' : ev.school === 'life' || ev.school === 'light' ? 'heal' : 'arcane';
    if (ev.k === 'heal') return 'heal';
    if (ev.k === 'levelup') return 'levelup';
    if (ev.k === 'die') return 'blood';
    return null;
  }

  // ---------- Люди ----------
  const HAIR = ['#2a1a10', '#4a2e1a', '#6a4a2a', '#a8743a', '#c8a050', '#d8c890', '#8a2a1a', '#1a1a1a'];
  const SKIN = ['#f1c9a5', '#e0ac85', '#c68863', '#9c6644', '#6e4630', '#f6d7c0'];
  const CLOTH = ['#6a8a5a', '#8a5a6a', '#5a6a8a', '#8a7a4a', '#a0603a', '#4a7a7a', '#7a5a9a', '#9a8a6a'];
  const ACCESSORY = [null, 'cap', 'bow', 'scarf', 'patch', null];
  // Внешность ребёнка: рост по возрасту (0,55…1 от взрослого), волосы, кожа, одежда, косички, аксессуар — по сиду
  function childLook(seed, age, adultAge = 16) {
    const R = rng(hash('child:' + seed));
    const grown = Math.max(0, Math.min(1, (Number(age) || 0) / Math.max(1, adultAge)));
    return {
      scale: +(0.55 + 0.45 * grown).toFixed(3),
      hair: HAIR[Math.floor(R() * HAIR.length)], skin: SKIN[Math.floor(R() * SKIN.length)],
      shirt: CLOTH[Math.floor(R() * CLOTH.length)], pants: CLOTH[Math.floor(R() * CLOTH.length)],
      longHair: R() < 0.5, accessory: ACCESSORY[Math.floor(R() * ACCESSORY.length)], freckles: R() < 0.3,
    };
  }

  return { settings, configure, QUALITY, RENDERERS, FPS_CAPS, sanitizeGfx, effectiveGfx, lowerQuality, quality, hash, rng, BIOMES, TEXTURES, BIOME_OBJECTS, OBJECT_KEYS, texturePixels, atlasHash,
    ICON_SHAPES, ENEMY_SHAPES, ANIMS, VEHICLES, PIECE_STYLE, BUILDING_STYLE, FAMILY_STYLE, spriteOf, coverage, dayPhase, light, PARTICLES, burst, fxKind, childLook, HAIR, SKIN, CLOTH };
});
