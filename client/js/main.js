import {initTooltipSettings,setTooltipProfile} from './tooltip-settings.js';
// Точка входа клиента: переключение экранов, вход и регистрация.
import { Api, session } from './api.js';
import { initCharacters, openList } from './characters.js';
import { initHelp } from './help.js';
import { initWorlds } from './worlds.js';
import { initGame } from './game/game.js';
import { initAccessibility } from './accessibility.js';
import { initButtonIcons } from './button-icons.js';

const $ = (sel) => document.querySelector(sel);
const state = { mode: 'login', account: null };
initAccessibility();
initTooltipSettings();
initButtonIcons();

function show(id) {
  document.body.classList.toggle('in-game', id === 'screen-game'); // фон-арт только в меню (шаг 19)
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
}

// ---------- Вход / регистрация ----------

const form = $('#auth-form');
const errorBox = $('#auth-error');
const submitBtn = $('#auth-submit');

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  const reg = mode === 'register';
  form.querySelector('.confirm').classList.toggle('hidden', !reg);
  form.password2.required = reg;
  form.password.autocomplete = reg ? 'new-password' : 'current-password';
  submitBtn.textContent = reg ? 'Создать аккаунт' : 'Войти';
  errorBox.textContent = '';
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.textContent = '';
  const username = form.username.value.trim();
  const password = form.password.value;
  if (state.mode === 'register' && password !== form.password2.value) {
    errorBox.textContent = 'Пароли не совпадают.';
    return;
  }
  submitBtn.disabled = true;
  try {
    const res = state.mode === 'register'
      ? await Api.register(username, password)
      : await Api.login(username, password);
    session.token = res.token;
    form.reset();
    enterHome(res.account);
  } catch (err) {
    errorBox.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------- После входа: список персонажей ----------

function enterHome(account) {
  state.account = account;
  setTooltipProfile(account.id);
  $('#home-username').textContent = account.username;
  $('#home-role').classList.toggle('hidden', account.role !== 'admin');
  openList();
}

initCharacters(show);
initWorlds(show, () => openList());
initGame(show);
initHelp();

$('#btn-logout').addEventListener('click', async () => {
  try { await Api.logout(); } catch { /* сессия уже недействительна */ }
  session.token = null;
  state.account = null;
  setTooltipProfile('');
  setMode('login');
  show('screen-auth');
});

// ---------- Старт ----------

// Настройки сервера: лимиты имени/пароля, стартовые очки и т. п.
async function applyServerConfig() {
  try {
    const cfg = await Api.config();
    window.CharacterRules.configure(cfg.game);
    window.WorldGen.configure(cfg.game);
    window.Movement.configure(cfg.game);
    window.Inventory.configure(cfg.game);
    window.Combat.configure(cfg.game);
    window.Enemies.configure(cfg.game);
    if (window.Survival) window.Survival.configure(cfg.game);
    if (window.Companions) window.Companions.configure(cfg.game);
    if (window.Magic) window.Magic.configure(cfg.game);
    if (window.Building) window.Building.configure(cfg.game);
    if (window.Fog) window.Fog.configure(cfg.game); // шаг 22: туман войны
    if (window.Camera) window.Camera.configure(cfg.game); // шаг 22: камера
    if (window.Crafting) window.Crafting.configure(cfg.game);
    if (window.Houses) window.Houses.configure(cfg.game); // дома с интерьерами
    if (window.Levels) window.Levels.configure(cfg.game);
    if (window.Vehicles) window.Vehicles.configure(cfg.game);
    if (window.Settlements) window.Settlements.configure(cfg.game);
    if (window.Factions) window.Factions.configure(cfg.game);
    if (window.Quests) window.Quests.configure(cfg.game);
    if (window.Family) window.Family.configure(cfg.game);
    if (window.Voice) window.Voice.configure(cfg.game);
    if (window.Art) window.Art.configure(cfg.game);
    window.GameSettings = cfg.game;
    window.NetSettings = cfg.net || {};
    const { usernameMin: umin, usernameMax: umax, passwordMin: pmin, passwordMax: pmax } = cfg.auth;
    Object.assign(form.username, { minLength: umin, maxLength: umax, pattern: `[A-Za-zА-Яа-яЁё0-9_\\-]{${umin},${umax}}`,
      title: `${umin}–${umax} символов: буквы, цифры, «_» или «-»` });
    for (const f of [form.password, form.password2]) Object.assign(f, { minLength: pmin, maxLength: pmax, title: `От ${pmin} до ${pmax} символов` });
  } catch { /* останутся значения по умолчанию; сервер всё равно проверит */ }
}

async function boot() {
  await applyServerConfig();
  if (session.token) {
    try {
      const { account } = await Api.me();
      return enterHome(account);
    } catch {
      session.token = null;
    }
  }
  setMode('login');
  show('screen-auth');
}

boot();
