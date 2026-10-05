'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load([
  ...load.files(['core', 'data']),
  ...load.files(['sim']),
  'js/net/net.js',
]);

test('vision: own units always seen, a distant enemy hidden, a nearby one seen', () => {
  const w = new E.World({ biome: 'desert', seed: 3, human: 'aegis' });
  const aegis = w.units.find((u) => u.team === 'aegis');
  const verdant = w.units.find((u) => u.team === 'verdant');
  assert.ok(aegis && verdant, 'both sides have a unit');
  assert.ok(E.SIM.vision(w, 'aegis').has(aegis.id), 'own unit is always visible');
  // push the enemy far beyond any sight range
  verdant.pos.x = aegis.pos.x + 8000; verdant.pos.z = aegis.pos.z;
  w.tickN++;
  assert.ok(!E.SIM.vision(w, 'aegis').has(verdant.id), 'distant enemy is hidden');
  // put it right on top of a friendly: now it is seen
  verdant.pos.x = aegis.pos.x + 4; verdant.pos.z = aegis.pos.z; verdant.pos.y = aegis.pos.y;
  w.tickN++;
  assert.ok(E.SIM.vision(w, 'aegis').has(verdant.id), 'nearby enemy is seen');
});

test('pack: a fogged snapshot omits unseen enemies and their projectiles', () => {
  const w = new E.World({ biome: 'desert', seed: 7, human: 'aegis' });
  const aegis = w.units.find((u) => u.team === 'aegis');
  const verdant = w.units.find((u) => u.team === 'verdant');
  verdant.pos.x = aegis.pos.x + 8000; verdant.pos.z = aegis.pos.z;
  w.projectiles.push({ id: 1, kind: 'bolt', wk: 'bolt', pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, team: 'verdant', uid: verdant.id, scale: 1 });
  w.projectiles.push({ id: 2, kind: 'bolt', wk: 'bolt', pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, team: 'aegis', uid: aegis.id, scale: 1 });
  w.tickN++;
  const vis = E.SIM.vision(w, 'aegis');
  const s = E.Net.pack(w, [], null, vis, 'aegis');
  const ids = s.u.map((r) => r[0]);
  assert.ok(ids.includes(aegis.id), 'friendly unit is transmitted');
  assert.ok(!ids.includes(verdant.id), 'hidden enemy is not transmitted');
  assert.strictEqual(s.pj.length, 1, 'only the local team projectile is transmitted');
  assert.strictEqual(s.pj[0][7], 'aegis');
});

test('fog off: the snapshot is unfiltered (default behaviour unchanged)', () => {
  const w = new E.World({ biome: 'desert', seed: 11, human: 'aegis' });
  const s = E.Net.pack(w, [], null, null, 'aegis');
  assert.strictEqual(s.u.length, w.units.length, 'all units transmitted when there is no fog');
});

// A two-end fake relay, as test/net.test.cjs uses.
function makePair() {
  const H = { handlers: {}, on(ev, fn) { this.handlers[ev] = fn; return this; }, send(id, data) { if (id === 1) G.deliver(0, data); }, onMsg(from, data) { this.handlers.msg && this.handlers.msg({ from, data }); }, peer(m) { this.handlers.peer && this.handlers.peer(m); } };
  const G = { handlers: {}, on(ev, fn) { this.handlers[ev] = fn; return this; }, toHost(data) { H.onMsg(1, data); }, deliver(from, data) { this.handlers.msg && this.handlers.msg({ from, data }); } };
  return { H, G };
}

test('fogged session: a guest only receives enemies it can see, and gains them when they close', () => {
  const { H, G } = makePair();
  const hostWorld = new E.World({ biome: 'desert', seed: 5, human: 'aegis', fog: true });
  const host = new E.Net.NetSession();
  host.host({ role: 'host', world: hostWorld, relay: H, state: 'play' });
  let meta = null;
  G.on('msg', (m) => { try { const s = JSON.parse(m.data); if (s.t === 'meta') meta = s; } catch {} });
  H.peer({ id: 1, name: 'Guest1', open: true });
  const guestWorld = new E.Net.RemoteWorld({ biome: meta.biome, seed: meta.seed, scale: meta.scale, faction: meta.faction });
  const guest = new E.Net.NetSession();
  guest.guest({ role: 'guest', world: guestWorld, relay: G, state: 'play' });
  const step = (n) => { for (let i = 0; i < n; i++) { hostWorld.tick(1 / 30); host.frame(hostWorld, hostWorld.drainEvents(), 1000 + hostWorld.tickN * 120); } };
  // park one enemy far from every verdant observer
  const foe = hostWorld.units.find((u) => u.team === 'aegis');
  foe.pos.x = 9000; foe.pos.z = 9000;
  step(2);
  assert.ok(!guestWorld.umap.has(foe.id), 'unseen enemy is not sent to the guest');
  // walk it up to a friendly and it appears in the next snapshot
  const friend = hostWorld.units.find((u) => u.team === 'verdant');
  foe.pos.x = friend.pos.x + 4; foe.pos.z = friend.pos.z; foe.pos.y = friend.pos.y;
  step(2);
  assert.ok(guestWorld.umap.has(foe.id), 'enemy appears once it is in sight');
});
