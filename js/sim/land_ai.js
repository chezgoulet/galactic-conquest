// LAND AI: squads of infantry that fight from cover, bound forward under their
// own base of fire, flank and retreat; medics and engineers doing their jobs;
// vehicles that escort and kite. Everything here only decides what to do; the
// movement and weapon handling is in land.js.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  const tmpA = V.make(), tmpB = V.make(), tmpC = V.make(), tmpD = V.make();
  const DEST = { x: 0, z: 0, r: 3 };
  const ROLE = { trooper: 'assault', engineer: 'assault', heavy: 'support', sniper: 'support', medic: 'medic' };

  // how much each class wants each kind of target (counters live here)
  const PRIO = {
    trooper:  { trooper: 1, heavy: 1.0, sniper: 1.25, medic: 1.35, engineer: 1.45, v_skiff: 0.45, v_tank: 0.12, v_aa: 0.55, t_battery: 0.12, t_nest: 0.4, t_aabattery: 0.9, t_shieldgen: 0.2, t_ioncannon: 0.2, fighter: 0.05 },
    heavy:    { trooper: 0.8, heavy: 0.8, sniper: 0.9, medic: 0.9, engineer: 0.9, v_skiff: 2.2, v_tank: 2.0, v_aa: 2.2, t_battery: 0.9, t_nest: 0.7, t_aabattery: 1.4, t_shieldgen: 0.35, t_ioncannon: 0.3, fighter: 1.9 },
    sniper:   { trooper: 0.9, heavy: 1.7, sniper: 2.0, medic: 1.9, engineer: 1.9, v_skiff: 0.05, v_tank: 0.02, v_aa: 0.05, t_battery: 0, t_nest: 0.3, t_aabattery: 0.2, t_shieldgen: 0, t_ioncannon: 0, fighter: 0 },
    medic:    { trooper: 1, heavy: 0.9, sniper: 1.2, medic: 1.2, engineer: 1.2, v_skiff: 0.2, v_tank: 0.05, v_aa: 0.2, t_battery: 0.05, t_nest: 0.2, t_aabattery: 0.5, t_shieldgen: 0.05, t_ioncannon: 0.05, fighter: 0 },
    engineer: { trooper: 1, heavy: 0.9, sniper: 1.2, medic: 1.2, engineer: 1.2, v_skiff: 0.3, v_tank: 0.05, v_aa: 0.3, t_battery: 0.05, t_nest: 0.3, t_aabattery: 0.6, t_shieldgen: 0.05, t_ioncannon: 0.05, fighter: 0 },
  };
  const VPRIO = {
    tank: { trooper: 0.9, heavy: 1.1, sniper: 0.9, medic: 0.9, engineer: 1.0, v_skiff: 0.9, v_tank: 1.6, v_aa: 1.3, t_battery: 1.3, t_nest: 0.9, t_aabattery: 1.0, t_shieldgen: 0.5, t_ioncannon: 0.5, fighter: 0 },
    skiff: { trooper: 1, heavy: 0.8, sniper: 1.1, medic: 1.1, engineer: 1.1, v_skiff: 0.9, v_tank: 0.1, v_aa: 0.6, t_battery: 0.1, t_nest: 0.3, t_aabattery: 0.5, t_shieldgen: 0, t_ioncannon: 0, fighter: 0 },
    aa:    { trooper: 0.35, heavy: 0.3, sniper: 0.35, medic: 0.35, engineer: 0.35, v_skiff: 0.3, v_tank: 0.05, v_aa: 0.2, t_battery: 0, t_nest: 0, t_aabattery: 0, t_shieldgen: 0, t_ioncannon: 0, fighter: 3 },
  };
  const keyOf = (e) => e.kind === 'infantry' ? e.type : e.kind === 'vehicle' ? 'v_' + e.type : e.kind === 'turret' ? 't_' + e.type : e.kind;

  // ── squads ───────────────────────────────────────────────────
  function squadOf(w, u) { return u.sq ? (w.sqMap && w.sqMap.get(u.sq)) || null : null; }
  function assignSquad(w, u) {
    if (u.pid || u.kind !== 'infantry') return;
    w.sqMap = w.sqMap || new Map();
    let best = null, bd = 80 * 80;
    for (const s of w.squads) {
      if (s.team !== u.team || s.ids.length >= 5) continue;
      const d = (s.cx - u.pos.x) * (s.cx - u.pos.x) + (s.cz - u.pos.z) * (s.cz - u.pos.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) {
      best = { id: w.squadId++, team: u.team, ids: [], cx: u.pos.x, cz: u.pos.z, goal: null, goalT: 0, contact: null, focus: 0, advance: true, flank: null, flankT: -99, flankSign: w.rng.sign(), n: 0, born: w.t };
      w.squads.push(best); w.sqMap.set(best.id, best);
    }
    best.ids.push(u.id); u.sq = best.id;
  }
  function chooseSquadGoal(w, sq) {
    const R = w.rng, en = S.enemyOf(sq.team);
    let best = null, bs = 0;
    for (const c of w.cps) {
      const d = Math.hypot(c.pos.x - sq.cx, c.pos.z - sq.cz);
      let s;
      if (c.owner !== sq.team) s = (c.owner ? 1 : 1.25) * (c.n[sq.team] > 0 ? 1.25 : 1) / (d + 160);
      else if (c.n[en] > 0 || Math.abs(c.cap) < 0.99) s = 1.8 / (d + 160);
      else continue;
      let taken = 0; for (const o of w.squads) if (o !== sq && o.team === sq.team && o.goal && o.goal.cp === c.id) taken++;
      s *= (0.6 + R.next() * 0.8) / (1 + 0.7 * taken);
      if (s > bs) { bs = s; best = { x: c.pos.x, z: c.pos.z, r: c.r * 0.7, cp: c.id, uid: 0 }; }
    }
    // go after enemy structures when the line is ours, and objective sites
    if (w.cps.filter(c => c.owner === sq.team).length >= 3 && R.next() < 0.22) {
      let tgt = null, bd = 1e9;
      for (const e of w.units) if (e.alive && e.team === en && e.kind === 'turret' && (e.type === 'shieldgen' || e.type === 'ioncannon' || e.type === 'aabattery')) { const d = Math.hypot(e.pos.x - sq.cx, e.pos.z - sq.cz); if (d < bd) { bd = d; tgt = e; } }
      if (tgt) { best = { x: tgt.pos.x, z: tgt.pos.z, r: 22, cp: -1, uid: tgt.id }; bs = 1; }
    }
    for (const o of w.objs) {
      if (o.done) continue;
      if (o.type === 'uplink') { const d = Math.hypot(o.pos.x - sq.cx, o.pos.z - sq.cz); const s = 1.4 / (d + 160) * (0.7 + R.next() * 0.6); if (s > bs) { bs = s; best = { x: o.pos.x, z: o.pos.z, r: o.r * 0.6, cp: -2, uid: 0 }; } }
      else if (o.target) {
        const tu = w.umap.get(o.target); if (!tu || !tu.alive) continue;
        const mine = (o.type === 'destroy') === (o.team === sq.team) ;
        const d = Math.hypot(tu.pos.x - sq.cx, tu.pos.z - sq.cz), s = 1.5 / (d + 160) * (0.7 + R.next() * 0.6);
        if (s > bs && (o.type === 'destroy' ? o.team === sq.team : o.team === sq.team)) { bs = s; best = { x: tu.pos.x, z: tu.pos.z, r: 24, cp: -3, uid: o.type === 'destroy' ? tu.id : 0 }; }
      }
    }
    return best || { x: w.cps[R.i(w.cps.length)].pos.x, z: 0, r: 20, cp: -1, uid: 0 };
  }
  function squadSystem(w, dt) {
    if (w.tickN % 9 !== 0) return;
    const SQ = w.squads;
    for (let i = SQ.length - 1; i >= 0; i--) {
      const sq = SQ[i];
      let n = 0, cx = 0, cz = 0, sup = 0, supFiring = 0, asl = 0, ex = 0, ez = 0, en = 0;
      const tally = {};
      for (let k = sq.ids.length - 1; k >= 0; k--) {
        const u = w.umap.get(sq.ids[k]);
        if (!u || !u.alive || u.pid || u.sq !== sq.id) { sq.ids.splice(k, 1); continue; }
        n++; cx += u.pos.x; cz += u.pos.z;
        const role = ROLE[u.type];
        if (role === 'support') { sup++; if (w.t - u.lastFire < 1.2) supFiring++; } else if (role === 'assault') asl++;
        const t = u.ai.tid ? w.umap.get(u.ai.tid) : null;
        if (t && t.alive && u.ai.los) { ex += t.pos.x; ez += t.pos.z; en++; tally[t.id] = (tally[t.id] || 0) + (t.kind === 'infantry' ? 1 : 2); }
      }
      if (!n) { SQ.splice(i, 1); w.sqMap.delete(sq.id); continue; }
      sq.cx = cx / n; sq.cz = cz / n; sq.n = n;
      if (en) { sq.contact = { x: ex / en, z: ez / en, t: w.t }; let bf = 0, bc = 0; for (const id in tally) if (tally[id] > bc) { bc = tally[id]; bf = +id; } sq.focus = bf; }
      const fresh = sq.contact && w.t - sq.contact.t < 4;
      if (!fresh) sq.focus = 0;
      // goal
      const g = sq.goal;
      let stale = !g || w.t > sq.goalT;
      if (g && g.cp >= 0 && !stale) { const c = w.cps[g.cp]; if (c.owner === sq.team && c.n[S.enemyOf(sq.team)] === 0 && Math.abs(c.cap) >= 0.99) stale = true; }
      if (g && g.uid) { const tu = w.umap.get(g.uid); if (!tu || !tu.alive) stale = true; }
      if (stale && !fresh) { sq.goal = chooseSquadGoal(w, sq); sq.goalT = w.t + 18 + w.rng.next() * 14; sq.flank = null; }
      // fire and manoeuvre: assault elements bound forward only while the base of fire is up
      sq.advance = !fresh || sup === 0 || supFiring > 0 || w.t - (sq.advT || 0) > 6;
      if (sq.advance && fresh && sup > 0 && supFiring === 0) sq.advT = w.t;
      // flank point
      if (fresh && asl >= 2 && (!sq.flank || w.t - sq.flankT > 9)) {
        const bx = sq.cx - sq.contact.x, bz = sq.cz - sq.contact.z, bl = Math.hypot(bx, bz) || 1;
        if (bl > 38) {
          const ang = sq.flankSign * 0.95, ca = Math.cos(ang), sa = Math.sin(ang), rad = E.clamp(bl * 0.9, 34, 95);
          const fx = sq.contact.x + (bx / bl * ca - bz / bl * sa) * rad, fz = sq.contact.z + (bx / bl * sa + bz / bl * ca) * rad;
          if (w.terrain.height(fx, fz) > w.terrain.waterLevel + 0.3 && Math.abs(fx) < w.layout.arena.x && Math.abs(fz) < w.layout.arena.z) { sq.flank = { x: fx, z: fz }; sq.flankT = w.t; }
          else sq.flankSign = -sq.flankSign;
        }
      } else if (!fresh && sq.flank && w.t - sq.flankT > 12) sq.flank = null;
    }
  }

  // ── perception ───────────────────────────────────────────────
  function pickTarget(w, u, sq) {
    const W = E.WEAPONS[u.def.weapon], pr = PRIO[u.type] || PRIO.trooper, ai = u.ai;
    const sense = u.type === 'sniper' ? 520 : Math.min(W.range * 1.05, 250);
    let best = null, bs = 0; S.eyeOf(u, tmpA);
    const focus = sq ? sq.focus : 0, T = w.terrain;
    for (const e of w.units) {
      if (!e.alive || e.team === u.team) continue;
      const pf = pr[keyOf(e)]; if (!pf) continue;
      let d = V.distance(u.pos, e.pos);
      if (e.kind === 'infantry' && e.m && e.m.stealth && e.stance === 1 && Math.hypot(e.vel.x, e.vel.z) < 1.5) d *= 1 + 2 * e.m.stealth;
      if (d > sense) continue;
      if (e.kind === 'fighter' && (u.def.alt !== 'rocket' || e.pos.y - T.height(e.pos.x, e.pos.z) > 160 || d > 380)) continue;
      let s = pf * 1000 / (d + 60);
      if (e.id === ai.tid) s *= 1.25;
      if (e.id === focus) s *= 1.4;
      if (e.id === u.lastAtt && w.t - u.lastAttT < 4) s *= 1.3;
      if (s <= bs) continue;
      if (e.kind !== 'fighter' && !S.los(w, tmpA, S.centerOf(e, tmpB))) continue;
      bs = s; best = e;
    }
    return best;
  }

  // ── order / goal destination ─────────────────────────────────
  function orderDest(w, u, o) {
    const ord = u.order, ai = u.ai; if (!ord) return null;
    if (ord.type === 'follow') { const l = w.unitOf(ord.pid); if (l) { o.x = l.pos.x + ai.off.x * 0.4; o.z = l.pos.z + ai.off.z * 0.4; o.r = 6; return o; } u.order = null; return null; }
    o.x = ord.pos.x + ai.off.x * 0.3; o.z = ord.pos.z + ai.off.z * 0.3; o.r = 8;
    if (ord.type !== 'hold' && w.t - ord.t > 75) u.order = null;
    return o;
  }

  function validCover(w, u, tg) {
    const ai = u.ai, c = ai.cov;
    if (!c || !c.alive) return false;
    if (c.occ !== u.id) { c.occ = u.id; }
    c.occT = w.t;
    return S.coverCovered(w, ai.cx, ai.cz, tg.pos.x, tg.pos.z, 0.8);
  }
  function takeCover(w, u, tx, tz, R, gx, gz) {
    const ai = u.ai, CS = S.findCover(w, u, tx, tz, R, gx, gz, 0.9);
    if (!CS) return false;
    ai.cov = CS.c; ai.cx = CS.x; ai.cz = CS.z; ai.px = CS.px; ai.pz = CS.pz; ai.tall = CS.c.h > 1.45;
    CS.c.occ = u.id; CS.c.occT = w.t;
    return true;
  }

  // ── infantry think: pick the target, decide what to be doing ──
  function think(w, u) {
    const ai = u.ai, W = E.WEAPONS[u.def.weapon], R = w.rng;
    const sq = squadOf(w, u), role = ROLE[u.type] || 'assault', hpf = u.hp / u.maxHp;
    let t = pickTarget(w, u, sq); ai.los = !!t;
    if (t) ai.seenT = w.t;
    else if (ai.cov && ai.cov.alive && ai.tid && w.t - (ai.seenT || -9) < 4) { const m0 = w.umap.get(ai.tid); if (m0 && m0.alive) t = m0; }   // keep the head down, remember who is out there
    ai.tid = t ? t.id : 0;
    const k = w.cfg.aiErr * (1 + (u.supp || 0) * 2.2);
    ai.errY = R.gauss() * k; ai.errP = R.gauss() * k * 0.6;
    if (w.t > ai.offT) {
      ai.offT = w.t + 5 + R.next() * 7;
      const g = sq && sq.goal ? sq.goal : { r: 20 }, rr = (g.r || 20) * 0.8, a = R.angle(), d = Math.sqrt(R.next()) * rr;
      ai.off.x = Math.cos(a) * d; ai.off.z = Math.sin(a) * d;
    }
    ai.strafeT -= 0.4; if (ai.strafeT <= 0) { ai.strafe = -ai.strafe; ai.strafeT = 1 + R.next() * 2.2; }
    // retreat hysteresis
    if (!ai.retreat && hpf < 0.27 && w.t - u.bornT > 3) ai.retreat = true;
    else if (ai.retreat && hpf > 0.6) ai.retreat = false;
    ai.job = null; ai.mode = 'move'; ai.expose = true; ai.crouchWant = false;
    const ord = orderDest(w, u, DEST);
    // 1. retreat
    if (ai.retreat) {
      ai.mode = 'retreat';
      let md = null, bd = 1e9;
      for (const a of w.units) if (a.alive && a !== u && a.team === u.team && a.type === 'medic' && a.kind === 'infantry') { const d = V.distance2(a.pos, u.pos); if (d < bd && d < 110 * 110) { bd = d; md = a; } }
      if (md) { ai.dx = md.pos.x; ai.dz = md.pos.z; ai.dr = 4; }
      else { const h = w.cps.find(c => c.home === u.team); ai.dx = h.pos.x; ai.dz = h.pos.z; ai.dr = h.r * 0.5; }
      if (t && !(md && Math.sqrt(bd) < 12)) { if (!validCover(w, u, t)) { ai.cov = null; takeCover(w, u, t.pos.x, t.pos.z, 20, ai.dx, ai.dz); } if (ai.cov) { ai.dx = ai.cx; ai.dz = ai.cz; ai.dr = 0.8; ai.mode = 'fight'; ai.crouchWant = true; } }
      return;
    }
    // 2. class jobs when nothing is shooting at us
    const near = t ? V.distance(u.pos, t.pos) : 1e9;
    if (u.type === 'medic' && !(t && near < 40 && u.supp > 0.4)) {
      let bt = null, bd = 45 * 45;
      for (const a of w.units) if (a.alive && a !== u && a.team === u.team && a.kind === 'infantry' && a.hp < a.maxHp * 0.65) { const d = V.distance2(a.pos, u.pos); if (d < bd) { bd = d; bt = a; } }
      if (bt) { ai.mode = 'heal'; ai.dx = bt.pos.x; ai.dz = bt.pos.z; ai.dr = 6; ai.job = bt.id; return; }
    }
    if (u.type === 'engineer' && !(t && near < 35)) { if (engineerJob(w, u, sq)) return; }
    // 3. combat
    if (t) {
      const d = near, g = sq && sq.goal;
      const gx = g ? g.x : t.pos.x, gz = g ? g.z : t.pos.z;
      const needCover = (u.supp || 0) > 0.35 || hpf < 0.6 || role === 'support' || u.type === 'sniper' || u.type === 'medic';
      const holding = ord && u.order.type === 'hold';
      // keep distance as a marksman
      if (u.type === 'sniper' && d < 70) { ai.mode = 'kite'; ai.dx = u.pos.x + (u.pos.x - t.pos.x) / d * 30; ai.dz = u.pos.z + (u.pos.z - t.pos.z) / d * 30; ai.dr = 3; ai.cov = null; return; }
      const tooFar = d > W.range * 0.88;
      // cover maintenance
      if (!validCover(w, u, t)) { ai.cov = null; if (w.t > (ai.covT || 0)) { ai.covT = w.t + 0.7; takeCover(w, u, t.pos.x, t.pos.z, needCover ? 32 : 22, holding ? ord.x : gx, holding ? ord.z : gz); } }
      const bound = role === 'assault' && !holding && sq && sq.advance && (d > W.range * 0.42 || tooFar) && (u.supp || 0) < 0.45 && hpf > 0.5;
      if (tooFar || bound) {
        ai.mode = 'advance';
        let fx = t.pos.x, fz = t.pos.z;
        if (sq && sq.flank && !ai.flankDone && role === 'assault') {
          const df = Math.hypot(sq.flank.x - u.pos.x, sq.flank.z - u.pos.z);
          if (df < 14) ai.flankDone = true; else { fx = sq.flank.x; fz = sq.flank.z; }
        }
        // bound to the next cover that makes progress, else step straight at it
        let ok = false;
        if (takeCover(w, u, t.pos.x, t.pos.z, 24, fx, fz)) {
          const prog = Math.hypot(ai.cx - t.pos.x, ai.cz - t.pos.z) < d - 3 || tooFar && Math.hypot(ai.cx - fx, ai.cz - fz) < Math.hypot(u.pos.x - fx, u.pos.z - fz) - 3;
          if (prog) { ai.dx = ai.cx; ai.dz = ai.cz; ai.dr = 0.9; ok = true; } else ai.cov = null;
        }
        if (!ok) { const dl = Math.hypot(fx - u.pos.x, fz - u.pos.z) || 1, st = Math.min(16, dl); ai.dx = u.pos.x + (fx - u.pos.x) / dl * st; ai.dz = u.pos.z + (fz - u.pos.z) / dl * st; ai.dr = 1.5; }
        ai.expose = !tooFar ? true : false;
        return;
      }
      ai.mode = 'fight';
      if (ai.cov) { ai.dx = ai.cx; ai.dz = ai.cz; ai.dr = 0.7; }
      else { ai.dx = u.pos.x; ai.dz = u.pos.z; ai.dr = 1e9; }   // open ground: strafe where we are
      return;
    }
    // 4. nothing to shoot: orders, then the squad's goal
    ai.cov = null;
    if (ord) { ai.mode = u.order.type === 'hold' ? 'hold' : 'move'; ai.dx = ord.x; ai.dz = ord.z; ai.dr = ord.r; return; }
    const g = sq && sq.goal;
    if (g) { ai.dx = g.x + ai.off.x; ai.dz = g.z + ai.off.z; ai.dr = 2.5; }
    else { const c = w.cps[S.chooseGoal(w, u)]; ai.dx = c.pos.x + ai.off.x; ai.dz = c.pos.z + ai.off.z; ai.dr = 2.5; }
    // medics tag along behind the assault element
    if (u.type === 'medic' && sq && sq.n > 1) { ai.dx = sq.cx + ai.off.x * 0.2; ai.dz = sq.cz + ai.off.z * 0.2; ai.dr = 5; }
    ai.flankDone = false;
  }

  // engineer jobs: returns true if one was chosen (ai.mode/ai.dx set)
  function engineerJob(w, u, sq) {
    const ai = u.ai, R = w.rng;
    // repair the most damaged friendly vehicle / emplacement nearby
    let bt = null, bs = 0;
    for (const e of w.units) {
      if (!e.alive || e.team !== u.team || (e.kind !== 'vehicle' && e.kind !== 'turret') || e.hp >= e.maxHp * 0.82 || e.def.nest && false) continue;
      const d = V.distance(e.pos, u.pos); if (d > 90) continue;
      const s = (1 - e.hp / e.maxHp) * (e.kind === 'vehicle' ? 1.5 : 1) * 100 / (d + 30);
      if (s > bs) { bs = s; bt = e; }
    }
    if (bt) { ai.mode = 'repair'; ai.job = bt.id; ai.dx = bt.pos.x; ai.dz = bt.pos.z; ai.dr = bt.r + 2.5; return true; }
    // sabotage a nearby enemy structure while no infantry watches it
    if (u.hp > u.maxHp * 0.5 && u.altT <= 0) {
      let st = null, sd = 120 * 120, infNear = false;
      for (const e of w.units) {
        if (!e.alive || e.team === u.team) continue;
        const d2 = V.distance2(e.pos, u.pos);
        if (e.kind === 'infantry' && d2 < 40 * 40) { infNear = true; break; }
        if (e.kind === 'turret' && d2 < sd && !S.chargeOn(w, e.id) && (e.type === 'shieldgen' || e.type === 'aabattery' || e.type === 'ioncannon' || e.type === 'nest' || e.type === 'battery')) { sd = d2; st = e; }
      }
      if (st && !infNear) { ai.mode = 'sabotage'; ai.job = st.id; ai.dx = st.pos.x; ai.dz = st.pos.z; ai.dr = st.r + 2.5; return true; }
    }
    // lay mines on the approach to a post we hold
    if (w.t > (ai.mineT || 0) && u.altT <= 0 && w.units.some(e => e.alive && e.team !== u.team && e.kind === 'vehicle')) {
      const mine = w.cps.filter(c => c.owner === u.team), en = w.cps.filter(c => c.owner !== u.team);
      if (mine.length && en.length) {
        let bc = null, bd = 1e9;
        for (const c of mine) { const d = Math.hypot(c.pos.x - u.pos.x, c.pos.z - u.pos.z); if (d < bd) { bd = d; bc = c; } }
        let ec = null, ed = 1e9; for (const c of en) { const d = Math.hypot(c.pos.x - bc.pos.x, c.pos.z - bc.pos.z); if (d < ed) { ed = d; ec = c; } }
        for (const e of w.units) if (e.alive && e.team !== u.team && e.kind === 'vehicle') { const d = Math.hypot(e.pos.x - bc.pos.x, e.pos.z - bc.pos.z); if (d < ed && d < 500) { ed = d; ec = { pos: e.pos }; } }
        const dx = ec.pos.x - bc.pos.x, dz = ec.pos.z - bc.pos.z, dl = Math.hypot(dx, dz) || 1, off = bc.r + 10 + R.next() * 24, lat = (R.next() - 0.5) * 30;
        ai.mode = 'mine'; ai.dx = bc.pos.x + dx / dl * off - dz / dl * lat; ai.dz = bc.pos.z + dz / dl * off + dx / dl * lat; ai.dr = 2.5; ai.job = -1;
        if (bd < 160) return true;
      }
    }
    return false;
  }

  // ── infantry per-tick ────────────────────────────────────────
  function aiInfantry(w, u, dt) {
    const ai = u.ai, W = E.WEAPONS[u.def.weapon];
    if (u.stance === undefined) S.initInfantry(w, u);
    S.infantryTick(w, u, dt);
    if (u.vaultD) { S.stepInfantry(w, u, dt, 0, 0, 0, false, false, false); return; }
    ai.thinkT -= dt;
    if (ai.thinkT <= 0) { ai.thinkT = 0.3 + w.rng.next() * 0.2; think(w, u); }
    let tg = S.target(w, u);
    if (tg && tg.kind === 'fighter' && tg.pos.y - w.terrain.height(tg.pos.x, tg.pos.z) > 200) tg = null;
    let wx = 0, wz = 0, smul = 1, crouch = false, sprint = false;
    const mode = ai.mode;
    // movement intent toward the destination
    let ddx = ai.dx - u.pos.x, ddz = ai.dz - u.pos.z, dd = Math.hypot(ddx, ddz);
    const atSpot = dd < ai.dr;
    // peek / hide cycle at tall cover; stand / crouch at low cover
    let exposed = true;
    if (mode === 'fight' && ai.cov && atSpot) {
      ai.peekT -= dt;
      if (ai.peekT <= 0) { ai.peeking = !ai.peeking; ai.peekT = ai.peeking ? 1.1 + w.rng.next() * 1.4 : 1.4 + w.rng.next() * 1.8; if (!tg) ai.peeking = false; }
      exposed = ai.peeking;
      if (ai.tall && ai.peeking) { ddx = ai.px - u.pos.x; ddz = ai.pz - u.pos.z; dd = Math.hypot(ddx, ddz); }
      else if (ai.tall && !ai.peeking) { ddx = ai.cx - u.pos.x; ddz = ai.cz - u.pos.z; dd = Math.hypot(ddx, ddz); }
      crouch = !exposed || (!ai.tall && (u.supp || 0) > 0.3);
      wx = dd > 0.35 ? ddx / dd * 0.6 : 0; wz = dd > 0.35 ? ddz / dd * 0.6 : 0;
      ai.inCover = true;
    } else {
      ai.inCover = false;
      if (dd > ai.dr && dd < 1e8) {
        wx = ddx / dd; wz = ddz / dd;
        if (!tg && dd > 28 && mode !== 'heal' && (u.supp || 0) < 0.3) sprint = true;
        if (mode === 'retreat' || mode === 'kite') sprint = true;
        if (mode === 'advance') sprint = (u.supp || 0) < 0.3 && dd > 8 && !(tg && ai.expose && V.distance(u.pos, tg.pos) < 60);
      }
      if (mode === 'fight' && !ai.cov && tg) { // no cover: strafe and keep pushing
        const tx = tg.pos.x - u.pos.x, tz = tg.pos.z - u.pos.z, d = Math.hypot(tx, tz) || 1;
        wx = -tz / d * ai.strafe * 0.55; wz = tx / d * ai.strafe * 0.55; smul = 0.8;
        crouch = (u.supp || 0) > 0.5;
      }
      if (mode === 'advance' && tg) smul = 0.9;
    }
    // unstick
    ai.stuckT = (ai.stuckT || 0) + dt;
    if (ai.stuckT > 0.8) {
      const moved = Math.hypot(u.pos.x - (ai.lx || 0), u.pos.z - (ai.lz || 0));
      if ((wx || wz) && moved < 0.5 && !ai.inCover) { ai.nudge = w.t + 1.2; ai.nudgeS = w.rng.sign(); }
      ai.lx = u.pos.x; ai.lz = u.pos.z; ai.stuckT = 0;
    }
    if (ai.nudge > w.t) { const c = wx, d = wz; wx = -d * ai.nudgeS * 0.9 + c * 0.2; wz = c * ai.nudgeS * 0.9 + d * 0.2; }
    // snipers hold still to shoot
    if (u.type === 'sniper' && tg && !ai.retreat && mode === 'fight' && !ai.cov) { wx *= 0.2; wz *= 0.2; crouch = true; }
    // aim and fire
    let aimed = false;
    if (tg) {
      S.leadPoint(u, tg, W, tmpA); S.eyeOf(u, tmpB);
      const ax = tmpA.x - tmpB.x, ay = tmpA.y - tmpB.y, az = tmpA.z - tmpB.z;
      const wantY = Math.atan2(ax, az) + ai.errY, wantP = Math.atan2(ay, Math.hypot(ax, az)) + ai.errP;
      const tr = 7 * (1 - 0.45 * (u.supp || 0)) * (u.type === 'heavy' ? 0.8 : 1);
      u.aimYaw = S.turnTo(u.aimYaw, wantY, tr * dt); u.aimPitch = S.turnTo(u.aimPitch, wantP, 5 * dt);
      u.yaw = u.aimYaw;
      const al = Math.abs(S.angDiff(wantY, u.aimYaw)) + Math.abs(wantP - u.aimPitch);
      aimed = al < 0.07;
      const d = V.distance(u.pos, tg.pos);
      if (u.tool) u.tool = 0;
      if (exposed && !sprint && mode !== 'heal') {
        if (ai.pauseT > 0) { ai.pauseT -= dt; if (ai.cov && !ai.tall) crouch = true; }
        else {
          if (ai.burstT <= 0) ai.burstT = 0.5 + w.rng.next() * 0.9;
          if (aimed && d < W.range) S.landFire(w, u, S.dirOf(u.aimYaw, u.aimPitch, tmpA), 0);
          ai.burstT -= dt; if (ai.burstT <= 0 || u.hot) ai.pauseT = (0.4 + w.rng.next() * 0.8) * (u.type === 'sniper' ? 0.4 : 1);
        }
      }
      if (u.altT <= 0 && aimed) {
        const alt = u.def.alt;
        if (alt === 'grenade' && tg.kind !== 'fighter' && d > 10 && d < 34 && w.rng.next() < 0.03) S.landAlt(w, u, S.dirOf(u.aimYaw, Math.min(0.9, u.aimPitch + 0.28 + d * 0.006), tmpA), 0);
        else if (alt === 'rocket' && tg.kind !== 'infantry' && d < E.WEAPONS.rocket.range && w.rng.next() < 0.1) S.landAlt(w, u, S.dirOf(u.aimYaw, u.aimPitch + 0.03, tmpA), S.lockId(w, u, tg));
      }
    } else if (wx || wz) {
      u.yaw = S.turnTo(u.yaw, Math.atan2(wx, wz), 6 * dt); u.aimYaw = u.yaw; u.aimPitch *= 0.9;
    }
    // tools and abilities
    if (mode === 'heal' || u.def.alt === 'medburst') {
      if (u.def.alt === 'medburst' && u.altT <= 0 && (w.tickN + u.id) % 20 === 0) {
        const R2 = E.WEAPONS.medburst.radius * E.WEAPONS.medburst.radius * 0.8;
        for (const a of w.units) if (a.alive && a.team === u.team && a.kind === 'infantry' && a.hp < a.maxHp * 0.6 && V.distance2(a.pos, u.pos) < R2) { S.landAlt(w, u, tmpA, 0); break; }
      }
    }
    if (u.type === 'engineer') engineerTick(w, u, dt, tg, dd);
    if ((u.supp || 0) > 0.45) crouch = true;
    S.stepInfantry(w, u, dt, wx, wz, smul, false, crouch, sprint);
  }

  function engineerTick(w, u, dt, tg, dd) {
    const ai = u.ai, mode = ai.mode;
    if (mode === 'repair' && !tg) {
      const t = w.umap.get(ai.job);
      if (t && t.alive && V.distance(t.pos, u.pos) < t.r + 7) {
        u.tool = 1;
        const dx = t.pos.x - u.pos.x, dz = t.pos.z - u.pos.z;
        u.aimYaw = S.turnTo(u.aimYaw, Math.atan2(dx, dz), 8 * dt); u.yaw = u.aimYaw;
        S.engRepair(w, u, t, dt);
        return;
      }
    } else if (mode === 'sabotage' && !tg) {
      const t = w.umap.get(ai.job);
      if (t && t.alive && V.distance(t.pos, u.pos) < t.r + 5) {
        u.tool = 2;
        const dx = t.pos.x - u.pos.x, dz = t.pos.z - u.pos.z;
        u.aimYaw = Math.atan2(dx, dz); u.yaw = u.aimYaw; u.aimPitch = 0;
        S.engSabotage(w, u, S.dirOf(u.aimYaw, 0.1, tmpC), dt);
        return;
      }
    } else if (mode === 'mine' && dd < 3) {
      ai.mineT = w.t + 22 + w.rng.next() * 20;
      S.landAlt(w, u, tmpC, 0); ai.mode = 'move';
      return;
    }
    // under fire with nothing to hide behind: put up a barricade
    if (tg && !ai.cov && !ai.retreat && (u.supp || 0) > 0.25 && w.t >= (u.buildT || 0) && V.distance(u.pos, tg.pos) > 15) {
      const dx = tg.pos.x - u.pos.x, dz = tg.pos.z - u.pos.z;
      u.aimYaw = Math.atan2(dx, dz); u.yaw = u.aimYaw;
      S.engBuild(w, u);
    }
    if (u.tool !== 0 && !(mode === 'repair' || mode === 'sabotage')) u.tool = 0;
  }

  // ── vehicles ─────────────────────────────────────────────────
  function pickVehTarget(w, u) {
    const W = E.WEAPONS[u.def.weapon], pr = VPRIO[u.type] || VPRIO.tank, T = w.terrain;
    let best = null, bs = 0; S.eyeOf(u, tmpA);
    const aa = u.type === 'aa';
    for (const e of w.units) {
      if (!e.alive || e.team === u.team) continue;
      const pf = pr[keyOf(e)]; if (!pf) continue;
      const d = V.distance(u.pos, e.pos);
      let range = W.range;
      if (e.kind === 'fighter') { if (!aa) continue; range = E.WEAPONS.aamissile.range; if (e.pos.y - T.height(e.pos.x, e.pos.z) > E.LAND.aaMaxAlt) continue; }
      if (d > range) continue;
      let s = pf * 1000 / (d + 60);
      if (e.id === u.ai.tid) s *= 1.3;
      if (s <= bs) continue;
      if (e.kind !== 'fighter' && !S.los(w, tmpA, S.centerOf(e, tmpB))) continue;
      bs = s; best = e;
    }
    return best;
  }
  function aiVehicle(w, u, dt) {
    const ai = u.ai, W = E.WEAPONS[u.def.weapon], R = w.rng;
    ai.thinkT -= dt;
    if (ai.thinkT <= 0) {
      ai.thinkT = 0.3 + R.next() * 0.2;
      const t = pickVehTarget(w, u); ai.tid = t ? t.id : 0;
      const k = w.cfg.aiErr * 0.5; ai.errY = R.gauss() * k; ai.errP = R.gauss() * k * 0.6;
      ai.strafeT -= 0.4; if (ai.strafeT <= 0) { ai.strafe = -ai.strafe; ai.strafeT = 1 + R.next() * 2.2; }
      if (w.t > ai.offT) { ai.offT = w.t + 6 + R.next() * 8; const a = R.angle(), d = Math.sqrt(R.next()) * 30; ai.off.x = Math.cos(a) * d; ai.off.z = Math.sin(a) * d; }
      // destination: retreat to base when crippled, else escort the nearest friendly squad, else a post
      const hpf = u.hp / u.maxHp;
      if (!ai.retreat && (u.crip || hpf < 0.3)) ai.retreat = true; else if (ai.retreat && hpf > 0.7) ai.retreat = false;
      ai.wait = false;
      if (ai.retreat) { const h = w.cps.find(c => c.home === u.team); ai.dx = h.pos.x - (u.team === 'aegis' ? 14 : -14); ai.dz = h.pos.z; ai.dr = 8; }
      else {
        let sq = null, bd = 1e9;
        for (const s of w.squads) { if (s.team !== u.team || s.n < 2) continue; const d = Math.hypot(s.cx - u.pos.x, s.cz - u.pos.z); if (d < bd) { bd = d; sq = s; } }
        if (u.type === 'aa') {
          // stay with friendly ground forces under the sky
          if (sq) { ai.dx = sq.cx + ai.off.x; ai.dz = sq.cz + ai.off.z; ai.dr = 24; } else { const gp = S.goalPos(w, u, tmpC); ai.dx = gp.x; ai.dz = gp.z; ai.dr = 30; }
        } else if (sq && bd < 500 && sq.goal) {
          ai.dx = sq.goal.x + ai.off.x; ai.dz = sq.goal.z + ai.off.z; ai.dr = 10;
          const sd = Math.hypot(sq.cx - u.pos.x, sq.cz - u.pos.z);
          ai.wait = u.type === 'tank' && sd > 55 && sd < 400;    // don't outrun the escort
        } else { const gp = S.goalPos(w, u, tmpC); ai.dx = gp.x; ai.dz = gp.z; ai.dr = 14; }
      }
    }
    const tg = S.target(w, u);
    let gx = ai.dx - u.pos.x, gz = ai.dz - u.pos.z; const dg = Math.hypot(gx, gz);
    let throttle = dg > ai.dr ? 1 : 0, des = dg > 1 ? Math.atan2(gx, gz) : u.yaw;
    if (ai.wait) throttle = 0.15;
    if (ai.retreat && dg < ai.dr) throttle = 0;
    let brake = false;
    if (tg) {
      const tx = tg.pos.x - u.pos.x, tz = tg.pos.z - u.pos.z, d = Math.hypot(tx, tz) || 1;
      const al = S.aimTurret(w, u, tg, dt, 2.6);
      S.dirOf(u.aimYaw, u.aimPitch, tmpA);
      if (tg.kind === 'fighter') {
        if (al < 0.1 && d < W.range) S.landFire(w, u, tmpA, 0);
        if (u.def.alt && u.altT <= 0 && al < 0.4) S.landAlt(w, u, tmpA, S.lockId(w, u, tg));
      } else {
        if (al < 0.06 && d < W.range && !u.aimLimited) S.landFire(w, u, tmpA, 0);
        if (u.def.alt === 'coax' && tg.kind === 'infantry' && d < E.WEAPONS.coax.range && al < 0.12) S.landAlt(w, u, tmpA, 0);
      }
      const faceYaw = Math.atan2(tx, tz);
      if (u.type === 'tank') {
        // armored front toward the enemy; close up when far, back off when near
        if (d < W.range * 0.9) { des = faceYaw; throttle = d < W.range * 0.4 ? -0.5 : (dg > ai.dr && !ai.wait && d > W.range * 0.65 ? 0.4 : 0); if (ai.retreat) { des = Math.atan2(gx, gz); throttle = dg > ai.dr ? 0.7 : 0; } }
      } else if (u.type === 'skiff') {
        if (d < W.range * 0.85) { des = faceYaw + ai.strafe * 0.9; throttle = d < 60 ? -0.4 : 0.85; }
        else if (u.aimLimited) des = faceYaw;
      } else if (tg.kind === 'fighter') { throttle *= 0.3; }
      else if (u.aimLimited) des = faceYaw;
    } else { u.aimYaw = S.turnTo(u.aimYaw, u.yaw, 1.5 * dt); u.aimPitch *= 0.95; }
    const dy = S.angDiff(des, u.yaw);
    if (Math.abs(dy) > 1.1) throttle *= 0.3;
    S.stepVehicle(w, u, dt, throttle, E.clamp(dy * 2.2, -1, 1), brake);
  }

  S.systems.push(squadSystem);
  Object.assign(S, { assignSquad, aiInfantry, aiVehicle, squadOf, pickLandTarget: pickTarget, pickVehTarget });
})(window.E = window.E || {});
