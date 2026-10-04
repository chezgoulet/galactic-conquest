// The match-ticket keyring. Ed25519 key pairs live in server_keys; private
// keys are encrypted at rest with AES-256-GCM under a key derived from
// SECRET_KEY. The keyring signs with the newest active key; any unretired key
// verifies, so tickets survive key rotation.
import { generateKeyPair, encryptSecret, decryptSecret, signTicket, verifyTicket, decodeTicket, b64u } from '../lib/crypto.js';

export class Keyring {
  constructor(db, master) {
    this.db = db; this.master = master;
    this.publics = {};   // kid -> publicKey b64
    this.privs = {};     // kid -> privateKey b64 (decrypted in memory)
    this.signer = null;  // kid currently used for signing
  }

  async load() {
    const rows = (await this.db.query('SELECT id, public_key, private_enc FROM server_keys ORDER BY created_at ASC')).rows;
    for (const r of rows) {
      this.publics[r.id] = r.public_key;
      if (r.private_enc) {
        try { this.privs[r.id] = decryptSecret(this.master, 'key:' + r.id, r.private_enc); } catch {}
      }
    }
    // newest key with a usable private key signs
    this.signer = null;
    for (const kid of Object.keys(this.privs)) this.signer = kid;
    if (!this.signer) await this.ensure();
  }

  async ensure() {
    if (this.signer && this.privs[this.signer]) return this.signer;
    const kp = generateKeyPair();
    const kid = b64u(Buffer.from('gc' + Date.now() + Math.random())).slice(0, 16);
    const enc = encryptSecret(this.master, 'key:' + kid, kp.privateKey);
    await this.db.query('INSERT INTO server_keys (id, public_key, private_enc) VALUES ($1, $2, $3)', [kid, kp.publicKey, enc]);
    this.publics[kid] = kp.publicKey;
    this.privs[kid] = kp.privateKey;
    this.signer = kid;
    return kid;
  }

  // { kid, token } where token = "kid.body.sig"
  async ticket(payload) {
    const kid = await this.ensure();
    const token = kid + '.' + signTicket(this.privs[kid], payload);
    return { kid, token };
  }

  // verify a "kid.body.sig" token against its kid's public key (rotation-safe)
  verifyToken(token) {
    const dot1 = String(token).indexOf('.');
    const kid = String(token).slice(0, dot1);
    const rest = String(token).slice(dot1 + 1);
    if (!this.publics[kid]) return null;
    if (!verifyTicket(this.publics[kid], rest)) return null;
    return decodeTicket(rest);
  }

  // rotate: retire the current signer and add a fresh one; old keys keep verifying
  async rotate() {
    if (this.signer) await this.db.query('UPDATE server_keys SET retired_at = now() WHERE id = $1 AND retired_at IS NULL', [this.signer]);
    this.signer = null;
    return this.ensure();
  }

  publicKeys() { return this.publics; }
}
