import {tooltipSettings} from '../tooltip-settings.js';
// Игровой экран: цикл, ввод (клик / WASD / колесо), HUD, миникарта, меню Esc, совместная игра.
// Движение авторитетно на сервере: клиент отправляет намерения (путь или направление) по WebSocket
// и сразу предсказывает движение тем же общим кодом (shared/movement.js); расхождения исправляются по данным сервера.
// Других игроков клиент рисует с интерполяцией между снимками сервера.
// Бой (враги, атаки, эффекты) — в combat-view.js, окно персонажа и экран смерти — в stats-ui.js.
import { initSceneryView } from './scenery-view.js';
import { Api } from '../api.js';
import { corpseClear, corpseWelcome, corpseMessage, corpseScene, corpseAttach, corpseDetach, corpseHit, corpseInit, corpseOpen } from './corpses-ui.js';
import { Net } from '../net.js';
import { PAN_KEYS, KEY_DIRS, panKeyFor, moveKey } from './keymap.js';
import { initChat, chatAttach, chatDetach, chatHandleKey, chatOnWelcome, chatOnMessage } from '../chat.js';
import { renderMinimapImage } from './render.js';
import { minimapMatrix, minimapWorldPoint } from './minimap-math.js';
import { commerceInit, commerceAttach, commerceDetach, commerceMessage, commerceScene, commerceClick, commerceMinimap, commerceIsOpen, commerceToggle } from './commerce-ui.js';
import { initInventory, invAttach, invDetach, invOnMessage, invToggle, invIsOpen, hotkey } from '../inventory-ui.js';
import {
  combatAttach, combatDetach, combatOnWelcome, combatOnState, combatBusy, combatOnMessage, combatUpdate, combatScene, combatMouseDown,
  combatMouseMove, combatHover, combatMouseUp, combatShift, combatCancel, combatTarget, combatWeapon,
  combatSetCompLookup, combatEnemies, combatAutoToggle, combatKey,
} from './combat-view.js';
import { questsAttach, questsOnWelcome, questsOnMessage, questsKey, questsFrame } from './quests-ui.js';
import { famAttach, famOnWelcome, famOnMessage, famKey, famScene } from './family-ui.js';
import { createRenderer, loadGfx, saveGfx, artParticles } from './art.js';
import { FrameGovernor, watchBattery, overlayText } from './perf.js';
import { voiceAttach, voiceOnWelcome, voiceOnMessage, voiceKey, voiceKeyUp, voiceBlur, voiceLeaveWorld } from './voice.js';
import { magicFieldsScene, magicSlipperyAt, magicFieldsWelcome, magicViewRange, magicSpeedMul, magicAttach, magicDetach, magicOnMessage, magicCast, magicKey, magicFrame, spellTip, spellIcon } from './magic-ui.js';
import { compAttach, compDetach, compOnWelcome, compOnState, compOnMessage, compKey, compScene, compSpeedMul, compLookup, compControlled, compHover } from './companions-ui.js';
import { baseAttach, baseDetach, baseOnWelcome, baseOnMessage, baseKey, baseClick, baseMode, baseScene, baseOnInventory, baseHover } from './base-ui.js';
import { levelsAttach, levelsOnWelcome, levelsOnMessage, levelsKey, levelsFrame, levelsMinimap, levelMap, levelMarkers, levelsState } from './levels-ui.js';
import { stlAttach, stlOnWelcome, stlOnMessage, stlOnState, stlKey, stlClick, stlFrame, stlScene, stlLookup, stlWhere, stlIsOpen, stlClose, stlHover } from './settlements-ui.js';
import { vehAttach, vehOnWelcome, vehOnMessage, vehKey, vehFrame, vehScene, vehSeat, vehMinimap, vehSpeedMul, vehInit, vehHover } from './vehicles-ui.js';
import { survivalAttach, survivalDetach, survivalOnWelcome, survivalOnMessage, survivalKey, survivalDraw, survivalSpeedMul } from './survival-ui.js';
import { initAdmin, adminAttach, adminDetach, adminToggle, adminIsOpen, adminCanOpen, adminMapClick, adminOnGod } from '../admin-ui.js';
import { initCheats, cheatAttach, cheatDetach, cheatToggle, cheatIsOpen, cheatsCanOpen, cheatMapClick, cheatOnMsg, cheatOnGod, cheatCancelPick, cheatKey } from '../cheat-ui.js';
import { weAttach, weDetach, weOnWelcome, weOnMessage, weScene, weClick } from './worldedit-ui.js';
import { fogOnWelcome, fogOnMessage, fogFrame, fogBind, fogDetach, fogSetOff, fogMinimap, fogKnown, fogSee, fogState } from './fog-ui.js';
import { initStatsUi, statsAttach, statsDetach, statsToggle, statsIsOpen, statsRender, showDeath, hideDeath } from '../stats-ui.js';
import { initFloatingPanels, restoreAllPanels, restorePanel, revealAdminPanels, closeTopmostPanel } from '../floating-window.js';

const G = window.WorldGen;
const M = window.Movement;
const R = window.CharacterRules;
const $ = (sel) => document.querySelector(sel);
const colorOf = (group, id) => (R.APPEARANCE[group].find((o) => o.id === id) || R.APPEARANCE[group][0]).color;
const cfg = () => window.GameSettings || {};
const P = window.Protocol;
const Inv = window.Inventory;
const Items = window.Items;

let game = null; // текущая сессия
let gmChordArmedUntil = 0;

function savedZoom(key, fallback, min, max) {
  try {
    const value = Number(localStorage.getItem(key));
    if (Number.isFinite(value) && value > 0) return Math.max(min, Math.min(max, value));
  } catch { /* Настройки работают и при недоступном хранилище. */ }
  return Math.max(min, Math.min(max, fallback));
}
function storeZoom(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* Текущий масштаб остаётся доступен. */ }
}

export function initGame(showScreen) {
  game = null;
  initGame.show = showScreen;
  initSceneryView(()=>game?.renderer);
  // кнопки меню и хотбар создаются один раз
  const bar = $('#hotbar');
  for (let i = 1; i <= 10; i++) {
    const key = i % 10;
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.key = String(key);
    slot.innerHTML = `<span class="slot-key">${key}</span>`;
    bar.append(slot);
  }
  $('#btn-menu-continue').addEventListener('click', () => toggleMenu(false));
  $('#btn-menu-help').addEventListener('click', () => { toggleMenu(false); $('#btn-help').click(); });
  $('#btn-panels-reset').addEventListener('click', () => { restoreAllPanels(); toast('Расположение и вид панелей восстановлены.', 2200); });
  $('#btn-menu-exit').addEventListener('click', () => exitGame());
  $('#btn-menu-save').addEventListener('click', () => { if (game) { game.net.send({ t: 'save' }); $('#btn-menu-save').disabled = true; } });
  $('#btn-corpse-apply').addEventListener('click', () => { if (game) game.net.send({ t: 'corpse-settings', seconds: Number($('#corpse-lifetime').value) }); });
  $('#btn-spawn-apply').addEventListener('click', () => { if (game) game.net.send({ t: 'spawn-settings', enemyRespawnSec: Number($('#enemy-respawn-sec').value), enemyPopulation: Number($('#enemy-population').value) }); });
  $('#btn-difficulty-apply').addEventListener('click', () => { if (game) game.net.send({ t: 'difficulty-settings', difficulty: $('#server-difficulty').value, groundItemTtlSec: Number($('#ground-item-ttl').value), corpseLifetimeSec: Number($('#corpse-lifetime').value), enemyRespawnSec: Number($('#enemy-respawn-sec').value), enemyPopulation: Number($('#enemy-population').value), settlementNpcRespawnSec: Number($('#story-npc-respawn-sec').value), questItemRespawnSec: Number($('#story-item-respawn-sec').value) }); });
  $('#server-difficulty').replaceChildren(...window.Difficulty.MODES.map(x => new Option(x.label, x.id)));
  $('#btn-game-menu').addEventListener('click', () => toggleMenu(true));
  // графика (шаги 19–20): рендер (при следующем входе), качество, FPS, батарея, автокачество, оверлей — сразу
  const selR = $('#gfx-renderer'), selQ = $('#gfx-quality'), selF = $('#gfx-fps');
  if (selR && selQ) {
    syncGfxMenu();
    const onGfx = (what) => {
      saveGfx({ ...loadGfx(), renderer: selR.value, quality: selQ.value, fps: Number(selF.value), battery: $('#gfx-battery').checked, auto: $('#gfx-auto').checked, overlay: $('#gfx-overlay').checked, edge: $('#gfx-edge').checked, arrows: $('#gfx-arrows').checked });
      if (what === 'r' && game) toast('Рендер сменится при следующем входе в мир.', 2500);
      applyGfx();
    };
    selR.addEventListener('change', () => onGfx('r'));
    for (const id of ['#gfx-quality', '#gfx-fps', '#gfx-battery', '#gfx-auto', '#gfx-overlay', '#gfx-edge', '#gfx-arrows']) $(id).addEventListener('change', () => onGfx('x'));
  }
  watchBattery((on) => { // шаг 20: от батареи — низкое качество и 30 FPS (если экономия включена)
    const was = perf.onBattery;
    perf.onBattery = on;
    if (game && was !== on && loadGfx().battery) toast(on ? 'Работа от батареи: качество «низкое», 30 FPS (Меню → Экономия батареи).' : 'Зарядка подключена: обычные настройки графики.', 3000);
    applyGfx();
  });
  $('#btn-net-exit').addEventListener('click', () => exitGame());
  initChat();
  initInventory();
  $('#auto-combat-controls').addEventListener('click', (e) => {
    const button=e.target.closest('[data-auto-combat]');
    if(button)combatAutoToggle(button.dataset.autoCombat);
  });
  initStatsUi();
  vehInit();
  initAdmin();
  initCheats();
  commerceInit();
  corpseInit();
  const placeCompactPanels = () => {
    const hud = $('#hud-top').getBoundingClientRect();
    const top = Math.max(8, Math.min(Math.max(250, hud.bottom + 8), innerHeight - 140));
    document.documentElement.style.setProperty('--comp-top', top + 'px');
  };
  const compactPanels = new ResizeObserver(placeCompactPanels);
  compactPanels.observe($('#hud-top'));
  window.addEventListener('resize', placeCompactPanels);
  window.addEventListener('ui-layout-change', placeCompactPanels);
}

