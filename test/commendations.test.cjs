'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load([...load.files(['core', 'data'])]);

test('commendations: earned from a battle result by threshold', () => {
  assert.strictEqual(E.Commendations.evaluate({}).length, 0, 'a blank result earns nothing');
  const ids = E.Commendations.evaluate({ won: true, kills: 25, captures: 4, best: 12, deaths: 0, time: 300 }).map((m) => m.id);
  for (const id of ['veteran', 'sharpshooter', 'standard', 'unstoppable', 'flawless', 'blitz']) assert.ok(ids.includes(id), 'earns ' + id);
  assert.ok(!ids.includes('martyr'), 'flawless does not earn the death medal');
  assert.ok(E.Commendations.evaluate({ won: true, deaths: 10 }).map((m) => m.id).includes('martyr'));
  assert.strictEqual(E.Commendations.count({ medals: { veteran: 3, blitz: 1 } }), 4, 'career medal count');
  assert.strictEqual(E.Commendations.count(null), 0);
});
