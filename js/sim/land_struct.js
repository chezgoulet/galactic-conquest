// LAND structures and tools: emplacements (AA battery, MG nest), the shield
// generator and ion cannon, engineer tools (repair, barricades, mines,
// charges), and ground objectives. Also the land-side battle setup.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  const L = E.LAND;
  const tmpA = V.make(), tmpB = V.make(), tmpC = V.make();

  // ── setup: cover, structures, per-battle state (called first by sim.setup) ──
  function setupLand(w) {
    w.landStats = S.newLandStats(); w.squads = []; w.squadId = 1; w.mines = []; w.mineId = 1; w.charges = []; w.chargeId = 1; w.objs = []; w.objId = 1;
    w.landT = { aegis: { aa: 25 }, verdant: { aa: 25 } };
    S.genCover(w);
    for (const f of E.TEAMS) {
      const home = w.cps.find(c => c.home === f), sgn = f === 'aegis' ? 1 : -1, hx = home.pos.x, hz = home.pos.z;
      const mk = (type, x, z) => { const u = S.spawnUnit(w, 'turret', type, f, { x, z }); u.yaw = u.aimYaw = Math.atan2(-x, -z); u.baseTeam = f; return u; };
      mk('shieldgen', hx - sgn * 52, hz + 6);
      mk('aabattery', hx - sgn * 22, hz + 44); mk('aabattery', hx - sgn * 22, hz - 44);
      mk('nest', hx + sgn * 40, hz + 20); mk('nest', hx + sgn * 40, hz - 20);
      S.spawnUnit(w, 'vehicle', 'aa', f, { x: hx - sgn * 20, z: hz + 4 });
    }
    // the ion cannon sits beside the central post; it belongs to whoever holds the post
    const mid = w.cps[Math.floor(w.cps.length / 2)];
    const ion = S.spawnUnit(w, 'turret', 'ioncannon', w.rng.next() < 0.5 ? 'aegis' : 'verdant', { x: mid.pos.x + 4, z: mid.pos.z + mid.r * 0.55 });
    ion.cd = L.ionFirst; ion.active = false; ion.cpId = mid.id;
    w.ion = ion;
  }

  // ── shield dome ──────────────────────────────────────────────
  function shielded(w, team, pos) {
    const U = w.units;
    for (let i = 0; i < U.length; i++) {
      const u = U[i];
      if (u.kind !== 'turret' || u.type !== 'shieldgen' || !u.alive || u.team !== team) continue;
      const dx = pos.x - u.pos.x, dz = pos.z - u.pos.z, R = u.def.shieldR || L.shieldR;
      if (dx * dx + dz * dz < R * R) return true;
    }
    return false;
  }

  // ── structures ───────────────────────────────────────────────
  function structureDeath(w, e, src) {
    if (e.def.structure) {
      w.events.push({ type: 'structureDown', uid: e.id, utype: e.type, team: e.team, pos: V.clone(e.pos), by: src.uid || 0 });
      S.blast(w, e.pos, 16, 320, e.team, e.id, 'wreck', null);
    }
  }
  // fire the ion cannon (also callable by a player possessing it)
  function structureFire(w, u) {
    if (u.type !== 'ioncannon' || !u.active || u.cd > 0) return false;
    let best = null, bd = 1e12;
    for (const c of w.units) if (c.alive && c.kind === 'capital' && c.team !== u.team) { const d = V.distance2(c.pos, u.pos); if (d < bd) { bd = d; best = c; } }
    if (!best) return false;
    u.cd = L.ionCd;
    const sh = Math.min(best.shield, L.ionShield); best.hitT = 0;
    if (best.arcs && best.shield > 0) { const k = 1 - sh / best.shield; for (const a of best.arcs) { a.v *= k; a.hitT = 0; } }   // capital shields are four arcs: drain them all
    best.shield -= sh;
    const from = { x: u.pos.x, y: u.pos.y + u.def.h, z: u.pos.z };
    w.events.push({ type: 'ion', uid: u.id, team: u.team, from, to: V.clone(best.pos), tid: best.id, shieldStripped: Math.round(sh) });
    S.applyDamage(w, best, L.ionHull, { wk: 'ioncannon', team: u.team, uid: u.id, owner: u.pid || null }, best.pos);
    return true;
  }
  function structureSystem(w, dt) {
    const ion = w.ion;
    for (const u of w.units) {
      if (u.kind !== 'turret' || !u.alive) continue;
      if (u.def.structure) u.charging = u.type === 'ioncannon' && u.active && u.cd < 4;
    }
    if (ion && ion.alive) {
      const cp = w.cps[ion.cpId];
      if (cp.owner && cp.owner !== ion.team) {
        const prev = ion.team; ion.team = cp.owner; ion.cd = Math.max(ion.cd, 8);
        w.events.push({ type: 'ionFlip', uid: ion.id, team: ion.team, prev });
      }
      ion.active = cp.owner === ion.team;
      if (ion.active) {
        ion.cd = Math.max(0, ion.cd - dt);
        if (ion.cd <= 0 && !ion.pid) structureFire(w, ion);
      }
    }
  }

  // ── emplacement AI ───────────────────────────────────────────
  function pickEmplacementTarget(w, u) {
    const D = u.def, W = E.WEAPONS[D.weapon], T = w.terrain;
    let best = null, bs = 0; S.eyeOf(u, tmpA);
    for (const e of w.units) {
      if (!e.alive || e.team === u.team) continue;
      if (w.cfg.fog && !S.visible(w, u.team, e)) continue;
      let s = 0, d = V.distance(u.pos, e.pos);
      if (D.aa) {
        if (e.kind !== 'fighter') continue;
        const alt = e.pos.y - Math.max(T.height(e.pos.x, e.pos.z), T.waterLevel);
        if (alt > L.aaMaxAlt || d > 1150) continue;
        const sp = Math.hypot(e.vel.x, e.vel.z, e.vel.y);
        s = 1000 / (d + 100) * (sp < 110 ? 1.6 : 1) * (alt < 250 ? 1.4 : 1);
      } else if (D.nest) {
        if (e.kind === 'infantry') s = 1000 / (d + 40); else if (e.kind === 'vehicle' && e.armor === 'light') s = 500 / (d + 40); else continue;
        if (d > W.range) continue;
      } else {
        if (e.kind === 'fighter') { if (e.pos.y - T.height(e.pos.x, e.pos.z) > 220 || d > 380) continue; s = 600 / (d + 60); }
        else if (e.kind === 'infantry') s = 900 / (d + 60); else if (e.kind === 'vehicle') s = 1300 / (d + 60); else continue;
        if (d > W.range) continue;
      }
      if (e.id === u.ai.tid) s *= 1.3;
      if (s <= bs) continue;
      if (e.kind !== 'fighter' || e.pos.y - T.height(e.pos.x, e.pos.z) < 60) { if (!S.los(w, tmpA, S.centerOf(e, tmpB))) continue; }
      bs = s; best = e;
    }
    return best;
  }
  function aiTurret(w, u, dt) {
    const D = u.def, ai = u.ai;
    if (D.structure) return;
    ai.thinkT -= dt;
    if (ai.thinkT <= 0) {
      ai.thinkT = 0.25 + w.rng.next() * 0.2;
      const t = pickEmplacementTarget(w, u); ai.tid = t ? t.id : 0;
      const k = w.cfg.aiErr * 0.5; ai.errY = w.rng.gauss() * k; ai.errP = w.rng.gauss() * k * 0.6;
    }
    const tg = S.target(w, u);
    if (tg) {
      const err = S.aimTurret(w, u, tg, dt, D.turn);
      const d = V.distance(u.pos, tg.pos), W = E.WEAPONS[D.weapon];
      S.dirOf(u.aimYaw, u.aimPitch, tmpA);
      if (err < 0.08 && d < W.range) S.landFire(w, u, tmpA, 0);
      if (D.alt && err < 0.35 && d < E.WEAPONS[D.alt].range && tg.kind === 'fighter') { const id = S.lockId(w, u, tg); if (id && u.altT <= 0) S.landAlt(w, u, tmpA, id); }
    }
    u.yaw = u.aimYaw;
  }

  // ── engineer tools ───────────────────────────────────────────
  function repairRate(t, m) { return (t.kind === 'vehicle' ? 70 : 95) * (m.repair || 1); }
  // repair a friendly unit (vehicle / emplacement) or cover piece; returns hp restored
  function engRepair(w, u, tgt, dt) {
    const m = u.m || S.M0;
    let amt = 0;
    if (tgt.hw !== undefined) { // cover piece
      if (!tgt.alive || (tgt.team && tgt.team !== u.team)) return 0;
      amt = S.repairCover(w, tgt, 110 * m.repair * dt);
    } else {
      if (!tgt.alive || tgt.team !== u.team || (tgt.kind !== 'vehicle' && tgt.kind !== 'turret') || tgt.hp >= tgt.maxHp) return 0;
      amt = Math.min(tgt.maxHp - tgt.hp, repairRate(tgt, m) * dt); tgt.hp += amt;
      if (tgt.kind === 'vehicle' && tgt.hp > tgt.maxHp * 0.5) tgt.hitT = Math.max(tgt.hitT, 0);
    }
    if (amt > 0) {
      u.repairAcc = (u.repairAcc || 0) + amt;
      if (w.t - (u.repairT || -9) > 0.45) {
        u.repairT = w.t; u.repairId = tgt.id;
        w.events.push({ type: 'repair', uid: u.id, tid: tgt.id, cover: tgt.hw !== undefined, to: u.pid, pos: tgt.hw !== undefined ? { x: tgt.x, y: tgt.y + tgt.h * 0.5, z: tgt.z } : V.clone(tgt.pos) });
      }
      if (u.pid && u.repairAcc >= 120) { S.score(w, u.pid, 15, 'REPAIR'); u.repairAcc = 0; }
    }
    return amt;
  }
  // the thing a tool is pointed at: the unit (or cover piece) nearest the aim ray within range
  function toolTarget(w, u, dir, range, pred) {
    S.eyeOf(u, tmpA);
    let best = null, bs = 0.32;
    for (const e of w.units) {
      if (!e.alive || e.kind === 'infantry' || e.kind === 'fighter' || e.kind === 'capital' || !pred(e)) continue;
      const dx = e.pos.x - tmpA.x, dy = e.pos.y + e.h * 0.5 - tmpA.y, dz = e.pos.z - tmpA.z, l = Math.hypot(dx, dy, dz);
      if (l - e.r > range) continue;
      const a = Math.acos(E.clamp((dx * dir.x + dy * dir.y + dz * dir.z) / (l || 1), -1, 1)) - Math.atan2(e.r, Math.max(l, 1));
      if (a < bs) { bs = a; best = e; }
    }
    return best;
  }
  function engTool(w, u, dir, dt) {
    const m = u.m || S.M0;
    if (u.tool === 1) {
      let tgt = toolTarget(w, u, dir, 14, (e) => e.team === u.team && e.hp < e.maxHp && (e.kind === 'vehicle' || e.kind === 'turret'));
      if (!tgt) {
        S.dirOf(u.aimYaw, 0, tmpC);
        tgt = S.coverNear(w, u.pos.x + dir.x * 4, u.pos.z + dir.z * 4, 7, (c) => c.hp < c.maxHp && (!c.team || c.team === u.team));
      }
      if (tgt) engRepair(w, u, tgt, dt);
    } else if (u.tool === 2) engSabotage(w, u, dir, dt);
  }
  // plant a charge on an enemy structure / vehicle / emplacement, or defuse one on a friendly one (hold fire)
  function engSabotage(w, u, dir, dt) {
    const m = u.m || S.M0;
    let tgt = toolTarget(w, u, dir, 9, (e) => true);
    if (!tgt) { u.work = 0; u.workId = 0; return; }
    if (u.workId !== tgt.id) { u.workId = tgt.id; u.work = 0; }
    const ch = chargeOn(w, tgt.id);
    if (tgt.team === u.team) {
      if (!ch || ch.team === u.team) { u.work = 0; return; }
    } else if (ch && ch.team === u.team) { u.work = 0; return; }
    u.work += dt / 1.4;
    if (u.work >= 1) {
      u.work = 0;
      if (tgt.team === u.team) defuse(w, ch, u); else plantCharge(w, u, tgt);
    }
  }
  function chargeOn(w, uid) { for (const c of w.charges) if (c.uid === uid) return c; return null; }
  function plantCharge(w, u, tgt) {
    if (!tgt || !tgt.alive || tgt.team === u.team || chargeOn(w, tgt.id) || u.altT > 0) return null;
    const m = u.m || S.M0, fuse = 11 * m.fuse;
    const c = { id: w.chargeId++, uid: tgt.id, team: u.team, by: u.id, pid: u.pid || null, t: w.t + fuse, fuse, mul: m.chargeDmg };
    w.charges.push(c); u.altT = E.WEAPONS.charge.cd;
    w.events.push({ type: 'charge', cid: c.id, uid: tgt.id, team: u.team, fuse, pos: V.clone(tgt.pos) });
    return c;
  }
  function defuse(w, ch, u) {
    const i = w.charges.indexOf(ch); if (i < 0) return false;
    w.charges.splice(i, 1);
    w.events.push({ type: 'defuse', cid: ch.id, uid: ch.uid, team: u.team, by: u.id });
    if (u.pid) S.score(w, u.pid, 100, 'CHARGE DEFUSED');
    return true;
  }
  function chargeSystem(w, dt) {
    for (let i = w.charges.length - 1; i >= 0; i--) {
      const c = w.charges[i], t = w.umap.get(c.uid);
      if (!t || !t.alive) { w.charges.splice(i, 1); continue; }
      if (w.t >= c.t) {
        w.charges.splice(i, 1);
        const W = E.WEAPONS.charge, src = { wk: 'charge', team: c.team, uid: c.by, owner: c.pid };
        w.events.push({ type: 'chargeBlast', cid: c.id, uid: t.id, pos: V.clone(t.pos), team: c.team });
        S.applyDamage(w, t, W.dmg * c.mul, src, t.pos);
        S.blast(w, t.pos, W.splash, 220, c.team, c.by, 'charge', c.pid);
      }
    }
  }
  function engBuild(w, u) {
    const m = u.m || S.M0;
    if (w.t < (u.buildT || 0)) return null;
    const c = S.buildBarrier(w, u);
    if (c) u.buildT = w.t + 14 * m.buildCd;
    return c;
  }

  // ── mines ────────────────────────────────────────────────────
  function layMine(w, u) {
    if (!u.onGround || u.vaultD) return null;
    const m = u.m || S.M0, W = E.WEAPONS.mine;
    let n = 0, oldest = null;
    for (const k of w.mines) if (k.uid === u.id) { n++; if (!oldest) oldest = k; }
    if (n >= m.mines) w.mines.splice(w.mines.indexOf(oldest), 1);
    const k = { id: w.mineId++, team: u.team, uid: u.id, pid: u.pid || null, x: u.pos.x, y: u.pos.y, z: u.pos.z, armT: w.t + L.mineArm, expT: w.t + 300, mul: m.mineDmg, seen: false };
    w.mines.push(k); u.altT = W.cd;
    w.events.push({ type: 'mine', mid: k.id, team: u.team, pos: { x: k.x, y: k.y, z: k.z }, uid: u.id });
    if (w.landStats) w.landStats.minesLaid = (w.landStats.minesLaid || 0) + 1;
    return k;
  }
  function mineSystem(w, dt) {
    const M = w.mines; if (!M.length) return;
    if (w.tickN % 3 !== 0) return;
    const W = E.WEAPONS.mine, U = w.units;
    for (let i = M.length - 1; i >= 0; i--) {
      const k = M[i];
      if (w.t > k.expT) { M.splice(i, 1); continue; }
      if (w.t < k.armT) continue;
      let hit = null, seen = false;
      for (let j = 0; j < U.length; j++) {
        const e = U[j]; if (!e.alive || e.team === k.team) continue;
        const dx = e.pos.x - k.x, dz = e.pos.z - k.z, d2 = dx * dx + dz * dz;
        if (e.kind === 'vehicle') { const R = L.mineR + e.r * 0.45; if (d2 < R * R && e.pos.y - k.y < 5) { hit = e; break; } }
        else if (e.kind === 'infantry' && d2 < 400) seen = true;
      }
      if (seen && !k.seen) { k.seen = true; w.events.push({ type: 'mineSpotted', mid: k.id, team: k.team, pos: { x: k.x, y: k.y, z: k.z } }); }
      if (!hit) continue;
      M.splice(i, 1);
      const src = { wk: 'mine', team: k.team, uid: k.uid, owner: k.pid };
      w.events.push({ type: 'mineBlast', mid: k.id, uid: hit.id, pos: { x: k.x, y: k.y, z: k.z }, team: k.team });
      S.applyDamage(w, hit, W.dmg * k.mul, src, hit.pos);
      for (const e of U) {
        if (!e.alive || e.team === k.team || e === hit || (e.kind !== 'infantry' && e.kind !== 'vehicle')) continue;
        const d = Math.hypot(e.pos.x - k.x, e.pos.z - k.z) - e.r;
        if (d < W.splash) S.applyDamage(w, e, W.dmg * k.mul * 0.6 * (1 - Math.max(0, d) / W.splash), src, e.pos);
      }
      S.blastCover(w, k.x, k.y, k.z, W.splash, 150, 1);
    }
  }

  // ── AA vehicle reinforcements ────────────────────────────────
  function landReinforce(w, dt) {
    if (w.tickN % 6 !== 0 || w.winner) return;
    for (const f of E.TEAMS) {
      const T = w.teams[f], LT = w.landT[f];
      if (T.tickets <= 0) continue;
      let n = 0; for (const u of w.units) if (u.alive && u.team === f && u.kind === 'vehicle' && u.type === 'aa') n++;
      if (n >= 1) { LT.aa = 60; continue; }
      LT.aa -= dt * 6;
      if (LT.aa <= 0) {
        LT.aa = 60;
        const home = w.cps.find(c => c.home === f), c = home.owner === f ? home : S.spawnCP(w, f);
        if (c) S.spawnUnit(w, 'vehicle', 'aa', f, S.ring(w, c.pos, c.r * 0.6, c.r * 1.1));
      }
    }
  }

  // ── objectives: building blocks the battle flow can compose ──
  // S.addObjective(w, spec) -> obj. Specs:
  //   { type:'destroy', target:uid, team:attackers }          done when the target dies
  //   { type:'defend',  target:uid, team:defenders, duration } done when the timer runs out with the target alive (fails if it dies)
  //   { type:'uplink',  pos:{x,z}, r, need:seconds, team:null } hold the site with the only infantry present; first side to `need` wins
  // State on w.objs[]: { id, type, team, frac 0..1, done, success, winner, ... }; events objAdd / objProgress / objDone.
  function addObjective(w, spec) {
    const o = Object.assign({ id: w.objId++, done: false, success: null, winner: null, frac: 0, step: 0, t: 0, label: '' }, spec);
    if (o.type === 'uplink') { o.r = o.r || 24; o.need = o.need || 60; o.prog = { aegis: 0, verdant: 0 }; o.holder = null; o.n = { aegis: 0, verdant: 0 }; o.contested = false; }
    if (o.type === 'defend') o.duration = o.duration || 90;
    const tu = o.target ? w.umap.get(o.target) : null;
    if (tu) o.pos = { x: tu.pos.x, z: tu.pos.z };
    w.objs.push(o);
    w.events.push({ type: 'objAdd', id: o.id, otype: o.type, team: o.team || null, pos: o.pos ? { x: o.pos.x, z: o.pos.z } : null, target: o.target || 0 });
    return o;
  }
  function objFinish(w, o, success, winner) {
    o.done = true; o.success = success; o.winner = winner || null; o.frac = success ? 1 : o.frac;
    w.events.push({ type: 'objDone', id: o.id, otype: o.type, team: winner || o.team || null, success });
  }
  function objSystem(w, dt) {
    if (!w.objs.length) return;
    for (const o of w.objs) {
      if (o.done) continue;
      o.t += dt;
      let frac = o.frac;
      if (o.type === 'destroy' || o.type === 'defend') {
        const tu = w.umap.get(o.target);
        if (tu && tu.alive) o.pos = { x: tu.pos.x, z: tu.pos.z };
        if (o.type === 'destroy') {
          if (!tu || !tu.alive) { objFinish(w, o, true, o.team); continue; }
          frac = 1 - tu.hp / tu.maxHp;
        } else {
          if (!tu || !tu.alive) { objFinish(w, o, false, S.enemyOf(o.team)); continue; }
          frac = o.t / o.duration;
          if (frac >= 1) { objFinish(w, o, true, o.team); continue; }
        }
      } else if (o.type === 'uplink') {
        o.n.aegis = 0; o.n.verdant = 0;
        for (const u of w.units) if (u.alive && u.kind === 'infantry' && E.distXZ2(u.pos, o.pos) < o.r * o.r) o.n[u.team]++;
        o.contested = o.n.aegis > 0 && o.n.verdant > 0;
        for (const f of E.TEAMS) {
          if (!o.contested && o.n[f] > 0 && (!o.team || o.team === f || true)) o.prog[f] = Math.min(o.need, o.prog[f] + dt * (0.6 + 0.4 * Math.min(4, o.n[f]) / 4));
          else if (!o.contested) o.prog[f] = Math.max(0, o.prog[f] - dt * 0.3);
        }
        if (!o.contested && o.n[S.enemyOf('aegis')] > 0) o.prog.aegis = Math.max(0, o.prog.aegis - dt * 0.7);
        if (!o.contested && o.n.aegis > 0) o.prog.verdant = Math.max(0, o.prog.verdant - dt * 0.7);
        o.holder = o.prog.aegis > o.prog.verdant ? 'aegis' : o.prog.verdant > o.prog.aegis ? 'verdant' : null;
        frac = Math.max(o.prog.aegis, o.prog.verdant) / o.need;
        if (frac >= 1) { o.frac = 1; objFinish(w, o, true, o.prog.aegis >= o.need ? 'aegis' : 'verdant'); continue; }
      }
      o.frac = frac;
      const step = Math.floor(frac * 10);
      if (step > o.step) { o.step = step; w.events.push({ type: 'objProgress', id: o.id, otype: o.type, frac, team: o.holder || o.team || null }); }
    }
  }

  // ── net ──────────────────────────────────────────────────────
  S.net.world.land = {
    pack(w) {
      return {
        m: (w.mines || []).map(k => [k.id, k.team, Math.round(k.x * 10) / 10, Math.round(k.z * 10) / 10, w.t >= k.armT ? 1 : 0, k.seen ? 1 : 0]),
        c: (w.charges || []).map(c => [c.id, c.uid, c.team, Math.round((c.t - w.t) * 10) / 10]),
        o: (w.objs || []).map(o => [o.id, o.type, o.team || 0, Math.round(o.frac * 1000) / 1000, o.done ? 1 : 0, o.success ? 1 : 0, o.pos ? Math.round(o.pos.x) : 0, o.pos ? Math.round(o.pos.z) : 0, o.r || 0, o.holder || 0, o.contested ? 1 : 0]),
      };
    },
    apply(w, d) {
      w.mines = d.m.map(r => ({ id: r[0], team: r[1], x: r[2], z: r[3], y: 0, armT: r[4] ? -1 : 1e9, seen: !!r[5] }));
      w.charges = d.c.map(r => ({ id: r[0], uid: r[1], team: r[2], t: w.t + r[3] }));
      w.objs = d.o.map(r => ({ id: r[0], type: r[1], team: r[2] || null, frac: r[3], done: !!r[4], success: !!r[5], pos: { x: r[6], z: r[7] }, r: r[8], holder: r[9] || null, contested: !!r[10] }));
    },
  };

  S.systems.push(structureSystem, chargeSystem, mineSystem, landReinforce, objSystem);
  Object.assign(S, { setupLand, shielded, structureDeath, structureFire, aiTurret, engRepair, engTool, engBuild, engSabotage, toolTarget, plantCharge, defuse, chargeOn,
    layMine, addObjective, pickEmplacementTarget });
})(window.E = window.E || {});
