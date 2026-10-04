// Account + session + 2FA service. Pure logic over the db; routes are thin.
import crypto from 'node:crypto';
import { hashPassword, verifyPassword, randomToken, hashToken, totpSecret, verifyTotp, totpNow, encryptSecret, decryptSecret } from '../lib/crypto.js';
import { HttpError, badRequest } from '../context.js';

const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16);
const NEW_NAME = (s) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 16) || 'Commander';

function uuid() { return crypto.randomUUID(); }

export class AuthService {
  constructor(db, cfg) { this.db = db; this.cfg = cfg; this.master = cfg.SECRET_KEY; }

  async create({ email, password, name }) {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('invalid email');
    if (!password || password.length < 8) throw badRequest('password must be at least 8 characters');
    const uname = NEW_NAME(name);
    let key = nameKey(uname); let n = 0;
    while (await this.db.queryOne('SELECT 1 FROM users WHERE name_key = $1', [key])) { n++; key = nameKey(uname) + n; }
    const id = uuid();
    await this.db.query(
      'INSERT INTO users (id, display_name, name_key, email, password_hash) VALUES ($1,$2,$3,$4,$5)',
      [id, uname, key, email, hashPassword(password)]
    );
    return this.db.queryOne('SELECT * FROM users WHERE id = $1', [id]);
  }

  async findById(id) { return this.db.queryOne('SELECT * FROM users WHERE id = $1', [id]); }
  async byEmail(email) { return this.db.queryOne('SELECT * FROM users WHERE email = $1', [String(email).toLowerCase()]); }
  async byNameKey(k) { return this.db.queryOne('SELECT * FROM users WHERE name_key = $1', [k]); }

  // verify + check the account is usable; returns the user or throws
  async verifyCredentials(email, password) {
    const u = await this.byEmail(email);
    // dummy verify to keep timing even when the account does not exist
    if (!u) { verifyPassword(password, 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'); throw badRequest('invalid credentials'); }
    if (!verifyPassword(password, u.password_hash)) throw badRequest('invalid credentials');
    if (u.status === 'banned') throw new HttpError(403, 'banned', 'this account is banned');
    if (u.status === 'suspended' && u.suspended_until && new Date(u.suspended_until) > new Date()) throw new HttpError(403, 'suspended', 'this account is suspended');
    return u;
  }

  async issueSession(user, { kind = 'web', client, mfa = false, ttlMs } = {}) {
    const id = randomToken(32);
    const ttl = ttlMs || (kind === 'game' ? 30 : 365) * 864e5;
    await this.db.query(
      'INSERT INTO sessions (id, user_id, kind, client, mfa, expires_at) VALUES ($1,$2,$3,$4,$5, now() + ($6::bigint / 1000.0) * interval \'1 second\')',
      [id, user.id, kind, client || null, mfa, String(ttl)]
    );
    return { id, ttl };
  }

  async validateSession(id) {
    if (!id) return null;
    const s = await this.db.queryOne('SELECT * FROM sessions WHERE id = $1', [id]);
    if (!s || new Date(s.expires_at) < new Date()) return null;
    const u = await this.findById(s.user_id);
    if (!u || u.status === 'deleted' || u.status === 'banned') return null;
    await this.db.query('UPDATE sessions SET last_used_at = now() WHERE id = $1', [s.id]);
    return { session: s, user: u };
  }

  async logout(id) { await this.db.query('DELETE FROM sessions WHERE id = $1', [id]); }

  // ── 2FA ──────────────────────────────────────────────────────
  async mfaSetup(user) {
    const secret = totpSecret();
    const enc = encryptSecret(this.master, 'totp:' + user.id, secret);
    await this.db.query('UPDATE users SET totp_secret_enc = $1 WHERE id = $2', [enc, user.id]);
    return { secret, otpauth: 'otpauth://totp/GalacticConquest:' + encodeURIComponent(user.display_name) + '?secret=' + secret + '&issuer=GalacticConquest' };
  }
  async mfaEnable(user, code) {
    const secret = decryptSecret(this.master, 'totp:' + user.id, user.totp_secret_enc);
    if (!verifyTotp(secret, code)) throw badRequest('invalid code');
    const codes = [];
    for (let i = 0; i < 8; i++) { const c = crypto.randomInt(1e6, 1e7).toString(); codes.push(c); await this.db.query('INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1,$2)', [user.id, hashToken(c)]); }
    await this.db.query('UPDATE users SET totp_enabled = true WHERE id = $1', [user.id]);
    return { codes };
  }
  async mfaDisable(user, code) {
    const secret = decryptSecret(this.master, 'totp:' + user.id, user.totp_secret_enc);
    if (!(verifyTotp(secret, code) || await this.useRecovery(user.id, code))) throw badRequest('invalid code');
    await this.db.query('UPDATE users SET totp_enabled = false, totp_secret_enc = NULL WHERE id = $1', [user.id]);
  }
  async useRecovery(userId, code) {
    const h = hashToken(code);
    const row = await this.db.queryOne('SELECT * FROM recovery_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL', [userId, h]);
    if (!row) return false;
    await this.db.query('UPDATE recovery_codes SET used_at = now() WHERE id = $1', [row.id]);
    return true;
  }
  // returns true when the provided code (totp or recovery) is valid for the user
  async checkMfa(user, code) {
    if (!user.totp_enabled) return false;
    const secret = decryptSecret(this.master, 'totp:' + user.id, user.totp_secret_enc);
    if (verifyTotp(secret, code)) return true;
    return this.useRecovery(user.id, code);
  }
}
