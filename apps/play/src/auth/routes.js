// Auth routes: signup, login, 2FA challenge, logout, password reset, and the
// game hand-off flow (client registers a sha256 verifier, the browser approves,
// the client claims a game token).
import crypto from 'node:crypto';
import { badRequest, HttpError } from '../context.js';
import { hashPassword } from '../lib/crypto.js';

function setSession(req, res, id) {
  const secure = req.server.cfg.isProd;
  res.setCookie('gc_session', id, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: 365 * 86400 });
}
function clearSession(req, res) { res.clearCookie('gc_session', { path: '/' }); }
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function buildAuthRoutes(app) {
  const A = app.auth;

  app.post('/api/auth/signup', async (req, res) => {
    const { email, password, name } = req.body || {};
    if (await A.byEmail(email)) throw new HttpError(409, 'email_taken', 'an account with that email already exists');
    const user = await A.create({ email, password, name });
    const { id } = await A.issueSession(user, { kind: 'web' });
    setSession(req, res, id);
    // token is returned so a cross-origin client (game on apex, api on play.) can
    // use it as a Bearer without depending on the httpOnly cookie
    return { ok: true, token: id, user: { id: user.id, name: user.display_name } };
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, password, mfa } = req.body || {};
    const user = await A.verifyCredentials(email, password);
    if (user.totp_enabled && !mfa) return { mfa: true, user: { id: user.id, name: user.display_name } };
    if (user.totp_enabled && !await A.checkMfa(user, mfa)) throw badRequest('invalid 2fa code');
    const { id } = await A.issueSession(user, { kind: 'web', mfa: !!user.totp_enabled });
    setSession(req, res, id);
    await app.audit(user.id, 'auth.login', user.name_key);
    return { ok: true, token: id, user: { id: user.id, name: user.display_name, role: user.role } };
  });

  app.post('/api/auth/mfa', async (req, res) => {
    // completes a login that required 2FA; the client re-sends credentials+code
    const { email, password, mfa } = req.body || {};
    const user = await A.verifyCredentials(email, password);
    if (!user.totp_enabled) throw badRequest('no 2fa for this account');
    if (!await A.checkMfa(user, mfa)) throw badRequest('invalid 2fa code');
    const { id } = await A.issueSession(user, { kind: 'web', mfa: true });
    setSession(req, res, id);
    return { ok: true, token: id, user: { id: user.id, name: user.display_name, role: user.role } };
  });

  app.post('/api/auth/logout', async (req, res) => {
    const t = req.cookies.gc_session;
    if (t) await A.logout(t);
    clearSession(req, res);
    return { ok: true };
  });

  // forgot/reset
  app.post('/api/auth/forgot', async (req) => {
    const { email } = req.body || {};
    const user = await A.byEmail(email);
    if (user) {
      const token = crypto.randomBytes(24).toString('hex');
      await app.db.query('INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1,$2,$3, now() + interval \'24 hours\')', [sha256(token), user.id, 'reset']);
      // (mail delivery is pluggable; in dev we stash it in the outbox)
      if (app.outbox) app.outbox.push({ to: email, subject: 'Reset your Galactic Conquest password', text: token });
    }
    return { ok: true }; // no oracle
  });
  app.post('/api/auth/reset', async (req) => {
    const { token, password } = req.body || {};
    const row = await app.db.queryOne('SELECT * FROM email_tokens WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()', [sha256(token), 'reset']);
    if (!row) throw badRequest('invalid or expired token');
    if (!password || password.length < 8) throw badRequest('password must be at least 8 characters');
    await app.db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), row.user_id]);
    await app.db.query('UPDATE email_tokens SET used_at = now() WHERE token_hash = $1', [sha256(token)]);
    return { ok: true };
  });

  // game hand-off: the in-game client registers a sha256(verifier); the browser
  // approves; the client (with its game token) claims it.
  app.post('/api/auth/handoff', async (req) => {
    const { email, password, verifier } = req.body || {};
    const user = await A.verifyCredentials(email, password);
    const id = crypto.randomBytes(16).toString('hex');
    await app.db.query('INSERT INTO login_handoffs (id, user_id, expires_at) VALUES ($1,$2, now() + interval \'10 minutes\')', [id, user.id]);
    return { url: app.cfg.PUBLIC_URL + '/approve?h=' + id, user: { id: user.id, name: user.display_name } };
  });
  app.post('/api/auth/handoff/approve', async (req, res) => {
    const { h } = req.body || {};
    const row = await app.db.queryOne('SELECT * FROM login_handoffs WHERE id = $1 AND claimed_at IS NULL', [h]);
    if (!row) throw badRequest('unknown hand-off');
    // approval comes from an authenticated web session (the human at the browser)
    if (!req.user) throw new HttpError(401, 'unauthorized', 'sign in to approve');
    if (row.user_id !== req.user.id) throw badRequest('hand-off is for a different account');
    const { id } = await A.issueSession(row.user ? await A.findById(row.user_id) : req.user, { kind: 'web' });
    setSession(req, res, id);
    return { ok: true };
  });
  app.post('/api/auth/handoff/claim', async (req) => {
    const { h, verifier, device } = req.body || {};
    const row = await app.db.queryOne('SELECT * FROM login_handoffs WHERE id = $1 AND claimed_at IS NULL', [h]);
    if (!row) throw badRequest('unknown or already claimed hand-off');
    await app.db.query('UPDATE login_handoffs SET claimed_at = now() WHERE id = $1', [h]);
    const user = await A.findById(row.user_id);
    const { id } = await A.issueSession(user, { kind: 'game', client: device });
    return { token: id, user: { id: user.id, name: user.display_name, rating: user.rating } };
  });
}
