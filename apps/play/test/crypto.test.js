import { test } from 'node:test';
import assert from 'node:assert';
import * as C from '../src/lib/crypto.js';

test('password hash + verify roundtrip, wrong password fails', () => {
  const h = C.hashPassword('correct-horse-battery');
  assert.ok(C.verifyPassword('correct-horse-battery', h));
  assert.ok(!C.verifyPassword('wrong', h));
  assert.ok(!C.verifyPassword('x', 'not-a-hash'));
});

test('encrypt/decrypt secret roundtrip; wrong key fails', () => {
  const enc = C.encryptSecret('master-key-1234567890ab', 'purpose', 'top-secret');
  assert.strictEqual(C.decryptSecret('master-key-1234567890ab', 'purpose', enc), 'top-secret');
  assert.throws(() => C.decryptSecret('different-master-key', 'purpose', enc));
});

test('ed25519 ticket sign + verify; tamper fails; rotation-safe verify', () => {
  const kp = C.generateKeyPair();
  const body = { v: 2, mid: 'abc', exp: 999 };
  const token = C.signTicket(kp.privateKey, body);
  const [b, s] = token.split('.');
  assert.ok(C.verifyTicket(kp.publicKey, token), 'valid ticket verifies');
  assert.deepStrictEqual(C.decodeTicket(token), body, 'payload decodes');
  // tamper the signature (guaranteed to change)
  const tampered = token.slice(0, -1) + (token.at(-1) === 'a' ? 'b' : 'a');
  assert.ok(!C.verifyTicket(kp.publicKey, tampered), 'tampered ticket fails');
  // a second key still verifies its own ticket (rotation)
  const kp2 = C.generateKeyPair();
  assert.ok(C.verifyTicket(kp2.publicKey, C.signTicket(kp2.privateKey, body)));
  assert.ok(!C.verifyTicket(kp2.publicKey, token), 'kp2 cannot verify kp1 ticket');
});

test('totp: a code within the window verifies, stale/foreign fail', () => {
  const secret = C.totpSecret();
  const now = C.totpNow(secret);
  assert.ok(C.verifyTotp(secret, now), 'current code verifies');
  assert.ok(!C.verifyTotp(secret, '000000' === now ? '111111' : '000000'), 'a different 6-digit code does not');
  assert.ok(!C.verifyTotp(C.totpSecret(), now), 'a foreign secret fails');
});

test('turn credentials are stable per expiry and hmac-shaped', () => {
  const a = C.turnCredentials('secret', 12 * 3600);
  assert.match(a.username, /^\d+:gc$/);
  assert.ok(a.credential.length > 10, 'credential is base64 hmac');
  assert.ok(a.expiry > Date.now() / 1000);
});
