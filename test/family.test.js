'use strict';
// Шаг 17: правила семьи — симпатия, стадии, условия свадьбы, кровати, сироты, рост, распорядок, проверка записи.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../shared/family');
const Items = require('../shared/items');

test('семья: симпатия и стадии отношений', () => {
  assert.deepEqual(F.validate(), []);
  const rel = { affinity: 0 };
  assert.equal(F.addAffinity(rel, 10), 10);
  assert.equal(rel.stage, 'stranger');
  F.addAffinity(rel, 10, 'friendly'); // ×1.25
  assert.equal(rel.affinity, 22.5);
  assert.equal(rel.stage, 'acquaint');
  assert.equal(F.addAffinity({ affinity: 50 }, 10, 'hostile'), 0); // враг поселения — симпатия не растёт
  assert.equal(F.addAffinity({ affinity: 50 }, -10, 'hostile'), -10); // а падает всегда
  F.addAffinity(rel, 200);
  assert.equal(rel.affinity, 100);
  assert.equal(rel.stage, 'close');
  rel.stage = 'courting';
  F.addAffinity(rel, -50);
  assert.equal(rel.stage, 'courting'); // стадии-действия сами не сбрасываются
  assert.equal(F.autoStage(F.settings.familyCourtAt - 1), 'friend');
  // подарки: по ценности, с пределами
  assert.equal(F.giftAffinity({ value: 1 }), 1);
  assert.equal(F.giftAffinity({ value: 55 }), 6);
  assert.equal(F.giftAffinity({ value: 99999 }), F.settings.familyGiftMax);
  assert.ok(F.giftable(Items.get('gold_nugget')));
  assert.ok(!F.giftable(Items.get('caps')));
  assert.ok(!F.giftable(Items.get('quest_parcel')));
  assert.ok(F.ready(0, 10, Date.now()) && !F.ready(Date.now() - 60000, 10, Date.now()) && F.ready(Date.now() - 11 * 60000, 10, Date.now()));
});

test('семья: ухаживание, помолвка, пол, свадьба', () => {
  const ch = { appearance: { gender: 'male' } };
  const rel = { affinity: F.settings.familyCourtAt - 1, stage: 'friend' };
  assert.match(F.canAdvance('fam_court', { ch, rel, gender: 'female' }), /симпатия/);
  rel.affinity = F.settings.familyCourtAt;
  assert.match(F.canAdvance('fam_court', { ch, rel, gender: 'male' }), /противоположного пола/);
  F.settings.familyOppositeSex = false;
  assert.equal(F.canAdvance('fam_court', { ch, rel, gender: 'male' }), null);
  F.settings.familyOppositeSex = true;
  assert.equal(F.canAdvance('fam_court', { ch, rel, gender: 'female' }), null);
  assert.equal(F.genderOfName('Марфа'), 'female');
  assert.equal(F.genderOfName('Лука'), 'male');
  assert.match(F.canAdvance('fam_propose', { ch, rel, gender: 'female' }), /ухаживание/);
  rel.stage = 'courting';
  F.of(ch).rel['w:n1'] = rel;
  assert.match(F.canAdvance('fam_court', { ch, rel: { affinity: 90, stage: 'close' }, gender: 'female' }), /за другим/); // одно ухаживание
  assert.match(F.canAdvance('fam_propose', { ch, rel, gender: 'female' }), /симпатия 80/);
  rel.affinity = 85;
  assert.equal(F.canAdvance('fam_propose', { ch, rel, gender: 'female' }), null);
  rel.stage = 'engaged';
  const ok = { ch, rel, tier: 'neutral', money: F.settings.familyCeremonyCost, freeBeds: 1 };
  assert.equal(F.ceremonyCheck(ok), null);
  assert.match(F.ceremonyCheck({ ...ok, freeBeds: 0 }), /кровать/);
  assert.match(F.ceremonyCheck({ ...ok, money: 10 }), /крышек/);
  assert.match(F.ceremonyCheck({ ...ok, tier: 'unfriendly' }), /безразличия/);
  assert.match(F.ceremonyCheck({ ...ok, rel: { stage: 'courting' } }), /помолвки/);
  F.of(ch).bond = { characterId: 'x', name: 'Боб' }; // семейный союз с игроком — тоже супруг
  assert.match(F.ceremonyCheck(ok), /уже есть/);
  assert.match(F.canAdvance('fam_court', { ch: { appearance: { gender: 'male' }, family: { members: [F.makeMember({ kind: 'partner', name: 'Зоя' })], rel: {} } }, rel: { affinity: 90, stage: 'close' }, gender: 'female' }), /уже есть/);
});

