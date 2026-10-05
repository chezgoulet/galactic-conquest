// SPACE (boarding): marines launched from a hangar cross to an enemy capital,
// breach it where the shields are down and fight the crew in a compact deck
// complex inside the hull (low-gravity, magnetic boots). Their units run in
// mode 'boarding': deck-local coordinates are stored on u.board and u.pos is
// derived from the moving ship every tick. Holding a node sabotages the matching
// subsystem; holding the bridge captures the ship.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3, SP = E.SPACE;

  // ── the deck complex (zone-local meters: x = right, z = forward, y = up) ──
  const DECKS = [
    { id: 'dock',   cx: 0,   cz: -45, hx: 16, hz: 14, y: 0 },
    { id: 'corr',   cx: 0,   cz: -10, hx: 7,  hz: 40, y: 2 },
    { id: 'shield', cx: 24,  cz: -5,  hx: 20, hz: 14, y: 4 },
    { id: 'engine', cx: -26, cz: 10,  hx: 21, hz: 16, y: -1.5 },
    { id: 'bridge', cx: 0,   cz: 46,  hx: 18, hz: 18, y: 5.5 },
  ];
  const LINK = [{ x: 0, z: -42 }, null, { x: 5.5, z: -5 }, { x: -6, z: 10 }, { x: 0, z: 29 }];
  const ADJ = [[1], [0, 2, 3, 4], [1], [1], [1]];
  const NODES = { shield: { deck: 2, x: 30, z: -5 }, reactor: { deck: 3, x: -34, z: 10 }, bridge: { deck: 4, x: 0, z: 52 } };
  const NODE_R = 7, STEP = 4.6, LOWG = 2.5, CEIL = 14;
  const ZONE_LZ = -0.2; // zone origin along the hull (fraction of length)
  const inDeck = (d, x, z) => Math.abs(x - d.cx) <= d.hx && Math.abs(z - d.cz) <= d.hz;
  // what the boarding party goes for: crack the shields first, then take the
  // bridge; a couple always peel off toward the reactor.
  const planAgainst = (ship) => ship.sys.shield.alive
    ? ['shield', 'shield', 'bridge', 'shield', 'bridge', 'reactor']
    : ['bridge', 'bridge', 'reactor', 'bridge', 'shield', 'reactor'];

  // ── placement: deck-local -> world, riding the ship ──────────
  function place(w, u) {
    const b = u.board, ship = w.umap.get(b.ship); if (!ship) return false;
    const fx = Math.sin(ship.yaw), fz = Math.cos(ship.yaw), lz = ship.def.len * ZONE_LZ + b.z, lx = b.x;
    u.pos.x = ship.pos.x + fx * lz - fz * lx; u.pos.z = ship.pos.z + fz * lz + fx * lx;
    u.pos.y = ship.pos.y + ship.h * 0.25 + b.y;
    const wx = fx * b.vz - fz * b.vx, wz = fz * b.vz + fx * b.vx;
    u.vel.x = ship.vel.x + wx; u.vel.z = ship.vel.z + wz; u.vel.y = ship.vel.y + b.vy;
    u.onGround = !b.air;
    return true;
  }
  // world move direction -> deck-local (rotate by the ship's yaw)
  function toLocal(ship, wx, wz, o) { const fx = Math.sin(ship.yaw), fz = Math.cos(ship.yaw); o.x = -wx * fz + wz * fx; o.z = wx * fx + wz * fz; return o; }
  const tl = { x: 0, z: 0 };

  // one movement step: magnetic walking on a deck, thrust jumps in the air
  function move(w, u, dt, wx, wz, speed, jump, hold) {
    const b = u.board, ship = w.umap.get(b.ship); if (!ship) return;
    toLocal(ship, wx, wz, tl);
    const k = Math.min(1, dt * (b.air ? 1.2 : 12));
    b.vx += (tl.x * speed - b.vx) * k; b.vz += (tl.z * speed - b.vz) * k;
    if (jump && !b.air) { b.air = true; b.vy = 5.2; }
    if (b.air) { b.vy += (hold ? 4.5 : -LOWG) * dt; b.vy = E.clamp(b.vy, -6, 6.5); }
    let nx = b.x + b.vx * dt, nz = b.z + b.vz * dt;
    const cur = DECKS[b.deck];
    if (b.air) { // airborne: any deck footprint is open space, walls elsewhere
      let ok = false; for (const d of DECKS) if (inDeck(d, nx, nz)) { ok = true; break; }
      if (!ok) { nx = E.clamp(nx, cur.cx - cur.hx, cur.cx + cur.hx); nz = E.clamp(nz, cur.cz - cur.hz, cur.cz + cur.hz); b.vx *= -0.3; b.vz *= -0.3; }
      b.x = nx; b.z = nz; b.y += b.vy * dt;
      if (b.y > CEIL) { b.y = CEIL; b.vy = Math.min(0, b.vy); }
      if (b.vy <= 0) { // land on the highest floor under us
        let bd = -1, by = -99;
        for (let i = 0; i < DECKS.length; i++) if (inDeck(DECKS[i], b.x, b.z) && DECKS[i].y <= b.y + 0.4 && DECKS[i].y > by) { by = DECKS[i].y; bd = i; }
        if (bd >= 0 && b.y <= by + 0.05) { b.deck = bd; b.y = by; b.vy = 0; b.air = false; }
        else if (bd < 0 || b.y < -6) { b.deck = b.deck; b.y = Math.max(b.y, cur.y); }
      }
    } else {
      const trySet = (x, z) => {
        if (inDeck(cur, x, z)) { b.x = x; b.z = z; return true; }
        for (const j of ADJ[b.deck]) if (inDeck(DECKS[j], x, z) && Math.abs(DECKS[j].y - b.y) <= STEP) { b.deck = j; b.x = x; b.z = z; return true; }
        return false;
      };
      if (!trySet(nx, nz) && !trySet(nx, b.z) && !trySet(b.x, nz)) { b.vx = b.vz = 0; }
      b.y += (DECKS[b.deck].y - b.y) * Math.min(1, dt * 8);
      if (Math.abs(b.y - DECKS[b.deck].y) < 0.02) b.y = DECKS[b.deck].y;
      b.vy = 0;
    }
    place(w, u);
  }

  // ── fighting ─────────────────────────────────────────────────
  const BOARD_DMG = 0.4;
  function hitscan(w, u, tg, player) {
    const W = E.WEAPONS[u.def.weapon]; if (!W || !W.rate || u.fireT > 0) return false;
    u.fireT += 1 / W.rate;
    const d = V.distance(u.pos, tg.pos), p = E.clamp((player ? 0.85 : 0.6) - d / 160, 0.15, 0.9), hit = w.rng.next() < p;
    w.events.push({ type: 'boardFire', uid: u.id, tid: tg.id, team: u.team, hit, from: V.clone(u.pos), to: V.clone(tg.pos), wk: u.def.weapon });
    if (hit) S.applyDamage(w, tg, W.dmg * BOARD_DMG * (W.vs && W.vs.inf !== undefined ? W.vs.inf : 1), { wk: u.def.weapon, uid: u.id, team: u.team, owner: u.pid, pos: u.pos }, tg.pos, false);
    u.lastFire = w.t;
    return true;
  }
  function foes(w, u, range) {
    const op = u.board.opx, out = [];
    for (const o of op.units) {
      if (o === u || !o.alive || o.team === u.team) continue;
      if (V.distance2(o.pos, u.pos) < range * range) out.push(o);
    }
    return out;
  }
  function nearestFoe(w, u, range) {
    let best = null, bd = range * range;
    for (const o of u.board.opx.units) { if (o === u || !o.alive || o.team === u.team) continue; const d = V.distance2(o.pos, u.pos); if (d < bd) { bd = d; best = o; } }
    return best;
  }

  // ── AI ───────────────────────────────────────────────────────
  function waypoint(b, node, out) {
    const T = node.deck, cur = b.deck;
    if (cur === T) { out.x = node.x; out.z = node.z; return out; }
    const near = (p) => Math.hypot(b.x - p.x, b.z - p.z) <= 3;
    if (cur !== 1) {
      if (!near(LINK[cur])) { out.x = LINK[cur].x; out.z = LINK[cur].z; return out; }
      if (T === 1) { out.x = node.x; out.z = node.z; return out; }
      out.x = LINK[T].x; out.z = LINK[T].z; return out;
    }
    if (!near(LINK[T])) { out.x = LINK[T].x; out.z = LINK[T].z; return out; }
    out.x = node.x; out.z = node.z; return out;
  }
  const wp = { x: 0, z: 0 };
  function aiBoarding(w, u, dt) {
    const b = u.board, ship = w.umap.get(b.ship); const ai = u.ai;
    if (!ship || !ship.alive || !b.opx || b.opx.status !== 'active') { u.alive = false; return; }
    ai.thinkT -= dt;
    if (ai.thinkT <= 0) { ai.thinkT = 0.25 + w.rng.next() * 0.2; const t = nearestFoe(w, u, 55); ai.tid = t ? t.id : 0; ai.strafe = w.rng.sign(); }
    const tg = ai.tid ? w.umap.get(ai.tid) : null, att = b.side === 'att', node = NODES[b.node];
    let tx, tz, goal = null;
    if (tg && tg.alive && tg.board) { // a fight: close to a good range, keep shooting
      const d = V.distance(tg.pos, u.pos);
      u.yaw = u.aimYaw = Math.atan2(tg.pos.x - u.pos.x, tg.pos.z - u.pos.z);
      if (d < 55) hitscan(w, u, tg, false);
      const wm = d > 22 ? 1 : d < 10 ? -0.6 : 0;
      move(w, u, dt, Math.sin(u.yaw) * wm + Math.cos(u.yaw) * ai.strafe * 0.5, Math.cos(u.yaw) * wm - Math.sin(u.yaw) * ai.strafe * 0.5, u.speed * 0.6, false, false);
      return;
    }
    // no enemy near: attackers push the objective, defenders hold their post
    if (att) goal = waypoint(b, node, wp);
    else { goal = (b.deck === node.deck && Math.hypot(b.x - node.x, b.z - node.z) < 4) ? null : waypoint(b, node, wp); }
    if (goal) {
      const gx = goal.x - b.x, gz = goal.z - b.z, l = Math.hypot(gx, gz);
      if (l > 1) { // deck-local direction -> world
        const fx = Math.sin(ship.yaw), fz = Math.cos(ship.yaw), dx = gx / l, dz = gz / l;
        const wx = fx * dz - fz * dx, wz = fz * dz + fx * dx;
        u.yaw = u.aimYaw = Math.atan2(wx, wz);
        move(w, u, dt, wx, wz, u.speed, false, false);
        return;
      }
    }
    move(w, u, dt, 0, 0, 0, false, false);
  }
  function playerBoarding(w, u, p, dt) {
    const b = u.board, ship = w.umap.get(b.ship); const inp = p.input;
    if (!ship || !ship.alive || !b.opx || b.opx.status !== 'active') { u.alive = false; if (u.pid) { const pl = w.players[u.pid]; if (pl) { pl.unitId = 0; pl.deadT = w.t; } u.pid = null; } return; }
    const mx = E.clamp(inp.mx || 0, -1, 1), mz = E.clamp(inp.mz || 0, -1, 1), my = inp.moveYaw || 0;
    const fx = Math.sin(my), fz = Math.cos(my), rx = -Math.cos(my), rz = Math.sin(my);
    let wx = fx * mz + rx * mx, wz = fz * mz + rz * mx; const l = Math.hypot(wx, wz); if (l > 1) { wx /= l; wz /= l; }
    u.yaw = u.aimYaw = inp.yaw; u.aimPitch = inp.pitch;
    move(w, u, dt, wx, wz, inp.sprint ? u.def.sprint * 0.7 : u.speed, !!inp.jump, !!inp.jump);
    if (inp.fire && u.fireT <= 0) { // aim ray against the other side's fighters
      const dx = Math.sin(inp.yaw) * Math.cos(inp.pitch), dy = Math.sin(inp.pitch), dz = Math.cos(inp.yaw) * Math.cos(inp.pitch);
      let best = null, bs = 0.09;
      for (const o of foes(w, u, 80)) {
        const ox = o.pos.x - u.pos.x, oy = o.pos.y + o.h * 0.5 - (u.pos.y + u.h * 0.8), oz = o.pos.z - u.pos.z, d = Math.hypot(ox, oy, oz) || 1;
        const a = Math.acos(E.clamp((ox * dx + oy * dy + oz * dz) / d, -1, 1)) - Math.atan2(o.r, d);
        if (a < bs) { bs = a; best = o; }
      }
      if (best) hitscan(w, u, best, true); else u.fireT += 0.1;
    }
  }
  S.modes.boarding = { ai: aiBoarding, player: playerBoarding };

  // ── operations ───────────────────────────────────────────────
  function ops(w) { return w.boardings || (w.boardings = []); }
  function breachArc(w, from, target) {
    const arc = S.arcAt(target, from.pos, null);
    return !target.sys.shield.alive || target.arcs[arc].v < 0.2 * target.arcs[arc].max;
  }
  function boardingReady(w, from, target) {
    if (!from || !target || !from.alive || !target.alive || from.team === target.team || target.kind !== 'capital') return false;
    if (!from.sys.hangar.alive) return false;
    if (w.boardCd && w.boardCd[from.team] > w.t) return false;
    for (const o of ops(w)) if (o.status === 'pods' || o.status === 'active') { if (o.team === from.team || o.shipId === target.id) return false; }
    if (V.distance(from.pos, target.pos) > 2200) return false;
    return breachArc(w, from, target);
  }
  function board(w, team, from, target) {
    if (!boardingReady(w, from, target)) { if (from && from.pid) w.events.push({ type: 'boardDenied', uid: from.id, team, tid: target ? target.id : 0, reason: from.sys.hangar.alive ? 'shieldsUp' : 'noHangar' }); return false; }
    const n = SP.boardCrew + (w.teams[team].bonus && w.teams[team].bonus.elite ? 2 : 0);
    // pods run the point-defence gauntlet
    let surv = 0; for (let i = 0; i < n; i++) if (w.rng.next() > 0.1 * target.def.pd * (target.sys.bridge.alive ? 1 : 0.5) / 4 * 0.5) surv++;
    const eta = Math.max(4, V.distance(from.pos, target.pos) / 240);
    const op = { id: w.nextBoard = (w.nextBoard || 0) + 1, team, shipId: target.id, fromId: from.id, status: 'pods', t: 0, eta, launched: n, surv, units: [], nodes: { shield: { p: 0, done: false }, reactor: { p: 0, done: false }, bridge: { p: 0, done: false } }, started: w.t, result: '' };
    ops(w).push(op); target.boarding = op;
    w.events.push({ type: 'boardingLaunched', team, from: from.id, tid: target.id, n, surv, eta, pos: V.clone(from.pos) });
    return true;
  }
  const MIX = ['trooper', 'trooper', 'heavy', 'trooper', 'medic', 'trooper', 'sniper', 'trooper'];
  function spawnAboard(w, op, ship, team, type, node, side, k) {
    const b = { ship: ship.id, deck: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, air: false, side, node, op: op.id, opx: op };
    const d = NODES[node];
    if (side === 'att') { b.deck = 0; b.x = DECKS[0].cx + (k % 3 - 1) * 5; b.z = DECKS[0].cz + ((k / 3) | 0) * 4 - 4; b.y = DECKS[0].y; }
    else { b.deck = d.deck; b.x = d.x + (k % 3 - 1) * 3; b.z = d.z + ((k / 3) | 0) * 3 - 3; b.y = DECKS[d.deck].y; }
    const u = S.spawnUnit(w, 'infantry', type, team, { x: ship.pos.x, y: ship.pos.y, z: ship.pos.z }, { mode: 'boarding', board: b });
    u.yaw = u.aimYaw = ship.yaw; place(w, u); op.units.push(u);
    return u;
  }
  function startBoarding(w, op, ship) {
    op.status = 'active'; op.started = w.t;
    const plan = planAgainst(ship);
    for (let i = 0; i < op.surv; i++) spawnAboard(w, op, ship, op.team, MIX[i % MIX.length], plan[i % plan.length], 'att', i);
    const crew = ship.def.crew, names = ['bridge', 'shield', 'reactor'];
    for (let i = 0; i < crew; i++) spawnAboard(w, op, ship, ship.team, i % 4 === 3 ? 'heavy' : 'trooper', names[i % 3], 'def', (i / 3) | 0);
    w.events.push({ type: 'boardingStart', team: op.team, tid: ship.id, n: op.surv, defenders: crew, pos: V.clone(ship.pos) });
    w.events.push({ type: 'boardingAlarm', uid: ship.id, team: ship.team, by: op.team });
    w.events.push({ type: 'announce', key: 'boardingAlarm', team: ship.team });
  }
  function clearAboard(w, op, silent) {
    for (const u of op.units) if (u.alive) {
      u.alive = false;
      if (u.pid && w.players[u.pid]) { const p = w.players[u.pid]; p.unitId = 0; p.deadT = w.t; u.pid = null; }
    }
  }
  function finish(w, op, result) {
    op.status = result === 'captured' ? 'won' : 'lost'; op.result = result;
    clearAboard(w, op);
    const ship = w.umap.get(op.shipId); if (ship && ship.boarding === op) ship.boarding = null;
    (w.boardCd = w.boardCd || {})[op.team] = w.t + 45;
    w.events.push({ type: 'boardingResult', team: op.team, tid: op.shipId, result, t: w.t - op.started });
    op.endT = w.t;
  }
  function captureShip(w, op, ship) {
    const from = ship.team, to = op.team;
    if (w._sp) w._sp.tick = -1;
    ship.team = to; ship.captured = true; ship.retreat = false; ship.stranded = false; ship.flag = false;
    if (ship.pid && w.players[ship.pid]) { const p = w.players[ship.pid]; p.unitId = 0; p.deadT = w.t; ship.pid = null; }
    const br = ship.sys.bridge; br.alive = true; br.hp = br.maxHp * 0.4; br.mark = 1;
    for (const a of ship.arcs) a.v = Math.max(a.v, a.max * 0.25);
    ship.ai.thinkT = 0; ship.ai.face = w.rng.sign(); ship.ai.aggr = 0.9; ship.tgtId = 0; ship.tgtSys = ''; ship.powerGoal = SP.power.balanced.slice(); ship.powerMode = 0;
    for (const g of ship.guns) g.t = 3;
    if (w.fleetReport) { S.reportShip(w, ship, 'captured'); const f = w.fleetReport[from], i = f.findIndex(x => x.id === ship.id); if (i >= 0) { f[i].status = 'captured'; } }
    w.events.push({ type: 'shipCaptured', uid: ship.id, team: to, from, utype: ship.type, pos: V.clone(ship.pos) });
    w.events.push({ type: 'announce', key: 'shipCaptured', team: to });
    finish(w, op, 'captured');
  }

  function boardingSystem(w, dt) {
    const list = w.boardings; if (!list || !list.length) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const op = list[i], ship = w.umap.get(op.shipId);
      if (op.status === 'won' || op.status === 'lost') { if (w.t - op.endT > 20) list.splice(i, 1); continue; }
      if (!ship || !ship.alive) { clearAboard(w, op); op.status = 'lost'; op.result = 'shipLost'; op.endT = w.t; w.events.push({ type: 'boardingResult', team: op.team, tid: op.shipId, result: 'shipLost', t: w.t - op.started }); continue; }
      op.t += dt;
      if (op.status === 'pods') {
        if (op.t >= op.eta) {
          if (op.surv <= 0) { op.status = 'lost'; op.result = 'podsLost'; op.endT = w.t; ship.boarding = null; w.events.push({ type: 'boardingResult', team: op.team, tid: ship.id, result: 'podsLost', t: op.t }); }
          else startBoarding(w, op, ship);
        }
        continue;
      }
      // node control
      let att = 0, def = 0;
      for (const u of op.units) if (u.alive) { if (u.board.side === 'att') att++; else def++; }
      for (const name in NODES) {
        const nd = op.nodes[name], N = NODES[name]; if (nd.done) continue;
        let na = 0, nf = 0;
        for (const u of op.units) { if (!u.alive) continue; const b = u.board; if (b.deck === N.deck && Math.hypot(b.x - N.x, b.z - N.z) < NODE_R) { if (b.side === 'att') na++; else nf++; } }
        if (na > 0 && nf === 0) nd.p = Math.min(1, nd.p + 0.08 * Math.min(na, 3) * dt);
        else if (nf > 0) nd.p = Math.max(0, nd.p - 0.04 * nf * dt);
        else nd.p = Math.max(0, nd.p - 0.015 * dt);
        if (nd.p >= 1) {
          nd.done = true;
          w.events.push({ type: 'boardNode', uid: ship.id, team: op.team, node: name, state: 'sabotaged' });
          if (name === 'shield') S.destroySys(w, ship, 'shield', null, 'sabotage');
          else if (name === 'reactor') S.destroySys(w, ship, 'reactor', null, 'sabotage');
          else { captureShip(w, op, ship); break; }
        }
      }
      if (op.status !== 'active') continue;
      if (att === 0) finish(w, op, 'repelled');
      else if (w.t - op.started > SP.boardTime) finish(w, op, 'repelled');
    }
  }
  function boardingEvacuate(w, ship, why) {
    for (const op of ops(w)) if (op.shipId === ship.id && (op.status === 'active' || op.status === 'pods')) {
      clearAboard(w, op); op.status = 'lost'; op.result = why; op.endT = w.t;
      w.events.push({ type: 'boardingResult', team: op.team, tid: ship.id, result: why, t: w.t - op.started });
    }
    ship.boarding = null;
  }
  function boardingState(w, team) {
    const o = ops(w).filter(x => (x.team === team || (w.umap.get(x.shipId) || {}).team === team) && (x.status === 'pods' || x.status === 'active'))[0];
    if (!o) return null;
    let att = 0, def = 0; for (const u of o.units) if (u.alive) { if (u.board.side === 'att') att++; else def++; }
    return { id: o.id, status: o.status, attackers: o.team, shipId: o.shipId, marines: att, defenders: def, eta: Math.max(0, o.eta - o.t), tLeft: Math.max(0, SP.boardTime - (w.t - o.started)),
      nodes: { shield: o.nodes.shield.p, reactor: o.nodes.reactor.p, bridge: o.nodes.bridge.p } };
  }
  S.net.world.boarding = {
    pack(w) { return ops(w).filter(o => o.status === 'pods' || o.status === 'active').map(o => [o.id, o.team, o.shipId, o.status === 'active' ? 1 : 0, Math.round(o.nodes.shield.p * 100), Math.round(o.nodes.reactor.p * 100), Math.round(o.nodes.bridge.p * 100), o.units.filter(u => u.alive).map(u => [u.id, u.board.side === 'att' ? 1 : 0])]); },
    apply(w, d) {
      for (const r of d) for (const [id, side] of r[7]) { const u = w.umap.get(id); if (u) { u.mode = 'boarding'; u.board = u.board || {}; u.board.ship = r[2]; u.board.side = side ? 'att' : 'def'; } }
      w.boardings = d.map(r => ({ id: r[0], team: r[1], shipId: r[2], status: r[3] ? 'active' : 'pods', nodes: { shield: { p: r[4] / 100 }, reactor: { p: r[5] / 100 }, bridge: { p: r[6] / 100 } }, units: [], t: 0, eta: 0, started: w.t }));
    },
  };
  S.systems.push(boardingSystem);
  Object.assign(S, { board, boardingReady, boardingEvacuate, boardingState, boardingPlace: place, BOARD_DECKS: DECKS, BOARD_NODES: NODES });
})(window.E = window.E || {});
