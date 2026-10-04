// LAND: movement and control for infantry, ground vehicles and emplacements,
// suppression, weapon handling, and the hooks that give vehicles weight.
// Bot behaviour lives in land_ai.js, cover in land_cover.js, structures and
// objectives in land_struct.js, perks and loadouts in land_perks.js.
//
// Infantry state (all on the unit):
//   stance 0 stand / 1 crouch / 2 slide     supp 0..1 suppression       stam 0..1 sprint stamina
//   sprinting bool                          bloom radians of aim spread  vault 0..1 progress (0 = not vaulting)
//   vaultKind 'vault'|'mantle'              tool 0 gun / 1 repair torch / 2 charge (engineer)
// Vehicle state: crip 0 ok / 1 mobility kill / 2 burning, lastZone 'front'|'side'|'rear'|'top'|'belly',
//   aimLimited (turret cannot reach the aim point), spd forward speed, pitch/roll hull tilt.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  const tmpA = V.make(), tmpB = V.make(), tmpC = V.make(), tmpD = V.make();
  const GRAV = 22;
  const STANCE_H = [1, 0.66, 0.45], STANCE_SPD = [1, 0.5, 1];
  // neutral modifier sheet (land_perks.js builds the real one per unit)
  const M0 = { hp: 1, speed: 1, sprint: 1, dmg: 1, bloom: 1, suppTake: 1, suppGive: 1, heal: 1, repair: 1, gCd: 1, gBlast: 1, rCd: 1, rDmg: 1, seek: 1, vsAir: 1, cover: 1, mines: 4,
               mineDmg: 1, aura: 1, auraRes: 0, regen: 0, stealth: 0, heat: 1, rate: 1, vault: 1, dr: 0, coverDmg: 1, buildCd: 1, chargeDmg: 1, fuse: 1 };
  const OUT = { c: null, nx: 0, nz: 0 };

  // ── suppression ──────────────────────────────────────────────
  function addSupp(w, e, a) {
    if (!(a > 0)) return;
    const m = e.m || M0, before = e.supp || 0;
    e.supp = Math.min(1, before + a * m.suppTake); e.suppT = w.t;
    if (e.pid) {
      const lv = e.supp > 0.7 ? 2 : e.supp > 0.35 ? 1 : 0, lb = before > 0.7 ? 2 : before > 0.35 ? 1 : 0;
      if (lv > lb) w.events.push({ type: 'suppress', uid: e.id, to: e.pid, level: lv, supp: e.supp });
    }
  }
  function nearMissInf(w, e, p) {
    const W = E.WEAPONS[p.wk] || {}, own = p.uid ? w.umap.get(p.uid) : null;
    let a = (0.012 + Math.min(p.dmg, 70) * 0.0009) * (W.supp || 1);
    if (own && own.m) a *= own.m.suppGive;
    addSupp(w, e, a);
  }

  // ── weapons (modifier aware) ─────────────────────────────────
  const rot = V.make();
  function bloomDir(w, u, dir) {
    const b = u.bloom || 0; if (b <= 0.0005 || u.kind !== 'infantry') return dir;
    // uniform point in a disc of angular radius b around dir (cheap, deterministic)
    const R = w.rng, a = R.next() * E.TAU, r = Math.sqrt(R.next()) * b;
    const rx = dir.z, rz = -dir.x, rl = Math.hypot(rx, rz) || 1;   // right
    rot.x = dir.x + (rx / rl) * Math.cos(a) * r + 0 ; rot.z = dir.z + (rz / rl) * Math.cos(a) * r;
    rot.y = dir.y + Math.sin(a) * r;
    const l = Math.hypot(rot.x, rot.y, rot.z) || 1; rot.x /= l; rot.y /= l; rot.z /= l;
    return rot;
  }
  function landFire(w, u, dir, tid) {
    const W = E.WEAPONS[u.def.weapon], m = u.m || M0;
    if (u.fireT > 0 || u.hot) return false;
    u.fireT += 1 / (W.rate * m.rate);
    if (W.heat) { u.heat += W.heat * m.heat; if (u.heat >= 1) { u.hot = true; if (u.pid) w.events.push({ type: 'overheat', uid: u.id, to: u.pid }); } }
    const d = bloomDir(w, u, dir);
    S.shoot(w, u, u.def.weapon, S.muzzle(u, d, tmpD), d, tid, m.dmg);
    return true;
  }
  function landAlt(w, u, dir, tid) {
    const wk = u.def.alt; if (!wk || u.altT > 0) return false;
    const W = E.WEAPONS[wk], m = u.m || M0;
    if (W.kind === 'heal') {
      u.altT = W.cd;
      const R2 = W.radius * W.radius, hv = W.heal * m.heal;
      for (const a of w.units) if (a.alive && a.team === u.team && a.kind === 'infantry' && V.distance2(a.pos, u.pos) < R2) a.hp = Math.min(a.maxHp, a.hp + hv);
      w.events.push({ type: 'heal', pos: V.clone(u.pos), team: u.team, r: W.radius });
      if (u.pid) S.score(w, u.pid, 25, 'HEAL');
      return true;
    }
    if (W.kind === 'mine') return !!S.layMine(w, u);
    u.altT = (W.cd || 1 / W.rate) * (wk === 'rocket' ? m.rCd : wk === 'grenade' ? m.gCd : 1);
    let mul = wk === 'rocket' ? m.rDmg : 1;
    const t = tid ? w.umap.get(tid) : null;
    if (t && t.kind === 'fighter') mul *= m.vsAir;
    const d = bloomDir(w, u, dir);
    const p = S.shoot(w, u, wk, S.muzzle(u, d, tmpD), d, tid, mul);
    if (wk === 'grenade') p.splash *= m.gBlast;
    if (wk === 'rocket' && m.seek !== 1) p.seek *= m.seek;
    return true;
  }
  // Seeker launch helper. Ground targets lock at once; aircraft need the AIR
  // lock-on (S.lockOn), which builds over time — so call this every tick the
  // target is tracked. Returns the target id once locked, else 0.
  function lockId(w, u, tg) {
    if (tg.kind !== 'fighter' || !S.lockOn) return tg.id;
    return S.lockOn(w, u, tg, 1 / 30) ? tg.id : 0;
  }

  // ── infantry movement ────────────────────────────────────────
  function canVault(c) { return (c.def.vault && c.h <= 1.4) ? 'vault' : (c.def.climb && c.h <= 2.1) ? 'mantle' : null; }
  function startVault(w, u, c, kind, nx, nz) {
    const T = w.terrain;
    let px = u.pos.x, pz = u.pos.z, ok = false;
    for (let i = 1; i <= 24; i++) {
      px = u.pos.x - nx * i * 0.3; pz = u.pos.z - nz * i * 0.3;
      if (!S.coverBlockedAt(w, px, pz, u.r, T.ground(px, pz))) { ok = true; break; }
    }
    if (!ok) return false;
    px -= nx * 0.35; pz -= nz * 0.35;
    const A = w.layout.arena;
    if (Math.abs(px) > A.x * 1.2 || Math.abs(pz) > A.z * 1.2 || T.height(px, pz) < T.waterLevel - 0.5) return false;
    const m = u.m || M0;
    u.vaultD = { x0: u.pos.x, z0: u.pos.z, x1: px, z1: pz, t: 0, dur: (kind === 'vault' ? 0.42 : 0.85) * m.vault * (1 + Math.hypot(px - u.pos.x, pz - u.pos.z) * 0.05), peak: c.h + 0.3 };
    u.vaultKind = kind; u.vault = 0.01; u.stance = 0;
    w.events.push({ type: 'vault', uid: u.id, kind, pos: { x: u.pos.x, y: u.pos.y, z: u.pos.z }, cid: c.id });
    return true;
  }
  function stepVault(w, u, dt) {
    const v = u.vaultD, T = w.terrain;
    v.t += dt; const k = Math.min(1, v.t / v.dur), e = k * k * (3 - 2 * k);
    const ox = u.pos.x, oz = u.pos.z;
    u.pos.x = v.x0 + (v.x1 - v.x0) * e; u.pos.z = v.z0 + (v.z1 - v.z0) * e;
    const g = T.ground(u.pos.x, u.pos.z);
    u.pos.y = g + Math.sin(k * Math.PI) * v.peak; u.vy = 0; u.onGround = false;
    u.vel.x = (u.pos.x - ox) / dt; u.vel.z = (u.pos.z - oz) / dt; u.vel.y = 0;
    u.vault = k;
    if (k >= 1) {
      u.vaultD = null; u.vault = 0; u.onGround = true; u.pos.y = g;
      const sp = Math.hypot(u.vel.x, u.vel.z) || 1, keep = Math.min(1, u.speed * 0.6 / sp);
      u.vel.x *= keep; u.vel.z *= keep; u.vaultCd = 0.35;
    }
  }
  // wx,wz: desired direction (len<=1). smul scales the walking (or sprint) speed.
  function stepInfantry(w, u, dt, wx, wz, smul, jump, crouch, sprint) {
    if (u.stance === undefined) S.initInfantry(w, u);
    if (u.vaultD) { stepVault(w, u, dt); u.h += (u.def.h * STANCE_H[0] - u.h) * Math.min(1, dt * 10); return; }
    const T = w.terrain, m = u.m || M0, d = u.def;
    const g = T.ground(u.pos.x, u.pos.z), wl = Math.hypot(wx, wz);
    u.vaultCd = Math.max(0, (u.vaultCd || 0) - dt); u.slideCd = Math.max(0, (u.slideCd || 0) - dt);
    const hv = Math.hypot(u.vel.x, u.vel.z);
    // stamina and sprint
    if (u.winded && u.stam > 0.3) u.winded = false;
    let spr = !!sprint && wl > 0.2 && !u.winded && u.stance !== 1;
    if (spr) { u.stam -= dt / 7; if (u.stam <= 0) { u.stam = 0; u.winded = true; spr = false; } }
    else u.stam = Math.min(1, u.stam + dt * (wl < 0.1 ? 0.28 : 0.14));
    u.sprinting = spr;
    // stance: crouch, slide
    if (u.stance === 2) {
      u.slideT -= dt;
      if (u.slideT <= 0 || !crouch || hv < 3) u.stance = crouch ? 1 : 0;
    } else if (crouch && sprint && u.onGround && hv > d.speed * u.spM * 0.85 && u.slideCd <= 0 && u.stam > 0.12) {
      u.stance = 2; u.slideT = 0.8; u.slideCd = 1.8; u.stam -= 0.1;
      const k = Math.max(hv, d.sprint * u.spM) * 1.08 / hv; u.vel.x *= k; u.vel.z *= k;
      w.events.push({ type: 'slide', uid: u.id, pos: { x: u.pos.x, y: u.pos.y, z: u.pos.z } });
    } else u.stance = crouch ? 1 : 0;
    const hT = d.h * STANCE_H[u.stance];
    u.h += (hT - u.h) * Math.min(1, dt * (u.stance === 2 ? 25 : 10));
    // desired velocity
    let speed = (spr ? d.sprint * m.sprint : d.speed) * u.spM * m.speed * smul;
    speed *= STANCE_SPD[u.stance] * (1 - 0.28 * (u.supp || 0));
    if (T.height(u.pos.x, u.pos.z) < T.waterLevel - 0.5) speed *= 0.62;
    if (wl > 0.01) {
      const grade = (T.ground(u.pos.x + wx * 1.6, u.pos.z + wz * 1.6) - g) / 1.6;
      if (grade > 0.15) speed *= E.clamp(1.12 - grade * 0.8, 0.3, 1);
    }
    let tvx = wx * speed, tvz = wz * speed;
    if (u.stance === 2) { // sliding: momentum carries, friction bleeds it, steering is weak
      const f = Math.max(0, u.slideT / 0.8), sp = Math.max(3, Math.hypot(u.vel.x, u.vel.z) * (1 - dt * 1.7)), vx = u.vel.x, vz = u.vel.z, vl = Math.hypot(vx, vz) || 1;
      tvx = vx / vl * sp * (0.6 + 0.4 * f); tvz = vz / vl * sp * (0.6 + 0.4 * f);
    }
    // accelerate toward it: snappy on the ground, little air control
    const acc = u.onGround ? (u.stance === 2 ? 14 : wl < 0.05 ? 62 : spr ? 30 : 44) : 5;
    let dvx = tvx - u.vel.x, dvz = tvz - u.vel.z; const dl = Math.hypot(dvx, dvz), lim = acc * dt;
    if (dl > lim) { dvx *= lim / dl; dvz *= lim / dl; }
    u.vel.x += dvx; u.vel.z += dvz;
    u.pos.x += u.vel.x * dt; u.pos.z += u.vel.z * dt;
    S.clampArena(w, u);
    // jump
    if (jump && u.onGround && u.stance !== 2) { u.vy = 7.6; u.onGround = false; u.stance = 0; }
    u.vy -= GRAV * dt; u.pos.y += u.vy * dt;
    // cover collision and auto vault / mantle
    const col = S.collideCover(w, u.pos, u.r, u.pos.y, 0, 0, OUT);
    if (col) {
      if (u.stance === 2) { u.stance = 1; u.slideT = 0; }
      if (wl > 0.2 && u.vaultCd <= 0 && !u.winded) {
        const into = (wx * -OUT.nx + wz * -OUT.nz) / wl;
        if (into > 0.45) {
          u.pushT = (u.pushT || 0) + dt;
          const kind = canVault(col);
          if (kind && (u.pushT > 0.08 || (jump && into > 0.2)) && startVault(w, u, col, kind, OUT.nx, OUT.nz)) { u.pushT = 0; return; }
        } else u.pushT = 0;
      }
    } else u.pushT = 0;
    const g2 = T.ground(u.pos.x, u.pos.z);
    if (u.pos.y <= g2 || (u.vy <= 0 && u.pos.y - g2 < 0.45 && u.onGround)) { u.pos.y = g2; u.vy = 0; u.onGround = true; }
    else if (u.pos.y - g2 > 0.45) u.onGround = false;
    u.vel.y = u.vy;
  }

  // sustain: suppression decay, bloom, perk regeneration (run for every infantry each tick)
  function infantryTick(w, u, dt) {
    const m = u.m || M0;
    if (u.supp > 0 && w.t - u.suppT > 0.7) {
      const was = u.supp;
      u.supp = Math.max(0, u.supp - dt * (u.stance === 1 ? 0.34 : 0.22));
      if (u.pid && was > 0.35 && u.supp <= 0.35) w.events.push({ type: 'suppress', uid: u.id, to: u.pid, level: 0, supp: u.supp });
    }
    // aim bloom: moving, airborne, suppressed, sliding; crouching steadies
    const hv = Math.hypot(u.vel.x, u.vel.z);
    let b = 0.004 + (hv / Math.max(1, u.speed)) * 0.012 + (u.onGround ? 0 : 0.03) + (u.supp || 0) * 0.05 + (u.stance === 2 ? 0.02 : 0);
    if (u.stance === 1 && hv < 1.5) b *= 0.4; else if (u.stance === 1) b *= 0.7;
    if (u.sprinting) b += 0.02;
    if (u.def.weapon === 'longrifle') b *= 0.5;
    b *= m.bloom;
    u.bloom += (b - u.bloom) * Math.min(1, dt * 8);
    if (m.regen && u.hp < u.maxHp && u.hitT > 3) u.hp = Math.min(u.maxHp, u.hp + m.regen * dt);
  }

  // ── vehicles ─────────────────────────────────────────────────
  const VOUT = { c: null, nx: 0, nz: 0 };
  function stepVehicle(w, u, dt, throttle, turn, brake) {
    const d = u.def, T = w.terrain;
    const crip = u.crip === 2 ? 0.35 : u.crip === 1 ? 0.5 : 1;
    const maxF = u.speed * crip;
    const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw), rx = Math.cos(u.yaw), rz = -Math.sin(u.yaw);
    let vf = u.vel.x * fx + u.vel.z * fz, vl = u.vel.x * rx + u.vel.z * rz;
    const sf = Math.min(1, Math.abs(vf) / (maxF * 0.35));
    const yr = turn * d.turn * (u.crip ? 0.55 : 1) * (0.3 + 0.7 * sf);
    u.yaw += yr * dt;
    const tgt = throttle >= 0 ? throttle * maxF : throttle * maxF * 0.45;
    const acc = ((tgt > 0 && vf >= 0 && tgt > vf) || (tgt < 0 && vf <= 0 && tgt < vf)) ? d.accel * (u.crip ? 0.6 : 1) : d.brake;
    const lim = acc * dt * (brake ? 2.2 : 1);
    const pvf = vf;
    vf += E.clamp((brake ? 0 : tgt) - vf, -lim, lim);
    const grade = (T.height(u.pos.x + fx * 5, u.pos.z + fz * 5) - T.height(u.pos.x - fx * 5, u.pos.z - fz * 5)) / 10;
    vf -= grade * 9.8 * dt * 0.8;
    vl *= Math.exp(-d.grip * dt * (brake ? 2.8 : 1));
    vl -= yr * vf * dt * 0.2;
    u.vel.x = fx * vf + rx * vl; u.vel.z = fz * vf + rz * vl;
    u.pos.x += u.vel.x * dt; u.pos.z += u.vel.z * dt;
    S.clampArena(w, u);
    // world geometry: crush light cover at speed, bounce off the rest
    const col = S.collideCover(w, u.pos, u.r * 0.85, u.pos.y - d.hover, 1, Math.abs(vf), VOUT);
    if (col) {
      const vn = u.vel.x * VOUT.nx + u.vel.z * VOUT.nz;
      if (vn < 0) {
        u.vel.x -= VOUT.nx * vn * 1.3; u.vel.z -= VOUT.nz * vn * 1.3;
        const imp = -vn;
        if (imp > 5 && w.t - (u.bumpT || -9) > 0.5) {
          u.bumpT = w.t;
          const dm = (imp - 5) * 14 * (d.mass || 1);
          S.coverDamage(w, col, dm * 3, null, 'ram');
          S.applyDamage(w, u, dm, { wk: 'ram', team: null, uid: 0, owner: null }, null);
          w.events.push({ type: 'bump', uid: u.id, speed: imp, pos: V.clone(u.pos) });
        }
      }
    }
    // hover: spring-damper ride height with a gentle bob that settles when stopped
    const ground = Math.max(T.height(u.pos.x, u.pos.z), T.waterLevel);
    const bob = Math.sin(w.t * 2.1 + u.id * 1.7) * 0.07 * (1 - 0.6 * sf) + sf * Math.sin(w.t * 17 + u.id) * 0.025;
    const ty = ground + d.hover + bob - 0.14 * (1 - sf) * (u.crip ? 2 : 1);
    u.vy = (u.vy || 0) + ((ty - u.pos.y) * 55 - (u.vy || 0) * 8.5) * dt;
    u.pos.y += u.vy * dt; u.vel.y = u.vy;
    if (u.pos.y < ground + 0.25) { u.pos.y = ground + 0.25; if (u.vy < 0) u.vy *= -0.2; }
    // tilt
    const ax = (vf - pvf) / dt;
    u.pitch += (-Math.atan(grade) * 0.9 - ax * 0.004 - u.pitch) * Math.min(1, dt * 5);
    u.roll += (-yr * sf * 0.1 - vl * 0.015 - u.roll) * Math.min(1, dt * 5);
    u.spd = vf;
  }
  // turret traverse with hull-relative limits; returns remaining aim error (large if the point is out of reach)
  function slew(w, u, wantYaw, wantPitch, dt, rateMul) {
    const tr = u.def.turret;
    if (!tr) { // emplacements: free traverse
      const r = (u.def.turn || 2) * dt * (rateMul || 1);
      u.aimYaw = S.turnTo(u.aimYaw, wantYaw, r);
      const pMax = u.def.pitchMax || 1.1;
      u.aimPitch = S.turnTo(u.aimPitch, E.clamp(wantPitch, -0.35, pMax), r);
      return Math.abs(S.angDiff(wantYaw, u.aimYaw)) + Math.abs(wantPitch - u.aimPitch);
    }
    const rate = tr.rate * dt * (rateMul || 1) * (u.crip ? 0.5 : 1);
    let rel = S.angDiff(u.aimYaw, u.yaw), want = S.angDiff(wantYaw, u.yaw);
    const arc = tr.arc;
    u.aimLimited = false;
    if (arc < Math.PI) { rel = E.clamp(rel, -arc, arc); if (Math.abs(want) > arc) { want = E.clamp(want, -arc, arc); u.aimLimited = true; } }
    rel += E.clamp(S.angDiff(want, rel), -rate, rate);
    u.aimYaw = u.yaw + rel;
    u.aimPitch += E.clamp(E.clamp(wantPitch, tr.pitchMin, tr.pitchMax) - u.aimPitch, -rate, rate);
    return Math.abs(S.angDiff(wantYaw, u.aimYaw)) + Math.abs(wantPitch - u.aimPitch);
  }
  // aim a vehicle/emplacement at a unit (with lead); returns the aim error
  function aimTurret(w, u, tg, dt, rate) {
    const W = E.WEAPONS[u.def.weapon];
    S.leadPoint(u, tg, W, tmpA); S.eyeOf(u, tmpB);
    const ax = tmpA.x - tmpB.x, ay = tmpA.y - tmpB.y, az = tmpA.z - tmpB.z;
    const wantY = Math.atan2(ax, az) + u.ai.errY, wantP = Math.atan2(ay, Math.hypot(ax, az)) + u.ai.errP;
    return slew(w, u, wantY, wantP, dt, u.def.turret ? 1 : (rate / Math.max(0.1, u.def.turn || 2)));
  }

  // ── player control ───────────────────────────────────────────
  function playerInfantry(w, u, p, dt) {
    if (u.stance === undefined) S.initInfantry(w, u);
    const inp = p.input, mx = E.clamp(inp.mx || 0, -1, 1), mz = E.clamp(inp.mz || 0, -1, 1);
    const my = inp.moveYaw, fx = Math.sin(my), fz = Math.cos(my);
    let wx = fx * mz - fz * mx, wz = fz * mz + fx * mx; const l = Math.hypot(wx, wz);
    if (l > 1) { wx /= l; wz /= l; }
    u.yaw = inp.yaw; u.aimYaw = inp.yaw; u.aimPitch = inp.pitch;
    const sprint = inp.sprint && mz > 0 && !inp.fire;
    stepInfantry(w, u, dt, wx, wz, 1, inp.jump, !!inp.crouch, sprint);
    infantryTick(w, u, dt);
    if (u.vaultD) return;
    // engineer tools: cycle selects, abil2 raises a barricade
    if (inp.cycle && !u.cycP && u.type === 'engineer') { u.tool = (u.tool + 1) % 3; w.events.push({ type: 'tool', uid: u.id, to: u.pid, tool: u.tool }); }
    u.cycP = !!inp.cycle;
    if (inp.abil2 && !u.abil2P && u.type === 'engineer') S.engBuild(w, u);
    u.abil2P = !!inp.abil2;
    S.dirOf(inp.yaw, inp.pitch, tmpA);
    if (inp.fire && !u.sprinting) {
      if (u.type === 'engineer' && u.tool > 0) S.engTool(w, u, tmpA, dt);
      else landFire(w, u, tmpA, 0);
    }
    if (inp.abil) {
      if (u.def.alt === 'grenade') S.dirOf(inp.yaw, Math.min(1.2, inp.pitch + 0.16), tmpA);
      let lk = 0;
      if (u.def.alt === 'rocket') { const t = S.aimTarget(w, u, S.eyeOf(u, tmpB), tmpA, 0.12, 500, S.lockable); lk = t ? lockId(w, u, t) : 0; }
      landAlt(w, u, tmpA, lk);
    }
  }
  function playerVehicle(w, u, p, dt) {
    const inp = p.input, mx = E.clamp(inp.mx || 0, -1, 1), mz = E.clamp(inp.mz || 0, -1, 1);
    stepVehicle(w, u, dt, mz, -mx, !!inp.crouch);
    slew(w, u, inp.yaw, inp.pitch, dt, 1);
    S.dirOf(u.aimYaw, u.aimPitch, tmpA);
    if (inp.fire && !u.aimLimited) landFire(w, u, tmpA, 0);
    if (inp.abil) {
      let lk = 0;
      if (u.def.alt === 'aamissile') { const t = S.aimTarget(w, u, S.eyeOf(u, tmpB), tmpA, 0.14, 1200, (e) => e.kind === 'fighter'); lk = t ? lockId(w, u, t) : 0; if (!lk) return; }   // hold to build the lock; it fires when it has one
      landAlt(w, u, tmpA, lk);
    }
  }
  function playerTurret(w, u, p, dt) {
    const inp = p.input;
    slew(w, u, inp.yaw, inp.pitch, dt, 1); u.yaw = u.aimYaw;
    S.dirOf(u.aimYaw, u.aimPitch, tmpA);
    if (u.def.structure) { if (inp.fire) S.structureFire(w, u); return; }
    if (inp.fire) landFire(w, u, tmpA, 0);
    if (inp.abil && u.def.alt) {
      let lk = 0;
      if (u.def.aa) { const t = S.aimTarget(w, u, S.eyeOf(u, tmpB), tmpA, 0.14, 1200, (e) => e.kind === 'fighter'); lk = t ? lockId(w, u, t) : 0; if (!lk) return; }
      landAlt(w, u, tmpA, lk);
    }
  }

  // ── hooks: damage, death ─────────────────────────────────────
  function infDamage(w, e, d, src, at, head) {
    const m = e.m || M0;
    d *= (1 - Math.min(0.6, m.dr + (e.auraRes || 0)));
    if (src.uid) { e.lastAtt = src.uid; e.lastAttT = w.t; }
    addSupp(w, e, 0.05 + d / e.maxHp * 0.7);
    return d;
  }
  const SIDE_FWD = { x: 0, z: 0 };
  function vehDamage(w, e, d, src, at, head) {
    const F = e.def.armorF; if (!F) return d;
    let zone = 'side';
    if (src.vel) {
      const vx = src.vel.x, vy = src.vel.y, vz = src.vel.z, sp = Math.hypot(vx, vy, vz) || 1, hxz = Math.hypot(vx, vz) || 1;
      if (vy / sp < -0.62) zone = 'top';
      else {
        const cosA = -(vx * Math.sin(e.yaw) + vz * Math.cos(e.yaw)) / hxz;   // +1: the shot comes from dead ahead
        zone = cosA > 0.55 ? 'front' : cosA < -0.45 ? 'rear' : 'side';
      }
    } else if (src.wk === 'mine') zone = 'belly';
    const mul = zone === 'belly' ? 1.25 : F[zone];
    e.lastZone = zone;
    if (src.wk !== 'ram' && src.wk !== 'burn' && (e.pid || src.owner) && Math.abs(mul - 1) > 0.04) w.events.push({ type: 'armor', uid: e.id, zone, mul, to: e.pid, by: src.owner || null, pos: at ? V.clone(at) : V.clone(e.pos) });
    return d * mul;
  }
  function vehDeath(w, e, src) {
    const big = e.type === 'tank' ? 1 : 0.65;
    S.leaveWreck(w, e);
    S.blast(w, e.pos, 13 * big, 240 * big, e.team, e.id, 'wreck', e.pid);
    w.events.push({ type: 'wreck', uid: e.id, utype: e.type, pos: V.clone(e.pos), yaw: e.yaw });
  }
  // an explosion that hurts everyone nearby (friend and foe at reduced rate)
  function blast(w, pos, R, dmg, team, uid, wk, pid) {
    const src = { wk, team, uid, owner: null };
    for (const o of w.units) {
      if (!o.alive || o.kind === 'capital' || o.kind === 'fighter' || o.id === uid) continue;
      S.centerOf(o, tmpC);
      const dd = V.distance(tmpC, pos) - o.r;
      if (dd < R) applyBlast(w, o, dmg * E.clamp01(1 - Math.max(0, dd) / R) * (o.team === team ? 0.55 : 1), src, tmpC);
    }
    S.blastCover(w, pos.x, pos.y, pos.z, R, dmg * 0.6, 1);
    w.events.push({ type: 'blast', pos: V.clone(pos), r: R, wk, team });
  }
  function applyBlast(w, o, d, src, at) { if (d > 1) S.applyDamage(w, o, d, src, at); }

  // ── per-tick land systems ────────────────────────────────────
  function vehicleSystem(w, dt) {
    const U = w.units;
    for (let i = 0; i < U.length; i++) {
      const u = U[i]; if (!u.alive || u.kind !== 'vehicle') continue;
      // mobility kill / burning
      const f = u.hp / u.maxHp, lv = f < 0.15 ? 2 : f < 0.36 ? 1 : 0;
      if (lv !== (u.crip || 0)) {
        w.events.push({ type: lv > (u.crip || 0) ? 'cripple' : 'recover', uid: u.id, utype: u.type, level: lv, pos: V.clone(u.pos), team: u.team });
        u.crip = lv;
      }
      if (u.crip === 2) { u.hp -= 3.2 * dt; if (u.hp <= 0) { S.kill(w, u, { wk: 'burn', team: null, uid: 0, owner: null }); continue; } }
      // ramming
      const spd = Math.hypot(u.vel.x, u.vel.z);
      if (spd > 6 && (w.tickN + u.id) % 2 === 0) {
        for (let j = 0; j < U.length; j++) {
          const o = U[j]; if (o === u || !o.alive || o.team === u.team) continue;
          if (o.kind !== 'infantry' && o.kind !== 'vehicle') continue;
          const dx = o.pos.x - u.pos.x, dz = o.pos.z - u.pos.z, rr = u.r * 0.9 + o.r;
          if (dx * dx + dz * dz > rr * rr || Math.abs(o.pos.y - u.pos.y) > 4) continue;
          if (w.t - (o.ramT || -9) < 0.7) continue;
          const dl = Math.hypot(dx, dz) || 1, nx = dx / dl, nz = dz / dl;
          const closing = u.vel.x * nx + u.vel.z * nz - (o.vel.x * nx + o.vel.z * nz);
          if (closing < 4) continue;
          o.ramT = w.t; u.ramT = w.t;
          const src = { wk: 'ram', team: u.team, uid: u.id, owner: u.pid || null };
          if (o.kind === 'infantry') {
            S.applyDamage(w, o, 40 + closing * 9 * (u.def.mass || 1), src, o.pos);
            o.vel.x += nx * closing * 0.8; o.vel.z += nz * closing * 0.8; o.vy = 4; o.onGround = false;
          } else {
            const mu = u.def.mass || 1, mo = o.def.mass || 1;
            S.applyDamage(w, o, closing * 30 * mu / (mu + mo) * 1.6, src, o.pos);
            S.applyDamage(w, u, closing * 30 * mo / (mu + mo) * 1.6, { wk: 'ram', team: o.team, uid: o.id, owner: o.pid || null }, u.pos);
            const k = closing * (mu / (mu + mo)) * 0.6; o.vel.x += nx * k; o.vel.z += nz * k; u.vel.x -= nx * closing * (mo / (mu + mo)) * 0.5; u.vel.z -= nz * closing * (mo / (mu + mo)) * 0.5;
          }
          w.events.push({ type: 'ram', uid: u.id, tid: o.id, closing, pos: V.clone(o.pos) });
          if (w.landStats) w.landStats.rams++;
        }
      }
    }
  }

  // ── registration ─────────────────────────────────────────────
  const C = S.ctl = S.ctl || {};
  C.infantry = { ai: (w, u, dt) => S.aiInfantry(w, u, dt), player: playerInfantry, damage: infDamage, nearMiss: nearMissInf };
  C.vehicle = { ai: (w, u, dt) => S.aiVehicle(w, u, dt), player: playerVehicle, damage: vehDamage, death: vehDeath };
  C.turret = { ai: (w, u, dt) => S.aiTurret(w, u, dt), player: playerTurret, death: (w, e, src) => S.structureDeath(w, e, src) };
  S.systems.push(vehicleSystem);

  // ── net ──────────────────────────────────────────────────────
  const R2 = (x) => Math.round(x * 100) / 100;
  S.net.unit.infantry = {
    pack: (u) => [u.stance || 0, Math.round((u.supp || 0) * 100), Math.round((u.stam === undefined ? 1 : u.stam) * 100), Math.round((u.vault || 0) * 100), u.tool || 0, R2(u.h), u.sprinting ? 1 : 0, R2(u.bloom || 0), u.aimPitch ? R2(u.aimPitch) : 0],
    apply(u, a) { u.stance = a[0]; u.supp = a[1] / 100; u.stam = a[2] / 100; u.vault = a[3] / 100; u.tool = a[4]; u.h = a[5]; u.sprinting = !!a[6]; u.bloom = a[7]; u.aimPitch = a[8]; u.aimYaw = u.yaw; },
  };
  S.net.unit.vehicle = {
    pack: (u) => [u.crip || 0, R2(u.aimYaw), R2(u.aimPitch), u.aimLimited ? 1 : 0, u.lastZone || ''],
    apply(u, a) { u.crip = a[0]; u.aimYaw = a[1]; u.aimPitch = a[2]; u.aimLimited = !!a[3]; u.lastZone = a[4]; },
  };
  S.net.unit.turret = {
    pack: (u) => [R2(u.aimPitch), u.active === false ? 0 : 1, Math.round((u.cd || 0) * 10) / 10, u.charging ? 1 : 0],
    apply(u, a) { u.aimPitch = a[0]; u.active = !!a[1]; u.cd = a[2]; u.charging = !!a[3]; u.aimYaw = u.yaw; },
  };

  Object.assign(S, { stepInfantry, stepVehicle, slew, aimTurret, playerInfantry, playerVehicle, playerTurret, addSupp, landFire, landAlt, lockId, infantryTick, blast, M0, canVault,
    // kept for callers of the previous API
    playerTurretCtl: playerTurret });
})(window.E = window.E || {});
