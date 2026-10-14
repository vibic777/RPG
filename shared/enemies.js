// Бестиарий: враги и таблицы добычи. Это ДАННЫЕ, а не код: новый враг — строка в таблице ENEMIES,
// поведение задаётся ссылкой на BEHAVIOURS (параметры для ИИ сервера), места появления — весами биомов.
// Общий файл: сервер (ИИ, появление, добыча) и клиент (рисунок, справка «Враги», подсказки).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./items'), require('./worldgen'));
  else root.Enemies = factory(root.Items, root.WorldGen);
})(typeof self !== 'undefined' ? self : this, function (Items, WorldGen) {
  'use strict';
  const Difficulty = typeof module === 'object' && module.exports ? require('./difficulty') : (typeof self !== 'undefined' ? self.Difficulty : null);

  // Настраиваемые значения (config.game)
  const settings = {
    maxEnemyLevel: 99,
    enemyHpPerLevel: 0.15, // +доля здоровья за уровень врага сверх первого
    enemyDamageFactor: 0.8, // общий множитель урона врагов
    enemyDamagePerLevel: 0.045, // +доля урона за уровень
    enemyDefensePerLevel: 0.5, // +брони за уровень
    enemyXpPerLevel: 0.2, // +доля опыта за уровень
    lootLevelSlack: 2, // предметы из добычи — не выше уровня врага + это число
    lootRarityWeights: '60,25,10,4,1', // веса редкостей при случайном предмете: обычный, необычный, редкий, эпический, легендарный
    lootChanceFactor: 1, // множитель шанса добычи (2 — вдвое реже «пусто»)
    difficulty: 'normal',
    robotsWalkSeabed: true, // роботы и наземные дроны ходят по дну (вода проходима, скорость как вплавь)
  };
  function configure(game) {
    for (const k of Object.keys(settings)) if (game && game[k] !== undefined) settings[k] = game[k];
  }

  // Семейства (разделы бестиария). Пустые — формат готов, враги появятся на следующих этапах
  const FAMILIES = {
    human: { name: 'Люди', hint: 'Рейдеры, мародёры и прочие обитатели пустоши, живущие грабежом.' },
    mutant: { name: 'Радиационные мутанты', hint: 'Три степени мутации: чем выше степень, тем сильнее и тем глупее.' },
    animal: { name: 'Животные', hint: 'Обычные звери и их огромные мутировавшие сородичи.' },
    insect: { name: 'Насекомые', hint: 'Гигантские насекомые, скорпионы и пауки.' },
    zombie: { name: 'Зомби', hint: 'В городах и пустошах; при частых ордах приходят толпами.' },
    robot: { name: 'Роботы', hint: 'Довоенные машины, до сих пор выполняющие свою программу.' },
    cyborg: { name: 'Киборги', hint: 'Люди с имплантами — от железной руки до почти полностью механического тела. Уязвимы к ЭМИ, как роботы.' },
    alien: { name: 'Пришельцы', hint: 'Существа не с этой планеты. Редки, живут вдали от людей, опаснее местных хищников.' },
    mage: { name: 'Маги', hint: 'Люди, владеющие одной из семи школ магии, и ниндзя с магией теней. Держатся на расстоянии и колдуют. Можно украсть (скопировать) заклинание у живого мага (X рядом с ним), а убив мага — забрать его силу. Роняют свитки и книги заклинаний.' },
    dragon: { name: 'Драконы', hint: 'Живут у логов, отмеченных на карте (если в мире есть драконы). Летают — вода и горы им не преграда. Вид дракона — по типу логова. Приручение: связать лассо и потратить драконий амулет (нужен контейнер-уменьшитель).' },
  };

  // Поведение — параметры ИИ (сервер читает их, а не название поведения):
  //   keepDistance — отступать, если герой ближе такой доли дальности атаки (стрелки); packAggro — заметил один, нападают все рядом;
  //   leashFactor — во сколько раз дальше преследует; alarmFactor — радиус тревоги (× game.packAggroRadius);
  //   aggroFactor — множитель радиуса обнаружения
  const BEHAVIOURS = {
    rusher: { name: 'Напористый', desc: 'Замечает героя и сразу идёт в ближний бой.' },
    kiter: { name: 'Стрелок', desc: 'Держится на расстоянии и стреляет; отходит, если подойти вплотную.', keepDistance: 0.3 },
    pack: { name: 'Стая', desc: 'Охотится стаей: заметил один — нападают все рядом.', packAggro: true },
    horde: { name: 'Орда', desc: 'Медленно, но неотвратимо идёт за добычей, преследует далеко и не отступает.', packAggro: true, leashFactor: 3 },
    guard: { name: 'Страж', desc: 'Охраняет место; по тревоге сходится вся охрана вокруг.', packAggro: true, alarmFactor: 2 },
    brute: { name: 'Громила', desc: 'Туповат: замечает героя поздно, но бьёт очень сильно и не отступает.', aggroFactor: 0.7 },
    civil: { name: 'Мирный', desc: 'Мирный житель: никогда не нападает первым и убегает, если его ударить.', passive: true, peaceful: true, leashFactor: 1 },
    loner: { name: 'Одиночка', desc: 'Не нападает первым; если его задеть — мстит и преследует очень далеко.', passive: true, leashFactor: 2.5 },
  };

  // Формы для процедурного рисунка
  const SHAPES = ['humanoid', 'zombie', 'quadruped', 'scorpion', 'ant', 'spider', 'mantis', 'walker', 'cyborg', 'alien', 'dragon', 'drone'];

  // Враги. level — [мин, макс]; hp, defense, resist — на 1-м уровне; speed — клеток/с; radius — размер для попаданий;
  // attack: kind melee | ranged, damage [мин, макс], type — тип урона, range — клеток, speed — атак/с, proj — скорость снаряда,
  // fx — вид снаряда, flags — как у оружия (poison, bleed, stun…); aggro — радиус обнаружения, leash — как далеко уходит от дома;
  // fleeAt — доля здоровья, при которой убегает (0 — никогда); group — размер группы; biomes — веса появления;
  // xp — опыт на 1-м уровне; loot — таблица добычи; look — рисунок (crown — метка босса); tags — особенности (robot, cyborg — уязвимы к ЭМИ);
  // fly — летает: идёт напрямую над водой и горами; tameable: false — пока нельзя приручить;
  // boss — главарь: появляется редко (game.bossSpawnChance) вместе со свитой guards ([id, …]) числом guardCount;
  // spawn: false — никогда не появляется сам (только событием или командой /spawn)
  const ENEMIES = [
    // --- Люди ---
    { id: 'raider_thug', name: 'Рейдер-громила', family: 'human', desc: 'Бритоголовый громила с битой. Грабит караваны и тех, кто выглядит слабее.', level: [1, 5], hp: 38, defense: 2, speed: 3.4, attack: { kind: 'melee', damage: [4, 7], type: 'physical', range: 1.3, speed: 1.1 }, aggro: 8, leash: 18, behaviour: 'pack', group: [2, 4], biomes: { waste: 3, city: 3, desert: 1, hills: 1 }, xp: 16, loot: 'raider', look: { shape: 'humanoid', color: '#6b4a2c', color2: '#8a2d2d', weapon: 'club' } },
    { id: 'raider_gunner', name: 'Рейдер-стрелок', family: 'human', desc: 'Стреляет из самодельного пистолета из-за укрытия и не любит ближний бой.', level: [2, 6], hp: 30, defense: 1, speed: 3.3, attack: { kind: 'ranged', damage: [5, 8], type: 'physical', range: 9, speed: 1, proj: 28, fx: 'bullet' }, aggro: 10, leash: 18, behaviour: 'kiter', group: [1, 2], biomes: { waste: 2, city: 3, desert: 1 }, xp: 20, loot: 'raider', look: { shape: 'humanoid', color: '#4f4636', color2: '#b83a2a', weapon: 'pistol' } },
    { id: 'raider_marauder', name: 'Мародёр', family: 'human', desc: 'Опытный налётчик в броне из автомобильных дверей, с обрезом двустволки.', level: [5, 10], hp: 70, defense: 6, speed: 3.3, attack: { kind: 'ranged', damage: [10, 16], type: 'physical', range: 6, speed: 0.8, proj: 26, fx: 'pellets' }, aggro: 9, leash: 20, behaviour: 'kiter', group: [1, 3], biomes: { city: 2, waste: 2 }, xp: 45, loot: 'raider_rich', look: { shape: 'humanoid', color: '#5a5f65', color2: '#8a6d4a', weapon: 'shotgun', size: 1.05 } },
    { id: 'raider_sniper', name: 'Снайпер', family: 'human', desc: 'Засел на крыше или горном уступе с длинной винтовкой. Бьёт издалека и больно; вблизи беспомощен. Только на высотных уровнях.', level: [3, 14], hp: 34, defense: 1, speed: 3, attack: { kind: 'ranged', damage: [12, 18], type: 'physical', range: 16, speed: 0.45, proj: 40, fx: 'bullet' }, aggro: 16, leash: 16, behaviour: 'kiter', group: [1, 1], biomes: { roof: 3, ledge: 3 }, xp: 40, loot: 'raider_rich', look: { shape: 'humanoid', color: '#4a4a3a', color2: '#2a3a2a', weapon: 'rifle' } },
    // --- Мутанты ---
    { id: 'mutant_irradiated', name: 'Облучённый', family: 'mutant', desc: 'Низшая степень мутации: кожа в язвах, но он ещё помнит, как держать ружьё.', level: [2, 6], hp: 45, defense: 2, resist: { poison: 0.3 }, speed: 3, attack: { kind: 'ranged', damage: [4, 8], type: 'physical', range: 10, speed: 0.9, proj: 30, fx: 'bullet' }, aggro: 10, leash: 18, behaviour: 'kiter', group: [1, 3], biomes: { waste: 3, city: 2, desert: 2 }, xp: 22, loot: 'mutant', look: { shape: 'humanoid', color: '#8a9a5a', color2: '#4a3a2a', weapon: 'rifle' } },
    { id: 'mutant_slasher', name: 'Мутант-рубака', family: 'mutant', desc: 'Средняя степень мутации: разум угас, зато руки сжимают топор мёртвой хваткой.', level: [4, 9], hp: 85, defense: 4, resist: { poison: 0.3 }, speed: 3.3, attack: { kind: 'melee', damage: [8, 13], type: 'physical', range: 1.6, speed: 1 }, aggro: 8, leash: 18, behaviour: 'rusher', group: [1, 3], biomes: { waste: 2, hills: 2, forest: 1, city: 1 }, xp: 40, loot: 'mutant', look: { shape: 'humanoid', color: '#7a8a4a', color2: '#3a2a22', weapon: 'axe', size: 1.15 } },
    { id: 'mutant_brute', name: 'Мутант-громадина', family: 'mutant', desc: 'Высшая степень мутации: трёхметровая гора мышц с когтями. Глуп, но сносит всё на пути.', level: [7, 14], hp: 190, defense: 8, resist: { poison: 0.4 }, speed: 2.8, attack: { kind: 'melee', damage: [16, 26], type: 'physical', range: 1.6, speed: 0.7, flags: ['stun'] }, aggro: 9, leash: 16, behaviour: 'brute', group: [1, 1], biomes: { waste: 2, hills: 2, city: 1 }, xp: 90, loot: 'mutant_big', look: { shape: 'humanoid', color: '#6a7a3a', color2: '#d8d0b0', weapon: 'claws', size: 1.5 } },
    // --- Животные ---
    { id:'horse_wild', name:'Дикая лошадь', family:'animal', mountable:true, desc:'Приручается навыком Приручение. После связывания лассо покормите и приручите; N — сесть верхом.', level:[1,6], hp:65, defense:1, speed:3.5, attack:{kind:'melee',damage:[3,6],type:'physical',range:1.2,speed:0.9}, aggro:2, leash:12, behaviour:'loner', fleeAt:0.7, group:[1,3], biomes:{forest:2,hills:3,waste:1}, xp:12, loot:'animal', look:{shape:'quadruped',species:'horse',color:'#926d4f',color2:'#342b27',size:1.2} },
    { id:'horse_silver', name:'Серебряный скакун', family:'animal', mountable:true, desc:'Выносливая ездовая лошадь. Приручение и кормление повышают шанс получить спутника.', level:[3,9], hp:90, defense:2, speed:3.8, attack:{kind:'melee',damage:[4,8],type:'physical',range:1.3,speed:1}, aggro:2, leash:12, behaviour:'loner', fleeAt:0.6, group:[1,2], biomes:{forest:1,hills:2}, xp:20, loot:'animal', look:{shape:'quadruped',species:'horse',color:'#c7c5bb',color2:'#5e6269',size:1.25} },
    { id: 'wolf', name: 'Серый волк', family: 'animal', desc: 'Обычный волк. Поодиночке труслив, в стае — опасен.', level: [1, 4], hp: 26, defense: 0, speed: 4.6, attack: { kind: 'melee', damage: [3, 6], type: 'physical', range: 1.1, speed: 1.4 }, aggro: 9, leash: 20, behaviour: 'pack', fleeAt: 0.2, group: [2, 4], biomes: { forest: 4, hills: 2, waste: 1 }, xp: 12, loot: 'animal', look: { shape: 'quadruped', color: '#6d6a62', color2: '#d8d0c0', size: 0.8 } },
    { id: 'wolf_mutant', name: 'Рваноух', family: 'animal', desc: 'Мутировавший волк размером с телёнка, с рваной шкурой и лишним рядом зубов.', level: [5, 10], hp: 60, defense: 2, speed: 5, attack: { kind: 'melee', damage: [7, 12], type: 'physical', range: 1.2, speed: 1.5, flags: ['bleed'] }, aggro: 10, leash: 22, behaviour: 'pack', fleeAt: 0.15, group: [2, 4], biomes: { forest: 2, waste: 2, hills: 2 }, xp: 34, loot: 'animal_mutant', look: { shape: 'quadruped', color: '#4a3f3a', color2: '#b83a2a', size: 1 } },
    { id: 'boar', name: 'Кабан', family: 'animal', desc: 'Лесной кабан. Бросается на всех, кто подойдёт слишком близко.', level: [1, 4], hp: 40, defense: 2, speed: 4.2, attack: { kind: 'melee', damage: [4, 8], type: 'physical', range: 1.1, speed: 0.9 }, aggro: 6, leash: 14, behaviour: 'rusher', group: [1, 2], biomes: { forest: 3, hills: 1 }, xp: 14, loot: 'animal', look: { shape: 'quadruped', color: '#5a4030', color2: '#e8e0c8', size: 0.85 } },
    { id: 'boar_mutant', name: 'Бронекабан', family: 'animal', desc: 'Кабан-мутант с костяными пластинами на спине. Таранит так, что валит с ног.', level: [5, 10], hp: 110, defense: 10, speed: 4.4, attack: { kind: 'melee', damage: [9, 15], type: 'physical', range: 1.2, speed: 0.8, flags: ['stun'] }, aggro: 7, leash: 16, behaviour: 'rusher', group: [1, 2], biomes: { forest: 2, hills: 2, waste: 1 }, xp: 42, loot: 'animal_mutant', look: { shape: 'quadruped', color: '#4a3a30', color2: '#9a8a70', size: 1.2 } },
    { id: 'mutant_eel', name: 'Угорь-мутант', family: 'animal', desc: 'Двухметровый угорь с бледной светящейся кожей. Живёт на дне и бьёт током. Только под водой.', level: [3, 14], hp: 45, defense: 1, resist: { electric: 0.8 }, speed: 4.4, attack: { kind: 'melee', damage: [6, 10], type: 'electric', range: 1.3, speed: 1.1, flags: ['stun'] }, aggro: 8, leash: 16, behaviour: 'pack', group: [1, 3], biomes: { seabed: 4 }, xp: 30, loot: 'aquatic', look: { shape: 'quadruped', color: '#2a6a7a', color2: '#bff0ff', size: 0.8 } },
    { id: 'crab_mutant', name: 'Краб-броненосец', family: 'animal', desc: 'Краб размером с бочку. Панцирь держит пулю, клешни ломают кости. Только под водой.', level: [4, 16], hp: 95, defense: 12, speed: 2.6, attack: { kind: 'melee', damage: [9, 14], type: 'physical', range: 1.3, speed: 0.8 }, aggro: 6, leash: 12, behaviour: 'guard', group: [1, 2], biomes: { seabed: 3 }, xp: 40, loot: 'aquatic', look: { shape: 'scorpion', color: '#8a3a2a', color2: '#e8c0a0', size: 1.1 } },
    { id: 'sky_harpy', name: 'Крылан', family: 'animal', desc: 'Кожистокрылый мутант, охотится в небе на всё, что летает. Заготовка воздушных врагов: сам пока не появляется (только /spawn).', level: [8, 20], hp: 80, defense: 3, speed: 5.5, attack: { kind: 'melee', damage: [10, 15], type: 'physical', range: 1.4, speed: 1.2, flags: ['bleed'] }, aggro: 10, leash: 24, behaviour: 'pack', group: [2, 3], biomes: { hills: 1 }, xp: 70, loot: 'animal_mutant', fly: true, spawn: false, air: true, look: { shape: 'dragon', color: '#5a4a4a', color2: '#d8a08a', size: 0.7 } },
    { id: 'bear', name: 'Бурый медведь', family: 'animal', desc: 'Хозяин леса. Не ищет драки, но и не уступает дорогу.', level: [3, 7], hp: 120, defense: 4, speed: 3.8, attack: { kind: 'melee', damage: [10, 16], type: 'physical', range: 1.4, speed: 0.8 }, aggro: 6, leash: 14, behaviour: 'rusher', fleeAt: 0.1, group: [1, 1], biomes: { forest: 3, hills: 2 }, xp: 45, loot: 'animal', look: { shape: 'quadruped', color: '#5a3a22', color2: '#3a2616', size: 1.4 } },
    { id: 'bear_mutant', name: 'Горбач', family: 'animal', desc: 'Медведь-мутант с горбом из светящихся наростов. Вдвое больше обычного и вдвое злее.', level: [8, 15], hp: 260, defense: 8, resist: { fire: 0.1 }, speed: 3.9, attack: { kind: 'melee', damage: [18, 28], type: 'physical', range: 1.6, speed: 0.7, flags: ['stun'] }, aggro: 8, leash: 16, behaviour: 'brute', group: [1, 1], biomes: { forest: 1, hills: 2 }, xp: 110, loot: 'animal_mutant', look: { shape: 'quadruped', color: '#3a2a22', color2: '#6fdc3a', size: 1.8 } },
    // --- Зомби ---
    { id: 'zombie', name: 'Ходячий мертвец', family: 'zombie', desc: 'Медленный и неутомимый. Опасен толпой — и тем, что никогда не отстаёт.', level: [1, 6], hp: 45, defense: 1, resist: { poison: 0.8 }, speed: 1.7, attack: { kind: 'melee', damage: [3, 6], type: 'physical', range: 1.1, speed: 0.6 }, aggro: 9, leash: 20, behaviour: 'horde', group: [2, 5], biomes: { city: 4, waste: 3 }, xp: 12, loot: 'zombie', look: { shape: 'zombie', color: '#7a8a6a', color2: '#4a3a30' } },
    { id: 'zombie_runner', name: 'Бегун', family: 'zombie', desc: 'Свежий мертвец, ещё не забывший, как бегать.', level: [3, 8], hp: 35, defense: 0, resist: { poison: 0.8 }, speed: 3.6, attack: { kind: 'melee', damage: [4, 7], type: 'physical', range: 1.1, speed: 1 }, aggro: 11, leash: 22, behaviour: 'horde', group: [1, 3], biomes: { city: 3, waste: 2 }, xp: 20, loot: 'zombie', look: { shape: 'zombie', color: '#8a8a7a', color2: '#3d4a5c' } },
    { id: 'zombie_bloated', name: 'Раздутый', family: 'zombie', desc: 'Распухший от трупного газа мертвец. Его удары отравляют.', level: [4, 9], hp: 90, defense: 2, resist: { poison: 0.8 }, speed: 1.4, attack: { kind: 'melee', damage: [5, 8], type: 'poison', range: 1.2, speed: 0.5, flags: ['poison'] }, aggro: 8, leash: 18, behaviour: 'horde', group: [1, 2], biomes: { city: 2, waste: 2 }, xp: 28, loot: 'zombie', look: { shape: 'zombie', color: '#6a8a4a', color2: '#8a6a3a', size: 1.3 } },
    // --- Насекомые ---
    { id: 'scorpion_giant', name: 'Пустынный скорпион', family: 'insect', desc: 'Скорпион размером с собаку. Жало пробивает кожаную куртку и отравляет.', level: [3, 8], hp: 70, defense: 8, speed: 3.6, attack: { kind: 'melee', damage: [6, 10], type: 'poison', range: 1.3, speed: 1, flags: ['poison'] }, aggro: 7, leash: 15, behaviour: 'rusher', group: [1, 2], biomes: { desert: 4, waste: 1 }, xp: 30, loot: 'insect', look: { shape: 'scorpion', color: '#8a6a3a', color2: '#3a2616', size: 1.1 } },
    { id: 'ant_soldier', name: 'Муравей-жнец', family: 'insect', desc: 'Рыжий муравей в полметра ростом. Жнецы охотятся отрядами.', level: [2, 6], hp: 32, defense: 5, speed: 4, attack: { kind: 'melee', damage: [4, 7], type: 'physical', range: 1.1, speed: 1.2 }, aggro: 8, leash: 16, behaviour: 'pack', group: [3, 6], biomes: { desert: 2, waste: 2, forest: 1 }, xp: 14, loot: 'insect', look: { shape: 'ant', color: '#8a3a22', color2: '#2a1a12', size: 0.8 } },
    { id: 'spider_weaver', name: 'Паук-сетеплёт', family: 'insect', desc: 'Плетёт паутину в руинах и лесах. Плюётся ядом издалека.', level: [4, 9], hp: 55, defense: 3, speed: 3.8, attack: { kind: 'ranged', damage: [5, 8], type: 'poison', range: 7, speed: 0.8, proj: 12, fx: 'spit', flags: ['poison'] }, aggro: 9, leash: 16, behaviour: 'kiter', group: [1, 2], biomes: { forest: 3, city: 1 }, xp: 32, loot: 'insect', look: { shape: 'spider', color: '#2d2a26', color2: '#b83a2a' } },
    { id: 'mantis_reaper', name: 'Богомол-косарь', family: 'insect', desc: 'Двухметровый богомол. Лапы-косы оставляют глубокие раны.', level: [6, 12], hp: 95, defense: 6, speed: 4.5, attack: { kind: 'melee', damage: [12, 18], type: 'physical', range: 1.7, speed: 1.2, flags: ['bleed'] }, aggro: 8, leash: 16, behaviour: 'rusher', group: [1, 1], biomes: { hills: 2, forest: 2, desert: 1 }, xp: 55, loot: 'insect', look: { shape: 'mantis', color: '#5a8a3a', color2: '#d8e8a0', size: 1.3 } },
    // --- Роботы ---
    // --- Киборги ---
    { id: 'cyborg_ripper', name: 'Киборг-потрошитель', family: 'cyborg', desc: 'Наёмник, сменивший руки на гидравлические клинки. Боли не чувствует — импланты глушат её.', level: [6, 12], hp: 100, defense: 7, resist: { poison: 0.4 }, speed: 3.9, attack: { kind: 'melee', damage: [10, 15], type: 'physical', range: 1.5, speed: 1.3, flags: ['bleed'] }, aggro: 9, leash: 18, behaviour: 'rusher', group: [1, 2], biomes: { city: 2, waste: 1 }, xp: 60, loot: 'cyborg', tags: ['cyborg'], look: { shape: 'cyborg', color: '#5a6068', color2: '#3a8ad8', weapon: 'blades' } },
    { id: 'cyborg_gunner', name: 'Киборг-канонир', family: 'cyborg', desc: 'Вместо левой руки — вживлённая импульсная пушка, вместо глаза — прицел. Держит дистанцию.', level: [7, 14], hp: 80, defense: 6, resist: { poison: 0.4 }, speed: 3.3, attack: { kind: 'ranged', damage: [9, 14], type: 'energy', range: 11, speed: 1.1, proj: 34, fx: 'laser' }, aggro: 12, leash: 18, behaviour: 'kiter', group: [1, 2], biomes: { city: 2, waste: 1 }, xp: 65, loot: 'cyborg', tags: ['cyborg'], look: { shape: 'cyborg', color: '#4a4f58', color2: '#e0503a', weapon: 'armgun' } },
    // --- Пришельцы ---
    { id: 'alien_spitter', name: 'Кислотный плевун', family: 'alien', desc: 'Гибкая тварь с кожистым воротником вокруг головы и раздвоенным хвостом. Плюётся кислотой издалека.', level: [8, 15], hp: 90, defense: 4, resist: { poison: 0.9, fire: 0.2 }, speed: 4, attack: { kind: 'ranged', damage: [8, 12], type: 'poison', range: 7, speed: 1, proj: 16, fx: 'acid', flags: ['poison'] }, aggro: 10, leash: 18, behaviour: 'kiter', group: [1, 3], biomes: { desert: 1, waste: 1, hills: 0.5 }, xp: 75, loot: 'alien', look: { shape: 'alien', color: '#3a6a5a', color2: '#c8f03a' } },
    { id: 'alien_hunter', name: 'Пришелец-охотник', family: 'alien', desc: 'Двух с половиной метров, в пластинчатой броне, похожей на доспех самурая. Подкрадывается почти незаметно и рубит энергоклинком.', level: [12, 20], hp: 220, defense: 12, resist: { energy: 0.3, electric: 0.2 }, speed: 4.6, attack: { kind: 'melee', damage: [16, 24], type: 'energy', range: 1.7, speed: 1.2 }, aggro: 5, leash: 26, behaviour: 'rusher', group: [1, 1], biomes: { forest: 0.5, hills: 0.5, desert: 0.5 }, xp: 150, loot: 'alien', look: { shape: 'alien', color: '#3a3040', color2: '#b83ad8', size: 1.35, weapon: 'blade' } },
    { id: 'alien_drone', name: 'Трутень улья', family: 'alien', desc: 'Мелкая тварь из гнёзд пришельцев: бегает по стенам, кусает и зовёт сородичей. Живёт только в гнёздах (шаг 13).', level: [6, 14], hp: 50, defense: 3, resist: { poison: 0.8 }, speed: 4.8, attack: { kind: 'melee', damage: [6, 10], type: 'physical', range: 1.1, speed: 1.4, flags: ['bleed'] }, aggro: 9, leash: 16, behaviour: 'pack', group: [2, 4], biomes: { nest: 4 }, xp: 40, loot: 'alien', look: { shape: 'alien', color: '#4a3a5a', color2: '#e05aff', size: 0.75 } },
    // --- Драконы ---
    { id: 'dragon_fire', name: 'Огненный дракон', family: 'dragon', desc: 'Молодой огненный дракон с рыжей чешуёй. Не трогает прохожих, но если разозлить — жжёт пламенем и гонится над рекой и скалами.', level: [12, 25], hp: 700, defense: 16, resist: { fire: 0.9, poison: 0.3 }, speed: 4.4, attack: { kind: 'ranged', damage: [22, 34], type: 'fire', range: 7, speed: 0.8, proj: 18, fx: 'fireball', flags: ['burn'] }, aggro: 8, leash: 30, behaviour: 'loner', group: [1, 1], biomes: { hills: 1, desert: 0.5, forest: 0.5, waste: 0.5 }, xp: 600, loot: 'dragon', fly: true, tags: ['dragon'], radius: 0.9, look: { shape: 'dragon', color: '#c8501e', color2: '#ffc83a', size: 1.6 } },
    { id: 'dragon_ice', name: 'Ледяной дракон', family: 'dragon', desc: 'Бело-голубой дракон горных логов. Дышит стужей, от которой коченеют руки.', level: [12, 25], hp: 680, defense: 15, resist: { fire: 0.3, poison: 0.3 }, speed: 4.3, attack: { kind: 'ranged', damage: [20, 30], type: 'energy', range: 7, speed: 0.8, proj: 16, fx: 'spit', flags: ['stun'] }, aggro: 8, leash: 30, behaviour: 'loner', group: [1, 1], biomes: { hills: 1, forest: 0.5 }, xp: 620, loot: 'dragon', fly: true, tags: ['dragon'], radius: 0.9, look: { shape: 'dragon', color: '#9ad8f0', color2: '#ffffff', size: 1.6 } },
    { id: 'dragon_lava', name: 'Лавовый дракон', family: 'dragon', desc: 'Чёрный дракон пустынных логов с трещинами раскалённой лавы на чешуе. Самый тяжёлый и злой.', level: [14, 28], hp: 820, defense: 20, resist: { fire: 1, poison: 0.4 }, speed: 4, attack: { kind: 'ranged', damage: [26, 38], type: 'fire', range: 6, speed: 0.7, proj: 14, fx: 'fireball', flags: ['burn'] }, aggro: 8, leash: 30, behaviour: 'loner', group: [1, 1], biomes: { desert: 1, hills: 0.5 }, xp: 700, loot: 'dragon', fly: true, tags: ['dragon'], radius: 0.95, look: { shape: 'dragon', color: '#2a2224', color2: '#ff6a1a', size: 1.7 } },
    { id: 'dragon_water', name: 'Водный дракон', family: 'dragon', desc: 'Сине-зелёный дракон прибрежных логов. Бьёт струёй воды, сбивающей с ног.', level: [12, 25], hp: 650, defense: 14, resist: { fire: 0.5, poison: 0.3 }, speed: 4.6, attack: { kind: 'ranged', damage: [18, 28], type: 'physical', range: 8, speed: 0.9, proj: 20, fx: 'spit', flags: ['stun'] }, aggro: 8, leash: 30, behaviour: 'loner', group: [1, 1], biomes: { hills: 0.5, forest: 0.5 }, xp: 600, loot: 'dragon', fly: true, tags: ['dragon'], radius: 0.9, look: { shape: 'dragon', color: '#2a8a8a', color2: '#9af0e0', size: 1.6 } },
    // --- Главари банд (со свитой) и супер-босс ---
    { id: 'boss_raider', name: 'Барон Ржавый Зуб', family: 'human', desc: 'Главарь рейдеров в броне из дорожных знаков, с кувалдой из рельса. Ходит только со свитой громил и стрелков.', level: [6, 14], hp: 420, defense: 10, speed: 3.2, attack: { kind: 'melee', damage: [14, 22], type: 'physical', range: 1.7, speed: 0.8, flags: ['stun'] }, aggro: 9, leash: 20, behaviour: 'guard', group: [1, 1], biomes: { waste: 1, city: 1 }, xp: 300, loot: 'boss_gang', boss: true, guards: ['raider_thug', 'raider_gunner'], guardCount: [3, 5], look: { shape: 'humanoid', color: '#7a5a3a', color2: '#c8a03a', weapon: 'club', size: 1.3, crown: true } },
    { id: 'boss_mutant', name: 'Пророк Язв', family: 'mutant', desc: 'Вожак облучённых: говорит с радиацией и травит врагов светящейся жижей из посоха-трубы. Его стерегут мутанты всех степеней.', level: [10, 18], hp: 520, defense: 9, resist: { poison: 0.7 }, speed: 3, attack: { kind: 'ranged', damage: [14, 20], type: 'poison', range: 9, speed: 0.9, proj: 20, fx: 'acid', flags: ['poison'] }, aggro: 10, leash: 20, behaviour: 'guard', group: [1, 1], biomes: { waste: 1, hills: 0.5 }, xp: 420, loot: 'boss_gang', boss: true, guards: ['mutant_irradiated', 'mutant_slasher'], guardCount: [3, 4], look: { shape: 'humanoid', color: '#6a8a3a', color2: '#9aff5a', weapon: 'rifle', size: 1.35, crown: true } },
    { id: 'boss_cyborg', name: 'Командор Шестерня', family: 'cyborg', desc: 'Глава клана Шестерни: три механические руки, пушка на плече и холодный расчёт. Ближе всех к Железному Патриарху; ходит с потрошителями и канонирами.', level: [12, 20], hp: 600, defense: 13, resist: { poison: 0.5, energy: 0.2 }, speed: 3.2, attack: { kind: 'ranged', damage: [16, 24], type: 'energy', range: 11, speed: 1, proj: 34, fx: 'laser' }, aggro: 11, leash: 20, behaviour: 'guard', group: [1, 1], biomes: { city: 1, waste: 0.5 }, xp: 520, loot: 'boss_gang', boss: true, guards: ['cyborg_ripper', 'cyborg_gunner'], guardCount: [3, 4], tags: ['cyborg'], radius: 0.7, look: { shape: 'cyborg', color: '#3a4048', color2: '#3a8ad8', weapon: 'armgun', size: 1.4, crown: true } },
    { id: 'boss_ninja', name: 'Мастер Безликий', family: 'mage', desc: 'Глава клана Тени. Никто не видел его лица: появляется из дыма, бьёт и исчезает. Его стерегут ученики-ниндзя.', level: [12, 20], hp: 480, defense: 8, speed: 4.6, attack: { kind: 'melee', damage: [16, 24], type: 'physical', range: 1.4, speed: 1.4, flags: ['bleed'] }, aggro: 10, leash: 22, behaviour: 'guard', group: [1, 1], biomes: { forest: 1, city: 1 }, xp: 500, loot: 'boss_gang', boss: true, guards: ['ninja'], guardCount: [3, 4], spells: ['smoke', 'shadow_step', 'shadow_bolt'], look: { shape: 'humanoid', color: '#121218', color2: '#c83a3a', weapon: 'katana', size: 1.3, crown: true } },
    // --- Обитатели домов (shared/houses.js): только в интерьерах, сами в мире не появляются ---
    { id: 'house_resident', name: 'Жилец', family: 'human', desc: 'Мирный житель уцелевшего дома. Не нападает, а если ударить — убегает. Убивать его незачем: добычи почти нет.', level: [1, 40], hp: 26, defense: 0, speed: 3.1, attack: { kind: 'melee', damage: [1, 2], type: 'physical', range: 1.2, speed: 0.6 }, aggro: 4, leash: 8, behaviour: 'civil', fleeAt: 0.95, group: [1, 1], biomes: { city: 1 }, xp: 1, loot: 'none', spawn: false, look: { shape: 'humanoid', color: '#6c7a8c', color2: '#c8b48a', weapon: 'none' } },
    { id: 'house_squatter', name: 'Бродяга', family: 'human', desc: 'Нейтральный бродяга, занявший пустую квартиру. Сам не трогает, но если задеть — дерётся ножом и мстит.', level: [1, 40], hp: 34, defense: 1, speed: 3.3, attack: { kind: 'melee', damage: [3, 6], type: 'physical', range: 1.2, speed: 1 }, aggro: 6, leash: 14, behaviour: 'loner', group: [1, 1], biomes: { city: 1 }, xp: 10, loot: 'raider', spawn: false, look: { shape: 'humanoid', color: '#5b5040', color2: '#7a6a4a', weapon: 'knife' } },
    { id: 'family_kin', name: 'Член семьи', family: 'human', desc: 'Член вашей семьи в походе (шаг 17): идёт с вами как спутник. Сам в мире не появляется.', level: [1, 40], hp: 70, defense: 4, speed: 3.4, attack: { kind: 'melee', damage: [6, 10], type: 'physical', range: 1.3, speed: 1 }, aggro: 8, leash: 18, behaviour: 'guard', group: [1, 1], biomes: { city: 1 }, xp: 1, loot: 'none', spawn: false, look: { shape: 'humanoid', color: '#5a7a5a', color2: '#c8b070', weapon: 'club' } },
    { id: 'boss_super', name: 'Железный Патриарх', family: 'cyborg', desc: 'Легенда пустоши: старик, от которого осталась только голова в бронированном теле. Держит в страхе все банды. Сам не появляется — только особым событием.', level: [25, 40], hp: 3000, defense: 24, resist: { poison: 0.8, fire: 0.3, energy: 0.3 }, speed: 3, attack: { kind: 'ranged', damage: [30, 45], type: 'energy', range: 12, speed: 1, proj: 36, fx: 'laser', flags: ['stun'] }, aggro: 12, leash: 24, behaviour: 'guard', group: [1, 1], biomes: { city: 1 }, xp: 3000, loot: 'boss_super', boss: true, spawn: false, guards: ['cyborg_ripper', 'cyborg_gunner'], guardCount: [4, 6], tags: ['cyborg'], radius: 0.8, look: { shape: 'cyborg', color: '#3d4247', color2: '#ffd84a', weapon: 'armgun', size: 1.7, crown: true } },
    { id: 'alien_queen', name: 'Матка улья', family: 'alien', desc: 'Раздутая королева гнезда пришельцев на самом дне. Плюётся кислотой, её стерегут трутни и плевуны. Только в гнёздах.', level: [14, 30], hp: 900, defense: 14, resist: { poison: 1, fire: 0.1 }, speed: 2.4, attack: { kind: 'ranged', damage: [18, 28], type: 'poison', range: 9, speed: 0.9, proj: 16, fx: 'acid', flags: ['poison'] }, aggro: 10, leash: 14, behaviour: 'guard', group: [1, 1], biomes: { nest: 1 }, xp: 900, loot: 'boss_deep', boss: true, spawn: false, guards: ['alien_drone', 'alien_spitter'], guardCount: [3, 5], radius: 0.9, look: { shape: 'alien', color: '#5a2a5a', color2: '#ffea5a', size: 1.8, crown: true } },
    { id: 'leviathan', name: 'Левиафан', family: 'mutant', desc: 'Огромный мутант морских глубин, помесь угря и осьминога. Дно его логова усыпано костями ныряльщиков.', level: [12, 28], hp: 800, defense: 10, resist: { poison: 0.5, electric: 0 }, speed: 3.2, attack: { kind: 'melee', damage: [20, 30], type: 'physical', range: 2.2, speed: 0.8, flags: ['stun'] }, aggro: 9, leash: 14, behaviour: 'guard', group: [1, 1], biomes: { seabed: 1 }, xp: 850, loot: 'boss_deep', boss: true, spawn: false, guards: ['mutant_eel', 'crab_mutant'], guardCount: [2, 4], radius: 0.9, look: { shape: 'quadruped', color: '#1a4a5a', color2: '#9af0e0', size: 1.9, crown: true } },
    { id: 'boss_vault', name: 'Страж хранилища', family: 'robot', desc: 'Тяжёлый довоенный робот-охранник на гусеницах. Стережёт самую глубокую комнату хранилища.', level: [10, 26], hp: 850, defense: 20, resist: { poison: 1, fire: 0.3 }, speed: 2.4, attack: { kind: 'ranged', damage: [14, 22], type: 'physical', range: 12, speed: 2, proj: 36, fx: 'bullet' }, aggro: 11, leash: 14, behaviour: 'guard', group: [1, 1], biomes: { floor: 1 }, xp: 800, loot: 'boss_deep', boss: true, spawn: false, guards: ['walker_patrol'], guardCount: [1, 2], tags: ['robot'], radius: 0.85, look: { shape: 'walker', color: '#4a5058', color2: '#ff5a3a', size: 1.7, crown: true } },
    // --- Маги (шаг 12): spells — заклинания из shared/magic.js, которые враг читает в бою (и которые можно украсть) ---
    { id: 'mage_fire', name: 'Огненный маг', family: 'mage', desc: 'Отшельник в опалённой мантии. Мечет огненные стрелы и выжигает всё вокруг кольцом пламени.', level: [4, 12], hp: 60, defense: 2, resist: { fire: 0.5 }, speed: 3, attack: { kind: 'ranged', damage: [6, 10], type: 'fire', range: 10, speed: 0.8, proj: 18, fx: 'flame', flags: ['magic'] }, aggro: 11, leash: 20, behaviour: 'kiter', group: [1, 1], biomes: { desert: 2, waste: 1 }, xp: 60, loot: 'mage', spells: ['fire_bolt', 'fire_nova', 'meteor', 'fire_rain', 'flame_field', 'heat_exhaustion', 'fire_breath'], look: { shape: 'humanoid', color: '#8a2d1a', color2: '#ff7a2a', weapon: 'staff' } },
    { id: 'mage_water', name: 'Ледяная ведьма', family: 'mage', desc: 'Колдунья северных озёр. Сковывает льдом, прячется за ледяным щитом и лечит себя.', level: [4, 12], hp: 55, defense: 2, resist: { magic: 0.3 }, speed: 3, attack: { kind: 'ranged', damage: [5, 9], type: 'magic', range: 10, speed: 0.8, proj: 16, fx: 'frost', flags: ['magic'] }, aggro: 11, leash: 20, behaviour: 'kiter', group: [1, 1], biomes: { forest: 2, hills: 1 }, xp: 60, loot: 'mage', spells: ['frost_bolt', 'heal', 'ice_shield','ice_rain','ice_floor','deep_freeze','water_jet','chilling_curse'], look: { shape: 'humanoid', color: '#2a5a8a', color2: '#bfe8ff', weapon: 'staff' } },
    { id: 'mage_earth', name: 'Каменный шаман', family: 'mage', desc: 'Горный шаман в плаще из шкур. Бьёт каменными шипами, трясёт землю, кожа у него крепче брони.', level: [5, 13], hp: 80, defense: 5, resist: { physical: 0.2 }, speed: 2.8, attack: { kind: 'ranged', damage: [6, 10], type: 'physical', range: 9, speed: 0.7, proj: 14, fx: 'stone', flags: ['magic'] }, aggro: 10, leash: 18, behaviour: 'kiter', group: [1, 1], biomes: { hills: 3, forest: 1 }, xp: 65, loot: 'mage', spells: ['stone_spike', 'stone_skin', 'quake','earth_spires','living_roots','gravel_stream','stone_weight'], look: { shape: 'humanoid', color: '#6a5030', color2: '#c8a060', weapon: 'staff' } },
    { id: 'mage_air', name: 'Заклинатель бурь', family: 'mage', desc: 'Бродячий маг в развевающемся плаще. Цепные молнии, порывы ветра и мгновенные скачки.', level: [5, 13], hp: 55, defense: 1, resist: { electric: 0.5 }, speed: 3.4, attack: { kind: 'ranged', damage: [6, 10], type: 'electric', range: 10, speed: 0.9, proj: 30, fx: 'spark', flags: ['magic'] }, aggro: 11, leash: 20, behaviour: 'kiter', group: [1, 1], biomes: { hills: 2, waste: 1, desert: 1 }, xp: 65, loot: 'mage', spells: ['lightning', 'gust', 'blink','vortex_shot','hurricane','wind_spires','wind_rain','breathless'], look: { shape: 'humanoid', color: '#5a6a8a', color2: '#bfe8ff', weapon: 'staff' } },
    { id: 'mage_dark', name: 'Чернокнижник', family: 'mage', desc: 'Изгнанник, продавший душу тьме. Отравляет теневыми стрелами, насылает порчу и ужас.', level: [6, 14], hp: 65, defense: 2, resist: { poison: 0.5 }, speed: 3, attack: { kind: 'ranged', damage: [6, 11], type: 'poison', range: 10, speed: 0.8, proj: 17, fx: 'shadow', flags: ['magic'] }, aggro: 11, leash: 20, behaviour: 'kiter', group: [1, 1], biomes: { city: 1, waste: 2 }, xp: 70, loot: 'mage', spells: ['shadow_bolt', 'weaken', 'fear','shadow_vortex','shadow_whirlfield','shadow_rain','shadow_spires','shadow_stream'], look: { shape: 'humanoid', color: '#2a1a3a', color2: '#9a5aff', weapon: 'staff' } },
    {id:'mage_blood',name:'Кровавый заклинатель',family:'mage',desc:'Копья и дождь крови; похищение здоровья. Приручается и обучает кровавой магии.',level:[6,14],hp:64,defense:2,resist:{magic:0.2},speed:2.7,attack:{kind:'ranged',damage:[5,8],type:'magic',range:10,speed:0.75,proj:22,fx:'bloodSpike',flags:['magic']},aggro:9,leash:16,behaviour:'kiter',group:[1,1],biomes:{forest:1,waste:1,city:1},xp:65,loot:'mage',spells:['blood_spike','vampire_touch','blood_rain','vampiric_pact','blood_stream','blood_weakness','blood_spires'],look:{shape:'humanoid',color:'#643244',color2:'#ed8296',weapon:'staff'}},
    {id:'mage_tesla',name:'Маг грозы',family:'mage',desc:'Разряды Тесла, цепная молния и грозовое поле. Поддаётся переговорам и приручению.',level:[6,14],hp:60,defense:2,resist:{electric:0.4},speed:2.8,attack:{kind:'ranged',damage:[5,8],type:'electric',range:11,speed:0.75,proj:28,fx:'tesla',flags:['magic']},aggro:9,leash:16,behaviour:'kiter',group:[1,1],biomes:{hills:1,waste:1,city:1},xp:65,loot:'mage',spells:['tesla_bolt','chain_lightning','thunderstorm','tesla_spires','arc_stream','static_curse'],look:{shape:'humanoid',color:'#415972',color2:'#9ad1ff',weapon:'staff'}},
    { id: 'mage_light', name: 'Жрец света', family: 'mage', desc: 'Фанатик сияющего культа. Жжёт лучами солнца, лечит себя и укрывается оберегом.', level: [6, 14], hp: 70, defense: 3, resist: { energy: 0.5 }, speed: 3, attack: { kind: 'ranged', damage: [6, 10], type: 'energy', range: 11, speed: 0.8, proj: 30, fx: 'holy', flags: ['magic'] }, aggro: 11, leash: 20, behaviour: 'kiter', group: [1, 1], biomes: { desert: 2, city: 1 }, xp: 70, loot: 'mage', spells: ['sun_ray', 'holy_light', 'ward', 'light_rain', 'light_spires', 'blinding_seal', 'radiance_stream'], look: { shape: 'humanoid', color: '#e8e0c0', color2: '#ffd84a', weapon: 'staff' } },
    { id: 'ninja', name: 'Ниндзя', family: 'mage', desc: 'Воин тени в чёрном: исчезает в дымовой завесе и появляется за спиной с клинком. Владеет отдельной школой магии тени.', level: [5, 14], hp: 60, defense: 3, speed: 4.4, attack: { kind: 'melee', damage: [8, 13], type: 'physical', range: 1.3, speed: 1.4, flags: ['bleed'] }, aggro: 10, leash: 22, behaviour: 'rusher', group: [1, 3], biomes: { forest: 2, city: 2, hills: 1 }, xp: 70, loot: 'mage', spells: ['smoke', 'shadow_step', 'shadow_bolt'], look: { shape: 'humanoid', color: '#1a1a22', color2: '#3a3a4a', weapon: 'katana' } },
    { id: 'golem_stone', name: 'Каменный голем', family: 'mage', desc: 'Глыба, поднятая заклинанием «Каменный голем». Медленный и крепкий; рассыпается, когда чары выдыхаются. Сам не появляется.', level: [5, 15], hp: 160, defense: 10, resist: { poison: 1, physical: 0.2 }, speed: 2.8, attack: { kind: 'melee', damage: [10, 16], type: 'physical', range: 1.5, speed: 0.8, flags: ['stun'] }, aggro: 8, leash: 16, behaviour: 'brute', group: [1, 1], biomes: { hills: 1 }, xp: 40, loot: 'none', spawn: false, tameable: false, tags: ['construct'], look: { shape: 'humanoid', color: '#7a746a', color2: '#5a544a', weapon: 'claws', size: 1.4 } },
    { id: 'walker_patrol', name: 'Патрульный шагоход', family: 'robot', desc: 'Довоенный робот охраны складов на двух опорах. Туповат, но по тревоге сходится вся охрана.', level: [5, 12], hp: 150, defense: 14, resist: { poison: 0.8, fire: 0.2 }, speed: 2.6, attack: { kind: 'ranged', damage: [7, 11], type: 'physical', range: 12, speed: 2.5, proj: 36, fx: 'bullet' }, aggro: 11, leash: 18, behaviour: 'guard', group: [1, 2], biomes: { city: 2, waste: 0.5 }, xp: 70, loot: 'robot', tags: ['robot'], look: { shape: 'walker', color: '#6d7278', color2: '#ffd84a', size: 1.3 } },
    { id: 'droid_repair', name: 'Ремонтный дроид', family: 'robot', desc: 'Низкий колёсный автомат с манипуляторами. Часть дроидов чинит складскую технику, часть защищает мастерскую.', level: [2, 8], hp: 75, defense: 5, resist: { poison: 1, physical: 0.1 }, speed: 2.2, attack: { kind: 'melee', damage: [3, 6], type: 'physical', range: 1.1, speed: 0.8 }, aggro: 7, leash: 14, behaviour: 'guard', group: [1, 2], biomes: { floor: 1 }, xp: 32, loot: 'robot', tags: ['robot'], look: { shape: 'quadruped', color: '#65747a', color2: '#55c7d8', size: 0.8 } },
    { id: 'droid_protocol', name: 'Сервисный протокольный дроид', family: 'robot', desc: 'Высокий двуногий помощник учёных и кладовщиков. Невооружённые модели патрулируют склад и не нападают первыми.', level: [1, 6], hp: 55, defense: 3, resist: { poison: 1 }, speed: 2, attack: { kind: 'melee', damage: [2, 4], type: 'physical', range: 1, speed: 0.65 }, aggro: 0.5, leash: 10, behaviour: 'loner', group: [1, 2], biomes: { floor: 1 }, xp: 20, loot: 'robot', tags: ['robot'], look: { shape: 'humanoid', color: '#b7a36b', color2: '#477c8c', weapon: 'none', size: 0.9 } },
  ];

  // Таблицы добычи: rolls — сколько бросков [мин, макс]; empty — шанс ничего не выпасть;
  // entries: { item, w (вес), n: [мин, макс] } или { pick: { category, group }, w } — случайный предмет каталога
  // с редкостью по весам lootRarityWeights и уровнем не выше уровня врага + lootLevelSlack
  const dragonElements={fire:['fireStream','fire','burn','fire_breath'],ice:['waterJet','magic','stun','deep_freeze'],lava:['fireStream','fire','burn','flame_field'],water:['waterJet','magic','stun','tidal_wave']};
  for(const def of ENEMIES)if(dragonElements[def.id.replace('dragon_','')]){const [fx,type,flag,spell]=dragonElements[def.id.replace('dragon_','')];def.attack={...def.attack,kind:'cone',fx,type,flags:[flag,'magic']};def.spells=[spell];if(def.id==='dragon_ice'){def.attack.freezeSec=1;def.attack.rootSec=1;}}
  for(const [id,name,color,accent,type,fx,flags,spell] of [
    ['air','Воздушный','#718eac','#cdeffa','magic','windStream',['knockback'],'gust'],
    ['earth','Земляной','#746147','#c9b17e','physical','gravelStream',['stun'],'stone_rain'],
    ['electricity','Грозовой','#3d5c87','#a9ddff','electric','arcStream',['stun'],'chain_lightning'],
    ['blood','Кровавый','#713044','#ee91ac','magic','bloodStream',['bleed','lifesteal'],'blood_stream'],
    ['shadow','Теневой','#202733','#849bb5','magic','umbraStream',['armorPiercing'],'umbra_stream'],
    ['dark','Бездновый','#302541','#ba8eeb','poison','shadowStream',['poison'],'shadow_stream'],
    ['light','Светлый','#c4bba1','#fff0bd','energy','lightStream',['magic'],'radiance_stream']
  ]){const base=ENEMIES.find(d=>d.id==='dragon_fire');ENEMIES.push({...base,id:'dragon_'+id,name:name+' дракон',desc:'Европейский четырёхлапый дракон: отдельные крылья, полёт и дыхание своей стихии.',attack:{...base.attack,kind:'cone',type,fx,flags:['magic',...flags]},spells:[spell],resist:{[type]:0.65,poison:0.25},look:{...base.look,color,color2:accent},biomes:{hills:0.6,forest:0.3,waste:0.2}});}

  for(const def of ENEMIES)if(['ninja','boss_ninja'].includes(def.id))def.spells=['smoke','shadow_step','umbra_bolt','umbra_curse','umbra_rain'];
  const shadowMage=ENEMIES.find(e=>e.id==='mage_dark');
  ENEMIES.push({...shadowMage,id:'mage_shadow',name:'Маг сумрака',desc:'Мастер отдельной школы тени: скрывается, выпускает призрачные клинки и сковывает противников тенями.',spells:['umbra_bolt','umbra_curse','umbra_rain','umbra_spires','umbra_stream','umbra_field','umbra_veil'],attack:{...shadowMage.attack,type:'magic',fx:'umbraBolt',flags:['magic','armorPiercing']},look:{...shadowMage.look,color:'#202733',color2:'#849bb5'}});
  const shadowDragon=ENEMIES.find(e=>e.id==='dragon_shadow');shadowDragon.spells=['umbra_stream','umbra_veil','umbra_bolt','umbra_spires'];
  const LOOT = {
    raider: { rolls: [1, 2], empty: 0.2, entries: [
      { item: 'fuel_gas', w: 1 }, { item: 'veh_parts', w: 1 }, { item: 'scroll_veh_parts', w: 1 }, { item: 'scroll_veh_kit_motorcycle', w: 1 }, { item: 'scroll_fuel_gas', w: 1 },
      { item: 'wood', w: 2, n: [1, 3] }, { item: 'plastic', w: 2, n: [1, 2] }, { item: 'gunpowder', w: 1, n: [1, 2] }, { item: 'scroll_gunpowder', w: 1 }, { item: 'scroll_ammo_9mm', w: 1 }, { item: 'scroll_build_wall_stone', w: 1 }, { item: 'scroll_build_spikes', w: 1 }, { item: 'scroll_outer_leather', w: 1 }, { item: 'ammo_9mm', w: 8, n: [4, 14] }, { item: 'ammo_12g', w: 3, n: [2, 6] }, { item: 'ration', w: 5 }, { item: 'water_flask', w: 4 },
      { item: 'scrap_metal', w: 4, n: [1, 3] }, { item: 'cloth', w: 3, n: [1, 3] }, { item: 'medkit', w: 1 },
      { item: 'water_dirty', w: 2 }, { item: 'coffee', w: 2 }, { item: 'herbs', w: 2 }, { item: 'campfire', w: 2 }, { item: 'bedroll', w: 1 },
      { pick: { group: 'firearm' }, w: 2 }, { pick: { group: 'melee' }, w: 2 }, { pick: { category: ['clothing', 'armor'] }, w: 2 },
    ] },
    raider_rich: { rolls: [2, 3], empty: 0.1, entries: [
      { item: 'gunpowder', w: 2, n: [1, 3] }, { item: 'scroll_ammo_12g', w: 1 }, { item: 'scroll_armor_chain', w: 1 }, { item: 'scroll_sword_short', w: 1 }, { item: 'scroll_build_gate', w: 1 }, { item: 'scroll_build_forge', w: 1 }, { item: 'scroll_mine_clapper', w: 1 }, { item: 'scroll_medkit', w: 1 }, { item: 'ammo_12g', w: 5, n: [3, 10] }, { item: 'ammo_556', w: 4, n: [5, 20] }, { item: 'canned', w: 3 }, { item: 'medkit', w: 2 },
      { item: 'electronics', w: 2 }, { item: 'gold_nugget', w: 1 }, { pick: { category: 'weapon' }, w: 3 }, { pick: { category: 'armor' }, w: 2 },
      { pick: { category: 'backpack' }, w: 1 },
    ] },
    mutant: { rolls: [1, 2], empty: 0.3, entries: [
      { item: 'scroll_antirad', w: 1 }, { item: 'scroll_build_chemlab', w: 1 }, { item: 'plastic', w: 2, n: [1, 2] }, { item: 'ammo_556', w: 3, n: [3, 10] }, { item: 'ammo_9mm', w: 3, n: [3, 10] }, { item: 'canned', w: 3 }, { item: 'scrap_metal', w: 4, n: [1, 4] },
      { item: 'medkit', w: 1 }, { item: 'stim', w: 1 }, { pick: { group: 'melee' }, w: 2 }, { pick: { group: 'firearm' }, w: 1 },
      { item: 'antirad', w: 2 }, { item: 'water_dirty', w: 2 },
    ] },
    mutant_big: { rolls: [2, 3], empty: 0.1, entries: [
      { item: 'scroll_stim', w: 1 }, { item: 'scroll_armor_leather', w: 1 }, { pick: { category: 'weapon' }, w: 3 }, { pick: { category: ['armor', 'clothing'] }, w: 2 }, { item: 'gold_nugget', w: 1 }, { item: 'platinum', w: 1 },
      { item: 'medkit', w: 2 }, { item: 'canned', w: 3 }, { pick: { category: 'accessory' }, w: 1 },
    ] },
    // животные: мясо (сырое — жарить у костра) и шкуры
    animal: { rolls: [1, 2], empty: 0.05, entries: [{ item: 'meat_raw', w: 6, n: [1, 2] }, { item: 'hide', w: 3 }] },
    animal_mutant: { rolls: [1, 2], empty: 0.2, entries: [
      { item: 'meat_raw', w: 5, n: [1, 3] }, { item: 'hide', w: 3, n: [1, 2] }, { item: 'amulet_fangs', w: 1 }, { item: 'stim', w: 1 },
    ] },
    zombie: { rolls: [1, 1], empty: 0.45, entries: [
      { item: 'cloth', w: 2, n: [1, 2] }, { item: 'scroll_ration', w: 1 }, { item: 'cloth', w: 4 }, { item: 'scrap_metal', w: 3 }, { item: 'ration', w: 2 }, { item: 'canned', w: 2 }, { item: 'ammo_9mm', w: 2, n: [2, 8] },
      { pick: { category: 'clothing' }, w: 1 }, { item: 'ring_copper', w: 1 }, { item: 'antirad', w: 1 },
    ] },
    insect: { rolls: [1, 2], empty: 0.3, entries: [{ item: 'chitin', w: 6 }, { item: 'mana_tonic', w: 1 }, { item: 'water_clean', w: 1 }] },
    robot: { rolls: [2, 3], empty: 0.05, entries: [
      { item: 'scroll_ammo_cell', w: 1 }, { item: 'scroll_build_electronics', w: 1 }, { item: 'scroll_build_generator', w: 1 }, { item: 'scroll_turret_watchman', w: 1 }, { item: 'plastic', w: 2, n: [1, 3] }, { item: 'electronics', w: 6, n: [1, 3] }, { item: 'scrap_metal', w: 5, n: [2, 5] }, { item: 'ammo_cell', w: 3 }, { item: 'ammo_556', w: 3, n: [10, 30] },
      { pick: { group: 'energy' }, w: 1 }, { item: 'platinum', w: 1 }, { item: 'circuit_rare', w: 0.5 },
    ] },
    cyborg: { rolls: [1, 2], empty: 0.15, entries: [
      { item: 'electronics', w: 5, n: [1, 3] }, { item: 'ammo_cell', w: 4 }, { item: 'scrap_metal', w: 3, n: [1, 3] }, { item: 'stim', w: 2 },
      { pick: { group: 'energy' }, w: 1 }, { pick: { category: 'armor' }, w: 1 },
    ] },
    alien: { rolls: [1, 2], empty: 0.2, entries: [
      { item: 'chitin', w: 4, n: [1, 2] }, { item: 'mana_tonic', w: 2 }, { item: 'electronics', w: 2 }, { item: 'platinum', w: 1 },
      { pick: { group: 'energy' }, w: 1 },
    ] },
    // военный склад под охраной шагоходов (шаг 11): контейнер-уменьшитель и редкая электроника
    depot: { rolls: [3, 4], empty: 0, rarity: '20,35,30,12,3', entries: [
      { item: 'circuit_rare', w: 4, n: [1, 2] }, { item: 'platinum', w: 3, n: [1, 2] }, { item: 'electronics', w: 4, n: [2, 4] }, { item: 'scroll_shrinker', w: 2 },
      { item: 'ammo_556', w: 3, n: [10, 30] }, { pick: { group: 'firearm' }, w: 2 }, { pick: { category: 'armor' }, w: 2 },
    ] },
    dragon: { rolls: [3, 5], empty: 0, rarity: '10,30,35,20,5', entries: [
      { item: 'gold_nugget', w: 4, n: [2, 5] }, { item: 'platinum', w: 3, n: [1, 3] }, { item: 'circuit_rare', w: 1 }, { item: 'scroll_dragon_charm', w: 1 }, { item: 'dragon_charm', w: 0.5 }, { pick: { category: 'weapon' }, w: 2 }, { pick: { category: 'accessory' }, w: 2 },
    ] },
    // главари банд: больше предметов и выше редкость
    mage: { rolls: [1, 2], empty: 0.1, entries: [
      ...Items.ITEMS.filter((it) => it.teachesSpell).map((it) => ({ item: it.id, w: { uncommon: 1, rare: 0.35, epic: 0.08 }[it.rarity] || 0.5 })),
      { item: 'mana_tonic', w: 4 }, { item: 'herbs', w: 2 }, { item: 'gold_nugget', w: 1 }, { item: 'cloth', w: 2, n: [1, 3] },
    ] },
    none: { rolls: [1, 1], empty: 0.99, entries: [{ item: 'cloth', w: 1 }] },
    boss_gang: { rolls: [3, 4], empty: 0, rarity: '20,40,28,10,2', entries: [
      { pick: { category: 'weapon' }, w: 4 }, { pick: { category: 'armor' }, w: 3 }, { pick: { category: 'accessory' }, w: 1 }, { pick: { category: 'backpack' }, w: 1 },
      { item: 'gold_nugget', w: 2, n: [1, 3] }, { item: 'medkit', w: 2, n: [1, 2] }, { item: 'ammo_556', w: 2, n: [20, 40] },
    ] },
    // шаг 13: главари глубоких уровней, тайники подземелий, водные мутанты
    boss_deep: { rolls: [4, 6], empty: 0, rarity: '5,25,40,23,7', entries: [
      { pick: { category: 'weapon' }, w: 4 }, { pick: { category: 'armor' }, w: 3 }, { pick: { category: 'accessory' }, w: 2 }, { item: 'platinum', w: 2, n: [2, 4] }, { item: 'air_tank', w: 1, n: [1, 2] },
    ] },
    cache: { rolls: [2, 3], empty: 0, rarity: '30,35,23,10,2', entries: [
      { item: 'gold_nugget', w: 2, n: [1, 2] }, { item: 'medkit', w: 3 }, { item: 'electronics', w: 2, n: [1, 3] }, { item: 'air_tank', w: 2 }, { item: 'ammo_556', w: 2, n: [10, 30] }, { item: 'veh_parts', w: 2, n: [1, 3] }, { item: 'fuel_gas', w: 2 }, { item: 'fuel_diesel', w: 1 }, { item: 'fuel_avia', w: 1 },
      { pick: { category: 'weapon' }, w: 3 }, { pick: { category: ['clothing', 'armor'] }, w: 3 }, { pick: { category: 'accessory' }, w: 1 },
    ] },
    aquatic: { rolls: [1, 2], empty: 0.35, entries: [
      { item: 'meat_raw', w: 4, n: [1, 2] }, { item: 'chitin', w: 2 }, { item: 'air_tank', w: 1 }, { item: 'gold_nugget', w: 1 },
    ] },
    boss_super: { rolls: [5, 7], empty: 0, rarity: '0,10,40,35,15', entries: [
      { pick: { category: 'weapon' }, w: 4 }, { pick: { category: 'armor' }, w: 3 }, { pick: { category: 'accessory' }, w: 2 }, { item: 'platinum', w: 2, n: [3, 6] },
    ] },
  };

  for(const [type,name,fly]of [['uav','Разведывательный БПЛА',true],['quad','Боевой квадрокоптер',true],['tracked','Гусеничный разведчик',false],['service','Сервисный астродроид',false]]) {
    const base=ENEMIES.find(e=>e.id==='droid_repair');
    ENEMIES.push({...base,id:'drone_'+type,name,desc:'Робот-спутник: создаётся на столе техники, встречается в руинах, перепрограммируется и ремонтируется.',fly,level:[1,12],hp:100,defense:5,speed:2.8,group:[1,1],biomes:{city:0.12,waste:0.04},behaviour:'kiter',attack:{kind:'ranged',damage:[4,7],type:'energy',range:8,speed:1,proj:26,fx:'laser'},look:{shape:'drone',species:type,color:'#80939d',color2:'#57d5ee',size:0.75},tags:['robot']});
  }
  for(const type of ['uav','quad','tracked','service'])LOOT.robot.entries.push({item:'drone_kit_'+type,w:0.7});
  for(const id of ['dragon_dark','dragon_light']){const i=ENEMIES.findIndex(e=>e.id===id);if(i>=0)ENEMIES.splice(i,1);}
  const formerDark=ENEMIES.find(e=>e.id==='mage_dark');if(formerDark){formerDark.name='Заклинатель теней';formerDark.desc='Маг тени: порча, страх и призрачные потоки.';formerDark.attack={...formerDark.attack,type:'magic',fx:'umbraBolt'};}
  const formerLight=ENEMIES.find(e=>e.id==='mage_light');if(formerLight){formerLight.name='Водный целитель';formerLight.desc='Лечит и защищает водной магией, атакует разрядами.';}
  for(const id of ['wings_angel','wings_archangel','wings_hell'])LOOT.mage.entries.push({item:id,w:id==='wings_archangel'?.3:.8});
  LOOT.robot.entries.push({item:'flight_jetpack',w:.8});
  // ---------- Нормализация ----------
  const BY_ID = new Map();
  for (const e of ENEMIES) {
    e.resist = e.resist || {};
    e.fleeAt = e.fleeAt || 0;
    e.tags = e.tags || [];
    e.boss = Boolean(e.boss);
    e.fly = Boolean(e.fly);
    e.spawn = e.spawn !== false;
    e.tameable = e.tameable !== false; // false — пока нельзя приручить (драконы — позже)
    e.guards = e.guards || [];
    e.radius = e.radius || 0.35 * ((e.look && e.look.size) || 1);
    e.attack.flags = e.attack.flags || [];
    e.look.size = e.look.size || 1;
    BY_ID.set(e.id, e);
  }
  const get = (id) => BY_ID.get(id) || BY_ID.get({dragon_dark:'dragon_shadow',dragon_light:'dragon_electricity'}[id]) || null;
  const behaviourOf = (e) => e.boss ? BEHAVIOURS.brute : BEHAVIOURS[e.behaviour] || BEHAVIOURS.rusher;

  // Показатели врага на уровне level
  function statsAt(def, level, difficulty = settings.difficulty) {
    const lv = Math.max(1, Math.min(settings.maxEnemyLevel, Math.floor(Number(level) || 1))) - 1;
    const s = settings;
    const profile = Difficulty.get(difficulty);
    const dk = 1 + lv * s.enemyDamagePerLevel;
    return {
      maxHp: Math.max(1, Math.round(def.hp * (1 + lv * s.enemyHpPerLevel) * profile.hp)),
      damage: [Math.max(1, Math.round(def.attack.damage[0] * s.enemyDamageFactor * dk * profile.damage)), Math.max(1, Math.round(def.attack.damage[1] * s.enemyDamageFactor * dk * profile.damage))],
      defense: Math.max(0, Math.round((def.defense + lv * s.enemyDefensePerLevel) * profile.defense)),
      xp: Math.round(def.xp * (1 + lv * s.enemyXpPerLevel)),
    };
  }

  // ---------- Добыча ----------
  const RARITY_ORDER = Object.keys(Items.RARITIES);
  function rarityWeights(spec = settings.lootRarityWeights) {
    const w = String(spec).split(',').map(Number);
    return RARITY_ORDER.map((_, i) => (Number.isFinite(w[i]) && w[i] >= 0 ? w[i] : 0));
  }
  const inRange = (rnd, [a, b]) => a + Math.floor(rnd() * (b - a + 1));
  function weighted(list, weightOf, rnd) {
    const total = list.reduce((a, x) => a + weightOf(x), 0);
    if (total <= 0) return null;
    let r = rnd() * total;
    for (const x of list) { r -= weightOf(x); if (r < 0) return x; }
    return list[list.length - 1];
  }
  function matchesPick(it, pick) {
    if (it.fixed || it.quest || it.set) return false; // комплекты имеют отдельный бросок, независимо от обычной добычи
    const cats = pick.category ? [].concat(pick.category) : null;
    if (cats && !cats.includes(it.category)) return false;
    if (pick.group && !(it.weapon && Items.WEAPON_CLASSES[it.weapon.class].group === pick.group)) return false;
    return true;
  }
  // Случайный предмет по фильтру: редкость — по весам; если такой редкости нет, берётся ближайшая более низкая
  function pickItem(pick, level, rnd, rarity) {
    const pool = Items.ITEMS.filter((it) => matchesPick(it, pick) && it.level <= level + settings.lootLevelSlack);
    if (!pool.length) return null;
    const ws = rarityWeights(rarity);
    let ri = RARITY_ORDER.indexOf(weighted(RARITY_ORDER, (r) => ws[RARITY_ORDER.indexOf(r)], rnd) || 'common');
    for (; ri >= 0; ri--) {
      const cand = pool.filter((it) => it.rarity === RARITY_ORDER[ri]);
      if (cand.length) return cand[Math.floor(rnd() * cand.length)].id;
    }
    return pool[Math.floor(rnd() * pool.length)].id;
  }
  // Бросок добычи: [{ id, n }]. rnd — функция 0..1 (детерминированный ГПСЧ в тестах)
  function rollLoot(tableId, level, rnd = Math.random) {
    const t = LOOT[tableId];
    if (!t) return [];
    const empty = Math.max(0, Math.min(1, 1 - (1 - t.empty) * settings.lootChanceFactor));
    if (rnd() < empty) return [];
    const out = new Map();
    const rolls = inRange(rnd, t.rolls);
    for (let i = 0; i < rolls; i++) {
      const e = weighted(t.entries, (x) => x.w, rnd);
      if (!e) continue;
      const id = e.item || pickItem(e.pick, level, rnd, t.rarity);
      if (!id) continue;
      const it = Items.get(id);
      const n = it.stackable && e.n ? inRange(rnd, e.n) : 1;
      if (it.stackable && out.has(id)) out.get(id).n += n;
      else out.set(it.stackable ? id : id + '#' + i, { id, n });
    }
    return [...out.values()];
  }

  // ---------- Проверка данных (тесты и запуск сервера) ----------
  function validate() {
    const errors = [];
    const biomeKeys = WorldGen.BIOMES.map((b) => b.key);
    const walkableKeys = WorldGen.BIOMES.filter((b) => b.walkable).map((b) => b.key);
    const ids = new Set();
    const hex = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
    const pair = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(v) && v >= 0) && p[0] <= p[1];
    for (const e of ENEMIES) {
      const err = (m) => errors.push(`${e.id || '?'}: ${m}`);
      if (typeof e.id !== 'string' || !/^[a-z0-9_]+$/.test(e.id)) err('некорректный id');
      if (ids.has(e.id)) err('повторяющийся id');
      ids.add(e.id);
      if (!e.name || !e.desc || e.desc.length < 10) err('нет названия или описания');
      if (!FAMILIES[e.family] || FAMILIES[e.family].later) err('неизвестное семейство ' + e.family);
      if (!BEHAVIOURS[e.behaviour]) err('неизвестное поведение ' + e.behaviour);
      if (!pair(e.level) || e.level[0] < 1 || !Number.isInteger(e.level[0]) || !Number.isInteger(e.level[1])) err('level — [мин, макс], целые ≥ 1');
      for (const k of ['hp', 'speed', 'aggro', 'leash', 'xp', 'radius']) if (!(e[k] > 0)) err(`${k} должно быть > 0`);
      if (!(e.defense >= 0)) err('defense ≥ 0');
      if (e.leash < e.aggro) err('leash не может быть меньше aggro');
      if (!(e.fleeAt >= 0 && e.fleeAt < 1)) err('fleeAt — доля 0..1');
      if (!pair(e.group) || e.group[0] < 1) err('group — [мин, макс] ≥ 1');
      for (const [k, v] of Object.entries(e.resist)) if (!Items.DAMAGE_TYPES[k] || !(v >= 0 && v <= 1)) err('некорректное сопротивление ' + k);
      const a = e.attack;
      if (!a || !['melee', 'ranged', 'cone'].includes(a.kind)) err('attack.kind — melee или ranged');
      else {
        if (!pair(a.damage)) err('attack.damage — [мин, макс]');
        if (!Items.DAMAGE_TYPES[a.type]) err('неизвестный тип урона ' + a.type);
        if (!(a.range > 0) || !(a.speed > 0)) err('attack.range и attack.speed > 0');
        if (a.kind === 'ranged' && !(a.proj > 0)) err('дальней атаке нужна скорость снаряда proj');
        if (a.kind === 'melee' && a.range > 3) err('ближняя атака дальше 3 клеток');
      }
      const bw = Object.entries(e.biomes || {});
      if (bw.some(([k, v]) => !biomeKeys.includes(k) || !(v >= 0))) err('biomes: неизвестный биом или вес');
      if (!bw.some(([k, v]) => walkableKeys.includes(k) && v > 0)) err('нет ни одного проходимого биома появления');
      if (!LOOT[e.loot]) err('неизвестная таблица добычи ' + e.loot);
      for (const g of e.guards) { const gd = BY_ID.get(g); if (!gd || gd.boss) err('свита: неизвестный или сам босс ' + g); }
      if (e.guards.length && (!pair(e.guardCount) || e.guardCount[0] < 1)) err('guardCount — [мин, макс] ≥ 1');
      if (e.guards.length && !e.boss) err('свита бывает только у босса');
      for (const k of ['fly', 'spawn', 'boss']) if (typeof e[k] !== 'boolean') err(k + ' — да/нет');
      if (!e.look || !SHAPES.includes(e.look.shape) || !hex(e.look.color) || (e.look.color2 && !hex(e.look.color2))) err('look — форма и цвета');
    }
    for (const [id, t] of Object.entries(LOOT)) {
      const err = (m) => errors.push(`добыча ${id}: ${m}`);
      if (!pair(t.rolls) || !(t.empty >= 0 && t.empty < 1) || !t.entries.length) err('rolls, empty, entries');
      if (t.rarity && rarityWeights(t.rarity).every((w) => w === 0)) err('rarity: все веса нулевые');
      for (const x of t.entries) {
        if (!(x.w > 0)) err('вес должен быть > 0');
        if (x.item && !Items.get(x.item)) err('неизвестный предмет ' + x.item);
        if (x.item && x.n && !pair(x.n)) err('n — [мин, макс]');
        if (!x.item && !(x.pick && Items.ITEMS.some((it) => matchesPick(it, x.pick)))) err('pick не находит ни одного предмета');
      }
    }
    if (rarityWeights().every((w) => w === 0)) errors.push('lootRarityWeights: все веса нулевые');
    return errors;
  }

  // Роботы и дроны — машины: не плавают, а ходят по дну (вода для них проходима, из воды выходят на сушу).
  // Летающие дроны над водой летят; по дну ходят наземные (гусеничный, сервисный, шагоходы, дроиды).
  const isMachine = (def) => Boolean(def) && (def.family === 'robot' || (Array.isArray(def.tags) && def.tags.includes('robot')));
  const seabedWalker = (def) => isMachine(def) && !def.fly && settings.robotsWalkSeabed !== false;

  return {
    settings, configure, FAMILIES, BEHAVIOURS, SHAPES, ENEMIES, LOOT, get, behaviourOf, statsAt, rollLoot, pickItem, validate, isMachine, seabedWalker,
  };
});
