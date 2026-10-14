'use strict';
// HTTP-сервер: статика из client/ + JSON API.
// WebSocket (ws) для кооператива и чата — на том же порту (server/realtime.js).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const config = require('./config');
const logger = require('./logger');

// ---------- Настройки и командная строка ----------
const HELP = {
  usage: 'node server/index.js [параметры]    (или: npm start -- [параметры])',
  description: 'Сервер игры «Наследие Ржавчины и Магии»: раздаёт клиент и обрабатывает API.',
  flags: {
    '--port': { arg: '<порт>', desc: 'порт сервера (по умолчанию 3333)', key: 'port' },
    '--host': { arg: '<адрес>', desc: 'адрес прослушивания (по умолчанию 0.0.0.0)', key: 'host' },
    '--auto-port': { desc: 'если порт занят — занять следующий свободный', key: 'autoPort' },
    '--open': { desc: 'открыть браузер после запуска', key: 'open' },
  },
  examples: [
    'node server/index.js --port 3100',
    'node server/index.js --data D:\\rpg-data --auto-port',
    'node server/index.js --set game.startPoints=15',
  ],
};
const { cfg, args } = config.cli(process.argv.slice(2), HELP);
if (args.positional.length) {
  console.error(`Ошибка: неожиданный аргумент «${args.positional[0]}».\n\n` + config.helpText(HELP));
  process.exit(2);
}
logger.install(cfg.logging);

// Резервные копии: при запуске (до чтения и миграций данных) и по таймеру; server.lock — метка работающего сервера
const backups = require('./backups');
const restartToken = require('crypto').randomBytes(32).toString('hex');
const restartPipe = process.platform === 'win32'
  ? '\\\\.\\pipe\\rust-magic-' + require('crypto').createHash('sha256').update(cfg.dataPath).digest('hex').slice(0, 24)
  : null;
let restartControl;
{
  const other = backups.serverRunning();
  if (other) console.warn(`Внимание: с папкой данных ${cfg.dataPath} уже работает сервер (процесс ${other}). Два сервера на одних данных могут потерять изменения.`);
  backups.lock(restartPipe ? { restartPipe, restartToken } : {});
  process.on('exit', () => backups.unlock());
  try {
    if (cfg.backupOnStart && require('fs').readdirSync(cfg.dataPath).some((n) => n !== 'server.lock')) backups.create('start');
  } catch (e) { console.warn('[backup] не удалось сделать копию при запуске:', e.message); }
  if (cfg.backupIntervalMin > 0) {
    setInterval(() => {
      try { backups.create('auto'); } catch (e) { console.warn('[backup] не удалось сделать копию:', e.message); }
    }, cfg.backupIntervalMin * 60000).unref();
  }
}

