// AIR: the flight model for everything that flies and is not a capital ship —
// fighters, bombers, gunships and strike craft. Attitude is a body basis driven
// by pitch/yaw/roll rates; velocity is a real vector shaped by thrust, drag,
// gravity and lift, all scaled by the local air density so one model runs from
// the ground, through the cloud deck and thin air, out to orbit.
//   air.js     flight model, launching, player control, hulls and ground (this file)
//   airwpn.js  lock-on, countermeasures, guns, bombs, torpedoes
//   airai.js   per-role bot doctrine
//   airops.js  troop drops, close-air-support call-ins, repair
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  const tmpA = V.make(), tmpB = V.make(), tmpC = V.make();
  const clamp = E.clamp, clamp01 = E.clamp01, smooth = E.smooth;
  // the control sheet every pilot (bot or human) fills in each tick
  const CT = { dx: 0, dy: 0, dz: 1, thr: 0.65, boost: false, roll: 0, drift: false, brake: false, full: false, vy: NaN, mvx: NaN, mvz: 0, evade: 0 };
  const AP = { q: 0, r: 0, p: 0 };

  // ── attitude basis ───────────────────────────────────────────
  // f = nose, r = right wing, u = up (u = r x f). Bank is positive when banked
  // left (left wing down), the same sense the renderer already reads from u.roll.
  function setBasis(F, yaw, pitch, bank) {
    const cp = Math.cos(pitch), fx = Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = Math.cos(yaw) * cp;
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);
    let ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    const c = Math.cos(bank), s = Math.sin(bank);
    F.fx = fx; F.fy = fy; F.fz = fz;
    F.ux = ux * c - rx * s; F.uy = uy * c; F.uz = uz * c - rz * s;
    F.rx = rx * c + ux * s; F.ry = uy * s; F.rz = rz * c + uz * s;
  }
  function deriveAngles(u, F) {
    const cp = Math.hypot(F.fx, F.fz);
    if (cp > 0.02) u.yaw = Math.atan2(F.fx, F.fz);
    u.pitch = Math.asin(clamp(F.fy, -1, 1));
    const r0x = -Math.cos(u.yaw), r0z = Math.sin(u.yaw);
    let lx = -r0z * F.fy, ly = r0z * F.fx - r0x * F.fz, lz = r0x * F.fy;
    const l = Math.hypot(lx, ly, lz) || 1; lx /= l; ly /= l; lz /= l;
    u.roll = Math.atan2(-(F.ux * r0x + F.uz * r0z), F.ux * lx + F.uy * ly + F.uz * lz);
    u.aimYaw = u.yaw; u.aimPitch = u.pitch;
  }
  function orthonormalize(F) {
    let l = Math.hypot(F.fx, F.fy, F.fz) || 1; F.fx /= l; F.fy /= l; F.fz /= l;
    const d = F.rx * F.fx + F.ry * F.fy + F.rz * F.fz;
    F.rx -= F.fx * d; F.ry -= F.fy * d; F.rz -= F.fz * d;
    l = Math.hypot(F.rx, F.ry, F.rz) || 1; F.rx /= l; F.ry /= l; F.rz /= l;
    F.ux = F.ry * F.fz - F.rz * F.fy; F.uy = F.rz * F.fx - F.rx * F.fz; F.uz = F.rx * F.fy - F.ry * F.fx;
  }
  const noseDir = (u, o) => { const F = u.fl; if (F) { o.x = F.fx; o.y = F.fy; o.z = F.fz; return o; } return S.dirOf(u.yaw, u.pitch, o); };

  // ── per-craft state ──────────────────────────────────────────
  function initAir(u) {
    const d = u.def, F = u.fl = { fx: 0, fy: 0, fz: 1, rx: -1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, wp: 0, wq: 0, wr: 0 };
    setBasis(F, u.yaw, u.pitch, u.roll);
    Object.assign(u, {
      thr: 0.65, thrCmd: 0.65, boostE: 1, boosting: false, boostLock: false, stall: 0, stallWarn: false, inCloud: false, dens: 1,
      g: 0, sens: 0, drift: false, driftE: 1, driftLock: false, evT: 0, evCd: 0, evDir: 1,
      cm: d.cm || 0, cmCd: 0, cmT: 0, jamT: -1, ord: d.ord || 0, ordT: 0,
      lockId: 0, lockT: 0, locked: false, lockOut: 0, warn: 0, warnT: -1, lockedT: -1, mslT: -1, mslD: 0, trackT: -1,
      carry: 0, load: null, band: 0, oob: 0, agl: 0, landed: false, pilot: false, prevCycle: false, launchT: u.launchT !== undefined ? u.launchT : -99,
      air: { mode: '', modeT: 0, thinkT: 0, tid: 0, px: 0, py: 0, pz: 0, hasPt: false, side: 1, reactT: -1, task: null, clear: 60, clrT: 0 },
    });
    return F;
  }
  function bandOf(y) { return y < S.ALT.cloudLo ? 0 : y <= S.ALT.cloudHi ? 1 : y < S.ALT.space ? 2 : 3; }

  // does the segment a-b pass through the cloud deck? (locks and sight can't)
  function cloudBlocks(a, b) {
    const lo = a.y < b.y ? a.y : b.y, hi = a.y < b.y ? b.y : a.y;
    return hi >= S.ALT.cloudLo && lo <= S.ALT.cloudHi;
  }

  // ── autopilot: world direction -> body rates ─────────────────
  // Mouse-aim for humans, steering for bots: roll to put the lift vector toward
  // the target, then pull; rudder mops up. Banking is limited unless C.full.
  function autopilot(u, F, C, auth, o) {
    const d = u.def;
    const ex = C.dx * F.rx + C.dy * F.ry + C.dz * F.rz, ey = C.dx * F.ux + C.dy * F.uy + C.dz * F.uz, ez = C.dx * F.fx + C.dy * F.fy + C.dz * F.fz;
    const h = Math.hypot(ex, ey), th = Math.atan2(h, ez);
    const sx = h > 1e-6 ? ex / h : 0, sy = h > 1e-6 ? ey / h : 1;
    const vt = d.vtol ? 1 : 0;
    o.q = clamp(th * sy * 3.4, -auth, auth);
    const ya = auth * (vt ? 0.95 : 0.55);
    o.r = clamp(th * sx * 2.6, -ya, ya);
    const rollMax = d.roll * (1 - 0.5 * u.stall);
    if (C.roll) { o.p = C.roll * rollMax; return; }
    const bank = u.roll;
    let wt = clamp01((th - 0.05) / 0.25) * (vt ? 0.25 : 1);
    let want = Math.atan2(ex, ey);
    if (!C.full) { const nb = clamp(bank - want, -1.25, 1.25); want = bank - nb; }
    o.p = clamp(want * 3.6, -rollMax, rollMax) * wt + clamp(bank * 1.1, -rollMax * 0.6, rollMax * 0.6) * (1 - wt);
  }

  function startEvade(w, u, dir) {
    const K = E.AIR;
    if (u.evT > 0 || u.evCd > 0) return false;
    u.evT = Math.max(K.evadeTime, E.TAU / (u.def.roll * 1.35)); u.evCd = K.evadeCooldown; u.evDir = dir < 0 ? -1 : 1;
    w.events.push({ type: 'evade', uid: u.id, dir: u.evDir, to: u.pid, pos: V.clone(u.pos) });
    return true;
  }

  // ── the flight step ──────────────────────────────────────────
  function stepFlight(w, u, dt, C) {
    const d = u.def, K = E.AIR, T = w.terrain, G = K.G;
    const F = u.fl || initAir(u);
    const vel = u.vel, pos = u.pos;
    let v = Math.hypot(vel.x, vel.y, vel.z);
    const rho = S.density(pos.y), rs = smooth(rho * 3.5);   // rs: 1 in the air, 0 in space, blended between
    const vc = d.corner * u.spM, vmax = d.speed * 1.2 * u.spM, vBoost = d.boost * u.spM, spaceMax = vBoost * 1.35;
    u.dens = rho;

    // upkeep: ordnance rearm, countermeasures, cooldowns
    if (u.ord < d.ord) { u.ordT += dt; if (u.ordT >= d.rearm) { u.ordT = 0; u.ord++; } } else u.ordT = 0;
    if (u.cm < d.cm) { u.cmT += dt; if (u.cmT >= K.cmRegen) { u.cmT = 0; u.cm++; } }
    u.cmCd -= dt; u.evCd -= dt;

    // afterburner resource
    let boosting = false;
    if (u.boostHold > 0) u.boostHold -= dt;
    if ((C.boost || u.boostHold > 0) && u.boostE > 0 && !u.boostLock) {
      if (!u.boosting) u.boostHold = 0.6; boosting = true; u.boostE -= K.boostDrain * dt; if (u.boostE <= 0) { u.boostE = 0; u.boostLock = true; } }
    else { u.boostE = Math.min(1, u.boostE + K.boostRegen * dt * (C.boost ? 0.4 : 1)); if (u.boostLock && u.boostE > K.boostLockout) u.boostLock = false; }
    if (boosting !== u.boosting) { u.boosting = boosting; w.events.push({ type: 'boost', uid: u.id, on: boosting, to: u.pid }); }
    // drift: decouple heading from velocity for a moment
    let drift = false;
    if (C.drift && !d.vtol && u.driftE > 0 && !u.driftLock) { drift = true; u.driftE -= dt / K.driftMax; if (u.driftE <= 0) { u.driftE = 0; u.driftLock = true; } }
    else { u.driftE = Math.min(1, u.driftE + dt * K.driftRegen); if (u.driftLock && u.driftE > 0.35) u.driftLock = false; }
    u.drift = drift;

    // throttle spools toward its command
    u.thr += clamp(C.thr - u.thr, -dt * 1.6, dt * 1.6);

    // stall: lift is gone below the stall speed, but only in real air
    const sw = smooth((rho - 0.2) / 0.25), vs = d.stall / Math.sqrt(Math.max(rho, 0.35));
    const vtolW = d.vtol ? clamp01((0.75 * vc - v) / (0.5 * vc)) * rs : 0;
    const st = sw * clamp01((vs - v) / (0.2 * vs)) * (1 - vtolW);
    const was = u.stall;
    u.stall += (st - u.stall) * Math.min(1, dt * (st > u.stall ? 4 : 1.6));
    u.stallWarn = sw > 0.2 && v < vs * 1.25 && vtolW < 0.5;
    if ((was < 0.5) !== (u.stall < 0.5)) w.events.push({ type: 'stall', uid: u.id, on: u.stall >= 0.5, to: u.pid, pos: V.clone(pos) });

    // control authority: aerodynamic (best at corner speed) or thruster-limited
    const cornerF = clamp(Math.min(v / vc, vc / Math.max(v, 1)), 0.35, 1);
    const aero = d.turn * Math.sqrt(rho) * cornerF;
    const rcs = d.turn * 0.55 * (boosting ? 1.25 : 1);
    const auth = Math.max(aero, rcs, d.turn * 0.9 * vtolW) * (1 - 0.65 * u.stall);

    // evasive manoeuvre request
    if (C.evade && u.evT <= 0) startEvade(w, u, C.evade);
    autopilot(u, F, C, auth, AP);
    if (u.stall > 0.05) {
      AP.q -= u.stall * sw * 1.3;
      AP.p += u.stall * Math.sin(w.t * 5 + u.id) * 0.9;
    }
    if (u.evT > 0 && rho > 0.3 && !u.pid && pos.y - Math.max(T.height(pos.x, pos.z), T.waterLevel) < 180 - Math.min(0, vel.y) * 1.6) u.evT = 0;   // bots never barrel-roll into the ground
    if (u.evT > 0) {
      u.evT -= dt;
      const k = Math.min(1, u.evT * 6 + 0.3);
      AP.p = u.evDir * d.roll * 1.35 * k; AP.q = Math.max(AP.q * 0.3, auth * 0.4 * k); AP.r *= 0.3;
    }
    const kr = Math.min(1, dt * 7);
    F.wq += (AP.q - F.wq) * kr; F.wr += (AP.r - F.wr) * kr; F.wp += (AP.p - F.wp) * kr;
    // rotate the basis: pitch about r, yaw about u, roll about f
    let a = F.wq * dt, c = Math.cos(a), s = Math.sin(a), x, y, z;
    x = F.fx * c + F.ux * s; y = F.fy * c + F.uy * s; z = F.fz * c + F.uz * s;
    F.ux = F.ux * c - F.fx * s; F.uy = F.uy * c - F.fy * s; F.uz = F.uz * c - F.fz * s; F.fx = x; F.fy = y; F.fz = z;
    a = F.wr * dt; c = Math.cos(a); s = Math.sin(a);
    x = F.fx * c + F.rx * s; y = F.fy * c + F.ry * s; z = F.fz * c + F.rz * s;
    F.rx = F.rx * c - F.fx * s; F.ry = F.ry * c - F.fy * s; F.rz = F.rz * c - F.fz * s; F.fx = x; F.fy = y; F.fz = z;
    a = F.wp * dt; c = Math.cos(a); s = Math.sin(a);
    x = F.ux * c + F.rx * s; y = F.uy * c + F.ry * s; z = F.uz * c + F.rz * s;
    F.rx = F.rx * c - F.ux * s; F.ry = F.ry * c - F.uy * s; F.rz = F.rz * c - F.uz * s; F.ux = x; F.uy = y; F.uz = z;
    orthonormalize(F);

    // forces
    const bm = boosting ? (vBoost / vmax) * (vBoost / vmax) : 1;
    const fade = clamp01((S.ALT.ceiling - pos.y) / 300);
    let ax = 0, ay = 0, az = 0;
    const thrust = d.accel * u.thr * bm * fade;
    // atmosphere: thrust, drag, gravity (all by density)
    if (rs > 0) {
      const kd = d.accel / (vmax * vmax) * rho * (1 + (drift ? 0.6 : 0) + (C.brake ? 2.5 : 0));
      ax += F.fx * thrust * rs - kd * v * vel.x * rs; ay += F.fy * thrust * rs - kd * v * vel.y * rs; az += F.fz * thrust * rs - kd * v * vel.z * rs;
      const gs = G * clamp01(rho * 1.6) * rs;
      ay -= gs;
      // lift cancels the part of gravity across the flight path (the part along it
      // still trades height for speed); it fades away below the stall speed
      if (v > 1) {
        const liftC = (1 - u.stall) * clamp01((v - 0.5 * vs) / (0.5 * vs)), vyn = vel.y / v;
        ax += gs * liftC * (-vyn * vel.x / v); ay += gs * liftC * (1 - vyn * vyn); az += gs * liftC * (-vyn * vel.z / v);
      }
    }
    // space: thrust-limited, no drag. Flight assist holds the nose-axis speed to the
    // throttle setpoint and bleeds lateral drift; crouch (drift) switches it off.
    const aw = 1 - rs;
    if (aw > 0) {
      const vf = vel.x * F.fx + vel.y * F.fy + vel.z * F.fz;
      if (drift) { if (boosting) { ax += F.fx * thrust * aw; ay += F.fy * thrust * aw; az += F.fz * thrust * aw; } }
      else {
        const vset = u.thr * spaceMax * (boosting ? 1 : 0.7);
        const acc = vf < vset ? thrust * (vset > 0 ? 1 : 0) : -d.accel * 0.5;
        const gain = vf < vset ? Math.min(1, (vset - vf) * 0.2) : 1;
        ax += F.fx * acc * gain * aw; ay += F.fy * acc * gain * aw; az += F.fz * acc * gain * aw;
        const lk = Math.exp(-0.9 * aw * dt);
        const lx = vel.x - F.fx * vf, ly = vel.y - F.fy * vf, lz = vel.z - F.fz * vf;
        vel.x -= lx * (1 - lk); vel.y -= ly * (1 - lk); vel.z -= lz * (1 - lk);
      }
    }
    // VTOL lift jets: hold the craft up and steer its ground velocity at low speed
    if (vtolW > 0) {
      const wantVy = isNaN(C.vy) ? 0 : C.vy;
      ay += vtolW * (G * clamp01(rho * 1.6) + clamp((wantVy - vel.y) * 1.6, -9, 9));
      if (!isNaN(C.mvx)) {
        let hx = (C.mvx - vel.x) * 1.4, hz = (C.mvz - vel.z) * 1.4; const hl = Math.hypot(hx, hz), lim = d.accel * 0.6;
        if (hl > lim) { hx *= lim / hl; hz *= lim / hl; }
        ax += hx * vtolW; az += hz * vtolW;
      }
      const dk = 0.35 * vtolW; vel.x -= vel.x * dk * dt; vel.z -= vel.z * dk * dt;
    }
    vel.x += ax * dt; vel.y += ay * dt; vel.z += az * dt;

    // lift: the velocity vector follows the nose, bleeding speed in hard turns
    v = Math.hypot(vel.x, vel.y, vel.z);
    let omega = 0;
    if (rs > 0.02 && v > 1 && !drift) {
      const c0 = clamp((vel.x * F.fx + vel.y * F.fy + vel.z * F.fz) / v, -1, 1);
      if (c0 < 0.99999) {
        const liftF = (1 - u.stall) * clamp(v / vc, 0.25, 1.4) * (1 - vtolW);
        const al = Math.acos(c0);
        let dl = al * (1 - Math.exp(-3.4 * rho * liftF * dt));
        dl = Math.min(dl, d.turn * 1.25 * Math.sqrt(rho) * Math.min(1, vc / Math.max(v, vc)) * dt);
        if (dl > 1e-6) {
          // rotate the velocity direction by dl toward the nose
          const hx = vel.x / v, hy = vel.y / v, hz = vel.z / v;
          let ex = F.fx - hx * c0, ey = F.fy - hy * c0, ez = F.fz - hz * c0; const el = Math.hypot(ex, ey, ez) || 1;
          ex /= el; ey /= el; ez /= el;
          const cd = Math.cos(dl), sd = Math.sin(dl);
          vel.x = (hx * cd + ex * sd) * v; vel.y = (hy * cd + ey * sd) * v; vel.z = (hz * cd + ez * sd) * v;
          omega = dl / dt;
          const nv = Math.max(v * 0.4, v - 0.045 * omega * omega * v * dt * rs);
          const k = nv / v; vel.x *= k; vel.y *= k; vel.z *= k; v = nv;
        }
      }
    }
    u.g += (omega * v / 40 - u.g) * Math.min(1, dt * 5);
    // speed ceiling
    if (v > spaceMax) { const k = spaceMax / v; vel.x *= k; vel.y *= k; vel.z *= k; v = spaceMax; }

    // integrate
    const px = pos.x, py = pos.y, pz = pos.z;
    pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
    u.spd = v; u.vy = vel.y;
    // soft arena bound
    const hd = Math.hypot(pos.x, pos.z), B = w.layout.bound * 1.3;
    if (hd > B) { const k = B / hd; pos.x *= k; pos.z *= k; const vo = (vel.x * pos.x + vel.z * pos.z) / B; if (vo > 0) { vel.x -= pos.x / B * vo; vel.z -= pos.z / B * vo; } }
    // ceiling
    if (pos.y > S.ALT.ceiling) { pos.y = S.ALT.ceiling; if (vel.y > 0) vel.y = 0; }

    // ground and water
    const gh = Math.max(T.height(pos.x, pos.z), T.waterLevel), gm = Math.max(T.height((px + pos.x) * 0.5, (pz + pos.z) * 0.5), T.waterLevel);
    u.agl = pos.y - gh;
    u.landed = false;
    if (pos.y < gh + 1.5 || (py + pos.y) * 0.5 < gm + 1.2) {
      const water = T.height(pos.x, pos.z) < T.waterLevel;
      if (d.vtol && v < 20 && vel.y > -9 && !water) { pos.y = gh + 1.5; vel.y = 0; vel.x *= 0.85; vel.z *= 0.85; u.landed = true; }
      else {
        pos.y = Math.max(pos.y, gh + 1.5);
        w.events.push({ type: 'crash', uid: u.id, pos: V.clone(pos), vel: V.clone(vel), surf: water ? 'water' : 'ground', team: u.team, kind: u.type });
        S.kill(w, u, { team: null, uid: 0, owner: null, wk: 'crash' });
        return;
      }
    }
    hullCollide(w, u, v);
    if (!u.alive) return;

    // derived presentation state
    deriveAngles(u, F);
    u.inCloud = pos.y >= S.ALT.cloudLo && pos.y <= S.ALT.cloudHi;
    u.sens = v / vBoost;
    const b = bandOf(pos.y);
    if (b !== u.band) { u.band = b; w.events.push({ type: 'band', uid: u.id, band: b, to: u.pid }); }
  }

  // capital hulls are solid: a fast hit is fatal, a graze hurts and bounces
  function hullCollide(w, u, v) {
    if (w.t - u.launchT < 7) return;
    const U = w.units;
    for (let i = 0; i < U.length; i++) {
      const c = U[i];
      if (c.kind !== 'capital' || !c.alive) continue;
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), hl = c.def.len * 0.5 - c.h, rc = c.h * 1.25 + u.r;
      const rx = u.pos.x - c.pos.x, ry = u.pos.y - c.pos.y, rz = u.pos.z - c.pos.z;
      if (Math.abs(ry) > rc * 1.6 + 8) continue;
      const a = clamp(rx * fx + rz * fz, -hl, hl), qx = rx - fx * a, qz = rz - fz * a;
      const d2 = qx * qx + ry * ry * 1.6 + qz * qz;
      if (d2 >= rc * rc) continue;
      const dmg = 70 + v * 2.2;
      w.events.push({ type: 'crash', uid: u.id, pos: V.clone(u.pos), vel: V.clone(u.vel), surf: 'hull', cap: c.id, team: u.team, kind: u.type });
      u.hp -= dmg; u.hitT = 0;
      if (u.hp <= 0) { S.kill(w, u, { team: null, uid: 0, owner: null, wk: 'crash' }); return; }
      let nx = qx, ny = ry, nz = qz; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      u.pos.x = c.pos.x + fx * a + nx * (rc + 1); u.pos.y = c.pos.y + ny * (rc + 1) / 1.26; u.pos.z = c.pos.z + fz * a + nz * (rc + 1);
      const vn = u.vel.x * nx + u.vel.y * ny + u.vel.z * nz;
      if (vn < 0) { u.vel.x -= 1.6 * vn * nx; u.vel.y -= 1.6 * vn * ny; u.vel.z -= 1.6 * vn * nz; }
      return;
    }
  }

  // ── launching ────────────────────────────────────────────────
  const ROSTER = ['interceptor', 'bomber', 'gunship', 'interceptor', 'strike', 'interceptor'];
  // false when the ship's hangar has been shot out (subsystems are optional)
  function canLaunch(w, cap) {
    if (!cap || !cap.alive) return false;
    const h = cap.sys && cap.sys.hangar;
    if (h && (h.alive === false || h.dead || h.hp <= 0)) return false;
    return true;
  }
  function launchFighter(w, f, cap, i) {
    const type = ROSTER[(i % ROSTER.length + ROSTER.length) % ROSTER.length];
    let pos, yaw, sp;
    if (canLaunch(w, cap)) {
      const fx = Math.sin(cap.yaw), fz = Math.cos(cap.yaw);
      pos = { x: cap.pos.x + fx * 40 - fz * (i % 2 ? 60 : -60), y: cap.pos.y - cap.h - 12 - (i % 3) * 8, z: cap.pos.z + fz * 40 + fx * (i % 2 ? 60 : -60) }; yaw = cap.yaw; sp = Math.max(0, cap.spd || 0) + 60;
    } else {   // no usable hangar: scramble from the home airfield instead
      const home = w.cps.find(c => c.home === f) || w.cps[0];
      pos = { x: home.pos.x * 2.2, y: home.pos.y + 420, z: home.pos.z + w.rng.f(-200, 200) }; yaw = f === 'aegis' ? Math.PI / 2 : -Math.PI / 2; sp = 80;
    }
    const u = S.spawnUnit(w, 'fighter', type, f, pos, { yaw, launchT: w.t });
    initAir(u);
    const d = u.def; sp = Math.min(sp, d.speed * u.spM * 1.1);
    u.vel.x = Math.sin(yaw) * sp; u.vel.z = Math.cos(yaw) * sp; u.spd = sp; u.aimYaw = yaw;
    return u;
  }

  // compat shim: old callers steer toward a yaw/pitch at a speed
  function stepFighter(w, u, dt, desYaw, desPitch, speed) {
    S.dirOf(desYaw, desPitch, tmpA);
    CT.dx = tmpA.x; CT.dy = tmpA.y; CT.dz = tmpA.z; CT.thr = clamp((speed / (u.def.speed * 1.2 * u.spM)) ** 2, 0, 1);
    CT.boost = speed > u.def.speed * 1.4 * u.spM; CT.roll = 0; CT.drift = false; CT.brake = false; CT.full = false; CT.vy = NaN; CT.mvx = NaN; CT.evade = 0;
    stepFlight(w, u, dt, CT);
  }

  // ── player control ───────────────────────────────────────────
  function playerFighter(w, u, p, dt) {
    const inp = p.input, d = u.def, F = u.fl || initAir(u);
    if (!u.pilot) { u.pilot = true; u.thrCmd = u.thr; }
    const mz = clamp(inp.mz || 0, -1, 1), mx = clamp(inp.mx || 0, -1, 1);
    const hover = d.vtol && u.spd < 0.55 * d.corner * u.spM;
    u.thrCmd = clamp(u.thrCmd + mz * 0.5 * dt, d.vtol ? 0 : 0.12, 1);
    S.dirOf(inp.yaw, inp.pitch, tmpA);
    let dx = tmpA.x, dy = tmpA.y, dz = tmpA.z;
    // outer bound: the nose swings back toward the battle
    const hd = Math.hypot(u.pos.x, u.pos.z), B = w.layout.bound;
    u.oob = clamp01((hd - B * 1.02) / (B * 0.2));
    if (u.oob > 0) {
      const il = 1 / (hd || 1), k = u.oob;
      dx = dx * (1 - k) - u.pos.x * il * k; dz = dz * (1 - k) - u.pos.z * il * k;
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    }
    CT.dx = dx; CT.dy = dy; CT.dz = dz;
    let thr = u.thrCmd;
    const vs = d.stall / Math.sqrt(Math.max(u.dens, 0.35));
    if (!d.vtol && u.dens > 0.3 && u.spd < vs * 1.3) thr = Math.max(thr, 0.9);     // stall protection for new pilots
    CT.thr = thr; CT.roll = clamp(inp.roll || 0, -1, 1); CT.drift = !!inp.crouch && !d.vtol; CT.brake = !!inp.crouch && !!d.vtol; CT.full = false;
    CT.boost = !!inp.sprint && !d.vtol; CT.vy = NaN; CT.mvx = NaN; CT.evade = 0;
    if (d.vtol) {
      CT.vy = inp.sprint ? 8 : inp.crouch ? -7 : 0;
      if (hover) {   // WASD flies the lift jets: forward along the aim heading, strafe sideways
        const fx = Math.sin(inp.yaw), fz = Math.cos(inp.yaw), sp = 16 * (0.25 + u.thrCmd);
        CT.mvx = fx * mz * sp - fz * mx * sp; CT.mvz = fz * mz * sp + fx * mx * sp; CT.thr = 0;
      }
    }
    if (inp.abil2 && u.evT <= 0 && u.evCd <= 0) CT.evade = inp.roll < 0 ? -1 : inp.roll > 0 ? 1 : (u.evDir = -u.evDir);
    if (inp.jump) S.airCM(w, u);
    stepFlight(w, u, dt, CT);
    if (!u.alive) return;
    S.airPilotWeapons(w, u, inp, dt);
  }

  const C = S.ctl = S.ctl || {};
  C.fighter = Object.assign(C.fighter || {}, { player: playerFighter, death: onDeath });
  function onDeath(w, u) {
    if (u.carry > 0) {
      const T = w.teams[u.team]; T.tickets = Math.max(0, T.tickets - u.carry);
      w.events.push({ type: 'troopsLost', uid: u.id, team: u.team, n: u.carry, pos: V.clone(u.pos) });
      u.carry = 0; u.load = null;
    }
  }

  // ── multiplayer: what guests need to draw the cockpit and effects ──
  const r2 = (x) => Math.round(x * 100) / 100;
  S.net = S.net || { unit: {}, world: {} };
  S.net.unit.fighter = {
    pack(u) {
      const fl = (u.boosting ? 1 : 0) | (u.stall >= 0.5 ? 2 : 0) | (u.stallWarn ? 4 : 0) | (u.inCloud ? 8 : 0) | (u.drift ? 16 : 0) | (u.evT > 0 ? 32 : 0) | (u.locked ? 64 : 0) | ((u.warn | 0) << 7) | (u.landed ? 512 : 0);
      return [r2(u.thr), r2(u.boostE), r2(u.lockT), fl, u.cm | 0, r2(u.g), r2(u.sens), u.carry | 0, u.lockId | 0, u.ord | 0, r2(u.driftE), r2(u.oob), r2(u.dens)];
    },
    apply(u, a) {
      u.thr = a[0]; u.boostE = a[1]; u.lockT = a[2]; const fl = a[3];
      u.boosting = !!(fl & 1); u.stall = fl & 2 ? 1 : 0; u.stallWarn = !!(fl & 4); u.inCloud = !!(fl & 8); u.drift = !!(fl & 16); u.evT = fl & 32 ? 0.5 : 0; u.locked = !!(fl & 64); u.warn = (fl >> 7) & 3; u.landed = !!(fl & 512);
      u.cm = a[4]; u.g = a[5]; u.sens = a[6]; u.carry = a[7]; u.lockId = a[8]; u.ord = a[9]; u.driftE = a[10]; u.oob = a[11]; u.dens = a[12];
    },
  };

  Object.assign(S, { launchFighter, canLaunch, stepFighter, stepFlight, initAir, startEvade, playerFighter, noseDir, cloudBlocks, bandOf, setBasis, deriveAngles });
  S.airCT = CT;
})(window.E = window.E || {});
