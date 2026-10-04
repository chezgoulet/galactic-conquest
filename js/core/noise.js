// Deterministic value / fBm noise on a 2D grid, seedable per world. Terrain and
// star placement draw from this so a given (biome, seed) always yields the same
// planet. No external noise library — it is all hash + smoothstep.
(function (E) {
  'use strict';
  function hash2(ix, iz, seed) {
    let n = ix * 374761393 + iz * 668265263 + seed * 974634561;
    n = (n ^ (n >>> 13)) >>> 0;
    n = Math.imul(n, 1274126177) >>> 0;
    n = (n ^ (n >>> 16)) >>> 0;
    return (n & 0xffff) / 0xffff; // [0,1)
  }
  const smooth = (t) => t * t * (3 - 2 * t);

  // Factory: E.Noise(seed) -> { n2, fbm, ridge, warp }. Deterministic per seed.
  function Noise(seed) {
    seed = (seed >>> 0) || 1;
    const self = { seed, n2: null, fbm: null, ridge: null, warp: null };
    self.n2 = (x, z) => {
      const ix = Math.floor(x), iz = Math.floor(z);
      const fx = x - ix, fz = z - iz;
      const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
      const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
      const u = smooth(fx), v = smooth(fz);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    self.fbm = (x, z, oct = 5, lac = 2, gain = 0.5) => {
      let amp = 1, freq = 1, sum = 0, norm = 0;
      for (let i = 0; i < oct; i++) {
        sum += (self.n2(x * freq, z * freq) * 2 - 1) * amp;
        norm += amp; amp *= gain; freq *= lac;
      }
      return sum / (norm || 1);
    };
    self.ridge = (x, z, oct = 5) => {
      let amp = 0.5, freq = 1, sum = 0;
      for (let i = 0; i < oct; i++) {
        const v = Math.abs(self.fbm(x * freq, z * freq, 2));
        sum += (1 - Math.abs(2 * v - 1)) * amp;
        amp *= 0.5; freq *= 2.1;
      }
      return E.clamp01(sum);
    };
    self.warp = (x, z, oct) => {
      const wx = self.fbm(x + 12.3, z + 4.5, 3), wz = self.fbm(x - 7.1, z + 9.2, 3);
      return self.fbm(x + wx * 0.8, z + wz * 0.8, oct);
    };
    return self;
  }
  E.Noise = Noise;
  E.hash2 = hash2;
})(window.E = window.E || {});
