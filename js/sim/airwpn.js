// AIR weapons: lock-on with warnings, countermeasures, converging guns with
// lead, ballistic bomb release, torpedoes and subsystem aiming, and the
// per-tick world system that raises missile/lock warnings.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  const tmpA = V.make(), tmpB = V.make(), tmpC = V.make(), tmpN = V.make(), tmpD = V.make();
  const clamp = E.clamp;
  const BS = { t: 0, along: 0, lat: 0, miss: 0, ix: 0, iz: 0 };   // bomb solution scratch

  const aimOf = (u, o) => u.kind === 'fighter' ? S.noseDir(u, o) : S.dirOf(u.aimYaw, u.aimPitch, o);

  // ── lock-on ──────────────────────────────────────────────────
  // Call every tick while trying to hold `target`; returns true while locked.
  // Works for anything with a facing (aircraft, turrets, infantry): the AA built
  // by the land code calls this too. Progress is u.lockT (0..1) on u.lockId.
  // Per-unit optional def fields: lockCone (rad), lockTime (s), lockRange (m).
  function lockOn(w, u, tg, dt) {
    const K = E.AIR, d = u.def;
    if (u.lockId === undefined) { u.lockId = 0; u.lockT = 0; u.locked = false; u.lockOut = 0; }
    if (!tg || !tg.alive || tg.team === u.team) { dropLock(w, u); return false; }
    if (u.lockId !== tg.id) { dropLock(w, u); u.lockId = tg.id; }
    const W = E.WEAPONS[d.alt] || {};
    const cone = d.lockCone || K.lockCone, range = d.lockRange || W.range || 900;
    let time = d.lockTime || K.lockTime;
    if (tg.kind === 'capital') time *= 0.5;
    S.eyeOf(u, tmpA); S.centerOf(tg, tmpB);
    const dx = tmpB.x - tmpA.x, dy = tmpB.y - tmpA.y, dz = tmpB.z - tmpA.z, L = Math.hypot(dx, dy, dz) || 1;
    aimOf(u, tmpC);
    const ang = Math.acos(clamp((dx * tmpC.x + dy * tmpC.y + dz * tmpC.z) / L, -1, 1)) - Math.atan2(tg.r || 1, L);
    let ok = L <= range && L > 15 && ang < cone && !S.cloudBlocks(tmpA, tmpB);
    if (ok && (tg.jamT > w.t)) ok = false;
    if (ok && (u.kind !== 'fighter' || tg.kind !== 'fighter') && (w.tickN + u.id) % 4 === 0) u.lockLos = S.los(w, tmpA, tmpB);
    if (ok && u.lockLos === false && (u.kind !== 'fighter' || tg.kind !== 'fighter')) ok = false;
    const was = u.locked;
    if (tg.jamT > w.t) { u.lockT = 0; u.lockOut = 0; }
    else if (ok) {
      u.lockOut = 0;
      u.lockT = Math.min(1, u.lockT + dt / time * (tg.evT > 0 ? 0.4 : 1));
    } else {
      u.lockOut += dt;
      if (u.lockOut > K.lockGrace) u.lockT = Math.max(0, u.lockT - dt * K.lockDecay / time);
    }
    u.locked = u.lockT >= 1;
    if (u.lockT > 0.12 && tg.kind === 'fighter') {   // the victim feels it
      if (u.locked) tg.lockedT = w.t + 0.4;
      tg.warnT = w.t + 0.4; tg.warnBy = u.id;
    }
    if (u.locked !== was) w.events.push({ type: u.locked ? 'lockAcquired' : 'lockLost', uid: u.id, tid: tg.id, to: u.pid, team: u.team });
    return u.locked;
  }
  function dropLock(w, u) {
    if (u.locked) w.events.push({ type: 'lockLost', uid: u.id, tid: u.lockId, to: u.pid, team: u.team });
    u.lockId = 0; u.lockT = 0; u.locked = false; u.lockOut = 0;
  }

  // the pilot's target selection: hold the current lock, or take what is in the cone
  function updateLock(w, u, dt, cycle) {
    const d = u.def, K = E.AIR;
    const pred = d.alt === 'ptorp' ? (e => e.kind === 'capital' || e.kind === 'vehicle') : (e => e.kind !== 'infantry' && e.kind !== 'turret');
    let tg = u.lockId ? w.umap.get(u.lockId) : null;
    if (tg && (!tg.alive || tg.team === u.team)) tg = null;
    if (cycle || !tg) {
      const W = E.WEAPONS[d.alt], cur = tg ? tg.id : 0;
      const nt = S.aimTarget(w, u, u.pos, S.noseDir(u, tmpD), d.lockCone || K.lockCone, W.range, e => e.id !== cur && pred(e) && !S.cloudBlocks(u.pos, e.pos));
      if (nt) tg = nt;
    }
    if (tg) lockOn(w, u, tg, dt);
    else { if (u.locked) dropLock(w, u); u.lockT = Math.max(0, u.lockT - dt * 2); u.lockId = 0; }
  }

  // ── countermeasures ──────────────────────────────────────────
  function airCM(w, u) {
    const K = E.AIR;
    if (!(u.cm > 0) || u.cmCd > 0) return false;
    u.cm--; u.cmCd = K.cmCooldown; u.jamT = w.t + K.cmJam;
    w.events.push({ type: 'flare', uid: u.id, pos: V.clone(u.pos), vel: V.clone(u.vel), team: u.team, to: u.pid, left: u.cm });
    return true;
  }

  // ── guns: converge on the aim point, lead moving targets ──────
  // dir: where the pilot is aiming (unit). Returns true if a round went out.
  function airFirePrimary(w, u, dir, assist) {
    const d = u.def, W = E.WEAPONS[d.weapon];
    if (u.fireT > 0 || u.hot) return false;
    const nose = S.noseDir(u, tmpN);
    let ax = dir.x, ay = dir.y, az = dir.z;
    // traverse limit (gunship turret) or a small gimbal for fixed wing guns
    const arc = d.arc || 0.1, c = ax * nose.x + ay * nose.y + az * nose.z;
    if (c < Math.cos(arc)) {
      let px = ax - nose.x * c, py = ay - nose.y * c, pz = az - nose.z * c; const pl = Math.hypot(px, py, pz) || 1;
      const s = Math.sin(arc), k = Math.cos(arc);
      ax = nose.x * k + px / pl * s; ay = nose.y * k + py / pl * s; az = nose.z * k + pz / pl * s;
    }
    tmpA.x = ax; tmpA.y = ay; tmpA.z = az;
    // converge on whatever is under the reticle (and lead it for human pilots)
    const tgt = S.aimTarget(w, u, u.pos, tmpA, assist ? 0.05 : 0.02, W.range, null);
    let R = d.conv || 380;
    if (tgt) {
      R = clamp(V.distance(u.pos, tgt.pos), 60, W.range);
      if (assist) { S.leadPoint(u, tgt, W, tmpB); tmpA.x = tmpB.x - u.pos.x; tmpA.y = tmpB.y - u.pos.y; tmpA.z = tmpB.z - u.pos.z; V.normalize(tmpA); R = V.distance(u.pos, tmpB); }
    }
    const s = u.gunSide * u.r * 0.55;
    const mx = u.pos.x + tmpA.x * u.r - Math.cos(u.yaw) * s, my = u.pos.y + tmpA.y * u.r - 0.3, mz = u.pos.z + tmpA.z * u.r + Math.sin(u.yaw) * s;
    tmpB.x = u.pos.x + tmpA.x * R - mx; tmpB.y = u.pos.y + tmpA.y * R - my; tmpB.z = u.pos.z + tmpA.z * R - mz;
    V.normalize(tmpB);
    return S.firePrimary(w, u, tmpB, tgt ? tgt.id : 0);
  }

  // ── ordnance ─────────────────────────────────────────────────
  const GUIDED = { missile: 1, ptorp: 1 };
  function airAlt(w, u, dir, tid) {
    const d = u.def, wk = d.alt;
    if (!wk || u.altT > 0 || !(u.ord > 0)) return false;
    if (GUIDED[wk] && !tid) return false;
    const tg = tid ? w.umap.get(tid) : null;
    const ok = S.fireAlt(w, u, dir, tid || 0);
    if (!ok) return false;
    u.ord--; u.ordT = 0;
    const p = w.projectiles[w.projectiles.length - 1];
    if (wk === 'bomb') w.events.push({ type: 'bombAway', uid: u.id, pos: V.clone(u.pos), vel: V.clone(u.vel), team: u.team, to: u.pid, ord: u.ord });
    if (GUIDED[wk] && tg && tg.kind === 'fighter') { tg.warnT = w.t + 0.4; tg.warnBy = u.id; tg.mslBy = u.id; tg.mslT = w.t + 0.4; }
    if (wk === 'ptorp' && p && p.uid === u.id && tg && tg.kind === 'capital' && S.sysPos && tg.sys) {
      const name = pickSys(tg, tmpD);
      if (name) { p.sysCap = tg.id; p.sysName = name; p.tid = 0; }
    }
    return true;
  }
  const SYS_PRI = ['shield', 'shields', 'generator', 'reactor', 'bridge', 'engine', 'engines', 'hangar'];
  function sysAlive(s) { return s && !(s.alive === false || s.dead || s.hp <= 0 || s === 0); }
  // a live subsystem on a capital, if the SPACE code gives it any (defensive)
  function pickSys(cap, out) {
    if (!S.sysPos || !cap.sys) return null;
    for (const n of SYS_PRI) if (sysAlive(cap.sys[n]) && S.sysPos(cap, n, out)) return n;
    for (const n of Object.keys(cap.sys)) if (sysAlive(cap.sys[n]) && S.sysPos(cap, n, out)) return n;
    return null;
  }

  // ── bombs: ballistic release solution ────────────────────────
  // Where would a bomb dropped now land, relative to a (moving) target point?
  // BS.along: + long / - short (m, along the track); BS.lat: sideways; BS.t: fall time.
  function bombSolution(w, u, tx, ty, tz, tvx, tvz) {
    const g = E.WEAPONS.bomb.grav, nose = S.noseDir(u, tmpN);
    const ox = u.pos.x + nose.x * u.r, oy = u.pos.y + nose.y * u.r, oz = u.pos.z + nose.z * u.r;
    const vy0 = u.vel.y - 4, h = oy - ty;
    if (h <= 1) return null;
    const t = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * h)) / g;
    BS.t = t; BS.ix = ox + u.vel.x * t; BS.iz = oz + u.vel.z * t;
    const ex = BS.ix - (tx + tvx * t), ez = BS.iz - (tz + tvz * t), vh = Math.hypot(u.vel.x, u.vel.z) || 1;
    BS.along = (ex * u.vel.x + ez * u.vel.z) / vh; BS.lat = (-ex * u.vel.z + ez * u.vel.x) / vh; BS.miss = Math.hypot(ex, ez);
    return BS;
  }
  // predicted impact point of a bomb dropped now (for a bomb sight): {x, z}, null if it would not fall
  function bombImpact(w, u, o) {
    const g = E.WEAPONS.bomb.grav, nose = S.noseDir(u, tmpN), gy = w.terrain.height(u.pos.x, u.pos.z);
    let ix = u.pos.x, iz = u.pos.z, gh = gy;
    for (let i = 0; i < 3; i++) {
      const h = u.pos.y + nose.y * u.r - gh; if (h <= 1) return null;
      const vy0 = u.vel.y - 4, t = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * h)) / g;
      ix = u.pos.x + nose.x * u.r + u.vel.x * t; iz = u.pos.z + nose.z * u.r + u.vel.z * t;
      gh = Math.max(w.terrain.height(ix, iz), w.terrain.waterLevel);
    }
    o = o || {}; o.x = ix; o.z = iz; o.y = gh; return o;
  }
  // drop a bomb if the solution says it lands on the target now. Returns true if released.
  function bombRelease(w, u, tx, ty, tz, tvx, tvz, tol) {
    if (!(u.ord > 0) || u.altT > 0 || u.def.alt !== 'bomb') return false;
    const s = bombSolution(w, u, tx, ty, tz, tvx || 0, tvz || 0); if (!s) return false;
    const vh = Math.hypot(u.vel.x, u.vel.z), step = vh * (1 / 30);
    if (s.along < -step * 0.5 || s.along > step * 1.5 || Math.abs(s.lat) > (tol || 14)) return false;
    return airAlt(w, u, S.noseDir(u, tmpN), 0);
  }

  // ── pilot weapons (human) ────────────────────────────────────
  function airPilotWeapons(w, u, inp, dt) {
    const d = u.def, nose = S.noseDir(u, tmpN), guided = GUIDED[d.alt];
    if (guided) updateLock(w, u, dt, !!inp.cycle && !u.prevCycle);
    u.prevCycle = !!inp.cycle;
    S.dirOf(inp.yaw, inp.pitch, tmpD);
    let aim = tmpD; const arc = d.arc || 0.12;
    if (nose.x * aim.x + nose.y * aim.y + nose.z * aim.z < Math.cos(arc)) aim = nose;
    if (inp.fire) airFirePrimary(w, u, aim, true);
    if (inp.abil) {
      if (guided) {
        if (u.locked) airAlt(w, u, nose, u.lockId);
        else if (u.altT <= 0 && (u.noLockT || 0) < w.t) { u.noLockT = w.t + 0.8; w.events.push({ type: 'noLock', uid: u.id, to: u.pid }); }
      } else if (d.alt === 'pod') {
        let a2 = aim; if (nose.x * a2.x + nose.y * a2.y + nose.z * a2.z < Math.cos(0.3)) a2 = nose;
        airAlt(w, u, a2, 0);
      } else airAlt(w, u, nose, 0);
    }
  }

  // ── the world system: warnings and steered torpedoes ─────────
  function airSystem(w, dt) {
    const P = w.projectiles;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (p.seek && p.tid) {
        const t = w.umap.get(p.tid);
        if (t && t.alive && t.kind === 'fighter') {
          const dd = V.distance(p.pos, t.pos);
          if (t.mslTick !== w.tickN) { t.mslTick = w.tickN; t.mslD = dd; } else if (dd < t.mslD) t.mslD = dd;
          t.mslT = w.t + 0.25;
        }
      } else if (p.sysCap) {   // a torpedo flying at a particular subsystem
        const cap = w.umap.get(p.sysCap);
        if (!cap || !cap.alive || !S.sysPos || !S.sysPos(cap, p.sysName, tmpA)) { p.sysCap = 0; continue; }
        const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z) || 1;
        let wx = tmpA.x - p.pos.x, wy = tmpA.y - p.pos.y, wz = tmpA.z - p.pos.z; const l = Math.hypot(wx, wy, wz) || 1, k = Math.min(1, p.seek * dt);
        let nx = p.vel.x / sp + (wx / l - p.vel.x / sp) * k, ny = p.vel.y / sp + (wy / l - p.vel.y / sp) * k, nz = p.vel.z / sp + (wz / l - p.vel.z / sp) * k;
        const nl = Math.hypot(nx, ny, nz) || 1; p.vel.x = nx / nl * sp; p.vel.y = ny / nl * sp; p.vel.z = nz / nl * sp;
      }
    }
    const U = w.units;
    for (let i = 0; i < U.length; i++) {
      const u = U[i];
      if (u.kind !== 'fighter' || !u.alive || u.warn === undefined) continue;
      const lvl = u.mslT > w.t ? 3 : u.lockedT > w.t ? 2 : u.warnT > w.t ? 1 : 0;
      if (lvl > u.warn) w.events.push({ type: 'warn', uid: u.id, to: u.pid, level: lvl, by: lvl === 3 ? (u.mslBy || u.warnBy || 0) : (u.warnBy || 0) });
      u.warn = lvl;
    }
  }
  S.systems = S.systems || []; S.systems.push(airSystem);

  Object.assign(S, { lockOn, dropLock, updateLock, airCM, airFirePrimary, airAlt, airPilotWeapons, bombSolution, bombImpact, bombRelease, pickSys });
})(window.E = window.E || {});
