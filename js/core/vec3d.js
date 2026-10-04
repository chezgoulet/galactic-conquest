// Minimal 3D vector helpers operating on plain {x,y,z} objects. A mix of
// in-place (out) and allocate forms; the hot paths use the out form.
(function (E) {
  'use strict';
  const V3 = {
    X: { x: 1, y: 0, z: 0 }, Y: { x: 0, y: 1, z: 0 }, Z: { x: 0, y: 0, z: 1 },
    ZERO: { x: 0, y: 0, z: 0 }, UP: { x: 0, y: 1, z: 0 }, FORWARD: { x: 0, y: 0, z: -1 }, RIGHT: { x: 1, y: 0, z: 0 },
    make: (x = 0, y = 0, z = 0) => ({ x, y, z }),
    clone: (a) => ({ x: a.x, y: a.y, z: a.z }),
    set: (o, x, y, z) => { o.x = x; o.y = y; o.z = z; return o; },
    copy: (o, a) => { o.x = a.x; o.y = a.y; o.z = a.z; return o; },
    add: (a, b, o) => { o = o || {}; o.x = a.x + b.x; o.y = a.y + b.y; o.z = a.z + b.z; return o; },
    addTo: (a, b) => { a.x += b.x; a.y += b.y; a.z += b.z; return a; },
    sub: (a, b, o) => { o = o || {}; o.x = a.x - b.x; o.y = a.y - b.y; o.z = a.z - b.z; return o; },
    scale: (a, s, o) => { o = o || {}; o.x = a.x * s; o.y = a.y * s; o.z = a.z * s; return o; },
    mul: (a, s) => { a.x *= s; a.y *= s; a.z *= s; return a; },
    scaleAdd: (a, s, b, o) => { o = o || {}; o.x = a.x * s + b.x; o.y = a.y * s + b.y; o.z = a.z * s + b.z; return o; },
    addScaled: (a, s, b, o) => { o = o || {}; o.x = a.x + s.x * b; o.y = a.y + s.y * b; o.z = a.z + s.z * b; return o; },
    dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
    cross: (a, b, o) => { o = o || {}; const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x; o.x = x; o.y = y; o.z = z; return o; },
    len: (a) => Math.hypot(a.x, a.y, a.z),
    len2: (a) => a.x * a.x + a.y * a.y + a.z * a.z,
    distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
    distance2: (a, b) => { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; },
    normalize: (a, o) => { o = o || a; const l = Math.hypot(a.x, a.y, a.z) || 1; o.x = a.x / l; o.y = a.y / l; o.z = a.z / l; return o; },
    safeNorm: (a, o) => { o = o || a; const l = Math.hypot(a.x, a.y, a.z); if (l > 1e-9) { o.x = a.x / l; o.y = a.y / l; o.z = a.z / l; } else { o.x = 0; o.y = 0; o.z = 0; } return o; },
    lerp: (a, b, t, o) => { o = o || {}; o.x = a.x + (b.x - a.x) * t; o.y = a.y + (b.y - a.y) * t; o.z = a.z + (b.z - a.z) * t; return o; },
    negate: (a, o) => { o = o || {}; o.x = -a.x; o.y = -a.y; o.z = -a.z; return o; },
    angleTo: (a, b) => { const d = E.dot(E.normalize(a.clone()), E.normalize(b.clone())); return Math.acos(E.clamp(d, -1, 1)); },
    up: (a) => a.y > 0,
  };
  E.V3 = V3;
  E.vec3 = V3.make;
})(window.E = window.E || {});
