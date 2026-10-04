'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load(['js/core/util.js', 'js/core/rng.js', 'js/data/factions.js', 'js/data/biomes.js', 'js/data/units.js', 'js/data/galaxy.js']);

test('campaign builds a valid system strip', () => {
  const c = E.Campaign.newCampaign({ seed: 7, playerFaction: 'aegis', length: 5 });
  assert.strictEqual(c.systems.length, 7, '2 homes + 5 contested');
  assert.strictEqual(c.systems[0].owner, 'aegis');
  assert.strictEqual(c.systems[c.systems.length - 1].owner, 'verdant');
  assert.strictEqual(c.frontIndex, 1);
  const front = E.Campaign.frontSystem(c);
  assert.ok(!front.owner, 'front starts contested');
  // biomes are valid
  for (const s of c.systems) assert.ok(E.biome(s.biome), 'valid biome: ' + s.biome);
});

test('campaign is deterministic per seed', () => {
  const a = E.Campaign.newCampaign({ seed: 42 });
  const b = E.Campaign.newCampaign({ seed: 42 });
  assert.deepStrictEqual(a.systems.map(s => s.biome), b.systems.map(s => s.biome));
});

test('winning the front advances and grants resources', () => {
  const c = E.Campaign.newCampaign({ seed: 3, length: 3 });
  const r0 = E.Campaign.frontIndex;
  const res = E.Campaign.applyResult(c, true);
  assert.ok(res.changed);
  assert.strictEqual(c.frontIndex, 2, 'front advanced');
  assert.ok(c.resources > 100, 'resources grew');
  assert.ok(c.systems[1].owner === 'aegis', 'captured system owned by player');
});

test('losing does not advance the front', () => {
  const c = E.Campaign.newCampaign({ seed: 3, length: 3 });
  E.Campaign.applyResult(c, false);
  assert.strictEqual(c.frontIndex, 1, 'front unchanged after loss');
});

test('capturing all fronts wins the war', () => {
  const c = E.Campaign.newCampaign({ seed: 5, length: 2 });
  E.Campaign.applyResult(c, true);
  assert.ok(!c.victory, 'not won yet');
  E.Campaign.applyResult(c, true);
  assert.strictEqual(c.victory, 'aegis', 'won the war after taking the last front');
});

test('matchOptions give a valid biome + seed + fleet scale', () => {
  const c = E.Campaign.newCampaign({ seed: 11 });
  const o = E.Campaign.matchOptions(c);
  assert.ok(E.biome(o.biome), 'valid biome');
  assert.ok(Number.isInteger(o.seed) && o.seed >= 0);
  assert.ok(o.fleetScale >= 1);
  assert.strictEqual(o.human, 'aegis');
});

test('quickBattle returns a valid match', () => {
  const o = E.Campaign.quickBattle({ seed: 99 });
  assert.ok(E.biome(o.biome));
  assert.ok(o.human === 'aegis' || o.human === 'verdant');
  assert.ok(o.fleetScale >= 1);
});
