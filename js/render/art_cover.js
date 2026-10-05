// Cover: every piece in w.cover[] drawn as itself, in three damage stages, instanced.
//   14 cover types x (intact, damaged, broken) geometries built once per biome, normalised to a unit footprint
//   (x,z in -0.5..0.5, y in 0..1) and scaled per piece to (2*hw, h0, 2*hd). Stage 3 / dead pieces leave low rubble.
//   One InstancedMesh per (type, stage); the instance lists are rebuilt only when the piece list signature changes.
//   Dynamic pieces (wrecks, engineer barriers) are just more entries. breakFx() is called from the renderer on
//   coverBreak events: debris chunks, dust and a scorch mark.
(function (E) {
  'use strict';
  const sh = (c, k) => E.Geo.shade(c, k);

  function palette(biomeId, look) {
    const rock = E.rgb(look.rock), rock2 = E.rgb(look.rock2 || look.rock);
    const dust = { desert: [196, 164, 112], tundra: [232, 238, 246], jungle: [74, 104, 52], urban: [150, 148, 144], volcanic: [58, 54, 52], ocean: [190, 182, 150], cratered: [150, 152, 158], gas: [110, 90, 130] }[biomeId] || [180, 160, 120];
    return {
      rock, rock2, dust, bag: sh([158, 140, 100], biomeId === 'tundra' ? 1.1 : 1), concrete: biomeId === 'urban' ? [110, 110, 114] : sh([148, 144, 134], 0.68),
      metal: [70, 76, 86], rust: [124, 74, 44], crate: biomeId === 'desert' ? [128, 108, 72] : [86, 98, 78], wood: [96, 70, 46], ice: [170, 208, 236], leaf: biomeId === 'tundra' ? [52, 88, 74] : [44, 104, 46],
      cactus: [84, 128, 70], hazard: [186, 138, 34], char: [28, 26, 26],
    };
  }

  // damage helpers: stage 0/1/2 -> scorch factor and chunk-removal odds
  const burn = (c, d, k) => d ? sh(c, 1 - (k === undefined ? 0.22 : k) * d) : c;

  function rubbleBits(b, rng, n, col, spread, hmax) {
    for (let i = 0; i < n; i++) {
      const s = rng.f(0.035, 0.1) * (hmax || 1);
      b.box(s * rng.f(0.8, 1.8), s * rng.f(0.6, 1.2), s * rng.f(0.8, 1.8), rng.f(-0.5, 0.5) * spread, s * 0.4, rng.f(-0.5, 0.5) * spread, burn(col, 1, 0.1 * rng.f(0, 2)), { ry: rng.angle(), rx: rng.f(-0.4, 0.4), mode: 2, sc: 1 });
    }
  }
  function ember(b, rng, n, w, h, d) {
    for (let i = 0; i < n; i++) b.box(0.03, 0.03, 0.03, rng.f(-0.5, 0.5) * w, rng.f(0.1, 0.9) * h, rng.f(-0.5, 0.5) * d, [255, 120, 30], { emi: 2.6, mode: 0, sc: 1 });
  }
  function crack(b, rng, w, h, d, n, col) {
    for (let i = 0; i < n; i++) {
      const y = rng.f(0.15, 0.9) * h, x = rng.f(-0.4, 0.4) * w, f = rng.chance(0.5);
      b.box(f ? 0.02 : rng.f(0.1, 0.3), rng.f(0.1, 0.35) * h, f ? rng.f(0.1, 0.3) : 0.02, x, y, f ? d * 0.5 + 0.005 : 0, col || [22, 22, 24], { rz: rng.f(-0.5, 0.5), mode: 0, sc: 1 });
    }
  }

  // ── per-type geometry. (b, P, d, rng, team) ──
  const BUILD = {
    sandbag(b, P, d, rng) {
      const rows = d === 0 ? 3 : d === 1 ? 3 : 2, n = 6;
      for (let r = 0; r < rows; r++) for (let i = 0; i < n; i++) {
        if (d === 1 && r === 2 && rng.chance(0.5)) continue;
        if (d === 2 && r === 1 && rng.chance(0.55)) continue;
        const off = (r % 2) * 0.5 / n, x = (i + 0.5) / n - 0.5 + off - (r % 2 ? 0.5 / n * 0 : 0);
        if (x > 0.5 || x < -0.5) continue;
        const k = rng.f(0.92, 1.08), tip = d && r === rows - 1 ? rng.f(-0.4, 0.4) : rng.f(-0.06, 0.06);
        b.box(1 / n * 1.1 * k, 0.3 * (d === 2 ? 0.8 : 1), 0.78, x, 0.16 + r * 0.28 + (d === 2 ? -0.03 : 0), rng.f(-0.03, 0.03), burn(sh(P.bag, rng.f(0.9, 1.1)), d, 0.15), { taper: [0.82, 0.84], ry: rng.f(-0.1, 0.1), rz: tip, mode: 0, sc: 1 });
        b.box(1 / n * 0.5, 0.025, 0.1, x, 0.17 + r * 0.29 + 0.14, 0.2, sh(P.bag, 0.75), { mode: 0, sc: 1 });    // tied seam
      }
      if (d) rubbleBits(b, rng, 5 + d * 3, P.bag, 1.0, 1.2);
      if (d === 2) b.sphere(0.5, 0, 0.04, 0.35, burn(P.dust, 0, 0), { sx: 0.7, sy: 0.12, sz: 0.4, seg: 8, seg2: 4, mode: 0, sc: 1 });
    },
    barrier(b, P, d, rng) {
      const top = d === 0 ? 1 : d === 1 ? 0.92 : 0.55;
      b.box(1, 0.16, 1, 0, 0.08, 0, burn(P.concrete, d), { sc: 1, mode: 2 });
      b.box(0.94, top - 0.16, 0.62, 0, 0.16 + (top - 0.16) / 2, 0, burn(sh(P.concrete, 1.06), d), { taper: [1, 0.78], sc: 1, mode: 2 });
      b.box(0.96, 0.08, 0.5, 0, top, 0, burn(P.metal, d), { sc: 1, mode: 1 });
      for (let i = 0; i < 4; i++) b.box(0.06, top * 0.4, 0.64, -0.38 + i * 0.25, 0.2 + top * 0.25, 0, P.hazard, { rz: 0.5, sc: 1, mode: 0, taper: [1, 0.8] });
      if (d >= 1) { crack(b, rng, 1, top, 0.62, 3 + d * 2, [20, 20, 22]); b.box(0.2, 0.2, 0.7, rng.f(-0.3, 0.3), top - 0.05, 0, [18, 18, 20], { mode: 0, sc: 1 }); }
      if (d === 2) { for (let i = 0; i < 4; i++) b.cyl(0.012, 0.012, 0.35, 4, rng.f(-0.4, 0.4), top + 0.14, rng.f(-0.1, 0.1), P.rust, { rx: rng.f(-0.4, 0.4), rz: rng.f(-0.3, 0.3), mode: 0, sc: 1 }); rubbleBits(b, rng, 6, P.concrete, 1.1, 1.2); }
    },
    crates(b, P, d, rng) {
      const crate = (x, y, z, s, ry, tilt, k) => {
        const c = burn(sh(P.crate, k || 1), d);
        b.box(s, s * 0.5, s, x, y + s * 0.25, z, c, { ry, rz: tilt, sc: 1, mode: 1 });
        b.box(s * 1.03, s * 0.06, s * 1.03, x, y + s * 0.03, z, sh(c, 0.7), { ry, rz: tilt, sc: 1, mode: 0 });
        b.box(s * 1.03, s * 0.06, s * 1.03, x, y + s * 0.47, z, sh(c, 0.7), { ry, rz: tilt, sc: 1, mode: 0 });
        for (const sx of [-1, 1]) b.box(s * 0.06, s * 0.5, s * 1.03, x + Math.cos(ry) * sx * s * 0.47, y + s * 0.25, z - Math.sin(ry) * sx * s * 0.47, sh(c, 0.72), { ry, rz: tilt, sc: 1, mode: 0 });
        b.box(s * 0.3, s * 0.1, 0.01, x, y + s * 0.3, z + s * 0.51, P.hazard, { ry, sc: 1, mode: 0 });
      };
      crate(-0.2, 0, 0.0, 0.58, 0.1, 0, 1); crate(0.26, 0, -0.1, 0.46, -0.2, 0, 0.9);
      if (d < 2) crate(-0.12, 0.29, 0.05, 0.5, d ? 0.55 : -0.1, d ? 0.35 : 0, 1.05);
      if (d >= 1) { for (let i = 0; i < 6; i++) b.box(0.02, 0.02, rng.f(0.08, 0.2), rng.f(-0.5, 0.5), rng.f(0.02, 0.2), rng.f(-0.5, 0.5), sh(P.crate, 0.6), { ry: rng.angle(), rz: rng.f(-1, 1), mode: 0, sc: 1 }); if (d === 2) { ember(b, rng, 2, 0.8, 0.3, 0.8); } }
    },
    bunker(b, P, d, rng) {
      const hh = d === 2 ? 0.62 : 1;
      b.box(1, 0.18, 1, 0, 0.09, 0, burn(P.concrete, d, 0.15), { sc: 1, mode: 2 });
      // wall in three pieces so stage 2 can have a breach
      const seg = [[-0.34, 0.32], [0.0, 0.36], [0.34, 0.32]];
      seg.forEach(([x, w], i) => {
        if (d === 2 && i === 1) return;
        const hI = (d === 1 && i === 2) ? 0.82 : hh;
        b.box(w, hI * 0.9, 0.9, x, 0.18 + hI * 0.45, 0, burn(sh(P.concrete, 1.04), d, 0.2), { sc: 1, mode: 2 });
      });
      if (d < 2) { b.box(0.36, 0.34, 0.9, 0, 0.18 + 0.66 + 0.17 - 0.32, 0, burn(P.concrete, d), { sc: 1, mode: 2 }); b.box(0.36, 0.1, 0.9, 0, 0.18, 0, burn(P.concrete, d), { sc: 1, mode: 2 }); b.box(0.34, 0.08, 0.95, 0, 0.66, 0, [14, 14, 16], { sc: 1, mode: 0 }); }
      b.box(1.02, 0.07, 0.96, 0, 0.18 + hh * 0.9 + 0.035, 0, burn(P.metal, d), { sc: 1, mode: 1, taper: [1, 1] });
      for (const s of [-1, 1]) b.box(0.04, 0.5, 0.04, s * 0.48, 0.5, 0.48, P.hazard, { sc: 1, mode: 0 });
      if (d >= 1) { crack(b, rng, 1, hh, 0.9, 4 + d * 3, [18, 18, 20]); rubbleBits(b, rng, 6 + d * 4, P.concrete, 1.15, 1.4); for (let i = 0; i < 3; i++) b.cyl(0.012, 0.012, 0.4, 4, rng.f(-0.4, 0.4), 0.7, 0.45, P.rust, { rx: rng.f(-0.5, 0.5), mode: 0, sc: 1 }); }
      if (d === 2) ember(b, rng, 3, 0.9, 0.5, 0.5);
    },
    trap(b, P, d, rng) {
      const arm = (rx, ry, rz, len, col) => b.box(0.1, len, 0.1, 0, 0.5, 0, col, { rx, ry, rz, sc: 1, mode: 1 });
      const c = burn(P.metal, d, 0.12);
      const a = d === 2 ? 2 : 3;
      arm(0, 0, 0.78, 1.25, c); arm(0.78, 0.0, 0.0, 1.25, c); if (a > 2) arm(-0.78, 0.9, 0.78, 1.2, c);
      b.box(0.14, 0.14, 0.14, 0, 0.5, 0, sh(c, 1.2), { sc: 1, mode: 1 });
      if (d) { b.box(0.06, 0.06, 0.5, 0.35, 0.1, 0.1, P.rust, { rx: 0.3, sc: 1, mode: 0 }); ember(b, rng, d, 0.5, 0.6, 0.5); }
      for (const s of [-1, 1]) b.box(0.12, 0.05, 0.12, s * 0.4, 0.04, 0, sh(P.rust, 0.9), { sc: 1, mode: 0 });
    },
    rock(b, P, d, rng) {
      const mk = (cx, cy, cz, r, seed, col, sx, sz) => {
        const T = E.THREE, g = new T.IcosahedronGeometry(1, 2), p = g.attributes.position, rr = E.RNG(seed), seen = new Map();
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i), key = x.toFixed(3) + y.toFixed(3) + z.toFixed(3);
          let k = seen.get(key); if (k === undefined) { k = 0.82 + rr.next() * 0.3 + Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7) * 0.1; seen.set(key, k); }
          p.setXYZ(i, x * k, Math.max(y * k, -0.05) * 0.8, z * k);
        }
        b.add(g, cx, cy, cz, col, { sx: r * sx, sy: r, sz: r * sz, smooth: false, mode: 2, sc: 1 });
      };
      if (d < 2) {
        mk(0, 0.34, 0, 0.5, 5, burn(P.rock, d, 0.1), 1, 1);
        mk(0.3, 0.12, 0.18, 0.28, 9, sh(P.rock2, 0.95), 0.9, 0.8);
        mk(-0.28, 0.1, -0.2, 0.24, 13, sh(P.rock, 1.08), 0.9, 0.9);
        if (d === 1) { crack(b, rng, 0.8, 0.7, 0.8, 5, sh(P.rock, 0.35)); b.box(0.22, 0.18, 0.22, 0.2, 0.62, 0.1, sh(P.rock2, 1.15), { ry: 0.5, rx: 0.3, sc: 1, mode: 2 }); }
      } else {
        mk(-0.22, 0.2, 0, 0.32, 17, sh(P.rock, 0.8), 0.9, 1); mk(0.26, 0.14, 0.04, 0.26, 21, sh(P.rock2, 0.85), 1, 0.9); mk(0.02, 0.07, 0.3, 0.16, 25, sh(P.rock, 0.7), 1, 1);
        rubbleBits(b, rng, 8, P.rock, 1.0, 1.4);
      }
    },
    slab(b, P, d, rng) {
      const top = d === 2 ? 0.55 : 1;
      b.box(0.96, top, 0.8, 0, top / 2, 0, burn(P.ice, d, 0.18), { taper: [0.82, 0.55], sc: 1, mode: 0, emi: 0.1 });
      b.box(0.5, top * 0.72, 0.5, 0.3, top * 0.36, 0.2, sh(P.ice, 1.1), { taper: [0.7, 0.6], ry: 0.4, sc: 1, mode: 0, emi: 0.1 });
      b.box(0.4, 0.1, 0.5, -0.3, 0.05, -0.3, [236, 244, 252], { taper: [0.8, 0.8], sc: 1, mode: 0 });
      if (d) crack(b, rng, 0.9, top, 0.8, 5, [240, 246, 252]);
      if (d === 2) rubbleBits(b, rng, 8, P.ice, 1.1, 1.2);
    },
    tree(b, P, d, rng) {
      const hh = d === 2 ? 0.45 : 1;
      b.cyl(0.12, 0.24, hh, 7, 0, hh / 2, 0, burn(P.wood, d, 0.2), { smooth: true, mode: 0, sc: 1 });
      for (let i = 0; i < 5; i++) { const a = i / 5 * E.TAU; b.cone(0.1, 0.22, 4, Math.cos(a) * 0.2, 0.08, Math.sin(a) * 0.2, sh(P.wood, 0.85), { rx: Math.sin(a) * 1.0, rz: -Math.cos(a) * 1.0, mode: 0, sc: 1 }); }
      if (d < 2) {
        const nb = d ? 2 : 4;
        for (let i = 0; i < nb; i++) { const a = i * 2.1; b.cyl(0.02, 0.05, 0.35, 5, Math.cos(a) * 0.15, 0.62 + i * 0.07, Math.sin(a) * 0.15, P.wood, { rx: Math.sin(a) * 0.9, rz: -Math.cos(a) * 0.9, mode: 0, sc: 1 }); }
        const lc = burn(P.leaf, d, 0.25);
        if (!d || rng.chance(0.6)) for (let i = 0; i < 5; i++) b.sphere(0.5, rng.f(-0.25, 0.25), 0.82 + rng.f(0, 0.22), rng.f(-0.25, 0.25), sh(lc, rng.f(0.85, 1.15)), { sx: rng.f(0.38, 0.55), sy: rng.f(0.22, 0.3), sz: rng.f(0.38, 0.55), seg: 7, seg2: 5, mode: 0, sc: 1 });
      } else { b.cone(0.1, 0.4, 5, 0.05, 0.5, 0, P.wood, { rz: 0.4, mode: 0, sc: 1 }); ember(b, rng, 3, 0.4, 0.4, 0.4); }
    },
    cactus(b, P, d, rng) {
      const hh = d === 2 ? 0.5 : 1, c = burn(P.cactus, d, 0.2);
      b.cyl(0.2, 0.26, hh, 8, 0, hh / 2, 0, c, { smooth: true, mode: 0, sc: 1 });
      b.sphere(0.2, 0, hh, 0, sh(c, 1.1), { sy: 0.7, seg: 8, seg2: 5, mode: 0, sc: 1 });
      if (d < 2) for (const s of [-1, 1]) { const y = 0.42 + (s > 0 ? 0.12 : 0); b.cyl(0.11, 0.11, 0.34, 7, s * 0.32, y, 0, c, { rz: Math.PI / 2, smooth: true, mode: 0, sc: 1 }); if (!d || s > 0) b.cyl(0.1, 0.12, 0.36, 7, s * 0.5, y + 0.2, 0, sh(c, 1.05), { smooth: true, mode: 0, sc: 1 }); }
      if (d === 2) rubbleBits(b, rng, 4, P.cactus, 0.9, 1);
    },
    ruin(b, P, d, rng) {
      const cols = 7;
      for (let i = 0; i < cols; i++) {
        const x = (i + 0.5) / cols - 0.5, base = rng.f(0.85, 1.0), gap = (i === 3 || i === 4) && true;
        let hgt = d === 0 ? base * (gap && i === 3 ? 0.5 : 1) : d === 1 ? base * rng.f(0.35, 0.95) : base * rng.f(0.1, 0.5);
        if (gap && i === 4 && d === 0) continue;
        b.box(1 / cols * 1.02, hgt, 0.9, x, hgt / 2, 0, burn(sh(P.concrete, rng.f(0.92, 1.08)), d, 0.18), { sc: 1, mode: 2, taper: [1, 0.85 + 0.15 * rng.next()] });
        if (d === 0 && hgt > 0.85) b.box(1 / cols * 1.02, 0.05, 0.92, x, hgt, 0, sh(P.concrete, 0.85), { sc: 1, mode: 2 });
      }
      b.box(0.14, 0.16, 0.3, -0.18, 0.62, 0.2, [18, 18, 20], { sc: 1, mode: 0 });                // window void
      for (let i = 0; i < 3; i++) b.cyl(0.012, 0.012, 0.35, 4, rng.f(-0.45, 0.45), (d ? 0.4 : 0.95), rng.f(-0.3, 0.3), P.rust, { rx: rng.f(-0.5, 0.5), mode: 0, sc: 1 });
      rubbleBits(b, rng, 8 + d * 5, P.concrete, 1.15, 1.2);
      if (d) crack(b, rng, 1, 0.9, 0.9, 3 + d * 2, [20, 20, 22]);
    },
    ledge(b, P, d, rng) {
      const top = d === 2 ? 0.5 : 1;
      for (let i = 0; i < 5; i++) b.box(rng.f(0.3, 0.55), rng.f(0.4, 1) * top * (i % 2 ? 0.8 : 1), rng.f(0.5, 0.85), (i / 4 - 0.5) * 0.85, 0.2, rng.f(-0.1, 0.1), burn(sh(i % 2 ? P.rock2 : P.rock, rng.f(0.85, 1.1)), d, 0.15), { ry: rng.f(-0.3, 0.3), rz: rng.f(-0.25, 0.25), taper: [0.8, 0.85], sc: 1, mode: 2 });
      rubbleBits(b, rng, 6, P.rock, 1.1, 1.2);
    },
    tower(b, P, d, rng) {
      const hh = d === 2 ? 0.62 : 1;
      b.box(1, 0.12, 1, 0, 0.06, 0, burn(P.concrete, d, 0.15), { sc: 1, mode: 2 });
      b.box(0.9, hh * 0.78, 0.9, 0, 0.12 + hh * 0.39, 0, burn(sh(P.concrete, 1.0), d, 0.2), { sc: 1, mode: 3, taper: [0.95, 0.95] });
      for (let i = 0; i < 3; i++) for (const s of [-1, 1]) b.box(0.08, 0.08, 0.02, s * 0.2, 0.3 + i * 0.2, 0.455, [14, 14, 16], { sc: 1, mode: 0 });
      if (d < 2) { b.box(1.0, 0.1, 1.0, 0, 0.12 + hh * 0.78, 0, burn(P.metal, d), { sc: 1, mode: 1 }); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.08, 0.1, 0.08, sx * 0.46, 0.12 + hh * 0.78 + 0.1, sz * 0.46, P.metal, { sc: 1, mode: 0 }); b.cyl(0.01, 0.01, 0.2, 4, 0.3, 0.12 + hh * 0.78 + 0.15, 0.3, P.metal, { mode: 0, sc: 1 }); }
      b.box(0.5, 0.05, 0.02, 0, 0.5, 0.47, P.hazard, { sc: 1, mode: 0, emi: 0.6 });
      if (d) { crack(b, rng, 0.9, hh, 0.9, 5 + d * 3, [18, 18, 20]); rubbleBits(b, rng, 8 + d * 4, P.concrete, 1.25, 1.4); }
      if (d === 2) { ember(b, rng, 4, 0.8, 0.7, 0.8); for (let i = 0; i < 5; i++) b.cyl(0.012, 0.012, 0.35, 4, rng.f(-0.4, 0.4), 0.62, rng.f(-0.4, 0.4), P.rust, { rx: rng.f(-0.5, 0.5), rz: rng.f(-0.5, 0.5), mode: 0, sc: 1 }); }
    },
    wreck(b, P, d, rng) {
      const c = burn(P.char, 0), c2 = sh([62, 58, 54], 1 - 0.1 * d);
      b.box(1, 0.5, 1, 0, 0.3, 0, c2, { taper: [0.8, 0.9], sc: 1, mode: 2, rz: 0.04 });
      b.box(0.5, 0.4, 0.62, -0.15, 0.62, 0, c, { taper: [0.8, 0.8], sc: 1, mode: 2, rz: 0.1 });
      b.cyl(0.06, 0.07, 0.8, 6, 0.35, 0.52, 0.0, c, { rz: 1.25, mode: 0, sc: 1 });             // drooping barrel
      for (let i = 0; i < 4; i++) b.box(0.05, 0.3 + rng.f(0, 0.2), 0.7, -0.42 + i * 0.28, 0.5 + rng.f(0, 0.1), 0.2, c, { rx: rng.f(0.1, 0.4), mode: 0, sc: 1 });     // torn ribs
      rubbleBits(b, rng, 8, [52, 50, 48], 1.2, 1.4);
      ember(b, rng, 7 - d * 2, 0.9, 0.8, 0.9);
      for (let i = 0; i < 4; i++) b.box(0.4, 0.015, 0.08, rng.f(-0.3, 0.3), rng.f(0.35, 0.8), rng.f(-0.3, 0.3) + 0.46, [255, 100, 24], { emi: 2.2, mode: 0, sc: 1, ry: rng.f(-1, 1) });
    },
    shield(b, P, d, rng, team) {
      const F = E.faction(team || 'aegis').palette, g = F.shield, ec = [g[0], g[1], g[2]];
      b.box(1.0, 0.1, 1.0, 0, 0.05, 0, P.metal, { sc: 1, mode: 1 });
      for (const s of [-1, 1]) { b.box(0.06, 1, 0.9, s * 0.46, 0.5, 0, P.metal, { sc: 1, mode: 1 }); b.sphere(0.05, s * 0.46, 1.0, 0, ec, { emi: 3, mode: 0, sc: 1 }); }
      b.box(0.9, 0.9, 0.18, 0, 0.55, 0, ec, { emi: d ? 0.9 : 1.6, mode: 0, sc: 1, taper: [1, 0.3] });
      b.box(0.92, 0.04, 0.2, 0, 1.0, 0, sh(ec, 1.1), { emi: 2.5, mode: 0, sc: 1 });
    },
  };

  const COLOR_KEYS = { wreck: [74, 70, 66] };

  class CoverView {
    constructor(scene, biomeId, look, world) {
      const T = E.THREE;
      this.S = scene; this.biome = biomeId; this.P = palette(biomeId, look);
      this.group = new T.Group(); scene.world.add(this.group);
      this.meshes = new Map();          // key -> { im, cap }
      this.sig = -1; this.mat = E.Mat.prop(E.rgbToHex ? E.rgbToHex(this.P.dust) : (this.P.dust[0] << 16 | this.P.dust[1] << 8 | this.P.dust[2]), 'cover:' + biomeId);
      this.rubble = null;
      this.world = world; this._m = new T.Matrix4(); this._q = new T.Quaternion(); this._p = new T.Vector3(); this._s = new T.Vector3(); this._c = new T.Color(); this._up = new T.Vector3(0, 1, 0);
      this.seen = new Map();            // id -> stage, to detect transitions for local effects
      this.counts = {};
      for (const c of (world.cover || [])) { const k = this.keyOf(c); this.counts[k] = (this.counts[k] || 0) + 1; }
    }
    keyOf(c) { return c.type === 'shield' ? 'shield:' + (c.team || 'aegis') : c.type; }
    geoFor(key, stage) {
      const type = key.split(':')[0], team = key.split(':')[1];
      const rng = E.RNG(E.hashStr ? E.hashStr(key) + stage * 77 : stage * 77 + 1), b = new E.Geo.Builder(1);
      (BUILD[type] || BUILD.ledge)(b, this.P, stage, rng, team);
      return b.build();
    }
    meshFor(key, stage, need) {
      const k = key + '#' + stage; let rec = this.meshes.get(k);
      if (rec && rec.cap >= need) return rec;
      const T = E.THREE, cap = Math.max(8, Math.ceil(need * 1.5) + 4);
      if (rec) { this.group.remove(rec.im); rec.im.dispose && rec.im.dispose(); }
      const im = new T.InstancedMesh(rec ? rec.im.geometry : this.geoFor(key, stage), this.mat, cap);
      im.castShadow = im.receiveShadow = true; im.frustumCulled = false; im.count = 0;
      im.setColorAt(0, this._c.setRGB(1, 1, 1));
      this.group.add(im);
      rec = { im, cap, n: 0 }; this.meshes.set(k, rec); return rec;
    }
    rubbleMesh(need) {
      if (this.rubble && this.rubble.cap >= need) return this.rubble;
      const T = E.THREE, cap = Math.max(16, need + 16);
      if (this.rubble) { this.group.remove(this.rubble.im); this.rubble.im.dispose(); }
      const b = new E.Geo.Builder(1), rng = E.RNG(4242);
      for (let i = 0; i < 26; i++) { const s = rng.f(0.06, 0.2); b.box(s * 1.5, s * rng.f(0.4, 1), s * 1.5, rng.f(-0.48, 0.48), s * 0.3, rng.f(-0.48, 0.48), sh(this.P.concrete, rng.f(0.6, 1.0)), { ry: rng.angle(), rx: rng.f(-0.3, 0.3), mode: 2, sc: 1 }); }
      const im = new T.InstancedMesh(b.build(), this.mat, cap); im.castShadow = im.receiveShadow = true; im.frustumCulled = false; im.count = 0; im.setColorAt(0, this._c.setRGB(1, 1, 1));
      this.group.add(im); this.rubble = { im, cap, n: 0 }; return this.rubble;
    }

    sync(world) {
      const arr = world.cover; if (!arr) return;
      let sig = arr.length * 131 | 0;
      for (let i = 0; i < arr.length; i++) { const c = arr[i]; sig = (Math.imul(sig, 31) + c.id * 7 + c.stage * 3 + (c.alive ? 1 : 0) + (c.team === 'verdant' ? 5 : 0)) | 0; }
      if (sig === this.sig) return;
      this.sig = sig;
      const need = {}; let rubbleN = 0;
      for (const c of arr) { if (c.alive && c.stage < 3) { const k = this.keyOf(c) + '#' + Math.min(2, c.stage); need[k] = (need[k] || 0) + 1; } else if (!c.dyn || c.stage === 3) rubbleN++; }
      for (const rec of this.meshes.values()) rec.n = 0;
      const m = this._m, q = this._q, p = this._p, s = this._s, col = this._c;
      for (const k in need) { const [key, st] = k.split('#'); this.meshFor(key, +st, need[k]); }
      const rb = this.rubbleMesh(rubbleN); rb.n = 0;
      for (const c of arr) {
        const dead = !(c.alive && c.stage < 3);
        let rec, sx, sy, sz;
        if (dead) {
          if (c.dyn && c.stage !== 3) continue;
          rec = rb; sx = c.hw * 2 * 0.95; sz = c.hd * 2 * 0.95; sy = Math.max(0.5, (c.h0 || c.h) * 0.5);
        } else {
          const st = Math.min(2, c.stage), key = this.keyOf(c);
          rec = this.meshes.get(key + '#' + st);
          sx = c.hw * 2; sz = c.hd * 2; sy = c.h0 || c.h || 1;
        }
        if (!rec || rec.n >= rec.cap) continue;
        p.set(c.x, c.y, c.z); q.setFromAxisAngle(this._up, c.yaw); s.set(sx, sy, sz);
        m.compose(p, q, s); rec.im.setMatrixAt(rec.n, m);
        const v = 0.86 + ((c.id * 2654435761 >>> 0) % 1000) / 1000 * 0.26;
        rec.im.setColorAt(rec.n, col.setRGB(v, v * 0.99, v * 0.97)); rec.n++;
      }
      for (const rec of this.meshes.values()) { rec.im.count = rec.n; rec.im.visible = rec.n > 0; rec.im.instanceMatrix.needsUpdate = true; if (rec.im.instanceColor) rec.im.instanceColor.needsUpdate = true; }
      rb.im.count = rb.n; rb.im.visible = rb.n > 0; rb.im.instanceMatrix.needsUpdate = true; if (rb.im.instanceColor) rb.im.instanceColor.needsUpdate = true;
    }

    // coverBreak: chunks, dust, a scorch mark and a flash of sparks on hard cover
    breakFx(fx, e) {
      const c = this.world && this.world.cover ? this.world.cover.find(x => x.id === e.id) : null;
      const hw = e.hw || (c && c.hw) || 1.5, hd = e.hd || (c && c.hd) || 0.5, h = e.h || (c && c.h0) || 1.5, pos = e.pos;
      const type = e.ctype || (c && c.type) || 'barrier', P = this.P;
      const col = { sandbag: P.bag, crates: P.crate, rock: P.rock, ledge: P.rock, slab: P.ice, tree: P.wood, cactus: P.cactus, wreck: P.char }[type] || P.concrete;
      const n = Math.min(26, 8 + Math.round((hw + hd) * 3));
      fx.debris({ x: pos.x, y: pos.y + h * 0.5, z: pos.z }, n, col, 5 + h * 2, Math.max(hw, hd), { grav: 18 });
      fx.puff({ x: pos.x, y: pos.y + 0.3, z: pos.z }, 4, type === 'tree' || type === 'cactus' ? [0.3, 0.4, 0.25] : [P.dust[0] / 255, P.dust[1] / 255, P.dust[2] / 255], Math.max(hw, hd) * 1.6, 1.8, 1.4, Math.max(hw, hd) * 2);
      if (type !== 'sandbag' && type !== 'tree' && type !== 'cactus' && type !== 'slab' && type !== 'crates') fx.spark({ x: pos.x, y: pos.y + h * 0.6, z: pos.z }, 8, [1, 0.7, 0.35], 9, 0.5, 0.1);
      if (fx.scorch) fx.scorch(pos, Math.max(hw, hd) * 1.1, 0.35);
    }
    dispose() { this.S.world.remove(this.group); }
  }

  E.ArtCover = { CoverView, BUILD, palette };
})(window.E = window.E || {});
