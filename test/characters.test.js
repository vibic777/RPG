'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Rules = require('../shared/character-rules');
const { startServer, api, validCharacter } = require('./helpers');

test('правила: проверка данных персонажа', () => {
  Rules.configure({ startPoints: 12, startStatCap: 6, companionsMax: 11, maxScars: 3 });
  const ok = Rules.validateNew(validCharacter());
  assert.equal(ok.ok, true, ok.errors.join('; '));
  assert.equal(ok.value.unspentPoints, 1);

  const bad = (mutate) => { const c = validCharacter(); mutate(c); return Rules.validateNew(c); };
  assert.equal(bad((c) => { c.name = 'Б'; }).ok, false);
  assert.equal(bad((c) => { c.name = '1abc'; }).ok, false);
  assert.equal(bad((c) => { c.stats.strength = 0; }).ok, false, 'минимум 1');
  assert.equal(bad((c) => { c.stats.magic = 2.5; }).ok, false, 'только целые');
  assert.equal(bad((c) => { delete c.stats.taming; }).ok, false, 'все 11 характеристик обязательны');
  assert.equal(bad((c) => { c.stats.companions = 7; }).ok, false, 'предел при создании');
  assert.equal(bad((c) => { for (const k of Object.keys(c.stats)) c.stats[k] = 3; }).ok, false, 'слишком много очков');
  assert.equal(bad((c) => { c.appearance.hair = 'afro'; }).ok, false);
  assert.equal(bad((c) => { c.appearance.gender = 'other'; }).ok, false);
  assert.equal(bad((c) => { c.appearance.implants = ['eye', 'eye']; }).ok, false, 'без повторов');
  assert.equal(bad((c) => { c.appearance.scars = ['cheek', 'eye', 'lip', 'chest']; }).ok, false, 'лимит шрамов');
  assert.equal(Rules.validateNew(null).ok, false);
  // 12-я характеристика «Количество лавок» (shops): у старых героев без неё — 1
  assert.equal(Rules.STATS.length, 12);
  assert.equal(bad((c) => { delete c.stats.shops; }).value?.stats.shops ?? 1, 1);
  assert.equal(Rules.statCap('companions', false), 11);
});

test('правила: штраф за смерть не опускает характеристики ниже 1', () => {
  const stats = Object.fromEntries(Rules.STATS.map((s) => [s.id, 1]));
  assert.equal(Rules.applyDeathPenalty(stats), null);
  stats.magic = 2;
  assert.equal(Rules.applyDeathPenalty(stats), 'magic');
  assert.equal(stats.magic, 1);
});

test('персонажи: создание, список, получение, удаление', async (t) => {
  const s = await startServer(['--set', 'game.maxCharacters=3']);
  t.after(() => s.stop());
  const b = s.base;
  const a = (await api(b, 'POST', '/api/register', { username: 'owner', password: 'secret123' })).data.token;
  const other = (await api(b, 'POST', '/api/register', { username: 'other', password: 'secret123' })).data.token;

  assert.equal((await api(b, 'GET', '/api/characters')).status, 401);
  assert.deepEqual((await api(b, 'GET', '/api/characters', undefined, a)).data.characters, []);

  const c = await api(b, 'POST', '/api/characters', validCharacter(), a);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const ch = c.data.character;
  assert.equal(ch.level, 1);
  assert.equal(ch.unspentPoints, 1);
  assert.equal(ch.lastWorld, null, 'персонаж не привязан к миру');
  assert.equal(ch.inventory.equipment.underwear.id, 'underwear_base', 'бельё всегда надето');
  assert.deepEqual(Object.keys(ch.vitals), ['hp', 'stamina', 'mp']);
  assert.ok(Array.isArray(ch.companions) && Array.isArray(ch.inventory.cells) && ch.inventory.hotbar.length === 10);

  // файл персонажей хранится отдельно, по аккаунту
  const files = fs.readdirSync(path.join(s.dataDir, 'characters'));
  assert.equal(files.length, 1);
  assert.equal(files[0], ch.accountId + '.json');

  assert.equal((await api(b, 'POST', '/api/characters', validCharacter('АЙРА РЖАВАЯ'), a)).status, 409, 'имя уникально в аккаунте');
  const invalid = await api(b, 'POST', '/api/characters', { ...validCharacter('Кто-то'), stats: {} }, a);
  assert.equal(invalid.status, 400);
  assert.ok(invalid.data.errors.length >= 11);

  assert.equal((await api(b, 'GET', '/api/characters/' + ch.id, undefined, a)).data.character.name, 'Айра Ржавая');
  assert.equal((await api(b, 'GET', '/api/characters/' + ch.id, undefined, other)).status, 404, 'чужой персонаж недоступен');
  assert.equal((await api(b, 'DELETE', '/api/characters/' + ch.id, undefined, other)).status, 404);
  assert.deepEqual((await api(b, 'GET', '/api/characters', undefined, other)).data.characters, []);

  // лимит персонажей из настроек
  assert.equal((await api(b, 'POST', '/api/characters', validCharacter('Второй'), a)).status, 200);
  assert.equal((await api(b, 'POST', '/api/characters', validCharacter('Третий'), a)).status, 200);
  const over = await api(b, 'POST', '/api/characters', validCharacter('Четвёртый'), a);
  assert.equal(over.status, 400);
  assert.match(over.data.error, /Не больше 3/);

  assert.equal((await api(b, 'DELETE', '/api/characters/' + ch.id, undefined, a)).status, 200);
  assert.equal((await api(b, 'DELETE', '/api/characters/' + ch.id, undefined, a)).status, 404);
  const names = (await api(b, 'GET', '/api/characters', undefined, a)).data.characters.map((x) => x.name);
  assert.deepEqual(names, ['Второй', 'Третий']);
});

test('персонажи: стартовые очки берутся из настроек сервера', async (t) => {
  const s = await startServer(['--set', 'game.startPoints=2']);
  t.after(() => s.stop());
  const a = (await api(s.base, 'POST', '/api/register', { username: 'owner', password: 'secret123' })).data.token;
  const r = await api(s.base, 'POST', '/api/characters', validCharacter(), a);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /доступно \(2\)/);
});