const Rules = require('../shared/character-rules');
Rules.configure(cfg.game);
require('../shared/worldgen').configure(cfg.game);
require('../shared/movement').configure(cfg.game);
require('../shared/combat').configure(cfg.game);
require('../shared/enemies').configure(cfg.game);
require('../shared/survival').configure(cfg.game);
require('../shared/companions').configure(cfg.game);
require('../shared/magic').configure(cfg.game);
require('../shared/building').configure(cfg.game);
require('../shared/crafting').configure(cfg.game);
require('../shared/fog').configure(cfg.game);
require('../shared/camera').configure(cfg.game);
require('../shared/houses').configure(cfg.game);
require('../shared/levels').configure(cfg.game);
require('../shared/vehicles').configure(cfg.game);
require('../shared/settlements').configure(cfg.game);
require('../shared/factions').configure(cfg.game);
require('../shared/family').configure(cfg.game);
require('../shared/voice').configure(cfg.game);
require('../shared/art').configure(cfg.game);
require('../shared/quests').configure(cfg.game);
{
  // бестиарий и таблицы добычи — тоже данные
  const errors = require('../shared/enemies').validate();
  if (errors.length) {
    console.error('Ошибка в бестиарии (shared/enemies.js):\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  if (!['max', 'avg'].includes(cfg.game.scaleMode)) {
    console.error('Ошибка: game.scaleMode — max или avg.');
    process.exit(2);
  }
  // материалы турелей должны быть в каталоге
  const Items = require('../shared/items');
  for (const k of ['turretUpgradeItem', 'turretUpgradeItem2', 'turretRepairItem']) {
    if (cfg.game[k] && !Items.get(cfg.game[k])) { console.error(`Ошибка: game.${k} — нет предмета «${cfg.game[k]}» в каталоге.`); process.exit(2); }
  }
  if (!['nearest', 'strongest', 'weakest'].includes(cfg.game.turretDefaultMode)) { console.error('Ошибка: game.turretDefaultMode — nearest, strongest или weakest.'); process.exit(2); }
}
{
  // каталог предметов — данные; ошибка в нём не должна тихо ломать игру
  const errors = require('../shared/items').validateCatalogue();
  if (errors.length) {
    console.error('Ошибка в каталоге предметов (shared/items.js):\n  ' + errors.join('\n  '));
    process.exit(1);
  }
}
const auth = require('./auth');
const characters = require('./characters');
const bases = require('./bases');
const transfer = require('./transfer');
const events = require('./events');
const admin = require('./admin');
const inventory = require('./inventory');
try { inventory.configure(cfg.game); } catch (e) { console.error('Ошибка: ' + e.message); process.exit(1); }
const worlds = require('./worlds');
const realtime = require('./realtime');
const chat = require('./chat');
const combat = require('./combat');
require('./enemy-social');
const building = require('./building');
const crafting = require('./crafting');
const companions = require('./companions');
require('./companion-control');
const magic = require('./magic');
const levels = require('./levels');
const vehicles = require('./vehicles');
const settlements = require('./settlements'); // поселения (шаг 15): жители, торговля, репутация, набеги
require('./commerce'); // обмен между героями и отдельные личные лавки
require('./autouse'); // автопомощь из сумки: лечение, мана, еда, вода, заправка и ремонт машины
require('./corpses'); // общие для кооператива останки и время их хранения
require('./spawner-settings'); // общие таймер возрождения и лимит популяции врагов
require('./difficulty-settings'); // сложность сервера и время хранения выпавших предметов
const factions = require('./factions'); // фракции (шаг 16): репутация у банд, Союза, Ордена; враждебность
const quests = require('./quests'); // задания и концовки (шаг 16)
require('./cheats'); // чит-панель (шаг 20): WS { t: 'cheat' }
require('./worldedit'); // стройка чит-панели (шаг 21): объекты в мире, тайники
require('./fog'); // туман войны (шаг 22): разведанная карта героя, обзор, отсечение по обзору
const family = require('./family'); // семья (шаг 17)
const voice = require('./voice'); // голосовой чат (шаг 18)
const { HttpError } = auth;

const CLIENT_DIR = path.join(__dirname, '..', 'client');
const SHARED_DIR = path.join(__dirname, '..', 'shared'); // общий код клиента и сервера

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ---------- Утилиты ----------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, maxKb = cfg.maxBodyKb) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxKb * 1024) { reject(new HttpError(413, 'Слишком большой запрос.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Некорректный JSON.')); }
    });
    req.on('error', reject);
  });
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

// ---------- Middleware ----------
// Каждый обработчик получает ctx = { req, res, body, account, token, ip }.

function requireAuth(ctx) {
  ctx.token = bearer(ctx.req);
  ctx.account = auth.accountByToken(ctx.token);
  if (!ctx.account) throw new HttpError(401, 'Требуется вход в игру.');
}

function requireAdmin(ctx) {
  requireAuth(ctx);
  if (ctx.account.role !== 'admin') throw new HttpError(403, 'Доступно только администратору.');
}