test('семья: дети, рост, кровати, распорядок, помощники', () => {
  const t0 = Date.UTC(2026, 0, 1);
  const kid = F.makeMember({ kind: 'child', name: 'Петя', age: 10, study: 'craft' }, t0);
  assert.equal(F.ageOf(kid, t0), 10);
  assert.ok(!F.isAdult(kid, t0));
  const year = F.settings.familyChildYearMin * 60000;
  assert.equal(F.ageOf(kid, t0 + 3.5 * year), 13);
  assert.ok(!F.grow(kid, t0 + 3 * year));
  const adultAt = t0 + (F.settings.familyAdultAge - 10) * year;
  assert.ok(F.grow(kid, adultAt));
  assert.equal(kid.role, 'craft');
  assert.equal(kid.level, 1 + Math.floor((F.settings.familyAdultAge - 10) / 2));
  assert.ok(!F.grow(kid, adultAt + year)); // один раз
  // кровати: дома живут первые по времени; ушедшие в спутники кровать не занимают
  const f = { members: [F.makeMember({ kind: 'partner', name: 'Зоя', role: 'heal' }, t0), kid, F.makeMember({ kind: 'child', name: 'Маша', age: 5 }, t0 + 1)], rel: {}, bond: null };
  assert.deepEqual([...F.housed(f, 2)], [f.members[0].id, kid.id]);
  assert.equal(F.freeBeds(f, 2), 0);
  kid.out = true;
  assert.equal(F.freeBeds(f, 2), 0);
  assert.equal(F.freeBeds(f, 3), 1);
  assert.deepEqual([...F.housed(f, 2)].sort(), [f.members[0].id, f.members[2].id].sort());
  // распорядок: сон → работа → отдых по долям дня
  const day = F.settings.familyDayMin * 60000, d0 = Math.ceil(t0 / day) * day;
  assert.equal(F.phase(d0 + 0.1 * day), 'sleep');
  assert.equal(F.phase(d0 + 0.5 * day), 'work');
  assert.equal(F.phase(d0 + 0.9 * day), 'rest');
  const hs = F.housed(f, 2);
  assert.ok(F.helping(f.members[0], hs, d0 + 0.5 * day, 0));
  assert.ok(!F.helping(f.members[0], hs, d0 + 0.1 * day, 0)); // спит
  assert.ok(!F.helping(f.members[2], hs, d0 + 0.5 * day, 0)); // ребёнок не помогает
  assert.ok(!F.helping(f.members[0], new Set(), d0 + 0.5 * day, 0)); // без кровати — не помогает
  // сироты — по сиду, детерминированно
  const o1 = F.orphansFor('seed1', 2), o2 = F.orphansFor('seed1', 2);
  assert.deepEqual(o1, o2);
  assert.equal(o1.length, F.settings.familyOrphansPerTown);
  assert.ok(o1.every((o) => o.age >= 3 && o.age <= 11 && o.id.startsWith('o2_')));
  assert.notDeepEqual(F.orphansFor('seed2', 2), o1);
  // проверка записи: мусор отбрасывается, супруг не появляется из «стадии» в rel
  const s = F.sanitize({ members: [{ kind: 'dragon' }, { kind: 'child', name: 'Ваня', age0: 4, since: t0, id: 'k1' }], rel: { 'w:n': { affinity: 500, stage: 'partner', name: 'Ольга' } }, bond: { characterId: 'c1', name: 'Боб' } });
  assert.equal(s.members.length, 1);
  assert.equal(s.members[0].id, 'k1');
  assert.equal(s.rel['w:n'].affinity, 100);
  assert.equal(s.rel['w:n'].stage, 'close');
  assert.equal(s.bond.name, 'Боб');
  const legacy = { family: [] }; // заготовка шага 1 в старых героях
  F.of(legacy).members.push(kid);
  assert.equal(JSON.parse(JSON.stringify(legacy)).family.members.length, 1);
});
