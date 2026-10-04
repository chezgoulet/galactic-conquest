// The simulation step. Pure and deterministic — draws only from world.rng,
// reads/writes world state, and emits world.events (drained by the renderer /
// audio / HUD / netcode). The World owns the state; js/sim/* own the rules:
//   common.js      helpers + unit construction      ai.js      shared perception/intent
//   combat.js      weapons, projectiles, damage     land.js    infantry, vehicles, turrets
//   objectives.js  posts, reinforcements, victory   air.js     fighters, bombers
//   sim.js         setup, per-tick step, verbs      space.js   capital ships, orbital strikes
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  const RESPAWN = 4;

  // ── setup ────────────────────────────────────────────────────
  function setup(w) {
    if (S.setupLand) S.setupLand(w); // land: cover, structures, objectives state
    for (const f of E.TEAMS) {
      const T = w.teams[f], home = w.cps.find(c => c.home === f), sgn = f === 'aegis' ? 1 : -1;
      for (let i = 0; i < T.infCap; i++) S.spawnUnit(w, 'infantry', S.pickClass(w), f, S.ring(w, home.pos, 6, home.r * 0.9));
      const vs = Object.assign({}, E.FORCE.vehicles); if (T.bonus.armor) vs.tank++;
      T.vehCap = vs;
      for (const [type, n] of Object.entries(vs)) for (let i = 0; i < n; i++) S.spawnUnit(w, 'vehicle', type, f, { x: home.pos.x - sgn * 20, z: home.pos.z + (i * 2 - 1) * 16 + (type === 'tank' ? 34 : -34) });
      for (const s of [-1, 1]) S.spawnUnit(w, 'turret', 'battery', f, { x: home.pos.x + sgn * 22, z: home.pos.z + s * 26 });
      // an explicitly empty fleet (a campaign world with no garrison left) fields no ships at all
      if (T.fleet.length) S.deployFleet(w, f);
      if (T.fleetHp) {   // campaign damage carried into the battle, ship by ship in fleet order
        const caps = w.units.filter(u => u.kind === 'capital' && u.team === f);
        T.fleetHp.forEach((hp, i) => {
          const cu = caps[i]; if (!cu || !(hp < 1)) return;
          cu.hp = Math.max(1, Math.round(cu.maxHp * hp));
          if (cu.arcs) for (const arc of cu.arcs) arc.v *= hp;
          cu.shield = Math.round(cu.shield * hp);
        });
      }
      T.airCap = (T.bonus.wing !== undefined ? T.bonus.wing : E.DOCTRINE[f].fighters) + (T.bonus.airwing ? 2 : 0);
      const cap = w.units.find(u => u.kind === 'capital' && u.team === f);
      for (let i = 0; i < T.airCap; i++) S.launchFighter(w, f, S.carrierFor(w, f, i) || cap, i);
    }
    for (const u of w.units) u.bornT = -10;
    w.events.length = 0;
  }

  // ── per-unit step: cooldowns, then the player's or the bot's control ──
  function control(w, u, dt) {
    u.fireT = Math.max(0, u.fireT - dt); u.altT -= dt; u.hitT += dt;
    if (u.heat > 0) { u.heat = Math.max(0, u.heat - (u.hot ? 0.5 : 0.36) * dt); if (u.hot && u.heat < 0.2) u.hot = false; }
    const p = u.pid ? w.players[u.pid] : null, c = (u.mode && S.modes[u.mode]) || S.ctl[u.kind];
    if (p) { c.player(w, u, p, dt); return; }
    if (u.pid) u.pid = null;
    c.ai(w, u, dt);
  }

  // ── player verbs ─────────────────────────────────────────────
  function release(w, pid) {
    const p = w.players[pid]; if (!p) return;
    const u = p.unitId ? w.umap.get(p.unitId) : null;
    if (u) { u.pid = null; u.ai.thinkT = 0; u.aimYaw = u.yaw; if (u.kind === 'fighter') u.ai.state = ''; }
    p.unitId = 0;
  }
  function possess(w, pid, uid) {
    const p = w.players[pid], u = w.umap.get(uid);
    if (!p || !u || !u.alive || u.team !== p.team || (u.pid && u.pid !== pid)) return false;
    release(w, pid);
    u.pid = pid; p.unitId = uid; u.order = null;
    p.input.yaw = p.input.moveYaw = u.aimYaw; p.input.pitch = u.kind === 'fighter' ? u.pitch : 0;
    w.events.push({ type: 'possess', to: pid, uid });
    return true;
  }
  function deploy(w, pid, type, cpId) {
    const p = w.players[pid]; if (!p || w.winner) return null;
    const T = w.teams[p.team], c = w.cps[cpId];
    if (!c || c.owner !== p.team || T.tickets <= 0 || !E.INFANTRY[type]) return null;
    if (p.unitId && w.umap.get(p.unitId)) return null;
    if (w.t - p.deadT < RESPAWN) return null;
    const u = S.spawnUnit(w, 'infantry', type, p.team, S.ring(w, c.pos, 4, c.r * 0.6));
    u.yaw = u.aimYaw = Math.atan2(-u.pos.x, -u.pos.z);
    if (S.onDeploy) S.onDeploy(w, u, p); // land: apply the player's loadout
    possess(w, pid, u.id);
    return u;
  }
  function order(w, pid, ids, type, pos) {
    const p = w.players[pid]; if (!p) return;
    let n = 0;
    for (const id of ids || []) {
      const u = w.umap.get(id);
      if (!u || !u.alive || u.team !== p.team || u.pid || u.kind === 'capital' || u.kind === 'turret') continue;
      u.order = type === 'free' ? null : { type, pos: pos ? { x: pos.x, y: 0, z: pos.z } : V.clone(u.pos), t: w.t, pid };
      u.ai.offT = 0; n++;
    }
    w.events.push({ type: 'order', to: pid, n, order: type, pos: pos ? V.clone(pos) : null });
  }

  // ── intensity (drives music) ─────────────────────────────────
  function intensity(w) {
    let firing = 0, total = 0;
    for (const u of w.units) { if (u.kind === 'capital' || u.kind === 'turret') continue; total++; if (w.t - u.lastFire < 1.5) firing++; }
    return E.clamp01((firing / Math.max(1, total)) * 1.6 + Math.min(0.3, w.projectiles.length / 200));
  }

  // ── main step ────────────────────────────────────────────────
  function update(w, dt) {
    w.t += dt; w.tickN++;
    if (w.winner) { S.updateProjectiles(w, dt); w.intensity *= 0.98; return; }
    const U = w.units;
    for (let i = 0; i < U.length; i++) if (U[i].alive) control(w, U[i], dt);
    S.updateProjectiles(w, dt);
    S.updateStrikes(w, dt);
    S.sustain(w, dt);
    if (w.tickN % 3 === 0) S.updateCPs(w, dt * 3);
    if (w.tickN % 6 === 0) { S.reinforce(w, dt * 6); S.bleedAndWin(w, dt * 6); }
    for (let i = 0; i < S.systems.length; i++) S.systems[i](w, dt);
    w.intensity += (intensity(w) - w.intensity) * 0.05;
    // drop the dead
    let k = 0;
    for (let i = 0; i < U.length; i++) { const u = U[i]; if (u.alive) U[k++] = u; else w.umap.delete(u.id); }
    U.length = k;
  }

  // ── commander helpers (selection) ────────────────────────────
  function myUnits(w, f, kind) { return w.units.filter(u => u.alive && u.team === f && u.kind !== 'capital' && u.kind !== 'turret' && (!kind || u.kind === kind)); }
  function selectNearest(w, pos, maxD, f) {
    let best = null, bd = maxD * maxD;
    for (const u of myUnits(w, f)) { const d = E.distXZ2(pos, u.pos); if (d < bd) { bd = d; best = u; } }
    return best;
  }

  Object.assign(S, { setup, control, release, possess, deploy, order, intensity, update, myUnits, selectNearest, RESPAWN });
})(window.E = window.E || {});
