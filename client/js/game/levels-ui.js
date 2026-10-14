// Вертикальные уровни на клиенте (шаг 13): карта текущего уровня (строится локально по сиду мира и ключу — как сама
// карта мира), метки входов и выходов, индикатор уровня и шкала «Воздух», U — войти/выйти, PageUp/PageDown — высота
// полёта на драконе, подсказка у входа, точки входов на миникарте. Переход решает сервер: клиент получает новое
// приветствие (welcome.level) и меняет карту.
const L = () => window.Levels;
const G = () => window.WorldGen;
const $ = (s) => document.querySelector(s);

let api = null; // { send, toast, hero, groundMap, map }
const st = { level: null, z: 0, alt: 0, breath: 0, breathMax: 0, under: false, swim: false, hintAt: 0, hintKey: '', warnAt: 0 };
const ROUTE_NAMES = { stone_ramp: 'естественный каменный уклон', stone_steps: 'ступени в скале', timber_stairs: 'деревянная лестница', vertical_ladder: 'вертикальная лестница', rope_ladder: 'верёвочная лестница', metal_hatch: 'металлический люк' };

export function levelsAttach(a) {
  api=a;
  let panel=$('#personal-flight');
  if(!panel){panel=document.createElement('div');panel.id='personal-flight';panel.className='flight-controls hidden';
    for(const [action,icon,title]of [['toggle','🪽','Взлететь с экипировкой'],['up','⤴','Подняться: PageUp'],['down','⤵','Снизиться: PageDown']]){
      const b=document.createElement('button');b.type='button';b.className='btn small';b.dataset.nativeIcon='';b.dataset.flight=action;b.textContent=icon;b.title=title;b.setAttribute('aria-label',title);
      b.addEventListener('click',()=>{if(!api)return;api.send(action==='toggle'&&st.alt>0?{t:'lvl-land'}:{t:'lvl-alt',d:action==='down'?-1:1});});panel.append(b);
    }
    $('#hud-z')?.after(panel);
  }
}
function flightHud(){
  const panel=$('#personal-flight');if(!panel||!api)return;
  const available=Boolean(api.canFly&&api.canFly());panel.classList.toggle('hidden',!available);
  if(!available)return;
  const toggle=panel.querySelector('[data-flight=toggle]'),mode=st.alt>0?'air':'ground';if(toggle.dataset.mode!==mode){toggle.dataset.mode=mode;toggle.textContent=st.alt>0?'⏬':'🪽';toggle.title=st.alt>0?'Приземлиться на свободную сушу':'Взлететь с помощью ранца или крыльев (PageUp)';toggle.setAttribute('aria-label',toggle.title);}
  panel.querySelector('[data-flight=down]').disabled=!(st.alt>0);
  panel.querySelector('[data-flight=up]').disabled=st.alt>=window.Levels.airTop(window.GameSettings?.airMaxAltitude??5);
}

// Карта для уровня: null — поверхность
export function levelMap(groundMap, level) {
  if (!level) return groundMap;
  const m = L().level(groundMap, level.key);
  if (m) m.swimmer = true;
  return m || groundMap;
}

// Метки входов/выходов для рендера: Map "x,y" -> { kind: 'portal', pk, label }
export function levelMarkers(groundMap, level) {
  if(level?.surfaceRegion){const region=L().level(groundMap,level.key),out=levelMarkers(region,null);for(const town of region.settlements)out.set(town.x+','+town.y,{kind:'settlement',label:town.name});for(const lair of region.lairs||[])out.set(lair.x+','+lair.y,{kind:'lair',label:lair.name});for(const depot of region.depots||[])out.set(depot.x+','+depot.y,{kind:'depot',label:'Военный склад'});return out;}
  const out = new Map();
  const Lv = L();
  if (!Lv) return out;
  const lab = (kind, extra) => `${Lv.KINDS[kind].name}${extra ? ' — ' + extra : ''} (U)`;
  if (!level) {
    for(const p of window.Regions?.portals(groundMap)||[])out.set(p.x+','+p.y,{kind:'portal',pk:'travel',label:p.name+' (U)'});
    for (const e of Lv.entrances(groundMap)) {
      const t = Lv.TYPES[e.type];
      out.set(e.x + ',' + e.y, { kind: 'portal', pk: e.kind, label: e.kind === 'elevator' ? lab('elevator', (window.GameSettings || {}).levelElevator === false ? 'обесточен' : 'сразу на самый нижний уровень') : lab(e.kind, `${t.name}, ${t.dir < 0 ? 'глубина' : 'высота'} до ${e.depth}`) });
      if (e.exit) out.set(e.exit.x + ',' + e.exit.y, { kind: 'portal', pk: 'cave', label: lab('cave', 'узкий лаз (затоплен)') });
    }
    if (window.Houses) for (const h of window.Houses.list(groundMap)) {
      if (h.variant < 0.24 && h.condition !== 'ruined' && h.x + 1 < groundMap.width) out.set((h.x + 1) + ',' + h.y, { kind: 'portal', pk: 'ladder', label: lab('ladder', `${h.name}: пожарная лестница на крышу`) });
    }
    return out;
  }
  const lv = Lv.level(groundMap, level.key);
  for (const x of lv ? lv.exits : []) {
    const to = x.to.key === 'ground' ? null : Lv.arrival(groundMap, x.to);
    const destination = x.kind === 'jump' ? `падение с высоты ${lv.z}` : !to ? (x.secret ? 'тайный выход на сушу' : x.kind === 'door' ? 'на улицу' : 'на поверхность')
      : lv.house && window.Houses ? window.Houses.floorName(lv.house, to.z) : `${Lv.zName(to.z).toLowerCase()}`;
    const text = [destination, ROUTE_NAMES[x.route]].filter(Boolean).join(' · ');
    out.set(x.x + ',' + x.y, { kind: 'portal', pk: x.route || x.kind, label: lab(x.kind, text) });
  }
  return out;
}

