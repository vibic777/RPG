'use strict';
// Семья на сервере (шаг 17, GDD §10): отношения с жителями (разговор, подарки, задания, защита), ухаживание, помолвка и
// свадьба в поселении, семейный союз игроков по взаимному согласию, приёмные дети (сироты у старост), старейшина-Патриарх
// (приглашение из концовки «Семья» шага 16), жизнь на базе: кровати, распорядок, помощники (охрана, ремесло, сбор, лечение),
// поход членов семьи со спутниками. Семья хранится на герое (ch.family) и переезжает с ним в «Новую игру+».
const Fam = require('../shared/family');
const S = require('../shared/settlements');
const C = require('../shared/companions');
const Items = require('../shared/items');
const Inv = require('../shared/inventory');
const Enemies = require('../shared/enemies');
const realtime = require('./realtime');
const chat = require('./chat');
const config = require('./config');
const auth = require('./auth');
const characters = require('./characters');
const bases = require('./bases');

const G = () => config.get().game;
const on = () => G().familyEnabled !== false;
const combat = () => require('./combat');
const settlements = () => require('./settlements');
const building = () => require('./building');
const companions = () => require('./companions');
const inventory = () => require('./inventory');
const ID_RE = /^[0-9a-f-]{36}$/;
const real = (room) => Boolean(room && room.world && ID_RE.test(room.world.id));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- База семьи ----------
// База героя в этой комнате: кровати, сундуки, флаг (только поверхность мира, где база стоит)
function homeOf(room, accountId) {
  if (!room || room.level || !room.map) return null;
  const st = building().stateOf(room);
  const base = [...st.bases.values()].find((b) => b.ownerId === accountId);
  if (!base) return null;
  const mine = [...st.pieces.values()].filter((p) => p.base === base.id);
  return { base, beds: mine.filter((p) => require('../shared/building').get(p.type)?.bed), chests: mine.filter((p) => Array.isArray(p.items)), flag: { x: base.placed.x + 0.5, y: base.placed.y + 0.5 }, r: base.placed.r || 8 };
}
// Сколько кроватей у героя: на базе в этой комнате, иначе — по сохранённой базе аккаунта
function bedsOf(c) {
  const h = homeOf(c.room, c.account.id);
  if (h) return h.beds.length;
  try { const b = bases.listOf(c.account.id).find((x) => x.placed) || bases.listOf(c.account.id)[0]; return b ? (b.structures || []).filter((s) => require('../shared/building').get(s.type)?.bed).length : 0; } catch { return 0; }
}

// ---------- Публичный вид ----------
function publicFamily(c, now = Date.now()) {
  const ch = c.character, f = Fam.of(ch), beds = bedsOf(c), hs = Fam.housed(f, beds), wid = c.room && c.room.world ? c.room.world.id + ':' : '';
  const h = homeOf(c.room, c.account.id);
  return {
    t: 'fam', pregnancy: f.pregnancy || null,
    members: f.members.map((m, i) => ({
      id: m.id, kind: m.kind, name: m.name, pregnancy: m.pregnancy || null, gender: m.gender, origin: m.origin, age: Fam.ageOf(m, now), adult: Fam.isAdult(m, now) ? 1 : 0, role: m.role, study: m.study || null,
      level: m.level, out: m.out ? 1 : 0, housed: hs.has(m.id) ? 1 : 0, phase: Fam.phase(now, i), helping: Fam.helping(m, hs, now, i) ? 1 : 0,
    })),
    rel: Object.entries(f.rel).filter(([k]) => !wid || k.startsWith(wid)).map(([k, r]) => ({ key: k, name: r.name, town: r.town, gender: r.gender, affinity: Math.floor(r.affinity), stage: r.stage })),
    bond: f.bond ? { name: f.bond.name, characterId: f.bond.characterId } : null,
    invites: (ch.familyInvites || []).filter((x) => x === 'boss_super'),
    asks: c.room && c.room.famAsks ? [...c.room.famAsks.values()].filter((a) => a.to === c.account.id && Date.now() - a.at < G().familyBondAskSec * 1000).map((a) => ({ from: a.from, name: a.name })) : [],
    beds, home: h ? { x: h.flag.x, y: h.flag.y, r: h.r, beds: h.beds.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 })) } : null,
  };
}
function send(c) { if (c && c.character) realtime.send(c, publicFamily(c)); }
function changed(c) { combat().markDirty(c); send(c); }

