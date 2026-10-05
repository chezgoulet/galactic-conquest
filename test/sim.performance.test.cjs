'use strict';
// A coarse but stable regression tripwire for simulation cost. The headless GPU
// perf harness (tools/perf.cjs) is for real hardware; this guards the pure sim
// in CI. The budget is deliberately loose (many test files run in parallel), so
// it catches a real blow-up, not run-to-run noise.
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load([...load.files(['core', 'data']), ...load.files(['sim'])]);

test('sim performance: a full armada battle stays within the tick budget', () => {
  const w = new E.World({ biome: 'desert', seed: 7, human: 'aegis', fleetScale: 1.8, enemyScale: 1.8 });
  for (let i = 0; i < 40; i++) w.tick(1 / 30);            // warm up: spawns + first contacts
  let max = 0; const N = 400;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    const a = process.hrtime.bigint();
    w.tick(1 / 30);
    const ms = Number(process.hrtime.bigint() - a) / 1e6;
    if (ms > max) max = ms;
  }
  const avg = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  assert.ok(Number.isFinite(avg) && avg > 0, 'measured a real average tick');
  assert.ok(avg < 12, `average sim tick ${avg.toFixed(2)} ms should stay under 12 ms`);
  assert.ok(max < 250, `worst single tick ${max.toFixed(0)} ms should stay under 250 ms`);
});
