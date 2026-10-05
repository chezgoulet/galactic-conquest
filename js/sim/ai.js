// AI perception and intent shared by every unit kind: target selection, which
// command post to push, squad orders, and the periodic "think" that refreshes
// them. The per-domain files (land/air/space) turn this into movement and fire.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  const tmpA = V.make(), tmpB = V.make();
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

  // ── AI: perception ───────────────────────────────────────────
  function pickTarget(w, u) {
    const W = E.WEAPONS[u.def.weapon], pref = PREF[u.type] || PREF.trooper;
    const sense = u.kind === 'infantry' ? Math.min(W.range, u.type === 'sniper' ? 520 : 230) : u.kind === 'fighter' ? 1500 : W.range;
    let best = null, bs = 0; S.eyeOf(u, tmpA);
    for (const e of w.units) {
      if (!e.alive || e.team === u.team) continue;
      if (w.cfg && w.cfg.fog && !S.visible(w, u.team, e)) continue;
      const pf = pref[e.kind]; if (!pf) continue;
      const d = V.distance(u.pos, e.pos);
      if (d > sense && e.kind !== 'capital') continue;
      let s = pf * 1000 / (d + 60);
      if (e.id === u.ai.tid) s *= 1.3;
      if (s <= bs) continue;
      if (u.kind !== 'fighter' && e.kind !== 'fighter' && !S.los(w, tmpA, S.centerOf(e, tmpB))) continue;
      bs = s; best = e;
    }
    return best;
  }

  function chooseGoal(w, u) {
    let best = -1, bs = 0; const en = S.enemyOf(u.team), R = w.rng;
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

  Object.assign(S, { pickTarget, chooseGoal, goalPos, think, target });
})(window.E = window.E || {});