// ---------- Жители: отношения ----------
const townName = (room, sid) => ((room.map.settlements || []).find((s) => s.id === sid) || { name: '?' }).name;
function relFor(room, c, n) {
  const f = Fam.of(c.character), key = Fam.relKey(room.world.id, n.id);
  if (!f.rel[key]) f.rel[key] = { name: n.name, town: townName(room, n.sid), gender: Fam.genderOfName(n.name), affinity: 0, stage: 'stranger', talkAt: 0, giftAt: 0 };
  return f.rel[key];
}
const canRelate = (n) => n.role !== 'guard' && !n.escort;
function flagsFor(room, c, n, tier) {
  if (!on() || !real(room) || !canRelate(n)) return { famKids: n.role === 'quest' && on() ? true : undefined };
  const key = Fam.relKey(room.world.id, n.id), rel = Fam.of(c.character).rel[key] || { affinity: 0, stage: 'stranger' };
  const o = { ch: c.character, rel, gender: Fam.genderOfName(n.name) };
  return { famOk: true, famCourt: !Fam.canAdvance('fam_court', o) && tier !== 'hostile', famPropose: !Fam.canAdvance('fam_propose', o), famWed: rel.stage === 'engaged', famKids: n.role === 'quest' };
}
const publicRel = (rel) => (rel ? { stage: rel.stage, affinity: Math.floor(rel.affinity), name: rel.name } : null);
// Добавка к npc-talk: отношения и условия диалога
function talkExtra(room, c, n, tier) {
  const rel = real(room) ? Fam.of(c.character).rel[Fam.relKey(room.world.id, n.id)] : null;
  return { rel: publicRel(rel), flags: flagsFor(room, c, n, tier) };
}
function relUpdate(room, c, n, tier, say) {
  const rel = Fam.of(c.character).rel[Fam.relKey(room.world.id, n.id)] || null;
  realtime.send(c, { t: 'fam-rel', id: n.id, rel: publicRel(rel), flags: flagsFor(room, c, n, tier), ...(say ? { say } : {}) });
}
const TALK = {
  stranger: ['«Мы знакомы? Ну, здравствуй.»', '«Тихо сегодня. Это хорошо.»'],
  acquaint: ['«А, это ты! Как дорога?»', '«Слышал, ты помогаешь поселению. Спасибо.»'],
  friend: ['«Рад тебя видеть! Посиди со мной немного.»', '«Расскажи, что там, за стенами?»'],
  close: ['«С тобой спокойнее. Заходи почаще.»', '«Я тут подумал(а) о тебе… Просто хорошо, что ты есть.»'],
  courting: ['«Прогулка у реки была чудесной. Повторим?»', '«Я берегу твой подарок.»'],
  engaged: ['«Скорее бы праздник! Всё поселение ждёт.»', '«Наш дом будет самым уютным в пустоши.»'],
};

