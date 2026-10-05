// Deterministic, seedable RNG. The simulation must never touch Math.random; it
// draws from a world RNG so a match is fully reproducible from (config, seed,
// command stream). mulberry32 is fast, well-distributed and bit-identical
// across engines, which is what a deterministic host-authoritative sim needs.
(function (E) {
  'use strict';

  function mulberry32(a) {
    const fn = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // live stream state, so a match can be saved and resumed bit-for-bit
    fn.getState = () => a >>> 0;
    fn.setState = (v) => { a = v >>> 0; };
    return fn;
  }

  // Factory: E.RNG(seed) -> deterministic RNG. No `new`; matches E.RNG(seed)
  // call sites everywhere in the codebase. `state`/`set` read and restore the
  // exact stream position (not just the original seed).
  function RNG(seed) {
    let s = seed >>> 0;
    const f = mulberry32(s);
    return {
      get state() { return f.getState(); },
      set(seed) { s = seed >>> 0; f.setState(s); return this; },
      next: () => f(),                       // [0,1)
      f: (a, b) => a + (b - a) * f(),
      i: (n) => (f() * n) | 0,               // [0,n)
      i2: (a, b) => a + ((f() * (b - a + 1)) | 0), // [a,b]
      pick: (arr) => arr[((f() * arr.length) | 0)],
      pickW: (pairs) => {
        let tot = 0; for (const [, w] of pairs) tot += w;
        let x = f() * tot; for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; }
        return pairs[0][0];
      },
      sign: () => (f() < 0.5 ? -1 : 1),
      angle: () => f() * E.TAU,
      gauss: () => {
        let u = 0, v = 0; while (u === 0) u = f(); while (v === 0) v = f();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(E.TAU * v);
      },
      shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = ((f() * (i + 1)) | 0); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; },
      chance: (p) => f() < p,
    };
  }

  E.RNG = RNG;
  E.mulberry32 = mulberry32;
  // derive a uint seed from a string (for named biomes, faction motifs, etc.)
  E.seedFrom = (str) => E.hashStr(str);
})(window.E = window.E || {});
