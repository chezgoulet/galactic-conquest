// The simulation rules: movement, AI, weapons, damage, command posts,
// reinforcements and win conditions. Pure and deterministic — draws only from
// world.rng, reads/writes world state, and emits world.events (drained by the
// renderer / audio / HUD / netcode). The World owns the state; this owns the rules.
//
// Conventions: y is up; yaw 0 faces +z and forward = (sin yaw, 0, cos yaw);
// "right" (screen-right when looking forward) = (-cos yaw, 0, sin yaw).
(function (E) {
  'use strict';
  const V = E.V3;
  const GRAV = 22, RESPAWN = 4, CAP_ALT = 640, ORBIT_R = 700;
  const DEATH_COST = { infantry: 1, vehicle: 3, fighter: 1, turret: 0, capital: 25 };
  const KILL_SCORE = { infantry: 100, vehicle: 300, fighter: 250, turret: 150, capital: 2500 };
  const PREF = {
    trooper: { infantry: 1, vehicle: 0.22, turret: 0.2 },
    sniper:  { infantry: 1, vehicle: 0.1, turret: 0.15 },
    medic:   { infantry: 1, vehicle: 0.15, turret: 0.15 },
    heavy:   { infantry: 0.8, vehicle: 1.7, turret: 1.2, fighter: 0.35 },
    skiff:   { infantry: 1, vehicle: 0.7, turret: 0.5, fighter: 0.15 },
    tank:    { infantry: 0.9, vehicle: 1.6, turret: 1.3 },
    battery: { infantry: 1, vehicle: 1.2, fighter: 1.1 },
    interceptor: { fighter: 2.2, vehicle: 0.5, infantry: 0.2, turret: 0.35, capital: 0.3 },
    bomber:  { capital: 1.1, vehicle: 1.5, turret: 1.3, infantry: 0.45, fighter: 0.3 },
  };

  const tmpA = V.make(), tmpB = V.make(), tmpC = V.make(), tmpD = V.make(), tmpM = V.make();
  function dirOf(yaw, pitch, o) { const c = Math.cos(pitch); o = o || {}; o.x = Math.sin(yaw) * c; o.y = Math.sin(pitch); o.z = Math.cos(yaw) * c; return o; }
  function angDiff(a, b) { let d = (a - b) % E.TAU; if (d > Math.PI) d -= E.TAU; if (d < -Math.PI) d += E.TAU; return d; }
  function turnTo(cur, want, max) { const d = angDiff(want, cur); return cur + E.clamp(d, -max, max); }
  function isGroundKind(u) { return u.kind === 'infantry' || u.kind === 'vehicle' || u.kind === 'turret'; }
  function centerOf(u, o) { o = o || {}; o.x = u.pos.x; o.z = u.pos.z; o.y = u.pos.y + (isGroundKind(u) ? u.h * 0.55 : 0); return o; }
  function eyeOf(u, o) { o = o || {}; o.x = u.pos.x; o.z = u.pos.z; o.y = u.pos.y + (u.kind === 'infantry' ? u.h * 0.86 : isGroundKind(u) ? u.h * 0.8 : 0); return o; }
  function enemyOf(t) { return t === 'aegis' ? 'verdant' : 'aegis'; }
  function nameOf(w, u) { return u.pid && w.players[u.pid] ? w.players[u.pid].name : E.unitName(u.kind, u.type); }

  // ── setup ────────────────────────────────────────────────────
  function spawnUnit(w, kind, type, team, pos, extra) {
    const def = E.unitDef(kind, type), D = E.DOCTRINE[team], B = w.teams[team].bonus || {};
    let hpM = 1, spM = 1;
    if (kind === 'infantry') { hpM = D.infHp * (B.elite ? 1.2 : 1); spM = D.infSpeed; }
    else if (kind === 'vehicle') hpM = D.vehHp * (B.armor ? 1.15 : 1);
    else if (kind === 'fighter') { hpM = D.fighterHp; spM = D.fighterSpeed; }
    else if (kind === 'capital') hpM = D.capHp * (B.hull ? 1.25 : 1);
    const hp = Math.round(def.hp * hpM);
    const u = {
      id: w.nextId++, kind, type, team, def, armor: def.armor,
      pos: { x: pos.x, y: pos.y !== undefined ? pos.y : w.groundY(pos.x, pos.z), z: pos.z }, vel: { x: 0, y: 0, z: 0 },
      yaw: team === 'aegis' ? Math.PI / 2 : -Math.PI / 2, pitch: 0, roll: 0, aimYaw: 0, aimPitch: 0,
      hp, maxHp: hp, shield: Math.round((def.shield || 0) * (kind === 'capital' ? hpM : 1)), maxShield: 0, hitT: 99,
      alive: true, r: def.r, h: def.h, speed: def.speed * spM, spM, spd: 0, vy: 0, onGround: true,
      heat: 0, hot: false, fireT: 0, altT: 2, lastFire: -9, gunSide: 1,
      pid: null, kills: 0, order: null, bornT: w.t,
      ai: { thinkT: w.rng.next() * 0.5, tid: 0, los: false, goal: -1, goalT: 0, off: { x: 0, z: 0 }, offT: 0,
            strafe: w.rng.sign(), strafeT: 1, burstT: 0, pauseT: 0, errY: 0, errP: 0, state: '', stateT: 0, bYaw: 0, bPitch: 0 },
    };
    u.maxShield = u.shield; u.aimYaw = u.yaw;
    if (extra) Object.assign(u, extra);
    if (kind === 'capital') buildGuns(u);
    w.units.push(u); w.umap.set(u.id, u);
    w.events.push({ type: 'spawn', uid: u.id });
    return u;
  }

  function buildGuns(u) {
    const d = u.def, L = d.len, g = [];
    for (let i = 0; i < d.main; i++) g.push({ wk: 'turbo', t: 1 + i * 0.7, lx: 0, ly: d.h * 0.55, lz: E.lerp(-0.12, 0.34, d.main > 1 ? i / (d.main - 1) : 0.5) * L, slot: 'main' });
    for (let s = -1; s <= 1; s += 2) for (let i = 0; i < d.side; i++)
      g.push({ wk: 'broadside', t: 0.5 + i * 0.3, lx: s * d.r * 0.36, ly: 0, lz: E.lerp(-0.3, 0.3, d.side > 1 ? i / (d.side - 1) : 0.5) * L, slot: 'side', s });
    for (let i = 0; i < d.pd; i++) g.push({ wk: 'flak', t: i * 0.1, lx: (i % 2 ? 1 : -1) * d.r * 0.3, ly: (i % 3 - 1) * d.h * 0.4, lz: E.lerp(-0.4, 0.4, i / Math.max(1, d.pd - 1)) * L, slot: 'pd' });
    g.push({ wk: 'torpedo', t: 5, lx: 0, ly: -d.h * 0.3, lz: L * 0.4, slot: 'torp' });
    u.guns = g;
  }

  function ring(w, c, a, b) { const an = w.rng.angle(), d = w.rng.f(a, b); return { x: c.x + Math.cos(an) * d, z: c.z + Math.sin(an) * d }; }
  function pickClass(w) { return w.rng.pickW(E.FORCE.mix); }

  function setup(w) {
    for (const f of E.TEAMS) {
      const T = w.teams[f], home = w.cps.find(c => c.home === f), sgn = f === 'aegis' ? 1 : -1;
      for (let i = 0; i < T.infCap; i++) spawnUnit(w, 'infantry', pickClass(w), f, ring(w, home.pos, 6, home.r * 0.9));
      const vs = Object.assign({}, E.FORCE.vehicles); if (T.bonus.armor) vs.tank++;
      T.vehCap = vs;
      for (const [type, n] of Object.entries(vs)) for (let i = 0; i < n; i++) spawnUnit(w, 'vehicle', type, f, { x: home.pos.x - sgn * 20, z: home.pos.z + (i * 2 - 1) * 16 + (type === 'tank' ? 34 : -34) });
      for (const s of [-1, 1]) spawnUnit(w, 'turret', 'battery', f, { x: home.pos.x + sgn * 22, z: home.pos.z + s * 26 });
      T.fleet.forEach((type, i) => {
        const a = (f === 'aegis' ? Math.PI : 0) + i * 0.42, R = ORBIT_R + i * 190;
        spawnUnit(w, 'capital', type, f, { x: Math.cos(a) * R, y: CAP_ALT + i * 90, z: Math.sin(a) * R }, { yaw: Math.atan2(-Math.sin(a), Math.cos(a)), orbitR: R, alt: CAP_ALT + i * 90, flag: i === 0 });
      });
      T.airCap = E.DOCTRINE[f].fighters + (T.bonus.airwing ? 2 : 0);
      const cap = w.units.find(u => u.kind === 'capital' && u.team === f);
      for (let i = 0; i < T.airCap; i++) launchFighter(w, f, cap, i);
    }
    for (const u of w.units) u.bornT = -10;
    w.events.length = 0;
  }

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
    const u = spawnUnit(w, 'fighter', type, f, pos, { yaw });
    u.spd = u.speed; u.aimYaw = yaw;
    return u;
  }

  // ── movement integrators ─────────────────────────────────────
  function clampArena(w, u) {
    const A = w.layout.arena, mx = A.x * 1.22, mz = A.z * 1.22;
    if (u.pos.x > mx) u.pos.x = mx; else if (u.pos.x < -mx) u.pos.x = -mx;
    if (u.pos.z > mz) u.pos.z = mz; else if (u.pos.z < -mz) u.pos.z = -mz;
  }
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
    clampArena(w, u);
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
    clampArena(w, u);
    const ty = Math.max(T.height(u.pos.x, u.pos.z), T.waterLevel) + d.hover;
    u.vel.y = (ty - u.pos.y) * Math.min(1, dt * 9) / dt; u.pos.y += (ty - u.pos.y) * Math.min(1, dt * 9);
  }
  function stepFighter(w, u, dt, desYaw, desPitch, speed) {
    const d = u.def, mt = d.turn * dt;
    const dy = angDiff(desYaw, u.yaw);
    u.yaw += E.clamp(dy, -mt, mt);
    u.roll += (E.clamp(dy * 1.8, -1.25, 1.25) - u.roll) * Math.min(1, dt * 3.5);
    u.pitch += E.clamp(E.clamp(desPitch, -1.2, 1.2) - u.pitch, -mt, mt);
    u.spd += (speed - u.spd) * Math.min(1, dt * 1.4);
    dirOf(u.yaw, u.pitch, tmpA);
    u.vel.x = tmpA.x * u.spd; u.vel.y = tmpA.y * u.spd; u.vel.z = tmpA.z * u.spd;
    u.pos.x += u.vel.x * dt; u.pos.y += u.vel.y * dt; u.pos.z += u.vel.z * dt;
    u.aimYaw = u.yaw; u.aimPitch = u.pitch;
    const g = Math.max(w.terrain.height(u.pos.x, u.pos.z), w.terrain.waterLevel);
    if (u.pos.y < g + 1.5) { u.pos.y = g + 1.5; kill(w, u, { team: null, uid: 0, owner: null, wk: 'crash' }); }
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

  // ── weapons ──────────────────────────────────────────────────
  function muzzle(u, dir, o) {
    o = o || {};
    if (u.kind === 'infantry') { o.x = u.pos.x + dir.x * 0.6; o.y = u.pos.y + u.h * 0.84 + dir.y * 0.6; o.z = u.pos.z + dir.z * 0.6; }
    else if (u.kind === 'fighter') {
      const s = u.gunSide * u.r * 0.55; u.gunSide = -u.gunSide;
      o.x = u.pos.x + dir.x * u.r - Math.cos(u.yaw) * s; o.y = u.pos.y + dir.y * u.r - 0.3; o.z = u.pos.z + dir.z * u.r + Math.sin(u.yaw) * s;
    } else { const k = u.kind === 'vehicle' ? u.r * 1.05 : 2.4; o.x = u.pos.x + dir.x * k; o.y = u.pos.y + u.h * 0.8 + dir.y * k; o.z = u.pos.z + dir.z * k; }
    return o;
  }

  function shoot(w, u, wk, origin, dir, tid, dmgMul) {
    const W = E.WEAPONS[wk], R = w.rng;
    const sp = (W.spread || 0) * (u.pid ? 1 : 3);
    let dx = dir.x + (R.next() - 0.5) * 2 * sp, dy = dir.y + (R.next() - 0.5) * 2 * sp, dz = dir.z + (R.next() - 0.5) * 2 * sp;
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const speed = W.speed || 0;
    const p = {
      id: w.nextProj++, wk, kind: W.kind, pos: { x: origin.x, y: origin.y, z: origin.z },
      vel: { x: dx * speed, y: dy * speed, z: dz * speed }, team: u.team, uid: u.id, owner: u.pid || null,
      dmg: W.dmg * (dmgMul || 1), life: W.fuse || ((W.range || 300) / Math.max(1, speed) * 1.12), splash: W.splash || 0,
      grav: W.grav || 0, seek: W.seek || 0, tid: tid || 0, r: W.kind === 'bolt' ? 0.15 : 0.5, scale: W.scale || 1,
    };
    if (W.kind === 'grenade') p.vel.y += 5.5;
    if (W.kind === 'bomb') { p.vel.x = u.vel.x; p.vel.y = u.vel.y - 4; p.vel.z = u.vel.z; p.life = 14; }
    w.projectiles.push(p);
    w.events.push({ type: 'fire', pid: p.id, wk, pos: V.clone(p.pos), vel: V.clone(p.vel), team: u.team, uid: u.id, life: p.life });
    u.lastFire = w.t;
    return p;
  }

  function firePrimary(w, u, dir, tid) {
    const W = E.WEAPONS[u.def.weapon];
    if (u.fireT > 0 || u.hot) return false;
    u.fireT += 1 / W.rate;
    if (W.heat) { u.heat += W.heat; if (u.heat >= 1) { u.hot = true; if (u.pid) w.events.push({ type: 'overheat', uid: u.id, to: u.pid }); } }
    shoot(w, u, u.def.weapon, muzzle(u, dir, tmpM), dir, tid);
    return true;
  }
  function fireAlt(w, u, dir, tid) {
    const wk = u.def.alt; if (!wk || u.altT > 0) return false;
    const W = E.WEAPONS[wk];
    u.altT = W.cd || 1 / W.rate;
    if (W.kind === 'heal') {
      for (const a of w.units) if (a.alive && a.team === u.team && a.kind === 'infantry' && V.distance2(a.pos, u.pos) < W.radius * W.radius) a.hp = Math.min(a.maxHp, a.hp + W.heal);
      w.events.push({ type: 'heal', pos: V.clone(u.pos), team: u.team, r: W.radius });
      if (u.pid) score(w, u.pid, 25, 'HEAL');
      return true;
    }
    shoot(w, u, wk, muzzle(u, dir, tmpM), dir, tid);
    return true;
  }

  // the enemy closest to an aim ray (for lock-ons and designating targets)
  function aimTarget(w, u, o, d, maxAng, range, pred) {
    let best = null, bs = maxAng;
    for (const e of w.units) {
      if (!e.alive || e.team === u.team || (pred && !pred(e))) continue;
      const dx = e.pos.x - o.x, dy = e.pos.y - o.y, dz = e.pos.z - o.z, l = Math.hypot(dx, dy, dz);
      if (l > range || l < 1) continue;
      const a = Math.acos(E.clamp((dx * d.x + dy * d.y + dz * d.z) / l, -1, 1)) - Math.atan2(e.r, l);
      if (a < bs) { bs = a; best = e; }
    }
    return best;
  }
  const lockable = (e) => e.kind !== 'infantry';

  function leadPoint(u, e, W, o) {
    centerOf(e, o);
    const d = V.distance(u.pos, o), t = W.speed ? d / W.speed : 0;
    o.x += e.vel.x * t; o.y += e.vel.y * t * 0.6; o.z += e.vel.z * t;
    if (W.grav) o.y += 0.5 * W.grav * t * t;
    return o;
  }

  // ── damage ───────────────────────────────────────────────────
  function score(w, pid, pts, why) {
    const p = w.players[pid]; if (!p) return;
    p.score += pts; w.events.push({ type: 'score', to: pid, pts, why });
  }
  function applyDamage(w, e, amount, src, at, head) {
    if (!e.alive || w.winner) return;
    const W = E.WEAPONS[src.wk] || {};
    let d = amount * ((W.vs && W.vs[e.armor] !== undefined) ? W.vs[e.armor] : 1);
    if (head) d *= 1.8;
    if (e.pid && !src.owner) d *= w.cfg.enemyDmg;
    if (d <= 0) return;
    e.hitT = 0;
    let sh = 0;
    if (e.shield > 0) { sh = Math.min(e.shield, d); e.shield -= sh; d -= sh; }
    e.hp -= d;
    const dead = e.hp <= 0;
    if (src.owner || e.pid) {
      const su = src.uid ? w.umap.get(src.uid) : null;
      w.events.push({ type: 'hit', uid: e.id, by: src.owner, to: e.pid, dmg: Math.round(d + sh), kill: dead, head: !!head, sh: sh > 0 && d <= 0,
        pos: at ? V.clone(at) : centerOf(e), from: su ? { x: su.pos.x, z: su.pos.z } : null });
    }
    if (dead) kill(w, e, src);
  }

  function kill(w, e, src) {
    if (!e.alive) return;
    e.alive = false; e.hp = 0;
    const T = w.teams[e.team];
    T.deaths++;
    if (!w.winner) T.tickets = Math.max(0, T.tickets - DEATH_COST[e.kind]);
    const ku = src.uid ? w.umap.get(src.uid) : null;
    if (src.team && src.team !== e.team) { w.teams[src.team].kills++; if (ku) ku.kills++; }
    const ev = { type: 'death', uid: e.id, kind: e.kind, utype: e.type, team: e.team, pos: V.clone(e.pos), vel: V.clone(e.vel), yaw: e.yaw,
      by: src.uid || 0, byPid: src.owner || null, pid: e.pid, wk: src.wk, victim: nameOf(w, e), killer: ku ? nameOf(w, ku) : (src.wk === 'crash' ? 'Crashed' : 'Bombardment'), kteam: src.team };
    w.events.push(ev);
    if (src.owner && w.players[src.owner] && src.team !== e.team) {
      const p = w.players[src.owner];
      p.kills++; p.streak++; if (p.streak > p.best) p.best = p.streak;
      score(w, p.id, KILL_SCORE[e.kind], e.kind === 'infantry' ? 'KILL' : E.unitName(e.kind, e.type).toUpperCase() + ' DESTROYED');
      if (p.streak > 0 && p.streak % 5 === 0) score(w, p.id, 50 * p.streak / 5, p.streak + ' KILL STREAK');
    }
    if (e.pid && w.players[e.pid]) { const p = w.players[e.pid]; p.deaths++; p.streak = 0; p.unitId = 0; p.deadT = w.t; e.pid = null; }
    if (e.kind === 'capital') w.events.push({ type: 'announce', key: 'capitalDown', team: e.team });
  }

  function explode(w, p, pos, direct) {
    if (p.splash > 0) {
      const R = p.splash;
      for (const e of w.units) {
        if (!e.alive || e.team === p.team || e === direct || e.kind === 'capital') continue;
        centerOf(e, tmpC);
        const d = V.distance(tmpC, pos) - e.r;
        if (d < R) applyDamage(w, e, p.dmg * E.clamp01(1 - Math.max(0, d) / R) * 0.85, p, tmpC);
      }
    }
  }

  function updateProjectiles(w, dt) {
    const T = w.terrain, P = w.projectiles;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      if (p.seek && p.tid) {
        const t = w.umap.get(p.tid);
        if (t && t.alive) {
          centerOf(t, tmpA);
          const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z) || 1;
          let wx = tmpA.x - p.pos.x, wy = tmpA.y - p.pos.y, wz = tmpA.z - p.pos.z; const l = Math.hypot(wx, wy, wz) || 1;
          const k = Math.min(1, p.seek * dt);
          let nx = p.vel.x / sp + (wx / l - p.vel.x / sp) * k, ny = p.vel.y / sp + (wy / l - p.vel.y / sp) * k, nz = p.vel.z / sp + (wz / l - p.vel.z / sp) * k;
          const nl = Math.hypot(nx, ny, nz) || 1; p.vel.x = nx / nl * sp; p.vel.y = ny / nl * sp; p.vel.z = nz / nl * sp;
        }
      }
      if (p.grav) p.vel.y -= p.grav * dt;
      const ax = p.pos.x, ay = p.pos.y, az = p.pos.z;
      const sx = p.vel.x * dt, sy = p.vel.y * dt, sz = p.vel.z * dt;
      const seg2 = sx * sx + sy * sy + sz * sz;
      p.pos.x += sx; p.pos.y += sy; p.pos.z += sz;
      p.life -= dt;
      let hit = null, surf = null, head = false, ht = 1;
      for (let j = 0; j < w.units.length; j++) {
        const e = w.units[j];
        if (!e.alive || e.team === p.team) continue;
        if (e.kind === 'capital') {
          // capsule along the hull axis
          const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw), hl = e.def.len * 0.5 - e.h, rc = e.h * 1.25 + p.r;
          const rx = p.pos.x - e.pos.x, ry = p.pos.y - e.pos.y, rz = p.pos.z - e.pos.z;
          const a = E.clamp(rx * fx + rz * fz, -hl, hl);
          const qx = rx - fx * a, qz = rz - fz * a;
          if (qx * qx + ry * ry * 1.6 + qz * qz < rc * rc) { hit = e; ht = 1; break; }
          continue;
        }
        const cx = e.pos.x - ax, cz = e.pos.z - az;
        const ey0 = e.kind === 'infantry' ? e.pos.y + 0.25 : e.kind === 'vehicle' || e.kind === 'turret' ? e.pos.y + e.h * 0.5 : e.pos.y;
        const cy = ey0 - ay;
        const rad = e.r + p.r + (e.kind === 'infantry' ? 0.1 : 0);
        if (cx * cx + cz * cz > (rad + 20) * (rad + 20) && seg2 < 400) continue;
        let t = seg2 > 0 ? (cx * sx + cy * sy + cz * sz) / seg2 : 0;
        if (e.kind === 'infantry') t = seg2 > 0 ? (cx * sx + cz * sz + (cy + e.h * 0.5) * sy) / seg2 : 0;
        t = E.clamp01(t);
        const qx = sx * t - cx, qz = sz * t - cz;
        let qy = sy * t - cy;
        if (e.kind === 'infantry') { const top = e.h - 0.25; qy = qy < 0 ? qy : qy > top ? qy - top : 0; }
        if (qx * qx + qy * qy + qz * qz < rad * rad && t < ht) {
          hit = e; ht = t;
          head = e.kind === 'infantry' && p.kind === 'bolt' && (ay + sy * t) > e.pos.y + e.h * 0.8;
        }
      }
      let dead = false;
      if (hit) {
        tmpD.x = ax + sx * ht; tmpD.y = ay + sy * ht; tmpD.z = az + sz * ht;
        surf = hit.shield > 0 ? 'shield' : 'unit';
        applyDamage(w, hit, p.dmg, p, tmpD, head);
        explode(w, p, tmpD, hit);
        V.copy(p.pos, tmpD); dead = true;
      } else {
        const g = T.height(p.pos.x, p.pos.z), wl = T.waterLevel;
        if (p.pos.y <= g || p.pos.y <= wl) {
          if (p.kind === 'grenade' && p.pos.y <= g && p.life > 0) {
            p.pos.y = g + 0.05; p.vel.y = Math.abs(p.vel.y) * 0.32; p.vel.x *= 0.55; p.vel.z *= 0.55;
            if (Math.abs(p.vel.y) < 1.2) { p.vel.y = 0; p.grav = 0; p.vel.x *= 0.4; p.vel.z *= 0.4; }
          } else { p.pos.y = Math.max(g, wl); surf = p.pos.y <= wl && g < wl ? 'water' : 'ground'; explode(w, p, p.pos, null); dead = true; }
        } else if (p.life <= 0) {
          dead = true; surf = 'air';
          if (p.kind === 'grenade' || p.kind === 'rocket' || p.kind === 'missile') explode(w, p, p.pos, null); else surf = null;
        }
      }
      if (dead) {
        if (surf) w.events.push({ type: 'impact', pid: p.id, wk: p.wk, pos: V.clone(p.pos), surf, splash: p.splash, team: p.team, big: hit ? hit.kind === 'capital' : false });
        else w.events.push({ type: 'fizzle', pid: p.id });
        P[i] = P[P.length - 1]; P.pop();
      }
    }
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

  // ── AI: perception ───────────────────────────────────────────
  function pickTarget(w, u) {
    const W = E.WEAPONS[u.def.weapon], pref = PREF[u.type] || PREF.trooper;
    const sense = u.kind === 'infantry' ? Math.min(W.range, u.type === 'sniper' ? 520 : 230) : u.kind === 'fighter' ? 1500 : W.range;
    let best = null, bs = 0; eyeOf(u, tmpA);
    for (const e of w.units) {
      if (!e.alive || e.team === u.team) continue;
      const pf = pref[e.kind]; if (!pf) continue;
      const d = V.distance(u.pos, e.pos);
      if (d > sense && e.kind !== 'capital') continue;
      let s = pf * 1000 / (d + 60);
      if (e.id === u.ai.tid) s *= 1.3;
      if (s <= bs) continue;
      if (u.kind !== 'fighter' && e.kind !== 'fighter' && !w.terrain.los(tmpA, centerOf(e, tmpB))) continue;
      bs = s; best = e;
    }
    return best;
  }

  function chooseGoal(w, u) {
    let best = -1, bs = 0; const en = enemyOf(u.team), R = w.rng;
    for (const c of w.cps) {
      let s;
      const d = E.distXZ(u.pos, c.pos);
      if (c.owner !== u.team) s = (c.owner ? 1 : 1.25) * (c.n[u.team] > 0 ? 1.3 : 1) / (d + 160);
      else if (c.n[en] > 0 || (c.owner === u.team && Math.abs(c.cap) < 0.99)) s = 1.7 / (d + 160);
      else continue;
      s *= 0.55 + R.next() * 0.9;
      if (s > bs) { bs = s; best = c.id; }
    }
    if (best < 0) best = R.i(w.cps.length);
    return best;
  }
  function goalPos(w, u, o) {
    const ai = u.ai, ord = u.order;
    if (ord) {
      if (ord.type === 'follow') { const l = w.unitOf(ord.pid); if (l) { o.x = l.pos.x + ai.off.x * 0.4; o.z = l.pos.z + ai.off.z * 0.4; o.r = 6; return o; } u.order = null; }
      else { o.x = ord.pos.x + ai.off.x * 0.3; o.z = ord.pos.z + ai.off.z * 0.3; o.r = 8; if (ord.type !== 'hold' && w.t - ord.t > 75) u.order = null; return o; }
    }
    if (ai.goal < 0 || w.t > ai.goalT) { ai.goal = chooseGoal(w, u); ai.goalT = w.t + 9 + w.rng.next() * 9; }
    const c = w.cps[ai.goal];
    o.x = c.pos.x + ai.off.x; o.z = c.pos.z + ai.off.z; o.r = 2.5;
    return o;
  }
  function think(w, u, dt) {
    const ai = u.ai;
    ai.thinkT -= dt;
    if (ai.thinkT > 0) return false;
    ai.thinkT = 0.32 + w.rng.next() * 0.22;
    const t = pickTarget(w, u);
    ai.tid = t ? t.id : 0;
    const k = w.cfg.aiErr * (t && (t.kind === 'fighter') ? 0.6 : 1) * (u.kind === 'infantry' ? 1 : 0.5);
    ai.errY = w.rng.gauss() * k; ai.errP = w.rng.gauss() * k * 0.6;
    if (w.t > ai.offT) {
      ai.offT = w.t + 5 + w.rng.next() * 7;
      const c = w.cps[ai.goal >= 0 ? ai.goal : 0], rr = (c ? c.r : 20) * (u.kind === 'vehicle' ? 1.5 : 0.8);
      const a = w.rng.angle(), d = Math.sqrt(w.rng.next()) * rr;
      ai.off.x = Math.cos(a) * d; ai.off.z = Math.sin(a) * d;
    }
    ai.strafeT -= 0.4; if (ai.strafeT <= 0) { ai.strafe = -ai.strafe; ai.strafeT = 1 + w.rng.next() * 2.2; }
    return true;
  }
  function target(w, u) { const t = u.ai.tid ? w.umap.get(u.ai.tid) : null; return t && t.alive ? t : null; }

  // ── AI: infantry ─────────────────────────────────────────────
  function aiInfantry(w, u, dt) {
    const ai = u.ai, W = E.WEAPONS[u.def.weapon];
    think(w, u, dt);
    const tg = target(w, u), gp = goalPos(w, u, tmpC);
    const gx = gp.x - u.pos.x, gz = gp.z - u.pos.z, dg = Math.hypot(gx, gz);
    let wx = 0, wz = 0, speed = u.speed;
    if (tg) {
      const tx = tg.pos.x - u.pos.x, tz = tg.pos.z - u.pos.z, d = Math.hypot(tx, tz) || 1;
      leadPoint(u, tg, W, tmpA); eyeOf(u, tmpB);
      const ax = tmpA.x - tmpB.x, ay = tmpA.y - tmpB.y, az = tmpA.z - tmpB.z;
      const wantY = Math.atan2(ax, az) + ai.errY, wantP = Math.atan2(ay, Math.hypot(ax, az)) + ai.errP;
      u.aimYaw = turnTo(u.aimYaw, wantY, 7 * dt); u.aimPitch = turnTo(u.aimPitch, wantP, 5 * dt);
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
        const al = Math.abs(angDiff(wantY, u.aimYaw)) + Math.abs(wantP - u.aimPitch);
        if (al < 0.07 && d < W.range) { firePrimary(w, u, dirOf(u.aimYaw, u.aimPitch, tmpA), 0); }
        ai.burstT -= dt; if (ai.burstT <= 0 || u.hot) ai.pauseT = 0.5 + w.rng.next() * 0.9;
      }
      if (u.altT <= 0) {
        const alt = u.def.alt;
        if (alt === 'grenade' && tg.kind !== 'fighter' && d > 10 && d < 34 && w.rng.next() < 0.03) fireAlt(w, u, dirOf(u.aimYaw, Math.min(0.9, u.aimPitch + 0.28 + d * 0.006), tmpA), 0);
        else if (alt === 'rocket' && tg.kind !== 'infantry' && d < E.WEAPONS.rocket.range && w.rng.next() < 0.08) fireAlt(w, u, dirOf(u.aimYaw, u.aimPitch + 0.03, tmpA), tg.id);
      }
    } else if (dg > gp.r) {
      wx = gx / dg; wz = gz / dg;
      if (dg > 30) speed = u.def.sprint * u.spM;
      u.yaw = turnTo(u.yaw, Math.atan2(wx, wz), 6 * dt); u.aimYaw = u.yaw; u.aimPitch *= 0.9;
    }
    if (u.def.alt === 'medburst' && u.altT <= 0 && (w.tickN + u.id) % 20 === 0) {
      for (const a of w.units) if (a.alive && a.team === u.team && a.kind === 'infantry' && a.hp < a.maxHp * 0.6 && V.distance2(a.pos, u.pos) < 160) { fireAlt(w, u, tmpA, 0); break; }
    }
    stepInfantry(w, u, dt, wx, wz, speed, false);
  }

  // ── AI: vehicles + turrets ───────────────────────────────────
  function aimTurret(w, u, tg, dt, rate) {
    const W = E.WEAPONS[u.def.weapon];
    leadPoint(u, tg, W, tmpA); eyeOf(u, tmpB);
    const ax = tmpA.x - tmpB.x, ay = tmpA.y - tmpB.y, az = tmpA.z - tmpB.z;
    const wantY = Math.atan2(ax, az) + u.ai.errY, wantP = Math.atan2(ay, Math.hypot(ax, az)) + u.ai.errP;
    u.aimYaw = turnTo(u.aimYaw, wantY, rate * dt); u.aimPitch = turnTo(u.aimPitch, E.clamp(wantP, -0.35, 1.1), rate * dt);
    return Math.abs(angDiff(wantY, u.aimYaw)) + Math.abs(wantP - u.aimPitch);
  }
  function aiVehicle(w, u, dt) {
    const ai = u.ai, W = E.WEAPONS[u.def.weapon];
    think(w, u, dt);
    const tg = target(w, u), gp = goalPos(w, u, tmpC);
    let gx = gp.x - u.pos.x, gz = gp.z - u.pos.z; const dg = Math.hypot(gx, gz);
    let throttle = dg > 14 ? 1 : 0, des = dg > 1 ? Math.atan2(gx, gz) : u.yaw;
    if (tg) {
      const tx = tg.pos.x - u.pos.x, tz = tg.pos.z - u.pos.z, d = Math.hypot(tx, tz);
      const al = aimTurret(w, u, tg, dt, 2.6);
      if (al < 0.06 && d < W.range) firePrimary(w, u, dirOf(u.aimYaw, u.aimPitch, tmpA), 0);
      if (u.def.alt === 'coax' && tg.kind === 'infantry' && d < E.WEAPONS.coax.range && al < 0.12) fireAlt(w, u, dirOf(u.aimYaw, u.aimPitch, tmpA), 0);
      if (d < W.range * 0.7) {
        if (u.type === 'tank') { throttle = dg > 40 ? 0.35 : 0; }
        else { des = Math.atan2(tx, tz) + ai.strafe * 1.35; throttle = 0.8; }
      }
    } else { u.aimYaw = turnTo(u.aimYaw, u.yaw, 1.5 * dt); u.aimPitch *= 0.95; }
    const dy = angDiff(des, u.yaw);
    if (Math.abs(dy) > 1.1) throttle *= 0.3;
    stepVehicle(w, u, dt, throttle, E.clamp(dy * 2.2, -1, 1));
  }
  function aiTurret(w, u, dt) {
    think(w, u, dt);
    const tg = target(w, u);
    if (tg) { if (aimTurret(w, u, tg, dt, u.def.turn) < 0.07) firePrimary(w, u, dirOf(u.aimYaw, u.aimPitch, tmpA), 0); }
    u.yaw = u.aimYaw;
  }

  // ── AI: fighters ─────────────────────────────────────────────
  function aiFighter(w, u, dt) {
    const ai = u.ai, d = u.def, W = E.WEAPONS[d.weapon], T = w.terrain;
    think(w, u, dt);
    const tg = target(w, u);
    let desYaw = u.yaw, desPitch = 0, speed = u.speed;
    if (ai.state === 'break') {
      ai.stateT -= dt; desYaw = ai.bYaw; desPitch = ai.bPitch; speed = d.boost * u.spM;
      if (ai.stateT <= 0) ai.state = '';
    } else if (tg) {
      const bombRun = d.alt === 'bomb' && tg.kind !== 'fighter';
      leadPoint(u, tg, W, tmpA);
      if (bombRun) { centerOf(tg, tmpA); tmpA.y += tg.kind === 'capital' ? tg.h + 90 : 150; }
      const dx = tmpA.x - u.pos.x, dy = tmpA.y - u.pos.y, dz = tmpA.z - u.pos.z, hd = Math.hypot(dx, dz), dist = Math.hypot(hd, dy);
      desYaw = Math.atan2(dx, dz) + ai.errY; desPitch = Math.atan2(dy, hd) + ai.errP;
      dirOf(u.yaw, u.pitch, tmpB);
      const ang = Math.acos(E.clamp((dx * tmpB.x + dy * tmpB.y + dz * tmpB.z) / (dist || 1), -1, 1));
      if (bombRun) {
        const dh = u.pos.y - (tg.pos.y + (tg.kind === 'capital' ? tg.h : 0)), tf = Math.sqrt(Math.max(0.1, 2 * dh / E.WEAPONS.bomb.grav)), lead = u.spd * tf;
        if (u.altT <= 0 && dh > 20 && Math.abs(hd - lead) < (tg.kind === 'capital' ? 70 : 16) && Math.abs(angDiff(Math.atan2(dx, dz), u.yaw)) < 0.3) fireAlt(w, u, tmpB, 0);
        if (hd < 30) { ai.state = 'break'; ai.stateT = 3.5; ai.bYaw = u.yaw + ai.strafe * 0.5; ai.bPitch = 0.25; }
      } else {
        if (ang < 0.06 && dist < W.range) firePrimary(w, u, tmpB, 0);
        if (d.alt === 'missile' && u.altT <= 0 && ang < 0.16 && dist > 140 && dist < E.WEAPONS.missile.range && tg.kind !== 'infantry') fireAlt(w, u, tmpB, tg.id);
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
      leadPoint(u, tg, W, tmpB);
      if (tg.kind === 'capital') { // rake the hull, not just the center
        const k = (w.rng.next() - 0.5) * tg.def.len * 0.6; tmpB.x += Math.sin(tg.yaw) * k; tmpB.z += Math.cos(tg.yaw) * k; tmpB.y += (w.rng.next() - 0.5) * tg.h * 0.6;
      }
      const dir = V.normalize(V.sub(tmpB, tmpA, tmpC));
      shoot(w, u, g.wk, tmpA, dir, g.slot === 'torp' ? tg.id : 0, dm);
    }
  }
  function aiCapital(w, u, dt) {
    // hold a slow orbit over the battlefield, broadside to the enemy line
    const a = Math.atan2(u.pos.z, u.pos.x) + 0.45, R = u.orbitR || ORBIT_R;
    const des = Math.atan2(Math.cos(a) * R - u.pos.x, Math.sin(a) * R - u.pos.z);
    stepCapital(w, u, dt, E.clamp(angDiff(des, u.yaw) * 3, -1, 1), 1);
    capitalGuns(w, u, dt, null, false);
  }

  // ── player control ───────────────────────────────────────────
  function playerControl(w, u, p, dt) {
    const inp = p.input;
    const mx = E.clamp(inp.mx || 0, -1, 1), mz = E.clamp(inp.mz || 0, -1, 1);
    if (u.kind === 'infantry') {
      const my = inp.moveYaw, fx = Math.sin(my), fz = Math.cos(my);
      let wx = fx * mz - fz * mx, wz = fz * mz + fx * mx; const l = Math.hypot(wx, wz);
      if (l > 1) { wx /= l; wz /= l; }
      u.yaw = inp.yaw; u.aimYaw = inp.yaw; u.aimPitch = inp.pitch;
      const sprint = inp.sprint && mz > 0 && !inp.fire;
      stepInfantry(w, u, dt, wx, wz, sprint ? u.def.sprint * u.spM : u.speed, inp.jump);
      dirOf(inp.yaw, inp.pitch, tmpA);
      if (inp.fire && !sprint) firePrimary(w, u, tmpA, 0);
      if (inp.abil) {
        if (u.def.alt === 'grenade') dirOf(inp.yaw, Math.min(1.2, inp.pitch + 0.16), tmpA);
        const lk = u.def.alt === 'rocket' ? aimTarget(w, u, eyeOf(u, tmpB), tmpA, 0.12, 500, lockable) : null;
        fireAlt(w, u, tmpA, lk ? lk.id : 0);
      }
    } else if (u.kind === 'vehicle') {
      stepVehicle(w, u, dt, mz, -mx);
      u.aimYaw = turnTo(u.aimYaw, inp.yaw, 3.2 * dt); u.aimPitch = turnTo(u.aimPitch, E.clamp(inp.pitch, -0.3, 1.0), 3.2 * dt);
      dirOf(u.aimYaw, u.aimPitch, tmpA);
      if (inp.fire) firePrimary(w, u, tmpA, 0);
      if (inp.abil) fireAlt(w, u, tmpA, 0);
    } else if (u.kind === 'fighter') {
      const d = u.def, sp = (inp.sprint || mz > 0) ? d.boost : mz < 0 ? d.minSpeed : d.speed;
      let dy = inp.yaw, dp = inp.pitch;
      if (Math.hypot(u.pos.x, u.pos.z) > w.layout.bound * 1.12) dy = Math.atan2(-u.pos.x, -u.pos.z);
      if (u.pos.y > 1600) dp = Math.min(dp, -0.2);
      stepFighter(w, u, dt, dy, dp, sp * u.spM);
      if (!u.alive) return;
      dirOf(u.yaw, u.pitch, tmpA); dirOf(inp.yaw, inp.pitch, tmpC);
      const conv = (tmpA.x * tmpC.x + tmpA.y * tmpC.y + tmpA.z * tmpC.z) > 0.985 ? tmpC : tmpA; // slight gimbal
      if (inp.fire) firePrimary(w, u, conv, 0);
      if (inp.abil) {
        const lk = d.alt === 'missile' ? aimTarget(w, u, u.pos, tmpA, 0.3, E.WEAPONS.missile.range, lockable) : null;
        if (d.alt !== 'missile' || lk) fireAlt(w, u, tmpA, lk ? lk.id : 0);
      }
    } else if (u.kind === 'capital') {
      stepCapital(w, u, dt, -mx, 0.35 + Math.max(0, mz) * 0.65 - Math.max(0, -mz) * 0.35);
      dirOf(inp.yaw, inp.pitch, tmpD);
      let focus = null;
      if (inp.fire) focus = aimTarget(w, u, u.pos, tmpD, 0.22, 2400, null);
      capitalGuns(w, u, dt, focus, !!focus);
      const T = w.teams[u.team];
      if (inp.abil && T.strikeT <= 0) {
        const o = { x: u.pos.x, y: u.pos.y - u.h, z: u.pos.z }, t = w.terrain.raycast(o, tmpD, 4000);
        if (t > 0) { strike(w, u.team, { x: o.x + tmpD.x * t, y: 0, z: o.z + tmpD.z * t }, p.id); T.strikeT = E.WEAPONS.orbital.cd * (T.bonus.orbital ? 0.6 : 1); }
      }
    } else if (u.kind === 'turret') {
      u.aimYaw = turnTo(u.aimYaw, inp.yaw, 3 * dt); u.aimPitch = turnTo(u.aimPitch, E.clamp(inp.pitch, -0.3, 1.2), 3 * dt); u.yaw = u.aimYaw;
      if (inp.fire) firePrimary(w, u, dirOf(u.aimYaw, u.aimPitch, tmpA), 0);
    }
  }

  function control(w, u, dt) {
    u.fireT = Math.max(0, u.fireT - dt); u.altT -= dt; u.hitT += dt;
    if (u.heat > 0) { u.heat = Math.max(0, u.heat - (u.hot ? 0.5 : 0.36) * dt); if (u.hot && u.heat < 0.2) u.hot = false; }
    const p = u.pid ? w.players[u.pid] : null;
    if (p) { playerControl(w, u, p, dt); return; }
    if (u.pid) u.pid = null;
    if (u.kind === 'infantry') aiInfantry(w, u, dt);
    else if (u.kind === 'vehicle') aiVehicle(w, u, dt);
    else if (u.kind === 'fighter') aiFighter(w, u, dt);
    else if (u.kind === 'capital') aiCapital(w, u, dt);
    else aiTurret(w, u, dt);
  }

  // ── sustain: shields, regen, medic aura ──────────────────────
  function sustain(w, dt) {
    for (const u of w.units) {
      if (!u.alive) continue;
      if (u.maxShield > 0 && u.hitT > 5 && u.shield < u.maxShield) u.shield = Math.min(u.maxShield, u.shield + u.maxShield * 0.07 * dt);
      if (u.kind === 'infantry') {
        if (u.pid && u.hitT > 6 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + 10 * dt);
        if (u.type === 'medic' && (w.tickN + u.id) % 15 === 0) {
          for (const a of w.units) if (a !== u && a.alive && a.team === u.team && a.kind === 'infantry' && a.hp < a.maxHp && V.distance2(a.pos, u.pos) < 110) a.hp = Math.min(a.maxHp, a.hp + 5);
        }
      }
    }
  }

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
      if (!c.contested && (na || nv)) {
        const dir = na ? 1 : -1, n = Math.min(6, na || nv);
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
          for (const u of w.units) if (u.alive && u.pid && u.team === team && E.distXZ2(u.pos, c.pos) < c.r * c.r) { const p = w.players[u.pid]; if (p) { p.captures++; score(w, p.id, 250, 'COMMAND POST CAPTURED'); } }
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
    const en = enemyOf(f); let best = null, bs = -1;
    for (const c of w.cps) {
      if (c.owner !== f || c.n[en] > c.n[f] + 2) continue;
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
      let inf = 0, air = 0; const veh = { skiff: 0, tank: 0 }; let cap = null;
      for (const u of w.units) {
        if (!u.alive || u.team !== f) continue;
        if (u.kind === 'infantry') inf++; else if (u.kind === 'fighter') air++; else if (u.kind === 'vehicle') veh[u.type]++; else if (u.kind === 'capital' && !cap) cap = u;
      }
      T.alive = inf; T.capital = cap ? cap.id : 0;
      T.strikeT -= dt;
      if (T.tickets <= 0) continue;
      T.waveT -= dt;
      if (T.waveT <= 0) {
        T.waveT = 5.5;
        const n = Math.min(5, T.infCap - inf, T.tickets - inf);
        for (let i = 0; i < n; i++) { const c = spawnCP(w, f); if (!c) break; spawnUnit(w, 'infantry', pickClass(w), f, ring(w, c.pos, 5, c.r * 0.85)); }
      }
      for (const type of ['skiff', 'tank']) {
        if (veh[type] >= (T.vehCap[type] || 0)) { continue; }
        T.vehT[type] -= dt;
        if (T.vehT[type] <= 0) {
          T.vehT[type] = type === 'tank' ? 45 : 28;
          const home = w.cps.find(c => c.home === f), c = home.owner === f ? home : spawnCP(w, f);
          if (c) spawnUnit(w, 'vehicle', type, f, ring(w, c.pos, c.r * 0.6, c.r * 1.1));
        }
      }
      if (air < T.airCap) {
        T.airT -= dt;
        if (T.airT <= 0) { T.airT = cap ? 11 : 24; const u = launchFighter(w, f, cap, w.rng.i(6)); w.events.push({ type: 'launch', pos: V.clone(u.pos), team: f }); }
      }
      // AI fleet calls an orbital strike on a massed enemy
      if (T.strikeT <= 0 && cap && !cap.pid) {
        T.strikeT = E.WEAPONS.orbital.cd * (T.bonus.orbital ? 0.7 : 1.15) + w.rng.next() * 20;
        const en = enemyOf(f); let best = null, bn = 2;
        for (const c of w.cps) if (c.n[en] > bn && c.n[f] === 0) { bn = c.n[en]; best = c; }
        if (!best) { const tk = w.units.find(u => u.alive && u.team === en && (u.type === 'tank' || u.kind === 'turret')); if (tk && w.rng.next() < 0.6) best = tk; }
        if (best) strike(w, f, best.pos, null);
      }
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
    const u = spawnUnit(w, 'infantry', type, p.team, ring(w, c.pos, 4, c.r * 0.6));
    u.yaw = u.aimYaw = Math.atan2(-u.pos.x, -u.pos.z);
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
    if (w.winner) { updateProjectiles(w, dt); w.intensity *= 0.98; return; }
    const U = w.units;
    for (let i = 0; i < U.length; i++) if (U[i].alive) control(w, U[i], dt);
    updateProjectiles(w, dt);
    updateStrikes(w, dt);
    sustain(w, dt);
    if (w.tickN % 3 === 0) updateCPs(w, dt * 3);
    if (w.tickN % 6 === 0) { reinforce(w, dt * 6); bleedAndWin(w, dt * 6); }
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

  E.SIM = { setup, update, spawnUnit, possess, release, deploy, order, strike, applyDamage, kill, myUnits, selectNearest,
    dirOf, angDiff, centerOf, eyeOf, aimTarget, RESPAWN, CAP_ALT };
})(window.E = window.E || {});
