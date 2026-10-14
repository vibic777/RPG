// Семья (шаг 17, GDD §10): отношения с жителями поселений, ухаживание и свадьба, семейный союз игроков, приёмные дети,
// жизнь семьи на базе (распорядок дня, помощники), старейшина-Патриарх (концовка «Семья» шага 16).
// Это ДАННЫЕ и чистые расчёты (общий файл сервера и клиента). Всё — без «взрослого» содержания: отношения, свадьба как
// праздник в поселении, совместная жизнь на базе. Семья хранится на герое: ch.family = { members, rel, bond }.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./worldgen'));
  else root.Family = factory(root.WorldGen);
})(typeof self !== 'undefined' ? self : this, function (WorldGen) {
  'use strict';
  const { mulberry32, hashString } = WorldGen;

  const settings = {
    familyPregnancyMin: 30, // длительность беременности в реальных минутах
    familyEnabled: true, // семья включена: отношения с жителями, свадьбы, дети, помощники на базе
    familyTalkAffinity: 4, // симпатия за разговор «по душам»
    familyTalkCooldownMin: 10, // разговор с тем же жителем приносит симпатию не чаще, чем раз в столько минут
    familyGiftValuePer: 10, // подарок: +1 симпатии за каждые столько крышек ценности предмета
    familyGiftMax: 15, // подарок: не больше стольких очков симпатии за раз
    familyGiftCooldownMin: 2, // подарки одному жителю — не чаще, чем раз в столько минут
    familyQuestAffinity: 5, // выполненное задание старосты: симпатия знакомых жителей того поселения
    familyHelpAffinity: 8, // отбитый набег: симпатия знакомых жителей поселения
    familyCourtAt: 60, // с какой симпатии можно начать ухаживать
    familyProposeAt: 80, // с какой симпатии (уже ухаживая) можно сделать предложение
    familyOppositeSex: true, // по GDD брак — с персонажем противоположного пола
    familyCeremonyCost: 200, // свадьба в поселении: плата за праздник, крышек
    familyMaxMembers: 8, // сколько членов семьи может жить на базе
    familyDayMin: 24, // длина «дня» распорядка семьи, минут (сон, работа, отдых)
    familyChildYearMin: 60, // ребёнок взрослеет на год за столько реальных минут
    familyAdultAge: 16, // с какого возраста ребёнок помогает на базе как взрослый; в поход можно раньше
    familyOrphansPerTown: 2, // сколько сирот ждёт семью в каждом поселении
    familyHelperTickSec: 5, // как часто помощники на базе делают свою работу, секунд
    familyGuardRadius: 12, // охрана: радиус защиты вокруг флага базы, клеток
    familyGuardDamage: 8, // охрана: урон по врагу у базы за такт (+10% за уровень члена семьи)
    familyCraftSpeedup: 0.25, // ремесло: насколько быстрее идёт очередь крафта, пока помощник дома (доля)
    familyGatherMin: 3, // сбор: одна единица ресурса в сундук базы за столько минут работы
    familyHealPerTick: 3, // лечение: здоровья герою на базе за такт
    familyBondAskSec: 60, // предложение семейного союза другому игроку действует столько секунд
  };
  function configure(game) {
    for (const k of Object.keys(settings)) if (game && game[k] !== undefined) settings[k] = game[k];
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- Стадии отношений ----------
  // auto — достигается симпатией; action — действием в диалоге (ухаживание, помолвка, свадьба)
  const STAGES = {
    stranger: { name: 'Незнакомец', icon: '·', at: 0, auto: true },
    acquaint: { name: 'Знакомый', icon: '🙂', at: 15, auto: true },
    friend: { name: 'Друг', icon: '😊', at: 35, auto: true },
    close: { name: 'Близкий друг', icon: '💛', at: () => settings.familyCourtAt, auto: true },
    courting: { name: 'Ухаживание', icon: '🌼', action: 'fam_court' },
    engaged: { name: 'Помолвка', icon: '💍', action: 'fam_propose' },
    partner: { name: 'Супруг(а)', icon: '🏠', action: 'fam_wed' },
  };
  const STAGE_IDS = Object.keys(STAGES);
  const AUTO = STAGE_IDS.filter((s) => STAGES[s].auto);
  const atOf = (s) => (typeof STAGES[s].at === 'function' ? STAGES[s].at() : STAGES[s].at);
  function autoStage(aff) {
    let out = 'stranger';
    for (const s of AUTO) if (aff >= atOf(s)) out = s;
    return out;
  }
  // Множитель роста симпатии от отношения поселения к герою
  const TIER_MUL = { hostile: 0, unfriendly: 0.5, neutral: 1, friendly: 1.25, honored: 1.5 };
  // Изменить симпатию; стадии-действия не сбрасываются сами. Возвращает фактическое изменение.
  function addAffinity(rel, amount, tier = 'neutral') {
    const k = amount > 0 ? TIER_MUL[tier] == null ? 1 : TIER_MUL[tier] : 1;
    const before = rel.affinity || 0;
    rel.affinity = clamp(Math.round((before + amount * k) * 10) / 10, 0, 100);
    if (!rel.stage || STAGES[rel.stage].auto) rel.stage = autoStage(rel.affinity);
    return rel.affinity - before;
  }
  const giftAffinity = (item) => clamp(Math.round(((item && item.value) || 0) / settings.familyGiftValuePer), 1, settings.familyGiftMax);
  const giftable = (item) => Boolean(item && item.value > 0 && !item.fixed && !item.quest && !item.noTrade && item.id !== 'caps'); // самородок — можно
  const ready = (at, min, now) => !at || now - at >= min * 60000;

  // ---------- Пол (GDD: брак — с персонажем противоположного пола) ----------
  const FEMALE = new Set(['Агафья', 'Варвара', 'Дуня', 'Зоя', 'Клава', 'Марфа', 'Ольга', 'Рада', 'Таисия', 'Ярина', 'Нюра', 'Алёна', 'Дарья', 'Стеша', 'Фрося', 'Лиза', 'Маша', 'Катя']);
  const genderOfName = (name) => (FEMALE.has(String(name)) ? 'female' : 'male');
  const heroGender = (ch) => (ch && ch.appearance && ch.appearance.gender) || 'male';
  const compatible = (ch, gender) => !settings.familyOppositeSex || heroGender(ch) !== gender;

  // ---------- Семья героя ----------
  const blank = () => ({ members: [], rel: {}, bond: null });
  const of = (ch) => {
    if (!ch.family || typeof ch.family !== 'object' || Array.isArray(ch.family)) ch.family = blank(); // [] — заготовка шага 1 в записи героя
    const f = ch.family;
    if (!Array.isArray(f.members)) f.members = [];
    if (!f.rel || typeof f.rel !== 'object') f.rel = {};
    if (f.bond === undefined) f.bond = null;
    return f;
  };
  const relKey = (worldId, npcId) => `${worldId}:${npcId}`;
  const partnerOf = (f) => f.members.find((m) => m.kind === 'partner') || null;
  const hasSpouse = (f) => Boolean(partnerOf(f) || f.bond);
  // Кого сейчас «добивается» герой (ухаживание или помолвка) — не больше одного
  const suitor = (f) => Object.entries(f.rel).find(([, r]) => r.stage === 'courting' || r.stage === 'engaged') || null;

  // Можно ли перейти на стадию-действие; null — можно, строка — почему нет. o: { ch, rel, gender }
  function canAdvance(to, o) {
    const f = of(o.ch), rel = o.rel;
    if (to === 'fam_court') {
      if (!compatible(o.ch, o.gender)) return 'Семью по правилам этого мира создают с персонажем противоположного пола.';
      if (hasSpouse(f)) return 'У вас уже есть супруг(а).';
      if (rel.stage === 'courting' || rel.stage === 'engaged') return 'Вы уже ухаживаете.';
      if (suitor(f)) return 'Вы уже ухаживаете за другим человеком.';
      if ((rel.affinity || 0) < settings.familyCourtAt) return `Нужна симпатия ${settings.familyCourtAt} (сейчас ${Math.floor(rel.affinity || 0)}).`;
      return null;
    }
    if (to === 'fam_propose') {
      if (rel.stage !== 'courting') return 'Сначала — ухаживание.';
      if ((rel.affinity || 0) < settings.familyProposeAt) return `Нужна симпатия ${settings.familyProposeAt} (сейчас ${Math.floor(rel.affinity || 0)}).`;
      return null;
    }
    return 'Неизвестный шаг.';
  }
  // Условия свадьбы. o: { ch, rel, tier, money, freeBeds }
  function ceremonyCheck(o) {
    const f = of(o.ch);
    if (!o.rel || o.rel.stage !== 'engaged') return 'Свадьба — после помолвки.';
    if (hasSpouse(f)) return 'У вас уже есть супруг(а).';
    if (o.tier === 'hostile' || o.tier === 'unfriendly') return 'Поселение не станет праздновать с тем, кого недолюбливает (нужно отношение не ниже безразличия).';
    if (f.members.length >= settings.familyMaxMembers) return `В семье уже ${settings.familyMaxMembers} человек.`;
    if (!(o.freeBeds > 0)) return 'Супругу нужна своя кровать на вашей базе (поставьте кровать).';
    if ((o.money || 0) < settings.familyCeremonyCost) return `Праздник стоит ${settings.familyCeremonyCost} крышек.`;
    return null;
  }

  // ---------- Члены семьи ----------
  const KINDS = {
    partner: { name: 'Супруг(а)', icon: '💍' },
    child: { name: 'Ребёнок', icon: '🧒' },
    elder: { name: 'Старейшина', icon: '👴' },
  };
  const ROLES = {
    guard: { name: 'Охрана', icon: '🛡', hint: 'Защищает базу: бьёт врагов у флага базы.' },
    craft: { name: 'Ремесло', icon: '🔨', hint: 'Помогает в мастерской: очередь крафта идёт быстрее.' },
    gather: { name: 'Сбор', icon: '🧺', hint: 'Собирает ресурсы (дерево, камень, металлолом, ткань) в сундук базы.' },
    heal: { name: 'Лечение', icon: '✚', hint: 'Лечит вас, пока вы на базе.' },
  };
  const ROLE_IDS = Object.keys(ROLES);
  const GATHER_POOL = ['wood', 'stone', 'scrap_metal', 'cloth', 'hide'];
  // ноль, отрицательное или мусор — по умолчанию 60 мин; малые значения (ускоренные проверки) действуют как заданы
  const yearMs = () => (Number(settings.familyChildYearMin) > 0 ? Number(settings.familyChildYearMin) : 60) * 60000;
  const ageOf = (m, now = Date.now()) => (m.kind === 'child' ? Math.floor((m.age0 || 0) + Math.max(0, now - (m.since || now)) / yearMs()) : m.age || 30);
  const isAdult = (m, now = Date.now()) => m.kind !== 'child' || ageOf(m, now) >= settings.familyAdultAge;
  // Сколько лет ребёнок учился своему делу (до взрослости)
  const studied = (m, now = Date.now()) => Math.max(0, Math.min(ageOf(m, now), settings.familyAdultAge) - (m.age0 || 0));
  // Рост: повзрослевший ребёнок получает дело, которому учился, и уровень за учёбу. true — повзрослел сейчас.
  function grow(m, now = Date.now()) {
    if (m.kind !== 'child' || m.grown || !isAdult(m, now)) return false;
    m.grown = true;
    m.role = ROLES[m.study] ? m.study : 'gather';
    m.level = Math.max(m.level || 1, 1 + Math.floor(studied(m, now) / 2));
    return true;
  }
  let seq = 0;
  function makeMember(o, now = Date.now()) {
    const m = {
      id: o.id || `f${now.toString(36)}${(seq++ % 1296).toString(36)}`, kind: KINDS[o.kind] ? o.kind : 'child', name: String(o.name || 'Безымянный').slice(0, 40),
      gender: o.gender === 'female' ? 'female' : 'male', origin: String(o.origin || 'npc').slice(0, 24), since: now, level: clamp(Math.floor(Number(o.level) || 1), 1, 40),
      role: ROLES[o.role] ? o.role : null, out: false,
    };
    if (m.kind === 'child') { m.age0 = clamp(Math.floor(o.age == null ? 6 : Number(o.age) || 0), 0, settings.familyAdultAge); m.study = ROLES[o.study] ? o.study : 'gather'; if (m.age0 >= settings.familyAdultAge) grow(m, now); }
    else m.age = clamp(Math.floor(Number(o.age) || 30), 16, 200);
    if (o.look) m.look = o.look;
    return m;
  }
  // Кто «живёт» на базе: по кровати на каждого дома (не в спутниках); первые по времени появления
  function housed(f, beds) {
    const home = f.members.filter((m) => !m.out).sort((a, b) => a.since - b.since);
    return new Set(home.slice(0, Math.max(0, beds | 0)).map((m) => m.id));
  }
  const homeCount = (f) => f.members.filter((m) => !m.out).length;
  const freeBeds = (f, beds) => Math.max(0, (beds | 0) - homeCount(f));
  // Распорядок: доля дня → сон / работа / отдых; i — сдвиг, чтобы семья не ходила строем
  function phase(now = Date.now(), i = 0) {
    const len = settings.familyDayMin * 60000;
    const t = (((now + i * 0.03 * len) % len) + len) % len / len;
    return t < 0.3 ? 'sleep' : t < 0.8 ? 'work' : 'rest';
  }
  const PHASES = { sleep: { name: 'спит', icon: '💤' }, work: { name: 'работает', icon: '⚒' }, rest: { name: 'отдыхает', icon: '☕' } };
  // Может ли член семьи помогать прямо сейчас (взрослый, дома, с кроватью, рабочее время)
  const helping = (m, housedSet, now, i) => Boolean(m.role && !m.out && housedSet.has(m.id) && isAdult(m, now) && phase(now, i) === 'work');

  // ---------- Сироты ----------
  // По сиду мира и поселению: имя, пол, возраст 3…11 — одинаково на сервере и клиенте
  const ORPHAN_NAMES = { female: ['Алёна', 'Дарья', 'Стеша', 'Фрося', 'Лиза', 'Маша', 'Катя', 'Нюра'], male: ['Ваня', 'Петя', 'Сёма', 'Гриша', 'Митя', 'Федя', 'Костя', 'Лёша'] };
  function orphansFor(seed, townId) {
    const rnd = mulberry32(hashString(`${seed}:orph:${townId}`));
    const out = [];
    for (let k = 0; k < settings.familyOrphansPerTown; k++) {
      const gender = rnd() < 0.5 ? 'female' : 'male', pool = ORPHAN_NAMES[gender];
      out.push({ id: `o${townId}_${k}`, name: pool[Math.floor(rnd() * pool.length)], gender, age: 3 + Math.floor(rnd() * 9) });
    }
    return out;
  }

  // ---------- Проверка записи (импорт героя, ГМ) ----------
  function sanitize(f) {
    const out = blank();
    if (!f || typeof f !== 'object' || Array.isArray(f)) return out;
    for (const m of Array.isArray(f.members) ? f.members.slice(0, settings.familyMaxMembers) : []) {
      if (!m || !KINDS[m.kind]) continue;
      const x = makeMember(m, Number(m.since) || Date.now());
      x.id = String(m.id || x.id).slice(0, 24); x.out = Boolean(m.out);
      if (m.kind === 'child') { x.age0 = clamp(Math.floor(Number(m.age0) || 0), 0, settings.familyAdultAge); x.grown = Boolean(m.grown); if (m.grown && ROLES[m.role]) x.role = m.role; }
      if (m.gatherAcc) x.gatherAcc = Number(m.gatherAcc) || 0;
      if(m.pregnancy&&Number.isFinite(m.pregnancy.due)&&m.gender==='female'&&m.kind==='partner'&&x.age>=18)x.pregnancy={due:m.pregnancy.due,partner:String(m.pregnancy.partner||'').slice(0,40)};
      out.members.push(x);
    }
    for (const [k, r] of Object.entries(f.rel && typeof f.rel === 'object' ? f.rel : {}).slice(0, 200)) {
      if (!r || typeof r !== 'object') continue;
      out.rel[String(k).slice(0, 80)] = { name: String(r.name || '?').slice(0, 40), town: String(r.town || '').slice(0, 40), gender: r.gender === 'female' ? 'female' : 'male', affinity: clamp(Number(r.affinity) || 0, 0, 100), stage: STAGES[r.stage] && r.stage !== 'partner' ? r.stage : autoStage(clamp(Number(r.affinity) || 0, 0, 100)), talkAt: Number(r.talkAt) || 0, giftAt: Number(r.giftAt) || 0 };
    }
    if (f.bond && f.bond.characterId) out.bond = { accountId: String(f.bond.accountId || ''), characterId: String(f.bond.characterId), name: String(f.bond.name || '').slice(0, 40), at: Number(f.bond.at) || 0 };
    if(f.pregnancy&&Number.isFinite(f.pregnancy.due))out.pregnancy={due:f.pregnancy.due,partner:String(f.pregnancy.partner||'').slice(0,40)};
    return out;
  }
  function validate() {
    const errs = [];
    if (atOf('close') <= atOf('friend')) errs.push('familyCourtAt должен быть больше порога «друг»');
    if (settings.familyProposeAt < settings.familyCourtAt) errs.push('familyProposeAt меньше familyCourtAt');
    for (const r of GATHER_POOL) if (!r) errs.push('пустой ресурс сбора');
    return errs;
  }

  return {
    settings, configure, STAGES, STAGE_IDS, TIER_MUL, KINDS, ROLES, ROLE_IDS, PHASES, GATHER_POOL, FEMALE,
    autoStage, addAffinity, giftAffinity, giftable, ready, genderOfName, heroGender, compatible,
    blank, of, relKey, partnerOf, hasSpouse, suitor, canAdvance, ceremonyCheck,
    ageOf, isAdult, studied, grow, makeMember, housed, homeCount, freeBeds, phase, helping, orphansFor, sanitize, validate,
  };
});
