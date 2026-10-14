'use strict';
// Перенос героя в файл и обратно (экспорт / импорт JSON).
//
// Файл: { format: 'rust-magic-character', version, exportedAt, owner, server, character, sig }.
// sig — HMAC-SHA256 по остальным полям с секретом сервера (data/secret.key, создаётся сам).
//
// Импорт своего файла (подпись сервера верна, тот же аккаунт) — герой возвращается целиком, с тем же id:
//   * если такой герой уже есть на сервере — отказ (иначе вещи удваивались бы);
//   * удалённого героя можно вернуть, только если после экспорта он не менялся (надгробие в файле персонажей),
//     и только один раз.
// Чужой файл (другой сервер, другой аккаунт, нет подписи или файл изменён) — по настройке characterImportForeign:
//   'appearance' (по умолчанию) — новый герой 1-го уровня с тем же именем и внешностью, без вещей и опыта;
//   'full' — весь герой, но только после строгой проверки (уровень, опыт, очки, вещи); новый id;
//   'reject' — отказ.
// В любом случае запись проверяется: известные предметы, размер стопок, прочность, характеристики и уровень.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { dataPath, writeAtomic } = require('./store');
const characters = require('./characters');
const Rules = require('../shared/character-rules');
const Combat = require('../shared/combat');
const Items = require('../shared/items');
const Inv = require('../shared/inventory');
const { HttpError } = require('./auth');

const FORMAT = 'rust-magic-character';
const VERSION = 1;
const SIGNED = ['format', 'version', 'exportedAt', 'owner', 'server', 'character'];

let secretCache = null;
function secret() {
  const file = path.join(dataPath(), 'secret.key');
  if (secretCache && secretCache.file === file) return secretCache.key;
  let key = '';
  try { key = fs.readFileSync(file, 'utf8').trim(); } catch { /* ещё нет */ }
  if (!/^[0-9a-f]{64}$/.test(key)) {
    key = crypto.randomBytes(32).toString('hex');
    writeAtomic(file, key + '\n');
  }
  secretCache = { file, key };
  return key;
}
// Открытый отпечаток сервера (по нему видно, что файл «свой»; сам секрет не раскрывается)
const serverId = () => crypto.createHash('sha256').update('server:' + secret()).digest('hex').slice(0, 16);
const ownerTag = (accountId) => crypto.createHmac('sha256', secret()).update('owner:' + accountId).digest('hex').slice(0, 24);
function sign(file) {
  const body = {};
  for (const k of SIGNED) body[k] = file[k];
  return crypto.createHmac('sha256', secret()).update(JSON.stringify(body)).digest('hex');
}
function signatureOk(file) {
  if (typeof file.sig !== 'string' || !/^[0-9a-f]{64}$/.test(file.sig)) return false;
  return crypto.timingSafeEqual(Buffer.from(file.sig, 'hex'), Buffer.from(sign(file), 'hex'));
}

const PRIVATE = ['accountId', 'positions', 'lastWorld'];
function exportCharacter(account, id) {
  const rec = structuredClone(characters.get(account, id));
  for (const k of PRIVATE) delete rec[k];
  const file = { format: FORMAT, version: VERSION, exportedAt: Date.now(), owner: ownerTag(account.id), server: serverId(), character: rec };
  file.sig = sign(file);
  return file;
}

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Строгая проверка записи героя. Возвращает список ошибок (пустой — всё в порядке).
function checkRecord(ch) {
  const errs = [];
  if (!ch || typeof ch !== 'object' || Array.isArray(ch)) return ['Нет данных героя.'];
  const base = Rules.validateNew({ name: ch.name, appearance: ch.appearance, stats: Object.fromEntries(Rules.STATS.map((s) => [s.id, 1])) });
  errs.push(...base.errors);
  const cs = Combat.settings;
  if (!isInt(ch.level, 1, cs.maxLevel)) errs.push(`Уровень — от 1 до ${cs.maxLevel}.`);
  else if (!(Number.isFinite(ch.xp) && ch.xp >= 0 && ch.xp < Combat.xpToNext(ch.level))) errs.push('Опыт не соответствует уровню.');
  const st = ch.stats && typeof ch.stats === 'object' ? ch.stats : {};
  let spent = 0;
  for (const s of Rules.STATS) {
    const v = st[s.id] ?? (s.id === 'shops' ? 1 : undefined);
    if (!isInt(v, Rules.STAT_MIN, Rules.statCap(s.id, false))) errs.push(`«${s.label}»: недопустимое значение.`);
    else spent += v - Rules.STAT_MIN;
  }
  if (!isInt(ch.unspentPoints, 0, 1e6)) errs.push('Нераспределённые очки — целое число ≥ 0.');
  else if (Number.isInteger(ch.level) && spent + ch.unspentPoints > Rules.START_POINTS + cs.statPointsPerLevel * (ch.level - 1)) errs.push('Очков характеристик больше, чем даёт уровень.');
  if (ch.deaths !== undefined && !isInt(ch.deaths, 0, 1e9)) errs.push('Число смертей — целое ≥ 0.');
  errs.push(...checkInventory(ch.inventory));
  if (ch.ammoOpen !== undefined) {
    if (!ch.ammoOpen || typeof ch.ammoOpen !== 'object') errs.push('Вскрытые боеприпасы: неверный формат.');
    else for (const [id, n] of Object.entries(ch.ammoOpen)) if (!Items.get(id) || !isInt(n, 0, 1e4)) errs.push(`Вскрытые боеприпасы «${id}»: неверно.`);
  }
  return errs;
}