// Действия семьи из диалога жителя: { a: 'fam_talk' | 'fam_gift' | 'fam_court' | 'fam_propose' | 'fam_wed' | 'orphans', id, i?, adopt?, study? }
function npcAct(room, c, n, m, tier) {
  if (!on()) return 'Семья отключена на сервере.';
  if (!real(room)) return 'Здесь это недоступно.';
  const ch = c.character, f = Fam.of(ch), now = Date.now();
  if (m.a === 'orphans') return orphans(room, c, n, m, tier);
  if (!canRelate(n)) return `${n.name}: «Я на посту.»`;
  const rel = relFor(room, c, n), gender = Fam.genderOfName(n.name);
  switch (m.a) {
    case 'fam_talk': {
      if (!Fam.ready(rel.talkAt, Fam.settings.familyTalkCooldownMin, now)) { relUpdate(room, c, n, tier, `${n.name}: «Мы ведь только что говорили. Приходи позже.»`); return null; }
      rel.talkAt = now;
      const got = Fam.addAffinity(rel, Fam.settings.familyTalkAffinity, tier);
      const lines = TALK[rel.stage] || TALK.friend;
      combat().markDirty(c);
      relUpdate(room, c, n, tier, `${n.name}: ${lines[Math.floor(now / 1000) % lines.length]}${got > 0 ? ` (симпатия +${Math.round(got * 10) / 10})` : ''}`);
      return null;
    }
    case 'fam_gift': {
      if (m.i == null) { // список того, что можно подарить
        const list = (ch.inventory.cells || []).map((x, i) => { const it = x && Items.get(x.id); return it && Fam.giftable(it) ? { i, id: x.id, name: it.name, n: x.n || 1, gain: Fam.giftAffinity(it) } : null; }).filter(Boolean);
        realtime.send(c, { t: 'npc-offer', id: n.id, what: 'gifts', gifts: list, money: settlements().wallet(ch), cooldown: Fam.ready(rel.giftAt, Fam.settings.familyGiftCooldownMin, now) ? 0 : 1 });
        return null;
      }
      if (!Fam.ready(rel.giftAt, Fam.settings.familyGiftCooldownMin, now)) return `${n.name}: «Ты и так меня балуешь. Давай в другой раз.»`;
      let item = null;
      const err = settlements().deal(ch, () => {
        const cell = (ch.inventory.cells || [])[Number(m.i)], it = cell && Items.get(cell.id);
        if (!it || !Fam.giftable(it)) return 'Это нельзя подарить.';
        const r = Inv.removeAt(ch, { c: 'cell', i: Number(m.i) }, 1);
        if (r && r.error) return r.error;
        item = it;
        return null;
      });
      if (err) return err;
      settlements().afterInv(c);
      rel.giftAt = now;
      const got = Fam.addAffinity(rel, Fam.giftAffinity(item), tier);
      combat().markDirty(c);
      relUpdate(room, c, n, tier, `${n.name}: «${item.name}? Для меня? Спасибо!» (симпатия +${Math.round(got * 10) / 10})`);
      return null;
    }
    case 'fam_court': {
      const e = Fam.canAdvance('fam_court', { ch, rel, gender });
      if (e) return e;
      rel.stage = 'courting';
      combat().markDirty(c);
      relUpdate(room, c, n, tier, `${n.name} смущённо улыбается: «Прогуляться вдоль стены? С удовольствием.» Начинается ухаживание.`);
      return null;
    }
    case 'fam_propose': {
      const e = Fam.canAdvance('fam_propose', { ch, rel, gender });
      if (e) return e;
      rel.stage = 'engaged';
      combat().markDirty(c);
      relUpdate(room, c, n, tier, `${n.name}: «Да! Конечно, да!» Помолвка! Свадьбу играют в поселении (нужна свободная кровать на базе и ${Fam.settings.familyCeremonyCost} крышек на праздник).`);
      return null;
    }
    case 'fam_wed': return wedding(room, c, n, rel, gender, tier);
    default: return 'Неизвестное действие.';
  }
}
function wedding(room, c, n, rel, gender, tier) {
  const ch = c.character, f = Fam.of(ch), stl = settlements();
  const e = Fam.ceremonyCheck({ ch, rel, tier, money: realtime.godOf(c.account.id).infiniteMoney ? Number.MAX_SAFE_INTEGER - 100 : stl.wallet(ch), freeBeds: Fam.freeBeds(f, bedsOf(c)) });
  if (e) return e;
  const err = stl.deal(ch, () => stl.pay(ch, Fam.settings.familyCeremonyCost, realtime.godOf(c.account.id).infiniteMoney));
  if (err) return err;
  const m = Fam.makeMember({ kind: 'partner', name: n.name, gender, origin: 'npc', role: 'heal', age: 22 + (n.name.length * 3) % 15, level: Math.max(1, Math.floor((ch.level || 1) / 2)) });
  m.from = rel.town;
  f.members.push(m);
  delete f.rel[Fam.relKey(room.world.id, n.id)];
  const rec = stl.recOf(room.world, n.sid);
  (rec.gone || (rec.gone = {}))[n.id] = ch.id; // житель переезжает на базу
  stl.removeNpc(room, n.id);
  stl.changeRep(room, c, n.sid, 5, 'свадьба');
  stl.afterInv(c);
  combat().markDirty(c);
  chat.system(room.id, `🎉 Свадьба в «${rel.town}»: ${ch.name} и ${n.name}! Всё поселение празднует. ${n.name} переезжает на базу.`);
  realtime.send(c, { t: 'npc-remove', id: n.id });
  send(c);
  return null;
}

// ---------- Сироты ----------
function orphanList(room, sid) {
  const rec = settlements().recOf(room.world, sid), adopted = rec.adopted || {};
  return Fam.orphansFor(room.map.seed, sid).filter((o) => !adopted[o.id]);
}
function orphans(room, c, n, m, tier) {
  if (n.role !== 'quest') return `${n.name}: «Про сирот знает староста.»`;
  const ch = c.character, f = Fam.of(ch);
  const list = orphanList(room, n.sid);
  if (m.adopt) {
    const o = list.find((x) => x.id === String(m.adopt));
    if (!o) return 'Этого ребёнка уже забрали.';
    if (tier === 'unfriendly' || tier === 'hostile') return `${n.name}: «Ребёнка — тому, кого здесь недолюбливают? Нет.»`;
    if (f.members.length >= Fam.settings.familyMaxMembers) return `В семье уже ${Fam.settings.familyMaxMembers} человек.`;
    if (!Fam.freeBeds(f, bedsOf(c))) return 'Ребёнку нужна своя кровать на вашей базе.';
    const kid = Fam.makeMember({ kind: 'child', name: o.name, gender: o.gender, origin: 'orphan', age: o.age, study: Fam.ROLES[m.study] ? m.study : 'gather' });
    kid.from = townName(room, n.sid);
    f.members.push(kid);
    const rec = settlements().recOf(room.world, n.sid);
    (rec.adopted || (rec.adopted = {}))[o.id] = ch.name;
    settlements().markWorldDirty(room.world);
    combat().markDirty(c);
    chat.system(room.id, `${ch.name} принимает в семью ${o.name} из «${kid.from}».`);
    send(c);
  }
  realtime.send(c, { t: 'npc-offer', id: n.id, what: 'orphans', orphans: orphanList(room, n.sid), beds: Fam.freeBeds(f, bedsOf(c)), money: settlements().wallet(ch), ...(m.adopt ? { say: `${n.name}: «Береги ребёнка. Пусть у него будет дом.»` } : {}) });
  return null;
}

