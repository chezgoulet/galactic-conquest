'use strict';
// Decisive online integration test: the game's own OnlineClient + Relay drive
// the REAL play service (booted in-process on PGlite) over a real WebSocket.
// The WebRTC DataChannel is a no-op mock (headless Node has no RTC); the test
// exercises the full online *protocol* the game client speaks: account ->
// connect/auth -> host -> join -> ready gate -> start -> signed ticket -> claim
// -> reconciliation + Elo.
const { test, after } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');

let svc;
const clients = [];
// close the game clients first: their open WebSockets otherwise keep the
// service (and so the test process) alive
after(async () => { for (const c of clients) c.close(); if (svc) await svc.close(); });

// no-op WebRTC so the relay's makePeer doesn't throw in Node; the WS signaling
// (hosted/joined/peer/ready/ticket) still flows, which is what we test.
class MockRTC {
  constructor() { this.readyState = 'closed'; this.onicecandidate = null; this.onconnectionstatechange = null; this.ondatachannel = null; this.localDescription = null; }
  createDataChannel() { return { readyState: 'closed', onopen: null, onmessage: null, send() {}, close() {} }; }
  createOffer() { return Promise.resolve({ type: 'offer', sdp: { type: 'offer', sdp: 'mock' } }); }
  createAnswer() { return Promise.resolve({ type: 'answer', sdp: { type: 'answer', sdp: 'mock' } }); }
  setLocalDescription(d) { this.localDescription = d; return Promise.resolve(); }
  setRemoteDescription() { return Promise.resolve(); }
  addIceCandidate() { return Promise.resolve(); }
  restartIce() {} close() {}
}
function shimLS() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }
// wait for the next `ev` emitted by an OnlineClient
function wait(oc, ev, ms = 5000) {
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('timeout waiting for ' + ev)), ms);
    oc.on(ev, (m) => { clearTimeout(to); res(m); });
  });
}

test('online: game client end-to-end against the real service', async () => {
  const { loadConfig } = await import('../apps/play/src/config.js');
  const { openAndMigrate } = await import('../apps/play/src/db/index.js');
  const { buildApp } = await import('../apps/play/src/app.js');
  const cfg = loadConfig({ NODE_ENV: 'test', SECRET_KEY: 'x'.repeat(24), RATE_LIMIT: '0', TURN_SECRET: 'y'.repeat(24) });
  const db = await openAndMigrate(cfg);
  const app = await buildApp(cfg, db);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  svc = { close: async () => { await app.close(); await db.close(); } };

  const E = load([
    'js/core/util.js', 'js/core/rng.js', 'js/core/vec3d.js', 'js/core/events.js', 'js/core/loop.js', 'js/core/noise.js',
    'js/data/factions.js', 'js/data/biomes.js', 'js/data/units.js',
    'js/sim/terrain.js', 'js/sim/sim.js', 'js/sim/world.js',
    'js/net/net.js', 'js/net/relay.js', 'js/net/online.js',
  ], {
    fetch, WebSocket, RTCPeerConnection: MockRTC,
    location: { protocol: 'http:', host: '127.0.0.1', href: baseUrl },
    localStorage: shimLS(),
    navigator: { platform: 'web' },
  });

  // ── host account + connect ──
  const oc = new E.Online.OnlineClient();
  clients.push(oc);
  oc.setUrl(baseUrl);
  await oc.signup('host@ex.com', 'password123', 'HostH');
  assert.ok(oc.token, 'signup returns a token');
  await oc.connect();
  assert.ok(oc.user, 'authenticated (hello)');

  // ── guest account + connect ──
  const og = new E.Online.OnlineClient();
  clients.push(og);
  og.setUrl(baseUrl);
  await og.signup('guest@ex.com', 'password123', 'GuestG');
  await og.connect();

  // ── host creates a lobby ──
  oc.host('team');
  const hosted = await wait(oc, 'hosted');
  assert.match(hosted.room, /^[A-Z0-9]{5}$/, '5-letter room code');

  // ── guest joins ──
  og.join(hosted.room);
  const joined = await wait(og, 'joined');
  assert.strictEqual(joined.room, hosted.room);
  await wait(oc, 'lobby'); // host sees the peer
  assert.strictEqual(oc._lobby().guests.length, 1, 'host sees one guest');

  // ── ready gate: start refused until the guest readies ──
  oc.start(true);
  const refused = await wait(oc, 'error');
  assert.strictEqual(refused.msg, 'players not ready');

  og.ready(true);
  const lb = await wait(oc, 'lobby');
  assert.ok(lb.guests[0].ready, 'guest is ready');

  // ── start -> both receive a signed ticket ──
  oc.start(true);
  const tHost = await wait(oc, 'ticket');
  const tGuest = await wait(og, 'ticket');
  assert.strictEqual(tHost.match, tGuest.match, 'same match code');
  assert.ok(tHost.ticket, 'host got a ticket');
  // the ticket verifies and lists both players
  const pay = app.keys.verifyToken(tHost.ticket);
  assert.ok(pay, 'ticket verifies');
  assert.strictEqual(pay.players.length, 2);
  assert.strictEqual(pay.ranked, true);

  // ── both players claim the result -> reconciliation + Elo ──
  assert.strictEqual((await oc.claim('aegis', 'aegis')).status, 'confirmed', 'host claim confirms');
  await og.claim('aegis', 'verdant');
  const mine = await fetch(baseUrl + '/api/match/mine', { headers: { authorization: 'Bearer ' + og.token } }).then((r) => r.json());
  assert.ok(mine.some((m) => m.status === 'confirmed' && m.winner_team === 'aegis'), 'guest sees the confirmed match');
  const guest = await app.db.queryOne('SELECT rating FROM users WHERE email = $1', ['guest@ex.com']);
  assert.notStrictEqual(guest.rating, 1200, 'guest Elo moved');
});
