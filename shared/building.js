// Строительство и добыча — данные и правила, общие для сервера и клиента.
// Сооружения стоят на клетках участка базы (координаты мира). Слои: floor (фундамент), main (стены, мебель), roof (крыша).
// block: 0 — проходимо, 1 — сплошное, 'door' — дверь/ворота (проходят владелец и допущенные; незапертая — все игроки; враги — никогда).
// Ресурсные точки (деревья, валуны, завалы в руинах) — детерминированы по сиду; истощаются и восстанавливаются (состояние — на сервере).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./worldgen'), require('./items'));
  else root.Building = factory(root.WorldGen, root.Items);
})(typeof self !== 'undefined' ? self : this, function (WorldGen, Items) {
  'use strict';

  const settings = {
    baseRadius: 10, baseMinSettlementDist: 20, baseMinSpawnDist: 16, buildRange: 7, buildRefund: 0.5, buildRepairFactor: 0.25,
    buildMaxPerBase: 400, spikeDamage: 8, spikeIntervalSec: 1, pieceHpFactor: 1,
    gatherRange: 1.8, gatherCooldownSec: 0.8, gatherUses: 4, gatherRespawnMin: 15,
    gatherTreeChance: 0.1, gatherRockChance: 0.07, gatherRuinChance: 0.05, gatherToolBonus: 2,
  };
  function configure(game) { for (const k of Object.keys(settings)) if (game && game[k] !== undefined) settings[k] = game[k]; }

  // Сооружения: cost — материалы; learn — нужен чертёж (рецепт build_<...>); station — станок крафта; остальное — свойства
  const P = (id, name, layer, block, hp, cost, extra = {}) => ({ id, name, layer, block, hp, cost, learn: null, color: '#8a6a3a', desc: '', ...extra });
  const PIECES = [
    P('flag', 'Флаг базы', 'main', 0, 800, {}, { fixed: true, color: '#c83a2a', desc: 'Центр участка базы (проходим). Ставится флагом базы; удалить базу может администратор.' }),
    P('foundation', 'Фундамент', 'floor', 0, 600, { stone: 3 }, { color: '#7a746a', desc: 'Каменный пол. Под крышей и лестницей нужен фундамент.' }),
    P('wall_wood', 'Деревянная стена', 'main', 1, 400, { wood: 4 }, { color: '#8a6a3a', desc: 'Стена из брёвен. Враги могут её сломать.' }),
    P('wall_stone', 'Каменная стена', 'main', 1, 1000, { stone: 6 }, { learn: 'build_wall_stone', color: '#8f8a84', desc: 'Прочная каменная стена.' }),
    P('door', 'Дверь', 'main', 'door', 300, { wood: 3, scrap_metal: 1 }, { color: '#6a4a2a', desc: 'Дверь: проходят хозяин и допущенные к базе; щелчок хозяина — запереть / отпереть для всех. Враги не проходят.' }),
    P('window', 'Окно', 'main', 1, 250, { wood: 2, scrap_metal: 1 }, { color: '#6fa8c8', desc: 'Стена с окном. Непроходимо.' }),
    P('roof', 'Крыша', 'roof', 0, 300, { wood: 2 }, { needs: 'foundation', color: '#5a3a2a', desc: 'Крыша над домом. Внутрь заходят через дверь; для обзора используйте режим скрытия препятствий.' }),
    P('stairs', 'Лестница', 'main', 0, 300, { wood: 3 }, { needs: 'foundation', color: '#7a5a3a', desc: 'Лестница к боевому ходу соседней крепостной стены или башни. Щелчок — подняться или спуститься.' }),
    P('fence', 'Забор', 'main', 1, 150, { wood: 2 }, { color: '#9a7a4a', desc: 'Лёгкий забор.' }),
    P('gate', 'Ворота', 'main', 'door', 600, { wood: 4, scrap_metal: 2 }, { learn: 'build_gate', color: '#5a4a3a', desc: 'Крепкие ворота: как дверь, но прочнее.' }),
    P('spikes', 'Колья', 'main', 0, 200, { wood: 3 }, { learn: 'build_spikes', spikes: true, color: '#b8a070', desc: 'Острые колья: ранят врагов, которые на них встают.' }),
    P('barricade', 'Баррикада', 'main', 1, 350, { wood: 3, scrap_metal: 2 }, { color: '#6d7278', desc: 'Завал из досок и железа.' }),
    P('chest', 'Сундук', 'main', 1, 250, { wood: 4 }, { storage: 20, color: '#8a5a2a', desc: 'Общий склад базы: хозяин и допущенные кладут и берут предметы (щелчок рядом).' }),
    P('workbench', 'Верстак', 'main', 1, 300, { wood: 6, scrap_metal: 2 }, { station: 'workbench', color: '#9a7a4a', desc: 'Станок: инструменты, оружие, одежда из шкур.' }),
    P('forge', 'Кузница', 'main', 1, 500, { stone: 8, scrap_metal: 4 }, { station: 'forge', learn: 'build_forge', color: '#5a4a44', desc: 'Станок: металл, клинки, доспехи, патроны.' }),
    P('chemlab', 'Химстол', 'main', 1, 250, { wood: 4, plastic: 3, scrap_metal: 2 }, { station: 'chem', learn: 'build_chemlab', color: '#4a8a6a', desc: 'Станок: порох, лекарства, антирадин.' }),
    P('electronics_bench', 'Стол электроники', 'main', 1, 250, { wood: 4, electronics: 3, scrap_metal: 3 }, { station: 'electronics', learn: 'build_electronics', color: '#2d5a3a', desc: 'Станок: турели, энергоячейки.' }),
    P('bed', 'Кровать', 'main', 0, 200, { wood: 4, cloth: 4 }, { bed: true, color: '#8a4a4a', desc: 'Кровать: после смерти вы возрождаетесь здесь (щелчок — назначить). Спать на ней — как в поселении.' }),
    P('generator', 'Генератор', 'main', 1, 400, { scrap_metal: 8, electronics: 2 }, { learn: 'build_generator', color: '#5a5a3a', desc: 'Заготовка: электричество для станков и света — позже.' }),
    P('lamp', 'Светильник', 'main', 0, 100, { wood: 1, scrap_metal: 1 }, { light: 4, color: '#e8c050', desc: 'Светит вокруг (ночь и освещение — позже).' }),
    P('campfire_pit', 'Очаг', 'main', 0, 300, { stone: 4, wood: 2 }, { station: 'fire', fire: true, color: '#c8603a', desc: 'Постоянный костёр: готовка еды, очистка воды; не гаснет.' }),
  ];
  PIECES.push(
    P('moat', 'Ров с водой', 'floor', 'moat', 800, { stone: 4 }, { color: '#287f9b', desc: 'Водяной ров задерживает наземных врагов. Для прохода постройте мост рядом; герой может переплыть.' }),
    P('bridge', 'Мост', 'floor', 0, 650, { wood: 8, scrap_metal: 2 }, { color: '#a88859', desc: 'Настил через ров: можно заменить клетку рва мостом.' }),
    P('castle_wall', 'Крепостная стена', 'main', 1, 1800, { stone: 10 }, { color: '#a19a89', battlements: true, desc: 'Стена с зубцами и боевым ходом. Подъём по соседней лестнице.' }),
    P('tower', 'Башня', 'main', 1, 2600, { stone: 18, wood: 4 }, { color: '#aaa28c', battlements: true, desc: 'Крепостная башня с боевой площадкой; подъём по лестнице.' }),
    P('magic_table', 'Стол магии', 'main', 1, 400, { wood: 6, stone: 4, gold_nugget: 2 }, { station: 'magic', color: '#7052a5', desc: 'Создание магического оружия и брони разных школ.' }),
    P('technical_table', 'Стол техники', 'main', 1, 450, { wood: 5, scrap_metal: 6, electronics: 3 }, { station: 'technical', color: '#466d79', desc: 'Сборка турелей, беспилотников и ремонтных наборов.' }),
    P('garage', 'Гаражный стенд', 'main', 1, 800, { wood: 8, scrap_metal: 12, electronics: 4 }, { station: 'garage', color: '#627477', desc: 'Сборка машин из запчастей, металла и электроники.' }),
    P('double_bed', 'Двуспальная кровать', 'main', 0, 350, { wood: 8, cloth: 8 }, { bed: true, color: '#985d73', desc: 'Точка возрождения и совместный отдых взрослых супругов через панель семьи F3.' })
  );
  const TEMPLATES = [
    { id: 'cottage', name: 'Деревянный дом', radius: 2, wall: 'wall_wood', roof: true },
    { id: 'stone_house', name: 'Каменный дом', radius: 3, wall: 'wall_stone', roof: true },
    { id: 'workshop', name: 'Дом-мастерская', radius: 3, wall: 'wall_wood', roof: true, workshop: true },
    { id: 'castle', name: 'Замок со рвом', radius: 5, wall: 'castle_wall', castle: true }
  ];
  function templatePieces(id) {
    const t = TEMPLATES.find(x => x.id === id); if (!t) return [];
    const out = [], r = t.radius;
    for (let y=-r;y<=r;y++) for (let x=-r;x<=r;x++) {
      out.push({type:'foundation',x,y});
      if(Math.abs(x)===r||Math.abs(y)===r) out.push({type:x===0&&y===r?(t.castle?'gate':'door'):t.castle&&Math.abs(x)===r&&Math.abs(y)===r?'tower':t.wall,x,y});
      else if(t.roof) out.push({type:'roof',x,y});
    }
    if(t.castle) {
      for(let y=-r-1;y<=r+1;y++)for(let x=-r-1;x<=r+1;x++)if(Math.abs(x)===r+1||Math.abs(y)===r+1)out.push({type:x===0&&y===r+1?'bridge':'moat',x,y});
      out.push({type:'stairs',x:-r+1,y:0},{type:'stairs',x:r-1,y:0});
    } else out.push({type:'double_bed',x:-1,y:-1},{type:'chest',x:1,y:-1},{type:'campfire_pit',x:-1,y:1});
    if(t.workshop)out.push({type:'workbench',x:1,y:1});
    return out;
  }
  const BY_ID = new Map(PIECES.map((p) => [p.id, p]));
  const get = (id) => BY_ID.get(id) || null;
  const maxHp = (p) => Math.round(p.hp * settings.pieceHpFactor);

  // ---------- Проходимость: слой блоков мира (world.blocks: Map индекс клетки → { block, locked, owner, allow }) ----------
  // world.actor — кто сейчас движется (id аккаунта; null — враги). Подключается в WorldGen.isWalkable.
  function canPass(b, actor, world={}) {
    if (b.block === 'moat') return Boolean(world.flyer || world.swimmer && !world.drive);
    if (b.block === 1) return false;
    if (b.block !== 'door') return true;
    if (actor == null) return false;
    return !b.locked || b.owner === actor || (b.allow || []).includes(actor);
  }
  WorldGen.setBlockCheck && WorldGen.setBlockCheck(canPass);

  // Индекс сооружений по клеткам для карты: { floor, main, roof } → Map
  function tileKey(x, y) { return x + ',' + y; }

  // Участок базы: можно ли объявить. others — другие базы мира [{ x, y, r }]
  function canClaim(map, x, y, others = [], r = settings.baseRadius) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < r || ty < r || tx >= map.width - r || ty >= map.height - r) return 'Слишком близко к краю мира.';
    if (!WorldGen.BIOMES[WorldGen.tileAt(map, tx, ty)].walkable) return 'Здесь нельзя поставить флаг.';
    if (WorldGen.tileAt(map, tx, ty) === WorldGen.B.SETTLEMENT) return 'Нельзя строиться в поселении.';
    for (const s of map.settlements || []) if (Math.hypot(s.x - tx, s.y - ty) < settings.baseMinSettlementDist + r) return `Слишком близко к поселению «${s.name}».`;
    if (map.spawn && Math.hypot(map.spawn.x - tx, map.spawn.y - ty) < settings.baseMinSpawnDist + r) return 'Слишком близко к точке появления мира.';
    for (const o of others) if (Math.hypot(o.x - tx, o.y - ty) < r + (o.r || r) + 1) return 'Слишком близко к чужой базе.';
    return null;
  }

  // Можно ли поставить сооружение. base: { x, y, r }, at(x, y, layer) → сооружение или null
  function canPlace(map, base, piece, x, y, at) {
    if (!piece || piece.fixed) return 'Неизвестная постройка.';
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= map.width || y >= map.height) return 'За краем мира.';
    if (!base) return 'Сначала объявите базу: используйте флаг базы.';
    if (Math.hypot(x + 0.5 - (base.x + 0.5), y + 0.5 - (base.y + 0.5)) > base.r) return 'Вне участка базы.';
    if (!WorldGen.BIOMES[WorldGen.tileAt(map, x, y)].walkable) return 'Здесь нельзя строить.';
    if (at(x, y, piece.layer) && !(piece.id === 'bridge' && at(x,y,'floor').type === 'moat')) return 'Клетка уже занята.';
    if(piece.layer==='main' && at(x,y,'floor')?.type==='moat')return 'Сначала постройте мост: сооружения нельзя ставить в воду рва.';
    if (piece.needs && (!at(x, y, 'floor') || at(x, y, 'floor').type !== piece.needs)) return `Нужен фундамент под «${piece.name}».`;
    return null;
  }

  const refund = (piece) => Object.fromEntries(Object.entries(piece.cost).map(([k, n]) => [k, Math.floor(n * settings.buildRefund)]).filter(([, n]) => n > 0));
  const repairCost = (piece, hp, max) => {
    const k = max > 0 ? (max - hp) / max : 0;
    return Object.fromEntries(Object.entries(piece.cost).map(([id, n]) => [id, Math.ceil(n * settings.buildRepairFactor * k)]).filter(([, n]) => n > 0));
  };

  // ---------- Ресурсные точки ----------
  const NODES = {
    tree: { name: 'Дерево', tool: 'axe', hint: 'Дерево: рубите (топором — вдвое больше).', yields: [{ id: 'wood', n: [1, 2], p: 1 }] },
    rock: { name: 'Валун', tool: 'pick', needTool: true, hint: 'Валун: добывается киркой (или кувалдой).', yields: [{ id: 'stone', n: [1, 2], p: 1 }, { id: 'scrap_metal', n: [1, 1], p: 0.3 }] },
    ruin: { name: 'Завал', tool: 'pry', hint: 'Завал в руинах: разбирайте руками (монтировкой — вдвое больше).', yields: [{ id: 'plastic', n: [1, 2], p: 0.6 }, { id: 'cloth', n: [1, 2], p: 0.4 }, { id: 'electronics', n: [1, 1], p: 0.2 }, { id: 'scrap_metal', n: [1, 2], p: 0.4 }] },
  };
  const nodeCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function nodes(map) {
    if (nodeCache && nodeCache.has(map)) return nodeCache.get(map);
    const out = new Map(), W = map.width, seed = (WorldGen.hashString(String(map.seed)) + 901) | 0, B = WorldGen.B;
    for (let y = 1; y < map.height - 1; y++) for (let x = 1; x < W - 1; x++) {
      const t = map.tiles[y * W + x], h = WorldGen.hash2(x, y, seed);
      let k = null;
      if (t === B.FOREST && h < settings.gatherTreeChance) k = 'tree';
      else if ((t === B.HILLS || t === B.WASTE || t === B.DESERT) && h < settings.gatherRockChance * (t === B.HILLS ? 2 : 0.5)) k = 'rock';
      else if (t === B.CITY && h < settings.gatherRuinChance) k = 'ruin';
      if (k) out.set(y * W + x, k);
    }
    if (nodeCache) nodeCache.set(map, out);
    return out;
  }
  const nodeAt = (map, x, y) => nodes(map).get(Math.floor(y) * map.width + Math.floor(x)) || null;

  // Сколько даёт один удар: tool — инструмент в руках ('axe' | 'pick' | 'pry' | null). Возвращает { error } или { items: [{ id, n }] }
  function gatherYield(kind, tool, rnd = Math.random) {
    const n = NODES[kind];
    if (!n) return { error: 'Здесь нечего добывать.' };
    if (n.needTool && tool !== n.tool) return { error: `${n.name}: нужна кирка (или кувалда) в руках.` };
    const mul = tool === n.tool ? settings.gatherToolBonus : 1;
    const items = [];
    for (const y of n.yields) {
      if (rnd() >= y.p) continue;
      const k = (y.n[0] + Math.floor(rnd() * (y.n[1] - y.n[0] + 1))) * mul;
      if (k > 0) items.push({ id: y.id, n: k });
    }
    if (!items.length) items.push({ id: n.yields[0].id, n: mul });
    return { items };
  }

  return { settings, configure, PIECES, TEMPLATES, templatePieces, get, maxHp, canPass, tileKey, canClaim, canPlace, refund, repairCost, NODES, nodes, nodeAt, gatherYield };
});