// ---------- Маршруты ----------
// [метод, путь, [middleware...], обработчик]; в пути можно использовать параметры «:id»
const routes = [];
// opts.maxKb — свой предел размера запроса (импорт героя)
function route(method, url, mw, handler, opts = {}) {
  const re = new RegExp('^' + url.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  routes.push({ method, url, re, mw, handler, maxKb: opts.maxKb });
}

route('GET', '/api/health', [], () => ({ ok: true, time: Date.now() }));

// Настройки, нужные клиенту (стартовые очки, лимиты и т. п.)
route('GET', '/api/config', [], () => config.publicConfig(cfg));

route('POST', '/api/register', [], async (ctx) => {
  const { username, password } = ctx.body;
  const account = await auth.register(username, password);
  const { token } = await auth.login(username, password, ctx.ip);
  return { token, account: auth.publicAccount(account) };
});

route('POST', '/api/login', [], async (ctx) => {
  const { username, password } = ctx.body;
  const { token, account } = await auth.login(username, password, ctx.ip);
  return { token, account: auth.publicAccount(account) };
});

route('POST', '/api/logout', [requireAuth], (ctx) => {
  auth.destroySession(ctx.token);
  return { ok: true };
});

route('GET', '/api/me', [requireAuth], (ctx) => ({ account: auth.publicAccount(ctx.account) }));

// --- Персонажи (хранятся отдельно от миров) ---
route('GET', '/api/characters', [requireAuth], (ctx) => ({ characters: characters.list(ctx.account) }));

route('POST', '/api/characters', [requireAuth], (ctx) => ({ character: characters.create(ctx.account, ctx.body) }));

// Экспорт / импорт героя файлом JSON (server/transfer.js)
route('GET', '/api/characters/:id/export', [requireAuth], (ctx) => transfer.exportCharacter(ctx.account, ctx.params.id));
route('POST', '/api/characters/import', [requireAuth], (ctx) => transfer.importCharacter(ctx.account, ctx.body), { maxKb: () => cfg.importMaxKb });

route('GET', '/api/characters/:id', [requireAuth], (ctx) => ({ character: characters.get(ctx.account, ctx.params.id) }));

route('DELETE', '/api/characters/:id', [requireAuth], (ctx) => {
  characters.remove(ctx.account, ctx.params.id);
  return { ok: true };
});

// --- Базы (отдельно от миров и персонажей; наполнятся на шаге строительства) ---
route('GET', '/api/bases', [requireAuth], (ctx) => ({ bases: bases.list(ctx.account), max: config.get().game.maxBasesPerAccount }));
route('POST', '/api/bases', [requireAuth], (ctx) => ({ base: bases.create(ctx.account, ctx.body) }));
route('GET', '/api/bases/:id', [requireAuth], (ctx) => ({ base: bases.get(ctx.account, ctx.params.id) }));
route('POST', '/api/bases/:id/name', [requireAuth], (ctx) => ({ base: bases.rename(ctx.account, ctx.params.id, ctx.body.name) }));

// Сохранение позиции героя в мире: body { worldId, x, y, z }
route('POST', '/api/characters/:id/position', [requireAuth], (ctx) => {
  const { worldId, x, y, z } = ctx.body;
  const w = worlds.get(ctx.account, typeof worldId === 'string' ? worldId : '');
  const pos = characters.savePosition(ctx.account, ctx.params.id, w, worlds.getMap(w), { x, y, z });
  return { position: pos };
});

// Действие с инвентарём вне мира: body { type: 'move'|'equip'|'unequip'|'use'|'hotbar'|'hotkey', ... }
// Вложить свободные очки характеристик: body { stat, count? }
route('POST', '/api/characters/:id/stats', [requireAuth], (ctx) => ({ character: combat.allocateRest(ctx.account, ctx.params.id, ctx.body) }));

route('POST', '/api/characters/:id/inventory', [requireAuth], (ctx) => inventory.view(inventory.act(ctx.account, ctx.params.id, ctx.body)));

// --- Миры (параметры генерации; карта строится по сиду на сервере и у клиентов) ---
route('GET', '/api/worlds', [requireAuth], (ctx) => ({ worlds: worlds.list(ctx.account) }));

route('POST', '/api/worlds', [requireAuth], (ctx) => ({ world: worlds.create(ctx.account, ctx.body) }));

route('GET', '/api/worlds/:id', [requireAuth], (ctx) => ({ world: worlds.getView(ctx.account, ctx.params.id) }));

// Перезапустить общую сюжетную кампанию мира из лобби (только владелец).
route('POST', '/api/worlds/:id/story-reset', [requireAuth], (ctx) => require('./quests').resetCampaign(ctx.account, ctx.params.id));

// Присоединиться к чужому миру по коду приглашения: body { code }
route('POST', '/api/worlds/join', [requireAuth], (ctx) => ({ world: worlds.join(ctx.account, ctx.body.code) }));

// Владелец: открыть / закрыть мир, создать / убрать код. body { open?, invite?: 'new' | 'remove' }
route('POST', '/api/worlds/:id/share', [requireAuth], (ctx) => ({ world: worlds.share(ctx.account, ctx.params.id, ctx.body) }));

// Участник убирает чужой мир из своего списка
route('POST', '/api/worlds/:id/leave', [requireAuth], (ctx) => {
  worlds.leave(ctx.account, ctx.params.id);
  return { ok: true };
});

route('DELETE', '/api/worlds/:id', [requireAuth], (ctx) => {
  worlds.remove(ctx.account, ctx.params.id);
  return { ok: true };
});

// --- Администратор (заготовка под панель ГМ) ---
route('GET', '/api/admin/accounts', [requireAdmin], () => ({ accounts: auth.listAccounts() }));

// Панель ГМ (server/admin.js)
route('GET', '/api/admin/players', [requireAdmin], () => ({ players: admin.players() }));
route('POST', '/api/admin/kick', [requireAdmin], (ctx) => admin.kick(ctx.account, ctx.body.username, ctx.body.reason));
route('POST', '/api/admin/role', [requireAdmin], (ctx) => ({ account: auth.publicAccount(auth.setRole(ctx.account, ctx.body.username, ctx.body.role)) }));
route('POST', '/api/admin/teleport', [requireAdmin], (ctx) => admin.teleport(ctx.account, ctx.body));
route('GET', '/api/admin/accounts/:username/characters', [requireAdmin], (ctx) => admin.accountCharacters(decodeURIComponent(ctx.params.username)));
route('POST', '/api/admin/characters/edit', [requireAdmin], (ctx) => admin.editCharacter(ctx.account, ctx.body));
route('POST', '/api/admin/spawn', [requireAdmin], (ctx) => admin.spawn(ctx.account, ctx.body));
route('POST', '/api/admin/message', [requireAdmin], (ctx) => admin.message(ctx.account, ctx.body));
route('GET', '/api/admin/log', [requireAdmin], (ctx) => admin.log(Object.fromEntries(new URL(ctx.req.url, 'http://x').searchParams)));
route('GET', '/api/admin/worlds', [requireAdmin], () => ({ worlds: admin.worldList() }));
route('GET', '/api/admin/server-settings', [requireAdmin], (ctx) => ({settings:admin.serverSettings(new URL(ctx.req.url,'http://x').searchParams.get('worldId'))}));
route('POST', '/api/admin/server-settings', [requireAdmin], (ctx) => admin.setServerSettings(ctx.account, ctx.body));
route('POST', '/api/admin/worlds/:id/save', [requireAdmin], (ctx) => admin.saveWorldNow(ctx.account, ctx.params.id));
route('GET', '/api/admin/backups', [requireAdmin], () => admin.backupList());
route('POST', '/api/admin/backups', [requireAdmin], (ctx) => admin.backupCreate(ctx.account, ctx.body.label));
route('POST', '/api/admin/god', [requireAdmin], (ctx) => admin.setGod(ctx.account, ctx.body));

// Игровые события (server/events.js) — для панели ГМ
route('GET', '/api/admin/events', [requireAdmin], () => ({ events: events.list(), types: events.types() }));
route('POST', '/api/admin/events', [requireAdmin], (ctx) => ({ event: events.add(ctx.account, ctx.body) }));
route('POST', '/api/admin/events/:id/run', [requireAdmin], (ctx) => {
  const ev = events.find(ctx.params.id);
  return { event: ev, ...events.run(ev, { admin: ctx.account }) };
});
route('DELETE', '/api/admin/events/:id', [requireAdmin], (ctx) => ({ event: events.remove(ctx.account, ctx.params.id) }));

// body: { username, minutes?: число (нет/0 — бессрочно), reason?: строка }
route('POST', '/api/admin/ban', [requireAdmin], (ctx) => {
  const { username, minutes, reason } = ctx.body;
  return { account: auth.publicAccount(auth.ban(ctx.account, username, minutes, reason)) };
});

// Выдать / забрать предметы. body { username, character? (id или имя), item (id или название), count? }
route('POST', '/api/admin/items/give', [requireAdmin], (ctx) => inventory.give(ctx.account, ctx.body));
route('POST', '/api/admin/items/take', [requireAdmin], (ctx) => inventory.take(ctx.account, ctx.body));
// Базы и рецепты (шаг 10)
route('GET', '/api/admin/bases', [requireAdmin], () => ({ bases: building.adminList() }));
route('POST', '/api/admin/bases/remove', [requireAdmin], (ctx) => {
  const b = building.adminRemove(ctx.body.id);
  if (!b) throw new auth.HttpError(404, 'База не найдена.');
  auth.logAdmin(ctx.account, 'base-remove', { id: b.id, owner: b.ownerId, name: b.name });
  return { ok: true, id: b.id };
});
route('POST', '/api/admin/companions/list', [requireAdmin], (ctx) => companions.adminList(ctx.body));
route('POST', '/api/admin/companions/give', [requireAdmin], (ctx) => {
  const r = companions.adminGive(ctx.body, false);
  auth.logAdmin(ctx.account, 'companion-give', { username: r.username, character: r.character, def: r.companion.def, level: r.companion.lvl });
  return r;
});
route('POST', '/api/admin/companions/spawn', [requireAdmin], (ctx) => {
  const r = companions.adminGive({ ...ctx.body, out: true }, true);
  auth.logAdmin(ctx.account, 'companion-spawn', { username: r.username, character: r.character, def: r.companion.def, level: r.companion.lvl });
  return r;
});
route('POST', '/api/admin/companions/remove', [requireAdmin], (ctx) => {
  const r = companions.adminRemove(ctx.body);
  auth.logAdmin(ctx.account, 'companion-remove', { username: r.username, character: r.character, name: r.removed });
  return r;
});
route('POST', '/api/admin/recipes/give', [requireAdmin], (ctx) => {
  const r = crafting.adminGive(ctx.account, ctx.body);
  auth.logAdmin(ctx.account, 'recipe-give', { username: r.username, character: r.character, recipe: String(ctx.body.recipe || '') });
  return r;
});
// Транспорт (шаг 14): список, спавн рядом с игроком (или с собой), убрать / починить / заправить
route('POST', '/api/admin/vehicles/list', [requireAdmin], (ctx) => vehicles.adminList(ctx.body));
route('POST', '/api/admin/vehicles/spawn', [requireAdmin], (ctx) => vehicles.adminSpawn(ctx.account, ctx.body));
route('POST', '/api/admin/vehicles/act', [requireAdmin], (ctx) => vehicles.adminAct(ctx.account, ctx.body));
// Поселения (шаг 15): список (репутации, прочность, набег), действие rep | restock | repair | raid
route('POST', '/api/admin/settlements/list', [requireAdmin], (ctx) => settlements.adminList(ctx.account, ctx.body));
route('POST', '/api/admin/settlements/act', [requireAdmin], (ctx) => settlements.adminAct(ctx.account, ctx.body));
route('POST', '/api/admin/quests/list', [requireAdmin], (ctx) => quests.adminList(ctx.account, ctx.body));
route('POST', '/api/admin/quests/act', [requireAdmin], (ctx) => quests.adminAct(ctx.account, ctx.body));
// Семья (шаг 17): отношения и члены семьи героя
route('POST', '/api/admin/family/list', [requireAdmin], (ctx) => family.adminList(ctx.body));
route('POST', '/api/admin/family/act', [requireAdmin], (ctx) => family.adminAct(ctx.account, ctx.body));
route('POST', '/api/admin/voice/list', [requireAdmin], () => voice.adminList());
route('POST', '/api/admin/voice/mute', [requireAdmin], (ctx) => {
  const { username, minutes, reason } = ctx.body || {};
  return { account: auth.publicAccount(auth.voiceMute(ctx.account, username, minutes === undefined ? require('../shared/voice').settings.voiceMuteDefaultMin || null : minutes, reason)), ...voice.adminList() };
});
route('POST', '/api/admin/voice/unmute', [requireAdmin], (ctx) => ({ account: auth.publicAccount(auth.voiceUnmute(ctx.account, (ctx.body || {}).username)), ...voice.adminList() }));
// Магия (шаг 12): список, научить (spell = id | 'all'), стереть
route('POST', '/api/admin/spells/list', [requireAdmin], (ctx) => magic.adminList(ctx.body));
route('POST', '/api/admin/spells/teach', [requireAdmin], (ctx) => {
  const r = magic.adminTeach(ctx.body);
  auth.logAdmin(ctx.account, 'spell-teach', { username: r.username, character: r.character, spell: String(ctx.body.spell || '') });
  return r;
});
route('POST', '/api/admin/spells/remove', [requireAdmin], (ctx) => {
  const r = magic.adminRemove(ctx.body);
  auth.logAdmin(ctx.account, 'spell-remove', { username: r.username, character: r.character, spell: String(ctx.body.spell || '') });
  return r;
});

// Объявление администратора в чат: во все активные миры или в один. body { text, worldId? }
route('POST', '/api/admin/announce', [requireAdmin], (ctx) => {
  const { text, worldId } = ctx.body;
  return chat.announce(ctx.account, typeof text === 'string' ? text : '', typeof worldId === 'string' && worldId ? worldId : null);
});

route('POST', '/api/admin/unban', [requireAdmin], (ctx) => {
  return { account: auth.publicAccount(auth.unban(ctx.account, ctx.body.username)) };
});

async function handleApi(req, res, pathname) {
  const startedAt = process.hrtime.bigint();
  res.once('finish', () => logger.write('info', `${req.method} ${pathname} → ${res.statusCode} (${Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6)} мс)`));
  let params = null;
  const r = routes.find((x) => x.method === req.method && (params = x.re.exec(pathname)));
  if (!r) {
    const known = routes.some((x) => x.re.test(pathname));
    return sendJson(res, known ? 405 : 404, { error: known ? 'Метод не поддерживается.' : 'Не найдено.' });
  }
  const ctx = { req, res, body: {}, params: { ...params.groups }, account: null, token: null, ip: req.socket.remoteAddress || '' };
  try {
    if (req.method === 'POST' || req.method === 'PUT') ctx.body = await readBody(req, r.maxKb ? r.maxKb() : undefined);
    if (typeof ctx.body !== 'object' || ctx.body === null || Array.isArray(ctx.body)) ctx.body = {};
    for (const mw of r.mw) mw(ctx);
    const result = await r.handler(ctx);
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message, ...(err.extra || {}) });
    } else {
      console.error('[api]', err);
      sendJson(res, 500, { error: 'Внутренняя ошибка сервера.' });
    }
  }
}

