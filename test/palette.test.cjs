'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load(load.files(['core']));

test('palette: default colours, then a colour-blind swap in place', () => {
  assert.strictEqual(E.Palette.col.aegis, '#ff6a3a', 'default aegis');
  assert.ok(E.Palette.names.includes('colorblind') && E.Palette.names.includes('default'));
  E.Palette.apply('colorblind');
  assert.strictEqual(E.Palette.col.aegis, E.Palette.palettes.colorblind.aegis, 'aegis swapped');
  assert.notStrictEqual(E.Palette.col.aegis, E.Palette.col.verdant, 'teams stay distinct');
  E.Palette.apply('default');
  assert.strictEqual(E.Palette.col.aegis, '#ff6a3a', 'back to default');
});
