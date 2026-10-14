// Шаг 20: кадры и производительность клиента — ограничение FPS, простой, батарея, автокачество, оверлей F8.
// Логика без DOM (FrameGovernor) проверяется тестами; оверлей и батарея — тонкие обёртки над браузером.

// Решает, рисовать ли кадр в этом requestAnimationFrame, и следит за FPS
export class FrameGovernor {
  // o: { cap (30 / 60 / 0 — без ограничения), idleFps, idleAfterSec, autoFps (0 — без автокачества), lowSec, cooldownSec }
  constructor(o = {}) {
    this.cap = o.cap ?? 60;
    this.idleFps = o.idleFps ?? 20;
    this.idleAfter = (o.idleAfterSec ?? 3) * 1000;
    this.autoFps = o.autoFps ?? 24;
    this.lowMs = (o.lowSec ?? 4) * 1000;
    this.cooldownMs = (o.cooldownSec ?? 10) * 1000;
    this.next = 0; this.lastActive = -Infinity; this.times = []; this.costs = []; this.lowSince = 0; this.cooldownUntil = 0; this.startedAt = null;
  }
  setCap(cap) { this.cap = cap; this.next = 0; }
  // ввод игрока или движение на экране — не простой
  touch(now) { this.lastActive = now; }
  idle(now) { return now - this.lastActive > this.idleAfter; }
  // целевой FPS сейчас (0 — без ограничения)
  target(now) {
    if (this.idle(now)) return this.cap > 0 ? Math.min(this.cap, this.idleFps) : this.idleFps;
    return this.cap;
  }
  // рисовать ли кадр: расписание с шагом 1000/FPS (без накопления долга), допуск 1 мс на дрожание rAF
  shouldDraw(now) {
    if (this.startedAt === null) this.startedAt = now;
    const fps = this.target(now);
    if (!(fps > 0)) return true;
    const iv = 1000 / fps;
    if (now < this.next - 1) return false;
    this.next = now - this.next < iv ? this.next + iv : now + iv; // опоздали больше чем на шаг — расписание заново
    return true;
  }
  // кадр нарисован за costMs миллисекунд
  drawn(now, costMs = 0) {
    this.times.push(now); this.costs.push(costMs);
    while (this.times.length && now - this.times[0] > 1000) { this.times.shift(); this.costs.shift(); }
  }
  fps() { return this.times.length; }
  frameMs() { return this.costs.length ? this.costs.reduce((a, b) => a + b, 0) / this.costs.length : 0; }
  // автокачество: FPS ниже порога lowSec подряд (не в простое и не из-за своего же ограничения) — снизить на ступень.
  // Возвращает новое качество или null.
  autoCheck(now, quality, lower) {
    if (!(this.autoFps > 0) || this.idle(now) || now - (this.startedAt ?? now) < 3000) { this.lowSince = 0; return null; }
    if (this.cap > 0 && this.cap <= this.autoFps) { this.lowSince = 0; return null; }
    if (this.fps() >= this.autoFps) { this.lowSince = 0; return null; }
    if (!this.lowSince) this.lowSince = now;
    if (now - this.lowSince < this.lowMs || now < this.cooldownUntil) return null;
    const q = lower(quality);
    this.lowSince = 0; this.cooldownUntil = now + this.cooldownMs;
    return q || null;
  }
}

// Батарея: cb(onBattery) сразу и при подключении / отключении зарядки. Без API (Firefox, Safari) — молчит.
export function watchBattery(cb, nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav || typeof nav.getBattery !== 'function') return Promise.resolve(false);
  return nav.getBattery().then((b) => {
    const upd = () => cb(!b.charging);
    b.addEventListener('chargingchange', upd);
    upd();
    return true;
  }).catch(() => false);
}

// Текст оверлея F8
export function overlayText(s) {
  const parts = [`FPS ${s.fps}${s.cap ? '/' + s.cap : ''}${s.idle ? ' (простой)' : ''}`, `кадр ${s.frameMs.toFixed(1)} мс`];
  if (s.ping !== null && s.ping !== undefined) parts.push(`пинг ${Math.round(s.ping)} мс`);
  if (s.srv) {
    parts.push(`тик ${s.srv.tickMs}/${s.srv.tickMax} мс`, `${s.srv.kbps} КБ/с`);
    parts.push(`враги ${s.srv.awake ?? '?'}/${s.srv.enemies}`);
    if (s.srv.errors) parts.push(`ошибок сервера ${s.srv.errors}`);
  }
  parts.push(`качество: ${s.quality}${s.saver ? ' (батарея)' : ''}`);
  if (s.chunks !== undefined) parts.push(`фрагменты ${s.chunks}`);
  return parts.join(' · ');
}
