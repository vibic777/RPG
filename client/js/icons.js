import { drawEquipmentAura } from './game/equipment-aura.js';
// Процедурные иконки предметов: форма и цвета берутся из каталога (item.icon = { shape, color, color2 }).
// Рисуются на сетке 32×32 и масштабируются. Кэш готовых картинок — по id предмета и размеру.
const cache = new Map();

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// Рисует иконку в контексте: (x, y) — левый верхний угол, s — размер
export function drawIcon(ctx, icon, x = 0, y = 0, s = 32) {
  const c1 = icon.color || '#888888';
  const c2 = icon.color2 || shade(c1, -0.35);
  const k = s / 32;
  ctx.save();
  if(icon.stealth)ctx.globalAlpha*=.6;
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const P = (pts, fill, stroke, lw = 1.2) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    if (fill) { const gr=ctx.createLinearGradient(5,4,27,29); gr.addColorStop(0,fill); gr.addColorStop(0.35,fill); gr.addColorStop(0.48,'#e9f2ef'); gr.addColorStop(0.56,fill); gr.addColorStop(1,fill); ctx.fillStyle=gr; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  };
  const L = (x1, y1, x2, y2, col, lw) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const R = (rx, ry, w, h, col) => { const gr=ctx.createLinearGradient(rx,ry,rx+w,ry+h);gr.addColorStop(0,col);gr.addColorStop(0.45,col);gr.addColorStop(0.55,'#ffffff55');gr.addColorStop(0.65,col);gr.addColorStop(1,col);ctx.fillStyle=gr;ctx.fillRect(rx,ry,w,h); };
  const C = (cx, cy, r, col, stroke, lw = 1.2) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); if (col) { ctx.fillStyle = col; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); } };
  const glow = (col, blur = 6) => { ctx.shadowColor = col; ctx.shadowBlur = blur; };
  const noGlow = () => { ctx.shadowBlur = 0; };
  const dark = shade(c1, -0.45), light = shade(c1, 0.3);
  const gun = (len, barrel, stockLen, mag) => {
    // ствол по диагонали: приклад слева внизу
    ctx.save(); ctx.translate(16, 16); ctx.rotate(-Math.PI / 5); ctx.translate(-16, -16);
    R(16 - len / 2, 13, len, 4, c1);
    R(16 + len / 2 - 1, 13.8, barrel, 2.4, dark);
    if (stockLen) P([[16 - len / 2, 13], [16 - len / 2 - stockLen, 14], [16 - len / 2 - stockLen, 19], [16 - len / 2, 17]], c2);
    R(16 - len / 2 + 3, 17, 3, 5, c2); // рукоять
    if (mag) R(16 + 1, 17, 2.5, mag, dark);
    ctx.restore();
  };
  if (icon.energy) { glow(c2,4); }
  switch (icon.shape) {
    case 'pecheneg': case 'm240':
      gun(16,7,5,true); L(20,18,25,27,dark,1.5);L(20,18,17,27,dark,1.5);
      for(let i=0;i<6;i++)L(18+i,9,18+i,12,c2,0.65);R(11,18,6,7,'#6a654b');break;
    case 'gatling':
      ctx.save();ctx.translate(16,16);ctx.rotate(-Math.PI/5);ctx.translate(-16,-16);
      R(5,12,9,9,c1);R(8,21,4,7,'#423f39');R(5,9,8,2,c2);
      for(let i=0;i<3;i++){R(14,10+i*4,14,2,c1);L(14,10+i*4,28,10+i*4,'#e2ebed',0.5);}
      R(18,9,3,12,dark);R(25,9,3,12,c2);C(29,15,3,dark,c1,1);ctx.restore();break;
    case 'tanto': case 'wakizashi': case 'katana': case 'nodachi': {
      const short=icon.shape==='tanto', top=short?12:icon.shape==='wakizashi'?7:3;
      P([[12,23],[14,22],[25,top],[28,top-1],[27,top+4],[16,25]],c1,dark,0.6);
      L(15,22,26,top+2,c2,0.7); L(11,25,16,21,'#cfad62',2.8);
      L(7,30,12,25,'#29272b',3.5); for(let i=0;i<4;i++) L(6.6+i,28.5-i,8.5+i,30-i,'#cba578',0.7);
      C(8,29,0.7,c2); break;
    }
    case 'tomahawk':
      L(8,29,20,5,'#67503c',3);L(9,28,21,5,c2,0.8);
      P([[16,8],[22,5],[29,7],[27,15],[21,13],[18,14]],c1,dark,0.7);L(27,8,26,13,'#eaf2f7',1);break;
    case 'nunchaku':
      L(8,28,13,11,'#302a26',5);L(8,27,13,11,c1,3);L(22,27,19,10,'#302a26',5);L(22,26,19,10,c1,3);
      for(let i=0;i<6;i++)C(13+i*1.2,9-Math.sin(i/5*Math.PI)*3,1,null,'#ccd6dd',0.7);
      for(let i=0;i<4;i++){L(7+i,24-i*3,10+i,25-i*3,c2,0.7);L(19+i*0.4,14+i*3,22+i*0.4,13+i*3,c2,0.7);}break;

    case 'pistol': case 'laser_pistol':
      P([[6, 12], [25, 12], [25, 16], [13, 16], [12, 24], [7, 24], [8, 16], [6, 16]], c1, dark);
      if (icon.shape === 'laser_pistol') { glow(c2); R(24, 13, 4, 2, c2); noGlow(); C(11, 14, 1.3, c2); } else R(24, 12.8, 3, 2, dark);
      break;
    case 'smg': gun(14, 5, 3, 7); break;
    case 'rifle': gun(18, 7, 7, 5); break;
    case 'sniper': gun(20, 8, 7, 0); ctx.save(); ctx.translate(16, 16); ctx.rotate(-Math.PI / 5); R(-3, -6, 8, 2.5, '#222'); ctx.restore(); break;
    case 'shotgun': gun(18, 6, 7, 0); ctx.save(); ctx.translate(16, 16); ctx.rotate(-Math.PI / 5); R(0, 1, 7, 2, c2); ctx.restore(); break;
    case 'mg': gun(20, 7, 5, 0); ctx.save(); ctx.translate(16, 16); ctx.rotate(-Math.PI / 5); R(-3, 1, 6, 7, '#6b5a2a'); L(8, 1, 6, 8, dark, 1.2); L(8, 1, 11, 8, dark, 1.2); ctx.restore(); break;
    case 'launcher': case 'laser_rifle':
      ctx.save(); ctx.translate(16, 16); ctx.rotate(-Math.PI / 5);
      if (icon.shape === 'launcher') { R(-13, -3, 26, 6, c1); R(11, -4, 3, 8, dark); R(-3, 3, 3, 5, c2); P([[13, -3], [17, 0], [13, 3]], c2); }
      else { R(-12, -2.5, 22, 5, c1); R(-15, -1, 4, 6, dark); R(-4, 2.5, 3, 5, dark); glow(c2); R(10, -1, 6, 2, c2); R(-6, -1, 10, 1.2, c2); noGlow(); }
      ctx.restore();
      break;
    case 'knife':
      P([[8, 24], [21, 9], [24, 8], [23, 11], [11, 26]], light, dark, 0.8);
      L(7, 21, 12, 26, '#555', 2); L(4, 29, 9, 24, c2, 3);
      if (icon.color2 && icon.color2 !== '#4a3322') C(18, 13, 1.2, icon.color2);
      break;
    case 'club': L(7, 26, 24, 7, c1, 4); L(19, 12, 25, 6, shade(c1, 0.1), 6.5); break;
    case 'baton': L(8, 25, 23, 9, c1, 4); glow(c2); L(20, 12, 24, 8, c2, 3); noGlow(); L(7, 26, 10, 23, '#111', 4.5); break;
    case 'mace': L(8, 25, 20, 12, '#5a3d24', 2.8); C(22, 10, 5.5, c1, dark); for (let a = 0; a < 6; a++) C(22 + Math.cos(a) * 6, 10 + Math.sin(a) * 6, 1.2, dark); break;
    case 'hammer':
      L(8, 26, 20, 10, '#5a3d24', 2.8);
      ctx.save(); ctx.translate(21, 9); ctx.rotate(Math.PI / 4); R(-8, -3.5, 16, 7, c1); if (icon.color2) { glow(c2); R(-7, -1, 14, 2, c2); noGlow(); } ctx.restore();
      break;
    case 'sword': case 'greatsword': {
      const g = icon.shape === 'greatsword';
      P([[g ? 5 : 8, g ? 27 : 24], [24, 6], [27, 5], [26, 8], [g ? 8 : 10, g ? 29 : 26]], light, dark, 0.8);
      if (icon.color2 && icon.color2.toLowerCase() === '#ff7a2a') { glow(icon.color2); L(10, 24, 24, 8, icon.color2, 1); noGlow(); }
      L(5, 21, 13, 29, '#8a6d3b', 2.2); L(3, 30, 8, 25, c2, 3);
      break;
    }
    case 'axe': case 'greataxe': case 'laser_axe': {
      L(8, 27, 22, 6, icon.shape === 'laser_axe' ? '#555' : '#6b4a2c', 2.6);
      const big = icon.shape === 'greataxe';
      ctx.beginPath(); ctx.moveTo(18, 8); ctx.quadraticCurveTo(big ? 32 : 29, big ? 8 : 10, big ? 27 : 25, big ? 20 : 17); ctx.lineTo(19, 13); ctx.closePath();
      ctx.fillStyle = c1; ctx.fill(); ctx.strokeStyle = dark; ctx.lineWidth = 0.8; ctx.stroke();
      if (big) { ctx.beginPath(); ctx.moveTo(18, 9); ctx.quadraticCurveTo(8, 6, 11, 16); ctx.lineTo(17, 12); ctx.closePath(); ctx.fillStyle = c1; ctx.fill(); }
      if (icon.shape === 'laser_axe') { glow(c2); ctx.strokeStyle = c2; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(22, 8); ctx.quadraticCurveTo(29, 10, 25, 17); ctx.stroke(); noGlow(); }
      break;
    }
    case 'spear': L(5, 28, 24, 9, '#6b4a2c', 2); P([[22, 11], [28, 4], [26, 10]], c1, dark, 0.6); P([[22, 11], [28, 4], [21, 9]], light); break;
    case 'halberd': L(5, 28, 25, 6, '#6b4a2c', 2); P([[22, 9], [28, 3], [25, 9]], c1); ctx.beginPath(); ctx.moveTo(21, 9); ctx.quadraticCurveTo(28, 12, 25, 17); ctx.lineTo(19, 12); ctx.closePath(); ctx.fillStyle = c1; ctx.fill(); ctx.strokeStyle = dark; ctx.lineWidth = 0.8; ctx.stroke(); break;
    case 'bow':
      ctx.strokeStyle = c1; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(8, 4); ctx.quadraticCurveTo(28, 16, 8, 28); ctx.stroke();
      if (icon.color2) { glow(icon.color2); L(8, 4, 8, 28, icon.color2, 1); noGlow(); } else L(8, 4, 8, 28, '#ddd', 0.7);
      break;
    case 'blowgun': L(4, 26, 28, 6, c1, 2.6); R(5, 23, 3, 3, '#333'); break;
    case 'crossbow':
      L(16, 28, 16, 8, c1, 3.2);
      ctx.strokeStyle = c2; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(4, 14); ctx.quadraticCurveTo(16, 4, 28, 14); ctx.stroke();
      L(4, 14, 16, 18, '#ddd', 0.7); L(28, 14, 16, 18, '#ddd', 0.7);
      break;
    case 'disc': case 'star':
      if (icon.shape === 'star') { for (let i = 0; i < 4; i++) { ctx.save(); ctx.translate(16, 16); ctx.rotate(i * Math.PI / 2 + 0.3); P([[0, -12], [3, -2], [-3, -2]], c1, dark, 0.6); ctx.restore(); } C(16, 16, 2.5, dark); break; }
      for (let i = 0; i < 8; i++) { ctx.save(); ctx.translate(16, 16); ctx.rotate(i * Math.PI / 4); P([[-2.5, -10], [0, -14], [2.5, -10]], light); ctx.restore(); }
      C(16, 16, 10.5, c1, dark, 1); C(16, 16, 4, c2, dark, 0.8);
      break;
    case 'lsword': case 'dlsword':
      glow(c2, 8); L(icon.shape === 'dlsword' ? 5 : 13, icon.shape === 'dlsword' ? 27 : 19, 26, 6, c2, 3); if (icon.shape === 'dlsword') { noGlow(); }
      noGlow(); L(icon.shape === 'dlsword' ? 5 : 13, icon.shape === 'dlsword' ? 27 : 19, 26, 6, '#fff', 1);
      if (icon.shape === 'dlsword') { R(13, 16, 6, 3, c1); } else L(8, 25, 13, 19, c1, 4);
      break;
    case 'lasso':
      L(5, 27, 11, 21, c1, 3.5);
      glow(c2, 7); ctx.strokeStyle = c2; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(11, 21); ctx.quadraticCurveTo(14, 12, 20, 13); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(21, 11, 7, 5, -0.3, 0, Math.PI * 2); ctx.stroke(); noGlow();
      break;
    case 'staff': case 'wand': {
      const w = icon.shape === 'wand';
      L(w ? 9 : 6, w ? 25 : 29, w ? 21 : 22, w ? 11 : 8, c1, w ? 2.2 : 2.6);
      glow(c2, 9); C(w ? 22 : 23, w ? 10 : 7, w ? 3 : 4, c2); noGlow(); C(w ? 22 : 23, w ? 10 : 7, 1.3, '#fff');
      break;
    }
    case 'flamer':
      ctx.save(); ctx.translate(16, 16); ctx.rotate(-Math.PI / 6);
      R(-12, -2.5, 20, 5, c1); R(8, -1.5, 5, 3, '#333'); R(-6, 2, 3, 5, '#333'); R(-11, 2.5, 5, 7, '#a33');
      glow(c2, 8); P([[13, 0], [19, -4], [17, 0], [19, 4]], c2); noGlow();
      ctx.restore();
      break;
    case 'mine': ctx.beginPath(); ctx.ellipse(16, 19, 11, 6, 0, 0, Math.PI * 2); ctx.fillStyle = c1; ctx.fill(); ctx.strokeStyle = dark; ctx.lineWidth = 1; ctx.stroke(); R(13, 12, 6, 5, dark); glow(c2); C(16, 12, 1.8, c2); noGlow(); break;
    case 'trap':
      ctx.strokeStyle = c1; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(16, 18, 10, Math.PI, 0); ctx.stroke();
      for (let i = 0; i < 7; i++) { const a = Math.PI + (i + 0.5) * Math.PI / 7; P([[16 + Math.cos(a) * 10, 18 + Math.sin(a) * 10], [16 + Math.cos(a) * 6.5, 18 + Math.sin(a) * 6.5], [16 + Math.cos(a + 0.2) * 10, 18 + Math.sin(a + 0.2) * 10]], c1); }
      L(5, 22, 27, 22, dark, 2.5); C(16, 22, 2.5, dark);
      break;
    case 'net': ctx.strokeStyle = c1; ctx.lineWidth = 1; for (let i = 0; i <= 5; i++) { L(5 + i * 4.4, 6, 5 + i * 4.4, 26, c1, 1); L(5, 6 + i * 4, 27, 6 + i * 4, c1, 1); } C(5, 26, 2, '#666'); C(27, 26, 2, '#666'); break;
    case 'tripwire': L(3, 22, 29, 22, '#bbb', 0.8); R(3, 18, 2, 8, '#6b4a2c'); ctx.beginPath(); ctx.ellipse(24, 17, 4, 5, 0, 0, Math.PI * 2); ctx.fillStyle = c1; ctx.fill(); R(23, 10, 2, 3, '#999'); break;
    case 'turret':
      L(9, 28, 16, 20, '#555', 2); L(23, 28, 16, 20, '#555', 2); L(16, 28, 16, 20, '#555', 2);
      R(9, 12, 14, 9, c1); R(20, 14, 10, 3, dark); glow(c2); C(13, 16, 1.6, c2); noGlow();
      break;
    // --- боеприпасы ---
    case 'bullet': for (let i = 0; i < 3; i++) { const bx = 8 + i * 7; R(bx, 13, 5, 13, c1); ctx.beginPath(); ctx.moveTo(bx, 13); ctx.quadraticCurveTo(bx + 2.5, 4, bx + 5, 13); ctx.fillStyle = '#b87333'; ctx.fill(); R(bx, 23, 5, 3, shade(c1, -0.25)); } break;
    case 'shell': for (let i = 0; i < 3; i++) { const bx = 7 + i * 7; R(bx, 8, 6, 14, c1); R(bx, 22, 6, 4, '#c9a54a'); } break;
    case 'grenade': ctx.beginPath(); ctx.ellipse(16, 17, 7, 9, 0, 0, Math.PI * 2); ctx.fillStyle = c1; ctx.fill(); R(12, 6, 8, 3, '#c9a54a'); L(10, 13, 22, 13, dark, 0.8); L(10, 20, 22, 20, dark, 0.8); break;
    case 'rocket': ctx.save(); ctx.translate(16, 16); ctx.rotate(-Math.PI / 4); R(-10, -3, 16, 6, c1); P([[6, -4], [13, 0], [6, 4]], c2); P([[-10, -3], [-13, -6], [-13, 6], [-10, 3]], dark); ctx.restore(); break;
    case 'arrow': for (let i = 0; i < 3; i++) { const o = i * 4 - 4; L(6 + o, 27, 24 + o, 7, c1, 1.4); P([[24 + o, 7], [21 + o, 8], [23 + o, 10]], icon.color2 || '#9aa0a6'); L(6 + o, 27, 8 + o, 23, '#ddd', 2); } break;
    case 'cell': R(10, 6, 12, 21, c1); R(13, 4, 6, 2, '#999'); glow(c2); R(12, 9, 8, 15, c2); noGlow(); R(12, 9, 8, 6, 'rgba(0,0,0,0.3)'); break;
    case 'fuel': R(9, 8, 14, 20, c1); R(12, 4, 5, 4, '#333'); R(11, 12, 10, 6, '#ffd84a'); break;
    // --- одежда и броня ---
    case 'underwear': P([[6, 11], [26, 11], [25, 17], [19, 24], [16, 19], [13, 24], [7, 17]], c1, shade(c1, 0.3)); break;
    case 'shirt': P([[11, 5], [21, 5], [29, 10], [26, 15], [23, 13], [23, 28], [9, 28], [9, 13], [6, 15], [3, 10]], c1, dark); L(13, 5, 16, 9, dark, 1); L(19, 5, 16, 9, dark, 1); break;
    case 'jacket': case 'coat': {
      const long = icon.shape === 'coat';
      P([[11, 4], [21, 4], [29, 9], [28, 24], [24, 24], [23, long ? 31 : 27], [9, long ? 31 : 27], [8, 24], [4, 24], [3, 9]], c1, dark);
      L(16, 7, 16, long ? 31 : 27, dark, 1); P([[11, 4], [16, 10], [21, 4]], light);
      break;
    }
    case 'pants': P([[8, 4], [24, 4], [26, 29], [19, 29], [16, 12], [13, 29], [6, 29]], c1, dark); R(8, 4, 16, 3, dark); break;
    case 'armor': case 'vest': case 'power_armor': {
      P([[9, 4], [23, 4], [27, 8], [26, 22], [16, 29], [6, 22], [5, 8]], c1, dark);
      if (icon.shape === 'vest') { R(10, 10, 12, 4, dark); R(10, 16, 12, 4, dark); }
      else { L(16, 6, 16, 27, dark, 1); L(7, 14, 25, 14, dark, 1); }
      if (icon.shape === 'power_armor') { R(3, 6, 6, 7, dark); R(23, 6, 6, 7, dark); glow(c2); C(16, 11, 2.5, c2); noGlow(); }
      else if (icon.color2) { glow(c2, 4); L(9, 20, 23, 20, c2, 1.2); noGlow(); }
      break;
    }
    case 'helmet': case 'helmet_full':
      ctx.beginPath(); ctx.arc(16, 18, 11, Math.PI, 0); ctx.closePath(); ctx.fillStyle = c1; ctx.fill(); ctx.strokeStyle = dark; ctx.lineWidth = 1; ctx.stroke();
      R(3, 18, 26, 3, dark);
      if (icon.shape === 'helmet_full') { R(7, 18, 18, 9, c1); glow(c2); R(9, 19, 14, 3, c2); noGlow(); }
      break;
    case 'bandana': P([[5, 16], [16, 8], [27, 16], [16, 18]], c1, dark); P([[24, 16], [29, 25], [26, 25], [22, 17]], c1); C(12, 13, 0.9, '#fff'); C(19, 12, 0.9, '#fff'); break;
    case 'hood': P([[16, 3], [27, 13], [26, 29], [6, 29], [5, 13]], c1, dark); ctx.beginPath(); ctx.ellipse(16, 17, 6, 8, 0, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill(); break;
    case 'goggles': L(4, 16, 28, 16, '#333', 2); C(11, 16, 5, c1); C(21, 16, 5, c1); glow(c2, 5); C(11, 16, 3.3, c2); C(21, 16, 3.3, c2); noGlow(); break;
    case 'mask': ctx.beginPath(); ctx.ellipse(16, 15, 10, 11, 0, 0, Math.PI * 2); ctx.fillStyle = c1; ctx.fill(); C(12, 12, 3, '#9ab'); C(20, 12, 3, '#9ab'); C(16, 23, 4, '#333'); break;
    case 'gloves': P([[6, 28], [6, 14], [8, 8], [10, 14], [11, 6], [13, 14], [14, 7], [16, 15], [18, 12], [17, 28]], c1, dark); P([[17, 28], [17, 14], [19, 8], [21, 14], [22, 6], [24, 14], [25, 7], [27, 15], [28, 28]], shade(c1, -0.1), dark); break;
    case 'boots': P([[6, 5], [13, 5], [13, 22], [16, 24], [16, 28], [4, 28], [5, 22]], c1, dark); P([[17, 7], [24, 7], [24, 22], [28, 24], [28, 28], [16, 28], [17, 22]], shade(c1, -0.1), dark); if (icon.color2) { glow(c2); R(4, 26, 12, 2, c2); R(16, 26, 12, 2, c2); noGlow(); } break;
    case 'robe': // мантия мага: длинный подол, широкие рукава, кушак и рунная кайма
      P([[12, 4], [20, 4], [28, 15], [24, 17], [22, 13], [26, 29], [6, 29], [10, 13], [8, 17], [4, 15]], c1, dark); P([[13, 4], [16, 10], [19, 4]], shade(c1, -0.25)); R(10, 15, 12, 2.5, c2); L(16, 17, 16, 29, dark, 0.8); glow(c2); R(7, 26.5, 18, 1.6, c2); noGlow(); break;
    case 'cloak': P([[11, 4], [21, 4], [27, 29], [16, 26], [5, 29]], c1, dark); C(16, 6, 2, '#c9a54a'); break;
    case 'belt': R(3, 13, 26, 6, c1); R(13, 12, 6, 8, '#c9a54a'); R(15, 14, 2, 4, c1); R(5, 19, 5, 6, shade(c1, -0.2)); R(22, 19, 5, 6, shade(c1, -0.2)); break;
    case 'bag': ctx.strokeStyle = dark; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(16, 13, 8, Math.PI, 0); ctx.stroke(); P([[5, 13], [27, 13], [25, 28], [7, 28]], c1, dark); R(10, 16, 12, 5, shade(c1, -0.15)); break;
    case 'jetpack':
      R(7,7,7,21,c1);R(18,7,7,21,c1);L(14,12,18,12,dark,3);C(10.5,7,3.5,c2);C(21.5,7,3.5,c2);P([[8,28],[11,32],[13,28]],c2);P([[19,28],[22,32],[24,28]],c2);break;
    case 'wings':
      for(const side of [-1,1]){ctx.save();ctx.translate(16,16);ctx.scale(side,1);if(icon.wingKind==='hell'){P([[0,0],[5,-10],[14,-12],[11,-3],[14,7],[5,4],[0,8]],c1,c2,.7);L(0,0,5,-10,c2,1);L(5,-10,14,7,c2,.7);}else{for(let i=0;i<7;i++)P([[1,5],[5+i,-10+i*.5],[14-i,5+i*.8],[4,10]],i%2?light:c1,c2,.4);}ctx.restore();}break;
    case 'backpack': P([[8, 6], [24, 6], [26, 28], [6, 28]], c1, dark); R(10, 16, 12, 9, shade(c1, -0.15)); R(10, 5, 12, 5, shade(c1, 0.15)); if (icon.color2) { R(4, 8, 2, 20, c2); R(26, 8, 2, 20, c2); } break;
    case 'ring': C(16, 18, 8, null, c1, 3); if (icon.color2) { glow(c2); C(16, 9.5, 3, c2); noGlow(); } else C(16, 10, 2.5, light); break;
    case 'amulet': ctx.strokeStyle = '#c9a54a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(16, 8, 9, 0.2, Math.PI - 0.2); ctx.stroke(); P([[16, 15], [22, 21], [16, 29], [10, 21]], c1, dark); C(16, 21, 2, c2); break;
    // --- расходуемое ---
    case 'food': R(6, 10, 20, 14, c1); R(6, 10, 20, 4, shade(c1, 0.2)); L(9, 18, 23, 18, dark, 1); break;
    case 'can': R(9, 7, 14, 19, c1); ctx.beginPath(); ctx.ellipse(16, 7, 7, 2.5, 0, 0, Math.PI * 2); ctx.fillStyle = light; ctx.fill(); R(9, 12, 14, 8, c2); break;
    case 'meat': ctx.beginPath(); ctx.ellipse(14, 18, 9, 7, -0.5, 0, Math.PI * 2); ctx.fillStyle = c1; ctx.fill(); L(20, 12, 27, 5, '#eee', 3); C(27, 5, 2, '#eee'); break;
    case 'flask': ctx.beginPath(); ctx.ellipse(16, 19, 9, 9, 0, 0, Math.PI * 2); ctx.fillStyle = c1; ctx.fill(); R(13, 4, 6, 7, '#6b4a2c'); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(10, 15, 3, 7); break;
    case 'bottle': R(11, 11, 10, 17, c1); R(14, 4, 4, 7, c1); R(13, 3, 6, 2, '#ddd'); R(12, 17, 8, 5, '#fff'); break;
    case 'medkit': R(5, 9, 22, 17, c1); R(12, 6, 8, 3, '#888'); R(14, 11, 4, 13, c2); R(10, 15.5, 12, 4, c2); break;
    case 'potion': ctx.beginPath(); ctx.arc(16, 20, 8, 0, Math.PI * 2); ctx.fillStyle = c1; glow(c1, 6); ctx.fill(); noGlow(); R(14, 5, 4, 8, '#ccc'); R(13, 4, 6, 2, '#6b4a2c'); break;
    case 'syringe': ctx.save(); ctx.translate(16, 16); ctx.rotate(-Math.PI / 4); R(-8, -3, 14, 6, c1); glow(c2); R(-6, -2, 9, 4, c2); noGlow(); R(6, -0.6, 7, 1.2, '#bbb'); R(-12, -1, 4, 2, '#888'); R(-13, -4, 1.5, 8, '#888'); ctx.restore(); break;
    // --- материалы ---
    case 'scrap': P([[5, 20], [12, 10], [19, 14], [26, 8], [27, 20], [18, 26], [9, 26]], c1, dark); L(12, 14, 20, 22, dark, 1); break;
    case 'planks': for (let i = 0; i < 3; i++) { R(4, 8 + i * 6, 24, 5, i % 2 ? shade(c1, -0.1) : c1); L(4, 10 + i * 6, 28, 10 + i * 6, dark, 0.5); } break;
    case 'cloth': P([[6, 10], [26, 7], [24, 25], [8, 27]], c1, dark); L(8, 15, 24, 13, dark, 0.6); L(8, 20, 24, 18, dark, 0.6); break;
    case 'chip': R(7, 7, 18, 18, c1); for (let i = 0; i < 4; i++) { R(4, 9 + i * 4, 3, 1.5, c2); R(25, 9 + i * 4, 3, 1.5, c2); } R(12, 12, 8, 8, '#111'); break;
    case 'nugget': P([[7, 20], [11, 11], [19, 8], [26, 14], [24, 24], [13, 26]], c1, dark); P([[11, 13], [18, 10], [16, 15]], light); break;
    case 'plate': ctx.beginPath(); ctx.ellipse(16, 17, 11, 8, 0.3, 0, Math.PI * 2); ctx.fillStyle = c1; ctx.fill(); ctx.strokeStyle = light; ctx.lineWidth = 1; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(16, 30 + i * 3, 16, 1.2 * Math.PI, 1.8 * Math.PI); ctx.stroke(); } break;
    case 'book':
      P([[6,7],[22,4],[27,7],[27,26],[10,29],[6,26]],dark,'#211d27',0.7);
      P([[10,8],[26,5],[26,24],[10,27]],c1,dark,0.7);L(12,25,25,23,'#e4d6b4',1.6);
      for(const [bx,by] of [[12,10],[24,8],[12,23],[24,21]])P([[bx,by],[bx+2,by],[bx,by+2]],'#e0bb6e');
      P([[18,10],[22,15],[18,21],[14,16]],c2,'#e6c98c',0.7);L(18,12,18,19,'#f3e2b5',0.6);L(15,16,21,15,'#f3e2b5',0.6);break;
    case 'scroll': R(9, 8, 14, 17, '#e8dcb0'); C(9, 8, 2.5, c1, dark, 1); C(23, 25, 2.5, c1, dark, 1); R(9, 5.5, 14, 5, c1); R(9, 22.5, 14, 5, c1); C(16, 16, 3, c2); break;
    case 'rune': C(16, 16, 11, c1, dark, 1.5); C(16, 16, 5, c2); L(16, 6, 16, 26, light, 1); L(6, 16, 26, 16, light, 1); break;
    default:
      R(7, 7, 18, 18, c1); ctx.strokeStyle = dark; ctx.strokeRect(7, 7, 18, 18);
  }
  noGlow();
  drawEquipmentAura(ctx,icon,16,16,4.5,1200,-Math.PI/4,19);
  // Etched ornament and gemstone distinguish rare weapons and set pieces.
  if (['epic','legendary'].includes(icon.rarity) || icon.set) {
    const ink=icon.rarity==='legendary'?'#efd38b':'#c7a6ef';
    for(const [bx,by,sign] of [[2,2,1],[30,30,-1]]){L(bx,by,bx+sign*6,by,ink,0.8);L(bx,by,bx,by+sign*6,ink,0.8);}
    P([[27,24],[30,27],[27,30],[24,27]],icon.set?c2:ink,'#342c3a',0.6);
    if(icon.set) { C(27,27,1,'#fff1be'); L(24,3,28,7,c2,0.7);L(28,3,24,7,c2,0.7); }
  }
  ctx.restore();
}

