// Weapons, projectiles and damage: who can shoot what, how shots fly, what
// they hit and what dying costs. Shared by every domain (land, air, space).
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  const tmpA = V.make(), tmpC = V.make(), tmpD = V.make(), tmpM = V.make();
  const DEATH_COST = { infantry: 1, vehicle: 3, fighter: 1, turret: 0, capital: 25 };
  const KILL_SCORE = { infantry: 100, vehicle: 300, fighter: 250, turret: 150, capital: 2500 };

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

  // a clear sightline: over the terrain and past every obstacle
  function los(w, a, b) {
    if (!w.terrain.los(a, b)) return false;
    for (let j = 0; j < S.obstacles.length; j++) if (S.obstacles[j].blocks(w, a, b)) return false;
    return true;
  }

  function leadPoint(u, e, W, o) {
    S.centerOf(e, o);
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
    // per-kind hooks: damage() sees the hit before shields (facing armor, shield
    // arcs); hull() sees what got through (subsystems). Each returns the amount
    // that carries on.
    const C = S.ctl[e.kind];
    if (C.damage) d = C.damage(w, e, d, src, at, head);
    if (!(d > 0)) return;
    e.hitT = 0;
    let sh = 0;
    if (e.shield > 0) { sh = Math.min(e.shield, d); e.shield -= sh; d -= sh; }
    if (C.hull && d > 0) d = Math.max(0, C.hull(w, e, d, src, at));
    e.hp -= d;
    const dead = e.hp <= 0;
    if (src.owner || e.pid) {
      const su = src.uid ? w.umap.get(src.uid) : null;
      w.events.push({ type: 'hit', uid: e.id, by: src.owner, to: e.pid, dmg: Math.round(d + sh), kill: dead, head: !!head, sh: sh > 0 && d <= 0,
        pos: at ? V.clone(at) : S.centerOf(e), from: su ? { x: su.pos.x, z: su.pos.z } : null });
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
      by: src.uid || 0, byPid: src.owner || null, pid: e.pid, wk: src.wk, victim: S.nameOf(w, e), killer: ku ? S.nameOf(w, ku) : (src.wk === 'crash' ? 'Crashed' : 'Bombardment'), kteam: src.team };
    w.events.push(ev);
    if (src.owner && w.players[src.owner] && src.team !== e.team) {
      const p = w.players[src.owner];
      p.kills++; p.streak++; if (p.streak > p.best) p.best = p.streak;
      score(w, p.id, KILL_SCORE[e.kind], e.kind === 'infantry' ? 'KILL' : E.unitName(e.kind, e.type).toUpperCase() + ' DESTROYED');
      if (p.streak > 0 && p.streak % 5 === 0) score(w, p.id, 50 * p.streak / 5, p.streak + ' KILL STREAK');
    }
    if (e.pid && w.players[e.pid]) { const p = w.players[e.pid]; p.deaths++; p.streak = 0; p.unitId = 0; p.deadT = w.t; e.pid = null; }
    if (e.kind === 'capital') w.events.push({ type: 'announce', key: 'capitalDown', team: e.team });
    const C = S.ctl[e.kind]; if (C.death) C.death(w, e, src);
  }

  function explode(w, p, pos, direct) {
    if (p.splash > 0) {
      const R = p.splash;
      for (const e of w.units) {
        if (!e.alive || e.team === p.team || e === direct || e.kind === 'capital') continue;
        S.centerOf(e, tmpC);
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
        if (t && t.jamT > w.t) p.tid = 0; // decoyed (countermeasures): the lock is lost for good
        else if (t && t.alive) {
          S.centerOf(t, tmpA);
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
        const q2 = qx * qx + qy * qy + qz * qz;
        if (q2 < rad * rad) {
          if (t < ht) { hit = e; ht = t; head = e.kind === 'infantry' && p.kind === 'bolt' && (ay + sy * t) > e.pos.y + e.h * 0.8; }
        } else if (q2 < (rad + 3) * (rad + 3)) { const c = S.ctl[e.kind]; if (c.nearMiss) c.nearMiss(w, e, p); }
      }
      // world geometry (cover, structures) nearer than any unit stops the shot
      let obs = null;
      for (let j = 0; j < S.obstacles.length; j++) { const o = S.obstacles[j].trace(w, p, ax, ay, az, sx, sy, sz, ht); if (o && o.t <= ht) { obs = o; ht = o.t; hit = null; } }
      let dead = false;
      if (obs) {
        p.pos.x = ax + sx * ht; p.pos.y = ay + sy * ht; p.pos.z = az + sz * ht;
        surf = obs.surf || 'ground'; obs.hit(w, p, p.pos); explode(w, p, p.pos, null); dead = true;
      } else if (hit) {
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

  Object.assign(S, { los, muzzle, shoot, firePrimary, fireAlt, aimTarget, leadPoint, score, applyDamage, kill, explode, updateProjectiles, sustain, lockable });
})(window.E = window.E || {});
