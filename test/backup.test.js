'use strict';
// Резервные копии (server/backups.js и CLI server/backup.js): создание, ротация, список, восстановление,
// защита от восстановления при работающем сервере, копия при запуске сервера.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpDir, rmDir, runCli, startServer, newPlayer } = require('./helpers');

function dataDirWith(files) {
  const dir = tmpDir();
  const data = path.join(dir, 'data');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(data, rel)), { recursive: true });
    fs.writeFileSync(path.join(data, rel), text);
  }
  return { dir, data };
}
const cli = (data, ...a) => runCli('server/backup.js', [...a, '--data', data]);

test('резервные копии: create, list, ротация по backupKeep, restore latest возвращает данные', (t) => {
  const { dir, data } = dataDirWith({ 'accounts.json': '{"users":{"a":1}}', 'worlds/w.json': '{"id":"w"}' });
  t.after(() => rmDir(dir));
  let r = cli(data, 'create', 'first');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Копия создана: .*-first/);
  // данные испортились
  fs.writeFileSync(path.join(data, 'accounts.json'), '{"users":{}}');
  fs.writeFileSync(path.join(data, 'junk.json'), 'x');
  r = cli(data, 'list');
  assert.match(r.stdout, /-first/);
  r = cli(data, 'restore', 'latest');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Прежние данные сохранены в копию .*before-restore/);
  assert.equal(fs.readFileSync(path.join(data, 'accounts.json'), 'utf8'), '{"users":{"a":1}}');
  assert.equal(fs.readFileSync(path.join(data, 'worlds/w.json'), 'utf8'), '{"id":"w"}');
  assert.ok(!fs.existsSync(path.join(data, 'junk.json')), 'лишние файлы убраны');
  // ротация: хранится не больше backupKeep
  for (let i = 0; i < 4; i++) assert.equal(cli(data, 'create', 'n' + i, '--set', 'backupKeep=3').code, 0);
  const names = fs.readdirSync(data + '-backups');
  assert.equal(names.length, 3);
  assert.ok(names.some((n) => n.endsWith('-n3')) && !names.some((n) => n.endsWith('-first')), names.join(','));
  // ошибки: неизвестная копия, нет команды
  assert.equal(cli(data, 'restore', 'nope').code, 1);
  assert.equal(cli(data).code, 2);
  assert.match(runCli('server/backup.js', ['--help']).stdout, /restore/);
});

test('резервные копии: сервер делает копию при запуске и не даёт восстановить себя на ходу', async (t) => {
  const dir = tmpDir();
  t.after(() => rmDir(dir));
  const data = path.join(dir, 'data');
  const s = await startServer(['--data', data]);
  t.after(() => s.stop());
  await newPlayer(s.base, 'bkuser', 'Копир');
  assert.ok(fs.existsSync(path.join(data, 'server.lock')));
  assert.equal(cli(data, 'create').code, 0);
  const r = cli(data, 'restore', 'latest');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Сервер работает/);
  await s.stop();
  // в Windows kill() завершает процесс сразу, без обработчиков — метка останется, но процесса уже нет
  if (process.platform !== 'win32') assert.ok(!fs.existsSync(path.join(data, 'server.lock')), 'метка убрана при остановке');
  // повторный запуск на тех же данных — копия «start»
  const s2 = await startServer(['--data', data]);
  t.after(() => s2.stop());
  const list = cli(data, 'list').stdout;
  assert.match(list, /-start /);
});
