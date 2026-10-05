// Procedural models: infantry, vehicles, fighters, turrets and capital ships,
// all built from code with a distinct hull grammar per faction — the Concord is
// angular plate and slab, the Pact is lofted, finned and bioluminescent.
// Models face +z, origin at the feet (ground units) or the centre (aircraft).
// Geometry is cached per (faction, kind, type); units share one hull material.
(function (E) {
  'use strict';
  const cache = new Map();
  const B = () => new E.Geo.Builder();
  const sh = (c, k) => E.Geo.shade(c, k);
  function cached(key, make) { let g = cache.get(key); if (!g) { g = make(); cache.set(key, g); } return g; }
  function mesh(geo, shadow) { const m = new E.THREE.Mesh(geo, E.Geo.material()); m.castShadow = shadow !== false; m.receiveShadow = true; return m; }

  // ── INFANTRY ────────────────────────────────────────────────
  // Three meshes: upper body (pitches with aim), and two legs (walk cycle).
  function infantryGeo(F, type) {
    const P = F.palette, org = F.hull.style === 'organic';
    const armor = sh(P.hullLight, 1.05), under = P.hullDark, acc = P.accent, glow = P.glow;
    const up = B(), leg = B();
    const bulk = type === 'heavy' ? 1.18 : type === 'sniper' ? 0.92 : 1;
    // pelvis, abdomen, chest
    up.box(0.36 * bulk, 0.2, 0.24, 0, 0.04, 0, under, { mode: 0 });
    up.box(0.3 * bulk, 0.24, 0.2, 0, 0.22, 0, under, { mode: 0 });
    up.box(0.4 * bulk, 0.36, 0.27, 0, 0.5, 0.01, armor, { taper: [1.18, 1.05] });
    up.box(0.22 * bulk, 0.16, 0.04, 0, 0.52, 0.15, acc, { mode: 0 });
    // shoulders + arms reaching forward to the weapon
    for (const s of [-1, 1]) {
      if (org) up.sphere(0.115 * bulk, s * 0.29 * bulk, 0.64, 0, acc, { sy: 0.8 });
      else up.box(0.17 * bulk, 0.11, 0.22, s * 0.3 * bulk, 0.66, 0, acc, { taper: [0.8, 0.9], mode: 0 });
      up.box(0.1, 0.1, 0.34, s * 0.27 * bulk, 0.5, 0.14, under, { rx: 0.35, ry: s * 0.25, mode: 0 });
      up.box(0.09, 0.09, 0.3, s * 0.17 * bulk, 0.42, 0.36, armor, { ry: s * 0.6, mode: 0 });
    }
    // head
    if (org) {
      up.sphere(0.145, 0, 0.87, 0.01, armor, { sy: 1.1, sz: 1.15 });
      up.box(0.2, 0.05, 0.1, 0, 0.87, 0.11, glow, { emi: 3.5, mode: 0 });
      up.cone(0.03, 0.22, 5, 0.07, 1.04, -0.06, acc, { rx: -0.5, mode: 0 }); up.cone(0.03, 0.22, 5, -0.07, 1.04, -0.06, acc, { rx: -0.5, mode: 0 });
    } else {
      up.box(0.23, 0.24, 0.26, 0, 0.87, 0.01, armor, { taper: [0.85, 0.9] });
      up.box(0.21, 0.05, 0.04, 0, 0.88, 0.135, glow, { emi: 3.5, mode: 0 });
      up.box(0.04, 0.12, 0.26, 0, 1.01, -0.01, acc, { mode: 0 });
    }
    // backpack
    up.box(0.3 * bulk, 0.36, 0.14, 0, 0.5, -0.19, under);
    if (type === 'medic') { up.box(0.16, 0.05, 0.02, 0, 0.52, -0.27, [255, 255, 255], { emi: 3, mode: 0 }); up.box(0.05, 0.16, 0.02, 0, 0.52, -0.27, [255, 255, 255], { emi: 3, mode: 0 }); }
    // weapon (held centre-right; right is -x)
    const gx = -0.1, gy = 0.4, dark = sh(under, 0.7);
    if (type === 'sniper') { up.box(0.06, 0.1, 1.15, gx, gy, 0.6, dark, { mode: 0 }); up.cyl(0.035, 0.035, 0.3, 6, gx, gy + 0.09, 0.45, dark, { rx: Math.PI / 2, mode: 0 }); up.box(0.03, 0.03, 0.05, gx, gy, 1.19, glow, { emi: 4, mode: 0 }); }
    else if (type === 'heavy') {
      up.box(0.13, 0.15, 0.7, gx, gy - 0.03, 0.42, dark, { mode: 0 }); up.cyl(0.05, 0.05, 0.3, 6, gx, gy - 0.03, 0.9, dark, { rx: Math.PI / 2, mode: 0 });
      up.cyl(0.085, 0.085, 0.95, 8, 0.22, 0.76, -0.05, sh(armor, 0.8), { rx: Math.PI / 2, mode: 0 }); up.cyl(0.07, 0.07, 0.02, 8, 0.22, 0.76, 0.43, acc, { rx: Math.PI / 2, emi: 1.5, mode: 0 });
    } else { up.box(0.07, 0.11, type === 'medic' ? 0.5 : 0.66, gx, gy, 0.42, dark, { mode: 0 }); up.box(0.05, 0.14, 0.1, gx, gy - 0.1, 0.3, dark, { mode: 0 }); up.box(0.03, 0.03, 0.05, gx, gy + 0.01, 0.76, glow, { emi: 4, mode: 0 }); }
    // leg (pivot at the hip)
    leg.box(0.15 * bulk, 0.46, 0.17, 0, -0.24, 0, under, { mode: 0 });
    leg.box(0.13, 0.1, 0.13, 0, -0.48, 0.03, acc, { mode: 0 });
    leg.box(0.13 * bulk, 0.44, 0.15, 0, -0.72, 0, armor, { taper: [1.15, 1.1] });
    leg.box(0.14, 0.1, 0.27, 0, -0.95, 0.05, under, { mode: 0 });
    return { up: up.build(), leg: leg.build() };
  }
  function makeInfantry(F, type) {
    const T = E.THREE, g = cached('inf:' + F.id + ':' + type, () => infantryGeo(F, type));
    const root = new T.Group(), s = E.INFANTRY[type].h / 1.85;
    const body = new T.Group(); body.scale.setScalar(s); root.add(body);
    const up = mesh(g.up); up.position.y = 1.0; body.add(up);
    const legL = mesh(g.leg); legL.position.set(0.11, 1.0, 0); body.add(legL);
    const legR = mesh(g.leg); legR.position.set(-0.11, 1.0, 0); body.add(legR);
    return { root, body, up, legL, legR };
  }

  // ── GROUND VEHICLES ─────────────────────────────────────────
  function vehicleGeo(F, type) {
    const P = F.palette, org = F.hull.style === 'organic';
    const hull = B(), tur = B(), gun = B();
    const c1 = P.hull, c2 = P.hullDark, c3 = P.hullLight, acc = P.accent, eng = P.engine, dark = sh(P.hullDark, 0.6);
    if (type === 'skiff') {
      if (org) {
        hull.loft([{ z: -3, w: 0.8, h: 0.5, y: 0.9 }, { z: -2, w: 2.2, h: 1.1, y: 0.9 }, { z: 0.6, w: 2.5, h: 1.25, y: 0.85 }, { z: 2.4, w: 1.5, h: 0.8, y: 0.8 }, { z: 3.3, w: 0.3, h: 0.25, y: 0.75 }], c1, { n: 12, smooth: true });
        for (const s of [-1, 1]) { hull.sphere(0.75, s * 1.75, 0.75, -0.6, c3, { sx: 0.75, sy: 0.6, sz: 2.4 }); hull.box(0.1, 0.9, 1.6, s * 1.75, 1.35, -1.7, acc, { taper: [1, 0.3], shear: -0.6, mode: 0 }); hull.sphere(0.34, s * 1.75, 0.75, -2.35, eng, { emi: 6, mode: 0 }); }
      } else {
        hull.box(2.3, 0.75, 5.0, 0, 0.85, -0.2, c1, { taper: [0.8, 0.92] });
        hull.box(1.9, 0.5, 1.8, 0, 0.82, 2.9, c3, { taper: [0.35, 0.3], shear: 0.5 });
        for (const s of [-1, 1]) { hull.box(0.75, 0.62, 3.7, s * 1.62, 0.72, -0.5, c2, { taper: [0.8, 0.9] }); hull.box(0.5, 0.42, 0.1, s * 1.62, 0.72, -2.38, eng, { emi: 6, mode: 0 }); hull.box(0.1, 0.8, 1.2, s * 1.62, 1.3, -1.8, acc, { taper: [1, 0.4], shear: -0.5, mode: 0 }); }
      }
      hull.sphere(0.62, 0, 1.3, 0.9, P.canopies, { sx: 0.95, sy: 0.6, sz: 1.6, emi: 0.15, mode: 0 });
      for (const s of [-1, 1]) hull.box(0.3, 0.06, 3.2, s * 1.62, 0.36, -0.5, P.glow, { emi: 3, mode: 0 });
      hull.box(1.2, 0.06, 3.4, 0, 0.44, -0.2, P.glow, { emi: 2.2, mode: 0 });
      tur.cyl(0.42, 0.55, 0.35, org ? 12 : 6, 0, 0.1, 0, c3);
      for (const s of [-1, 1]) { gun.cyl(0.07, 0.09, 1.9, 6, s * 0.24, 0.12, 0.95, dark, { rx: Math.PI / 2, mode: 0 }); gun.box(0.05, 0.05, 0.08, s * 0.24, 0.12, 1.92, P.glow, { emi: 4, mode: 0 }); }
      gun.box(0.75, 0.3, 0.6, 0, 0.12, 0.05, c2);
      return { hull: hull.build(), tur: tur.build(), gun: gun.build(), ty: 1.42, tz: -0.9 };
    }
    // tank
    if (org) {
      hull.loft([{ z: -4.2, w: 2.6, h: 1.2, y: 1.15 }, { z: -3, w: 4.4, h: 1.9, y: 1.2 }, { z: 1.5, w: 4.7, h: 2.0, y: 1.15 }, { z: 3.6, w: 3.2, h: 1.3, y: 1.0 }, { z: 4.5, w: 0.8, h: 0.5, y: 0.9 }], c1, { n: 14, smooth: true, p: 2.6 });
      for (const s of [-1, 1]) { hull.sphere(1, s * 2.5, 0.85, 0, c2, { sx: 0.8, sy: 0.7, sz: 4.2 }); hull.box(0.12, 1.2, 2.4, s * 2.3, 2.2, -2.6, acc, { taper: [1, 0.25], shear: -1, mode: 0 }); }
      hull.sphere(0.6, 0, 1.3, -4.1, eng, { emi: 6, sx: 2.2, mode: 0 });
    } else {
      hull.box(4.5, 1.15, 8.0, 0, 1.15, 0, c1, { taper: [0.82, 0.9] });
      hull.box(4.2, 0.7, 2.2, 0, 1.0, 4.3, c3, { taper: [0.7, 0.2], shear: 0.6 });
      hull.box(3.4, 0.5, 3.2, 0, 1.95, -1.9, c2, { taper: [0.85, 0.85] });
      for (const s of [-1, 1]) { hull.box(1.0, 0.95, 7.4, s * 2.55, 0.85, -0.1, c2, { taper: [0.75, 0.94] }); hull.box(0.5, 0.2, 0.9, s * 1.2, 2.25, -2.9, dark, { mode: 0 }); hull.box(0.7, 0.5, 0.1, s * 1.3, 1.25, -4.02, eng, { emi: 6, mode: 0 }); }
      hull.box(1.0, 0.1, 5, 0, 1.75, 0.6, acc, { mode: 0 });
    }
    for (const s of [-1, 1]) hull.box(0.5, 0.07, 6.6, s * 2.5, 0.34, -0.1, P.glow, { emi: 3, mode: 0 });
    hull.box(2.6, 0.07, 6.2, 0, 0.52, 0, P.glow, { emi: 1.6, mode: 0 });
    if (org) tur.sphere(1.45, 0, 0.3, 0, c3, { sy: 0.55, sz: 1.2 }); else { tur.box(2.7, 0.95, 3.3, 0, 0.42, -0.1, c3, { taper: [0.72, 0.75] }); tur.box(0.8, 0.3, 0.9, 0.7, 1.0, -0.6, c2); }
    tur.cyl(0.03, 0.03, 1.6, 4, -0.9, 1.5, -1.2, dark, { mode: 0 });
    gun.cyl(0.2, 0.26, 4.8, 8, 0, 0, 2.9, dark, { rx: Math.PI / 2, mode: 0 });
    gun.cyl(0.33, 0.33, 0.7, 8, 0, 0, 5.0, c2, { rx: Math.PI / 2 });
    gun.box(0.9, 0.7, 1.0, 0, 0, 0.6, c1);
    gun.cyl(0.07, 0.07, 1.6, 5, 0.55, 0.05, 1.5, dark, { rx: Math.PI / 2, mode: 0 });
    return { hull: hull.build(), tur: tur.build(), gun: gun.build(), ty: 2.25, tz: -0.4 };
  }
  function makeVehicle(F, type) {
    const T = E.THREE, g = cached('veh:' + F.id + ':' + type, () => vehicleGeo(F, type));
    const root = new T.Group(), body = new T.Group(); root.add(body);
    body.add(mesh(g.hull));
    const turret = new T.Group(); turret.position.set(0, g.ty, g.tz); body.add(turret);
    turret.add(mesh(g.tur));
    const gun = mesh(g.gun); gun.position.set(0, 0.42, 0.5); turret.add(gun);
    return { root, body, turret, gun };
  }

  // ── TURRET EMPLACEMENT ──────────────────────────────────────
  function makeTurret(F) {
    const T = E.THREE, P = F.palette;
    const g = cached('tur:' + F.id, () => {
      const base = B(), head = B(), gun = B(), dark = sh(P.hullDark, 0.6);
      base.cyl(2.3, 2.9, 1.2, 6, 0, 0.6, 0, P.hullDark); base.cyl(1.2, 1.6, 1.3, 8, 0, 1.8, 0, P.hull);
      head.box(2.2, 1.1, 2.4, 0, 0.3, 0, P.hullLight, { taper: [0.75, 0.8] }); head.box(0.5, 0.25, 0.1, 0, 0.5, 1.2, P.glow, { emi: 3, mode: 0 });
      for (const s of [-1, 1]) { gun.cyl(0.13, 0.16, 3.2, 6, s * 0.62, 0, 1.6, dark, { rx: Math.PI / 2, mode: 0 }); gun.box(0.5, 0.5, 1.2, s * 0.62, 0, 0.2, P.hull); }
      return { base: base.build(), head: head.build(), gun: gun.build() };
    });
    const root = new T.Group(); root.add(mesh(g.base));
    const turret = new T.Group(); turret.position.y = 2.6; root.add(turret);
    turret.add(mesh(g.head));
    const gun = mesh(g.gun); gun.position.set(0, 0.35, 0.3); turret.add(gun);
    return { root, body: root, turret, gun, fixedBase: true };
  }

  // ── FIGHTERS ────────────────────────────────────────────────
  function fighterGeo(F, type) {
    const P = F.palette, org = F.hull.style === 'organic', b = B(), bomber = type === 'bomber';
    const c1 = P.hull, c2 = P.hullDark, c3 = P.hullLight, acc = P.accent, eng = P.engine, dark = sh(P.hullDark, 0.6);
    const k = bomber ? 1.25 : 1;
    if (org) {
      b.loft([{ z: -3.6 * k, w: 0.5, h: 0.5 }, { z: -2.6 * k, w: 1.5 * k, h: 1.2 * k }, { z: 0, w: 1.7 * k, h: 1.3 * k }, { z: 2.6 * k, w: 0.9, h: 0.7, y: -0.05 }, { z: 4.4 * k, w: 0.08, h: 0.08, y: -0.1 }], c1, { n: 12, smooth: true });
      // crescent wings: three swept segments each side
      for (const s of [-1, 1]) {
        b.box(2.3 * k, 0.14, 1.9, s * 1.7 * k, 0, -0.6, c3, { ry: -s * 0.35, taper: [1, 0.8] });
        b.box(2.0 * k, 0.11, 1.3, s * 3.3 * k, 0.12, 0.3, c1, { ry: -s * 0.9, rz: s * 0.12 });
        b.box(1.5, 0.08, 0.7, s * 4.1 * k, 0.22, 1.5, acc, { ry: -s * 1.3, rz: s * 0.2, mode: 0 });
        b.box(0.05, 0.05, 0.1, s * 4.25 * k, 0.24, 2.25, P.glow, { emi: 5, mode: 0 });
        if (bomber) b.sphere(0.5, s * 1.9, -0.45, -0.5, c2, { sz: 2.2 });
      }
      b.box(0.08, 1.1, 1.8, 0, 0.8, -2.2, acc, { taper: [1, 0.25], shear: -0.9, mode: 0 });
      b.sphere(0.62 * k, 0, 0, -3.3 * k, eng, { emi: 7, sz: 0.6, mode: 0 });
      b.box(0.06, 0.03, 4.6, 0.5, 0.52, 0, P.glow, { emi: 2.5, mode: 0 }); b.box(0.06, 0.03, 4.6, -0.5, 0.52, 0, P.glow, { emi: 2.5, mode: 0 });
    } else {
      b.loft([{ z: -3.8 * k, w: 1.3 * k, h: 0.9 * k }, { z: -2.4 * k, w: 1.7 * k, h: 1.25 * k }, { z: 0.4, w: 1.5 * k, h: 1.1 * k }, { z: 2.8 * k, w: 0.75, h: 0.6, y: -0.1 }, { z: 4.6 * k, w: 0.06, h: 0.06, y: -0.15 }], c1, { n: 6, p: 3.4, rot: Math.PI / 6 });
      for (const s of [-1, 1]) {
        b.box(3.6 * k, 0.14, 2.3, s * 2.3 * k, -0.08, -1.3, c3, { ry: s * 0.32, taper: [0.9, 0.55] });
        b.box(1.0, 0.1, 2.9, s * 4.1 * k, -0.08, -0.7, acc, { taper: [0.5, 0.85], mode: 0 });
        b.cyl(0.07, 0.09, 2.6, 6, s * 4.15 * k, -0.08, 0.9, dark, { rx: Math.PI / 2, mode: 0 });
        b.box(0.06, 0.06, 0.1, s * 4.15 * k, -0.08, 2.22, P.glow, { emi: 5, mode: 0 });
        b.box(0.1, 1.3, 1.5, s * 0.75 * k, 0.85, -2.9 * k, c2, { rz: -s * 0.35, taper: [1, 0.4], shear: -0.7 });
        b.cyl(0.42 * k, 0.5 * k, 1.5, 8, s * 0.62 * k, 0, -3.9 * k, c2, { rx: Math.PI / 2 });
        b.cyl(0.36 * k, 0.36 * k, 0.08, 10, s * 0.62 * k, 0, -4.68 * k, eng, { rx: Math.PI / 2, emi: 8, mode: 0 });
        if (bomber) b.box(0.7, 0.6, 3.2, s * 1.9, -0.45, -0.6, c2, { taper: [0.8, 0.8] });
      }
      b.box(0.5, 0.06, 2.4, 0, 0.62 * k, -1.2, acc, { mode: 0 });
    }
    b.sphere(0.5 * k, 0, 0.42 * k, 1.1 * k, P.canopies, { sx: 0.85, sy: 0.7, sz: 2.0, emi: 0.2, mode: 0 });
    if (bomber) b.box(1.1, 0.5, 3.4, 0, -0.75, -0.3, c2, { taper: [0.8, 0.8] });
    return b.build();
  }
  function makeFighter(F, type) {
    const T = E.THREE, root = new T.Group(), body = new T.Group(); root.add(body);
    body.add(mesh(cached('fig:' + F.id + ':' + type, () => fighterGeo(F, type))));
    return { root, body };
  }

  // ── CAPITAL SHIPS ───────────────────────────────────────────
  function capitalGeo(F, type) {
    const P = F.palette, org = F.hull.style === 'organic', d = E.CAPITALS[type], b = B();
    const L = d.len, H = d.h * 1.25, W = d.h * 2.5, rng = E.RNG(E.hashStr(F.id + type));
    const c1 = P.hull, c2 = P.hullDark, c3 = P.hullLight, acc = P.accent, eng = P.engine, glow = P.glow, dark = sh(P.hullDark, 0.55);
    const big = type === 'dreadnought', carrier = type === 'carrier';
    if (org) {
      // teardrop body + keel
      b.loft([{ z: -0.5 * L, w: W * 0.2, h: H * 0.25 }, { z: -0.38 * L, w: W * 0.62, h: H * 0.7 }, { z: -0.1 * L, w: W * 0.9, h: H * 0.95 }, { z: 0.18 * L, w: W, h: H * 1.05 },
        { z: 0.36 * L, w: W * 0.7, h: H * 0.8, y: -H * 0.04 }, { z: 0.47 * L, w: W * 0.3, h: H * 0.36, y: -H * 0.1 }, { z: 0.52 * L, w: W * 0.04, h: H * 0.05, y: -H * 0.14 }], c1, { n: 18, smooth: true, mode: 3 });
      b.loft([{ z: -0.34 * L, w: W * 0.2, h: H * 0.3, y: -H * 0.5 }, { z: -0.05 * L, w: W * 0.45, h: H * 0.6, y: -H * 0.52 }, { z: 0.26 * L, w: W * 0.2, h: H * 0.3, y: -H * 0.45 }], c2, { n: 12, smooth: true, mode: 2 });
      // dorsal spine ribs
      for (let i = 0; i < 9; i++) { const z = E.lerp(-0.36, 0.3, i / 8) * L, k = 1 - Math.abs(i - 4.5) / 7; b.box(W * 0.07, H * 0.34 * k + 3, L * 0.035, 0, H * 0.5 * (0.6 + k * 0.4) + 2, z, c3, { taper: [0.3, 0.5], shear: -L * 0.015, mode: 2 }); }
      // swept petals
      const petals = big ? 4 : 3;
      for (let i = 0; i < petals; i++) for (const s of [-1, 1]) {
        const z0 = E.lerp(-0.05, -0.34, i / Math.max(1, petals - 1)) * L, rz = s * (0.25 + i * 0.22), len = W * (1.25 - i * 0.14);
        b.box(len, H * 0.08, L * 0.13, s * (W * 0.42 + len * 0.42), Math.sin(rz * s) * len * 0.42, z0 - len * 0.2, c3, { ry: s * 0.5, rz, taper: [0.9, 0.5], mode: 2 });
        b.box(len * 0.8, H * 0.05, L * 0.05, s * (W * 0.5 + len * 0.95), Math.sin(rz * s) * len * 1.0, z0 - len * 0.72, acc, { ry: s * 1.0, rz: rz * 1.1, mode: 0 });
        b.box(len * 1.1, H * 0.022, L * 0.012, s * (W * 0.42 + len * 0.45), Math.sin(rz * s) * len * 0.44 + H * 0.05, z0 - len * 0.2, glow, { ry: s * 0.5, rz, emi: 2.6, mode: 0 });
      }
      // bioluminescent veins along the flanks
      for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 2.2; for (const s of [-1, 1]) b.box(1.3, 1.3, L * 0.5, s * Math.cos(a) * W * 0.47, Math.sin(a) * H * 0.5, 0.02 * L, glow, { emi: 2.2, mode: 0 }); }
      b.sphere(H * 0.26, 0, H * 0.5, 0.2 * L, P.canopies, { sz: 1.8, sy: 0.6, emi: 0.9, mode: 0 });
      for (let i = 0; i < 3; i++) { const x = (i - 1) * W * 0.26, y = i === 1 ? H * 0.12 : -H * 0.1; b.sphere(H * 0.3, x, y, -0.46 * L, c2, { sz: 1.5 }); b.sphere(H * 0.24, x, y, -0.5 * L - H * 0.12, eng, { emi: 9, sz: 0.5, mode: 0 }); }
      b.box(W * 0.3, 2, L * 0.16, 0, -H * 0.82, -0.02 * L, P.canopies, { emi: 2.2, mode: 0 });
    } else {
      // slab hull tapering to a blade prow
      b.loft([{ z: -0.5 * L, w: W * 0.82, h: H * 0.8 }, { z: -0.36 * L, w: W, h: H }, { z: 0.02 * L, w: W * 0.94, h: H * 0.86 }, { z: 0.3 * L, w: W * 0.52, h: H * 0.56, y: -H * 0.04 },
        { z: 0.47 * L, w: W * 0.16, h: H * 0.32, y: -H * 0.08 }, { z: 0.52 * L, w: W * 0.02, h: H * 0.14, y: -H * 0.1 }], c1, { n: 8, p: 5, rot: Math.PI / 8, mode: 3 });
      b.box(W * 0.05, H * 0.5, L * 0.2, 0, -H * 0.06, 0.43 * L, acc, { taper: [1, 0.3], shear: L * 0.04, mode: 0 });
      // flank sponsons with gun decks
      for (const s of [-1, 1]) {
        b.box(W * 0.22, H * 0.42, L * 0.56, s * W * 0.52, -H * 0.05, -0.08 * L, c2, { taper: [0.7, 0.96], mode: 3 });
        b.box(W * 0.08, H * 0.12, L * 0.5, s * W * 0.63, -H * 0.05, -0.08 * L, dark, { mode: 3 });
        for (let i = 0; i < d.side; i++) { const z = E.lerp(-0.3, 0.3, d.side > 1 ? i / (d.side - 1) : 0.5) * L; b.box(W * 0.07, H * 0.1, L * 0.035, s * W * 0.66, -H * 0.05, z, c3, { mode: 0 }); b.cyl(1.1, 1.4, W * 0.14, 6, s * W * 0.72, -H * 0.05, z, dark, { rz: Math.PI / 2, mode: 0 }); }
        b.box(W * 0.012, H * 0.02, L * 0.52, s * W * 0.645, H * 0.09, -0.08 * L, acc, { emi: 1.6, mode: 0 });
        if (carrier) { b.box(W * 0.5, H * 0.08, L * 0.5, s * W * 0.85, -H * 0.3, -0.05 * L, c3, { mode: 2 }); b.box(W * 0.4, 1.2, L * 0.44, s * W * 0.85, -H * 0.255, -0.05 * L, P.canopies, { emi: 1.2, mode: 0 }); }
      }
      // stepped citadel + bridge tower
      const tiers = big ? 4 : 3;
      for (let i = 0; i < tiers; i++) { const k = 1 - i * 0.22; b.box(W * 0.5 * k, H * 0.24, L * 0.3 * k, 0, H * (0.5 + i * 0.22), (-0.2 + i * 0.02) * L, i % 2 ? c2 : c3, { taper: [0.8, 0.85], mode: 3 }); }
      const ty = H * (0.5 + tiers * 0.22);
      b.box(W * 0.2, H * 0.3, L * 0.07, 0, ty + H * 0.08, -0.16 * L, c1, { taper: [1.35, 1.2], mode: 3 });
      b.box(W * 0.26, H * 0.05, L * 0.012, 0, ty + H * 0.17, -0.16 * L + L * 0.037, P.canopies, { emi: 2.5, mode: 0 });
      b.cyl(0.6, 0.9, H * 0.7, 5, W * 0.06, ty + H * 0.55, -0.18 * L, dark, { mode: 0 }); b.cyl(0.5, 0.7, H * 0.45, 5, -W * 0.07, ty + H * 0.42, -0.2 * L, dark, { mode: 0 });
      // greebles
      for (let i = 0; i < 130; i++) {
        const z = rng.f(-0.44, 0.24) * L, hw = W * 0.45 * E.clamp01(1.1 - Math.max(0, z / L) * 2.2), x = rng.f(-hw, hw);
        if (Math.abs(x) < W * 0.27 && z < 0.02 * L && z > -0.38 * L) continue;
        const w = rng.f(2, 9), h = rng.f(1.2, 5), dd = rng.f(3, 16);
        b.box(w, h, dd, x, H * 0.43 * (z > 0.02 * L ? 1 - (z / L) * 0.9 : 1) + h * 0.3, z, rng.chance(0.2) ? c3 : c2, { mode: 1 });
      }
      // ventral hangar glow + engines
      b.box(W * 0.34, 2, L * 0.18, 0, -H * 0.44, -0.1 * L, P.canopies, { emi: 2.4, mode: 0 });
      b.box(W * 0.42, H * 0.16, L * 0.24, 0, -H * 0.44, -0.1 * L, c2, { mode: 2 });
      const ne = big ? 4 : 3;
      for (let i = 0; i < ne; i++) { const x = (i - (ne - 1) / 2) * W * 0.24; b.cyl(H * 0.22, H * 0.27, L * 0.07, 10, x, -H * 0.02, -0.52 * L, c2, { rx: Math.PI / 2 }); b.cyl(H * 0.19, H * 0.19, 1, 12, x, -H * 0.02, -0.557 * L, eng, { rx: Math.PI / 2, emi: 9, mode: 0 }); }
    }
    // main battery turrets on the dorsal line (match the sim's hardpoints)
    for (let i = 0; i < d.main; i++) {
      const z = E.lerp(-0.12, 0.34, d.main > 1 ? i / (d.main - 1) : 0.5) * L, y = d.h * 0.55;
      if (z < -0.02 * L && !org) continue; // hidden under the citadel; the muzzle still fires from there
      b.cyl(W * 0.06, W * 0.075, H * 0.14, org ? 12 : 6, 0, y, z, c3);
      for (const s of [-1, 1]) b.cyl(0.9, 1.2, W * 0.26, 6, s * W * 0.022, y + H * 0.04, z + W * 0.13, dark, { rx: Math.PI / 2, mode: 0 });
    }
    return b.build();
  }
  function makeCapital(F, type) {
    const T = E.THREE, root = new T.Group(), body = new T.Group(); root.add(body);
    const m = mesh(cached('cap:' + F.id + ':' + type, () => capitalGeo(F, type)));
    body.add(m);
    return { root, body, hull: m };
  }

  function makeUnit(u) {
    const F = E.faction(u.team);
    if (u.kind === 'infantry') { const rig = E.ArtInfantry.make(F, E.INFANTRY[u.type] ? u.type : 'trooper'); rig.rig = rig; return rig; }
    if (u.kind === 'vehicle') return makeVehicle(F, u.type);
    if (u.kind === 'fighter') return makeFighter(F, u.type);
    if (u.kind === 'capital') return makeCapital(F, u.type);
    if (E.ArtStruct && E.TURRETS[u.type]) { const m = E.ArtStruct.makeStructure(F, u.type); return m; }
    return makeTurret(F);
  }

  E.Models = { makeUnit, makeInfantry, makeVehicle, makeFighter, makeCapital, makeTurret, cache };
})(window.E = window.E || {});
