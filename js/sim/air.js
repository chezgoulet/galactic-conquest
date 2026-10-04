// AIR: fighters and bombers — the flight model, launching from carriers, bot
// dogfighting / bombing runs and player control.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  const tmpA = V.make(), tmpB = V.make(), tmpC = V.make();
  function launchFighter(w, f, cap, i) {
    const type = (i % 3 === 2) ? 'bomber' : 'interceptor';
    let pos, yaw;
    if (cap && cap.alive) {
      const fx = Math.sin(cap.yaw), fz = Math.cos(cap.yaw);
      pos = { x: cap.pos.x + fx * 40 - fz * (i % 2 ? 60 : -60), y: cap.pos.y - cap.h - 12 - (i % 3) * 8, z: cap.pos.z + fz * 40 + fx * (i % 2 ? 60 : -60) }; yaw = cap.yaw;
    } else {
      const home = w.cps.find(c => c.home === f) || w.cps[0];
      pos = { x: home.pos.x * 2.2, y: home.pos.y + 420, z: home.pos.z + w.rng.f(-200, 200) }; yaw = f === 'aegis' ? Math.PI / 2 : -Math.PI / 2;
    }
    const u = S.spawnUnit(w, 'fighter', type, f, pos, { yaw });
    u.spd = u.speed; u.aimYaw = yaw;
    return u;
  }

  // ── flight model ─────────────────────────────────────────────
  function stepFighter(w, u, dt, desYaw, desPitch, speed) {
    const d = u.def, mt = d.turn * dt;
    const dy = S.angDiff(desYaw, u.yaw);
    u.yaw += E.clamp(dy, -mt, mt);
    u.roll += (E.clamp(dy * 1.8, -1.25, 1.25) - u.roll) * Math.min(1, dt * 3.5);
    u.pitch += E.clamp(E.clamp(desPitch, -1.2, 1.2) - u.pitch, -mt, mt);
    u.spd += (speed - u.spd) * Math.min(1, dt * 1.4);
    S.dirOf(u.yaw, u.pitch, tmpA);
    u.vel.x = tmpA.x * u.spd; u.vel.y = tmpA.y * u.spd; u.vel.z = tmpA.z * u.spd;
    u.pos.x += u.vel.x * dt; u.pos.y += u.vel.y * dt; u.pos.z += u.vel.z * dt;
    u.aimYaw = u.yaw; u.aimPitch = u.pitch;
    const g = Math.max(w.terrain.height(u.pos.x, u.pos.z), w.terrain.waterLevel);
    if (u.pos.y < g + 1.5) { u.pos.y = g + 1.5; S.kill(w, u, { team: null, uid: 0, owner: null, wk: 'crash' }); }
  }

  // ── AI: fighters ─────────────────────────────────────────────
  function aiFighter(w, u, dt) {
    const ai = u.ai, d = u.def, W = E.WEAPONS[d.weapon], T = w.terrain;
    S.think(w, u, dt);
    const tg = S.target(w, u);
    let desYaw = u.yaw, desPitch = 0, speed = u.speed;
    if (ai.state === 'break') {
      ai.stateT -= dt; desYaw = ai.bYaw; desPitch = ai.bPitch; speed = d.boost * u.spM;
      if (ai.stateT <= 0) ai.state = '';
    } else if (tg) {
      const bombRun = d.alt === 'bomb' && tg.kind !== 'fighter';
      S.leadPoint(u, tg, W, tmpA);
      if (bombRun) { S.centerOf(tg, tmpA); tmpA.y += tg.kind === 'capital' ? tg.h + 90 : 150; }
      const dx = tmpA.x - u.pos.x, dy = tmpA.y - u.pos.y, dz = tmpA.z - u.pos.z, hd = Math.hypot(dx, dz), dist = Math.hypot(hd, dy);
      desYaw = Math.atan2(dx, dz) + ai.errY; desPitch = Math.atan2(dy, hd) + ai.errP;
      S.dirOf(u.yaw, u.pitch, tmpB);
      const ang = Math.acos(E.clamp((dx * tmpB.x + dy * tmpB.y + dz * tmpB.z) / (dist || 1), -1, 1));
      if (bombRun) {
        const dh = u.pos.y - (tg.pos.y + (tg.kind === 'capital' ? tg.h : 0)), tf = Math.sqrt(Math.max(0.1, 2 * dh / E.WEAPONS.bomb.grav)), lead = u.spd * tf;
        if (u.altT <= 0 && dh > 20 && Math.abs(hd - lead) < (tg.kind === 'capital' ? 70 : 16) && Math.abs(S.angDiff(Math.atan2(dx, dz), u.yaw)) < 0.3) S.fireAlt(w, u, tmpB, 0);
        if (hd < 30) { ai.state = 'break'; ai.stateT = 3.5; ai.bYaw = u.yaw + ai.strafe * 0.5; ai.bPitch = 0.25; }
      } else {
        if (ang < 0.06 && dist < W.range) S.firePrimary(w, u, tmpB, 0);
        if (d.alt === 'missile' && u.altT <= 0 && ang < 0.16 && dist > 140 && dist < E.WEAPONS.missile.range && tg.kind !== 'infantry') S.fireAlt(w, u, tmpB, tg.id);
        const brk = tg.kind === 'capital' ? 430 : tg.kind === 'fighter' ? 60 : 170;
        if (dist < brk) { ai.state = 'break'; ai.stateT = 2 + w.rng.next() * 1.6; ai.bYaw = u.yaw + ai.strafe * (1.1 + w.rng.next()); ai.bPitch = tg.kind === 'fighter' ? (w.rng.next() - 0.3) * 0.7 : 0.5; }
      }
      if (dist > 500) speed = d.boost * u.spM;
    } else {
      // patrol a lazy circle over the front
      const a = w.t * 0.12 + u.id, px = Math.cos(a) * 520 + (u.team === 'aegis' ? -200 : 200), pz = Math.sin(a) * 520;
      desYaw = Math.atan2(px - u.pos.x, pz - u.pos.z);
      desPitch = E.clamp((T.height(u.pos.x, u.pos.z) + 300 - u.pos.y) * 0.004, -0.4, 0.4);
    }
    // safety
    const g = Math.max(T.height(u.pos.x, u.pos.z), T.waterLevel), g2 = Math.max(T.height(u.pos.x + u.vel.x * 1.6, u.pos.z + u.vel.z * 1.6), T.waterLevel);
    const agl = u.pos.y - g, ahead = u.pos.y + u.vel.y * 1.6 - g2;
    if (agl < 55 || ahead < 45) desPitch = Math.max(desPitch, agl < 28 || ahead < 20 ? 1.0 : 0.6);
    if (u.pos.y > 1250) desPitch = Math.min(desPitch, -0.25);
    if (Math.hypot(u.pos.x, u.pos.z) > w.layout.bound) desYaw = Math.atan2(-u.pos.x, -u.pos.z);
    // steer clear of capital hulls
    for (const c of w.units) if (c.kind === 'capital' && c.alive && V.distance2(c.pos, u.pos) < (c.def.len * 0.62) * (c.def.len * 0.62) && ai.state !== 'break') {
      ai.state = 'break'; ai.stateT = 1.6; ai.bYaw = Math.atan2(u.pos.x - c.pos.x, u.pos.z - c.pos.z); ai.bPitch = u.pos.y > c.pos.y ? 0.5 : -0.4;
    }
    stepFighter(w, u, dt, desYaw, desPitch, speed);
  }

  // ── player control ───────────────────────────────────────────
  function playerFighter(w, u, p, dt) {
    const inp = p.input, mz = E.clamp(inp.mz || 0, -1, 1);
    const d = u.def, sp = (inp.sprint || mz > 0) ? d.boost : mz < 0 ? d.minSpeed : d.speed;
    let dy = inp.yaw, dp = inp.pitch;
    if (Math.hypot(u.pos.x, u.pos.z) > w.layout.bound * 1.12) dy = Math.atan2(-u.pos.x, -u.pos.z);
    if (u.pos.y > 1600) dp = Math.min(dp, -0.2);
    stepFighter(w, u, dt, dy, dp, sp * u.spM);
    if (!u.alive) return;
    S.dirOf(u.yaw, u.pitch, tmpA); S.dirOf(inp.yaw, inp.pitch, tmpC);
    const conv = (tmpA.x * tmpC.x + tmpA.y * tmpC.y + tmpA.z * tmpC.z) > 0.985 ? tmpC : tmpA; // slight gimbal
    if (inp.fire) S.firePrimary(w, u, conv, 0);
    if (inp.abil) {
      const lk = d.alt === 'missile' ? S.aimTarget(w, u, u.pos, tmpA, 0.3, E.WEAPONS.missile.range, S.lockable) : null;
      if (d.alt !== 'missile' || lk) S.fireAlt(w, u, tmpA, lk ? lk.id : 0);
    }
  }

  const C = S.ctl = S.ctl || {};
  C.fighter = { ai: aiFighter, player: playerFighter };

  Object.assign(S, { launchFighter, stepFighter, aiFighter, playerFighter });
})(window.E = window.E || {});