// ---------- Шаг 20: кадры, батарея, автокачество, оверлей F8 ----------
const perf = { onBattery: false, eff: null, srv: null, ping: null, pingAt: 0, textAt: 0, autoAt: 0 };
function syncGfxMenu() {
  const g = loadGfx();
  $('#gfx-renderer').value = g.renderer; $('#gfx-quality').value = g.quality; $('#gfx-fps').value = String(g.fps);
  $('#gfx-battery').checked = g.battery; $('#gfx-auto').checked = g.auto; $('#gfx-overlay').checked = g.overlay; $('#gfx-edge').checked = Boolean(g.edge); $('#gfx-arrows').checked = g.arrows !== false;
}
// Применить настройки графики к текущей игре (с учётом батареи)
function applyGfx() {
  if (!game || !window.Art) return;
  const eff = window.Art.effectiveGfx(loadGfx(), perf.onBattery), old = perf.eff;
  perf.eff = eff;
  game.gov.setCap(eff.fps);
  game.gov.autoFps = eff.auto ? (cfg().autoQualityFps ?? 24) : 0;
  if (!old || old.quality !== eff.quality) game.renderer.setQuality(eff.quality);
  game.edgeScroll = Boolean(eff.edge); // шаг 22: прокрутка у края экрана
  game.arrowsPan = eff.arrows !== false; // стрелки — камера, WASD — герой
  const overlay = $('#perf-overlay');
  if (eff.overlay && (!old || old.overlay !== eff.overlay)) restorePanel('perf-overlay');
  overlay.classList.toggle('hidden', !eff.overlay || Boolean(overlay.dataset.panelClosed));
}
function perfFrame(now) {
  const gov = game.gov, eff = perf.eff;
  if (!eff) return;
  if (now - perf.autoAt > 1000) { // автокачество
    perf.autoAt = now;
    const q = !eff.saver && gov.autoCheck(now, eff.quality, window.Art.lowerQuality);
    if (q) { saveGfx({ ...loadGfx(), quality: q }); syncGfxMenu(); applyGfx(); toast(`Мало кадров в секунду — качество снижено до «${window.Art.QUALITY[q].name.toLowerCase()}» (Меню → Качество, «Автокачество»).`, 4000); }
  }
  if (!eff.overlay) return;
  if (now - perf.pingAt > 2000) { perf.pingAt = now; game.net.send({ t: 'perf', echo: performance.now() }); }
  if (now - perf.textAt > 500) {
    perf.textAt = now;
    $('#perf-overlay-content').textContent = overlayText({ fps: gov.fps(), cap: gov.target(now), idle: gov.idle(now), frameMs: gov.frameMs(), ping: perf.ping, srv: perf.srv, quality: window.Art.QUALITY[eff.quality].name.toLowerCase(), saver: eff.saver, chunks: game.renderer.lastStats.groundChunks });
  }
}
function toggleOverlay() {
  saveGfx({ ...loadGfx(), overlay: !loadGfx().overlay });
  syncGfxMenu(); applyGfx();
}

