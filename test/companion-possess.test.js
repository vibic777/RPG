'use strict';
// Вселение в спутника (🎮, клавиша \) и возврат к герою (↩, \); плавание и ныряние драконов (ART.md «Плавание», GDD «Спутники»).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, api, newPlayer, joinWorld, sleep } = require('./helpers');
const WorldGen = require('../shared/worldgen');
globalThis.window = globalThis.window || {};
window.WorldGen = window.WorldGen || WorldGen;
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'client', 'js', 'game', f)).href);

test('плавание: драконы плывут и ныряют, дроны и прочие летуны — нет; вселённый спутник может войти в воду', async () => {
  const { swimModeAt } = await load('swim-art.js');
  const B = WorldGen.B, tiles = new Uint8Array(4).fill(B.WASTE); tiles[1] = B.WATER;
  const map = { width: 2, height: 2, tiles };
  const dragon = { x: 1.5, y: 0.5, def: { fly: true, look: { shape: 'dragon' } } };
  assert.equal(swimModeAt(map, dragon), 'swim', 'дракон на воде плывёт');
  assert.equal(swimModeAt({ ...map, underwater: true }, { ...dragon, x: 0.5 }), 'dive', 'дракон ныряет');
  assert.equal(swimModeAt(map, { ...dragon, def: { fly: true }, look: { shape: 'dragon' } }), 'swim', 'форма из look существа');
  assert.equal(swimModeAt(map, { ...dragon, alt: 3 }), null, 'дракон в полёте не плавает');
  assert.equal(swimModeAt(map, { ...dragon, mounted: true }), null, 'дракон под седлом героя — по высоте героя');
  assert.equal(swimModeAt(map, { x: 1.5, y: 0.5, def: { fly: true, look: { shape: 'drone' } } }), null, 'дрон — машина, не плавает');
  const art = read('client/js/game/creature-art.js');
  assert.match(art, /sw==='dive'\?/, 'у дракона своя поза ныряния');
  assert.match(read('server/companion-control.js'), /map\.swimmer=!s\.fly/, 'вселённый спутник плывёт как в ИИ');
  assert.match(read('client/js/game/companions-ui.js'), /e\.alt = h\.alt \|\| 0/, 'верховой дракон на высоте героя');
});

test('UI вселения: клавиша \\, значок «Вы управляете», кнопка ↩ с подсказками, справка', () => {
  const ui = read('client/js/game/companions-ui.js');
  assert.match(ui, /e\.code === 'Backslash'/);
  assert.match(ui, /controlKey\(e\.shiftKey\)/);
  assert.match(ui, /renderControlBadge\(\)/);
  assert.match(ui, /Некем управлять/);
  const html = read('client/index.html');
  assert.match(html, /id="comp-control-badge"[^>]*title="[^"]+"/);
  assert.match(html, /id="btn-comp-return"[^>]*title="Вернуть управление герою \(\\\)"/);
  assert.match(read('client/css/style.css'), /\.comp-control-badge/);
  const help = read('client/js/help.js');
  assert.match(help, /вселение/);
  assert.match(help, /К герою/);
  assert.match(help, /драконы в воде плывут/);
});

const params = (seed) => ({ name: 'Вселение', seed, size: 'small', enemyDensity: 'none', hordeFrequency: 'never', dragons: 0, scaleToLevel: false });
const SET = ['--set', 'game.survivalFoodPerMin=0', '--set', 'game.survivalWaterPerMin=0', '--set', 'game.depotsPer256=0'];

test('WS: вселение в спутника, управление им и возврат к герою; чужого/несуществующего — нельзя', async (t) => {
  const s = await startServer(SET);
  t.after(() => s.stop());
  const b = s.base;
  const admin = await newPlayer(b, 'admin', 'Алиса');
  const w = (await api(b, 'POST', '/api/worlds', params('possess-1'), admin.token)).data.world;
  const A = await joinWorld(b, admin, w.id);
  const cheat = async (msg) => { A.drain(); A.send({ t: 'cheat', ...msg }); const m = await A.next((x) => x.t === 'cheat-ok' || x.t === 'cheat-err', 4000); assert.equal(m.t, 'cheat-ok', m.message); return m; };
  await cheat({ a: 'god', god: { invulnerable: true } });
  const me = A.welcome.players.find((p) => p.id === A.welcome.you);
  const map = WorldGen.generate({ ...w });
  let spot = null;
  for (let r = 2; r < 6 && !spot; r++) for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r]]) {
    const x = Math.floor(me.x + dx), y = Math.floor(me.y + dy);
    if (!spot && WorldGen.isWalkable(map, x, y) && WorldGen.isWalkable(map, x + 1, y) && WorldGen.isWalkable(map, x - 1, y)) spot = { x: x + 0.5, y: y + 0.5 };
  }
  assert.ok(spot, 'есть место для спутника');
  const cs = await cheat({ a: 'spawn', kind: 'companion', id: 'wolf', level: 5, x: spot.x, y: spot.y });
  const pos = async () => (await cheat({ a: 'list' })).list.find((r) => r.k === 'c' && r.id === cs.id);
  // несуществующий спутник — отказ
  A.drain();
  A.send({ t: 'comp', a: 'control', id: 'нет-такого' });
  const rej = await A.next((x) => x.t === 'comp-reject' || x.t === 'comp-control', 3000);
  assert.equal(rej.t, 'comp-reject');
  assert.match(rej.message, /Управлять можно только своим/);
  // вселение
  A.drain();
  A.send({ t: 'comp', a: 'control', id: cs.id });
  assert.equal((await A.next('comp-control', 3000)).id, cs.id);
  const p0 = await pos();
  A.send({ t: 'comp-input', action: 'dir', dx: 1, dy: 0 });
  await sleep(500);
  A.send({ t: 'comp-input', action: 'dir', dx: -1, dy: 0 });
  await sleep(500);
  A.send({ t: 'comp-input', action: 'stop' });
  let moved = false;
  for (let i = 0; i < 10 && !moved; i++) { const p1 = await pos(); moved = Math.hypot(p1.x - p0.x, p1.y - p0.y) > 0.05; if (!moved) { A.send({ t: 'comp-input', action: 'dir', dx: 0, dy: i % 2 ? 1 : -1 }); await sleep(300); A.send({ t: 'comp-input', action: 'stop' }); } }
  assert.ok(moved, 'вселённый спутник ходит по командам игрока');
  // возврат к герою — повторная команда с тем же id (клавиша \ или ↩)
  A.drain();
  A.send({ t: 'comp', a: 'control', id: cs.id });
  assert.equal((await A.next('comp-control', 3000)).id, null);
  // после возврата ввод спутника не двигает его
  const p2 = await pos();
  A.send({ t: 'comp-input', action: 'dir', dx: 1, dy: 0 });
  await sleep(400);
  const p3 = await pos();
  assert.ok(Math.hypot(p3.x - p2.x, p3.y - p2.y) < 1.5, 'после возврата спутник не управляется вводом');
  await A.close();
});
