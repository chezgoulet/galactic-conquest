// AIR operations: troop-lander gunships, close-air-support call-ins, and
// mending / rearming near the carrier or the airfield.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;

  // ── troop landers ────────────────────────────────────────────
  // Put n troopers aboard (instant; the AI flies to the airfield first).
  function airLoad(w, u, n) {
    n = Math.max(0, Math.min(n | 0, u.def.carry || 0));
    u.load = []; for (let i = 0; i < n; i++) u.load.push(S.pickClass(w));
    u.carry = n;
    w.events.push({ type: 'airLoad', uid: u.id, team: u.team, n, to: u.pid });
    return n;
  }
  // Set them down around `pos`; returns the spawned infantry.
  function airUnload(w, u, pos) {
    const out = [], R = w.rng;
    for (const type of (u.load || [])) {
      const a = R.angle(), r = 4 + R.next() * 9;
      out.push(S.spawnUnit(w, 'infantry', type, u.team, { x: pos.x + Math.cos(a) * r, z: pos.z + Math.sin(a) * r }));
    }
    w.events.push({ type: 'airDrop', uid: u.id, team: u.team, n: out.length, pos: { x: pos.x, z: pos.z }, to: u.pid });
    u.carry = 0; u.load = null;
    return out;
  }
  // Task a gunship to ferry n troops to a landing zone. Returns the gunship, or
  // null (and an 'airUnavailable' event) if none is free. The lead wires the
  // reinforcement system to this instead of spawning at a command post.
  // A loaded lander sent straight from the fleet (or the airfield if no hangar
  // works): the reinforcement system's way of landing a wave at a forward post.
  function sendLander(w, team, pos, n) {
    const u = S.launchFighter(w, team, S.carrierFor ? S.carrierFor(w, team) : null, 2);
    if (u.type !== 'gunship') return null;
    const cnt = airLoad(w, u, Math.min(n | 0, u.def.carry));
    u.air.task = { type: 'drop', pos: { x: pos.x, z: pos.z }, n: cnt, stage: 'deliver', t: 0, pid: null };
    w.events.push({ type: 'airAccepted', uid: u.id, team, role: 'gunship', task: 'drop', pos: { x: pos.x, z: pos.z }, n: cnt, eta: Math.round(V.distance(u.pos, { x: pos.x, y: 0, z: pos.z }) / 50), to: null });
    return u;
  }
  function airDrop(w, team, pos, n, pid) {
    let best = null, bs = 1e12;
    const h = w.cps.find(c => c.home === team) || w.cps[0];
    for (const u of w.units) {
      if (!u.alive || u.kind !== 'fighter' || u.team !== team || u.type !== 'gunship' || u.pid) continue;
      if (u.air.task || u.air.mode === 'rtb' || u.hp < u.maxHp * 0.5) continue;
      const d = u.carry > 0 ? E.distXZ(u.pos, pos) : E.distXZ(u.pos, h.pos) + E.distXZ(h.pos, pos);
      if (d < bs) { bs = d; best = u; }
    }
    if (!best) { w.events.push({ type: 'airUnavailable', team, reason: 'none', what: 'drop', to: pid || null }); return null; }
    const cnt = Math.min(n | 0, best.def.carry);
    best.air.task = { type: 'drop', pos: { x: pos.x, z: pos.z }, n: cnt, stage: best.carry > 0 ? 'deliver' : 'pickup', t: 0, pid: pid || null };
    best.air.mode = '';
    w.events.push({ type: 'airAccepted', uid: best.id, team, role: 'gunship', task: 'drop', pos: { x: pos.x, z: pos.z }, n: cnt, eta: Math.round(bs / 45), to: pid || null });
    return best;
  }

  // ── close air support ────────────────────────────────────────
  const CAS_ROLES = { bomber: 1, gunship: 1, strike: 1 };
  // Request a strike at pos {x, z}. role: 'bomber' | 'gunship' | 'strike' | 'any'.
  // Returns the tasked aircraft or null. Events: airAccepted, airInbound,
  // airWeaponsAway, airComplete, airUnavailable.
  function taskAir(w, team, role, pos, pid) {
    const K = E.AIR; w.air = w.air || { callT: {} };
    const last = w.air.callT[team];
    if (last !== undefined && w.t < last + K.callCooldown) {
      w.events.push({ type: 'airUnavailable', team, reason: 'cooldown', wait: Math.ceil(last + K.callCooldown - w.t), to: pid || null });
      return null;
    }
    let best = null, bs = 1e12;
    for (const u of w.units) {
      if (!u.alive || u.kind !== 'fighter' || u.team !== team || u.pid || !CAS_ROLES[u.def.role]) continue;
      if (role && role !== 'any' && u.def.role !== role) continue;
      const a = u.air;
      if (a.cas || (a.task && a.task.type === 'drop') || a.mode === 'rtb' || a.mode === 'reload' || u.hp < u.maxHp * 0.45 || !(u.ord > 0)) continue;
      let s = E.distXZ(u.pos, pos);
      if (role === 'any' && u.def.role === 'strike') s += 800;       // strike craft are for capitals
      if (s < bs) { bs = s; best = u; }
    }
    if (!best) { w.events.push({ type: 'airUnavailable', team, reason: 'none', to: pid || null }); return null; }
    w.air.callT[team] = w.t;
    const a = best.air;
    a.cas = { x: pos.x, z: pos.z, until: w.t + 80, pid: pid || null, fired: false, inbound: false };
    a.task = { type: 'cas', pos: { x: pos.x, z: pos.z }, pid: pid || null, fired: false };
    a.tid = 0; a.hasPt = false; a.mode = ''; a.planT = 0;
    w.events.push({ type: 'airAccepted', uid: best.id, team, role: best.def.role, task: 'cas', pos: { x: pos.x, z: pos.z }, eta: Math.round(bs / Math.max(40, best.spd)), to: pid || null });
    return best;
  }

  S.verbs = S.verbs || {};
  // a ground player / commander marks a position for a strike
  S.verbs.callAir = function (w, pid, a, b) {
    const p = w.players[pid]; if (!p || !a || w.winner) return null;
    const u = taskAir(w, p.team, typeof b === 'string' ? b : 'any', { x: a.x, z: a.z }, pid);
    return u ? { uid: u.id, role: u.def.role, eta: Math.round(E.distXZ(u.pos, a) / Math.max(40, u.spd)) } : null;
  };
  // the pilot of a loaded gunship sets the troops down (hover low and slow)
  S.verbs.drop = function (w, pid) {
    const p = w.players[pid], u = p && p.unitId ? w.umap.get(p.unitId) : null;
    if (!u || u.kind !== 'fighter' || !(u.carry > 0) || u.agl > 45 || u.spd > 22) return null;
    return S.airUnload(w, u, u.pos).length;
  };

  // ── mending and rearming ─────────────────────────────────────
  function airOpsSystem(w, dt) {
    const K = E.AIR, U = w.units;
    for (let i = 0; i < U.length; i++) {
      const u = U[i];
      if (u.kind !== 'fighter' || !u.alive || !u.fl) continue;
      if (w.tickN % 3 !== 0) continue;
      const step = dt * 3;
      let near = false;
      for (let j = 0; j < U.length && !near; j++) {
        const c = U[j];
        if (c.kind === 'capital' && c.alive && c.team === u.team) {
          const r = c.def.len * 0.5 + 220, dx = u.pos.x - c.pos.x, dz = u.pos.z - c.pos.z;
          if (dx * dx + dz * dz < r * r && Math.abs(u.pos.y - c.pos.y) < 260) near = true;
        }
      }
      if (!near && u.def.vtol && u.agl < 40 && u.spd < 18) {      // hovering over the home airfield
        const h = w.cps.find(c => c.home === u.team);
        if (h && E.distXZ2(u.pos, h.pos) < 60 * 60) near = true;
      }
      if (near && u.hitT > 2) {
        if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * K.hullRepair * step);
        if (u.ord < u.def.ord) u.ordT += step * 2.5;
        if (u.cm < u.def.cm) u.cmT += step * 3;
      }
      // a human gunship picks up troops hovering over the airfield
      if (u.pid && u.def.carry && u.carry === 0 && u.agl < 35 && u.spd < 14) {
        const h = w.cps.find(c => c.home === u.team);
        if (h && E.distXZ2(u.pos, h.pos) < 45 * 45) { u.loadT = (u.loadT || 0) + step; if (u.loadT > 3) { airLoad(w, u, u.def.carry); u.loadT = 0; } } else u.loadT = 0;
      }
    }
  }
  S.systems = S.systems || []; S.systems.push(airOpsSystem);

  Object.assign(S, { airLoad, airUnload, sendLander, airDrop, taskAir });
})(window.E = window.E || {});
