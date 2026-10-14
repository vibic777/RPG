import { drawVehicleModel, vehicleDimensions, vehicleMuzzle } from './vehicle-art.js';
// Транспорт на клиенте (шаг 14): машины на карте (обломки темнее), своя машина — предсказание движения по правилам
// местности (map.drive, как на сервере), панель «Транспорт» (Shift+Y): прочность, топливо, места, багажник.
// Клавиши: Y — сесть/выйти, J — заправить, O — починить, M — запереть; PageUp/PageDown — высота (авиация).
// Всё решает сервер: клиент шлёт veh-enter / veh-exit / veh-refuel / veh-repair / veh-lock / veh-cargo.
const VV = () => window.Vehicles;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let api = null; // { send, toast, you, map: () => карта, hero, others, character }
const st = { list: new Map(), seat: null, hintAt: 0, hintId: '', open: false, weapon: {} }; // weapon: id машины -> выбранный вид оружия
function rememberVehicle(v) {
  const previous=st.list.get(v.id);
  st.list.set(v.id,{...v,facingAngle:Number.isFinite(v.facingAngle)?v.facingAngle:previous&&previous.facingAngle,visualOdometer:previous?.visualOdometer,visualPosition:previous&&previous.visualPosition});
}

export function vehHover(sx,sy,r){
  let hit=null,depth=-Infinity;
  for(const v of st.list.values()){const p=drawPos(v),s=r.toScreen(p.x,p.y),d=VV().get(v.def);if(!d)continue;
    if(r.fog&&!r.fog.see(p.x,p.y))continue;
    if(Math.abs(sx-s.x)<r.hw*2.5&&sy>s.y-r.hh*4&&sy<s.y+r.hh&&p.x+p.y>depth){hit=v;depth=p.x+p.y;}
  }return hit;
}
export function vehAttach(a) { api = a; }
export function vehOnWelcome(msg) {
  st.list = new Map((msg.vehicles || []).map((v) => [v.id, v]));
  st.seat = null;
  applyDrive();
  renderHud(); renderPanel();
}
export function vehOnMessage(msg) {
  switch (msg.t) {
    case 'veh-upd': rememberVehicle(msg.v); if (st.seat && st.seat.id === msg.v.id) st.seat.v = msg.v; applyDrive(); renderHud(); renderPanel(); return true;
    case 'veh-remove': st.list.delete(msg.id); if (st.seat && st.seat.id === msg.id) st.seat = null; applyDrive(); renderHud(); renderPanel(); return true;
    case 'veh-seat':
      st.seat = msg.id ? { id: msg.id, seat: msg.seat, def: msg.def, alt: msg.alt || 0, v: msg.v } : null;
      if (msg.v) rememberVehicle(msg.v);
      applyDrive(); renderHud(); renderPanel();
      return true;
    case 'veh-reject': api.toast(msg.message, 3000); return true;
    case 'lv': if (st.seat && (msg.alt || 0) !== st.seat.alt) { st.seat.alt = msg.alt || 0; applyDrive(); renderHud(); } return false; // шкала уровней тоже обрабатывает
    default: return false;
  }
}
// Правила местности машины — для предсказания движения водителя (сервер считает так же)
function applyDrive() {
  const m = api && api.map();
  if (!m) return;
  const def = st.seat && VV().get(st.seat.def),hero = api.hero(),v=st.seat&&(st.list.get(st.seat.id)||st.seat.v);
  hero.seated = Boolean(def); hero.vehicleHidden = Boolean(def); hero.ride = null;hero.vehicleCockpit=false;
  if(def&&v) hero.facingAngle=v.facingAngle||0;
  m.drive = def && st.seat.seat === 0 ? VV().drive(def,st.seat.alt,v?.facingAngle??hero.facingAngle??0) : null;
  if (api.refreshGrid) api.refreshGrid();
}
export const vehRefreshDrive = applyDrive;
// Множитель скорости: null — не в машине; седок — 0
export function vehSpeedMul() {
  if (!st.seat) return null;
  if (st.seat.seat !== 0) return 0;
  const def = VV().get(st.seat.def), v = st.list.get(st.seat.id) || st.seat.v;
  if (!def || !v) return 0;
  if (def.fuel.type !== 'none' && v.fuel <= 0 && !(api.god && api.god() && api.god().vehicleFuel)) return 0;
  return VV().speedMul(def, v, window.Movement.settings.heroSpeed);
}
export const vehSeat = () => st.seat;
// ---------- Бортовое оружие: выбор вида (1–9, [ ]), профиль для ЛКМ, боезапас ----------
// Место с оружием: водитель или стрелок вооружённой машины
function armedSeat() {
  if (!st.seat) return null;
  const def = VV().get(st.seat.def);
  const groups = def ? VV().armsOf(def) : [];
  if (!groups.length || (st.seat.seat !== (def.gunner ?? 0) && st.seat.seat !== 0)) return null;
  return { def, groups };
}
// Выбранная группа ({ id, type, name, icon, item, ... }) или null — не на месте с оружием
export function vehWeapon() {
  const a = armedSeat();
  if (!a) return null;
  return a.groups.find((g) => g.id === st.weapon[st.seat.id]) || a.groups[0];
}
// Профиль атаки группы (как у сервера): предмет-оружие или вид из shared/vehicles.js
export function vehWeaponProfile(g) {
  if (!g) return null;
  return g.item ? window.Combat.profile(window.Items.get(g.item)) : VV().armProfile(g.type);
}
function selectWeapon(id) {
  const a = armedSeat();
  if (!a || !st.seat) return;
  const g = a.groups.find((x) => x.id === id);
  if (!g) return;
  st.weapon[st.seat.id] = id;
  api.toast(`Оружие: ${g.icon} ${g.name}${ammoText(g)}`, 1600);
  renderHud();
}
function ammoOf(id) {
  if (!id) return Infinity;
  const ch = api.character(), item = window.Items.get(id);
  const cells = (ch.inventory && ch.inventory.cells) || [];
  return cells.reduce((n, x) => n + (x && x.id === id ? (x.n || 1) * ((item && item.rounds) || 1) : 0), 0) + ((ch.ammoOpen && ch.ammoOpen[id]) || 0);
}
function ammoText(g) {
  const p = vehWeaponProfile(g);
  if (!p || !p.ammo) return '';
  const god = api.god && api.god() && api.god().vehicleAmmo;
  return god ? ' · ∞' : ` · ${ammoOf(p.ammo)} шт.`;
}
export function vehShotMuzzle(x,y,owner,angle){
  if(!api)return null;
  for(const v of st.list.values())if(v.seats?.includes(owner)&&Math.hypot(v.x-x,v.y-y)<0.6)return vehicleMuzzle(v,angle)||null;
  return null;
}
export function vehAim(x, y) {
  if (!api || !st.seat || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const def = VV().get(st.seat.def);
  if (!def || !VV().armsOf(def).length || (st.seat.seat !== (def.gunner ?? 0) && st.seat.seat !== 0)) return;
  const v = st.list.get(st.seat.id) || st.seat.v;
  const turrets = VV().turretsOf(def);
  if (!v || !turrets.front && !turrets.rear) return;
  const dir = (Math.round(Math.atan2(y - v.y, x - v.x) / (Math.PI / 4)) + 8) % 8;
  const bearing=Math.atan2(y-v.y,x-v.x),heading=Number.isFinite(v.facingAngle)?v.facingAngle:0;
  const delta=Math.atan2(Math.sin(bearing-heading),Math.cos(bearing-heading));
  const rear=Boolean(turrets.rear&&(Math.abs(delta)>Math.PI/2||!turrets.front)),key=rear?'rearTurretDir':'turretDir';
  if(v&&v[key]===dir)return;
  if(v)v[key]=dir;
  if(st.seat.v)st.seat.v[key]=dir;
  api.send({ t: 'veh-aim', x, y });
}

function nearestVeh() {
  const h = api.hero();
  let best = null, bd = Infinity;
  for (const v of st.list.values()) { const d = VV().pointBodyDistance(h,VV().bodyAt(v.def,v)); if (d < bd) { bd = d; best = v; } }
  const def = best && VV().get(best.def);
  return best && bd <= (window.GameSettings.vehicleEnterRange || 2.2) + def.radius ? best : null;
}
export function vehKey(e) {
  if (!api || !VV()) return false;
  if (e.code === 'KeyY' && e.shiftKey) { e.preventDefault(); st.open = !st.open; renderPanel(); return true; }
  if (e.code === 'KeyY') { e.preventDefault(); if (st.seat) api.send({ t: 'veh-exit' }); else { const v = nearestVeh(); if (v) api.send({ t: 'veh-enter', id: v.id }); else api.toast('Рядом нет машины.'); } return true; }
  const armed = armedSeat();
  if (armed && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    const n = /^Digit([1-9])$/.exec(e.code);
    if (n && armed.groups[Number(n[1]) - 1]) { e.preventDefault(); selectWeapon(armed.groups[Number(n[1]) - 1].id); return true; }
    if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      e.preventDefault();
      const cur = vehWeapon(), i = armed.groups.indexOf(cur), k = armed.groups.length;
      selectWeapon(armed.groups[(i + (e.code === 'BracketRight' ? 1 : k - 1)) % k].id);
      return true;
    }
  }
  const v = st.seat ? st.list.get(st.seat.id) : nearestVeh();
  const act = { KeyJ: 'veh-refuel', KeyO: 'veh-repair', KeyM: 'veh-lock' }[e.code];
  if (act) { e.preventDefault(); if (v) api.send({ t: act, id: v.id }); else api.toast('Рядом нет машины.'); return true; }
  return false;
}

