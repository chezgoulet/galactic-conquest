// SPACE: capital ships — hull movement, gun batteries, fleet AI, player command
// of a capital, and the orbital strikes a fleet drops on the surface.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  const tmpA = V.make(), tmpB = V.make(), tmpC = V.make(), tmpD = V.make();
  const CAP_ALT = 640, ORBIT_R = 700;

  function buildGuns(u) {
    const d = u.def, L = d.len, g = [];
    for (let i = 0; i < d.main; i++) g.push({ wk: 'turbo', t: 1 + i * 0.7, lx: 0, ly: d.h * 0.55, lz: E.lerp(-0.12, 0.34, d.main > 1 ? i / (d.main - 1) : 0.5) * L, slot: 'main' });
    for (let s = -1; s <= 1; s += 2) for (let i = 0; i < d.side; i++)
      g.push({ wk: 'broadside', t: 0.5 + i * 0.3, lx: s * d.r * 0.36, ly: 0, lz: E.lerp(-0.3, 0.3, d.side > 1 ? i / (d.side - 1) : 0.5) * L, slot: 'side', s });
    for (let i = 0; i < d.pd; i++) g.push({ wk: 'flak', t: i * 0.1, lx: (i % 2 ? 1 : -1) * d.r * 0.3, ly: (i % 3 - 1) * d.h * 0.4, lz: E.lerp(-0.4, 0.4, i / Math.max(1, d.pd - 1)) * L, slot: 'pd' });
    g.push({ wk: 'torpedo', t: 5, lx: 0, ly: -d.h * 0.3, lz: L * 0.4, slot: 'torp' });
    u.guns = g;
  }

  function stepCapital(w, u, dt, turn, throttle) {
    const d = u.def;
    u.spd += (throttle * u.speed - u.spd) * Math.min(1, dt * 0.4);
    u.yaw += turn * d.turn * dt;
    u.roll += (turn * 0.12 - u.roll) * Math.min(1, dt * 0.5);
    u.vel.x = Math.sin(u.yaw) * u.spd; u.vel.z = Math.cos(u.yaw) * u.spd;
    u.pos.x += u.vel.x * dt; u.pos.z += u.vel.z * dt;
    const ty = (u.alt || CAP_ALT) + Math.sin(w.t * 0.13 + u.id) * 8;
    u.pos.y += (ty - u.pos.y) * Math.min(1, dt * 0.3);
    const B = w.layout.bound * 0.8, hd = Math.hypot(u.pos.x, u.pos.z);
    if (hd > B) { u.pos.x *= B / hd; u.pos.z *= B / hd; }
  }

  // ── capital ships ────────────────────────────────────────────
  function gunPos(u, g, o) {
    const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw);
    o.x = u.pos.x + fx * g.lz - fz * g.lx; o.y = u.pos.y + g.ly; o.z = u.pos.z + fz * g.lz + fx * g.lx;
    return o;
  }
  function capitalGuns(w, u, dt, focus, boost) {
    const dm = E.DOCTRINE[u.team].capDmg;
    let ecap = null, ed = 1e12, efi = null, fd = 1e12;
    for (const e of w.units) {
      if (!e.alive || e.team === u.team) continue;
      const d2 = V.distance2(e.pos, u.pos);
      if (e.kind === 'capital' && d2 < ed) { ed = d2; ecap = e; }
      if (e.kind === 'fighter' && d2 < fd) { fd = d2; efi = e; }
    }
    for (const g of u.guns) {
      g.t -= dt * (boost && g.slot === 'main' ? 1.6 : 1);
      if (g.t > 0) continue;
      const W = E.WEAPONS[g.wk];
      let tg = null;
      if (g.slot === 'pd') tg = efi && fd < W.range * W.range ? efi : null;
      else tg = focus || ecap;
      if (!tg) { g.t = 0.25; continue; }
      gunPos(u, g, tmpA);
      if (V.distance(tmpA, tg.pos) > W.range) { g.t = 0.4; continue; }
      if (g.slot === 'side') { // only the flank facing the target bears
        const side = (tg.pos.x - u.pos.x) * -Math.cos(u.yaw) + (tg.pos.z - u.pos.z) * Math.sin(u.yaw);
        if (side * g.s < 0) { g.t = 0.3; continue; }
      }
      g.t = (W.cd || 1 / W.rate) * (0.85 + w.rng.next() * 0.3);
      S.leadPoint(u, tg, W, tmpB);
      if (tg.kind === 'capital') { // rake the hull, not just the center
        const k = (w.rng.next() - 0.5) * tg.def.len * 0.6; tmpB.x += Math.sin(tg.yaw) * k; tmpB.z += Math.cos(tg.yaw) * k; tmpB.y += (w.rng.next() - 0.5) * tg.h * 0.6;
      }
      const dir = V.normalize(V.sub(tmpB, tmpA, tmpC));
      S.shoot(w, u, g.wk, tmpA, dir, g.slot === 'torp' ? tg.id : 0, dm);
    }
  }
  function aiCapital(w, u, dt) {
    // hold a slow orbit over the battlefield, broadside to the enemy line
    const a = Math.atan2(u.pos.z, u.pos.x) + 0.45, R = u.orbitR || ORBIT_R;
    const des = Math.atan2(Math.cos(a) * R - u.pos.x, Math.sin(a) * R - u.pos.z);
    stepCapital(w, u, dt, E.clamp(S.angDiff(des, u.yaw) * 3, -1, 1), 1);
    capitalGuns(w, u, dt, null, false);
  }

  // ── orbital strikes ──────────────────────────────────────────
  function strike(w, team, pos, pid) {
    w.strikes.push({ team, pos: { x: pos.x, y: w.terrain.height(pos.x, pos.z), z: pos.z }, t: 3.2, shots: E.WEAPONS.orbital.shots, iv: 0, pid: pid || null });
    w.events.push({ type: 'strikeWarn', pos: V.clone(pos), team, r: E.WEAPONS.orbital.splash });
  }
  function updateStrikes(w, dt) {
    for (let i = w.strikes.length - 1; i >= 0; i--) {
      const s = w.strikes[i];
      s.t -= dt; if (s.t > 0) continue;
      s.iv -= dt;
      if (s.iv <= 0 && s.shots > 0) {
        s.iv = 0.32; s.shots--;
        const cap = w.units.find(u => u.alive && u.kind === 'capital' && u.team === s.team);
        const o = cap ? { x: cap.pos.x, y: cap.pos.y - cap.h, z: cap.pos.z } : { x: s.pos.x + (s.team === 'aegis' ? -500 : 500), y: s.pos.y + 1100, z: s.pos.z };
        const a = w.rng.angle(), r = w.rng.f(0, 15);
        const tx = s.pos.x + Math.cos(a) * r - o.x, ty = s.pos.y - o.y, tz = s.pos.z + Math.sin(a) * r - o.z, l = Math.hypot(tx, ty, tz);
        const W = E.WEAPONS.orbital, speed = 520;
        const p = { id: w.nextProj++, wk: 'orbital', kind: 'turbo', pos: V.clone(o), vel: { x: tx / l * speed, y: ty / l * speed, z: tz / l * speed },
          team: s.team, uid: cap ? cap.id : 0, owner: s.pid, dmg: W.dmg, life: l / speed + 1, splash: W.splash, grav: 0, seek: 0, tid: 0, r: 1, scale: 5 };
        w.projectiles.push(p);
        w.events.push({ type: 'fire', pid: p.id, wk: 'orbital', pos: V.clone(p.pos), vel: V.clone(p.vel), team: s.team, uid: p.uid, life: p.life });
      }
      if (s.shots <= 0) w.strikes.splice(i, 1);
    }
  }

  // ── player control ───────────────────────────────────────────
  function playerCapital(w, u, p, dt) {
    const inp = p.input, mx = E.clamp(inp.mx || 0, -1, 1), mz = E.clamp(inp.mz || 0, -1, 1);
    stepCapital(w, u, dt, -mx, 0.35 + Math.max(0, mz) * 0.65 - Math.max(0, -mz) * 0.35);
    S.dirOf(inp.yaw, inp.pitch, tmpD);
    let focus = null;
    if (inp.fire) focus = S.aimTarget(w, u, u.pos, tmpD, 0.22, 2400, null);
    capitalGuns(w, u, dt, focus, !!focus);
    const T = w.teams[u.team];
    if (inp.abil && T.strikeT <= 0) {
      const o = { x: u.pos.x, y: u.pos.y - u.h, z: u.pos.z }, t = w.terrain.raycast(o, tmpD, 4000);
      if (t > 0) { strike(w, u.team, { x: o.x + tmpD.x * t, y: 0, z: o.z + tmpD.z * t }, p.id); T.strikeT = E.WEAPONS.orbital.cd * (T.bonus.orbital ? 0.6 : 1); }
    }
  }

  const C = S.ctl = S.ctl || {};
  C.capital = { ai: aiCapital, player: playerCapital };

  Object.assign(S, { buildGuns, stepCapital, gunPos, capitalGuns, aiCapital, strike, updateStrikes, playerCapital, CAP_ALT, ORBIT_R });
})(window.E = window.E || {});