// ---------- Статика ----------

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); return res.end();
  }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel.includes('\0')) { res.writeHead(400); return res.end(); } // нулевой байт роняет fs.stat
  if (rel.endsWith('/')) rel += 'index.html';
  let root = CLIENT_DIR;
  if (rel.startsWith('/shared/')) { root = SHARED_DIR; rel = rel.slice(7); }
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Не найдено');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- Запуск ----------

const server = http.createServer((req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) handleApi(req, res, pathname);
    else serveStatic(req, res, pathname);
  } catch (err) {
    // ни один запрос не должен ронять сервер
    console.error('[http]', err);
    if (!res.headersSent) res.writeHead(400);
    res.end();
  }
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, (err) => { if (err) console.log(`Не удалось открыть браузер. Откройте вручную: ${url}`); });
}

let port = cfg.port;
let attempts = 0;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
    if (cfg.autoPort && attempts < cfg.autoPortTries && port !== 0) {
      attempts++;
      console.log(`Порт ${port} занят, пробую ${port + 1}...`);
      port++;
      return server.listen(port, cfg.host);
    }
    const busy = err.code === 'EADDRINUSE' ? `Порт ${port} уже занят (возможно, сервер уже запущен).` : `Нет доступа к порту ${port}.`;
    console.error(`Ошибка: ${busy}\nЗапустите на другом порту, например:\n` +
      `  start.bat ${port + 1}\n  npm start -- --port ${port + 1}\n` +
      `или добавьте флаг --auto-port, чтобы занять следующий свободный порт.`);
    process.exit(1);
  }
  throw err;
});

