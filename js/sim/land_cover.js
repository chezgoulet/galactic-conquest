// LAND cover: destructible cover and fortifications. Generated once from the
// world seed (own RNG, so w.rng is untouched), stored on w.cover, registered as
// a world obstacle (projectiles and sightlines stop on it) and queried by the
// movement and AI code.
//
// A cover piece is an oriented box:
//   { id, type, x, y, z,        centre (y = ground under it)
//     yaw,                      rotation about +y, same convention as units: local +z -> (sin yaw, cos yaw);
//                               three.js: mesh.rotation.y = yaw
//     hw, hd,                   half width (local x) and half depth (local z), metres
//     h, h0,                    current and original height (shrinks as it degrades)
//     hp, maxHp, stage,         stage 0 intact, 1 damaged, 2 broken (renderer: swap/crack the model)
//     alive, dyn, team, ttl }   dyn = built or left at runtime (wreck, engineer barrier)
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  const CELL = 32;
  const key = (cx, cz) => (cx + 512) * 2048 + (cz + 512);
  let HC = null, HNX = 0, HNZ = 0;     // last collision: piece + outward normal
  let TC = null;                       // piece the last trace hit
  const TR = { t: 0, surf: 'ground', hit: coverHit };
  const EXPLOSIVE = { rocket: 1, missile: 1, shell: 1, grenade: 1, bomb: 1, turbo: 1, orbital: 1 };

  // ── store ────────────────────────────────────────────────────
  function initCover(w) { w.cover = []; w.coverGrid = new Map(); w.coverId = 1; w.coverEvScan = { arr: null, n: 0 }; }
  function gridAdd(w, c) {
    const R = Math.hypot(c.hw, c.hd), x0 = Math.floor((c.x - R) / CELL), x1 = Math.floor((c.x + R) / CELL), z0 = Math.floor((c.z - R) / CELL), z1 = Math.floor((c.z + R) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = key(i, j); let a = w.coverGrid.get(k); if (!a) { a = []; w.coverGrid.set(k, a); } a.push(c);
    }
  }
  function gridRemove(w, c) {
    const R = Math.hypot(c.hw, c.hd), x0 = Math.floor((c.x - R) / CELL), x1 = Math.floor((c.x + R) / CELL), z0 = Math.floor((c.z - R) / CELL), z1 = Math.floor((c.z + R) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const a = w.coverGrid.get(key(i, j)); if (!a) continue;
      const k = a.indexOf(c); if (k >= 0) { a[k] = a[a.length - 1]; a.pop(); }
    }
  }
  function addCover(w, type, x, z, yaw, o) {
    o = o || {};
    const D = E.COVER[type], T = w.terrain;
    const wd = o.w || D.w[0], hp = Math.round((o.hp || D.hp) * (o.hpMul || 1));
    const y = T.ground(x, z) - 0.1;
    const c = { id: w.coverId++, type, x, y, z, yaw, hw: wd / 2, hd: (o.d || D.d) / 2, h: D.h, h0: D.h, hp, maxHp: hp, stage: 0, alive: true,
                dyn: !!o.dyn, team: o.team || null, ttl: o.ttl || 0, c: Math.cos(yaw), s: Math.sin(yaw), def: D, round: !!D.round, idx: w.cover.length };
    w.cover.push(c); gridAdd(w, c);
    return c;
  }

  // ── geometry ─────────────────────────────────────────────────
  // circle (x,z,r) vs piece; returns penetration depth (>0) and sets HNX/HNZ
  function circleBox(c, x, z, r) {
    const dx = x - c.x, dz = z - c.z;
    const lu = dx * c.c - dz * c.s, lv = dx * c.s + dz * c.c;
    const qu = lu < -c.hw ? -c.hw : lu > c.hw ? c.hw : lu, qv = lv < -c.hd ? -c.hd : lv > c.hd ? c.hd : lv;
    let nu = lu - qu, nv = lv - qv, pen;
    const d2 = nu * nu + nv * nv;
    if (d2 > 1e-8) {
      if (d2 >= r * r) return 0;
      const d = Math.sqrt(d2); pen = r - d; nu /= d; nv /= d;
    } else { // centre inside: leave through the nearest face
      const pu = c.hw - Math.abs(lu), pv = c.hd - Math.abs(lv);
      if (pu < pv) { nu = lu < 0 ? -1 : 1; nv = 0; pen = pu + r; } else { nu = 0; nv = lv < 0 ? -1 : 1; pen = pv + r; }
    }
    HNX = nu * c.c + nv * c.s; HNZ = -nu * c.s + nv * c.c;
    return pen;
  }
  // push a ground body out of every solid piece. mode 0 infantry, 1 vehicle (crushes `crush` pieces when
  // fast). Returns the deepest blocking piece (HC/HNX/HNZ describe it) or null.
  function collide(w, pos, r, feetY, mode, spd, out) {
    if (out) out.c = null;
    const g = w.coverGrid; HC = null; if (!g || !g.size) return null;
    const x0 = Math.floor((pos.x - r - 8) / CELL), x1 = Math.floor((pos.x + r + 8) / CELL), z0 = Math.floor((pos.z - r - 8) / CELL), z1 = Math.floor((pos.z + r + 8) / CELL);
    let best = 0, bc = null, bnx = 0, bnz = 0;
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const a = g.get(key(i, j)); if (!a) continue;
      for (let k = 0; k < a.length; k++) {
        const c = a[k]; if (!c.alive) continue;
        if (feetY >= c.y + c.h - 0.2) continue;
        const pen = circleBox(c, pos.x, pos.z, r); if (pen <= 0) continue;
        if (mode === 1 && c.def.crush && spd > 5) { coverDamage(w, c, 60 * spd * (c.def.hard ? 0.4 : 1) + 80, null, 'ram'); if (c.alive) { pos.x += HNX * pen * 0.3; pos.z += HNZ * pen * 0.3; } continue; }
        pos.x += HNX * pen; pos.z += HNZ * pen;
        if (pen > best) { best = pen; bc = c; bnx = HNX; bnz = HNZ; }
      }
    }
    HC = bc; HNX = bnx; HNZ = bnz;
    if (out) { out.c = bc; out.nx = bnx; out.nz = bnz; }
    return bc;
  }
  function blockedAt(w, x, z, r, feetY) {
    const g = w.coverGrid; if (!g || !g.size) return false;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const a = g.get(key(i, j)); if (!a) continue;
      for (let k = 0; k < a.length; k++) { const c = a[k]; if (c.alive && feetY < c.y + c.h - 0.2 && circleBox(c, x, z, r) > 0) return true; }
    }
    return false;
  }
  // segment (a + s*t, t in 0..1) vs one box; entry t or -1 (segments that start inside are ignored)
  function segBox(c, ax, ay, az, sx, sy, sz) {
    const dx = ax - c.x, dz = az - c.z;
    const au = dx * c.c - dz * c.s, av = dx * c.s + dz * c.c, ay0 = ay - c.y;
    const su = sx * c.c - sz * c.s, sv = sx * c.s + sz * c.c;
    if (au > -c.hw && au < c.hw && av > -c.hd && av < c.hd && ay0 > 0 && ay0 < c.h) return -1;
    let t0 = 0, t1 = 1;
    // u slab
    if (su > -1e-9 && su < 1e-9) { if (au < -c.hw || au > c.hw) return -1; }
    else { let a = (-c.hw - au) / su, b = (c.hw - au) / su; if (a > b) { const t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1; }
    if (sv > -1e-9 && sv < 1e-9) { if (av < -c.hd || av > c.hd) return -1; }
    else { let a = (-c.hd - av) / sv, b = (c.hd - av) / sv; if (a > b) { const t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1; }
    if (sy > -1e-9 && sy < 1e-9) { if (ay0 < 0 || ay0 > c.h) return -1; }
    else { let a = -ay0 / sy, b = (c.h - ay0) / sy; if (a > b) { const t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1; }
    return t0;
  }
  // grid-walk a segment; returns the nearest hit t (<= maxT) or -1. any=true stops at the first hit.
  function segWalk(w, ax, ay, az, sx, sy, sz, maxT, any) {
    const g = w.coverGrid; TC = null; if (!g || !g.size) return -1;
    let cx = Math.floor(ax / CELL), cz = Math.floor(az / CELL);
    const ex = Math.floor((ax + sx) / CELL), ez = Math.floor((az + sz) / CELL);
    const stx = sx > 0 ? 1 : -1, stz = sz > 0 ? 1 : -1;
    const tdx = sx !== 0 ? Math.abs(CELL / sx) : 1e9, tdz = sz !== 0 ? Math.abs(CELL / sz) : 1e9;
    let tmx = sx > 0 ? ((cx + 1) * CELL - ax) / sx : sx < 0 ? (cx * CELL - ax) / sx : 1e9;
    let tmz = sz > 0 ? ((cz + 1) * CELL - az) / sz : sz < 0 ? (cz * CELL - az) / sz : 1e9;
    let best = maxT + 1e-6, bc = null;
    for (let n = 0; n < 200; n++) {
      const a = g.get(key(cx, cz));
      if (a) for (let k = 0; k < a.length; k++) {
        const c = a[k]; if (!c.alive) continue;
        const t = segBox(c, ax, ay, az, sx, sy, sz);
        if (t >= 0 && t < best) { best = t; bc = c; if (any) { TC = c; return t; } }
      }
      if (cx === ex && cz === ez) break;
      const nx = tmx < tmz ? tmx : tmz;
      if (best <= nx) break;
      if (tmx < tmz) { cx += stx; tmx += tdx; } else { cz += stz; tmz += tdz; }
    }
    TC = bc;
    return bc ? best : -1;
  }

  // ── obstacle registration ────────────────────────────────────
  function trace(w, p, ax, ay, az, sx, sy, sz, maxT) {
    const t = segWalk(w, ax, ay, az, sx, sy, sz, maxT, false);
    if (t < 0) return null;
    TR.t = t; TR.surf = 'ground'; return TR;
  }
  function blocks(w, a, b) { return segWalk(w, a.x, a.y, a.z, b.x - a.x, b.y - a.y, b.z - a.z, 1, true) >= 0; }
  function coverHit(w, p, pos) {
    const c = TC; if (!c || !c.alive) return;
    const W = E.WEAPONS[p.wk] || {};
    if (p.splash > 0) return; // splash is applied by the impact scan
    let d = p.dmg * (c.def.hard ? 0.25 : 0.9) * (W.cv || 1);
    const su = p.uid ? w.umap.get(p.uid) : null; if (su && su.m && su.m.coverDmg) d *= su.m.coverDmg;
    coverDamage(w, c, d, p, p.wk);
  }
  S.obstacles.push({ trace, blocks });

  // ── damage ───────────────────────────────────────────────────
  function stageOf(c) { const f = c.hp / c.maxHp; return f > 0.66 ? 0 : f > 0.33 ? 1 : 2; }
  function coverDamage(w, c, d, src, wk) {
    if (!c.alive || !(d > 0)) return;
    if (w.landStats) w.landStats.coverHits++;
    c.hp -= d;
    if (c.hp <= 0) { breakCover(w, c, wk); return; }
    const s = stageOf(c);
    if (s !== c.stage) {
      c.stage = s; c.h = c.h0 * (1 - 0.2 * s);
      w.events.push({ type: 'coverStage', id: c.id, ctype: c.type, stage: s, frac: c.hp / c.maxHp, pos: { x: c.x, y: c.y, z: c.z }, h: c.h });
    }
  }
  function breakCover(w, c, wk) {
    if (!c.alive) return;
    c.alive = false; c.hp = 0; c.stage = 3; gridRemove(w, c);
    w.landStats && (w.landStats.coverBroken++);
    w.events.push({ type: 'coverBreak', id: c.id, ctype: c.type, pos: { x: c.x, y: c.y, z: c.z }, yaw: c.yaw, hw: c.hw, hd: c.hd, h: c.h0, wk: wk || null, dyn: c.dyn });
  }
  function repairCover(w, c, amt) {
    if (!c.alive || c.hp >= c.maxHp) return 0;
    const a = Math.min(amt, c.maxHp - c.hp); c.hp += a;
    const s = stageOf(c); if (s !== c.stage) { c.stage = s; c.h = c.h0 * (1 - 0.2 * s); w.events.push({ type: 'coverStage', id: c.id, ctype: c.type, stage: s, frac: c.hp / c.maxHp, pos: { x: c.x, y: c.y, z: c.z }, h: c.h }); }
    return a;
  }
  // damage everything in a blast: used by impact scan and by wreck / charge explosions
  function blastCover(w, x, y, z, R, dmg, mul) {
    const g = w.coverGrid; if (!g || !g.size) return;
    const x0 = Math.floor((x - R - 6) / CELL), x1 = Math.floor((x + R + 6) / CELL), z0 = Math.floor((z - R - 6) / CELL), z1 = Math.floor((z + R + 6) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const a = g.get(key(i, j)); if (!a) continue;
      for (let k = a.length - 1; k >= 0; k--) {
        const c = a[k]; if (!c || !c.alive) continue;
        const d = Math.hypot(c.x - x, c.z - z) - Math.min(c.hw, c.hd);
        if (d < R) coverDamage(w, c, dmg * (1 - Math.max(0, d) / R) * (c.def.hard ? 0.7 : 1) * (mul || 1), null, 'blast');
      }
    }
  }

  // ── runtime: ttl, wreck lifetime, impact scan ────────────────
  function coverSystem(w, dt) {
    // splash from any projectile that exploded this tick
    const sc = w.coverEvScan, ev = w.events;
    let from = sc.arr === ev ? sc.n : 0;
    for (let i = from; i < ev.length; i++) {
      const e = ev[i];
      if (e.type === 'impact' && e.splash > 0) {
        const W = E.WEAPONS[e.wk]; if (!W) continue;
        blastCover(w, e.pos.x, e.pos.y, e.pos.z, e.splash, W.dmg * 0.85, (W.cv || 1) * 1.3);
      }
    }
    sc.arr = ev; sc.n = ev.length;
    if ((w.tickN & 7) === 0) {
      for (let i = w.cover.length - 1; i >= 0; i--) {
        const c = w.cover[i];
        if (c.alive && c.ttl > 0) { c.ttl -= dt * 8; if (c.ttl <= 0) breakCover(w, c, 'expired'); }
        if (!c.alive && c.dyn) { w.cover.splice(i, 1); }
      }
      // indices of static pieces are stable (only dyn pieces are ever spliced, and they come last)
    }
  }

  // ── engineer fortifications ──────────────────────────────────
  function buildBarrier(w, u) {
    const m = u.m || {};
    const yaw = u.aimYaw, d = 3.0;
    const x = u.pos.x + Math.sin(yaw) * d, z = u.pos.z + Math.cos(yaw) * d;
    if (blockedAt(w, x, z, 1.4, u.pos.y)) return null;
    if (w.terrain.height(x, z) < w.terrain.waterLevel) return null;
    // the wall stands across the line of fire
    const c = addCover(w, 'shield', x, z, yaw, { dyn: true, team: u.team, hpMul: m.cover || 1, ttl: 150 });
    c.owner = u.id;
    u.builds = u.builds || [];
    u.builds.push(c); while (u.builds.length > 3) { const o = u.builds.shift(); if (o.alive) breakCover(w, o, 'expired'); }
    w.events.push({ type: 'build', uid: u.id, ctype: c.type, cid: c.id, team: u.team, pos: { x, y: c.y, z } });
    return c;
  }
  // wrecks become cover
  function leaveWreck(w, u) {
    const big = u.type === 'tank' ? 1 : 0.7;
    const c = addCover(w, 'wreck', u.pos.x, u.pos.z, u.yaw, { dyn: true, w: 6.2 * big, d: 3.0 * big, hp: 650 * big, ttl: 110 });
    c.h0 = c.h = 1.6 * big;
    return c;
  }

  // ── generation ───────────────────────────────────────────────
  function freeSpot(w, x, z, rad) {
    const g = w.coverGrid, x0 = Math.floor((x - rad - 8) / CELL), x1 = Math.floor((x + rad + 8) / CELL), z0 = Math.floor((z - rad - 8) / CELL), z1 = Math.floor((z + rad + 8) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const a = g.get(key(i, j)); if (!a) continue;
      for (let k = 0; k < a.length; k++) { const c = a[k]; if (Math.hypot(c.x - x, c.z - z) < rad + Math.hypot(c.hw, c.hd) * 0.8) return false; }
    }
    return true;
  }
  function genCover(w) {
    initCover(w);
    const rng = E.RNG((w.planet.seed ^ 0x2c0ffee5) >>> 0), T = w.terrain, cvv = (w.planet.biomeDef && w.planet.biomeDef.cover) || {};
    const A = w.layout.arena, cps = w.cps;
    const okSpot = (x, z) => Math.abs(x) < A.x * 1.05 && Math.abs(z) < A.z * 1.05 && T.height(x, z) > T.waterLevel + 0.4 && T.slope(x, z) < 0.55;
    const nearCp = (x, z, k) => { for (const c of cps) if (Math.hypot(c.pos.x - x, c.pos.z - z) < c.r * k) return true; return false; };
    const place = (type, x, z, yaw, o) => {
      const D = E.COVER[type];
      o = o || {};
      o.w = D.w[0] + rng.next() * (D.w[1] - D.w[0]); o.hpMul = 0.9 + rng.next() * 0.2;
      if (D.round) o.d = o.w * (0.7 + rng.next() * 0.3);
      if (!okSpot(x, z) || nearCp(x, z, 0.5) || !freeSpot(w, x, z, Math.max(o.w, o.d || D.d) * 0.5 + 1)) return null;
      return addCover(w, type, x, z, yaw, o);
    };
    // fortifications: crescents around every post, facing outward, plus nests of cover on the approaches
    const FORT = [['sandbag', 4], ['barrier', 2], ['crates', 1.6], ['trap', 1.0], ['bunker', 0.6]];
    cps.forEach((c, ci) => {
      const n = c.home ? 11 : 8;
      for (let i = 0; i < n; i++) {
        const a = (i + rng.next() * 0.6) / n * E.TAU, rr = c.r * (1.05 + rng.next() * 0.55);
        const x = c.pos.x + Math.cos(a) * rr, z = c.pos.z + Math.sin(a) * rr;
        const type = rng.pickW(FORT);
        place(type, x, z, Math.atan2(Math.cos(a), Math.sin(a)));  // wall faces the post
      }
    });
    const order = cps.map((c, i) => i).sort((a, b) => cps[a].pos.x - cps[b].pos.x);
    for (let k = 0; k + 1 < order.length; k++) {
      const a = cps[order[k]].pos, b = cps[order[k + 1]].pos, dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      const yaw = Math.atan2(dx, dz);
      const nc = 4 + (rng.next() * 3 | 0);
      for (let q = 0; q < nc; q++) {
        const t = 0.18 + 0.64 * (q + rng.next() * 0.8) / nc, off = (rng.next() - 0.5) * 90;
        const bx = a.x + dx * t - dz / L * off, bz = a.z + dz * t + dx / L * off;
        const m = 2 + (rng.next() * 3 | 0);
        for (let i = 0; i < m; i++) place(rng.pickW(FORT), bx + (rng.next() - 0.5) * 22, bz + (rng.next() - 0.5) * 22, yaw + (rng.next() - 0.5) * 0.7);
      }
    }
    // natural cover, by biome
    const wt = {};
    let tot = 0;
    for (const k in cvv) {
      const m = E.COVER_BIOME[k]; if (!m || !(cvv[k] > 0)) continue;
      for (const [type, f] of m) { wt[type] = (wt[type] || 0) + cvv[k] * f; tot += cvv[k] * f; }
    }
    const pairs = Object.keys(wt).map(k => [k, wt[k]]);
    if (pairs.length) {
      const N = Math.min(190, Math.round(18 + tot * 150));
      let tries = 0, made = 0;
      while (made < N && tries++ < N * 6) {
        let x, z;
        if (rng.next() < 0.55) { // along approaches
          const k = rng.i(order.length - 1), a = cps[order[k]].pos, b = cps[order[k + 1]].pos, t = rng.next();
          x = a.x + (b.x - a.x) * t + (rng.next() - 0.5) * 220; z = a.z + (b.z - a.z) * t + (rng.next() - 0.5) * 220;
        } else { x = (rng.next() * 2 - 1) * A.x * 0.95; z = (rng.next() * 2 - 1) * A.z * 0.95; }
        if (place(rng.pickW(pairs), x, z, rng.next() * E.TAU)) made++;
      }
    }
    w.coverStatic = w.cover.length;
  }

  // ── AI helpers: find a firing / hiding spot ──────────────────
  const CS = { x: 0, z: 0, c: null, px: 0, pz: 0, peek: false };
  // best hiding spot within R of u that is shielded from a threat at (tx,tz); closer to `gx,gz` preferred.
  // returns CS (x,z,c,peek spot) or null
  function findCover(w, u, tx, tz, R, gx, gz, minH) {
    const g = w.coverGrid; if (!g || !g.size) return null;
    const x0 = Math.floor((u.pos.x - R) / CELL), x1 = Math.floor((u.pos.x + R) / CELL), z0 = Math.floor((u.pos.z - R) / CELL), z1 = Math.floor((u.pos.z + R) / CELL);
    let best = 1e9, bc = null, bx = 0, bz = 0, n = 0;
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const a = g.get(key(i, j)); if (!a) continue;
      for (let k = 0; k < a.length; k++) {
        const c = a[k]; if (!c.alive || c.h < minH) continue;
        if (c.def.vault === undefined && c.def.hard === undefined) continue;
        if (c.occ && c.occ !== u.id && w.t - c.occT < 4) continue;
        let dx = c.x - tx, dz = c.z - tz; const dl = Math.hypot(dx, dz); if (dl < 14) continue;
        dx /= dl; dz /= dl;
        const ext = Math.abs(c.hw * (dx * c.c - dz * c.s)) + Math.abs(c.hd * (dx * c.s + dz * c.c));
        const sx = c.x + dx * (ext + 0.9), sz = c.z + dz * (ext + 0.9);
        const dist = Math.hypot(sx - u.pos.x, sz - u.pos.z); if (dist > R) continue;
        const sc = dist + (gx === undefined ? 0 : 0.35 * Math.hypot(sx - gx, sz - gz)) - Math.min(c.h, 2.2) * 2;
        if (sc < best && w.terrain.height(sx, sz) > w.terrain.waterLevel) { best = sc; bc = c; bx = sx; bz = sz; }
        if (++n > 40) break;
      }
    }
    if (!bc) return null;
    CS.c = bc; CS.x = bx; CS.z = bz;
    // peek spot: step to the end of the wall that gives a view, still tucked in
    const c = bc, side = ((u.id + (w.tickN >> 6)) & 1) ? 1 : -1;
    const dx = c.x - tx, dz = c.z - tz, dl = Math.hypot(dx, dz) || 1;
    const vs = (dx * c.s + dz * c.c) >= 0 ? 1 : -1;
    CS.px = c.x + c.c * side * (c.hw + 0.9) + c.s * vs * (c.hd + 0.5);
    CS.pz = c.z - c.s * side * (c.hw + 0.9) + c.c * vs * (c.hd + 0.5);
    return CS;
  }
  // is a point screened from a threat by an (alive) piece? uses chest height
  const tmpP = V.make(), tmpQ = V.make();
  function covered(w, x, z, tx, tz, h) {
    tmpP.x = tx; tmpP.y = w.terrain.ground(tx, tz) + 1.5; tmpP.z = tz;
    tmpQ.x = x; tmpQ.y = w.terrain.ground(x, z) + (h || 1.0); tmpQ.z = z;
    return blocks(w, tmpP, tmpQ);
  }
  // nearest alive piece to a point (for engineers, repair targets)
  function coverNear(w, x, z, R, pred) {
    const g = w.coverGrid; if (!g || !g.size) return null;
    const x0 = Math.floor((x - R) / CELL), x1 = Math.floor((x + R) / CELL), z0 = Math.floor((z - R) / CELL), z1 = Math.floor((z + R) / CELL);
    let best = null, bd = R * R;
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const a = g.get(key(i, j)); if (!a) continue;
      for (let k = 0; k < a.length; k++) { const c = a[k]; if (!c.alive || (pred && !pred(c))) continue; const d = (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z); if (d < bd) { bd = d; best = c; } }
    }
    return best;
  }

  // ── net ──────────────────────────────────────────────────────
  S.net = S.net || { unit: {}, world: {} };
  S.net.world.cover = {
    pack(w) {
      const dm = [], dy = [];
      const cv = w.cover || [];
      for (let i = 0; i < cv.length; i++) {
        const c = cv[i];
        if (c.dyn) { if (c.alive) dy.push([c.id, c.type, Math.round(c.x * 10) / 10, Math.round(c.z * 10) / 10, Math.round(c.yaw * 100) / 100, Math.round(c.hp / c.maxHp * 100), Math.round(c.y * 10) / 10, Math.round(c.hw * 20) / 10]); }
        else if (!c.alive) dm.push([c.id, 0]); else if (c.hp < c.maxHp) dm.push([c.id, Math.max(1, Math.round(c.hp / c.maxHp * 100))]);
      }
      return { s: dm, d: dy };
    },
    apply(w, d) {
      if (!w.cover && w._base) { w.cover = w._base.cover; }
      if (!w._coverStatic) { w._coverStatic = (w.cover || []).filter(c => !c.dyn); w._coverById = new Map(); for (const c of w._coverStatic) w._coverById.set(c.id, c); }
      for (const c of w._coverStatic) { c.hp = c.maxHp; c.alive = true; c.stage = 0; c.h = c.h0; }
      for (const r of d.s) {
        const c = w._coverById.get(r[0]); if (!c) continue;
        if (!r[1]) { c.alive = false; c.hp = 0; c.stage = 3; } else { c.hp = c.maxHp * r[1] / 100; c.stage = stageOf(c); c.h = c.h0 * (1 - 0.2 * c.stage); }
      }
      const dyn = [];
      for (const r of d.d) {
        const D = E.COVER[r[1]]; if (!D) continue;
        const hw = r[7] / 2 || D.w[0] / 2, ci = Math.cos(r[4]), si = Math.sin(r[4]);
        dyn.push({ id: r[0], type: r[1], x: r[2], z: r[3], y: r[6], yaw: r[4], hw, hd: D.d / 2, h: D.h, h0: D.h, hp: r[5], maxHp: 100, stage: r[5] > 66 ? 0 : r[5] > 33 ? 1 : 2, alive: true, dyn: true, c: ci, s: si, def: D, round: !!D.round });
      }
      w.cover = w._coverStatic.concat(dyn);
    },
  };

  S.systems.push(coverSystem);
  Object.assign(S, { genCover, addCover, collideCover: collide, coverBlockedAt: blockedAt, coverDamage, breakCover, repairCover, blastCover, buildBarrier, leaveWreck, findCover, coverCovered: covered, coverNear, COVER_CELL: CELL });
})(window.E = window.E || {});
