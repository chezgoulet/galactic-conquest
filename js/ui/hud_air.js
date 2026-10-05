// Flight HUD: speed and altitude tapes, throttle + afterburner, pitch ladder, g and
// drift, stall / missile / lock warnings (with the direction of the threat), lock
// box with progress, ordnance / countermeasure / troop pips, bomb pipper, band
// banner. Drawn on the HUD canvas; the text warnings and pips are DOM.
(function (E) {
  'use strict';
  const P = E.HUD.prototype;
  const BAND = { low: ['LOW ALTITUDE', 'Full lift. Watch the ground and AA batteries'], cloud: ['CLOUD DECK', 'Reduced visibility. AA batteries lose you'], high: ['HIGH ALTITUDE', 'Thin air: less lift, slow handling'], space: ['ORBIT', 'Vacuum: no lift, no drag. Fly by thrust and inertia'] };
  const pips = (el, n, max) => { const key = n + '/' + max; if (el._p === key) return; el._p = key; el.innerHTML = '<i class="on"></i>'.repeat(Math.max(0, Math.min(n, max))) + '<i></i>'.repeat(Math.max(0, max - Math.max(0, n))); };

  P.airUpdate = function (u, w, dt) {
    const $ = this.$, d = u.def, tmp = this._tmp || (this._tmp = {});
    // ordnance, countermeasures, troops
    pips($.pips.querySelector('.ord div'), u.ord | 0, d.ord || 0); pips($.pips.querySelector('.cm div'), u.cm | 0, d.cm || 0); if (d.carry) pips($.pips.querySelector('.carry div'), u.carry | 0, d.carry);
    // band banner
    const b = BAND[u.band] || BAND.low; const bn = $.fl.querySelector('.fl-band');
    this.tx(bn, b[0] + ' — ' + b[1]); this.cl(bn, 'space', u.band === 'space');
    // warnings
    const W = [];
    if (u.warn === 3) W.push(['MISSILE — ' + Math.round(u.mslD || 0) + ' m — FLARES (SPACE)', 'crit']); else if (u.warn === 2) W.push(['LOCKED ON — EVADE', 'crit']); else if (u.warn === 1) W.push(['TRACKED', 'warn']);
    if (u.stallWarn || u.stall >= 0.5) W.push(['STALL — NOSE DOWN, THROTTLE UP', 'crit']);
    if (u.oob > 0.02) W.push(['LEAVING THE BATTLE AREA — TURN BACK ' + Math.round(u.oob * 100) + '%', 'warn']);
    if (u.agl < 70 && u.vel.y < -18 && u.band === 'low') W.push(['PULL UP', 'crit']);
    if (d.carry && u.carry > 0) W.push([u.agl <= 45 && u.spd <= 22 ? 'TROOPS ABOARD — PRESS X TO DROP' : 'TROOPS ABOARD — HOVER LOW AND SLOW TO DROP', 'info']);
    if (u.locked) W.push(['TARGET LOCKED — FIRE', 'good']);
    const html = W.map(([t, c]) => `<div class="${c}">${t}</div>`).join('');
    if ($.fl.querySelector('.fl-warn')._v !== html) { $.fl.querySelector('.fl-warn')._v = html; $.fl.querySelector('.fl-warn').innerHTML = html; }
    void tmp;
  };

  P.airOverlay = function (ctx, u, w, cam, o, W, H, R) {
    const d = u.def, cx = W / 2, cy = H / 2, hx = R * 17, th = R * 9, lw = Math.max(1.5, R * 0.12);
    const green = '#9dffc8', amber = '#ffc24a', red = '#ff4a3a', dim = 'rgba(190,230,255,.55)';
    ctx.lineWidth = lw; ctx.font = `600 ${R * 0.7}px system-ui`; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 5;
    const space = u.band === 'space', dens = u.dens == null ? 1 : u.dens;
    const stallV = d.stall / Math.sqrt(Math.max(dens, 0.35));
    // speed tape (left)
    const tape = (x, val, step, per, side, marks) => {
      ctx.save(); ctx.beginPath(); ctx.rect(x - R * 3.2, cy - th, R * 6.4, th * 2); ctx.clip();
      ctx.strokeStyle = dim; ctx.fillStyle = dim; ctx.textAlign = side > 0 ? 'left' : 'right';
      const lo = Math.floor((val - per) / step) * step;
      for (let v = lo; v <= val + per; v += step) { const y = cy - (v - val) / per * th; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + side * R * 0.9, y); ctx.stroke(); if (v >= 0 && Math.round(v / step) % 2 === 0) ctx.fillText(String(Math.round(v)), x + side * R * 1.2, y); }
      if (marks) for (const [v, c] of marks) { const y = cy - (v - val) / per * th; if (Math.abs(y - cy) < th) { ctx.strokeStyle = c; ctx.lineWidth = lw * 2; ctx.beginPath(); ctx.moveTo(x - side * R * 0.4, y); ctx.lineTo(x + side * R * 0.9, y); ctx.stroke(); ctx.lineWidth = lw; } }
      ctx.restore();
    };
    const spd = u.spd || 0;
    tape(cx - hx, spd, 10, 50, 1, [[stallV, red], [d.speed, 'rgba(120,255,180,.6)']]);
    tape(cx + hx, Math.max(0, u.agl), 20, 140, -1, [[0, red]]);
    // readout boxes
    const box = (x, y, txt, col, side) => { ctx.fillStyle = 'rgba(4,10,16,.82)'; ctx.strokeStyle = col; const bw = R * 3.6, bh = R * 1.5; ctx.fillRect(x - (side > 0 ? 0 : bw), y - bh / 2, bw, bh); ctx.strokeRect(x - (side > 0 ? 0 : bw), y - bh / 2, bw, bh); ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.font = `700 ${R * 0.95}px system-ui`; ctx.fillText(txt, x + (side > 0 ? bw / 2 : -bw / 2), y + 1); ctx.font = `600 ${R * 0.7}px system-ui`; };
    box(cx - hx - R * 3.9, cy, Math.round(spd), spd < stallV * 1.25 && dens > 0.3 ? red : green, 1);
    box(cx + hx + R * 3.9, cy, space ? '—' : Math.round(Math.max(0, u.agl)), u.agl < 80 && u.band === 'low' ? amber : green, -1);
    ctx.fillStyle = dim; ctx.textAlign = 'center'; ctx.font = `600 ${R * 0.6}px system-ui`;
    ctx.fillText('SPEED m/s', cx - hx - R * 2.1, cy + th + R * 1.1); ctx.fillText(space ? 'ORBIT' : 'AGL m', cx + hx + R * 2.1, cy + th + R * 1.1);
    ctx.fillText('Y ' + Math.round(u.pos.y) + ' m · ' + (BAND[u.band] || BAND.low)[0], cx + hx + R * 2.1, cy + th + R * 2);
    // throttle + afterburner bars
    const bx = cx - hx - R * 8.4, by = cy + th, bh = th * 2;
    ctx.fillStyle = 'rgba(4,10,16,.7)'; ctx.fillRect(bx, by - bh, R * 0.9, bh); ctx.strokeStyle = dim; ctx.strokeRect(bx, by - bh, R * 0.9, bh);
    ctx.fillStyle = green; ctx.fillRect(bx, by - bh * (u.thr || 0), R * 0.9, bh * (u.thr || 0));
    const ex = bx + R * 1.3; ctx.fillStyle = 'rgba(4,10,16,.7)'; ctx.fillRect(ex, by - bh, R * 0.9, bh); ctx.strokeStyle = dim; ctx.strokeRect(ex, by - bh, R * 0.9, bh);
    ctx.fillStyle = u.boostLock ? red : u.boosting ? '#fff' : amber; ctx.fillRect(ex, by - bh * (u.boostE == null ? 1 : u.boostE), R * 0.9, bh * (u.boostE == null ? 1 : u.boostE));
    ctx.fillStyle = dim; ctx.textAlign = 'center'; ctx.fillText('THR', bx + R * 0.45, by + R * 0.9); ctx.fillStyle = u.boosting ? '#fff' : u.boostLock ? red : dim; ctx.fillText(u.boostLock ? 'AB LOCK' : 'AB', ex + R * 0.45, by + R * 0.9);
    // g and drift (under the throttle)
    ctx.textAlign = 'left'; ctx.fillStyle = (u.g || 1) > 7 ? red : dim; ctx.fillText('G ' + (u.g || 1).toFixed(1), bx, by - bh - R * 2.2);
    if (d.cm !== undefined && !d.vtol) { ctx.fillStyle = u.drift ? amber : dim; ctx.fillText('DRIFT', bx, by - bh - R * 1.1); const de = u.driftE == null ? 1 : E.clamp01(u.driftE / (E.AIR.driftMax || 1)); ctx.fillStyle = 'rgba(4,10,16,.7)'; ctx.fillRect(bx + R * 3, by - bh - R * 1.4, R * 4, R * 0.7); ctx.fillStyle = u.drift ? amber : dim; ctx.fillRect(bx + R * 3, by - bh - R * 1.4, R * 4 * (de > 1 ? 1 : de), R * 0.7); }
    // heading
    const hdg = (((-u.yaw * 180 / Math.PI) % 360) + 360) % 360;
    ctx.textAlign = 'center'; ctx.fillStyle = green; ctx.font = `700 ${R * 0.9}px system-ui`; ctx.fillText(String(Math.round(hdg)).padStart(3, '0') + '°', cx, R * 5.2); ctx.font = `600 ${R * 0.7}px system-ui`;
    // pitch ladder
    ctx.strokeStyle = 'rgba(157,255,200,.5)'; ctx.fillStyle = 'rgba(157,255,200,.7)';
    for (const pd of [-30, -20, -10, 0, 10, 20, 30]) {
      const p = pd * Math.PI / 180, dir = E.SIM.dirOf(u.yaw, p);
      cam.project({ x: u.pos.x + dir.x * 1000, y: u.pos.y + dir.y * 1000, z: u.pos.z + dir.z * 1000 }, o); if (!o.vis) continue;
      const half = pd === 0 ? R * 5 : R * 2.2; if (Math.abs(o.x - cx) > hx * 0.9 || Math.abs(o.y - cy) > th * 1.2) continue;
      ctx.beginPath(); ctx.moveTo(o.x - half, o.y); ctx.lineTo(o.x - half * 0.35, o.y); ctx.moveTo(o.x + half * 0.35, o.y); ctx.lineTo(o.x + half, o.y); ctx.stroke();
      if (pd !== 0) { ctx.textAlign = 'right'; ctx.fillText(String(pd), o.x - half - 4, o.y); }
    }
    // gun cross (where the nose points) is drawn by the base HUD; here the velocity vector
    if (spd > 8) { const vx = u.vel.x, vy = u.vel.y, vz = u.vel.z; cam.project({ x: u.pos.x + vx * 20, y: u.pos.y + vy * 20, z: u.pos.z + vz * 20 }, o); if (o.vis) { ctx.strokeStyle = green; ctx.beginPath(); ctx.arc(o.x, o.y, R * 0.45, 0, E.TAU); ctx.moveTo(o.x - R * 0.9, o.y); ctx.lineTo(o.x - R * 0.45, o.y); ctx.moveTo(o.x + R * 0.9, o.y); ctx.lineTo(o.x + R * 0.45, o.y); ctx.moveTo(o.x, o.y - R * 0.9); ctx.lineTo(o.x, o.y - R * 0.45); ctx.stroke(); } }
    // nose marker
    { const dir = E.SIM.dirOf(u.yaw, u.pitch); cam.project({ x: u.pos.x + dir.x * 400, y: u.pos.y + dir.y * 400, z: u.pos.z + dir.z * 400 }, o); if (o.vis) { ctx.strokeStyle = '#fff'; ctx.lineWidth = lw * 1.4; ctx.beginPath(); ctx.arc(o.x, o.y, R * 0.7, 0, E.TAU); ctx.stroke(); ctx.lineWidth = lw; } }
    // lock box
    const tg = u.lockId ? w.byId(u.lockId) : null;
    if (tg && tg.alive) {
      cam.project(tg.pos, o);
      const dist = Math.hypot(tg.pos.x - u.pos.x, tg.pos.y - u.pos.y, tg.pos.z - u.pos.z);
      if (o.vis) {
        const s = R * 1.5, col = u.locked ? red : amber; ctx.strokeStyle = col; ctx.lineWidth = lw * 1.5;
        ctx.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(o.x + sx * s, o.y + sy * s * 0.4); ctx.lineTo(o.x + sx * s, o.y + sy * s); ctx.lineTo(o.x + sx * s * 0.4, o.y + sy * s); } ctx.stroke();
        ctx.beginPath(); ctx.arc(o.x, o.y, s * 1.35, -Math.PI / 2, -Math.PI / 2 + E.TAU * E.clamp01(u.lockT)); ctx.stroke();
        ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.fillText((u.locked ? 'LOCK · ' : 'LOCKING ' + Math.round(u.lockT * 100) + '% · ') + E.unitName(tg.kind, tg.type).toUpperCase() + ' · ' + Math.round(dist) + ' m', o.x, o.y + s * 2 + R * 0.5);
        ctx.lineWidth = lw;
      }
    }
    // bomb pipper
    if (d.alt === 'bomb') {
      const bi = E.SIM.bombImpact(w, u, this._bi || (this._bi = {}));
      if (bi) { cam.project(bi, o); if (o.vis) { ctx.strokeStyle = u.ord > 0 ? amber : dim; ctx.lineWidth = lw * 1.5; ctx.beginPath(); ctx.arc(o.x, o.y, R * 1.1, 0, E.TAU); ctx.moveTo(o.x - R * 1.7, o.y); ctx.lineTo(o.x + R * 1.7, o.y); ctx.moveTo(o.x, o.y - R * 1.7); ctx.lineTo(o.x, o.y + R * 1.7); ctx.stroke(); ctx.fillStyle = u.ord > 0 ? amber : dim; ctx.textAlign = 'center'; ctx.fillText(u.ord > 0 ? 'IMPACT' : 'NO BOMBS', o.x, o.y + R * 2.4); ctx.lineWidth = lw; } }
    }
    // threat bearing
    if (u.warn >= 2) {
      const th2 = w.byId(u.mslBy || u.warnBy);
      if (th2) { const a = Math.atan2(th2.pos.x - u.pos.x, th2.pos.z - u.pos.z) - cam.yaw, rr = Math.min(W, H) * 0.3; ctx.save(); ctx.translate(cx - Math.sin(a) * rr, cy - Math.cos(a) * rr); ctx.rotate(-a + Math.PI); ctx.fillStyle = u.warn === 3 ? red : amber; ctx.beginPath(); ctx.moveTo(0, -R * 1.2); ctx.lineTo(R * 0.9, R * 0.8); ctx.lineTo(-R * 0.9, R * 0.8); ctx.closePath(); ctx.fill(); ctx.restore(); }
    }
    ctx.textBaseline = 'middle'; ctx.shadowBlur = 0;
  };
})(window.E = window.E || {});
