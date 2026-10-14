'use strict';
// Единый модуль настроек.
// Приоритет: флаги командной строки > переменные окружения > config.json > значения по умолчанию.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const DEFAULTS = {
  port: 3333, // порт HTTP/WebSocket
  host: '0.0.0.0', // адрес прослушивания (0.0.0.0 — доступен в локальной сети)
  dataDir: 'data', // папка данных (относительно корня проекта или абсолютный путь)
  backupDir: '', // папка резервных копий (пусто — рядом с папкой данных: data-backups)
  backupKeep: 10, // сколько последних резервных копий хранить (старые удаляются)
  backupIntervalMin: 60, // как часто сервер делает резервную копию, минут (0 — только при запуске и вручную)
  backupOnStart: true, // резервная копия при каждом запуске сервера (до миграций данных)
  eventCheckSec: 5, // как часто проверять расписание игровых событий, секунд (0 — не проверять)
  eventMinIntervalMin: 1, // повторяющееся событие — не чаще раза в N минут
  eventMaxScheduled: 100, // предел запланированных событий
  eventMaxDurationMin: 1440, // предел длительности события (двойной лут), минут
  eventHistory: 50, // сколько завершённых событий хранить
  autosaveSec: 30, // как часто сохранять состояние миров (враги, турели) и героев, секунд
  autoPort: false, // если порт занят — пробовать следующий
  autoPortTries: 20, // сколько следующих портов пробовать
  open: false, // открыть браузер после запуска
  maxBodyKb: 16, // максимальный размер JSON-запроса, КБ
  importMaxKb: 512, // максимальный размер файла героя при импорте, КБ
  characterImportForeign: 'appearance', // чужой или изменённый файл героя: appearance (только имя и внешность), full (весь герой после проверки), reject
  sessionTtlDays: 30, // срок жизни сессии, дней
  loginFailLimit: 10, // неудачных попыток входа до блокировки
  loginFailWindowMin: 5, // окно подсчёта неудачных попыток, минут
  usernameMin: 3,
  usernameMax: 20,
  passwordMin: 6,
  passwordMax: 128,
  worldCacheSize: 4, // сколько сгенерированных карт держать в памяти сервера
  wsPath: '/ws', // путь WebSocket на том же порту
  wsPingSec: 5, // период проверки живости соединений (ping)
  wsPongTimeoutSec: 12, // нет ответа на ping дольше — соединение закрывается, герой уходит из мира
  wsAuthTimeoutSec: 10, // сколько ждать приветствия после подключения
  wsMaxPayloadKb: 64, // максимальный размер сообщения WebSocket, КБ
  wsMaxMsgPerSec: 40, // сообщений в секунду от одного клиента (защита от флуда)
  wsBanCheckSec: 5, // как часто перепроверять сессии подключённых (бан, выход)
  wsCompress: true, wsCompressThreshold: 1024, // сжатие сообщений WebSocket (permessage-deflate) от N байт (шаг 20)
  crashSafe: true, // ошибка в обработчике или необработанное исключение не останавливает сервер (журнал + аварийное сохранение)
  logging: {
    enabled: false, // запись серверных журналов в log/ выключена по умолчанию
    directory: 'log', // папка журналов относительно каталога игры
    levels: { trace: true, debug: true, info: true, warn: true, error: true, fatal: true }, // шесть уровней; отдельные уровни можно выключить
  },
  // голосовой чат (шаг 18): TURN-сервер — не попадает в общие настройки клиента, выдаётся только вошедшим в голосовой канал
  voiceTurnUrl: '', voiceTurnUser: '', voiceTurnPass: '',
  game: {
    maxCharacters: 8, // персонажей на аккаунт
    importMaxCells: 65536, // предел ячеек инвентаря в импортируемом файле героя
    manualSaveCooldownSec: 5, // кнопка «Сохранить» в меню: не чаще раза в N секунд на мир
    ngPlusEnemyHpFactor: 0.75, // «Новая игра+»: здоровье врагов × (мир легче — герой уже прошёл игру)
    ngPlusEnemyDamageFactor: 0.75, // «Новая игра+»: урон врагов ×
    eventSpawnDist: 9, // событие «босс»: на каком расстоянии от случайного игрока появляется, клеток
    eventLootMultiplier: 2, // событие «двойной лут»: во сколько раз больше бросков добычи
    adminSpawnItemMax: 500, // панель ГМ: предел предметов за один спавн
    adminLogPageSize: 50, // панель ГМ: записей журнала на странице
    adminLogPageMax: 500, // панель ГМ: наибольший размер страницы журнала
    adminMaxStatPoints: 1000, // панель ГМ: предел свободных очков характеристик при правке героя
    maxBasesPerAccount: 1, // баз на аккаунт (база общая для всех героев аккаунта и переносится между мирами)
    baseSize: 24, // сторона участка базы, клеток
    baseMaxStructures: 2000, // предел сооружений в одной базе
    startPoints: 12, // свободных очков при создании персонажа
    startStatCap: 6, // максимум характеристики при создании
    companionsMax: 11, // предел характеристики «Напарники» (команда до 11)
    maxScars: 3,
    maxTattoos: 4,
    maxImplants: 4,
    maxWorlds: 10, // миров на аккаунт
    maxPlayers: 8, // игроков одновременно в одном мире
    shopItemsMax: 64, // позиций товаров в одной личной лавке
    shopBuyRange: 3, // дальность покупки в лавке, клеток
    tradeRange: 3, // дальность прямого обмена между героями
    tradeLifetimeSec: 180, // срок приглашения и подтверждения обмена
    maxWorldMembers: 32, // участников (по коду приглашения) в одном мире
    inviteCodeLength: 8, // длина кода приглашения (4–16)
    maxDragons: 20, // предел числа драконов в настройках мира
    worldSizes: { small: 128, medium: 256, large: 512, huge: 1024 }, // стороны карты в клетках
    heroSpeed: 4, // скорость героя, клеток в секунду
    enemySpeedFactor: 0.75, // множитель скорости наземных врагов при преследовании
    pathMaxNodes: 60000, // предел поиска пути A*
    moveTolerance: 1.5, // допуск проверки скорости на сервере
    maxPathLength: 5000, // предел длины пути от клиента, клеток
    pathStartTolerance: 3, // на сколько клеток начало пути может отставать от позиции на сервере
    tickRate: 10, // тиков сервера в секунду (рассылка позиций)
    interpDelayMs: 150, // задержка интерполяции других игроков на клиенте, мс
    reconcileSnapDistance: 3, // расхождение с сервером (клеток), при котором герой переставляется
    connTimeoutSec: 8, // нет данных от сервера дольше — соединение считается потерянным
    reconnectBaseMs: 500, // первая задержка переподключения, мс (дальше удваивается)
    reconnectMaxMs: 8000, // предельная задержка переподключения, мс
    reconnectMaxAttempts: 15, // попыток переподключения до возврата в список миров
    requireOwnerOnline: false, // гости могут войти, только пока владелец в мире
    chatMaxLength: 300, // максимальная длина сообщения чата, символов
    chatHistory: 50, // сколько последних сообщений мира получает вошедший игрок
    chatRateCount: 5, // сообщений чата не больше этого числа...
    chatRateWindowSec: 5, // ...за столько секунд
    chatLogLines: 200, // строк в окне чата на клиенте
    tileWidth: 64, // ширина изометрической клетки в пикселях при масштабе 1
    zoomMin: 0.35,
    zoomMax: 2.5,
    zoomDefault: 1,
    savePositionSec: 10, // как часто сохранять позицию героя
    renderChunkSize: 16, // сторона фрагмента карты в кэше рендера, клеток
    renderCacheBelowZoom: 0.75, // ниже этого масштаба карта рисуется из кэша фрагментов
    renderCacheMaxChunks: 256, // предел фрагментов в кэше
    baseSlots: 1024, // максимальная базовая вместимость
    maxInventorySlots: 65536,
    baseCarryKg: 1000000000, // переносимый вес, кг (в пределах точной арифметики JS)
    carryPerStrength: 1000000, // +кг за единицу Силы
    pickupRange: 1.6, // дальность подбора предметов с земли, клеток
    itemActionMax: 9999, // предел количества обычных предметов в одном действии
    groundItemsMax: 500, // предел предметов на земле в одном мире
    setArmorDropChance: 0.20, // отдельный шанс детали комплекта с любого врага
    setWeaponDropChance: 0.04, // отдельный шанс оружия комплекта
    groundItemTtlMin: 120, // совместимость со старыми настройками
    groundItemTtlSec: 7200, // выпавшие предметы (кроме постоянных тайников), 0 — сразу
    difficulty: 'normal',
    groundPurgeSec: 30, // как часто сервер убирает исчезнувшие предметы, секунд
    startingKit: 'knife_rusty,shirt_canvas,pants_burlap,feet_wraps,bag_canvas,ration*2,water_flask*2', // стартовый набор: id через запятую, количество после *
    // --- производные показатели героя ---
    hpBase: 80, hpPerStrength: 12, hpPerLevel: 8,
    staminaBase: 60, staminaPerStrength: 6, staminaPerStealth: 4,
    mpBase: 20, mpPerMagic: 15, mpPerIntellect: 5,
    // --- бой ---
    pvpAllowed: false,
    critBase: 0.05, critPerStealth: 0.01, critMax: 0.5, critMultiplier: 1.75,
    meleeBonusPerStrength: 0.04, magicBonusPerMagic: 0.05, energyBonusPerIntellect: 0.03,
    armorK: 50, armorNonPhysicalFactor: 0.5, armorPierceFactor: 0.5, resistMax: 0.8,
    unarmedDamageMin: 1, unarmedDamageMax: 3, unarmedSpeed: 1.5, unarmedRange: 1.1,
    meleeMaxRange: 2.6,
    meleeStaminaCost: 4, heavyStaminaFactor: 1.5, magicMpCost: 4,
    sprintMultiplier: 1.5, sprintStaminaPerSec: 12,
    staminaRegenPerSec: 6, hpRegenPerSec: 0.5, mpRegenPerSec: 1, regenDelaySec: 5, enemyRegenPctPerSec: .25, npcRegenPerSec: .5,
    attackSpeedTolerance: 0.85, meleeRangeTolerance: 0.6,
    durabilityLossChance: 0.25,
    cleaveArcDeg: 100, flameConeDeg: 40, spreadConeDeg: 30, spreadSecondaryFactor: 0.5, spreadPellets: 3,
    explosionRadius: 1.6, chainTargets: 2, chainRange: 3, chainFactor: 0.6,
    pullDistance: 3, lassoHoldSec: 2.5, lassoHoldPerTaming: 0.3, lassoBossHoldFactor: 0.3, knockbackDistance: 1.5, stunChance: 0.25, stunSec: 1,
    dotDurationSec: 3, dotBurnFactor: 0.3, dotPoisonFactor: 0.4, dotBleedFactor: 0.3,
    empRobotFactor: 2, noiseRadius: 12, thrownRecoverChance: 0.6, projectileRadius: 0.25,
    trapArmSec: 1.5, trapTriggerRadius: 0.7, trapImmobilizeSec: 4, trapLifetimeMin: 30, maxTrapsPerPlayer: 8,
    bossSpawnChance: 0.03, maxBossesPerRoom: 1, bossAnnounce: true, dragonLairRadius: 14,
    turretLifetimeSec: 300, maxTurretsPerPlayer: 3, turretHpBase: 150, turretHpPerTier: 0.5, turretDefense: 6, turretRadius: 0.4,
    turretMaxTier: 3, turretTierDamage: 0.35, turretTierRange: 0.15, turretTierFireRate: 0.2, turretTierMagazine: 0.5,
    turretUpgradeItem: 'scrap_metal', turretUpgradeCount: 6, turretUpgradeItem2: 'electronics', turretUpgradeCount2: 2,
    turretRepairItem: 'scrap_metal', turretRepairHpPerItem: 40, turretInteractRange: 3, turretDefaultMode: 'nearest',
    // --- опыт и уровни ---
    xpBase: 100, xpExponent: 1.5, maxLevel: 999, maxEnemyLevel: 99, maxStat: 999, statPointsPerLevel: 3, xpShareRadius: 20, levelUpHeal: true,
    // --- смерть ---
    respawnSec: 5, respawnHpFraction: 1, deathDropItems: false, settlementVisitRadius: 3,
    corpseLifetimeSec: 60,
    // --- враги ---
    enemyHpPerLevel: 0.15, enemyDamageFactor: 0.8, enemyDamagePerLevel: 0.045, enemyDefensePerLevel: 0.5, enemyXpPerLevel: 0.2,
    spawnAreaSize: 16, spawnActiveRadius: 40, spawnMinPlayerDist: 14, spawnSafeRadius: 14, settlementSafeRadius: 5,
    areaBaseCap: 3, densityLow: 0.5, densityNormal: 1, densityHigh: 1.7,
    enemyRespawnSec: 90, enemyPopulation: 100, despawnDelaySec: 60, maxEnemiesPerRoom: 250, spawnCheckSec: 1,
    levelPerTiles: 12, scaleMode: 'avg', scaleLevelSpread: 1,
    bossSpeedFactor: 0.55, bossAttackSpeedMax: 0.5,
    aiRepathSec: 0.6, aiPathMaxNodes: 1500, aiWanderRadius: 4, packAggroRadius: 8, fleeRecoverSec: 4, leashHealPerSec: 0.5, enemySeparation: 0.6,
    aiIdleMinSec: 2, aiIdleMaxSec: 6, aiRetreatStep: 3, aiFleeStep: 5,
    hordeIntervalRareMin: 30, hordeIntervalNormalMin: 15, hordeIntervalOftenMin: 7, hordeSizeMin: 4, hordeSizeMax: 8, hordeSpawnDist: 22,
    // --- добыча ---
    lootLevelSlack: 2, lootRarityWeights: '60,25,10,4,1', lootChanceFactor: 1, lootScatter: 0.8,
    // --- роботы и дроны на дне ---
    robotsWalkSeabed: true,
    // --- администратор ---
    adminKillRadius: 15, adminSpawnMax: 30, combatInvSyncSec: 2,
    dropOffsetMin: 0.35, dropOffsetMax: 0.7,
    // --- выживание (шаг 9) ---
    survivalEnabled: true, survivalFoodPerMin: 1, survivalWaterPerMin: 1.4, survivalRestPerMin: 0.7,
    survivalSprintWaterFactor: 2, survivalSprintRestFactor: 1.5,
    survivalSitRestPerMin: 8, survivalSleepRestPerMin: 20, survivalUnsafeRestFactor: 0.25, survivalRestVitalsFactor: 2, survivalRestSafeRadius: 10,
    survivalLow: 30, survivalCritical: 10, survivalStarveHpPerSec: 0.2, survivalThirstHpPerSec: 0.15, survivalCanKill: false,
    survivalThirstStaminaMaxLow: 0.8, survivalThirstStaminaMaxZero: 0.5, survivalThirstStaminaRegenLow: 0.5, survivalThirstStaminaRegenZero: 0.25,
    survivalTiredMpRegen: 0.5, survivalExhaustedMpRegen: 0, survivalExhaustedPenalty: 0.2,
    survivalRadPerMin: 4, survivalRadDecayPerMin: 0.5, survivalRadSickAt: 50, survivalRadMaxHpLoss: 0.5,
    survivalRadCityThreshold: 0.74, survivalCratersPer128: 1, survivalCraterRadius: 6,
    survivalIllMin: 8, survivalIllDrainFactor: 2, survivalSpoilMin: 60, survivalSpoiledIllChance: 0.6, survivalSpoiledFactor: 0.5,
    survivalCampfireMin: 10, survivalCampfireRange: 2, survivalMaxCampfires: 2,
    survivalDrinkRange: 1.6, survivalDrinkWater: 20, survivalDrinkIllChance: 0.2, survivalDrinkRad: 2, survivalDrinkCooldownSec: 1.5,
    survivalWarnCooldownSec: 60, survivalRespawnMin: 50,
    survivalDifficultyEasy: 0.5, survivalDifficultyNormal: 1, survivalDifficultyHard: 1.5, survivalDifficultyBrutal: 2,
    // --- база, строительство, добыча, крафт (шаг 10) ---
    baseRadius: 10, baseMinSettlementDist: 20, baseMinSpawnDist: 16, buildRange: 7, buildRefund: 0.5, buildRepairFactor: 0.25,
    buildMaxPerBase: 400, spikeDamage: 8, spikeIntervalSec: 1, pieceHpFactor: 1, enemyPieceDamageFactor: 1,
    gatherRange: 1.8, gatherCooldownSec: 0.8, gatherUses: 4, gatherRespawnMin: 15,
    gatherTreeChance: 0.1, gatherRockChance: 0.07, gatherRuinChance: 0.05, gatherToolBonus: 2,
    craftQueueMax: 5, craftStationRange: 3, craftTimeFactor: 1,
    // --- спутники, приручение, драконы (шаг 11) ---
    compEnabled: true,
    compTameBase: 0.35, compTamePerStat: 0.06, compTameLevelPenalty: 0.03, compTameHpBonus: 0.3, compTameFoodBonus: 0.15,
    compChanceMin: 0.02, compChanceMax: 0.95, compTryCooldownSec: 3, compTameRange: 3,
    compDragonFactor: 0.25, compDragonItem: 'dragon_charm', compDragonMinTaming: 5,
    compPersuadeBase: 0.25, compPersuadePerStat: 0.07, compRecruitGoldPerLevel: 0.5, compRecruitPaidBonus: 0.3, compReputationBonus: 0.1,
    compSuggestBase: 0.4, compSuggestPerStat: 0.06, compSuggestMpCost: 30, compSuggestSec: 90, compSuggestSecPerStat: 15,
    compHackBase: 0.3, compHackPerStat: 0.07, compHackItem: 'electronics',
    compFollowDist: 2.2, compGuardRadius: 6, compAggroRadius: 7, compLeash: 14, compFleeAt: 0.2, compRegenPerSec: 0.5,
    compXpShare: 0.5, compLevelHpBonus: 0.1, compReviveSec: 60, compReviveRange: 2, compReviveHp: 0.3, compPermadeath: true,
    compFoodPerMin: 1, compHungryAt: 20, compShrinkerRequired: true,
    compMountSpeed: 1.8, compMountRange: 2.5, compBreathCooldownSec: 4, compBreathRange: 6, compBreathAngle: 40, compBreathFactor: 1.2,
    depotsPer256: 2, depotWakeRadius: 30, depotGuards: 3, depotGuardLevel: 8, depotRadius: 4, depotRespawnMin: 0,
    // --- магия (шаг 12) ---
    magicEnabled: true, magicLevelScaling: 0.04, magicAffinityPerStat: 0.04, magicPowerPerPoint: 0.03, magicPowerMax: 10,
    magicGcdSec: 0.4, magicRangeTolerance: 0.6, magicInterruptOnMove: true, magicInterruptOnDamage: true, magicMaxKnown: 128,
    magicTelepathyRange: 10, magicTelepathyMpCost: 15, magicTeachMpCost: 10, magicAskTimeoutSec: 30,
    magicStealRange: 6, magicStealBase: 0.2, magicStealPerStat: 0.05, magicStealLevelPenalty: 0.02, magicStealMpCost: 25, magicStealCooldownSec: 15,
    magicKillGrantChance: 0.5, magicKillPowerBoost: 1,
    magicChanceMin: 0.03, magicChanceMax: 0.9, magicEnemyCastFactor: 1, magicEnemyDamageFactor: 0.8,
    magicMaxSummons: 1,
    // --- вертикальные уровни (шаг 13) ---
    levelsEnabled: true, levelEntrancesPer256: 10, levelSize: 48, levelDepthEnemyBonus: 2, levelEnemiesBase: 5, levelEnemiesPerDepth: 2,
    levelCacheBase: 1, levelCachePerDepth: 1, levelEntranceRadius: 1.6, levelRespawnMin: 120, levelMaxPlayers: 0,
    breathSec: 25, scubaBreathSec: 150, airTankSec: 90, breathRegenPerSec: 20, drownDamagePct: 8, diveFreeDepth: 1,
    swimSpeed: 0.45, swimStaminaPerSec: 4, fallDamagePct: 12, airDismount: 'block', airMaxAltitude: 5, levelElevator: true,
    // дома с интерьерами (shared/houses.js)
    housesEnabled: true, houseCityChance: 0.12, houseWildChance: 0.006, houseMaxFloors: 5, houseMaxBasement: 5, houseEnemyChance: 0.3, houseNeutralChance: 0.15, houseResidentChance: 0.3,
    // --- транспорт (шаг 14) ---
    vehiclesEnabled: true, vehicleWrecksPer256: 14, vehicleRespawnSec: 60, vehicleIntactChance: 0.12, vehicleEnterRange: 2.2, vehicleSpeedFactor: 1,
    vehicleFuelFactor: 1, vehicleRamMinSpeed: 3, vehicleRamFactor: 1, vehicleRamSelfPct: 15, vehicleCrashDamagePct: 4,
    vehicleRepairPerParts: 20, vehicleFieldRepairMaxPct: 100, vehicleAutoRepairPctPerSec: .25, vehicleWreckMinPct: 25, vehicleMaxPerWorld: 200, vehicleOwnedPerPlayer: 5,
    vehicleGuestDrive: true, vehicleDiveMaxDepth: 5, vehicleArmsDamageFactor: 1, vehicleMissileTurnFactor: 1, vehicleLowFlyHitPct: 10,
    autoUseEnabled: true, autoUseThresholdPct: 40, autoUseRadAt: 40, autoUseIntervalSec: 1.5, autoUseRetrySec: 20,
    // поселения (шаг 15, shared/settlements.js)
    settlementsEnabled: true, settlementLayout: true, settlementWakeRadius: 30, settlementTalkRange: 3, settlementNpcRespawnSec: 300, questItemRespawnSec: 300, settlementRestockMin: 30, tradeBuyFactor: 1.2, tradeSellFactor: 0.4, tradeRepPriceMax: 0.3, tradeDamagedFactor: 1.5, healPricePerHp: 0.5, curePrice: 60, spellPricePerTier: 150, recipePriceFactor: 2, repTradePer: 500, repAssault: 10, repMurder: 40, repDefend: 15, repFactionShare: 0.25, repHostileAt: -50, repUnfriendlyAt: -15, repFriendlyAt: 25, repHonoredAt: 60, wantedSec: 120, guardAggroRadius: 8, guardLeash: 10, raidRewardGold: 2, raidMaxMin: 6, raidDamagePerSec: 0.5, settlementRegenPerMin: 2, settlementPvpOff: true,
    // фракции (шаг 16, shared/factions.js)
    factionsEnabled: true, factionAttackAt: -15, factionAllyShare: 0.3, factionEnemyShare: 0.5, factionKillRep: 6, factionBossKillRep: 30, factionAttackRep: 3, factionTownWeight: 0.5,
    // задания и концовки (шаг 16, shared/quests.js)
    questsEnabled: true, questBoardSize: 3, questBoardRefreshMin: 60, questMaxActive: 8, questBossDist: 45, questRewardFactor: 1, questEscortSpeed: 2.6, questDeliverMaxDist: 160, endingRuleGangs: 2,
    // семья (шаг 17, shared/family.js)
    familyEnabled: true, familyTalkAffinity: 4, familyTalkCooldownMin: 10, familyGiftValuePer: 10, familyGiftMax: 15, familyGiftCooldownMin: 2, familyQuestAffinity: 5, familyHelpAffinity: 8, familyCourtAt: 60, familyProposeAt: 80, familyOppositeSex: true, familyCeremonyCost: 200, familyMaxMembers: 8, familyDayMin: 24, familyPregnancyMin: 30, familyChildYearMin: 60, familyAdultAge: 16, familyOrphansPerTown: 2, familyHelperTickSec: 5, familyGuardRadius: 12, familyGuardDamage: 8, familyCraftSpeedup: 0.25, familyGatherMin: 3, familyHealPerTick: 3, familyBondAskSec: 60,
    // голосовой чат (шаг 18, shared/voice.js)
    voiceEnabled: true, voiceMaxPeers: 8, voiceProximityRadius: 24, voiceProximityFull: 4, voiceDefaultMode: 'ptt', voicePttKey: 'KeyV', voiceStunUrls: '', voiceMaxSigKb: 16, voiceVadThreshold: 0.05, voiceVadHangMs: 400, voiceMuteDefaultMin: 60,
    // графика и арт (шаг 19, shared/art.js)
    graphicsRenderer: 'art', graphicsQuality: 'medium', artDayMin: 30, artNightDark: 0.45, artUnderLight: 7, artParticleMax: 300, artTextureSize: 32,
    // производительность и сеть (шаг 20)
    netViewRadius: 40, netDelta: true, netKeyframeSec: 5, aiSleepRadius: 48, fpsCap: 60, fpsIdle: 20, idleAfterSec: 3, autoQualityFps: 24, batterySaver: true, perfOverlay: false,
    // чит-панель (шаг 20)
    cheatsForAll: false, cheatSpeedMax: 5, cheatKillRadius: 15, cheatListRadius: 40, worldEditMaxProps: 2000, worldEditOpenRange: 2,
    // камера и туман войны (шаг 22, shared/camera.js, shared/fog.js)
    cameraPanSpeed: 18, cameraSmoothSec: 0.12, cameraEdgeScroll: false, cameraArrowKeys: true, cameraEdgePx: 12, cameraFollowDefault: true,
    fogMode: 'on', fogRadius: 12, fogNightMul: 0.65, fogUndergroundMul: 0.6, fogShared: true, fogServerCull: true, fogDimAlpha: 0.55,
    // --- отображение боя на клиенте ---
    dmgNumberMs: 900, hitFlashMs: 140, enemyFadeMs: 600, hpBarShowSec: 4, groundOnTopRadius: 0.9,
    chaseRepathMs: 400, meleeApproachMargin: 0.15, fxMaxAgeMs: 450,
  },
};

