// Crypto primitives for the play service. All from node:crypto — no native
// deps so it builds anywhere.
//
//   scrypt passwords      AES-256-GCM secret storage (keyring, TOTP)
//   Ed25519 match tickets HMAC-SHA1 TURN credentials  TOTP 2FA
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const b64 = (buf) => Buffer.from(buf).toString('base64');
const utf8 = (s) => Buffer.from(String(s), 'utf8');

// ── KDF: derive an AES key (and salt) from the master SECRET_KEY ─────────
// A single SECRET_KEY protects all encrypted-at-rest secrets. We derive a
// stable 32-byte key per "purpose" tag so a future rotation of SECRET_KEY can
// re-wrap only the secrets that need it (secrets:rewrap in the CLI).
export function kdf(master, purpose) {
  return crypto.createHmac('sha256', master).update('gc:' + purpose + ':').digest('base64');
}

export function encryptSecret(master, purpose, plaintext) {
  const key = kdf(master, purpose + ':enc');
  const iv = crypto.randomBytes(12);
  const ct = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  const enc = Buffer.concat([ct.update(utf8(plaintext)), ct.final()]);
  const tag = ct.getAuthTag();
  return b64u(iv) + '.' + b64u(tag) + '.' + b64u(enc);
}
export function decryptSecret(master, purpose, packed) {
  const [iv, tag, enc] = packed.split('.');
  const key = kdf(master, purpose + ':enc');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}

// ── passwords (scrypt) ───────────────────────────────────────────────────
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(utf8(password), salt, 64, SCRYPT_OPTS);
  return `scrypt$${SCRYPT_OPTS.N}$${b64u(salt)}$${b64u(hash)}`;
}
export function verifyPassword(password, stored) {
  try {
    const [, n, salt, hash] = String(stored).split('$');
    const c = crypto.scryptSync(utf8(password), Buffer.from(salt, 'base64url'), 64, { N: +n, r: 8, p: 1 });
    return crypto.timingSafeEqual(c, Buffer.from(hash, 'base64url'));
  } catch { return false; }
}

// ── tokens (opaque, random) ──────────────────────────────────────────────
export function randomToken(bytes = 32) { return b64u(crypto.randomBytes(bytes)); }
export function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

// ── Ed25519 keyring for match tickets ────────────────────────────────────
export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}
export function signTicket(privateB64, payload) {
  const key = crypto.createPrivateKey({ key: Buffer.from(privateB64, 'base64'), format: 'der', type: 'pkcs8' });
  const body = b64u(utf8(JSON.stringify(payload)));
  const sig = b64u(crypto.sign(null, utf8(body), key));
  return body + '.' + sig;
}
export function verifyTicket(publicB64, signedBody) {
  const [body, sig] = String(signedBody).split('.');
  const key = crypto.createPublicKey({ key: Buffer.from(publicB64, 'base64'), format: 'der', type: 'spki' });
  return crypto.verify(null, utf8(body), key, Buffer.from(sig, 'base64url'));
}
export function decodeTicket(signedBody) {
  const body = String(signedBody).split('.')[0];
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}

// ── TOTP (RFC 6238, HMAC-SHA1, 30 s, 6 digits) ───────────────────────────
function totpCode(secret, counter) {
  const k = Buffer.from(secret, 'base64');
  const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', k).update(m).digest();
  const o = h[h.length - 1] & 0xf;
  const v = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(v % 1e6).padStart(6, '0');
}
export function totpNow(secret, step = 30) { return totpCode(secret, Math.floor(Date.now() / 1000 / step)); }
export function verifyTotp(secret, code, window = 1) {
  const c = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) if (crypto.timingSafeEqual(utf8(totpCode(secret, c + i)), utf8(String(code).padStart(6, '0')))) return true;
  return false;
}
export function totpSecret() { return b64u(crypto.randomBytes(20)); }

// ── TURN REST credentials (coturn use-auth-secret) ───────────────────────
export function turnCredentials(secret, lifetimeSec) {
  const expiry = Math.floor(Date.now() / 1000) + lifetimeSec;
  const username = String(expiry) + ':gc';
  const credential = b64(crypto.createHmac('sha1', secret).update(username).digest());
  return { username, credential, expiry };
}

export { b64u, b64, utf8 };
