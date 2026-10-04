// LAND: infantry, ground vehicles and emplacements — movement over terrain,
// bot behaviour and player control.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  const tmpA = V.make(), tmpB = V.make(), tmpC = V.make();
  const GRAV = 22;

  // ── movement ─────────────────────────────────────────────────
  function stepInfantry(w, u, dt, wx, wz, speed, jump) {
    const T = w.terrain, g = T.ground(u.pos.x, u.pos.z);
    if (T.height(u.pos.x, u.pos.z) < T.waterLevel - 0.5) speed *= 0.62;
    if (wx || wz) {
      const grade = (T.ground(u.pos.x + wx * 1.6, u.pos.z + wz * 1.6) - g) / 1.6;
      if (grade > 0.15) speed *= E.clamp(1.12 - grade * 0.8, 0.3, 1);
    }
    const k = Math.min(1, dt * (u.onGround ? 11 : 2.5));
    u.vel.x += (wx * speed - u.vel.x) * k; u.vel.z += (wz * speed - u.vel.z) * k;
    u.pos.x += u.vel.x * dt; u.pos.z += u.vel.z * dt;
    S.clampArena(w, u);
    if (jump && u.onGround) { u.vy = 7.6; u.onGround = false; }
    u.vy -= GRAV * dt; u.pos.y += u.vy * dt;
    const g2 = T.ground(u.pos.x, u.pos.z);
    if (u.pos.y <= g2 || (u.vy <= 0 && u.pos.y - g2 < 0.45 && u.onGround)) { u.pos.y = g2; u.vy = 0; u.onGround = true; }
    else if (u.pos.y - g2 > 0.45) u.onGround = false;
    u.vel.y = u.vy;
  }
  function stepVehicle(w, u, dt, throttle, turn) {
    const d = u.def, T = w.terrain;
    u.spd += (throttle * u.speed - u.spd) * Math.min(1, dt * d.accel / u.speed * 1.6);
    u.yaw += turn * d.turn * dt * (0.35 + 0.65 * Math.min(1, Math.abs(u.spd) / (u.speed * 0.4) + 0.4));
    const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw);
    const grade = (T.height(u.pos.x + fx * 5, u.pos.z + fz * 5) - T.height(u.pos.x, u.pos.z)) / 5;
    const sl = u.spd > 0 && grade > 0.25 ? E.clamp(1.2 - grade * 0.8, 0.25, 1) : 1;
    u.vel.x = fx * u.spd * sl; u.vel.z = fz * u.spd * sl;
    u.pos.x += u.vel.x * dt; u.pos.z += u.vel.z * dt;
    S.clampArena(w, u);
    const ty = Math.max(T.height(u.pos.x, u.pos.z), T.waterLevel) + d.hover;
    u.vel.y = (ty - u.pos.y) * Math.min(1, dt * 9) / dt; u.pos.y += (ty - u.pos.y) * Math.min(1, dt * 9);
  }

  // ── AI: infantry ─────────────────────────────────────────────
  function aiInfantry(w, u, dt) {
    const ai = u.ai, W = E.WEAPONS[u.def.weapon];
    S.think(w, u, dt);
    const tg = S.target(w, u), gp = S.goalPos(w, u, tmpC);
    const gx = gp.x - u.pos.x, gz = gp.z - u.pos.z, dg = Math.hypot(gx, gz);
    let wx = 0, wz = 0, speed = u.speed;
    if (tg) {
      const tx = tg.pos.x - u.pos.x, tz = tg.pos.z - u.pos.z, d = Math.hypot(tx, tz) || 1;
      S.leadPoint(u, tg, W, tmpA); S.eyeOf(u, tmpB);
      const ax = tmpA.x - tmpB.x, ay = tmpA.y - tmpB.y, az = tmpA.z - tmpB.z;
      const wantY = Math.atan2(ax, az) + ai.errY, wantP = Math.atan2(ay, Math.hypot(ax, az)) + ai.errP;
      u.aimYaw = S.turnTo(u.aimYaw, wantY, 7 * dt); u.aimPitch = S.turnTo(u.aimPitch, wantP, 5 * dt);
      u.yaw = u.aimYaw;
      // strafe while fighting; keep pushing onto the objective
      const sx = -tz / d * ai.strafe, sz = tx / d * ai.strafe;
      const push = dg > 10 ? 0.75 : 0;
      const keep = (u.type === 'sniper' && d < 120) ? -0.5 : (d > W.range * 0.7 ? 0.8 : 0);
      wx = sx * 0.55 + (dg > 0.1 ? gx / dg * push : 0) + tx / d * keep; wz = sz * 0.55 + (dg > 0.1 ? gz / dg * push : 0) + tz / d * keep;
      const l = Math.hypot(wx, wz); if (l > 1) { wx /= l; wz /= l; }
      speed *= 0.8;
      // bursts
      if (ai.pauseT > 0) ai.pauseT -= dt;
      else {
        if (ai.burstT <= 0) ai.burstT = 0.5 + w.rng.next() * 0.9;
        const al = Math.abs(S.angDiff(wantY, u.aimYaw)) + Math.abs(wantP - u.aimPitch);
        if (al < 0.07 && d < W.range) { S.firePrimary(w, u, S.dirOf(u.aimYaw, u.aimPitch, tmpA), 0); }
        ai.burstT -= dt; if (ai.burstT <= 0 || u.hot) ai.pauseT = 0.5 + w.rng.next() * 0.9;
      }
      if (u.altT <= 0) {
        const alt = u.def.alt;
        if (alt === 'grenade' && tg.kind !== 'fighter' && d > 10 && d < 34 && w.rng.next() < 0.03) S.fireAlt(w, u, S.dirOf(u.aimYaw, Math.min(0.9, u.aimPitch + 0.28 + d * 0.006), tmpA), 0);
        else if (alt === 'rocket' && tg.kind !== 'infantry' && d < E.WEAPONS.rocket.range && w.rng.next() < 0.08) S.fireAlt(w, u, S.dirOf(u.aimYaw, u.aimPitch + 0.03, tmpA), tg.id);
      }
    } else if (dg > gp.r) {
      wx = gx / dg; wz = gz / dg;
      if (dg > 30) speed = u.def.sprint * u.spM;
      u.yaw = S.turnTo(u.yaw, Math.atan2(wx, wz), 6 * dt); u.aimYaw = u.yaw; u.aimPitch *= 0.9;
    }
    if (u.def.alt === 'medburst' && u.altT <= 0 && (w.tickN + u.id) % 20 === 0) {
      for (const a of w.units) if (a.alive && a.team === u.team && a.kind === 'infantry' && a.hp < a.maxHp * 0.6 && V.distance2(a.pos, u.pos) < 160) { S.fireAlt(w, u, tmpA, 0); break; }
    }
    stepInfantry(w, u, dt, wx, wz, speed, false);
  }

  // ── AI: vehicles + turrets ───────────────────────────────────
  function aimTurret(w, u, tg, dt, rate) {
    const W = E.WEAPONS[u.def.weapon];
    S.leadPoint(u, tg, W, tmpA); S.eyeOf(u, tmpB);
    const ax = tmpA.x - tmpB.x, ay = tmpA.y - tmpB.y, az = tmpA.z - tmpB.z;
    const wantY = Math.atan2(ax, az) + u.ai.errY, wantP = Math.atan2(ay, Math.hypot(ax, az)) + u.ai.errP;
    u.aimYaw = S.turnTo(u.aimYaw, wantY, rate * dt); u.aimPitch = S.turnTo(u.aimPitch, E.clamp(wantP, -0.35, 1.1), rate * dt);
    return Math.abs(S.angDiff(wantY, u.aimYaw)) + Math.abs(wantP - u.aimPitch);
  }
  function aiVehicle(w, u, dt) {
    const ai = u.ai, W = E.WEAPONS[u.def.weapon];
    S.think(w, u, dt);
    const tg = S.target(w, u), gp = S.goalPos(w, u, tmpC);
    let gx = gp.x - u.pos.x, gz = gp.z - u.pos.z; const dg = Math.hypot(gx, gz);
    let throttle = dg > 14 ? 1 : 0, des = dg > 1 ? Math.atan2(gx, gz) : u.yaw;
    if (tg) {
      const tx = tg.pos.x - u.pos.x, tz = tg.pos.z - u.pos.z, d = Math.hypot(tx, tz);
      const al = aimTurret(w, u, tg, dt, 2.6);
      if (al < 0.06 && d < W.range) S.firePrimary(w, u, S.dirOf(u.aimYaw, u.aimPitch, tmpA), 0);
      if (u.def.alt === 'coax' && tg.kind === 'infantry' && d < E.WEAPONS.coax.range && al < 0.12) S.fireAlt(w, u, S.dirOf(u.aimYaw, u.aimPitch, tmpA), 0);
      if (d < W.range * 0.7) {
        if (u.type === 'tank') { throttle = dg > 40 ? 0.35 : 0; }
        else { des = Math.atan2(tx, tz) + ai.strafe * 1.35; throttle = 0.8; }
      }
    } else { u.aimYaw = S.turnTo(u.aimYaw, u.yaw, 1.5 * dt); u.aimPitch *= 0.95; }
    const dy = S.angDiff(des, u.yaw);
    if (Math.abs(dy) > 1.1) throttle *= 0.3;
    stepVehicle(w, u, dt, throttle, E.clamp(dy * 2.2, -1, 1));
  }
  function aiTurret(w, u, dt) {
    S.think(w, u, dt);
    const tg = S.target(w, u);
    if (tg) { if (aimTurret(w, u, tg, dt, u.def.turn) < 0.07) S.firePrimary(w, u, S.dirOf(u.aimYaw, u.aimPitch, tmpA), 0); }
    u.yaw = u.aimYaw;
  }

  // ── player control ───────────────────────────────────────────
  function playerInfantry(w, u, p, dt) {
    const inp = p.input, mx = E.clamp(inp.mx || 0, -1, 1), mz = E.clamp(inp.mz || 0, -1, 1);
    const my = inp.moveYaw, fx = Math.sin(my), fz = Math.cos(my);
    let wx = fx * mz - fz * mx, wz = fz * mz + fx * mx; const l = Math.hypot(wx, wz);
    if (l > 1) { wx /= l; wz /= l; }
    u.yaw = inp.yaw; u.aimYaw = inp.yaw; u.aimPitch = inp.pitch;
    const sprint = inp.sprint && mz > 0 && !inp.fire;
    stepInfantry(w, u, dt, wx, wz, sprint ? u.def.sprint * u.spM : u.speed, inp.jump);
    S.dirOf(inp.yaw, inp.pitch, tmpA);
    if (inp.fire && !sprint) S.firePrimary(w, u, tmpA, 0);
    if (inp.abil) {
      if (u.def.alt === 'grenade') S.dirOf(inp.yaw, Math.min(1.2, inp.pitch + 0.16), tmpA);
      const lk = u.def.alt === 'rocket' ? S.aimTarget(w, u, S.eyeOf(u, tmpB), tmpA, 0.12, 500, S.lockable) : null;
      S.fireAlt(w, u, tmpA, lk ? lk.id : 0);
    }
  }
  function playerVehicle(w, u, p, dt) {
    const inp = p.input, mx = E.clamp(inp.mx || 0, -1, 1), mz = E.clamp(inp.mz || 0, -1, 1);
    stepVehicle(w, u, dt, mz, -mx);
    u.aimYaw = S.turnTo(u.aimYaw, inp.yaw, 3.2 * dt); u.aimPitch = S.turnTo(u.aimPitch, E.clamp(inp.pitch, -0.3, 1.0), 3.2 * dt);
    S.dirOf(u.aimYaw, u.aimPitch, tmpA);
    if (inp.fire) S.firePrimary(w, u, tmpA, 0);
    if (inp.abil) S.fireAlt(w, u, tmpA, 0);
  }
  function playerTurret(w, u, p, dt) {
    const inp = p.input;
    u.aimYaw = S.turnTo(u.aimYaw, inp.yaw, 3 * dt); u.aimPitch = S.turnTo(u.aimPitch, E.clamp(inp.pitch, -0.3, 1.2), 3 * dt); u.yaw = u.aimYaw;
    if (inp.fire) S.firePrimary(w, u, S.dirOf(u.aimYaw, u.aimPitch, tmpA), 0);
  }

  const C = S.ctl = S.ctl || {};
  C.infantry = { ai: aiInfantry, player: playerInfantry };
  C.vehicle = { ai: aiVehicle, player: playerVehicle };
  C.turret = { ai: aiTurret, player: playerTurret };

  Object.assign(S, { stepInfantry, stepVehicle, aiInfantry, aimTurret, aiVehicle, aiTurret, playerInfantry, playerVehicle, playerTurret });
})(window.E = window.E || {});
