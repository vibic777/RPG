'use strict';
// Фракции на сервере (шаг 16): репутация героя у фракций (ch.factions, переходит с героем между мирами),
// враждебность врагов-членов фракций, рост и падение репутации за убийства и удары, сообщение fac, ГМ.
const F = require('../shared/factions');
const realtime = require('./realtime');
const characters = require('./characters');
const auth = require('./auth');
const chat = require('./chat');

const combat = () => require('./combat');

function sendFac(c, d) { realtime.send(c, { t: 'fac', reps: F.all(c.character), ...(d ? { d } : {}) }); }

// Изменить репутацию подключённого героя (с разносом). why — для чата при смене уровня отношения.
function change(c, f, delta, why, opts) {
  const ch = c.character;
  const before = F.all(ch);
  const d = F.change(ch, f, delta, opts);
  if (!Object.keys(d).length) return d;
  combat().markDirty(c);
  sendFac(c, d);
  for (const id of Object.keys(d)) {
    const t0 = F.tierOf(before[id]), t1 = F.tierOf(F.repOf(ch, id));
    if (t0 !== t1) chat.tell(c, `«${F.FACTIONS[id].name}»: отношение — ${require('../shared/settlements').TIERS[t1].name}${why ? ` (${why})` : ''}.`);
  }
  return d;
}

// Враг не нападает первым на этого игрока? (p — запись ИИ с id аккаунта)
function peaceful(room, e, p) {
  if (!e || !e.def || !p || !F.settings.factionsEnabled) return false;
  if (e.angry && e.angry.has(p.id)) return false;
  const c = room.players.get(p.id);
  return Boolean(c && !F.enemyHostile(c.character, e.def));
}
const peacefulTo = (c, e) => Boolean(c && e && F.settings.factionsEnabled && !(e.angry && e.angry.has(c.account.id)) && !F.enemyHostile(c.character, e.def));

// Игрок ударил врага: если фракция к нему не враждебна — она обижается (один раз на врага), сородичи рядом встают на защиту
function onHit(room, c, e) {
  if (!peacefulTo(c, e)) return;
  const f = F.ofEnemy(e.def), id = c.account.id;
  const r = require('./config').get().game.packAggroRadius;
  for (const o of combat().stateOf(room).enemies.values()) {
    if (o.dead || F.ofEnemy(o.def) !== f || Math.hypot(o.x - e.x, o.y - e.y) > r) continue;
    (o.angry || (o.angry = new Set())).add(id);
  }
  (e.angry || (e.angry = new Set())).add(id);
  change(c, f, -F.settings.factionAttackRep, 'нападение');
}

// Враг убит: все, кто делит опыт, теряют репутацию у его фракции (её враги довольны)
function onKill(room, e, share) {
  const { f, delta } = F.killDelta(e.def);
  if (!f || !F.settings.factionsEnabled) return;
  for (const c of share) change(c, f, delta, e.def.boss ? `убит ${e.def.name}` : 'убийство');
}

// ---------- ГМ ----------
// Задать репутацию героя у фракции: { username, character?, faction, value }
function adminSet(admin, body = {}) {
  const f = String(body.faction || '');
  if (!F.FACTIONS[f]) throw new auth.HttpError(400, `Фракция: ${F.IDS.join(', ')}.`);
  if (F.FACTIONS[f].locked) throw new auth.HttpError(400, `Репутацию у «${F.FACTIONS[f].name}» изменить нельзя.`);
  const v = Number(body.value);
  if (!Number.isFinite(v)) throw new auth.HttpError(400, 'Значение — число −100…100.');
  const { acc, ch } = require('./inventory').resolveTarget(body.username, body.character);
  const c = realtime.byAccount.get(acc.id);
  if (c && c.character && c.character.id === ch.id) {
    F.set(c.character, f, v);
    combat().persist(c);
    sendFac(c);
    chat.tell(c, `Администратор изменил вашу репутацию: «${F.FACTIONS[f].name}» — ${F.repOf(c.character, f)}.`);
  } else characters.update(acc, ch.id, (x) => { F.set(x, f, v); });
  auth.logAdmin(admin, 'faction', { username: acc.username, character: ch.name, faction: f, value: F.clamp(v) });
  return { character: ch.name, faction: f, rep: F.clamp(v), tier: F.tierOf(F.clamp(v)) };
}
const publicReps = (ch) => F.IDS.map((f) => ({ id: f, name: F.FACTIONS[f].name, rep: F.repOf(ch, f), tier: F.tierOf(F.repOf(ch, f)) }));

realtime.use({
  welcome: (room, c) => ({ fac: F.all(c.character) }),
});

module.exports = { sendFac, change, peaceful, peacefulTo, onHit, onKill, adminSet, publicReps };
