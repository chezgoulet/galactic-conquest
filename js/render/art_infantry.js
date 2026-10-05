// Infantry: articulated procedural soldiers with five class silhouettes (trooper, heavy, marksman, medic, engineer)
// in each faction's armour. One rig per unit, three LODs:
//   lod 0 (< 38 m)   torso + weapon + tool meshes, thigh/shin meshes with a knee joint  -> full animation
//   lod 1 (< 170 m)  torso+weapon merged, straight legs                                  -> walk cycle, stance, recoil
//   lod 2 (beyond)   one merged mesh in a neutral pose                                    -> one draw call
// Animation is procedural from sim state: walk/run/sprint cycle, crouch, slide, vault/mantle, aim pitch, firing
// recoil, suppression flinch, engineer tools, plus a death collapse (see E.ArtInfantry.deathPose).
// Units face +z, origin at the feet, the hip pivot is 1.0 m up in model units. The model stands 1.85 units tall and
// the group is scaled to the class height (E.INFANTRY[type].h).
(function (E) {
  'use strict';
  const cache = new Map();
  const sh = (c, k) => E.Geo.shade(c, k);
  const B = () => new E.Geo.Builder();
  const HIP = 1.0;

  // oriented tapered limb between two points (cylinder axis along the segment)
  function limb(b, a, c, r0, r1, col, o) {
    const T = E.THREE, dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2], len = Math.hypot(dx, dy, dz) || 1e-3;
    const g = new T.CylinderGeometry(r1, r0, len, 7, 1).rotateX(Math.PI / 2);
    b.add(g, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, col, Object.assign({ ry: Math.atan2(dx, dz), rx: -Math.asin(dy / len), smooth: true, mode: 0 }, o));
  }

  const CLASS_ARMOR = { medic: [226, 229, 232], engineer: [186, 178, 160] };

  function build(F, type) {
    const P = F.palette, org = F.hull.style === 'organic';
    const bulk = { heavy: 1.24, sniper: 0.9, medic: 0.98, engineer: 1.06, trooper: 1 }[type] || 1;
    const base = CLASS_ARMOR[type] ? CLASS_ARMOR[type] : sh(P.hullLight, 0.95);
    const armor = type === 'heavy' ? sh(P.hull, 1.25) : base, under = sh(P.hullDark, type === 'sniper' ? 0.8 : 1.1), cloth = sh(P.hullDark, 1.4), acc = P.accent, glow = P.glow;
    const yellow = [222, 168, 40], dark = sh(P.hullDark, 0.55), white = [240, 244, 246];
    const T = E.THREE;
    const torso = B(), gun = B(), thigh = B(), shin = B(), torch = B(), charge = B();

    // ── torso ──
    torso.box(0.30 * bulk, 0.14, 0.20, 0, 0.05, 0, under, { mode: 0 });
    torso.box(0.33 * bulk, 0.05, 0.22, 0, 0.13, 0, acc, { mode: 0 });
    torso.cyl(0.13 * bulk, 0.145 * bulk, 0.2, 8, 0, 0.24, 0, cloth, { mode: 0, smooth: true, sz: 0.8 });
    torso.box(0.38 * bulk, 0.30, 0.24, 0, 0.46, 0.005, armor, { taper: [1.12, 1.02] });
    torso.box(0.25 * bulk, 0.2, 0.05, 0, 0.47, 0.135, sh(armor, 1.12), { taper: [0.92, 1] });
    torso.box(0.27 * bulk, 0.04, 0.05, 0, 0.36, 0.14, acc, { mode: 0 });
    torso.cyl(0.075, 0.1, 0.09, 8, 0, 0.64, 0, cloth, { mode: 0, smooth: true });
    for (const s of [-1, 1]) {
      const sx = s * 0.25 * bulk;
      const pr = (type === 'heavy' ? 0.15 : type === 'sniper' ? 0.095 : 0.115);
      if (org) torso.sphere(pr, sx, 0.56, 0, s > 0 ? acc : armor, { sy: 0.8, seg: 8, seg2: 6, mode: 1 });
      else torso.box(pr * 1.5, pr * 1.1, pr * 1.9, sx, 0.57, 0, s > 0 ? acc : armor, { taper: [0.8, 0.9], rz: -s * 0.35, mode: 1 });
      // arms: upper arm + forearm toward the weapon grips (right hand on the grip at -x, left on the fore-grip)
      const elbow = s < 0 ? [-0.2, 0.36, 0.1] : [0.22 * bulk, 0.36, 0.18], hand = s < 0 ? [-0.1, 0.37, 0.22] : [0.05, 0.4, type === 'sniper' ? 0.6 : type === 'heavy' ? 0.5 : 0.5];
      limb(torso, [sx, 0.55, 0], elbow, 0.05 * bulk, 0.045, cloth);
      limb(torso, elbow, hand, 0.045, 0.04, armor, { mode: 1 });
      torso.box(0.075, 0.075, 0.09, hand[0], hand[1], hand[2], dark, { mode: 0 });
    }
    // helmet + face
    const hy = 0.73;
    if (org) {
      torso.sphere(0.125, 0, hy, 0.01, armor, { sy: 1.12, sz: 1.2, seg: 10, seg2: 8, mode: 1 });
      torso.box(0.16, 0.04, 0.05, 0, hy + 0.01, 0.12, glow, { emi: 3.5, mode: 0 });
      for (const s of [-1, 1]) torso.cone(0.022, 0.2, 5, s * 0.06, hy + 0.15, -0.07, acc, { rx: -0.55, rz: -s * 0.1, mode: 0 });
    } else {
      torso.sphere(type === 'heavy' ? 0.15 : 0.125, 0, hy, 0.005, armor, { sy: 1.08, sz: 1.15, seg: 10, seg2: 8, mode: 1 });
      torso.box(0.15, 0.045, 0.05, 0, hy + 0.005, type === 'heavy' ? 0.13 : 0.115, type === 'engineer' ? [120, 220, 255] : glow, { emi: 3.2, mode: 0 });
      torso.box(0.03, 0.1, 0.22, 0, hy + 0.12, -0.02, acc, { mode: 0, taper: [1, 0.8] });                 // crest stripe (team)
    }
    // ── backpack / class kit ──
    torso.box(0.26 * bulk, 0.3, 0.12, 0, 0.46, -0.18, sh(under, 1.2), { mode: 0 });
    if (type === 'trooper') {
      torso.cyl(0.015, 0.015, 0.4, 5, 0.1, 0.78, -0.2, dark, { mode: 0 });                              // antenna
      torso.box(0.1, 0.07, 0.06, -0.08, 0.3, -0.3, acc, { mode: 0 });
    } else if (type === 'heavy') {
      torso.box(0.34, 0.26, 0.2, 0, 0.5, -0.26, sh(armor, 0.8), { taper: [0.9, 0.9] });                  // ammo hopper
      torso.cyl(0.07, 0.07, 0.34, 8, 0.2, 0.7, 0.0, sh(armor, 0.7), { rx: Math.PI / 2, mode: 1, smooth: true });  // launcher tube on the shoulder
      torso.cyl(0.075, 0.075, 0.03, 8, 0.2, 0.7, 0.18, acc, { rx: Math.PI / 2, emi: 1.6, mode: 0 });
      torso.box(0.5, 0.06, 0.26, 0, 0.62, 0, acc, { mode: 0, taper: [0.85, 0.8] });                       // wide gorget plate
    } else if (type === 'sniper') {
      torso.box(0.34, 0.62, 0.05, 0, 0.2, -0.27, sh(cloth, 0.9), { taper: [0.8, 1], mode: 0 });         // cape
      torso.cone(0.12, 0.2, 7, 0, hy + 0.1, -0.06, sh(cloth, 0.9), { rx: -0.35, mode: 0 });              // hood
      torso.cyl(0.02, 0.02, 0.5, 5, -0.16, 0.5, -0.24, dark, { rx: 0.1, mode: 0 });                      // spotter mast
    } else if (type === 'medic') {
      torso.box(0.3, 0.34, 0.14, 0, 0.47, -0.22, white, { mode: 1 });
      torso.box(0.18, 0.05, 0.02, 0, 0.5, -0.3, glow, { emi: 3, mode: 0 }); torso.box(0.05, 0.18, 0.02, 0, 0.5, -0.3, glow, { emi: 3, mode: 0 });
      torso.box(0.16, 0.05, 0.02, 0, 0.47, 0.162, acc, { emi: 2.2, mode: 0 }); torso.box(0.05, 0.16, 0.02, 0, 0.47, 0.162, acc, { emi: 2.2, mode: 0 });
      torso.cyl(0.05, 0.05, 0.1, 8, 0.2, 0.7, 0.04, white, { mode: 1 }); torso.sphere(0.05, 0.2, 0.77, 0.04, glow, { emi: 3, mode: 0 });   // shoulder lamp
      torso.torus(0.2, 0.012, 0, 0.55, -0.22, glow, { rx: Math.PI / 2, emi: 2.4, mode: 0 });
    } else if (type === 'engineer') {
      torso.box(0.34, 0.38, 0.2, 0, 0.48, -0.27, sh(yellow, 0.9), { mode: 1, taper: [0.92, 0.9] });       // fabricator pack
      torso.cyl(0.06, 0.06, 0.4, 8, 0.13, 0.55, -0.4, sh(under, 1.6), { mode: 1, smooth: true });         // gas bottle
      torso.cyl(0.06, 0.06, 0.4, 8, -0.13, 0.55, -0.4, sh(under, 1.6), { mode: 1, smooth: true });
      torso.cyl(0.14, 0.14, 0.04, 10, 0, hy + 0.1, 0.01, yellow, { mode: 1 });                              // hard hat brim
      torso.sphere(0.12, 0, hy + 0.1, -0.005, yellow, { sy: 0.7, seg: 8, seg2: 5, mode: 1 });
      limb(torso, [0.22, 0.36, 0.18], [0.05, 0.4, 0.5], 0.062, 0.058, yellow, { mode: 1 });               // gauntlet tool
      torso.sphere(0.04, 0.2, 0.7, 0.05, [255, 220, 120], { emi: 3, mode: 0 });
    }

    // ── weapons (separate mesh so engineer tools can replace it) ──
    const gx = -0.1, gy = 0.38, gd = sh(under, 0.7), gl = sh(under, 1.2);
    if (type === 'sniper') {
      gun.box(0.05, 0.1, 0.5, gx, gy, 0.32, gd, { mode: 0 }); gun.cyl(0.018, 0.018, 0.8, 6, gx, gy + 0.02, 0.9, gl, { rx: Math.PI / 2, mode: 0, smooth: true });
      gun.cyl(0.032, 0.032, 0.3, 8, gx, gy + 0.09, 0.4, gd, { rx: Math.PI / 2, mode: 0, smooth: true }); gun.sphere(0.034, gx, gy + 0.09, 0.56, glow, { emi: 2.4, mode: 0 });
      gun.box(0.03, 0.03, 0.05, gx, gy + 0.02, 1.33, glow, { emi: 4, mode: 0 }); gun.box(0.05, 0.06, 0.22, gx, gy - 0.02, 0.06, gd, { mode: 0 });
    } else if (type === 'heavy') {
      gun.box(0.14, 0.17, 0.52, gx + 0.03, gy - 0.01, 0.38, gd, { mode: 0 });
      for (let i = 0; i < 3; i++) { const a = i / 3 * E.TAU; gun.cyl(0.018, 0.018, 0.55, 5, gx + 0.03 + Math.cos(a) * 0.04, gy - 0.01 + Math.sin(a) * 0.04, 0.86, gl, { rx: Math.PI / 2, mode: 0, smooth: true }); }
      gun.cyl(0.07, 0.07, 0.06, 8, gx + 0.03, gy - 0.01, 1.14, gd, { rx: Math.PI / 2, mode: 0 }); gun.box(0.12, 0.12, 0.14, gx + 0.03, gy - 0.16, 0.34, sh(acc, 0.8), { mode: 0 });
      gun.box(0.04, 0.04, 0.04, gx + 0.03, gy - 0.01, 1.18, glow, { emi: 4, mode: 0 });
    } else {
      const long = type === 'medic' ? 0.5 : type === 'engineer' ? 0.5 : 0.7;
      gun.box(0.065, 0.11, long, gx, gy, 0.2 + long / 2, gd, { mode: 0 });
      gun.box(0.05, 0.14, 0.1, gx, gy - 0.11, 0.26, gd, { mode: 0 });
      gun.cyl(0.016, 0.016, 0.22, 5, gx, gy + 0.01, 0.2 + long + 0.1, gl, { rx: Math.PI / 2, mode: 0, smooth: true });
      gun.box(0.04, 0.04, 0.08, gx, gy + 0.075, 0.46, dark, { mode: 0 });
      gun.box(0.035, 0.035, 0.04, gx, gy + 0.01, 0.2 + long + 0.22, glow, { emi: 4, mode: 0 });
      if (type === 'trooper') gun.box(0.045, 0.045, 0.2, gx, gy + 0.075, 0.38, sh(acc, 0.7), { mode: 0 });
    }
    // engineer tools: repair torch + demolition charge
    torch.cyl(0.03, 0.04, 0.34, 7, gx, gy, 0.42, [90, 94, 100], { rx: Math.PI / 2, mode: 1, smooth: true });
    torch.box(0.06, 0.1, 0.14, gx, gy - 0.07, 0.28, yellow, { mode: 1 });
    torch.sphere(0.03, gx, gy, 0.62, [190, 245, 255], { emi: 6, mode: 0 });
    charge.box(0.2, 0.14, 0.2, 0.0, gy - 0.02, 0.4, [92, 98, 92], { mode: 1 });
    charge.box(0.16, 0.03, 0.16, 0, gy + 0.06, 0.4, acc, { mode: 0 });
    charge.sphere(0.022, 0.06, gy + 0.09, 0.4, [255, 40, 20], { emi: 6, mode: 0 });

    // ── legs (hip-pivot thigh, knee-pivot shin) ──
    const lw = 0.075 * bulk;
    limb(thigh, [0, 0, 0], [0, -0.5, 0.02], lw * 1.2, lw * 0.95, cloth);
    thigh.box(0.17 * bulk, 0.22, 0.18, 0, -0.17, 0.01, armor, { taper: [0.9, 0.9], mode: 1 });          // thigh plate
    thigh.box(0.17 * bulk, 0.1, 0.17, 0, -0.04, 0, under, { mode: 0 });
    limb(shin, [0, 0, 0], [0, -0.44, -0.02], lw * 0.95, lw * 0.7, cloth);
    shin.sphere(lw * 1.25, 0, 0.005, 0.045, armor, { sy: 0.8, seg: 7, seg2: 5, mode: 1 });               // knee guard
    shin.box(0.14 * bulk, 0.3, 0.14, 0, -0.22, 0.04, armor, { taper: [0.95, 0.8], mode: 1 });          // greave
    shin.box(0.15, 0.09, 0.28, 0, -0.485, 0.06, dark, { taper: [0.9, 0.7], mode: 0 });                  // boot
    shin.box(0.16, 0.025, 0.1, 0, -0.52, 0.17, acc, { mode: 0 });
    const R = (b) => b.build();
    const g = { torso: R(torso), gun: R(gun), thigh: R(thigh), shin: R(shin), torch: R(torch), charge: R(charge) };
    // merged variants
    const merged = (list) => {
      const b = B();
      for (const [geo, x, y, z] of list) { const c = geo.clone(); c.translate(x, y, z); b.pos.push(...c.attributes.position.array); b.nor.push(...c.attributes.normal.array); b.col.push(...c.attributes.color.array); b.fx.push(...c.attributes.aFx.array); }
      return b.build();
    };
    g.mid = merged([[g.torso, 0, 0, 0], [g.gun, 0, 0, 0]]);
    const leg = (x) => [[g.thigh, x, 0, 0], [g.shin, x, -0.5, 0]];
    g.midLegL = merged(leg(0)); g.midLegR = g.midLegL;   // legs are mirrored by the pivot offset, not geometry
    g.far = merged([[g.torso, 0, HIP, 0], [g.gun, 0, HIP, 0], ...leg(0.1).map(a => [a[0], a[1], a[2] + HIP, a[3]]), ...leg(-0.1).map(a => [a[0], a[1], a[2] + HIP, a[3]])]);
    return g;
  }

  function make(F, type) {
    const T = E.THREE, key = F.id + ':' + type;
    let g = cache.get(key); if (!g) { g = build(F, type); cache.set(key, g); }
    const def = E.INFANTRY[type] || E.INFANTRY.trooper, mat = E.Mat.suit();
    const mk = (geo, shadow) => { const m = new T.Mesh(geo, mat); m.castShadow = shadow !== false; m.receiveShadow = true; return m; };
    const root = new T.Group(), body = new T.Group(); root.add(body);
    const s = def.h / 1.9; body.scale.setScalar(s);
    const hip = new T.Group(); hip.position.y = HIP; body.add(hip);
    const spine = new T.Group(); hip.add(spine);
    const up = mk(g.torso), gun = mk(g.gun), torch = mk(g.torch, false), charge = mk(g.charge, false), midUp = mk(g.mid);
    torch.visible = charge.visible = false;
    spine.add(up, gun, torch, charge, midUp);
    const legs = [];
    for (const x of [0.1, -0.1]) {
      const th = new T.Group(); th.position.x = x; hip.add(th);
      const knee = new T.Group(); knee.position.y = -0.5; th.add(knee);
      const thM = mk(g.thigh), shM = mk(g.shin), midM = mk(g.midLegL);
      th.add(thM, midM); knee.add(shM);
      legs.push({ th, knee, thM, shM, midM });
    }
    const far = mk(g.far, false); far.visible = false; body.add(far);
    const rig = { root, body, hip, spine, up, gun, torch, charge, midUp, legs, far, legL: legs[0].th, legR: legs[1].th, lod: -1, type, s, cr: 0, sl: 0, vt: 0, sprint: 0, rec: 0, phase: Math.random() * 6.28, amp: 0, dead: false };
    setLod(rig, 2);
    return rig;
  }

  function setLod(r, lod) {
    if (r.lod === lod) return; r.lod = lod;
    const f = lod === 0;
    r.up.visible = r.gun.visible = f; for (const l of r.legs) { l.thM.visible = l.shM.visible = f; l.midM.visible = lod === 1; }
    r.midUp.visible = lod === 1; r.far.visible = lod === 2;
    r.hip.visible = lod < 2;
    if (lod === 2) { r.hip.position.y = HIP; }
  }

  // pose targets from sim state. Returns nothing; mutates the rig. d2 = squared distance to the camera.
  const lerp = (a, b, k) => a + (b - a) * k;
  function animate(r, u, dt, t, world, d2, vis) {
    const lod = d2 < 38 * 38 ? 0 : d2 < 170 * 170 ? 1 : 2;
    setLod(r, lod);
    r.root.visible = vis;
    if (lod === 2 || !vis) { r.body.rotation.x = 0; return; }
    const sp = Math.hypot(u.vel.x, u.vel.z), onG = u.onGround !== false;
    const stance = u.stance || 0, k = Math.min(1, dt * 11);
    const cr = stance === 1 ? 1 : 0, sl = stance === 2 ? 1 : 0;
    r.cr = lerp(r.cr, cr, k); r.sl = lerp(r.sl, sl, Math.min(1, dt * 14));
    const vault = u.vault > 0 ? Math.sin(Math.min(1, u.vault) * Math.PI) : 0, mantle = u.vaultKind === 'mantle';
    r.vt = lerp(r.vt, vault, Math.min(1, dt * 20));
    const spr = u.sprinting ? 1 : 0; r.sprint = lerp(r.sprint, spr, k);
    const run = Math.min(1, sp / 5.5) * (onG ? 1 : 0.2) * (1 - r.sl);
    r.amp = lerp(r.amp, run, Math.min(1, dt * 12));
    r.phase += sp * dt * (1.9 + 0.5 * r.sprint) * (r.cr > 0.5 ? 0.7 : 1);
    const ph = r.phase, a = r.amp * (0.75 + 0.35 * r.sprint);
    // hips: stand 1.0, crouch 0.66, slide 0.34; vault lifts them
    const hy = lerp(lerp(HIP, 0.64, r.cr), 0.36, r.sl) + r.vt * (mantle ? 0.55 : 0.4) + Math.abs(Math.sin(ph)) * 0.05 * a * (1 - r.cr);
    r.hip.position.y = hy;
    // legs
    const strideT = Math.sin(ph) * 0.85 * a, strideT2 = -strideT;
    const airT = onG ? 0 : 1;
    for (let i = 0; i < 2; i++) {
      const L = r.legs[i], sgn = i ? -1 : 1, s0 = i ? strideT2 : strideT;
      const thetaWalk = s0, kneeWalk = Math.max(0, Math.sin(ph * 1 + (i ? 0 : Math.PI) + 1.0)) * 1.05 * a + 0.1 * a;
      const crTh = -1.05 - sgn * 0.12, crKn = 1.9;                                  // crouch: thighs forward, knees folded
      const slTh = -1.25 + sgn * 0.1, slKn = 0.25;                                    // slide: legs out ahead
      const vtTh = -1.2 + sgn * 0.35, vtKn = 1.5;                                     // vault: knees tucked
      const air = -0.55 + sgn * 0.35, airK = 0.9;
      let th = lerp(thetaWalk, crTh, r.cr), kn = lerp(kneeWalk, crKn, r.cr);
      th = lerp(th, slTh, r.sl); kn = lerp(kn, slKn, r.sl);
      th = lerp(th, vtTh, r.vt); kn = lerp(kn, vtKn, r.vt);
      th = lerp(th, air, airT * (1 - r.vt)); kn = lerp(kn, airK, airT * (1 - r.vt));
      L.th.rotation.x = th; L.knee.rotation.x = kn;
      L.th.rotation.z = sgn * (0.04 + r.sl * 0.1);
    }
    // torso: aim pitch, run lean, crouch lean, slide lean-back, recoil kick, suppression flinch
    r.rec = Math.max(0, 1 - (world.t - (u.lastFire || -9)) * 11);
    const supp = u.supp || 0;
    const lean = 0.08 * r.amp + 0.14 * r.sprint * r.amp + 0.32 * r.cr + 0.12 * supp - 1.15 * r.sl + 0.55 * r.vt * (mantle ? 1 : 0.4);
    r.spine.rotation.x = lean - E.clamp(u.aimPitch || 0, -0.8, 0.8) * 0.85 - r.rec * 0.05;
    r.spine.rotation.y = Math.sin(ph) * 0.1 * a;
    r.spine.rotation.z = Math.sin(ph * 2) * 0.03 * a * (1 + r.sprint);
    r.spine.position.z = -r.rec * 0.07; r.spine.position.y = -supp * 0.04 * (1 - r.cr);
    r.body.rotation.x = 0;
    // engineer tools
    if (r.type === 'engineer') {
      const tool = u.tool || 0;
      r.gun.visible = lod === 0 && tool === 0; r.midUp.visible = lod === 1;
      r.torch.visible = lod === 0 && tool === 1; r.charge.visible = lod === 0 && tool === 2;
      if (lod === 1) { /* merged mesh shows the gun in every tool state at range; fine at this distance */ }
    }
  }

  // collapse pose for corpses: t seconds since death, dir -1/1 picks a fall side. Mutates the rig; returns when settled.
  function deathPose(r, t, dir, kind) {
    r.dead = true;
    const k = Math.min(1, t * 3.0), e = k * k * (3 - 2 * k);
    const back = kind % 2 === 0;                        // fall backwards or crumple forwards
    r.setLod = r.setLod || null;
    setLod(r, 0);
    r.hip.position.y = lerp(r.hip.position.y, 0.18 + 0.3 * (1 - e), 0.25);
    r.body.rotation.x = (back ? -1 : 1) * e * (Math.PI / 2 - 0.12);
    r.body.rotation.z = dir * e * 0.35;
    r.body.position.y = e * 0.2;
    for (const L of r.legs) { L.th.rotation.x = lerp(L.th.rotation.x, back ? -0.4 : 0.1, 0.2); L.knee.rotation.x = lerp(L.knee.rotation.x, back ? 0.9 : 1.2, 0.2); }
    r.spine.rotation.x = lerp(r.spine.rotation.x, back ? 0.1 : -0.3, 0.2);
    r.gun.visible = r.up.visible = true;
  }

  E.ArtInfantry = { make, animate, setLod, deathPose, build };
})(window.E = window.E || {});