// ---------- Члены семьи: дела, поход, дом ----------
function memberOf(c, id) { return Fam.of(c.character).members.find((m) => m.id === String(id || '')) || null; }
function goOut(c, m) {
  const ch = c.character, room = c.room;
  if (m.out) return null;
  if (!room || !room.map) return 'Нужно быть в мире.';
  if (!C.freeSlots(ch)) return `Все места спутников заняты (Напарники: ${C.slots(ch)}).`;
  const def = Enemies.get('family_kin');
  const rec = C.makeRecord(def, m.level || 1, 'family', 'c' + m.id.slice(1, 9) + Math.floor(Math.random() * 1296).toString(36));
  rec.name = m.name; rec.fam = m.id;
  if(m.kind==='child'){rec.loadoutInitialized=true;rec.equip={};rec.bag=[];}
  ch.companions = C.list(ch).concat(rec);
  m.out = true;
  companions().spawnEnt(room, c, rec);
  companions().sendList(c);
  changed(c);
  return null;
}
function sendHome(c, famId, why = 'отправляется домой') {
  const ch = c.character, m = memberOf(c, famId);
  for (const rec of C.list(ch).filter((r) => r.fam === famId)) { if (c.room) companions().removeEnt(c.room, rec.id); }
  ch.companions = C.list(ch).filter((r) => r.fam !== famId);
  if (m) { m.out = false; chat.tell(c, `${m.name} ${why}.`); }
  companions().sendList(c);
  changed(c);
  return null;
}
function childProtected(room,c,ent,rec){
  const m=rec.fam&&memberOf(c,rec.fam);if(m?.kind!=='child')return false;
  if(!m.out)return true;
  const h=homeOf(room,c.account.id);return Boolean(h&&dist(ent,h.flag)<=h.r);
}
function childDeath(c,rec){
  const m=rec.fam&&memberOf(c,rec.fam);if(m?.kind!=='child')return false;
  Fam.of(c.character).members=Fam.of(c.character).members.filter(x=>x.id!==m.id);
  combat().markDirty(c);send(c);return true;
}
function updateChildren(c,now){
  const f=Fam.of(c.character),key=f.members.filter(m=>m.kind==='child').map(m=>m.id+':'+Fam.ageOf(m,now)).join('|');
  if(c.familyAgeKey===key)return;c.familyAgeKey=key;
  for(const rec of C.list(c.character))if(rec.fam){const m=memberOf(c,rec.fam);if(m?.kind==='child'){
    rec.level=Math.max(rec.level,m.level||1);const ent=companions().entOf(c.room,rec.id);
    if(ent)c.room.broadcast({t:'comp-family',id:ent.id,family:{id:m.id,kind:m.kind,age:Fam.ageOf(m,now),gender:m.gender,adultAge:Fam.settings.familyAdultAge}});
  }}
  changed(c);
}
function births(c,now=Date.now()) {
  const f=Fam.of(c.character);let any=false;
  for(const mother of [f,...f.members])if(mother.pregnancy&&mother.pregnancy.due<=now) {
    if(f.members.length>=Fam.settings.familyMaxMembers)continue;
    const gender=Math.random()<0.5?'female':'male';
    const kid=Fam.makeMember({kind:'child',name:gender==='female'?'Новорождённая дочь':'Новорождённый сын',gender,origin:'birth',age:0},now);
    kid.parents=[c.character.name,mother.pregnancy.partner];f.members.push(kid);delete mother.pregnancy;any=true;
    chat.tell(c,'👶 В вашей семье родился ребёнок: '+kid.name+'.');
  }
  if(any)changed(c);
}
function together(c,mem,conceive) {
  if(c.cb?.dead)return 'Совместный отдых доступен живому герою.';
  if(!mem||mem.kind!=='partner'||Fam.ageOf(mem)<18||Number(c.character.age??25)<18)return 'Совместный отдых доступен взрослым супругам от 18 лет.';
  if(mem.out)return 'Верните супруга домой.';
  const h=homeOf(c.room,c.account.id);
  if(!h||!h.beds.some(b=>dist(c.pos,{x:b.x+.5,y:b.y+.5})<=2.5))return 'Подойдите к кровати на своей базе.';
  if(!Fam.housed(Fam.of(c.character),h.beds.length).has(mem.id))return 'Супругу нужна кровать на базе.';
  if(conceive) {
    if(Fam.heroGender(c.character)==='female'?mem.gender==='female':mem.gender==='male')return 'Для рождения ребёнка нужны супруги разного пола.';
    const f=Fam.of(c.character);
    if(f.pregnancy||f.members.some(m=>m.pregnancy))return 'В семье уже ожидают ребёнка.';
    if(f.members.length>=Fam.settings.familyMaxMembers||Fam.freeBeds(f,h.beds.length)<1)return 'Подготовьте свободное место в семье и отдельную кровать ребёнку.';
    const mother=Fam.heroGender(c.character)==='female'?f:mem;
    mother.pregnancy={due:Date.now()+Math.max(1,Fam.settings.familyPregnancyMin)*60000,partner:mem.name};
    chat.tell(c,'💞 Вы провели время вместе. Семья ожидает ребёнка; срок показан в панели F3.');
  }else chat.tell(c,'🌙 Вы отдыхаете вместе. Отдых прервётся при движении или опасности.');
  require('./survival').startRest(c.room,c);changed(c);return null;
}
// Согласовать семью и спутников, вырастить детей (вход, панель)
function sync(c, now = Date.now()) {
  const ch = c.character, f = Fam.of(ch);
  births(c,now);
  const recs = new Map(C.list(ch).filter((r) => r.fam).map((r) => [r.fam, r]));
  for (const m of f.members) if (m.out && !recs.has(m.id)) m.out = false; // спутник пропал — вернулся домой
  if ([...recs.keys()].some((id) => !f.members.some((m) => m.id === id))) ch.companions = C.list(ch).filter((r) => !r.fam || f.members.some((m) => m.id === r.fam));
  for (const m of f.members) if (Fam.grow(m, now)) chat.tell(c, `🎓 ${m.name} повзрослел(а)! Теперь помогает на базе: ${Fam.ROLES[m.role].name.toLowerCase()} (уровень ${m.level}).`);
}
function acceptInvite(c, who, yes) {
  const ch = c.character, f = Fam.of(ch);
  if (!(ch.familyInvites || []).includes(who)) return 'Приглашения нет.';
  ch.familyInvites = ch.familyInvites.filter((x) => x !== who);
  if (yes) {
    if (f.members.length >= Fam.settings.familyMaxMembers) { ch.familyInvites.push(who); return `В семье уже ${Fam.settings.familyMaxMembers} человек.`; }
    const m = Fam.makeMember({ kind: 'elder', name: 'Железный Патриарх', gender: 'male', origin: 'patriarch', role: 'guard', age: 97, level: 30 });
    f.members.push(m);
    if (c.room) chat.system(c.room.id, `Железный Патриарх входит в семью ${ch.name}. Старик охраняет базу и рассказывает детям истории довоенного мира.`);
  }
  changed(c);
  return null;
}