export function levelsOnWelcome(msg) {
  st.level = msg.level || null;
  st.z = msg.z || 0;
  st.alt = 0;
  st.hintKey = '';
  updateHud(true);
}

export function levelsOnMessage(msg) {
  switch (msg.t) {
    case 'lv':
      st.breath = msg.b; st.breathMax = msg.bm; st.under = Boolean(msg.u); st.swim = Boolean(msg.sw); st.alt = msg.alt || 0; st.z = msg.z || 0;
      if (st.under && st.breath <= 5 && Date.now() - st.warnAt > 4000) { st.warnAt = Date.now(); api.toast('Кончается воздух! Используйте баллон или всплывайте (U у выхода).', 2500); }
      if(api)api.hero().alt=Math.max(0,st.alt); // под водой (подлодка, alt < 0) герой не поднимается над землёй
      updateHud();
      return true;
    case 'lvl-reject':
      api.toast(msg.message, 3000);
      return true;
    case 'lvl-alt':
      if (api.onAlt) api.onAlt(msg.id, msg.alt);
      return true;
    default:
      return false;
  }
}

export function levelsKey(e) {
  if (e.code === 'KeyU') { e.preventDefault();const p=L().nearbyPortal(api.groundMap(),st.level?L().level(api.groundMap(),st.level.key):null,api.hero().x,api.hero().y);if(p?.kind==='travel')api.toast('Переход: '+p.name+'. Загрузка региона…',3000);api.send({ t: 'lvl-go' }); return true; }
  if (e.code === 'PageUp' || e.code === 'PageDown') { e.preventDefault(); api.send({ t: 'lvl-alt', d: e.code === 'PageUp' ? 1 : -1 }); return true; }
  return false;
}

// Каждый кадр: подсказка у входа
export function levelsFrame(now) {
  if (!api || !L() || now - st.hintAt < 400) return;
  st.hintAt = now;flightHud();
  const h = api.hero();
  const p = L().nearbyPortal(api.groundMap(), st.level ? L().level(api.groundMap(), st.level.key) : null, h.x, h.y);
  const key = p ? p.kind + p.x + ',' + p.y : '';
  if (key && key !== st.hintKey) {
    const k = L().KINDS[p.kind], hs = p.house && window.Houses ? window.Houses.byId(api.groundMap(), p.id) : null;
    const about = hs ? ` ${hs.name}: этажей ${hs.floors} + крыша${hs.basement ? `, подвалов ${hs.basement}` : ''}.` : '';
    api.toast(`${k.icon} ${k.name}:${about} ${k.hint} Нажмите U.`, 2500);
  }
  st.hintKey = key;
}

// Точки входов на миникарте
export function levelsMinimap(ctx, toMini, markers) {
  ctx.fillStyle = '#ffd84a';
  for (const [k, m] of markers) {
    if (m.kind !== 'portal') continue;
    const [x, y] = k.split(',').map(Number);
    const p = toMini(x, y);
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
}

export const levelsState = () => st;

function updateHud(force) {
  flightHud();
  const Lv = L();
  if (!Lv) return;
  const z = st.z;
  const el = $('#hud-z');
  if (el) {
    const text = `${z > 0 ? '▲' : z < 0 ? '▼' : '●'} ${Lv.zName(z)} (${Lv.zLabel(z)})${st.level ? ' · ' + st.level.typeName : ''}${st.swim ? ' · вплавь' : ''}`;
    if (force || el.textContent !== text) {
      el.textContent = text;
      el.title = 'Вертикальный уровень: −5…−1 — под землёй или под водой, 0 — поверхность, +1…+5 — этажи домов, крыши и вершины (авиация здесь бьётся о дома, лес и скалы), +6…+10 — небо (ранец, крылья, дракон или авиация; PageUp/PageDown). U — войти во вход/выход или в дверь дома рядом.';
    }
  }
  const bar = $('#bar-air');
  if (bar) {
    const show = st.under || (st.breathMax && st.breath < st.breathMax);
    bar.classList.toggle('hidden', !show);
    if (show) {
      bar.querySelector('.fill').style.width = `${Math.max(0, Math.min(100, (st.breath / Math.max(1, st.breathMax)) * 100))}%`;
      bar.querySelector('.val').textContent = `${Math.max(0, Math.round(st.breath))} / ${st.breathMax} с`;
    }
  }
}