function toast(text, ms = 1800) {
  const t = $('#game-toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

export function heroColors(a) {
  const skin = colorOf('skin', a.skin), metal = '#8d949c';
  return {
    skin,
    hair: a.hair === 'bald' ? null : colorOf('hairColor', a.hairColor),
    longHair: ['long', 'braids', 'dreads', 'ponytail'].includes(a.hair),
    underwear: colorOf('underwear', a.underwear),
    legs: (a.implants || []).includes('legs') ? metal : skin,
    armL: (a.implants || []).includes('armLeft') ? metal : skin,
    armR: (a.implants || []).includes('armRight') ? metal : skin,
    cyberEye: (a.implants || []).includes('eye'),
    female: a.gender === 'female',
    wide: a.body === 'muscular' || a.body === 'heavy',
    body: a.body, beard: a.beard && a.beard !== 'none', scar: Boolean(a.scars && a.scars.length), mohawk: a.hair === 'mohawk',
    face: a.face, eyes: colorOf('eyes',a.eyes), hairStyle: a.hair, scars: a.scars || [], tattoos: a.tattoos || [], implants: a.implants || [],
  };
}

export async function enterGame(characterStub, worldRecord, { onExit } = {}) {
  initGame.show('screen-game');
  const loading = $('#game-loading');
  loading.classList.remove('hidden');
  $('#game-loading-text').textContent = `Генерация мира «${worldRecord.name}»...`;
  await new Promise((r) => setTimeout(r, 30)); // дать браузеру показать надпись

  let character, world, map;
  try {
    character = (await Api.getCharacter(characterStub.id)).character;
    world = (await Api.getWorld(worldRecord.id)).world;
    map = G.generate(world);
  } catch (err) {
    loading.classList.add('hidden');
    alert(err.message);
    return onExit && onExit();
  }
  initFloatingPanels(character.id);
  if (world.mapHash && G.mapHash(map) !== world.mapHash) {
    console.warn('Контрольная сумма карты не совпадает с серверной', G.mapHash(map), world.mapHash);
    toast('Внимание: карта отличается от серверной (разные версии генератора?)', 5000);
  }

  const canvas = $('#game-canvas');
  const s = cfg();
  const renderer = createRenderer(canvas, map, { // художественный или простой рендер (шаг 19, настройка в меню)
    tileWidth: s.tileWidth || 64, zoom: savedZoom('rpg.cameraZoom', s.zoomDefault || 1, s.zoomMin || 0.35, s.zoomMax || 2.5),
    chunkSize: s.renderChunkSize, cacheBelowZoom: s.renderCacheBelowZoom, cacheMaxChunks: s.renderCacheMaxChunks,
  });
  map.swimmer = true; // герой плавает по воде (шаг 13) — так же, как считает сервер
  const markers = new Map(levelMarkers(map, null)); // входы в подземелья и на высоты (шаг 13)
  for (const st of map.settlements) markers.set(st.x + ',' + st.y, { kind: 'settlement', label: `${st.name} (${st.typeName.toLowerCase()})` });
  for (const l of map.lairs) markers.set(l.x + ',' + l.y, { kind: 'lair', label: l.name });
  for (const d of map.depots || []) markers.set(d.x + ',' + d.y, { kind: 'depot', label: 'Военный склад' });
  renderer.markersRef = markers;

  const spawn = { x: map.spawn.x + 0.5, y: map.spawn.y + 0.5 };
  game = {
    character, world, map, renderer, markers, onExit, groundMap: map, groundMarkers: markers, levelKey: null,
    grid: M.gridFromWorld(map),
    hero: { ...spawn, name: character.name, moving: false, colors: heroColors(character.appearance), look: Inv.look(character) },
    ground: new Map(), // gid -> предмет на земле
    pendingPickup: null, // gid предмета, к которому идём, чтобы поднять
    path: [], target: null, correction: null,
    keys: new Set(), sentDir: { dx: 0, dy: 0 },
    camera: window.Camera.create({ x: spawn.x, y: spawn.y, w: map.width, h: map.height }), panKeys: {}, mouseScreen: null, drag: null, miniDrag: false, edgeScroll: false, arrowsPan: true, // шаг 22: камера
    others: new Map(), // id -> { info, colors, snaps: [{ t, x, y, m }], x, y, moving }
    you: null,
    running: false,
    minimap: renderMinimapImage(map), miniZoom: savedZoom('rpg.minimapZoom', 1, 1, 8),
    listeners: [],
    welcomed: false,
  };
  const g = game;
  combatAttach({
    getCharacter: () => g.character, getHero: () => g.hero, getOthers: () => g.others, you: () => g.you,
    send: (m) => g.net.send(m), toast, renderer: () => g.renderer,
    moveTo: (x, y) => moveTo(x, y, { quiet: true, keepCombat: true }), stop: () => stopMoving(), isMoving: () => g.path.length > 0, controlled:()=>compControlled(),
  });
  renderer.groundOnTop = s.groundOnTopRadius;

  // Подключение к миру; первый вход ждём, дальше — переподключения в фоне
  $('#game-loading-text').textContent = `Подключение к миру «${world.name}»...`;
  const firstWelcome = new Promise((resolve) => { g.resolveWelcome = resolve; });
  g.net = new Net({
    worldId: world.id, characterId: character.id, settings: s, wsPath: (window.NetSettings || {}).wsPath,
    onMessage: (msg) => { if (game === g) onNetMessage(msg); },
    onStatus: (status, info) => { if (game === g) onNetStatus(status, info); },
  });
  chatAttach(g.net);
  g.net.connect();
  const ok = await firstWelcome;
  if (!ok || game !== g) return;

  setupHud(character);
  renderer.resize();
  bind(window, 'resize', () => renderer.resize());
  bind(window, 'keydown', onKeyDown);
  bind(window, 'keyup', onKeyUp);
  bind(window, 'blur', () => { game.keys.clear(); game.panKeys = {}; game.drag = null; combatShift(false); combatMouseUp(); setSprint(false); });
  bind(document, 'visibilitychange', () => { if (document.hidden) game.keys.clear(); });
  bind(canvas, 'mousedown', onCanvasClick);
  bind(canvas, 'mousemove', (e) => {
    const rc = canvas.getBoundingClientRect();
    const sx = e.clientX - rc.left, sy = e.clientY - rc.top;
    if (game.drag) { game.camera.panScreen(game.drag.x - sx, game.drag.y - sy, renderer.hw, renderer.hh); game.drag = { x: sx, y: sy }; } // средняя кнопка — тащить обзор
    game.mouseScreen = { x: sx, y: sy };
    combatMouseMove(sx, sy);
    game.mouseWorld = renderer.toWorld(sx, sy);
    if(!tooltipSettings().enabled)return;
    const companion=compHover(sx,sy,renderer),enemy=combatHover(),w=game.mouseWorld;
    const index=Math.floor(w.y)*game.map.width+Math.floor(w.x),biome=window.WorldGen.BIOMES[game.map.tiles[index]];
    let info=null;
    for(const it of game.ground.values()){const p=renderer.toScreen(it.x,it.y);if(Math.hypot(p.x-sx,p.y-renderer.hh*.45-sy)<Math.max(14,renderer.hh*.9)){const item=window.Items.get(it.id||it.item);if(item)info={text:`${item.name} · предмет на земле · щелчок рядом — подобрать`,topic:'item:'+item.id,key:'loot:'+it.gid};break;}}
    if(!info&&companion)info={text:`${companion.name} · уровень ${companion.lvl} · H — команда; T рядом — вернуть исключённого союзника`,topic:'h-companions',key:companion.id};
    if(!info&&enemy)info={text:`${enemy.def.name} · уровень ${enemy.lvl||enemy.def.level?.[0]||1}`,topic:'enemy:'+enemy.def.id,key:enemy.id};
    const corpse=!info&&corpseHit(sx,sy,renderer);if(corpse)info={text:'Труп: щелчок рядом — осмотреть и забрать вещи. Можно положить вещи: они исчезнут вместе с трупом.',topic:'h-death',key:'corpse:'+corpse.id};
    const vehicle=!info&&vehHover(sx,sy,renderer);if(vehicle){const def=window.Vehicles.get(vehicle.def);info={text:`${def.name} · Y — сесть или выйти, Shift+Y — управление и обслуживание`,topic:'vehicle:'+def.id,key:'vehicle:'+vehicle.id};}
    if(!info){for(const actor of [game.hero,...game.others.values()]){const p=renderer.toScreen(actor.x,actor.y);if(Math.abs(p.x-sx)<renderer.hh&&sy>p.y-renderer.hh*3.5&&sy<p.y+renderer.hh*.3){info={text:actor.name+' · герой; I — снаряжение, C — характеристики',topic:'h-stats',key:actor.name};break;}}}
    if(!info)info=stlHover(sx,sy,renderer)||baseHover(w.x,w.y);
    if(!info&&biome)info={text:`${biome.name} · ${biome.hint||''}`,topic:'h-biomes',key:biome.key};
    window.dispatchEvent(new CustomEvent('rpg-world-tooltip',{detail:{canvas,...info,x:e.clientX,y:e.clientY}}));
  });
  bind(canvas, 'mouseleave', () => { game.mouseScreen = null; });
  bind(window, 'mouseup', () => { combatMouseUp(); game.drag = null; game.miniDrag = false; });
  bind(window, 'mousemove', (e) => { if (game.miniDrag) minimapLook(e); });
  bind($('#btn-cam-follow'), 'click', () => camToggle());
  bind($('#btn-cam-center'), 'click', () => camCenter());
  bind($('#minimap'), 'contextmenu', (e) => e.preventDefault());
  bind(canvas, 'wheel', onWheel, { passive: false });
  bind(canvas, 'contextmenu', (e) => e.preventDefault());
  bind($('#minimap'), 'mousedown', onMinimapClick);
  bind($('#btn-mini-minus'), 'click', () => miniZoom(-1));
  bind($('#btn-mini-plus'), 'click', () => miniZoom(1));
  bind($('#btn-mini-reset'), 'click', () => miniZoom(0));
  bind($('#minimap'), 'wheel', (e) => { e.preventDefault(); miniZoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  bind(window, 'beforeunload', () => { if (game) game.net.close(); });
  bind(window, 'blur', () => voiceBlur()); // окно потеряло фокус — рация отпускается
  bind(window, 'pagehide', () => { if (game) game.net.close(); }); // мобильные браузеры и кэш страниц не всегда шлют beforeunload

  loading.classList.add('hidden');
  toggleMenu(false);
  const saved = character.positions && character.positions[world.id];
  toast(saved ? 'С возвращением! Вы там, где остановились.' : 'Вы прибыли в новый мир. F1 — справка.', 2500);
  g.running = true;
  // шаг 20: ограничение FPS, простой, батарея, автокачество
  g.gov = new FrameGovernor({ cap: 60, idleFps: cfg().fpsIdle ?? 20, idleAfterSec: cfg().idleAfterSec ?? 3, autoFps: cfg().autoQualityFps ?? 24 });
  perf.eff = null; perf.srv = null; perf.ping = null;
  applyGfx();
  for (const ev of ['keydown', 'mousemove', 'mousedown', 'wheel']) bind(window, ev, () => { if (game) game.gov.touch(performance.now()); }, { passive: true });
  let last = performance.now();
  const frame = (now) => {
    if (!game || !game.running) return;
    requestAnimationFrame(frame); // сразу: ошибка в кадре не останавливает цикл
    const gov = game.gov;
    if (compControlled()?.moving || game.keys.size || game.hero.moving || game.hero.stunUntil > now || game.hero.hurtAt && now - game.hero.hurtAt < 220 || game.hero.castUntil > now || game.hero.attackAt && now - game.hero.attackAt < 600 || game.drag || Object.values(game.panKeys).some(Boolean) || game.camera.x !== game.camera.tx || game.camera.y !== game.camera.ty || game.edgeScroll || combatBusy(game.hero) || artParticles().list.length || [...game.others.values()].some((o) => o.moving || o.stunUntil > now || o.hurtAt && now - o.hurtAt < 220 || o.attackAt && now - o.attackAt < 600 || o.castUntil > now)) gov.touch(now);
    if (document.hidden || !gov.shouldDraw(now)) return; // вкладка в фоне или ещё рано
    const t0 = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    update(dt);
    updateOthers(now);
    cameraFrame(dt); // шаг 22: слежение или свободный обзор
    fogFrame(game.hero, game.renderer);
    combatUpdate(dt, now);
    magicFrame(now);
    levelsFrame(now);
    vehFrame(now);
    stlFrame(now);
    questsFrame(now);
    game.renderer.draw({
      visibilityRange: Math.max(1,combatWeapon('main')?.prof.range||0,combatWeapon('off')?.prof.range||0,magicViewRange(),...(() => {const vehicle=vehSeat()&&window.Vehicles.get(vehSeat().def);return vehicle?[vehicle.weapon,vehicle.rearWeapon,vehicle.secondaryWeapon].filter(Boolean).map(w=>window.Combat.profile(window.Items.get(w.item)).range||0):[];})()),
      hero: game.hero, others: [...game.others.values()], target: game.target, markers: game.markers,
      ground: [...game.ground.values()], groundLabelRange: Inv.settings.pickupRange * 2, ...corpseScene(commerceScene(weScene(compScene(baseScene(famScene(stlScene(vehScene(withSurvival(magicFieldsScene(combatScene()))), game.renderer, now), game.renderer, now), game.renderer, game.mouseWorld, now), game.renderer, now), game.renderer, game.mouseWorld, now)), game.renderer),
    }, now);
    if (now - (game.miniAt || 0) > 200) { game.miniAt = now; drawMinimap(); } // миникарта — 5 раз в секунду
    if (now - (game.hudAt || 0) > 100) { game.hudAt = now; updateHud(); } // полоски HUD — 10 раз в секунду
    gov.drawn(now, performance.now() - t0);
    perfFrame(now);
  };
  requestAnimationFrame(frame);
}

// Слой выживания (радиация, костры, «Zz») — под эффектами боя
function withSurvival(scene) {
  const over = scene.overlay;
  return { ...scene, overlay: (r, t) => { survivalDraw(r, t, game.hero); if (over) over(r, t); } };
}

// ---------- Сеть ----------

function addOther(info) {
  if (info.id === game.you) return;
  game.others.set(info.id, {
    info, alt:info.a||0, buildElevation:info.be||0, id: info.id, name: info.name, admin: info.admin, colors: heroColors(info.appearance), look: info.look || {},
    x: info.x, y: info.y, moving: Boolean(info.m), dir: 1, snaps: [{ t: performance.now(), x: info.x, y: info.y, m: info.m }],
  });
}

// Сменить карту на уровень level (null — поверхность): рендер, сетка пути, миникарта, метки
function switchLevel(g, level) {
  const oldRegion=window.Regions?.parse(g.levelKey)?.key,newRegion=window.Regions?.parse(level?.key)?.key;
  if(oldRegion&&oldRegion!==newRegion)window.Levels.releaseRegion(g.groundMap,oldRegion);
  g.levelKey = level ? level.key : null;
  g.map = levelMap(g.groundMap, level);
  g.markers = level ? levelMarkers(g.groundMap, level) : g.groundMarkers;
  g.renderer.map = g.map;
  g.renderer.level = level?.surfaceRegion?null:level; // surface regions use outdoor lighting
  g.renderer.markersRef = g.markers;
  g.renderer.cache.clear();
  g.renderer.cacheKey = '';
  g.grid = M.gridFromWorld(g.map);
  g.minimap = renderMinimapImage(g.map);
  g.ground = new Map();
  g.path = []; g.target = null; g.pendingPickup = null;
  if (g.welcomed) toast(level ? `${level.name} (уровень ${window.Levels.zLabel(level.z)})` : 'Вы на поверхности.', 2500);
}

function onNetMessage(msg) {
  if (commerceMessage(msg)) return;
  if (corpseMessage(msg.t === 'corpse-add' && msg.corpse.appearance ? { ...msg, corpse: { ...msg.corpse, colors: heroColors(msg.corpse.appearance) } } : msg)) return;
  if (msg.t === 'corpse-error') { toast(msg.message); return; }
  if (msg.t === 'corpse-settings') { window.GameSettings.corpseLifetimeSec = msg.seconds; $('#corpse-lifetime').value = msg.seconds; toast(`Время трупов для всех игроков: ${msg.seconds} с.`); return; }
  if (msg.t === 'spawn-settings-error') { toast(msg.message); return; }
  if (msg.t === 'spawn-settings') {
    window.GameSettings.enemyRespawnSec = msg.enemyRespawnSec; window.GameSettings.enemyPopulation = msg.enemyPopulation;
    $('#enemy-respawn-sec').value = msg.enemyRespawnSec; $('#enemy-population').value = msg.enemyPopulation;
    document.querySelectorAll('[data-spawn-setting="enemyRespawnSec"]').forEach(x => x.value = msg.enemyRespawnSec);
    document.querySelectorAll('[data-spawn-setting="enemyPopulation"]').forEach(x => x.value = msg.enemyPopulation);
    toast(`Настройки спавна для всех: ${msg.enemyRespawnSec} с, цель ${msg.enemyPopulation} врагов ±10%.`); return;
  }
  if (msg.t === 'difficulty-settings-error') { toast(msg.message); return; }
  if (msg.t === 'difficulty-settings') {
    Object.assign(window.GameSettings, msg);
    $('#server-difficulty').value=msg.difficulty;
    $('#story-npc-respawn-sec').value = msg.settlementNpcRespawnSec ?? window.GameSettings.settlementNpcRespawnSec ?? 300;
    $('#story-item-respawn-sec').value = msg.questItemRespawnSec ?? window.GameSettings.questItemRespawnSec ?? 300;
    if(game)game.world.difficulty=msg.difficulty;
    window.Enemies.configure(window.GameSettings);
    document.querySelectorAll('[data-server-setting]').forEach(x => { if (Object.hasOwn(msg, x.dataset.serverSetting)) x.value = msg[x.dataset.serverSetting]; });
    toast(`Сложность мира: ${window.Difficulty.get(msg.difficulty).label}. Срок выпавших вещей: ${msg.groundItemTtlSec} с.`); return;
  }
  if (msg.t === 'fac' && game) game.character.factions = { ...msg.reps };
  const g = game;
  if (typeof msg.t === 'string' && msg.t.startsWith('cheat-') && cheatOnMsg(msg)) return; // чит-панель (шаг 20)
  switch (msg.t) {
    case 'welcome': {
      g.you = msg.you;
      corpseWelcome({ ...msg, corpses: (msg.corpses || []).map(c => c.appearance ? { ...c, colors: heroColors(c.appearance) } : c) });
      window.GameSettings.corpseLifetimeSec = msg.corpseLifetimeSec ?? 60;
      $('#corpse-lifetime').value = window.GameSettings.corpseLifetimeSec;
      if (msg.enemyRespawnSec != null) window.GameSettings.enemyRespawnSec = msg.enemyRespawnSec;
      if (msg.enemyPopulation != null) window.GameSettings.enemyPopulation = msg.enemyPopulation;
      $('#enemy-respawn-sec').value = window.GameSettings.enemyRespawnSec ?? 90;
      $('#enemy-population').value = window.GameSettings.enemyPopulation ?? 100;
      if (msg.difficulty != null) {window.GameSettings.difficulty=msg.difficulty;g.world.difficulty=msg.difficulty;window.Enemies.configure(window.GameSettings);}
      if (msg.groundItemTtlSec != null) window.GameSettings.groundItemTtlSec = msg.groundItemTtlSec;
      $('#server-difficulty').value = window.GameSettings.difficulty || 'normal';
      $('#ground-item-ttl').value = window.GameSettings.groundItemTtlSec ?? 7200;
      window.GameSettings.settlementNpcRespawnSec = msg.settlementNpcRespawnSec ?? 300;
      window.GameSettings.questItemRespawnSec = msg.questItemRespawnSec ?? 300;
      $('#story-npc-respawn-sec').value = window.GameSettings.settlementNpcRespawnSec;
      $('#story-item-respawn-sec').value = window.GameSettings.questItemRespawnSec;
      // вертикальный уровень (шаг 13): сервер перевёл героя на другой уровень — сменить карту
      if ((msg.level ? msg.level.key : null) !== g.levelKey) switchLevel(g, msg.level);
      levelsAttach({ send: (m) => g.net.send(m), toast, hero: () => g.hero, groundMap: () => g.groundMap, canFly:()=>!vehSeat()&&(!g.levelKey||g.map.surfaceRegion)&&window.Items.setEffects(g.character).fly, onAlt: (id, alt) => { alt=Math.max(0,alt); /* alt < 0 — в подлодке под водой: фигура не опускается */ if (id === g.you) {g.hero.alt=alt;if(!g.hero.mounted)g.map.flyer=window.Items.setEffects(g.character).fly&&alt>0;} else if (g.others.has(id)) g.others.get(id).alt = alt; } });
      levelsOnWelcome(msg);
      vehAttach({ send: (m) => g.net.send(m), toast, you: msg.you, map: () => g.map, hero: () => g.hero, others: () => g.others, character: () => g.character, god: () => g.god, refreshGrid: () => { g.grid = M.gridFromWorld(g.map); } });
      vehOnWelcome(msg);
      stlAttach({ send: (m) => g.net.send(m), toast, you: msg.you, map: () => g.map, hero: () => g.hero, character: () => g.character, refreshGrid: () => { g.grid = M.gridFromWorld(g.map); } });
      stlOnWelcome(msg);
      questsAttach({ send: (m) => g.net.send(m), toast, hero: () => g.hero, enemies: combatEnemies });
      questsOnWelcome(msg);
      famAttach({ send: (m) => g.net.send(m), toast, hero: () => g.hero });
      famOnWelcome(msg);
      voiceAttach({ send: (m) => g.net.send(m), toast, hero: () => g.hero, others: () => g.others });
      voiceOnWelcome(msg); // голосовой чат (шаг 18)
      g.others.clear();
      for (const pl of msg.players) {
        if (pl.id === msg.you) { // позиция героя — по данным сервера
          g.hero.x = pl.x; g.hero.y = pl.y;
          g.path = []; g.target = null; g.correction = null;g.hero.surfaceVelocity={vx:0,vy:0}; g.sentDir = { dx: 0, dy: 0 };
        } else addOther(pl);
      }
      // шаг 22: туман войны и камера (при входе в мир и на уровень — к герою)
      fogOnWelcome(msg, g.map);
      fogBind(g.renderer);
      fogSetOff(msg.god && msg.god.nofog);
      g.camera.setWorld(g.map.width, g.map.height);
      if (!g.welcomed) g.camera.follow = window.Camera.settings.cameraFollowDefault;
      g.camera.snap(g.hero);
      chatOnWelcome(msg.chat, msg.you);
      if (msg.inv) { g.character.inventory = msg.inv.inventory; g.character.vitals = msg.inv.vitals; g.character.autoLoot = msg.inv.autoLoot; }
      g.hero.look = Inv.look(g.character);
      commerceAttach({ send: m => g.net.send(m), toast, character: () => g.character, hero: () => g.hero, others: () => g.others, you: () => g.you }, msg.commerce);
      corpseAttach({ send: m => g.net.send(m), character: () => g.character, toast });
      g.ground = new Map((msg.ground || []).map((x) => [x.gid, x]));
      invAttach({
        getCharacter: () => g.character,
        send: (a) => { if(a.type==='use'){g.hero.actionAt=performance.now();g.hero.actionKind='consume';} g.net.send({t:'inv',a}); },
        toast,
        onChange: () => { g.hero.look = Inv.look(g.character); g.map.flyer = Boolean(g.hero.mounted && g.map.flyer) || window.Items.setEffects(g.character).fly && g.hero.alt>0; statsRender(); },
        place: (item) => placeItem(item),
        cast: (id) => magicCast(id), spellTip, spellIcon,
      });
      if (msg.fac) g.character.factions = { ...msg.fac }; combatOnWelcome(msg);
      survivalAttach({ send: (m) => g.net.send(m), toast });
      survivalOnWelcome(msg);
      baseAttach({ send: (m) => g.net.send(m), toast, you: g.you, map: g.map, hero: () => g.hero, character: () => g.character });
      baseOnWelcome(msg);
      weAttach({ send: (m) => g.net.send(m), toast, map: () => g.map, renderer: () => g.renderer });
      weOnWelcome(msg); // шаг 21: объекты стройки чит-панели
      compAttach({ send: (m) => g.net.send(m), toast, you: g.you, map: g.map, hero: () => g.hero, character: () => g.character, target: () => combatTarget(), mouse: () => g.mouseWorld });
      compOnWelcome(msg);
      combatSetCompLookup(compLookup, stlLookup);
      magicAttach({ send: (m) => g.net.send(m), toast, you: g.you, character: () => g.character, target: () => combatTarget(), mouse: () => g.mouseWorld, others: () => g.others, hero: () => g.hero, invSend: (a) => g.net.send({ t: 'inv', a }) });
      magicFieldsWelcome(msg.magicFields||[]);
      if (msg.me) applyMe(msg.me);
      statsAttach({ getCharacter: () => g.character, getMe: () => g.me, send: (m) => g.net.send(m) });
      hideDeath();
      $('#net-status').classList.add('hidden');
      // панель ГМ — только администратору (сервер всё равно проверяет роль)
      g.god = msg.god || {};
      cheatAttach({ allowed: Boolean(msg.cheats), send: (m) => g.net.send(m), toast, you: g.you, renderer: () => g.renderer, character: () => g.character });
      adminAttach({ isAdmin: Boolean((msg.players.find((p) => p.id === msg.you) || {}).admin), send: (m) => g.net.send(m), toast, worldId: msg.worldId, god: g.god });
      // «Сохранить» в меню — владельцу мира и администратору
      $('#btn-menu-save').classList.toggle('hidden', !(msg.owner || (msg.players.find((p) => p.id === msg.you) || {}).admin));
      $('#btn-menu-save').disabled = false;
      if (g.welcomed) toast('Связь восстановлена');
      g.welcomed = true;
      if (g.resolveWelcome) { g.resolveWelcome(true); g.resolveWelcome = null; }
      break;
    }
    case 'state': {
      const now = performance.now();
      for (const pl of msg.players) {
        if (pl.id === g.you) {
          g.hero.alt=pl.a||0;g.hero.buildElevation=pl.be||0;g.map.buildElevation=pl.be||0;g.hero.stealth=Boolean(pl.sh);
          g.hero.dead = Boolean(pl.d); g.hero.stunUntil = pl.st ? now + 120 : 0; g.hero.sprint = Boolean(g.me && g.me.sprint);
          reconcile(pl); continue;
        }
        const o = g.others.get(pl.id);
        if (!o) continue;
        o.buildElevation=pl.be||0;o.alt=pl.a||0;o.stealth=Boolean(pl.sh);
        o.hp = pl.h; o.dead = Boolean(pl.d); o.moving = Boolean(pl.m); o.stunUntil = pl.st ? now + 120 : 0;
        o.snaps.push({ t: now, x: pl.x, y: pl.y, m: pl.m });
        if (o.snaps.length > 30) o.snaps.shift();
      }
      combatOnState(msg.e);
      compOnState(msg.cp);
      stlOnState(msg.np, msg.sg);
      break;
    }
    case 'saved':
      $('#btn-menu-save').disabled = false;
      toast(msg.message, msg.ok ? 1800 : 3000);
      break;
    case 'join':
      addOther(msg.player);
      if (msg.level) toast(`${msg.player.name} приходит с другого уровня`);
      else if (!msg.quiet) toast(`${msg.player.name} (${msg.player.account}) входит в мир`);
      break;
    case 'lv': case 'lvl-reject': case 'lvl-alt':
      vehOnMessage(msg); // высота авиации — правила местности машины
      levelsOnMessage(msg);
      break;
    case 'npc-add': case 'npc-remove': case 'npc-talk': case 'npc-offer': case 'npc-say': case 'npc-reject': case 'stl-town': case 'fam-rel':
      stlOnMessage(msg);
      break;
    case 'vc-peers': case 'vc-join': case 'vc-leave': case 'vc-sig': case 'vc-speak': case 'vc-muted': case 'vc-unmuted': case 'vc-reject':
      voiceOnMessage(msg); // голосовой чат (шаг 18)
      break;
    case 'fam': case 'fam-ask': case 'fam-reject':
      famOnMessage(msg); // семья (шаг 17)
      break;
    case 'quests': case 'fac': case 'ending': case 'quest-reject':
      questsOnMessage(msg); // задания, фракции, концовки (шаг 16)
      break;
    case 'veh-upd': case 'veh-remove': case 'veh-seat': case 'veh-reject':
      vehOnMessage(msg);
      break;
    case 'teleported': // администратор переместил героя
      if (msg.id === g.you) {
        g.hero.x = msg.x; g.hero.y = msg.y;
        g.path = []; g.target = null; g.correction = null;g.hero.surfaceVelocity={vx:0,vy:0};
      } else if (g.others.has(msg.id)) {
        const o = g.others.get(msg.id);
        o.snaps = [{ t: performance.now(), x: msg.x, y: msg.y, m: 0 }];
        o.x = msg.x; o.y = msg.y;
      }
      break;
    case 'god':
      g.god = msg.god;
      fogSetOff(msg.god && msg.god.nofog); // чит «без тумана» (шаг 22)
      adminOnGod(msg.god);
      cheatOnGod(msg.god);
      break;
    case 'gm-err':
      toast(msg.message, 3000);
      break;
    case 'leave': {
      const o = g.others.get(msg.id);
      g.others.delete(msg.id);
      if (o && msg.reason === 'level') toast(`${msg.name} уходит на другой уровень`);
      else if (o && msg.reason !== 'hidden') toast(`${msg.name} покидает мир`);
      break;
    }
    case 'reject':
      g.hero.x = msg.x; g.hero.y = msg.y;
      g.path = []; g.target = null; g.correction = null;g.hero.surfaceVelocity={vx:0,vy:0};
      toast('Сервер отклонил движение: ' + msg.reason);
      break;
    case 'error':
      console.warn('[сеть]', msg.message);
      break;
    case 'perf': // шаг 20: ответ сервера для оверлея F8
      perf.srv = msg;
      if (typeof msg.echo === 'number') perf.ping = performance.now() - msg.echo;
      break;
    case 'chat':
      chatOnMessage(msg, g.you);
      break;
    case 'inv': case 'inv-error':
      invOnMessage(msg);
      baseOnInventory();
      break;
    case 'fog-reveal': case 'fog-merge':
      fogOnMessage(msg, g.renderer);
      break;
    case 'prop-add': case 'prop-remove': case 'prop-hide': case 'prop-err':
      weOnMessage(msg);
      break;
    case 'terrain-upd':
      if (g.map && Number.isInteger(msg.i) && msg.i >= 0 && msg.i < g.map.tiles.length) { g.map.tiles[msg.i] = msg.tile; g.renderer.terrainChanged(); }
      break;
    case 'bld-base': case 'bld-base-remove': case 'bld-add': case 'bld-upd': case 'bld-remove': case 'bld-reject':
    case 'node-upd': case 'gathered': case 'chest': case 'craft': case 'craft-reject':
      baseOnMessage(msg);
      break;
    case 'magic-field': case 'magic': case 'magic-learn': case 'magic-steal': case 'cast-reject':
      magicOnMessage(msg);
      break;
    case 'comp-control': case 'comp-add': case 'comp-remove': case 'comp-list': case 'comp-mount': case 'comp-rider': case 'comp-try': case 'comp-breath': case 'comp-reject':
      compOnMessage(msg);
      if(msg.t==='comp-control'){g.path=[];g.sentDir={dx:0,dy:0};combatCancel();}
      break;
    case 'ground-add':
      g.ground.set(msg.item.gid, msg.item);
      break;
    case 'ground-remove': {
      const it = g.ground.get(msg.gid);
      g.ground.delete(msg.gid);
      if (g.pendingPickup === msg.gid) g.pendingPickup = null;
      if (it && msg.by === g.you) toast(`Подобрано: ${Items.get(it.id).name}${it.n > 1 ? ' × ' + it.n : ''}`);
      break;
    }
    case 'look':
      if (msg.id === g.you) g.hero.look = msg.look;
      else if (g.others.has(msg.id)) g.others.get(msg.id).look = msg.look;
      break;
    case 'sv': case 'sv-warn': case 'sv-reject': case 'fire-add': case 'fire-remove':
      survivalOnMessage(msg);
      break;
    case 'me':
      combatOnMessage(msg);
      applyMe(msg);
      break;
    case 'stats':
      g.character.stats = msg.stats;
      g.character.unspentPoints = msg.pts;
      statsRender();
      break;
    case 'level':
      if (msg.id === g.you) { g.character.level = msg.level; setupHud(g.character); statsRender(); }
      else if (g.others.has(msg.id)) g.others.get(msg.id).level = msg.level;
      break;
    case 'dead':
      g.hero.dead = true;
      g.character.stats = msg.stats;
      g.character.deaths = msg.deaths;
      stopMoving();
      combatCancel();
      setSprint(false);
      showDeath(msg);
      statsRender();
      break;
    case 'respawned':
      if (msg.id === g.you) {
        g.hero.x = msg.x; g.hero.y = msg.y; g.hero.dead = false;
        g.path = []; g.target = null; g.correction = null;g.hero.surfaceVelocity={vx:0,vy:0};
        hideDeath();
        toast('Вы снова в строю.');
      } else if (g.others.has(msg.id)) {
        const o = g.others.get(msg.id);
        o.snaps = [{ t: performance.now(), x: msg.x, y: msg.y, m: 0 }];
        o.x = msg.x; o.y = msg.y; o.dead = false; o.hp = 100;
      }
      break;
    default:
      if (combatOnMessage(msg)) break;
      if (g.onExtraMessage) g.onExtraMessage(msg); // будущие системы
  }
}

// Личные показатели от сервера: здоровье, выносливость, мана, опыт, уровень, очки, смерти
function applyMe(me) {
  const g = game, ch = g.character;
  g.me = me;
  ch.vitals = { hp: me.hp, stamina: me.st, mp: me.mp };
  if (me.lvl !== ch.level) { ch.level = me.lvl; setupHud(ch); }
  ch.xp = me.xp; ch.unspentPoints = me.pts; ch.deaths = me.deaths;
  statsRender();
}

function onNetStatus(status, info) {
  const g = game;
  const box = $('#net-status');
  if (status === 'online' || status === 'connecting') return;
  if (status === 'reconnecting') {
    g.keys.clear();
    $('#net-status-text').textContent = `${info.message} Переподключение через ${Math.ceil(info.delay / 1000)} с (попытка ${info.attempt} из ${info.max})...`;
    box.classList.remove('hidden');
    return;
  }
  // соединение закрыто окончательно
  if (!g.welcomed) { // не удалось войти
    $('#game-loading').classList.add('hidden');
    if (g.resolveWelcome) { g.resolveWelcome(false); g.resolveWelcome = null; }
    alert(info.message);
    finish(g);
    if (info.code === P.CLOSE.AUTH || info.code === P.CLOSE.BANNED) location.reload();
    else if (g.onExit) g.onExit();
    return;
  }
  g.running = false;
  $('#net-status-text').textContent = info.message;
  $('#btn-net-exit').textContent = info.code === P.CLOSE.AUTH || info.code === P.CLOSE.BANNED ? 'На экран входа' : 'К списку миров';
  g.exitToLogin = info.code === P.CLOSE.AUTH || info.code === P.CLOSE.BANNED;
  box.classList.remove('hidden');
}

// Сверка своей позиции с сервером: большое расхождение — переставить, небольшое в покое — плавно подтянуть
function reconcile(sp) {
  const h = game.hero;
  const d = Math.hypot(sp.x - h.x, sp.y - h.y);
  // Серверные снимки идут реже кадров клиента. Даже крупное накопившееся
  // расхождение исправляем плавно; настоящие перемещения сбрасываются отдельными сообщениями.
  if (d > (cfg().reconcileSnapDistance || 3) * 4) {
    h.x = sp.x; h.y = sp.y;
    game.path = []; game.target = null; game.correction = null;
  } else if (!h.dead && d > 0.025) {
    game.correction = { x: sp.x, y: sp.y };
  }
}

// Другие игроки: интерполяция между снимками с задержкой interpDelayMs
function updateOthers(now) {
  const t = now - (cfg().interpDelayMs ?? 150);
  for (const o of game.others.values()) {
    const sn = o.snaps;
    while (sn.length > 2 && sn[1].t <= t) sn.shift();
    if (sn.length >= 2 && sn[0].t <= t) {
      const k = Math.min(1, (t - sn[0].t) / Math.max(1, sn[1].t - sn[0].t));
      o.x = sn[0].x + (sn[1].x - sn[0].x) * k;
      o.y = sn[0].y + (sn[1].y - sn[0].y) * k;
      o.moving = Boolean(sn[1].m || sn[0].m);
      if (Math.abs((sn[1].x - sn[1].y) - (sn[0].x - sn[0].y)) > 1e-3) o.dir = (sn[1].x - sn[1].y) > (sn[0].x - sn[0].y) ? 1 : -1;
    } else {
      const last = sn[sn.length - 1];
      o.x = last.x; o.y = last.y; o.moving = Boolean(last.m);
    }
  }
}

function bind(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  game.listeners.push(() => target.removeEventListener(type, fn, opts));
}

// ---------- Обновление ----------

// Клавиши: камера (стрелки, цифровой блок) и движение (WASD) — keymap.js
function cameraFrame(dt) {
  const r = game.renderer, cam = game.camera, ms = game.mouseScreen;
  const edge = game.edgeScroll && ms && !game.drag && document.hasFocus() ? window.Camera.edgeDirs(ms.x, ms.y, r.vw, r.vh) : null;
  const p = cam.update(dt, compControlled()||game.hero, game.panKeys, edge);
  r.cam = { x: p.x, y: p.y };
  if (ms) game.mouseWorld = r.toWorld(ms.x, ms.y); // обзор сдвинулся — точка под курсором тоже
  const label = cam.follow ? '🔒' : '🔓';
  const b = $('#btn-cam-follow');
  if (b && b.dataset.mode !== label) { b.dataset.mode = label; b.textContent = label; b.title = cam.follow ? 'Камера следует за героем · End — переключить' : 'Свободная камера · End — включить слежение'; b.dataset.iconTooltip = b.title; b.setAttribute('aria-label',b.title); b.classList.toggle('active', !cam.follow); }
}
function camCenter() { game.camera.recenter(compControlled()||game.hero); }
function camToggle() { const on = game.camera.toggleFollow(compControlled()||game.hero); toast(on ? 'Камера следит за героем.' : (game.arrowsPan ? 'Свободная камера: стрелки' : 'Свободная камера: Ctrl+стрелки') + ', цифровой блок, средняя кнопка мыши, миникарта. Home — к герою.', 2500); }


// Множитель скорости для предсказания: бег (пробел) при запасе выносливости, мёртвый стоит
function speedMul() {
  const me = game.me;
  if (!me) return 1;
  if (me.dead) return 0;
  const vm = vehSpeedMul(); // в машине (шаг 14): скорость машины, седок стоит
  if (vm !== null) return vm;
  const cheat = game.god && game.god.speed > 1 ? game.god.speed : 1; // чит-панель: быстрое передвижение
  const slowed = me.immobile || game.hero.stunUntil > performance.now();
  return (slowed ? 0 : survivalSpeedMul()) * (me.sprint && me.st > 0 ? (cfg().sprintMultiplier || 1) : 1) * compSpeedMul() * magicSpeedMul() * cheat; // верхом на драконе, «Попутный ветер» — быстрее
}

// «Сквозь препятствия» (чит-панель): предсказание идёт как у летуна — вода и горы проходимы
function update(dt) {
  const fly = game.map.flyer;
  const swim = game.map.swimmer;
  if (game.god && game.god.noclip || window.Items.setEffects(game.character).fly && game.hero.alt>0) game.map.flyer = true;
  if (game.map.flyer) game.map.swimmer = false;
  try { updateInner(dt); } finally { game.map.flyer = fly; game.map.swimmer = swim; }
}
function updateInner(dt) {
  const controlled=compControlled();
  if(controlled){let dx=0,dy=0;for(const key of game.keys)if(KEY_DIRS[key]){dx+=KEY_DIRS[key][0];dy+=KEY_DIRS[key][1];}const len=Math.hypot(dx,dy),dir=len?{dx:dx/len,dy:dy/len}:{dx:0,dy:0};if(dir.dx!==game.sentDir.dx||dir.dy!==game.sentDir.dy){game.net.send({t:'comp-input',action:'dir',...dir});game.sentDir=dir;}game.path=[];if(game.correction){const h=game.hero,ox=game.correction.x-h.x,oy=game.correction.y-h.y,k=Math.min(1,dt*10);h.x+=ox*k;h.y+=oy*k;h.moving=Math.hypot(ox,oy)>0.04;if(!h.moving)game.correction=null;}return;}

  const h = game.hero, beforeSurface={x:game.hero.x,y:game.hero.y};
  let dx = 0, dy = 0;
  if (!(game.me && game.me.dead)) for (const k of game.keys) if (KEY_DIRS[k]) { dx += KEY_DIRS[k][0]; dy += KEY_DIRS[k][1]; }
  // направление отправляется на сервер только при изменении
  const len0 = Math.hypot(dx, dy);
  const dir = len0 ? { dx: dx / len0, dy: dy / len0 } : { dx: 0, dy: 0 };
  if (dir.dx !== game.sentDir.dx || dir.dy !== game.sentDir.dy) {
    if (len0 || !game.path.length) game.net.send({ t: 'dir', dx: dir.dx, dy: dir.dy });
    game.sentDir = dir;
  }
  if (dx || dy) {
    game.path = []; game.target = null;
    combatCancel();
    const len = Math.hypot(dx, dy);
    const step = M.speedAt(game.map, h.x, h.y, speedMul()) * dt;
    const np = M.moveWithCollision(game.map, h, (dx / len) * step, (dy / len) * step);
    h.moving = np.x !== h.x || np.y !== h.y;
    h.x = np.x; h.y = np.y;
  } else if (game.path.length) {
    const r = M.followPath(game.map, h, game.path, dt, speedMul());
    h.x = r.pos.x; h.y = r.pos.y;
    game.path = r.path;
    h.moving = true;
    if (!game.path.length) game.target = null;
  } else {
    h.moving = false;
  }
  const ice=!vehSeat()&&!game.map.flyer&&magicSlipperyAt(beforeSurface.x,beforeSurface.y);
  if(speedMul()<=0)h.surfaceVelocity={vx:0,vy:0};
  else {const to=M.surfaceMove(game.map,beforeSurface,h,h.surfaceVelocity||(h.surfaceVelocity={}),dt,ice,M.speedAt(game.map,beforeSurface.x,beforeSurface.y,speedMul()));h.x=to.x;h.y=to.y;h.moving=h.x!==beforeSurface.x||h.y!==beforeSurface.y;}
  if (game.correction) { // плавно гасить сетевое расхождение, в том числе во время движения
    const c = game.correction;
    const ox = c.x - h.x, oy = c.y - h.y, d = Math.hypot(ox, oy);
    if (d < 0.04) game.correction = null;
    else if (!dx && !game.path.length) {
      const step = Math.min(d, Math.max(0.5, M.speedAt(game.map, h.x, h.y, speedMul())) * dt);
      h.x += ox / d * step; h.y += oy / d * step;
    } else {
      const step = Math.min(d, dt * 1.5);
      const fixed = M.moveWithCollision(game.map, h, ox / d * step, oy / d * step);
      h.x = fixed.x; h.y = fixed.y;
    }
  }
  // дошли до предмета — поднять
  if (game.pendingPickup) {
    const it = game.ground.get(game.pendingPickup);
    if (!it) game.pendingPickup = null;
    else if (Math.hypot(it.x - h.x, it.y - h.y) <= Inv.settings.pickupRange * 0.9) {
      game.net.send({ t: 'inv', a: { type: 'pickup', gid: it.gid } });
      game.pendingPickup = null;
    } else if (!game.path.length && !h.moving) game.pendingPickup = null;
  }
}

// Поднять предмет: рядом — сразу, далеко — сначала подойти
function pickupItem(it) {
  const h = game.hero;
  if (Math.hypot(it.x - h.x, it.y - h.y) <= Inv.settings.pickupRange * 0.9) {
    game.net.send({ t: 'inv', a: { type: 'pickup', gid: it.gid } });
    return;
  }
  moveTo(it.x, it.y);
  if (game.path.length) game.pendingPickup = it.gid;
}

function nearestGround(x, y, maxDist) {
  let best = null, bd = maxDist;
  for (const it of game.ground.values()) {
    const d = Math.hypot(it.x - x, it.y - y);
    if (d <= bd) { bd = d; best = it; }
  }
  return best;
}

// quiet — без подсказок (преследование цели), keepCombat — не сбрасывать цель атаки
function moveTo(tx, ty, { quiet = false, keepCombat = false } = {}) {
  if(compControlled()){game.net.send({t:'comp-input',action:'move',x:tx,y:ty});return;}
  const h = game.hero;
  if (game.me && game.me.dead) return;
  if (!keepCombat) combatCancel();
  tx = Math.floor(tx); ty = Math.floor(ty);
  if (!G.isWalkable(game.map, tx, ty)) { if (!quiet) toast(`Туда не пройти: ${G.BIOMES[G.tileAt(game.map, tx, ty)].name.toLowerCase()}`); return; }
  const path = M.findPath(game.grid, Math.floor(h.x), Math.floor(h.y), tx, ty);
  if (!path) { if (!quiet) toast('Путь не найден: цель недостижима или слишком далеко'); return; }
  if (!path.length) return;
  game.path = path;
  game.target = keepCombat ? null : { x: tx, y: ty };
  game.correction = null;
  game.net.send({ t: 'path', path });
}

// Остановиться (для атаки с места)
function stopMoving() {
  if (!game.path.length) return;
  game.path = []; game.target = null;
  game.net.send({ t: 'dir', dx: 0, dy: 0 });
}

// Бег: пока зажат пробел (тратит выносливость)
function setSprint(on) {
  if (!game || Boolean(game.sprintHeld) === on) return;
  game.sprintHeld = on;
  game.net.send({ t: 'sprint', on });
}

// Установить мину, ловушку или турель: у курсора, если он рядом, иначе под ноги
function placeItem(item) {
  const g = game, h = g.hero;
  const msg = { t: 'place', item };
  if (g.mouseWorld && Math.hypot(g.mouseWorld.x - h.x, g.mouseWorld.y - h.y) <= Inv.settings.pickupRange) {
    msg.x = Math.round(g.mouseWorld.x * 100) / 100; msg.y = Math.round(g.mouseWorld.y * 100) / 100;
  }
  g.net.send(msg);
}

// ---------- Ввод ----------

const overlaysOpen = () => !$('#help-overlay').classList.contains('hidden') || !$('#net-status').classList.contains('hidden');

function onKeyUp(e) {
  if (!game) return;
  game.keys.delete(e.code);
  if (PAN_KEYS[e.code]) game.panKeys[PAN_KEYS[e.code]] = false;
  if (e.key === 'Shift') combatShift(false);
  if (e.code === 'Space') setSprint(false);
  voiceKeyUp(e); // рация отпущена
}

function onKeyDown(e) {
  if (!game) return;
  if (e.code === 'Escape') {
    if (!$('#help-overlay').classList.contains('hidden')) { e.preventDefault(); $('#btn-help-close').click(); return; }
    if (!$('#ending-window').classList.contains('hidden') && questsKey(e)) return;
    if (!$('#game-menu').classList.contains('hidden')) { e.preventDefault(); toggleMenu(false); return; }
    if (cheatCancelPick()) { e.preventDefault(); return; }
    if (closeTopmostPanel()) { e.preventDefault(); return; }
  }
  if (overlaysOpen()) return;
  if (e.ctrlKey && e.altKey && e.shiftKey && e.code === 'KeyC') { gmChordArmedUntil = Date.now() + 1500; e.preventDefault(); return; }
  if (e.ctrlKey && e.altKey && e.shiftKey && e.code === 'KeyX' && Date.now() <= gmChordArmedUntil) {
    gmChordArmedUntil = 0; e.preventDefault();
    if (adminCanOpen()) {
      revealAdminPanels({ showCheats: cheatsCanOpen() }); adminToggle(true);
      if (cheatsCanOpen()) cheatToggle(true);
      else toast('Чит-панель доступна только при выданном сервером разрешении.', 3000);
    }
    return;
  }
  if (Date.now() > gmChordArmedUntil) gmChordArmedUntil = 0;
  if (e.code === 'Escape' && baseKey(e)) return; // окна строительства, крафта, сундука
  if (e.code === 'Escape' && magicKey(e)) return; // книга заклинаний
  if (e.code === 'Escape' && questsKey(e)) return; // журнал заданий, экран концовки
  if (e.code === 'Escape' && famKey(e)) return; // панель семьи
  if (e.code === 'Escape' && voiceKey(e)) return; // панель голоса, отмена выбора клавиши рации
  if (e.code === 'Escape') {
    e.preventDefault();
    if (commerceIsOpen()) { commerceToggle(false); return; }
    if (cheatCancelPick()) return;
    if (stlIsOpen()) stlClose(); else if (cheatIsOpen()) cheatToggle(false); else if (adminIsOpen()) adminToggle(false); else if (invIsOpen()) invToggle(false); else if (statsIsOpen()) statsToggle(false); else toggleMenu();
    return;
  }
  if (!$('#game-menu').classList.contains('hidden')) return;
  if (e.code === 'F10') { e.preventDefault(); adminToggle(); return; }
  if (e.code === 'F9') { e.preventDefault(); cheatToggle(); return; } // шаг 20: чит-панель
  if (e.code === 'F7') { e.preventDefault(); cheatToggle(true, 'build'); return; } // шаг 21: чит-панель, вкладка «Стройка»
  if (!/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '') && cheatKey(e)) { e.preventDefault(); return; } // R — поворот в стройке
  if (e.code === 'F8') { e.preventDefault(); toggleOverlay(); return; } // шаг 20: оверлей FPS / пинг / тик
  // ввод в полях панели ГМ не должен двигать героя
  if (e.target && e.target.closest && e.target.closest('#admin-panel, #cheat-panel, #commerce-window')) return;
  if (chatHandleKey(e)) { game.keys.clear(); return; }
  if (voiceKey(e)) return; // F4 — панель голоса, V (настраивается) — рация, пока зажата
  // шаг 22: камера — Ctrl+стрелки и цифровой блок двигают обзор, Home / 5 — к герою, End / Ё — слежение вкл/выкл
  const pk = panKeyFor(e.code, e.ctrlKey, game.arrowsPan); // стрелки — камера (настройка «Стрелки — камера»), WASD — герой
  if (pk) { e.preventDefault(); game.panKeys[pk] = true; return; }
  if (e.code === 'Home' || e.code === 'Numpad5') { e.preventDefault(); camCenter(); return; }
  if ((e.code === 'End' || e.code === 'Backquote') && !e.repeat) { e.preventDefault(); camToggle(); return; }
  if (moveKey(e.code, game.arrowsPan)) { e.preventDefault(); game.keys.add(e.code); return; }
  if (e.key === 'Shift') combatShift(true);
  if (e.code === 'KeyI') { e.preventDefault(); invToggle(); return; }
  if (e.code === 'KeyC') { e.preventDefault(); statsToggle(); return; }
  if (survivalKey(e)) return; // Z — отдых, G — попить
  if (vehKey(e)) return; // Y — сесть/выйти (Shift+Y — панель), J — заправить, O — починить, M — запереть
  if (levelsKey(e)) return; // U — вход/выход уровня, PageUp/PageDown — высота полёта на драконе
  if (magicKey(e)) return; // P — книга заклинаний, X — украсть заклинание у мага
  if (famKey(e)) return; // F3 — панель семьи
  if (questsKey(e)) return; // F2 — журнал заданий, T рядом с Железным Патриархом — разговор
  if (stlKey(e)) return; // T рядом с жителем поселения — поговорить
  if (combatKey(e)) return; // T — переговоры с человеком; Tab/Caps Lock — атака
  if (compKey(e)) return; // Shift+T — обычное привлечение спутника; V/N/Q/H — приказы
  if (baseKey(e)) return; // B — строительство (R — поворот), K — рецепты, E — добыть / открыть
  if (e.code === 'KeyR') { e.preventDefault(); game.net.send({ t: 'reload', slot: e.shiftKey ? 'off' : 'main' }); return; }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) setSprint(true); return; }
  if (e.code === 'KeyF') { // поднять ближайший предмет
    const it = nearestGround(game.hero.x, game.hero.y, Inv.settings.pickupRange * 3);
    if (it) pickupItem(it); else toast('Рядом нет предметов');
    return;
  }
  if (/^Digit[0-9]$/.test(e.code)) {
    const slot = document.querySelector(`#hotbar .slot[data-key="${e.code.slice(5)}"]`);
    slot.classList.add('active');
    setTimeout(() => slot.classList.remove('active'), 200);
    hotkey((Number(e.code.slice(5)) + 9) % 10);
  }
}

function onCanvasClick(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  if (e.button === 1) { e.preventDefault(); game.drag = { x: sx, y: sy }; return; } // средняя кнопка — тащить обзор (шаг 22)
  if (e.button === 0 && cheatMapClick(game.renderer.toWorld(sx, sy))) return; // чит-панель: точка телепорта / спавна
  if (e.button === 0 && adminMapClick(e, game.renderer.toWorld(sx, sy))) return; // выбор точки панелью ГМ, полёт
  if (game.me && game.me.dead) return;
  if (baseMode() && baseClick(e, game.renderer.toWorld(sx, sy))) return; // режим строительства
  if (e.button === 0 && weClick(game.renderer.toWorld(sx, sy))) return; // тайник стройки: открыть
  if (stlClick(e, sx, sy, game.renderer)) return; // житель: поговорить (Ctrl — напасть)
  if (commerceClick(e, sx, sy, game.renderer)) return;
  if(compControlled()){const at=game.renderer.toWorld(sx,sy);if(e.button===2||e.shiftKey)game.net.send({t:'comp-attack',x:at.x,y:at.y});else if(e.button===0)moveTo(at.x,at.y);return;}
  if (combatMouseDown(e, sx, sy)) return; // враг под курсором, Shift или правая кнопка — бой
  if (e.button === 0) { const body = corpseHit(sx, sy, game.renderer); if (body) { corpseOpen(body); return; } }
  if (baseClick(e, game.renderer.toWorld(sx, sy))) return; // дверь, сундук, кровать, станок, ресурсная точка
  if (e.button !== 0) return;
  // щелчок по предмету на земле (иконка стоит чуть выше точки) — поднять
  const r = game.renderer;
  let hit = null, hd = Math.max(14, r.hh * 0.9);
  for (const it of game.ground.values()) {
    const p = r.toScreen(it.x, it.y);
    const d = Math.hypot(p.x - sx, p.y - r.hh * 0.45 - sy);
    if (d < hd) { hd = d; hit = it; }
  }
  if (hit) { pickupItem(hit); return; }
  const w = r.toWorld(sx, sy);
  game.pendingPickup = null;
  moveTo(w.x, w.y);
}

function onWheel(e) {
  e.preventDefault();
  const s = cfg();
  const r = game.renderer;
  r.zoom = Math.min(s.zoomMax || 2.5, Math.max(s.zoomMin || 0.35, r.zoom * (e.deltaY > 0 ? 1 / 1.12 : 1.12)));
  storeZoom('rpg.cameraZoom', r.zoom);
}

function toggleMenu(force) {
  const m = $('#game-menu');
  const open = force === undefined ? m.classList.contains('hidden') : force;
  m.classList.toggle('hidden', !open);
  if (open && game) game.keys.clear();
}

// ---------- HUD ----------

function setupHud(ch) {
  $('#hud-name').textContent = ch.name;
  const own = game.world.own;
  $('#hud-world').title = own ? 'Текущий мир (ваш)' : `Текущий мир. Владелец: ${game.world.ownerName}`;
  $('#hud-level').textContent = `Ур. ${ch.level}`;
  $('#hud-world').textContent = game.world.name;
}

function setBar(id, value, max) {
  const el = $(id);
  el.querySelector('.fill').style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
  el.querySelector('.val').textContent = `${Math.round(value)} / ${max}`;
}

function updateHud() {
  const ch = game.character;
  const d = R.derive(ch.stats, ch.level);
  const me = game.me;
  setBar('#bar-hp', ch.vitals.hp, me ? me.mhp : d.maxHp);
  setBar('#bar-stamina', ch.vitals.stamina, me ? me.mst : d.maxStamina);
  setBar('#bar-mp', ch.vitals.mp, me ? me.mmp : d.maxMp);
  if (me) setBar('#bar-xp', me.xp, me.next);
  updateTargetFrame();
  updateAmmo();
  const tx = Math.floor(game.hero.x), ty = Math.floor(game.hero.y);
  const b = G.BIOMES[G.tileAt(game.map, tx, ty)];
  const pl = $('#hud-players');
  const n = game.others.size + 1, max = cfg().maxPlayers || 8;
  const ptext = `👥 ${n} / ${max}`;
  if (pl.textContent !== ptext) {
    pl.textContent = ptext;
    pl.title = 'Игроки в мире: ' + [`${game.character.name} (вы)`, ...[...game.others.values()].map((o) => o.name + (o.admin ? ' 🛡' : ''))].join(', ') +
      `. Предел — ${max}. Голубые точки на миникарте — другие игроки.`;
  }
  const loc = $('#hud-location');
  const z = levelsState().z;
  const town = z === 0 ? stlWhere(game.hero.x, game.hero.y) : null; // поселение (шаг 15)
  const text = `${town ? `🏘 ${town.name}${town.raid ? ' ⚔' : ''} · ` : ''}${b.name} · ${tx}, ${ty} · уровень ${window.Levels ? window.Levels.zLabel(z) : 0}`;
  if (loc.textContent !== text) { loc.textContent = text; loc.title = (town ? `Поселение «${town.name}»: мирная зона (без PvP, ловушек и строительства), отношение — ${window.Settlements.TIERS[town.tier].name} (${town.rep}). ` : '') + b.hint + ' Координаты клетки и вертикальный уровень (0 — поверхность, минус — под землёй/водой, плюс — выше).'; }
}

// Рамка цели: враг под курсором или выбранный для атаки
function updateTargetFrame() {
  const e = combatTarget();
  const box = $('#target-frame');
  if (!e || !e.def) { if (!box.classList.contains('hidden')) box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  $('#tf-name').textContent = e.def.name;
  $('#tf-level').textContent = `ур. ${e.lvl}`;
  const el = $('#tf-hp');
  el.querySelector('.fill').style.width = `${e.hp}%`;
  el.querySelector('.val').textContent = `${Math.round((e.hp / 100) * e.maxHp)} / ${e.maxHp}`;
  const info = `${window.Enemies.FAMILIES[e.def.family].name} · ${window.Enemies.behaviourOf(e.def).name}${e.flags & 4 ? ' · убегает' : e.flags & 16 ? ' · связан лассо' : e.flags & 2 ? ' · оглушён' : ''}`;
  if ($('#tf-info').textContent !== info) $('#tf-info').textContent = info;
}

// Патроны оружия в руках и перезарядка
function updateAmmo() {
  const me = game.me, box = $('#hud-ammo');
  const w = combatWeapon('main');
  const parts = [];
  for (const [slot, label] of [['main', ''], ['off', 'вторая рука: ']]) {
    const m = me && me.mag && me.mag[slot];
    if (!m) continue;
    const rl = me.reload && me.reload.slot === slot;
    parts.push(`${label}<span class="${m.n ? '' : 'empty'}">${m.n} / ${m.max}</span> · в сумке ${m.have}${rl ? ' <span class="reload">перезарядка…</span>' : !m.n && m.have ? ' <span class="reload">R — перезарядить</span>' : ''}`);
  }
  const html = (w && w.item ? `${w.item.name}${w.inst.dur === 0 ? ' (сломано)' : ''}${parts.length ? ': ' : ''}` : '') + parts.join(' · ');
  const show = Boolean(parts.length);
  box.classList.toggle('hidden', !show);
  if (show && box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
}

// Миникарта в изометрической проекции (как основной вид)
function minimapTransform(ctx, c, map) {
  const m=minimapMatrix(map,c.width,c.height,game.miniZoom,game.hero);
  ctx.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);
}

function miniZoom(direction) {
  game.miniZoom=direction===0?1:Math.max(1,Math.min(8,game.miniZoom*(direction>0?1.4:1/1.4)));
  storeZoom('rpg.minimapZoom', game.miniZoom);
  $('#mini-zoom-label').textContent=Math.round(game.miniZoom*100)+'%';
  $('#btn-mini-minus').disabled=game.miniZoom<=1;
  $('#btn-mini-plus').disabled=game.miniZoom>=8;
  drawMinimap();
}

function drawMinimap() {
  const c = $('#minimap');
  const ctx = c.getContext('2d');
  $('#mini-zoom-label').textContent=Math.round(game.miniZoom*100)+'%';
  $('#btn-mini-minus').disabled=game.miniZoom<=1;
  $('#btn-mini-plus').disabled=game.miniZoom>=8;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  minimapTransform(ctx, c, game.map);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(game.minimap, 0, 0);
  fogMinimap(ctx); // туман войны (шаг 22)
  const pt = ctx.getTransform();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const toMini = (x, y) => new DOMPoint(x, y).matrixTransform(pt);
  // поселения
  ctx.fillStyle = '#fff';
  for (const s of game.map.settlements) { if (!fogKnown(s.x, s.y)) continue; const p = toMini(s.x, s.y); ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
  levelsMinimap(ctx, toMini, fogState() ? new Map([...game.markers].filter(([k]) => { const [x, y] = k.split(',').map(Number); return fogKnown(x, y); })) : game.markers); // входы и выходы уровней (жёлтые)
  vehMinimap(ctx, toMini); // техника (голубые, своя — белая)
  // видимая область
  const r = game.renderer;
  const corners = [[0, 0], [r.vw, 0], [r.vw, r.vh], [0, r.vh]].map(([x, y]) => { const w = r.toWorld(x, y); return toMini(w.x, w.y); });
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  // другие игроки
  ctx.fillStyle = '#5fd3ff';
  const fs = fogState();
  for (const o of game.others.values()) { if (!(fs && fs.shared) && !fogSee(o.x, o.y)) continue; const p = toMini(o.x, o.y); ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill(); }
  // враги, которые уже гонятся за кем-то (флаг «в бою»)
  ctx.fillStyle = '#ff8a3a';
  for (const e of combatScene().enemies || []) if (e.flags & 8 && !e.deadAt && fogSee(e.x, e.y)) { const p = toMini(e.x, e.y); ctx.fillRect(p.x - 1, p.y - 1, 2, 2); }
  // герой
  commerceMinimap(ctx, toMini, fogSee);
  const h = toMini(game.hero.x, game.hero.y);
  ctx.fillStyle = '#ff4040';
  ctx.beginPath(); ctx.arc(h.x, h.y, 3, 0, Math.PI * 2); ctx.fill();
}

// Миникарта (шаг 22): щелчок и перетаскивание — посмотреть туда (камера отпускает героя); правая кнопка или Shift — идти туда
function onMinimapClick(e) {
  e.preventDefault();
  if (e.button === 2 || e.shiftKey) { const p = minimapPoint(e); moveTo(p.x, p.y); return; }
  if (e.button !== 0) return;
  game.miniDrag = true;
  minimapLook(e);
}
function minimapLook(e) { const p = minimapPoint(e); game.camera.lookAt(p.x, p.y); }
function minimapPoint(e) {
  const c = $('#minimap');
  const rect = c.getBoundingClientRect();
  const m=minimapMatrix(game.map,c.width,c.height,game.miniZoom,game.hero);
  const p=minimapWorldPoint(m,(e.clientX-rect.left)*c.width/rect.width,(e.clientY-rect.top)*c.height/rect.height);
  return {x:Math.max(0,Math.min(game.map.width-0.01,p.x)),y:Math.max(0,Math.min(game.map.height-0.01,p.y))};
}

// ---------- Выход ----------
// Позицию героя сохраняет сервер: периодически, при выходе и при обрыве связи.

function finish(g) {
  g.running = false;
  chatDetach();
  invDetach();
  commerceDetach();
  corpseDetach();
  combatDetach();
  survivalDetach();
  baseDetach();
  compDetach();
  corpseClear();
  magicDetach();
  statsDetach();
  adminDetach();
  cheatDetach();
  weDetach();
  fogDetach();
  voiceLeaveWorld();
  g.net.stop();
  g.listeners.forEach((off) => off());
  if (game === g) game = null;
  toggleMenu(false);
  $('#net-status').classList.add('hidden');
}

export async function exitGame() {
  if (!game) return;
  const g = game;
  g.net.close();
  finish(g);
  if (g.exitToLogin) { location.reload(); return; }
  if (g.onExit) g.onExit();
}
