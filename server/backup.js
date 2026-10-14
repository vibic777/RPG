'use strict';
// Резервные копии данных из командной строки. Справка: node server/backup.js --help
const config = require('./config');

const HELP = {
  usage: 'node server/backup.js <list | create [метка] | restore <копия|latest>> [параметры]',
  description: 'Резервные копии папки данных (аккаунты, герои, базы, миры, состояние миров, события).\n' +
    'Копии лежат в папке backupDir (по умолчанию — рядом с данными, «data-backups»); хранятся последние backupKeep.\n' +
    '  list              — список копий (новые первыми)\n' +
    '  create [метка]    — сделать копию сейчас (метка латиницей, по умолчанию manual)\n' +
    '  restore <копия>   — восстановить копию (имя из списка или latest). Сервер должен быть остановлен;\n' +
    '                      перед восстановлением текущие данные сохраняются в копию «before-restore».',
  flags: { '--force': { desc: 'восстановить, даже если сервер работает (не рекомендуется)', name: 'force' } },
  examples: ['node server/backup.js list', 'node server/backup.js create before-update', 'node server/backup.js restore latest', 'node server/backup.js restore 2026-09-28_23-40-00-000-auto --data D:\\rpg-data'],
};

const { args } = config.cli(process.argv.slice(2), HELP);
const backups = require('./backups');
const [cmd, arg] = args.positional;
const fail = (msg) => { console.error('Ошибка: ' + msg + '\n\n' + config.helpText(HELP)); process.exit(2); };
const kb = (n) => (n / 1024).toFixed(1) + ' КБ';
const when = (t) => (t ? new Date(t).toLocaleString('ru-RU') : '—');

try {
  if (cmd === 'list') {
    const all = backups.list();
    if (!all.length) console.log(`Резервных копий нет (папка: ${config.get().backupPath}).`);
    for (const b of all) console.log(`${b.id}  ${when(b.created)}  файлов: ${b.files}, ${kb(b.bytes)}`);
  } else if (cmd === 'create') {
    const b = backups.create(arg || 'manual');
    console.log(`Копия создана: ${b.id} (файлов: ${b.files}, ${kb(b.bytes)}) в ${config.get().backupPath}`);
  } else if (cmd === 'restore') {
    if (!arg) fail('укажите копию: имя из списка или latest.');
    const r = backups.restore(arg, { force: Boolean(args.extra.force) });
    console.log(`Восстановлено из ${r.restored.id}. Прежние данные сохранены в копию ${r.before.id}.`);
  } else {
    fail(cmd ? `неизвестная команда «${cmd}».` : 'не указана команда.');
  }
} catch (e) {
  console.error('Ошибка: ' + e.message);
  process.exit(1);
}
