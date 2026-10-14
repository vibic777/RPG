'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../server/config');
const { tmpDir, rmDir, runCli, SERVER, MAKE_ADMIN, startServer } = require('./helpers');

test('настройки: значения по умолчанию (порт 3333)', () => {
  const dir = tmpDir();
  try {
    const f = path.join(dir, 'c.json');
    fs.writeFileSync(f, '{}');
    const cfg = config.load({ configFile: f, env: {} });
    assert.equal(cfg.port, 3333);
    assert.equal(cfg.host, '0.0.0.0');
    assert.equal(cfg.dataDir, 'data');
    assert.equal(cfg.game.startPoints, 12);
    assert.equal(cfg.dataPath, path.resolve(config.ROOT, 'data'));
  } finally { rmDir(dir); }
});

test('настройки: приоритет CLI > окружение > config.json > по умолчанию', () => {
  const dir = tmpDir();
  try {
    const f = path.join(dir, 'c.json');
    fs.writeFileSync(f, JSON.stringify({ port: 4000, host: '127.0.0.1', sessionTtlDays: 7, game: { startPoints: 20, maxCharacters: 3 } }));
    // только файл
    let cfg = config.load({ configFile: f, env: {} });
    assert.equal(cfg.port, 4000);
    assert.equal(cfg.sessionTtlDays, 7);
    assert.equal(cfg.game.startPoints, 20);
    assert.equal(cfg.game.maxImplants, 4, 'не заданные в файле вложенные ключи остаются по умолчанию');
    // окружение сильнее файла
    cfg = config.load({ configFile: f, env: { PORT: '4001', RM_SESSION_TTL_DAYS: '2', RM_GAME_START_POINTS: '15' } });
    assert.equal(cfg.port, 4001);
    assert.equal(cfg.sessionTtlDays, 2);
    assert.equal(cfg.game.startPoints, 15);
    assert.equal(cfg.host, '127.0.0.1');
    // CLI сильнее окружения
    const args = config.parseArgs(['--port', '4002', '--set', 'game.startPoints=9', '--data=/tmp/x', '--auto-port'], {
      flags: { '--port': { arg: '<порт>', key: 'port' }, '--auto-port': { key: 'autoPort' } },
    });
    cfg = config.load({ configFile: f, env: { PORT: '4001', RM_GAME_START_POINTS: '15' }, overrides: args.overrides });
    assert.equal(cfg.port, 4002);
    assert.equal(cfg.game.startPoints, 9);
    assert.equal(cfg.dataDir, '/tmp/x');
    assert.equal(cfg.autoPort, true);
    // устаревший срок в минутах действует из любого источника, пока секунды не заданы явно
    assert.equal(config.load({ configFile: f, env: {}, overrides: { 'game.groundItemTtlMin': 0.5 } }).game.groundItemTtlSec, 30);
    assert.equal(config.load({ configFile: f, env: { RM_GAME_GROUND_ITEM_TTL_MIN: '2' } }).game.groundItemTtlSec, 120);
    assert.equal(config.load({ configFile: f, env: {}, overrides: { 'game.groundItemTtlMin': 0.5, 'game.groundItemTtlSec': 5 } }).game.groundItemTtlSec, 5);
  } finally { rmDir(dir); }
});

test('настройки: RM_CONFIG указывает файл; ошибки типов и неизвестные параметры', () => {
  const dir = tmpDir();
  try {
    const f = path.join(dir, 'c.json');
    fs.writeFileSync(f, JSON.stringify({ port: 4100 }));
    assert.equal(config.load({ env: { RM_CONFIG: f } }).port, 4100);
    assert.throws(() => config.load({ configFile: path.join(dir, 'нет.json'), env: {} }), config.ConfigError);
    assert.throws(() => config.load({ configFile: f, env: { PORT: 'abc' } }), config.ConfigError);
    assert.throws(() => config.load({ configFile: f, env: { PORT: '70000' } }), config.ConfigError);
    assert.throws(() => config.parseArgs(['--bogus']), /Неизвестный параметр/);
    assert.throws(() => config.parseArgs(['--set', 'nope=1']), /неизвестная настройка/);
    assert.throws(() => config.parseArgs(['--data']), /нужно значение/);
    assert.equal(config.envName('game.startPoints'), 'RM_GAME_START_POINTS');
    assert.equal(config.envName('dataDir'), 'DATA_DIR');
  } finally { rmDir(dir); }
});

test('CLI: --help и -h у сервера и make-admin, неизвестный флаг — ошибка', () => {
  for (const script of [SERVER, MAKE_ADMIN]) {
    for (const flag of ['--help', '-h']) {
      const r = runCli(script, [flag]);
      assert.equal(r.code, 0, r.out);
      assert.match(r.stdout, /Использование:/);
      assert.match(r.stdout, /--data <папка>/);
    }
    const bad = runCli(script, ['--bogus']);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /Неизвестный параметр: --bogus/);
    assert.match(bad.stderr, /Использование:/);
  }
  const extra = runCli(SERVER, ['лишний']);
  assert.equal(extra.code, 2);
});

test('сервер: занятый порт — понятное сообщение; --auto-port берёт следующий', async () => {
  const s = await startServer();
  try {
    const busy = runCli(SERVER, ['--port', String(s.port), '--host', '127.0.0.1', '--data', s.dataDir]);
    assert.equal(busy.code, 1);
    assert.match(busy.stderr, new RegExp(`Порт ${s.port} уже занят`));
    assert.match(busy.stderr, /--auto-port/);
    // более поздний --port перекрывает --port 0 из помощника
    const s2 = await startServer(['--port', String(s.port), '--auto-port']);
    try {
      assert.ok(s2.port > s.port && s2.port <= s.port + 20, `ожидался следующий порт, получен ${s2.port}`);
      assert.match(s2.output(), /занят, пробую/);
    } finally { await s2.stop(); }
  } finally { await s.stop(); }
});
