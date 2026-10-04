'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load(['js/core/util.js', 'js/core/rng.js', 'js/data/factions.js', 'js/data/biomes.js', 'js/data/units.js', 'js/data/galaxy.js']);

test('campaign builds a valid 10-system galaxy', () => {
  const c = E.Campaign.newCampaign({ seed: 7, playerFaction: 'aegis' });
  assert.strictEqual(c.planets.length, 10, 'ten worlds');
  assert.ok(c.links.length >= 8, 'hyperlanes present');
  assert.strictEqual(c.planets[0].home, 'aegis', 'player home');
  assert.strictEqual(c.planets[9].home, 'verdant', 'enemy home');
  assert.strictEqual(c.planets[0].owner, 'aegis');
  assert.strictEqual(c.planets[9].owner, 'verdant');
  assert.strictEqual(c.victory, null);
  for (const p of c.planets) assert.ok(E.biome(p.biome), 'valid biome: ' + p.biome);
  // the frontier the player can assault: unclaimed worlds adjacent to player territory
  const atk = E.Campaign.attackable(c);
  assert.ok(atk.length > 0, 'player has a frontier to attack');
  for (const id of atk) assert.strictEqual(c.planets[id].owner, null, 'frontier worlds start unclaimed');
});

test('campaign is deterministic per seed', () => {
  const a = E.Campaign.newCampaign({ seed: 42 });
  const b = E.Campaign.newCampaign({ seed: 42 });
  assert.deepStrictEqual(a.planets.map(p => p.biome), b.planets.map(p => p.biome));
  assert.deepStrictEqual(a.links, b.links);
  assert.strictEqual(a.planets[0].name, b.planets[0].name);
});

test('winning a frontier assault captures the world and pays credits', () => {
  const c = E.Campaign.newCampaign({ seed: 3, playerFaction: 'aegis' });
  const id = E.Campaign.attackable(c)[0];
  const before = c.credits.aegis;
  const res = E.Campaign.applyBattle(c, id, true, 100, false);
  assert.strictEqual(c.planets[id].owner, 'aegis', 'world captured');
  assert.ok(c.credits.aegis > before, 'credits grew');
  assert.strictEqual(res.won, true);
  assert.strictEqual(c.battles, 1);
});

test('losing an assault leaves the world unclaimed', () => {
  const c = E.Campaign.newCampaign({ seed: 3, playerFaction: 'aegis' });
  const id = E.Campaign.attackable(c)[0];
  E.Campaign.applyBattle(c, id, false, 0, false);
  assert.strictEqual(c.planets[id].owner, null, 'still unclaimed after a failed assault');
});

test('losing a defense surrenders the world', () => {
  const c = E.Campaign.newCampaign({ seed: 3, playerFaction: 'aegis' });
  const owned = c.planets.filter(p => p.owner === 'aegis' && !p.home)[0];
  const res = E.Campaign.applyBattle(c, owned.id, false, 0, true);
  assert.strictEqual(c.planets[owned.id].owner, 'verdant', 'world lost in defense');
  assert.strictEqual(res.defending, true);
});

test('capturing the enemy home system wins the war', () => {
  const c = E.Campaign.newCampaign({ seed: 5, playerFaction: 'aegis' });
  assert.strictEqual(c.victory, null);
  E.Campaign.applyBattle(c, 9, true, 0, false);
  assert.strictEqual(c.victory, 'aegis', 'capturing the enemy home wins');
});

test('matchOptions give a valid biome, seed and fleet scale', () => {
  const c = E.Campaign.newCampaign({ seed: 11 });
  const id = E.Campaign.attackable(c)[0];
  const o = E.Campaign.matchOptions(c, id);
  assert.ok(E.biome(o.biome), 'valid biome');
  assert.ok(Number.isInteger(o.seed) && o.seed >= 0);
  assert.ok(o.fleetScale >= 1);
  assert.strictEqual(o.human, c.playerFaction);
  assert.ok(o.enemyScale >= 0.5);
  assert.ok(o.bonus && o.bonus[c.playerFaction], 'bonus table present');
});

test('quickBattle returns a valid match', () => {
  const o = E.Campaign.quickBattle({ seed: 99 });
  assert.ok(E.biome(o.biome));
  assert.ok(o.human === 'aegis' || o.human === 'verdant');
  assert.ok(o.fleetScale >= 1);
});

test('upgrades raise fleet scale and are bounded', () => {
  const c = E.Campaign.newCampaign({ seed: 2, playerFaction: 'aegis' });
  const base = E.Campaign.fleetScale(c, 'aegis');
  assert.ok(!E.Campaign.buy(c, 'fleet'), 'cannot buy before the credits are in');
  c.credits.aegis += 400;
  assert.ok(E.Campaign.buy(c, 'fleet'), 'bought the flagship upgrade');
  assert.ok(E.Campaign.fleetScale(c, 'aegis') > base, 'fleet scaled up');
});

test('career ranks map from lifetime score', () => {
  assert.strictEqual(E.Campaign.rank(0).name, 'Recruit');
  assert.strictEqual(E.Campaign.rank(350000).name, 'Grand Admiral');
});
