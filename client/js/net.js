// Соединение с сервером реального времени (WebSocket): вход в мир по сессии,
// автоматическое переподключение с нарастающей задержкой, корректный выход.
import { session } from './api.js';

const P = window.Protocol;

export class Net {
  // opts: { worldId, characterId, settings, wsPath, onMessage(msg), onStatus(status, info) }
  // статусы: 'connecting' | 'online' | 'reconnecting' | 'closed'
  constructor(opts) {
    this.opts = opts;
    this.ws = null;
    this.attempt = 0;
    this.stopped = false;
    this.lastRx = 0;
    this.lastKick = null;
    this.status = 'connecting';
    this.watchdog = setInterval(() => this.checkAlive(), 1000);
  }

  get settings() { return this.opts.settings || {}; }

  connect() {
    if (this.stopped) return;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + (this.opts.wsPath || '/ws');
    let ws;
    try { ws = new WebSocket(url); } catch { this.onClosed(1006); return; }
    this.ws = ws;
    this.lastKick = null;
    ws.onopen = () => {
      this.lastRx = Date.now();
      ws.send(JSON.stringify({ t: 'hello', v: P.VERSION, token: session.token, worldId: this.opts.worldId, characterId: this.opts.characterId }));
    };
    ws.onmessage = (e) => {
      this.lastRx = Date.now();
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'welcome') { this.attempt = 0; this.setStatus('online'); }
      if (msg.t === 'kicked') this.lastKick = msg;
      this.opts.onMessage(msg);
    };
    ws.onclose = (e) => { if (this.ws === ws) this.onClosed(e.code); };
  }

  setStatus(status, info = {}) {
    this.status = status;
    this.opts.onStatus(status, info);
  }

  // Сервер шлёт позиции каждый тик; долгая тишина — связь потеряна
  checkAlive() {
    if (this.stopped || this.status !== 'online') return;
    const limit = (this.settings.connTimeoutSec || 8) * 1000;
    if (Date.now() - this.lastRx > limit) {
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch { /* ignore */ }
      this.onClosed(1006);
    }
  }

  onClosed(code) {
    if (this.stopped) return;
    const s = this.settings;
    const message = (this.lastKick && this.lastKick.message) || P.CLOSE_TEXT[code] || 'Связь с сервером потеряна.';
    const max = s.reconnectMaxAttempts ?? 15;
    if (P.shouldReconnect(code) && this.attempt < max) {
      const delay = P.backoffDelay(this.attempt, s.reconnectBaseMs || 500, s.reconnectMaxMs || 8000, Math.random());
      this.attempt++;
      this.setStatus('reconnecting', { attempt: this.attempt, max, delay, code, message });
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    } else {
      this.stop();
      this.setStatus('closed', { code, message });
    }
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(msg)); return true; }
    return false;
  }

  // Корректный выход: сервер сохранит позицию и сообщит остальным
  close() {
    if (this.stopped) return;
    this.send({ t: 'bye' });
    const ws = this.ws;
    this.stop();
    try { ws && ws.close(1000, 'bye'); } catch { /* ignore */ }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.watchdog);
    clearTimeout(this.retryTimer);
  }
}
