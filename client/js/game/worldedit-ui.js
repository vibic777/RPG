// Стройка чит-панели в мире (шаг 21): объекты стройки (props), скрытые объекты мира, призрак постановки, подсветка цели.
// Сервер: server/worldedit.js (prop-add / prop-remove / prop-hide, welcome.props / welcome.hidden). Тайник открывается щелчком рядом.
const WE = () => window.WorldEdit;
let api = null; // { map(), renderer(), send(m), hero() }
const props = new Map();
let hidden = new Set();
let ghost = null; // { cat, id, rot, name, erase }
let highlight = null; // () => { x, y } | null

export function weAttach(a) { api = a; props.clear(); hidden = new Set(); ghost = null; highlight = null; }
export function weDetach() { api = null; props.clear(); hidden = new Set(); ghost = null; highlight = null; }
function syncHidden() {
  const r = api && api.renderer();
  if (r) { r.hidden = hidden; r.hiddenVer = (r.hiddenVer || 0) + 1; }
}
function nodeMap() { const m = api && api.map(); return m && window.Building ? window.Building.nodes(m) : null; }
function addProp(p) {
  props.set(p.id, p);
  if (p.k === 'node') { const m = api.map(), nm = nodeMap(); if (nm) nm.set(p.y * m.width + p.x, p.key); }
}
export function weOnWelcome(msg) {
  props.clear();
  hidden = new Set(msg.hidden || []);
  const nm = nodeMap();
  if (nm) for (const k of hidden) nm.delete(k);
  for (const p of msg.props || []) addProp(p);
  syncHidden();
}
export function weOnMessage(msg) {
  if (!api) return false;
  if (msg.t === 'prop-add') { addProp(msg.prop); return true; }
  if (msg.t === 'prop-remove') {
    const p = props.get(msg.id);
    props.delete(msg.id);
    if (p && p.k === 'node') { const m = api.map(), nm = nodeMap(); if (nm && nm.get(p.y * m.width + p.x) === p.key) nm.delete(p.y * m.width + p.x); }
    return true;
  }
  if (msg.t === 'prop-hide') { if (msg.on) { hidden.add(msg.i); const nm = nodeMap(); if (nm) nm.delete(msg.i); } else hidden.delete(msg.i); syncHidden(); return true; }
  if (msg.t === 'prop-err') { if (api.toast) api.toast(msg.message, 2500); return true; }
  return false;
}
export const weProps = () => [...props.values()];
export function weSetGhost(g) { ghost = g; }
export function weSetHighlight(fn) { highlight = fn; }
// Щелчок: открыть тайник рядом (true — поглощён)
export function weClick(w) {
  if (!api) return false;
  for (const p of props.values()) {
    if (p.k !== 'cache' || Math.hypot(p.x - w.x, p.y - w.y) > 0.9) continue;
    api.send({ t: 'prop', a: 'open', id: p.id });
    return true;
  }
  return false;
}

