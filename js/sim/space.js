// SPACE (core): capital ships as enormous, damageable machines — hull and
// subsystem model, directional shield arcs, power distribution, helm with
// inertia, gun batteries, point defence, orbital strikes and fleet deployment.
// The fleet AI, battle stages and player command live in space_fleet.js and
// the zero-G boarding actions in space_board.js.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  const tmpA = V.make(), tmpB = V.make(), tmpC = V.make(), tmpD = V.make(), tmpE = V.make();
  const SP = E.SPACE, ORDER = SP.order, ARCS = SP.arcs;
  // capital ships hold station in the orbit band (kept for compatibility)
  const CAP_ALT = S.ALT ? S.ALT.orbit : 3200, ORBIT_R = 1150;

  // ── per-tick fleet lists (rebuilt once per tick, shared by every ship) ──
  function lists(w) {
    let L = w._sp;
    if (!L) L = w._sp = { tick: -1, n: -1, caps: { aegis: [], verdant: [] }, fighters: { aegis: [], verdant: [] }, all: [] };
    if (L.tick === w.tickN && L.n === w.units.length) return L;
    L.tick = w.tickN; L.n = w.units.length;
    L.caps.aegis.length = L.caps.verdant.length = L.fighters.aegis.length = L.fighters.verdant.length = L.all.length = 0;
    for (let i = 0; i < w.units.length; i++) {
      const u = w.units[i]; if (!u.alive) continue;
      if (u.kind === 'capital') { L.caps[u.team].push(u); L.all.push(u); }
      else if (u.kind === 'fighter') L.fighters[u.team].push(u);
    }
    return L;
  }
  const capsOf = (w, team) => lists(w).caps[team];

  // ── construction ─────────────────────────────────────────────
  function buildGuns(u) {
    const d = u.def, L = d.len, g = [];
    for (let i = 0; i < d.main; i++) g.push({ wk: 'turbo', t: 1 + i * 0.7, lx: 0, ly: d.h * 0.55, lz: E.lerp(-0.12, 0.34, d.main > 1 ? i / (d.main - 1) : 0.5) * L, slot: 'main' });
    for (let s = -1; s <= 1; s += 2) for (let i = 0; i < d.side; i++)
      g.push({ wk: 'broadside', t: 0.5 + i * 0.3, lx: s * d.r * 0.36, ly: 0, lz: E.lerp(-0.3, 0.3, d.side > 1 ? i / (d.side - 1) : 0.5) * L, slot: 'side', s });
    for (let i = 0; i < d.pd; i++) g.push({ wk: 'flak', t: i * 0.1, lx: (i % 2 ? 1 : -1) * d.r * 0.3, ly: (i % 3 - 1) * d.h * 0.4, lz: E.lerp(-0.4, 0.4, i / Math.max(1, d.pd - 1)) * L, slot: 'pd' });
    g.push({ wk: 'torpedo', t: 5, lx: 0, ly: -d.h * 0.3, lz: L * 0.4, slot: 'torp' });
    u.guns = g;
    initCapital(u);
  }
  // subsystems, shield arcs, power and command state
  function initCapital(u) {
    const d = u.def, sys = {};
    for (const n of ORDER) {
      const s = SP.sys[n], hp = Math.max(1, Math.round(u.maxHp * s.hp * SP.sysHpMul));
      sys[n] = { hp, maxHp: hp, alive: true, lx: 0, ly: d.h * s.ly, lz: d.len * s.lz, r: Math.max(14, d.r * s.r), hitT: 99, mark: 0 };
    }
    u.sys = sys;
    if (u.ai) { u.ai.face = 1; u.ai.aggr = 1; u.ai.pref = 0; u.ai.faceT = 0; }
    u.arcs = ARCS.map((n, i) => { const m = u.maxShield * SP.arcShare[i]; return { v: m, max: m, hitT: 99, flareT: 0 }; });
    u.power = SP.power.balanced.slice(); u.powerGoal = SP.power.balanced.slice(); u.powerMode = 0;
    Object.assign(u, { role: d.role, throttle: 0.6, yawRate: 0, braceT: 0, braceCd: 0, coreT: 0, retreat: false, stranded: false, needsEscort: false, threat: 0,
      tgtId: 0, tgtSys: '', launchCd: 0, hullMark: 0, pdKills: 0, pdT: 0, boarding: null, captured: false, boost: false, escortT: 0, pdTgt: null, pdScanT: 0 });
  }

  // world position of a subsystem (the AIR engineer's bombers aim at this)
  function sysPos(u, name, out) {
    const s = u.sys && u.sys[name]; out = out || {};
    if (!s) { out.x = u.pos.x; out.y = u.pos.y; out.z = u.pos.z; return out; }
    const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw);
    out.x = u.pos.x + fx * s.lz - fz * s.lx; out.y = u.pos.y + s.ly; out.z = u.pos.z + fz * s.lz + fx * s.lx;
    return out;
  }
  const sysAlive = (u, n) => !!(u.sys && u.sys[n] && u.sys[n].alive);
  const hullFrac = (u) => u.hp / u.maxHp;
  function shieldFrac(u) { let v = 0, m = 0; for (const a of u.arcs) { v += a.v; m += a.max; } return m > 0 ? v / m : 0; }
  // how far a ship's engines let it manoeuvre, power included
  function engineMul(u) {
    const e = u.sys.engines, base = e.alive ? 0.7 + 0.3 * e.hp / e.maxHp : 0.3;
    return base * (0.65 + u.power[2] * 1.05);
  }
  function weaponMul(u) { return E.clamp(u.power[1] / 0.333, 0.55, 1.7); }
  function liveBatteries(u) { return u.alive && u.sys.batteries.alive && !u.captured; }

  // ── shields, subsystem and hull damage (combat.js hooks) ─────
  function arcAt(u, at, src) {
    let px, pz;
    if (at) { px = at.x - u.pos.x; pz = at.z - u.pos.z; }
    else if (src && src.pos) { px = src.pos.x - u.pos.x; pz = src.pos.z - u.pos.z; } else return 2;
    const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw);
    const lz = (px * fx + pz * fz) / (u.def.len * 0.5), lx = (-px * fz + pz * fx) / u.def.r; // lx > 0 = starboard
    if (Math.abs(lz) > Math.abs(lx)) return lz > 0 ? 0 : 1;
    return lx > 0 ? 3 : 2;
  }
  function capDamage(w, e, d, src, at) {
    if (e.braceT > 0) d *= SP.braceMul;
    e.hitT = 0;
    const i = arcAt(e, at, src), A = e.arcs[i];
    A.hitT = 0;
    if (A.v > 0) {
      const sh = Math.min(A.v, d); A.v -= sh; d -= sh;
      if (A.flareT <= 0 && sh > 0) {
        A.flareT = 0.12;
        w.events.push({ type: 'shieldHit', uid: e.id, team: e.team, arc: i, amt: Math.round(sh), frac: A.v / A.max, pos: at ? V.clone(at) : V.clone(e.pos), by: src.uid || 0 });
      }
      if (A.v <= 0.5) { A.v = 0; w.events.push({ type: 'shieldDown', uid: e.id, team: e.team, arc: i, pos: at ? V.clone(at) : V.clone(e.pos) }); }
    }
    if (d > 0) e.shield = 0; // combat.js drains e.shield next: arcs are the only shield here
    return d;
  }
  // first live subsystem along the shot's path inside the hull
  function sysAlong(u, src, at) {
    let dx, dy, dz;
    if (src && src.vel && (src.vel.x || src.vel.y || src.vel.z)) { dx = src.vel.x; dy = src.vel.y; dz = src.vel.z; }
    else { dx = u.pos.x - at.x; dy = u.pos.y - at.y; dz = u.pos.z - at.z; }
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const pen = u.h * 2.6, pr = src && src.r ? src.r : 0.5;
    let best = null, bt = 1e9;
    for (let k = 0; k < ORDER.length; k++) {
      const s = u.sys[ORDER[k]]; if (!s.alive) continue;
      sysPos(u, ORDER[k], tmpE);
      const rx = tmpE.x - at.x, ry = tmpE.y - at.y, rz = tmpE.z - at.z;
      const t = E.clamp(rx * dx + ry * dy + rz * dz, 0, pen);
      const qx = rx - dx * t, qy = ry - dy * t, qz = rz - dz * t;
      if (qx * qx + qy * qy + qz * qz < (s.r + pr) * (s.r + pr) && t < bt) { bt = t; best = ORDER[k]; }
    }
    return best;
  }
  function stageOf(w, team) { return (team && w.space && w.space[team]) ? w.space[team].stage : 0; }
  function capHull(w, e, d, src, at) {
    const st = stageOf(w, src.team), screen = e.def.role === 'screen';
    const hm = st && !screen ? SP.stageHull[st - 1] : 1, sm = st && !screen ? SP.stageSys[st - 1] : 1;
    const name = at ? sysAlong(e, src, at) : null;
    if (name) {
      damageSys(w, e, name, d * SP.sysShare * sm, src, at);
      return d * SP.hullShare * hm;
    }
    return d * hm;
  }
  function damageSys(w, u, name, amt, src, at) {
    const s = u.sys[name]; if (!s.alive) return;
    s.hp -= amt; s.hitT = 0;
    const f = Math.max(0, s.hp) / s.maxHp, mk = f <= 0 ? 3 : f < 0.25 ? 2 : f < 0.5 ? 1 : 0;
    if (s.hp <= 0) { destroySys(w, u, name, src); return; }
    if (mk > s.mark) {
      s.mark = mk;
      w.events.push({ type: 'sysDamaged', uid: u.id, team: u.team, sys: name, frac: f, pos: sysPos(u, name, {}), by: src && src.uid || 0, wk: src && src.wk || '' });
    }
  }
  function destroySys(w, u, name, src, cause) {
    const s = u.sys[name]; if (!s.alive) return;
    s.hp = 0; s.alive = false; s.mark = 3;
    if (!w.spaceLog) w.spaceLog = [];
    if (w.spaceLog.length < 400) w.spaceLog.push({ t: w.t, uid: u.id, team: u.team, type: u.type, sys: name });
    w.events.push({ type: 'sysDestroyed', uid: u.id, team: u.team, sys: name, label: SP.sys[name].label, pos: sysPos(u, name, {}), by: src && src.uid || 0, byPid: src && src.owner || null, wk: (src && src.wk) || cause || '' });
    if (name === 'reactor' && u.coreT <= 0) { u.coreT = SP.coreTime; w.events.push({ type: 'coreBreach', uid: u.id, team: u.team, t: SP.coreTime, pos: V.clone(u.pos) }); }
    if (name === 'bridge') w.events.push({ type: 'announce', key: 'bridgeLost', team: u.team });
    if (u.boarding && name === 'bridge') u.boarding.bridgeDown = true;
  }
  function wrapCtl() {
    const C = S.ctl = S.ctl || {};
    C.capital = Object.assign(C.capital || {}, { damage: capDamage, hull: capHull, death: capDeath });
  }
  function capDeath(w, e, src) {
    if (w._sp) w._sp.tick = -1;
    if (S.boardingEvacuate) S.boardingEvacuate(w, e, 'shipLost');
    w.events.push({ type: 'shipDestroyed', uid: e.id, team: e.team, utype: e.type, pos: V.clone(e.pos), by: src.uid || 0, wk: src.wk || '' });
    if (S.reportShip) S.reportShip(w, e, 'destroyed');
  }

  // ── per-tick ship state: shields, power, brace, core, command effects ──
  function capTick(w, u, dt) {
    for (let k = 0; k < ORDER.length; k++) u.sys[ORDER[k]].hitT += dt;
    if (u.braceT > 0) u.braceT -= dt; if (u.braceCd > 0) u.braceCd -= dt; if (u.launchCd > 0) u.launchCd -= dt;
    // power eases toward its goal and always sums to 1
    let sum = 0;
    for (let i = 0; i < 3; i++) { u.power[i] += E.clamp(u.powerGoal[i] - u.power[i], -0.3 * dt, 0.3 * dt); sum += u.power[i]; }
    for (let i = 0; i < 3; i++) u.power[i] /= sum;
    // shields: arcs regenerate on their own clocks; no generator, no shield
    const gen = u.sys.shield.alive, pw = u.power[0] / 0.333, bridge = u.sys.bridge.alive ? 1 : 0.6;
    let v = 0, m = 0;
    for (let i = 0; i < 4; i++) {
      const A = u.arcs[i]; A.hitT += dt; if (A.flareT > 0) A.flareT -= dt;
      if (!gen) A.v = Math.max(0, A.v - A.max * 0.3 * dt);
      else if (A.hitT > SP.regenDelay && A.v < A.max) { A.v = Math.min(A.max, A.v + A.max * SP.regenRate * pw * bridge * dt); if (A.v >= A.max) A.v = A.max; }
      v += A.v; m += A.max;
    }
    u.shield = v; u.maxShield = m;
    if (!gen && !u.shieldCollapsed) { u.shieldCollapsed = true; w.events.push({ type: 'shieldCollapse', uid: u.id, team: u.team, pos: V.clone(u.pos) }); }
    // hull thresholds
    const hf = hullFrac(u);
    while (u.hullMark < 3 && hf < [0.75, 0.5, 0.25][u.hullMark]) {
      w.events.push({ type: 'hullBreach', uid: u.id, team: u.team, frac: hf, level: ++u.hullMark, pos: V.clone(u.pos) });
    }
    // reactor core breach: the ship is lost unless the clock is beaten by nothing at all
    if (u.coreT > 0) {
      u.coreT -= dt;
      if (u.coreT <= 0) { u.coreT = 0; S.kill(w, u, { team: null, uid: 0, owner: null, wk: 'reactor' }); }
    }
    if (u.captured && u.mutinyT > 0) u.mutinyT -= dt;
  }

  // ── helm: thrust along the heading, rotation by torque, velocity that drifts ──
  function stepCapital(w, u, dt, turn, throttle) {
    const d = u.def, eng = engineMul(u) * (u.boost ? 1.3 : 1);
    const maxSpd = u.speed * eng, acc = u.speed * 0.07 * eng;
    u.spd += E.clamp(throttle * maxSpd - u.spd, -acc * dt, acc * dt);
    const om = d.turn * eng, al = om * 0.45;
    u.yawRate += E.clamp(turn * om - u.yawRate, -al * dt, al * dt);
    u.yaw += u.yawRate * dt;
    u.roll += (E.clamp(u.yawRate / Math.max(0.01, om), -1, 1) * 0.1 - u.roll) * Math.min(1, dt * 0.5);
    const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw), k = Math.min(1, dt * 0.35);
    u.vel.x += (fx * u.spd - u.vel.x) * k; u.vel.z += (fz * u.spd - u.vel.z) * k;
    u.pos.x += u.vel.x * dt; u.pos.z += u.vel.z * dt;
    const ty = (u.alt || CAP_ALT) + Math.sin(w.t * 0.13 + u.id) * 8, ny = u.pos.y + (ty - u.pos.y) * Math.min(1, dt * 0.3);
    u.vel.y = (ny - u.pos.y) / dt; u.pos.y = ny;
    const B = w.layout.bound * (u.retreat ? 1.7 : 0.9), hd = Math.hypot(u.pos.x, u.pos.z);
    if (hd > B) { u.pos.x *= B / hd; u.pos.z *= B / hd; }
    u.aimYaw = u.yaw;
  }

  // ── gun batteries ────────────────────────────────────────────
  function gunPos(u, g, o) {
    const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw);
    o.x = u.pos.x + fx * g.lz - fz * g.lx; o.y = u.pos.y + g.ly; o.z = u.pos.z + fz * g.lz + fx * g.lx;
    return o;
  }
  const flank = (u, p) => ((p.x - u.pos.x) * -Math.cos(u.yaw) + (p.z - u.pos.z) * Math.sin(u.yaw)) >= 0 ? 1 : -1;
  // focus = enemy ship to hit with the main battery and torpedoes; fsys = subsystem to aim at
  function capitalGuns(w, u, dt, focus, fsys, boost) {
    const L = lists(w), en = u.team === 'aegis' ? 'verdant' : 'aegis';
    let caps = L.caps[en], fi = L.fighters[en];
    if (w.cfg.fog) { const v = S.vision(w, u.team); caps = caps.filter((e) => v.has(e.id)); fi = fi.filter((e) => v.has(e.id)); }
    const dm = E.DOCTRINE[u.team].capDmg, wm = weaponMul(u) * (u.captured ? 0.7 : 1);
    const bridge = u.sys.bridge.alive, braced = u.braceT > 0;
    if (focus && (!focus.alive || focus.team === u.team)) focus = null;
    let near = null, nd = 1e12, sp = null, spd2 = 1e12, sm = null, smd2 = 1e12;
    for (let i = 0; i < caps.length; i++) {
      const e = caps[i], d2 = V.distance2(e.pos, u.pos);
      if (d2 < nd) { nd = d2; near = e; }
      if (flank(u, e.pos) > 0) { if (d2 < spd2) { spd2 = d2; sp = e; } } else if (d2 < smd2) { smd2 = d2; sm = e; }
    }
    // point-defence target: refreshed a few times a second
    u.pdScanT -= dt;
    if (u.pdScanT <= 0) {
      u.pdScanT = 0.15; u.pdTgt = null; let bd = 700 * 700;
      for (let i = 0; i < fi.length; i++) { const d2 = V.distance2(fi[i].pos, u.pos); if (d2 < bd) { bd = d2; u.pdTgt = fi[i]; } }
    }
    const err = bridge ? 0.004 : 0.03, pdOK = !u.pdTgt || u.pdTgt.alive;
    for (let gi = 0; gi < u.guns.length; gi++) {
      const g = u.guns[gi];
      g.t -= dt * wm * (boost && g.slot === 'main' ? 1.5 : 1);
      if (g.t > 0) continue;
      const W = E.WEAPONS[g.wk];
      let tg = null;
      if (g.slot === 'pd') { tg = pdOK ? u.pdTgt : null; if (!bridge && w.rng.next() < 0.4) tg = null; }
      else {
        if (braced || (g.slot === 'main' && !u.sys.batteries.alive)) { g.t = 0.5; continue; }
        if (g.slot === 'side') tg = g.s > 0 ? sp : sm;
        else tg = focus || near;
        if (g.slot === 'torp' && !u.sys.hangar.alive && u.role !== 'line' && u.role !== 'flagship') { g.t = 1; continue; }
      }
      if (!tg) { g.t = 0.25; continue; }
      gunPos(u, g, tmpA);
      if (V.distance(tmpA, tg.pos) > W.range + (tg.kind === 'capital' ? tg.def.r : 0)) {
        if (g.slot === 'main' && tg !== near && near && V.distance(tmpA, near.pos) <= W.range) tg = near; else { g.t = 0.4; continue; }
      }
      g.t = (W.cd || 1 / W.rate) * (0.85 + w.rng.next() * 0.3);
      if (tg.kind === 'capital') {
        const ab = (g.slot === 'main' || g.slot === 'torp') && tg === focus && fsys && tg.sys[fsys].alive;
        if (ab) sysPos(tg, fsys, tmpB);
        else { // rake the hull, not just the center
          S.centerOf(tg, tmpB);
          const k = (w.rng.next() - 0.5) * tg.def.len * 0.9; tmpB.x += Math.sin(tg.yaw) * k; tmpB.z += Math.cos(tg.yaw) * k; tmpB.y += (w.rng.next() - 0.5) * tg.h * 0.6;
        }
        const t = V.distance(tmpA, tmpB) / W.speed; tmpB.x += tg.vel.x * t; tmpB.z += tg.vel.z * t;
      } else S.leadPoint(u, tg, W, tmpB);
      const dir = V.normalize(V.sub(tmpB, tmpA, tmpC));
      if (err > 0.01) { dir.x += w.rng.gauss() * err; dir.y += w.rng.gauss() * err; dir.z += w.rng.gauss() * err; V.normalize(dir, dir); }
      S.shoot(w, u, g.wk, tmpA, dir, g.slot === 'torp' ? tg.id : 0, dm);
    }
  }

  // ── point defence against torpedoes and missiles; escort requests; pd kills ──
  function pdSystem(w, dt) {
    const P = w.projectiles, L = lists(w);
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      if (p.wk !== 'torpedo' && p.wk !== 'missile' && p.wk !== 'ptorp') continue;
      const caps = L.caps[p.team === 'aegis' ? 'verdant' : 'aegis'];
      for (let k = 0; k < caps.length; k++) {
        const c = caps[k], d2 = V.distance2(c.pos, p.pos), env = 450 + c.def.r;
        if (d2 > env * env) continue;
        const npd = c.def.pd * (c.sys.bridge.alive ? 1 : 0.5) * weaponMul(c) * (p.wk === 'ptorp' ? 0.5 : 1);   // proton torpedoes are harder to intercept
        if (w.rng.next() < 1 - Math.exp(-0.12 * npd * dt)) {
          c.pdKills++;
          w.events.push({ type: 'pdIntercept', uid: c.id, team: c.team, wk: p.wk, pos: V.clone(p.pos), by: p.uid });
          w.events.push({ type: 'impact', pid: p.id, wk: p.wk, pos: V.clone(p.pos), surf: 'air', splash: 0, team: p.team, big: false });
          P[i] = P[P.length - 1]; P.pop();
          break;
        }
      }
    }
    // flak kills and fighters crossing the envelope
    const ev = w.events;
    if ((w._evScan || 0) > ev.length) w._evScan = 0;
    for (let i = w._evScan || 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.type === 'death' && e.kind === 'fighter' && e.wk === 'flak' && e.by) {
        const s = w.umap.get(e.by); if (s && s.kind === 'capital') { s.pdKills++; ev.push({ type: 'pdKill', uid: s.id, team: s.team, victim: e.uid, utype: e.utype, pos: e.pos }); }
      }
    }
    w._evScan = ev.length;
  }

  // escort requests: bombers or torpedoes on a ship with no interceptors near
  function escortSystem(w, dt) {
    if (w.tickN % 15 !== 0) return;
    const L = lists(w);
    for (const u of L.all) {
      const en = u.team === 'aegis' ? 'verdant' : 'aegis';
      let threat = 0, cover = 0;
      for (const f of L.fighters[en]) if ((f.type === 'bomber' || f.type === 'strike') && V.distance2(f.pos, u.pos) < 1400 * 1400) threat++;
      for (const p of w.projectiles) if ((p.wk === 'torpedo' || p.wk === 'ptorp') && p.team === en && V.distance2(p.pos, u.pos) < 1000 * 1000) threat++;
      for (const f of L.fighters[u.team]) if (f.type === 'interceptor' && V.distance2(f.pos, u.pos) < 1000 * 1000) cover++;
      const need = threat > 0 && cover < 2;
      u.threat = threat; u.escortT -= 0.5;
      if (need && (!u.needsEscort || u.escortT <= 0)) { u.escortT = 10; w.events.push({ type: 'escortRequest', uid: u.id, team: u.team, pos: V.clone(u.pos), threat }); }
      u.needsEscort = need;
    }
  }
  // ships that want fighter cover / systems a bomber could attack (for the AIR AI)
  function needsEscort(w, team) { return capsOf(w, team).filter(u => u.needsEscort); }
  function bombTargets(w, team) { // enemy ships' live subsystems whose shield arc is open or generator dead
    const out = [];
    for (const c of capsOf(w, team === 'aegis' ? 'verdant' : 'aegis')) { if (w.cfg.fog && !S.visible(w, team, c)) continue; for (const n of ORDER) if (c.sys[n].alive) out.push({ ship: c, sys: n, pos: sysPos(c, n, {}), exposed: !c.sys.shield.alive || shieldFrac(c) < 0.3 }); }
    return out;
  }

  // ── orbital strikes ──────────────────────────────────────────
  function strikeShips(w, team) {
    const o = []; for (const u of capsOf(w, team)) if (liveBatteries(u) && u.sys.bridge.alive) o.push(u); return o;
  }
  // returns true if a strike was launched
  function strike(w, team, pos, pid) {
    const ships = strikeShips(w, team), en = team === 'aegis' ? 'verdant' : 'aegis';
    if (!ships.length) { w.events.push({ type: 'strikeDenied', team, reason: 'noBattery', pos: V.clone(pos), to: pid || null }); return false; }
    if (S.shielded && S.shielded(w, en, pos)) { w.events.push({ type: 'strikeBlocked', team, pos: V.clone(pos), by: 'groundShield', to: pid || null }); return false; }
    let src = ships[0], bd = 1e12;
    for (const s of ships) { const d = E.distXZ2(s.pos, pos); if (d < bd) { bd = d; src = s; } }
    w.strikes.push({ team, pos: { x: pos.x, y: w.terrain.height(pos.x, pos.z), z: pos.z }, t: 3.2, shots: Math.round(E.WEAPONS.orbital.shots * (0.6 + 0.4 * ships.length)), iv: 0, pid: pid || null, src: src.id, checked: false });
    w.events.push({ type: 'strikeWarn', pos: V.clone(pos), team, r: E.WEAPONS.orbital.splash, src: src.id });
    return true;
  }
  function updateStrikes(w, dt) {
    for (let i = w.strikes.length - 1; i >= 0; i--) {
      const s = w.strikes[i];
      s.t -= dt; if (s.t > 0) continue;
      if (!s.checked) {
        s.checked = true;
        if (S.shielded && S.shielded(w, s.team === 'aegis' ? 'verdant' : 'aegis', s.pos)) { w.events.push({ type: 'strikeBlocked', team: s.team, pos: V.clone(s.pos), by: 'groundShield', to: s.pid }); w.strikes.splice(i, 1); continue; }
      }
      s.iv -= dt;
      if (s.iv <= 0 && s.shots > 0) {
        s.iv = 0.32; s.shots--;
        let cap = w.umap.get(s.src); if (!cap || !cap.alive || !liveBatteries(cap)) cap = strikeShips(w, s.team)[0] || null;
        if (!cap) { w.strikes.splice(i, 1); w.events.push({ type: 'strikeDenied', team: s.team, reason: 'noBattery', pos: V.clone(s.pos), to: s.pid }); continue; }
        const o = { x: cap.pos.x, y: cap.pos.y - cap.h, z: cap.pos.z };
        const a = w.rng.angle(), r = w.rng.f(0, 15);
        const tx = s.pos.x + Math.cos(a) * r - o.x, ty = s.pos.y - o.y, tz = s.pos.z + Math.sin(a) * r - o.z, l = Math.hypot(tx, ty, tz);
        const W = E.WEAPONS.orbital, speed = 1500;
        const p = { id: w.nextProj++, wk: 'orbital', kind: 'turbo', pos: V.clone(o), vel: { x: tx / l * speed, y: ty / l * speed, z: tz / l * speed },
          team: s.team, uid: cap.id, owner: s.pid, dmg: W.dmg, life: l / speed + 1, splash: W.splash, grav: 0, seek: 0, tid: 0, r: 1, scale: 5 };
        w.projectiles.push(p);
        w.events.push({ type: 'fire', pid: p.id, wk: 'orbital', pos: V.clone(p.pos), vel: V.clone(p.vel), team: s.team, uid: p.uid, life: p.life });
      }
      if (s.shots <= 0) w.strikes.splice(i, 1);
    }
  }
  // strength of a side's grip on the sky, 0..1 (1 = the enemy has no fleet)
  function orbitalSuperiority(w, team) {
    const pw = (t) => { let p = 0; for (const u of capsOf(w, t)) p += (u.hp + shieldFrac(u) * u.def.shield) * (u.sys.batteries.alive ? 1 : 0.4); return p; };
    const a = pw(team), b = pw(team === 'aegis' ? 'verdant' : 'aegis');
    return a + b > 0 ? a / (a + b) : 0.5;
  }
  // strike cooldown follows the sky: no battery, no strikes; command of orbit speeds them
  function strikeSystem(w, dt) {
    for (const f of E.TEAMS) {
      const T = w.teams[f];
      if (!strikeShips(w, f).length) { if (T.strikeT < 5) T.strikeT = 5; continue; }
      if (T.strikeT > 0) T.strikeT -= dt * E.clamp((orbitalSuperiority(w, f) - 0.5) * 0.8, -0.3, 0.4);
    }
  }

  // ── fleet deployment (called from sim.js setup) ──────────────
  function carrierFor(w, team, i) {
    const c = capsOf(w, team).filter(u => u.sys.hangar.alive && u.def.wing && !u.captured);
    if (!c.length) return null;
    let n = 0; for (const u of c) n += u.role === 'carrier' ? 3 : 1;
    let k = (i !== undefined ? i : (w.tickN / 6) | 0) % n;
    for (const u of c) { k -= u.role === 'carrier' ? 3 : 1; if (k < 0) return u; }
    return c[0];
  }
  function deployFleet(w, f) {
    const T = w.teams[f], sgn = f === 'aegis' ? -1 : 1;
    let list = T.fleet.filter(t => E.CAPITALS[t]);
    if (!list.some(t => E.CAPITALS[t].role === 'screen')) list = list.concat(T.scale > 1.3 ? ['frigate', 'frigate', 'frigate'] : ['frigate', 'frigate']);
    T.fleet = list;
    let nl = 0, nc = 0, ns = 0, first = true;
    list.forEach((type) => {
      const d = E.CAPITALS[type]; let x, z, ao;
      if (d.role === 'screen') { x = sgn * 800; z = (ns % 2 ? 1 : -1) * (300 + Math.floor(ns / 2) * 280); ns++; ao = 20; }
      else if (d.role === 'carrier') { x = sgn * 1550; z = (nc % 2 ? 1 : -1) * (300 + Math.floor(nc / 2) * 500); nc++; ao = -50; }
      else { x = sgn * 1150; z = (nl % 2 ? 1 : -1) * Math.ceil(nl / 2) * 780; nl++; ao = d.role === 'flagship' ? 0 : 40; }
      const alt = (S.ALT ? S.ALT.orbit : CAP_ALT) + ao + (w.rng.next() - 0.5) * 20;
      const flag = first && d.role !== 'screen'; if (flag) first = false;
      S.spawnUnit(w, 'capital', type, f, { x, y: alt, z }, { yaw: f === 'aegis' ? 0 : Math.PI, orbitR: Math.hypot(x, z), alt, flag });
    });
    const fl = capsOf(w, f); lists(w).tick = -1; void fl;
    for (const u of w.units) if (u.kind === 'capital' && u.team === f) { u.ai.face = w.rng.sign(); u.ai.aggr = 0.85 + w.rng.next() * 0.35; u.ai.pref = w.rng.i(3); u.ai.faceT = 0; }
  }

  Object.assign(S, { buildGuns, initCapital, stepCapital, gunPos, capitalGuns, strike, updateStrikes, CAP_ALT, ORBIT_R, lists, capsOf, sysPos, sysAlive, hullFrac, shieldFrac,
    engineMul, weaponMul, liveBatteries, capTick, damageSys, destroySys, needsEscort, bombTargets, orbitalSuperiority, strikeShips, carrierFor, deployFleet, arcAt, capDamage, capHull });
  // combat.js sustain() runs before the systems: keep the aggregate equal to the arcs
  function shieldSync(w) { for (const u of lists(w).all) if (u.alive && u.arcs) { let v = 0; for (const a of u.arcs) v += a.v; u.shield = v; } }
  S.systems.push(pdSystem, escortSystem, strikeSystem, shieldSync);
  wrapCtl();
})(window.E = window.E || {});