realtime.attach(server);
events.start(); // расписание игровых событий

// Корректное завершение (Ctrl+C / остановка службы): сохранить позиции игроков и предупредить их
let stopping = false;
function gracefulExit() {
  if (stopping) return;
  stopping = true;
  console.log('Остановка сервера: сохраняю позиции игроков...');
  realtime.shutdown();
  if (restartControl) restartControl.close();
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
}
process.on('SIGINT', gracefulExit); // Ctrl+C (в том числе в Windows)
process.on('SIGTERM', gracefulExit);
if (process.platform === 'win32') process.on('SIGBREAK', gracefulExit); // Ctrl+Break, закрытие консоли
// Запуск из другой программы с IPC-каналом (менеджер процессов, тесты): сообщение 'shutdown'.
// В Windows сигнал SIGTERM завершает процесс сразу, поэтому корректная остановка — через IPC.
if (process.send) process.on('message', (m) => { if (m === 'shutdown') gracefulExit(); });

// Локальный канал батника: перед остановкой сохраняем игроков обычным gracefulExit.
if (restartPipe) {
  restartControl = require('net').createServer((socket) => {
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('error', () => {});
    let request = '';
    socket.on('data', (chunk) => {
      request += chunk.toString();
      if (request.length > 256) return socket.destroy();
      if (!request.includes('\n')) return;
      if (request.trim() !== restartToken) return socket.destroy();
      socket.end('OK\n');
      gracefulExit();
    });
  });
  restartControl.on('error', (err) => console.error('Канал перезапуска недоступен:', err.message));
  restartControl.listen(restartPipe);
  restartControl.unref();
}

