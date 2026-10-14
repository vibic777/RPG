// Общие правила персонажа: варианты внешности, характеристики, валидация.
// Используется и сервером (require), и браузером (window.CharacterRules).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CharacterRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1;

  // Настраиваемые значения (сервер задаёт из config, клиент получает через /api/config)
  const settings = {
    maxCharacters: 8, // персонажей на аккаунт
    startPoints: 12, // свободные очки при создании
    startStatCap: 6, // максимум любой характеристики при создании
    maxStat: 999, // абсолютный предел характеристик
    companionsMax: 11, // предел команды
    maxScars: 3,
    maxTattoos: 4,
    maxImplants: 4,
    // производные показатели (здоровье, выносливость, мана)
    hpBase: 80, hpPerStrength: 12, hpPerLevel: 5,
    staminaBase: 60, staminaPerStrength: 6, staminaPerStealth: 4,
    mpBase: 20, mpPerMagic: 15, mpPerIntellect: 5,
  };

  // ---------- Внешность ----------
  // id — хранится в данных, label — показывается в интерфейсе
  const APPEARANCE = {
    gender: [
      { id: 'male', label: 'Мужской' },
      { id: 'female', label: 'Женский' },
    ],
    body: [
      { id: 'slim', label: 'Худощавое' },
      { id: 'athletic', label: 'Атлетичное' },
      { id: 'muscular', label: 'Мускулистое' },
      { id: 'heavy', label: 'Крупное' },
    ],
    face: [
      { id: 'oval', label: 'Овальное' },
      { id: 'square', label: 'Квадратное' },
      { id: 'angular', label: 'Скуластое' },
      { id: 'round', label: 'Круглое' },
      { id: 'narrow', label: 'Узкое' },
      { id: 'heart', label: 'Сердцевидное' },
    ],
    hair: [
      { id: 'bald', label: 'Без волос' },
      { id: 'buzz', label: 'Ёжик' },
      { id: 'short', label: 'Короткая' },
      { id: 'mohawk', label: 'Ирокез' },
      { id: 'long', label: 'Длинные' },
      { id: 'ponytail', label: 'Хвост' },
      { id: 'braids', label: 'Косы' },
      { id: 'dreads', label: 'Дреды' },
      { id: 'bun', label: 'Пучок' },
    ],
    hairColor: [
      { id: 'black', label: 'Чёрный', color: '#1c1714' },
      { id: 'brown', label: 'Каштановый', color: '#5a3a22' },
      { id: 'blond', label: 'Светлый', color: '#d8b870' },
      { id: 'red', label: 'Рыжий', color: '#a3471f' },
      { id: 'gray', label: 'Седой', color: '#a9a9a4' },
      { id: 'white', label: 'Белый', color: '#eeeeea' },
      { id: 'toxic', label: 'Кислотно-зелёный', color: '#6fdc3a' },
      { id: 'blue', label: 'Синий', color: '#3a6fdc' },
    ],
    skin: [
      { id: 'pale', label: 'Бледная', color: '#f3d9c6' },
      { id: 'light', label: 'Светлая', color: '#e8bf9c' },
      { id: 'tan', label: 'Смуглая', color: '#c99368' },
      { id: 'olive', label: 'Оливковая', color: '#a8804f' },
      { id: 'brown', label: 'Коричневая', color: '#7e5234' },
      { id: 'dark', label: 'Тёмная', color: '#4e3222' },
      { id: 'ashen', label: 'Пепельная (облучённая)', color: '#9fa393' },
    ],
    eyes: [
      { id: 'brown', label: 'Карие', color: '#5b3a1e' },
      { id: 'blue', label: 'Голубые', color: '#4a86c5' },
      { id: 'green', label: 'Зелёные', color: '#4c9a4a' },
      { id: 'gray', label: 'Серые', color: '#8a9096' },
      { id: 'amber', label: 'Янтарные', color: '#d19a2a' },
    ],
    underwear: [
      { id: 'gray', label: 'Серое', color: '#6b6f73' },
      { id: 'black', label: 'Чёрное', color: '#25272a' },
      { id: 'white', label: 'Белое', color: '#e2e2dc' },
      { id: 'khaki', label: 'Хаки', color: '#6f6a45' },
      { id: 'red', label: 'Красное', color: '#8e2a26' },
    ],
    // Множественный выбор
    scars: [
      { id: 'cheek', label: 'Шрам на щеке' },
      { id: 'eye', label: 'Шрам через глаз' },
      { id: 'lip', label: 'Рассечённая губа' },
      { id: 'chest', label: 'Шрам на груди' },
      { id: 'arm', label: 'Шрамы на руке' },
      { id: 'belly', label: 'Шрам на животе' },
    ],
    tattoos: [
      { id: 'armLeft', label: 'Узор на левой руке' },
      { id: 'armRight', label: 'Узор на правой руке' },
      { id: 'chest', label: 'Знак на груди' },
      { id: 'face', label: 'Узор на лице' },
      { id: 'neck', label: 'Штрихкод на шее' },
      { id: 'legs', label: 'Узоры на ногах' },
    ],
    implants: [
      { id: 'eye', label: 'Кибер-глаз' },
      { id: 'jaw', label: 'Кибер-челюсть' },
      { id: 'port', label: 'Нейропорт на виске' },
      { id: 'armLeft', label: 'Кибер-рука (левая)' },
      { id: 'armRight', label: 'Кибер-рука (правая)' },
      { id: 'chest', label: 'Пластина на груди' },
      { id: 'legs', label: 'Кибер-ноги' },
    ],
  };

  const GROUP_LABELS = {
    gender: 'Пол', body: 'Телосложение', face: 'Лицо', hair: 'Причёска', hairColor: 'Цвет волос',
    skin: 'Цвет кожи', eyes: 'Цвет глаз', underwear: 'Нижнее бельё',
    scars: 'Шрамы', tattoos: 'Татуировки', implants: 'Кибер-импланты',
  };

  const SINGLE = ['gender', 'body', 'face', 'hair', 'hairColor', 'skin', 'eyes', 'underwear'];
  const MULTI_LIMITS = {};
  const STAT_MAX = {}; // абсолютные пределы (у остальных пока нет)
  function configure(o = {}) {
    for (const k of Object.keys(settings)) if (Number.isFinite(o[k])) settings[k] = o[k];
    Object.assign(MULTI_LIMITS, { scars: settings.maxScars, tattoos: settings.maxTattoos, implants: settings.maxImplants });
    STAT_MAX.companions = Math.min(11, settings.companionsMax);
    STAT_MAX.shops = 5;
  }
  configure();

  // ---------- Характеристики ----------
  const STATS = [
    { id: 'strength', label: 'Сила', desc: 'Урон в ближнем бою, переносимый вес, здоровье.' },
    { id: 'magic', label: 'Магия', desc: 'Сила заклинаний и запас маны.' },
    { id: 'intellect', label: 'Интеллект', desc: 'Изучение магии и технологий, рецепты.' },
    { id: 'stealth', label: 'Скрытность', desc: 'Незаметность, засады, кражи.' },
    { id: 'persuasion', label: 'Договор', desc: 'Убеждение: избегать конфликтов, торговаться.' },
    { id: 'hacking', label: 'Взлом', desc: 'Перепрограммировать киборгов и роботов на свою сторону.' },
    { id: 'engineering', label: 'Инженерия', desc: 'Крафт и ремонт чего угодно, включая транспорт.' },
    { id: 'builder', label: 'Строитель', desc: 'База, сооружения, турели.' },
    { id: 'suggestion', label: 'Внушение', desc: 'Обратить любое живое существо на свою сторону.' },
    { id: 'taming', label: 'Приручение', desc: 'Приручать животных и драконов.' },
    { id: 'companions', label: 'Напарники', desc: 'Размер команды (1–11). Спутники в контейнере тоже занимают место; исключённые союзники — нет.' },
    { id: 'shops', label: 'Количество лавок', desc: 'Сколько личных лавок можно держать открытыми одновременно во всех мирах (1–5).' },
  ];
  const STAT_MIN = 1;
  function statCap(id, creation) {
    const abs = Math.min(settings.maxStat, STAT_MAX[id] || settings.maxStat);
    return creation ? Math.min(abs, settings.startStatCap) : abs;
  }

  // Производные показатели: зависят от характеристик и уровня (коэффициенты — в настройках)
  function derive(stats, level = 1) {
    const s = settings, lv = Math.max(1, level || 1) - 1;
    return {
      maxHp: Math.round(s.hpBase + stats.strength * s.hpPerStrength + lv * s.hpPerLevel),
      maxStamina: Math.round(s.staminaBase + stats.strength * s.staminaPerStrength + stats.stealth * s.staminaPerStealth),
      maxMp: Math.round(s.mpBase + stats.magic * s.mpPerMagic + stats.intellect * s.mpPerIntellect),
    };
  }

  // ---------- Валидация ----------
  const NAME_RE = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9 '\-]{1,23}$/;
  const ids = (list) => list.map((o) => o.id);

  // Проверяет данные формы создания. Возвращает { ok, errors[], value }
  function validateNew(input) {
    const errors = [];
    const src = input && typeof input === 'object' ? input : {};
    const name = typeof src.name === 'string' ? src.name.trim().replace(/\s+/g, ' ') : '';
    if (!NAME_RE.test(name)) errors.push('Имя: 2–24 символа, начинается с буквы; буквы, цифры, пробел, «-» и «\'».');

    const appIn = src.appearance && typeof src.appearance === 'object' ? src.appearance : {};
    const appearance = {};
    for (const key of SINGLE) {
      const v = appIn[key];
      if (!ids(APPEARANCE[key]).includes(v)) errors.push(`Недопустимое значение: «${GROUP_LABELS[key]}».`);
      appearance[key] = v;
    }
    for (const [key, limit] of Object.entries(MULTI_LIMITS)) {
      const v = appIn[key] == null ? [] : appIn[key];
      if (!Array.isArray(v) || v.some((x) => !ids(APPEARANCE[key]).includes(x)) || new Set(v).size !== v.length) {
        errors.push(`Недопустимое значение: «${GROUP_LABELS[key]}».`);
      } else if (v.length > limit) {
        errors.push(`«${GROUP_LABELS[key]}»: не больше ${limit}.`);
      }
      appearance[key] = Array.isArray(v) ? v.slice() : [];
    }

    const stIn = src.stats && typeof src.stats === 'object' ? src.stats : {};
    const stats = {};
    let spent = 0;
    for (const s of STATS) {
      const v = stIn[s.id] ?? (s.id === 'shops' ? 1 : undefined);
      if (!Number.isInteger(v) || v < STAT_MIN || v > statCap(s.id, true)) {
        errors.push(`«${s.label}»: от ${STAT_MIN} до ${statCap(s.id, true)}.`);
      } else {
        spent += v - STAT_MIN;
      }
      stats[s.id] = v;
    }
    if (spent > settings.startPoints) errors.push(`Распределено больше очков, чем доступно (${settings.startPoints}).`);

    return { ok: errors.length === 0, errors, value: { name, appearance, stats, unspentPoints: settings.startPoints - spent } };
  }

  // Полная запись персонажа. Хранится отдельно от миров и может входить в любой мир.
  function createRecord(v, accountId, id, now) {
    const d = derive(v.stats);
    return {
      version: VERSION,
      id,
      accountId,
      name: v.name,
      createdAt: now,
      updatedAt: now,
      appearance: v.appearance,
      stats: v.stats,
      unspentPoints: v.unspentPoints,
      level: 1,
      xp: 0,
      vitals: { hp: d.maxHp, stamina: d.maxStamina, mp: d.maxMp },
      // инвентарь, слои экипировки (бельё всегда надето) и панель 1–0 — см. shared/inventory.js;
      // сервер заполняет его стартовым набором при создании
      inventory: null,
      spells: [],
      companions: [], // живут в контейнере-уменьшителе, призыв ограничен stats.companions
      shrinker: null,
      family: [],
      reputation: {},
      deaths: 0,
      lastWorld: null, // { worldId, x, y, z } — z: вертикальный уровень (-5..10)
      positions: {}, // последняя позиция в каждом мире: { [worldId]: { x, y, z, t } }
    };
  }

  // Смерть: -1 к случайной характеристике выше 1
  function applyDeathPenalty(stats, rnd = Math.random) {
    const pool = STATS.map((s) => s.id).filter((id) => stats[id] > STAT_MIN);
    if (!pool.length) return null;
    const id = pool[Math.floor(rnd() * pool.length)];
    stats[id] -= 1;
    return id;
  }

  return {
    VERSION, APPEARANCE, GROUP_LABELS, SINGLE, MULTI_LIMITS, STATS, STAT_MIN, STAT_MAX,
    settings, configure, statCap, derive, validateNew, createRecord, applyDeathPenalty,
    get MAX_CHARACTERS() { return settings.maxCharacters; },
    get START_POINTS() { return settings.startPoints; },
    get START_STAT_CAP() { return settings.startStatCap; },
  };
});
