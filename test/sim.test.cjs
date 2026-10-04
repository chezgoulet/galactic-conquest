'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load([
  'js/core/util.js', 'js/core/rng.js', 'js/core/vec3d.js', 'js/core/events.js', 'js/core/loop.js', 'js/core/noise.js',
  'js/data/factions.js', 'js/data/biomes.js', 'js/data/units.js',
  'js/sim/terrain.js', 'js/sim/sim.js', 'js/sim/world.js',
]);

const HZ = 30, DT = 1 / HZ;

function run(seed, frames) {
  const w = new E.World({ biome: 'tundra', seed, scale: 1, human: 'aegis' });
  const startCount = w.units.length;
  for (let i = 0; i < frames; i++) w.tick(DT);
  return { w, startCount };
}

test('world builds a full force and objectives', () => {
  const w = new E.World({ biome: 'desert', seed: 42 });
  assert.ok(w.units.length >= 20, 'has units');
  assert.ok(w.objectives.length >= 6, 'has objectives');
  const hq = w.objectives.filter(o => o.role === 'hq');
  assert.strictEqual(hq.length, 2, 'two HQs');
  assert.ok(w.units.some(u => u.kind === 'capital'), 'has a capital ship');
  assert.ok(w.units.some(u => u.kind === 'fighter'), 'has fighters');
  assert.ok(w.units.some(u => u.kind === 'vehicle'), 'has vehicles');
});

test('sim is deterministic (same seed -> same outcomes)', () => {
  const a = run(99, 600);
  const b = run(99, 600);
  const snap = (w) => w.units.map(u => [u.id, u.alive ? 1 : 0, Math.round(u.pos.x), Math.round(u.pos.z), Math.round(u.hp)]).join('|');
  assert.strictEqual(snap(a.w), snap(b.w), 'identical unit positions/health after 600 frames');
});

test('combat occurs and units take damage / die', () => {
  const w = new E.World({ biome: 'jungle', seed: 7, human: 'aegis' });
  // run 70 seconds (forces meet mid-map and fight)
  for (let i = 0; i < HZ * 70; i++) w.tick(DT);
  const aegisDead = w.units.filter(u => u.team === 'aegis' && !u.alive).length;
  const verdantDead = w.units.filter(u => u.team === 'verdant' && !u.alive).length;
  const anyDead = aegisDead + verdantDead;
  assert.ok(anyDead > 0, `expected combat kills, got ${anyDead}`);
  assert.ok(w.stats.kills.aegis + w.stats.kills.verdant > 0, 'kill stats recorded');
});

test('objectives can be captured and tracked', () => {
  const w = new E.World({ biome: 'tundra', seed: 3, human: 'aegis' });
  const before = w.objectives.map(o => o.owner).join(',');
  for (let i = 0; i < HZ * 60; i++) w.tick(DT);
  const captured = w.objectives.filter(o => o.owner && o.progress >= 1).length;
  assert.ok(captured > 0, `objectives captured: ${captured}`);
  assert.strictEqual(w.winner === null || typeof w.winner === 'string', true);
});

test('win condition: capturing enemy HQ ends the match', () => {
  // Force a win: teleport aegis units onto the verdant HQ and hold.
  const w = new E.World({ biome: 'desert', seed: 5, human: 'aegis' });
  const enemyHQ = w.objectives.find(o => o.role === 'hq' && o.owner === 'verdant');
  assert.ok(enemyHQ, 'enemy HQ exists');
  // spawn a big aegis force right on top of the enemy HQ
  for (let i = 0; i < 20; i++) w.unit('infantry', 'aegis', 'rifle', 'rifle', { x: enemyHQ.pos.x + (i % 3) - 1, z: enemyHQ.pos.z + ((i / 3) | 0) });
  for (let i = 0; i < HZ * 20; i++) w.tick(DT);
  assert.strictEqual(w.winner, 'aegis', 'aegis wins by destroying/capturing enemy HQ, got ' + w.winner);
});

test('intensity signal tracks combat (0..1)', () => {
  const w = new E.World({ biome: 'tundra', seed: 11 });
  let inRange = true;
  for (let i = 0; i < HZ * 10; i++) { w.tick(DT); inRange = inRange && (w.intensity >= 0 && w.intensity <= 1); }
  assert.ok(inRange, 'intensity stays in [0,1]');
});
