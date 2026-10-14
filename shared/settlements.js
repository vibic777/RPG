// Поселения (шаг 15): застройка по сиду, жители, торговля, репутация, диалоги, набеги.
// Общий файл: сервер (жители, сделки, репутация, стража, набеги) и клиент (стены и дома на карте, окно диалога, торговля, справка).
// Застройка детерминирована по сиду мира и id поселения: сервер и клиент строят одинаково. Стены и дома — отдельный слой
// map.walls (Set индексов клеток, shared/worldgen.js isWalkable): сами клетки карты и её контрольная сумма не меняются.
// Диалоги — данные: { start, nodes: { id: { text, options: [{ text, next | action, cond? }] } } } (формат пригодится шагу 16 — задания).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./worldgen'), require('./items'));
  else root.Settlements = factory(root.WorldGen, root.Items);
})(typeof self !== 'undefined' ? self : this, function (WorldGen, Items) {
  'use strict';
  const { mulberry32, hashString } = WorldGen;

  const settings = {
    settlementsEnabled: true, // жители, торговля и репутация включены
    settlementLayout: true, // застройка: дома, стены, ворота (выключено — только площадь без стен)
    settlementWakeRadius: 30, // жители появляются, когда герой ближе, клеток
    settlementTalkRange: 3, // дальность разговора с жителем, клеток
    settlementNpcRespawnSec: 300, // убитый житель возвращается через, с
    settlementRestockMin: 30, // торговцы пополняют товар раз в, мин
    tradeBuyFactor: 1.2, // цена покупки = ценность × редкость × это
    tradeSellFactor: 0.4, // цена продажи торговцу = ценность × редкость × это
    tradeRepPriceMax: 0.3, // репутация ±100 меняет цены на ±30%
    tradeDamagedFactor: 1.5, // разорённое набегом поселение: цены × это
    healPricePerHp: 0.5, // лечение: крышек за единицу здоровья
    curePrice: 60, // лечение болезни и радиации, крышек
    spellPricePerTier: 150, // обучение заклинанию: крышек × круг²
    recipePriceFactor: 2, // рецепт: ценность результата × это (не меньше 40 крышек)
    repTradePer: 500, // +1 репутации за каждые столько крышек сделок
    repAssault: 10, // нападение на жителя: −репутации
    repMurder: 40, // убийство жителя: −репутации
    repDefend: 15, // отбитый набег: +репутации защитникам
    repFactionShare: 0.25, // доля изменения репутации для поселений того же рода
    repHostileAt: -50, // ниже — стража нападает, никто не торгует
    repUnfriendlyAt: -15, // ниже — лекарь и маг отказывают
    repFriendlyAt: 25, // выше — «друг»: вербовка легче
    repHonoredAt: 60, // выше — «почёт»
    wantedSec: 120, // после нападения стража преследует, с
    guardAggroRadius: 8, // стража замечает врагов и преступников, клеток
    guardLeash: 10, // стража не уходит дальше края поселения на, клеток
    raidRewardGold: 2, // награда защитникам отбитого набега: самородков
    raidMaxMin: 6, // набег без победы дольше — поселение разорено
    raidDamagePerSec: 0.5, // каждый налётчик в поселении: урон поселению в секунду (из 100)
    settlementRegenPerMin: 2, // поселение отстраивается: прочность в минуту
    settlementPvpOff: true, // в поселениях игроки не могут сражаться
  };
  function configure(o = {}) {
    for (const k of Object.keys(settings)) if (o && o[k] !== undefined && typeof o[k] === typeof settings[k]) settings[k] = o[k];
  }

  // ---------- Рода поселений ----------
  // r — полуразмер застройки; ring — стена по краю (ворота: N/S/W/E); slots — дома (по порядку мест); roles — жители;
  // maxRarity — самый редкий товар; cats — что любит торговец (вес категории); spellTier — до какого круга учит маг
  const KINDS = {
    village: { name: 'Деревня', faction: 'Деревни', r: 6, ring: ['N', 'S', 'W', 'E'], wall: '#92744d', style: 'wood', slots: ['market', 'clinic', 'house'], roles: ['trader', 'healer', 'quest', 'guard', 'civilian', 'civilian'], maxRarity: 'uncommon', cats: { consumable: 3, material: 3, clothing: 1, weapon: 1, ammo: 1 }, spellTier: 1, raiders: ['raider_thug', 'raider_gunner'] },
    town: { name: 'Поселение', faction: 'Поселения', r: 7, ring: ['N', 'S', 'W', 'E'], wall: '#77766b', style: 'scrap', slots: ['market', 'clinic', 'tower', 'workshop', 'house', 'house'], roles: ['trader', 'healer', 'mage', 'recipes', 'quest', 'guard', 'guard', 'civilian', 'civilian', 'civilian'], maxRarity: 'rare', cats: { consumable: 2, material: 2, clothing: 1, armor: 1, weapon: 2, ammo: 2, backpack: 1, accessory: 1 }, spellTier: 2, raiders: ['raider_thug', 'raider_gunner', 'raider_marauder'] },
    base: { name: 'База', faction: 'Базы', r: 8, ring: ['N', 'S', 'W', 'E'], wall: '#596a70', style: 'military', slots: ['market', 'clinic', 'workshop', 'barracks', 'house'], roles: ['trader', 'healer', 'recipes', 'quest', 'guard', 'guard', 'guard', 'guard', 'civilian'], maxRarity: 'rare', cats: { weapon: 3, ammo: 3, armor: 2, consumable: 1, material: 1 }, spellTier: 0, raiders: ['mutant_irradiated', 'mutant_slasher', 'raider_gunner'] },
    vault: { name: 'Убежище', faction: 'Убежища', r: 6, ring: ['N', 'S', 'W', 'E'], wall: '#587d81', style: 'vault', slots: ['market', 'clinic', 'tower', 'workshop'], roles: ['trader', 'healer', 'mage', 'recipes', 'quest', 'guard', 'guard', 'civilian', 'civilian'], maxRarity: 'epic', cats: { consumable: 3, material: 2, accessory: 1, armor: 1, ammo: 1 }, spellTier: 3, raiders: ['zombie', 'zombie_runner', 'zombie_bloated'] },
  };
  const BUILDINGS = {
    market: { name: 'Рынок', color: '#a07a3a', icon: '⚖', role: 'trader' },
    clinic: { name: 'Лечебница', color: '#c8c8c0', icon: '✚', role: 'healer' },
    tower: { name: 'Башня мага', color: '#6a5aa0', icon: '✦', role: 'mage' },
    workshop: { name: 'Мастерская', color: '#7a6a5a', icon: '⚒', role: 'recipes', stations: ['workbench', 'forge'] },
    barracks: { name: 'Казарма', color: '#5a6a4a', icon: '⚔', role: 'guard' },
    house: { name: 'Дом', color: '#8a7058', icon: '⌂', role: 'civilian' },
  };

  // ---------- Жители ----------
  // hp, damage [мин, макс], range — дальность удара, speed — клеток/с, dlg — диалог, look — цвета одежды для отрисовки
  const ROLES = {
    trader: { name: 'Торговец', hp: 60, damage: [3, 6], range: 1.2, speed: 2, dlg: 'trader', icon: '⚖', look: { shirt: '#a07a3a', pants: '#4a3a2a' }, hint: 'Покупает и продаёт. Цены зависят от редкости и вашей репутации.' },
    healer: { name: 'Лекарь', hp: 50, damage: [2, 4], range: 1.2, speed: 2, dlg: 'healer', icon: '✚', look: { shirt: '#e0e0d8', pants: '#6a6a6a' }, hint: 'Лечит раны, болезнь и радиацию за плату; продаёт лекарства.' },
    mage: { name: 'Маг-наставник', hp: 70, damage: [6, 10], range: 5, speed: 2, dlg: 'mage', icon: '✦', look: { shirt: '#5a4a90', pants: '#2a2440' }, hint: 'Учит заклинаниям за плату (круг — по роду поселения).' },
    recipes: { name: 'Мастер-рецептурщик', hp: 60, damage: [4, 7], range: 1.2, speed: 2, dlg: 'recipes', icon: '⚒', look: { shirt: '#7a6a5a', pants: '#3a3028' }, hint: 'Продаёт рецепты крафта (без свитков).' },
    quest: { name: 'Староста', hp: 60, damage: [3, 6], range: 1.2, speed: 2, dlg: 'quest', icon: '❗', look: { shirt: '#5a7a9a', pants: '#2a3a4a' }, hint: 'Раздаёт задания (обычные — обновляются со временем — и сюжетные), принимает посылки и добытое.' },
    guard: { name: 'Стражник', hp: 140, damage: [9, 15], range: 6, speed: 3.2, dlg: 'guard', icon: '⚔', look: { shirt: '#4a5a3a', pants: '#2a3020', armor: '#6a6e70' }, hint: 'Обходит поселение, защищает его от врагов и наказывает преступников.' },
    civilian: { name: 'Житель', hp: 40, damage: [1, 3], range: 1.2, speed: 1.8, dlg: 'civilian', icon: '·', look: { shirt: '#8a7a6a', pants: '#4a4038' }, hint: 'Мирный житель. Напасть на него — преступление.' },
  };
  const NAMES = ['Агафья', 'Борис', 'Варвара', 'Глеб', 'Дуня', 'Ефим', 'Жора', 'Зоя', 'Игнат', 'Клава', 'Лука', 'Марфа', 'Никита', 'Ольга', 'Прохор', 'Рада', 'Савва', 'Таисия', 'Устин', 'Фрол', 'Харитон', 'Юлиан', 'Ярина', 'Тихон', 'Аким', 'Степан', 'Нюра', 'Матвей'];

  // ---------- Диалоги ----------
  // Действия, которые понимает сервер: trade, heal, learn, recipes, quest, bye. Условия: friendly, unfriendly, damaged, raid.
  // В тексте: {npc} — имя жителя, {town} — поселение, {player} — герой, {tier} — отношение.
  const ACTIONS = ['trade', 'heal', 'learn', 'recipes', 'quest', 'bye', 'fam_talk', 'fam_gift', 'fam_court', 'fam_propose', 'fam_wed', 'orphans'];
  const CONDS = ['friendly', 'unfriendly', 'damaged', 'raid', 'notHostile', 'famOk', 'famCourt', 'famPropose', 'famWed', 'famKids'];
  const bye = { text: 'До встречи.', action: 'bye' };
  const DIALOGUES = {
    trader: { start: 'hi', nodes: {
      hi: { text: '{npc}: «Добро пожаловать в {town}, {player}! Лучший товар по эту сторону пустоши.»', options: [{ text: 'Покажи товар.', action: 'trade', cond: 'notHostile' }, { text: 'Чем платят?', next: 'money' }, { text: 'Как дела в поселении?', next: 'news' }, bye] },
      money: { text: '{npc}: «Крышками, дружище. Золотой самородок — это сто крышек, сдачу дам. Чем лучше о тебе говорят, тем дешевле товар.»', options: [{ text: 'Понятно.', next: 'hi' }, bye] },
      news: { text: '{npc}: «Отношение к тебе: {tier}. Помогай поселению — и цены станут мягче.»', options: [{ text: 'Назад.', next: 'hi' }, bye] },
    } },
    healer: { start: 'hi', nodes: {
      hi: { text: '{npc}: «Ранен? Болен? Фонишь? Садись, посмотрю.»', options: [{ text: 'Подлечи меня.', action: 'heal', cond: 'notHostile' }, { text: 'Что продаёшь?', action: 'trade', cond: 'notHostile' }, bye] },
    } },
    mage: { start: 'hi', nodes: {
      hi: { text: '{npc}: «Магия — не игрушка, {player}. Но знание продаётся, как и всё здесь.»', options: [{ text: 'Научи меня.', action: 'learn', cond: 'notHostile' }, { text: 'Откуда магия после катастрофы?', next: 'lore' }, bye] },
      lore: { text: '{npc}: «Излучение разбудило то, что спало в людях. Одни сгорели, другие научились этим управлять.»', options: [{ text: 'Назад.', next: 'hi' }, bye] },
    } },
    recipes: { start: 'hi', nodes: {
      hi: { text: '{npc}: «Чертежи, рецепты, секреты ремесла. За верстак в мастерской платить не надо — пользуйся.»', options: [{ text: 'Какие рецепты есть?', action: 'recipes', cond: 'notHostile' }, bye] },
    } },
    quest: { start: 'hi', nodes: {
      hi: { text: '{npc}: «Я присматриваю за {town}. Отношение к тебе: {tier}.»', options: [{ text: 'Есть работа?', action: 'quest' }, { text: 'Как помочь поселению?', next: 'help' }, bye] },
      help: { text: '{npc}: «Торгуй честно, не трогай людей, а когда придут налётчики — встань рядом со стражей. За защиту платим золотом.»', options: [{ text: 'Назад.', next: 'hi' }, bye] },
    } },
    guard: { start: 'hi', nodes: {
      hi: { text: '{npc}: «Здесь мирная зона. Оружие — в чехол, драки — за воротами.»', options: [{ text: 'А если нападут?', next: 'raid' }, { text: 'Ладно, ладно.', action: 'bye' }] },
      raid: { text: '{npc}: «Налётчиков встречаем все вместе. Кто помог отбиться — получит награду и уважение.»', options: [bye] },
    } },
    civilian: { start: 'hi', nodes: {
      hi: { text: '{npc}: «Здравствуй, путник. Торговец на рынке, лекарь в лечебнице — спроси у них.»', options: [{ text: 'Как тут живётся?', next: 'life' }, bye] },
      life: { text: '{npc}: «Пока стража держит стены — живём. Раньше было хуже.»', options: [bye] },
    } },
  };
  // Семья (шаг 17): личный разговор у всех, кроме стражи (условия famOk… присылает сервер в npc-talk.flags), сироты — у старосты
  const FAM_NODE = { text: '{npc} внимательно смотрит на вас: «Ну, о чём поговорим?»', options: [
    { text: 'Поболтать по душам.', action: 'fam_talk' }, { text: 'Сделать подарок…', action: 'fam_gift' },
    { text: 'Пригласить на прогулку (ухаживать).', action: 'fam_court', cond: 'famCourt' }, { text: 'Сделать предложение.', action: 'fam_propose', cond: 'famPropose' },
    { text: 'Сыграть свадьбу!', action: 'fam_wed', cond: 'famWed' }, { text: 'Назад.', next: 'hi' }] };
  for (const id of ['trader', 'healer', 'mage', 'recipes', 'quest', 'civilian']) {
    const d = DIALOGUES[id], opts = d.nodes.hi.options;
    d.nodes.fam = FAM_NODE;
    opts.splice(opts.length - 1, 0, { text: 'Поговорить о личном…', next: 'fam', cond: 'famOk' });
    if (id === 'quest') opts.splice(opts.length - 1, 0, { text: 'Есть ли сироты, которым нужен дом?', action: 'orphans', cond: 'famKids' });
  }
  // ext: { actions, conds } — дополнительные действия и условия (задания шага 16 — shared/quests.js)
  function validateDialogue(d, id = '?', ext = {}) {
    const errs = [], acts = [...ACTIONS, ...(ext.actions || [])], conds = [...CONDS, ...(ext.conds || [])];
    if (!d || typeof d !== 'object' || !d.nodes || !d.nodes[d.start]) return [`${id}: нет стартового узла`];
    const seen = new Set([d.start]), queue = [d.start];
    while (queue.length) {
      const k = queue.shift(), n = d.nodes[k];
      if (!n || typeof n.text !== 'string' || !n.text) { errs.push(`${id}.${k}: нет текста`); continue; }
      if (!Array.isArray(n.options) || !n.options.length) errs.push(`${id}.${k}: нет вариантов ответа`);
      for (const o of n.options || []) {
        if (!o.text) errs.push(`${id}.${k}: вариант без текста`);
        if (Boolean(o.next) === Boolean(o.action)) errs.push(`${id}.${k}: у варианта «${o.text}» должно быть ровно одно — next или action`);
        if (o.action && !acts.includes(o.action)) errs.push(`${id}.${k}: неизвестное действие ${o.action}`);
        if (o.cond && !conds.includes(o.cond)) errs.push(`${id}.${k}: неизвестное условие ${o.cond}`);
        if (o.next) { if (!d.nodes[o.next]) errs.push(`${id}.${k}: переход в несуществующий узел ${o.next}`); else if (!seen.has(o.next)) { seen.add(o.next); queue.push(o.next); } }
      }
    }
    for (const k of Object.keys(d.nodes)) if (!seen.has(k)) errs.push(`${id}.${k}: узел недостижим`);
    return errs;
  }
  // Варианты ответа с учётом условий; ctx: { tier, damaged, raid, flags? } — flags: свои условия (задания шага 16)
  function optionsFor(node, ctx) {
    return (node.options || []).filter((o) => !o.cond
      || (o.cond === 'friendly' && (ctx.tier === 'friendly' || ctx.tier === 'honored'))
      || (o.cond === 'unfriendly' && (ctx.tier === 'unfriendly' || ctx.tier === 'hostile'))
      || (o.cond === 'notHostile' && ctx.tier !== 'hostile')
      || (o.cond === 'damaged' && ctx.damaged) || (o.cond === 'raid' && ctx.raid)
      || Boolean(ctx.flags && ctx.flags[o.cond]));
  }
  const fill = (text, ctx) => String(text).replace(/\{(npc|town|player|tier)\}/g, (_, k) => (k === 'tier' ? TIERS[ctx.tier].name : ctx[k] || ''));

  // ---------- Репутация ----------
  const TIERS = {
    hostile: { name: 'враждебность', color: '#e05040' },
    unfriendly: { name: 'неприязнь', color: '#e0a040' },
    neutral: { name: 'безразличие', color: '#c8c0b0' },
    friendly: { name: 'дружба', color: '#7cd060' },
    honored: { name: 'почёт', color: '#60c0ff' },
  };
  const clampRep = (v) => Math.max(-100, Math.min(100, Math.round(Number(v) || 0)));
  function tierOf(rep) {
    const s = settings;
    if (rep <= s.repHostileAt) return 'hostile';
    if (rep <= s.repUnfriendlyAt) return 'unfriendly';
    if (rep >= s.repHonoredAt) return 'honored';
    if (rep >= s.repFriendlyAt) return 'friendly';
    return 'neutral';
  }
  // Для вербовки (зацепка «Договор», shared/companions.js): −2 … +2
  const tierBonus = (rep) => ({ hostile: -2, unfriendly: -1, neutral: 0, friendly: 1, honored: 2 }[tierOf(rep)]);

  // ---------- Цены ----------
  const RARITY_MUL = { common: 1, uncommon: 1.25, rare: 1.6, epic: 2.2, legendary: 3.2 };
  const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const repMul = (rep) => 1 - settings.tradeRepPriceMax * (clampRep(rep) / 100);
  // Цена в крышках: side 'buy' (герой покупает) | 'sell' (герой продаёт); o: { rep, damaged }
  function price(it, side, o = {}) {
    if (!it || !(it.value > 0)) return 0;
    const base = it.value * (RARITY_MUL[it.rarity] || 1);
    if (side === 'buy') return Math.max(1, Math.ceil(base * settings.tradeBuyFactor * repMul(o.rep) * (o.damaged ? settings.tradeDamagedFactor : 1)));
    return Math.max(1, Math.floor((base * settings.tradeSellFactor) / repMul(o.rep)));
  }
  const servicePrice = (base, o = {}) => Math.max(1, Math.ceil(base * repMul(o.rep) * (o.damaged ? settings.tradeDamagedFactor : 1)));
  const CURRENCY = ['caps', 'gold_nugget'];
  const NUGGET = 100; // крышек в самородке
  const tradable = (it) => Boolean(it && it.value > 0 && !it.fixed && !CURRENCY.includes(it.id) && !it.noTrade);

  // Товар торговца: детерминирован по сиду, поселению, роли и номеру пополнения
  function stockFor(seed, town, role, n) {
    const k = KINDS[town.type] || KINDS.village;
    const rnd = mulberry32(hashString(`${seed}:stock:${town.id}:${role}:${n}`));
    const maxR = RARITY_ORDER.indexOf(k.maxRarity);
    const pool = Items.ITEMS.filter((it) => tradable(it) && RARITY_ORDER.indexOf(it.rarity) <= maxR && !it.teaches && !it.teachesSpell && !it.vehicle
      && (role === 'healer' ? it.category === 'consumable' && it.effect && (it.effect.hp > 0 || it.effect.rad < 0 || it.cure || it.effect.mp > 0) : (k.cats[it.category] || 0) > 0));
    const out = {};
    const want = role === 'healer' ? 6 : 12;
    for (let t = 0; Object.keys(out).length < Math.min(want, pool.length) && t < 400; t++) {
      // взвешенный выбор: любимые категории и обычные вещи — чаще
      let total = 0;
      const w = pool.map((it) => { const x = (role === 'healer' ? 1 : k.cats[it.category]) / (1 + RARITY_ORDER.indexOf(it.rarity) * 1.5); total += x; return x; });
      let r = rnd() * total, i = 0;
      while (i < pool.length - 1 && r > w[i]) { r -= w[i]; i++; }
      const it = pool[i];
      if (out[it.id]) continue;
      out[it.id] = it.stackable ? 2 + Math.floor(rnd() * Math.min(10, it.stack)) : 1;
    }
    return out;
  }

  // ---------- Застройка ----------
  // Места домов (левый верхний угол 3×3 относительно центра) и сторона двери (к центру). Площадь 3×3 в центре свободна,
  // проходы на запад и восток всегда открыты (дома ставятся только в эти 6 мест).
  const SLOTS = [
    { dx: -7, dy: -7, door: [4, 2] }, { dx: 3, dy: -7, door: [0, 2] }, { dx: -7, dy: 3, door: [4, 2] }, { dx: 3, dy: 3, door: [0, 2] },
    { dx: -2, dy: -10, door: [2, 4] }, { dx: -2, dy: 6, door: [2, 0] },
  ];
  const plain = (map, x, y) => x >= 0 && y >= 0 && x < map.width && y < map.height && WorldGen.BIOMES[map.tiles[y * map.width + x]].walkable;
  function layout(map, town) {
    const k = KINDS[town.type] || KINDS.village;
    const rnd = mulberry32(hashString(`${map.seed}:town:${town.id}`));
    const cx = town.x, cy = town.y, W = map.width;
    const walls = new Set(), buildings = [], gateCells = new Set();
    const nearSpawn = (x, y) => map.spawn && Math.abs(map.spawn.x - x) <= 2 && Math.abs(map.spawn.y - y) <= 2;
    const order = SLOTS.map((s, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    k.slots.forEach((kind, n) => {
      const sl = SLOTS[order[n]];
      const x0 = cx + sl.dx, y0 = cy + sl.dy;
      const door = { x: x0 + sl.door[0], y: y0 + sl.door[1] };
      const inner = { x: x0 + 2, y: y0 + 2 };
      let ok = settings.settlementLayout;
      for (let y = y0; y < y0 + 5 && ok; y++) for (let x = x0; x < x0 + 5; x++) if (!plain(map, x, y) || nearSpawn(x, y)) { ok = false; break; }
      const b = { kind, x: x0, y: y0, w: 5, h: 5, door, inner, built: ok };
      if(ok)for(let y=y0;y<y0+5;y++)for(let x=x0;x<x0+5;x++){
        const corridor=(y===inner.y&&x>=Math.min(inner.x,door.x)&&x<=Math.max(inner.x,door.x))||(x===inner.x&&y>=Math.min(inner.y,door.y)&&y<=Math.max(inner.y,door.y));
        if(!corridor)walls.add(y*W+x);
      }
      buildings.push(b);
    });
    const r = k.r+6;
    const gates = [];
    if (k.ring && settings.settlementLayout) {
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || !plain(map, x, y)) continue;
        walls.add(y * W + x);
      }
      for (const side of k.ring) {
        const cells = side === 'N' || side === 'S'
          ? [-2, -1, 0, 1, 2].map((dx) => (side === 'N' ? cy - r : cy + r) * W + cx + dx)
          : [-2, -1, 0, 1, 2].map((dy) => (cy + dy) * W + (side === 'W' ? cx - r : cx + r));
        cells.forEach((j) => { if (walls.has(j)) gateCells.add(j); });
        if (cells.some((j) => gateCells.has(j))) gates.push({ id: `${town.id}:${side}`, side, appearance: ['scrap', 'truck', 'timber', 'vault'][hashString(`${town.id}:${side}`) % 4], cells: cells.filter((j) => walls.has(j)), open: false });
      }
      // Открытые проёмы используются только для проверки связности; в мире ворота закрыты по умолчанию.
      const pathWalls = new Set([...walls].filter((j) => !gateCells.has(j)));
      // ворота должны вести наружу: иначе стена не ставится
      if (!reachesOutside(map, pathWalls, cx, cy, r)) { walls.clear(); gates.length = 0; gateCells.clear(); }
    }
    if (!reachesOutside(map, new Set([...walls].filter((j) => !gateCells.has(j))), cx, cy, r)) { walls.clear(); gates.length = 0; gateCells.clear(); for (const b of buildings) b.built = false; }
    const defenses = [], decor = [];
    if (walls.size) {
      for (const [dx, dy] of [[-r + 1, -r + 1], [r - 1, -r + 1], [-r + 1, r - 1], [r - 1, r - 1]]) defenses.push({ x: cx + dx + 0.5, y: cy + dy + 0.5 });
      const choices = k.style === 'wood' ? ['well', 'planter', 'woodpile', 'lantern'] : k.style === 'scrap' ? ['waterTank', 'scrapPile', 'antenna', 'planter'] : k.style === 'military' ? ['generator', 'crates', 'radio', 'lamp'] : ['reactor', 'bench', 'planter', 'terminal'];
      for (let i = 0; i < 7; i++) {
        const dx = Math.floor(rnd() * (r * 2 - 3)) - r + 2, dy = Math.floor(rnd() * (r * 2 - 3)) - r + 2;
        const x = cx + dx, y = cy + dy, j = y * W + x;
        if (plain(map, x, y) && !walls.has(j) && !buildings.some((b) => b.built && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) && !defenses.some((p) => Math.floor(p.x) === x && Math.floor(p.y) === y)) decor.push({ kind: choices[Math.floor(rnd() * choices.length)], x: x + 0.5, y: y + 0.5, variant: Math.floor(rnd() * 3) });
      }
    }
    // жители: службы — в своём доме (или на площади), стража — у ворот и по углам, мирные — в домах и на площади
    const npcs = [];
    const free = (x, y) => plain(map, x, y) && !walls.has(y * W + x);
    const around = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    let civ = 0, grd = 0;
    k.roles.forEach((role, i) => {
      const home = buildings.find((b) => BUILDINGS[b.kind].role === role && !b.taken);
      let p;
      if (home && role !== 'guard' && role !== 'civilian') { home.taken = true; p = home.built ? home.inner : home.door; }
      else if (role === 'guard') { const a = (grd++ / 4) * Math.PI * 2 + Math.PI / 4; p = { x: Math.round(cx + Math.cos(a) * (r - 1.5)), y: Math.round(cy + Math.sin(a) * (r - 1.5)) }; }
      else { const hs = buildings.filter((b) => b.kind === 'house'); const h = hs[civ % Math.max(1, hs.length)]; p = h && civ < hs.length ? (h.built ? h.inner : h.door) : around[1 + (civ % 8)].map((d, j) => (j ? cy : cx) + d * 2).reduce((x, y) => ({ x, y })); civ++; }
      if (!free(p.x, p.y)) p = around.map(([dx, dy]) => ({ x: cx + dx, y: cy + dy })).find((q) => free(q.x, q.y)) || { x: cx, y: cy };
      const name = NAMES[Math.floor(rnd() * NAMES.length)];
      npcs.push({ id: `n${town.id}_${i}`, role, name, x: p.x + 0.5, y: p.y + 0.5 });
    });
    return { id: town.id, x: cx, y: cy, r, zone: r + 1, kind: town.type, style: k.style, wall: k.wall, buildings, walls: [...walls], gates, gateCells: [...gateCells], defenses, decor, npcs };
  }
  // Есть ли путь из центра за край застройки (r+1), не проходя сквозь стены
  function reachesOutside(map, walls, cx, cy, r) {
    const W = map.width, seen = new Set([cy * W + cx]), q = [[cx, cy]];
    while (q.length) {
      const [x, y] = q.shift();
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) > r) return true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy, j = Y * W + X;
        if (seen.has(j) || !plain(map, X, Y) || walls.has(j)) continue;
        seen.add(j); q.push([X, Y]);
      }
    }
    return false;
  }
  // Застройка всех поселений карты: map.towns (по id поселения), map.walls — слой стен
  function applyToMap(map) {
    if (!map || !Array.isArray(map.settlements) || !map.settlements.length || map.level) return map;
    map.towns = map.settlements.map((s) => layout(map, s));
    map.openGates = new Set();
    // Каждой новой карте нужен один узнаваемый сюжетный проводник у ближайшего к появлению старосты.
    const hub = map.towns.reduce((best, town) => !best || Math.hypot(town.x - map.spawn.x, town.y - map.spawn.y) < Math.hypot(best.x - map.spawn.x, best.y - map.spawn.y) ? town : best, null);
    const guide = hub && hub.npcs.find((npc) => npc.role === 'quest');
    if (guide) { guide.name = 'Марта Клёпка'; guide.story = 'main-guide'; map.storyHub = { townId: hub.id, npcId: guide.id }; }
    const walls = new Set();
    for (const t of map.towns) for (const j of t.walls) walls.add(j);
    if (walls.size) { if (map.walls) for (const j of walls) map.walls.add(j); else map.walls = walls; } // дома (shared/houses.js) — в том же слое
    return map;
  }
  WorldGen.addPostGen(applyToMap);
  // Поселение, в зоне которого клетка (x, y); null — вне поселений
  function at(map, x, y) {
    for (const t of (map && map.towns) || []) if (Math.max(Math.abs(x - (t.x + 0.5)), Math.abs(y - (t.y + 0.5))) <= t.zone + 0.5) return t;
    return null;
  }
  // Станки мастерских поблизости (общие верстак и кузня)
  function stationsAt(map, x, y, range) {
    const out = [];
    for (const t of (map && map.towns) || []) {
      if (Math.abs(x - t.x) > t.r + range + 2 || Math.abs(y - t.y) > t.r + range + 2) continue;
      for (const b of t.buildings) if (BUILDINGS[b.kind].stations && Math.hypot(b.inner.x + 0.5 - x, b.inner.y + 0.5 - y) <= range + 1.5) out.push(...BUILDINGS[b.kind].stations);
    }
    return out;
  }

  function validate() {
    const errs = [];
    for (const [id, d] of Object.entries(DIALOGUES)) errs.push(...validateDialogue(d, id));
    for (const [id, r] of Object.entries(ROLES)) {
      if (!DIALOGUES[r.dlg]) errs.push(`роль ${id}: нет диалога ${r.dlg}`);
      if (!(r.hp > 0) || !Array.isArray(r.damage) || !(r.speed > 0)) errs.push(`роль ${id}: неверные показатели`);
    }
    for (const [id, k] of Object.entries(KINDS)) {
      for (const s of k.slots) if (!BUILDINGS[s]) errs.push(`род ${id}: неизвестный дом ${s}`);
      for (const r of k.roles) if (!ROLES[r]) errs.push(`род ${id}: неизвестная роль ${r}`);
      if (k.slots.length > SLOTS.length) errs.push(`род ${id}: слишком много домов`);
      if (!WorldGen.SETTLEMENT_TYPES.some((t) => t.key === id)) errs.push(`род ${id}: нет такого типа поселения в генераторе`);
    }
    for (const t of WorldGen.SETTLEMENT_TYPES) if (!KINDS[t.key]) errs.push(`тип поселения ${t.key} без застройки`);
    for (const c of CURRENCY) if (!Items.get(c)) errs.push(`нет предмета-валюты ${c}`);
    return errs;
  }

  // Full server snapshot, also used after reconnect. Only gate cells may bypass walls.
  function syncGates(map, cells) {
    if (!map || !Array.isArray(cells)) return false;
    const allowed = new Set((map.towns || []).flatMap(t => (t.gates || []).flatMap(g => g.cells)));
    const next = new Set(cells.filter(j => allowed.has(j)));
    if (map.openGates && map.openGates.size === next.size && [...next].every(j => map.openGates.has(j))) return false;
    map.openGates = next;
    return true;
  }

  return {
    settings, configure, KINDS, BUILDINGS, ROLES, NAMES, DIALOGUES, ACTIONS, CONDS, TIERS, RARITY_MUL, CURRENCY, NUGGET,
    validateDialogue, optionsFor, fill, clampRep, tierOf, tierBonus, repMul, price, servicePrice, tradable, stockFor,
    layout, applyToMap, at, stationsAt, reachesOutside, validate, syncGates,
  };
});