function checkItem(x, where, uids, errs) {
  if (!x || typeof x !== 'object') { errs.push(`${where}: неверный предмет.`); return; }
  const it = Items.get(x.id);
  if (!it) { errs.push(`${where}: неизвестный предмет «${String(x.id).slice(0, 40)}».`); return; }
  if (!isInt(x.n, 1, it.stack)) errs.push(`${where}: «${it.name}» — в стопке от 1 до ${it.stack}.`);
  if (x.dur !== undefined && !(it.durability && Number.isFinite(x.dur) && x.dur >= 0 && x.dur <= it.durability)) errs.push(`${where}: «${it.name}» — неверная прочность.`);
  if (x.tier !== undefined && !isInt(x.tier, 1, config.get().game.turretMaxTier)) errs.push(`${where}: «${it.name}» — неверный уровень улучшения.`);
  if (x.mag !== undefined && !isInt(x.mag, 0, Math.max(0, (it.weapon && it.weapon.magazine) || 0))) errs.push(`${where}: «${it.name}» — в магазине больше патронов, чем он вмещает.`);
  if (typeof x.uid !== 'string' || x.uid.length > 40 || uids.has(x.uid)) errs.push(`${where}: повторяющийся или неверный uid.`);
  uids.add(x.uid);
}

function checkInventory(inv) {
  const errs = [];
  if (inv == null) return errs; // старый герой без инвентаря — будет выдан заново
  if (typeof inv !== 'object' || !Array.isArray(inv.cells) || !inv.equipment || typeof inv.equipment !== 'object') return ['Инвентарь: неверный формат.'];
  const maxCells = Math.min(65536, config.get().game.importMaxCells);
  if (inv.cells.length > maxCells) errs.push(`Инвентарь: больше ${maxCells} ячеек.`);
  const uids = new Set();
  inv.cells.forEach((x, i) => { if (x !== null) checkItem(x, `Ячейка ${i + 1}`, uids, errs); });
  const slots = new Set(Items.SLOTS.map((s) => s.id));
  for (const [s, x] of Object.entries(inv.equipment)) {
    if (!slots.has(s)) { errs.push(`Снаряжение: неизвестный слот «${String(s).slice(0, 20)}».`); continue; }
    if (x === null || s === 'underwear') continue;
    checkItem(x, `Слот «${s}»`, uids, errs);
    const it = Items.get(x && x.id);
    if (it && !Items.slotsFor(it).includes(s)) errs.push(`Слот «${s}»: «${it.name}» сюда не надевается.`);
  }
  return errs.slice(0, 20);
}

// Импорт. input: { file, name? } — name меняет имя при совпадении.
function importCharacter(account, input) {
  const file = input && input.file;
  if (!file || typeof file !== 'object' || file.format !== FORMAT) throw new HttpError(400, 'Это не файл героя.');
  if (!Number.isInteger(file.version) || file.version < 1) throw new HttpError(400, 'Файл героя повреждён: нет версии.');
  if (file.version > VERSION) throw new HttpError(400, 'Файл героя сделан более новой версией игры — обновите сервер.');
  const own = signatureOk(file) && file.owner === ownerTag(account.id);
  const src = structuredClone(file.character);
  if (!src || typeof src !== 'object' || Array.isArray(src)) throw new HttpError(400, 'В файле нет героя.');
  if (input.name !== undefined) src.name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  const now = Date.now();

  if (!own) {
    const mode = config.get().characterImportForeign;
    if (mode === 'reject') throw new HttpError(403, 'Файл создан на другом сервере, другим аккаунтом или изменён — импорт таких файлов на этом сервере выключен.');
    if (mode !== 'full') { // appearance и любое неизвестное значение — самый безопасный вариант
      const v = Rules.validateNew({ name: src.name, appearance: src.appearance, stats: Object.fromEntries(Rules.STATS.map((s) => [s.id, 1])) });
      if (!v.ok) throw new HttpError(400, v.errors.join('\n'), { errors: v.errors });
      const rec = characters.create(account, v.value);
      return { character: rec, mode: 'appearance', message: 'Файл чужой или изменён: перенесены только имя и внешность, герой начинает с 1-го уровня.' };
    }
  }
  const errs = checkRecord(src);
  if (errs.length) throw new HttpError(400, 'Файл героя не прошёл проверку:\n' + errs.join('\n'), { errors: errs });
  let id = crypto.randomUUID(), tomb = false;
  if (own) {
    if (characters.list(account).some((c) => c.id === src.id)) throw new HttpError(409, 'Этот герой уже есть в вашем списке — импорт создал бы его копию.');
    const t = characters.tombstone(account, src.id);
    if (t) {
      if (t.updatedAt > file.exportedAt) throw new HttpError(409, 'Герой менялся после этого экспорта и потом был удалён — старый файл восстановить нельзя.');
      id = src.id; tomb = true;
    } else if (typeof src.id === 'string' && /^[0-9a-f-]{36}$/.test(src.id)) {
      throw new HttpError(409, 'Этот герой не был удалён — импорт создал бы его копию.');
    }
  }
  if (!own) delete src.endings; // концовки (доступ к «Новой игре+») из чужого файла не переносятся
  const d = Rules.derive(src.stats, src.level);
  const rec = {
    ...src, id, accountId: account.id, createdAt: Number.isFinite(src.createdAt) ? src.createdAt : now, updatedAt: now, importedAt: now,
    lastWorld: null, positions: {},
    vitals: { hp: d.maxHp, stamina: d.maxStamina, mp: d.maxMp },
  };
  if (rec.inventory) Inv.ensure(rec);
  characters.addRecord(account, rec, { tombstone: tomb });
  return { character: rec, mode: own ? 'own' : 'full', message: own ? 'Герой восстановлен из файла.' : 'Герой перенесён из чужого файла после проверки.' };
}

module.exports = { exportCharacter, importCharacter, checkRecord, signatureOk, FORMAT, VERSION };
