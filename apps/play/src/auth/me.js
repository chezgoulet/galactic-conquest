// /api/me: profile, password/email, 2FA setup+enable+disable, session list.
import { badRequest, unauthorized, requireRole } from '../context.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';

export function buildMeRoutes(app) {
  const A = app.auth;
  const me = async (req) => {
    if (!req.user) throw unauthorized();
    return req.user;
  };
  const fresh = async (id) => A.findById(id);

  app.get('/api/me', async (req) => {
    const u = await fresh((await me(req)).id);
    return {
      id: u.id, name: u.display_name, email: u.email, role: u.role, rating: u.rating,
      matches: u.matches, wins: u.wins, mfa: u.totp_enabled,
      suspendedUntil: u.suspended_until, mutedUntil: u.muted_until,
    };
  });

  app.patch('/api/me', async (req) => {
    const u = await me(req);
    const { name } = req.body || {};
    if (name) {
      const n = String(name).trim().slice(0, 16);
      if (!n) throw badRequest('bad name');
      await app.db.query('UPDATE users SET display_name = $1 WHERE id = $2', [n, u.id]);
    }
    return { ok: true };
  });

  app.post('/api/me/password', async (req) => {
    const u = await me(req);
    const { current, next } = req.body || {};
    if (!current || !verifyPassword(current, u.password_hash)) throw badRequest('current password is wrong');
    if (!next || next.length < 8) throw badRequest('new password too short');
    await app.db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(next), u.id]);
    return { ok: true };
  });

  // ── 2FA ──────────────────────────────────────────────────────
  app.post('/api/me/mfa/setup', async (req) => {
    const u = await me(req);
    return A.mfaSetup(u);
  });
  app.post('/api/me/mfa/enable', async (req) => {
    const u = await me(req);
    return A.mfaEnable(u, (req.body || {}).code);
  });
  app.post('/api/me/mfa/disable', async (req) => {
    const u = await me(req);
    await A.mfaDisable(u, (req.body || {}).code);
    return { ok: true };
  });

  // ── sessions ─────────────────────────────────────────────────
  app.get('/api/me/sessions', async (req) => {
    const u = await me(req);
    const rows = await app.db.query('SELECT id, kind, client, mfa, created_at, last_used_at, expires_at FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY created_at DESC', [u.id]);
    return rows.rows.map((s) => ({ id: s.id.slice(0, 6), kind: s.kind, client: s.client, mfa: s.mfa, created: s.created_at, lastUsed: s.last_used_at }));
  });
  app.delete('/api/me/sessions/:id', async (req) => {
    const u = await me(req);
    const { id } = req.params;
    const row = await app.db.queryOne('SELECT id FROM sessions WHERE id LIKE $1 AND user_id = $2', [id + '%', u.id]);
    if (row) await A.logout(row.id);
    return { ok: true };
  });
  app.post('/api/me/sessions/revoke-others', async (req) => {
    const u = await me(req);
    await app.db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [u.id, req.cookies.gc_session || '']);
    return { ok: true };
  });

  app.delete('/api/me', async (req) => {
    const u = await me(req);
    await app.db.query('UPDATE users SET status = $1, password_hash = $2 WHERE id = $3', ['deleted', 'x', u.id]);
    await A.logout(req.cookies.gc_session || '');
    return { ok: true };
  });
}
