// Fog of war: which enemies a team can actually see. A team always sees its own
// units; an enemy is seen only when a friendly observer is within sight range
// with line of sight (and it is not masked by cloud), or when it sits inside a
// command post the team owns. Sight ranges are a little longer than weapon
// ranges so a unit can usually see what it is about to shoot. This is the single
// source of truth shared by the networked snapshot filter, the renderer and
// (when fog is enabled) the AI. Deterministic: pure distance/LOS lookups, no RNG.
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {};
  const SIGHT = {
    infantry: { _: 340, sniper: 560 },
    vehicle: { _: 540, aa: 950 },
    fighter: { _: 1500, interceptor: 1700, bomber: 1000, strike: 1200, gunship: 900 },
    capital: { _: 3000, frigate: 2400, cruiser: 2600, carrier: 2800, dreadnought: 3200 },
    turret: { _: 520, aabattery: 1000, battery: 720, shieldgen: 420, ioncannon: 1350, nest: 420 },
  };
  const CP_SIGHT = 700;

  function sightOf(u) { const t = SIGHT[u.kind]; if (!t) return 500; return t[u.type] || t._ || 500; }

  // Set of unit ids visible to `team`, cached for the current tick.
  function vision(w, team) {
    if (w._visTick !== w.tickN) { w._visTick = w.tickN; w._vis = {}; }
    const cached = w._vis[team];
    if (cached) return cached;
    const out = new Set(), observers = [];
    for (const u of w.units) if (u.alive && u.team === team) { out.add(u.id); observers.push(u); }
    const tmpB = {};
    for (const e of w.units) {
      if (!e.alive || e.team === team) continue;
      let vis = false;
      for (const o of observers) {
        const r = sightOf(o), dx = e.pos.x - o.pos.x, dy = e.pos.y - o.pos.y, dz = e.pos.z - o.pos.z;
        if (dx * dx + dy * dy + dz * dz > r * r) continue;
        if (S.los && !S.los(w, o.pos, S.centerOf(e, tmpB))) continue;
        if (S.cloudBlocks && S.cloudBlocks(o.pos, e.pos)) continue;
        vis = true; break;
      }
      if (!vis && w.cps) for (const c of w.cps) {
        if (c.owner !== team) continue;
        const dx = e.pos.x - c.pos.x, dz = e.pos.z - c.pos.z, r = CP_SIGHT + (c.r || 0);
        if (dx * dx + dz * dz <= r * r) { vis = true; break; }
      }
      if (vis) out.add(e.id);
    }
    w._vis[team] = out;
    return out;
  }

  // True when `team` may perceive entity `e` (own units and nulls are always seen).
  function visible(w, team, e) { return !e || e.team === team || vision(w, team).has(e.id); }

  Object.assign(S, { vision, visible, sightOf, CP_SIGHT });
})(window.E = window.E || {});
