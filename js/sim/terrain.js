// Pure terrain height field. Both the sim (ground units stand here) and the
// renderer (builds the mesh here) read from this, so ground height is always
// consistent and deterministic for a given (biome, seed). No three.js.
(function (E) {
  'use strict';

  // Build a height sampler for a planet (from E.makePlanet).
  // Returns { height(x,z), slope(x,z), biome, planet, craters }.
  function makeTerrain(planet) {
    const b = planet.biomeDef;
    const amp = b.amp || {};
    const seed = planet.seed;
    const r = E.RNG(seed);
    const n = E.Noise(seed);
    const n2 = E.Noise(seed ^ 0x9e3779b9);
    const H = 90; // base feature height in meters
    const s = 4 / (planet.radius); // world->noise scale, features scale with planet

    // Craters / vents (deterministic). Depth and size per crater.
    const craters = [];
    const nc = (b.cover && b.cover.rocks ? 1 : 0) + ((amp.craters || 0) > 0 ? Math.round(6 + (amp.craters || 0) * 20) : 0) + ((b.cover && b.cover.vents) ? Math.round(8 * b.cover.vents) : 0);
    for (let i = 0; i < nc; i++) {
      const a = r.angle(), d = r.f(80, planet.radius * 0.4);
      craters.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, rad: r.f(18, 90), depth: r.f(6, 40) * (amp.craters || 0.5 + 0.5) });
    }

    // Gas-giant banding (a slow sinusoid for the band backdrop).
    const bands = b.amp && b.amp.bands ? b.amp.bands : 0;

    function height(x, z) {
      const u = x * s, v = z * s;
      let h = 0;
      h += n.fbm(u, v, 5) * (amp.low || 0.4) * H;
      h += n2.fbm(u * 2.6 + 11, v * 2.6 + 7, 4) * (amp.mid || 0.5) * H * 0.6;
      h += n.ridge(u * 5.5 + 3, v * 5.5 + 3, 4) * (amp.high || 0.8) * H * 0.35;
      h += (n.warp(u * 1.3, v * 1.3, 3) - 0.5) * (amp.rough || 0.4) * H * 0.3;
      // craters carve down (rim up is implicit from the gaussian edge)
      for (let i = 0; i < craters.length; i++) {
        const c = craters[i];
        const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
        if (d < c.rad * 2.2) h -= c.depth * Math.exp(-(d * d) / (c.rad * c.rad * 1.6));
      }
      // gas bands: slow horizontal stripes
      if (bands) h += Math.sin(v * 0.18 + Math.sin(u * 0.05) * 1.5) * bands * H * 0.5;
      return h;
    }

    function slope(x, z) {
      const e = 6;
      const hx = (height(x + e, z) - height(x - e, z)) / (2 * e);
      const hz = (height(x, z + e) - height(x, z - e)) / (2 * e);
      return Math.hypot(hx, hz);
    }

    return {
      planet, biome: planet.biome, height, slope, craters,
      // sample the surface normal-ish up vector (approx from two partials)
      up: (x, z) => {
        const e = 8;
        const hx = (height(x + e, z) - height(x - e, z)) / (2 * e);
        const hz = (height(x, z + e) - height(x, z - e)) / (2 * e);
        const v = E.V3.make(-hx, 1, -hz);
        return E.V3.normalize(v, E.V3.make(0, 1, 0));
      },
    };
  }

  E.makeTerrain = makeTerrain;
})(window.E = window.E || {});
