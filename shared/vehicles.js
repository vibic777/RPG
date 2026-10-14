// Транспорт (шаг 14): каталог довоенной техники, правила местности, топливо, повреждения, обломки в мире.
// Общий файл: сервер (вождение, топливо, таран, бортовое оружие, ремонт) и клиент (предсказание движения, отрисовка, справка).
// Движение техники — тот же shared/movement.js: у карты на время шага водителя стоит world.drive
// ({ walk(biome), speed(biome) }) — какие клетки проходимы и с какой скоростью (доля от скорости машины).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./worldgen'));
  else root.Vehicles = factory(root.WorldGen);
})(typeof self !== 'undefined' ? self : this, function (WorldGen) {
  'use strict';
  const { B, BIOMES, mulberry32, hashString } = WorldGen;

  const settings = {
    vehiclesEnabled: true, // транспорт включён
    vehicleWrecksPer256: 14, // брошенной техники на карту 256×256 (пропорционально площади)
    vehicleRespawnSec: 60, // задержка замены уничтоженной природной техники
    vehicleIntactChance: 0.12, // доля целой техники (с топливом) среди найденной
    vehicleEnterRange: 2.2, // дальность посадки, клеток
    vehicleSpeedFactor: 1, // общий множитель скорости техники
    vehicleFuelFactor: 1, // общий множитель расхода топлива
    vehicleRamMinSpeed: 3, // таран: минимальная скорость, клеток/с
    vehicleRamFactor: 1, // множитель урона тарана
    vehicleRamSelfPct: 15, // доля урона тарана, которую получает сама машина, %
    vehicleCrashDamagePct: 4, // удар о стену на полной скорости: урон машине, % прочности
    vehicleRepairPerParts: 20, // ремонт: % прочности за одну «Автозапчасть» у верстака
    vehicleFieldRepairMaxPct: 100, // запчасти восстанавливают прочность мгновенно и в поле
    vehicleWreckMinPct: 25, // обломки: ехать можно, только починив выше этого % прочности
    vehicleDiveMaxDepth: 5, // подлодки: глубина погружения, уровней ниже моря (до 5: −1…−5)
    vehicleArmsDamageFactor: 1, // множитель урона бортового оружия (пушки, ракеты, торпеды, бомбы)
    vehicleMissileTurnFactor: 1, // множитель поворотливости управляемых ракет (0 — летят прямо)
  };
  function configure(o = {}) {
    for (const k of Object.keys(settings)) if (o && o[k] !== undefined && typeof o[k] === typeof settings[k]) settings[k] = o[k];
  }

  // Классы местности: road — ровная (город, пустошь, поселение, бетонный пол), offroad — бездорожье, water — поверхность воды,
  // depth — морское дно подводных уровней, air — полёт (высота > 0)
  const TERRAIN = { road: 'дороги и ровная земля', offroad: 'бездорожье', water: 'вода', depth: 'под водой', air: 'воздух' };
  const ROADS = new Set([B.CITY, B.ROAD, B.WASTE, B.SETTLEMENT, B.FLOOR, B.ROOF]);
  function terrainOf(t) {
    const b = BIOMES[t];
    if (!b) return null;
    if (b.underwater) return 'depth';
    if (b.swim) return 'water';
    if (!b.walkable) return null; // горы, стены, пропасть
    return ROADS.has(t) ? 'road' : 'offroad';
  }

  // Топливо: предмет-«боеприпас» с зарядами (rounds) — одна единица топлива = один заряд
  const FUELS = {
    none: { name: 'без топлива', item: null },
    fuel_gas: { name: 'бензин', item: 'fuel_gas' },
    fuel_diesel: { name: 'солярка', item: 'fuel_diesel' },
    fuel_avia: { name: 'авиатопливо', item: 'fuel_avia' },
    ammo_cell: { name: 'энергоячейки', item: 'ammo_cell' },
  };

  // Каталог. speed — клеток/с по дороге; terrain — классы местности → множитель скорости; seats — мест (0 — водитель);
  // gunner — номер места стрелка (бортовое оружие), null — стреляет водитель; fuel { type, cap, perTile }; hp, armor;
  // cargo — ячеек багажника; weapon { item, ammo } — профиль атаки как у оружия (шаг 6); open — открытая (седоки
  // стреляют своим оружием, машина их не закрывает); sealed — герметична (под водой воздух не расходуется);
  // eng — Инженерия для ремонта (большая техника — высокий навык); fly — летает (PageUp/PageDown), vtol — взлёт с места (вертолёт), иначе нужна ровная полоса; ram — урон тарана на полной скорости
  const V = (id, name, kind, speed, terrain, seats, fuel, hp, armor, cargo, extra = {}) => Object.assign({
    id, name, kind, speed, terrain, seats, fuel, hp, armor, cargo, gunner: null, weapon: null, open: false, sealed: false, fly: false, vtol: false,
    ram: Math.round(hp / 10), mass: 1, radius: 0.6, eng: 0, wreck: true, color: '#7a7a7a', icon: '🚗', desc: '',
  }, extra);
  const LIST = [
    V('bicycle', 'Велосипед', 'land', 6.5, { road: 1, offroad: 0.55 }, 1, { type: 'none', cap: 0, perTile: 0 }, 60, 0, 0,
      { mass:.02,open: true, ram: 4, radius: 0.45, staminaPerSec: 2, icon: '🚲', color: '#3a7ab8', desc: 'Тихий и без топлива: тратит выносливость ездока. По бездорожью медленно.' }),
    V('horse', 'Верховая лошадь', 'land', 7.5, { road: 1, offroad: 0.8 }, 1, { type: 'none', cap: 0, perTile: 0 }, 150, 0, 2,
      { mass:.55,animal: 'horse', open: true, wreck: false, staminaPerSec: 2, ram: 8, radius: 0.55, icon: '🐎', color: '#80563d', desc: 'Живое ездовое животное: не нужно топливо, но езда расходует выносливость.' }),
    V('mutant_mount', 'Мутант-скакун', 'land', 9, { road: 1, offroad: 0.9, water: 0.15 }, 1, { type: 'none', cap: 0, perTile: 0 }, 300, 2, 4,
      { mass:.9,animal: 'mutant', open: true, wreck: false, staminaPerSec: 3, ram: 28, radius: 0.65, icon: '🦎', color: '#697943', desc: 'Быстрый пустошный скакун с усиленной бронёй и вместительными сумками. Езда утомляет.' }),
    V('motorcycle', 'Мотоцикл', 'land', 10, { road: 1, offroad: 0.7 }, 2, { type: 'fuel_gas', cap: 40, perTile: 0.06 }, 120, 2, 4,
      { mass:.25,open: true, gunner: 0, weapon: { item: 'mg_mower' }, ram: 12, radius: 0.5, icon: '🏍', color: '#8a2d2d', desc: 'Быстрый мотоцикл с передним пулемётом; не защищает от пуль.' }),
    V('car', 'Легковушка', 'land', 11, { road: 1, offroad: 0.45 }, 4, { type: 'fuel_gas', cap: 60, perTile: 0.08 }, 260, 4, 12,
      { mass: 1.6, ram: 22, radius: 0.9, gunner: 1, weapon: { item: 'mg_mower' }, icon: '🚗', color: '#b8a03a', desc: 'Четыре места, пулемёт у стрелка и багажник. Закрывает от ударов, но по бездорожью вязнет.' }),
    V('sedan', 'Дорожный седан', 'land', 12, { road: 1, offroad: 0.5 }, 4, { type: 'fuel_gas', cap: 65, perTile: 0.085 }, 290, 4, 16,
      { car: true, mass: 1.8, ram: 24, gunner: 1, weapon: { item: 'mg_mower' }, radius: 0.95, icon: '🚘', color: '#496f83', desc: 'Комфортабельная легковая машина: пулемёт у стрелка, четыре места и вместительный багажник.' }),
    V('armored_car', 'Бронированный универсал', 'land', 9.5, { road: 1, offroad: 0.58 }, 5, { type: 'fuel_gas', cap: 75, perTile: 0.11 }, 540, 12, 20,
      { car: true, mass: 2.5, ram: 32, gunner: 1, weapon: { item: 'mg_hail' }, radius: 1.0, icon: '🚙', color: '#526052', desc: 'Укреплённая машина на пять мест с тяжёлым пулемётом и усиленной защитой.' }),
    V('truck', 'Пикап в духе Ford Raptor', 'land', 9.5, { road: 1, offroad: 0.75 }, 4, { type: 'fuel_diesel', cap: 80, perTile: 0.1 }, 420, 6, 30,
      { eng: 2, mass: 3.2, gunner: 1, weapon: { item: 'mg_mower' }, ram: 34, radius: 1.05, icon: '🛻', color: '#6a5a3a', desc: 'Мощный полноприводный пикап с широкими внедорожными колёсами, открытым кузовом и компактным пулемётом на станке в кузове.' }),
    V('cargo_truck', 'Грузовик с прицепом', 'land', 7.5, { road: 1, offroad: 0.68 }, 3, { type: 'fuel_diesel', cap: 180, perTile: 0.16 }, 760, 7, 80,
      { eng: 2, mass: 9, truckCab: true, trailerLength: 1.65, gunner: 1, weapon: { item: 'launcher_boom' }, ram: 42, radius: 1.25, icon: '🚚', color: '#69745a', desc: 'Трёхместный грузовик с ракетницей у стрелка, бортовым прицепом и большим грузовым отсеком.' }),
    V('semi_truck', 'Тягач с длинным полуприцепом', 'land', 6.5, { road: 1, offroad: 0.48 }, 3, { type: 'fuel_diesel', cap: 260, perTile: 0.2 }, 1150, 10, 150,
      { eng: 3, mass: 18, truckCab: true, trailerLength: 2.5, gunner: 1, weapon: { item: 'launcher_boom' }, ram: 50, radius: 1.7, icon: '🚛', color: '#6b6870', desc: 'Тяжёлый тягач с ракетницей и длинным полуприцепом: очень большой грузовой отсек.' }),
    V('bus', 'Пассажирский автобус Mercedes', 'land', 8.5, { road: 1, offroad: 0.45 }, 12, { type: 'fuel_diesel', cap: 150, perTile: 0.17 }, 760, 5, 12,
      { bus: true, mass: 12, gunner: 1, weapon: { item: 'mg_mower' }, turretMount: 'rear', ram: 38, radius: 1.35, icon: '🚌', color: '#b9a74e', desc: 'Большой автобус Mercedes на одиннадцать пассажиров и водителя, с небольшой задней пулемётной башенкой.' }),
    V('armored_bus', 'Защищённый автобус', 'land', 6.5, { road: 1, offroad: 0.42 }, 10, { type: 'fuel_diesel', cap: 190, perTile: 0.22 }, 1450, 15, 16,
      { bus: true, mass: 16, gunner: 1, weapon: { item: 'mg_mower' }, turretMount: 'rear', ram: 55, radius: 1.45, icon: '🚍', color: '#606954', desc: 'Бронированный автобус на девять пассажиров и водителя, с небольшой задней пулемётной установкой.' }),
    V('apc', 'БТР', 'land', 8, { road: 1, offroad: 0.85, water: 0.35 }, 6, { type: 'fuel_diesel', cap: 120, perTile: 0.16 }, 900, 14, 20,
      { eng: 4, mass: 13, gunner: 1, weapon: { item: 'mg_hail' }, ram: 60, radius: 1.25, icon: '🚙', color: '#4f5a3a', desc: 'Бронетранспортёр: шесть мест, пулемёт, плывёт по воде (медленно).' }),
    V('ifv', 'Боевая машина пехоты', 'land', 7.5, { road: 1, offroad: 0.9, water: 0.2 }, 7, { type: 'fuel_diesel', cap: 145, perTile: 0.18 }, 1180, 17, 26,
      { eng: 4, mass: 17, apc: true, gunner: 1, weapon: { item: 'mg_mower' }, ram: 72, radius: 1.35, icon: '🚜', color: '#566748', desc: 'БМП: водитель, стрелок и пять десантников; усиленная броня и пулемёт.' }),
    V('tank', 'Т-14 «Армата»', 'land', 6, { road: 1, offroad: 0.9 }, 3, { type: 'fuel_diesel', cap: 150, perTile: 0.25 }, 1600, 22, 10,
      { eng: 5, mass: 52, tracked: true, gunner: 1, weapon: { item: 'launcher_boom' }, ram: 90, radius: 1.65, icon: '🛡', color: '#3f4a2c', desc: 'Медленный Т-14 с необитаемой башней, клиновидной бронёй и широкими гусеницами. Башня независимо наводится по восьми направлениям.' }),
    V('light_tank', 'Лёгкий разведывательный танк', 'land', 8, { road: 1, offroad: 0.88 }, 3, { type: 'fuel_diesel', cap: 120, perTile: 0.2 }, 980, 17, 12,
      { eng: 4, mass: 24, tracked: true, gunner: 1, weapon: { item: 'mg_hail' }, ram: 64, radius: 1.35, icon: '🛡', color: '#65724d', desc: 'Быстрый лёгкий танк: водитель, командир и стрелок; пулемёт и гусеницы.' }),
    V('rowboat', 'Вёсельная лодка', 'water', 4.5, { water: 1 }, 2, { type: 'none', cap: 0, perTile: 0 }, 80, 0, 6,
      { mass:.12,open: true, gunner: 1, weapon: { item: 'mg_mower' }, ram: 3, staminaPerSec: 3, icon: '🛶', color: '#8a6a3a', desc: 'Самодельная лодка с лёгким пулемётом на носу: гребец тратит выносливость.', wreck: false }),
    V('boat', 'Французский прогулочный катер', 'water', 8, { water: 1 }, 4, { type: 'fuel_gas', cap: 50, perTile: 0.07 }, 200, 2, 16,
      { mass:2.8,open: true, gunner: 1, weapon: { item: 'mg_mower' }, rearWeapon: { item: 'mg_mower' }, ram: 10, radius: 0.7, icon: '🚤', color: '#e8e0d0', desc: 'Французский прогулочный катер с пулемётами на носу и корме: передняя и задняя полусферы огня.' }),
    V('jetski', 'Гидроцикл', 'water', 13, { water: 1 }, 2, { type: 'fuel_gas', cap: 30, perTile: 0.09 }, 90, 1, 2,
      { mass:.25,open: true, gunner: 0, weapon: { item: 'mg_mower' }, ram: 8, radius: 0.5, icon: '🌊', color: '#2a8ab8', desc: 'Самый быстрый транспорт на воде, с носовым пулемётом.' }),
    V('submarine', 'Проект 941 «Акула»', 'water', 6, { water: 0.8, depth: 1 }, 3, { type: 'ammo_cell', cap: 100, perTile: 0.08 }, 4800, 24, 240,
      { eng: 5, mass: 23200,submergedMass:48000, sealed: true, dive: true, gunner: 1, weapon: { item: 'launcher_boom' }, rearWeapon: { item: 'launcher_boom' }, ram: 20, radius: 1.35, icon: '🐋', color: '#414b49', desc: 'Советский проект 941: корпус 172,8 × 23,3 м, две линии ракетных шахт перед рубкой и два винта. Бронеплиты, сварные заплаты и оружейные переделки пустошей.' }),
    V('deep_submarine', 'Глубоководный батискаф', 'water', 4.5, { water: 0.7, depth: 1 }, 5, { type: 'ammo_cell', cap: 180, perTile: 0.1 }, 920, 18, 42,
      { eng: 5, mass: 46, sealed: true, submersible: true, dive: true, gunner: 1, weapon: { item: 'launcher_boom' }, ram: 24, radius: 1.8, icon: '🛟', color: '#526b77', desc: 'Тяжёлый вооружённый батискаф: экипаж из пяти человек, большой отсек и торпедная ракетница.' }),
    V('helicopter', 'Ударный вертолёт Ка-52', 'air', 12, { road: 0.3, offroad: 0.3, air: 1 }, 4, { type: 'fuel_avia', cap: 80, perTile: 0.12 }, 350, 5, 10,
      { mass:10.8,eng: 4, fly: true, vtol: true, gunner: 1, weapon: { item: 'mg_mower' }, secondaryWeapon: { item: 'launcher_boom' }, ram: 0, radius: 0.8, icon: '🚁', color: '#4f6a4f', desc: 'Взлетает с места. Стрелок управляет пулемётом и бомбами (основная / вторая кнопка атаки). Садиться — только на сушу.' }),
    V('plane', 'Штурмовик Ил-2', 'air', 16, { road: 0.5, offroad: 0.2, air: 1 }, 2, { type: 'fuel_avia', cap: 100, perTile: 0.1 }, 220, 3, 6,
      { mass:6.4,eng: 4, fly: true, gunner: 0, weapon: { item: 'mg_mower' }, rearWeapon: { item: 'mg_mower' }, secondaryWeapon: { item: 'launcher_boom' }, ram: 0, radius: 0.8, icon: '✈', color: '#c8c8d0', desc: 'Штурмовик Ил-2: передние пушки и задний пулемёт прикрывают каждый свою полусферу; отдельная атака сбрасывает бомбы.' }),
    V('mech_sentinel', 'Двуногий боевой мех «Страж»', 'land', 5.2, { road: 0.85, offroad: 0.95, water: 0.1 }, 2, { type: 'fuel_diesel', cap: 220, perTile: 0.2 }, 1550, 20, 14,
      { eng: 6, mass: 14, walker: 'biped', gunner: 1, weapon: { item: 'mg_hail' }, ram: 85, radius: 1.35, icon: '🤖', color: '#65716e', desc: 'Ростовой двуногий мех с кабиной пилота, местом стрелка и тяжёлым пулемётом. Управление — как у машины.' }),
    V('chicken_walker', 'Двуногий шагоход «Страйдер»', 'land', 8, { road: 0.8, offroad: 1, water: 0.15 }, 1, { type: 'ammo_cell', cap: 150, perTile: 0.16 }, 640, 12, 8,
      { eng: 4, mass: 5, walker: 'biped_light', gunner: 0, weapon: { item: 'mg_mower' }, ram: 46, radius: 1.0, icon: '🤖', color: '#8a7148', desc: 'Лёгкий одноместный боевой робот на двух механических ногах с обратными коленными шарнирами и пулемётом.' }),
    V('elephant_walker', 'Тяжёлый шагоход «Мамонт»', 'land', 3.8, { road: 0.65, offroad: 1, water: 0 }, 4, { type: 'fuel_diesel', cap: 320, perTile: 0.26 }, 2600, 28, 38,
      { eng: 7, mass: 38, walker: 'elephant', gunner: 1, weapon: { item: 'launcher_boom' }, ram: 130, radius: 1.9, icon: '🐘', color: '#77756a', desc: 'Громадный четырёхногий шагоход с закрытой кабиной, местом стрелка и пушкой. Медленный, очень прочный.' }),
  ];
  const BY_ID = new Map(LIST.map((d) => [d.id, d]));
  const get = (id) => BY_ID.get(id) || null;

  // Проверка каталога (тесты)
  function validateCatalogue(Items) {
    const errors = [];
    for (const d of LIST) {
      if (!(d.speed > 0)) errors.push(`${d.id}: скорость`);
      if (!Object.keys(d.terrain).length || Object.keys(d.terrain).some((k) => !TERRAIN[k])) errors.push(`${d.id}: местность`);
      if (!(d.seats >= 1)) errors.push(`${d.id}: места`);
      if (d.gunner !== null && !(d.gunner < d.seats)) errors.push(`${d.id}: место стрелка`);
      if (!FUELS[d.fuel.type]) errors.push(`${d.id}: тип топлива`);
      if (d.fuel.type !== 'none' && !(d.fuel.cap > 0 && d.fuel.perTile > 0)) errors.push(`${d.id}: бак и расход`);
      if (!(d.hp > 0) || !(d.armor >= 0) || !(d.cargo >= 0)) errors.push(`${d.id}: прочность/броня/багажник`);
      if (d.fly && !d.terrain.air) errors.push(`${d.id}: летает без воздуха`);
      if (Items) {
        if (d.fuel.type !== 'none' && !(Items.get(d.fuel.type) && Items.get(d.fuel.type).rounds > 0)) errors.push(`${d.id}: нет топлива-предмета`);
        for (const [slot, spec] of [['бортовое оружие', d.weapon], ['кормовое оружие', d.rearWeapon], ['второе оружие', d.secondaryWeapon]]) {
          if (spec && !(Items.get(spec.item) && Items.get(spec.item).weapon)) errors.push(`${d.id}: ${slot}`);
        }
      }
    }
    return errors;
  }

  // Physical hull bounds in metres, including tires and permanent armor, excluding rotating barrels.
  const HULL_METERS = {
    bicycle:[.7,2.1,1.1],horse:[1.1,2.8,2.3],mutant_mount:[1.4,3.2,2.7],motorcycle:[.95,2.5,1.25],
    car:[2.24,4.5,1.8],sedan:[2.3,5,1.8],armored_car:[2.4,5.1,2],truck:[2.65,6,2.2],
    cargo_truck:[2.9,9,3.5,.15],semi_truck:[3,13,3.7,.15],bus:[3,10.8,3.7],armored_bus:[3.1,10.8,3.8],
    apc:[3.3,8,2.7],ifv:[3.5,7.7,2.5],tank:[4,9.5,3],light_tank:[3.4,8,2.7],
    rowboat:[1.6,3.3,1],boat:[2.6,6.8,2.5],jetski:[1.3,3.2,1.2],submarine:[23.3,172.8,32],deep_submarine:[4,9.8,4,-.1],
    helicopter:[10.5,13,4,-.6],plane:[13.4,11,3,.5],mech_sentinel:[3,3.2,5.5],chicken_walker:[2.2,3,4],elephant_walker:[4.8,8.4,6,.8]
  };
  const LEVEL_METERS=1.7;
  function dimensionsOf(def){return HULL_METERS[typeof def==='string'?def:def?.id]||[1.8,4.5,1.8];}
  function bodyAt(def,pos,heading=pos.facingAngle||0){
    const d=dimensionsOf(def),ca=Math.cos(heading),sa=Math.sin(heading),offset=(d[3]||0)/M_PER_TILE;
    const halfWidth=d[0]/(2*M_PER_TILE),halfLength=d[1]/(2*M_PER_TILE),z=pos.alt||0;
    return {x:pos.x+ca*offset,y:pos.y+sa*offset,heading,halfWidth,halfLength,ux:ca,uy:sa,vx:-sa,vy:ca,minZ:z,maxZ:z+d[2]/LEVEL_METERS,
      extentX:Math.abs(ca)*halfLength+Math.abs(sa)*halfWidth,extentY:Math.abs(sa)*halfLength+Math.abs(ca)*halfWidth};
  }
  function pointBodyDistance(point,b){
    const dx=point.x-b.x,dy=point.y-b.y,along=Math.abs(dx*b.ux+dy*b.uy)-b.halfLength,across=Math.abs(dx*b.vx+dy*b.vy)-b.halfWidth;
    return Math.hypot(Math.max(0,along),Math.max(0,across));
  }
  function bodiesOverlap(a,b,vertical=true){
    if(vertical&&(a.minZ>=b.maxZ-1e-6||b.minZ>=a.maxZ-1e-6))return false;
    const dx=b.x-a.x,dy=b.y-a.y;
    for(const [x,y] of [[a.ux,a.uy],[a.vx,a.vy],[b.ux,b.uy],[b.vx,b.vy]]){
      const ar=Math.abs(x*a.ux+y*a.uy)*a.halfLength+Math.abs(x*a.vx+y*a.vy)*a.halfWidth;
      const br=Math.abs(x*b.ux+y*b.uy)*b.halfLength+Math.abs(x*b.vx+y*b.vy)*b.halfWidth;
      if(Math.abs(dx*x+dy*y)>=ar+br-1e-6)return false;
    }return true;
  }
  function bodyIntersectsCell(b,x,y){return bodiesOverlap(b,{x:x+.5,y:y+.5,ux:1,uy:0,vx:0,vy:1,halfLength:.5,halfWidth:.5},false);}
  function bodyCellOverlapArea(b,x,y){
    let points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>[b.x+u*b.ux*b.halfLength+v*b.vx*b.halfWidth,b.y+u*b.uy*b.halfLength+v*b.vy*b.halfWidth]);
    for(const [axis,edge,sign] of [[0,x,1],[0,x+1,-1],[1,y,1],[1,y+1,-1]]){
      const clipped=[];
      for(let i=0;i<points.length;i++){
        const a=points[i],c=points[(i+1)%points.length],insideA=(a[axis]-edge)*sign>=0,insideC=(c[axis]-edge)*sign>=0;
        if(insideA)clipped.push(a);
        if(insideA!==insideC){const t=(edge-a[axis])/(c[axis]-a[axis]);clipped.push([a[0]+(c[0]-a[0])*t,a[1]+(c[1]-a[1])*t]);}
      }
      points=clipped;if(!points.length)return 0;
    }
    return Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-p[1]*q[0];},0))/2;
  }
  function motionHeading(heading,dx,dy){
    if(Math.hypot(dx,dy)<1e-8)return heading;
    const bearing=Math.atan2(dy,dx),turn=Math.atan2(Math.sin(bearing-heading),Math.cos(bearing-heading));
    // Movement into the rear hemisphere is reverse gear, not a 180-degree hull turn.
    return heading+(Math.abs(turn)>Math.PI/2+1e-8?turn-Math.sign(turn)*Math.PI:turn);
  }
  function sweptBodyHit(def,from,to,point,radius=0){
    const distance=Math.hypot(to.x-from.x,to.y-from.y),start=from.facingAngle||0;
    const heading=to.facingAngle??motionHeading(start,to.x-from.x,to.y-from.y);
    const turn=Math.atan2(Math.sin(heading-start),Math.cos(heading-start)),initial=bodyAt(def,from);
    const steps=Math.max(1,Math.ceil((distance+Math.abs(turn)*Math.hypot(initial.halfWidth,initial.halfLength))/.12));
    for(let i=0;i<=steps;i++){
      const t=i/steps,b=bodyAt(def,{x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,alt:(from.alt||0)+((to.alt??from.alt??0)-(from.alt||0))*t},start+turn*t);
      if(pointBodyDistance(point,b)<=radius)return true;
    }
    return false;
  }
  // alt < 0 — подлодка под водой: только водные клетки, скорость как на глубине
  function drive(def, alt = 0, heading = 0) {
    const air = def.fly && alt > 0;
    const under = alt < 0;
    const k = (t) => {
      if (air) return def.terrain.air || 0;
      const c = terrainOf(t);
      if (under) return c === 'water' || c === 'depth' ? def.terrain.depth || def.terrain.water || 0 : 0;
      return (c && def.terrain[c]) || 0;
    };
    const hull=bodyAt(def,{x:0,y:0,alt},heading);
    return { id:def.id,air,heading,alt,radius:Math.hypot(hull.halfLength,hull.halfWidth),planRadius:hull.halfWidth,bodyAt:(x,y,a)=>bodyAt(def,{x,y,alt},a),intersectsCell:bodyIntersectsCell,cellOverlap:bodyCellOverlapArea,motionHeading,walk:t=>k(t)>0,speed:k };
  }
  function canPlaceBody(map,def,pos){
    const body=bodyAt(def,pos),world={...map,flyer:false,drive:drive(def,pos.alt||0,pos.facingAngle||0)};
    for(let y=Math.floor(body.y-body.extentY);y<=Math.floor(body.y+body.extentY);y++)for(let x=Math.floor(body.x-body.extentX);x<=Math.floor(body.x+body.extentX);x++){
      if(!WorldGen.isWalkable(world,x,y)&&bodyIntersectsCell(body,x,y))return false;
    }
    return true;
  }
  function findBerth(map,def,near,accept=()=>true){
    for(const facingAngle of [near.facingAngle||0,(near.facingAngle||0)+Math.PI/2]){const spot={x:near.x,y:near.y,facingAngle};if(canPlaceBody(map,def,spot)&&accept(spot))return spot;}
    const sites=[];
    for(let y=2;y<map.height-2;y+=4)for(let x=2;x<map.width-2;x+=4){
      if(canDrive(def,WorldGen.tileAt(map,x,y)))sites.push({x:x+.5,y:y+.5});
    }
    sites.sort((a,b)=>Math.hypot(a.x-near.x,a.y-near.y)-Math.hypot(b.x-near.x,b.y-near.y));
    for(const p of sites)for(const facingAngle of [0,Math.PI/2]){const spot={...p,facingAngle};if(canPlaceBody(map,def,spot)&&accept(spot))return spot;}
    return null;
  }
  const canDrive = (def, t, alt = 0) => drive(def, alt).walk(t);
  // Скорость (множитель к скорости героя): прочность ниже половины — медленнее
  function speedMul(def, v, heroSpeed) {
    if(v&&!drivable(def,v))return 0;
    const hpK = v && v.hp < def.hp * 0.5 ? 0.6 + 0.8 * (v.hp / def.hp) : 1;
    return (def.speed * settings.vehicleSpeedFactor * hpK) / heroSpeed;
  }
  // Расход топлива за пройденные клетки
  const fuelFor = (def, tiles) => (def.fuel.type === 'none' ? 0 : def.fuel.perTile * settings.vehicleFuelFactor * tiles);
  // Урон тарана на скорости speed (клеток/с): до vehicleRamMinSpeed — 0
  function ramDamage(def, speed) {
    if (!(def.ram > 0) || speed < settings.vehicleRamMinSpeed) return 0;
    return def.ram * settings.vehicleRamFactor * Math.min(1.2, speed / def.speed);
  }
  function walkerFeet(def,distance=0,moving=true){
    if(!def.walker)return [];
    const half=def.id==='chicken_walker'?.5:.6,phase=distance*Math.PI*2/(4*half),elephant=def.walker==='elephant';
    const offsets=elephant?[[ -1,-1,0],[-1,1,Math.PI/2],[1,-1,Math.PI],[1,1,Math.PI*1.5]]:[[-1,0,Math.PI],[1,0,0]];
    return offsets.map(([side,end,offset],index)=>{
      const u=(((phase+offset)/(Math.PI*2))%1+1)%1,stance=!moving||u<.5,v=(u-.5)*2;
      const dy=(u<.5?half*(1-4*u):-half+2*half*v*v*(3-2*v))*(moving?1:0);
      const dz=u<.5||!moving?0:Math.sin(v*Math.PI)*(elephant?.35:def.id==='chicken_walker'?.32:.35);
      const x=side*(elephant?1.35:def.id==='chicken_walker'?.6:.72);
      return {index,side,end,dy,dz,stance,x,y:(elephant?end*1.95:def.id==='chicken_walker'?.075:.15)+dy,z:dz,
        width:elephant?1.1:def.id==='chicken_walker'?.4:.6,length:elephant?1.1:def.id==='chicken_walker'?.9:1.1};
    });
  }
  function contactImpact(def,speed,activeFeet=1){
    const mass=Math.max(.01,def.mass||1),factor=settings.vehicleRamFactor;
    if(def.walker){const load=mass/Math.max(1,activeFeet);return{kind:'stomp',damage:load*(9+Math.min(12,Math.abs(speed)*2))*factor,knockback:0,stunSec:1.1};}
    if(!(speed>.01))return null;
    if(def.tracked||def.id==='ifv')return{kind:'crush',damage:mass*(3+Math.min(8,speed)*.8)*factor,knockback:.1,stunSec:1.2};
    if(speed<settings.vehicleRamMinSpeed)return null;
    const kinetic=mass*(speed*M_PER_TILE)**2;
    return{kind:'knockdown',damage:((def.ram||0)*.35+Math.sqrt(kinetic)*6)*factor,knockback:Math.min(3,.4+Math.sqrt(kinetic)*.12),stunSec:Math.min(2.5,.3+Math.sqrt(kinetic)*.06)};
  }
  function vehicleContact(def,from,to,target,radius,speed){
    if((to.alt||0)!==0||(target.alt||0)!==0)return null;
    if(!def.walker)return sweptBodyHit(def,from,to,target,radius)?contactImpact(def,speed):null;
    const length=Math.hypot(to.x-from.x,to.y-from.y),start=from.facingAngle||0,finish=to.facingAngle??motionHeading(start,to.x-from.x,to.y-from.y),turn=Math.atan2(Math.sin(finish-start),Math.cos(finish-start));
    const d0=from.odometer||0,d1=to.odometer??d0+length*M_PER_TILE,steps=Math.max(1,Math.ceil((length+Math.abs(turn)*dimensionsOf(def)[1]/M_PER_TILE)/.08),Math.ceil(Math.abs(d1-d0)/.06));
    for(let i=0;i<=steps;i++){
      const t=i/steps,heading=start+turn*t,ca=Math.cos(heading),sa=Math.sin(heading),feet=walkerFeet(def,d0+(d1-d0)*t,length>.0001);
      for(const foot of feet){
        if(!foot.stance||foot.z>.025)continue;
        const b=bodyAt('bicycle',{x:from.x+(to.x-from.x)*t+(-sa*foot.x+ca*foot.y)/M_PER_TILE,y:from.y+(to.y-from.y)*t+(ca*foot.x+sa*foot.y)/M_PER_TILE},heading);
        b.halfWidth=foot.width/(2*M_PER_TILE);b.halfLength=foot.length/(2*M_PER_TILE);
        if(pointBodyDistance(target,b)<=radius)return{...contactImpact(def,speed,feet.filter(f=>f.stance).length),foot:foot.index};
      }
    }
    return null;
  }
  // Урон по машине с учётом брони (как у героя: броня вычитается, не меньше 15%)
  const armorCut = (def, amount) => Math.max(amount * 0.15, amount - def.armor);
  // Можно ли взлететь / сесть здесь: вертолёт — на любой суше, самолёт — только на ровной
  function canTakeOff(def, t) {
    if (!def.fly) return false;
    const c = terrainOf(t);
    return def.vtol ? c === 'road' || c === 'offroad' : c === 'road';
  }
  const repairNeed = (def, v, pct) => Math.ceil(Math.max(0, Math.min(def.hp, (def.hp * pct) / 100) - v.hp) / (def.hp * settings.vehicleRepairPerParts / 100));
  const drivable = (def, v) => v.hp > def.hp * settings.vehicleWreckMinPct / 100 || (!v.wreck && v.hp > 0);

  // ---------- Техника в мире (детерминирована по сиду) ----------
  // Сухопутная — в руинах, на пустоши и у поселений; лодки — у берега; самолёты — на ровной пустоши; подлодки — редко в море.
  // Большинство — обломки (ремонт), около поселений иногда целая с топливом.
  const MIX = [['bicycle', 3], ['horse', 1.5], ['mutant_mount', 0.5], ['motorcycle', 3], ['car', 3], ['sedan', 2], ['armored_car', 0.8], ['truck', 1.5], ['cargo_truck', 0.8], ['semi_truck', 0.35], ['bus', 0.6], ['armored_bus', 0.25], ['apc', 0.8], ['ifv', 0.55], ['tank', 0.35], ['light_tank', 0.45], ['boat', 2], ['jetski', 1], ['submarine', 0.45], ['deep_submarine', 0.2], ['helicopter', 0.65], ['plane', 0.45], ['mech_sentinel', 0.25], ['chicken_walker', 0.4], ['elephant_walker', 0.12]];
  function randomDef(rnd = Math.random) {
    const weight = MIX.reduce((s, row) => s + row[1], 0);
    let r = rnd() * weight;
    for (const [id, w] of MIX) { r -= w; if (r <= 0) return get(id); }
    return get(MIX[0][0]);
  }
  function worldSpawns(map) {
    if (!map || map.level || !settings.vehiclesEnabled) return [];
    const cache = map.__vehicles || (Object.defineProperty(map, '__vehicles', { value: {}, enumerable: false }), map.__vehicles);
    if (cache.list) return cache.list;
    const W = map.width, H = map.height, T = map.tiles;
    const rnd = mulberry32(hashString(String(map.seed)) ^ 0x7e41c1e5);
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? B.WATER : T[y * W + x]);
    const main = (x, y) => !map.region || map.region[y * W + x] === map.mainRegion;
    const total = Math.max(MIX.length, Math.round((settings.vehicleWrecksPer256 * W * H) / 65536));
    const weight = MIX.reduce((s, m) => s + m[1], 0);
    const out = [];
    const clearance = (def) => def.trailerLength || def.walker === 'elephant' ? 7 : 4;
    const taken = (x, y, def) => out.some((v) => Math.abs(v.x - x) + Math.abs(v.y - y) < Math.max(clearance(def), clearance(get(v.def)))) || (map.spawn && Math.abs(map.spawn.x - x) + Math.abs(map.spawn.y - y) < 3);
    const landNear = (x, y) => [1,2,3,4].some(r=>[[r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dy]) => BIOMES[at(x + dx, y + dy)].walkable && main(x + dx, y + dy)));
    const nearSettlement = (x, y) => (map.settlements || []).some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) <= 8);
    const types = MIX.map(([id]) => get(id));
    for (let i = 0; i < total; i++) {
      let def;
      if (i < types.length) def = types[i];
      else {
        let r = rnd() * weight;
        def = LIST[0];
        for (const [id, w] of MIX) { r -= w; if (r <= 0) { def = get(id); break; } }
      }
      for (let tries = 0; tries < 400; tries++) {
        const x = 1 + Math.floor(rnd() * (W - 2)), y = 1 + Math.floor(rnd() * (H - 2));
        const t = at(x, y);
        let ok;
        if (def.kind === 'water') ok = (t===B.WATER||t===B.RIVER)&&(def.id==='submarine'||landNear(x,y));
        else if (def.fly) ok = (t === B.WASTE || t === B.CITY) && main(x, y);
        else ok = (t === B.CITY || t === B.WASTE || t === B.SETTLEMENT || (tries > 200 && BIOMES[t].walkable && !BIOMES[t].level)) && main(x, y);
        if (!ok || taken(x, y, def)) continue;
        const pos={x:x+.5,y:y+.5,facingAngle:0};
        if(!canPlaceBody(map,def,pos)&&def.id==='submarine')pos.facingAngle=Math.PI/2;
        if(!canPlaceBody(map,def,pos)||out.some(v=>bodiesOverlap(bodyAt(def,pos),bodyAt(v.def,v))))continue;
        const intact = def.wreck === false || (nearSettlement(x, y) ? rnd() < settings.vehicleIntactChance * 2 : rnd() < settings.vehicleIntactChance);
        const hpPct = intact ? 1 : 0.1 + rnd() * 0.12;
        out.push({ id: 'w' + out.length, def: def.id, x: x + 0.5, y: y + 0.5,facingAngle:pos.facingAngle, hp: Math.round(def.hp * hpPct), fuel: intact ? Math.round(def.fuel.cap * 0.3) : 0, wreck: !intact });
        break;
      }
    }
    cache.list = out;
    return out;
  }


  // ---------- Вертикаль техники ----------
  // Единая шкала z (shared/levels.js): −5…−1 — под водой, 0 — поверхность, +1…+5 — высота построек и деревьев,
  // +6…+10 — воздух. У машины alt — прямо z: > 0 — высота полёта (+1…+5 — среди домов и деревьев, там бьёт о препятствия
  // выше машины — shared/houses.js obstacleZ; +6…+10 — свободное небо), < 0 — глубина подлодки (до −5).
  const DEPTH_MAX = 5, AIR_MAX = 10;
  // Глубина воды под клеткой: число клеток до ближайшего берега (не больше DEPTH_MAX); суша — 0.
  // У берега мелко (−1), в открытом море — до −5. Считается один раз на карту (волна от берега).
  function depthAt(map, x, y) {
    if (!map || !map.tiles) return 0;
    const W = map.width, H = map.height;
    let d = map.__depth;
    if (!d) {
      d = new Uint8Array(W * H);
      const swim = (t) => Boolean(BIOMES[t] && (BIOMES[t].swim || BIOMES[t].underwater));
      let front = [];
      for (let i = 0; i < W * H; i++) { if (swim(map.tiles[i])) d[i] = 255; else front.push(i); }
      // берег — 0; вода у края карты — открытое море
      for (let level = 1; level <= DEPTH_MAX && front.length; level++) {
        const next = [];
        for (const i of front) {
          const fx = i % W, fy = (i / W) | 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = fx + dx, ny = fy + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = ny * W + nx;
            if (d[j] === 255) { d[j] = level; next.push(j); }
          }
        }
        front = next;
      }
      for (let i = 0; i < W * H; i++) if (d[i] === 255) d[i] = DEPTH_MAX;
      Object.defineProperty(map, '__depth', { value: d, enumerable: false });
    }
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return DEPTH_MAX;
    return d[iy * W + ix];
  }
  const canDive = (def) => Boolean(def && def.dive);

  // ---------- Бортовое оружие: виды, установки, точки вылета ----------
  // Модельные координаты — метры, как у низкополигональных моделей (client/js/game/vehicle-mesh*.js): x — вправо по борту,
  // y — вперёд, z — вверх от земли. Клетка карты ≈ 1,51 м. Точка вылета снаряда = дуло / пилон / торпедный аппарат.
  const M_PER_TILE = 2 / (0.9 * (3.3 / 1.75) * 0.78);
  const UNITS_PER_M = 3.3 / 1.75; // высота в единицах рисунка (рост героя 3,3 = 1,75 м)
  // Виды оружия. item — профиль из предмета (пулемёт, гранатомёт); иначе свой профиль. medium — где работает:
  // air — только в воздухе (бомбы), water — торпеда идёт только по воде, deep — можно стрелять из-под воды.
  const ARMS = {
    mg: { name: 'Пулемёт', key: 'mg', icon: '⁞', deep: false },
    agl: { name: 'Автоматический гранатомёт', item: 'launcher_boom', icon: '◉', deep: false },
    cannon: { name: 'Автопушка 30 мм', icon: '▮', deep: false, profile: { fx: 'shell', proj: 42, damage: [22, 32], damageType: 'physical', range: 15, speed: 4, ammo: 'ammo_30mm', flags: ['armorPiercing'] } },
    tank_gun: { name: 'Танковая пушка 125 мм', icon: '■', deep: false, profile: { fx: 'shell', proj: 38, damage: [110, 150], damageType: 'physical', range: 18, speed: 0.33, ammo: 'ammo_tank_shell', flags: ['explosive', 'armorPiercing'], blast: 1.4 } },
    rockets: { name: 'Неуправляемые ракеты', icon: '➹', deep: false, profile: { fx: 'rocket', proj: 24, damage: [45, 65], damageType: 'physical', range: 18, speed: 3, ammo: 'ammo_rocket', flags: ['explosive'], blast: 1.5 } },
    missile: { name: 'Управляемая ракета', icon: '⇶', deep: true, guided: true, profile: { fx: 'missile', proj: 15, damage: [95, 135], damageType: 'physical', range: 24, speed: 0.5, ammo: 'ammo_missile', flags: ['explosive', 'guided'], blast: 1.6, turn: 4 } },
    torpedo: { name: 'Торпеда', icon: '⟿', deep: true, water: true, profile: { fx: 'torpedo', proj: 8, damage: [150, 200], damageType: 'physical', range: 22, speed: 0.35, ammo: 'ammo_torpedo', flags: ['explosive', 'torpedo'], blast: 2 } },
    bomb: { name: 'Авиабомба', icon: '●', deep: false, air: true, profile: { fx: 'bomb', proj: 6, damage: [130, 180], damageType: 'physical', range: 7, speed: 0.7, ammo: 'ammo_bomb', flags: ['explosive', 'bomb'], blast: 2.2 } },
  };
  // Профиль атаки вида без предмета (как Combat.profile)
  function armProfile(type) {
    const a = ARMS[type], p = a && a.profile;
    if (!p) return null;
    return { name: a.name, kind: 'ranged', fx: p.fx, proj: p.proj, damage: p.damage.map((d) => Math.max(1, Math.round(d * settings.vehicleArmsDamageFactor))), damageType: p.damageType, range: p.range, speed: p.speed, ammo: p.ammo, magazine: 0, reload: 0, flags: p.flags.slice(), class: 'vehicle', unarmed: false, blast: p.blast || 0, turn: (p.turn || 0) * settings.vehicleMissileTurnFactor, arm: type };
  }
  // Установка: frame — hull (корпус) или front/rear (поворотная башня); at — дуло при башне «прямо» (front — вперёд, rear — назад);
  // dir — куда смотрит неподвижная установка (0 — вперёд, π — назад); arc — полусектор наведения, градусов; draw — как дорисовать.
  const M = (frame, at, o = {}) => ({ frame, at, dir: o.dir || 0, arc: o.arc ?? (frame === 'hull' ? 30 : 180), draw: o.draw || null, up: Boolean(o.up), down: Boolean(o.down) });
  const pair = (x, y, z, o) => [M('hull', [-x, y, z], o), M('hull', [x, y, z], o)];
  const pairOn = (frame, x, y, z, o) => [M(frame, [-x, y, z], o), M(frame, [x, y, z], o)];
  const T = (px, py, arc = 180) => ({ pivot: [px, py], arc });
  const BACK = { dir: Math.PI };
  // Наборы оружия по машинам: turrets — поворотные башни (ось и сектор, как у моделей), groups — [вид, установки, предмет].
  const ARMAMENT = {
    motorcycle: { turrets: { front: T(0, 0.52) }, groups: [['mg', [M('front', [0, 1.32, 1.35])], 'mg_mower'], ['rockets', pair(0.36, 0.95, 0.72, { draw: 'pod' })], ['missile', [M('hull', [0.34, -0.25, 0.95], { draw: 'rail', arc: 180 })]], ['agl', [M('hull', [0, -1.15, 0.95], { ...BACK, draw: 'barrel' })]]] },
    car: { turrets: { front: T(0, -0.625) }, groups: [['mg', [M('front', [0, 0.625, 1.82])], 'mg_mower'], ['rockets', pair(0.68, 1.65, 0.88, { draw: 'pod' })], ['missile', pair(0.55, -0.35, 1.48, { draw: 'rail', arc: 180 })], ['agl', [M('hull', [0, -2.05, 0.94], { ...BACK, draw: 'barrel' })]]] },
    sedan: { turrets: { front: T(0, -0.525) }, groups: [['mg', [M('front', [0, 0.725, 1.82])], 'mg_mower'], ['rockets', pair(0.68, 1.85, 0.88, { draw: 'pod' })], ['missile', pair(0.55, -0.35, 1.48, { draw: 'rail', arc: 180 })], ['agl', [M('hull', [0, -2.3, 0.94], { ...BACK, draw: 'barrel' })]]] },
    armored_car: { turrets: { front: T(0, -1.025) }, groups: [['mg', [M('front', [0, 0.575, 2.07])], 'mg_hail'], ['rockets', pair(0.76, 1.9, 1.0, { draw: 'pod' })], ['missile', pair(0.6, -0.75, 1.72, { draw: 'rail', arc: 180 })], ['agl', [M('hull', [0, -2.35, 1.08], { ...BACK, draw: 'barrel' })]]] },
    truck: { turrets: { front: T(0, -1.7) }, groups: [['mg', [M('front', [0, -0.45, 0.911])], 'mg_mower'], ['rockets', pair(0.78, 2.1, 1.18, { draw: 'pod' })], ['missile', pair(0.55, 0.85, 1.92, { draw: 'rail', arc: 180 })], ['agl', [M('hull', [0, -2.65, 1.22], { ...BACK, draw: 'barrel' })]]] },
    cargo_truck: { turrets: { front: T(0, 2.85) }, groups: [['agl', [M('front', [0, 4.45, 3.378])], 'launcher_boom'], ['mg', [M('hull', [0, -4.15, 1.75], { ...BACK, draw: 'barrel', arc: 60 })], 'mg_mower'], ['rockets', pair(0.6, 0.6, 2.95, { draw: 'pod' })], ['missile', pair(1.05, 1.5, 2.65, { draw: 'rail', arc: 180 })]] },
    semi_truck: { turrets: { front: T(0, 4.8) }, groups: [['agl', [M('front', [0, 6.4, 3.378])], 'launcher_boom'], ['mg', [M('hull', [0, -6.3, 2.1], { ...BACK, draw: 'barrel', arc: 60 })], 'mg_mower'], ['rockets', pair(0.62, 2.7, 3.7, { draw: 'pod' })], ['missile', pair(1.1, 1.4, 3.7, { draw: 'rail', arc: 180 })]] },
    bus: { turrets: { front: T(0, -3.85) }, groups: [['mg', [M('front', [0, -2.6, 3.71])], 'mg_mower'], ['rockets', pair(0.85, 4.6, 3.32, { draw: 'pod' })], ['missile', pair(0.85, 0.6, 3.32, { draw: 'rail', arc: 180 })], ['agl', [M('hull', [0, -5.4, 1.55], { ...BACK, draw: 'barrel' })]]] },
    armored_bus: { turrets: { front: T(0, -3.85) }, groups: [['mg', [M('front', [0, -2.25, 3.71])], 'mg_mower'], ['rockets', pair(0.9, 4.6, 3.5, { draw: 'pod' })], ['missile', pair(0.9, 0.6, 3.5, { draw: 'rail', arc: 180 })], ['agl', [M('hull', [0, -5.45, 1.6], { ...BACK, draw: 'barrel' })]]] },
    apc: { turrets: { front: T(0, 0.6) }, groups: [['cannon', [M('front', [0, 3.4, 2.38])]], ['mg', [M('front', [0.32, 2.3, 2.38], { draw: 'barrel' })], 'mg_hail'], ['missile', pairOn('front', 0.78, 1.0, 2.62, { draw: 'rail' })], ['agl', [M('hull', [0, -3.3, 1.9], { ...BACK, draw: 'barrel' })]]] },
    ifv: { turrets: { front: T(0, -0.3) }, groups: [['cannon', [M('front', [0, 3.1, 2.25])]], ['mg', [M('front', [0.34, 2.0, 2.2], { draw: 'barrel' })], 'mg_mower'], ['missile', pairOn('front', 0.85, 0.2, 2.62, { draw: 'rail' })], ['agl', [M('hull', [0, -3.6, 2.0], { ...BACK, draw: 'barrel' })]]] },
    tank: { turrets: { front: T(0, -0.45) }, groups: [['tank_gun', [M('front', [0, 7.1, 2.26])]], ['mg', [M('front', [0.67, 0.1, 2.87])], 'mg_hail'], ['missile', [M('front', [0, 7.1, 2.26])]], ['agl', [M('front', [-0.75, -1.6, 2.72], { draw: 'barrel' })]]] },
    light_tank: { turrets: { front: T(0, -0.2) }, groups: [['tank_gun', [M('front', [0, 4.2, 1.94])]], ['mg', [M('front', [0.5, 0.65, 2.49])], 'mg_hail'], ['missile', pairOn('front', 0.95, 0.4, 2.3, { draw: 'rail' })], ['agl', [M('hull', [0, -3.05, 1.55], { ...BACK, draw: 'barrel' })]]] },
    rowboat: { turrets: { front: T(0, 1.15) }, groups: [['mg', [M('front', [0, 2.1, 0.95])], 'mg_mower'], ['rockets', pair(0.5, 0.9, 0.72, { draw: 'pod' })], ['torpedo', [M('hull', [0.62, 0.1, 0.42], { draw: 'torpedo' })]], ['missile', [M('hull', [-0.42, -1.05, 0.75], { draw: 'rail', arc: 180 })]]] },
    boat: { turrets: { front: T(0, 2.45, 90), rear: { pivot: [0, -2.45], arc: 90, base: Math.PI } }, groups: [['mg', [M('front', [0, 3.5, 1.52]), M('rear', [0, -3.5, 1.37])], 'mg_mower'], ['torpedo', pair(0.82, 0.6, 1.22, { draw: 'torpedo' })], ['missile', pair(0.55, -0.4, 2.12, { draw: 'rail', arc: 180 })], ['rockets', pair(0.62, 2.0, 1.4, { draw: 'pod' })]] },
    jetski: { turrets: { front: T(0, 0.95) }, groups: [['mg', [M('front', [0, 1.85, 1.15])], 'mg_mower'], ['torpedo', pair(0.5, 0.55, 0.4, { draw: 'torpedo' })], ['rockets', pair(0.48, 0.05, 0.78, { draw: 'pod' })], ['missile', [M('hull', [0, -1.1, 0.98], { draw: 'rail', arc: 180 })]]] },
    submarine: { dive: true, turrets: { front:T(0,65,90),rear:{pivot:[0,-58],arc:90,base:Math.PI} }, groups:[
      ['cannon',[M('front',[0,72,16.08])]],['mg',[M('rear',[0,-59.05,14.67])],'mg_hail'],
      ['torpedo',[...pair(3.5,84,5.8,{draw:'hatch'}),...pair(3.5,83.5,7.3,{draw:'hatch'}),...pair(3.5,82.5,8.8,{draw:'hatch'})]],
      ['missile',Array.from({length:10},(_,i)=>pair(3.25,8+i*5.1,14.22,{draw:'vls',up:true,arc:180})).flat()]
    ] },
    deep_submarine: { dive: true, turrets: { front: T(0, 2.3) }, groups: [['cannon', [M('front', [0, 3.35, 3.73])]], ['mg', [M('hull', [0, -2.4, 3.55], { ...BACK, draw: 'barrel', arc: 90 })], 'mg_hail'], ['torpedo', pair(0.6, 4.35, 2.05, { draw: 'hatch' })], ['missile', pair(0.25, -1.4, 3.4, { draw: 'vls', up: true, arc: 180 })]] },
    helicopter: { turrets: { front: T(0, 3.4, 90) }, groups: [['mg', [M('front', [0, 5.0, 0.4])], 'mg_mower'], ['cannon', pair(2.4, 0.95, 0.72, { draw: 'barrel' })], ['rockets', pair(1.5, 0.56, 0.72)], ['missile', pair(3.05, 0.52, 1.05, { arc: 180 })], ['torpedo', [M('hull', [0, 0.65, 0.42], { draw: 'torpedo' })]]] },
    plane: { turrets: { rear: { pivot: [0, -0.75], arc: 90, base: Math.PI } }, groups: [['cannon', pair(1.9, 2.75, 0.95)], ['mg', [M('rear', [0, -2.0, 2.48])], 'mg_mower'], ['rockets', [...pair(2.6, 1.3, 0.85), ...pair(3.15, 1.3, 0.85)]], ['bomb', pair(1.1, 0.3, 0.55, { down: true, arc: 180 })], ['torpedo', [M('hull', [0, 0.9, 0.62], { draw: 'torpedo' })]]] },
    mech_sentinel: { turrets: { front: T(0, 0) }, groups: [['mg', [M('front', [1.3, 2.15, 3.5])], 'mg_hail'], ['cannon', [M('front', [-1.3, 2.15, 3.5], { draw: 'barrel' })]], ['rockets', pairOn('front', 0.85, 0.45, 4.55, { draw: 'pod' })], ['missile', [M('front', [0, -0.75, 4.7], { draw: 'rail' })]]] },
    chicken_walker: { turrets: { front: T(0, 0) }, groups: [['mg', [M('front', [0.78, 1.45, 2.91])], 'mg_mower'], ['rockets', [M('front', [-0.78, 1.35, 2.91], { draw: 'pod' })]], ['missile', pairOn('front', 0.45, -0.55, 3.32, { draw: 'rail' })], ['agl', [M('front', [0, 1.25, 2.55], { draw: 'barrel' })]]] },
    elephant_walker: { turrets: { front: T(0, -0.2) }, groups: [['tank_gun', [M('front', [0, 2.9, 5.35])]], ['mg', pair(1.25, 3.3, 3.4, { draw: 'barrel', arc: 45 }), 'mg_hail'], ['rockets', pairOn('front', 0.9, 0.65, 5.35, { draw: 'pod' })], ['missile', pairOn('front', 0.32, 0.45, 5.68, { draw: 'rail' })]] }, // блоки ракет — на кронштейнах по бокам башни, направляющие — на её крыше
  };
  // Группы оружия машины: [{ id, type, name, item, mounts: [{ id, frame, at, dir, arc, draw }] }]; первая — по умолчанию
  function armsOf(def) {
    const spec = def && ARMAMENT[def.id];
    if (!spec) return [];
    if (spec.__groups) return spec.__groups;
    const groups = spec.groups.map(([type, mounts, item], gi) => ({ id: type, type, name: ARMS[type].name, icon: ARMS[type].icon, item: item || ARMS[type].item || null, deep: ARMS[type].deep, water: Boolean(ARMS[type].water), air: Boolean(ARMS[type].air), guided: Boolean(ARMS[type].guided), mounts: mounts.map((m, i) => ({ ...m, id: `${type}${i}`, group: type })) }));
    Object.defineProperty(spec, '__groups', { value: groups, enumerable: false });
    return groups;
  }
  const turretsOf = (def) => (def && ARMAMENT[def.id] && ARMAMENT[def.id].turrets) || {};
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const clampArc = (a, center, half) => center + Math.max(-half, Math.min(half, wrap(a - center)));
  const heading8 = (a) => Math.round((Number.isFinite(a) ? a : 0) / (Math.PI / 4)) * Math.PI / 4;
  // Угол башни относительно корпуса (как рисует модель): turretDir/rearTurretDir — 8 направлений карты
  function turretAngle(def, v, frame) {
    const t = turretsOf(def)[frame];
    if (!t) return 0;
    const heading = Number.isFinite(v.facingAngle)?v.facingAngle:0;
    const dir = frame === 'rear' ? (Number.isInteger(v.rearTurretDir) ? v.rearTurretDir : 4) : (Number.isInteger(v.turretDir) ? v.turretDir : Math.round(heading / (Math.PI / 4)));
    const base = t.base || 0;
    return clampArc(((dir % 8) * Math.PI / 4) - heading, base, (t.arc ?? 180) * Math.PI / 180);
  }
  // Точка установки в координатах модели (м) при текущем повороте башни
  function mountLocal(def, v, m) {
    if (m.frame === 'hull') return m.at.slice();
    const t = turretsOf(def)[m.frame];
    const a = turretAngle(def, v, m.frame) - (t.base || 0), c = Math.cos(a), s = Math.sin(a);
    const rx = m.at[0] - t.pivot[0], ry = m.at[1] - t.pivot[1];
    return [t.pivot[0] + c * rx + s * ry, t.pivot[1] - s * rx + c * ry, m.at[2]];
  }
  // Направление ствола установки в координатах модели (угол от «вперёд» к правому борту)
  function mountLocalDir(def, v, m) {
    if (m.frame === 'hull') return m.dir;
    const t = turretsOf(def)[m.frame];
    return turretAngle(def, v, m.frame) - (t.base || 0) + (t.base || 0);
  }
  // Точка вылета на карте: { x, y — клетки, z — м над водой/землёй (без высоты полёта), a — угол ствола на карте }
  function mountWorld(def, v, m) {
    const p = mountLocal(def, v, m), h = Number.isFinite(v.facingAngle)?v.facingAngle:0, ca = Math.cos(h), sa = Math.sin(h);
    const local = mountLocalDir(def, v, m);
    return { x: v.x + (-sa * p[0] + ca * p[1]) / M_PER_TILE, y: v.y + (ca * p[0] + sa * p[1]) / M_PER_TILE, z: p[2], a: h + local };
  }
  // Можно ли стрелять установкой в точку (сектор наведения от направления ствола «прямо»)
  function inArc(def, v, m, point) {
    const h = Number.isFinite(v.facingAngle)?v.facingAngle:0;
    const center = h + (m.frame === 'hull' ? m.dir : (turretsOf(def)[m.frame].base || 0));
    const half = (m.frame === 'hull' ? m.arc : (turretsOf(def)[m.frame].arc ?? 180)) * Math.PI / 180;
    const bearing = Math.atan2(point.y - v.y, point.x - v.x);
    return Math.abs(wrap(bearing - center)) <= half + 1e-6;
  }

  return { findBerth,walkerFeet,contactImpact,vehicleContact,motionHeading,bodyCellOverlapArea,HULL_METERS,LEVEL_METERS,canPlaceBody,dimensionsOf,bodyAt,pointBodyDistance,bodiesOverlap,bodyIntersectsCell,sweptBodyHit,settings, configure, TERRAIN, FUELS, LIST, get, randomDef, validateCatalogue, terrainOf, drive, canDrive, speedMul, fuelFor, ramDamage, armorCut, canTakeOff, repairNeed, drivable, worldSpawns,
    DEPTH_MAX, AIR_MAX, depthAt, canDive, M_PER_TILE, UNITS_PER_M, ARMS, ARMAMENT, armProfile, armsOf, turretsOf, turretAngle, heading8, clampArc, mountLocal, mountLocalDir, mountWorld, inArc };
});
