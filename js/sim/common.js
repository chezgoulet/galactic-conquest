// Shared sim vocabulary: angle/vector helpers, unit construction and arena
// bounds. Every other sim module builds on these.
//
// Module convention (all js/sim/*.js): each file is an IIFE that adds its
// functions to the shared E.SIM namespace. Call a function from the same file
// bare; call anything from another sim file as S.name(...) — it is resolved at
// call time, so the files can load in any order.
//
// Space conventions: y is up; yaw 0 faces +z and forward = (sin yaw, 0, cos yaw);
// "right" (screen-right when looking forward) = (-cos yaw, 0, sin yaw).
(function (E) {
  'use strict';
  const S = E.SIM = E.SIM || {}, V = E.V3;
  function dirOf(yaw, pitch, o) { const c = Math.cos(pitch); o = o || {}; o.x = Math.sin(yaw) * c; o.y = Math.sin(pitch); o.z = Math.cos(yaw) * c; return o; }
  function angDiff(a, b) { let d = (a - b) % E.TAU; if (d > Math.PI) d -= E.TAU; if (d < -Math.PI) d += E.TAU; return d; }
  function turnTo(cur, want, max) { const d = angDiff(want, cur); return cur + E.clamp(d, -max, max); }
  function isGroundKind(u) { return u.kind === 'infantry' || u.kind === 'vehicle' || u.kind === 'turret'; }
  function centerOf(u, o) { o = o || {}; o.x = u.pos.x; o.z = u.pos.z; o.y = u.pos.y + (isGroundKind(u) ? u.h * 0.55 : 0); return o; }
  function eyeOf(u, o) { o = o || {}; o.x = u.pos.x; o.z = u.pos.z; o.y = u.pos.y + (u.kind === 'infantry' ? u.h * 0.86 : isGroundKind(u) ? u.h * 0.8 : 0); return o; }
  function enemyOf(t) { return t === 'aegis' ? 'verdant' : 'aegis'; }
  function nameOf(w, u) { return u.pid && w.players[u.pid] ? w.players[u.pid].name : E.unitName(u.kind, u.type); }

  // ── the three domains share one sky, split by altitude (meters above datum) ──
  // ground .. cloud deck .. thin upper air .. space. Capital ships hold station
  // at ALT.orbit; fighters fly the whole column. density() is 1 at the surface
  // and 0 from ALT.space up — drag, lift and sound all scale with it.
  const ALT = { cloudLo: 700, cloudHi: 1000, space: 2600, orbit: 3200, ceiling: 4400 };
  function density(y) { return E.clamp01(1 - y / ALT.space); }
  function inSpace(y) { return y >= ALT.space; }

  // ── unit construction ────────────────────────────────────────
  function spawnUnit(w, kind, type, team, pos, extra) {
    const def = E.unitDef(kind, type), D = E.DOCTRINE[team], B = w.teams[team].bonus || {};
    let hpM = 1, spM = 1;
    if (kind === 'infantry') { hpM = D.infHp * (B.elite ? 1.2 : 1); spM = D.infSpeed; }
    else if (kind === 'vehicle') hpM = D.vehHp * (B.armor ? 1.15 : 1);
    else if (kind === 'fighter') { hpM = D.fighterHp; spM = D.fighterSpeed; }
    else if (kind === 'capital') hpM = D.capHp * (B.hull ? 1.25 : 1);
    const hp = Math.round(def.hp * hpM);
    const u = {
      id: w.nextId++, kind, type, team, def, armor: def.armor,
      pos: { x: pos.x, y: pos.y !== undefined ? pos.y : w.groundY(pos.x, pos.z), z: pos.z }, vel: { x: 0, y: 0, z: 0 },
      yaw: team === 'aegis' ? Math.PI / 2 : -Math.PI / 2, pitch: 0, roll: 0, aimYaw: 0, aimPitch: 0,
      hp, maxHp: hp, shield: Math.round((def.shield || 0) * (kind === 'capital' ? hpM : 1)), maxShield: 0, hitT: 99,
      alive: true, r: def.r, h: def.h, speed: def.speed * spM, spM, spd: 0, vy: 0, onGround: true,
      heat: 0, hot: false, fireT: 0, altT: 2, lastFire: -9, gunSide: 1,
      pid: null, kills: 0, order: null, bornT: w.t,
      ai: { thinkT: w.rng.next() * 0.5, tid: 0, los: false, goal: -1, goalT: 0, off: { x: 0, z: 0 }, offT: 0,
            strafe: w.rng.sign(), strafeT: 1, burstT: 0, pauseT: 0, errY: 0, errP: 0, state: '', stateT: 0, bYaw: 0, bPitch: 0 },
    };
    u.maxShield = u.shield; u.aimYaw = u.yaw;
    if (extra) Object.assign(u, extra);
    if (kind === 'capital') S.buildGuns(u);
    w.units.push(u); w.umap.set(u.id, u);
    w.events.push({ type: 'spawn', uid: u.id });
    return u;
  }

  function ring(w, c, a, b) { const an = w.rng.angle(), d = w.rng.f(a, b); return { x: c.x + Math.cos(an) * d, z: c.z + Math.sin(an) * d }; }
  function pickClass(w) { return w.rng.pickW(E.FORCE.mix); }

  function clampArena(w, u) {
    const A = w.layout.arena, mx = A.x * 1.22, mz = A.z * 1.22;
    if (u.pos.x > mx) u.pos.x = mx; else if (u.pos.x < -mx) u.pos.x = -mx;
    if (u.pos.z > mz) u.pos.z = mz; else if (u.pos.z < -mz) u.pos.z = -mz;
  }

  // ── extension points ─────────────────────────────────────────
  // S.ctl[kind]   = { ai(w, u, dt), player(w, u, p, dt) }   per-kind control (land/air/space register)
  // S.verbs[name] = fn(w, pid, a, b)                        player commands beyond the built-in ones
  // S.systems     = [fn(w, dt)]                             extra per-tick world systems, run in order
  // S.modes[name] = { ai, player }                          overrides S.ctl for units with u.mode === name
  // S.obstacles   = [{ trace(w, p, ax, ay, az, sx, sy, sz, maxT) -> { t, surf, hit(w, p, pos) } | null,
  //                    blocks(w, a, b) -> bool }]           world geometry shots and sightlines stop on
  // optional S.ctl[kind] hooks (see combat.js): damage, hull, nearMiss, death
  // S.net.unit[kind] = { pack(u) -> array, apply(u, array) }   extra per-unit state guests need
  // S.net.world[key] = { pack(w) -> any,   apply(w, data) }    extra world state guests need
  S.ctl = S.ctl || {}; S.verbs = S.verbs || {}; S.systems = S.systems || [];
  S.modes = S.modes || {}; S.obstacles = S.obstacles || [];
  S.net = S.net || { unit: {}, world: {} };
  function packUnit(u) { const n = S.net.unit[u.kind]; return n ? n.pack(u) : 0; }
  function unpackUnit(u, d) { const n = S.net.unit[u.kind]; if (n && d) n.apply(u, d); }
  function packWorld(w) { const o = {}; for (const k in S.net.world) o[k] = S.net.world[k].pack(w); return o; }
  function unpackWorld(w, o) { if (o) for (const k in S.net.world) if (o[k] !== undefined) S.net.world[k].apply(w, o[k]); }
  function verb(w, pid, name, a, b) { const f = S.verbs[name]; return f && w.players[pid] ? f(w, pid, a, b) : null; }

  Object.assign(S, { ALT, density, inSpace, packUnit, unpackUnit, packWorld, unpackWorld, verb, dirOf, angDiff, turnTo, isGroundKind, centerOf, eyeOf, enemyOf, nameOf, spawnUnit, ring, pickClass, clampArena });
})(window.E = window.E || {});