// Готовая картинка (data URL) — для <img> в ячейках, слотах и на панели 1–0
export function iconUrl(item, size = 64) {
  const key = item.id + '@' + size;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  drawIcon(c.getContext('2d'), item.icon, 0, 0, size);
  const url = c.toDataURL();
  if(cache.size>=512)cache.delete(cache.keys().next().value);
  cache.set(key, url);
  return url;
}

// Картинка-canvas для рисования в мире (предметы на земле)
const canvasCache = new Map();
export function iconCanvas(item, size = 48) {
  const key = item.id + '@' + size;
  if (canvasCache.has(key)) return canvasCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  drawIcon(c.getContext('2d'), item.icon, 0, 0, size);
  if(canvasCache.size>=512)canvasCache.delete(canvasCache.keys().next().value);
  canvasCache.set(key, c);
  return c;
}

// Как оружие держат в руке (для рисования героя): клинок, древковое, пистолет, длинный ствол, лук, диск, плеть
export function weaponKind(shape) {
  if (['knife', 'tanto', 'nunchaku', 'baton', 'wand'].includes(shape)) return 'short';
  if (['club', 'mace', 'hammer', 'katana', 'wakizashi', 'nodachi', 'tomahawk', 'sword', 'greatsword', 'axe', 'greataxe', 'laser_axe', 'lsword'].includes(shape)) return 'blade';
  if (['spear', 'halberd', 'staff', 'dlsword'].includes(shape)) return 'pole';
  if (['pistol', 'laser_pistol', 'smg'].includes(shape)) return 'pistol';
  if (['rifle', 'sniper', 'shotgun', 'mg', 'gatling', 'pecheneg', 'm240', 'launcher', 'laser_rifle', 'flamer', 'blowgun', 'crossbow'].includes(shape)) return 'long';
  if (shape === 'bow') return 'bow';
  if (shape === 'disc' || shape === 'star') return 'disc';
  if (shape === 'lasso') return 'coil';
  return 'short';
}
