// Магия (шаг 12) — общие правила для сервера (проверка и расчёт заклинаний) и клиента (книга заклинаний, подсказки, справка).
// Восемь школ: огонь, вода, земля, воздух, тьма, свет, кровь, электричество. Заклинания заданы данными (SPELLS):
//   { id, name, school, tier (1–3), kind, target, mp, cd, cast, range, radius, deg, damage [мин, макс], type, flags, proj, fx,
//     heal, perSec, dur, absorb, defense, speed, factor, summon, req { стат: минимум }, level, desc }
// kind: bolt (снаряд), chain (цепная молния), cone (конус), aoe (область вокруг себя или в точке), heal, hot (лечение со временем),
//       shield (щит — поглощает урон), buff (защита / скорость), debuff (ослабить врага), summon (призыв), blink (скачок),
//       step (теневой шаг — за спину цели), stealth (дым), fear, charm (внушение — временный спутник), cleanse (очищение).
// target: enemy (враг), point (точка), self (себя), ally (себя или союзника рядом), around (вокруг себя).
// Выученные заклинания хранятся на герое: character.spells = [id…]; character.magicPower — сила от убитых магов.
// Сила заклинания = (1 + сродство школы × стат) × (1 + уровень героя × рост) × (1 + сила убитых магов); урон ещё растёт от «Магии» (как посохи).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Magic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const settings = {
    magicEnabled: true, magicLevelScaling: 0.04, magicAffinityPerStat: 0.04, magicPowerPerPoint: 0.03, magicPowerMax: 10,
    magicGcdSec: 0.4, magicRangeTolerance: 0.6, magicInterruptOnMove: true, magicInterruptOnDamage: true, magicMaxKnown: 128,
    magicTelepathyRange: 10, magicTelepathyMpCost: 15, magicTeachMpCost: 10, magicAskTimeoutSec: 30,
    magicStealRange: 6, magicStealBase: 0.2, magicStealPerStat: 0.05, magicStealLevelPenalty: 0.02, magicStealMpCost: 25, magicStealCooldownSec: 15,
    magicKillGrantChance: 0.5, magicKillPowerBoost: 1,
    magicChanceMin: 0.03, magicChanceMax: 0.9, magicEnemyCastFactor: 1, magicEnemyDamageFactor: 0.8,
    magicMaxSummons: 1,
  };
  function configure(game) {
    for (const k of Object.keys(settings)) if (game && game[k] !== undefined) settings[k] = game[k];
  }

  // Школы: цвет (интерфейс, эффекты), тип урона, стат сродства (чем он выше — тем сильнее заклинания школы)
  const SCHOOLS = {
    fire: { name: 'Огонь', color: '#ff7a2a', type: 'fire', stat: 'magic', desc: 'Разрушение: огненные стрелы, волны пламени, метеоры. Поджигает врагов.' },
    water: { name: 'Вода', color: '#4ab0ff', type: 'magic', stat: 'intellect', desc: 'Лёд и исцеление: сковывает врагов, лечит и защищает щитом.' },
    earth: { name: 'Земля', color: '#b08a4a', type: 'physical', stat: 'strength', desc: 'Камень и стойкость: оглушает, укрепляет кожу, призывает голема.' },
    air: { name: 'Воздух', color: '#bfe8ff', type: 'magic', stat: 'intellect', desc: 'Ветер и вихри: отбрасывание, ураганы, скачок и ускорение.' },
    dark: { name: 'Тьма', color: '#9a5aff', type: 'poison', stat: 'stealth', desc: 'Порча, страх, подчинение и отравляющие потоки бездны.' },
    shadow: {name:'Тень',color:'#788faa',type:'magic',stat:'stealth',desc:'Скрытность, теневой шаг, призрачные клинки, сковывающие тени и завесы.'},
    blood: { name:'Кровь',color:'#e65b7c',type:'magic',stat:'magic',desc:'Кровавые шипы, дождь и вампиризм: кровотечение и похищение здоровья.' },
    electricity: { name:'Электричество',color:'#91c9ff',type:'electric',stat:'intellect',desc:'Разряды Тесла, цепные молнии и продолжительная гроза.' },
    light: { name: 'Свет', color: '#ffe89a', type: 'energy', stat: 'persuasion', desc: 'Сияние: лучи света, сильное лечение, очищение и оберег. Жжёт нежить.' },
  };
  const TIERS = { 1: { name: 'Ученик', level: 1, magic: 1 }, 2: { name: 'Адепт', level: 5, magic: 3 }, 3: { name: 'Мастер', level: 10, magic: 6 } };
  const KINDS = {
    bolt: 'Снаряд', chain: 'Цепь', cone: 'Конус', aoe: 'Область', heal: 'Лечение', hot: 'Восстановление', shield: 'Щит', buff: 'Усиление',
    field:'Продолжительная зона', vampirism:'Вампиризм', debuff: 'Ослабление', summon: 'Призыв', blink: 'Скачок', step: 'Теневой шаг', stealth: 'Скрытность', fear: 'Страх', charm: 'Подчинение', cleanse: 'Очищение',
  };
  const TARGETS = { enemy: 'Враг', point: 'Точка', self: 'На себя', ally: 'Себя или союзника', around: 'Вокруг себя' };

  const S = (o) => o;
  const SPELLS = [
    // --- Огонь ---
    S({ id: 'fire_bolt', name: 'Огненная стрела', school: 'fire', tier: 1, kind: 'bolt', target: 'enemy', mp: 8, cd: 1.5, cast: 0.4, range: 11, damage: [10, 16], flags: ['burn'], proj: 18, fx: 'flame', desc: 'Сгусток пламени летит в цель и поджигает её.' }),
    S({ id: 'fire_breath', name: 'Огненное дыхание', school: 'fire', tier: 1, kind: 'cone', target: 'point', mp: 12, cd: 5, cast: 0, range: 4, deg: 50, damage: [8, 13], flags: ['burn'], fx: 'flame', desc: 'Струя огня веером перед магом.' }),
    S({ id: 'fire_nova', name: 'Огненное кольцо', school: 'fire', tier: 2, kind: 'aoe', target: 'around', mp: 20, cd: 10, cast: 0.6, range: 0, radius: 3, damage: [14, 22], flags: ['burn'], fx: 'fire', desc: 'Волна огня расходится во все стороны от мага.' }),
    S({ id: 'meteor', name: 'Метеор', school: 'fire', tier: 3, kind: 'aoe', target: 'point', mp: 40, cd: 20, cast: 1.8, range: 12, radius: 3, damage: [35, 55], flags: ['burn'], stun: 1.5, fx: 'fire', desc: 'С неба падает пылающий камень. Долго читается, но сносит толпу.' }),
    // --- Вода ---
    S({ id: 'frost_bolt', name: 'Ледяная стрела', school: 'water', tier: 1, kind: 'bolt', target: 'enemy', mp: 8, cd: 2, cast: 0.4, range: 10, damage: [8, 12], root: 1.5, proj: 16, fx: 'frost', desc: 'Осколок льда ранит и сковывает ноги цели.' }),
    S({ id: 'heal', name: 'Исцеление', school: 'water', tier: 1, kind: 'heal', target: 'ally', mp: 12, cd: 4, cast: 1, range: 8, heal: [18, 26], desc: 'Живая вода затягивает раны — свои или союзника.' }),
    S({ id: 'regen', name: 'Родник', school: 'water', tier: 2, kind: 'hot', target: 'ally', mp: 18, cd: 15, cast: 0.5, range: 8, perSec: 4, dur: 10, desc: 'Раны заживают сами собой несколько секунд.' }),
    S({ id: 'ice_shield', name: 'Ледяной щит', school: 'water', tier: 2, kind: 'shield', target: 'self', mp: 20, cd: 20, cast: 0.3, range: 0, absorb: 40, dur: 15, desc: 'Корка льда поглощает урон, пока не растает.' }),
    S({ id: 'tidal_wave', name: 'Волна', school: 'water', tier: 3, kind: 'cone', target: 'point', mp: 30, cd: 14, cast: 0.8, range: 6, deg: 70, damage: [20, 30], flags: ['knockback'], root: 2, fx: 'frost', desc: 'Стена воды сбивает врагов и сковывает их льдом.' }),
    // --- Земля ---
    S({ id: 'stone_spike', name: 'Каменный шип', school: 'earth', tier: 1, kind: 'bolt', target: 'enemy', mp: 9, cd: 2, cast: 0.5, range: 9, damage: [12, 18], flags: ['stun'], proj: 14, fx: 'stone', desc: 'Острый камень бьёт так, что цель может оглохнуть.' }),
    S({ id: 'stone_skin', name: 'Каменная кожа', school: 'earth', tier: 1, kind: 'buff', target: 'self', mp: 15, cd: 30, cast: 0.5, range: 0, defense: 6, dur: 30, desc: 'Кожа твердеет: защита выше на полминуты.' }),
    S({ id: 'quake', name: 'Землетрясение', school: 'earth', tier: 2, kind: 'aoe', target: 'around', mp: 25, cd: 14, cast: 0.8, range: 0, radius: 4, damage: [16, 24], stun: 1, fx: 'stone', desc: 'Земля вздрагивает вокруг мага и валит врагов с ног.' }),
    S({ id: 'summon_golem', name: 'Каменный голем', school: 'earth', tier: 3, kind: 'summon', target: 'self', mp: 45, cd: 90, cast: 2, range: 0, summon: 'golem_stone', dur: 90, desc: 'Поднимает из земли голема — он сражается за мага и рассыпается через полторы минуты.' }),
    // --- Воздух ---
    S({ id: 'lightning', name: 'Молния', school: 'air', tier: 1, kind: 'chain', target: 'enemy', mp: 10, cd: 3, cast: 0.3, range: 9, damage: [10, 15], flags: ['chain'], desc: 'Разряд бьёт цель и перескакивает на соседей.' }),
    S({ id: 'gust', name: 'Порыв ветра', school: 'air', tier: 1, kind: 'cone', target: 'point', mp: 8, cd: 5, cast: 0, range: 4, deg: 70, damage: [4, 7], flags: ['knockback'], fx: 'wind', desc: 'Ветер отбрасывает всех перед магом.' }),
    S({ id: 'blink', name: 'Скачок', school: 'air', tier: 2, kind: 'blink', target: 'point', mp: 15, cd: 8, cast: 0, range: 7, desc: 'Мгновенно переносит мага в видимую точку (не в воду и не в горы).' }),
    S({ id: 'haste', name: 'Попутный ветер', school: 'air', tier: 2, kind: 'buff', target: 'self', mp: 18, cd: 25, cast: 0.3, range: 0, speed: 1.35, dur: 12, desc: 'Ветер в спину — бег быстрее на несколько секунд.' }),
    S({ id: 'storm', name: 'Буря', school: 'air', tier: 3, kind: 'aoe', target: 'point', mp: 40, cd: 20, cast: 1.5, range: 12, radius: 3.5, damage: [28, 42], stun: 1, fx: 'spark', desc: 'Удар десятка молний по площади.' }),
    // --- Тьма ---
    S({ id: 'shadow_bolt', name: 'Теневая стрела', school: 'dark', tier: 1, kind: 'bolt', target: 'enemy', mp: 8, cd: 1.8, cast: 0.4, range: 11, damage: [10, 15], flags: ['poison'], proj: 17, fx: 'shadow', desc: 'Сгусток тьмы отравляет цель.' }),
    S({ id: 'smoke', name: 'Дымовая завеса', school: 'dark', tier: 1, kind: 'stealth', target: 'self', mp: 15, cd: 25, cast: 0, range: 0, radius: 8, dur: 6, req: { stealth: 1 }, desc: 'Облако дыма: враги рядом теряют мага из виду, и он невидим для них несколько секунд (атака снимает скрытность). Излюбленный приём ниндзя.' }),
    S({ id: 'weaken', name: 'Порча', school: 'dark', tier: 1, kind: 'debuff', target: 'enemy', mp: 10, cd: 10, cast: 0.5, range: 9, factor: 0.7, dur: 10, desc: 'Враг бьёт слабее (урон × 0,7).' }),
    S({ id: 'shadow_step', name: 'Теневой шаг', school: 'dark', tier: 2, kind: 'step', target: 'enemy', mp: 14, cd: 10, cast: 0, range: 8, req: { stealth: 2 }, desc: 'Маг исчезает в тени и появляется за спиной цели.' }),
    S({ id: 'fear', name: 'Ужас', school: 'dark', tier: 2, kind: 'fear', target: 'around', mp: 20, cd: 18, cast: 0.5, range: 0, radius: 4, dur: 4, desc: 'Враги рядом в панике бегут прочь (боссы не поддаются).' }),
    S({ id: 'charm', name: 'Подчинение', school: 'dark', tier: 3, kind: 'charm', target: 'enemy', mp: 35, cd: 45, cast: 1.5, range: 5, dur: 60, req: { suggestion: 2 }, desc: 'Как внушение спутников: враг временно служит магу (занимает место спутника). Шанс — от «Магии» и «Внушения».' }),
    // --- Свет ---
    S({ id: 'sun_ray', name: 'Луч солнца', school: 'light', tier: 1, kind: 'bolt', target: 'enemy', mp: 9, cd: 2, cast: 0.3, range: 12, damage: [11, 16], proj: 30, fx: 'holy', undead: 1.5, desc: 'Быстрый луч света. Нежить горит сильнее.' }),
    S({ id: 'purify', name: 'Очищение', school: 'light', tier: 1, kind: 'cleanse', target: 'ally', mp: 8, cd: 6, cast: 0.3, range: 8, desc: 'Снимает яд, горение, кровотечение, оглушение и оковы.' }),
    S({ id: 'holy_light', name: 'Святой свет', school: 'light', tier: 2, kind: 'heal', target: 'ally', mp: 22, cd: 8, cast: 1.2, range: 8, heal: [30, 45], cleanse: true, desc: 'Сильное лечение с очищением.' }),
    S({ id: 'ward', name: 'Оберег', school: 'light', tier: 2, kind: 'shield', target: 'ally', mp: 18, cd: 18, cast: 0.5, range: 8, absorb: 30, dur: 15, desc: 'Светлый щит на себя или союзника.' }),
    S({ id: 'judgement', name: 'Кара', school: 'light', tier: 3, kind: 'aoe', target: 'point', mp: 40, cd: 20, cast: 1.5, range: 12, radius: 3, damage: [30, 45], stun: 1, fx: 'holy', undead: 1.5, desc: 'Столп света с неба. Нежить горит сильнее.' }),
  ];
  SPELLS.push(
    S({id:'icicle_shot',name:'Ледяное копьё',school:'water',tier:1,kind:'bolt',target:'enemy',mp:10,cd:2,cast:0.4,range:13,damage:[12,18],proj:24,fx:'icicle',root:0.7,desc:'Длинный ледяной шип летит в цель и ненадолго сковывает ноги.'}),
    S({id:'fire_rain',name:'Огненный дождь',school:'fire',tier:2,kind:'field',target:'point',mp:28,cd:14,cast:0.8,range:12,radius:3,damage:[5,9],dur:6,pulse:1,fx:'fireRain',flags:['burn'],desc:'Пылающие сгустки падают на область и поджигают противников.'}),
    S({id:'flame_field',name:'Море пламени',school:'fire',tier:2,kind:'field',target:'point',mp:26,cd:13,cast:0.6,range:10,radius:3,damage:[4,7],dur:7,pulse:1,fx:'flameField',flags:['burn'],desc:'Земля покрывается языками огня; вошедшие противники получают урон и загораются.'}),
    S({id:'fire_tornado',name:'Огненный смерч',school:'fire',tier:3,kind:'field',target:'point',mp:38,cd:19,cast:1,range:12,radius:3.5,damage:[6,10],dur:7,pulse:1,fx:'fireTornado',flags:['burn'],desc:'Вращающийся столб пламени обжигает область вокруг себя.'}),
    S({id:'ice_rain',name:'Ледяной дождь',school:'water',tier:2,kind:'field',target:'point',mp:28,cd:14,cast:0.8,range:12,radius:3,damage:[5,9],dur:6,pulse:1,fx:'iceRain',root:0.3,desc:'Шесть секунд ледяные шипы падают с неба и ранят всех противников в области раз в секунду.'}),
    S({id:'ice_spires',name:'Ледяные пики',school:'water',tier:2,kind:'aoe',target:'point',mp:24,cd:10,cast:0.7,range:11,radius:2.5,damage:[18,27],fx:'iceSpikes',root:1.5,desc:'Из пола вырастают ледяные пики: урон по площади и оковы.'}),
    S({id:'deep_freeze',name:'Глубокая заморозка',school:'water',tier:3,kind:'bolt',target:'enemy',mp:30,cd:14,cast:0.9,range:10,damage:[16,24],proj:22,fx:'icicle',freeze:3,root:3,stun:3,desc:'Замораживает цель в ледяной оболочке: три секунды нельзя идти, атаковать и колдовать. Боссы замерзают на более короткое время.'}),
    S({id:'ice_floor',name:'Скользкий лёд',school:'water',tier:2,kind:'field',target:'point',mp:20,cd:15,cast:0.5,range:11,radius:3.5,dur:9,pulse:1,fx:'iceFloor',slippery:true,desc:'Девять секунд пол покрыт льдом. Все наземные персонажи скользят при торможении и смене направления; урона нет.'}),
    S({id:'earth_spires',name:'Каменные шипы',school:'earth',tier:2,kind:'aoe',target:'point',mp:26,cd:11,cast:0.8,range:11,radius:3,damage:[21,31],stun:0.8,fx:'earthSpikes',desc:'Острые каменные пики вырываются из земли и сбивают противников с ног.'}),
    S({id:'living_roots',name:'Живые корни',school:'earth',tier:2,kind:'field',target:'point',mp:23,cd:15,cast:0.7,range:10,radius:3,damage:[2,4],dur:6,pulse:1,root:1.2,fx:'roots',desc:'Корни удерживают противников в области и слегка ранят. После ухода из зоны оковы быстро спадают.'}),
    S({id:'stone_rain',name:'Камнепад',school:'earth',tier:3,kind:'field',target:'point',mp:36,cd:19,cast:1,range:12,radius:3.5,damage:[7,12],dur:6,pulse:1,fx:'stoneRain',desc:'Шесть волн тяжёлых камней обрушиваются на выбранную область.'}),
    S({id:'boulder_shot',name:'Валун',school:'earth',tier:1,kind:'bolt',target:'enemy',mp:12,cd:3,cast:0.6,range:12,damage:[16,24],proj:14,fx:'boulder',flags:['knockback'],desc:'Большой вращающийся валун отбрасывает цель.'}),
    S({id:'vortex_shot',name:'Вихревой снаряд',school:'air',tier:1,kind:'bolt',target:'enemy',mp:11,cd:2.5,cast:0.3,range:13,damage:[12,18],proj:16,fx:'vortex',flags:['knockback'],desc:'Небольшой вращающийся смерч летит в противника и отбрасывает его.'}),
    S({id:'hurricane',name:'Ураган',school:'air',tier:3,kind:'field',target:'point',mp:38,cd:20,cast:1,range:12,radius:3.5,damage:[6,10],dur:7,pulse:1,fx:'hurricane',desc:'Высокий смерч семь секунд наносит урон всем противникам внутри.'}),
    S({id:'vortex_field',name:'Поле вихрей',school:'air',tier:2,kind:'field',target:'point',mp:27,cd:15,cast:0.7,range:11,radius:3,damage:[4,7],dur:7,pulse:1,fx:'vortexField',desc:'Несколько малых смерчей кружат над областью и наносят периодический урон.'}),
    S({id:'shadow_vortex',name:'Вихрь тьмы',school:'dark',tier:1,kind:'bolt',target:'enemy',mp:12,cd:2.5,cast:0.4,range:12,damage:[12,19],proj:16,fx:'shadowVortex',flags:['poison'],desc:'Тёмный вращающийся сгусток поражает и отравляет цель.'}),
    S({id:'shadow_whirlfield',name:'Поле тёмных вихрей',school:'dark',tier:3,kind:'field',target:'point',mp:36,cd:18,cast:1,range:12,radius:3.5,damage:[5,8],dur:7,pulse:1,fx:'shadowField',flags:['poison'],desc:'Область наполняют тёмные смерчи. Каждый вошедший противник получает урон и отравление.'}),
    S({id:'shadow_maelstrom',name:'Чёрный ураган',school:'dark',tier:2,kind:'aoe',target:'around',mp:26,cd:12,cast:0.6,range:0,radius:3,damage:[20,29],fx:'shadowField',desc:'Волна вращающейся тьмы поражает всех противников вокруг мага.'}),
    S({id:'blood_spike',name:'Кровавое копьё',school:'blood',tier:1,kind:'bolt',target:'enemy',mp:12,cd:2.5,cast:0.4,range:12,damage:[12,18],proj:22,fx:'bloodSpike',flags:['bleed','lifesteal'],lifesteal:0.2,desc:'Копьё из крови вызывает кровотечение и возвращает магу 20% нанесённого урона.'}),
    S({id:'blood_spires',name:'Кровавые шипы',school:'blood',tier:2,kind:'aoe',target:'point',mp:27,cd:12,cast:0.7,range:11,radius:3,damage:[18,27],fx:'bloodSpikes',flags:['bleed'],desc:'Пики из свернувшейся крови вырастают на площади и оставляют кровоточащие раны.'}),
    S({id:'blood_rain',name:'Кровавый дождь',school:'blood',tier:3,kind:'field',target:'point',mp:38,cd:20,cast:1,range:12,radius:3.5,damage:[5,8],dur:7,pulse:1,fx:'bloodRain',flags:['bleed','lifesteal'],lifesteal:0.15,desc:'Семь волн кровавых капель и шипов; кровотечение, 15% урона исцеляет заклинателя.'}),
    S({id:'vampire_touch',name:'Похищение жизни',school:'blood',tier:1,kind:'chain',target:'enemy',mp:16,cd:5,cast:0.5,range:9,damage:[15,23],fx:'bloodDrain',flags:['lifesteal'],lifesteal:0.5,desc:'Кровавый поток вытягивает здоровье: маг получает 50% фактически нанесённого урона.'}),
    S({id:'vampiric_pact',name:'Вампирский обет',school:'blood',tier:2,kind:'vampirism',target:'self',mp:24,cd:25,cast:0.5,range:0,dur:12,lifesteal:0.2,desc:'Двенадцать секунд 20% прямого урона оружием и магией возвращается здоровьем.'}),
    S({id:'tesla_bolt',name:'Разряд Тесла',school:'electricity',tier:1,kind:'bolt',target:'enemy',mp:11,cd:2,cast:0.3,range:14,damage:[12,18],proj:34,fx:'tesla',stun:0.35,desc:'Быстрый электрический снаряд с разрядами ненадолго оглушает цель.'}),
    S({id:'chain_lightning',name:'Цепная молния',school:'electricity',tier:2,kind:'chain',target:'enemy',mp:24,cd:8,cast:0.6,range:12,damage:[17,25],fx:'lightning',flags:['chain'],desc:'Молния перескакивает между соседними противниками.'}),
    S({id:'thunderstorm',name:'Гроза',school:'electricity',tier:3,kind:'field',target:'point',mp:40,cd:22,cast:1.2,range:13,radius:4,damage:[7,11],dur:7,pulse:1,fx:'thunderstorm',stun:0.2,desc:'Грозовая туча семь секунд бьёт молниями по площади.'}),
    S({id:'lightning_strike',name:'Удар молнии',school:'electricity',tier:2,kind:'aoe',target:'point',mp:25,cd:9,cast:0.6,range:13,radius:2,damage:[23,34],fx:'lightningStrike',stun:0.8,desc:'Молния падает с неба, поражает область и ненадолго оглушает.'})
  );
  // Every school offers a projectile, a sky area, a ground area, a curse and a stream.
  SPELLS.push(
    S({id:'heat_exhaustion',name:'Жар истощения',school:'fire',tier:1,kind:'debuff',target:'enemy',mp:12,cd:10,cast:0.4,range:10,factor:0.72,dur:8,fx:'fireCurse',desc:'Пылающая печать ослабляет урон цели на 28%.'}),
    S({id:'chilling_curse',name:'Леденящая слабость',school:'water',tier:1,kind:'debuff',target:'enemy',mp:12,cd:10,cast:0.4,range:10,factor:0.72,dur:8,fx:'iceCurse',desc:'Холодная печать ослабляет урон цели на 28%.'}),
    S({id:'water_jet',name:'Водяная струя',school:'water',tier:1,kind:'cone',target:'point',mp:7,cd:1.4,cast:0,range:5,deg:35,damage:[6,10],root:0.25,fx:'waterJet',desc:'Узкая направленная струя воды бьёт всех противников перед магом.'}),
    S({id:'stone_weight',name:'Каменная тяжесть',school:'earth',tier:1,kind:'debuff',target:'enemy',mp:12,cd:10,cast:0.5,range:10,factor:0.7,dur:8,fx:'earthCurse',desc:'Каменные оковы ослабляют урон цели на 30%.'}),
    S({id:'gravel_stream',name:'Поток щебня',school:'earth',tier:1,kind:'cone',target:'point',mp:8,cd:1.6,cast:0,range:5,deg:40,damage:[7,11],fx:'gravelStream',desc:'Направленный поток острых камней ранит противников перед магом.'}),
    S({id:'wind_rain',name:'Небесные лезвия',school:'air',tier:2,kind:'field',target:'point',mp:27,cd:14,cast:0.7,range:12,radius:3,damage:[5,8],dur:6,pulse:1,fx:'windRain',desc:'Воздушные лезвия падают с неба по площади.'}),
    S({id:'wind_spires',name:'Восходящие потоки',school:'air',tier:2,kind:'aoe',target:'point',mp:23,cd:10,cast:0.6,range:11,radius:3,damage:[17,25],stun:0.5,fx:'windSpikes',desc:'Из земли вырываются столбы воздуха и оглушают противников.'}),
    S({id:'breathless',name:'Безветрие',school:'air',tier:1,kind:'debuff',target:'enemy',mp:12,cd:10,cast:0.4,range:10,factor:0.72,dur:8,fx:'airCurse',desc:'Кольца тяжёлого воздуха ослабляют урон цели на 28%.'}),
    S({id:'shadow_rain',name:'Дождь теней',school:'dark',tier:2,kind:'field',target:'point',mp:29,cd:15,cast:0.8,range:12,radius:3,damage:[5,8],dur:6,pulse:1,fx:'shadowRain',flags:['poison'],desc:'Тёмные осколки падают с неба и отравляют врагов.'}),
    S({id:'shadow_spires',name:'Шипы бездны',school:'dark',tier:2,kind:'aoe',target:'point',mp:25,cd:11,cast:0.6,range:11,radius:3,damage:[17,25],root:0.8,fx:'shadowSpikes',desc:'Теневые пики вырастают из земли и удерживают цели.'}),
    S({id:'shadow_stream',name:'Дыхание бездны',school:'dark',tier:1,kind:'cone',target:'point',mp:8,cd:1.6,cast:0,range:5,deg:40,damage:[6,10],flags:['poison'],fx:'shadowStream',desc:'Направленный поток тьмы отравляет противников перед магом.'}),
    S({id:'blood_weakness',name:'Малокровие',school:'blood',tier:1,kind:'debuff',target:'enemy',mp:13,cd:10,cast:0.4,range:10,factor:0.7,dur:8,fx:'bloodCurse',desc:'Кровавая печать ослабляет урон цели на 30%.'}),
    S({id:'blood_stream',name:'Кровавый поток',school:'blood',tier:1,kind:'cone',target:'point',mp:9,cd:1.7,cast:0,range:5,deg:40,damage:[7,11],flags:['bleed','lifesteal'],lifesteal:0.12,fx:'bloodStream',desc:'Струя крови вызывает кровотечение и возвращает 12% нанесённого урона.'}),
    S({id:'tesla_spires',name:'Грозовые иглы',school:'electricity',tier:2,kind:'aoe',target:'point',mp:25,cd:11,cast:0.7,range:12,radius:3,damage:[18,26],stun:0.5,fx:'teslaSpikes',desc:'Из земли вырастают электрические иглы, соединённые дугами.'}),
    S({id:'static_curse',name:'Статический разлад',school:'electricity',tier:1,kind:'debuff',target:'enemy',mp:13,cd:10,cast:0.4,range:11,factor:0.72,dur:8,fx:'teslaCurse',desc:'Электрическая печать ослабляет урон цели на 28%.'}),
    S({id:'arc_stream',name:'Дуговой поток',school:'electricity',tier:1,kind:'cone',target:'point',mp:9,cd:1.7,cast:0,range:5,deg:40,damage:[7,11],fx:'arcStream',desc:'Веер электрических дуг бьёт всех противников перед магом.'}),
    S({id:'light_spires',name:'Кристаллы рассвета',school:'light',tier:2,kind:'aoe',target:'point',mp:25,cd:11,cast:0.7,range:12,radius:3,damage:[18,26],fx:'lightSpikes',undead:1.5,desc:'Сияющие кристаллы вырастают из земли; нежить получает больше урона.'}),
    S({id:'light_rain',name:'Звёздный дождь',school:'light',tier:2,kind:'field',target:'point',mp:29,cd:15,cast:0.8,range:12,radius:3,damage:[5,8],dur:6,pulse:1,fx:'lightRain',undead:1.5,desc:'Светящиеся звёзды падают с неба и поражают область.'}),
    S({id:'blinding_seal',name:'Слепящая печать',school:'light',tier:1,kind:'debuff',target:'enemy',mp:12,cd:10,cast:0.4,range:11,factor:0.72,dur:8,fx:'lightCurse',desc:'Ослепляющая печать ослабляет урон цели на 28%.'}),
    S({id:'radiance_stream',name:'Поток сияния',school:'light',tier:1,kind:'cone',target:'point',mp:8,cd:1.6,cast:0,range:5,deg:40,damage:[7,11],fx:'lightStream',undead:1.5,desc:'Световой веер поражает противников перед магом и сильнее жжёт нежить.'})
  );
  for(const sp of SPELLS)if(['smoke','shadow_step'].includes(sp.id))sp.school='shadow';
  SPELLS.push(
    S({id:'umbra_bolt',name:'Призрачный клинок',school:'shadow',tier:1,kind:'bolt',target:'enemy',mp:9,cd:2,cast:.3,range:11,damage:[10,16],proj:22,fx:'umbraBolt',flags:['armorPiercing'],desc:'Клинок из тени частично обходит броню.'}),
    S({id:'umbra_rain',name:'Дождь призрачных клинков',school:'shadow',tier:2,kind:'field',target:'point',mp:29,cd:15,cast:.8,range:12,radius:3,damage:[5,8],dur:6,pulse:1,fx:'umbraRain',desc:'Призрачные лезвия падают сверху на область.'}),
    S({id:'umbra_spires',name:'Сковывающие тени',school:'shadow',tier:2,kind:'aoe',target:'point',mp:25,cd:11,cast:.6,range:11,radius:3,damage:[16,24],root:1.2,fx:'umbraSpikes',desc:'Теневые пики поднимаются из земли и удерживают противников.'}),
    S({id:'umbra_curse',name:'Печать сумрака',school:'shadow',tier:1,kind:'debuff',target:'enemy',mp:12,cd:10,cast:.4,range:10,factor:.7,dur:8,fx:'umbraCurse',desc:'Печать тени снижает урон цели на 30%.'}),
    S({id:'umbra_stream',name:'Дыхание сумрака',school:'shadow',tier:1,kind:'cone',target:'point',mp:8,cd:1.6,cast:0,range:5,deg:40,damage:[7,11],fx:'umbraStream',desc:'Веер живых теней поражает противников перед магом.'}),
    S({id:'umbra_field',name:'Море теней',school:'shadow',tier:3,kind:'field',target:'point',mp:34,cd:18,cast:1,range:12,radius:3.5,damage:[5,8],dur:7,pulse:1,root:.3,fx:'umbraField',desc:'Вращающиеся тени наносят урон и кратко удерживают врагов.'}),
    S({id:'umbra_veil',name:'Покров тени',school:'shadow',tier:2,kind:'stealth',target:'self',mp:22,cd:30,cast:0,range:0,radius:5,dur:9,fx:'umbraVeil',desc:'Стирает силуэт мага из зрения врагов; атака снимает скрытность.'})
  );
  // Семь школ; прежние идентификаторы заклинаний сохраняются в старых сохранениях.
  for(const sp of SPELLS) {
    if(sp.school==='dark'){sp.school='shadow';sp.name=sp.name.replace(/тьмы/g,'теней').replace(/бездны/g,'сумрака').replace(/тёмных/g,'теневых');}
    if(sp.school==='light'){
      sp.school=['heal','hot','cleanse','shield'].includes(sp.kind)?'water':'electricity';
      const updates={sun_ray:['Луч разряда','lightning'],holy_light:['Целебная вода','waterHeal'],ward:['Водный оберег','iceShield'],judgement:['Небесный разряд','lightningStrike'],light_spires:['Кристаллы разряда','teslaSpikes'],light_rain:['Дождь искр','thunderstorm'],blinding_seal:['Ослепляющий разряд','lightCurse'],radiance_stream:['Поток разрядов','arcStream']};
      if(updates[sp.id]){sp.name=updates[sp.id][0];sp.fx=updates[sp.id][1];}
    }
  }
  for(const sp of SPELLS)if(['lightning','storm'].includes(sp.id))sp.school='electricity';
  delete SCHOOLS.dark;delete SCHOOLS.light;
  const schoolOrder=['blood','water','fire','earth','air','shadow','electricity'];
  const orderedSchools=Object.fromEntries(schoolOrder.map(id=>[id,SCHOOLS[id]]));
  for(const id of Object.keys(SCHOOLS))delete SCHOOLS[id];Object.assign(SCHOOLS,orderedSchools);
  const skySpells=new Set(['meteor','fire_rain','ice_rain','stone_rain','wind_rain','storm','shadow_rain','blood_rain','thunderstorm','lightning_strike','judgement','light_rain','umbra_rain']);
  const groundSpells=new Set(['fire_nova','flame_field','ice_spires','quake','earth_spires','living_roots','wind_spires','shadow_spires','blood_spires','tesla_spires','light_spires','umbra_spires']);
  for(const sp of SPELLS)sp.delivery=skySpells.has(sp.id)?'sky':groundSpells.has(sp.id)?'ground':sp.kind==='debuff'?'debuff':sp.kind==='cone'?'stream':['bolt','chain'].includes(sp.kind)?'direct':'support';
  const refreshedEffects={fire_bolt:'fireArrow',fire_breath:'fireStream',fire_nova:'fireNova',meteor:'meteorFall',frost_bolt:'icicle',tidal_wave:'waterJet',stone_spike:'boulder',quake:'quake',lightning:'lightning',gust:'windStream',storm:'lightningStrike',shadow_bolt:'shadowVortex',weaken:'shadowCurse',sun_ray:'sunRay',judgement:'judgement',heal:'waterHeal',regen:'waterRegen',ice_shield:'iceShield',stone_skin:'stoneSkin',haste:'windHaste',holy_light:'holyHeal',ward:'lightWard',purify:'purify',summon_golem:'golemSummon',blink:'windBlink',shadow_step:'shadowStep',smoke:'shadowSmoke',fear:'shadowFear',charm:'shadowCharm'};
  for(const sp of SPELLS)if(refreshedEffects[sp.id]&&!['sun_ray','holy_light','ward','judgement'].includes(sp.id))sp.fx=refreshedEffects[sp.id];
  for (const s of SPELLS) {
    s.type = s.type || SCHOOLS[s.school].type;
    s.flags = s.flags || [];
    s.req = Object.assign({ magic: TIERS[s.tier].magic }, s.req || {});
    s.level = s.level || TIERS[s.tier].level;
    s.fx = s.fx || s.school;
  }
  const byId = new Map(SPELLS.map((s) => [s.id, s]));
  const get = (id) => byId.get(id) || null;
  const bySchool = (school) => SPELLS.filter((s) => s.school === school);
  const itemId = (id) => 'spell_' + id; // свиток (1-й круг) или книга (2–3-й)
  const HOTBAR_RE = /^spell:[a-z_]+$/;
  const hotbarKey = (id) => 'spell:' + id;
  const fromHotbar = (v) => (typeof v === 'string' && HOTBAR_RE.test(v) ? v.slice(6) : null);

  const statOf = (ch, k) => (ch && ch.stats && Number(ch.stats[k])) || 0;
  const known = (ch) => (ch && Array.isArray(ch.spells) ? ch.spells.filter((id) => byId.has(id)) : []);
  const knows = (ch, id) => known(ch).includes(id);
  // Причина, почему нельзя выучить (или null)
  function canLearn(ch, id) {
    const s = get(id);
    if (!s) return 'Неизвестное заклинание.';
    if (knows(ch, id)) return `Заклинание «${s.name}» уже изучено.`;
    if (known(ch).length >= settings.magicMaxKnown) return 'Больше заклинаний не запомнить.';
    return reqError(ch, s);
  }
  const STAT_NAMES = { magic: 'Магия', intellect: 'Интеллект', strength: 'Сила', stealth: 'Скрытность', persuasion: 'Убеждение', suggestion: 'Внушение' };
  function reqError(ch, s) {
    for (const [k, v] of Object.entries(s.req || {})) if (statOf(ch, k) < v) return `Нужно: ${STAT_NAMES[k] || k} ${v} («${s.name}»).`;
    if ((ch && ch.level || 1) < s.level) return `Нужен уровень ${s.level} («${s.name}»).`;
    return null;
  }
  function learn(ch, id) {
    const err = canLearn(ch, id);
    if (err) return err;
    ch.spells = [...known(ch), id];
    return null;
  }
  function forget(ch, id) {
    const had = knows(ch, id);
    ch.spells = known(ch).filter((x) => x !== id);
    if (ch.inventory && Array.isArray(ch.inventory.hotbar)) ch.inventory.hotbar = ch.inventory.hotbar.map((v) => (v === hotbarKey(id) ? null : v));
    return had;
  }
  // Сродство школы: множитель от стата школы
  const affinity = (ch, school) => 1 + settings.magicAffinityPerStat * statOf(ch, SCHOOLS[school].stat);
  // Сила заклинания героя (множитель к урону, лечению, щиту)
  function power(ch, spell) {
    const s = typeof spell === 'string' ? get(spell) : spell;
    const lvl = Math.max(1, (ch && ch.level) || 1);
    const boost = Math.min(settings.magicPowerMax, Math.max(0, Number(ch && ch.magicPower) || 0));
    return affinity(ch, s.school) * (1 + settings.magicLevelScaling * (lvl - 1)) * (1 + settings.magicPowerPerPoint * boost);
  }
  // Сила заклинания врага-мага (по уровню)
  const enemyPower = (level) => (1 + settings.magicLevelScaling * (Math.max(1, level) - 1)) * settings.magicEnemyDamageFactor;
  const scaled = (range, k) => [Math.round(range[0] * k * 10) / 10, Math.round(range[1] * k * 10) / 10];
  const clamp = (x) => Math.min(settings.magicChanceMax, Math.max(settings.magicChanceMin, x));
  // Шанс украсть (скопировать) заклинание у живого мага: «Магия» и «Интеллект» против уровня врага
  function stealChance(ch, enemyLevel) {
    const st = statOf(ch, 'magic') + statOf(ch, 'intellect') / 2;
    const diff = Math.max(0, (enemyLevel || 1) - ((ch && ch.level) || 1));
    return clamp(settings.magicStealBase + settings.magicStealPerStat * st - settings.magicStealLevelPenalty * diff);
  }
  // Шанс подчинения (заклинание «Подчинение»): «Магия» + «Внушение»
  function charmChance(ch, enemyLevel, hpFrac = 1) {
    const st = statOf(ch, 'magic') + statOf(ch, 'suggestion');
    const diff = Math.max(0, (enemyLevel || 1) - ((ch && ch.level) || 1));
    return clamp(0.25 + 0.04 * st - 0.03 * diff + 0.3 * (1 - hpFrac));
  }
  // Краткое описание заклинания для подсказки (строки)
  function describe(s, ch) {
    const k = ch ? power(ch, s) : 1;
    const out = [`${SCHOOLS[s.school].name}, ${TIERS[s.tier].name.toLowerCase()} · ${KINDS[s.kind]} · ${TARGETS[s.target]}`,
      `Мана ${s.mp} · откат ${s.cd} с · чтение ${s.cast ? s.cast + ' с' : 'мгновенно'}${s.range ? ` · дальность ${s.range}` : ''}${s.radius ? ` · радиус ${s.radius}` : ''}`];
    out.push({sky:'Атака сверху по площади',ground:'Атака из земли по площади',debuff:'Ослабление цели',stream:'Направленный поток',direct:'Прямая атака',support:'Поддержка и усиление'}[s.delivery]);
    if (s.damage) out.push(`Урон ${scaled(s.damage, k).join('–')} (${s.type})${s.flags.length ? ' · ' + s.flags.join(', ') : ''}${s.root ? ` · оковы ${s.root} с` : ''}${s.stun ? ` · оглушение ${s.stun} с` : ''}`);
    if (s.heal) out.push(`Лечение ${scaled(s.heal, k).join('–')}`);
    if (s.perSec) out.push(`+${Math.round(s.perSec * k * 10) / 10} здоровья/с, ${s.dur} с`);
    if (s.absorb) out.push(`Щит ${Math.round(s.absorb * k)} на ${s.dur} с`);
    if (s.defense) out.push(`Защита +${Math.round(s.defense * k)} на ${s.dur} с`);
    if (s.speed) out.push(`Скорость × ${s.speed} на ${s.dur} с`);
    if (s.factor) out.push(`Урон врага × ${s.factor} на ${s.dur} с`);
    if(s.kind==='field') out.push(`Зона ${s.dur} с · импульс ${s.pulse || 1} с${s.slippery?' · скользкая поверхность':''}`);
    if(s.freeze) out.push(`Заморозка ${s.freeze} с`);
    if(s.lifesteal) out.push(`Вампиризм ${Math.round(s.lifesteal*100)}%${s.dur?' · '+s.dur+' с':''}`);
    if (s.kind === 'stealth' || s.kind === 'fear' || s.kind === 'charm' || s.kind === 'summon') out.push(`Длительность ${s.dur} с`);
    out.push('Требования: ' + Object.entries(s.req).map(([a, b]) => `${STAT_NAMES[a] || a} ${b}`).join(', ') + `, уровень ${s.level}`);
    return out;
  }

  function validate(known = {}) {
    const errors = [];
    const ids = new Set();
    for (const s of SPELLS) {
      const e = (m) => errors.push(`${s.id}: ${m}`);
      if (!/^[a-z_]+$/.test(s.id) || ids.has(s.id)) e('id — латиница, уникальный'); ids.add(s.id);
      if (!s.name || !s.desc) e('имя и описание');
      if (!SCHOOLS[s.school]) e('школа');
      if (!TIERS[s.tier]) e('круг 1–3');
      if (!KINDS[s.kind]) e('вид');
      if (!TARGETS[s.target]) e('цель');
      for (const k of ['mp', 'cd', 'cast', 'range']) if (!Number.isFinite(s[k]) || s[k] < 0) e(k + ' — число ≥ 0');
      if (!(s.mp > 0) || !(s.cd > 0)) e('мана и откат > 0');
      if (['bolt', 'chain', 'cone', 'aoe'].includes(s.kind) && !(Array.isArray(s.damage) && s.damage[0] > 0 && s.damage[1] >= s.damage[0])) e('урон — [мин, макс]');
      if (['bolt'].includes(s.kind) && !(s.proj > 0)) e('скорость снаряда');
      if (s.kind === 'cone' && !(s.deg > 0 && s.range > 0)) e('конус: угол и дальность');
      if (s.kind === 'field' && !(s.radius>0 && s.dur>0 && (s.pulse||1)>0)) e('зона: радиус, длительность и импульс > 0');
      if (s.kind === 'aoe' && !(s.radius > 0)) e('область: радиус');
      if (['enemy', 'point', 'ally'].includes(s.target) && !(s.range > 0)) e('дальность > 0');
      if (s.kind === 'heal' && !(s.heal && s.heal[1] >= s.heal[0] && s.heal[0] > 0)) e('лечение');
      if (s.kind === 'hot' && !(s.perSec > 0 && s.dur > 0)) e('восстановление: perSec и dur');
      if (s.kind === 'shield' && !(s.absorb > 0 && s.dur > 0)) e('щит: absorb и dur');
      if (s.kind === 'buff' && !((s.defense > 0 || s.speed > 1) && s.dur > 0)) e('усиление: defense/speed и dur');
      if (s.kind === 'debuff' && !(s.factor > 0 && s.factor < 1 && s.dur > 0)) e('ослабление: factor и dur');
      if (s.kind === 'summon' && !(s.summon && s.dur > 0)) e('призыв: summon и dur');
      if (s.kind === 'summon' && known.enemies && !known.enemies(s.summon)) e('призыв: неизвестное существо ' + s.summon);
      if (['stealth', 'fear', 'charm'].includes(s.kind) && !(s.dur > 0)) e('длительность');
      if (known.damageTypes && !known.damageTypes.includes(s.type)) e('тип урона ' + s.type);
      for (const k of Object.keys(s.req)) if (known.stats && !known.stats.includes(k)) e('требование — неизвестный стат ' + k);
    }
    for (const sc of Object.keys(SCHOOLS)) {
      const spells=bySchool(sc);
      if(spells.length<6)errors.push(`школа ${sc}: меньше шести заклинаний`);
      for(const role of ['sky','ground','debuff','stream','direct'])if(!spells.some(sp=>sp.delivery===role))errors.push(`школа ${sc}: нет роли ${role}`);
    }
    return errors;
  }

  return {
    settings, configure, SCHOOLS, TIERS, KINDS, TARGETS, SPELLS, STAT_NAMES, get, bySchool, itemId, hotbarKey, fromHotbar, HOTBAR_RE,
    known, knows, canLearn, reqError, learn, forget, affinity, power, enemyPower, scaled, stealChance, charmChance, describe, validate,
  };
});
