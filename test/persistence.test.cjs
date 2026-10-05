'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');

const store = (() => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; })();
const E = load(load.files(['core']), { localStorage: store });

test('rng: saved stream state resumes bit-for-bit', () => {
  const a = E.RNG(12345); for (let i = 0; i < 7; i++) a.next();
  const s = a.state;
  const b = E.RNG(1).set(s), c = E.RNG(999).set(s);
  const fromA = a.next(), fromB = b.next(), fromC = c.next();
  assert.strictEqual(fromA, fromB, 'restored stream matches the original');
  assert.strictEqual(fromB, fromC, 'two restores agree');
  assert.strictEqual(a.state, c.state, 'stream state tracks identically');
});

test('save envelope: settings, profile, campaign and history round-trip', () => {
  store.clear();
  store.setItem('gc.settings.v2', JSON.stringify({ palette: 'colorblind', uiScale: 1.2 }));
  store.setItem('gc.profile.v1', JSON.stringify({ xp: 123, battles: 4, wins: 2, kills: 55 }));
  store.setItem('gc.campaign.v2', JSON.stringify({ v: 3, turn: 5, seed: 42 }));
  const str = E.Save.exportString();
  store.clear();
  assert.strictEqual(store.getItem('gc.profile.v1'), null, 'cleared before import');
  const data = E.Save.importString(str);
  assert.strictEqual(data.profile.xp, 123);
  assert.strictEqual(data.campaign.turn, 5);
  assert.deepStrictEqual(JSON.parse(store.getItem('gc.settings.v2')), { palette: 'colorblind', uiScale: 1.2 }, 'settings written back');
  assert.strictEqual(JSON.parse(store.getItem('gc.camp.hist.v1')), null, 'absent keys stay absent');
});

test('save envelope: rejects foreign, malformed and newer files', () => {
  assert.throws(() => E.Save.parse('not json'), /valid JSON/);
  assert.throws(() => E.Save.parse(JSON.stringify({ app: 'other', version: 1 })), /not a Galactic Conquest save/);
  assert.throws(() => E.Save.parse(JSON.stringify({ app: 'galactic-conquest', version: 999, data: {} })), /newer version/);
  const keys = Object.keys(E.Save.parse(E.Save.exportString())).sort();
  assert.deepStrictEqual(keys, ['campaign', 'history', 'profile', 'settings'], 'its own output parses');
});
