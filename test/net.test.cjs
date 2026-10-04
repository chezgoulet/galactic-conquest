'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load([
  ...load.files(['core', 'data']),
  ...load.files(['sim']),
  'js/net/net.js',
]);

// A two-end fake WebRTC relay: host (id 0) <-> guest (id 1). Message handlers are
// single-slot per relay, matching E.Relay.on(), so the guest's meta capture and
// the guest session's snapshot handler occupy it in turn, just like in the lobby.
function makePair() {
  const H = {
    handlers: {},
    on(ev, fn) { this.handlers[ev] = fn; return this; },
    send(id, data) { if (id === 1) G.deliver(0, data); }, // host -> guest
    onMsg(from, data) { this.handlers.msg && this.handlers.msg({ from, data }); },
    peer(m) { this.handlers.peer && this.handlers.peer(m); },
    left(m) { this.handlers.left && this.handlers.left(m); },
  };
  const G = {
    handlers: {},
    on(ev, fn) { this.handlers[ev] = fn; return this; },
    toHost(data) { H.onMsg(1, data); }, // guest -> host
    deliver(from, data) { this.handlers.msg && this.handlers.msg({ from, data }); },
  };
  return { H, G };
}

function boot() {
  const { H, G } = makePair();
  const hostWorld = new E.World({ biome: 'desert', seed: 5, human: 'aegis' });
  const hostGame = { role: 'host', world: hostWorld, relay: H, state: 'play' };
  const host = new E.Net.NetSession();
  host.host(hostGame);
  // capture the guest's meta (the lobby does this to boot the guest world)
  let meta = null;
  G.on('msg', (m) => { try { const s = JSON.parse(m.data); if (s.t === 'meta') meta = s; } catch {} });
  H.peer({ id: 1, name: 'Guest1', open: true });
  const guestWorld = new E.Net.RemoteWorld({ biome: meta.biome, seed: meta.seed, scale: meta.scale, faction: meta.faction });
  guestWorld._pid = meta.pid;
  const guestGame = { role: 'guest', world: guestWorld, relay: G, state: 'play' };
  const guest = new E.Net.NetSession();
  guest.guest(guestGame); // takes over G's msg handler to apply snapshots
  return { H, G, hostWorld, hostGame, host, guest, guestWorld, guestGame, meta };
}
const tick = (ctx, n = 1, now) => {
  const t = now || Date.now();
  for (let i = 0; i < n; i++) {
    ctx.hostWorld.tick(1 / 30);
    ctx.host.frame(ctx.hostWorld, ctx.hostWorld.drainEvents(), t + i * 120);
  }
};

test('host assigns the guest a faction + pid and meta carries the world seed', () => {
  const { meta, hostWorld } = boot();
  assert.strictEqual(meta.faction, 'verdant', 'guest gets the opposing faction');
  assert.strictEqual(meta.pid, 'p2', 'guest gets a distinct pid');
  assert.strictEqual(meta.biome, hostWorld.planet.biome);
  assert.strictEqual(meta.seed, hostWorld.planet.seed);
  assert.ok(hostWorld.player('p2'), 'host registered the guest player');
});

test('guest world syncs the full state from the first snapshot', () => {
  const ctx = boot();
  tick(ctx, 2);
  assert.ok(ctx.guestWorld.units.length > 0, 'guest sees units');
  assert.strictEqual(ctx.guestWorld.units.length, ctx.hostWorld.units.length, 'unit counts match');
  assert.strictEqual(ctx.guestWorld.winner, ctx.hostWorld.winner);
  assert.strictEqual(ctx.guestWorld.teams.aegis.tickets, ctx.hostWorld.teams.aegis.tickets);
  // every guest unit mirrors the host's position closely
  const h = ctx.hostWorld.byId(1); const g = ctx.guestWorld.byId(1);
  assert.ok(g && Math.abs(g.pos.x - h.pos.x) < 2, 'unit position mirrored');
});

test('guest deploy command is routed to the host world and auto-possesses', () => {
  const ctx = boot();
  const home = ctx.hostWorld.cps.find(c => c.home === 'verdant').id;
  ctx.G.toHost(JSON.stringify({ t: 'deploy', a: 'trooper', b: home }));
  const p2 = ctx.hostWorld.player('p2');
  assert.ok(p2.unitId > 0, 'guest deployed + auto-possessed a unit');
  assert.strictEqual(ctx.hostWorld.unitOf('p2').team, 'verdant');
  // next snapshot carries the guest's possessed unit back
  tick(ctx, 2);
  assert.ok(ctx.guestWorld.unitOf('p2'), 'guest sees their own unit');
  assert.strictEqual(ctx.guestWorld.unitOf('p2').id, p2.unitId);
});

test('guest input + order commands reach the host world', () => {
  const ctx = boot();
  const p2 = ctx.hostWorld.player('p2');
  ctx.G.toHost(JSON.stringify({ t: 'input', a: { mx: 1, mz: 0, fire: true } }));
  assert.strictEqual(p2.input.mx, 1, 'input applied to the guest player');
  // order the guest's own (soon-to-exist) unit: deploy one first
  const home = ctx.hostWorld.cps.find(c => c.home === 'verdant').id;
  ctx.G.toHost(JSON.stringify({ t: 'deploy', a: 'trooper', b: home }));
  const uid = ctx.hostWorld.player('p2').unitId;
  // release then order another unit
  ctx.G.toHost(JSON.stringify({ t: 'release' }));
  ctx.G.toHost(JSON.stringify({ t: 'order', a: [uid], b: 'hold', c: null }));
  assert.ok(ctx.hostWorld.byId(uid).order && ctx.hostWorld.byId(uid).order.type === 'hold', 'order applied');
});

test('re-sync: a guest that fell behind gets a full snapshot', () => {
  const ctx = boot();
  tick(ctx, 2); // guest syncs to n=N
  // simulate the guest missing snapshots: reset its lastN so it's behind
  const info = [...ctx.host._guests.values()][0];
  info.lastN = 0; // far behind
  tick(ctx, 2); // host should send a FULL snapshot to re-sync
  assert.strictEqual(ctx.guestWorld.units.length, ctx.hostWorld.units.length, 're-synced to full state');
});