// Описание настроек для справки (--help)
const DESCRIPTIONS = {
  'logging.enabled': 'записывать ли сообщения сервера в файлы (по умолчанию выключено; требует перезапуска)',
  'logging.directory': 'папка файлов журнала относительно каталога игры (по умолчанию log)',
  'logging.levels.trace': 'записывать подробные трассировочные сообщения',
  'logging.levels.debug': 'записывать отладочные сообщения',
  'logging.levels.info': 'записывать обычные информационные сообщения',
  'logging.levels.warn': 'записывать предупреждения',
  'logging.levels.error': 'записывать ошибки',
  'logging.levels.fatal': 'записывать критические ошибки',
  'game.baseRadius': 'радиус участка базы вокруг флага, клеток',
  'game.baseMinSettlementDist': 'на сколько клеток (плюс радиус участка) база должна отстоять от поселений',
  'game.baseMinSpawnDist': 'на сколько клеток (плюс радиус участка) база должна отстоять от точки появления мира',
  'game.buildRange': 'как далеко от героя можно строить, клеток',
  'game.buildRefund': 'какая доля материалов возвращается при сносе постройки',
  'game.buildRepairFactor': 'доля стоимости постройки на полный ремонт (пропорционально урону)',
  'game.buildMaxPerBase': 'предел построек в одной базе',
  'game.spikeDamage': 'урон кольев врагу за удар',
  'game.spikeIntervalSec': 'как часто колья ранят стоящего на них врага, секунд',
  'game.pieceHpFactor': 'множитель прочности всех построек',
  'game.enemyPieceDamageFactor': 'множитель урона врагов по постройкам',
  'game.gatherRange': 'дальность добычи (деревья, валуны, завалы), клеток',
  'game.gatherCooldownSec': 'пауза между ударами при добыче, секунд',
  'game.gatherUses': 'сколько ударов выдерживает ресурсная точка до истощения',
  'game.gatherRespawnMin': 'через сколько минут истощённая точка восстанавливается',
  'game.gatherTreeChance': 'доля лесных клеток с деревом для рубки (0…1)',
  'game.gatherRockChance': 'доля клеток предгорий с валуном (в пустошах и пустынях — вчетверо меньше)',
  'game.gatherRuinChance': 'доля клеток руин с завалом',
  'game.gatherToolBonus': 'во сколько раз больше добыча подходящим инструментом',
  'game.craftQueueMax': 'сколько заказов может стоять в очереди крафта у одного героя',
  'game.craftStationRange': 'на каком расстоянии от станка можно крафтить, клеток',
  'game.craftTimeFactor': 'множитель времени крафта (0 — мгновенно)',
  'game.survivalEnabled': 'выживание (голод, жажда, усталость, радиация) на сервере; миры могут выключить его у себя',
  'game.survivalFoodPerMin': 'на сколько падает сытость в минуту (из 100)',
  'game.survivalWaterPerMin': 'на сколько падает вода в минуту (из 100)',
  'game.survivalRestPerMin': 'на сколько падает бодрость в минуту (из 100)',
  'game.survivalSprintWaterFactor': 'во сколько раз быстрее падает вода при беге',
  'game.survivalSprintRestFactor': 'во сколько раз быстрее падает бодрость при беге',
  'game.survivalSitRestPerMin': 'сколько бодрости в минуту даёт отдых сидя (Z)',
  'game.survivalSleepRestPerMin': 'сколько бодрости в минуту даёт сон (спальник в сумке или поселение)',
  'game.survivalUnsafeRestFactor': 'множитель отдыха, когда рядом враги (небезопасно)',
  'game.survivalRestVitalsFactor': 'во сколько раз быстрее восстанавливаются здоровье и мана во время отдыха',
  'game.survivalRestSafeRadius': 'отдых безопасен, если ближе этого числа клеток нет врагов',
  'game.survivalLow': 'порог «мало» для шкал (голод: нет восстановления здоровья, жажда: меньше выносливости, усталость: меньше маны)',
  'game.survivalCritical': 'порог «критично» для шкал (усталость: мана не восстанавливается)',
  'game.survivalStarveHpPerSec': 'сколько здоровья в секунду отнимает голод при нулевой сытости',
  'game.survivalThirstHpPerSec': 'сколько здоровья в секунду отнимает жажда при нулевой воде',
  'game.survivalCanKill': 'может ли голод/жажда убить (false — здоровье не опускается ниже 1)',
  'game.survivalThirstStaminaMaxLow': 'множитель максимума выносливости при малой воде',
  'game.survivalThirstStaminaMaxZero': 'множитель максимума выносливости при нулевой воде',
  'game.survivalThirstStaminaRegenLow': 'множитель восстановления выносливости при малой воде',
  'game.survivalThirstStaminaRegenZero': 'множитель восстановления выносливости при нулевой воде',
  'game.survivalTiredMpRegen': 'множитель восстановления маны при малой бодрости',
  'game.survivalExhaustedMpRegen': 'множитель восстановления маны при критической бодрости',
  'game.survivalExhaustedPenalty': 'штраф к урону и скорости при нулевой бодрости (доля)',
  'game.survivalRadPerMin': 'сколько радиации в минуту набирается за каждый уровень зоны (1–3)',
  'game.survivalRadDecayPerMin': 'на сколько радиация спадает в минуту вне зоны',
  'game.survivalRadSickAt': 'с какого уровня радиации начинается лучевая болезнь',
  'game.survivalRadMaxHpLoss': 'на какую долю уменьшается максимум здоровья при радиации 100',
  'game.survivalRadCityThreshold': 'порог шума для радиоактивных пятен в руинах города (0…1, больше — меньше пятен)',
  'game.survivalCratersPer128': 'сколько радиоактивных воронок на каждые 128×128 клеток',
  'game.survivalCraterRadius': 'радиус воронки, клеток',
  'game.survivalIllMin': 'сколько минут длится болезнь (от грязной воды, сырого или испорченного)',
  'game.survivalIllDrainFactor': 'во сколько раз быстрее голод и жажда при болезни',
  'game.survivalSpoilMin': 'через сколько минут портится сырая еда (0 — не портится)',
  'game.survivalSpoiledIllChance': 'шанс заболеть от испорченной еды',
  'game.survivalSpoiledFactor': 'какую долю пользы даёт испорченная еда',
  'game.survivalCampfireMin': 'сколько минут горит костёр',
  'game.survivalCampfireRange': 'на каком расстоянии от костра можно готовить, клеток',
  'game.survivalMaxCampfires': 'сколько костров одновременно может развести один игрок',
  'game.survivalDrinkRange': 'на каком расстоянии от воды можно пить (G), клеток',
  'game.survivalDrinkWater': 'сколько воды даёт глоток из реки или озера',
  'game.survivalDrinkIllChance': 'шанс заболеть от воды из реки/озера',
  'game.survivalDrinkRad': 'сколько радиации даёт глоток из реки/озера',
  'game.survivalDrinkCooldownSec': 'пауза между глотками из реки/озера, секунд',
  'game.survivalWarnCooldownSec': 'как часто повторять предупреждения о голоде/жажде/усталости, секунд',
  'game.survivalRespawnMin': 'после смерти сытость, вода и бодрость — не меньше этого значения',
  'game.survivalDifficultyEasy': 'множитель расхода шкал и радиации для сложности «Лёгкое»',
  'game.survivalDifficultyNormal': 'множитель для сложности «Обычное»',
  'game.survivalDifficultyHard': 'множитель для сложности «Тяжёлое»',
  'game.survivalDifficultyBrutal': 'множитель для сложности «Суровое»',
  port: 'порт сервера',
  host: 'адрес прослушивания',
  dataDir: 'папка данных',
  backupDir: 'папка резервных копий (пусто — рядом с папкой данных, «data-backups»)',
  backupKeep: 'сколько последних резервных копий хранить; старые удаляются',
  backupIntervalMin: 'период резервного копирования работающим сервером, минут (0 — выкл.)',
  backupOnStart: 'делать резервную копию при запуске сервера (true/false)',
  eventCheckSec: 'как часто проверять расписание игровых событий, секунд (0 — не проверять)',
  eventMinIntervalMin: 'повторяющееся игровое событие — не чаще раза в N минут',
  eventMaxScheduled: 'предел запланированных игровых событий',
  eventMaxDurationMin: 'предел длительности игрового события (например, двойного лута), минут',
  eventHistory: 'сколько завершённых игровых событий хранить',
  autosaveSec: 'период автосохранения состояния миров (враги, боссы, турели, мины) и героев, секунд; 0 — только при уходе последнего игрока, остановке и по кнопке «Сохранить»',
  autoPort: 'если порт занят — занять следующий свободный',
  autoPortTries: 'сколько портов пробовать при autoPort',
  open: 'открыть браузер после запуска',
  maxBodyKb: 'максимальный размер запроса, КБ',
  importMaxKb: 'максимальный размер файла героя при импорте, КБ',
  characterImportForeign: 'файл героя с другого сервера, другого аккаунта или изменённый: appearance — только имя и внешность (герой 1-го уровня), full — весь герой после строгой проверки, reject — отказ',
  sessionTtlDays: 'срок жизни сессии, дней',
  loginFailLimit: 'неудачных попыток входа до временной блокировки',
  loginFailWindowMin: 'окно подсчёта неудачных попыток, минут',
  usernameMin: 'минимальная длина имени аккаунта',
  usernameMax: 'максимальная длина имени аккаунта',
  passwordMin: 'минимальная длина пароля',
  passwordMax: 'максимальная длина пароля',
  'game.maxCharacters': 'персонажей на аккаунт',
  'game.importMaxCells': 'предел ячеек инвентаря в импортируемом файле героя',
  'game.manualSaveCooldownSec': 'кнопка «Сохранить» в меню (владелец мира): не чаще раза в N секунд на мир',
  'game.ngPlusEnemyHpFactor': '«Новая игра+»: множитель здоровья врагов (меньше 1 — мир легче)',
  'game.ngPlusEnemyDamageFactor': '«Новая игра+»: множитель урона врагов',
  'game.eventSpawnDist': 'игровое событие «босс» / «супер-босс»: расстояние появления от случайного игрока, клеток',
  'game.eventLootMultiplier': 'игровое событие «двойной лут»: во сколько раз больше бросков добычи с врага',
  'game.adminSpawnItemMax': 'панель ГМ: предел предметов за один спавн на землю',
  'game.adminLogPageSize': 'панель ГМ: записей журнала на странице',
  'game.adminLogPageMax': 'панель ГМ: наибольший размер страницы журнала',
  'game.adminMaxStatPoints': 'панель ГМ: предел свободных очков характеристик при правке героя',
  'game.maxBasesPerAccount': 'баз на аккаунт (база общая для героев аккаунта, переносится между мирами)',
  'game.baseSize': 'сторона участка базы, клеток',
  'game.baseMaxStructures': 'предел сооружений в одной базе',
  'game.startPoints': 'свободных очков при создании персонажа',
  'game.startStatCap': 'максимум характеристики при создании',
  'game.companionsMax': 'предел характеристики «Напарники»',
  'game.maxScars': 'максимум шрамов',
  'game.maxTattoos': 'максимум татуировок',
  'game.maxImplants': 'максимум имплантов',
  worldCacheSize: 'сгенерированных карт в памяти сервера',
  'game.maxWorlds': 'миров на аккаунт',
  'game.maxPlayers': 'игроков одновременно в одном мире',
  'game.shopItemsMax': 'позиций товаров в личной лавке',
  'game.shopBuyRange': 'дальность покупки в личной лавке, клеток',
  'game.tradeRange': 'дальность прямого обмена между героями, клеток',
  'game.tradeLifetimeSec': 'срок приглашения и подтверждения обмена, секунд',
  'game.maxWorldMembers': 'участников мира (присоединившихся по коду)',
  'game.inviteCodeLength': 'длина кода приглашения, 4–16 символов',
  'game.maxDragons': 'максимум драконов в настройках мира',
  'game.worldSizes.small': 'сторона маленькой карты, клеток',
  'game.worldSizes.medium': 'сторона средней карты, клеток',
  'game.worldSizes.large': 'сторона большой карты, клеток',
  'game.worldSizes.huge': 'сторона огромной карты, клеток',
  'game.heroSpeed': 'скорость героя, клеток в секунду',
  'game.enemySpeedFactor': 'множитель скорости наземных врагов при преследовании',
  'game.pathMaxNodes': 'предел поиска пути (узлов A*)',
  'game.moveTolerance': 'допуск проверки скорости на сервере',
  'game.maxPathLength': 'предел длины пути от клиента, клеток',
  'game.pathStartTolerance': 'допустимое отставание начала пути от позиции на сервере, клеток',
  'game.tickRate': 'тиков сервера в секунду (рассылка позиций), 1–60',
  'game.interpDelayMs': 'задержка интерполяции других игроков, мс',
  'game.reconcileSnapDistance': 'расхождение с сервером, при котором герой переставляется, клеток',
  'game.connTimeoutSec': 'тишина от сервера, после которой клиент переподключается, секунд',
  'game.reconnectBaseMs': 'первая задержка переподключения, мс',
  'game.reconnectMaxMs': 'предельная задержка переподключения, мс',
  'game.reconnectMaxAttempts': 'попыток переподключения',
  'game.requireOwnerOnline': 'гости входят в мир, только пока в нём владелец',
  'game.chatMaxLength': 'максимальная длина сообщения чата, символов',
  'game.chatHistory': 'последних сообщений чата, которые получает вошедший игрок',
  'game.chatRateCount': 'сообщений чата за окно chatRateWindowSec (ограничение частоты)',
  'game.chatRateWindowSec': 'окно ограничения частоты чата, секунд',
  'game.chatLogLines': 'строк в окне чата на клиенте',
  wsPath: 'путь WebSocket',
  wsPingSec: 'период проверки живости соединений, секунд',
  wsPongTimeoutSec: 'нет ответа на ping дольше стольких секунд — соединение рвётся, герой исчезает из мира (закрытый браузер, пропавшая сеть)',
  wsAuthTimeoutSec: 'ожидание приветствия после подключения, секунд',
  wsMaxPayloadKb: 'максимальный размер сообщения WebSocket, КБ',
  wsMaxMsgPerSec: 'сообщений в секунду от клиента (защита от флуда)',
  wsCompress: 'сжимать сообщения WebSocket (permessage-deflate): меньше трафика по сети, чуть больше работы процессора',
  wsCompressThreshold: 'сжимать только сообщения не короче стольких байт',
  crashSafe: 'ошибка в обработчике сообщения, тике расширения или необработанное исключение не останавливает сервер: пишется в журнал, миры сохраняются; false — сервер падает (для отладки)',
  wsBanCheckSec: 'период перепроверки сессий подключённых, секунд',
  voiceTurnUrl: 'голосовой чат: адрес TURN-сервера (turn:хост:порт или turns:…) для игроков за строгим NAT; пусто — без TURN',
  voiceTurnUser: 'голосовой чат: имя пользователя TURN-сервера',
  voiceTurnPass: 'голосовой чат: пароль TURN-сервера (выдаётся только игрокам, вошедшим в голосовой канал)',
  'game.tileWidth': 'ширина клетки на экране при масштабе 1, пикселей',
  'game.zoomMin': 'минимальный масштаб (колесо мыши)',
  'game.zoomMax': 'максимальный масштаб',
  'game.zoomDefault': 'масштаб при входе в мир',
  'game.savePositionSec': 'период сохранения позиции героя, секунд',
  'game.renderChunkSize': 'сторона фрагмента кэша рендера, клеток',
  'game.renderCacheBelowZoom': 'ниже этого масштаба рисовать из кэша фрагментов',
  'game.renderCacheMaxChunks': 'предел фрагментов в кэше рендера',
  'game.baseSlots': 'ячеек инвентаря без рюкзака и пояса',
  'game.maxInventorySlots': 'максимум ячеек инвентаря',
  'game.setArmorDropChance': 'шанс детали комплекта с любого врага (0…1)',
  'game.setWeaponDropChance': 'шанс оружия комплекта с любого врага (0…1)',
  'game.baseCarryKg': 'переносимый вес без учёта Силы и рюкзака, кг',
  'game.carryPerStrength': 'добавка переносимого веса за единицу Силы, кг',
  'game.pickupRange': 'дальность подбора предметов с земли, клеток',
  'game.itemActionMax': 'предел количества предметов в одном действии (выдача, подбор)',
  'game.groundItemsMax': 'предел предметов на земле в одном мире',
  'game.groundItemTtlMin': 'устаревший срок предметов на земле в минутах; заменён на game.groundItemTtlSec',
  'game.groundItemTtlSec': 'срок выпавших предметов на земле в секундах (0–65536; 0 — сразу; постоянные тайники не затрагивает)',
  'game.difficulty': 'глобальная сложность сервера: super_easy, easy, normal, medium, high, hard, hardcore',
  'game.groundPurgeSec': 'период уборки исчезнувших предметов с земли, секунд',
  'game.startingKit': 'стартовый набор нового героя: id предметов через запятую, количество после * (например ration*2)',
  'game.hpBase': 'здоровье героя: основа',
  'game.hpPerStrength': 'здоровье: + за единицу Силы',
  'game.hpPerLevel': 'здоровье: + за каждый уровень сверх первого',
  'game.staminaBase': 'выносливость: основа',
  'game.staminaPerStrength': 'выносливость: + за единицу Силы',
  'game.staminaPerStealth': 'выносливость: + за единицу Скрытности',
  'game.mpBase': 'мана: основа',
  'game.mpPerMagic': 'мана: + за единицу Магии',
  'game.mpPerIntellect': 'мана: + за единицу Интеллекта',
  'game.pvpAllowed': 'Совместимость старых настроек. Кооператив: PvP всегда отключён, игроки союзники против мира.',
  'game.critBase': 'базовый шанс критического удара (доля)',
  'game.critPerStealth': 'шанс крита: + за единицу Скрытности',
  'game.critMax': 'предел шанса крита',
  'game.critMultiplier': 'множитель урона при крите',
  'game.meleeBonusPerStrength': 'урон ближнего боя: + доля за единицу Силы',
  'game.magicBonusPerMagic': 'урон магического оружия: + доля за единицу Магии',
  'game.energyBonusPerIntellect': 'урон энергией и электричеством: + доля за единицу Интеллекта',
  'game.armorK': 'броня: урон × K / (K + защита)',
  'game.armorNonPhysicalFactor': 'доля защиты брони против нефизического урона',
  'game.armorPierceFactor': 'доля защиты против бронебойного оружия',
  'game.resistMax': 'предел сопротивления типу урона (доля)',
  'game.unarmedDamageMin': 'урон кулаками: минимум',
  'game.unarmedDamageMax': 'урон кулаками: максимум',
  'game.unarmedSpeed': 'ударов кулаками в секунду',
  'game.unarmedRange': 'дальность удара кулаками, клеток',
  'game.meleeMaxRange': 'фэнтезийное оружие с дальностью не больше этой — ближний бой, дальше — снаряд',
  'game.meleeStaminaCost': 'выносливость за удар в ближнем бою',
  'game.heavyStaminaFactor': 'множитель выносливости для тяжёлого оружия',
  'game.magicMpCost': 'мана за атаку магическим оружием',
  'game.sprintMultiplier': 'множитель скорости бега (пробел)',
  'game.sprintStaminaPerSec': 'выносливость в секунду при беге',
  'game.staminaRegenPerSec': 'восстановление выносливости в секунду',
  'game.hpRegenPerSec': 'восстановление здоровья в секунду (вне боя)',
  'game.mpRegenPerSec': 'восстановление маны в секунду',
  'game.regenDelaySec': 'здоровье восстанавливается через столько секунд после урона',
  'game.enemyRegenPctPerSec': 'медленное восстановление врага после отхода, % максимального здоровья в секунду',
  'game.npcRegenPerSec': 'восстановление здоровья жителей вне боя, единиц в секунду',
  'game.attackSpeedTolerance': 'допуск сервера к скорости атак (доля паузы между атаками)',
  'game.meleeRangeTolerance': 'допуск сервера к дальности ближнего боя, клеток',
  'game.durabilityLossChance': 'шанс потерять 1 прочности оружия при ударе и брони при попадании',
  'game.cleaveArcDeg': 'дуга удара (градусы) для ближнего боя и свойства «рассекает»',
  'game.flameConeDeg': 'угол конуса огнемёта, градусы',
  'game.spreadConeDeg': 'угол разброса дробовика, градусы',
  'game.spreadSecondaryFactor': 'доля урона боковых дробин (оружие с разбросом)',
  'game.spreadPellets': 'сколько дробин в выстреле оружия с разбросом (центральная + боковые в конусе spreadConeDeg)',
  'game.explosionRadius': 'радиус взрыва (гранаты, мины), клеток',
  'game.chainTargets': 'сколько целей задевает цепной разряд',
  'game.chainRange': 'дальность перескока цепного разряда, клеток',
  'game.chainFactor': 'доля урона цепного разряда',
  'game.pullDistance': 'на сколько клеток притягивает лассо',
  'game.lassoHoldSec': 'на сколько секунд лазерное лассо связывает цель (не двигается и не атакует)',
  'game.lassoHoldPerTaming': 'прибавка к связыванию лассо за каждое очко Приручения выше 1 (с)',
  'game.lassoBossHoldFactor': 'множитель связывания лассо для боссов (меньше 1 — держит короче)',
  'game.knockbackDistance': 'на сколько клеток отбрасывает',
  'game.stunChance': 'шанс оглушить оружием со свойством «оглушает»',
  'game.stunSec': 'длительность оглушения, секунд',
  'game.dotDurationSec': 'длительность горения, яда и кровотечения, секунд',
  'game.dotBurnFactor': 'горение: доля урона удара за всё время',
  'game.dotPoisonFactor': 'яд: доля урона удара за всё время',
  'game.dotBleedFactor': 'кровотечение: доля урона удара за всё время',
  'game.empRobotFactor': 'множитель урона ЭМИ по роботам',
  'game.noiseRadius': 'выстрел без глушителя будит врагов в этом радиусе, клеток',
  'game.thrownRecoverChance': 'шанс, что брошенный предмет можно подобрать',
  'game.projectileRadius': 'радиус снаряда для попаданий, клеток',
  'game.trapArmSec': 'через сколько секунд мина или ловушка взводится',
  'game.trapTriggerRadius': 'радиус срабатывания мины или ловушки, клеток',
  'game.trapImmobilizeSec': 'сколько секунд держит капкан или сеть',
  'game.trapLifetimeMin': 'сколько минут стоит установленная мина или ловушка',
  'game.maxTrapsPerPlayer': 'мин и ловушек одного игрока одновременно',
  'game.turretLifetimeSec': 'сколько секунд работает турель, потом складывается в предмет',
  'game.xpBase': 'опыт до следующего уровня: xpBase × уровень^xpExponent',
  'game.xpExponent': 'показатель роста опыта до уровня',
  'game.maxLevel': 'максимальный уровень героя',
  'game.maxEnemyLevel': 'максимальный уровень врага (не более 99)',
  'game.maxStat': 'максимум характеристики героя',
  'game.statPointsPerLevel': 'очков характеристик за уровень',
  'game.xpShareRadius': 'игроки в этом радиусе от убитого врага получают опыт (0 — только убивший)',
  'game.levelUpHeal': 'новый уровень полностью восстанавливает здоровье, выносливость и ману',
  'game.respawnSec': 'через сколько секунд после смерти можно возродиться',
  'game.corpseLifetimeSec': 'сколько секунд лежит труп (0–65536; по умолчанию 60)',
  'game.respawnHpFraction': 'доля здоровья после возрождения',
  'game.deathDropItems': 'при смерти вещи из сумки (не надетые) падают на землю',
  'game.settlementVisitRadius': 'поселение запоминается как точка возрождения, если подойти ближе, клеток',
  'game.enemyHpPerLevel': 'здоровье врага: + доля за уровень',
  'game.enemyDamageFactor': 'общий множитель урона врагов',
  'game.enemyDamagePerLevel': 'урон врага: + доля за уровень',
  'game.enemyDefensePerLevel': 'броня врага: + за уровень',
  'game.enemyXpPerLevel': 'опыт за врага: + доля за уровень',
  'game.spawnAreaSize': 'сторона участка появления врагов, клеток',
  'game.spawnActiveRadius': 'враги появляются на участках в этом радиусе от игроков, клеток',
  'game.spawnMinPlayerDist': 'враги не появляются ближе к игроку, клеток',
  'game.spawnSafeRadius': 'безопасная зона вокруг точки появления мира (враги не появляются и не заходят), клеток',
  'game.settlementSafeRadius': 'безопасная зона вокруг поселений, клеток',
  'game.areaBaseCap': 'врагов на участок при обычной плотности',
  'game.densityLow': 'множитель числа врагов: низкая плотность',
  'game.densityNormal': 'множитель числа врагов: обычная плотность',
  'game.densityHigh': 'множитель числа врагов: высокая плотность',
  'game.enemyRespawnSec': 'участок пополняется врагами не раньше, чем через столько секунд после убийства',
  'game.enemyPopulation': 'целевая общая численность врагов в активной карте; случайная цель ±10%, с учётом плотности мира',
  'game.despawnDelaySec': 'враги на участках без игроков исчезают через столько секунд',
  'game.maxEnemiesPerRoom': 'предел врагов в одном мире одновременно',
  'game.spawnCheckSec': 'период проверки появления врагов, секунд',
  'game.levelPerTiles': 'без подстройки мира: уровень врагов растёт на 1 каждые столько клеток от точки появления',
  'game.scaleMode': 'подстройка под уровень: max — по сильнейшему игроку, avg — по среднему',
  'game.scaleLevelSpread': 'разброс уровня врагов при подстройке, ±уровней',
  'game.bossSpeedFactor': 'множитель скорости передвижения боссов',
  'game.bossAttackSpeedMax': 'максимальная частота атак босса в секунду',
  'game.aiRepathSec': 'как часто враг пересчитывает путь, секунд',
  'game.aiPathMaxNodes': 'предел поиска пути врага (узлов A*)',
  'game.aiWanderRadius': 'радиус блуждания врага вокруг дома, клеток',
  'game.packAggroRadius': 'радиус, в котором стая слышит тревогу, клеток',
  'game.fleeRecoverSec': 'сколько секунд убегает раненый враг',
  'game.leashHealPerSec': 'возвращаясь домой, враг лечится на эту долю здоровья в секунду (0 — не лечится)',
  'game.aiIdleMinSec': 'враг стоит на месте минимум столько секунд перед блужданием',
  'game.aiIdleMaxSec': 'и максимум столько секунд',
  'game.aiRetreatStep': 'на сколько клеток отступает стрелок, если к нему подошли вплотную',
  'game.aiFleeStep': 'на сколько клеток за раз убегает раненый враг',
  'game.enemySeparation': 'минимальное расстояние между врагами, клеток',
  'game.hordeIntervalRareMin': 'орды зомби «редко»: раз в столько минут',
  'game.hordeIntervalNormalMin': 'орды зомби «обычно»: раз в столько минут',
  'game.hordeIntervalOftenMin': 'орды зомби «часто»: раз в столько минут',
  'game.hordeSizeMin': 'зомби в орде: минимум',
  'game.hordeSizeMax': 'зомби в орде: максимум',
  'game.hordeSpawnDist': 'орда появляется на таком расстоянии от игрока, клеток',
  'game.lootLevelSlack': 'уровень предметов добычи — не выше уровня врага + это число',
  'game.lootRarityWeights': 'веса редкостей добычи через запятую: обычный, необычный, редкий, эпический, легендарный',
  'game.lootChanceFactor': 'множитель шанса добычи',
  'game.robotsWalkSeabed': 'роботы и наземные дроны ходят по дну водоёмов и выходят на сушу (true/false); летающие дроны над водой летят',
  'game.lootScatter': 'разброс добычи вокруг убитого врага, клеток',
  'game.adminKillRadius': '/kill без аргументов убивает врагов в этом радиусе, клеток',
  'game.adminSpawnMax': 'предел врагов в одной команде /spawn',
  'game.dropOffsetMin': 'выброшенный предмет ложится перед героем: смещение по x и y не меньше (клеток)',
  'game.dropOffsetMax': 'и не больше (клеток)',
  'game.dmgNumberMs': 'сколько миллисекунд видны всплывающие числа урона (клиент)',
  'game.hitFlashMs': 'длительность белой вспышки при попадании, мс (клиент)',
  'game.enemyFadeMs': 'время исчезновения убитого врага, мс (клиент)',
  'game.hpBarShowSec': 'сколько секунд после попадания видна полоска здоровья врага (клиент)',
  'game.groundOnTopRadius': 'предмет на земле ближе этого расстояния (клеток) к фигуре рисуется поверх неё (клиент)',
  'game.chaseRepathMs': 'как часто клиент пересчитывает путь к цели атаки, мс',
  'game.meleeApproachMargin': 'на сколько клеток ближе дистанции удара подходит герой к цели (запас на движение цели)',
  'game.fxMaxAgeMs': 'длительность вспышек взмахов, конусов и взрывов, мс (клиент)',
  'game.bossSpawnChance': 'шанс, что вместо обычной группы появится главарь банды со свитой (0..1)',
  'game.maxBossesPerRoom': 'сколько главарей может быть в мире одновременно',
  'game.bossAnnounce': 'объявлять в чате о появлении главаря (true/false)',
  'game.dragonLairRadius': 'драконы появляются не дальше этого числа клеток от логова (и не больше драконов, чем логов)',
  'game.compEnabled': 'спутники включены (приручение, вербовка, внушение, взлом)',
  'game.compTameBase': 'базовый шанс приручения (0…1)',
  'game.compTamePerStat': 'прибавка к шансу за каждое очко навыка (Приручение, Договор, Внушение, Взлом — свои базы ниже)',
  'game.compTameLevelPenalty': 'вычет из шанса за каждый уровень цели',
  'game.compTameHpBonus': 'прибавка к шансу за раненую цель (× доля потерянного здоровья)',
  'game.compTameFoodBonus': 'прибавка к шансу приручения, если в сумке есть еда (тратится одна)',
  'game.compChanceMin': 'нижний предел шанса',
  'game.compChanceMax': 'верхний предел шанса',
  'game.compTryCooldownSec': 'пауза между попытками приручить/завербовать, секунд',
  'game.compTameRange': 'с какого расстояния можно приручать/вербовать, клеток',
  'game.compDragonFactor': 'множитель шанса для драконов (уровень 11 — очень трудно)',
  'game.compDragonItem': 'предмет, который тратится при попытке приручить дракона',
  'game.compDragonMinTaming': 'минимальное «Приручение» для попытки приручить дракона',
  'game.compPersuadeBase': 'базовый шанс договора (уговорить человека или мутанта)',
  'game.compPersuadePerStat': 'прибавка к шансу договора за очко «Договора»',
  'game.compRecruitGoldPerLevel': 'сколько золотых самородков за уровень цели просит наёмник (договор с оплатой)',
  'game.compRecruitPaidBonus': 'прибавка к шансу договора при оплате',
  'game.compReputationBonus': 'прибавка к шансу договора за единицу репутации (зацепка для репутации поселений)',
  'game.compSuggestBase': 'базовый шанс внушения',
  'game.compSuggestPerStat': 'прибавка к шансу внушения за очко «Внушения»',
  'game.compSuggestMpCost': 'сколько маны тратит попытка внушения',
  'game.compSuggestSec': 'сколько секунд длится внушение',
  'game.compSuggestSecPerStat': 'на сколько секунд дольше внушение за каждое очко «Внушения» сверх первого',
  'game.compHackBase': 'базовый шанс взлома робота или киборга',
  'game.compHackPerStat': 'прибавка к шансу взлома за очко «Взлома»',
  'game.compHackItem': 'предмет, который тратится при попытке взлома',
  'game.compFollowDist': 'на каком расстоянии спутник держится за героем, клеток',
  'game.compGuardRadius': 'радиус охраны места, клеток',
  'game.compAggroRadius': 'агрессивный спутник сам нападает на врагов ближе этого числа клеток',
  'game.compLeash': 'дальше этого расстояния от героя спутник бросает бой и возвращается (или догоняет телепортом при ×2)',
  'game.compFleeAt': 'доля здоровья, при которой спутник убегает к герою',
  'game.compRegenPerSec': 'сколько здоровья в секунду восстанавливает спутник вне боя (сытый)',
  'game.compXpShare': 'какую долю опыта героя получает каждый призванный спутник',
  'game.compLevelHpBonus': 'прибавка к здоровью спутника за уровень (доля)',
  'game.compReviveSec': 'сколько секунд раненого спутника можно спасти (подойти и нажать «Спасти»)',
  'game.compReviveRange': 'на каком расстоянии можно спасти спутника, клеток',
  'game.compReviveHp': 'с какой долей здоровья встаёт спасённый спутник',
  'game.compPermadeath': 'true — неспасённый спутник теряется навсегда; false — возвращается в контейнер с 1 здоровья',
  'game.compFoodPerMin': 'на сколько падает сытость зверя/дракона в минуту (из 100)',
  'game.compHungryAt': 'голодный зверь (сытость ниже) не восстанавливает здоровье и бьёт слабее',
  'game.compShrinkerRequired': 'нужен ли контейнер-уменьшитель, чтобы прятать спутников и приручать драконов',
  'game.compMountSpeed': 'множитель скорости верхом на драконе',
  'game.compMountRange': 'с какого расстояния можно сесть на дракона, клеток',
  'game.compBreathCooldownSec': 'перезарядка дыхания дракона верхом, секунд',
  'game.compBreathRange': 'дальность дыхания дракона, клеток',
  'game.compBreathAngle': 'ширина конуса дыхания, градусов',
  'game.compBreathFactor': 'множитель урона дыхания от урона дракона',
  'game.magicEnabled': 'магия включена (заклинания, изучение, кража у магов)',
  'game.magicLevelScaling': 'рост силы заклинаний за каждый уровень героя (0.04 = +4%)',
  'game.magicAffinityPerStat': 'сродство школы: прибавка силы за единицу стата школы (огонь — Магия, вода и воздух — Интеллект, земля — Сила, тьма — Скрытность, свет — Убеждение)',
  'game.magicPowerPerPoint': 'прибавка силы заклинаний за единицу силы, забранной у убитых магов',
  'game.magicPowerMax': 'предел силы, забранной у убитых магов',
  'game.magicGcdSec': 'общая пауза между любыми заклинаниями, секунд',
  'game.magicRangeTolerance': 'допуск дальности заклинания (сетевые задержки), клеток',
  'game.magicInterruptOnMove': 'движение прерывает чтение заклинания',
  'game.magicInterruptOnDamage': 'полученный урон прерывает чтение заклинания',
  'game.magicMaxKnown': 'сколько заклинаний герой может знать',
  'game.magicTelepathyRange': 'дальность телепатии и передачи заклинаний между игроками, клеток',
  'game.magicTelepathyMpCost': 'мана ученика за изучение заклинания телепатией',
  'game.magicTeachMpCost': 'мана учителя за передачу заклинания',
  'game.magicAskTimeoutSec': 'сколько секунд ждёт ответа просьба научить телепатией',
  'game.magicStealRange': 'дальность кражи заклинания у мага, клеток',
  'game.magicStealBase': 'базовый шанс украсть заклинание',
  'game.magicStealPerStat': 'прибавка шанса кражи за единицу Магии (и за 2 единицы Интеллекта)',
  'game.magicStealLevelPenalty': 'штраф шанса кражи за каждый уровень мага выше героя',
  'game.magicStealMpCost': 'мана за попытку кражи заклинания',
  'game.magicStealCooldownSec': 'пауза между попытками кражи, секунд',
  'game.magicKillGrantChance': 'шанс выучить одно из заклинаний убитого мага (иначе — прибавка силы)',
  'game.magicKillPowerBoost': 'сколько силы даёт убитый маг, если заклинание не перешло',
  'game.magicChanceMin': 'нижний предел шансов магии (кража, подчинение)',
  'game.magicChanceMax': 'верхний предел шансов магии',
  'game.magicEnemyCastFactor': 'множитель отката заклинаний у врагов-магов (больше — реже колдуют)',
  'game.magicEnemyDamageFactor': 'множитель силы заклинаний врагов-магов',
  'game.magicMaxSummons': 'сколько призванных существ одновременно у одного героя',
  'game.levelsEnabled': 'вертикальные уровни включены (подземелья, подводье, крыши и вершины; входы на карте)',
  'game.levelEntrancesPer256': 'сколько входов в подземелья и на высоты на каждые 256×256 клеток мира',
  'game.levelSize': 'сторона карты подземного и подводного уровня, клеток',
  'game.levelDepthEnemyBonus': 'на сколько уровней сильнее враги за каждый уровень глубины (высоты)',
  'game.levelEnemiesBase': 'сколько групп врагов на первом уровне подземелья',
  'game.levelEnemiesPerDepth': 'сколько групп врагов добавляется за каждый следующий уровень глубины',
  'game.levelCacheBase': 'сколько тайников с добычей на уровне',
  'game.levelCachePerDepth': 'прибавка тайников за глубину (+1 за каждые два уровня при значении 1)',
  'game.levelEntranceRadius': 'как близко нужно подойти ко входу или выходу уровня, клеток',
  'game.levelRespawnMin': 'через сколько минут враги зачищенного уровня появляются снова (0 — никогда)',
  'game.levelMaxPlayers': 'сколько героев одновременно на одном уровне (0 — без отдельного предела, действует maxPlayers мира)',
  'game.breathSec': 'запас воздуха под водой без снаряжения, секунд',
  'game.scubaBreathSec': 'прибавка запаса воздуха с аквалангом, секунд',
  'game.airTankSec': 'сколько секунд воздуха добавляет баллон с воздухом',
  'game.breathRegenPerSec': 'восстановление запаса воздуха вне воды, секунд за секунду',
  'game.drownDamagePct': 'урон удушья (кончился воздух или выносливость вплавь) в секунду, % от макс. здоровья',
  'game.diveFreeDepth': 'до какой глубины можно нырнуть без акваланга (1 — только первый подводный уровень)',
  'game.swimSpeed': 'скорость вплавь, доля от обычной скорости героя',
  'game.swimStaminaPerSec': 'сколько выносливости в секунду тратится вплавь',
  'game.fallDamagePct': 'урон от падения за каждый уровень высоты, % от макс. здоровья',
  'game.airDismount': 'слезть с дракона в воздухе: block — нельзя (сначала снизиться), fall — падение с уроном',
  'game.airMaxAltitude': 'сколько воздушных уровней над постройками доступно в полёте (до 5: +6…+10); ниже, +1…+5, — высота домов и деревьев',
  'game.housesEnabled': 'дома с интерьерами: в каждый дом города и хутор можно войти (U у двери); false — домов нет',
  'game.houseCityChance': 'доля клеток руин города — кандидатов в дома (0…1); меньшее значение оставляет больше места под улицы и площади',
  'game.houseWildChance': 'доля клеток пустоши (половина — в лесу, предгорьях, пустыне) — кандидатов в одинокие хутора',
  'game.houseMaxFloors': 'предел этажей дома (1…5); рядов окон на фасаде столько же, крыша — на уровне +этажей',
  'game.houseMaxBasement': 'предел подвальных уровней дома (0…5, до −5)',
  'game.houseEnemyChance': 'доля этажей дома с врагами (0…1)',
  'game.houseNeutralChance': 'доля этажей дома с нейтральными бродягами — не нападают первыми (0…1)',
  'game.houseResidentChance': 'доля этажей дома с мирными жильцами — не нападают и убегают (0…1)',
  'game.levelElevator': 'лифт у первого бункера работает: везёт с поверхности сразу на самый нижний уровень (false — обесточен)',
  'game.vehiclesEnabled': 'транспорт включён: брошенная техника в мире, вождение, крафт машин',
  'game.vehicleWrecksPer256': 'сколько брошенной техники на каждые 256×256 клеток мира',
  'game.vehicleRespawnSec': 'через сколько секунд после уничтожения заменить природную технику',
  'game.vehicleIntactChance': 'доля целой техники (с топливом) среди найденной; у поселений — вдвое чаще',
  'game.vehicleEnterRange': 'с какого расстояния можно сесть в машину, клеток',
  'game.vehicleSpeedFactor': 'общий множитель скорости всей техники',
  'game.vehicleFuelFactor': 'общий множитель расхода топлива (0 — топливо не тратится)',
  'game.vehicleRamMinSpeed': 'таран: с какой скорости (клеток в секунду) машина ранит врагов',
  'game.vehicleRamFactor': 'множитель урона тарана',
  'game.vehicleRamSelfPct': 'какую долю урона тарана (%) получает сама машина',
  'game.vehicleCrashDamagePct': 'удар о стену на полной скорости: урон машине, % её прочности',
  'game.vehicleRepairPerParts': 'сколько % прочности чинит одна «Автозапчасть»',
  'game.vehicleAutoRepairPctPerSec': 'бесплатный ремонт при наличии седока, % максимальной прочности в секунду',
  'game.vehicleFieldRepairMaxPct': 'ремонт в поле, без верстака своей базы, — не выше этого % прочности',
  'game.vehicleWreckMinPct': 'обломки поедут, только когда прочность выше этого %',
  'game.vehicleMaxPerWorld': 'предел техники в одном мире (найденной и собранной)',
  'game.vehicleOwnedPerPlayer': 'сколько машин может числиться за одним героем в мире',
  'game.vehicleGuestDrive': 'незапертую чужую машину можно водить (false — только садиться пассажиром)',
  'game.vehicleDiveMaxDepth': 'подлодки: на сколько уровней ниже моря можно погрузиться (0 — не ныряют, до 5: −1…−5; не глубже дна под лодкой)',
  'game.autoUseEnabled': 'автопомощь из сумки (панель «Автопомощь»: лечение, мана, выносливость, еда, вода, бодрость, антирадин, воздух, заправка и ремонт машины); false — выключена у всех',
  'game.autoUseThresholdPct': 'порог автопомощи, %: предмет из сумки используется, когда шкала (здоровье, мана, выносливость, сытость, вода, бодрость, воздух, топливо, прочность машины) ниже этой доли',
  'game.autoUseRadAt': 'автопомощь: антирадин — когда радиация не ниже этого значения (0–100)',
  'game.autoUseIntervalSec': 'автопомощь: не чаще одного предмета за столько секунд (на героя)',
  'game.autoUseRetrySec': 'автопомощь: если нужного предмета нет (или ремонт невозможен), повторная попытка по этой шкале — через столько секунд',
  'game.vehicleLowFlyHitPct': 'урон технике за удар о дом, деревья или скалы в низком полёте (+1…+5), % прочности; 0 — без урона (столкновение всё равно отбрасывает)',
  'game.vehicleArmsDamageFactor': 'множитель урона бортового оружия техники (пушки, ракеты, торпеды, бомбы)',
  'game.vehicleMissileTurnFactor': 'множитель поворотливости управляемых ракет (0 — летят прямо, без наведения)',
  'game.settlementsEnabled': 'поселения оживают: жители, торговля, репутация, стража и набеги',
  'game.settlementLayout': 'застройка поселений: дома, стены и ворота (false — только площадь без стен; меняется после перезапуска)',
  'game.settlementWakeRadius': 'жители поселения появляются, когда герой ближе этого, клеток',
  'game.settlementTalkRange': 'с какого расстояния можно говорить с жителем, клеток',
  'game.settlementNpcRespawnSec': 'через сколько секунд возвращается убитый житель',
  'game.questItemRespawnSec': 'через сколько секунд появляется снова подобранный сюжетный запас материалов активного задания',
  'game.settlementRestockMin': 'раз в сколько минут торговцы пополняют товар',
  'game.tradeBuyFactor': 'цена покупки = ценность предмета × множитель редкости × это',
  'game.tradeSellFactor': 'цена продажи торговцу = ценность × множитель редкости × это',
  'game.tradeRepPriceMax': 'насколько репутация ±100 меняет цены (0.3 — на ±30%)',
  'game.tradeDamagedFactor': 'в разорённом набегом поселении цены умножаются на это',
  'game.healPricePerHp': 'лекарь: крышек за единицу восстановленного здоровья',
  'game.curePrice': 'лекарь: цена лечения болезни и радиации, крышек',
  'game.spellPricePerTier': 'маг-наставник: цена заклинания = это × круг², крышек',
  'game.recipePriceFactor': 'рецепт у мастера: ценность изделия × это (не меньше 40 крышек)',
  'game.repTradePer': '+1 репутации за каждые столько крышек сделок',
  'game.repAssault': 'нападение на жителя: на сколько падает репутация',
  'game.repMurder': 'убийство жителя: на сколько падает репутация',
  'game.repDefend': 'отбитый набег: на сколько растёт репутация защитников',
  'game.repFactionShare': 'доля изменения репутации, которая достаётся поселениям того же рода (фракции)',
  'game.repHostileAt': 'репутация не выше этого — враждебность: стража нападает, никто не торгует',
  'game.repUnfriendlyAt': 'репутация не выше этого — неприязнь: лекарь и маг отказывают',
  'game.repFriendlyAt': 'репутация от этого — дружба (вербовка легче)',
  'game.repHonoredAt': 'репутация от этого — почёт',
  'game.wantedSec': 'сколько секунд стража преследует напавшего на жителя',
  'game.guardAggroRadius': 'с какого расстояния стража замечает врагов и преступников, клеток',
  'game.guardLeash': 'насколько далеко за край поселения стража преследует, клеток',
  'game.raidRewardGold': 'награда каждому защитнику отбитого набега, золотых самородков',
  'game.raidMaxMin': 'набег, не отбитый за столько минут, разоряет поселение',
  'game.raidDamagePerSec': 'урон поселению (из 100) в секунду от каждого налётчика внутри',
  'game.settlementRegenPerMin': 'на сколько (из 100) поселение отстраивается за минуту',
  'game.settlementPvpOff': 'в поселениях игроки не могут сражаться друг с другом (мирная зона)',
  'game.factionsEnabled': 'фракции: враги из банд не нападают на героев с хорошей репутацией у банды; изменения репутации расходятся союзникам и врагам фракции',
  'game.factionAttackAt': 'члены фракции нападают первыми, если репутация героя у неё не выше этого (−100…100)',
  'game.factionAllyShare': 'какая доля изменения репутации у фракции достаётся её союзникам (0.3 — 30%)',
  'game.factionEnemyShare': 'какая доля изменения репутации у фракции достаётся её врагам с обратным знаком (0.5 — 50%)',
  'game.factionKillRep': 'насколько падает репутация фракции за убийство её члена',
  'game.factionBossKillRep': 'насколько падает репутация фракции за убийство её главаря',
  'game.factionAttackRep': 'насколько падает репутация за удар по члену фракции, которая к вам не враждебна',
  'game.questsEnabled': 'задания: старосты поселений раздают обычные и сюжетные задания, сервер отслеживает цели',
  'game.questBoardSize': 'сколько обычных (процедурных) заданий у старосты одновременно',
  'game.questBoardRefreshMin': 'раз в сколько минут обновляется доска заданий старосты (новые задания)',
  'game.questMaxActive': 'сколько заданий можно держать взятыми в мире одновременно (на всю группу)',
  'game.questBossDist': 'на каком расстоянии от поселения появляется сюжетный главарь, клеток',
  'game.questRewardFactor': 'множитель денег и опыта в наградах за обычные задания',
  'game.questEscortSpeed': 'скорость сопровождаемого жителя, клеток в секунду',
  'game.questDeliverMaxDist': 'доставка и сопровождение — только в поселения не дальше этого, клеток',
  'game.endingRuleGangs': 'концовка «Властелин пустоши»: убить Патриарха, дружа (не ниже «дружбы») со столькими бандами; иначе — «Падение Патриарха»',
  'game.familyEnabled': 'семья: отношения с жителями поселений, свадьбы, семейный союз игроков, приёмные дети и помощники на базе',
  'game.familyTalkAffinity': 'на сколько растёт симпатия жителя от разговора «по душам»',
  'game.familyTalkCooldownMin': 'разговор с тем же жителем приносит симпатию не чаще, чем раз в столько минут',
  'game.familyGiftValuePer': 'подарок: +1 симпатии за каждые столько крышек ценности подаренного предмета',
  'game.familyGiftMax': 'подарок: не больше стольких очков симпатии за один раз',
  'game.familyGiftCooldownMin': 'подарки одному жителю — не чаще, чем раз в столько минут',
  'game.familyQuestAffinity': 'симпатия знакомых жителей поселения за выполненное задание его старосты',
  'game.familyHelpAffinity': 'симпатия знакомых жителей поселения за отбитый набег',
  'game.familyCourtAt': 'с какой симпатии (0…100) можно начать ухаживать за жителем',
  'game.familyProposeAt': 'с какой симпатии (уже ухаживая) можно сделать предложение',
  'game.familyOppositeSex': 'брак только с персонажем противоположного пола (как в GDD); false — с любым',
  'game.familyCeremonyCost': 'плата за свадебный праздник в поселении, крышек',
  'game.familyMaxMembers': 'сколько членов семьи может быть у героя (супруг, дети, старейшина)',
  'game.familyDayMin': 'длина «дня» распорядка семьи на базе, минут (сон, работа, отдых)',
  'game.familyPregnancyMin': 'беременность взрослых супругов: длительность в реальных минутах',
  'game.familyChildYearMin': 'ребёнок взрослеет на год за столько реальных минут (включая время вне игры)',
  'game.familyAdultAge': 'с какого возраста ребёнок помогает на базе как взрослый; взять в поход можно раньше',
  'game.familyOrphansPerTown': 'сколько сирот ждёт семью в каждом поселении',
  'game.familyHelperTickSec': 'как часто помощники на базе делают свою работу, секунд',
  'game.familyGuardRadius': 'охрана базы: радиус защиты вокруг флага базы, клеток',
  'game.familyGuardDamage': 'охрана базы: урон по врагу за такт (+10% за каждый уровень члена семьи)',
  'game.familyCraftSpeedup': 'ремесло: насколько быстрее идёт очередь крафта, пока помощник дома (доля, 0.25 = на 25%)',
  'game.familyGatherMin': 'сбор: одна единица ресурса в сундук базы за столько минут работы помощника',
  'game.familyHealPerTick': 'лечение: сколько здоровья помощник восстанавливает герою на базе за такт',
  'game.familyBondAskSec': 'предложение семейного союза другому игроку действует столько секунд',
  'game.voiceEnabled': 'голосовой чат между игроками одного мира (WebRTC, сервер только пересылает сигналы)',
  'game.voiceMaxPeers': 'сколько игроков может быть в одном голосовом канале (каждый соединён с каждым, 1–8 — разумно)',
  'game.voiceProximityRadius': 'голос в режиме «рядом»: дальше стольких клеток игрока не слышно',
  'game.voiceProximityFull': 'голос в режиме «рядом»: ближе стольких клеток — полная громкость',
  'game.voiceDefaultMode': 'режим голоса по умолчанию: ptt — рация (говорить, пока зажата клавиша), vad — голосовая активация',
  'game.voicePttKey': 'клавиша рации по умолчанию — код клавиши (KeyV, KeyB, CapsLock, Backquote…); игрок может сменить её в панели голоса',
  'game.voiceStunUrls': 'STUN-серверы для голоса через запятую, например stun:stun.l.google.com:19302; пусто — без STUN (работает в локальной сети и на одном компьютере)',
  'game.voiceMaxSigKb': 'наибольший размер одного голосового сигнала (описание соединения или ICE-кандидаты), КБ',
  'game.voiceVadThreshold': 'порог голосовой активации по умолчанию (громкость микрофона 0…1)',
  'game.voiceVadHangMs': 'голосовая активация: продолжать передачу ещё столько миллисекунд после тишины',
  'game.voiceMuteDefaultMin': 'заглушение голоса администратором по умолчанию, минут (0 — бессрочно)',
  'game.graphicsRenderer': 'рендер по умолчанию: art — художественный (текстуры, свет, частицы), classic — прежний простой (запасной для слабых машин); игрок может сменить в меню',
  'game.graphicsQuality': 'качество графики по умолчанию: low, medium или high (игрок может сменить в меню)',
  'game.artDayMin': 'длина суток для освещения, минут реального времени (0 — всегда день)',
  'game.artNightDark': 'насколько темнеет ночью: 0 — не темнеет, 0,8 — почти темно',
  'game.artUnderLight': 'радиус света вокруг героя в подземельях и ночью, клеток',
  'game.artParticleMax': 'наибольшее число частиц эффектов на экране (на высоком качестве; на среднем — половина, на низком — нет)',
  'game.netViewRadius': 'радиус интереса, клеток: в сообщениях state — только враги, жители и спутники не дальше этого от героя (меньше — меньше трафика)',
  'game.netDelta': 'в state слать только изменившихся (позиция, здоровье, флаги); false — каждый тик всех в радиусе',
  'game.netKeyframeSec': 'раз во столько секунд — полный список всех ближних (опорный кадр), даже без изменений',
  'game.aiSleepRadius': 'враги без цели дальше стольких клеток от всех игроков «спят» (ИИ не считается); 0 — никогда',
  'game.fpsCap': 'ограничение кадров в секунду по умолчанию: 30, 60 или 0 — без ограничения (игрок меняет в меню)',
  'game.fpsIdle': 'кадров в секунду в простое (герой стоит, вокруг ничего не движется, нет ввода)',
  'game.idleAfterSec': 'через сколько секунд без ввода и движения включается простой',
  'game.autoQualityFps': 'автокачество: если FPS ниже этого несколько секунд — качество графики снижается на ступень; 0 — выключено',
  'game.batterySaver': 'экономия батареи по умолчанию: от батареи (navigator.getBattery) — низкое качество и 30 FPS',
  'game.perfOverlay': 'показывать оверлей FPS / пинг / тик сервера по умолчанию (F8)',
  'game.cheatsForAll': 'чит-панель (F9) доступна всем игрокам, а не только администраторам — для одиночной игры и тестов; на общем сервере держите false',
  'game.cheatSpeedMax': 'наибольший множитель скорости бега в чит-панели',
  'game.cheatKillRadius': 'радиус «убить всех рядом» в чит-панели, клеток',
  'game.cameraPanSpeed': 'камера: скорость свободного обзора (Ctrl+стрелки, цифровой блок, край экрана), клеток в секунду',
  'game.cameraSmoothSec': 'камера: плавность движения, секунд (0 — без сглаживания)',
  'game.cameraEdgeScroll': 'камера: прокрутка обзора, когда мышь у края экрана, — по умолчанию для игроков (каждый может сменить в меню)',
  'game.cameraArrowKeys': 'камера: стрелки двигают обзор, а WASD — героя (true); false — стрелки ведут героя, как WASD (по умолчанию для игроков, каждый может сменить в меню)',
  'game.cameraEdgePx': 'камера: ширина полосы у края экрана для прокрутки, пикселей',
  'game.cameraFollowDefault': 'камера: при входе в мир следить за героем (End или Ё — вкл/выкл, Home — вернуть к герою)',
  'game.fogMode': 'туман войны: on — неразведанное чёрное, разведанное вне обзора затемнено (без живых врагов); explored — скрыто только неразведанное; off — без тумана',
  'game.fogRadius': 'туман войны: радиус обзора героя днём на поверхности, клеток',
  'game.fogNightMul': 'туман войны: множитель радиуса обзора глубокой ночью (0…1; в сумерках — плавно)',
  'game.fogUndergroundMul': 'туман войны: множитель радиуса обзора под землёй (подземелья, пещеры, бункеры)',
  'game.fogShared': 'туман войны: общая разведанная карта у всех игроков мира (совместная игра); false — у каждого своя',
  'game.fogServerCull': 'туман войны (режим on): сервер не шлёт врагов, жителей и чужих спутников вне обзора героя (против читов)',
  'game.fogDimAlpha': 'туман войны: затемнение разведанного, но не видимого сейчас (0…1)',
  'game.cheatListRadius': 'чит-панель «Персонажи»: радиус списка жителей и врагов вокруг героя, клеток (игроки и спутники — все в этом мире)',
  'game.worldEditMaxProps': 'стройка чит-панели: сколько объектов (деревья, скалы, здания, тайники, ресурсные точки) можно поставить в один мир (уровень)',
  'game.worldEditOpenRange': 'стройка чит-панели: с какого расстояния (клеток) открывается тайник с добычей',
  'game.artTextureSize': 'размер текстуры клетки, пикселей (8…128; больше — детальнее и тяжелее)',
  'game.factionTownWeight': 'какая доля репутации Союза поселений (для магов — Ордена магов) добавляется к репутации каждого поселения',
  'game.depotsPer256': 'сколько военных складов на каждые 256×256 клеток мира',
  'game.depotWakeRadius': 'охрана склада появляется, когда герой впервые подходит ближе этого числа клеток',
  'game.depotGuards': 'сколько шагоходов охраняет склад',
  'game.depotGuardLevel': 'минимальный уровень охраны склада',
  'game.depotRadius': 'радиус склада: ящик можно открыть, когда охрана в этом радиусе перебита',
  'game.depotRespawnMin': 'через сколько минут склад пополняется (0 — один раз на героя)',
  'game.maxTurretsPerPlayer': 'сколько турелей один игрок может держать установленными одновременно',
  'game.turretHpBase': 'здоровье турели 1-го уровня (враги могут её разбить)',
  'game.turretHpPerTier': 'прибавка здоровья турели за уровень улучшения (доля от базового)',
  'game.turretDefense': 'броня турели',
  'game.turretRadius': 'размер турели (радиус, клеток) для попаданий врагов',
  'game.turretMaxTier': 'предельный уровень улучшения турели',
  'game.turretTierDamage': 'прибавка урона турели за уровень улучшения (доля)',
  'game.turretTierRange': 'прибавка дальности турели за уровень (доля)',
  'game.turretTierFireRate': 'прибавка скорострельности турели за уровень (доля)',
  'game.turretTierMagazine': 'прибавка ёмкости магазина турели за уровень (доля)',
  'game.turretUpgradeItem': 'первый материал для улучшения турели (id предмета)',
  'game.turretUpgradeCount': 'сколько первого материала на улучшение (× текущий уровень)',
  'game.turretUpgradeItem2': 'второй материал для улучшения турели (id предмета, пусто — не нужен)',
  'game.turretUpgradeCount2': 'сколько второго материала (× текущий уровень)',
  'game.turretRepairItem': 'материал для ремонта турели (id предмета)',
  'game.turretRepairHpPerItem': 'сколько здоровья турели чинит один предмет материала',
  'game.turretInteractRange': 'с какого расстояния (клеток) можно управлять своей турелью',
  'game.turretDefaultMode': 'режим цели новой турели: nearest (ближайший), strongest (самый здоровый), weakest (самый слабый)',
  'game.combatInvSyncSec': 'как часто (секунд) присылать игроку инвентарь, если в бою изменилась только прочность',
};

