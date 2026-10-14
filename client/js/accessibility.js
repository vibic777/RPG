// Размер текста применяется ко всему интерфейсу и сохраняется в браузере.
const TEXT_KEY = 'rpg.textScale';
let scale = 1;
export const textScale = () => scale;
export function setTextScale(value) {
  const number = Number(value);
  scale = Number.isFinite(number) ? Math.max(0.8, Math.min(2, number)) : 1;
  document.documentElement.style.setProperty('--ui-text-scale', String(scale));
  document.documentElement.classList.toggle('large-text', scale > 1);
  const select = document.querySelector('#ui-text-size');
  if (select) {
    const sizes = [0.8, 0.9, 1, 1.5, 2];
    scale = sizes.reduce((a, b) => Math.abs(b - scale) < Math.abs(a - scale) ? b : a);
    document.documentElement.style.setProperty('--ui-text-scale', String(scale));
    select.value = String(Math.round(scale * 100));
  }
  try { localStorage.setItem(TEXT_KEY, String(scale)); } catch { /* Текущий размер продолжает работать. */ }
  window.dispatchEvent(new Event('ui-layout-change'));
}
export function initAccessibility() {
  let saved = 1;
  try { saved = localStorage.getItem(TEXT_KEY) || 1; } catch { /* Базовый размер. */ }
  setTextScale(saved);
  document.querySelector('#ui-text-size')?.addEventListener('change', event => setTextScale(Number(event.target.value) / 100));
  document.querySelector('#btn-text-size-reset')?.addEventListener('click', () => setTextScale(1));
}
