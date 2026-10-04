'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load([
  'js/core/util.js', 'js/core/rng.js', 'js/core/vec3d.js', 'js/core/events.js', 'js/core/loop.js', 'js/core/noise.js',
  'js/data/factions.js', 'js/data/biomes.js', 'js/data/units.js',
  ...load.files(['sim']),
]);

const HZ = 30, DT = 1 / HZ;

test('world builds a full order of battle and command posts', () => {
  const w = new E.World({ biome: 'desert', seed: 42 });
  assert.ok(w.units.length >= 20, 'has units');
  assert.strictEqual(w.cps.length, 5, 'five command posts');
  assert.strictEqual(w.cps.filter(c => c.home).length, 2, 'two HQ posts');
  const have = (k) => w.units.some(u => u.kind === k);
  assert.ok(have('infantry'), 'has infantry');
  assert.ok(have('vehicle'), 'has vehicles');
  assert.ok(have('fighter'), 'has fighters');
  assert.ok(have('capital'), 'has capital ships');
  assert.strictEqual(w.human, 'aegis', 'default human faction');
  assert.ok(w.teams.aegis && w.teams.verdant, 'both teams present');
  assert.ok(w.teams.aegis.tickets > 0, 'has reinforcement tickets');
});

test('sim is deterministic (same seed -> same outcomes)', () => {
  const mk = (seed) => {
    const w = new E.World({ biome: 'jungle', seed, scale: 1, human: 'aegis' });
    for (let i = 0; i < HZ * 20; i++) w.tick(DT);
    return w;
  };
  const snap = (w) => w.units.map(u => [u.id, u.alive ? 1 : 0, Math.round(u.pos.x), Math.round(u.pos.z), Math.round(u.hp)]).join('|');
  assert.strictEqual(snap(mk(99)), snap(mk(99)), 'identical unit positions/health after 20s');
});

test('combat occurs and kills are recorded', () => {
  const w = new E.World({ biome: 'jungle', seed: 7, human: 'aegis' });
  for (let i = 0; i < HZ * 70; i++) w.tick(DT);
  assert.ok(w.teams.aegis.kills + w.teams.verdant.kills > 0, 'both sides traded kills');
});

test('command posts are captured and tracked', () => {
  const w = new E.World({ biome: 'tundra', seed: 3, human: 'aegis' });
  for (let i = 0; i < HZ * 60; i++) w.tick(DT);
  const contested = w.cps.filter(c => Math.abs(c.cap) > 0.01).length;
  const owned = w.cps.filter(c => c.owner).length;
  assert.ok(owned > 0, `posts owned: ${owned}`);
  assert.ok(contested + owned >= 2, 'posts are being fought over');
  assert.ok(w.winner === null || typeof w.winner === 'string');
});

test('wiping a side that holds no posts ends the match', () => {
  const w = new E.World({ biome: 'desert', seed: 5, human: 'aegis' });
  for (const c of w.cps) c.owner = 'aegis';              // aegis holds the board
  for (const u of w.units) if (u.team === 'verdant' && (u.kind === 'infantry' || u.kind === 'vehicle')) u.alive = false;
  for (let i = 0; i < HZ * 3; i++) w.tick(DT);
  assert.strictEqual(w.winner, 'aegis', 'aegis wins when verdant is wiped with no posts');
});

test('player verbs: spawn, possess, deploy, order', () => {
  const w = new E.World({ biome: 'tundra', seed: 11, human: 'aegis' });
  const u = E.SIM.spawnUnit(w, 'infantry', 'trooper', 'aegis', { x: 0, z: 0 });
  w.addPlayer('p1', 'aegis', 'Cmd');
  assert.ok(E.SIM.possess(w, 'p1', u.id), 'possess works');
  assert.strictEqual(w.unitOf('p1').id, u.id, 'unitOf reflects possession');
  E.SIM.release(w, 'p1');
  const home = w.cps.find(c => c.home === 'aegis');
  const d = E.SIM.deploy(w, 'p1', 'trooper', home.id);
  assert.ok(d && d.kind === 'infantry', 'deploys an infantry unit');
  assert.strictEqual(w.unitOf('p1').id, d.id, 'auto-possesses the deployed unit');
  const ids = [u.id];
  E.SIM.order(w, 'p1', ids, 'hold');
  assert.ok(u.order && u.order.type === 'hold', 'order applied');
});

test('intensity signal tracks combat (0..1)', () => {
  const w = new E.World({ biome: 'tundra', seed: 11 });
  let inRange = true;
  for (let i = 0; i < HZ * 10; i++) { w.tick(DT); inRange = inRange && (w.intensity >= 0 && w.intensity <= 1); }
  assert.ok(inRange, 'intensity stays in [0,1]');
});