// Короткие имена переменных окружения; остальные — RM_<КЛЮЧ> (например RM_SESSION_TTL_DAYS, RM_GAME_START_POINTS)
const ENV_ALIASES = { port: 'PORT', host: 'HOST', dataDir: 'DATA_DIR' };

class ConfigError extends Error {}

const flatKeys = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === 'object' && !Array.isArray(v) ? flatKeys(v, prefix + k + '.') : [prefix + k]);
const getPath = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, key, value) {
  const parts = key.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {};
  o[parts.at(-1)] = value;
}
const envName = (key) => ENV_ALIASES[key] || 'RM_' + key.replace(/\./g, '_').replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
const KEYS = flatKeys(DEFAULTS);

// Приводит значение к типу значения по умолчанию
function coerce(key, raw, source) {
  const def = getPath(DEFAULTS, key);
  if (typeof def === 'number') {
    const n = Number(raw);
    if (raw === '' || raw === null || !Number.isFinite(n) || n < 0) throw new ConfigError(`${source}: «${key}» должно быть неотрицательным числом, получено «${raw}».`);
    if (key === 'port' && (!Number.isInteger(n) || n > 65535)) throw new ConfigError(`${source}: порт должен быть целым числом от 0 до 65535.`);
    if (key === 'game.corpseLifetimeSec' && (!Number.isInteger(n) || n > 65536)) throw new ConfigError('Время трупов: целое число от 0 до 65536 секунд.');
    if (key === 'game.enemyRespawnSec' && (!Number.isInteger(n) || n > 65536)) throw new ConfigError('Возрождение врагов: целое число от 0 до 65536 секунд.');
    if (key === 'game.enemyPopulation' && (!Number.isInteger(n) || n > 250)) throw new ConfigError('Численность врагов: целое число от 0 до 250.');
    if (key === 'game.groundItemTtlSec' && (!Number.isInteger(n) || n > 65536)) throw new ConfigError('Срок предметов на земле: целое число от 0 до 65536 секунд.');
    if (['game.settlementNpcRespawnSec', 'game.questItemRespawnSec'].includes(key) && (!Number.isInteger(n) || n > 65536)) throw new ConfigError(`${key}: целое число от 0 до 65536 секунд.`);
    return n;
  }
  if (key === 'game.difficulty' && !require('../shared/difficulty').MODES.some(x => x.id === String(raw))) throw new ConfigError('game.difficulty: выберите super_easy, easy, normal, medium, high, hard или hardcore.');
  if (typeof def === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    const s = String(raw).toLowerCase();
    if (['1', 'true', 'yes', 'да', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'нет', 'off'].includes(s)) return false;
    throw new ConfigError(`${source}: «${key}» должно быть true или false, получено «${raw}».`);
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') throw new ConfigError(`${source}: «${key}» должно быть строкой.`);
  return String(raw);
}

// ---------- Разбор командной строки ----------
// Общие флаги сервера и инструментов
const COMMON_FLAGS = {
  '--config': { arg: '<файл>', desc: 'путь к файлу настроек (по умолчанию config.json в корне проекта)', special: 'config' },
  '--data': { arg: '<папка>', desc: 'папка данных', key: 'dataDir' },
  '--set': { arg: '<ключ=значение>', desc: 'задать любую настройку, например --set game.startPoints=15 (можно несколько раз)', special: 'set' },
  '-h': { desc: 'показать эту справку', special: 'help' },
  '--help': { desc: 'показать эту справку', special: 'help' },
};

// spec: { flags: {...дополнительные флаги}, positional: ['имя', ...] }
function parseArgs(argv, spec = {}) {
  const flags = { ...COMMON_FLAGS, ...(spec.flags || {}) };
  const out = { overrides: {}, configFile: null, help: false, positional: [], extra: {} };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline = null;
    if (a.startsWith('--') && a.includes('=')) { inline = a.slice(a.indexOf('=') + 1); a = a.slice(0, a.indexOf('=')); }
    if (!a.startsWith('-') || a === '-') { out.positional.push(argv[i]); continue; }
    const f = flags[a];
    if (!f) throw new ConfigError(`Неизвестный параметр: ${a}`);
    let value = true;
    if (f.arg) {
      value = inline ?? argv[++i];
      if (value === undefined) throw new ConfigError(`Параметру ${a} нужно значение ${f.arg}.`);
    }
    if (f.special === 'help') out.help = true;
    else if (f.special === 'config') out.configFile = value;
    else if (f.special === 'set') {
      const eq = String(value).indexOf('=');
      const key = eq > 0 ? value.slice(0, eq) : '';
      if (!KEYS.includes(key)) throw new ConfigError(`--set: неизвестная настройка «${key || value}». Доступны: ${KEYS.join(', ')}.`);
      out.overrides[key] = coerce(key, value.slice(eq + 1), '--set');
    } else if (f.key) out.overrides[f.key] = coerce(f.key, value, a);
    else out.extra[f.name || a.replace(/^-+/, '')] = value;
  }
  return out;
}

