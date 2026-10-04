'use strict';
// End-to-end test of the LAN signaling server (server/signal.cjs) over REAL
// WebSockets with REAL client masking (RFC 6455). This is the exact path a
// browser takes when it calls E.Relay: host -> hosted, join -> joined + peer,
// SDP/ICE signal relay in both directions, kick, and left-on-drop. A full
// WebRTC DataChannel loopback is not possible in headless CI (no ICE candidates
// in SwiftShader), but the signaling server + masking are the server's job and
// are fully exercised here. The NetSession / Relay handshake logic is covered
// separately by net.test.cjs.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createSignal } = require('../server/signal.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A minimal real WebSocket client wrapper around Node's global WebSocket.
class Client {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.q = [];
    this.ws.onmessage = (e) => this.q.push(JSON.parse(e.data));
  }
  open() { return new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('ws error')); }); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  // wait for the next queued message matching pred (any if pred null), with timeout
  async next(pred, ms = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = this.q.findIndex((m) => !pred || pred(m));
      if (i !== -1) return this.q.splice(i, 1)[0];
      await sleep(20);
    }
    throw new Error('timed out waiting for ' + (pred ? 'matching msg' : 'msg') + '; queue=' + JSON.stringify(this.q.slice(0, 3)));
  }
  close() { try { this.ws.close(); } catch {} }
}

async function withServer(fn) {
  const srv = http.createServer((q, r) => r.end('ok'));
  const signal = createSignal({ ice: [{ urls: 'stun:stun.example:3478' }] });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  srv.on('upgrade', (req, socket) => signal.upgrade(req, socket));
  const url = `ws://127.0.0.1:${srv.address().port}/ws`;
  try { await fn(url); } finally { signal.close(); srv.close(); }
}

test('signaling server: host, join, SDP/ICE relay, kick, left', async () => {
  await withServer(async (url) => {
    const H = new Client(url); await H.open();
    const G = new Client(url); await G.open();

    // host -> hosted with a room code + ICE
    H.send({ op: 'host', name: 'Alpha' });
    const hosted = await H.next((m) => m.op === 'hosted');
    assert.ok(/^[A-Z]{4}$/.test(hosted.room), 'room code issued');
    assert.strictEqual(hosted.id, 0);
    assert.ok(Array.isArray(hosted.ice) && hosted.ice.length, 'ICE servers delivered');

    // join -> guest gets joined, host gets peer
    G.send({ op: 'join', room: hosted.room, name: 'Bravo' });
    const joined = await G.next((m) => m.op === 'joined');
    assert.strictEqual(joined.id, 1);
    const peer = await H.next((m) => m.op === 'peer');
    assert.strictEqual(peer.id, 1);
    assert.strictEqual(peer.name, 'Bravo');

    // guest joins a bad room -> error (masked frames decode fine)
    const G2 = new Client(url); await G2.open();
    G2.send({ op: 'join', room: 'ZZZZ', name: 'X' });
    const bad = await G2.next((m) => m.op === 'error');
    assert.strictEqual(bad.msg, 'no such room');

    // SDP / ICE relay: guest -> host and host -> guest
    G.send({ op: 'signal', to: 0, data: { sdp: { type: 'offer', sdp: 'OFFER-1' } } });
    const gotOffer = await H.next((m) => m.op === 'signal' && m.data.sdp.type === 'offer');
    assert.strictEqual(gotOffer.from, 1);
    assert.strictEqual(gotOffer.data.sdp.sdp, 'OFFER-1');
    H.send({ op: 'signal', to: 1, data: { sdp: { type: 'answer', sdp: 'ANSWER-1' } } });
    const gotAnswer = await G.next((m) => m.op === 'signal' && m.data.sdp.type === 'answer');
    assert.strictEqual(gotAnswer.from, 0);
    assert.strictEqual(gotAnswer.data.sdp.sdp, 'ANSWER-1');
    // ICE candidate both ways
    G.send({ op: 'signal', to: 0, data: { sdp: { type: 'cand', c: { candidate: 'cand-a' } } } });
    const cand = await H.next((m) => m.op === 'signal' && m.data.sdp.type === 'cand');
    assert.strictEqual(cand.data.sdp.c.candidate, 'cand-a');

    // a second guest also joins and can signal the host (host-authoritative)
    const G3 = new Client(url); await G3.open();
    G3.send({ op: 'join', room: hosted.room, name: 'Charlie' });
    const c3 = await G3.next((m) => m.op === 'joined');
    assert.strictEqual(c3.id, 2, 'guests are numbered sequentially');

    // kick charlie; host gets left
    H.send({ op: 'kick', id: 2 });
    const left = await H.next((m) => m.op === 'left');
    assert.strictEqual(left.id, 2, 'host told its guest left');

    // host leaving closes the room: the remaining guest gets 'closed'
    H.send({ op: 'close' });
    await G.next((m) => m.op === 'closed');

    H.close(); G.close(); G3.close();
  });
}, 15000);

test('signaling server: host dropping notifies guests and clears the room', async () => {
  await withServer(async (url) => {
    const H = new Client(url); await H.open();
    H.send({ op: 'host', name: 'Host' });
    const hosted = await H.next((m) => m.op === 'hosted');
    const G = new Client(url); await G.open();
    G.send({ op: 'join', room: hosted.room, name: 'G' });
    await G.next((m) => m.op === 'joined');
    // host socket drops -> guest is told the room closed
    H.ws.close();
    const closed = await G.next((m) => m.op === 'closed');
    assert.ok(closed, 'guest notified of room close');
    G.close();
  });
}, 15000);