// ---------- Семейный союз игроков ----------
function asks(room) { if (!room.famAsks) room.famAsks = new Map(); return room.famAsks; }
const askKey = (from, to) => `${from}>${to}`;
function bondProblem(a, b) {
  if (a === b) return 'Нельзя создать семью с самим собой.';
  if (Fam.hasSpouse(Fam.of(a.character))) return `У ${a.character.name} уже есть супруг(а).`;
  if (Fam.hasSpouse(Fam.of(b.character))) return `У ${b.character.name} уже есть супруг(а).`;
  if (!Fam.compatible(a.character, Fam.heroGender(b.character))) return 'Семью по правилам этого мира создают с персонажем противоположного пола.';
  if (a.room !== b.room) return 'Вы должны быть в одном мире.';
  return null;
}
function propose(c, name) {
  const room = c.room;
  const t = [...room.players.values()].find((x) => x.character.name.toLowerCase() === String(name || '').trim().toLowerCase());
  if (!t) return 'Такого героя нет в этом мире.';
  const e = bondProblem(c, t);
  if (e) return e;
  if (dist(c.pos, t.pos) > 8) return 'Подойдите ближе — такое предлагают лично.';
  asks(room).set(askKey(c.account.id, t.account.id), { from: c.account.id, to: t.account.id, name: c.character.name, at: Date.now() });
  realtime.send(t, { t: 'fam-ask', from: c.account.id, name: c.character.name, sec: G().familyBondAskSec });
  send(t);
  chat.tell(c, `Вы предложили ${t.character.name} создать семью. Ждём ответа.`);
  return null;
}
function setAllow(accountId, otherId, otherName, add) {
  try {
    for (const b of bases.listOf(accountId)) {
      b.allow = Array.isArray(b.allow) ? b.allow : [];
      b.allowNames = b.allowNames || {};
      if (add && !b.allow.includes(otherId)) { b.allow.push(otherId); b.allowNames[otherId] = otherName; }
      if (!add) b.allow = b.allow.filter((x) => x !== otherId);
    }
    bases.saveOf(accountId);
  } catch { /* у аккаунта нет баз */ }
}
function answer(c, fromId, yes) {
  const room = c.room, k = askKey(String(fromId || ''), c.account.id), a = asks(room).get(k);
  asks(room).delete(k);
  if (!a || Date.now() - a.at > G().familyBondAskSec * 1000) { send(c); return 'Предложение уже не действует.'; }
  const from = room.players.get(a.from);
  if (!from) return 'Предложивший уже ушёл.';
  if (!yes) { chat.tell(from, `${c.character.name} пока не готов(а) создать семью.`); send(c); return null; }
  const e = bondProblem(from, c);
  if (e) return e;
  const now = Date.now();
  Fam.of(from.character).bond = { accountId: c.account.id, characterId: c.character.id, name: c.character.name, at: now };
  Fam.of(c.character).bond = { accountId: from.account.id, characterId: from.character.id, name: from.character.name, at: now };
  setAllow(from.account.id, c.account.id, c.character.name, true);
  setAllow(c.account.id, from.account.id, from.character.name, true);
  chat.system(room.id, `💞 ${from.character.name} и ${c.character.name} теперь семья! Базы друг друга открыты обоим.`);
  changed(from); changed(c);
  return null;
}
function endBond(c) {
  const f = Fam.of(c.character), b = f.bond;
  if (!b) return 'У вас нет семейного союза с игроком.';
  f.bond = null;
  const other = realtime.byAccount.get(b.accountId);
  if (other && other.character && other.character.id === b.characterId) { Fam.of(other.character).bond = null; chat.tell(other, `${c.character.name} расторгает семейный союз.`); changed(other); }
  else {
    try { const acc = auth.listAccounts().find((a) => a.id === b.accountId); if (acc) characters.update(acc, b.characterId, (x) => { if (x.family) x.family.bond = null; }); } catch { /* герой удалён */ }
  }
  setAllow(c.account.id, b.accountId, b.name, false);
  setAllow(b.accountId, c.account.id, c.character.name, false);
  chat.tell(c, `Семейный союз с ${b.name} расторгнут.`);
  changed(c);
  return null;
}

