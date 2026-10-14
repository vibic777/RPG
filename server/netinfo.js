'use strict';
// Шаг 20: адреса локальной сети (IPv4, не внутренние) — по ним заходят друзья из той же сети или VPN (Radmin, ZeroTier)
function lanAddresses(nets = require('os').networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(nets || {})) for (const a of list || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push({ name, address: a.address });
  return out;
}
function lanLines(host, port, nets) {
  if (host && !['0.0.0.0', '::', ''].includes(host)) return [`Сервер слушает только ${host}: из сети доступен по http://${host}:${port}`];
  const list = lanAddresses(nets);
  if (!list.length) return ['Сетевых адаптеров не найдено — играть можно только на этом компьютере.'];
  return ['В локальной сети / VPN друзья заходят по адресу:', ...list.map((a) => `  http://${a.address}:${port}   (${a.name})`), ...(process.platform === 'win32' ? [`Друзья не могут зайти, а здесь открывается? Запустите firewall-allow.bat — он разрешит TCP-порт ${port} в брандмауэре Windows (или lan-setup.bat — спросит IP и порт и проверит сервер).`] : []), 'Через интернет — см. README, раздел «Игра по сети».'];
}
module.exports = { lanAddresses, lanLines };
