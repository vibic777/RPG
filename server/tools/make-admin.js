'use strict';
// Назначение администратора из командной строки. Справка: node server/tools/make-admin.js --help
const config = require('../config');

const HELP = {
  usage: 'node server/tools/make-admin.js <имя> [--revoke] [параметры]',
  description: 'Выдаёт аккаунту роль администратора (admin) или возвращает роль игрока (player).\n' +
    'Можно запускать при работающем сервере: он перечитает accounts.json.',
  flags: {
    '--revoke': { desc: 'снять роль администратора (вернуть player)' },
  },
  examples: ['node server/tools/make-admin.js Вальдемар', 'node server/tools/make-admin.js Вальдемар --revoke', 'npm run make-admin -- Вальдемар'],
};

const { args } = config.cli(process.argv.slice(2), HELP);
if (args.positional.length !== 1) {
  console.error((args.positional.length ? 'Ошибка: нужно ровно одно имя аккаунта.' : 'Ошибка: не указано имя аккаунта.') + '\n\n' + config.helpText(HELP));
  process.exit(2);
}
const username = args.positional[0];
const { accounts } = require('../store');
const db = accounts.get();
const a = db.users[username.toLowerCase()];
if (!a) {
  console.error(`Аккаунт «${username}» не найден (папка данных: ${config.get().dataPath}).`);
  process.exit(1);
}
a.role = args.extra.revoke ? 'player' : 'admin';
accounts.save();
console.log(`Аккаунт «${a.username}»: роль теперь ${a.role}.`);
