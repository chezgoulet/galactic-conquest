'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load(load.files(['core']));

const B = (pressed, value) => ({ pressed: !!pressed, value });

test('pad: sticks, triggers and one-shot button edges', () => {
  const buttons = [];
  buttons[7] = B(true, 0.9);   // RT fire
  buttons[0] = B(true);        // A jump
  buttons[15] = B(true);       // d-pad right
  const s = E.Pad.mapPad([0.5, 0.9, 0, -0.6], buttons, []);
  assert.ok(s.moveX > 0.3, 'left stick x');
  assert.ok(s.moveY < -0.3, 'left stick y inverted (up is forward)');
  assert.ok(s.lookY < 0, 'right stick y');
  assert.ok(s.fire, 'RT fires');
  assert.ok(s.jump, 'A jumps');
  assert.ok(s.pressed.a, 'A edge fires once');
  assert.ok(s.pressed.dright, 'd-pad right edge');

  const prev = []; prev[0] = true; prev[7] = true; prev[15] = true;
  const held = E.Pad.mapPad([0.5, 0.9, 0, -0.6], buttons, prev);
  assert.ok(!held.pressed.a && !held.pressed.dright, 'held buttons produce no new edge');

  const dead = E.Pad.mapPad([0.05, -0.05, 0, 0], [], []);
  assert.strictEqual(dead.moveX, 0, 'inside the dead zone');
  assert.strictEqual(dead.moveY, 0);
});