// ---------- Помощники на базе ----------
function tick(room, dt, now) {
  if (!on() || !real(room)) return;
  if (now < (room.famNext || 0)) return;
  const sec = Math.max(1, G().familyHelperTickSec);
  room.famNext = now + sec * 1000;
  for (const c of room.players.values()) {
    births(c,now);
    const ch = c.character, f = ch.family;
    if (!f || !f.members || !f.members.length) continue;
    for (const m of f.members) if (Fam.grow(m, now)) { chat.tell(c, `🎓 ${m.name} повзрослел(а)! Дело: ${Fam.ROLES[m.role].name.toLowerCase()}.`); changed(c); }
    updateChildren(c,now);
    const h = homeOf(room, c.account.id);
    if (!h) continue;
    const hs = Fam.housed(f, h.beds.length);
    f.members.forEach((m, i) => { if (Fam.helping(m, hs, now, i)) help(room, c, h, m, sec, i); });
  }
}
function help(room, c, h, m, sec, i) {
  const ch = c.character;
  if (m.role === 'guard') {
    let best = null, bd = Fam.settings.familyGuardRadius;
    for (const e of combat().stateOf(room).enemies.values()) { if (e.dead) continue; const d = dist(e, h.flag); if (d <= bd) { bd = d; best = e; } }
    if (best) combat().companionHit(room, { id: c.account.id, x: c.pos.x, y: c.pos.y }, best, Fam.settings.familyGuardDamage * (1 + 0.1 * ((m.level || 1) - 1)), 'physical', c);
  } else if (m.role === 'heal') {
    if (combat().cbOf(c).dead || dist(c.pos, h.flag) > h.r + 2) return;
    const max = combat().maxVitals(ch), v = ch.vitals;
    if (v && v.hp < max.hp) { v.hp = Math.min(max.hp, v.hp + Fam.settings.familyHealPerTick); combat().markDirty(c); combat().sendMe(c, true); }
  } else if (m.role === 'gather') {
    m.gatherAcc = (m.gatherAcc || 0) + sec;
    const need = Fam.settings.familyGatherMin * 60;
    if (m.gatherAcc < need) return;
    const chest = h.chests.find((p) => p.items.some((x) => !x || (x.n < ((Items.get(x.id) || {}).stack || 1))));
    if (!chest) { m.gatherAcc = need; return; } // некуда класть — ждёт сундук
    m.gatherAcc -= need;
    const id = Fam.GATHER_POOL[(Math.floor(Date.now() / 1000) + i) % Fam.GATHER_POOL.length];
    const it = Items.get(id), stack = (it && it.stack) || 1;
    const same = chest.items.findIndex((x) => x && x.id === id && x.n < stack);
    if (same >= 0) chest.items[same].n += 1;
    else { const k = chest.items.indexOf(null); if (k < 0) return; chest.items[k] = { id, n: 1 }; }
    building().stateOf(room).dirty.add(h.base.id);
    room.broadcast({ t: 'bld-upd', id: chest.id, hp: Math.ceil(chest.hp), locked: chest.locked ? 1 : 0, n: chest.items.filter(Boolean).length });
    combat().markDirty(c);
  }
}
// Ремесло: пока дома живёт взрослый помощник «ремесло» (с кроватью), очередь крафта идёт быстрее
function craftFactor(c) {
  if (!on() || !c || !c.character || !c.character.family) return 1;
  const f = c.character.family, hs = Fam.housed(f, bedsOf(c));
  return f.members.some((m) => m.role === 'craft' && !m.out && hs.has(m.id) && Fam.isAdult(m)) ? 1 - Fam.settings.familyCraftSpeedup : 1;
}

