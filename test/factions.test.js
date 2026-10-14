'use strict';
// Фракции (шаг 16): данные, отношения, математика репутации, враждебность, вербовка, слой над поселениями
const test = require('node:test');
const assert = require('node:assert');
const F = require('../shared/factions');
const Enemies = require('../shared/enemies');
const S = require('../shared/settlements');

test('фракции: данные верны, у каждой банды главарь, члены — враги бестиария, отношения симметричны', () => {
  assert.deepEqual(F.validate(Enemies), []);
  assert.deepEqual(F.GANGS.sort(), ['cyborgs', 'mutants', 'ninja', 'raiders']);
  for (const g of F.GANGS) {
    assert.equal(F.relation(g, 'patriarch'), 'ally');
    assert.equal(F.relation(g, 'alliance'), 'enemy');
    assert.equal(F.ofEnemy(F.FACTIONS[g].boss), g);
  }
  assert.equal(F.relation('raiders', 'mutants'), 'enemy');
  assert.equal(F.relation('mutants', 'raiders'), 'enemy');
  assert.equal(F.relation('alliance', 'mages'), 'ally');
  assert.equal(F.relation('hive', 'alliance'), 'enemy');
  assert.equal(F.relation('raiders', 'raiders'), 'self');
  assert.equal(F.ofEnemy('boss_super'), 'patriarch');
  assert.equal(F.ofEnemy('wolf'), null); // звери вне фракций
  assert.equal(F.ofRole('mage'), 'mages');
  assert.equal(F.ofRole('guard'), 'alliance');
});

test('фракции: репутация — стартовая, изменение с разносом союзникам и врагам, пределы, Улей не меняется', () => {
  const ch = {};
  assert.equal(F.repOf(ch, 'raiders'), F.FACTIONS.raiders.start);
  assert.equal(F.repOf(ch, 'alliance'), 0);
  const d = F.change(ch, 'mutants', -10); // убили мутантов
  assert.equal(d.mutants, -10);
  assert.equal(d.raiders, 10 * F.settings.factionEnemyShare); // враги мутантов рады
  assert.equal(d.patriarch, -10 * F.settings.factionAllyShare); // союзник мутантов недоволен
  assert.equal(d.alliance, 10 * F.settings.factionEnemyShare);
  assert.equal(F.repOf(ch, 'raiders'), -60 + 5);
  assert.equal(F.change(ch, 'hive', 50).hive, undefined);
  assert.equal(F.repOf(ch, 'hive'), -100);
  F.change(ch, 'alliance', 500);
  assert.equal(F.repOf(ch, 'alliance'), 100);
  assert.equal(F.repOf(ch, 'mutants'), -100); // враги Союза
  const pat = F.repOf(ch, 'patriarch');
  F.change(ch, 'raiders', 3, { spread: false });
  assert.equal(F.repOf(ch, 'patriarch'), pat); // без разноса
  assert.ok(F.set(ch, 'ninja', 40));
  assert.equal(F.repOf(ch, 'ninja'), 40);
  assert.equal(F.set(ch, 'hive', 40), false);
  assert.equal(F.tierOf(F.repOf(ch, 'ninja')), 'friendly');
});

test('фракции: враждебность и вербовка — банда нападает, пока репутация низкая; союзную банду можно уговорить', () => {
  const ch = {};
  const thug = Enemies.get('raider_thug'), wolf = Enemies.get('wolf'), spit = Enemies.get('alien_spitter');
  assert.equal(F.enemyHostile(ch, thug), true);
  assert.equal(F.enemyHostile(ch, wolf), true); // вне фракций — как раньше
  F.set(ch, 'raiders', F.settings.factionAttackAt + 1);
  assert.equal(F.enemyHostile(ch, thug), false);
  assert.equal(F.recruitable(ch, thug), false); // нейтралитет — ещё не союз
  F.set(ch, 'raiders', 30);
  assert.equal(F.recruitable(ch, thug), true);
  assert.equal(F.recruitBonus(ch, thug), 1);
  assert.equal(F.enemyHostile(ch, spit), true);
  assert.equal(F.recruitable(ch, spit), false);
  const was = F.settings.factionsEnabled;
  F.settings.factionsEnabled = false;
  F.set(ch, 'raiders', 100);
  assert.equal(F.enemyHostile(ch, thug), true); // фракции выключены — все враги нападают
  F.settings.factionsEnabled = was;
  // убийство: −у фракции, главарь — больше
  assert.deepEqual(F.killDelta(thug), { f: 'raiders', delta: -F.settings.factionKillRep });
  assert.equal(F.killDelta(Enemies.get('boss_raider')).delta, -F.settings.factionBossKillRep);
  assert.equal(F.killDelta(wolf).f, null);
});

test('фракции: репутация Союза добавляется к поселению (у мага — Ордена), уровни как у поселений', () => {
  const ch = {};
  F.set(ch, 'alliance', 40); F.set(ch, 'mages', -40);
  assert.equal(F.townRep(ch, 10, 'trader'), 10 + 40 * F.settings.factionTownWeight);
  assert.equal(F.townRep(ch, 10, 'mage'), 10 - 40 * F.settings.factionTownWeight);
  assert.equal(F.townRep(ch, 95, 'guard'), 100);
  assert.equal(F.tierOf(-60), S.tierOf(-60));
  F.set(ch, 'raiders', 30); F.set(ch, 'mutants', 0);
  assert.equal(F.gangsAtLeast(ch, 25), 1);
  assert.equal(F.gangsAtLeast(ch, -15), 2);
});