// Каждый кадр: подсказка у машины
export function vehFrame(now) {
  if (!api || !VV() || now - st.hintAt < 500) return;
  st.hintAt = now;
  const v = st.seat ? st.list.get(st.seat.id) : nearestVeh();
  const id = v ? v.id : '';
  if (id !== st.hintId) { st.hintId = id; renderHud(); if (!st.seat) renderPanel(); }
}

// Позиция машины для отрисовки: с водителем — где рисуется водитель (плавно)
function drawPos(v) {
  const d = v.seats && v.seats[0];
  if (d && d === api.you) { const h = api.hero(); return { x: h.x, y: h.y }; }
  const o = d && api.others().get(d);
  return o ? { x: o.x, y: o.y } : { x: v.x, y: v.y };
}
// Сцена: техника рисуется по глубине; все находящиеся внутри персонажи скрыты.
export function vehScene(scene) {
  if (!api) return scene;
  for (const other of api.others().values()) { other.seated = false; other.vehicleHidden = false; other.ride = null;other.vehicleCockpit=false; }
  if (!st.list.size) return scene;
  const props = [];
  for (const v of st.list.values()) {
    const p = drawPos(v), def = VV().get(v.def);
    if (!def) continue;
    const alt = st.seat && st.seat.id === v.id ? st.seat.alt : v.alt || 0;
    const old = v.visualPosition;
    const dx = old ? p.x - old.x : 0, dy = old ? p.y - old.y : 0;
    if (Math.hypot(dx, dy) > 0.0001) v.facingAngle = VV().motionHeading(v.facingAngle||0,dx,dy);
    v.moving = Math.hypot(dx, dy) > 0.0001;
    v.visualPosition = { ...p };
    for (const id of v.seats || []) {
      const other = id && api.others().get(id);
      if (other) { other.seated = true; other.vehicleHidden = true; }
    }
    props.push({ x: p.x - 0.02, y: p.y - 0.02, layer: alt > 0 ? alt : 0,boundsRadius:Math.hypot(...vehicleDimensions(def.id).slice(0,2))/(2*VV().M_PER_TILE), draw: (r, time) => drawVehicle(r, def, v, p, alt, time) }); // в воздухе — поверх наземной техники
  }
  return { ...scene, props: [...(scene.props || []), ...props] };
}
function drawVehicle(r, def, v, p, alt, time) {
  const s = r.toScreen(p.x, p.y);
  const unit=r.hh*0.9;
  if (alt < 0) { drawSubmerged(r, def, v, s, unit, alt, time); return; }
  drawVehicleModel(r.ctx, def, v, s.x, s.y, unit, v.facingAngle || 0, time, alt, r.quality);
  if (v.hp < v.maxHp) {
    const dimensions=vehicleDimensions(def.id);
    const w = r.hw * Math.max(0.8, dimensions[0]), y = s.y - alt * 10 - unit*(3.3/1.75)*(dimensions[2]+dimensions[1]*0.3)-6;
    r.ctx.fillStyle = '#101418cc'; r.ctx.fillRect(s.x - w / 2, y, w, 3);
    r.ctx.fillStyle = v.hp / v.maxHp > 0.35 ? '#b4c18c' : '#cc7355'; r.ctx.fillRect(s.x - w / 2, y, w * Math.max(0, v.hp / v.maxHp), 3);
  }
}

