import { test, after } from 'node:test';
import assert from 'node:assert';
import { boot, auth, cookie } from './helpers.js';
import { totpNow } from '../src/lib/crypto.js';

let h;
after(async () => { if (h) await h.close(); });

test('health + config expose ticket keys', async () => {
  h = await boot();
  const health = await h.app.inject({ method: 'GET', url: '/healthz' });
  assert.strictEqual(health.statusCode, 200);
  assert.strictEqual((await health.json()).ok, true);
  const cfg = await h.app.inject({ method: 'GET', url: '/api/config' });
  const cj = await cfg.json();
  assert.strictEqual(cfg.statusCode, 200);
  assert.ok(Object.keys(cj.ticketKeys).length >= 1, 'a ticket public key is published');
});

test('signup issues a session cookie and /me reflects it', async () => {
  const su = await h.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'alice@ex.com', password: 'password123', name: 'Alice' } });
  assert.strictEqual(su.statusCode, 200);
  assert.strictEqual((await su.json()).user.name, 'Alice');
  const me = await h.app.inject({ method: 'GET', url: '/api/me', headers: auth(cookie(su)) });
  assert.strictEqual(me.statusCode, 200);
  assert.strictEqual((await me.json()).email, 'alice@ex.com');
});

test('duplicate email is rejected', async () => {
  await h.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'dup@ex.com', password: 'password123', name: 'Dup' } });
  const dup = await h.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'dup@ex.com', password: 'password123', name: 'Dup2' } });
  assert.strictEqual(dup.statusCode, 409);
});

test('login: bad password 400, good password issues cookie', async () => {
  await h.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'bob@ex.com', password: 'password123', name: 'Bob' } });
  const bad = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'bob@ex.com', password: 'wrongpass' } });
  assert.strictEqual(bad.statusCode, 400);
  const good = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'bob@ex.com', password: 'password123' } });
  assert.strictEqual(good.statusCode, 200);
  assert.ok(cookie(good).some((c) => c.name === 'gc_session'));
});

test('unknown /me is unauthorized', async () => {
  const me = await h.app.inject({ method: 'GET', url: '/api/me' });
  assert.strictEqual(me.statusCode, 401);
});

test('2FA: setup -> enable -> login requires code -> wrong code rejected', async () => {
  const su = await h.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'carol@ex.com', password: 'password123', name: 'Carol' } });
  const ck = auth(cookie(su));
  const setup = await h.app.inject({ method: 'POST', url: '/api/me/mfa/setup', headers: ck });
  assert.strictEqual(setup.statusCode, 200);
  const secret = (await setup.json()).secret;
  const enable = await h.app.inject({ method: 'POST', url: '/api/me/mfa/enable', headers: ck, payload: { code: totpNow(secret) } });
  assert.strictEqual(enable.statusCode, 200);
  const l1 = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'carol@ex.com', password: 'password123' } });
  assert.strictEqual((await l1.json()).mfa, true);
  const l2 = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'carol@ex.com', password: 'password123', mfa: '000000' } });
  assert.strictEqual(l2.statusCode, 400);
  const l3 = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'carol@ex.com', password: 'password123', mfa: totpNow(secret) } });
  assert.strictEqual(l3.statusCode, 200);
  assert.ok(cookie(l3).some((c) => c.name === 'gc_session'));
});

test('game hand-off: register -> claim yields a game session', async () => {
  const su = await h.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'dan@ex.com', password: 'password123', name: 'Dan' } });
  const ck = auth(cookie(su));
  const verifier = 'some-verifier-' + Date.now();
  const ho = await h.app.inject({ method: 'POST', url: '/api/auth/handoff', headers: ck, payload: { email: 'dan@ex.com', password: 'password123', verifier } });
  assert.strictEqual(ho.statusCode, 200);
  const hid = (await ho.json()).url.split('h=')[1];
  const claim = await h.app.inject({ method: 'POST', url: '/api/auth/handoff/claim', payload: { h: hid, verifier, device: 'web' } });
  assert.strictEqual(claim.statusCode, 200);
  assert.ok((await claim.json()).token, 'a game token was issued');
});
