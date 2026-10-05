'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load([...load.files(['core', 'data']), ...load.files(['sim'])]);

test('battle modes: ticket pools, bleed rules and fallback', () => {
  assert.ok(E.MODE_LIST.length >= 3, 'several modes');
  const base = new E.World({ biome: 'desert', seed: 3, human: 'aegis' });
  const blitz = new E.World({ biome: 'desert', seed: 3, human: 'aegis', mode: 'blitz' });
  const ann = new E.World({ biome: 'desert', seed: 3, human: 'aegis', mode: 'annihilation' });
  assert.strictEqual(base.mode, 'conquest', 'default mode');
  assert.strictEqual(blitz.mode, 'blitz');
  assert.ok(blitz.teams.aegis.startTickets < base.teams.aegis.startTickets, 'blitz has fewer tickets');
  assert.strictEqual(ann.cfg.bleed, false, 'annihilation turns bleed off');
  assert.strictEqual(new E.World({ biome: 'desert', seed: 1, human: 'aegis', mode: 'nonsense' }).mode, 'conquest', 'unknown mode falls back');

  // holding a 3-post lead bleeds the loser — faster in blitz, never in annihilation
  const mk = (mode) => { const w = new E.World({ biome: 'desert', seed: 5, human: 'aegis', mode }); w.teams.aegis.cps = 4; w.teams.verdant.cps = 1; return w; };
  const c = mk('conquest'), vc = c.teams.verdant.tickets;
  E.SIM.bleedAndWin(c, 1.2);
  assert.strictEqual(c.teams.verdant.tickets, vc, 'conquest does not bleed in 1.2s');
  const b = mk('blitz'), vb = b.teams.verdant.tickets;
  E.SIM.bleedAndWin(b, 1.2);
  assert.strictEqual(b.teams.verdant.tickets, vb - 1, 'blitz bleeds twice as fast');
  const n = mk('annihilation'), vn = n.teams.verdant.tickets;
  E.SIM.bleedAndWin(n, 100);
  assert.strictEqual(n.teams.verdant.tickets, vn, 'annihilation never bleeds');
});
