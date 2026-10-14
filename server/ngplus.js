'use strict';
// «Новая игра+» (GDD §11: несколько концовок, игра продолжается после финала, новую игру можно начать с сохранённым
// героем и базой). Здесь — флаг концовки на герое и правила мира НИ+. Сами концовки (сюжет, фракции) — шаг 16:
// он вызовет markEnding(герой, 'id_концовки'); до тех пор флаг ставит администратор командой /ending.
const config = require('./config');
const { HttpError } = require('./auth');

const ENDING_RE = /^[a-z0-9_-]{1,32}$/;
const G = () => config.get().game;

// Отметить концовку на записи героя. Возвращает true, если это новая концовка.
function markEnding(ch, endingId = 'test', now = Date.now()) {
  const id = String(endingId);
  if (!ENDING_RE.test(id)) throw new HttpError(400, 'Концовка: латинские буквы, цифры, «_» и «-», до 32 символов.');
  ch.endings = Array.isArray(ch.endings) ? ch.endings : [];
  if (ch.endings.some((e) => e.id === id)) return false;
  ch.endings.push({ id, at: now });
  return true;
}

const eligible = (ch) => Boolean(ch && Array.isArray(ch.endings) && ch.endings.length);

// Описание НИ+ для записи нового мира (или ошибка). round — сколько концовок у героя: чем больше, тем «дальше» забег.
function worldInfo(ch, base) {
  if (!eligible(ch)) throw new HttpError(400, '«Новая игра+» открывается после концовки: этот герой ещё не прошёл игру.');
  return { round: ch.endings.length, characterId: ch.id, characterName: ch.name, baseId: base ? base.id : null, at: Date.now() };
}

// Множители врагов в мире НИ+ (1 — обычный мир). Берутся из настроек при каждом появлении, так что их можно менять.
function enemyFactors(world) {
  if (!world || !world.ngPlus) return { hp: 1, damage: 1 };
  return { hp: G().ngPlusEnemyHpFactor, damage: G().ngPlusEnemyDamageFactor };
}

module.exports = { markEnding, eligible, worldInfo, enemyFactors };
