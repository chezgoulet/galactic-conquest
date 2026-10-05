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
      // the side with more boots in the circle takes it; defenders slow the count but cannot freeze it
      if (na !== nv) {
        const dir = na > nv ? 1 : -1, n = Math.min(6, Math.abs(na - nv)) * (c.contested ? 0.6 : 1);
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
      if (c.owner !== f || (c.n[en] > 0 && !c.home)) continue;   // no reinforcing straight into a post under assault (the home base always can)
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
      let inf = 0, air = 0, gun = 0, lander = false; const veh = { skiff: 0, tank: 0 }; let cap = null;
      for (const u of w.units) {
        if (!u.alive || u.team !== f) continue;
        if (u.kind === 'infantry') inf++; else if (u.kind === 'fighter') { air++; if (u.type === 'gunship') { gun++; if (u.air && u.air.task && u.air.task.type === 'drop') lander = true; } } else if (u.kind === 'vehicle') veh[u.type]++; else if (u.kind === 'capital' && !cap) cap = u;
      }
      T.alive = inf; T.capital = cap ? cap.id : 0;
      T.strikeT -= dt;
      if (T.tickets <= 0) continue;
      T.waveT -= dt;
      if (T.waveT <= 0) {
        T.waveT = 5.5;
        const n = Math.min(5, T.infCap - inf, T.tickets - inf);
        // every other wave comes down from the fleet by troop lander to a forward post (one
        // lander at a time): shoot it down on the way and the wave never arrives
        T.waveN = (T.waveN || 0) + 1;
        const lz = n >= 2 && T.waveN % 2 === 0 && !lander && S.sendLander ? spawnCP(w, f) : null;
        if (!(lz && !lz.home && S.sendLander(w, f, lz.pos, n)))
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
      // roster slot 2 is the gunship: a wing always keeps a troop lander
      if (air < T.airCap) {
        T.airT -= dt;
        if (T.airT <= 0) { const bay = S.carrierFor(w, f); T.airT = bay ? 11 : 24; const u = S.launchFighter(w, f, bay, gun ? w.rng.i(6) : 2); w.events.push({ type: 'launch', pos: V.clone(u.pos), team: f }); }
      }
      // AI fleet calls an orbital strike on a massed enemy
      if (T.strikeT <= 0 && cap && !cap.pid) {
        T.strikeT = E.WEAPONS.orbital.cd * (T.bonus.orbital ? 0.7 : 1.15) + w.rng.next() * 20;
        const en = S.enemyOf(f); let best = null, bn = 2;
        // never waste the salvo on ground under an enemy shield dome
        const open = (pos) => !(S.shielded && S.shielded(w, en, pos));
        for (const c of w.cps) if (c.n[en] > bn && c.n[f] === 0 && open(c.pos)) { bn = c.n[en]; best = c; }
        if (!best) { const tk = w.units.find(u => u.alive && u.team === en && (u.type === 'tank' || u.kind === 'turret') && open(u.pos)); if (tk && w.rng.next() < 0.6) best = tk; }
        if (best) S.strike(w, f, best.pos, null);
      }
    }
  }

  // ── battle objectives: what the fight is about beyond holding posts ──
  // Each side must break the other's shield generator to open its base to
  // orbital fire, and a contested uplink comes online mid-battle. Finishing one
  // swings reinforcements. (The building blocks are S.addObjective in land_struct.js.)
  const UPLINK_AT = 150, SWING = 20, OFFENSIVE_EVERY = 80, OFFENSIVE_FOR = 70;
  function setupObjectives(w) {
    if (!S.addObjective) return;
    for (const f of E.TEAMS) {
      const en = S.enemyOf(f), gen = w.units.find(u => u.alive && u.team === en && u.type === 'shieldgen');
      if (gen) S.addObjective(w, { type: 'destroy', target: gen.id, team: f, label: 'Destroy the shield generator', key: 'shieldgen' });
    }
  }
  function battleFlow(w, dt) {
    if (w.winner || !w.objs || w.tickN % 15 !== 0) return;
    if (!w.uplinkSet && w.t >= UPLINK_AT) {
      w.uplinkSet = true;
      // the post nobody calls home that is most fought over
      let c = null, bs = -1;
      for (const p of w.cps) { if (p.home) continue; const s = p.n.aegis + p.n.verdant + (p.contested ? 5 : 0) + (1 - Math.abs(p.cap)) * 3; if (s > bs) { bs = s; c = p; } }
      if (c) { S.addObjective(w, { type: 'uplink', pos: { x: c.pos.x + c.r * 1.6, z: c.pos.z }, r: 22, need: 45, team: null, label: 'Hold the uplink', key: 'uplink' }); w.events.push({ type: 'announce', key: 'uplinkOnline', team: null }); }
    }
    // The offensive: every so often a side masses for one post — every squad
    // converges on it, the fleet prepares it with an orbital strike and the wing
    // flies close support. This is what moves the front.
    for (const f of E.TEAMS) {
      const T = w.teams[f], en = S.enemyOf(f);
      if (T.effort && (w.t > T.effort.until || w.cps[T.effort.cp].owner === f)) T.effort = null;
      if (T.effortT === undefined) T.effortT = OFFENSIVE_EVERY * (0.5 + w.rng.next() * 0.5);
      T.effortT -= dt * 15;
      if (T.effort || T.effortT > 0) continue;
      T.effortT = OFFENSIVE_EVERY * (0.8 + w.rng.next() * 0.4);
      // the nearest post we do not hold: the front, not some far post that merely looks empty
      let c = null, bs = -1;
      for (const p of w.cps) {
        if (p.owner === f) continue;
        let nd = 1e9; for (const o of w.cps) if (o.owner === f) nd = Math.min(nd, E.distXZ(p.pos, o.pos));
        const s = 1000 / (nd + 200) - p.n[en] * 0.04 + (p.home ? -0.4 : 0) + w.rng.next() * 0.2;
        if (s > bs) { bs = s; c = p; }
      }
      if (!c) continue;
      T.effort = { cp: c.id, until: w.t + OFFENSIVE_FOR };
      for (const sq of w.squads || []) if (sq.team === f) sq.goalT = 0;   // everyone re-plans now
      w.events.push({ type: 'offensive', team: f, cp: c.id, pos: V.clone(c.pos), until: T.effort.until });
      if (T.strikeT <= 0 && !(S.shielded && S.shielded(w, en, c.pos)) && c.n[f] === 0 && S.strike(w, f, c.pos, null)) T.strikeT = E.WEAPONS.orbital.cd;
      if (S.taskAir) S.taskAir(w, f, 'any', c.pos, null);
    }
    for (const o of w.objs) {
      if (!o.done || o.paid) continue;
      o.paid = true;
      const win = o.winner || (o.success ? o.team : null);
      if (!win) continue;
      const lose = S.enemyOf(win);
      w.teams[win].tickets += SWING; w.teams[lose].tickets = Math.max(1, w.teams[lose].tickets - SWING);
      w.events.push({ type: 'announce', key: o.key === 'shieldgen' ? 'shieldgenDown' : 'objectiveWon', team: win, obj: o.id });
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

  S.systems.push(battleFlow);
  Object.assign(S, { setupObjectives, battleFlow, updateCPs, spawnCP, reinforce, bleedAndWin });
})(window.E = window.E || {});
