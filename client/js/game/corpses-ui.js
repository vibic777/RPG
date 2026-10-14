import { drawCreature } from './creature-art.js';
import { drawHumanoid } from './figure-art.js';
const bodies = new Map(), pictures = new Map();
let api = null;
export function corpseClear() { bodies.clear(); pictures.clear(); }
export function corpseAttach(a) { api = a; }
export function corpseDetach() { api = null; $('#corpse-loot-window').classList.add('hidden'); }
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
export function corpseHit(sx, sy, renderer) {
  let hit = null, best = Math.max(20, renderer.hh * 1.5);
  for (const body of bodies.values()) {
    const p = renderer.toScreen(body.x, body.y);
    if (renderer.fog && !renderer.fog.see(body.x, body.y)) continue;
    const d = Math.hypot(sx - p.x, sy - p.y);
    if (d < best) { best = d; hit = body; }
  }
  return hit;
}
export function corpseOnMessage(msg) {
  if (msg.t === 'corpse-error') { api?.toast(msg.message || 'Не удалось переместить вещи из трупа.', 3500); return true; }
  if (msg.t === 'corpse-take-result') {
    api?.toast(msg.count ? `Забрано предметов: ${msg.count}${msg.left ? ` · осталось в трупе: ${msg.left}` : ''}` : msg.left ? 'В сумке нет места для этих предметов.' : 'Труп уже пуст.', 3000);
    return true;
  }
  if (msg.t !== 'corpse-inventory') return false;
  const win = $('#corpse-loot-window'); win.dataset.id = msg.id;
  $('#corpse-loot-title').textContent = `Труп · ${msg.secondsLeft} с`;
  const rows = (msg.items || []).map((x, i) => `<div class="corpse-item"><span>${esc(window.Items.get(x.id)?.name || x.id)} × ${x.n}${x.dur != null ? ` · ${x.dur} прочн.` : ''}</span><button type="button" class="btn small" data-take="${i}" title="Забрать всю стопку или указанное количество">Забрать</button></div>`).join('');
  const hero = api.character(), bag = [], equip = [];
  for (let i = 0; i < hero.inventory.cells.length; i++) { const x = hero.inventory.cells[i]; if (x) bag.push(`<div class="corpse-item"><span>${esc(window.Items.get(x.id)?.name || x.id)} × ${x.n}</span><button type="button" class="btn small" data-put="${i}">Положить</button></div>`); }
  for (const [slot, x] of Object.entries(hero.inventory.equipment || {})) if (x && x.id !== 'underwear_base') equip.push(`<div class="corpse-item"><span>${esc(window.Items.get(x.id)?.name || x.id)} · надето</span><button type="button" class="btn small" data-equip="${esc(slot)}">Положить</button></div>`);
  const itemCount = (msg.items || []).reduce((sum, item) => sum + item.n, 0), slotCount = (msg.items || []).length;
  $('#corpse-loot-items').innerHTML = `<h4>В трупе: ${itemCount} предметов · ${slotCount}/256 ячеек</h4><div class="row"><button type="button" class="btn small primary" data-take-all ${slotCount ? '' : 'disabled'} title="${slotCount ? 'Забрать всё, что помещается в сумку' : 'Труп пуст — забирать нечего'}">Забрать всё</button></div>${rows || '<p>Труп пуст.</p>'}<h4>Ваша сумка</h4><label>Количество для частичного перемещения (пусто — вся стопка) <input id="corpse-count" type="number" value="" min="1" max="9007199254740991"></label>${bag.join('') || '<p>Сумка пуста.</p>'}<h4>Надетые вещи</h4>${equip.join('') || '<p>Надетых вещей нет.</p>'}`;
  win.classList.remove('hidden'); return true;
}
export function corpseInit() {
  $('#btn-corpse-close').addEventListener('click', () => $('#corpse-loot-window').classList.add('hidden'));
  $('#corpse-loot-items').addEventListener('click', e => {
    const b = e.target.closest('[data-take-all],[data-take],[data-put],[data-equip]'); if (!b || !api || b.disabled) return;
    if (b.dataset.takeAll != null) { api.send({ t: 'corpse-act', id: $('#corpse-loot-window').dataset.id, action: 'take-all' }); return; }
    const action = b.dataset.take != null ? 'take' : b.dataset.put != null ? 'put' : 'put-equip';
    const count = Number($('#corpse-count').value);
    const msg = { t: 'corpse-act', id: $('#corpse-loot-window').dataset.id, action, ...(Number.isSafeInteger(count) && count > 0 ? { count } : {}) };
    if (b.dataset.take != null) msg.index = Number(b.dataset.take); else if (b.dataset.put != null) msg.cell = Number(b.dataset.put); else msg.slot = b.dataset.equip;
    api.send(msg);
  });
}
export function corpseOpen(body) { if (api && body) api.send({ t: 'corpse-act', action: 'view', id: body.id }); }
export function corpseWelcome(msg) { corpseClear(); for (const c of msg.corpses || []) bodies.set(c.id, c); }
export function corpseMessage(msg) {
  if (corpseOnMessage(msg)) return true;
  if (msg.t === 'corpse-add') { bodies.set(msg.corpse.id, msg.corpse); return true; }
  if (msg.t === 'corpse-remove') { bodies.delete(msg.id); pictures.delete(msg.id); if ($('#corpse-loot-window').dataset.id === msg.id) $('#corpse-loot-window').classList.add('hidden'); return true; }
  return false;
}
function draw(r, body, maxSide) {
  const unit = r.hh * 0.9, dpr = Math.min(r.dpr || 1, 2), key = unit + '|' + dpr + '|' + maxSide;
  let pic = pictures.get(body.id);
  if (!pic || pic.key !== key) {
    const def = body.def && window.Enemies.get(body.def), size = def && def.look.size || 1;
    const extent = Math.max(72, unit * size * 5);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = Math.min(maxSide, Math.ceil(extent * 2 * dpr));
    const ctx = canvas.getContext('2d'); ctx.scale(canvas.width / (extent * 2), canvas.height / (extent * 2));
    if (def) drawCreature(ctx, { def, look: def.look, deadAt: 1, alpha: 1, x: body.x, y: body.y }, extent, extent, unit, 1000);
    else {
      ctx.translate(extent, extent); ctx.rotate(1.1); ctx.scale(1, 0.65);
      drawHumanoid(ctx, { colors: body.colors || { skin: '#c99a72', armL: '#c99a72', armR: '#c99a72', hair: '#39302a', legs: '#52483c' }, look: body.look || {} }, 0, 0, unit, 1000);
    }
    pic = { key, canvas, extent }; pictures.delete(body.id); pictures.set(body.id, pic);
    let pixels = [...pictures.values()].reduce((sum, p) => sum + p.canvas.width * p.canvas.height, 0);
    while (pixels > 8 * 1024 * 1024) { const id = pictures.keys().next().value, old = pictures.get(id); pixels -= old.canvas.width * old.canvas.height; pictures.delete(id); }
  } else { pictures.delete(body.id); pictures.set(body.id, pic); }
  const s = r.toScreen(body.x, body.y);
  r.ctx.drawImage(pic.canvas, s.x - pic.extent, s.y - pic.extent, pic.extent * 2, pic.extent * 2);
}
export function corpseScene(scene, renderer) {
  const margin = Math.max(240, renderer.hw * 12), visible = [];
  for (const body of bodies.values()) {
    const s = renderer.toScreen(body.x, body.y);
    if (s.x >= -margin && s.x <= renderer.vw + margin && s.y >= -margin && s.y <= renderer.vh + margin && (!renderer.fog || renderer.fog.known(body.x, body.y))) visible.push(body);
  }
  // Все видимые тела помещаются в бюджет: большая куча не пересоздаёт картинки каждый кадр.
  const maxSide = Math.max(1, Math.min(1024, Math.floor(Math.sqrt(8 * 1024 * 1024 / Math.max(1, visible.length)))));
  return { ...scene, flats: [...(scene.flats || []), ...visible.map(c => ({ x: c.x, y: c.y, draw: r => draw(r, c, maxSide) }))] };
}
