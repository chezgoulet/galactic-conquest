// Pure terrain height field + battle layout. Both the sim (ground units stand
// here) and the renderer (builds the mesh here) read from this, so ground height
// is always consistent and deterministic for a given (biome, seed). No three.js.
//
// The battle is fought in a shallow basin around the origin (rolling ground,
// flattened pads under each command post) ringed by the biome's full-height
// mountains, which makes every map a natural arena with a dramatic skyline.
(function (E) {
  'use strict';

  const ARENA = { x: 1050, z: 760 };   // half-extents of the playable basin
  const BOUND = 2300;                  // soft world bound for aircraft

  // Command-post layout: two home bases and three contested posts, placed
  // point-symmetric through the origin so neither side is favoured.
  function battleLayout(planet) {
    const r = E.RNG((planet.seed ^ 0x5bd1e995) >>> 0);
    const fz = r.f(190, 300) * r.sign(), fx = r.f(250, 340);
    const cps = [
      { x: -660, z: r.f(-60, 60), home: 'aegis' },
      { x: -fx, z: fz },
      { x: 0, z: 0 },
      { x: fx, z: -fz },
      { x: 660, z: 0, home: 'verdant' },
    ];
    cps[4].z = -cps[0].z;
    cps.forEach((c, i) => { c.name = E.CP_NAMES ? E.CP_NAMES[i] : 'CP' + i; c.r = c.home ? 34 : 28; });
    return { cps, arena: ARENA, bound: BOUND };
  }

  function makeTerrain(planet) {
    const b = planet.biomeDef;
    const amp = b.amp || {};
    const seed = planet.seed;
    const r = E.RNG(seed);
    const n = E.Noise(seed);
    const n2 = E.Noise(seed ^ 0x9e3779b9);
    const H = 90;
    const s = 4 / planet.radius;
    const water = b.water || {};
    const waterLevel = (water.cover > 0.02) ? (water.level || 0) * 40 - 6 : -1e9;
    const layout = battleLayout(planet);

    const craters = [];
    const nc = ((amp.craters || 0) > 0 ? Math.round(10 + amp.craters * 26) : 0) + ((b.cover && b.cover.vents) ? Math.round(10 * b.cover.vents) : 0);
    for (let i = 0; i < nc; i++) {
      const a = r.angle(), d = r.f(120, 2600);
      craters.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, rad: r.f(24, 110), depth: r.f(5, 22) });
    }

    function raw(x, z) {
      const u = x * s, v = z * s;
      let h = 0;
      h += n.fbm(u, v, 5) * (amp.low || 0.4) * H;
      h += n2.fbm(u * 2.6 + 11, v * 2.6 + 7, 4) * (amp.mid || 0.5) * H * 0.6;
      h += n.ridge(u * 5.5 + 3, v * 5.5 + 3, 3) * (amp.high || 0.8) * H * 0.35;
      h += n2.fbm(u * 1.3 - 5, v * 1.3 + 2, 3) * (amp.rough || 0.4) * H * 0.3;
      return h;
    }
    // small-scale relief that survives the basin flattening (dunes, hummocks)
    function detail(x, z) {
      return n2.fbm(x * 0.012 + 3.1, z * 0.012 - 1.7, 3) * 5.5 * (0.5 + (amp.rough || 0.4)) +
             n.fbm(x * 0.03, z * 0.03, 2) * 0.9;
    }
    function basin(x, z) {
      const d = Math.hypot(x / ARENA.x, z / ARENA.z);
      return E.smoothstep(0.82, 2.3, d);
    }
    function unpadded(x, z) {
      const m = basin(x, z);
      let h = raw(x, z) * (0.22 + 1.5 * m) + m * m * 150 * (0.5 + (amp.high || 0.8) * 0.6) + detail(x, z);
      for (let i = 0; i < craters.length; i++) {
        const c = craters[i];
        const dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz, R2 = c.rad * c.rad;
        if (d2 < R2 * 5) {
          const q = d2 / R2;
          h += -c.depth * Math.exp(-q * 1.6) + c.depth * 0.35 * Math.exp(-(q - 1.15) * (q - 1.15) * 6);
        }
      }
      return h;
    }
    // pads: flatten the ground under each command post (and keep it dry)
    const pads = layout.cps.map(c => ({ x: c.x, z: c.z, r: c.r * 2.4, h: Math.max(unpadded(c.x, c.z), waterLevel + 3.5) }));
    layout.cps.forEach((c, i) => { c.y = pads[i].h; });

    function exact(x, z) {
      let h = unpadded(x, z);
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        const dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz;
        if (d2 < p.r * p.r) {
          const k = 1 - E.smoothstep(0.42, 1, Math.sqrt(d2) / p.r);
          h += (p.h - h) * k;
        }
      }
      return h;
    }
    // The arena is served from a lazily filled grid (bilinear), so the sim's
    // many height queries are cheap and the renderer's mesh (built on the same
    // grid) matches what units stand on exactly.
    const CS = 8, GX0 = -1504, GZ0 = -1200, GW = 377, GH = 301;
    const grid = new Float32Array(GW * GH).fill(NaN);
    function cell(ix, iz) {
      const i = iz * GW + ix; let v = grid[i];
      if (v !== v) { v = exact(GX0 + ix * CS, GZ0 + iz * CS); grid[i] = v; }
      return v;
    }
    function height(x, z) {
      const fx = (x - GX0) / CS, fz = (z - GZ0) / CS;
      if (!(fx >= 0 && fz >= 0 && fx < GW - 1 && fz < GH - 1)) return exact(x, z);
      const ix = fx | 0, iz = fz | 0, u = fx - ix, v = fz - iz;
      const a = cell(ix, iz), b = cell(ix + 1, iz), c = cell(ix, iz + 1), d = cell(ix + 1, iz + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    // where units stand: the sea floor is capped just under the surface (wading)
    function ground(x, z) { const h = height(x, z); return h < waterLevel - 1.1 ? waterLevel - 1.1 : h; }
    function slope(x, z) {
      const e = 4;
      return Math.hypot((height(x + e, z) - height(x - e, z)) / (2 * e), (height(x, z + e) - height(x, z - e)) / (2 * e));
    }
    function normal(x, z, o) {
      const e = 3;
      o = o || {};
      o.x = -(height(x + e, z) - height(x - e, z)) / (2 * e); o.y = 1; o.z = -(height(x, z + e) - height(x, z - e)) / (2 * e);
      return E.V3.normalize(o);
    }
    // segment line-of-sight against the height field (coarse march)
    function los(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.hypot(dx, dz), n = Math.min(12, Math.max(2, (d / 22) | 0));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        if (height(a.x + dx * t, a.z + dz * t) > a.y + dy * t + 0.3) return false;
      }
      return true;
    }
    // ray vs ground (march); returns distance or -1
    function raycast(o, d, maxD) {
      let t = 0, step = 3;
      for (let i = 0; i < 400 && t < maxD; i++) {
        const y = o.y + d.y * t, g = ground(o.x + d.x * t, o.z + d.z * t);
        if (y < g) { // refine
          let lo = Math.max(0, t - step), hi = t;
          for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (o.y + d.y * m < ground(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m; }
          return hi;
        }
        step = Math.max(2, (y - g) * 0.4); t += step;
      }
      return -1;
    }

    return { planet, biome: planet.biome, height, exact, cell, grid: { CS, GX0, GZ0, GW, GH }, ground, slope, normal, up: normal, los, raycast, craters, layout, waterLevel, basin };
  }

  E.makeTerrain = makeTerrain;
  E.battleLayout = battleLayout;
  E.ARENA = ARENA;
})(window.E = window.E || {});
