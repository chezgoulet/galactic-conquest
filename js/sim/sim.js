// The simulation rules: movement, AI, combat (projectiles + damage + shields),
// objective capture, and win conditions. Pure and deterministic — draws only from
// world.rng, reads/writes world state, and emits world.events (drained by the
// renderer for FX). The World owns the state; this owns the rules.
(function (E) {
  'use strict';

  function weaponOf(u) {
    const T = u.kind === 'infantry' ? E.INFANTRY : u.kind === 'vehicle' ? E.VEHICLES : u.kind === 'fighter' ? E.FIGHTERS : E.CAPITALS;
    const def = (T[u.type] || T.rifle || {});
    return def.weapon || { dmg: 5, rate: 2, range: 100, spread: 0.02, sfx: 'rifle' };
  }
  function detectRange(u) {
    return u.kind === 'capital' ? 1200 : u.kind === 'fighter' ? 340 : u.kind === 'vehicle' ? 300 : (u.role === 'recon' ? 220 : 140);
  }
  function airAlt(u) { return u.kind === 'capital' ? 520 : 130; }
  function isAir(u) { return u.kind === 'fighter' || u.kind === 'capital'; }

  function nearestEnemy(w, u, range) {
    let best = null, bd = range * range;
    for (const e of w.units) {
      if (!e.alive || e.team === u.team) continue;
      const d = E.distXZ2(u.pos, e.pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function nearestObjective(w, u, team) {
    let best = null, bd = Infinity;
    for (const o of w.objectives) {
      if (o.owner === team) continue; // capture enemy or neutral
      const d = E.distXZ2(u.pos, o.pos);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ── control ──────────────────────────────────────────────────
  function control(u, w, dt) {
    if (!u.alive) return;
    if (w.possessedId === u.id) { possessed(u, w, dt); return; }
    if (u.order && u.order.type === 'hold') { // hold position
      u.fireT = Math.max(0, u.fireT - dt);
      const e = nearestEnemy(w, u, detectRange(u));
      if (e) fireAt(u, w, e);
      return;
    }
    ai(u, w, dt);
  }

  function possessed(u, w, dt) {
    const inp = w.playerInput;
    const sp = u.speed;
    const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw);
    // forward/back + strafe
    let dx = (fx * inp.x) + (-fz * inp.y * -1);
    let dz = (fz * inp.x) + (fx * inp.y * -1);
    // normalize-ish strafe: right = +y
    const rx = Math.cos(u.yaw), rz = -Math.sin(u.yaw);
    dx = fx * inp.x + rx * inp.y;
    dz = fz * inp.x + rz * inp.y;
    const l = Math.hypot(dx, dz) || 1;
    if (l > 0.001) {
      u.pos.x += (dx / l) * sp * dt;
      u.pos.z += (dz / l) * sp * dt;
    }
    // face
    u.yaw = w.playerLookYaw !== undefined ? w.playerLookYaw : u.yaw;
    // altitude
    const targetY = isAir(u) ? w.groundY(u.pos.x, u.pos.z) + airAlt(u) : w.groundY(u.pos.x, u.pos.z);
    u.pos.y += (targetY - u.pos.y) * Math.min(1, dt * (isAir(u) ? 2 : 6));
    // fire: auto at nearest enemy in range, or at crosshair
    u.fireT = Math.max(0, u.fireT - dt);
    const e = nearestEnemy(w, u, detectRange(u));
    if (e && inp.fire !== false) fireAt(u, w, e);
  }

  function ai(u, w, dt) {
    const range = weaponOf(u).range || 100;
    const det = detectRange(u);
    const enemy = nearestEnemy(w, u, det);
    // objective to push (enemy or neutral)
    const obj = nearestObjective(w, u, u.team);
    // target point
    let tx, tz;
    if (enemy) { tx = enemy.pos.x; tz = enemy.pos.z; }
    else if (obj) { tx = obj.pos.x; tz = obj.pos.z; }
    else { // advance to enemy HQ
      const hq = w.objectives.find(o => o.role === 'hq' && o.owner !== u.team);
      if (!hq) return;
      tx = hq.pos.x; tz = hq.pos.z;
    }
    const dx = tx - u.pos.x, dz = tz - u.pos.z;
    const dist = Math.hypot(dx, dz);
    const stopR = obj && (Math.abs(tx - obj.pos.x) < 2 && Math.abs(tz - obj.pos.z) < 2) ? obj.radius * 0.7 : 0;
    // move toward target
    if (dist > (stopR + 2)) {
      const desired = Math.atan2(dx, dz);
      u.yaw = E.lerpAngle(u.yaw, desired, Math.min(1, u.turn * dt));
      const sp = u.speed * (enemy && dist < range * 0.6 ? 0.5 : 1); // slow when engaging
      u.pos.x += Math.sin(u.yaw) * sp * dt;
      u.pos.z += Math.cos(u.yaw) * sp * dt;
    }
    // altitude
    const targetY = isAir(u) ? w.groundY(u.pos.x, u.pos.z) + airAlt(u) + Math.sin(w.t + u.id) * 20 : w.groundY(u.pos.x, u.pos.z);
    u.pos.y += (targetY - u.pos.y) * Math.min(1, dt * (isAir(u) ? 1.5 : 6));
    // fire
    u.fireT = Math.max(0, u.fireT - dt);
    if (enemy && dist < range) fireAt(u, w, enemy);
    else if (obj && dist < obj.radius) fireAt(u, w, null, obj); // shoot the objective
  }

  // ── weapons ──────────────────────────────────────────────────
  function fireAt(u, w, enemy, obj) {
    if (u.fireT > 0) return;
    const wp = weaponOf(u);
    u.fireT = 1 / (wp.rate || 2);
    u.aim = u.yaw;
    const muzzle = E.V3.make(u.pos.x + Math.sin(u.yaw) * u.r * 1.5, u.pos.y + u.viewH * 0.7, u.pos.z + Math.cos(u.yaw) * u.r * 1.5);
    let dir;
    if (obj) dir = E.V3.normalize(E.V3.sub(obj.pos, muzzle));
    else if (enemy) dir = E.V3.normalize(E.V3.sub(enemy.pos, muzzle));
    else dir = E.V3.normalize(E.V3.make(Math.sin(u.yaw), 0, Math.cos(u.yaw)));
    const sp = wp.spread || 0.02;
    dir.x += (w.rng.next() - 0.5) * sp * 2; dir.y += (w.rng.next() - 0.5) * sp; dir.z += (w.rng.next() - 0.5) * sp * 2;
    E.V3.normalize(dir);
    const spd = (wp.speed || 150) * (u.kind === 'fighter' ? 1.3 : 1);
    w.projectiles.push({
      pos: muzzle, dir, speed: spd, dmg: wp.dmg, team: u.team, life: (wp.range || 120) / spd + 1.5,
      color: E.faction(u.faction).palette.engine, faction: u.faction, kind: wp.kind || 'bullet', r: 1.2,
    });
    w.events.push({ type: 'muzzle', pos: muzzle, dir, faction: u.faction, kind: wp.kind });
  }

  // ── combat ───────────────────────────────────────────────────
  function applyDamage(w, target, dmg, source) {
    if (!target.alive) return;
    // shield first
    if (target.maxShield > 0 && target.shield > 0) {
      const s = Math.min(target.shield, dmg);
      target.shield -= s; dmg -= s;
      if (s > 0.5) w.events.push({ type: 'shieldhit', pos: target.pos, team: target.team });
    }
    target.hp -= dmg;
    if (dmg > 0.5) w.events.push({ type: 'hit', pos: { x: target.pos.x, y: target.pos.y + target.viewH * 0.5, z: target.pos.z }, dmg: Math.round(dmg), team: target.team, faction: source ? source.team : 'neutral' });
    if (target.hp <= 0) {
      target.alive = false;
      target.hp = 0;
      w.events.push({ type: 'death', pos: { x: target.pos.x, y: target.pos.y, z: target.pos.z }, kind: target.kind, faction: target.faction });
      if (w.possessedId === target.id) { w.possessedId = null; w.events.push({ type: 'possessedDead' }); }
      if (source && source.team) { source.kills = (source.kills || 0) + 1; w.stats.kills[source.team] = (w.stats.kills[source.team] || 0) + 1; }
    }
  }

  function updateProjectiles(w, dt) {
    for (let i = w.projectiles.length - 1; i >= 0; i--) {
      const p = w.projectiles[i];
      p.pos.x += p.dir.x * p.speed * dt; p.pos.y += p.dir.y * p.speed * dt; p.pos.z += p.dir.z * p.speed * dt;
      p.life -= dt;
      let dead = p.life <= 0;
      // hit test vs enemy units
      if (!dead) {
        for (const e of w.units) {
          if (!e.alive || e.team === p.team) continue;
          const dx = e.pos.x - p.pos.x, dy = (e.pos.y + e.viewH * 0.5) - p.pos.y, dz = e.pos.z - p.pos.z;
          if (dx * dx + dy * dy + dz * dz < (e.r + p.r) * (e.r + p.r)) {
            applyDamage(w, e, p.dmg, { team: p.team }); dead = true; break;
          }
        }
        // hit enemy objectives
        if (!dead) {
          for (const o of w.objectives) {
            if (o.owner === p.team) continue;
            const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, dy = (o.pos.y) - p.pos.y;
            if (dx * dx + dy * dy + dz * dz < (o.radius + p.r) * (o.radius + p.r)) {
              o.hp -= p.dmg; if (o.hp <= 0) { o.hp = 0; o.owner = p.team; w.events.push({ type: 'objectiveDestroyed', pos: o.pos, role: o.role }); }
              dead = true; break;
            }
          }
        }
      }
      if (dead) { w.events.push({ type: 'impact', pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, faction: p.faction, kind: p.kind }); w.projectiles.splice(i, 1); }
    }
  }

  // shield regen
  function regen(w, dt) {
    const thin = w.planet.biomeDef.challenge && w.planet.biomeDef.challenge.thinAir ? 0.6 : 1;
    for (const u of w.units) {
      if (!u.alive || u.maxShield <= 0) continue;
      // only regen out of combat (no recent hit)
      u.regenT = (u.regenT || 0) + dt;
      if (u.regenT > 3) u.shield = Math.min(u.maxShield, u.shield + u.maxShield * 0.15 * thin * dt);
    }
  }

  // ── objectives ───────────────────────────────────────────────
  function updateObjectives(w, dt) {
    for (const o of w.objectives) {
      let a = 0, b = 0;
      for (const u of w.units) {
        if (!u.alive) continue;
        const d = E.distXZ2(u.pos, o.pos);
        if (d < o.radius * o.radius) { if (u.team === 'aegis') a++; else if (u.team === 'verdant') b++; }
      }
      if (a > 0 && b > 0) continue; // contested
      const team = a > 0 ? 'aegis' : b > 0 ? 'verdant' : null;
      if (!team) { // decay to owner
        if (o.owner) { o.progress += ((o.owner === 'aegis' ? 1 : 0) - o.progress) * Math.min(1, dt * 0.2); }
        continue;
      }
      if (team === o.owner) { o.progress = 1; continue; }
      const before = o.owner;
      o.progress += dt / (o.hold || 15);
      if (o.progress >= 1) {
        o.progress = 1; o.owner = team; o.hp = o.maxHp;
        w.events.push({ type: 'objectiveCaptured', pos: o.pos, team, role: o.role, prev: before });
      }
    }
  }

  function checkWin(w) {
    if (w.winner) return;
    const hqs = w.objectives.filter(o => o.role === 'hq');
    const aegisHQ = hqs.find(o => o.x < 0) || hqs[0];
    const verdantHQ = hqs.find(o => o.x >= 0) || hqs[1];
    if (verdantHQ && verdantHQ.owner === 'aegis') w.winner = 'aegis';
    else if (aegisHQ && aegisHQ.owner === 'verdant') w.winner = 'verdant';
    if (w.winner) w.events.push({ type: 'gameOver', winner: w.winner });
  }

  // ── intensity (drives music) ─────────────────────────────────
  function intensity(w) {
    let engaged = 0, total = 0;
    for (const u of w.units) { if (u.alive) { total++; if (u._engaged) engaged++; } }
    const near = (w.projectiles.length / 60) * 0.5;
    const obj = 0.2;
    return E.clamp01((engaged / Math.max(1, total)) * 0.7 + near + obj * 0.3);
  }

  // ── main step ────────────────────────────────────────────────
  function update(w, dt) {
    if (w.winner) { // keep FX going but freeze the battle
      updateProjectiles(w, dt); w.intensity = 0; return;
    }
    w.t += dt; w.tickN++;
    // control + movement
    for (const u of w.units) {
      if (!u.alive) continue;
      u._engaged = false;
      control(u, w, dt);
    }
    // mark engaged (has a recent target) for intensity
    for (const u of w.units) if (u.alive && nearestEnemy(w, u, detectRange(u))) u._engaged = true;
    updateProjectiles(w, dt);
    regen(w, dt);
    updateObjectives(w, dt);
    checkWin(w);
    w.intensity = intensity(w);
  }

  // ── player commands (the "light command" surface) ────────────
  function myUnits(w, kind) {
    return w.units.filter(u => u.alive && u.team === w.human && (!kind || u.kind === kind));
  }
  function selectNearest(w, pos, maxD) {
    let best = null, bd = maxD * maxD;
    for (const u of myUnits(w)) { const d = E.distXZ2(pos, u.pos); if (d < bd) { bd = d; best = u; } }
    return best;
  }
  function selectBox(w, a, b) {
    const set = new Set();
    const minx = Math.min(a.x, b.x), maxx = Math.max(a.x, b.x), minz = Math.min(a.z, b.z), maxz = Math.max(a.z, b.z);
    for (const u of myUnits(w)) if (u.pos.x >= minx && u.pos.x <= maxx && u.pos.z >= minz && u.pos.z <= maxz) set.add(u);
    return [...set];
  }
  function command(w, sel, type, arg) {
    for (const u of (sel || myUnits(w))) { u.order = { type, pos: arg && arg.pos ? E.V3.clone(arg.pos) : null, unit: arg && arg.unit ? arg.unit : null }; }
    w.events.push({ type: 'command', n: (sel || myUnits(w)).length, type });
  }

  E.SIM = Object.assign(E.SIM || {}, {
    update, weaponOf, nearestEnemy, intensity,
    myUnits, selectNearest, selectBox, command,
    applyDamage, fireAt,
  });
})(window.E = window.E || {});
