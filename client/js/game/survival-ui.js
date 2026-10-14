// Выживание на клиенте (шаг 9): шкалы в HUD с подсказками, предупреждения, отдых (Z), питьё (G),
// костры и радиоактивные клетки на карте. Всё решает сервер — клиент только показывает и отправляет просьбы.
const S = () => window.Survival;
let sv = null; // { api, state, fires: Map }

export function survivalAttach(api) {
  sv = { api, state: null, fires: new Map() };
  buildHud();
}
export function survivalDetach() { sv = null; const h = document.getElementById('hud-surv'); if (h) h.classList.add('hidden'); }

export function survivalOnWelcome(msg) {
  if (!sv) return;
  sv.fires = new Map((msg.fires || []).map((f) => [f.id, f]));
  if (msg.sv) setState(msg.sv);
}

export function survivalOnMessage(msg) {
  if (!sv) return false;
  switch (msg.t) {
    case 'sv': setState(msg); return true;
    case 'sv-warn': sv.api.toast(msg.text, 4000); return true;
    case 'sv-reject': sv.api.toast(msg.message, 2500); return true;
    case 'fire-add': sv.fires.set(msg.fire.id, msg.fire); return true;
    case 'fire-remove': sv.fires.delete(msg.id); return true;
    default: return false;
  }
}

// Z — сесть/лечь или встать; G — попить из реки/озера
export function survivalKey(e) {
  if (!sv) return false;
  if (e.code === 'KeyZ') {
    e.preventDefault();
    const resting = sv.state && sv.state.resting;
    sv.api.send({ t: 'rest', on: !resting });
    return true;
  }
  if (e.code === 'KeyG') { e.preventDefault(); sv.api.send({ t: 'drink' }); return true; }
  return false;
}
export const survivalResting = () => Boolean(sv && sv.state && sv.state.resting);
export const survivalSpeedMul = () => {
  const st = sv && sv.state;
  if (!st || !st.on || !(st.flags || []).includes('exhausted')) return 1;
  return 1 - (S().settings.survivalExhaustedPenalty || 0);
};

function buildHud() {
  let box = document.getElementById('hud-surv');
  if (!box) return;
  box.classList.remove('hidden');
  if (box.dataset.built) return;
  box.dataset.built = '1';
  for (const m of S().METERS) {
    const el = document.createElement('div');
    el.className = 'surv-meter';
    el.dataset.k = m.k;
    el.innerHTML = `<span class="ic"></span><div class="bar"><div class="fill"></div></div><span class="v"></span>`;
    el.querySelector('.ic').textContent = m.icon;
    el.querySelector('.fill').style.background = m.color;
    box.querySelector('.surv-meters').append(el);
  }
}

function setState(st) {
  sv.state = st;
  const box = document.getElementById('hud-surv');
  if (!box) return;
  box.classList.toggle('off', !st.on);
  const low = S().settings.survivalLow, crit = S().settings.survivalCritical;
  for (const m of S().METERS) {
    const el = box.querySelector(`.surv-meter[data-k="${m.k}"]`);
    if (!el) continue;
    const v = st[m.k] ?? 0;
    el.querySelector('.fill').style.width = v + '%';
    el.querySelector('.v').textContent = String(v);
    const bad = m.k === 'rad' ? v >= S().settings.survivalRadSickAt : v <= crit;
    const warn = m.k === 'rad' ? v > 0 && !bad : v <= low && !bad;
    el.classList.toggle('bad', bad);
    el.classList.toggle('warn', warn);
    el.title = `${m.name}: ${v} из 100. ${m.hint}`;
  }
  const notes = [];
  if (!st.on) notes.push('Выживание в этом мире выключено');
  if (st.resting) notes.push(st.resting === 'sleep' ? `💤 Сон${st.safe ? '' : ' — рядом опасно, отдых медленный'}` : `🪑 Отдых${st.safe ? '' : ' — рядом опасно, отдых медленный'}`);
  if (st.radHere) notes.push(`☢ Радиация здесь: уровень ${st.radHere}`);
  for (const f of st.flags || []) notes.push(S().FLAG_NAMES[f] || f);
  if (st.ill > 0) notes.push(`болезнь ещё ${Math.ceil(st.ill / 60000)} мин`);
  const n = box.querySelector('.surv-notes');
  n.textContent = notes.join(' · ');
  n.classList.toggle('hidden', !notes.length);
}

// Рисование поверх карты: радиоактивные клетки (зелёная дымка), костры, «Zz» над отдыхающим героем
export function survivalDraw(r, now, hero) {
  if (!sv || !r.map) return;
  const ctx = r.ctx, { hw, hh } = r;
  ctx.save();
  if (sv.state && sv.state.on) {
    const grid = S().radGrid(r.map), W = r.map.width, R = r.visibleRange();
    for (let y = R.y0; y <= R.y1; y++) for (let x = R.x0; x <= R.x1; x++) {
      const lvl = grid[y * W + x];
      if (!lvl || (r.fog && !r.fog.known(x, y))) continue; // не разведано (туман войны, шаг 22)
      const p = r.toScreen(x, y);
      ctx.globalAlpha = 0.08 + 0.07 * lvl + 0.03 * Math.sin(now / 400 + x + y);
      ctx.fillStyle = '#9be03a';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + hw, p.y + hh); ctx.lineTo(p.x, p.y + 2 * hh); ctx.lineTo(p.x - hw, p.y + hh);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  for (const f of sv.fires.values()) {
    if (r.fog && !r.fog.known(f.x, f.y)) continue;
    const p = r.toScreen(f.x, f.y), u = hh * 0.9;
    ctx.fillStyle = '#4a2f1a';
    ctx.fillRect(p.x - u * 0.7, p.y - u * 0.12, u * 1.4, u * 0.24);
    for (let i = 0; i < 3; i++) {
      const fl = 0.75 + 0.25 * Math.sin(now / 90 + i * 2.1);
      ctx.fillStyle = ['#ff5a1a', '#ffa52a', '#ffe07a'][i];
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - u * (0.35 + i * 0.12) * fl, u * (0.45 - i * 0.12), u * (0.55 - i * 0.12) * fl, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (hero && survivalResting()) {
    const p = r.toScreen(hero.x, hero.y);
    ctx.fillStyle = '#d8d0ff';
    ctx.font = `${Math.max(10, hh * 0.8)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 300);
    ctx.fillText(sv.state.resting === 'sleep' ? 'Zz' : '…', p.x + hh, p.y - hh * 3.2);
  }
  ctx.restore();
}
