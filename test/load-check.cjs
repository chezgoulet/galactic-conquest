// Guard: the pure (browser-free) layers must load cleanly into Node. Fails the
// test run early if a data/sim file accidentally reaches for window or THREE.
'use strict';
const load = require('../tools/load.cjs');
const E = load(['js/core/util.js', 'js/core/rng.js', 'js/core/vec3d.js', 'js/core/events.js', 'js/core/loop.js']);
if (!E || !E.RNG || !E.V3 || !E.Emitter) throw new Error('core did not attach to E');
const r = E.RNG(1);
if (!(r.next() >= 0 && r.next() < 1)) throw new Error('rng range');
const a = E.V3.cross(E.V3.X, E.V3.Y);
if (Math.hypot(a.x - 0, a.y - 0, a.z - 1) > 1e-9) throw new Error('vec3 cross');
console.log('load-check ok (core loads headless)');
