'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, rawGet } = require('./helpers');

test('статика: страницы клиента и общий код', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const cases = [
    ['/', 'text/html', /screen-auth/],
    ['/css/style.css', 'text/css', /--accent/],
    ['/js/main.js', 'text/javascript', /boot\(\)/],
    ['/js/preview.js', 'text/javascript', /drawCharacter/],
    ['/shared/character-rules.js', 'text/javascript', /CharacterRules/],
    ['/shared/worldgen.js', 'text/javascript', /WorldGen/],
    ['/shared/movement.js', 'text/javascript', /findPath/],
    ['/js/worlds.js', 'text/javascript', /openWorlds/],
    ['/js/game/game.js', 'text/javascript', /enterGame/],
    ['/js/game/render.js', 'text/javascript', /IsoRenderer/],
    ['/js/net.js', 'text/javascript', /class Net/],
    ['/js/chat.js', 'text/javascript', /chatOnMessage/],
    ['/shared/protocol.js', 'text/javascript', /backoffDelay/],
    ['/shared/magic.js', 'text/javascript', /hotbarKey/],
    ['/shared/items.js', 'text/javascript', /validateCatalogue/],
    ['/shared/survival.js', 'text/javascript', /radGrid/],
    ['/shared/building.js', 'text/javascript', /canPlace/],
    ['/shared/crafting.js', 'text/javascript', /RECIPES/],
    ['/shared/companions.js', 'text/javascript', /dragonForLair/],
    ['/shared/inventory.js', 'text/javascript', /applyKit/],
    ['/js/icons.js', 'text/javascript', /drawIcon/],
    ['/js/inventory-ui.js', 'text/javascript', /itemTooltip/],
    ['/shared/combat.js', 'text/javascript', /rollDamage/],
    ['/shared/enemies.js', 'text/javascript', /rollLoot/],
    ['/js/game/combat-view.js', 'text/javascript', /combatOnMessage/],
    ['/js/game/enemy-draw.js', 'text/javascript', /drawEnemy/],
    ['/js/stats-ui.js', 'text/javascript', /showDeath/],
  ];
  for (const [url, type, body] of cases) {
    const r = await rawGet(s.port, url);
    assert.equal(r.status, 200, url);
    assert.ok(r.headers['content-type'].startsWith(type), url + ' ' + r.headers['content-type']);
    assert.match(r.body, body, url);
  }
  assert.equal((await rawGet(s.port, '/nope.html')).status, 404);
});

test('статика: клиент получает тот же код генератора, что и сервер', async (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const s = await startServer();
  t.after(() => s.stop());
  for (const f of ['worldgen.js', 'movement.js', 'character-rules.js', 'protocol.js', 'items.js', 'inventory.js', 'combat.js', 'enemies.js']) {
    const served = (await rawGet(s.port, '/shared/' + f)).body;
    assert.equal(served, fs.readFileSync(path.join(__dirname, '..', 'shared', f), 'utf8'), f);
  }
  const html = (await rawGet(s.port, '/')).body;
  for (const id of ['screen-worlds', 'screen-game', 'game-canvas', 'minimap', 'hotbar', 'game-menu', 'bar-hp', 'bar-stamina', 'bar-mp', 'hud-players', 'net-status', 'join-form', 'join-code', 'chat', 'chat-log', 'chat-input', 'btn-chat-toggle', 'announce-banner', 'inv-window', 'inv-grid', 'inv-doll-canvas', 'inv-weight', 'inv-drop', 'btn-inventory', 'item-tip',
    'bar-xp', 'target-frame', 'tf-hp', 'hud-ammo', 'btn-stats', 'stats-badge', 'stats-window', 'stats-body', 'death-overlay', 'death-stat', 'btn-respawn']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  // общий код боя подключается до модулей клиента
  assert.ok(html.indexOf('/shared/combat.js') > html.indexOf('/shared/items.js'), 'combat.js после items.js');
  assert.ok(html.indexOf('/shared/enemies.js') < html.indexOf('js/main.js'), 'enemies.js до main.js');
});

test('клиент: бестиарий в справке строится из данных, у всех форм врагов есть рисунок', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const Enemies = require('../shared/enemies.js');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'client', 'js', f), 'utf8');
  // enemy-draw.js — тонкая обёртка: рисунки форм живут в creature-art.js (ветки по look.shape)
  assert.match(read('game/enemy-draw.js'), /from '\.\/creature-art\.js'/);
  const draw = read('game/creature-art.js');
  for (const shape of new Set(Enemies.ENEMIES.map((e) => e.look.shape))) assert.ok(draw.includes(`'${shape}'`), 'нет рисунка формы ' + shape);
  const help = read('help.js');
  for (const id of ['h-combat', 'h-enemies', 'h-xp', 'h-death']) assert.match(help, new RegExp(`id="${id}"`), id);
  assert.match(help, /E\.ENEMIES\.filter/, 'бестиарий генерируется из shared/enemies.js');
  assert.doesNotMatch(help, /появится на следующем этапе|появится вместе с боем|заработают вместе с боем/, 'устаревшие тексты убраны');
  assert.doesNotMatch(read('inventory-ui.js'), /появится вместе с боем/);
});

test('статика: обход каталогов запрещён', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const attempts = [
    '/../server/auth.js', '/../package.json', '/%2e%2e/package.json', '/%2e%2e%2fpackage.json',
    '/..%5cpackage.json', '/..%5c..%5cpackage.json', '/shared/../server/auth.js', '/shared/%2e%2e/server/auth.js',
    '/shared/..%5cserver%5cauth.js', '/%00', '/%E0%A4%A',
  ];
  for (const p of attempts) {
    const r = await rawGet(s.port, p);
    assert.notEqual(r.status, 200, `${p} не должен отдаваться`);
    assert.ok(!/scrypt|"dependencies"/.test(r.body), `${p}: утечка содержимого`);
  }
});
