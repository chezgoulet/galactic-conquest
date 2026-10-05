'use strict';
// Fragmentation framing: a payload larger than one DataChannel message must be
// split into framed parts and reassembled intact on the far side. Regression
// guard for the bug where >15 KB snapshots were sent as bare chunks and the
// receiver parsed each chunk as a whole message (silently dropping them).
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load(['js/net/relay.js']);

function pair() {
  const A = new E.Relay({}), B = new E.Relay({});
  const chunks = [];
  const dc = { readyState: 'open', send: (s) => chunks.push(s) };
  const pA = { id: 1, hello: true, dc }, pB = { id: 0, hello: true };
  const got = [];
  B.on('msg', (m) => got.push(m.data));
  return { A, B, pA, pB, chunks, got };
}

test('a payload larger than one chunk is fragmented, framed and reassembled', () => {
  const { A, B, pA, pB, chunks, got } = pair();
  const big = JSON.stringify({ t: 'snap', data: 'x'.repeat(40000) });
  assert.ok(big.length > 15000, 'test payload exceeds the chunk size');
  A.sendRaw(pA, big);
  assert.ok(chunks.length > 1, 'split into multiple DataChannel messages');
  for (const c of chunks) B.onMsg(pB, c);
  assert.strictEqual(got.length, 1, 'exactly one whole message reaches the app');
  assert.strictEqual(got[0], big, 'reassembled byte-for-byte');
});

test('a small message passes through unframed', () => {
  const { A, B, pA, pB, chunks, got } = pair();
  const small = '{"k":"hi","p":1}';
  A.sendRaw(pA, small);
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0], small);
  B.onMsg(pB, chunks[0]);
  assert.strictEqual(got[0], small);
});

test('malformed or oversized frame headers are dropped without throwing', () => {
  const { B, pB, got } = pair();
  assert.doesNotThrow(() => {
    B.onMsg(pB, '\u0001garbage');
    B.onMsg(pB, '\u00010:0:1:');      // id 0 is invalid
    B.onMsg(pB, '\u00011:5:3:x');     // part >= total
    B.onMsg(pB, '\u00011:0:99999:x'); // total over the cap
    B.onMsg(pB, '\u00011:0:2:a');     // incomplete; then a fresh id abandons it
    B.onMsg(pB, '\u00012:0:1:b');
  });
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0], 'b');
});
