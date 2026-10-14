'use strict';
// Сроки хранения: выпавшие предметы (game.groundItemTtlSec) и трупы (game.corpseLifetimeSec) исчезают по настройке
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');

const params = { name: 'Сроки', seed: 'lifetimes', size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false };
const SET = ['--set', 'game.survivalFoodPerMin=0', '--set', 'game.survivalWaterPerMin=0', '--set', 'game.depotsPer256=0', '--set', 'game.settlementsEnabled=false',
  '--set', 'game.groundItemTtlSec=2', '--set', 'game.groundPurgeSec=1', '--set', 'game.corpseLifetimeSec=2'];
async function cheat(C, msg) {
  C.send({ t: 'cheat', ...msg });
  const m = await C.next((x) => x.t === 'cheat-ok' || x.t === 'cheat-err', 4000);
  assert.equal(m.t, 'cheat-ok', m.message);
  return m;
}

test('WS сроки: предмет на земле и труп исчезают через заданные секунды', async (t) => {
  const s = await startServer(SET);
  t.after(() => s.stop());
  const admin = await newPlayer(s.base, 'admin', 'Алиса');
  const w = (await api(s.base, 'POST', '/api/worlds', params, admin.token)).data.world;
  const A = await joinWorld(s.base, admin, w.id);
  assert.equal(A.welcome.corpseLifetimeSec, 2, 'срок трупов из --set дошёл до клиента');
  // предмет на земле
  await cheat(A, { a: 'spawn', kind: 'item', id: 'caps', count: 3 });
  const item = (await A.next('ground-add')).item;
  const t0 = Date.now();
  assert.equal((await A.next((m) => m.t === 'ground-remove' && m.gid === item.gid, 6000)).gid, item.gid);
  assert.ok(Date.now() - t0 >= 1000, 'предмет не исчез мгновенно');
  // труп убитого врага
  await cheat(A, { a: 'spawn', kind: 'enemy', id: 'zombie', count: 1 });
  await A.next('enemy-add');
  await sleep(200);
  await cheat(A, { a: 'kill' });
  const body = (await A.next('corpse-add', 4000)).corpse;
  const t1 = Date.now();
  assert.equal((await A.next((m) => m.t === 'corpse-remove' && m.id === body.id, 6000)).id, body.id);
  assert.ok(Date.now() - t1 >= 1000, 'труп не исчез мгновенно');
  await A.close();
});
