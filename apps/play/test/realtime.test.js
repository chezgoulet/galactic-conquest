import { test, after } from 'node:test';
import assert from 'node:assert';
import { boot, cookie, auth, close } from './helpers.js';

let h, port, base;
after(async () => { if (h) await close(h); });

// a tiny WS client over the raw socket (Node global WebSocket)
function wsClient(url) {
  const c = { q: [], w: new WebSocket(url) };
  c.w.onmessage = (e) => c.q.push(JSON.parse(e.data));
  c.open = () => new Promise((res, rej) => { c.w.onopen = res; c.w.onerror = () => rej(new Error('ws err')); });
  c.send = (o) => c.w.send(JSON.stringify(o));
  c.next = async (pred, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = c.q.findIndex((m) => !pred || pred(m));
      if (i !== -1) return c.q.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('timeout: ' + JSON.stringify(c.q.slice(0, 3)));
  };
  c.close = () => { try { c.w.close(); } catch {} };
  return c;
}

async function mkGame(name) {
  const su = await h.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: name.toLowerCase() + '@ex.com', password: 'password123', name } });
  return { name, token: (cookie(su))[0].value, id: (await su.json()).user.id };
}

test('hub: auth -> hello, host -> room, join -> peer, signal relay, kick', async () => {
  h = await boot();
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  port = h.app.server.address().port;
  base = `ws://127.0.0.1:${port}/ws`;
  const [A, B] = [await mkGame('HostA'), await mkGame('GuestB')];

  const ha = wsClient(base); await ha.open();
  ha.send({ op: 'auth', token: A.token, version: '0.1.0', platform: 'web' });
  const hello = await ha.next((m) => m.op === 'hello');
  assert.strictEqual(hello.user.name, 'HostA');
  assert.ok(hello.ice.length >= 1, 'ICE servers delivered');
  assert.ok(Object.keys(hello.ticketKeys).length >= 1, 'ticket keys in hello');

  const hb = wsClient(base); await hb.open();
  hb.send({ op: 'auth', token: B.token });
  await hb.next((m) => m.op === 'hello');

  // host
  ha.send({ op: 'host', mode: 'team' });
  const hosted = await ha.next((m) => m.op === 'hosted');
  assert.match(hosted.room, /^[A-Z0-9]{5}$/);
  // join
  hb.send({ op: 'join', room: hosted.room, name: 'GuestB' });
  const joined = await hb.next((m) => m.op === 'joined');
  assert.strictEqual(joined.id, 1);
  const peer = await ha.next((m) => m.op === 'peer');
  assert.strictEqual(peer.id, 1);

  // signal relay guest->host and host->guest
  hb.send({ op: 'signal', to: 0, data: { sdp: { type: 'offer', sdp: 'O1' } } });
  const gotO = await ha.next((m) => m.op === 'signal' && m.data.sdp.type === 'offer');
  assert.strictEqual(gotO.from, 1);
  assert.strictEqual(gotO.data.sdp.sdp, 'O1');
  ha.send({ op: 'signal', to: 1, data: { sdp: { type: 'answer', sdp: 'A1' } } });
  const gotA = await hb.next((m) => m.op === 'signal' && m.data.sdp.type === 'answer');
  assert.strictEqual(gotA.from, 0);

  // start before anyone is ready is refused
  ha.send({ op: 'start', rated: true });
  const refused = await ha.next((m) => m.op === 'error' && m.msg === 'players not ready');
  assert.ok(refused, 'start refused while a guest is not ready');

  // guest readies -> host (and guest) see the ready state
  hb.send({ op: 'ready', on: true });
  const rs = await ha.next((m) => m.op === 'ready' && m.state.guests.some((g) => g.id === 1 && g.ready));
  assert.ok(rs, 'host sees the guest ready up');

  // start -> both get a signed ticket
  ha.send({ op: 'start', rated: true });
  const tA = await ha.next((m) => m.op === 'ticket');
  const tB = await hb.next((m) => m.op === 'ticket');
  assert.ok(tA.ticket, 'host got a ticket');
  assert.strictEqual(tA.match, tB.match, 'same match code');
  // the ticket verifies and lists both players
  const pay = h.app.keys.verifyToken(tA.ticket);
  assert.ok(pay, 'ticket verifies');
  assert.ok(pay.players.length === 2 && pay.ranked === true);

  // kick guest -> kicked
  ha.send({ op: 'kick', id: 1 });
  await hb.next((m) => m.op === 'kicked');

  ha.close(); hb.close();
});

test('hub: quick-match pairs two queued players into a lobby (guest auto-readies)', async () => {
  const [A, B] = [await mkGame('QM1'), await mkGame('QM2')];
  const a = wsClient(base); await a.open();
  a.send({ op: 'auth', token: A.token }); await a.next((m) => m.op === 'hello');
  a.send({ op: 'queue', mode: 'team' });
  const b = wsClient(base); await b.open();
  b.send({ op: 'auth', token: B.token }); await b.next((m) => m.op === 'hello');
  b.send({ op: 'queue', mode: 'team' });
  // both get a fresh room (matched)
  const ra = await a.next((m) => m.op === 'hosted' && m.matched);
  const rb = await b.next((m) => m.op === 'joined' && m.matched);
  assert.strictEqual(ra.room, rb.room, 'paired into the same room');
  // the matched guest auto-readies, so the host can start right away
  await a.next((m) => m.op === 'ready' && m.state.guests.some((g) => g.ready));
  a.send({ op: 'start' });
  const tA = await a.next((m) => m.op === 'ticket');
  const tB = await b.next((m) => m.op === 'ticket');
  assert.ok(tA.ticket && tB.ticket, 'both got tickets on start');
  a.close(); b.close();
});

test('hub: unauthenticated host is refused', async () => {
  const c = wsClient(base); await c.open();
  c.send({ op: 'host' });
  const e = await c.next((m) => m.op === 'error');
  assert.strictEqual(e.msg, 'auth first');
  c.close();
});
