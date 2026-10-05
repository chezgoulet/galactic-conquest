// Builds the visible planet surface from the pure terrain sampler: a
// high-resolution arena mesh on the sim's own height grid (so feet meet the
// ground exactly), a coarse far ring out to the horizon, a shaded water plane,
// and instanced cover (rocks, trees, spires, ruins). All geometry, colour and
// surface detail come from code; the ground shader adds procedural albedo
// variation, slope rock, bump and lava glow per pixel.
(function (E) {
  'use strict';

  // per-biome ground look. kind selects the micro-detail layer in E.Mat.terrain; rip/ripF/ripDir drive wind ripples or
  // drifts, rock/rock2 + strata the cliff bands, wl is filled in with the sim's water level.
  const LOOK = {
    tundra:   { kind: 'snow',     rock: '#5c6470', rock2: '#8791a1', tint: [1.06, 1.08, 1.12], rockAt: 0.3,  bump: 0.55, rough: 0.55, rip: 0.22, ripF: 1.5, ripDir: 0.4, strata: 0.5, strataF: 1.1 },
    desert:   { kind: 'sand',     rock: '#8a5c3c', rock2: '#c2915e', tint: [1.1, 0.96, 0.84],  rockAt: 0.34, bump: 0.5,  rough: 0.95, rip: 0.55, ripF: 2.5, ripDir: 0.7, strata: 0.95, strataF: 1.9 },
    jungle:   { kind: 'mud',      rock: '#4a4538', rock2: '#6d6450', tint: [0.8, 0.98, 0.66],  rockAt: 0.42, bump: 0.7,  rough: 0.85, rip: 0.0, strata: 0.5, strataF: 1.3 },
    urban:    { kind: 'concrete', rock: '#53565d', rock2: '#74767d', tint: [0.86, 0.86, 0.88], rockAt: 0.3,  bump: 0.5,  rough: 0.85, rip: 0.0, strata: 0.6, strataF: 2.2 },
    volcanic: { kind: 'ash',      rock: '#1c1512', rock2: '#3a2a22', tint: [0.7, 0.58, 0.5],   rockAt: 0.3,  bump: 1.0,  rough: 0.8, rip: 0.3, ripF: 1.8, ripDir: 1.2, lava: '#ff4a10', lavaLevel: -5 },
    ocean:    { kind: 'sand',     rock: '#4c5a55', rock2: '#7d8f86', tint: [0.95, 1.05, 0.88], rockAt: 0.38, bump: 0.5,  rough: 0.8,  rip: 0.4, ripF: 3.0, ripDir: 0.2 },
    cratered: { kind: 'regolith', rock: '#5f636d', rock2: '#8b8f99', tint: [0.9, 0.9, 0.94],   rockAt: 0.36, bump: 0.9,  rough: 0.95, rip: 0.3, ripF: 1.4, ripDir: 1.0 },
    gas:      { kind: 'ash',      rock: '#2e2238', rock2: '#5a4468', tint: [1.1, 0.88, 1.15],  rockAt: 0.32, bump: 0.8,  rough: 0.8, rip: 0.2, lava: '#b040ff', lavaLevel: -9 },
  };

  function groundMaterial(biomeId, terrain) {
    const L = Object.assign({ lava: null }, LOOK[biomeId] || LOOK.desert);
    if (terrain) {
      L.wl = terrain.waterLevel;
      // dirt roads between the command posts, in order: the lines the battle follows
      const c = terrain.layout.cps, roads = [];
      for (let i = 0; i < c.length - 1; i++) roads.push([c[i].x, c[i].z, c[i + 1].x, c[i + 1].z]);
      L.roads = roads;
    }
    return E.Mat.terrain(biomeId, L);
  }

  function colorAt(terrain, biome, noise, x, z, h, out) {
    const pal = biome.palette, wl = terrain.waterLevel;
    const t = E.clamp01(E.invLerp(-22, 150, h));
    let c = t < 0.28 ? E.mixC(pal.low, pal.mid, t / 0.28) : E.mixC(pal.mid, pal.high, E.clamp01((t - 0.28) / 0.72));
    const n = noise.fbm(x * 0.004, z * 0.004, 3);
    c = E.mixC(c, n > 0 ? pal.high : pal.low, Math.min(0.35, Math.abs(n) * 0.6));
    if (h < wl + 2.5) c = E.mixC(c, [c[0] * 0.5, c[1] * 0.52, c[2] * 0.5], E.clamp01((wl + 2.5 - h) / 3)); // wet shore
    const k = new E.THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, E.THREE.SRGBColorSpace);
    out[0] = k.r; out[1] = k.g; out[2] = k.b;
  }

  function buildTerrain(scene, terrain, biome, quality) {
    const T = E.THREE, G = terrain.grid, group = new T.Group();
    const noise = E.Noise(terrain.planet.seed ^ 0x77), c3 = [0, 0, 0];
    const mat = groundMaterial(terrain.biome, terrain);

    // ── arena: the sim's height grid, vertex for vertex ──
    const st = quality === 'low' ? 2 : 1, NX = Math.floor((G.GW - 1) / st) + 1, NZ = Math.floor((G.GH - 1) / st) + 1;
    const pos = new Float32Array(NX * NZ * 3), col = new Float32Array(NX * NZ * 3), idx = [];
    for (let iz = 0, k = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++, k += 3) {
      const x = G.GX0 + ix * st * G.CS, z = G.GZ0 + iz * st * G.CS, h = terrain.cell(ix * st, iz * st);
      pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
      colorAt(terrain, biome, noise, x, z, h, c3); col[k] = c3[0]; col[k + 1] = c3[1]; col[k + 2] = c3[2];
    }
    for (let iz = 0; iz < NZ - 1; iz++) for (let ix = 0; ix < NX - 1; ix++) { const a = iz * NX + ix, b = a + 1, c = a + NX, d = c + 1; idx.push(a, c, b, b, c, d); }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const inner = new T.Mesh(geo, mat); inner.receiveShadow = true; group.add(inner);

    // ── far ring: warped grid, dense near the arena, out to the horizon ──
    const R = quality === 'low' ? 96 : 150, EXT = 13000, M = R + 1;
    const op = new Float32Array(M * M * 3), oc = new Float32Array(M * M * 3), oi = [];
    const warp = (u) => Math.sign(u) * Math.pow(Math.abs(u), 2.1) * EXT;
    const x1 = G.GX0 + G.CS * 2, x2 = G.GX0 + (G.GW - 3) * G.CS, z1 = G.GZ0 + G.CS * 2, z2 = G.GZ0 + (G.GH - 3) * G.CS;
    for (let iz = 0, k = 0; iz < M; iz++) for (let ix = 0; ix < M; ix++, k += 3) {
      const x = warp(ix / R * 2 - 1), z = warp(iz / R * 2 - 1);
      let h = terrain.exact(x, z);
      colorAt(terrain, biome, noise, x, z, h, c3);
      if (x > x1 && x < x2 && z > z1 && z < z2) h -= 40;   // tuck under the arena mesh
      op[k] = x; op[k + 1] = h; op[k + 2] = z; oc[k] = c3[0]; oc[k + 1] = c3[1]; oc[k + 2] = c3[2];
    }
    for (let iz = 0; iz < R; iz++) for (let ix = 0; ix < R; ix++) { const a = iz * M + ix, b = a + 1, c = a + M, d = c + 1; oi.push(a, c, b, b, c, d); }
    const og = new T.BufferGeometry();
    og.setAttribute('position', new T.BufferAttribute(op, 3)); og.setAttribute('color', new T.BufferAttribute(oc, 3));
    og.setIndex(oi); og.computeVertexNormals();
    const outer = new T.Mesh(og, mat); outer.receiveShadow = false; group.add(outer);
    // skirt around the arena hides the seam
    const sp = [], sc = [], si = [];
    const edge = (ix, iz) => { const k = (iz * NX + ix) * 3; sp.push(pos[k], pos[k + 1], pos[k + 2], pos[k], pos[k + 1] - 70, pos[k + 2]); for (let j = 0; j < 2; j++) sc.push(col[k], col[k + 1], col[k + 2]); };
    const strip = (list) => { const base = sp.length / 3; for (const [ix, iz] of list) edge(ix, iz); for (let i = 0; i < list.length - 1; i++) { const a = base + i * 2; si.push(a, a + 1, a + 2, a + 1, a + 3, a + 2, a, a + 2, a + 1, a + 1, a + 2, a + 3); } };
    const top = [], bot = [], lef = [], rig = [];
    for (let ix = 0; ix < NX; ix++) { top.push([ix, 0]); bot.push([ix, NZ - 1]); }
    for (let iz = 0; iz < NZ; iz++) { lef.push([0, iz]); rig.push([NX - 1, iz]); }
    [top, bot, lef, rig].forEach(strip);
    const sg = new T.BufferGeometry();
    sg.setAttribute('position', new T.Float32BufferAttribute(sp, 3)); sg.setAttribute('color', new T.Float32BufferAttribute(sc, 3)); sg.setIndex(si); sg.computeVertexNormals();
    group.add(new T.Mesh(sg, mat));

    // ── water ──
    if (terrain.waterLevel > -1e8) {
      const wm = E.Mat.water(biome);
      const water = new T.Mesh(new T.PlaneGeometry(26000, 26000, 1, 1).rotateX(-Math.PI / 2), wm);
      water.position.y = terrain.waterLevel; water.renderOrder = 1;
      group.add(water); group.userData.water = water;
    }
    group.userData.ground = mat;
    buildCover(group, terrain, biome, quality);
    scene.world.add(group);
    return group;
  }

  // ── cover ────────────────────────────────────────────────────
  let natureMat = null;
  function nature() {
    if (!natureMat) natureMat = E.Mat.pbr({ vertexColors: true, roughness: 0.92, metalness: 0.0 });
    return natureMat;
  }
  function rockGeo(seed, col) {
    const T = E.THREE, r = E.RNG(seed), g = new T.IcosahedronGeometry(1, 1), p = g.attributes.position, seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = p.getX(i).toFixed(3) + p.getY(i).toFixed(3) + p.getZ(i).toFixed(3);
      let k = seen.get(key); if (k === undefined) { k = r.f(0.72, 1.25); seen.set(key, k); }
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.75, p.getZ(i) * k);
    }
    const b = new E.Geo.Builder(); b.add(g, 0, 0.2, 0, col, { mode: 0 }); return b.build();
  }
  const GEO = {
    rock: (b, P) => rockGeo(11, P.rock),
    rock2: (b, P) => rockGeo(29, E.Geo.shade(P.rock, 0.8)),
    jungleTree: (b) => { b.cyl(0.35, 0.6, 9, 6, 0, 4.5, 0, [74, 53, 36], { mode: 0 }); b.sphere(3.6, 0, 9.5, 0, [38, 96, 44], { sy: 0.6, seg: 7, seg2: 5, smooth: false, mode: 0 }); b.sphere(2.6, 1.6, 11.3, 0.8, [52, 122, 52], { sy: 0.6, seg: 7, seg2: 5, smooth: false, mode: 0 }); b.sphere(2.2, -1.4, 10.6, -1.2, [30, 82, 40], { sy: 0.6, seg: 6, seg2: 4, smooth: false, mode: 0 }); return b.build(); },
    palm: (b) => { b.cyl(0.22, 0.34, 8, 5, 0, 4, 0, [96, 74, 50], { rz: 0.12, mode: 0 }); for (let i = 0; i < 6; i++) { const a = i / 6 * E.TAU; b.box(0.9, 0.08, 3.6, -0.5 + Math.sin(a) * 1.6, 7.9, Math.cos(a) * 1.6, [56, 128, 56], { ry: a, rx: 0.5, taper: [0.3, 1], mode: 0 }); } return b.build(); },
    pine: (b) => { b.cyl(0.25, 0.4, 3, 5, 0, 1.5, 0, [60, 44, 32], { mode: 0 }); b.cone(2.6, 4, 7, 0, 4.4, 0, [34, 66, 54], { mode: 0 }); b.cone(2.0, 3.4, 7, 0, 6.6, 0, [44, 80, 66], { mode: 0 }); b.cone(1.3, 2.8, 7, 0, 8.6, 0, [214, 228, 240], { mode: 0 }); return b.build(); },
    cactus: (b) => { b.cyl(0.42, 0.5, 4.4, 7, 0, 2.2, 0, [84, 128, 70], { mode: 0 }); b.cyl(0.26, 0.26, 1.8, 6, 0.95, 2.9, 0, [78, 120, 66], { mode: 0 }); b.cyl(0.26, 0.26, 0.9, 6, 0.55, 2.1, 0, [78, 120, 66], { rz: Math.PI / 2, mode: 0 }); b.cyl(0.24, 0.24, 1.4, 6, -0.9, 2.4, 0, [78, 120, 66], { mode: 0 }); b.cyl(0.24, 0.24, 0.8, 6, -0.5, 1.8, 0, [78, 120, 66], { rz: Math.PI / 2, mode: 0 }); return b.build(); },
    scrub: (b) => { for (let i = 0; i < 6; i++) { const a = i * 1.05; b.cone(0.16, 1.5, 4, Math.cos(a) * 0.45, 0.6, Math.sin(a) * 0.45, [142, 124, 78], { rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5, mode: 0 }); } return b.build(); },
    shard: (b) => { b.cone(1.5, 8, 5, 0, 3.6, 0, [176, 214, 240], { rz: 0.14, emi: 0.12, mode: 0 }); b.cone(0.9, 4.6, 5, 1.3, 2, 0.5, [150, 196, 232], { rz: -0.3, emi: 0.12, mode: 0 }); b.cone(0.7, 3.2, 4, -1.0, 1.4, -0.7, [200, 230, 250], { rz: 0.4, emi: 0.12, mode: 0 }); return b.build(); },
    spire: (b, P) => { b.cone(2.2, 13, 6, 0, 6, 0, [34, 26, 24], { rz: 0.08, mode: 0 }); b.cone(1.3, 7, 5, 2, 3, 1, [44, 32, 28], { rz: -0.25, mode: 0 }); b.sphere(0.6, 0.6, 0.5, -1.4, P.lava || [255, 90, 20], { emi: 5, sy: 0.4, mode: 0 }); return b.build(); },
    tower: (b) => { b.box(16, 60, 16, 0, 30, 0, [92, 98, 112], { mode: 3 }); b.box(12, 14, 12, 0, 67, 0, [74, 80, 94], { mode: 3 }); b.box(1, 14, 1, 3, 81, 3, [50, 54, 62], { mode: 0 }); b.box(0.8, 0.8, 0.8, 3, 88.4, 3, [255, 60, 40], { emi: 6, mode: 0 }); return b.build(); },
    block: (b) => { b.box(26, 26, 18, 0, 13, 0, [104, 104, 112], { mode: 3 }); b.box(10, 8, 10, -5, 30, 0, [84, 88, 98], { mode: 3 }); return b.build(); },
    ruin: (b) => { b.box(7, 3.2, 0.7, 0, 1.6, 0, [118, 116, 112], { taper: [0.6, 1], mode: 0 }); b.box(0.7, 2, 4.5, 3.2, 1, 2.2, [104, 102, 100], { taper: [1, 0.5], mode: 0 }); b.box(1.6, 0.8, 1.2, -1.5, 0.4, 1.8, [96, 94, 92], { ry: 0.5, mode: 0 }); return b.build(); },
    coral: (b) => { b.cone(0.9, 3.6, 5, 0, 1.6, 0, [198, 110, 96], { mode: 0 }); b.cone(0.6, 2.4, 5, 0.9, 1, 0.4, [224, 150, 110], { rz: -0.4, mode: 0 }); b.cone(0.5, 2, 5, -0.7, 0.9, -0.5, [180, 96, 120], { rz: 0.5, mode: 0 }); return b.build(); },
  };
  // [geo, count, min scale, max scale, {far: ring only, hull: use hull material, slope: max, wet: allow underwater}]
  const COVER = {
    tundra:   [['rock', 380, 0.8, 4.2], ['pine', 520, 0.8, 1.7], ['shard', 170, 0.6, 2.2], ['rock2', 160, 3, 9, { far: 1 }]],
    desert:   [['rock', 420, 0.7, 4.5], ['rock2', 260, 2, 10, { far: 1 }], ['cactus', 230, 0.7, 1.6], ['scrub', 900, 0.6, 1.5]],
    jungle:   [['jungleTree', 1300, 0.7, 1.7], ['palm', 420, 0.8, 1.5], ['rock', 300, 0.8, 3.5], ['scrub', 500, 0.8, 1.6]],
    urban:    [['tower', 150, 0.7, 1.9, { far: 1, hull: 1 }], ['block', 130, 0.7, 1.4, { far: 1, hull: 1 }], ['ruin', 260, 0.7, 1.6], ['rock', 240, 0.5, 2], ['scrub', 300, 0.6, 1.2]],
    volcanic: [['spire', 300, 0.6, 2.2], ['rock', 520, 0.8, 5], ['rock2', 240, 3, 11, { far: 1 }]],
    ocean:    [['rock', 420, 0.8, 4.5], ['palm', 300, 0.8, 1.5], ['coral', 340, 0.7, 1.8, { wet: 1 }], ['scrub', 300, 0.7, 1.4]],
    cratered: [['rock', 650, 0.6, 5], ['rock2', 300, 2, 12, { far: 1 }], ['shard', 60, 0.5, 1.6]],
    gas:      [['spire', 260, 0.7, 2.6], ['rock', 480, 0.8, 5], ['shard', 120, 0.6, 2], ['rock2', 220, 3, 11, { far: 1 }]],
  };

  function buildCover(group, terrain, biome, quality) {
    const T = E.THREE, L = LOOK[terrain.biome] || LOOK.desert;
    const rng = E.RNG(terrain.planet.seed ^ 0x99), noise = E.Noise(terrain.planet.seed ^ 0x44);
    const P = { rock: E.rgb(L.rock), lava: L.lava ? E.rgb(L.lava) : null };
    const cps = terrain.layout.cps, dens = quality === 'low' ? 0.45 : 1;
    const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), up = new T.Vector3(0, 1, 0), col = new T.Color();
    for (const [name, count0, s0, s1, o] of (COVER[terrain.biome] || COVER.desert)) {
      const opt = o || {}, count = Math.round(count0 * dens);
      const geo = GEO[name](new E.Geo.Builder(), P);
      const im = new T.InstancedMesh(geo, opt.hull ? E.Geo.material() : nature(), count);
      let placed = 0, tries = count * 14;
      while (placed < count && tries-- > 0) {
        let x, z;
        if (opt.far) { const a = rng.angle(), d = rng.f(1.05, 2.6); x = Math.cos(a) * d * E.ARENA.x * 1.15; z = Math.sin(a) * d * E.ARENA.z * 1.3; }
        else { x = rng.f(-1480, 1480); z = rng.f(-1180, 1180); }
        if (!opt.far && noise.fbm(x * 0.006, z * 0.006, 2) < -0.12 + rng.next() * 0.2) continue;   // clump
        const h = terrain.height(x, z);
        if (!opt.wet && h < terrain.waterLevel + 0.6) continue;
        if (opt.wet && h > terrain.waterLevel - 1) continue;
        if (!opt.far && terrain.slope(x, z) > 0.75) continue;
        let near = false;
        for (const c of cps) if ((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) < (c.r * 1.5) * (c.r * 1.5)) { near = true; break; }
        if (near) continue;
        const sc = s0 + (s1 - s0) * rng.next() * rng.next();
        p.set(x, h - 0.15 * sc, z); q.setFromAxisAngle(up, rng.angle()); s.set(sc * rng.f(0.85, 1.15), sc * rng.f(0.85, 1.2), sc * rng.f(0.85, 1.15));
        m.compose(p, q, s); im.setMatrixAt(placed, m);
        const v = rng.f(0.8, 1.12); col.setRGB(v, v * rng.f(0.96, 1.04), v); im.setColorAt(placed, col);
        placed++;
      }
      im.count = placed; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = !opt.far; im.receiveShadow = true; im.frustumCulled = false;
      group.add(im);
    }
  }

  E.buildTerrain = buildTerrain;
  E.LOOK = LOOK;
})(window.E = window.E || {});
