'use strict';
// Задания и концовки (шаг 16): данные, доска старосты, прогресс целей каждого типа, условия концовок
const test = require('node:test');
const assert = require('node:assert');
const Q = require('../shared/quests');
const F = require('../shared/factions');
const S = require('../shared/settlements');
const Items = require('../shared/items');
const Enemies = require('../shared/enemies');
const Magic = require('../shared/magic');
const Crafting = require('../shared/crafting');

const env = { items: Items.get, enemies: Enemies.get, spells: Magic.get, recipe: Crafting.get };

test('задания: данные сюжета и разговоры верны, цепочка непрерывна, концовки описаны', () => {
  assert.deepEqual(Q.validate(env), []);
  assert.equal(Q.MAIN.length, 11);
  assert.equal(Q.MAIN[Q.MAIN.length - 1].id, 'm6_patriarch');
  for (const g of F.GANGS) assert.ok(Q.MAIN.some((q) => JSON.stringify(q.goals).includes(F.FACTIONS[g].boss)), `главарь ${g} в цепочке`);
  assert.deepEqual(Object.keys(Q.ENDINGS).sort(), ['ally', 'destroy', 'family', 'rule', 'unite']);
  // ошибки ловятся
  assert.ok(Q.validateQuest({ id: 'x', name: 'x', text: 'x', kind: 'kill', goals: [{ type: 'kill', n: 0 }] }, env).length >= 2);
  assert.ok(Q.validateQuest({ id: 'x', name: 'x', text: 'x', kind: 'any', goals: [{ type: 'any', of: [{ type: 'rep', faction: 'nope', min: 5 }] }] }, env).length >= 2);
  assert.ok(S.validateDialogue(Q.DIALOGUES.patriarch, 'p').length > 0); // без расширения действия заданий неизвестны
  assert.deepEqual(Q.validateDlg(Q.DIALOGUES.patriarch, 'p'), []);
});

test('задания: доска старосты детерминирована, разные виды, данные верны, обновляется по эпохе', () => {
  const towns = [{ id: 0, name: 'А', x: 10, y: 10, kind: 'village' }, { id: 1, name: 'Б', x: 50, y: 40, kind: 'town' }, { id: 2, name: 'В', x: 90, y: 90, kind: 'base' }];
  const e2 = { ...env, towns, entrances: [{ type: 'bunker', name: 'Бункер', depth: 3 }], recipes: ['pickaxe'] };
  const b1 = Q.board('seed', towns[0], 5, e2), b2 = Q.board('seed', towns[0], 5, e2), b3 = Q.board('seed', towns[0], 6, e2);
  assert.deepEqual(b1, b2);
  assert.equal(b1.length, Q.settings.questBoardSize);
  assert.equal(new Set(b1.map((q) => q.kind)).size, b1.length);
  assert.notDeepEqual(b1.map((q) => q.id), b3.map((q) => q.id));
  const kinds = new Set();
  for (let ep = 0; ep < 40; ep++) for (const t of towns) for (const q of Q.board('s' + ep, t, ep, e2)) {
    kinds.add(q.kind);
    assert.deepEqual(Q.validateQuest(q, e2), [], q.id);
    assert.equal(q.giver, t.id);
    assert.ok(q.reward.caps > 0 && q.reward.xp > 0);
    assert.ok(!q.text.includes('{town}'));
    if (q.kind === 'deliver' || q.kind === 'escort') assert.notEqual(q.goals[0].to, t.id);
  }
  assert.deepEqual([...kinds].sort(), [...Q.TEMPLATES].sort()); // все восемь видов встречаются
  // без соседей нет доставки и сопровождения, без входов — разведки
  for (let ep = 0; ep < 20; ep++) for (const q of Q.board('x', towns[0], ep, { ...env, towns: [towns[0]], entrances: [] })) assert.ok(!['deliver', 'escort', 'explore'].includes(q.kind));
});