// Подлодка под водой (alt −1…−5): чем глубже, тем прозрачнее и синее; над ней — рябь и пузыри
function drawSubmerged(r, def, v, s, unit, alt, time) {
  const ctx = r.ctx, depth = Math.min(5, -alt);
  ctx.save();
  ctx.globalAlpha = Math.max(0.12, 0.62 - depth * 0.1);
  drawVehicleModel(ctx, def, v, s.x, s.y, unit, v.facingAngle || 0, time, 0, r.quality);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.18 + depth * 0.06;
  ctx.fillStyle = '#1f5f86';
  const w = r.hw * Math.max(1, vehicleDimensions(def.id)[1] * 0.45);
  ctx.beginPath(); ctx.ellipse(s.x, s.y - unit * 0.2, w, w * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.5; ctx.strokeStyle = '#bfe6f5'; ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) { const k = ((time / 900 + i / 3) % 1); ctx.beginPath(); ctx.ellipse(s.x, s.y - unit * 0.2, w * (0.3 + k * 0.7), w * 0.42 * (0.3 + k * 0.7), 0, 0, Math.PI * 2); ctx.globalAlpha = 0.4 * (1 - k); ctx.stroke(); }
  ctx.globalAlpha = 0.9; ctx.fillStyle = '#e8f6ff'; ctx.font = `${Math.max(9, unit * 0.4)}px sans-serif`; ctx.textAlign = 'center';
  ctx.fillText(`⬇ ${alt}`, s.x, s.y - unit * 1.2);
  ctx.restore();
}