const { lanLines } = require('./netinfo'); // шаг 20: адреса локальной сети при запуске
// Шаг 20: необработанная ошибка не роняет сервер (crashSafe): журнал и аварийное сохранение миров
let crashSaves = 0;
process.on('uncaughtException', (err) => {
  console.error('[сбой] необработанное исключение:', err && err.stack ? err.stack : err);
  if (!cfg.crashSafe || stopping) process.exit(1);
  realtime.reportError('процесс', err);
  if (crashSaves++ < 5) { try { for (const room of realtime.rooms.values()) room.saveWorld(); console.error('[сбой] миры сохранены, сервер продолжает работу.'); } catch (e) { console.error('[сбой] аварийное сохранение не удалось:', e.message); } }
});
process.on('unhandledRejection', (err) => { console.error('[сбой] необработанный отказ промиса:', err && err.stack ? err.stack : err); realtime.reportError('промис', err); });

server.listen(port, cfg.host, () => {
  const actual = server.address().port;
  const url = `http://localhost:${actual}`;
  console.log(`[Наследие Ржавчины и Магии] сервер запущен: ${url}`);
  for (const line of lanLines(cfg.host, actual)) console.log(line); // шаг 20: адреса для друзей в локальной сети
  console.log(`Данные: ${cfg.dataPath}`);
  if (cfg.open) openBrowser(url);
});

module.exports = { server, requireAuth, requireAdmin };
