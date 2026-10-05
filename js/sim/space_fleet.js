// SPACE (fleet): the staged battle objectives, fleet AI (broadsides, shield
// facing, screening, targeting by stage, retreat), the fleet report, player
// command of a capital ship, command verbs and multiplayer registration.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3, SP = E.SPACE, ORDER = SP.order;
  const tmpA = V.make(), tmpB = V.make(), tmpD = V.make();
  const H = { x: 0, z: 0, thr: 0 };
  const SYS_PREF = [['shield', 'batteries', 'engines', 'hangar', 'bridge'], ['shield', 'engines', 'batteries', 'bridge', 'hangar'], ['batteries', 'shield', 'hangar', 'engines', 'bridge']];
  const enemyTeam = (t) => (t === 'aegis' ? 'verdant' : 'aegis');

  // ── battle stages (per side, on the world) ───────────────────
  // Stage I   win local space: strip the enemy screen            (hull and systems of the line are hardened)
  // Stage II  break the shields and knock out named subsystems   (systems fully vulnerable)
  // Stage III finish the hull or take the ship by boarding       (hull plating gives way)
  function ensureSpace(w) {
    if (!w.space) w.space = { aegis: { stage: 1, target: 0, t0: 0, log: [{ stage: 1, t: 0 }], won: false, lost: false, shipsLost: 0 }, verdant: { stage: 1, target: 0, t0: 0, log: [{ stage: 1, t: 0 }], won: false, lost: false, shipsLost: 0 } };
    if (!w.fleetReport) w.fleetReport = { aegis: [], verdant: [] };
    return w.space;
  }
  function pickObjective(w, team) {
    const en = S.capsOf(w, enemyTeam(team));
    let best = null, bs = -1;
    for (const e of en) { const s = (e.retreat ? -1e7 : 0) + (e.flag ? 1e6 : 0) + (e.def.role === 'screen' ? 0 : e.hp); if (s > bs) { bs = s; best = e; } }
    return best;
  }
  function advance(w, team, st, to, why) {
    if (to === st.stage) return;
    const from = st.stage; st.stage = to; st.t0 = w.t; st.log.push({ stage: to, t: w.t, why });
    w.events.push({ type: 'stageChange', team, from, stage: to, name: SP.stageNames[to - 1], target: st.target, why });
    w.events.push({ type: 'announce', key: 'spaceStage' + to, team, stage: to, name: SP.stageNames[to - 1] });
  }
  function spaceSystem(w, dt) {
    ensureSpace(w);
    if (w.tickN % 6 === 0) {
      for (const team of E.TEAMS) {
        const st = w.space[team], en = S.capsOf(w, enemyTeam(team)), own = S.capsOf(w, team);
        st.lost = own.length === 0;
        if (!en.length) {
          if (!st.won && !st.lost) { st.won = true; w.events.push({ type: 'fleetVictory', team }); w.events.push({ type: 'announce', key: 'fleetVictory', team }); }
          st.target = 0; continue;
        }
        st.won = false;
        let tg = st.target ? w.umap.get(st.target) : null;
        if (!tg || !tg.alive || tg.team === team) { // objective ship gone: next one
          const had = !!st.target; tg = pickObjective(w, team); st.target = tg ? tg.id : 0;
          if (had) advance(w, team, st, en.some(e => e.def.role === 'screen' && !e.retreat) ? 1 : 2, 'targetGone');
        }
        const screens = en.filter(e => e.def.role === 'screen' && !e.retreat).length;
        if (st.stage === 1 && (screens === 0 || w.t - st.t0 > 240)) advance(w, team, st, 2, screens ? 'timeout' : 'screenCleared');
        else if (st.stage === 2 && tg) {
          let dead = 0; for (const n of ORDER) if (n !== 'reactor' && !tg.sys[n].alive) dead++;
          if ((dead >= 2 && (!tg.sys.shield.alive || S.shieldFrac(tg) < 0.25)) || S.hullFrac(tg) < 0.55 || w.t - st.t0 > 300) advance(w, team, st, 3, 'systemsDown');
        }
      }
    }
    if (w.tickN % 30 === 0) refreshReport(w);
  }

  // ── summary for the HUD / objectives ─────────────────────────
  function fleetStats(w, team) {
    const caps = S.capsOf(w, team); let hp = 0, mh = 0, sh = 0, ms = 0, retreating = 0;
    for (const u of caps) { hp += u.hp; mh += u.maxHp; sh += u.shield; ms += u.maxShield; if (u.retreat) retreating++; }
    return { ships: caps.length, hull: mh ? hp / mh : 0, shield: ms ? sh / ms : 0, retreating };
  }
  function spaceState(w, team) {
    ensureSpace(w);
    const st = w.space[team], tg = st.target ? w.umap.get(st.target) : null, en = enemyTeam(team);
    const flag = S.capsOf(w, team).find(u => u.pid) || null;
    return { stage: st.stage, stageName: SP.stageNames[st.stage - 1], stageT: w.t - st.t0, targetId: st.target, targetType: tg ? tg.type : '', targetSys: flag ? flag.tgtSys : '',
      won: st.won, lost: st.lost, own: fleetStats(w, team), enemy: fleetStats(w, en), superiority: S.orbitalSuperiority(w, team),
      escort: S.needsEscort(w, team).map(u => u.id), strikeReady: w.teams[team].strikeT <= 0 && S.strikeShips(w, team).length > 0,
      boarding: S.boardingState ? S.boardingState(w, team) : null, log: st.log };
  }

  // ── fleet report (carried into the campaign) ─────────────────
  function reportEntry(w, u, status) {
    const sys = {}; for (const n of ORDER) sys[n] = Math.round(u.sys[n].hp / u.sys[n].maxHp * 100) / 100;
    return { id: u.id, type: u.type, name: E.unitName('capital', u.type), status, t: w.t, hp: Math.round(Math.max(0, u.hp)), maxHp: u.maxHp, hullFrac: Math.max(0, u.hp / u.maxHp), shieldFrac: S.shieldFrac(u), sys, flag: !!u.flag, pdKills: u.pdKills };
  }
  function reportShip(w, u, status) {
    ensureSpace(w);
    const list = w.fleetReport[u.team], e = reportEntry(w, u, status), i = list.findIndex(x => x.id === u.id);
    if (i >= 0) list[i] = e; else list.push(e);
  }
  function refreshReport(w) {
    for (const t of E.TEAMS) for (const u of S.capsOf(w, t)) if (u.alive) reportShip(w, u, u.retreat ? 'retreating' : u.captured ? 'captured' : 'active');
  }

  // ── leaving the battle ───────────────────────────────────────
  function leaveBattle(w, u) {
    if (!u.alive) return;
    if (w._sp) w._sp.tick = -1;
    const hf = u.hp / u.maxHp;
    if (S.boardingEvacuate) S.boardingEvacuate(w, u, 'shipLeft');
    u.alive = false; u.retreated = true;
    if (u.pid && w.players[u.pid]) { const p = w.players[u.pid]; p.unitId = 0; p.deadT = w.t; u.pid = null; }
    reportShip(w, u, 'retreated');
    w.events.push({ type: 'shipRetreated', uid: u.id, team: u.team, utype: u.type, pos: V.clone(u.pos), hullFrac: hf });
    w.events.push({ type: 'announce', key: 'shipRetreated', team: u.team });
  }
  function beginRetreat(w, u, why) {
    if (u.retreat) return;
    u.retreat = true; u.powerGoal = SP.power.engines.slice(); u.powerMode = 3; u.tgtId = 0; u.tgtSys = '';
    w.events.push({ type: 'shipRetreating', uid: u.id, team: u.team, utype: u.type, hullFrac: u.hp / u.maxHp, why: why || '', pos: V.clone(u.pos) });
  }
  function crippled(u) {
    const hf = u.hp / u.maxHp;
    return hf < (u.flag ? SP.retreatHullFlag : SP.retreatHull) || (!u.sys.batteries.alive && !u.sys.hangar.alive) || (!u.sys.shield.alive && hf < 0.4);
  }

  // ── steering ─────────────────────────────────────────────────
  function enemyCentroid(w, team, o) {
    let n = 0; o.x = o.z = 0;
    for (const e of S.capsOf(w, enemyTeam(team))) { o.x += e.pos.x; o.z += e.pos.z; n++; }
    if (n) { o.x /= n; o.z /= n; } else { o.x = team === 'aegis' ? 800 : -800; o.z = 0; }
    return o;
  }
  const DSTAR = { screen: 950, line: 1000, flagship: 1100, carrier: 1750 };
  // fills H with a desired heading vector (x, z) and throttle
  function steer(w, u, tg) {
    const ai = u.ai, team = u.team, sgn = team === 'aegis' ? -1 : 1;
    let hx = 0, hz = 0, thr = 0.9;
    if (u.retreat) {
      enemyCentroid(w, team, tmpA);
      let ax = u.pos.x - tmpA.x, az = u.pos.z - tmpA.z, l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
      const ol = Math.hypot(u.pos.x, u.pos.z) || 1;
      hx = ax * 0.5 + u.pos.x / ol; hz = az * 0.5 + u.pos.z / ol; thr = 1;
    } else {
      let dist = 0, tx = 0, tz = 0;
      if (tg) { tx = tg.pos.x - u.pos.x; tz = tg.pos.z - u.pos.z; dist = Math.hypot(tx, tz) || 1; tx /= dist; tz /= dist; }
      else { tx = -sgn; tz = 0; dist = 0; }
      const ds = (DSTAR[u.role] || 1000) * ai.aggr * (u.sys.batteries.alive ? 1 : 1.35) * (w.space && w.space[team].stage === 3 && u.role !== 'carrier' ? 0.85 : 1);
      const k = tg ? E.clamp((dist - ds) / 500, -1.2, 1.2) : 0;
      // heading that presents the chosen flank (and its shield arc) to the target
      const fx = ai.face > 0 ? tz : -tz, fz = ai.face > 0 ? -tx : tx;
      hx = fx + tx * k; hz = fz + tz * k;
      if (!tg) { hx = (sgn * -1150 - u.pos.x) * 0.002 + 0.0; hz = (0 - u.pos.z) * 0.002; if (Math.abs(hx) + Math.abs(hz) < 0.15) { hx = fx; hz = fz; } }
      if (u.role === 'screen') { // picket ahead of the asset it screens
        let asset = null; for (const c of S.capsOf(w, team)) if (c.role === 'carrier' || (!asset && c.flag)) asset = c;
        if (asset) {
          enemyCentroid(w, team, tmpB);
          let ex = tmpB.x - asset.pos.x, ez = tmpB.z - asset.pos.z; const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
          const px = asset.pos.x + ex * 520 + (u.id % 2 ? -ez : ez) * 300 - u.pos.x, pz = asset.pos.z + ez * 520 + (u.id % 2 ? ex : -ex) * 300 - u.pos.z, pl = Math.hypot(px, pz) || 1;
          const wgt = E.clamp(pl / 500, 0, 1) * (tg && dist < 1300 ? 0.6 : 1.2);
          hx += px / pl * wgt; hz += pz / pl * wgt;
        }
      }
      if (tg && dist < ds * 0.85) thr = 0.5;
    }
    // stay inside the arena, keep clear of other hulls
    const B = w.layout.bound * 0.9, pr = Math.hypot(u.pos.x, u.pos.z);
    if (!u.retreat && pr > B * 0.75) { const f = (pr - B * 0.75) / (B * 0.25) * 2.5; hx -= u.pos.x / pr * f; hz -= u.pos.z / pr * f; }
    for (const c of S.lists(w).all) {
      if (c === u) continue;
      const dx = u.pos.x - c.pos.x, dz = u.pos.z - c.pos.z, d = Math.hypot(dx, dz) || 1, R = (u.def.len + c.def.len) * 0.36 + 120;
      if (d < R) { const f = (R - d) / R * 3; hx += dx / d * f; hz += dz / d * f; if (d < R * 0.6) thr = Math.min(thr, 0.35); }
    }
    H.x = hx; H.z = hz; H.thr = thr;
    return H;
  }
  function helmTo(w, u, dt) {
    const des = Math.atan2(H.x, H.z), err = S.angDiff(des, u.yaw), eng = S.engineMul(u), om = u.def.turn * eng, al = om * 0.45;
    const want = Math.sign(err) * Math.min(om, Math.sqrt(2 * al * Math.abs(err)) * 0.7);
    const thr = Math.abs(err) > 1 ? Math.min(H.thr, 0.5) : H.thr;
    S.stepCapital(w, u, dt, E.clamp(want / om, -1, 1), thr);
  }

  // ── fleet AI ─────────────────────────────────────────────────
  function firstAlive(tg, list) { for (const n of list) if (tg.sys[n].alive) return n; return ''; }
  function think(w, u) {
    const ai = u.ai, team = u.team, st = w.space ? w.space[team] : null, stage = st ? st.stage : 1;
    const en = S.capsOf(w, enemyTeam(team)).filter((e) => !w.cfg.fog || S.visible(w, team, e)), bridge = u.sys.bridge.alive;
    if (!u.retreat && !u.stranded && en.length && crippled(u)) {
      if (u.sys.engines.alive) beginRetreat(w, u, 'crippled'); else { u.stranded = true; w.events.push({ type: 'shipStranded', uid: u.id, team, pos: V.clone(u.pos) }); }
    }
    // pick the focus ship by stage
    let tg = null, bd = 1e12;
    if (!u.retreat) {
      const spare = en.some(e => !e.retreat);
      if (stage === 1) { for (const e of en) if (e.def.role === 'screen' && !(spare && e.retreat)) { const d = V.distance2(e.pos, u.pos); if (d < bd) { bd = d; tg = e; } } }
      if (!tg && st && st.target) { const o = w.umap.get(st.target); if (o && o.alive) tg = o; }
      if (!tg) { bd = 1e12; for (const e of en) { if (spare && e.retreat) continue; const d = V.distance2(e.pos, u.pos); if (d < bd) { bd = d; tg = e; } } }
      // nothing in reach of the objective: shoot what is
      if (tg && V.distance(tg.pos, u.pos) > 2800) { let nb = null; bd = 2800 * 2800; for (const e of en) { const d = V.distance2(e.pos, u.pos); if (d < bd) { bd = d; nb = e; } } if (nb) tg = nb; }
    }
    u.tgtId = tg ? tg.id : 0;
    u.tgtSys = tg ? (stage === 2 && tg.def.role !== 'screen' ? firstAlive(tg, SYS_PREF[ai.pref]) : stage === 1 && tg.def.role !== 'screen' ? firstAlive(tg, ['shield']) : '') : '';
    if (tg && stage === 3 && tg.def.role !== 'screen' && tg.sys.bridge.alive && S.boardingReady && S.boardingReady(w, u, tg)) u.tgtSys = '';
    // shields: present the stronger flank, switch rarely
    ai.faceT -= 0.5;
    const ps = u.arcs[2].v / u.arcs[2].max, ss = u.arcs[3].v / u.arcs[3].max;
    if (ai.faceT <= 0 && (ai.face > 0 ? ss : ps) < 0.6 * (ai.face > 0 ? ps : ss)) { ai.face = -ai.face; ai.faceT = 10; }
    // power
    if (bridge) {
      const fa = ai.face > 0 ? ss : ps;
      const goal = u.retreat ? 3 : !u.sys.shield.alive ? 2 : fa < 0.3 ? 1 : (stage >= 2 && fa > 0.6) ? 2 : 0;
      if (goal !== u.powerMode) { u.powerMode = goal; u.powerGoal = SP.power[SP.powerNames[goal]].slice(); }
    }
    // brace under heavy fire
    if (u.braceCd <= 0 && u.hitT < 1 && u.shield / Math.max(1, u.maxShield) < 0.12 && u.hp / u.maxHp < 0.5 && w.rng.next() < 0.5) brace(w, u);
    // fighters: launch cover when threatened or on a clock
    if (u.def.wing && u.launchCd <= 0 && u.sys.hangar.alive && (u.threat > 0 || w.tickN % 600 < 15)) launchWing(w, u);
    // boarding: send marines when the target is actually takeable (a downed
    // shield arc on the approach), and prize a weakened or already-broken hull
    if (tg && tg.def.role !== 'screen' && S.board && S.boardingReady && S.boardingReady(w, u, tg) && !u.retreat) {
      const ripe = stage === 3 || tg.hp / tg.maxHp < 0.6 || !tg.sys.bridge.alive;
      if (ripe && w.rng.next() < 0.5) S.board(w, team, u, tg);
    }
  }
  function aiCapital(w, u, dt) {
    S.capTick(w, u, dt);
    if (!u.alive) return;
    const ai = u.ai; ai.thinkT -= dt; u.boost = u.retreat;
    if (ai.thinkT <= 0) { ai.thinkT = (u.sys.bridge.alive ? 0.5 : 1.6) + w.rng.next() * 0.3; think(w, u); }
    const tg = u.tgtId ? w.umap.get(u.tgtId) : null;
    steer(w, u, tg && tg.alive ? tg : null); helmTo(w, u, dt);
    if (u.retreat && Math.hypot(u.pos.x, u.pos.z) > w.layout.bound * 1.3) { leaveBattle(w, u); return; }
    S.capitalGuns(w, u, dt, tg, u.tgtSys, false);
  }

  // ── commands shared by AI, player and verbs ──────────────────
  function brace(w, u) {
    if (u.braceCd > 0 || u.braceT > 0) return false;
    u.braceT = SP.braceTime; u.braceCd = SP.braceCd;
    w.events.push({ type: 'brace', uid: u.id, team: u.team, t: SP.braceTime, pos: V.clone(u.pos) });
    return true;
  }
  function setPower(w, u, mode) {
    if (!u.sys.bridge.alive) return false;
    mode = ((mode % 4) + 4) % 4; u.powerMode = mode; u.powerGoal = SP.power[SP.powerNames[mode]].slice();
    w.events.push({ type: 'powerShift', uid: u.id, team: u.team, mode: SP.powerNames[mode], to: u.pid });
    return true;
  }
  function launchWing(w, u) {
    if (!u.alive || !u.def.wing || !u.sys.hangar.alive || u.launchCd > 0 || u.captured) return 0;
    const T = w.teams[u.team]; let cnt = 0;
    for (const f of S.lists(w).fighters[u.team]) cnt++;
    const n = Math.min(Math.min(4, u.def.bays), T.airCap + 6 - cnt);
    if (n <= 0) return 0;
    for (let k = 0; k < n; k++) { const f = S.launchFighter(w, u.team, u, w.rng.i(6)); w.events.push({ type: 'launch', pos: V.clone(f.pos), team: u.team, uid: u.id }); }
    u.launchCd = 45; w.events.push({ type: 'launchOrder', uid: u.id, team: u.team, n });
    return n;
  }
  function retreatOrder(w, u) { if (u.retreat) { u.retreat = false; return false; } beginRetreat(w, u, 'ordered'); return true; }

  // ── player command ───────────────────────────────────────────
  function cycleTarget(w, u, pid) {
    const en = S.capsOf(w, enemyTeam(u.team)).slice().sort((a, b) => V.distance2(a.pos, u.pos) - V.distance2(b.pos, u.pos) || a.id - b.id);
    if (!en.length) { u.tgtId = 0; u.tgtSys = ''; return; }
    const cur = u.tgtId ? en.findIndex(e => e.id === u.tgtId) : -1;
    if (cur < 0) { u.tgtId = en[0].id; u.tgtSys = ''; }
    else {
      const e = en[cur], names = ORDER.filter(n => e.sys[n].alive), ix = u.tgtSys ? names.indexOf(u.tgtSys) : -1;
      if (ix + 1 < names.length) u.tgtSys = names[ix + 1];
      else if (cur + 1 < en.length) { u.tgtId = en[cur + 1].id; u.tgtSys = ''; }
      else { u.tgtId = 0; u.tgtSys = ''; }
    }
    w.events.push({ type: 'targetSelected', uid: u.id, to: pid, tid: u.tgtId, sys: u.tgtSys });
  }
  function playerCapital(w, u, p, dt) {
    S.capTick(w, u, dt);
    if (!u.alive) return;
    const inp = p.input, ed = u.edge || (u.edge = { cycle: false, abil2: false, jump: false, crouch: false });
    const mx = E.clamp(inp.mx || 0, -1, 1), mz = E.clamp(inp.mz || 0, -1, 1);
    if (inp.cycle && !ed.cycle && u.sys.bridge.alive) cycleTarget(w, u, p.id);
    if (inp.abil2 && !ed.abil2) setPower(w, u, u.powerMode + 1);
    if (inp.jump && !ed.jump) launchWing(w, u);
    if (inp.crouch && !ed.crouch) brace(w, u);
    ed.cycle = !!inp.cycle; ed.abil2 = !!inp.abil2; ed.jump = !!inp.jump; ed.crouch = !!inp.crouch;
    if (u.sys.bridge.alive && Math.abs(inp.roll || 0) > 0.4) { // roll shifts power between shields and weapons
      const a = inp.roll * 0.3 * dt, g = u.powerGoal;
      g[0] = E.clamp(g[0] + a, 0.12, 0.6); g[1] = E.clamp(g[1] - a, 0.12, 0.6); const s = g[0] + g[1] + g[2]; g[0] /= s; g[1] /= s; g[2] /= s; u.powerMode = -1;
    }
    u.boost = !!inp.sprint && !u.retreat;
    // helm: the throttle is a telegraph, the wheel turns the ship by torque
    if (u.retreat) { const tg = null; steer(w, u, tg); helmTo(w, u, dt); }
    else { u.throttle = E.clamp(u.throttle + mz * 0.3 * dt, -0.3, 1); S.stepCapital(w, u, dt, -mx, u.throttle); }
    if (u.retreat && Math.hypot(u.pos.x, u.pos.z) > w.layout.bound * 1.3) { leaveBattle(w, u); return; }
    S.dirOf(inp.yaw, inp.pitch, tmpD);
    let focus = u.tgtId ? w.umap.get(u.tgtId) : null;
    if (focus && !focus.alive) { focus = null; u.tgtId = 0; u.tgtSys = ''; }
    if (!focus && inp.fire) focus = S.aimTarget(w, u, u.pos, tmpD, 0.3, 2800, e => e.kind === 'capital');
    S.capitalGuns(w, u, dt, focus, focus && focus.id === u.tgtId ? u.tgtSys : '', !!inp.fire);
    const T = w.teams[u.team];
    if (u.strikeTry > 0) u.strikeTry -= dt;
    if (inp.abil && T.strikeT <= 0 && !(u.strikeTry > 0) && u.sys.bridge.alive) {
      const o = { x: u.pos.x, y: u.pos.y - u.h, z: u.pos.z }, t = w.terrain.raycast(o, tmpD, 12000);
      u.strikeTry = 1.5;
      if (t > 0 && S.strike(w, u.team, { x: o.x + tmpD.x * t, y: 0, z: o.z + tmpD.z * t }, p.id)) T.strikeT = E.WEAPONS.orbital.cd * (T.bonus.orbital ? 0.6 : 1);
    }
  }

  // ── verbs (commanders without a helm, UI buttons) ────────────
  function shipOf(w, pid) {
    const p = w.players[pid]; if (!p) return null;
    const u = p.unitId ? w.umap.get(p.unitId) : null;
    if (u && u.kind === 'capital') return u;
    return S.capsOf(w, p.team).find(c => c.flag) || S.capsOf(w, p.team)[0] || null;
  }
  Object.assign(S.verbs, {
    launch: (w, pid) => { const u = shipOf(w, pid); return u ? launchWing(w, u) : 0; },
    brace: (w, pid) => { const u = shipOf(w, pid); return u ? brace(w, u) : false; },
    power: (w, pid, mode) => { const u = shipOf(w, pid); return u ? setPower(w, u, typeof mode === 'string' ? SP.powerNames.indexOf(mode) : mode | 0) : false; },
    retreat: (w, pid) => { const u = shipOf(w, pid); return u ? retreatOrder(w, u) : false; },
    target: (w, pid, id, sys) => { const u = shipOf(w, pid), t = w.umap.get(id); if (!u || !t || t.kind !== 'capital' || t.team === u.team) return false; u.tgtId = id; u.tgtSys = sys && t.sys[sys] && t.sys[sys].alive ? sys : ''; return true; },
    strike: (w, pid, x, z) => {
      const u = shipOf(w, pid), p = w.players[pid]; if (!u || !p) return false;
      const T = w.teams[u.team]; if (T.strikeT > 0) return false;
      if (S.strike(w, u.team, { x, y: 0, z }, pid)) { T.strikeT = E.WEAPONS.orbital.cd * (T.bonus.orbital ? 0.6 : 1); return true; }
      return false;
    },
    board: (w, pid, tid) => { const u = shipOf(w, pid), t = tid ? w.umap.get(tid) : (u && u.tgtId ? w.umap.get(u.tgtId) : null); return u && t && S.board ? S.board(w, u.team, u, t) : false; },
  });

  // ── multiplayer: what guests need to draw the HUD ────────────
  const q = (x) => Math.round(E.clamp(x, 0, 1) * 100);
  S.net.unit.capital = {
    // [arc fore/aft/port/stbd %, sys hp% x6 in E.SPACE.order, power sh/wp/en %, tgtId, tgtSys index (-1 none), flags, throttle%, braceT*10, coreT*10]
    pack(u) {
      if (!u.sys) return 0;
      return [u.arcs[0].v / u.arcs[0].max, u.arcs[1].v / u.arcs[1].max, u.arcs[2].v / u.arcs[2].max, u.arcs[3].v / u.arcs[3].max].map(q)
        .concat(ORDER.map(n => q(u.sys[n].hp / u.sys[n].maxHp)), u.power.map(q),
          [u.tgtId, ORDER.indexOf(u.tgtSys), (u.retreat ? 1 : 0) | (u.braceT > 0 ? 2 : 0) | (u.needsEscort ? 4 : 0) | (u.boarding ? 8 : 0) | (u.captured ? 16 : 0) | (u.stranded ? 32 : 0), Math.round(u.throttle * 100), Math.round(Math.max(0, u.braceT) * 10), Math.round(u.coreT * 10)]);
    },
    apply(u, a) {
      if (!Array.isArray(a)) return;
      if (!u.sys) { S.initCapital(u); }
      for (let i = 0; i < 4; i++) { u.arcs[i].max = u.arcs[i].max || (u.maxShield * SP.arcShare[i]); u.arcs[i].v = a[i] / 100 * u.arcs[i].max; }
      ORDER.forEach((n, i) => { const s = u.sys[n]; s.hp = a[4 + i] / 100 * s.maxHp; s.alive = a[4 + i] > 0; });
      u.power = [a[10] / 100, a[11] / 100, a[12] / 100];
      u.tgtId = a[13]; u.tgtSys = a[14] >= 0 ? ORDER[a[14]] : '';
      const f = a[15]; u.retreat = !!(f & 1); u.braceT = a[17] / 10; u.needsEscort = !!(f & 4); u.boarding = (f & 8) ? (u.boarding || {}) : null; u.captured = !!(f & 16); u.stranded = !!(f & 32);
      u.throttle = a[16] / 100; u.coreT = a[18] / 10;
    },
  };
  S.net.world.space = {
    pack(w) { ensureSpace(w); return E.TEAMS.map(t => { const s = w.space[t]; return [s.stage, s.target, (s.won ? 1 : 0) | (s.lost ? 2 : 0), Math.round(s.t0 * 10)]; }); },
    apply(w, d) { ensureSpace(w); E.TEAMS.forEach((t, i) => { const s = w.space[t], r = d[i]; if (!r) return; s.stage = r[0]; s.target = r[1]; s.won = !!(r[2] & 1); s.lost = !!(r[2] & 2); s.t0 = r[3] / 10; }); },
  };

  const C = S.ctl = S.ctl || {};
  C.capital = Object.assign(C.capital || {}, { ai: aiCapital, player: playerCapital });
  S.systems.push(spaceSystem);
  Object.assign(S, { aiCapital, playerCapital, spaceState, fleetStats, reportShip, leaveBattle, beginRetreat, crippled, brace, setPower, launchWing, cycleTarget, ensureSpace, shipOf });
})(window.E = window.E || {});