// ---------- Сигналы других систем ----------
// Задание старосты выполнено / набег отбит: знакомые жители поселения теплеют
function onTownDeed(room, c, sid, amount) {
  if (!on() || !real(room) || sid == null) return;
  const f = Fam.of(c.character), prefix = room.world.id + ':n' + sid + '_';
  let n = 0;
  for (const [k, r] of Object.entries(f.rel)) if (k.startsWith(prefix) && r.affinity > 0) { Fam.addAffinity(r, amount); n++; }
  if (n) { combat().markDirty(c); send(c); }
}
const onQuestDone = (room, c, sid) => onTownDeed(room, c, sid, Fam.settings.familyQuestAffinity);
const onRaidDefended = (room, c, sid) => onTownDeed(room, c, sid, Fam.settings.familyHelpAffinity);
// Приглашение из концовки «Семья» (шаг 16)
function invite(c, who) {
  const ch = c.character;
  ch.familyInvites = [...new Set([...(ch.familyInvites || []), who])];
  send(c);
}

// ---------- ГМ ----------
function target(body) {
  const { acc, ch } = inventory().resolveTarget(body.username, body.character);
  const c = realtime.byAccount.get(acc.id);
  return { acc, ch, live: c && c.character && c.character.id === ch.id ? c : null };
}
function adminList(body = {}) {
  const { ch, live } = target(body);
  const f = Fam.sanitize(live ? live.character.family : ch.family);
  const now = Date.now();
  return {
    character: ch.name, online: live ? 1 : 0, bond: f.bond, invites: (live ? live.character : ch).familyInvites || [],
    members: f.members.map((m) => ({ id: m.id, kind: m.kind, name: m.name, age: Fam.ageOf(m, now), adult: Fam.isAdult(m, now) ? 1 : 0, role: m.role, study: m.study || null, level: m.level, out: m.out ? 1 : 0, origin: m.origin })),
    rel: Object.entries(f.rel).map(([key, r]) => ({ key, name: r.name, town: r.town, affinity: Math.floor(r.affinity), stage: r.stage })),
    stages: Fam.STAGE_IDS.filter((s) => s !== 'partner'), kinds: Object.keys(Fam.KINDS), roles: Fam.ROLE_IDS,
  };
}
// act: rel { key, affinity?, stage? } | relDel { key } | add { kind, name, gender?, role?, age?, level? } | remove { id } | invite
function adminAct(admin, body = {}) {
  const { acc, ch, live } = target(body);
  const apply = (x) => {
    const f = Fam.of(x);
    switch (body.act) {
      case 'rel': {
        const r = f.rel[String(body.key || '')];
        if (!r) throw new auth.HttpError(404, 'Таких отношений нет.');
        if (body.affinity != null) { const v = Number(body.affinity); if (!Number.isFinite(v)) throw new auth.HttpError(400, 'Симпатия — число 0…100.'); r.affinity = Math.max(0, Math.min(100, v)); if (Fam.STAGES[r.stage].auto) r.stage = Fam.autoStage(r.affinity); }
        if (body.stage != null) { if (!Fam.STAGES[body.stage] || body.stage === 'partner') throw new auth.HttpError(400, 'Стадия: ' + Fam.STAGE_IDS.filter((s) => s !== 'partner').join(', ') + ' (супруга — «Добавить»).'); r.stage = body.stage; }
        return;
      }
      case 'relDel': delete f.rel[String(body.key || '')]; return;
      case 'add': {
        if (!Fam.KINDS[body.kind]) throw new auth.HttpError(400, 'Кто: ' + Object.keys(Fam.KINDS).join(', ') + '.');
        if (f.members.length >= Fam.settings.familyMaxMembers) throw new auth.HttpError(409, 'Семья полна.');
        if (body.kind === 'partner' && Fam.hasSpouse(f)) throw new auth.HttpError(409, 'У героя уже есть супруг(а).');
        const name = String(body.name || '').trim();
        if (!name) throw new auth.HttpError(400, 'Укажите имя.');
        f.members.push(Fam.makeMember({ kind: body.kind, name, gender: body.gender || Fam.genderOfName(name), origin: 'admin', role: body.role, study: body.role, age: body.age, level: body.level }));
        return;
      }
      case 'remove': {
        const id = String(body.id || '');
        if (!f.members.some((m) => m.id === id)) throw new auth.HttpError(404, 'Такого члена семьи нет.');
        f.members = f.members.filter((m) => m.id !== id);
        x.companions = C.list(x).filter((r) => r.fam !== id);
        return;
      }
      case 'invite': x.familyInvites = [...new Set([...(x.familyInvites || []), 'boss_super'])]; return;
      default: throw new auth.HttpError(400, 'act: rel, relDel, add, remove, invite.');
    }
  };
  if (live) {
    apply(live.character);
    if (body.act === 'remove') { for (const ent of live.room && live.room.comp ? [...live.room.comp.ents.values()] : []) if (ent.owner === live.account.id && !C.list(live.character).some((r) => r.id === ent.id)) companions().removeEnt(live.room, ent.id); companions().sendList(live); }
    changed(live);
  } else characters.update(acc, ch.id, (x) => { apply(x); });
  auth.logAdmin(admin, 'family', { username: acc.username, character: ch.name, act: String(body.act || ''), key: body.key, id: body.id, kind: body.kind, name: body.name });
  return adminList(body);
}