// Точки техники на миникарте (голубые, своя — белая)
export function vehMinimap(ctx, toMini) {
  if (!api) return;
  for (const v of st.list.values()) {
    const p = toMini(v.x, v.y);
    ctx.fillStyle = v.owner === api.you ? '#ffffff' : v.wreck ? '#6a8a9a' : '#5ac8ff';
    ctx.fillRect(p.x - 1, p.y - 1, 2.5, 2.5);
  }
}

// ---------- HUD и панель ----------
function renderHud() {
  const el = $('#hud-veh');
  if (!el) return;
  const seated = Boolean(st.seat);
  const v = seated ? st.list.get(st.seat.id) : nearestVeh();
  el.classList.toggle('hidden', !v);
  if (!v) return;
  const def = VV().get(v.def);
  const role = !seated ? 'рядом · Y — сесть' : st.seat.seat === 0 ? 'водитель · Y — выйти' : st.seat.seat === def.gunner ? 'стрелок' : 'пассажир';
  const dive = seated && st.seat.seat === 0 && VV().canDive(def) && !(api.map() && api.map().level)
    ? `<span title="Глубина: 0 — на поверхности, до −${Math.min(5, VV().settings.vehicleDiveMaxDepth)} (не глубже дна: чем дальше от берега, тем глубже)">глубина ${st.seat.alt || 0}</span><button type="button" class="btn small icon-button" data-veh-control="up" aria-label="Всплыть на уровень" title="PageUp — подняться на уровень; 0 — всплыть на поверхность (выйти можно только на поверхности)">⬆</button><button type="button" class="btn small icon-button" data-veh-control="down" aria-label="Погрузиться на уровень" title="PageDown — погрузиться на уровень (до −5). Под водой враги вас не видят; стреляют только торпеды и управляемые ракеты">⬇</button>` : '';
  const armed = armedSeat();
  const weapons = armed ? '<span class="veh-arms">' + armed.groups.map((g, i) => `<button type="button" class="btn small${g === vehWeapon() ? ' active' : ''}" data-veh-weapon="${g.id}" title="${i + 1} — выбрать: ${esc(g.name)}${g.guided ? ' (наводится на цель под курсором)' : ''}${g.water ? ' (только по воде)' : ''}${g.air ? ' (только в полёте, падает в точку)' : ''}${g.deep ? '; стреляет и из-под воды' : ''}. Установок: ${g.mounts.length}. Огонь — ПКМ, ЛКМ по цели или Shift+ЛКМ в точку.">${i + 1} ${g.icon}${esc(ammoText(g).replace(' · ', ' '))}</button>`).join('') + '</span>' : '';
  const controls = dive + (seated && st.seat.seat === 0 && def.fly
    ? '<button type="button" class="btn small icon-button" data-veh-control="up" aria-label="Взлететь или подняться" title="PageUp — взлететь / подняться на уровень (до +10). На +1…+5 дома, лес и скалы — препятствия: удар повреждает машину; с +6 небо свободно">⬆</button><button type="button" class="btn small icon-button" data-veh-control="down" aria-label="Снизиться или сесть" title="Снизиться на один уровень; уровень 0 — посадка. Самолёту нужна ровная полоса">⬇</button>'
    : seated && (def.submersible || def.id === 'submarine' || def.id === 'deep_submarine')
      ? '<button type="button" class="btn small" data-veh-control="dive" title="Переход на подводный уровень у отмеченного места погружения (U)">🌊 U · Место погружения</button>' : '') + weapons;
  el.innerHTML = `<span>${def.icon} ${esc(def.name)} · прочность ${Math.round((v.hp / v.maxHp) * 100)}%${def.fuel.type !== 'none' ? ` · топливо ${Math.floor(v.fuel)}/${v.cap}` : ''} · ${role}</span> ${controls} <button type="button" class="btn small" data-veh-help>Как управлять?</button>`;
  el.title = `${def.desc} Нажмите «Как управлять?» — подробная инструкция останется открытой.`;
  el.querySelector('[data-veh-help]').onclick = () => { st.open = true; renderPanel(); };
  el.querySelectorAll('[data-veh-weapon]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); selectWeapon(b.dataset.vehWeapon); }; });
}
function renderPanel() {
  const box = $('#veh-window');
  if (!box) return;
  box.classList.toggle('hidden', !st.open);
  if (!st.open || !api) return;
  const v = st.seat ? st.list.get(st.seat.id) : nearestVeh();
  const body = $('#veh-body');
  if (!v) { body.innerHTML = '<p class="muted">Рядом нет машины. Подойдите к технике на карте (голубые точки на миникарте).</p>'; return; }
  const def = VV().get(v.def), I = window.Items;
  const fuelId = VV().FUELS[def.fuel.type].item;
  const fuelItem = fuelId && I.get(fuelId);
  const inventory = api.character().inventory;
  const fuelCount = fuelId ? (inventory.cells || []).reduce((n, x) => n + (x && x.id === fuelId ? x.n || 1 : 0), 0) : 0;
  const fuelRounds = fuelCount * (fuelItem && fuelItem.rounds || 1) + (fuelId && api.character().ammoOpen && api.character().ammoOpen[fuelId] || 0);
  const partsCount = (inventory.cells || []).reduce((n, x) => n + (x && x.id === 'veh_parts' ? x.n || 1 : 0), 0);
  const engineering = api.character().stats && api.character().stats.engineering || 0;
  const fuelPlan = {
    fuel_gas: 'Бензин можно сделать на химическом столе: 4 дерева + 1 пластик; нужен Интеллект 3. Также ищите канистры в добыче.',
    fuel_diesel: 'Солярка попадается в добыче с противников и в тайниках; рецепта производства сейчас нет.',
    fuel_avia: 'Авиатопливо попадается в добыче с противников и в тайниках; рецепта производства сейчас нет.',
    ammo_cell: 'Энергоячейку можно собрать на столе электроники: 2 электроники + 1 пластик + 1 металлолом; нужна Инженерия 3. Ячейки также встречаются в добыче.'
  }[fuelId] || 'Этому транспорту топливо не требуется.';
  const terr = Object.entries(def.terrain).map(([k, f]) => `${VV().TERRAIN[k]} ×${f}`).join(', ');
  const seats = v.seats.map((id, i) => `<li>${i === 0 ? 'Водитель' : i === def.gunner ? 'Стрелок' : 'Пассажир'}: ${id ? esc(v.names[i] || '?') : '<span class="muted">свободно</span>'}</li>`).join('');
  const cargo = (v.cargo || []).map((x, i) => x ? `<li>${esc((I.get(x.id) || { name: x.id }).name)}${x.n > 1 ? ' × ' + x.n : ''} <button data-take="${i}" title="Забрать в сумку">Взять</button></li>` : '').join('');
  const cells = (api.character().inventory.cells || []).map((x, i) => x ? `<option value="${i}">${esc((I.get(x.id) || { name: x.id }).name)}${x.n > 1 ? ' × ' + x.n : ''}</option>` : '').join('');
  body.innerHTML = `
    <h3>${def.icon} ${esc(def.name)}${v.wreck ? ' <span class="bad">(разбит)</span>' : ''}</h3>
    <p class="muted">${esc(def.desc)}</p>
    <p>Прочность: ${Math.round(v.hp)} / ${v.maxHp} · броня ${def.armor}${def.open ? ' (открытая — не защищает)' : ''}<br>
    Топливо: ${def.fuel.type === 'none' ? 'не нужно' : `${Math.floor(v.fuel)} / ${v.cap} (${VV().FUELS[def.fuel.type].name}, ${def.fuel.perTile} на клетку)`}${def.staminaPerSec ? ` · выносливость −${def.staminaPerSec}/с` : ''}<br>
    Масса: ${def.mass} т · габариты: ${vehicleDimensions(def.id).map(n=>n.toLocaleString('ru-RU')).join(' × ')} м<br>
    ${def.walker?'Давит опорной ногой':def.tracked||def.id==='ifv'?'Давит гусеницами':'На скорости сбивает и отбрасывает'}<br>
    Скорость: ${def.speed} кл/с · местность: ${esc(terr)}${def.eng ? `<br>Ремонт — Инженерия ${def.eng}+` : ''}<br>
    Хозяин: ${v.ownerName ? esc(v.ownerName) : 'ничья (первый водитель станет хозяином)'}${v.locked ? ' · заперта' : ''}</p>
    <ul>${seats}</ul>
    ${def.cargo ? `<h4>Багажник (${(v.cargo || []).filter(Boolean).length}/${def.cargo})</h4><ul>${cargo || '<li class="muted">пусто</li>'}</ul>
    <p><select id="veh-put">${cells}</select> <button id="veh-put-btn" title="Положить выбранный предмет из сумки в багажник">В багажник</button></p>` : ''}
    <p><button data-a="veh-refuel" ${def.fuel.type === 'none' ? 'disabled' : ''}>Заправить (J)</button> <button data-a="veh-repair">Починить (O)</button> <button data-a="veh-lock">${v.locked ? 'Отпереть (M)' : 'Запереть (M)'}</button></p>
    ${def.fuel.type !== 'none' ? `<p class="veh-resource">Топливо в сумке: <b>${fuelRounds}</b> ед. ${fuelRounds ? 'Подойдите к машине и нажмите J.' : 'Подходящего топлива пока нет — где его взять, указано ниже.'}</p>` : ''}
    ${v.hp < v.maxHp ? `<p class="veh-resource">Автозапчасти в сумке: <b>${partsCount}</b>. O — мгновенный ремонт, до 100% при достаточном запасе. Без запчастей сядьте внутрь: медленный бесплатный ремонт, даже из разбитого состояния.</p>` : ''}
    <details open class="veh-guide"><summary>Пошаговая инструкция и ресурсы</summary>
      <ol><li>Подойдите к машине и нажмите <b>Y</b>, чтобы занять свободное место. Первое место — водитель. Чтобы выйти, нажмите Y в безопасном месте, где машине разрешено покинуть салон.</li>
      <li>Водитель управляет как героем: <b>WASD</b> или щелчок по земле. Следите за полосой топлива: без него моторная техника остановится. У вертолёта и самолёта нажимайте кнопки <b>⬆ / ⬇</b> в строке машины рядом с миникартой или клавиши <b>PageUp / PageDown</b>: это взлёт, набор высоты, снижение и посадка на уровень 0 (потолок +10). Самолёту нужна ровная полоса. На +1…+5 дома, лес и скалы — препятствия: удар о них повреждает машину, поднимитесь выше.</li>
      <li><b>Оружие</b> (водитель или стрелок): ${armsList(def)}. Выбор — клавиши <b>1–${Math.max(1, VV().armsOf(def).length)}</b>, <b>[ ]</b> или кнопки в строке машины; огонь выбранным — <b>ПКМ</b> (водитель: ЛКМ по земле — ехать), <b>ЛКМ</b> по цели или <b>Shift+ЛКМ</b> в точку. Пули и снаряды вылетают из стволов, ракеты — с пилонов, торпеды — из аппаратов; башня стреляет только в своём секторе. Управляемая ракета наводится на цель под курсором, торпеда идёт только по воде, бомба падает в точку (только в полёте). Боеприпасы берутся из сумки стреляющего.</li>
      ${VV().canDive(def) ? '<li><b>Погружение:</b> <b>PageDown</b> или ⬇ — на уровень глубже (до −5 и не глубже дна: у берега мелко), <b>PageUp</b> или ⬆ — выше, 0 — поверхность. Под водой враги вас не видят; стреляют только торпеды и управляемые ракеты; выйти можно только на поверхности. Кнопка <b>🌊 U</b> — переход на подводный уровень у отмеченного места погружения.</li>' : ''}
      <li><b>Топливо:</b> нужно держать подходящий предмет в сумке. Сейчас доступно: ${fuelRounds} ед. ${esc(fuelPlan)} Нажмите <b>J</b> или кнопку «Заправить»: игра сама возьмёт нужное количество. Одна канистра бензина содержит 20 единиц, бочонок солярки — 30, авиаканистра — 25, энергоячейка — 20.</li>
      <li><b>Ремонт:</b> нужны автозапчасти. Их можно изготовить в кузнице из 4 металлолома и 1 пластика (Инженерия 2) или найти в тайниках и добыче с врагов. Нажмите <b>O</b>. В поле прочность восстанавливается максимум до ${VV().settings.vehicleFieldRepairMaxPct}%; для ремонта до 100% подъедьте к верстаку своей базы. Тяжёлой технике также может требоваться Инженерия ${def.eng || 0}.</li>
      <li>Подробная панель всегда открывается этой кнопкой или <b>Shift+Y</b>. В ней видны места, груз, прочность и топливо. В багажник можно переложить предметы из сумки, а потом забрать их обратно.</li></ol>
    </details>`;
  body.querySelectorAll('button[data-a]').forEach((b) => { b.onclick = () => api.send({ t: b.dataset.a, id: v.id }); });
  body.querySelectorAll('button[data-take]').forEach((b) => { b.onclick = () => api.send({ t: 'veh-cargo', id: v.id, op: 'take', i: Number(b.dataset.take) }); });
  const put = $('#veh-put-btn');
  if (put) put.onclick = () => { const sel = $('#veh-put'); if (sel && sel.value !== '') api.send({ t: 'veh-cargo', id: v.id, op: 'put', i: Number(sel.value) }); };
}
export function vehInit() {
  const close = $('#btn-veh-close');
  if (close) close.onclick = () => { st.open = false; renderPanel(); };
  const hud = $('#hud-veh');
  if (hud) hud.addEventListener('click', (e) => {
    const control = e.target.closest('[data-veh-control]');
    if (control) {
      e.preventDefault(); e.stopPropagation();
      const action = control.dataset.vehControl;
      api.send(action === 'dive' ? { t: 'lvl-go' } : { t: 'lvl-alt', d: action === 'up' ? 1 : -1 });
      return;
    }
    const weapon = e.target.closest('[data-veh-weapon]');
    if (weapon) {
      e.preventDefault(); e.stopPropagation();
      selectWeapon(weapon.dataset.vehWeapon);
      return;
    }
    if (!e.target.closest('[data-veh-help]')) { st.open = true; renderPanel(); }
  });
}

// Виды оружия машины для справки и панели
function armsList(def) {
  const g = VV().armsOf(def);
  return g.length ? g.map((x, i) => `${i + 1} ${x.icon} ${esc(x.name)}${x.mounts.length > 1 ? ' ×' + x.mounts.length : ''}`).join(', ') : 'нет (седок стреляет своим оружием)';
}
// Справка (client/js/help.js)
export function vehiclesHelp() {
  const V = VV();
  if (!V) return '';
  const rows = V.LIST.map((d) => `<tr><td>${d.icon} ${esc(d.name)}</td><td>${d.speed}</td><td>${Object.keys(d.terrain).map((k) => V.TERRAIN[k]).join(', ')}</td><td>${d.seats}</td><td>${esc(V.FUELS[d.fuel.type].name)}</td><td>${d.hp} / ${d.armor}</td><td>${d.cargo}</td><td>${armsList(d)}</td></tr>`).join('');
  return `<p>Техника отмечена голубыми точками на миникарте. Подойдите к точке: появится постоянная строка с названием машины и кнопкой <b>«Как управлять?»</b> — подсказка не исчезает как уведомление. Эту же панель можно открыть клавишами <b>Shift+Y</b> или кнопкой в строке транспорта. Большинство найденных машин — обломки; ремонтируйте их автозапчастями.</p>
    <h4>Какая техника встречается</h4><p>В мире есть верховые животные, лёгковые и бронированные автомобили, грузовики с прицепами, автобусы, бронетранспортёры и танки. На воде встречаются лодки и гидроциклы, под водой — обычная и глубоководная подлодки, в воздухе — самолёт и вертолёт. Из шагающих машин доступны боевой мех, двуногий робот-«курица» и тяжёлый четвероногий робот-«слон». Для основных классов есть несколько моделей; названия, характеристики и места видны в таблице ниже.</p>
    <p>Животное можно оседлать без топлива. Грузовик с прицепом — единая управляемая машина с увеличенным багажником. Мехи и шагающие роботы управляются как обычная техника; у вооружённой модели есть место стрелка. У шагающих роботов и крупных грузовиков больше радиус, поэтому оставляйте им свободное место.</p>
    <h4>Первый запуск: коротко и по порядку</h4><ol>
    <li>Найдите голубую точку техники на миникарте и подойдите к машине. Нажмите <b>Y</b>, чтобы сесть; если мест несколько — Y занимает свободное.</li>
    <li>Водитель — место 1. Двигайтесь клавишами <b>WASD</b> или щёлкните по месту назначения. Пассажир не управляет машиной. Для выхода нажмите Y в безопасном месте.</li>
    <li><b>Бортовое оружие</b> — у каждой боевой машины 3–5 видов (таблица ниже): клавиши <b>1–9</b> или <b>[ ]</b> выбирают вид, огонь выбранным — <b>ПКМ</b>, <b>ЛКМ</b> по цели или <b>Shift+ЛКМ</b> в точку (водитель щелчком по земле едет). Пушки и пулемёты стреляют из стволов, ракеты — с пилонов, торпеды — из торпедных аппаратов; поворотная башня бьёт только в своём секторе. Управляемые ракеты доворачивают к цели под курсором; торпеды идут только по воде и взрываются у берега; бомбы падают в точку прицела (только в полёте). Высота полёта вертолёта и самолёта — до +10. Спутников можно посадить в транспорт кнопкой <b>＋</b> на панели спутников или клавишей <b>+</b> (до 11), высадка — когда водитель выходит.</li>
    <li>Нажмите <b>Shift+Y</b> или «Как управлять?» и проверьте топливо. Для заправки положите подходящий предмет в сумку и нажмите <b>J</b>. Игра сама заберёт только нужное количество зарядов.</li>
    <li>В разбитую машину можно сесть. Пока внутри есть седок, прочность восстанавливается медленно; двигатель заработает выше ${V.settings.vehicleWreckMinPct}%. Автозапчасти и <b>O</b> чинят мгновенно, до 100% при достаточном запасе.</li>
  </ol>
  <h4>Где брать топливо и запчасти</h4><ul>
    <li><b>Автозапчасти:</b> крафт в кузнице из 4 металлолома и 1 пластика (Инженерия 2); также добыча из тайников и врагов. Большие машины требуют Инженерию, указанную в их панели.</li>
    <li><b>Бензин:</b> химический стол, рецепт — 4 дерева и 1 пластик (Интеллект 3); канистры также можно найти в добыче.</li>
    <li><b>Солярка и авиатопливо:</b> сейчас выпадают в добыче с противников и в тайниках; отдельного рецепта крафта нет.</li>
    <li><b>Энергоячейки для подлодки:</b> стол электроники, 2 электроники + 1 пластик + 1 металлолом (Инженерия 3); также встречаются в добыче.</li>
    <li>Одна канистра бензина даёт 20 зарядов, бочонок солярки — 30, авиаканистра — 25, энергоячейка — 20. Тип нужного топлива показан в панели машины.</li>
  </ul>
  <ul>
    <li><b>Y</b> — сесть / выйти. Первый водитель ничейной машины становится хозяином; <b>M</b> — запереть (водить и садиться смогут только вы и допущенные на вашу базу).</li>
    <li>За рулём — обычное движение (WASD или щелчок): у каждой машины своя местность (дорога, бездорожье, вода, дно, воздух) и скорость. Удар о стену на скорости повреждает машину, наезд на врага — <b>таран</b>.</li>
    <li><b>J</b> — заправить подходящим предметом из сумки. Одна канистра бензина даёт 20 единиц, бочонок солярки — 30, авиаканистра — 25, энергоячейка — 20. Без топлива машина стоит.</li>
    <li>Места: водитель, <b>стрелок</b> (место 2 у машин с бортовым оружием), пассажиры. Бортовым оружием управляют водитель и стрелок: башня поворачивается за курсором, боеприпасы берутся из сумки стреляющего (снаряды 30 мм, 125 мм, ракеты, управляемые ракеты, торпеды, авиабомбы — крафт на гаражном стенде). Закрытая машина принимает удары на себя (броня), открытая (мотоцикл, лодка) — нет.</li>
    <li><b>Подлодка</b> погружается клавишей <b>PageDown</b> (или ⬇ в строке машины) — до −5, но не глубже дна (у берега мелко, мористее глубже), всплывает <b>PageUp</b> (⬆). Под водой её не видят враги, стреляют только торпеды и ракеты, выйти можно только всплыв. На подводные уровни — через отмеченные места погружения клавишей U (🌊). <b>Вертолёт</b> и <b>самолёт</b> меняют высоту кнопками ⬆/⬇ у строки машины или PageUp/PageDown; самолёту нужна ровная полоса для посадки. Выйти в воздухе нельзя (или падение — по настройке сервера). Высота до <b>+10</b>: на <b>+1…+5</b> — низкий полёт среди домов и деревьев: врезаться в дом выше вас, лес (+2), скалы (+4) или стены поселения (+1) — удар, отброс и урон машине; с <b>+6</b> небо свободно.</li>
    <li><b>Shift+Y</b> — открыть или закрыть постоянную панель машины: прочность, топливо, места, багажник и инструкция. Рядом с найденной машиной панель также открывает кнопка «Как управлять?» под миникартой.</li>
  </ul>
  <table class="help-table"><tr><th>Машина</th><th>кл/с</th><th>Местность</th><th>Мест</th><th>Топливо</th><th>Прочн./броня</th><th>Багаж</th><th>Оружие</th></tr>${rows}</table>
    <p class="muted">Количество природной техники поддерживается постоянным: если машина уничтожена, через ${Math.max(0, Number(V.settings.vehicleRespawnSec ?? 60))} сек. случайным образом появляется исправная модель в подходящем месте карты. Редкая водная и воздушная техника появляется только в подходящей местности.</p>`;
}
