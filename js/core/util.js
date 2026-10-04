// Global namespace + shared math utilities. The first script the game loads.
// Every other script does (function (E) { ... })(window.E = window.E || {}).
(function (E) {
  'use strict';
  if (!E || Object.keys(E).length) { /* already booted */ }
  E.GC = E.GC || {};
  E.TAU = Math.PI * 2;
  E.PI = Math.PI;
  E.DEG = Math.PI / 180;
  E.EPS = 1e-6;

  E.clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  E.clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
  E.lerp = (a, b, t) => a + (b - a) * t;
  E.invLerp = (a, b, x) => (b === a ? 0 : (x - a) / (b - a));
  E.remap = (x, a, b, c, d) => c + (d - c) * E.invLerp(a, b, x);
  E.smooth = t => { t = E.clamp01(t); return t * t * (3 - 2 * t); };
  E.smoothstep = (e0, e1, x) => E.smooth(E.invLerp(e0, e1, x));
  E.lerpAngle = (a, b, t) => {
    let d = (b - a) % E.TAU; if (d > Math.PI) d -= E.TAU; if (d < -Math.PI) d += E.TAU;
    return a + d * t;
  };
  E.approach = (x, target, amt) => x < target ? Math.min(x + amt, target) : Math.max(x - amt, target);

  E.dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return Math.hypot(dx, dy); };
  E.dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  E.dist2v = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y; return dx * dx + dy * dy; };
  // horizontal (x,z) distances — the ground plane. y is altitude.
  E.distXZ = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
  E.distXZ2 = (a, b) => { const dx = b.x - a.x, dz = b.z - a.z; return dx * dx + dz * dz; };
  E.len = (x, y) => Math.hypot(x, y);

  E.deepCopy = (o) => {
    if (o === null || typeof o !== 'object') return o;
    if (Array.isArray(o)) return o.map(E.deepCopy);
    if (o instanceof Map) return new Map([...o.entries()].map(([k, v]) => [k, E.deepCopy(v)]));
    if (o instanceof Set) return new Set([...o].map(E.deepCopy));
    const r = {}; for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = E.deepCopy(o[k]);
    return r;
  };

  // FNV-1a 32-bit string hash -> unsigned int. Stable across engines.
  E.hashStr = (s) => {
    s = String(s); let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  };
  E.mix = (a, b, t) => a + (b - a) * t;
  E.mixC = (a, b, t) => { // mix two rgb [r,g,b] arrays -> new
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  E.hsl2rgb = (h, s, l) => {
    h = ((h % 1) + 1) % 1;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  };
  E.rgbStr = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  E.rgbaStr = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  // hex string -> [r,g,b] 0-255 (shared by content + renderer)
  E.rgb = (hex) => { const n = parseInt(String(hex).slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

  E.fmtTime = (s) => { s = Math.max(0, s | 0); const m = (s / 60) | 0; return m + ':' + String(s % 60).padStart(2, '0'); };
  E.fmtN = (n) => (Math.round(n * 10) / 10).toLocaleString();
  E.letter = (n, l) => String.fromCharCode(65 + (n % 26)) + (n >= 26 ? (n / 26 | 0) : '');
  E.id = (p) => p.reduce((s, v) => (s * 31 + v) | 0, 5381) >>> 0;
  // three.js is loaded as a global by <script src="vendor/three.min.js"> before
  // this bundle; expose it on E so the render layer can use E.THREE.
  E.THREE = (typeof THREE !== 'undefined') ? THREE : (typeof window !== 'undefined' ? window.THREE : null);

  // small object pool helper
  E.Pool = function (make, cap) {
    const free = []; const max = cap || 64;
    return {
      get: () => (free.length ? free.pop() : make()),
      put: (o) => { if (free.length < max) free.push(o); },
      len: () => free.length,
    };
  };
})(window.E = window.E || {});