// ---------- Сообщения ----------
function safely(c, fn) {
  let err;
  try { err = fn(); } catch (e) { err = e.message || String(e); }
  if (err) realtime.send(c, { t: 'fam-reject', message: err });
  return err;
}
realtime.use({
  welcome: (room, c) => (on() ? { fam: publicFamily(c) } : {}),
  onJoin: (room, c) => { if (on()) { Fam.of(c.character); sync(c); send(c); } },
  tick,
  handlers: {
    fam: (c, m) => safely(c, () => {
      const msg = m && typeof m === 'object' ? m : {};
      if (!on()) return 'Семья отключена на сервере.';
      if (!c.room) return 'Нужно быть в мире.';
      const mem = msg.id != null ? memberOf(c, msg.id) : null;
      switch (msg.a) {
        case 'together': return together(c,mem,Boolean(msg.conceive));
        case 'list': sync(c); send(c); return null;
        case 'role': {
          if (!mem) return 'Такого члена семьи нет.';
          if (!Fam.ROLES[msg.role]) return 'Дело: ' + Fam.ROLE_IDS.join(', ') + '.';
          if (Fam.isAdult(mem)) mem.role = msg.role; else mem.study = msg.role; // ребёнок — учится этому делу
          changed(c);
          return null;
        }
        case 'out': return mem ? goOut(c, mem) : 'Такого члена семьи нет.';
        case 'home': return mem ? sendHome(c, mem.id) : 'Такого члена семьи нет.';
        case 'invite': return acceptInvite(c, String(msg.who || 'boss_super'), Boolean(msg.yes));
        case 'bond': return propose(c, msg.name);
        case 'answer': return answer(c, msg.from, Boolean(msg.yes));
        case 'unbond': return endBond(c);
        default: return 'Неизвестное действие.';
      }
    }),
  },
});

module.exports = { childProtected,childDeath,relFor, npcAct, talkExtra, flagsFor, sendHome, send, sync, tick, craftFactor, onQuestDone, onRaidDefended, invite, homeOf, bedsOf, adminList, adminAct, publicFamily };
