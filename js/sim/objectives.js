// The battle's objectives and flow: command-post capture, reinforcement waves,
// ticket bleed and the win condition.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  // ── command posts ────────────────────────────────────────────
  function updateCPs(w, dt) {
    let a = 0, v = 0;
    for (const c of w.cps) {
      c.n.aegis = 0; c.n.verdant = 0;
      for (const u of w.units) {
        if (!u.alive || (u.kind !== 'infantry' && u.kind !== 'vehicle')) continue;
        if (E.distXZ2(u.pos, c.pos) < c.r * c.r && Math.abs(u.pos.y - c.pos.y) < 14) c.n[u.team]++;
      }
      const na = c.n.aegis, nv = c.n.verdant;
      c.contested = na > 0 && nv > 0;
      if (!c.contested && (na || nv)) {
        const dir = na ? 1 : -1, n = Math.min(6, na || nv);
        const before = c.cap;
        c.cap = E.clamp(c.cap + dir * (0.05 + 0.02 * n) * dt, -1, 1);
        const team = dir > 0 ? 'aegis' : 'verdant';
        if (c.owner && c.owner !== team && ((before > 0) !== (c.cap > 0) || c.cap === 0)) {
          const prev = c.owner; c.owner = null;
          w.events.push({ type: 'neutral', cp: c.id, prev, team });
        }
        if (c.owner !== team && Math.abs(c.cap) >= 1) {
          c.owner = team; w.teams[team].captures++;
          w.events.push({ type: 'capture', cp: c.id, team, pos: V.clone(c.pos) });
          for (const u of w.units) if (u.alive && u.pid && u.team === team && E.distXZ2(u.pos, c.pos) < c.r * c.r) { const p = w.players[u.pid]; if (p) { p.captures++; S.score(w, p.id, 250, 'COMMAND POST CAPTURED'); } }
        }
      } else if (!na && !nv) {
        const rest = c.owner === 'aegis' ? 1 : c.owner === 'verdant' ? -1 : 0;
        c.cap = E.approach(c.cap, rest, 0.03 * dt);
      }
      if (c.owner === 'aegis') a++; else if (c.owner === 'verdant') v++;
    }
    w.teams.aegis.cps = a; w.teams.verdant.cps = v;
  }

  // ── reinforcements ───────────────────────────────────────────
  function spawnCP(w, f) {
    const en = S.enemyOf(f); let best = null, bs = -1;
    for (const c of w.cps) {
      if (c.owner !== f || c.n[en] > c.n[f] + 2) continue;
      let nd = 1e9;
      for (const o of w.cps) if (o.owner !== f) nd = Math.min(nd, E.distXZ(c.pos, o.pos));
      const s = (1 / (nd + 120)) * (0.5 + w.rng.next());
      if (s > bs) { bs = s; best = c; }
    }
    return best;
  }
  function reinforce(w, dt) {
    for (const f of E.TEAMS) {
      const T = w.teams[f];
      let inf = 0, air = 0; const veh = { skiff: 0, tank: 0 }; let cap = null;
      for (const u of w.units) {
        if (!u.alive || u.team !== f) continue;
        if (u.kind === 'infantry') inf++; else if (u.kind === 'fighter') air++; else if (u.kind === 'vehicle') veh[u.type]++; else if (u.kind === 'capital' && !cap) cap = u;
      }
      T.alive = inf; T.capital = cap ? cap.id : 0;
      T.strikeT -= dt;
      if (T.tickets <= 0) continue;
      T.waveT -= dt;
      if (T.waveT <= 0) {
        T.waveT = 5.5;
        const n = Math.min(5, T.infCap - inf, T.tickets - inf);
        for (let i = 0; i < n; i++) { const c = spawnCP(w, f); if (!c) break; S.spawnUnit(w, 'infantry', S.pickClass(w), f, S.ring(w, c.pos, 5, c.r * 0.85)); }
      }
      for (const type of ['skiff', 'tank']) {
        if (veh[type] >= (T.vehCap[type] || 0)) { continue; }
        T.vehT[type] -= dt;
        if (T.vehT[type] <= 0) {
          T.vehT[type] = type === 'tank' ? 45 : 28;
          const home = w.cps.find(c => c.home === f), c = home.owner === f ? home : spawnCP(w, f);
          if (c) S.spawnUnit(w, 'vehicle', type, f, S.ring(w, c.pos, c.r * 0.6, c.r * 1.1));
        }
      }
      if (air < T.airCap) {
        T.airT -= dt;
        if (T.airT <= 0) { T.airT = cap ? 11 : 24; const u = S.launchFighter(w, f, cap, w.rng.i(6)); w.events.push({ type: 'launch', pos: V.clone(u.pos), team: f }); }
      }
      // AI fleet calls an orbital strike on a massed enemy
      if (T.strikeT <= 0 && cap && !cap.pid) {
        T.strikeT = E.WEAPONS.orbital.cd * (T.bonus.orbital ? 0.7 : 1.15) + w.rng.next() * 20;
        const en = S.enemyOf(f); let best = null, bn = 2;
        for (const c of w.cps) if (c.n[en] > bn && c.n[f] === 0) { bn = c.n[en]; best = c; }
        if (!best) { const tk = w.units.find(u => u.alive && u.team === en && (u.type === 'tank' || u.kind === 'turret')); if (tk && w.rng.next() < 0.6) best = tk; }
        if (best) S.strike(w, f, best.pos, null);
      }
    }
  }

  function bleedAndWin(w, dt) {
    if (w.winner) return;
    const A = w.teams.aegis, Vd = w.teams.verdant;
    for (const [T, O] of [[A, Vd], [Vd, A]]) {
      const diff = O.cps - T.cps;
      if (diff > 0 && O.cps >= 3) {
        T.bleedT += dt;
        const iv = diff >= 4 ? 1.2 : diff === 3 ? 2.2 : diff === 2 ? 4 : 7;
        if (T.bleedT >= iv) { T.bleedT = 0; T.tickets = Math.max(0, T.tickets - 1); }
      } else T.bleedT = 0;
    }
    let win = null;
    const wiped = (T) => T.cps === 0 && !w.units.some(u => u.alive && u.team === T.id && (u.kind === 'infantry' || u.kind === 'vehicle'));
    const la = A.tickets <= 0 || wiped(A), lv = Vd.tickets <= 0 || wiped(Vd);
    if (la && lv) win = A.kills >= Vd.kills ? 'aegis' : 'verdant';
    else if (la) win = 'verdant'; else if (lv) win = 'aegis';
    if (win) { w.winner = win; w.endT = w.t; w.events.push({ type: 'gameOver', winner: win }); }
    // low-ticket warnings
    for (const T of [A, Vd]) { const q = T.tickets <= 25 ? 2 : T.tickets <= T.startTickets * 0.5 ? 1 : 0; if (q > (T.warned || 0)) { T.warned = q; w.events.push({ type: 'announce', key: q === 2 ? 'ticketsLow' : 'ticketsHalf', team: T.id }); } }
  }

  Object.assign(S, { updateCPs, spawnCP, reinforce, bleedAndWin });
})(window.E = window.E || {});
