// AIR AI: doctrine per role. Every craft runs the same loop: perceive -> react
// to threats -> role doctrine fills a control sheet -> safety layer (terrain,
// ceiling, stall, hulls, bounds) edits it -> flight model. Interceptors fly
// combat air patrol and hunt strike craft; bombers and strike craft plan
// ingress / run / egress passes; gunships orbit the ground push and ferry troops.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  const clamp = E.clamp, clamp01 = E.clamp01;
  const C = { dx: 0, dy: 0, dz: 1, thr: 0.65, boost: false, roll: 0, drift: false, brake: false, full: false, vy: NaN, mvx: NaN, mvz: 0, evade: 0 };
  const P = { x: 0, y: 0, z: 0, vx: 0, vz: 0 };      // target / aim point scratch
  const tmpA = V.make(), tmpB = V.make(), tmpN = V.make(), tmpL = V.make();

  const PREF = {
    interceptor: { fighter: { interceptor: 1.5, strike: 2.4, bomber: 2.8, gunship: 2.5 }, vehicle: 0.4, turret: 0.12, infantry: 0.12 },
    gunship:     { vehicle: 1.4, infantry: 1.0, turret: 0.5 },
    bomber:      { capital: 0.7, vehicle: 1.6, turret: 1.2, infantry: 0.25 },
    strike:      { capital: 3.0, vehicle: 1.2, turret: 0.5 },
  };
  const SENSE = { interceptor: 1700, gunship: 800, bomber: 1000, strike: 1200 };
  const gAt = (w, x, z) => Math.max(w.terrain.height(x, z), w.terrain.waterLevel);
  const air = (u) => u.air;
  function setMode(a, m, t) { a.mode = m; a.modeT = t || 0; }
  function look(u, x, y, z) {
    const dx = x - u.pos.x, dy = y - u.pos.y, dz = z - u.pos.z, l = Math.hypot(dx, dy, dz);
    if (l < 1e-3) { S.noseDir(u, tmpN); C.dx = tmpN.x; C.dy = tmpN.y; C.dz = tmpN.z; return 0; }
    C.dx = dx / l; C.dy = dy / l; C.dz = dz / l; return l;
  }
  function lookDir(x, y, z) { const l = Math.hypot(x, y, z) || 1; C.dx = x / l; C.dy = y / l; C.dz = z / l; }
  const home = (w, u) => w.cps.find(c => c.home === u.team) || w.cps[0];
  const ownCap = (w, u) => { for (const c of w.units) if (c.kind === 'capital' && c.alive && c.team === u.team) return c; return null; };

  // ── perception ───────────────────────────────────────────────
  function perceive(w, u, a) {
    const role = u.def.role, pref = PREF[role] || PREF.interceptor, sense = SENSE[role] || 1200, R = w.rng;
    const picks = role === 'interceptor' || role === 'gunship';      // bombers / strike craft plan their own targets
    let best = null, bs = 0, thr = null, td = 1e9;
    for (const e of w.units) {
      if (!e.alive || e.team === u.team) continue;
      const dx = e.pos.x - u.pos.x, dy = e.pos.y - u.pos.y, dz = e.pos.z - u.pos.z, d = Math.hypot(dx, dy, dz);
      if (e.kind === 'fighter' && e.fl && d < 700 && d < td && !e.inCloud) {   // is somebody pointing at me?
        if ((e.fl.fx * -dx + e.fl.fy * -dy + e.fl.fz * -dz) / (d || 1) > 0.86) { thr = e; td = d; }
      }
      if (!picks) continue;
      let pf = e.kind === 'fighter' ? (pref.fighter && pref.fighter[e.type]) : pref[e.kind];
      if (e.kind === 'vehicle' && e.type === 'tank' && pref.vehicle) pf = pref.vehicle * 1.2;
      if (!pf || (d > sense && e.kind !== 'capital')) continue;
      if (e.inCloud || u.inCloud && d > 220) continue;              // lost in the cloud
      if (S.cloudBlocks(u.pos, e.pos)) continue;
      if (a.cas && e.kind !== 'capital') { const cx = e.pos.x - a.cas.x, cz = e.pos.z - a.cas.z; if (cx * cx + cz * cz > 450 * 450) continue; }
      let s = pf * 1000 / (d + 80);
      if (e.id === a.tid) s *= 1.35;
      if (s > bs) { bs = s; best = e; }
    }
    if (!picks) { /* planned target stays */ }
    else if (best) { a.tid = best.id; a.lx = best.pos.x; a.ly = best.pos.y; a.lz = best.pos.z; a.lostT = w.t; }
    else if (a.tid) { a.tid = 0; }
    a.threat = thr ? thr.id : 0; a.threatD = td;
    const k = w.cfg.aiErr * 0.55;
    a.eY = R.gauss() * k; a.eP = R.gauss() * k * 0.6;
  }
  const tgt = (w, a) => { const t = a.tid ? w.umap.get(a.tid) : null; return t && t.alive ? t : null; };

  // ── shared helpers ───────────────────────────────────────────
  // the friendly front: where the ground fight is
  function frontPoint(w, u, a, o) {
    if (w.t < (a.frontT || 0)) { o.x = a.fx; o.z = a.fz; return o; }
    a.frontT = w.t + 8; const en = S.enemyOf(u.team);
    let best = w.cps[2] || w.cps[0], bs = -1;
    for (const c of w.cps) {
      const s = (c.n[en] * 2 + c.n[u.team] * 0.5 + (c.owner !== u.team ? 2 : 0.5) + (c.contested ? 3 : 0)) * (0.8 + ((c.id * 7 + u.id) % 5) * 0.1);
      if (s > bs) { bs = s; best = c; }
    }
    a.fx = best.pos.x; a.fz = best.pos.z; o.x = a.fx; o.z = a.fz; return o;
  }
  // patrol orbit over (x, z) at `agl` above the ground
  function patrolPoint(w, u, a, x, z, rad, agl) {
    const th = w.t * 0.14 * a.side + u.id * 1.7, px = x + Math.cos(th) * rad, pz = z + Math.sin(th) * rad;
    const y = Math.min(gAt(w, px, pz) + agl, S.ALT.cloudLo - 60);
    return look(u, px, y, pz);
  }
  function startJink(w, u, a, t) {
    if (a.mode === 'jink') return;
    a.prev = a.mode; setMode(a, 'jink', t); a.side = w.rng.sign();
    S.noseDir(u, tmpN); const h = Math.hypot(tmpN.x, tmpN.z) || 1; a.jx = tmpN.x / h; a.jz = tmpN.z / h;
  }

  function reflexes(w, u, a, dt) {
    const R = w.rng;
    if (u.mslT > w.t && u.mslD < 700) {
      if (a.reactT < 0) a.reactT = w.t + 0.3 + R.next() * 0.45;
      if (w.t >= a.reactT) {
        if (u.mslD < 520) S.airCM(w, u);
        if (u.mslD < 330 && u.evCd <= 0 && (u.agl > 220 || u.dens < 0.3)) S.startEvade(w, u, R.sign());
        startJink(w, u, a, 1.5);
      }
    } else a.reactT = -1;
    if (u.warn === 2 && a.mode !== 'jink' && a.mode !== 'run' && u.def.role !== 'gunship' && R.next() < dt * 0.5) startJink(w, u, a, 1.2);
  }

  // ── the safety layer ─────────────────────────────────────────
  function safety(w, u, a, dt, runMode) {
    const d = u.def, T = w.terrain, vx = u.vel.x, vz = u.vel.z, spd = u.spd;
    const hover = d.vtol && spd < 28;
    const clear = hover ? 22 : runMode ? 38 : 58;
    // terrain: look ahead along the actual velocity
    let worst = 0;
    const H0 = runMode ? 0.5 : 0.9, H1 = runMode ? 1.0 : 1.8, H2 = runMode ? 1.6 : 3.0;
    for (let i = 0; i < 3; i++) {
      const t = i === 0 ? H0 : i === 1 ? H1 : H2;
      const m = u.pos.y + u.vel.y * t - gAt(w, u.pos.x + vx * t, u.pos.z + vz * t) - clear;
      if (m < 0) worst = Math.max(worst, clamp01(-m / (clear * 0.8)) * (1 - i * 0.12));
    }
    if (u.agl < clear * 0.5) worst = Math.max(worst, 1 - u.agl / (clear * 0.5));
    // pull-out budget: how steep may we dive and still recover above `clear`?
    if (!hover && u.dens > 0.25 && u.agl < 900) {
      const vc = d.corner * u.spM, om = Math.max(0.3, d.turn * Math.sqrt(u.dens) * clamp(Math.min(spd / vc, vc / Math.max(spd, 1)), 0.35, 1) * (1 - 0.65 * u.stall));
      const room = u.agl - clear;
      let lo = 0, hi = 1.4;
      for (let i = 0; i < 6; i++) { const m = (lo + hi) * 0.5; (spd / om * (1 - Math.cos(m)) + 0.4 * spd * Math.sin(m) <= room) ? lo = m : hi = m; }
      const sinMax = Math.sin(lo);
      if (C.dy < -sinMax) { const hh = Math.hypot(C.dx, C.dz) || 1, k = Math.sqrt(1 - sinMax * sinMax) / hh; C.dx *= k; C.dz *= k; C.dy = -sinMax; }
      if (spd > 1 && u.vel.y < 0) { const gc = Math.asin(clamp(-u.vel.y / spd, 0, 1)); if (gc > lo) worst = Math.max(worst, clamp01((gc - lo) / 0.25)); }
    }
    if (worst > 0 && !(hover && u.agl > 8)) {
      let hx = vx, hz = vz; const hl = Math.hypot(hx, hz);
      if (hl < 3) { S.noseDir(u, tmpN); hx = tmpN.x; hz = tmpN.z; }
      const l = Math.hypot(hx, hz) || 1;
      C.dx = C.dx * (1 - worst) + hx / l * 0.5 * worst; C.dy = C.dy * (1 - worst) + 0.87 * worst; C.dz = C.dz * (1 - worst) + hz / l * 0.5 * worst;
      lookDir(C.dx, C.dy, C.dz);
      if (worst > 0.3) { C.thr = 1; if (worst > 0.55 && spd < d.speed * 1.1) C.boost = true; }
      if (hover) { C.vy = 6; }
    }
    // ceiling
    if (u.pos.y > S.ALT.ceiling - 250 && C.dy > -0.1) lookDir(C.dx, -0.1, C.dz);
    // energy: don't stall in real air
    if (!d.vtol && u.dens > 0.3) {
      const vs = d.stall / Math.sqrt(Math.max(u.dens, 0.35)), k = clamp01((vs * 1.4 - spd) / (vs * 0.4));
      if (k > 0) { lookDir(C.dx, Math.min(C.dy, 0.2) - 0.55 * k, C.dz); C.thr = 1; if (k > 0.5) C.boost = true; }
    }
    // capital hulls
    for (let i = 0; i < w.units.length; i++) {
      const c = w.units[i];
      if (c.kind !== 'capital' || !c.alive) continue;
      if (a.mode === 'rtb' && a.cap === c.id && u.pos.y > c.pos.y + c.h * 1.8) continue;
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), hl = c.def.len * 0.5 - c.h, rc = c.h * 1.25 + u.r + 60 + spd * 1.3;
      const rx = u.pos.x - c.pos.x, ry = u.pos.y - c.pos.y, rz = u.pos.z - c.pos.z;
      if (Math.abs(ry) > rc * 1.6) continue;
      const q = clamp(rx * fx + rz * fz, -hl, hl), qx = rx - fx * q, qz = rz - fz * q;
      const dd = Math.sqrt(qx * qx + ry * ry * 1.6 + qz * qz);
      if (dd >= rc) continue;
      const k = clamp01(1 - dd / rc) * 2.6 + 0.15, nl = dd || 1;
      const nx = qx / nl, ny = ry / nl + 0.15, nz = qz / nl;
      lookDir(C.dx * (1 - Math.min(1, k)) + nx * k, C.dy * (1 - Math.min(1, k)) + ny * k, C.dz * (1 - Math.min(1, k)) + nz * k);
      if (k > 0.5) C.thr = 1;
    }
    // arena bound
    const hd = Math.hypot(u.pos.x, u.pos.z), B = w.layout.bound * 0.93;
    if (hd > B) { const k = clamp01((hd - B) / (w.layout.bound * 0.2)); lookDir(C.dx * (1 - k) - u.pos.x / hd * k, C.dy, C.dz * (1 - k) - u.pos.z / hd * k); }
  }

  // ── weapons the bots use ─────────────────────────────────────
  function aimErr(a, dir) {
    if (!a.eY && !a.eP) return dir;
    const y = Math.atan2(dir.x, dir.z) + a.eY, p = Math.asin(clamp(dir.y, -1, 1)) + a.eP;
    return S.dirOf(y, p, tmpL);
  }
  function aiGuns(w, u, a, tg) {
    const d = u.def, W = E.WEAPONS[d.weapon];
    S.leadPoint(u, tg, W, tmpA);
    const rx = tmpA.x - u.pos.x, ry = tmpA.y - u.pos.y, rz = tmpA.z - u.pos.z, L = Math.hypot(rx, ry, rz) || 1;
    if (L > W.range * 0.92) return false;
    S.noseDir(u, tmpN);
    const ang = Math.acos(clamp((rx * tmpN.x + ry * tmpN.y + rz * tmpN.z) / L, -1, 1));
    if (ang > (d.arc ? d.arc : 0.05)) return false;
    tmpB.x = rx / L; tmpB.y = ry / L; tmpB.z = rz / L;
    return S.airFirePrimary(w, u, aimErr(a, tmpB), false);
  }
  function aiGuided(w, u, a, tg, dt) {
    const wk = u.def.alt; if (wk !== 'missile' && wk !== 'ptorp') return;
    if (!(u.ord > 0)) return;
    const W = E.WEAPONS[wk], L = V.distance(u.pos, tg.pos);
    if (L > W.range * 1.05) { if (u.lockId === tg.id) S.dropLock(w, u); return; }
    if (tg.kind === 'infantry' || (wk === 'ptorp' && tg.kind !== 'capital' && tg.kind !== 'vehicle')) return;
    if (S.lockOn(w, u, tg, dt) && u.altT <= 0 && L > (wk === 'missile' ? 140 : 250)) {
      S.airAlt(w, u, S.noseDir(u, tmpN), tg.id);
      if (a.task) a.task.fired = true;
    }
  }

  // ── interceptor ──────────────────────────────────────────────
  function doInterceptor(w, u, a, dt) {
    const d = u.def, W = E.WEAPONS[d.weapon], tg = tgt(w, a), vc = d.corner * u.spM, vmax = d.speed * 1.2 * u.spM;
    a.runMode = false;
    if (a.mode === 'jink') return jink(w, u, a, dt);
    if (!tg) {
      // lost it in the cloud? head for where it was, then back on patrol
      if (a.lostT !== undefined && w.t - a.lostT < 3 && a.lx !== undefined) { look(u, a.lx, a.ly, a.lz); C.thr = 0.9; return; }
      frontPoint(w, u, a, tmpA);
      patrolPoint(w, u, a, tmpA.x, tmpA.z, 430, 360);
      C.thr = 0.75; if (u.pos.y > S.ALT.cloudHi + 80 || Math.hypot(u.pos.x - tmpA.x, u.pos.z - tmpA.z) > 1800) C.boost = true;
      if (a.mode === 'egress') a.mode = '';
      return;
    }
    const rx = tg.pos.x - u.pos.x, ry = tg.pos.y - u.pos.y, rz = tg.pos.z - u.pos.z, L = Math.hypot(rx, ry, rz) || 1;
    S.noseDir(u, tmpN);
    const cosA = (rx * tmpN.x + ry * tmpN.y + rz * tmpN.z) / L, ang = Math.acos(clamp(cosA, -1, 1));
    if (tg.kind === 'fighter') {
      const tf = tg.fl || { fx: 0, fy: 0, fz: 1 };
      const aspect = (tf.fx * -rx + tf.fy * -ry + tf.fz * -rz) / L;          // 1: it points at me
      const closure = -((tg.vel.x - u.vel.x) * rx + (tg.vel.y - u.vel.y) * ry + (tg.vel.z - u.vel.z) * rz) / L;
      a.engT = (a.engT || 0) + dt;
      if (a.mode === 'yoyo') {
        a.modeT -= dt; if (a.modeT <= 0) setMode(a, '', 0);
        // high yo-yo: trade speed for height, roll over the top and come back down on the target
        lookDir(tmpN.x * 0.5 + a.sx * 0.35, 0.75, tmpN.z * 0.5 + a.sz * 0.35); C.thr = 1; C.full = true; return;
      }
      if (a.mode === 'extend') {
        a.modeT -= dt; if (a.modeT <= 0 || u.spd > vc * 1.15 && a.modeT < 1.5) { setMode(a, '', 0); a.engT = 0; }
        const hl = Math.hypot(rx, rz) || 1; lookDir(-rx / hl, -0.3, -rz / hl); C.thr = 1; C.boost = u.boostE > 0.5 && L < 400; return;
      }
      if (aspect > 0.78 && L < 600 && cosA < -0.1) {            // it is behind me and tracking: break
        startJink(w, u, a, 1.4 + w.rng.next() * 0.8); if (L < 320 && u.evCd <= 0 && (u.agl > 220 || u.dens < 0.3)) S.startEvade(w, u, a.side);
        return jink(w, u, a, dt);
      }
      if (L < 110 && closure > 25 && ang < 1.3) {              // about to overshoot: yo-yo
        S.noseDir(u, tmpN); a.sx = -rz / (Math.hypot(rx, rz) || 1) * a.side; a.sz = rx / (Math.hypot(rx, rz) || 1) * a.side;
        setMode(a, 'yoyo', 1.5); return;
      }
      if ((u.spd < vc * 0.82 && u.dens > 0.3 && L > 160) || a.engT > 13) { setMode(a, 'extend', 2.6 + w.rng.next()); a.engT = 0; return; }
      // pursuit: lead when closing from behind, lag when overshooting
      S.leadPoint(u, tg, W, tmpA);
      if (L < 230 && closure > 12) { tmpA.x -= tg.vel.x * 0.35; tmpA.y -= tg.vel.y * 0.35; tmpA.z -= tg.vel.z * 0.35; }
      look(u, tmpA.x, tmpA.y, tmpA.z);
      const vt = Math.hypot(tg.vel.x, tg.vel.y, tg.vel.z);
      C.thr = ang > 0.9 ? 1 : clamp((vt * 1.05 / vmax) ** 2 + 0.12, 0.5, 1);
      C.boost = L > 650 || (ang > 1.2 && u.boostE > 0.6 && L < 500);
      if (ang < 0.05 && L < W.range) aiGuns(w, u, a, tg);
      aiGuided(w, u, a, tg, dt);
      return;
    }
    // ground run: dive on it, rake it, pull off
    a.runMode = true;
    if (a.mode === 'egress') {
      a.modeT -= dt; lookDir(a.jx, 0.45, a.jz); C.thr = 1; if (a.modeT <= 0) setMode(a, '', 0); return;
    }
    const aim = S.centerOf(tg, tmpA); look(u, aim.x, aim.y + 6, aim.z);
    C.thr = 0.9; C.boost = L > 900;
    if (ang < 0.07 && L < W.range) aiGuns(w, u, a, tg);
    aiGuided(w, u, a, tg, dt);
    if (L < 150 && tg.kind !== 'capital' || L < 420 && tg.kind === 'capital') {
      const hl = Math.hypot(u.vel.x, u.vel.z) || 1; a.jx = u.vel.x / hl; a.jz = u.vel.z / hl; setMode(a, 'egress', 2 + w.rng.next());
    }
  }

  // hard break: turn across the threat, dive for speed, flares on the way
  function jink(w, u, a, dt) {
    a.modeT -= dt; a.runMode = false;
    if (a.modeT <= 0) { setMode(a, a.prev && a.prev !== 'jink' ? a.prev : '', 1); return; }
    if (((a.modeT * 2.2) | 0) !== (((a.modeT + dt) * 2.2) | 0)) a.side = -a.side;
    if (u.def.vtol) {   // a gunship sidesteps on its lift jets, nose steady
      const gh = Math.hypot(u.pos.x, u.pos.z) || 1;
      C.thr = 0; C.mvx = a.jz * a.side * 17 + (u.vel.x * 0.2); C.mvz = -a.jx * a.side * 17 + (u.vel.z * 0.2);
      C.vy = u.agl < 60 ? 5 : 0; C.dy = Math.max(C.dy, -0.3); lookDir(C.dx, C.dy, C.dz); return;
    }
    const c = Math.cos(1.25 * a.side), s = Math.sin(1.25 * a.side);
    const hx = a.jx * c - a.jz * s, hz = a.jx * s + a.jz * c;
    lookDir(hx, u.pos.y > 150 + (u.pos.y - u.agl) ? -0.28 : 0.3, hz); C.thr = 1; C.boost = u.boostE > 0.35;
    a.jx = hx * 0.6 + a.jx * 0.4; a.jz = hz * 0.6 + a.jz * 0.4;
  }

  // ── bomber / strike craft ────────────────────────────────────
  // where the strike aims: a live subsystem, the hull top, or the ground under a unit
  function strikeAim(w, u, a, o) {
    const t = tgt(w, a);
    if (t) {
      o.vx = t.vel.x; o.vz = t.vel.z;
      if (t.kind === 'capital') {
        const nm = S.pickSys(t, tmpB);
        if (nm) { o.x = tmpB.x; o.y = tmpB.y; o.z = tmpB.z; } else { o.x = t.pos.x; o.y = t.pos.y + t.h * 0.9; o.z = t.pos.z; }
      } else { o.x = t.pos.x; o.y = t.pos.y; o.z = t.pos.z; }
      return t;
    }
    if (a.hasPt) { o.x = a.px; o.z = a.pz; o.y = gAt(w, a.px, a.pz) + 1; o.vx = 0; o.vz = 0; return {}; }
    return null;
  }
  function planStrike(w, u, a) {
    const pref = PREF[u.def.role], R = w.rng; let best = null, bs = 0;
    a.hasPt = false;
    if (a.cas) {   // a call-in: hit something near the marked point, or the point itself
      for (const e of w.units) {
        if (!e.alive || e.team === u.team || e.kind === 'fighter' || e.kind === 'capital') continue;
        const dx = e.pos.x - a.cas.x, dz = e.pos.z - a.cas.z, d2 = dx * dx + dz * dz;
        if (d2 > 130 * 130) continue;
        const s = (pref[e.kind] || 0.2) * (e.type === 'tank' ? 1.5 : 1) / (Math.sqrt(d2) + 40);
        if (s > bs) { bs = s; best = e; }
      }
      if (best) { a.tid = best.id; return; }
      a.tid = 0; a.px = a.cas.x; a.pz = a.cas.z; a.hasPt = true; return;
    }
    for (const e of w.units) {
      if (!e.alive || e.team === u.team) continue;
      let pf = pref[e.kind]; if (!pf) continue;
      if (e.kind === 'vehicle' && e.type === 'tank') pf *= 1.3;
      const d = V.distance(u.pos, e.pos);
      if (e.kind === 'infantry' && d > 2500) continue;
      let s = pf * 1000 / (d + 700) * (0.85 + R.next() * 0.3);
      if (e.id === a.lastTid) s *= 0.5;       // vary targets between passes
      if (s > bs) { bs = s; best = e; }
    }
    a.tid = best ? best.id : 0;
  }

  function doStrike(w, u, a, dt) {
    const d = u.def, torp = d.alt === 'ptorp';
    a.runMode = a.mode === 'run';
    if (a.mode === 'jink') return jink(w, u, a, dt);
    if (a.mode === 'reload' || (u.ord < 1 && a.mode !== 'egress')) {
      if (a.mode !== 'reload') setMode(a, 'reload', 0);
      if (u.ord >= Math.min(d.ord, 3)) { setMode(a, '', 0); }
      else {   // loiter behind friendly lines while the racks refill
        const h = home(w, u); patrolPoint(w, u, a, h.pos.x * 0.6, h.pos.z, 500, 420); C.thr = 0.7; return;
      }
    }
    if (a.mode === 'egress') {
      a.modeT -= dt; lookDir(a.jx, a.jy, a.jz); C.thr = 1; C.boost = u.hp < u.maxHp * 0.6 && u.boostE > 0.3;
      if (a.modeT <= 0) { setMode(a, '', 0); a.lastTid = a.tid; a.tid = 0; a.hasPt = false; }
      return;
    }
    if (a.cas && w.t > a.cas.until) { a.cas = null; a.task = null; a.tid = 0; a.hasPt = false; }
    let t = a.tid ? tgt(w, a) : null;
    if (!t && !a.hasPt) {
      if (w.t >= a.planT) { a.planT = w.t + 1.2; planStrike(w, u, a); t = tgt(w, a); }
    }
    if (!t && a.tid) { a.tid = 0; }
    const aim = strikeAim(w, u, a, P);
    if (!aim) {   // nothing to hit: hold over the friendly front
      frontPoint(w, u, a, tmpA);
      patrolPoint(w, u, a, tmpA.x * 0.5 + home(w, u).pos.x * 0.5, tmpA.z, 500, 420); C.thr = 0.75; return;
    }
    const cap = aim.kind === 'capital';
    const dxh = P.x - u.pos.x, dzh = P.z - u.pos.z, hd = Math.hypot(dxh, dzh), dist = Math.hypot(hd, P.y - u.pos.y);
    S.noseDir(u, tmpN);
    const hn = Math.hypot(tmpN.x, tmpN.z) || 1, align = (dxh * tmpN.x + dzh * tmpN.z) / (hn * (hd || 1));
    if (a.mode !== 'run') {
      // ingress: fly to the initial point on our own side of the target, then turn in
      const h = home(w, u), hx = (cap ? ownCapX(w, u, h) : h.pos.x) - P.x, hz = (cap ? ownCapZ(w, u, h) : h.pos.z) - P.z, hl = Math.hypot(hx, hz) || 1;
      const lead = torp ? 1900 : cap ? 1300 : 1100;
      const ipx = P.x + hx / hl * lead, ipz = P.z + hz / hl * lead;
      const ipy = cap ? P.y + (torp ? 10 : 100) : Math.max(P.y, gAt(w, ipx, ipz)) + (torp ? 260 : 300);
      const dip = Math.hypot(ipx - u.pos.x, ipz - u.pos.z);
      const above = !cap || torp || u.pos.y > P.y + 30;     // bombs fall: a capital run is flown from above
      if (above && (dip < 320 || (hd < lead + 200 && align > 0.9 && hd > 500))) { setMode(a, 'run', 18); }
      else {
        look(u, ipx, ipy, ipz); C.thr = 0.85; C.boost = dip > 1200 && u.boostE > 0.3 && u.pos.y < S.ALT.space;
        if (a.cas) a.task && (a.task.inbound || (a.task.inbound = true, w.events.push({ type: 'airInbound', uid: u.id, team: u.team, pos: { x: a.cas.x, z: a.cas.z }, to: a.cas.pid })));
        return;
      }
    }
    // run: straight at it, release on the ballistic solution / fire the torpedo
    a.runMode = true;
    a.modeT -= dt;
    const tt = dist / Math.max(60, u.spd);
    if (cap && !torp && u.pos.y < P.y - 5 && hd < 700) { setMode(a, '', 0); return; }
    look(u, P.x + P.vx * tt, P.y + (cap ? (torp ? 0 : 70) : 6), P.z + P.vz * tt);
    C.thr = 0.95;
    let done = false;
    if (torp) {
      const t2 = tgt(w, a);
      if (t2) aiGuided(w, u, a, t2, dt);
      if (u.ord < 1 || a.modeT <= 0) done = true;
      if (a.task && a.task.fired) done = true;
      if (hd < (cap ? 420 : 160)) done = true;
    } else {
      const g = P.y;
      let rel = false;
      if (cap && aim.def) {
        const s = S.bombSolution(w, u, P.x, P.y, P.z, P.vx, P.vz);
        if (s && Math.abs(s.along) < aim.def.len * 0.35 && Math.abs(s.lat) < aim.def.len * 0.12 + 20 && u.altT <= 0) rel = S.airAlt(w, u, S.noseDir(u, tmpN), 0);
      } else rel = S.bombRelease(w, u, P.x, g, P.z, P.vx, P.vz, 16);
      if (rel) { a.dropped = (a.dropped || 0) + 1; if (a.task) { if (!a.task.fired) w.events.push({ type: 'airWeaponsAway', uid: u.id, team: u.team, pos: { x: P.x, z: P.z }, to: a.task.pid }); a.task.fired = true; } }
      if (!cap && a.dropped && a.dropped >= 1) { const s = S.bombSolution(w, u, P.x, g, P.z, P.vx, P.vz); if (!s || s.along > 40 || u.ord < 1) done = true; }
      if (cap && (u.ord < 1 || (a.dropped >= 3))) done = true;
      if (a.modeT <= 0 || hd < 45 || (hd < 200 && align < 0.0)) done = true;
    }
    if (done) {
      const hl = Math.hypot(u.vel.x, u.vel.z) || 1; a.jx = u.vel.x / hl; a.jz = u.vel.z / hl; a.jy = cap ? 0.12 : 0.3;
      a.dropped = 0; setMode(a, 'egress', cap ? 5.5 : 4.5);
      if (a.cas && a.task && a.task.fired) { w.events.push({ type: 'airComplete', uid: u.id, team: u.team, to: a.cas.pid }); a.cas = null; a.task = null; a.hasPt = false; }
    }
  }
  const ownCapX = (w, u, h) => { const c = ownCap(w, u); return c ? c.pos.x : h.pos.x; };
  const ownCapZ = (w, u, h) => { const c = ownCap(w, u); return c ? c.pos.z : h.pos.z; };

  // ── gunship ──────────────────────────────────────────────────
  // fly to (x, z) at `agl`; slow into a hover over the last stretch
  function hoverTo(w, u, a, x, z, agl, vmax) {
    const dx = x - u.pos.x, dz = z - u.pos.z, hd = Math.hypot(dx, dz);
    const gy = gAt(w, u.pos.x, u.pos.z);
    C.vy = clamp((gAt(w, x, z) + agl - u.pos.y) * 0.45, -9, 9);
    const high = u.agl > 300;
    if (hd > 380 || u.spd > 34 && hd > 120 || high) {   // transit
      look(u, x, gAt(w, x, z) + agl, z);
      C.mvx = NaN; C.brake = false;
      if (high) { if (C.dy < -0.8) lookDir(C.dx, -0.8, C.dz); C.thr = 0.7; return hd; }
      C.thr = 0.78; C.brake = hd < 520 && u.spd > 40;
      if (u.pos.y > gy + agl + 150) C.dy = Math.min(C.dy, -0.25);
      else if (u.pos.y < gy + agl - 20 && C.dy < 0.15) lookDir(C.dx, 0.15, C.dz);
      if (hd < 450) { C.thr = u.spd > 24 ? 0 : 0.3; C.brake = u.spd > 24; }
      return hd;
    }
    const sp = Math.min(vmax || 16, hd * 0.22);
    C.mvx = hd > 1 ? dx / hd * sp : 0; C.mvz = hd > 1 ? dz / hd * sp : 0; C.thr = 0; C.brake = false;
    return hd;
  }
  function doGunship(w, u, a, dt) {
    const d = u.def, W = E.WEAPONS[d.weapon];
    a.runMode = false;
    const hp = u.hp / u.maxHp;
    if (a.mode === 'jink') return jink(w, u, a, dt);
    const task = a.task;
    // damaged: back to the carrier / airfield to mend
    if (hp < 0.35 && a.mode !== 'rtb' && !(task && task.type === 'drop' && u.carry > 0 && hp > 0.2)) { setMode(a, 'rtb', 0); }
    if (a.mode === 'rtb') return doRtb(w, u, a);
    if (task && task.type === 'drop') return doDrop(w, u, a, task, dt);
    if (a.cas && w.t > a.cas.until) { a.cas = null; a.task = null; }
    // support the ground push: orbit the best target (or the front) and shoot it
    const tg = tgt(w, a);
    let fx, fz;
    if (tg) { fx = tg.pos.x; fz = tg.pos.z; a.fx = fx; a.fz = fz; a.focusT = w.t; }
    else if (a.cas) { fx = a.cas.x; fz = a.cas.z; }
    else { frontPoint(w, u, a, tmpA); fx = tmpA.x; fz = tmpA.z; }
    const R = tg ? 230 : 260;
    const dx = u.pos.x - fx, dz = u.pos.z - fz, dd = Math.hypot(dx, dz) || 1;
    if (dd > R + 450) hoverTo(w, u, a, fx + dx / dd * R, fz + dz / dd * R, a.agl, 16);
    else {
      // orbit tangentially, nose on the target so both guns and pods bear
      const th = Math.atan2(dz, dx) + 0.5 * a.side, px = fx + Math.cos(th) * R, pz = fz + Math.sin(th) * R;
      hoverTo(w, u, a, px, pz, a.agl, 15);
      if (!isNaN(C.mvx)) { const tx = -dz / dd * a.side * -1, tz = dx / dd * a.side * -1; C.mvx = C.mvx * 0.55 + tx * 9; C.mvz = C.mvz * 0.55 + tz * 9; }
      if (u.agl > 300) { /* still coming down: keep the descent heading */ }
      else if (tg) {
        S.leadPoint(u, tg, W, tmpA); look(u, tmpA.x, tmpA.y, tmpA.z);
        if (C.dy < -0.45) lookDir(C.dx, -0.45, C.dz);
        const L = V.distance(u.pos, tg.pos);
        S.noseDir(u, tmpN);
        const ang = Math.acos(clamp(((tmpA.x - u.pos.x) * tmpN.x + (tmpA.y - u.pos.y) * tmpN.y + (tmpA.z - u.pos.z) * tmpN.z) / (Math.hypot(tmpA.x - u.pos.x, tmpA.y - u.pos.y, tmpA.z - u.pos.z) || 1), -1, 1));
        if (tg.kind !== 'fighter') {
          aiGuns(w, u, a, tg);
          if (ang < 0.25 && L < E.WEAPONS.pod.range * 0.9 && L > 90 && (tg.kind === 'vehicle' || tg.kind === 'turret') && u.altT <= 0 && u.ord > 0) {
            if (a.salvo === undefined || a.salvo <= 0) { if (w.t > (a.salvoT || 0)) { a.salvo = 4; a.salvoT = w.t + 3.5; } }
            if (a.salvo > 0 && S.airAlt(w, u, S.noseDir(u, tmpN), 0)) a.salvo--;
          }
          if (a.cas && !a.cas.fired && L < 600) { a.cas.fired = true; w.events.push({ type: 'airWeaponsAway', uid: u.id, team: u.team, pos: { x: a.cas.x, z: a.cas.z }, to: a.cas.pid }); }
        }
      } else {
        // hold station; the nose follows the orbit
        look(u, px, u.pos.y, pz);
      }
    }
    if (a.cas && !a.cas.inbound && dd < 700) { a.cas.inbound = true; w.events.push({ type: 'airInbound', uid: u.id, team: u.team, pos: { x: a.cas.x, z: a.cas.z }, to: a.cas.pid }); }
  }

  // landing-zone ferry: collect at the airfield, fly to the LZ, hover, unload
  function doDrop(w, u, a, task, dt) {
    const h = home(w, u);
    if (u.carry <= 0 && task.stage !== 'deliver') task.stage = 'pickup';
    if (task.stage === 'pickup') {
      const hd = hoverTo(w, u, a, h.pos.x, h.pos.z, 14, 14);
      if (hd < 40 && u.agl < 40 && u.spd < 14) {
        a.loadT = (a.loadT || 0) + dt;
        if (a.loadT > 2.5) { S.airLoad(w, u, task.n); a.loadT = 0; task.stage = 'deliver'; }
      } else a.loadT = 0;
      look(u, task.pos.x, u.pos.y, task.pos.z);
      return;
    }
    task.stage = 'deliver';
    task.t = (task.t || 0) + dt;
    const hd = hoverTo(w, u, a, task.pos.x, task.pos.z, hd2agl(w, u, task), 14);
    if (hd < 380) { a.dropAgl = 9; }
    S.noseDir(u, tmpN);
    if (!isNaN(C.mvx) && hd > 20) look(u, task.pos.x, u.pos.y, task.pos.z);
    if (hd < 32 && u.agl < 24 && u.spd < 13) {
      S.airUnload(w, u, task.pos);
      task.done = true; a.task = null; setMode(a, '', 0);
    } else if (task.t > 140) { a.task = null; setMode(a, '', 0); }     // could not get in: abort
  }
  const hd2agl = (w, u, task) => Math.hypot(task.pos.x - u.pos.x, task.pos.z - u.pos.z) < 380 ? 9 : 70;

  // ── damaged craft go home to mend ────────────────────────────
  function doRtb(w, u, a) {
    const cap = ownCap(w, u);
    a.runMode = false;
    if (u.hp > u.maxHp * 0.85) { setMode(a, '', 0); return; }
    if (cap) {
      a.cap = cap.id;
      look(u, cap.pos.x, cap.pos.y + cap.h * 2.6 + 70, cap.pos.z);
      C.thr = 0.9; C.boost = u.pos.y < S.ALT.space && cap.pos.y > S.ALT.space && u.boostE > 0.4;
      if (u.def.vtol) { const d = Math.hypot(cap.pos.x - u.pos.x, cap.pos.z - u.pos.z); if (d < 300) { C.thr = 0; C.brake = true; C.mvx = (cap.pos.x - u.pos.x) * 0.2; C.mvz = (cap.pos.z - u.pos.z) * 0.2; C.vy = clamp((cap.pos.y + cap.h * 2.6 + 70 - u.pos.y) * 0.4, -8, 8); } }
    } else {
      const h = home(w, u);
      if (u.def.vtol) hoverTo(w, u, a, h.pos.x, h.pos.z, 25, 14);
      else { patrolPoint(w, u, a, h.pos.x, h.pos.z, 160, 120); C.thr = 0.6; }
    }
  }

  // ── entry point ──────────────────────────────────────────────
  function aiFighter(w, u, dt) {
    if (!u.fl) S.initAir(u);
    const a = u.air, d = u.def;
    u.pilot = false;
    a.thinkT -= dt;
    if (a.thinkT <= 0) {
      a.thinkT = 0.32 + w.rng.next() * 0.2;
      if (!a.agl) { a.agl = 90 + w.rng.next() * 50; a.side = w.rng.sign(); a.planT = 0; }
      perceive(w, u, a);
    }
    if (a.cas && w.t > a.cas.until) { a.cas = null; if (a.task && a.task.type === 'cas') a.task = null; }
    // defaults
    C.thr = 0.65; C.boost = false; C.roll = 0; C.drift = false; C.brake = false; C.full = false; C.vy = NaN; C.mvx = NaN; C.mvz = 0; C.evade = 0;
    S.noseDir(u, tmpN); C.dx = tmpN.x; C.dy = tmpN.y; C.dz = tmpN.z;
    a.modeT = a.modeT || 0;
    reflexes(w, u, a, dt);
    // a damaged fighter or strike craft goes home; gunships decide for themselves
    if (d.role !== 'gunship' && u.hp < u.maxHp * 0.3 && a.mode !== 'rtb') setMode(a, 'rtb', 0);
    const role = d.role;
    if (a.mode === 'rtb' && role !== 'gunship') doRtb(w, u, a);
    else if (role === 'interceptor') doInterceptor(w, u, a, dt);
    else if (role === 'gunship') doGunship(w, u, a, dt);
    else doStrike(w, u, a, dt);
    if (d.vtol && u.agl < 250 && C.dy < -0.45) lookDir(C.dx, -0.45, C.dz);
    safety(w, u, a, dt, a.runMode);
    // full-roll pursuit in a dogfight, else bank-limited
    if (role === 'interceptor' && a.mode !== 'run') C.full = true;
    S.stepFlight(w, u, dt, C);
    if (!u.alive) return;
    // defensive guns for bombers / strike craft against a fighter on their tail
    if (role === 'bomber' || role === 'strike') { const th = a.threat ? w.umap.get(a.threat) : null; if (th && th.alive && V.distance(th.pos, u.pos) < 480) { /* nothing aft: rely on flares and the break */ } }
  }

  const Ctl = S.ctl = S.ctl || {};
  Ctl.fighter = Object.assign(Ctl.fighter || {}, { ai: aiFighter });
  Object.assign(S, { aiFighter, frontPoint });
})(window.E = window.E || {});
