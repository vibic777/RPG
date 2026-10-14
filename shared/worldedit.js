// Стройка чит-панели (шаг 21): каталог того, что можно поставить в мир, — общий для сервера и клиента.
// Категории: piece — детали базы (shared/building.js, бесплатно), bld — здания поселений (вид как в поселении, без жителей),
// obj — объекты мира (деревья, скалы, руины, машины, кристаллы, кости…; украшение, не мешают ходьбе), cache — тайник с добычей
// (открыть щелчком рядом — добыча высыпается), node — ресурсная точка (добывается как обычная), enemy / npc / companion / vehicle — существа и техника.
// Объекты (prop) хранятся в состоянии мира: { id, k: 'obj'|'bld'|'cache'|'node', key, x, y, rot, lvl? }; hidden — клетки, где скрыт объект мира.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorldEdit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CATS = {
    piece: 'Детали базы', bld: 'Здания поселений', obj: 'Объекты мира', cache: 'Тайники с добычей', node: 'Ресурсные точки',
    enemy: 'Враги и драконы', npc: 'Жители', companion: 'Спутники', vehicle: 'Техника',
  };
  const PROP_KINDS = ['obj', 'bld', 'cache', 'node'];
  const OBJECTS = {
    tree_pine: 'Сосна', tree_oak: 'Дуб', tree_twisted: 'Кривое дерево', tree_dead: 'Сухое дерево', boulder: 'Валун', peak: 'Скала', mound: 'Холмик',
    ruin_block: 'Руина', rubble: 'Обломки', wall_block: 'Обломок стены', rusted_car: 'Ржавая машина', barrel: 'Бочка', tire: 'Покрышка', crate: 'Ящик',
    cactus: 'Кактус', bones: 'Кости', dune: 'Дюна', stalagmite: 'Сталагмит', mushroom: 'Гриб', cocoon: 'Кокон', kelp: 'Водоросли', shell: 'Ракушка',
    cloud: 'Облако', vent: 'Кристалл-отдушина', portal: 'Портал (вид)', lair: 'Логово (вид)', depot: 'Склад (вид)', settlement: 'Знак поселения',
  };
  const BUILDINGS = { market: 'Рынок', clinic: 'Лечебница', tower: 'Башня мага', workshop: 'Мастерская', barracks: 'Казарма', house: 'Дом' };
  const NODES = { tree: { name: 'Дерево (дрова)', sprite: 'node_tree' }, rock: { name: 'Валун (камень)', sprite: 'node_rock' }, ruin: { name: 'Завал (хлам)', sprite: 'node_ruin' } };
  const CACHES = { cache: 'Тайник', raider_rich: 'Сундук богатого рейдера', depot: 'Склад припасов', robot: 'Обломки робота', alien: 'Капсула пришельцев', dragon: 'Клад дракона', boss_super: 'Сокровища супер-босса' };
  const BLD_SIZE = 4; // здание поселения — 4×4 клетки, дверь с юга
  const settings = { worldEditMaxProps: 2000, worldEditOpenRange: 2 };
  function configure(game) { for (const k of Object.keys(settings)) if (game && Number.isFinite(game[k])) settings[k] = game[k]; }
  // Проверка новой вещи: ошибка (строка) или null
  function validProp(k, key) {
    if (k === 'obj') return OBJECTS[key] ? null : 'Нет такого объекта.';
    if (k === 'bld') return BUILDINGS[key] ? null : 'Нет такого здания.';
    if (k === 'node') return NODES[key] ? null : 'Нет такой ресурсной точки.';
    if (k === 'cache') return CACHES[key] ? null : 'Нет такого тайника.';
    return 'Неизвестная категория.';
  }
  const nameOf = (p) => (p.k === 'obj' ? OBJECTS[p.key] : p.k === 'bld' ? BUILDINGS[p.key] : p.k === 'node' ? NODES[p.key] && NODES[p.key].name : p.k === 'cache' ? CACHES[p.key] : '') || p.key;
  // Спрайт объекта (ключ shared/art.js OBJECT_KEYS)
  const spriteOf = (p) => (p.k === 'obj' ? p.key : p.k === 'node' ? NODES[p.key].sprite : p.k === 'cache' ? 'crate' : 'wall_block');
  // Клетки стен здания (кольцо BLD_SIZE×BLD_SIZE с проёмом-дверью посередине южной стороны, с учётом поворота)
  function bldWalls(x, y, rot = 0) {
    const out = [], n = BLD_SIZE, door = [[1, n - 1], [n - 1, 2], [2, 0], [0, 1]][((rot % 4) + 4) % 4];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if ((i === 0 || j === 0 || i === n - 1 || j === n - 1) && !(i === door[0] && j === door[1])) out.push([x + i, y + j]);
    return out;
  }
  return { CATS, PROP_KINDS, OBJECTS, BUILDINGS, NODES, CACHES, BLD_SIZE, settings, configure, validProp, nameOf, spriteOf, bldWalls };
});
