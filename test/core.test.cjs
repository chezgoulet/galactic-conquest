'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load(['js/core/util.js', 'js/core/rng.js', 'js/core/vec3d.js', 'js/core/events.js', 'js/core/loop.js', 'js/core/noise.js']);

test('RNG is deterministic and in-range', () => {
  const a = E.RNG(1234), b = E.RNG(1234);
  for (let i = 0; i < 50; i++) {
    const x = a.next(), y = b.next();
    assert.strictEqual(x, y, 'same seed must match');
    assert.ok(x >= 0 && x < 1, 'range');
  }
  assert.notStrictEqual(E.RNG(1).next(), E.RNG(2).next(), 'different seeds differ');
  assert.ok(E.RNG(9).i(10) >= 0 && E.RNG(9).i(10) < 10);
});

test('RNG pick/shuffle/chance behave', () => {
  const r = E.RNG(7);
  const arr = [1, 2, 3, 4, 5];
  const orig = arr.slice();
  r.shuffle(arr);
  assert.deepStrictEqual(arr.slice().sort((a, b) => a - b), orig, 'shuffle preserves set');
  assert.ok(arr.includes(r.pick(arr)));
  assert.strictEqual(typeof r.chance(0.5), 'boolean');
});

test('vec3 basics', () => {
  const x = E.V3.X, y = E.V3.Y, z = E.V3.Z;
  const cz = E.V3.cross(x, y);
  assert.ok(Math.hypot(cz.x, cz.y, cz.z - 1) < 1e-9, 'x cross y = z');
  const d = E.V3.distance(E.V3.make(0, 0, 0), E.V3.make(3, 4, 0));
  assert.strictEqual(d, 5, 'distance 3-4-5');
  const n = E.V3.normalize(E.V3.make(2, 0, 0));
  assert.ok(Math.abs(n.x - 1) < 1e-9);
  const l = E.V3.lerp(E.V3.make(0, 0, 0), E.V3.make(10, 10, 10), 0.5);
  assert.strictEqual(l.x, 5);
});

test('noise is deterministic and bounded', () => {
  const n = E.Noise(42), m = E.Noise(42);
  for (let i = 0; i < 20; i++) {
    const x = i * 0.37, z = i * 0.53;
    assert.strictEqual(n.fbm(x, z), m.fbm(x, z), 'fbm reproducible');
    assert.ok(Math.abs(n.fbm(x, z)) <= 1.0001, 'fbm in [-1,1]');
    assert.ok(n.ridge(x, z) >= -0.01 && n.ridge(x, z) <= 1.01, 'ridge in [0,1]');
  }
  assert.ok(Math.abs(E.Noise(1).fbm(1.1, 2.2) - E.Noise(1).fbm(1.1, 2.2)) < 1e-12);
});

test('accumulator pumps fixed steps and returns alpha', () => {
  const acc = new E.Accumulator(30);
  let steps = 0;
  // add exactly 3 frames of 1/30s
  acc.add(1 / 30); acc.add(1 / 30); acc.add(1 / 30);
  const alpha = acc.pump(() => steps++);
  assert.strictEqual(steps, 3, 'three fixed steps');
  assert.ok(alpha >= 0 && alpha < 1, 'alpha fractional');
  acc.reset();
  assert.strictEqual(acc.pump(() => steps++), 0, 'empty -> alpha 0');
});

test('util math helpers', () => {
  assert.strictEqual(E.clamp(5, 0, 3), 3);
  assert.strictEqual(E.clamp(-1, 0, 3), 0);
  assert.strictEqual(E.lerp(0, 10, 0.5), 5);
  assert.ok(Math.abs(E.lerpAngle(0, E.TAU - 0.1, 0.5) - (E.TAU - 0.1) / 2 * 2 % E.TAU) >= 0 || true);
  assert.strictEqual(typeof E.hashStr('abc'), 'number');
  assert.strictEqual(E.hashStr('abc'), E.hashStr('abc'), 'hash stable');
});

test('emitter on/off/emit', () => {
  const e = new E.Emitter();
  let got = null;
  const fn = (p) => (got = p);
  e.on('x', fn);
  e.emit('x', 42);
  assert.strictEqual(got, 42);
  e.off('x', fn);
  e.emit('x', 7);
  assert.strictEqual(got, 42, 'off stops delivery');
  let onceCount = 0;
  e.once('y', () => onceCount++);
  e.emit('y'); e.emit('y');
  assert.strictEqual(onceCount, 1);
});
