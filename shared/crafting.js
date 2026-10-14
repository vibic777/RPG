// Крафт — данные и правила, общие для сервера и клиента (книга рецептов, K).
// Рецепт: { id, name, out: { id, n } | null, piece?, in: { материал: n }, station: null | ключ станка, time (с),
//   req: { характеристика: минимум }, start (известен с начала), group }.
// piece — рецепт-чертёж постройки (ничего не создаёт, открывает сооружение в режиме строительства).
// Известные рецепты хранятся у героя (ch.recipes); новые — свитками (предмет с teaches), позже — у торговцев.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./items'), require('./character-rules'));
  else root.Crafting = factory(root.Items, root.CharacterRules);
})(typeof self !== 'undefined' ? self : this, function (Items, Rules) {
  'use strict';

  const settings = { craftQueueMax: 5, craftStationRange: 3, craftTimeFactor: 1 };
  function configure(game) { for (const k of Object.keys(settings)) if (game && game[k] !== undefined) settings[k] = game[k]; }

  const STATIONS = {
    workbench: { name: 'Верстак', hint: 'Инструменты, оружие ближнего боя, одежда из шкур.' },
    forge: { name: 'Кузница', hint: 'Металл: клинки, доспехи, патроны.' },
    chem: { name: 'Химстол', hint: 'Алхимия и химия: порох, лекарства, антирадин.' },
    electronics: { name: 'Стол электроники', hint: 'Турели, энергоячейки, приборы.' },
    magic: {name:'Стол магии',hint:'Магическое оружие и комплекты брони.'},
    technical: {name:'Стол техники',hint:'Турели и роботы-спутники.'},
    garage: {name:'Гараж',hint:'Машины, грузовики и танки.'},
    fire: { name: 'Костёр', hint: 'Готовка еды и очистка воды: костровой набор или постоянный костёр базы.' },
  };
  const GROUPS = { basic: 'Основное', tools: 'Инструменты', weapons: 'Оружие', ammo: 'Боеприпасы', armor: 'Одежда и броня', meds: 'Лекарства', food: 'Еда и вода', build: 'Постройки', tech: 'Техника' };

  const R = (id, name, group, out, inp, station, time, extra = {}) => ({ id, name, group, out, in: inp, station, time, req: {}, start: false, ...extra });
  const RECIPES = [
    // стартовые
    R('planks', 'Доски', 'basic', { id: 'planks', n: 2 }, { wood: 2 }, null, 2, { start: true }),
    R('base_flag', 'Флаг базы', 'basic', { id: 'base_flag', n: 1 }, { wood: 5, cloth: 2 }, null, 5, { start: true }),
    R('campfire', 'Костровой набор', 'basic', { id: 'campfire', n: 1 }, { wood: 3 }, null, 2, { start: true }),
    R('club_plain', 'Дубина', 'weapons', { id: 'club_plain', n: 1 }, { wood: 2 }, null, 3, { start: true }),
    R('cook_meat', 'Жареное мясо', 'food', { id: 'meat_roast', n: 1 }, { meat_raw: 1 }, 'fire', 3, { start: true }),
    R('purify_water', 'Очищенная вода', 'food', { id: 'water_clean', n: 1 }, { water_dirty: 1 }, 'fire', 3, { start: true }),
    R('axe_wood', 'Топор лесоруба', 'tools', { id: 'axe_wood', n: 1 }, { wood: 2, scrap_metal: 2 }, 'workbench', 6, { start: true }),
    R('pickaxe', 'Кирка', 'tools', { id: 'pickaxe', n: 1 }, { wood: 2, scrap_metal: 3 }, 'workbench', 6, { start: true }),
    R('crowbar', 'Монтировка', 'tools', { id: 'crowbar', n: 1 }, { scrap_metal: 3 }, 'workbench', 5, { start: true }),
    R('bedroll', 'Спальник', 'basic', { id: 'bedroll', n: 1 }, { hide: 2, cloth: 3 }, 'workbench', 8, { start: true }),
    R('bow_crude', 'Самодельный лук', 'weapons', { id: 'bow_crude', n: 1 }, { wood: 3, cloth: 1 }, 'workbench', 6, { start: true }),
    R('ammo_arrow', 'Стрелы × 10', 'ammo', { id: 'ammo_arrow', n: 10 }, { wood: 2, scrap_metal: 1 }, 'workbench', 4, { start: true }),
    // по свиткам
    R('outer_leather', 'Кожаная куртка', 'armor', { id: 'outer_leather', n: 1 }, { hide: 4, cloth: 2 }, 'workbench', 10, { req: { builder: 2 } }),
    R('armor_leather', 'Кожаный доспех', 'armor', { id: 'armor_leather', n: 1 }, { hide: 6, scrap_metal: 2 }, 'workbench', 14, { req: { builder: 3 } }),
    R('sword_short', 'Короткий меч', 'weapons', { id: 'sword_short', n: 1 }, { scrap_metal: 6, wood: 1 }, 'forge', 12, { req: { strength: 3 } }),
    R('armor_chain', 'Кольчуга', 'armor', { id: 'armor_chain', n: 1 }, { scrap_metal: 12, cloth: 2 }, 'forge', 20, { req: { strength: 4 } }),
    R('gunpowder', 'Порох × 2', 'ammo', { id: 'gunpowder', n: 2 }, { stone: 1, wood: 1 }, 'chem', 5, { req: { intellect: 2 } }),
    R('ammo_9mm', 'Патроны 9 мм × 10', 'ammo', { id: 'ammo_9mm', n: 10 }, { scrap_metal: 1, gunpowder: 1 }, 'forge', 6, { req: { engineering: 2 } }),
    R('ammo_12g', 'Дробь 12 калибра × 6', 'ammo', { id: 'ammo_12g', n: 6 }, { scrap_metal: 1, gunpowder: 1 }, 'forge', 6, { req: { engineering: 2 } }),
    R('medkit', 'Аптечка', 'meds', { id: 'medkit', n: 1 }, { cloth: 3, herbs: 2, plastic: 1 }, 'chem', 8, { req: { intellect: 3 } }),
    R('antirad', 'Антирадин', 'meds', { id: 'antirad', n: 1 }, { herbs: 3, plastic: 1 }, 'chem', 8, { req: { intellect: 3 } }),
    R('stim', 'Стимулятор', 'meds', { id: 'stim', n: 1 }, { herbs: 2, electronics: 1, plastic: 1 }, 'chem', 10, { req: { intellect: 5 } }),
    R('ration', 'Сухпаёк', 'food', { id: 'ration', n: 1 }, { meat_roast: 1, herbs: 1 }, 'fire', 4),
    R('ammo_cell', 'Энергоячейка', 'tech', { id: 'ammo_cell', n: 1 }, { electronics: 2, plastic: 1, scrap_metal: 1 }, 'electronics', 10, { req: { engineering: 3 } }),
    R('mine_clapper', 'Мина «Хлопушка»', 'tech', { id: 'mine_clapper', n: 1 }, { scrap_metal: 2, gunpowder: 2 }, 'forge', 8, { req: { engineering: 3 } }),
    R('turret_watchman', 'Турель', 'tech', { id: 'turret_watchman', n: 1 }, { scrap_metal: 10, electronics: 4 }, 'electronics', 30, { req: { engineering: 5 } }),
    // спутники (шаг 11): контейнер-уменьшитель — из редкой электроники и платины; драконий амулет — для приручения драконов
    R('shrinker', 'Контейнер-уменьшитель', 'tech', { id: 'shrinker', n: 1 }, { circuit_rare: 3, platinum: 2, electronics: 4 }, 'electronics', 60, { req: { engineering: 6 } }),
    R('dragon_charm', 'Драконий амулет', 'tech', { id: 'dragon_charm', n: 1 }, { platinum: 3, gold_nugget: 3, circuit_rare: 1 }, 'chem', 45, { req: { taming: 5 } }),
    // транспорт (шаг 14): велосипед и лодка — с начала; запчасти, мотоцикл и бензин — по свиткам
    R('veh_kit_bicycle', 'Велосипед', 'tech', { id: 'veh_kit_bicycle', n: 1 }, { scrap_metal: 6, plastic: 2 }, 'workbench', 15, { start: true }),
    R('veh_kit_rowboat', 'Вёсельная лодка', 'tech', { id: 'veh_kit_rowboat', n: 1 }, { planks: 8, cloth: 2 }, 'workbench', 15, { start: true }),
    R('veh_parts', 'Автозапчасти', 'tech', { id: 'veh_parts', n: 1 }, { scrap_metal: 4, plastic: 1 }, 'forge', 8, { req: { engineering: 2 } }),
    R('veh_kit_motorcycle', 'Мотоцикл', 'tech', { id: 'veh_kit_motorcycle', n: 1 }, { scrap_metal: 16, electronics: 4, veh_parts: 4 }, 'workbench', 40, { req: { engineering: 4 } }),
    R('fuel_gas', 'Бензин (канистра)', 'tech', { id: 'fuel_gas', n: 1 }, { wood: 4, plastic: 1 }, 'chem', 12, { req: { intellect: 3 } }),
    // чертежи построек (открывают сооружение в режиме строительства B)
    R('build_wall_stone', 'Чертёж: каменная стена', 'build', null, {}, null, 0, { piece: 'wall_stone', req: { builder: 2 } }),
    R('build_gate', 'Чертёж: ворота', 'build', null, {}, null, 0, { piece: 'gate', req: { builder: 2 } }),
    R('build_spikes', 'Чертёж: колья', 'build', null, {}, null, 0, { piece: 'spikes', req: { builder: 2 } }),
    R('build_forge', 'Чертёж: кузница', 'build', null, {}, null, 0, { piece: 'forge', req: { builder: 3 } }),
    R('build_chemlab', 'Чертёж: химстол', 'build', null, {}, null, 0, { piece: 'chemlab', req: { intellect: 2 } }),
    R('build_electronics', 'Чертёж: стол электроники', 'build', null, {}, null, 0, { piece: 'electronics_bench', req: { engineering: 3 } }),
    R('build_generator', 'Чертёж: генератор', 'build', null, {}, null, 0, { piece: 'generator', req: { engineering: 4 } }),
  ];
  for(const type of ['uav','quad','tracked','service'])RECIPES.push(R('drone_kit_'+type,Items.get('drone_kit_'+type).name,'tech',{id:'drone_kit_'+type,n:1},{scrap_metal:8,electronics:4,plastic:2},'technical',25,{start:true}));
  RECIPES.push(R('tech_turret','Турель: технический стол','tech',{id:'turret_watchman',n:1},{scrap_metal:10,electronics:4},'technical',30,{start:true}));
  // боеприпасы бортового оружия техники (гараж)
  RECIPES.push(
    R('ammo_30mm','Снаряды 30 мм × 20','ammo',{id:'ammo_30mm',n:20},{scrap_metal:3,gunpowder:2},'garage',10,{start:true}),
    R('ammo_tank_shell','Танковый снаряд 125 мм','ammo',{id:'ammo_tank_shell',n:1},{scrap_metal:4,gunpowder:3},'garage',12,{start:true}),
    R('ammo_rocket_veh','Реактивная граната (ракета) × 2','ammo',{id:'ammo_rocket',n:2},{scrap_metal:3,gunpowder:3,plastic:1},'garage',12,{start:true}),
    R('ammo_missile','Управляемая ракета','ammo',{id:'ammo_missile',n:1},{scrap_metal:6,gunpowder:4,electronics:3},'garage',20,{start:true}),
    R('ammo_torpedo','Торпеда','ammo',{id:'ammo_torpedo',n:1},{scrap_metal:10,gunpowder:6,electronics:2,veh_parts:1},'garage',25,{start:true}),
    R('ammo_bomb','Авиабомба','ammo',{id:'ammo_bomb',n:1},{scrap_metal:8,gunpowder:6},'garage',15,{start:true}));
  for(const [id,n]of [['car',20],['truck',32],['tank',50]])RECIPES.push(R('veh_kit_'+id,Items.get('veh_kit_'+id).name,'tech',{id:'veh_kit_'+id,n:1},{scrap_metal:n,veh_parts:Math.ceil(n/5),electronics:Math.ceil(n/8)},'garage',45,{start:true}));
  RECIPES.push(
    R('flight_jetpack','Реактивный ранец','tech',{id:'flight_jetpack',n:1},{scrap_metal:16,electronics:6,veh_parts:2},'technical',30,{start:true}),
    R('wings_angel','Крылья ангела','armor',{id:'wings_angel',n:1},{cloth:12,herbs:8,gold_nugget:3},'magic',30,{start:true}),
    R('wings_archangel','Крылья архангела','armor',{id:'wings_archangel',n:1},{cloth:24,herbs:16,platinum:6,circuit_rare:2},'magic',60,{start:true}),
    R('wings_hell','Крылья ада','armor',{id:'wings_hell',n:1},{hide:12,herbs:12,gold_nugget:5},'magic',40,{start:true})
  );
  // Каталог мастерской открывается по выбранному предмету, без тысяч строк рецептов в интерфейсе.
  function workshopPlan(it) {
    if(it?.flight){const recipe=RECIPES.find(r=>r.out?.id===it.id);if(recipe)return {station:recipe.station,cost:{...recipe.in}};}
    if(!it||it.fixed||it.placeable||!['weapon','armor','clothing'].includes(it.category))return null;
    const magical=it.school&&it.school!=='none'||it.weapon?.flags?.includes('magic');
    const advanced=['laser','plasma','tesla','ion'].includes(it.material);
    const station=it.flight==='jetpack'?'technical':it.flight?'magic':magical?'magic':advanced?'technical':it.weapon||it.category==='armor'?'forge':'workbench';
    const rarity={common:1,uncommon:2,rare:3,epic:5,legendary:8}[it.rarity]||2;
    const cost={scrap_metal:4+rarity*2};
    if(it.category!=='weapon')cost.cloth=3+rarity;
    if(advanced||it.weapon&&it.weapon.ammo)cost.electronics=2+rarity;
    if(it.material==='gold')cost.gold_nugget=rarity;
    if(it.material==='platinum')cost.platinum=rarity;
    if(['adamant','diamond','brilliant'].includes(it.material))cost.circuit_rare=rarity;
    if(magical){cost.herbs=4+rarity;cost.gold_nugget=(cost.gold_nugget||0)+2;}
    return {station,cost};
  }
  const BY_ID = new Map(RECIPES.map((r) => [r.id, r]));
  const get = (id) => BY_ID.get(id) || null;
  const startSet = () => RECIPES.filter((r) => r.start).map((r) => r.id);

  // Известные рецепты героя (стартовые — всегда)
  function known(ch) {
    const set = new Set(startSet());
    for (const id of (ch && Array.isArray(ch.recipes) ? ch.recipes : [])) if (BY_ID.has(id)) set.add(id);
    return set;
  }
  function learn(ch, id) {
    const r = get(id);
    if (!r) return 'Неизвестный рецепт.';
    if (known(ch).has(id)) return `Рецепт «${r.name}» уже известен.`;
    ch.recipes = [...new Set([...(Array.isArray(ch.recipes) ? ch.recipes : []), id])];
    return null;
  }

  // Считать материалы в сумке героя (ячейки)
  function haveCount(ch, id) {
    return (ch.inventory && ch.inventory.cells ? ch.inventory.cells : []).reduce((a, c) => a + (c && c.id === id ? c.n : 0), 0);
  }
  const statOf = (ch, s) => (ch.stats && ch.stats[s]) || 0;

  // Можно ли начать крафт: ctx { stations: Set ключей станков рядом }. Возвращает текст ошибки или null
  function check(ch, r, times = 1, ctx = {}) {
    if (!r) return 'Неизвестный рецепт.';
    if (!known(ch).has(r.id)) return `Рецепт «${r.name}» не изучен. Найдите свиток рецепта.`;
    if (r.piece) return `«${r.name}» — чертёж: постройка открыта в режиме строительства (B).`;
    for (const [s, v] of Object.entries(r.req || {})) if (statOf(ch, s) < v) return `Нужно: ${(Rules.STATS.find((x) => x.id === s) || { label: s }).label} ${v}.`;
    if (r.station && !(ctx.stations && ctx.stations.has(r.station))) return `Нужен станок рядом: ${STATIONS[r.station].name}.`;
    const miss = Object.entries(r.in).filter(([id, n]) => haveCount(ch, id) < n * times).map(([id, n]) => `${Items.get(id).name} ${haveCount(ch, id)}/${n * times}`);
    if (miss.length) return 'Не хватает: ' + miss.join(', ') + '.';
    return null;
  }

  // Проверка данных: выходы и материалы существуют, станки известны, у изучаемых рецептов есть свиток
  function validate() {
    const errs = [];
    const scrolls = new Set(Items.ITEMS.filter((i) => i.teaches).map((i) => i.teaches));
    for (const r of RECIPES) {
      const e = (m) => errs.push(`${r.id}: ${m}`);
      if (r.out && !Items.get(r.out.id)) e('неизвестный результат ' + r.out.id);
      if (r.out && !(Number.isInteger(r.out.n) && r.out.n >= 1)) e('количество результата');
      if (!r.out && !r.piece) e('нет результата');
      for (const [id, n] of Object.entries(r.in)) { if (!Items.get(id)) e('неизвестный материал ' + id); if (!(Number.isInteger(n) && n >= 1)) e('количество материала ' + id); }
      if (r.station && !STATIONS[r.station]) e('неизвестный станок ' + r.station);
      for (const s of Object.keys(r.req)) if (!Rules.STATS.some((x) => x.id === s)) e('неизвестная характеристика ' + s);
      if (!r.start && !scrolls.has(r.id)) e('нет свитка рецепта');
      if (!GROUPS[r.group]) e('неизвестная группа');
    }
    for (const id of scrolls) if (!BY_ID.has(id)) errs.push(`свиток учит неизвестный рецепт ${id}`);
    return errs;
  }

  return { settings, configure, STATIONS, GROUPS, RECIPES, workshopPlan, get, startSet, known, learn, haveCount, check, validate };
});