function helpText({ usage, description, flags = {}, examples = [] }) {
  const all = { ...(flags || {}), ...COMMON_FLAGS };
  const lines = [];
  if (description) lines.push(description, '');
  lines.push('Использование:', '  ' + usage, '', 'Параметры:');
  for (const [name, f] of Object.entries(all)) {
    if (name === '-h') continue;
    const n = name === '--help' ? '-h, --help' : name + (f.arg ? ' ' + f.arg : '');
    lines.push('  ' + n.padEnd(28) + ' ' + f.desc);
  }
  lines.push('', 'Настройки (config.json | переменная окружения | значение по умолчанию):');
  for (const key of KEYS) {
    lines.push('  ' + key.padEnd(22) + ' ' + envName(key).padEnd(24) + ' ' + JSON.stringify(getPath(DEFAULTS, key)).padEnd(10) + ' ' + (DESCRIPTIONS[key] || ''));
  }
  lines.push('', 'Приоритет: флаги командной строки > переменные окружения > config.json > по умолчанию.');
  if (examples.length) lines.push('', 'Примеры:', ...examples.map((e) => '  ' + e));
  return lines.join('\n');
}

// ---------- Сборка итоговых настроек ----------
let current = null;

function load({ overrides = {}, configFile = null, env = process.env } = {}) {
  const cfg = structuredClone(DEFAULTS);
  // 1) config.json
  const file = configFile || env.RM_CONFIG || path.join(ROOT, 'config.json');
  const explicit = Boolean(configFile || env.RM_CONFIG);
  // устаревший game.groundItemTtlMin (из файла, окружения или --set) действует, если game.groundItemTtlSec не задан явно
  let ttlSecSet = false, ttlMinSet = false;
  if (fs.existsSync(file)) {
    let json;
    try { json = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { throw new ConfigError(`Не удалось прочитать ${file}: ${e.message}`); }
    const fileKeys = flatKeys(json);
    for (const key of fileKeys) {
      if (key.startsWith('_')) continue; // комментарии вида "_comment"
      if (!KEYS.includes(key)) { console.warn(`[config] Неизвестная настройка в ${path.basename(file)}: «${key}» — пропущена.`); continue; }
      setPath(cfg, key, coerce(key, getPath(json, key), path.basename(file)));
    }
    ttlSecSet = ttlSecSet || getPath(json, 'game.groundItemTtlSec') !== undefined;
    ttlMinSet = ttlMinSet || getPath(json, 'game.groundItemTtlMin') !== undefined;
  } else if (explicit) {
    throw new ConfigError(`Файл настроек не найден: ${file}`);
  }
  // 2) переменные окружения
  for (const key of KEYS) {
    const v = env[envName(key)];
    if (v !== undefined && v !== '') {
      setPath(cfg, key, coerce(key, v, 'переменная ' + envName(key)));
      if (key === 'game.groundItemTtlSec') ttlSecSet = true;
      if (key === 'game.groundItemTtlMin') ttlMinSet = true;
    }
  }
  // 3) командная строка
  for (const [key, v] of Object.entries(overrides)) setPath(cfg, key, v);
  if ('game.groundItemTtlSec' in overrides) ttlSecSet = true;
  if ('game.groundItemTtlMin' in overrides) ttlMinSet = true;
  if (ttlMinSet && !ttlSecSet) cfg.game.groundItemTtlSec = Math.min(65536, Math.max(0, Number(cfg.game.groundItemTtlMin) * 60));

  cfg.dataPath = path.resolve(ROOT, cfg.dataDir);
  cfg.backupPath = cfg.backupDir ? path.resolve(ROOT, cfg.backupDir) : cfg.dataPath + '-backups';
  current = cfg;
  return cfg;
}

// Текущие настройки (если load() ещё не вызывался — без флагов командной строки)
function get() {
  return current || load();
}

// Настройки, которые нужны клиенту
function publicConfig(cfg = get()) {
  return {
    game: cfg.game,
    net: { wsPath: cfg.wsPath },
    auth: { usernameMin: cfg.usernameMin, usernameMax: cfg.usernameMax, passwordMin: cfg.passwordMin, passwordMax: cfg.passwordMax },
  };
}

// Синхронный вывод: console.log + process.exit обрезает длинную справку, если вывод идёт в конвейер (| more, | grep)
function writeOut(text) {
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < buf.length) {
    try { off += fs.writeSync(1, buf, off, buf.length - off); } catch (e) { if (e.code !== 'EAGAIN') throw e; }
  }
}

// Запуск CLI: разбор аргументов, справка, ошибки. Возвращает { cfg, args } или завершает процесс.
function cli(argv, helpSpec) {
  let args;
  try {
    args = parseArgs(argv, helpSpec);
    if (args.help) { writeOut(helpText(helpSpec) + '\n'); process.exit(0); }
    const cfg = load({ overrides: args.overrides, configFile: args.configFile });
    return { cfg, args };
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.error('Ошибка: ' + e.message + '\n');
    console.error(helpText(helpSpec));
    process.exit(2);
  }
}

module.exports = { ROOT, DEFAULTS, KEYS, ConfigError, load, get, publicConfig, parseArgs, helpText, cli, envName, DESCRIPTIONS };
