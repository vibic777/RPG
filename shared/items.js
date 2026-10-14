// Каталог предметов: оружие, боеприпасы, одежда и броня, рюкзаки, украшения, расходуемое, материалы.
// Это ДАННЫЕ, а не код: новые предметы добавляются строками в таблицы ниже.
// Значения по умолчанию для класса оружия (CLASS_DEFAULTS) дополняются полями конкретного предмета.
// Характеристики оружия (тип урона, урон, скорость, дальность, боеприпасы…) использует бой (shared/combat.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./magic'));
  else root.Items = factory(root.Magic);
})(typeof self !== 'undefined' ? self : this, function (Magic) {
  'use strict';

  const CATEGORIES = {
    weapon: 'Оружие', ammo: 'Боеприпасы', clothing: 'Одежда', armor: 'Броня', backpack: 'Рюкзаки и сумки',
    accessory: 'Украшения', consumable: 'Расходуемое', material: 'Материалы',
  };

  const DAMAGE_TYPES = {
    physical: 'физический', fire: 'огонь', energy: 'энергия', electric: 'электричество', poison: 'яд', magic: 'магия',
  };

  const RARITIES = {
    common: { name: 'обычный', color: '#d8d0c0' },
    uncommon: { name: 'необычный', color: '#6fcf5a' },
    rare: { name: 'редкий', color: '#4fa3ff' },
    epic: { name: 'эпический', color: '#b77bff' },
    legendary: { name: 'легендарный', color: '#ffa53a' },
  };

  // Слоты экипировки (порядок — от тела наружу). fixed — нельзя снять.
  const SLOTS = [
    { id: 'underwear', name: 'Нижнее бельё', hint: 'Базовый слой — всегда надето, снять нельзя', fixed: true },
    { id: 'shirt', name: 'Нательное (верх)', hint: 'Рубаха, майка, термобельё' },
    { id: 'pants', name: 'Штаны', hint: 'Нательный слой: штаны, брюки' },
    { id: 'outer', name: 'Верхняя одежда', hint: 'Куртка, плащ-пыльник, комбинезон' },
    { id: 'armor', name: 'Броня', hint: 'От кожаного доспеха до силовой и кибер-брони' },
    { id: 'head', name: 'Голова', hint: 'Бандана, каска, шлем' },
    { id: 'face', name: 'Лицо и глаза', hint: 'Очки, противогаз, визор' },
    { id: 'hands', name: 'Перчатки', hint: 'Перчатки' },
    { id: 'feet', name: 'Обувь', hint: 'Обмотки, сапоги, ботинки' },
    { id: 'back', name: 'Плащ / спина', hint: 'Плащ, накидка, реактивный ранец или крылья' },
    { id: 'belt', name: 'Пояс', hint: 'Пояс с подсумками добавляет ячейки' },
    { id: 'backpack', name: 'Рюкзак', hint: 'Сумка или рюкзак: больше ячеек и переносимого веса' },
    { id: 'ring1', name: 'Кольцо', hint: 'Кольцо' },
    { id: 'ring2', name: 'Кольцо', hint: 'Второе кольцо' },
    { id: 'amulet', name: 'Амулет', hint: 'Амулет или ожерелье' },
    { id: 'mainHand', name: 'Правая рука', hint: 'Основное оружие; двуручное занимает обе руки' },
    { id: 'offHand', name: 'Левая рука', hint: 'Второе одноручное оружие' },
  ];
  // Тип слота предмета -> слоты персонажа
  const SLOT_TYPES = {
    underwear: ['underwear'], shirt: ['shirt'], pants: ['pants'], outer: ['outer'], armor: ['armor'], head: ['head'],
    face: ['face'], hands: ['hands'], feet: ['feet'], back: ['back'], belt: ['belt'], backpack: ['backpack'],
    ring: ['ring1', 'ring2'], amulet: ['amulet'], hand: ['mainHand', 'offHand'], mainHand: ['mainHand'],
  };

  const WEAPON_GROUPS = {
    firearm: 'Огнестрельное', melee: 'Холодное (древнее)', ranged: 'Луки, арбалеты и метательное',
    energy: 'Лазерное и энергетическое', fantasy: 'Фэнтезийное и магическое', special: 'Особое: огнемёты, мины, ловушки, турели',
  };

  // Классы оружия и значения по умолчанию для предметов класса
  const WEAPON_CLASSES = {
    pistol: { name: 'Пистолеты и револьверы', group: 'firearm', d: { size: 1, durability: 300, icon: { shape: 'pistol', color: '#4a4f55' }, weapon: { damageType: 'physical', range: 12, speed: 2, reload: 1.5 } } },
    smg: { name: 'Пистолеты-пулемёты', group: 'firearm', d: { size: 2, durability: 300, icon: { shape: 'smg', color: '#3d4247' }, weapon: { damageType: 'physical', range: 10, speed: 8, reload: 2, flags: ['automatic'] } } },
    rifle: { name: 'Винтовки и автоматы', group: 'firearm', d: { size: 3, durability: 400, twoHanded: true, icon: { shape: 'rifle', color: '#5a4a38' }, weapon: { damageType: 'physical', range: 20, speed: 4, reload: 2.5 } } },
    sniper: { name: 'Снайперские винтовки', group: 'firearm', d: { size: 3, durability: 350, twoHanded: true, icon: { shape: 'sniper', color: '#3f4a3a' }, weapon: { damageType: 'physical', range: 35, speed: 0.7, reload: 3.5, flags: ['scope'] } } },
    shotgun: { name: 'Дробовики', group: 'firearm', d: { size: 3, durability: 350, twoHanded: true, icon: { shape: 'shotgun', color: '#5c4630' }, weapon: { damageType: 'physical', range: 7, speed: 1.2, reload: 3, ammo: 'ammo_12g', flags: ['spread'] } } },
    machinegun: { name: 'Пулемёты', group: 'firearm', d: { size: 4, durability: 500, twoHanded: true, icon: { shape: 'mg', color: '#353a3f' }, weapon: { damageType: 'physical', range: 22, speed: 10, reload: 5, flags: ['automatic', 'heavy'] } } },
    launcher: { name: 'Гранатомёты и РПГ', group: 'firearm', d: { size: 4, durability: 250, twoHanded: true, icon: { shape: 'launcher', color: '#4f5a3a' }, weapon: { damageType: 'fire', range: 25, speed: 0.4, reload: 4, flags: ['area', 'explosive', 'heavy'] } } },
    knife: { name: 'Ножи и кинжалы', group: 'melee', d: { size: 1, durability: 200, icon: { shape: 'knife', color: '#b8bcc2', color2: '#4a3322' }, weapon: { damageType: 'physical', range: 1.2, speed: 2.5 } } },
    club: { name: 'Дубины, булавы и молоты', group: 'melee', d: { size: 2, durability: 250, icon: { shape: 'club', color: '#6b4a2c' }, weapon: { damageType: 'physical', range: 1.4, speed: 1.2, flags: ['stun'] } } },
    sword: { name: 'Мечи', group: 'melee', d: { size: 2, durability: 300, icon: { shape: 'sword', color: '#c9ced4', color2: '#6b4a2c' }, weapon: { damageType: 'physical', range: 1.6, speed: 1.5 } } },
    axe: { name: 'Топоры и секиры', group: 'melee', d: { size: 2, durability: 280, icon: { shape: 'axe', color: '#9aa0a6', color2: '#6b4a2c' }, weapon: { damageType: 'physical', range: 1.5, speed: 1.1, flags: ['cleave'] } } },
    spear: { name: 'Копья, алебарды и глефы', group: 'melee', d: { size: 3, durability: 260, twoHanded: true, icon: { shape: 'spear', color: '#9aa0a6', color2: '#6b4a2c' }, weapon: { damageType: 'physical', range: 2.5, speed: 1, flags: ['reach'] } } },
    bow: { name: 'Луки и духовые трубки', group: 'ranged', d: { size: 3, durability: 200, twoHanded: true, icon: { shape: 'bow', color: '#7a5230' }, weapon: { damageType: 'physical', range: 18, speed: 1, reload: 0.8, magazine: 1, ammo: 'ammo_arrow', flags: ['silent'] } } },
    crossbow: { name: 'Арбалеты', group: 'ranged', d: { size: 3, durability: 250, twoHanded: true, icon: { shape: 'crossbow', color: '#5a3d24', color2: '#9aa0a6' }, weapon: { damageType: 'physical', range: 20, speed: 0.6, reload: 2, magazine: 1, ammo: 'ammo_bolt', flags: ['silent', 'armorPiercing'] } } },
    disc: { name: 'Метательные диски', group: 'ranged', d: { size: 1, durability: 400, icon: { shape: 'disc', color: '#c9ced4', color2: '#8a2d2d' }, weapon: { damageType: 'physical', range: 10, speed: 1.2, flags: ['thrown', 'returns'] } } },
    laser_gun: { name: 'Лазерные и энергетические стволы', group: 'energy', d: { size: 2, durability: 300, icon: { shape: 'laser_pistol', color: '#d8dde2', color2: '#ff3b3b' }, weapon: { damageType: 'energy', range: 18, speed: 2, reload: 2, ammo: 'ammo_cell' } } },
    laser_sword: { name: 'Лазерные мечи и топоры', group: 'energy', d: { size: 1, durability: 600, icon: { shape: 'lsword', color: '#9aa0a6', color2: '#4ff2ff' }, weapon: { damageType: 'energy', range: 1.6, speed: 2, ammo: 'ammo_cell', magazine: 100, reload: 2.5, flags: ['armorPiercing', 'glow'] } } },
    lasso: { name: 'Лазерные лассо и плети', group: 'energy', d: { size: 1, durability: 400, icon: { shape: 'lasso', color: '#6b4a2c', color2: '#ff5ad7' }, weapon: { damageType: 'energy', range: 5, speed: 0.8, ammo: 'ammo_cell', magazine: 30, reload: 2, flags: ['pull', 'glow'] } } },
    fantasy: { name: 'Фэнтезийное и магическое', group: 'fantasy', d: { size: 2, durability: 500, rarity: 'rare', icon: { shape: 'staff', color: '#6b4a2c', color2: '#ff7a2a' }, weapon: { damageType: 'magic', range: 12, speed: 1, flags: ['magic'] } } },
    flamethrower: { name: 'Огнемёты', group: 'special', d: { size: 3, durability: 300, twoHanded: true, icon: { shape: 'flamer', color: '#8a3b22', color2: '#ffb13b' }, weapon: { damageType: 'fire', range: 5, speed: 10, reload: 4, ammo: 'ammo_fuel', flags: ['burn', 'spray', 'burnsWebs'] } } },
    mine: { name: 'Мины', group: 'special', d: { size: 1, stack: 5, placeable: true, icon: { shape: 'mine', color: '#4f5a3a', color2: '#ff3b3b' }, weapon: { damageType: 'physical', range: 2, speed: 0, flags: ['deployable', 'area', 'trigger'] } } },
    trap: { name: 'Ловушки', group: 'special', d: { size: 1, stack: 5, placeable: true, icon: { shape: 'trap', color: '#6d7278' }, weapon: { damageType: 'physical', range: 1, speed: 0, flags: ['deployable', 'trigger', 'immobilize'] } } },
    turret: { name: 'Разворачиваемые турели', group: 'special', d: { size: 4, placeable: true, durability: 800, icon: { shape: 'turret', color: '#50565c', color2: '#ffd84a' }, weapon: { damageType: 'physical', range: 15, speed: 4, flags: ['deployable', 'automatic', 'turret'] } } },
  };

  // Поля оружия: class, damageType, damage [мин, макс], speed (атак в секунду), range (клетки),
  // ammo (id боеприпаса или null), magazine (0 — без магазина), reload (с), flags
  const WEAPONS = [
    // Пистолеты
    { id: 'pistol_nail', name: 'Гвоздодёр-9', desc: 'Простой надёжный пистолет под 9 мм. Собран в мастерской из запчастей трёх разных моделей.', class: 'pistol', weight: 0.9, value: 120, weapon: { damage: [8, 12], ammo: 'ammo_9mm', magazine: 12 } },
    { id: 'pistol_hornet', name: 'Шершень', desc: 'Компактный пистолет с глушителем. Тихий, но слабый.', class: 'pistol', weight: 0.7, value: 180, rarity: 'uncommon', req: { stealth: 2 }, weapon: { damage: [6, 10], speed: 2.5, ammo: 'ammo_9mm', magazine: 10, flags: ['silent'] } },
    { id: 'revolver_thunder', name: 'Громобой', desc: 'Шестизарядный револьвер крупного калибра. Отдача ломает запястья новичкам.', class: 'pistol', weight: 1.3, value: 260, rarity: 'uncommon', req: { strength: 3 }, weapon: { damage: [14, 22], speed: 1.2, ammo: 'ammo_45', magazine: 6, reload: 2.5 } },
    { id: 'pistol_warden', name: 'Надзиратель', desc: 'Автоматический пистолет стражи старых бункеров: стреляет очередями по три.', class: 'pistol', weight: 1.1, value: 480, rarity: 'rare', level: 5, weapon: { damage: [9, 13], speed: 3, ammo: 'ammo_9mm', magazine: 18, flags: ['burst'] } },
    // Пистолеты-пулемёты
    { id: 'smg_cricket', name: 'Сверчок', desc: 'Пистолет-пулемёт из штампованной жести. Стрекочет, как сверчок.', class: 'smg', weight: 2.4, value: 300, weapon: { damage: [5, 8], ammo: 'ammo_9mm', magazine: 30 } },
    { id: 'smg_reaper', name: 'Жнец', desc: 'Скорострельный пистолет-пулемёт с увеличенным магазином.', class: 'smg', weight: 2.8, value: 620, rarity: 'rare', level: 6, weapon: { damage: [6, 9], speed: 11, ammo: 'ammo_9mm', magazine: 50 } },
    // Винтовки
    { id: 'rifle_nomad', name: 'Кочевник', desc: 'Автомат пустынных караванщиков под 5,56 мм. Прощает песок и небрежность.', class: 'rifle', weight: 3.4, value: 520, req: { strength: 2 }, weapon: { damage: [10, 15], speed: 6, ammo: 'ammo_556', magazine: 30, flags: ['automatic'] } },
    { id: 'rifle_condor', name: 'Кондор', desc: 'Самозарядная винтовка под 7,62 мм. Точная и мощная.', class: 'rifle', weight: 4, value: 640, rarity: 'uncommon', req: { strength: 3 }, weapon: { damage: [16, 24], speed: 2, ammo: 'ammo_762', magazine: 10 } },
    { id: 'rifle_sentinel', name: 'Часовой-М', desc: 'Штурмовая винтовка с режимом очередей. Состоит на вооружении ополчения поселений.', class: 'rifle', weight: 3.6, value: 900, rarity: 'rare', level: 8, req: { strength: 3 }, weapon: { damage: [12, 17], speed: 7, ammo: 'ammo_556', magazine: 30, flags: ['burst'] } },
    // Снайперские
    { id: 'sniper_farsight', name: 'Дальнозор', desc: 'Снайперская винтовка с оптикой. Один выстрел — одна проблема.', class: 'sniper', weight: 6.5, value: 1100, rarity: 'uncommon', level: 4, req: { strength: 3, stealth: 2 }, weapon: { damage: [40, 60], ammo: 'ammo_762', magazine: 5 } },
    { id: 'sniper_whisper', name: 'Шёпот', desc: 'Бесшумная снайперская винтовка с интегрированным глушителем.', class: 'sniper', weight: 5.8, value: 2600, rarity: 'epic', level: 12, req: { stealth: 5 }, weapon: { damage: [45, 70], ammo: 'ammo_762', magazine: 5, flags: ['scope', 'silent'] } },
    // Дробовики
    { id: 'shotgun_thresher', name: 'Молотилка', desc: 'Помповый дробовик. На близкой дистанции спорить с ним бесполезно.', class: 'shotgun', weight: 3.5, value: 420, req: { strength: 2 }, weapon: { damage: [24, 40], magazine: 6 } },
    { id: 'shotgun_kum', name: 'Кум', desc: 'Двуствольное ружьё, передаётся по наследству. Два выстрела — и перезарядка.', class: 'shotgun', weight: 3.2, value: 300, weapon: { damage: [28, 44], speed: 2, magazine: 2, reload: 2.5 } },
    { id: 'shotgun_squall', name: 'Шквал', desc: 'Автоматический дробовик с барабанным магазином.', class: 'shotgun', weight: 4.8, value: 1500, rarity: 'rare', level: 9, req: { strength: 4 }, weapon: { damage: [20, 34], speed: 3, magazine: 12, reload: 4, flags: ['spread', 'automatic'] } },
    // Пулемёты
    { id: 'mg_mower', name: 'Косилка', desc: 'Ручной пулемёт под 5,56 мм с лентой на сто патронов.', class: 'machinegun', weight: 9, value: 1400, rarity: 'uncommon', level: 6, req: { strength: 5 }, weapon: { damage: [10, 15], ammo: 'ammo_556', magazine: 100 } },
    { id: 'mg_hail', name: 'Град', desc: 'Станковый пулемёт, который носят только очень сильные люди.', class: 'machinegun', weight: 14, value: 2400, rarity: 'rare', level: 10, req: { strength: 7 }, weapon: { damage: [15, 22], speed: 9, ammo: 'ammo_762', magazine: 150, reload: 6 } },
    // Гранатомёты
    { id: 'launcher_boom', name: 'Гулкий', desc: 'Однозарядный гранатомёт. Звук выстрела слышно за три квартала.', class: 'launcher', weight: 5, value: 1300, rarity: 'uncommon', level: 7, req: { strength: 3 }, weapon: { damage: [50, 80], ammo: 'ammo_grenade', magazine: 1 } },
    { id: 'launcher_windfall', name: 'Бурелом', desc: 'Ручной противотанковый гранатомёт. Сносит стены и робо-стражей.', class: 'launcher', weight: 7.5, value: 2800, rarity: 'rare', level: 12, req: { strength: 5 }, weapon: { damage: [90, 140], range: 30, ammo: 'ammo_rocket', magazine: 1, reload: 5 } },
    // Ножи
    { id: 'knife_rusty', name: 'Ржавый нож', desc: 'Старый кухонный нож. Лучше, чем ничего.', class: 'knife', weight: 0.3, value: 5, durability: 80, weapon: { damage: [3, 6] } },
    { id: 'knife_fang', name: 'Клык', desc: 'Боевой нож с воронёным клинком и упором для пальца.', class: 'knife', weight: 0.4, value: 60, weapon: { damage: [6, 10], speed: 2.8 } },
    { id: 'knife_claw', name: 'Коготь', desc: 'Изогнутый нож-керамбит. Оставляет глубокие кровоточащие раны.', class: 'knife', weight: 0.3, value: 150, rarity: 'uncommon', req: { stealth: 3 }, weapon: { damage: [7, 11], speed: 3, flags: ['bleed'] } },
    { id: 'knife_serpent', name: 'Змеиный зуб', desc: 'Кинжал с желобками, смазанными ядом пустынной гадюки.', class: 'knife', weight: 0.3, value: 380, rarity: 'rare', level: 4, req: { stealth: 3 }, weapon: { damageType: 'poison', damage: [6, 9], flags: ['poison'] }, icon: { color2: '#3f8a2d' } },
    // Дубины
    // инструменты добычи (шаг 10): tool — axe (деревья), pick (камни), pry (руины)
    { id: 'pickaxe', name: 'Кирка', desc: 'Кирка шахтёра. Добывает камень и металлолом из валунов; в драке тяжеловата.', class: 'club', weight: 3, value: 40, durability: 200, tool: 'pick', weapon: { damage: [5, 10], speed: 1 } },
    { id: 'crowbar', name: 'Монтировка', desc: 'Стальной ломик. Вскрывает завалы в руинах — больше добычи; неплохое оружие.', class: 'club', weight: 1.4, value: 30, durability: 250, tool: 'pry', weapon: { damage: [5, 9] } },
    { id: 'club_plain', name: 'Дубина', desc: 'Тяжёлая суковатая палка. Оружие первого дня после конца света.', class: 'club', weight: 1.5, value: 3, durability: 120, weapon: { damage: [4, 8] } },
    { id: 'bat_nails', name: 'Бита с гвоздями', desc: 'Бейсбольная бита, щедро утыканная гвоздями.', class: 'club', weight: 1.2, value: 40, weapon: { damage: [7, 12], flags: ['bleed'] } },
    { id: 'mace_bell', name: 'Булава «Колокол»', desc: 'Булава с навершием из церковного колокола. Гудит при каждом ударе.', class: 'club', weight: 3, value: 260, rarity: 'uncommon', req: { strength: 4 }, weapon: { damage: [14, 20], speed: 0.9, flags: ['stun'] }, icon: { shape: 'mace', color: '#8a6d3b' } },
    { id: 'hammer_sledge', tool: 'pick', name: 'Кувалда', desc: 'Строительная кувалда. Двумя руками — и с размаху.', class: 'club', weight: 6, value: 90, twoHanded: true, req: { strength: 5 }, weapon: { damage: [20, 32], speed: 0.6, flags: ['stun', 'heavy'] }, icon: { shape: 'hammer', color: '#5a5f65' } },
    { id: 'baton_shock', name: 'Шокер «Разряд»', desc: 'Дубинка-электрошокер. Не убивает, а обездвиживает.', class: 'club', weight: 0.8, value: 350, rarity: 'uncommon', req: { engineering: 2 }, weapon: { damageType: 'electric', damage: [5, 9], speed: 1.6, ammo: 'ammo_cell', magazine: 20, reload: 2, flags: ['stun'] }, icon: { shape: 'baton', color: '#2d3136', color2: '#6fc8ff' } },
    // Мечи
    { id: 'sword_short', name: 'Короткий меч', desc: 'Клинок из рессоры грузовика. Грубый, но острый.', class: 'sword', weight: 1.4, value: 110, weapon: { damage: [8, 13] } },
    { id: 'sword_widow', name: 'Палаш «Вдова»', desc: 'Прямой палаш с корзинчатой гардой. Названа по числу вдов, которых оставил прежний владелец.', class: 'sword', weight: 1.8, value: 420, rarity: 'uncommon', level: 3, req: { strength: 3 }, weapon: { damage: [12, 18], speed: 1.4 } },
    { id: 'sword_mountain', name: 'Двуручник «Гора»', desc: 'Огромный двуручный меч. Требует силы и пространства для замаха.', class: 'sword', weight: 5, value: 700, rarity: 'uncommon', level: 5, twoHanded: true, req: { strength: 6 }, weapon: { damage: [24, 36], speed: 0.8, range: 2, flags: ['cleave', 'heavy'] }, icon: { shape: 'greatsword' } },
    { id: 'sword_adamant', name: 'Адамантиевый клинок', desc: 'Меч из почти неразрушимого сплава. Режет броню как бумагу.', class: 'sword', weight: 1.6, value: 6000, rarity: 'legendary', level: 15, req: { strength: 5 }, durability: 5000, weapon: { damage: [30, 42], speed: 1.8, flags: ['armorPiercing'] }, icon: { color: '#e6f0ff' } },
    // Топоры
    { id: 'axe_wood', name: 'Топор лесоруба', desc: 'Обычный топор. Рубит дрова и не только.', class: 'axe', weight: 1.8, value: 45, weapon: { damage: [8, 14] } },
    { id: 'axe_roar', name: 'Секира «Рёв»', desc: 'Двуручная секира с широким полулунным лезвием.', class: 'axe', weight: 4.5, value: 520, rarity: 'uncommon', level: 4, twoHanded: true, req: { strength: 5 }, weapon: { damage: [22, 34], speed: 0.7, flags: ['cleave', 'heavy'] }, icon: { shape: 'greataxe' } },
    { id: 'axe_throwing', name: 'Метательный топорик', desc: 'Лёгкий топорик с балансировкой для броска.', class: 'axe', weight: 0.7, value: 30, stack: 5, durability: null, weapon: { damage: [7, 11], range: 8, speed: 1, flags: ['thrown'] } },
    // Копья
    { id: 'spear_rebar', name: 'Копьё из арматуры', desc: 'Заострённый прут арматуры с обмоткой. Держит зверя на расстоянии.', class: 'spear', weight: 2.2, value: 20, weapon: { damage: [8, 13] } },
    { id: 'halberd_gate', name: 'Алебарда «Страж ворот»', desc: 'Алебарда городской стражи: топор, крюк и пика в одном.', class: 'spear', weight: 4, value: 480, rarity: 'uncommon', level: 4, req: { strength: 4 }, weapon: { damage: [18, 28], speed: 0.8, flags: ['reach', 'cleave'] }, icon: { shape: 'halberd' } },
    { id: 'glaive_moon', name: 'Глефа «Луна»', desc: 'Длинное древко с изогнутым лезвием, похожим на месяц.', class: 'spear', weight: 3.4, value: 900, rarity: 'rare', level: 8, req: { strength: 4, stealth: 2 }, weapon: { damage: [20, 30], speed: 1.1 }, icon: { shape: 'halberd', color: '#d8dde2' } },
    // Луки и духовые трубки
    { id: 'bow_crude', name: 'Самодельный лук', desc: 'Лук из ветки и шнура от жалюзи.', class: 'bow', weight: 0.9, value: 25, weapon: { damage: [5, 9] } },
    { id: 'bow_falcon', name: 'Составной лук «Сокол»', desc: 'Лук из дерева, рога и сухожилий. Бьёт далеко и точно.', class: 'bow', weight: 1.1, value: 400, rarity: 'uncommon', level: 3, req: { strength: 3 }, weapon: { damage: [11, 17], range: 24 } },
    { id: 'blowgun_sting', name: 'Духовая трубка «Жало»', desc: 'Трубка для отравленных дротиков. Совершенно бесшумна.', class: 'bow', weight: 0.4, value: 200, twoHanded: false, req: { stealth: 3 }, weapon: { damageType: 'poison', damage: [3, 5], range: 10, ammo: 'ammo_dart', flags: ['silent', 'poison'] }, icon: { shape: 'blowgun', color: '#8a6d3b' } },
    // Арбалеты
    { id: 'crossbow_harpy', name: 'Арбалет «Гарпия»', desc: 'Арбалет с ножным стременем. Болт пробивает лёгкую броню.', class: 'crossbow', weight: 3, value: 450, req: { strength: 2 }, weapon: { damage: [16, 24] } },
    { id: 'crossbow_bumblebee', name: 'Многозарядный арбалет «Шмель»', desc: 'Арбалет с коробчатым магазином на десять болтов.', class: 'crossbow', weight: 3.5, value: 1100, rarity: 'rare', level: 7, req: { engineering: 3 }, weapon: { damage: [12, 18], speed: 1.8, magazine: 10, reload: 3 } },
    // Диски
    { id: 'disc_crescent', name: 'Боевой диск «Полумесяц»', desc: 'Метательный диск с зазубренной кромкой. Возвращается в руку.', class: 'disc', weight: 0.8, value: 500, rarity: 'uncommon', level: 3, req: { strength: 2, stealth: 2 }, weapon: { damage: [12, 18] } },
    { id: 'disc_harvest', name: 'Диск-жнец «Жатва»', desc: 'Раскладной диск с выдвижными лезвиями. Оставляет кровоточащие раны и возвращается хозяину.', class: 'disc', weight: 1, value: 1800, rarity: 'epic', level: 10, req: { stealth: 4 }, weapon: { damage: [20, 30], range: 14, flags: ['thrown', 'returns', 'bleed'] } },
    { id: 'star_steel', name: 'Метательные звёздочки', desc: 'Стальные сюрикены: вылетают и вновь появляются в руках, не расходуются.', class: 'disc', weight: 0.05, value: 4, stack: 50, durability: null, weapon: { damage: [3, 5], speed: 3, range: 8, flags: ['thrown'] }, icon: { shape: 'star' } },
    // Лазерное и энергетическое
    { id: 'laser_sparker', name: 'Искровик', desc: 'Лазерный пистолет. Луч прожигает ткань и лёгкую броню.', class: 'laser_gun', weight: 1, value: 800, rarity: 'uncommon', level: 4, req: { intellect: 2 }, weapon: { damage: [10, 14], magazine: 20 } },
    { id: 'laser_searchlight', name: 'Прожектор', desc: 'Лазерная винтовка с непрерывным лучом.', class: 'laser_gun', weight: 3.8, value: 1900, rarity: 'rare', level: 9, twoHanded: true, req: { intellect: 3, engineering: 2 }, weapon: { damage: [16, 22], speed: 5, range: 26, magazine: 40, flags: ['beam'] }, icon: { shape: 'laser_rifle' } },
    { id: 'pulse_blaster', name: 'Импульсник', desc: 'Энергетический пистолет-пулемёт, стреляющий плазменными сгустками.', class: 'laser_gun', weight: 2.2, value: 1500, rarity: 'rare', level: 7, req: { intellect: 2 }, weapon: { damage: [7, 10], speed: 8, magazine: 45, flags: ['automatic'] }, icon: { color2: '#6fc8ff' } },
    { id: 'arc_rifle', name: 'Молния-7', desc: 'Дуговая винтовка: разряд перескакивает между соседними целями.', class: 'laser_gun', weight: 4.2, value: 2400, rarity: 'epic', level: 11, twoHanded: true, req: { intellect: 4, engineering: 3 }, weapon: { damageType: 'electric', damage: [18, 26], speed: 1.5, magazine: 15, flags: ['chain', 'stun'] }, icon: { shape: 'laser_rifle', color2: '#6fc8ff' } },
    { id: 'lsword_dawn', name: 'Световой клинок «Рассвет»', desc: 'Рукоять, из которой выдвигается клинок из плотного света.', class: 'laser_sword', weight: 1, value: 3200, rarity: 'epic', level: 10, req: { intellect: 3, strength: 3 }, weapon: { damage: [22, 30] } },
    { id: 'lsword_eclipse', name: 'Двойной световой клинок «Затмение»', desc: 'Посох с клинками света с обеих сторон. Требует мастерства.', class: 'laser_sword', weight: 1.6, value: 5200, rarity: 'legendary', level: 14, twoHanded: true, req: { intellect: 4, strength: 4, stealth: 3 }, weapon: { damage: [26, 36], speed: 2.4, flags: ['armorPiercing', 'glow', 'cleave'] }, icon: { shape: 'dlsword', color2: '#ff3b3b' } },
    { id: 'laser_axe_spark', name: 'Лазерный топор «Искра»', desc: 'Топор с раскалённой до бела энергетической кромкой.', class: 'laser_sword', weight: 2, value: 2600, rarity: 'rare', level: 9, req: { strength: 4 }, weapon: { damage: [24, 32], speed: 1.2, flags: ['cleave', 'burn', 'glow'] }, icon: { shape: 'laser_axe', color2: '#ffb13b' } },
    { id: 'laser_bow_ray', name: 'Лазерный лук «Луч»', desc: 'Лук, стреляющий стрелами из света вместо обычных.', class: 'bow', weight: 1.4, value: 2200, rarity: 'epic', level: 9, req: { intellect: 3, strength: 2 }, weapon: { damageType: 'energy', damage: [16, 24], range: 26, ammo: 'ammo_cell', magazine: 12, reload: 2, flags: ['silent', 'glow'] }, icon: { color: '#d8dde2', color2: '#4ff2ff' } },
    { id: 'lasso_arkan', name: 'Лазерное лассо «Аркан»', desc: 'Энергетическая петля: притягивает цель к владельцу и ненадолго связывает.', class: 'lasso', weight: 0.9, value: 1700, rarity: 'rare', level: 6, req: { strength: 3, taming: 2 }, weapon: { damage: [6, 10] } },
    { id: 'whip_energy', name: 'Энергохлыст', desc: 'Хлыст из гибкого светового шнура. Жалит и оглушает.', class: 'lasso', weight: 0.7, value: 1200, rarity: 'uncommon', level: 5, weapon: { damageType: 'electric', damage: [8, 12], speed: 1.4, range: 3.5, flags: ['stun', 'glow'] }, icon: { color2: '#6fc8ff' } },
    // Фэнтезийное
    { id: 'staff_flame', name: 'Посох пламени', desc: 'Посох с тлеющим углём в навершии. Мечет огненные шары.', class: 'fantasy', weight: 2, value: 1600, level: 5, twoHanded: true, req: { magic: 4 }, weapon: { damageType: 'fire', damage: [14, 22], flags: ['magic', 'burn'] } },
    { id: 'staff_winds', name: 'Посох ветров', desc: 'Лёгкий посох, вокруг которого всегда шелестит воздух. Сбивает врагов с ног.', class: 'fantasy', weight: 1.6, value: 1500, level: 5, twoHanded: true, req: { magic: 4 }, weapon: { damage: [10, 16], range: 10, flags: ['magic', 'knockback'] }, icon: { color2: '#bfe8ff' } },
    { id: 'blade_ash', name: 'Клинок Пепла', desc: 'Меч, выкованный в пламени дракона. Лезвие всегда горячее.', class: 'fantasy', weight: 1.8, value: 3500, rarity: 'epic', level: 10, req: { strength: 3, magic: 3 }, weapon: { damageType: 'fire', damage: [20, 28], range: 1.6, speed: 1.5, flags: ['magic', 'burn'] }, icon: { shape: 'sword', color: '#3a2a22', color2: '#ff7a2a' } },
    { id: 'rod_venom', name: 'Жезл яда', desc: 'Костяной жезл, из которого сочится зелёный туман.', class: 'fantasy', weight: 0.8, value: 1400, level: 6, req: { magic: 3, intellect: 2 }, weapon: { damageType: 'poison', damage: [8, 12], speed: 1.2, flags: ['magic', 'poison', 'area'] }, icon: { shape: 'wand', color: '#d8d0b0', color2: '#5aff5a' } },
    { id: 'hammer_storm', name: 'Молот бури', desc: 'Боевой молот, призывающий молнии. Двумя руками — если хватит сил.', class: 'fantasy', weight: 5, value: 4800, rarity: 'legendary', level: 13, twoHanded: true, req: { strength: 5, magic: 4 }, weapon: { damageType: 'electric', damage: [30, 44], range: 1.6, speed: 0.8, flags: ['magic', 'stun', 'chain'] }, icon: { shape: 'hammer', color: '#6d7278', color2: '#6fc8ff' } },
    // Огнемёты
    { id: 'flamer_torch', name: 'Огнемёт «Горелка»', desc: 'Самодельный огнемёт из газового баллона. Выжигает паутину и гнёзда.', class: 'flamethrower', weight: 6, value: 700, rarity: 'uncommon', req: { engineering: 2 }, weapon: { damage: [6, 9], magazine: 50 } },
    { id: 'flamer_dragon', name: 'Тяжёлый огнемёт «Дракон»', desc: 'Армейский огнемёт с ранцевым баком. Струя на семь клеток.', class: 'flamethrower', weight: 11, value: 2100, rarity: 'rare', level: 8, req: { strength: 5, engineering: 3 }, weapon: { damage: [10, 14], range: 7, magazine: 120, flags: ['burn', 'spray', 'burnsWebs', 'heavy'] } },
    // Мины
    { id: 'mine_clapper', name: 'Мина «Хлопушка»', desc: 'Противопехотная мина нажимного действия.', class: 'mine', weight: 1, value: 80, req: { engineering: 1 }, weapon: { damage: [40, 60] } },
    { id: 'mine_emp', name: 'ЭМИ-мина', desc: 'Выводит из строя роботов и киборгов в радиусе взрыва.', class: 'mine', weight: 1.2, value: 300, rarity: 'uncommon', req: { engineering: 3 }, weapon: { damageType: 'electric', damage: [30, 50], range: 3, flags: ['deployable', 'area', 'trigger', 'emp'] }, icon: { color2: '#6fc8ff' } },
    { id: 'mine_fire', name: 'Мина «Зажигалка»', desc: 'Разбрызгивает горящую смесь при срабатывании.', class: 'mine', weight: 1.1, value: 180, req: { engineering: 2 }, weapon: { damageType: 'fire', damage: [25, 40], flags: ['deployable', 'area', 'trigger', 'burn'] }, icon: { color2: '#ffb13b' } },
    // Ловушки
    { id: 'trap_bear', name: 'Капкан', desc: 'Стальной капкан на крупного зверя. Держит мёртвой хваткой.', class: 'trap', weight: 2.5, value: 60, weapon: { damage: [15, 25] } },
    { id: 'trap_net', name: 'Сеть-ловушка', desc: 'Сеть с грузилами: обездвиживает, но не ранит. Удобна для приручения.', class: 'trap', weight: 1.5, value: 90, req: { taming: 1 }, weapon: { damage: [0, 0], flags: ['deployable', 'trigger', 'immobilize', 'nonLethal'] }, icon: { shape: 'net', color: '#a89468' } },
    { id: 'trap_tripwire', name: 'Растяжка', desc: 'Проволока и граната. Классика жанра.', class: 'trap', weight: 0.8, value: 120, req: { engineering: 2 }, weapon: { damage: [30, 45], range: 2, flags: ['deployable', 'trigger', 'area', 'explosive'] }, icon: { shape: 'tripwire', color: '#4f5a3a' } },
    // Турели
    { id: 'turret_watchman', name: 'Турель «Сторож»', desc: 'Пулемётная турель на треноге. Сама выбирает цели. Устанавливается на землю.', class: 'turret', weight: 18, value: 2000, rarity: 'uncommon', level: 5, req: { builder: 3, engineering: 2 }, weapon: { damage: [8, 12], ammo: 'ammo_556', magazine: 200 } },
    { id: 'turret_eye', name: 'Лазерная турель «Око»', desc: 'Энергетическая турель с датчиком движения.', class: 'turret', weight: 15, value: 3600, rarity: 'rare', level: 9, req: { builder: 4, engineering: 4 }, weapon: { damageType: 'energy', damage: [12, 18], range: 18, ammo: 'ammo_cell', magazine: 100 }, icon: { color2: '#ff3b3b' } },
    { id: 'turret_brazier', name: 'Огнемётная турель «Жаровня»', desc: 'Турель, заливающая подходы огнём. Против орд зомби — лучшее средство.', class: 'turret', weight: 20, value: 3000, rarity: 'rare', level: 8, req: { builder: 4, engineering: 3 }, weapon: { damageType: 'fire', damage: [10, 14], range: 6, speed: 8, ammo: 'ammo_fuel', magazine: 150, flags: ['deployable', 'automatic', 'turret', 'burn', 'spray'] }, icon: { color2: '#ffb13b' } },
  ];

  const AMMO = [
    { id: 'ammo_9mm', name: 'Патроны 9 мм', desc: 'Пистолетные патроны. Подходят к пистолетам и пистолетам-пулемётам.', weight: 0.01, value: 1, stack: 200, icon: { shape: 'bullet', color: '#c9a54a' } },
    { id: 'ammo_45', name: 'Патроны .45', desc: 'Крупнокалиберные пистолетные патроны для револьверов.', weight: 0.015, value: 2, stack: 100, icon: { shape: 'bullet', color: '#b88a3a' } },
    { id: 'ammo_556', name: 'Патроны 5,56 мм', desc: 'Промежуточный винтовочный патрон для автоматов, пулемётов и турелей.', weight: 0.012, value: 2, stack: 200, icon: { shape: 'bullet', color: '#d8b85a' } },
    { id: 'ammo_762', name: 'Патроны 7,62 мм', desc: 'Мощный винтовочный патрон.', weight: 0.02, value: 3, stack: 100, icon: { shape: 'bullet', color: '#a8883a' } },
    { id: 'ammo_12g', name: 'Дробь 12 калибра', desc: 'Патроны для дробовиков.', weight: 0.04, value: 3, stack: 50, icon: { shape: 'shell', color: '#b83a2a' } },
    { id: 'ammo_grenade', name: 'Граната 40 мм', desc: 'Выстрел для гранатомёта.', weight: 0.3, value: 40, stack: 10, icon: { shape: 'grenade', color: '#4f5a3a' } },
    { id: 'ammo_rocket', name: 'Реактивная граната', desc: 'Выстрел для ручного противотанкового гранатомёта; заряжается и в ракетные блоки техники (неуправляемые ракеты).', weight: 2, value: 150, stack: 4, rarity: 'uncommon', icon: { shape: 'rocket', color: '#4f5a3a', color2: '#b83a2a' } },
    // бортовое оружие техники (shared/vehicles.js ARMS): боеприпасы берутся из сумки водителя или стрелка
    { id: 'ammo_30mm', name: 'Снаряды 30 мм', desc: 'Выстрелы для автоматических пушек техники (БТР, БМП, вертолёт, самолёт, подлодка).', weight: 0.4, value: 12, stack: 100, icon: { shape: 'shell', color: '#b0903a' } },
    { id: 'ammo_tank_shell', name: 'Танковый снаряд 125 мм', desc: 'Осколочно-фугасный снаряд для танковых пушек.', weight: 6, value: 120, stack: 5, rarity: 'uncommon', icon: { shape: 'shell', color: '#6f6a3a', color2: '#c8b25a' } },
    { id: 'ammo_missile', name: 'Управляемая ракета', desc: 'Ракета с головкой наведения: доворачивает к выбранной цели. Пускается с пилонов, направляющих и из шахт подлодки — даже из-под воды.', weight: 8, value: 400, stack: 2, rarity: 'rare', icon: { shape: 'rocket', color: '#dfe2da', color2: '#c23b2e' } },
    { id: 'ammo_torpedo', name: 'Торпеда', desc: 'Идёт только по воде и взрывается у цели или о берег. Пускается из торпедных аппаратов лодок, подлодок и с подвески авиации.', weight: 20, value: 500, stack: 1, rarity: 'rare', icon: { shape: 'rocket', color: '#2f3d45', color2: '#9ab4c0' } },
    { id: 'ammo_bomb', name: 'Авиабомба', desc: 'Сбрасывается с самолёта в полёте и падает в точку прицела.', weight: 15, value: 300, stack: 2, rarity: 'uncommon', icon: { shape: 'grenade', color: '#3e4636' } },
    { id: 'ammo_arrow', recoverable: true, name: 'Стрелы', desc: 'Стрелы с металлическими наконечниками. Часть можно подобрать после выстрела.', weight: 0.03, value: 1, stack: 100, icon: { shape: 'arrow', color: '#7a5230' } },
    { id: 'ammo_bolt', recoverable: true, name: 'Арбалетные болты', desc: 'Короткие тяжёлые болты для арбалетов.', weight: 0.05, value: 2, stack: 50, icon: { shape: 'arrow', color: '#5a3d24', color2: '#9aa0a6' } },
    { id: 'ammo_dart', name: 'Отравленные дротики', desc: 'Дротики для духовой трубки, смоченные ядом.', weight: 0.01, value: 3, stack: 50, icon: { shape: 'arrow', color: '#8a6d3b', color2: '#3f8a2d' } },
    { id: 'ammo_cell', name: 'Энергоячейка', desc: 'Универсальная батарея для лазерного и энергетического оружия. Одна ячейка — 20 зарядов.', rounds: 20, weight: 0.2, value: 25, stack: 20, rarity: 'uncommon', icon: { shape: 'cell', color: '#3d4247', color2: '#4ff2ff' } },
    // топливо техники (шаг 14): единица топлива = один заряд (как патроны и ячейки)
    { id: 'fuel_gas', name: 'Канистра бензина', desc: 'Бензин для мотоциклов, легковушек и лодок. Одна канистра — 20 единиц топлива.', rounds: 20, weight: 4, value: 40, stack: 5, icon: { shape: 'fuel', color: '#c83a2a' } },
    { id: 'fuel_diesel', name: 'Бочонок солярки', desc: 'Дизельное топливо для пикапов, БТР и танков. Один бочонок — 30 единиц.', rounds: 30, weight: 6, value: 50, stack: 4, icon: { shape: 'fuel', color: '#4a4a3a' } },
    { id: 'fuel_avia', name: 'Авиатопливо', desc: 'Очищенный керосин для вертолётов и самолётов. Одна канистра — 25 единиц.', rounds: 25, weight: 4, value: 90, stack: 5, rarity: 'uncommon', icon: { shape: 'fuel', color: '#3a8ac8' } },
    { id: 'ammo_fuel', name: 'Баллон с горючим', desc: 'Смесь для огнемётов и огнемётных турелей. Одного баллона хватает на 25 выстрелов струёй.', rounds: 25, weight: 1.5, value: 30, stack: 5, icon: { shape: 'fuel', color: '#b83a2a' } },
  ];

  // Одежда и броня: armor — { defense, resist: { тип урона: доля 0..1 } }
  const WEARABLES = [
    { id: 'underwear_base', name: 'Нижнее бельё', desc: 'Базовый слой. Всегда надето, снять или выбросить нельзя. Цвет выбирается при создании героя.', category: 'clothing', slot: 'underwear', weight: 0, value: 0, fixed: true, icon: { shape: 'underwear', color: '#2a2a2a' } },
    { id: 'shirt_canvas', name: 'Холщовая рубаха', desc: 'Простая рубаха из мешковины.', category: 'clothing', slot: 'shirt', weight: 0.4, value: 5, durability: 60, armor: { defense: 1 }, icon: { shape: 'shirt', color: '#a8946a' } },
    { id: 'shirt_thermal', name: 'Термобельё', desc: 'Облегающее бельё, сохраняющее тепло. Немного защищает от огня.', category: 'clothing', slot: 'shirt', weight: 0.3, value: 60, durability: 80, armor: { defense: 1, resist: { fire: 0.05 } }, icon: { shape: 'shirt', color: '#7a3a3a' } },
    { id: 'shirt_mesh', name: 'Сетчатая майка', desc: 'Майка из кольчужной сетки. Спасает от порезов.', category: 'clothing', slot: 'shirt', weight: 1.2, value: 140, rarity: 'uncommon', durability: 150, armor: { defense: 3 }, icon: { shape: 'shirt', color: '#8d949c' } },
    { id: 'pants_burlap', name: 'Штаны из мешковины', desc: 'Колючие, но свои.', category: 'clothing', slot: 'pants', weight: 0.6, value: 5, durability: 60, armor: { defense: 1 }, icon: { shape: 'pants', color: '#8a7a55' } },
    { id: 'pants_work', name: 'Рабочие брюки', desc: 'Плотные брюки с накладками на коленях.', category: 'clothing', slot: 'pants', weight: 0.8, value: 40, durability: 120, armor: { defense: 2 }, icon: { shape: 'pants', color: '#3d4a5c' } },
    { id: 'pants_cargo', name: 'Карго-штаны', desc: 'Штаны с множеством карманов.', category: 'clothing', slot: 'pants', weight: 0.9, value: 70, durability: 120, armor: { defense: 2 }, icon: { shape: 'pants', color: '#4f5a3a' } },
    { id: 'outer_leather', name: 'Кожаная куртка', desc: 'Потёртая кожанка с заклёпками.', category: 'clothing', slot: 'outer', weight: 2, value: 90, durability: 200, armor: { defense: 4 }, icon: { shape: 'jacket', color: '#3a2a22' } },
    { id: 'outer_duster', name: 'Плащ-пыльник', desc: 'Длинный плащ от песка и ветра пустоши.', category: 'clothing', slot: 'outer', weight: 1.8, value: 110, durability: 180, armor: { defense: 3, resist: { fire: 0.05 } }, icon: { shape: 'coat', color: '#8a6d4a' } },
    { id: 'outer_hazmat', name: 'Химзащитный комбинезон', desc: 'Прорезиненный комбинезон. Хорошо защищает от яда и радиации.', category: 'clothing', slot: 'outer', weight: 3, value: 400, rarity: 'uncommon', level: 3, durability: 150, armor: { defense: 2, resist: { poison: 0.4 } }, icon: { shape: 'jacket', color: '#c9a52a' } },
    { id: 'head_bandana', name: 'Бандана', desc: 'Защищает голову от солнца и пыли.', category: 'clothing', slot: 'head', weight: 0.1, value: 8, durability: 50, icon: { shape: 'bandana', color: '#8a2d2d' } },
    { id: 'head_helmet', name: 'Каска', desc: 'Строительная каска. Выдерживает удар кирпичом.', category: 'armor', slot: 'head', weight: 0.8, value: 50, durability: 200, armor: { defense: 3 }, icon: { shape: 'helmet', color: '#d8b83a' } },
    { id: 'head_hood_mage', name: 'Капюшон мага', desc: 'Глубокий капюшон с вышитыми рунами. Защищает от магии.', category: 'clothing', slot: 'head', weight: 0.3, value: 600, rarity: 'rare', level: 5, req: { magic: 3 }, durability: 150, armor: { defense: 1, resist: { magic: 0.2 } }, icon: { shape: 'hood', color: '#3a2a5a' } },
    { id: 'head_power', name: 'Шлем «Титан»', desc: 'Шлем силовой брони с дыхательным фильтром и дисплеем.', category: 'armor', slot: 'head', weight: 3, value: 2500, rarity: 'epic', level: 12, req: { strength: 4, engineering: 3 }, durability: 1000, armor: { defense: 12, resist: { poison: 0.5, fire: 0.2, energy: 0.1 } }, icon: { shape: 'helmet_full', color: '#5a6a4a', color2: '#4ff2ff' } },
    { id: 'face_goggles', name: 'Защитные очки', desc: 'Очки сварщика. Спасают глаза от песка и вспышек.', category: 'clothing', slot: 'face', weight: 0.2, value: 25, durability: 80, icon: { shape: 'goggles', color: '#3a3a3a', color2: '#6fc8ff' } },
    { id: 'face_gasmask', name: 'Противогаз', desc: 'Резиновая маска с фильтром. Защищает от ядовитых газов.', category: 'clothing', slot: 'face', weight: 0.9, value: 120, rarity: 'uncommon', durability: 120, armor: { resist: { poison: 0.3 } }, icon: { shape: 'mask', color: '#3d4a3a' } },
    { id: 'face_scuba', name: 'Акваланг', desc: 'Маска с загубником и баллоном за спиной. Даёт большой запас воздуха под водой и позволяет нырять глубже первого подводного уровня.', category: 'clothing', slot: 'face', weight: 4, value: 450, rarity: 'uncommon', durability: 200, scuba: true, icon: { shape: 'mask', color: '#2a6a8a', color2: '#ffd84a' } },
    { id: 'face_nvg', name: 'Визор ночного видения', desc: 'Электронный визор. Ночью видно почти как днём.', category: 'clothing', slot: 'face', weight: 0.6, value: 900, rarity: 'rare', level: 6, req: { engineering: 2 }, durability: 150, icon: { shape: 'goggles', color: '#2d3136', color2: '#5aff5a' } },
    { id: 'hands_work', name: 'Рабочие перчатки', desc: 'Брезентовые перчатки.', category: 'clothing', slot: 'hands', weight: 0.1, value: 10, durability: 60, armor: { defense: 1 }, icon: { shape: 'gloves', color: '#a8946a' } },
    { id: 'hands_kevlar', name: 'Кевларовые перчатки', desc: 'Не режутся ножом и не горят.', category: 'armor', slot: 'hands', weight: 0.3, value: 180, rarity: 'uncommon', durability: 200, armor: { defense: 2, resist: { fire: 0.05 } }, icon: { shape: 'gloves', color: '#3a3a3a' } },
    { id: 'feet_wraps', name: 'Обмотки', desc: 'Тряпки, намотанные на ноги. Лучше, чем босиком.', category: 'clothing', slot: 'feet', weight: 0.3, value: 2, durability: 40, icon: { shape: 'boots', color: '#8a7a55' } },
    { id: 'feet_boots', name: 'Кирзовые сапоги', desc: 'Высокие сапоги из грубой кожи.', category: 'clothing', slot: 'feet', weight: 1.4, value: 45, durability: 180, armor: { defense: 1 }, icon: { shape: 'boots', color: '#2a2320' } },
    { id: 'feet_army', name: 'Армейские ботинки', desc: 'Удобные берцы с металлическим носком.', category: 'armor', slot: 'feet', weight: 1.2, value: 120, durability: 250, armor: { defense: 2 }, icon: { shape: 'boots', color: '#3a3a30' } },
    { id: 'feet_mag', name: 'Магнитные сапоги', desc: 'Сапоги с электромагнитами: не скользят и держат на металле.', category: 'armor', slot: 'feet', weight: 2.2, value: 1100, rarity: 'rare', level: 7, req: { engineering: 3 }, durability: 400, armor: { defense: 3, resist: { electric: 0.2 } }, icon: { shape: 'boots', color: '#50565c', color2: '#6fc8ff' } },
    { id: 'back_cloak', name: 'Плащ странника', desc: 'Шерстяной плащ с капюшоном. Греет ночью.', category: 'clothing', slot: 'back', weight: 1.2, value: 40, durability: 120, armor: { defense: 1 }, icon: { shape: 'cloak', color: '#4a3a2a' } },
    { id: 'back_camo', name: 'Маскировочная накидка', desc: 'Накидка из лоскутов под цвет местности. Помогает прятаться.', category: 'clothing', slot: 'back', weight: 0.8, value: 350, rarity: 'uncommon', req: { stealth: 2 }, durability: 100, flags: ['stealth'], icon: { shape: 'cloak', color: '#5a6a3a' } },
    { id: 'belt_pouches', name: 'Ремень с подсумками', desc: 'Широкий ремень с кармашками: +2 ячейки.', category: 'clothing', slot: 'belt', weight: 0.5, value: 60, durability: 150, slots: 2, icon: { shape: 'belt', color: '#5a3d24' } },
    { id: 'belt_tools', name: 'Пояс инструментальщика', desc: 'Пояс с петлями и карманами для инструментов: +3 ячейки.', category: 'clothing', slot: 'belt', weight: 0.9, value: 180, rarity: 'uncommon', req: { engineering: 2 }, durability: 200, slots: 3, icon: { shape: 'belt', color: '#6b4a2c', color2: '#9aa0a6' } },
    // Броня
    { id: 'armor_leather', name: 'Кожаный доспех', desc: 'Нагрудник из нескольких слоёв вываренной кожи.', category: 'armor', slot: 'armor', weight: 4, value: 150, durability: 250, armor: { defense: 6 }, icon: { shape: 'armor', color: '#6b4a2c' } },
    { id: 'armor_chain', name: 'Кольчуга', desc: 'Кольчуга из колец, нарезанных из пружин.', category: 'armor', slot: 'armor', weight: 8, value: 400, rarity: 'uncommon', level: 3, req: { strength: 3 }, durability: 400, armor: { defense: 10 }, icon: { shape: 'armor', color: '#8d949c' } },
    { id: 'armor_vest', name: 'Бронежилет', desc: 'Кевларовый жилет с пластинами. Держит пистолетную пулю.', category: 'armor', slot: 'armor', weight: 5, value: 600, rarity: 'uncommon', level: 4, durability: 350, armor: { defense: 12 }, icon: { shape: 'vest', color: '#3d4a3a' } },
    { id: 'armor_plate', name: 'Латы из автожелеза', desc: 'Пластинчатая броня из капотов и дверей машин. Тяжело, но надёжно.', category: 'armor', slot: 'armor', weight: 14, value: 800, rarity: 'uncommon', level: 5, req: { strength: 5 }, durability: 600, armor: { defense: 18, resist: { fire: 0.1 } }, icon: { shape: 'armor', color: '#6d7278', color2: '#8a2d2d' } },
    { id: 'armor_cyber', name: 'Кибер-броня «Панцирь»', desc: 'Лёгкая композитная броня с сервоприводами и нейроинтерфейсом.', category: 'armor', slot: 'armor', weight: 9, value: 4000, rarity: 'epic', level: 10, req: { engineering: 4, intellect: 3 }, durability: 900, armor: { defense: 22, resist: { energy: 0.2, electric: 0.2 } }, icon: { shape: 'armor', color: '#2d3136', color2: '#4ff2ff' } },
    { id: 'armor_power', name: 'Силовая броня «Титан»', desc: 'Экзоскелет в тяжёлых пластинах. Надевается поверх нательного слоя; верхнюю одежду и плащ под ней не носят.', category: 'armor', slot: 'armor', weight: 30, value: 9000, rarity: 'legendary', level: 12, req: { strength: 5, engineering: 3 }, durability: 2000, blocks: ['outer', 'back'], flags: ['power'], armor: { defense: 35, resist: { fire: 0.3, energy: 0.2, poison: 0.3, physical: 0.2 } }, icon: { shape: 'power_armor', color: '#5a6a4a', color2: '#ffd84a' } },
    // Рюкзаки: slots — дополнительные ячейки, carry — дополнительный вес, кг
    { id: 'bag_canvas', name: 'Холщовая сумка', desc: 'Сумка через плечо: +4 ячейки, +2 кг.', category: 'backpack', slot: 'backpack', weight: 0.5, value: 10, durability: 100, slots: 4, carry: 2, icon: { shape: 'bag', color: '#a8946a' } },
    { id: 'backpack_tourist', name: 'Туристический рюкзак', desc: 'Старый рюкзак с каркасом: +8 ячеек, +10 кг.', category: 'backpack', slot: 'backpack', weight: 1.5, value: 120, rarity: 'uncommon', durability: 200, slots: 8, carry: 10, icon: { shape: 'backpack', color: '#3d5a7a' } },
    { id: 'backpack_army', name: 'Армейский рюкзак', desc: 'Вместительный рюкзак с разгрузочной системой: +12 ячеек, +15 кг.', category: 'backpack', slot: 'backpack', weight: 2.5, value: 450, rarity: 'rare', level: 4, durability: 350, slots: 12, carry: 15, icon: { shape: 'backpack', color: '#4f5a3a' } },
    { id: 'backpack_exo', name: 'Рюкзак-экзорама', desc: 'Рюкзак на моторизованной раме: +18 ячеек, +30 кг.', category: 'backpack', slot: 'backpack', weight: 5, value: 2500, rarity: 'epic', level: 9, req: { engineering: 3 }, durability: 600, slots: 18, carry: 30, icon: { shape: 'backpack', color: '#50565c', color2: '#ffd84a' } },
    // Украшения
    { id: 'ring_copper', name: 'Медное кольцо', desc: 'Колечко из медной проволоки. Говорят, приносит удачу.', category: 'accessory', slot: 'ring', weight: 0.01, value: 15, icon: { shape: 'ring', color: '#c8743a' } },
    { id: 'ring_rune', name: 'Руническое кольцо', desc: 'Кольцо с руной защиты. Слегка ослабляет вражеские заклинания.', category: 'accessory', slot: 'ring', weight: 0.01, value: 900, rarity: 'rare', level: 5, req: { magic: 2 }, armor: { resist: { magic: 0.1 } }, icon: { shape: 'ring', color: '#c9ced4', color2: '#6fc8ff' } },
    { id: 'ring_ember', name: 'Кольцо тлеющих углей', desc: 'Кольцо тёплое на ощупь. Защищает от огня.', category: 'accessory', slot: 'ring', weight: 0.01, value: 800, rarity: 'rare', level: 5, armor: { resist: { fire: 0.1 } }, icon: { shape: 'ring', color: '#d8b83a', color2: '#ff7a2a' } },
    { id: 'amulet_ward', name: 'Амулет-оберег', desc: 'Деревянный оберег на шнурке.', category: 'accessory', slot: 'amulet', weight: 0.05, value: 50, armor: { resist: { magic: 0.05 } }, icon: { shape: 'amulet', color: '#8a6d3b', color2: '#c9a54a' } },
    { id: 'amulet_fangs', name: 'Ожерелье из клыков', desc: 'Трофей охотника на мутантов. Звери чуют силу владельца.', category: 'accessory', slot: 'amulet', weight: 0.1, value: 300, rarity: 'uncommon', req: { taming: 2 }, icon: { shape: 'amulet', color: '#e8e0c8', color2: '#8a2d2d' } },
  ];

  // Расходуемое: effect — восстановление { hp, stamina, mp }
  const CONSUMABLES = [
    { id: 'ration', name: 'Сухпаёк', desc: 'Галеты, сушёное мясо и таблетка витаминов. Восстанавливает здоровье.', weight: 0.5, value: 10, stack: 10, effect: { hp: 25, food: 30 }, icon: { shape: 'food', color: '#6b5a3a' } },
    { id: 'canned', name: 'Консервы', desc: 'Банка тушёнки довоенного производства. Срок годности — неважен.', weight: 0.4, value: 15, stack: 10, effect: { hp: 40, food: 45 }, icon: { shape: 'can', color: '#8d949c', color2: '#b83a2a' } },
    { id: 'meat_roast', name: 'Жареное мясо', desc: 'Мясо мутанта на вертеле. Лучше не спрашивать, какого.', weight: 0.6, value: 12, stack: 10, effect: { hp: 30, food: 40 }, icon: { shape: 'meat', color: '#8a4a2a' } },
    { id: 'water_flask', name: 'Фляга воды', desc: 'Вода из колодца. Восстанавливает выносливость.', weight: 1, value: 8, stack: 5, effect: { stamina: 30, water: 35 }, icon: { shape: 'flask', color: '#5a7a8a' } },
    { id: 'water_clean', name: 'Очищенная вода', desc: 'Бутылка фильтрованной воды без привкуса железа.', weight: 0.6, value: 20, stack: 10, effect: { stamina: 50, water: 50 }, icon: { shape: 'bottle', color: '#6fc8ff' } },
    { id: 'air_tank', name: 'Баллон с воздухом', desc: 'Небольшой баллон сжатого воздуха. Под водой — пополняет запас воздуха (шкала «Воздух»).', weight: 1.5, value: 60, stack: 5, rarity: 'uncommon', effect: { air: 90 }, icon: { shape: 'bottle', color: '#6fa8c8' } },
    { id: 'medkit', name: 'Аптечка', desc: 'Бинты, антисептик и обезболивающее. Быстро восстанавливает здоровье.', weight: 0.8, value: 90, stack: 5, rarity: 'uncommon', effect: { hp: 80 }, icon: { shape: 'medkit', color: '#e8e0d8', color2: '#c83a2a' } },
    { id: 'mana_tonic', name: 'Настой маны', desc: 'Светящийся настой из редких грибов. Восстанавливает ману.', weight: 0.3, value: 60, stack: 10, rarity: 'uncommon', effect: { mp: 40, rest: 10 }, icon: { shape: 'potion', color: '#3a6aff' } },
    { id: 'stim', name: 'Стимулятор', desc: 'Инъектор с боевым коктейлем: бодрит и слегка лечит.', weight: 0.1, value: 120, stack: 5, rarity: 'rare', effect: { stamina: 60, hp: 10, rest: 25 }, icon: { shape: 'syringe', color: '#d8dde2', color2: '#5aff5a' } },
  ];

  // Выживание (шаг 9): food/water/rest — шкалы (из 100), rad — радиация (минус — выводит),
  // ill — шанс заболеть, cure — лечит болезнь, spoils — портится (сырое), cook — во что превращается у костра,
  // camp — разводится костром, bedroll — спальник в сумке позволяет спать (Z)
  CONSUMABLES.push(
    { id: 'meat_raw', name: 'Сырое мясо', desc: 'Свежее мясо животного. Лучше пожарить у костра: сырое чуть утоляет голод, но может вызвать болезнь. Портится.', weight: 0.6, value: 5, stack: 10, effect: { food: 15, hp: 5 }, ill: 0.35, spoils: true, cook: 'meat_roast', icon: { shape: 'meat', color: '#c04a4a' } },
    { id: 'water_dirty', name: 'Грязная вода', desc: 'Мутная вода из лужи или реки. Утоляет жажду, но можно заболеть и схватить радиацию. У костра — очистить.', weight: 1, value: 1, stack: 5, effect: { water: 30, stamina: 15, rad: 3 }, ill: 0.25, cook: 'water_clean', icon: { shape: 'flask', color: '#6a6a3a' } },
    { id: 'herbs', name: 'Лечебные травы', desc: 'Пучок горьких трав. Лечит болезнь и немного здоровья.', weight: 0.1, value: 12, stack: 20, effect: { hp: 10 }, cure: true, icon: { shape: 'star', color: '#4a8a3a' } },
    { id: 'antirad', name: 'Антирадин', desc: 'Таблетки йода и сорбента. Выводит радиацию (−40).', weight: 0.1, value: 70, stack: 10, rarity: 'uncommon', effect: { rad: -40 }, icon: { shape: 'syringe', color: '#e8e8d8', color2: '#d8c83a' } },
    { id: 'coffee', name: 'Суррогатный кофе', desc: 'Жжёный цикорий в жестянке. Бодрит.', weight: 0.2, value: 14, stack: 10, effect: { rest: 30, stamina: 10 }, icon: { shape: 'can', color: '#5a3a2a', color2: '#c8a878' } },
    { id: 'campfire', name: 'Костровой набор', desc: 'Сухие дрова и огниво. Использовать — развести костёр у ног: рядом с ним сырое мясо жарится, грязная вода очищается (используйте их у огня).', weight: 2, value: 10, stack: 5, effect: {}, camp: true, icon: { shape: 'planks', color: '#8a5a2a' } },
  );

  // Свитки рецептов (шаг 10): использовать — выучить рецепт (shared/crafting.js). id свитка — scroll_<рецепт>
  const SCROLLS = [
    ['outer_leather', 'Кожаная куртка'], ['armor_leather', 'Кожаный доспех'], ['sword_short', 'Короткий меч'], ['armor_chain', 'Кольчуга'],
    ['gunpowder', 'Порох'], ['ammo_9mm', 'Патроны 9 мм'], ['ammo_12g', 'Дробь'], ['medkit', 'Аптечка'], ['antirad', 'Антирадин'], ['stim', 'Стимулятор'],
    ['ration', 'Сухпаёк'], ['ammo_cell', 'Энергоячейка'], ['mine_clapper', 'Мина'], ['turret_watchman', 'Турель'],
    ['build_wall_stone', 'Каменная стена'], ['build_gate', 'Ворота'], ['build_spikes', 'Колья'], ['build_forge', 'Кузница'],
    ['build_chemlab', 'Химстол'], ['build_electronics', 'Стол электроники'], ['build_generator', 'Генератор'],
    ['shrinker', 'Контейнер-уменьшитель'], ['dragon_charm', 'Драконий амулет'],
    ['veh_parts', 'Автозапчасти'], ['veh_kit_motorcycle', 'Мотоцикл'], ['fuel_gas', 'Бензин'],
  ];
  for (const [rid, title] of SCROLLS) {
    CONSUMABLES.push({ id: 'scroll_' + rid, name: `Рецепт: ${title}`, desc: `Записи мастера. Использовать — выучить рецепт «${title}» (книга рецептов — K). Позже такие продают торговцы в поселениях.`, weight: 0.1, value: 60, stack: 5, rarity: 'uncommon', effect: {}, teaches: rid, icon: { shape: 'cloth', color: '#e8dcb0', color2: '#6a4a2a' } });
  }

  // Свитки и книги заклинаний (шаг 12): использовать — выучить заклинание (shared/magic.js). 1-й круг — свиток, 2–3-й — книга
  if (Magic) for (const sp of Magic.SPELLS) {
    const school = Magic.SCHOOLS[sp.school], book = sp.tier > 1;
    CONSUMABLES.push({ id: Magic.itemId(sp.id), name: `${book ? 'Книга' : 'Свиток'} заклинания: ${sp.name}`, desc: `${school.name}, ${Magic.TIERS[sp.tier].name.toLowerCase()}. ${sp.desc} Использовать — выучить заклинание (книга заклинаний — P); ${book ? 'книга' : 'свиток'} при этом тратится.`, weight: book ? 0.8 : 0.1, value: [0, 80, 250, 700][sp.tier], stack: 5, rarity: ['', 'uncommon', 'rare', 'epic'][sp.tier], effect: {}, teachesSpell: sp.id, icon: { shape: book ? 'book' : 'scroll', color: book ? '#4a2a5a' : school.color, color2: school.color } });
  }

  const MATERIALS = [
    { id: 'scrap_metal', name: 'Металлолом', desc: 'Куски железа для ремонта и крафта.', weight: 1, value: 3, stack: 50, icon: { shape: 'scrap', color: '#6d7278' } },
    { id: 'planks', name: 'Доски', desc: 'Строительный материал для базы.', weight: 2, value: 2, stack: 30, icon: { shape: 'planks', color: '#8a6a3a' } },
    { id: 'cloth', name: 'Ткань', desc: 'Лоскуты ткани для одежды и бинтов.', weight: 0.2, value: 2, stack: 50, icon: { shape: 'cloth', color: '#b8a888' } },
    { id: 'electronics', name: 'Электроника', desc: 'Платы и провода из разобранной техники.', weight: 0.3, value: 15, stack: 50, rarity: 'uncommon', icon: { shape: 'chip', color: '#2d5a3a', color2: '#d8b83a' } },
    { id: 'quest_parcel', name: 'Посылка', desc: 'Перевязанный бечёвкой свёрток для другого поселения. Предмет задания: не продаётся, отдать старосте поселения-адресата.', weight: 0.5, value: 0, stack: 10, quest: true, noTrade: true, icon: { shape: 'cloth', color: '#a0703a' } },
    { id: 'caps', name: 'Крышки', desc: 'Крышки от довоенных бутылок — ходовая мелочь в поселениях. Сто крышек — один золотой самородок.', weight: 0, value: 1, stack: Number.MAX_SAFE_INTEGER, icon: { shape: 'nugget', color: '#c0c4c8' } },
    { id: 'gold_nugget', name: 'Золотой самородок', desc: 'Ценится в любом поселении: торговцы принимают его за 100 крышек и дают сдачу.', weight: 0.2, value: 100, stack: 50, rarity: 'rare', icon: { shape: 'nugget', color: '#e8c83a' } },
    { id: 'platinum', name: 'Платина', desc: 'Редкий металл для электроники и сложных механизмов.', weight: 0.2, value: 180, stack: 50, rarity: 'rare', icon: { shape: 'nugget', color: '#d8dde2' } },
    { id: 'hide', name: 'Шкура', desc: 'Выделанная шкура животного. Материал для одежды и снаряжения (крафт — позже).', weight: 1, value: 8, stack: 20, icon: { shape: 'cloth', color: '#8a6a4a' } },
    { id: 'bedroll', name: 'Спальник', desc: 'Скатка из шкур и ткани. Пока лежит в сумке, отдых (Z) — полноценный сон: бодрость восстанавливается быстрее.', weight: 2.5, value: 40, stack: 1, bedroll: true, icon: { shape: 'cloak', color: '#6a5a3a' } },
    // строительство и крафт (шаг 10)
    { id: 'wood', name: 'Древесина', desc: 'Брёвна и ветки. Рубятся с деревьев (лучше топором). Для построек и крафта.', weight: 0.5, value: 2, stack: 50, icon: { shape: 'planks', color: '#6a4a2a' } },
    { id: 'stone', name: 'Камень', desc: 'Обломки породы. Добываются из валунов киркой. Для фундаментов и каменных стен.', weight: 0.8, value: 2, stack: 50, icon: { shape: 'nugget', color: '#8a8a82' } },
    { id: 'plastic', name: 'Пластик', desc: 'Куски пластика из руин. Для электроники, аптечек и снаряжения.', weight: 0.3, value: 4, stack: 50, icon: { shape: 'scrap', color: '#d8d0b8' } },
    { id: 'gunpowder', name: 'Порох', desc: 'Самодельный порох для патронов и гранат (химстол).', weight: 0.1, value: 10, stack: 50, rarity: 'uncommon', icon: { shape: 'nugget', color: '#2a2a2a' } },
    { id: 'base_flag', name: 'Флаг базы', desc: 'Древко с флагом. Использовать в мире — объявить участок базой (одна база на аккаунт в мире). Нельзя рядом с поселением и точкой появления.', weight: 2, value: 30, stack: 1, claim: true, effect: {}, icon: { shape: 'staff', color: '#8a6a3a', color2: '#c83a2a' } },
    { id: 'chitin', name: 'Хитиновая пластина', desc: 'Панцирь хищного насекомого: лёгкий и прочный материал для брони.', weight: 0.8, value: 25, stack: 20, rarity: 'uncommon', icon: { shape: 'plate', color: '#5a4a2a' } },
    // транспорт (шаг 14)
    { id: 'veh_parts', name: 'Автозапчасти', desc: 'Детали двигателей, шины и листы брони. Ремонт техники: у верстака своей базы — до полной прочности, в поле — до половины.', weight: 2, value: 35, stack: 20, rarity: 'uncommon', icon: { shape: 'scrap', color: '#8a6a4a', color2: '#c8c8c8' } },
    { id: 'veh_kit_bicycle', name: 'Набор: велосипед', desc: 'Собранная из хлама рама с колёсами. Использовать в мире — поставить велосипед рядом (он будет ваш).', weight: 8, value: 60, stack: 1, vehicle: 'bicycle', effect: {}, icon: { shape: 'scrap', color: '#3a7ab8' } },
    { id: 'veh_kit_rowboat', name: 'Набор: вёсельная лодка', desc: 'Доски, вёсла и смола. Использовать у воды — спустить лодку на воду (она будет ваша).', weight: 12, value: 50, stack: 1, vehicle: 'rowboat', effect: {}, icon: { shape: 'planks', color: '#8a6a3a' } },
    { id: 'veh_kit_motorcycle', name: 'Набор: мотоцикл', desc: 'Двигатель, рама и бак. Использовать в мире — собрать мотоцикл рядом (он будет ваш, бак пуст).', weight: 20, value: 400, stack: 1, rarity: 'uncommon', vehicle: 'motorcycle', effect: {}, icon: { shape: 'scrap', color: '#8a2d2d' } },
    // спутники (шаг 11)
    { id: 'circuit_rare', name: 'Редкая микросхема', desc: 'Военная плата с довоенного склада. Нужна для контейнера-уменьшителя и сложной техники.', weight: 0.2, value: 120, stack: 20, rarity: 'rare', icon: { shape: 'chip', color: '#3a2d5a', color2: '#e8e0ff' } },
    { id: 'shrinker', name: 'Контейнер-уменьшитель', desc: 'Довоенный военный контейнер: уменьшает спутника и хранит его внутри, как джинна в лампе. Без него приручённые звери идут пешком, а дракона не приручить. Вмещает сколько угодно спутников; призвать одновременно — не больше «Напарников».', weight: 1.5, value: 900, stack: 1, rarity: 'epic', icon: { shape: 'can', color: '#5a6a7a', color2: '#7ae0ff' } },
    { id: 'dragon_charm', name: 'Драконий амулет', desc: 'Амулет из платины и золота с запахом драконьего логова. Тратится при попытке приручить связанного лассо дракона.', weight: 0.2, value: 600, stack: 5, rarity: 'epic', icon: { shape: 'nugget', color: '#e0702a', color2: '#ffd84a' } },
  ];

  // ---------- Нормализация: значения по умолчанию ----------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function mergeDeep(base, over) {
    const out = clone(base || {});
    for (const [k, v] of Object.entries(over || {})) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) ? mergeDeep(out[k], v) : v;
    }
    return out;
  }
  function finish(it, category) {
    const x = Object.assign({
      category, size: 1, value: 1, rarity: 'common', level: 1, req: {}, stack: 1, durability: null, slot: null,
      twoHanded: false, placeable: false, fixed: false, blocks: [], flags: [], icon: { shape: 'box', color: '#888888' },
    }, it);
    x.stackable = x.stack > 1;
    return x;
  }

  WEAPONS.push(
    {id:'mg_pecheneg',name:'Печенег',desc:'Пулемёт с кожухом охлаждения и коробом ленты. Занимает обе руки.',class:'machinegun',weight:8.2,value:1800,level:6,rarity:'rare',twoHanded:true,weapon:{damage:[12,18],speed:8,range:26,ammo:'ammo_556',magazine:200,reload:5,flags:['automatic','heavy']},icon:{shape:'pecheneg',color:'#49504e',color2:'#ae9566'}},
    {id:'mg_m240',name:'Пулемёт M240',desc:'Тяжёлый ленточный пулемёт с сошками и коробом. Занимает обе руки.',class:'machinegun',weight:12.5,value:2100,level:8,rarity:'rare',twoHanded:true,weapon:{damage:[14,21],speed:7.5,range:28,ammo:'ammo_556',magazine:200,reload:5.5,flags:['automatic','heavy']},icon:{shape:'m240',color:'#555d64',color2:'#8d7759'}},
    {id:'mg_gatling',name:'Гатлинг «Шторм»',desc:'Вращающийся блок из шести стволов. Высокая скорострельность, занимает обе руки.',class:'machinegun',weight:16,value:5200,level:13,rarity:'legendary',twoHanded:true,weapon:{damage:[9,14],speed:12,range:24,ammo:'ammo_556',magazine:300,reload:6,flags:['automatic','heavy']},icon:{shape:'gatling',color:'#535e68',color2:'#e5bb69'}}
  );
  const WEAPON_MATERIALS = [
    ['iron','Железо','#aeb7c2','#ced8e1',1,'common',1],
    ['silver','Серебро','#dae4ee','#aabbd1',1.15,'uncommon',3],
    ['gold','Золото','#e8ba59','#fff0b4',1.22,'rare',5],
    ['platinum','Платина','#d7dfde','#efffff',1.3,'rare',7],
    ['adamant','Адамант','#667b98','#a9c5ed',1.5,'epic',10],
    ['diamond','Алмаз','#a3cadb','#dcf8ff',1.55,'epic',11],
    ['brilliant','Бриллиант','#e4dfff','#ffffff',1.7,'legendary',14],
    ['laser','Лазер','#485866','#66edff',1.45,'rare',8],
    ['plasma','Плазма','#574c72','#ff93dc',1.6,'epic',11],
    ['tesla','Тесла','#4c6374','#97bfff',1.65,'epic',12],
    ['ion','Ион','#445963','#9effc8',1.75,'legendary',15],
  ];
  const WEAPON_FORMS = [
    ['dagger','Кинжал','knife','knife',0.5,[6,10],2.2,1.2,false],
    ['tanto','Танто','knife','tanto',0.6,[7,11],2,1.25,false],
    ['wakizashi','Вакидзаси','sword','wakizashi',0.9,[10,15],1.8,1.45,false],
    ['katana','Катана','sword','katana',1.3,[12,18],1.55,1.8,false],
    ['nodachi','Нодати','sword','nodachi',2.8,[18,27],0.95,2.5,true],
    ['sword','Меч','sword','sword',1.5,[11,17],1.5,1.7,false],
    ['axe','Топор','axe','axe',1.8,[13,20],1.15,1.5,false],
    ['tomahawk','Томагавк','axe','tomahawk',0.8,[8,13],1.9,1.3,false],
    ['spear','Копьё','spear','spear',2,[13,20],1.1,2.5,false],
    ['halberd','Алебарда','spear','halberd',3.5,[19,28],0.85,2.6,true],
    ['shuriken','Сюрикен','disc','star',0.15,[6,10],2.5,10,false],
    ['nunchaku','Нунчаки','club','nunchaku',0.7,[10,16],2,1.5,false],
    ['bow','Лук','bow','bow',1,[10,16],1.15,22,true],
    ['crossbow','Арбалет','crossbow','crossbow',2.5,[15,23],0.8,24,true],
    ['pistol','Пистолет','pistol','pistol',1,[6,10],3.2,17,false],
    ['rifle','Винтовка','rifle','rifle',3,[12,18],3,28,false],
    ['pecheneg','Печенег','machinegun','pecheneg',8.2,[12,18],8,26,true],
    ['m240','Пулемёт M240','machinegun','m240',12.5,[14,21],7.5,28,true],
    ['staff','Посох','fantasy','staff',2,[12,18],1.1,16,true],
    ['wand','Жезл','fantasy','wand',0.8,[8,13],1.6,12,false],
    ['grimoire','Гримуар','fantasy','book',1,[10,16],1.2,14,false],
    ['battle_scroll','Боевой свиток','fantasy','scroll',0.2,[7,12],1.4,12,false],
    ['uzi','Узи','smg','smg',1.9,[5,8],7,16,false],
    ['assault','Автомат','rifle','rifle',3.1,[8,13],5,24,false],
    ['gatling','Гатлинг','machinegun','gatling',12,[6,10],12,24,true],
    ['machinegun','Пулемёт','machinegun','mg',6,[7,11],8,25,true],
  ];
  for (const [material,label,color,accent,factor,rarity,level] of WEAPON_MATERIALS) {
    const energy = ['laser','plasma','tesla','ion'].includes(material);
    for (const [family,name,cls,shape,weight,damage,speed,range,twoHanded] of WEAPON_FORMS) {
      const ranged = ['bow','crossbow','pistol','rifle','machinegun'].includes(cls);
      const flags = energy ? ['glow', ...(material === 'tesla' ? ['chain'] : material === 'plasma' ? ['burn'] : ['armorPiercing'])] : [];
      if (cls === 'fantasy') flags.push('magic');
      if (cls === 'disc') flags.push('thrown','returns','silent');
      const ammo = ranged ? energy ? 'ammo_cell' : cls === 'bow' ? 'ammo_arrow' : cls === 'crossbow' ? 'ammo_bolt' : cls === 'pistol' ? 'ammo_9mm' : 'ammo_556' : null;
      WEAPONS.push({id:`forge_${material}_${family}`,name:`${name} — ${label}`,desc:`${name}: ${label.toLowerCase()}. ${['knife','sword','axe','spear','disc'].includes(cls) ? 'Можно метать без потери оружия.' : ''} ${!twoHanded ? 'Можно взять во вторую руку.' : 'Требует обеих рук.'}`,class:cls,material,rarity,level,weight,value:Math.round(80*factor*level),twoHanded,slot:twoHanded?'mainHand':'hand',durability:Math.round(300*factor),icon:{shape,color,color2:accent,material,energy},weapon:{damage:damage.map(n=>Math.round(n*factor)),damageType:energy ? material==='tesla'?'electric':material==='plasma'?'fire':'energy':'physical',speed,range,ammo,magazine:ranged ? cls==='bow'||cls==='crossbow'?1:cls==='machinegun'?100:24:0,flags,throwable:['knife','sword','axe','spear','disc'].includes(cls)}});
    }
  }

  const EQUIPMENT_SCHOOLS = [
    {id:'none',name:'Без чар',color:null},
    {id:'arcane',name:'Магические чары',color:'#c5a0ff',type:'magic',fx:'magic',flags:['magic']},
    {id:'dark',name:'Тёмная магия',color:'#a27cdd',type:'magic',fx:'shadow',flags:['magic','poison']},
    {id:'shadow',name:'Магия тени',color:'#788faa',type:'magic',fx:'umbraBolt',flags:['magic','armorPiercing']},
    {id:'water',name:'Магия воды',color:'#72d5ff',type:'magic',fx:'frost',flags:['magic','immobilize']},
    {id:'fire',name:'Магия огня',color:'#ffa054',type:'fire',fx:'fire',flags:['magic','burn']},
    {id:'earth',name:'Магия земли',color:'#ccb078',type:'physical',fx:'stone',flags:['magic','stun']},
    {id:'air',name:'Магия воздуха',color:'#b6edff',type:'magic',fx:'wind',flags:['magic','knockback']},
    {id:'blood',name:'Магия крови',color:'#ee6685',type:'magic',fx:'blood',flags:['magic','bleed','lifesteal']},
    {id:'electricity',name:'Магия электричества',color:'#91c9ff',type:'electric',fx:'tesla',flags:['magic','chain','stun']},
    {id:'light',name:'Магия света',color:'#fff0a0',type:'energy',fx:'holy',flags:['magic','armorPiercing']},
  ];
  // Every original weapon design also has every material; originals remain valid for old saves.
  const originalWeapons = WEAPONS.filter(w => !w.id.startsWith('forge_'));
  for (const w of originalWeapons) for (const [material,label,color,accent,factor,rarity,level] of WEAPON_MATERIALS) {
    const variant = clone(w); variant.id = `variant_${material}_${w.id}`; variant.name = `${w.name} — ${label}`;
    variant.material = material; variant.level = Math.max(w.level || 1,level); variant.rarity = rarity;
    variant.icon = {...w.icon,color,color2:accent,material,energy:['laser','plasma','tesla','ion'].includes(material)};
    variant.weapon = {...w.weapon,damage:w.weapon.damage.map(n=>Math.round(n*factor)),flags:[...(w.weapon.flags || [])]};
    if (variant.icon.energy) { variant.weapon.damageType = material==='tesla'?'electric':material==='plasma'?'fire':'energy'; variant.weapon.flags.push('glow'); }
    WEAPONS.push(variant);
  }
  const materialWeapons = WEAPONS.filter(w=>w.material);
  for (const w of materialWeapons) {
    w.school='none';w.affinity=`${w.material}_none`;
    for (const school of EQUIPMENT_SCHOOLS.slice(1)) {
      const x=clone(w);x.id=`${w.id}_${school.id}`;x.school=school.id;x.affinity=`${w.material}_${school.id}`;
      x.name=`${w.name} · ${school.name}`;x.desc=`${w.desc || w.name} ${school.name}: ${school.id==='blood'?'кровотечение и восстановление здоровья при попадании.':'стихийный урон и особый эффект.'}`;
      x.level=Math.max(3,(w.level || 1)+2);x.rarity=['epic','legendary'].includes(w.rarity)?w.rarity:'rare';x.value=Math.round((w.value||100)*1.7);
      x.weapon.damage=x.weapon.damage.map(n=>Math.round(n*1.12));x.weapon.damageType=school.type;x.weapon.flags=[...new Set([...x.weapon.flags,...school.flags])];x.weapon.fx=school.fx;
      x.icon={...x.icon,color2:school.color,school:school.id,energy:true}; WEAPONS.push(x);
    }
  }
  const wardrobe=WEARABLES.filter(w=>!w.fixed);
  for (const w of wardrobe) for (const [material,label,color,accent,factor,rarity,level] of WEAPON_MATERIALS) for (const school of EQUIPMENT_SCHOOLS) {
    const x=clone(w);x.id=`wear_${w.id}_${material}_${school.id}`;x.material=material;x.school=school.id;x.affinity=`${material}_${school.id}`;
    x.name=`${w.name} — ${label}${school.id==='none'?'':` · ${school.name}`}`;
    x.level=Math.max(w.level||1,level);x.rarity=school.id==='none'?rarity:['epic','legendary'].includes(rarity)?rarity:'rare';
    x.value=Math.round((w.value||10)*factor*(school.id==='none'?1:1.7));x.icon={...w.icon,color,color2:school.color||accent,material,school:school.id};
    if(x.armor){x.armor.defense=Math.round((x.armor.defense||0)*factor);if(school.type)x.armor.resist={...x.armor.resist,[school.type]:0.15};}
    WEARABLES.push(x);
  }

  const ITEMS = [];
  for (const w of WEAPONS) {
    if (['pistol','smg','rifle','sniper'].includes(w.class)) { w.twoHanded = false; w.slot = 'hand'; }
    const cls = WEAPON_CLASSES[w.class] || { d: {} };
    const merged = mergeDeep(cls.d, w);
    merged.weapon = Object.assign({ class: w.class, ammo: null, magazine: 0, reload: 0, flags: [] }, merged.weapon);
    merged.weapon.twoHanded = Boolean(merged.twoHanded);
    if (!merged.placeable && merged.slot == null) merged.slot = merged.twoHanded ? 'mainHand' : 'hand';
    ITEMS.push(finish(merged, 'weapon'));
  }
  for (const a of AMMO) ITEMS.push(finish({ rounds: 1, ...a }, 'ammo')); // rounds — зарядов в одном предмете
  for (const w of WEARABLES) ITEMS.push(finish(w, w.category));
  for (const c of CONSUMABLES) ITEMS.push(finish(c, 'consumable'));
  for (const m of MATERIALS) ITEMS.push(finish(m, 'material'));
  // топоры — инструмент для деревьев
  for (const it of ITEMS) if (it.weapon && it.weapon.class === 'axe' && !it.tool) it.tool = 'axe';

  const SETS = [
    {id:'stealth',name:'Стелс — Преломление',affinity:'stealth',school:'none',material:'iron',color:'#718995',accent:'#b5eef5',bonuses:[
      {pieces:2,text:'+10 защиты',defense:10},{pieces:3,text:'+3 маны в секунду',mpRegen:3},
      {pieces:4,text:'Стелс до атаки; шанс и множитель критического урона ×10',stealth:true},
      {pieces:5,text:'Уберстелс: маскировка всей команды до её атак',stealthTeam:true}]},
    { id: 'veil', name: 'Призрак пустоши', color: '#353044', accent: '#b79aff', bonuses: [
      { pieces: 2, text: '+12 защиты', defense: 12 },
      { pieces: 3, text: '+4 маны в секунду', mpRegen: 4 },
      { pieces: 4, text: 'Постоянная невидимость, даже при атаке', invisible: true },
      { pieces: 5, text: 'Клинок призрака: раз в 8 секунд теневой взрыв вокруг ближайшего врага', storm: 'poison' } ] },
    { id: 'phoenix', name: 'Сердце феникса', color: '#8d3b29', accent: '#ffc769', bonuses: [
      { pieces: 2, text: '+2 здоровья в секунду', hpRegen: 2 },
      { pieces: 3, text: '+10 защиты и ещё +3 здоровья в секунду', defense: 10, hpRegen: 3 },
      { pieces: 4, text: 'Автолечение: дополнительно 2% максимального здоровья в секунду', hpPercent: 0.02 },
      { pieces: 5, text: 'Меч феникса: раз в 8 секунд огненный взрыв вокруг ближайшего врага', storm: 'fire' } ] },
    { id: 'sky', name: 'Небесный странник', color: '#41647d', accent: '#90e9ff', bonuses: [
      { pieces: 2, text: '+10 защиты', defense: 10 },
      { pieces: 3, text: '+3 здоровья и маны в секунду', hpRegen: 3, mpRegen: 3 },
      { pieces: 4, text: 'Реактивный ранец: полёт над водой и скалами, PageUp/PageDown — высота', fly: true },
      { pieces: 5, text: 'Громовой клинок: раз в 8 секунд электрический взрыв вокруг ближайшего врага', storm: 'electric' } ] },
    { id: 'chaos', name: 'Хранитель стихий', color: '#47634f', accent: '#b6ffd0', bonuses: [
      { pieces: 2, text: '+15 защиты', defense: 15 },
      { pieces: 3, text: '+5 маны и +3 здоровья в секунду', hpRegen: 3, mpRegen: 5 },
      { pieces: 4, text: '+25 защиты и ещё +4 здоровья в секунду', defense: 25, hpRegen: 4 },
      { pieces: 5, text: 'Клинок стихий: случайный огненный, ледяной или электрический взрыв раз в 8 секунд', storm: 'random' } ] },
  ];
  for (const [material,label,color,accent,factor,rarity,level] of WEAPON_MATERIALS) for (const school of EQUIPMENT_SCHOOLS) for (const style of ['knight','power','mage']) {
    const title={knight:'Рыцарский',power:'Силовой',mage:'Магический'}[style];
    const full=school.id==='shadow'||school.id==='dark'?{text:'Постоянная невидимость',invisible:true}:school.id==='air'?{text:'Полёт с реактивным ранцем',fly:true}:school.id==='blood'?{text:'Вампиризм: 8% нанесённого урона',lifesteal:0.08}:school.id==='earth'?{text:'+30 защиты',defense:30}:{text:'Автолечение 1% здоровья в секунду',hpPercent:0.01};
    SETS.push({id:`forge_${style}_${material}_${school.id}`,name:`${title} комплект — ${label}${school.id==='none'?'':` · ${school.name}`}`,material,school:school.id,affinity:`${material}_${school.id}`,style,color,accent:school.color||accent,level,factor,
      bonuses:[{pieces:2,text:'+10 защиты',defense:10},{pieces:3,text:'+3 здоровья и маны в секунду',hpRegen:3,mpRegen:3},{pieces:4,...full},{pieces:5,text:'Уберкомплект: любое оружие того же материала и школы; стихийная буря и +20 защиты',storm:school.type||'random',defense:20}]});
  }
  const stealthWeapons=ITEMS.filter(it=>it.weapon&&!it.placeable&&!it.material).map(it=>{
    const copy=clone(it);copy.id='stealth_'+it.id;copy.name='Стелс — '+it.name;copy.affinity='stealth';copy.material='iron';copy.school='none';copy.stealth=true;copy.rarity='legendary';copy.value=Math.max(3000,copy.value*3);copy.icon={...copy.icon,color:'#718995',color2:'#b5eef5',stealth:true};copy.weapon.flags=[...new Set([...copy.weapon.flags,'silent'])];copy.desc+=' Полупрозрачное стелс-оружие. С полным комплектом «Преломление» скрывает команду до атак.';return copy;
  });ITEMS.push(...stealthWeapons);
  for (const set of SETS) {
    set.items = [];
    for (const [slot, name, shape, defense] of [['armor', 'Доспех', 'armor', 16], ['head', 'Шлем', 'helmet', 5], ['hands', 'Перчатки', 'gloves', 3], ['feet', 'Сапоги', 'boots', 4]]) {
      const id = `set_${set.id}_${slot}`; set.items.push(id);
      ITEMS.push(finish({ id, name: `${name} — ${set.name}`, desc: `Часть комплекта «${set.name}». Бонусы за 2, 3 и 4 детали складываются; оружие того же материала и школы открывает пятый бонус.`, category: 'armor', slot, set: set.id, level:set.level||1, weight: slot === 'armor' ? 4 : 0.6, value: 2500, rarity: 'epic', durability: 800, armor: { defense: set.factor ? Math.round(defense*set.factor*(set.style==='power'?1.5:set.style==='mage'?0.8:1)) : defense }, material:set.material,school:set.school,affinity:set.affinity,flags:set.style==='power'?['power']:[],icon: { shape:slot==='armor'&&set.style==='power'?'power_armor':slot==='armor'&&set.style==='mage'?'robe':shape, color: set.color, color2: set.accent,school:set.school } }, 'armor'));
    }
    if(set.id==='stealth')for(const id of set.items){const it=ITEMS.find(it=>it.id===id);it.stealth=true;it.icon.stealth=true;}
    if (set.affinity) {
      set.weapons=ITEMS.filter(it=>it.weapon&&!it.placeable&&it.affinity===set.affinity).map(it=>it.id);
      set.items.push(set.weapons.find(id=>id.includes('_gatling')) || set.weapons[0]);
      continue;
    }
    const id = `set_${set.id}_blade`; set.items.push(id);
    ITEMS.push(finish({ id, name: `Клинок — ${set.name}`, desc: `Редкое оружие комплекта «${set.name}». С четырьмя доспехами пробуждает боевую магию.`, category: 'weapon', slot: 'hand', set: set.id, weight: 1.8, value: 9000, rarity: 'legendary', durability: 1200, weapon: { class: 'sword', damage: [22, 32], damageType: set.id === 'phoenix' ? 'fire' : set.id === 'sky' ? 'electric' : 'magic', range: 1.6, speed: 1.4, ammo: null, magazine: 0, reload: 0, flags: ['magic'] }, icon: { shape: 'sword', color: set.color, color2: set.accent } }, 'weapon'));
  }
  for (const it of ITEMS) {
    it.icon.rarity = it.rarity; it.icon.set = it.set || null;
    if (it.weapon) {
      it.weapon.twoHanded = Boolean(it.twoHanded);
      if (it.weapon.class === 'disc') { it.weapon.flags = [...new Set([...it.weapon.flags, 'returns'])]; if (!/не расходу/.test(it.desc)) it.desc += ' Метание не расходует оружие.'; }
    }
  }
  // наборы техники и дронов — как прочие наборы (велосипед, лодка, мотоцикл): «материал» с действием, не расходник панели 1–0
  for(const [id,name,vehicle]of [['veh_kit_car','Легковая машина','car'],['veh_kit_truck','Грузовик','truck'],['veh_kit_tank','Танк','tank']])
    ITEMS.push(finish({id,name:'Набор: '+name,desc:'Используйте рядом со свободной площадкой: собрать транспорт. Топливо и боеприпасы загружаются отдельно.',weight:25,value:1800,stack:1,rarity:'rare',vehicle,effect:{},icon:{shape:'scrap',color:'#687c6b'}},'material'));
  for(const [type,name]of [['uav','БПЛА'],['quad','Квадрокоптер'],['tracked','Гусеничный дрон'],['service','Сервисный астродроид']])
    ITEMS.push(finish({id:'drone_kit_'+type,name:'Набор: '+name,desc:'Использовать — собрать личного робота-спутника. Управление и ремонт в панели спутников.',weight:4,value:700,stack:1,rarity:'rare',drone:'drone_'+type,effect:{},icon:{shape:'scrap',color:'#7097a9',color2:'#65dcff'}},'material'));
  for(const [id,name,kind,color,accent,school,rarity,value]of [
    ['flight_jetpack','Реактивный ранец','jetpack','#526d82','#8eeaff','none','rare',1800],
    ['wings_angel','Крылья ангела','angel','#ece8dc','#b5dcff','air','rare',2200],
    ['wings_archangel','Крылья архангела','archangel','#fff4cd','#efd17e','air','legendary',7000],
    ['wings_hell','Крылья ада','hell','#552e3b','#f47959','fire','epic',4500]
  ])ITEMS.push(finish({id,name,category:'clothing',slot:'back',flight:kind,school,weight:kind==='jetpack'?5:2,value,rarity,durability:800,desc:'Наденьте в слот «Спина». Взлёт и посадка — кнопки под миникартой; PageUp/PageDown — высота. На земле крылья сложены. Снять последнюю лётную экипировку можно после посадки.',icon:{shape:kind==='jetpack'?'jetpack':'wings',color,color2:accent,wingKind:kind}},'clothing'));
  // Устаревшие варианты доступны по прежним id, но не предлагаются как отдельные школы.
  const LEGACY_SCHOOLS={dark:'shadow',light:'electricity',arcane:'electricity'};
  const LEGACY_ITEMS=new Map();
  for(let i=ITEMS.length-1;i>=0;i--){
    const it=ITEMS[i],school=LEGACY_SCHOOLS[it.school];if(!school)continue;
    const old=it.school,descriptor=EQUIPMENT_SCHOOLS.find(x=>x.id===school);
    it.school=school;it.affinity=it.material?`${it.material}_${school}`:it.affinity;
    if(it.set)it.set=it.set.replace(new RegExp('_'+old+'$'),'_'+school);
    it.icon={...it.icon,school,color2:descriptor.color};
    it.desc=(it.desc||'').replace(/Тёмная магия/g,'Магия тени').replace(/Магические чары|Магия света/g,'Магия электричества');
    it.name=it.name.replace(/Тёмная магия/g,'Магия тени').replace(/Магические чары|Магия света/g,'Магия электричества');
    if(it.weapon){it.weapon.damageType=descriptor.type;it.weapon.fx=descriptor.fx;}
    LEGACY_ITEMS.set(it.id,it);ITEMS.splice(i,1);
  }
  for(let i=SETS.length-1;i>=0;i--)if(LEGACY_SCHOOLS[SETS[i].school])SETS.splice(i,1);
  for(let i=EQUIPMENT_SCHOOLS.length-1;i>=0;i--)if(LEGACY_SCHOOLS[EQUIPMENT_SCHOOLS[i].id])EQUIPMENT_SCHOOLS.splice(i,1);
  const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
  const get = (id) => BY_ID.get(id) || LEGACY_ITEMS.get(id) || null;
  const SET_BY_ID = new Map(SETS.map(s=>[s.id,s]));
  function setState(ch) {
    const equipped = new Set(Object.values(ch && ch.inventory && ch.inventory.equipment || {}).filter((x) => x && x.dur !== 0).map((x) => x.id));
    const active = new Set([...equipped].map(id=>get(id)?.set).filter(Boolean));
    return [...active].map(id=>SET_BY_ID.get(id)).filter(Boolean).map((set) => {
      const armorPieces = set.items.slice(0, 4).filter((id) => equipped.has(id)).length;
      const hasWeapon=set.affinity ? ['mainHand','offHand'].some(slot=>{const x=ch.inventory.equipment[slot],it=x&&x.dur!==0&&get(x.id);return Boolean(it?.weapon&&it.affinity===set.affinity);}) : equipped.has(set.items[4]);
      const pieces = armorPieces + (armorPieces === 4 && hasWeapon ? 1 : 0);
      return { ...set, pieces, armorPieces, bonuses: set.bonuses.map((b) => ({ ...b, active: pieces >= b.pieces })) };
    }).filter((s) => s.pieces > 0);
  }
  function flightGear(ch) {
    const eq=ch&&ch.inventory&&ch.inventory.equipment;
    for(const inst of Object.values(eq||{})){const it=inst&&get(inst.id);if(it?.flight&&(inst.dur==null||inst.dur>0))return it;}
    return null;
  }
  function setEffects(ch) {
    const out = { defense: 0, hpRegen: 0, mpRegen: 0, hpPercent: 0, invisible: false,stealth:false,stealthTeam:false, fly: false, storm: null, lifesteal: 0 };
    for (const s of setState(ch)) for (const b of s.bonuses) if (b.active) {
      for (const k of ['defense', 'hpRegen', 'mpRegen', 'hpPercent', 'lifesteal']) out[k] += b[k] || 0;
      if (b.invisible) out.invisible = true;
      if(b.stealth)out.stealth=true;if(b.stealthTeam)out.stealthTeam=true;
      if (b.fly) out.fly = true;
      if (b.storm) out.storm = b.storm;
    }
    if(flightGear(ch))out.fly=true;
    return out;
  }
  function rollSetLoot(rnd = Math.random, armorChance = 0.20, weaponChance = 0.04) {
    const out = [];
    if (rnd() < armorChance) { const set = SETS[Math.min(SETS.length - 1, Math.floor(rnd() * SETS.length))]; out.push({ id: set.items[Math.min(3, Math.floor(rnd() * 4))], n: 1 }); }
    if (rnd() < weaponChance) { const set = SETS[Math.min(SETS.length - 1, Math.floor(rnd() * SETS.length))]; out.push({ id: set.weapons ? set.weapons[Math.floor(rnd()*set.weapons.length)] : set.items[4], n: 1 }); }
    return out;
  }
  function lootPriority(ch, item, modes, instance = null, ammoTypes = null) {
    if (!item || item.fixed) return 0;
    const eq = ch.inventory.equipment;
    const usesAmmo = (x) => { const it = x && get(x.id); return it && it.weapon && it.weapon.ammo === item.id; };
    const needed = modes.needed && (item.effect && (item.effect.food > 0 || item.effect.water > 0 || item.effect.mp > 0) || item.category === 'ammo' && (ammoTypes ? ammoTypes.has(item.id) : ch.inventory.cells.some(usesAmmo) || Object.values(eq).some(usesAmmo)));
    if (modes.needed && needed) return 3;
    if (modes.best && !(instance && instance.dur === 0) && (item.weapon && !item.placeable || item.armor)) {
      const score = (it) => !it ? 0 : item.weapon ? it.weapon ? (it.weapon.damage[0] + it.weapon.damage[1]) / 2 * it.weapon.speed : 0 : (it.armor && it.armor.defense || 0) + Object.values(it.armor && it.armor.resist || {}).reduce((a, v) => a + v * 25, 0);
      const slots = slotsFor(item);
      if (item.weapon) {
        const worn = [eq.mainHand, eq.offHand].filter((x) => x && x.dur !== 0).map((x) => get(x.id));
        return score(item) > Math.max(0, ...worn.map(score)) ? 2 : modes.all ? 1 : 0;
      }
      if (slots.length && slots.some((slot) => score(item) > score(eq[slot] && eq[slot].dur !== 0 ? get(eq[slot].id) : null))) return 2;
    }
    return modes.all ? 1 : 0;
  }

  // ---------- Проверка каталога (тесты и запуск сервера) ----------
  const STAT_IDS = ['strength', 'magic', 'intellect', 'stealth', 'persuasion', 'hacking', 'engineering', 'builder', 'suggestion', 'taming', 'companions'];
  function validateCatalogue() {
    const errors = [];
    const ids = new Set();
    for (const it of ITEMS) {
      const e = (m) => errors.push(`${it.id || '?'}: ${m}`);
      if (typeof it.id !== 'string' || !/^[a-z0-9_]+$/.test(it.id)) e('некорректный id');
      if (ids.has(it.id)) e('повторяющийся id');
      ids.add(it.id);
      if (typeof it.name !== 'string' || !it.name.trim()) e('нет названия');
      if (typeof it.desc !== 'string' || it.desc.length < 5) e('нет описания');
      if (!CATEGORIES[it.category]) e('неизвестная категория ' + it.category);
      if (!RARITIES[it.rarity]) e('неизвестная редкость ' + it.rarity);
      for (const k of ['weight', 'value', 'size', 'level', 'stack']) if (!Number.isFinite(it[k]) || it[k] < 0) e(`поле ${k} должно быть числом ≥ 0`);
      if (!Number.isInteger(it.stack) || it.stack < 1) e('stack — целое ≥ 1');
      if (it.durability !== null && !(Number.isInteger(it.durability) && it.durability > 0)) e('durability — целое > 0 или null');
      if (it.stackable && it.durability !== null) e('складываемый предмет не может иметь прочность');
      if (!it.icon || typeof it.icon.shape !== 'string' || !/^#[0-9a-f]{6}$/i.test(it.icon.color || '')) e('нет иконки (shape, color)');
      if (it.icon && it.icon.color2 && !/^#[0-9a-f]{6}$/i.test(it.icon.color2)) e('некорректный color2');
      for (const [k, v] of Object.entries(it.req)) if (!STAT_IDS.includes(k) || !Number.isInteger(v) || v < 1) e('некорректное требование ' + k);
      if (it.slot !== null && !SLOT_TYPES[it.slot]) e('неизвестный тип слота ' + it.slot);
      for (const b of it.blocks) if (!SLOTS.some((s) => s.id === b)) e('blocks: неизвестный слот ' + b);
      if (it.category === 'weapon') {
        const w = it.weapon;
        if (!w || !WEAPON_CLASSES[w.class]) e('нет класса оружия');
        else {
          if (!DAMAGE_TYPES[w.damageType]) e('неизвестный тип урона ' + w.damageType);
          if (!Array.isArray(w.damage) || w.damage.length !== 2 || !(w.damage[0] >= 0) || w.damage[1] < w.damage[0]) e('урон — [мин, макс]');
          for (const k of ['speed', 'range', 'magazine', 'reload']) if (!Number.isFinite(w[k]) || w[k] < 0) e(`weapon.${k} — число ≥ 0`);
          if (w.ammo !== null && (!get(w.ammo) || get(w.ammo).category !== 'ammo')) e('неизвестный боеприпас ' + w.ammo);
          if (w.ammo && !(w.magazine >= 1)) e('оружию с боеприпасами нужен магазин ≥ 1');
          if (!Array.isArray(w.flags)) e('weapon.flags — массив');
          if (!it.placeable && !['hand', 'mainHand'].includes(it.slot)) e('оружие должно надеваться в руки');
          if (it.twoHanded && it.slot !== 'mainHand') e('двуручное оружие — только в правую руку (slot mainHand)');
        }
      }
      if (it.category === 'ammo' && !(Number.isInteger(it.rounds) && it.rounds >= 1)) e('rounds — целое ≥ 1');
      if (it.effect) for (const [k, v] of Object.entries(it.effect)) if (k === 'rad' ? !Number.isFinite(v) || !v : !['hp', 'stamina', 'mp', 'food', 'water', 'rest', 'air'].includes(k) || !(v > 0)) e('некорректный эффект ' + k);
      if (it.cook && (!get(it.cook) || !get(it.cook).effect)) e('cook — неизвестный результат ' + it.cook);
      if (it.ill != null && !(it.ill >= 0 && it.ill <= 1)) e('ill — шанс от 0 до 1');
      if (it.category === 'consumable' && !it.effect) e('расходуемому нужен эффект');
      if (it.category === 'backpack' && !(it.slots > 0)) e('рюкзаку нужны ячейки');
      if (['clothing', 'armor', 'backpack', 'accessory'].includes(it.category) && !it.slot) e('носимому предмету нужен слот');
    }
    return errors;
  }

  const slotById = (id) => SLOTS.find((s) => s.id === id) || null;
  const slotsFor = (it) => (it && it.slot ? SLOT_TYPES[it.slot] : []);

  return {
    CATEGORIES, DAMAGE_TYPES, RARITIES, SLOTS, SLOT_TYPES, WEAPON_GROUPS, WEAPON_CLASSES, STAT_IDS,
    ITEMS, WEAPON_MATERIALS, EQUIPMENT_SCHOOLS, get, validateCatalogue, slotById, slotsFor, SETS, setState, setEffects, flightGear, lootPriority, rollSetLoot,
  };
});