test('задания: прогресс целей каждого типа и выбор «любая из»', () => {
  const thug = Enemies.get('raider_thug'), wolf = Enemies.get('wolf');
  const mk = (goals) => ({ id: 't', goals });
  const cases = [
    [{ type: 'kill', enemy: 'wolf', n: 2 }, { type: 'kill', def: wolf }, { type: 'kill', def: thug }, 2],
    [{ type: 'kill', faction: 'raiders', n: 1 }, { type: 'kill', def: thug }, { type: 'kill', def: wolf }, 1],
    [{ type: 'tame', family: 'animal', n: 1 }, { type: 'tame', def: wolf }, { type: 'tame', def: thug }, 1],
    [{ type: 'craft', item: 'ammo_arrow', n: 10 }, { type: 'craft', item: 'ammo_arrow', n: 10 }, { type: 'craft', item: 'planks', n: 10 }, 1],
    [{ type: 'explore', level: 'bunker', depth: 2 }, { type: 'explore', level: 'bunker', depth: 3 }, { type: 'explore', level: 'bunker', depth: 1 }, 1],
    [{ type: 'defend', town: 3 }, { type: 'defend', town: 3, ok: true }, { type: 'defend', town: 3, ok: false }, 1],
    [{ type: 'escort', to: 2 }, { type: 'escort', to: 2 }, { type: 'escort', to: 1 }, 1],
    [{ type: 'deliver', item: 'quest_parcel', to: 2 }, { type: 'deliver', to: 2 }, { type: 'deliver', to: 5 }, 1],
    [{ type: 'finale' }, { type: 'finale' }, { type: 'kill', def: wolf }, 1],
  ];
  for (const [g, good, bad, times] of cases) {
    const q = mk([g]), p = Q.freshProgress(q);
    assert.equal(Q.advance(q, p, bad), false, `${g.type}: чужое событие`);
    for (let i = 0; i < times; i++) assert.equal(Q.advance(q, p, good), true, `${g.type}: своё событие`);
    assert.ok(Q.complete(q, p, {}), `${g.type}: выполнено`);
    assert.equal(Q.advance(q, p, good), false, `${g.type}: сверх нормы не растёт`);
  }
  // fetch не растёт от событий — только сдача
  const fq = mk([{ type: 'fetch', item: 'hide', n: 3 }]), fp = Q.freshProgress(fq);
  assert.ok(!Q.complete(fq, fp, {}));
  // any: убить главаря или подружиться
  const m2 = Q.get('m2_baron'), p2 = Q.freshProgress(m2), ch = {};
  assert.ok(!Q.complete(m2, p2, ch));
  F.set(ch, 'raiders', 30);
  assert.ok(Q.complete(m2, p2, ch)); // дружба с рейдерами
  const p3 = Q.freshProgress(m2);
  Q.advance(m2, p3, { type: 'kill', def: Enemies.get('boss_raider') });
  assert.ok(Q.complete(m2, p3, {})); // или убит Барон
  // финал: необязательная цель «убить Патриарха» не мешает
  const m6 = Q.get('m6_patriarch'), p6 = Q.freshProgress(m6);
  Q.advance(m6, p6, { type: 'finale' });
  assert.ok(Q.complete(m6, p6, {}));
  assert.match(Q.goalText(m2.goals[0], p2[0], env), /Барон Ржавый Зуб.*или.*Рейдеры/);
});

test('концовки: условия по репутации и способу', () => {
  const ch = {};
  assert.equal(Q.endingFor('kill', ch), 'destroy');
  assert.equal(Q.endingFor('ally', ch), null); // Патриарх враждебен — разговора нет
  F.set(ch, 'raiders', 30); F.set(ch, 'mutants', 30);
  assert.equal(Q.endingFor('kill', ch), 'rule'); // две банды-друга
  F.set(ch, 'patriarch', 30);
  assert.equal(Q.parleyFlags(ch).talk, true);
  assert.equal(Q.endingFor('ally', ch), 'ally');
  assert.equal(Q.endingFor('family', ch), null);
  assert.equal(Q.endingFor('unite', ch), null); // клан Тени и Шестерня ещё враги, Союз нейтрален
  F.set(ch, 'cyborgs', 0); F.set(ch, 'ninja', 0); F.set(ch, 'alliance', 30);
  assert.equal(Q.endingFor('unite', ch), 'unite');
  F.set(ch, 'patriarch', 70);
  assert.equal(Q.endingFor('family', ch), 'family');
  const flags = Q.parleyFlags(ch);
  const opts = S.optionsFor(Q.DIALOGUES.patriarch.nodes.hi, { flags });
  assert.equal(opts.length, 5);
  assert.equal(S.optionsFor(Q.DIALOGUES.patriarch.nodes.hi, { flags: Q.parleyFlags({}) }).length, 2); // только «сразиться» и «уйти»
});