// ---------- Рисование ----------
function box(r, x, y, color) { // блок стены здания (как стены поселений)
  const ctx = r.ctx, { hw, hh } = r, s = r.toScreen(x, y), h = hh * 2, k = 0.95;
  const sh = (c, f) => { const n = parseInt(c.slice(1), 16); return `rgb(${Math.round((n >> 16) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`; };
  ctx.fillStyle = sh(color, 0.7);
  ctx.beginPath(); ctx.moveTo(s.x - hw * k, s.y + hh); ctx.lineTo(s.x, s.y + hh * (1 + k)); ctx.lineTo(s.x, s.y + hh * (1 + k) - h); ctx.lineTo(s.x - hw * k, s.y + hh - h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = sh(color, 0.85);
  ctx.beginPath(); ctx.moveTo(s.x + hw * k, s.y + hh); ctx.lineTo(s.x, s.y + hh * (1 + k)); ctx.lineTo(s.x, s.y + hh * (1 + k) - h); ctx.lineTo(s.x + hw * k, s.y + hh - h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(s.x, s.y + hh - h - hh * k + hh * (1 - k)); ctx.lineTo(s.x + hw * k, s.y + hh - h); ctx.lineTo(s.x, s.y + hh * (1 + k) - h); ctx.lineTo(s.x - hw * k, s.y + hh - h); ctx.closePath(); ctx.fill();
}
const ICON = { obj: '🌲', node: '⛏', cache: '🎁', bld: '🏠' };
function drawProp(r, p, alpha = 1) {
  const ctx = r.ctx;
  ctx.save(); ctx.globalAlpha = alpha;
  if (p.k === 'bld') {
    const col = ((window.Settlements && window.Settlements.BUILDINGS[p.key]) || {}).color || '#8a7a6a';
    for (const [x, y] of WE().bldWalls(p.x, p.y, p.rot)) box(r, x, y, col);
    const s = r.toScreen(p.x + WE().BLD_SIZE / 2, p.y + WE().BLD_SIZE / 2);
    if (r.label) r.label(`${ICON.bld} ${WE().nameOf(p)}`, s.x, s.y - r.hh * 3.4, '#f3e4c4');
  } else {
    const cx = p.k === 'node' ? p.x + 0.5 : p.x, cy = p.k === 'node' ? p.y + 0.5 : p.y, s = r.toScreen(cx, cy);
    if (typeof r.objSprite === 'function') r.objSprite(WE().spriteOf(p), s.x, s.y, ((p.id || '').charCodeAt(1) % 8) / 8 + 0.01);
    else { // простой рендер: значок на земле
      ctx.fillStyle = p.k === 'cache' ? '#c8a050' : p.k === 'node' ? '#8a8a7a' : '#4a7a3a';
      ctx.beginPath(); ctx.ellipse(s.x, s.y - r.hh * 0.6, r.hw * 0.35, r.hh * 0.9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.font = `${Math.max(10, Math.round(r.hh))}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(ICON[p.k] || '•', s.x, s.y - r.hh * 0.3);
    }
    if (p.k === 'cache' && r.label) r.label('🎁 ' + WE().nameOf(p), s.x, s.y - r.hh * 2.6, '#f3d890');
  }
  ctx.restore();
}
function diamond(ctx, s, hw, hh) { ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + hw, s.y + hh); ctx.lineTo(s.x, s.y + hh * 2); ctx.lineTo(s.x - hw, s.y + hh); ctx.closePath(); }
function drawGhost(r, mouse) {
  if (!ghost || !mouse) return;
  const ctx = r.ctx, { hw, hh } = r, x = Math.floor(mouse.x), y = Math.floor(mouse.y);
  ctx.save();
  if (!ghost.erase && WE().PROP_KINDS.includes(ghost.cat)) {
    const cell = ghost.cat === 'bld' || ghost.cat === 'node';
    drawProp(r, { id: 'ghost', k: ghost.cat, key: ghost.id, x: cell ? x : mouse.x, y: cell ? y : mouse.y, rot: ghost.rot || 0 }, 0.55);
  }
  const s = r.toScreen(x, y);
  diamond(ctx, s, hw, hh);
  ctx.fillStyle = ghost.erase ? '#d4433a55' : '#6fdc3a44'; ctx.fill();
  ctx.strokeStyle = ghost.erase ? '#d4433a' : '#6fdc3a'; ctx.lineWidth = 2; ctx.stroke();
  const ang = [-Math.PI / 4, Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4][(ghost.rot || 0) % 4];
  if (!ghost.erase) { ctx.beginPath(); ctx.moveTo(s.x, s.y + hh); ctx.lineTo(s.x + Math.cos(ang) * hw * 0.6, s.y + hh + Math.sin(ang) * hh * 0.6); ctx.stroke(); }
  ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(ghost.erase ? '🧽 Ластик — щёлкните по объекту' : `${ghost.name || ghost.id} · R — поворот`, s.x, s.y - hh * 0.4);
  ctx.restore();
}
function drawHighlight(r, now) {
  const p = highlight && highlight();
  if (!p) return;
  const ctx = r.ctx, s = r.toScreen(p.x, p.y), k = 1 + 0.15 * Math.sin(now / 180);
  ctx.save(); ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 2.5; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.ellipse(s.x, s.y, r.hw * 0.7 * k, r.hh * 0.7 * k, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
}
export function weScene(scene, r, mouse, now) {
  if (!api) return scene;
  const vr = r.visibleRange ? r.visibleRange() : null, extra = [];
  for (const p of props.values()) {
    if (p.k === 'node') continue; // ресурсные точки рисует base-ui (они в Building.nodes)
    if (vr && (p.x + 5 < vr.x0 || p.x - 1 > vr.x1 || p.y + 5 < vr.y0 || p.y - 1 > vr.y1)) continue;
    extra.push({ obstacle:p.k==='obj'||p.k==='bld', kind:'editor', x: p.x + (p.k === 'bld' ? WE().BLD_SIZE / 2 : 0.5), y: p.y + (p.k === 'bld' ? WE().BLD_SIZE / 2 : 0.5), draw: (rr) => drawProp(rr, p) });
  }
  const over = scene.overlay;
  return { ...scene, props: [...(scene.props || []), ...extra], overlay: (rr, tt) => { drawGhost(rr, mouse); drawHighlight(rr, now); if (over) over(rr, tt); } };
}
