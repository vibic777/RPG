// Задания и концовки (шаг 16, GDD §6.14, §11). ДАННЫЕ и чистые расчёты — общий файл сервера и клиента.
// Задание: { id, name, kind, main?, text, done, goals: [цель], reward, next? }. Цели (всё отслеживает сервер):
//   kill { enemy | faction | family, n, spawn? }  — убить (spawn: сюжетный главарь появляется в мире при взятии задания)
//   fetch { item, n }       — принести старосте (предметы забираются при сдаче)
//   deliver { item, to }    — доставить посылку старосте поселения to
//   escort { to }           — довести жителя до поселения to (житель идёт за героем, может погибнуть)
//   defend { town }         — отбить набег на поселение (начинается при взятии)
//   explore { level?, depth } — спуститься на вертикальный уровень (тип входа level) не мельче depth
//   tame { family | enemy, n } — приручить / уговорить в спутники
//   craft { item, n }       — изготовить (готовый заказ крафта)
//   rep { faction, min }    — заслужить репутацию у фракции
//   any { of: [цели] }      — любая из целей (выбор: убить главаря или подружиться с бандой)
//   finale {}               — встреча с Железным Патриархом: выполняется выбором концовки
// Награда: { caps, xp, items: [[id, n]], rep (поселению-заказчику), fac: { фракция: n }, spell, recipe }.
// Разговоры — в формате диалогов шага 15 (shared/settlements.js): { start, nodes: { id: { text, options } } }.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./worldgen'), require('./settlements'), require('./factions'));
  else root.Quests = factory(root.WorldGen, root.Settlements, root.Factions);
})(typeof self !== 'undefined' ? self : this, function (WorldGen, Settlements, Factions) {
  'use strict';
  const { mulberry32, hashString } = WorldGen;

  const settings = {
    questsEnabled: true, // задания включены (старосты раздают, сервер отслеживает цели)
    questBoardSize: 3, // сколько процедурных заданий у старосты одновременно
    questBoardRefreshMin: 60, // раз в сколько минут обновляется доска заданий старосты
    questMaxActive: 8, // сколько заданий может быть взято в мире одновременно (на всю группу)
    questBossDist: 45, // на каком расстоянии от поселения появляется сюжетный главарь, клеток
    questRewardFactor: 1, // множитель денег и опыта в наградах
    questEscortSpeed: 2.6, // скорость сопровождаемого жителя, клеток/с
    questDeliverMaxDist: 160, // доставка и сопровождение — в поселение не дальше этого, клеток
    endingRuleGangs: 2, // «Властелин пустоши»: убить Патриарха, дружа (≥ дружбы) с этим числом банд
  };
  function configure(game) {
    for (const k of Object.keys(settings)) if (game && game[k] !== undefined) settings[k] = game[k];
  }

  const KINDS = {
    kill: { name: 'Убить', icon: '⚔' }, fetch: { name: 'Принести', icon: '📦' }, deliver: { name: 'Доставить', icon: '✉' },
    escort: { name: 'Сопроводить', icon: '🚶' }, defend: { name: 'Защитить', icon: '🛡' }, explore: { name: 'Исследовать', icon: '🕳' },
    tame: { name: 'Приручить', icon: '🐾' }, craft: { name: 'Изготовить', icon: '🔨' }, rep: { name: 'Подружиться', icon: '🤝' },
    any: { name: 'На выбор', icon: '⚖' }, finale: { name: 'Финал', icon: '👑' },
  };
  const GOAL_TYPES = Object.keys(KINDS);

  // ---------- Сюжетная цепочка ----------
  const MAIN = [
    { id: 'm0_awakening', name: 'Инвентаризация трупа', kind: 'kill', main: true,
      text: 'Ты очнулся в медицинском подземелье без памяти. Марта Клёпка просит помочь выбраться: отключи охрану и отбейся от поднятого аварийной системой мертвеца. По дороге реши, что спасти из соседнего отсека.',
      done: 'Марта вывела тебя к Ржавограду. Терминал назвал тебя пациентом Палимпсеста.', goals: [{ type: 'kill', enemy: 'zombie', n: 1, spawn: true }], reward: { caps: 35, xp: 100, items: [['medkit', 1]] }, next: 'm0_water' },
    { id: 'm0_water', name: 'Город с тремя крышами', kind: 'fetch', main: true,
      text: 'Староста Лада обещала воду и крышу, если ты поможешь восстановить насос. Принеси металлолом и электронику; Марта может использовать те же детали для мастерской.',
      done: 'Насос запущен. На трассе видели рейдеров Ржавого Зуба.', goals: [{ type: 'fetch', item: 'scrap_metal', n: 4 }], reward: { caps: 60, xp: 120, items: [['water_clean', 2]], fac: { alliance: 5 } }, next: 'm1_rumors' },
    { id: 'm1_rumors', name: 'Слухи о Патриархе', kind: 'kill', main: true,
      text: 'Староста рассказывает: банды пустоши подчиняются Железному Патриарху — киборгу, от которого осталась лишь голова в броне. Чтобы до него добраться, придётся разобраться с бандами. Начни с рейдеров: проредите их отряды.',
      done: 'Рейдеры притихли. Староста называет имя их главаря — Барон Ржавый Зуб.',
      goals: [{ type: 'kill', faction: 'raiders', n: 5 }], reward: { caps: 80, xp: 150, fac: { alliance: 5 } }, next: 'm2_baron' },
    { id: 'm2_baron', name: 'Барон Ржавый Зуб', kind: 'any', main: true,
      text: 'Барон Ржавый Зуб засел в пустоши со свитой (метка в журнале). Убей его — или заслужи уважение рейдеров (бей их врагов, мутантов), и Барон сам расскажет, где искать остальных.',
      done: 'С рейдерами покончено — так или иначе. Следующий — Пророк Язв, вожак мутантов.',
      goals: [{ type: 'any', of: [{ type: 'kill', enemy: 'boss_raider', n: 1, spawn: true }, { type: 'rep', faction: 'raiders', min: 25 }] }],
      reward: { caps: 200, xp: 400, items: [['gold_nugget', 1]] }, next: 'm3_prophet' },
    { id: 'm3_prophet', name: 'Пророк Язв', kind: 'any', main: true,
      text: 'Пророк Язв ведёт Детей Язв и травит колодцы. Убей его — или стань своим для мутантов (их враги — рейдеры).',
      done: 'Дети Язв больше не угроза. Говорят, Клан Шестерни прячет в бункерах ключи от логова Патриарха.',
      goals: [{ type: 'any', of: [{ type: 'kill', enemy: 'boss_mutant', n: 1, spawn: true }, { type: 'rep', faction: 'mutants', min: 25 }] }],
      reward: { caps: 250, xp: 500, items: [['medkit', 2]] }, next: 'm4_gear' },
    { id: 'm4_gear', name: 'Клан Шестерни', kind: 'any', main: true,
      text: 'Спустись в любой бункер хотя бы на второй уровень — там следы Клана Шестерни. Потом разберись с Командором Шестерней: убей его или заключи союз с кланом (их враги — Клан Тени).',
      done: 'Командор больше не стоит на пути. Последний клан — Тени.',
      goals: [{ type: 'explore', level: 'bunker', depth: 2 }, { type: 'any', of: [{ type: 'kill', enemy: 'boss_cyborg', n: 1, spawn: true }, { type: 'rep', faction: 'cyborgs', min: 25 }] }],
      reward: { caps: 300, xp: 700, items: [['electronics', 5]] }, next: 'm5_shadow' },
    { id: 'm5_shadow', name: 'Тень над пустошью', kind: 'any', main: true,
      text: 'Мастер Безликий и Клан Тени — глаза и уши Патриарха. Убей Мастера или заслужи доверие клана (их враги — киборги Шестерни).',
      done: 'Банды больше не заслоняют Патриарха. Он сам выходит навстречу.',
      goals: [{ type: 'any', of: [{ type: 'kill', enemy: 'boss_ninja', n: 1, spawn: true }, { type: 'rep', faction: 'ninja', min: 25 }] }],
      reward: { caps: 350, xp: 900, spell: 'smoke' }, next: 'm5_archive' },
    { id: 'm5_archive', name: 'Маска за маской', kind: 'fetch', main: true,
      text: 'Мастер Безликий нашёл в архиве три несовпадающие записи о тебе. Добудь электронный ключ, чтобы сверить архивную копию с терминалом Палимпсеста.',
      done: 'Записи подтверждают: ты сам согласился на процедуру стирания памяти.', goals: [{ type: 'fetch', item: 'electronics', n: 3 }], reward: { caps: 180, xp: 450, items: [['antirad', 2]], fac: { ninja: 5 } }, next: 'm5_station' },
    { id: 'm5_station', name: 'Нулевая станция', kind: 'explore', main: true,
      text: 'Найди вход в глубокий бункер и восстанови журнал «Мнемы». Ты был свидетелем запуска Программы Тишина, но записи о последнем решении пока закрыты.',
      done: '«Мнема» подтвердила, что память была стёрта по твоей просьбе. Нужен ключ Железного Патриарха.', goals: [{ type: 'explore', level: 'bunker', depth: 3 }], reward: { caps: 250, xp: 700, items: [['electronics', 5]], fac: { alliance: 5 } }, next: 'm5_war' },
    { id: 'm5_war', name: 'Война за последнюю кнопку', kind: 'any', main: true,
      text: 'Патриарх удерживает физический ключ к передатчику. Подготовься, собери союзников и доберись до цитадели: можно сразиться с ним или найти путь к переговорам.',
      done: 'Путь к цитадели открыт. Патриарх ждёт решения.', goals: [{ type: 'any', of: [{ type: 'kill', faction: 'cyborgs', n: 4 }, { type: 'rep', faction: 'alliance', min: 25 }] }], reward: { caps: 300, xp: 800, items: [['medkit', 2], ['antirad', 2]] }, next: 'm6_patriarch' },
    { id: 'm6_patriarch', name: 'Железный Патриарх', kind: 'finale', main: true,
      text: 'Железный Патриарх ждёт со свитой киборгов (метка в журнале). Если банды тебе друзья, он станет говорить (T рядом): можно служить ему, объединить фракции или даже позвать его в семью. Или — сразиться.',
      done: 'История Патриарха завершена. Пустошь живёт дальше — и ты вместе с ней.',
      goals: [{ type: 'finale' }, { type: 'kill', enemy: 'boss_super', n: 1, spawn: true, optional: true }], reward: { caps: 1000, xp: 3000, items: [['gold_nugget', 5]] } },
  ];
  const MAIN_IDS = MAIN.map((q) => q.id);
  const BY_ID = new Map(MAIN.map((q) => [q.id, q]));

  // Авторские побочные поручения; появляются на досках, прогресс общему миру, награда участникам.
  // Их цели намеренно собраны из уже поддерживаемых типов, чтобы не менять протокол квестов.
  const SIDE_STORIES = [
    { id: 'rain_tax', name: 'Налог на дождь', kind: 'fetch', text: 'Ладе нужны детали насоса. Принеси металлолом, а заодно выясни, почему резервный склад закрыт.', goals: [{ type: 'fetch', item: 'scrap_metal', n: 3 }], reward: { caps: 45, xp: 90, items: [['water_clean', 2]], rep: 3 } },
    { id: 'noisy_drone', name: 'Мальчик и гулкий дрон', kind: 'kill', text: 'Разведывательный дрон кружит над поселением. Найди и выведи из строя его патруль.', goals: [{ type: 'kill', enemy: 'walker_patrol', n: 2 }], reward: { caps: 60, xp: 110, items: [['electronics', 2]], fac: { alliance: 3 } } },
    { id: 'quiet_ward', name: 'Палата тишины', kind: 'fetch', text: 'Целительнице нужны аптечки для пациентов, которых поселение боится принять.', goals: [{ type: 'fetch', item: 'medkit', n: 2 }], reward: { caps: 50, xp: 100, fac: { alliance: 4 } } },
    { id: 'roof_materials', name: 'Крыша на вырост', kind: 'fetch', text: 'Семье и воротам нужны строительные материалы. Собери древесину для ремонта.', goals: [{ type: 'fetch', item: 'wood', n: 5 }], reward: { caps: 35, xp: 75, items: [['scrap_metal', 2]], rep: 4 } },
    { id: 'double_toll', name: 'Доля за охрану от охраны', kind: 'kill', text: 'Караван платит и стражникам, и бандитам. Утихомирь отряд, требующий двойную пошлину.', goals: [{ type: 'kill', faction: 'raiders', n: 3 }], reward: { caps: 80, xp: 130, fac: { alliance: 5 } } },
    { id: 'raider_ledger', name: 'Бухгалтер пустоши', kind: 'kill', text: 'Бухгалтер Барона пропал вместе с книгой долгов. Осмотри лагерь и разберись с охраной.', goals: [{ type: 'kill', enemy: 'raider_thug', n: 4 }], reward: { caps: 90, xp: 140, fac: { raiders: 4 } } },
    { id: 'mutant_water', name: 'Вода, которая лечит', kind: 'fetch', text: 'Пророку Язв нужны электронные детали для анализа заражённого источника.', goals: [{ type: 'fetch', item: 'electronics', n: 2 }], reward: { caps: 55, xp: 115, items: [['antirad', 2]], fac: { mutants: 5 } } },
    { id: 'false_prophet', name: 'Пустая маска', kind: 'kill', text: 'Самозванец прикрывается именем Пророка и нападает на караваны. Найди его отряд.', goals: [{ type: 'kill', faction: 'mutants', n: 3 }], reward: { caps: 70, xp: 130, fac: { alliance: 4 } } },
    { id: 'disconnect', name: 'Подключение по умолчанию', kind: 'fetch', text: 'Киборгу-добровольцу нужен изолирующий модуль. Принеси электронику для его сборки.', goals: [{ type: 'fetch', item: 'electronics', n: 3 }], reward: { caps: 75, xp: 150, items: [['electronics', 2]], fac: { cyborgs: 5 } } },
    { id: 'robot_nurse', name: 'Человек в запчастях', kind: 'kill', text: 'Старый медицинский робот принял пациентов за комплектующие. Останови охрану клиники.', goals: [{ type: 'kill', enemy: 'droid_repair', n: 2 }], reward: { caps: 70, xp: 140, items: [['medkit', 2]] } },
    { id: 'three_witnesses', name: 'Три свидетеля', kind: 'fetch', text: 'Найди лекарство, пропавшее между тремя караванщиками. Принеси аптечку для сверки накладных.', goals: [{ type: 'fetch', item: 'medkit', n: 1 }], reward: { caps: 50, xp: 100, rep: 5 } },
    { id: 'shadow_signal', name: 'Шпион вышел из чата', kind: 'kill', text: 'Курьер Клана Тени не вернулся с маршрута. Убери засаду и найди его рацию.', goals: [{ type: 'kill', faction: 'ninja', n: 2 }], reward: { caps: 80, xp: 145, fac: { ninja: 5 } } },
    { id: 'pyr_student', name: 'Зачёт по пиромантии', kind: 'fetch', text: 'Ученик Ордена устроил маленький пожар. Принеси чистую воду и помоги потушить лабораторию.', goals: [{ type: 'fetch', item: 'water_clean', n: 2 }], reward: { caps: 65, xp: 120, fac: { mages: 5 } } },
    { id: 'ion_samples', name: 'Справочник по концам света', kind: 'explore', text: 'Орден собирает наблюдения об аномальных зонах. Спустись в бункер и отметь ионный след.', goals: [{ type: 'explore', level: 'bunker', depth: 1 }], reward: { caps: 70, xp: 130, items: [['electronics', 2]], fac: { mages: 4 } } },
    { id: 'smart_turret', name: 'Слишком умный охранник', kind: 'kill', text: 'Турель не может решить, какой закон действует после конца света. Останови патруль вокруг неё.', goals: [{ type: 'kill', enemy: 'walker_patrol', n: 3 }], reward: { caps: 75, xp: 140, items: [['electronics', 3]] } },
    { id: 'nest_signal', name: 'Улей прислал жалобу', kind: 'kill', text: 'Чужой ретранслятор привлекает существ к поселению. Ослабь охрану гнезда и принеси сведения.', goals: [{ type: 'kill', faction: 'hive', n: 2 }], reward: { caps: 90, xp: 170, items: [['antirad', 1], ['electronics', 2]] } },
    { id: 'dragon_roof', name: 'Дракон на крыше', kind: 'tame', text: 'Молодой дракон поселился на крыше и требует блестящую дань. Найди способ успокоить его.', goals: [{ type: 'tame', family: 'dragon', n: 1 }], reward: { caps: 100, xp: 180, items: [['gold_nugget', 1]] } },
    { id: 'birthday_bot', name: 'День рождения по архиву', kind: 'kill', text: 'Праздничный терминал разбудил боевую систему. Останови патруль, пока гости не стали пунктом программы.', goals: [{ type: 'kill', enemy: 'walker_patrol', n: 2 }], reward: { caps: 55, xp: 110, items: [['water_clean', 2]] } },
    { id: 'acid_samples', name: 'Кислотный справочник', kind: 'fetch', text: 'Собирателю нужны ткани и аптечки для экспедиции через кислотный дождь.', goals: [{ type: 'fetch', item: 'cloth', n: 4 }], reward: { caps: 50, xp: 100, items: [['antirad', 1]], fac: { alliance: 3 } } },
    { id: 'graveyard_shift', name: 'Ночная смена', kind: 'kill', text: 'Сторож кладбища утверждает, что мертвецы просто задержались после смены. Уменьши толпу у ворот.', goals: [{ type: 'kill', enemy: 'zombie', n: 5 }], reward: { caps: 60, xp: 120, items: [['cloth', 3]] } },
  ];
  function sideBoard(seed, town, env, completed = []) {
    const rnd = mulberry32(hashString(`${seed}:side:${town.id}`));
    const start = Math.floor(rnd() * SIDE_STORIES.length), out = [];
    for (let i = 0; i < SIDE_STORIES.length && out.length < 2; i++) {
      const src = SIDE_STORIES[(start + i) % SIDE_STORIES.length];
      const q = { ...src, id: `side_${town.id}_${src.id}`, main: false, giver: town.id };
      if (completed.includes(q.id)) continue;
      if (validateQuest(q, env).length) continue;
      out.push(q);
    }
    return out;
  }

  // ---------- Концовки ----------
  const ENDINGS = {
    destroy: { name: 'Падение Железного Патриарха', text: 'Бронированное тело рухнуло, и голова старого тирана погасла. Банды разбежались, поселения впервые за много лет вздохнули свободно.' },
    rule: { name: 'Властелин пустоши', text: 'Патриарх пал от твоей руки, а банды, что звали тебя другом, присягнули новому хозяину. Пустошь теперь твоя — со всеми её поселениями и бедами.' },
    ally: { name: 'Правая рука Патриарха', text: 'Ты преклонил колено перед Железным Патриархом. Банды служат тебе, как служили ему; поселения платят дань и боятся.' },
    unite: { name: 'Объединённая пустошь', text: 'Патриарх выслушал тебя и сложил оружие. Банды и поселения заключили мир — впервые со времён катастрофы. Ты стал тем, кто их свёл.' },
    family: { name: 'Новая семья', text: 'Старый киборг, никогда не знавший тепла, согласился стать частью твоей семьи. Банды не знают, что и думать, но войны больше нет.' },
  };
  // Условия разговора с Патриархом (флаги для условий диалога)
  function parleyFlags(ch) {
    const r = (f) => Factions.repOf(ch, f), s = Settlements.settings;
    const gangsOk = Factions.GANGS.every((g) => r(g) > Factions.settings.factionAttackAt);
    return {
      talk: !Factions.hostile(ch, 'patriarch'),
      ally: r('patriarch') >= s.repFriendlyAt,
      unite: gangsOk && r('alliance') >= s.repFriendlyAt,
      family: r('patriarch') >= s.repHonoredAt,
    };
  }
  // Концовка по способу: kill — убит Патриарх; ally / unite / family — выбор в разговоре (null, если условие не выполнено)
  function endingFor(how, ch) {
    if (how === 'kill') return Factions.gangsAtLeast(ch, Settlements.settings.repFriendlyAt) >= settings.endingRuleGangs ? 'rule' : 'destroy';
    const f = parleyFlags(ch);
    if (!f.talk) return null;
    if (how === 'ally') return f.ally ? 'ally' : null;
    if (how === 'unite') return f.unite ? 'unite' : null;
    if (how === 'family') return f.family ? 'family' : null;
    return null;
  }

  // ---------- Разговоры ----------
  const DLG_ACTIONS = ['ally', 'unite', 'family', 'fight'];
  const DLG_CONDS = ['ally', 'unite', 'family'];
  const bye = { text: 'Я ещё вернусь.', action: 'bye' };
  const DIALOGUES = {
    patriarch: { start: 'hi', nodes: {
      hi: { text: 'Железный Патриарх: «Значит, это ты, {player}, перебил или переманил моих псов. Говори, зачем пришёл, пока я добрый.»', options: [
        { text: 'Я пришёл служить тебе.', next: 'ally', cond: 'ally' },
        { text: 'Банды и поселения устали воевать. Отпусти их.', next: 'unite', cond: 'unite' },
        { text: 'Старик, тебе нужна не армия, а семья.', next: 'family', cond: 'family' },
        { text: 'Ты прожил слишком долго. Защищайся!', action: 'fight' }, bye] },
      ally: { text: 'Патриарх: «Служить? Многие клялись. Поклянись — и банды будут слушать тебя, как меня.»', options: [{ text: 'Клянусь.', action: 'ally' }, { text: 'Я передумал.', next: 'hi' }] },
      unite: { text: 'Патриарх: «Мир… Банды тебя уважают, поселения тебе верят. Может, ты и прав. Я устал держать всех в страхе.»', options: [{ text: 'Тогда сложи оружие — и пусть будет мир.', action: 'unite' }, { text: 'Я передумал.', next: 'hi' }] },
      family: { text: 'Патриарх долго молчит. «Семья… У меня не было никого с тех пор, как осталась одна голова. Ты серьёзно?»', options: [{ text: 'Серьёзно. Пойдём домой.', action: 'family' }, { text: 'Я передумал.', next: 'hi' }] },
    } },
  };
  for (const q of MAIN) {
    DIALOGUES[q.id] = { start: 'hi', nodes: { hi: { text: `{npc}: «${q.text}»`, options: [{ text: 'Берусь.', action: 'accept' }, { text: 'Позже.', action: 'bye' }] } } };
  }
  const validateDlg = (d, id) => Settlements.validateDialogue(d, id, { actions: [...DLG_ACTIONS, 'accept'], conds: DLG_CONDS });

  // ---------- Процедурные задания старост ----------
  const KILL_POOL = {
    village: ['wolf', 'boar', 'zombie', 'raider_thug'], town: ['raider_gunner', 'mutant_irradiated', 'zombie_runner', 'wolf_mutant'],
    base: ['mutant_slasher', 'raider_marauder', 'cyborg_ripper', 'raider_thug'], vault: ['zombie', 'zombie_bloated', 'spider_weaver', 'mutant_irradiated'],
  };
  const FETCH_POOL = ['hide', 'scrap_metal', 'cloth', 'wood', 'stone', 'plastic', 'electronics'];
  const CRAFT_POOL = [['ammo_arrow', 10], ['bedroll', 1], ['bow_crude', 1], ['axe_wood', 1], ['club_plain', 1]];
  const TAME_POOL = ['animal'];
  const TEMPLATES = ['kill', 'fetch', 'deliver', 'escort', 'defend', 'explore', 'tame', 'craft'];
  const r100 = (v) => Math.max(1, Math.round(v * settings.questRewardFactor));
  // env: { items(id) → предмет|null, enemies(id) → враг|null, towns: [{ id, name, x, y, kind }], entrances: [{ type, depth }], recipes: [id] }
  function board(seed, town, epoch, env) {
    const rnd = mulberry32(hashString(`${seed}:qb:${town.id}:${epoch}`));
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const others = (env.towns || []).filter((t) => t.id !== town.id).map((t) => ({ t, d: Math.hypot(t.x - town.x, t.y - town.y) })).filter((o) => o.d <= settings.questDeliverMaxDist).sort((a, b) => a.d - b.d);
    const types = TEMPLATES.filter((k) => (k !== 'deliver' && k !== 'escort') || others.length).filter((k) => k !== 'explore' || (env.entrances || []).length);
    const out = [];
    for (let k = 0; k < settings.questBoardSize && types.length; k++) {
      const type = types.splice(Math.floor(rnd() * types.length), 1)[0];
      const id = `p${town.id}-${epoch}-${k}`;
      let q = null;
      if (type === 'kill') {
        const enemy = pick(KILL_POOL[town.kind] || KILL_POOL.village), n = 3 + Math.floor(rnd() * 4), e = env.enemies(enemy);
        const f = Factions.ofEnemy(enemy);
        q = { name: `Охота: ${e ? e.name : enemy}`, text: `У {town} неспокойно: ${e ? e.name.toLowerCase() : enemy} нападают на людей. Убей ${n}.`, goals: [{ type: 'kill', enemy, n }], reward: { caps: r100(20 + 15 * n), xp: r100(40 * n), rep: 3, ...(f ? { fac: { alliance: 2 } } : {}) } };
      } else if (type === 'fetch') {
        const item = pick(FETCH_POOL), it = env.items(item), n = Math.max(2, Math.min(10, Math.round(40 / ((it && it.value) || 4))));
        q = { name: `Нужно: ${it ? it.name : item}`, text: `{town} не хватает материалов. Принеси ${n} × ${it ? it.name : item} старосте.`, goals: [{ type: 'fetch', item, n }], reward: { caps: r100(20 + Math.ceil(((it && it.value) || 4) * n * 1.5)), xp: r100(60), rep: 2 } };
      } else if (type === 'deliver') {
        const o = others[Math.floor(rnd() * Math.min(3, others.length))];
        q = { name: `Посылка в «${o.t.name}»`, text: `Отнеси посылку старосте «${o.t.name}» (≈${Math.round(o.d)} клеток).`, goals: [{ type: 'deliver', item: 'quest_parcel', to: o.t.id }], reward: { caps: r100(30 + o.d * 0.6), xp: r100(80), rep: 3 } };
      } else if (type === 'escort') {
        const o = others[0];
        q = { name: `Проводить в «${o.t.name}»`, text: `Житель {town} просит проводить его в «${o.t.name}» (≈${Math.round(o.d)} клеток). Он пойдёт за тобой — береги его.`, goals: [{ type: 'escort', to: o.t.id }], reward: { caps: r100(40 + o.d * 0.8), xp: r100(120), rep: 4 } };
      } else if (type === 'defend') {
        q = { name: 'Отбить набег', text: 'Разведчики видели налётчиков у {town}. Возьмёшься — набег начнётся сразу. Помоги страже отбиться.', goals: [{ type: 'defend', town: town.id }], reward: { caps: r100(60), xp: r100(150), rep: 5, fac: { alliance: 3 } } };
      } else if (type === 'explore') {
        const e = pick(env.entrances), depth = Math.max(1, Math.min(e.depth || 1, 1 + Math.floor(rnd() * 2)));
        q = { name: `Разведка: ${e.name || e.type}`, text: `Спустись на уровень ${depth} (${e.name || e.type}) и вернись живым — {town} нужно знать, что там.`, goals: [{ type: 'explore', level: e.type, depth }], reward: { caps: r100(50 + 30 * depth), xp: r100(120 * depth), rep: 2 } };
      } else if (type === 'tame') {
        q = { name: 'Приручить зверя', text: 'Пастухам {town} нужен помощник. Приручи любого зверя (лассо и T).', goals: [{ type: 'tame', family: pick(TAME_POOL), n: 1 }], reward: { caps: r100(60), xp: r100(100), rep: 2 } };
      } else if (type === 'craft') {
        const [item, n] = pick(CRAFT_POOL), it = env.items(item), recipe = env.recipes && env.recipes.length ? pick(env.recipes) : null;
        q = { name: `Изготовить: ${it ? it.name : item}`, text: `Мастерам {town} нужно ${n > 1 ? `${n} × ` : ''}${it ? it.name : item}. Изготовь сам (крафт, K).`, goals: [{ type: 'craft', item, n }], reward: { caps: r100(40), xp: r100(80), rep: 2, ...(recipe ? { recipe } : {}) } };
      }
      out.push({ id, kind: type, giver: town.id, ...q, text: q.text.replace('{town}', town.name) });
    }
    return out;
  }
  const epochOf = (now) => Math.floor(now / (settings.questBoardRefreshMin * 60000));

  // ---------- Прогресс целей ----------
  // Прогресс — массив по целям: число (сколько сделано) или массив для any. Цель выполнена — goalDone.
  const needOf = (g) => (g.type === 'kill' || g.type === 'fetch' || g.type === 'tame' || g.type === 'craft' ? g.n || 1 : 1);
  function freshProgress(q) { return q.goals.map((g) => (g.type === 'any' ? g.of.map(() => 0) : 0)); }
  function goalDone(g, p, ch) {
    if (g.type === 'rep') return Boolean(ch) && Factions.repOf(ch, g.faction) >= g.min;
    if (g.type === 'any') return g.of.some((x, i) => goalDone(x, (p || [])[i], ch));
    return (Number(p) || 0) >= needOf(g);
  }
  // Задание выполнено? (ch — герой для целей «репутация»: подходит любой из группы — проверяет сервер)
  const complete = (q, prog, ch) => q.goals.every((g, i) => g.optional || goalDone(g, prog[i], ch));
  // Подходит ли событие к цели. ev: { type: 'kill', def } | { type: 'craft', item, n } | { type: 'tame', def } | { type: 'explore', level, depth }
  function matches(g, ev) {
    if (g.type !== ev.type) return false;
    if (g.type === 'kill' || g.type === 'tame') {
      const d = ev.def || {};
      if (g.enemy && g.enemy !== d.id) return false;
      if (g.faction && Factions.ofEnemy(d) !== g.faction) return false;
      if (g.family && g.family !== d.family) return false;
      return true;
    }
    if (g.type === 'craft') return g.item === ev.item;
    if (g.type === 'explore') return (!g.level || g.level === ev.level) && (Number(ev.depth) || 0) >= g.depth;
    if (g.type === 'defend') return g.town === ev.town && ev.ok;
    if (g.type === 'escort' || g.type === 'deliver') return g.to === ev.to;
    if (g.type === 'finale') return true;
    return false;
  }
  // Применить событие к прогрессу; вернуть true, если что-то изменилось
  function advance(q, prog, ev) {
    let changed = false;
    const step = (g, cur) => {
      if (!matches(g, ev)) return cur;
      const nv = Math.min(needOf(g), (Number(cur) || 0) + (Number(ev.n) || 1));
      if (nv !== cur) changed = true;
      return nv;
    };
    q.goals.forEach((g, i) => {
      if (g.type === 'any') prog[i] = g.of.map((x, k) => step(x, (prog[i] || [])[k] || 0));
      else prog[i] = step(g, prog[i] || 0);
    });
    return changed;
  }
  // Текст цели для журнала
  function goalText(g, p, env = {}) {
    const name = (id) => (env.enemies && env.enemies(id) ? env.enemies(id).name : id);
    const item = (id) => (env.items && env.items(id) ? env.items(id).name : id);
    const town = (id) => (env.townName ? env.townName(id) : `#${id}`);
    const cnt = (n) => ` (${Math.min(Number(p) || 0, n)}/${n})`;
    switch (g.type) {
      case 'kill': return `Убить: ${g.enemy ? name(g.enemy) : g.faction ? `бойцов «${Factions.FACTIONS[g.faction].name}»` : g.family}${cnt(g.n || 1)}`;
      case 'fetch': return `Принести старосте: ${item(g.item)}${cnt(g.n)}`;
      case 'deliver': return `Доставить «${item(g.item)}» старосте «${town(g.to)}»`;
      case 'escort': return `Довести жителя до «${town(g.to)}»`;
      case 'defend': return `Отбить набег на «${town(g.town)}»`;
      case 'explore': return `Спуститься: ${g.level ? (env.levelName ? env.levelName(g.level) : g.level) : 'любой вход'}, уровень ${g.depth}+`;
      case 'tame': return `Приручить: ${g.enemy ? name(g.enemy) : g.family === 'animal' ? 'зверя' : g.family}${cnt(g.n || 1)}`;
      case 'craft': return `Изготовить: ${item(g.item)}${cnt(g.n)}`;
      case 'rep': return `Репутация «${Factions.FACTIONS[g.faction].name}» не ниже ${g.min}`;
      case 'any': return 'Любое из: ' + g.of.map((x, i) => goalText(x, (p || [])[i], env)).join(' — или — ');
      case 'finale': return 'Встретиться с Железным Патриархом и решить его судьбу';
      default: return g.type;
    }
  }

  // ---------- Проверка данных ----------
  function validateQuest(q, env = {}) {
    const errs = [], id = q && q.id;
    if (!q || !q.id || !q.name || !q.text) return [`${id}: нет id, имени или текста`];
    if (!KINDS[q.kind]) errs.push(`${id}: неизвестный вид ${q.kind}`);
    if (!Array.isArray(q.goals) || !q.goals.length) errs.push(`${id}: нет целей`);
    const check = (g) => {
      if (!GOAL_TYPES.includes(g.type)) { errs.push(`${id}: неизвестная цель ${g.type}`); return; }
      if (g.type === 'any') { if (!Array.isArray(g.of) || g.of.length < 2) errs.push(`${id}: «на выбор» — нужно не меньше двух целей`); (Array.isArray(g.of) ? g.of : []).forEach(check); }
      if ((g.type === 'kill' || g.type === 'tame') && !g.enemy && !g.faction && !g.family) errs.push(`${id}: у цели ${g.type} нет врага, фракции или семейства`);
      if (g.enemy && env.enemies && !env.enemies(g.enemy)) errs.push(`${id}: нет врага ${g.enemy}`);
      if (g.faction && !Factions.FACTIONS[g.faction]) errs.push(`${id}: нет фракции ${g.faction}`);
      if ((g.type === 'fetch' || g.type === 'craft' || g.type === 'deliver') && env.items && !env.items(g.item)) errs.push(`${id}: нет предмета ${g.item}`);
      if (['kill', 'fetch', 'tame', 'craft'].includes(g.type) && !(g.n >= 1)) errs.push(`${id}: число в цели ${g.type} должно быть ≥ 1`);
      if (g.type === 'explore' && !(g.depth >= 1)) errs.push(`${id}: глубина разведки ≥ 1`);
      if (g.type === 'rep' && !(g.min > -100 && g.min <= 100)) errs.push(`${id}: неверный порог репутации`);
    };
    for (const g of q.goals || []) check(g);
    const r = q.reward || {};
    for (const [it, n] of r.items || []) { if (env.items && !env.items(it)) errs.push(`${id}: нет предмета награды ${it}`); if (!(n >= 1)) errs.push(`${id}: число предмета награды`); }
    for (const f of Object.keys(r.fac || {})) if (!Factions.FACTIONS[f]) errs.push(`${id}: нет фракции награды ${f}`);
    if (r.spell && env.spells && !env.spells(r.spell)) errs.push(`${id}: нет заклинания ${r.spell}`);
    if (r.recipe && env.recipe && !env.recipe(r.recipe)) errs.push(`${id}: нет рецепта ${r.recipe}`);
    if (q.next && !BY_ID.has(q.next)) errs.push(`${id}: следующее задание ${q.next} не найдено`);
    return errs;
  }
  function validate(env = {}) {
    const errs = [];
    for (const q of MAIN) errs.push(...validateQuest(q, env));
    for (const q of SIDE_STORIES) errs.push(...validateQuest(q, env));
    MAIN.forEach((q, i) => { if (i < MAIN.length - 1 && q.next !== MAIN[i + 1].id) errs.push(`${q.id}: цепочка разорвана`); });
    if (!MAIN[MAIN.length - 1].goals.some((g) => g.type === 'finale')) errs.push('последнее сюжетное задание без финала');
    for (const [id, d] of Object.entries(DIALOGUES)) errs.push(...validateDlg(d, id));
    for (const k of Object.keys(ENDINGS)) if (!/^[a-z0-9_-]{1,32}$/.test(k) || !ENDINGS[k].name || !ENDINGS[k].text) errs.push(`концовка ${k}: неверная`);
    return errs;
  }

  return {
    settings, configure, KINDS, GOAL_TYPES, MAIN, MAIN_IDS, SIDE_STORIES, sideBoard, ENDINGS, DIALOGUES, DLG_ACTIONS, DLG_CONDS, TEMPLATES,
    get: (id) => BY_ID.get(id) || null, parleyFlags, endingFor, board, epochOf, freshProgress, goalDone, complete, matches, advance, needOf, goalText,
    validateQuest, validate, validateDlg,
  };
});
