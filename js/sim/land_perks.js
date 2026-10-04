// LAND perks and loadouts, infantry setup, medic extras and per-battle
// statistics. Perk definitions are data (E.PERKS in data/land.js); a perk is a
// set of multipliers / additions on the unit's modifier sheet `u.m`, whose
// keys are listed in S.M0 (land.js).
//
// Players pick perks with the `loadout` verb: w.verb(pid, 'loadout', 'heavy', ['heavy.suppressor', 'heavy.tandem'])
// The choice is stored on the player (p.loadout[class]) and applied the next
// time they deploy that class. Bots roll their own perks when they spawn.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;

  // the lead's E.FORCE.mix (data/units.js loads after data/land.js) -> include the engineer
  if (E.FORCE && E.LAND_MIX) E.FORCE.mix = E.LAND_MIX;

  // ── perk lookup ──────────────────────────────────────────────
  const BY_ID = {};
  for (const cls in E.PERKS) for (const tier of ['t1', 't2']) for (const p of E.PERKS[cls][tier]) { p.cls = cls; p.tier = tier; BY_ID[p.id] = p; }
  E.PERK_BY_ID = BY_ID;

  // validate a pick for a class: at most one perk per tier, ids must belong to that class
  function sanitize(cls, ids) {
    const out = [], P = E.PERKS[cls]; if (!P || !Array.isArray(ids)) return out;
    const got = { t1: null, t2: null };
    for (const id of ids) { const p = BY_ID[id]; if (p && p.cls === cls && !got[p.tier]) got[p.tier] = p.id; }
    if (got.t1) out.push(got.t1); if (got.t2) out.push(got.t2);
    return out;
  }

  // ── applying perks ───────────────────────────────────────────
  function applyPerks(u, ids) {
    const m = Object.assign({}, S.M0); m.hpAdd = 0;
    for (const id of ids) {
      const p = BY_ID[id]; if (!p) continue;
      if (p.mul) for (const k in p.mul) m[k] = (m[k] === undefined ? 1 : m[k]) * p.mul[k];
      if (p.add) for (const k in p.add) { if (k === 'hp') m.hpAdd += p.add[k]; else m[k] = (m[k] || 0) + p.add[k]; }
    }
    u.m = m; u.perks = ids.slice();
    const frac = u.maxHp > 0 ? u.hp / u.maxHp : 1;
    u.maxHp = Math.round(u.baseHp * m.hp + m.hpAdd); u.hp = Math.round(u.maxHp * frac);
    u.speed = u.def.speed * u.spM * m.speed;
    u.altT = Math.min(u.altT, 0.5);
  }

  function initInfantry(w, u) {
    u.stance = 0; u.supp = 0; u.suppT = -9; u.stam = 1; u.winded = false; u.sprinting = false; u.bloom = 0.004;
    u.vault = 0; u.vaultKind = ''; u.vaultD = null; u.vaultCd = 0; u.slideT = 0; u.slideCd = 0; u.pushT = 0;
    u.tool = 0; u.cycP = false; u.abil2P = false; u.buildT = 0; u.builds = []; u.mines = 0;
    u.baseHp = u.maxHp; u.m = S.M0; u.perks = []; u.lastAtt = 0; u.lastAttT = -9;
    const ai = u.ai; ai.peekT = 0; ai.peeking = false; ai.retreat = false; ai.cov = null; ai.mode = ''; ai.flankDone = false; ai.inCover = false; ai.dx = u.pos.x; ai.dz = u.pos.z; ai.dr = 1;
  }
  function randomPerks(w, cls) {
    const P = E.PERKS[cls], R = w.rng;
    if (!P) return [];
    return [P.t1[R.i(P.t1.length)].id, P.t2[R.i(P.t2.length)].id];
  }
  // spawn hook (common.js): every infantry gets its land state; bots roll perks
  function onSpawn(w, u) {
    if (u.kind === 'infantry') { initInfantry(w, u); applyPerks(u, randomPerks(w, u.type)); if (S.assignSquad) S.assignSquad(w, u); }
    else if (u.kind === 'vehicle') { u.crip = 0; u.aimLimited = false; u.vy = 0; u.lastZone = ''; }
    else if (u.kind === 'turret') { u.active = true; u.cd = 0; }
  }
  // deploy hook (sim.js): a player's own loadout replaces the bot roll
  function onDeploy(w, u, p) {
    initInfantry(w, u);
    const ids = (p.loadout && p.loadout[u.type]) || [];
    applyPerks(u, sanitize(u.type, ids));
    u.hp = u.maxHp;
    w.events.push({ type: 'loadout', uid: u.id, to: p.id, cls: u.type, perks: u.perks.slice() });
  }

  S.verbs.loadout = function (w, pid, cls, ids) {
    const p = w.players[pid]; if (!p || !E.PERKS[cls]) return null;
    p.loadout = p.loadout || {};
    const ok = sanitize(cls, ids);
    p.loadout[cls] = ok;
    return ok;
  };

  // ── medic extras (aura perks), every 0.5s ────────────────────
  function medicSystem(w, dt) {
    if (w.tickN % 15 !== 0) return;
    const U = w.units;
    for (const a of U) if (a.kind === 'infantry') a.auraRes = 0;
    for (const md of U) {
      if (!md.alive || md.type !== 'medic' || !md.m) continue;
      const m = md.m, R = 10.5 * m.aura, R2 = R * R;
      for (const a of U) {
        if (a === md || !a.alive || a.team !== md.team || a.kind !== 'infantry') continue;
        const d2 = V.distance2(a.pos, md.pos);
        if (d2 > R2) continue;
        if (m.aura > 1 && d2 > 110 && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + 5);   // the base aura (combat.js) covers 10.5m
        if (m.auraRes > 0) a.auraRes = Math.max(a.auraRes || 0, m.auraRes);
      }
    }
  }

  // ── statistics (battle reports and tests) ────────────────────
  function keyOf(u) { return u.kind === 'infantry' ? u.type : u.kind === 'vehicle' ? 'v_' + u.type : u.kind === 'turret' ? 't_' + u.type : u.kind; }
  function statsSystem(w, dt) {
    const L = w.landStats, ev = w.events, cur = w._lsEv || (w._lsEv = { arr: null, n: 0 });
    let from = cur.arr === ev ? cur.n : 0;
    if (w.tickN % 6 === 0) for (const u of w.units) if (u.alive && u.kind === 'infantry' && !u.pid) { L.infTicks++; if (u.ai.inCover) L.coverTicks++; }
    for (let i = from; i < ev.length; i++) {
      const e = ev[i];
      if (e.type === 'death') {
        const ku = e.by ? w.umap.get(e.by) : null;
        const vk = e.kind === 'infantry' ? e.utype : e.kind === 'vehicle' ? 'v_' + e.utype : e.kind === 'turret' ? 't_' + e.utype : e.kind;
        L.deaths[vk] = (L.deaths[vk] || 0) + 1;
        if (ku && e.kteam !== e.team) {
          const kk = keyOf(ku); L.kills[kk] = (L.kills[kk] || 0) + 1;
          if (e.kind === 'vehicle') L.vehKilledBy[kk] = (L.vehKilledBy[kk] || 0) + 1;
        } else if (e.kteam !== e.team) { L.kills[e.wk || 'other'] = (L.kills[e.wk || 'other'] || 0) + 1; }
      } else if (e.type === 'vault') L.vaults++;
      else if (e.type === 'cripple') L.cripples++;
      else if (e.type === 'suppress' && e.level === 2) L.suppressions++;
      else if (e.type === 'mineBlast') L.mineHits++;
      else if (e.type === 'repair') L.repairs++;
      else if (e.type === 'fire') { const ku = w.umap.get(e.uid); if (ku && ku.kind === 'infantry') { /* shots fired from cover */ if (ku.ai && ku.ai.inCover) L.shotsFromCover++; L.shots++; } }
    }
    cur.arr = ev; cur.n = ev.length;
  }
  function newStats() {
    return { kills: {}, deaths: {}, vehKilledBy: {}, coverBroken: 0, coverHits: 0, vaults: 0, cripples: 0, suppressions: 0, rams: 0, mineHits: 0, repairs: 0,
             shots: 0, shotsFromCover: 0, coverTicks: 0, infTicks: 0 };
  }

  S.systems.push(medicSystem, statsSystem);
  Object.assign(S, { applyPerks, sanitizePerks: sanitize, initInfantry, onSpawn, onDeploy, randomPerks, newLandStats: newStats, perkById: (id) => BY_ID[id] || null });
})(window.E = window.E || {});
