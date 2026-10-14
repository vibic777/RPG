'use strict';
// «Новая игра+» (server/ngplus.js): флаг концовки (/ending), мир НИ+ только для героя с концовкой,
// база переходит, враги в мире НИ+ слабее (game.ngPlusEnemyHpFactor / DamageFactor).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, newPlayer, joinWorld } = require('./helpers');

const params = (o = {}) => ({ name: 'Мир', seed: 'ng-1', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false, ...o });
const say = (c, text) => c.send({ t: 'chat', text });

test('НИ+: без концовки нельзя; /ending открывает; мир НИ+ с базой; враги слабее', async (t) => {
  const s = await startServer(['--set', 'game.chatRateCount=50', '--set', 'game.ngPlusEnemyHpFactor=0.5']);
  t.after(() => s.stop());
  const a = await newPlayer(s.base, 'admin', 'Алиса');
  const bob = await newPlayer(s.base, 'bob', 'Боб');
  const ng = (tok, id) => api(s.base, 'POST', '/api/worlds', params({ name: 'Второй круг', newGamePlus: true, characterId: id }), tok);
  let r = await ng(a.token, a.characterId);
  assert.equal(r.status, 400, 'без концовки');
  assert.match(r.data.error, /концовк/);
  assert.equal((await ng(bob.token, a.characterId)).status, 404, 'чужой герой');

  const w = (await api(s.base, 'POST', '/api/worlds', params(), a.token)).data.world;
  assert.equal(w.ngPlus, undefined);
  const A = await joinWorld(s.base, a, w.id);
  say(A, '/spawn zombie');
  const normal = (await A.next('enemy-add')).enemy.maxHp;
  say(A, '/ending Алиса good_end');
  await A.next((m) => m.t === 'chat' && /good_end/.test(m.m.text));
  const ch = (await api(s.base, 'GET', `/api/characters/${a.characterId}`, undefined, a.token)).data.character;
  assert.deepEqual(ch.endings.map((e) => e.id), ['good_end']);
  A.close();

  const base = (await api(s.base, 'POST', '/api/bases', { name: 'Форт' }, a.token)).data.base;
  r = await ng(a.token, a.characterId);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.world.ngPlus.round, r.data.world.ngPlus.characterId, r.data.world.ngPlus.baseId], [1, a.characterId, base.id]);
  const A2 = await joinWorld(s.base, a, r.data.world.id);
  say(A2, '/spawn zombie');
  const easy = (await A2.next('enemy-add')).enemy;
  assert.equal(easy.maxHp, Math.round(normal * 0.5), 'здоровье врагов × ngPlusEnemyHpFactor');
  A2.close();
});
