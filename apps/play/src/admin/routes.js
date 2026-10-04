// Admin console API. Role-gated via requireRole. The console UI (public/admin)
// talks to these; the operator CLI talks to the db directly.
import { requireRole, badRequest, unauthorized } from '../context.js';

export function buildAdminRoutes(app) {
  // ── dashboard ────────────────────────────────────────────────
  app.get('/api/admin/dashboard', async (req) => {
    requireRole(req.user, 'support');
    const [u, m, i, a, s] = await Promise.all([
      app.db.query('SELECT count(*) n FROM users WHERE status <> $1', ['deleted']),
      app.db.query('SELECT count(*) n FROM matches'),
      app.db.query("SELECT count(*) n FROM issues WHERE status = 'open'"),
      app.db.query("SELECT count(*) n FROM player_reports WHERE status = 'open'"),
      app.db.query("SELECT count(*) n FROM users WHERE created_at > now() - interval '1 day'"),
    ]);
    const topCrashes = (await app.db.query("SELECT fingerprint, title, count, kind, last_at FROM issues WHERE status = 'open' ORDER BY count DESC LIMIT 5")).rows;
    const daySeries = (await app.db.query("SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day, count(*) AS value FROM users WHERE status <> $1 AND created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1 DESC", ['deleted'])).rows;
    return { users: u.rows[0].n, matches: m.rows[0].n, openIssues: i.rows[0].n, openReports: a.rows[0].n, dau: s.rows[0].n, topCrashes, daySeries };
  });

  // ── users ────────────────────────────────────────────────────
  app.get('/api/admin/users', async (req) => {
    requireRole(req.user, 'support');
    const { q, status } = req.query;
    let sql = 'SELECT id, display_name, name_key, email, role, status, rating, matches, wins, created_at, last_seen_at FROM users WHERE status <> $1';
    const p = ['deleted'];
    if (q) { p.push(q + '%'); sql += ` AND (name_key LIKE $${p.length} OR email LIKE $${p.length})`; }
    if (status) { p.push(status); sql += ` AND status = $${p.length}`; }
    sql += ' ORDER BY created_at DESC LIMIT 100';
    const rows = await app.db.query(sql, p);
    if (q) await app.audit(req.user.id, 'admin.user_search', q);
    return rows.rows;
  });
  app.get('/api/admin/users/:id', async (req) => {
    requireRole(req.user, 'support');
    const u = await app.db.queryOne('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!u) throw badRequest('no such user');
    const sessions = (await app.db.query('SELECT count(*) n FROM sessions WHERE user_id = $1 AND expires_at > now()', [u.id])).rows[0].n;
    const sanctions = (await app.db.query('SELECT kind, reason, until, created_at FROM sanctions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [u.id])).rows;
    const matches = (await app.db.query('SELECT mp.result, mp.rating_delta, m.winner_team, m.started_at FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.user_id = $1 ORDER BY m.started_at DESC LIMIT 20', [u.id])).rows;
    return { user: u, sessions, sanctions, matches };
  });
  app.post('/api/admin/users/:id/role', async (req) => {
    requireRole(req.user, 'admin');
    const { role } = req.body || {};
    if (!['player', 'support', 'moderator', 'admin', 'owner'].includes(role)) throw badRequest('bad role');
    await app.db.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
    await app.audit(req.user.id, 'admin.set_role', req.params.id, { role });
    return { ok: true };
  });
  app.post('/api/admin/users/:id/delete', async (req) => {
    requireRole(req.user, 'admin');
    await app.db.query('UPDATE users SET status = $1, password_hash = $2 WHERE id = $3', ['deleted', 'x', req.params.id]);
    await app.audit(req.user.id, 'admin.delete_user', req.params.id);
    return { ok: true };
  });

  // ── issues (crashes) ─────────────────────────────────────────
  app.get('/api/admin/issues', async (req) => {
    requireRole(req.user, 'support');
    const { status, kind } = req.query;
    const p = []; let sql = 'SELECT * FROM issues'; const w = [];
    if (status) { p.push(status); w.push(`status = $${p.length}`); }
    if (kind) { p.push(kind); w.push(`kind = $${p.length}`); }
    if (w.length) sql += ' WHERE ' + w.join(' AND ');
    sql += ' ORDER BY last_at DESC LIMIT 100';
    return (await app.db.query(sql, p)).rows;
  });
  app.get('/api/admin/issues/:id', async (req) => {
    requireRole(req.user, 'support');
    const issue = await app.db.queryOne('SELECT * FROM issues WHERE id = $1', [req.params.id]);
    if (!issue) throw badRequest('no such issue');
    const reports = (await app.db.query('SELECT id, message, platform, version, renderer, created_at FROM reports WHERE issue_id = $1 ORDER BY created_at DESC LIMIT 20', [issue.id])).rows;
    return { issue, reports };
  });
  app.patch('/api/admin/issues/:id', async (req) => {
    requireRole(req.user, 'support');
    const { status } = req.body || {};
    if (!['open', 'resolved', 'ignored', 'regressed'].includes(status)) throw badRequest('bad status');
    await app.db.query('UPDATE issues SET status = $1 WHERE id = $2', [status, req.params.id]);
    await app.audit(req.user.id, 'admin.issue_' + status, req.params.id);
    return { ok: true };
  });

  // ── announcements ────────────────────────────────────────────
  app.get('/api/admin/announcements', async (req) => {
    requireRole(req.user, 'moderator');
    return (await app.db.query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50')).rows;
  });
  app.post('/api/admin/announcements', async (req) => {
    requireRole(req.user, (req.body || {}).severity === 'critical' ? 'admin' : 'moderator');
    const { title, body, severity, audience, ends_at } = req.body || {};
    if (!title) throw badRequest('title required');
    await app.db.query('INSERT INTO announcements (title, body, severity, audience, ends_at, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [title, body || null, severity || 'info', audience || 'all', ends_at ? new Date(ends_at) : null, req.user.id]);
    return { ok: true };
  });
  app.delete('/api/admin/announcements/:id', async (req) => {
    requireRole(req.user, 'moderator');
    await app.db.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  // ── matches / disputes ───────────────────────────────────────
  app.get('/api/admin/matches', async (req) => {
    requireRole(req.user, 'support');
    const { status } = req.query;
    const p = []; let sql = 'SELECT m.*, u.display_name AS host_name FROM matches m LEFT JOIN users u ON u.id = m.host_id';
    if (status) { p.push(status); sql += ' WHERE m.status = $1'; }
    sql += ' ORDER BY m.created_at DESC LIMIT 100';
    return (await app.db.query(sql, p)).rows;
  });
  app.post('/api/admin/matches/:id/resolve', async (req) => {
    requireRole(req.user, 'support');
    const { winner } = req.body || {};
    const results = app.results;
    const r = await results.resolve(req.params.id, winner, req.user.id);
    await app.audit(req.user.id, 'admin.resolve_match', req.params.id, { winner });
    return r;
  });

  // ── live config ──────────────────────────────────────────────
  app.get('/api/admin/config', async (req) => {
    requireRole(req.user, 'admin');
    const rows = await app.db.query('SELECT key, value FROM remote_config');
    const out = {}; for (const r of rows.rows) out[r.key] = r.value;
    return out;
  });
  app.put('/api/admin/config/:key', async (req) => {
    requireRole(req.user, 'admin');
    await app.configStore.set(req.params.key, req.body, req.user.id);
    return { ok: true };
  });

  // ── ops ──────────────────────────────────────────────────────
  app.get('/api/admin/ops', async (req) => {
    requireRole(req.user, 'admin');
    const keys = Object.keys(app.keys.publicKeys());
    const hb = (await app.db.query('SELECT job, max(at) AS last FROM ops_heartbeats GROUP BY job')).rows;
    const alerts = (await app.db.query('SELECT kind, message, acked, at FROM ops_alerts WHERE NOT acked ORDER BY at DESC LIMIT 20')).rows;
    return { ticketKeys: keys, signers: keys, heartbeats: hb, alerts };
  });
  app.post('/api/admin/ops/check', async (req) => {
    requireRole(req.user, 'admin');
    const dbOk = await app.db.health().catch(() => false);
    await app.db.query('INSERT INTO ops_heartbeats (job) VALUES ($1)', ['manual-check']);
    return { db: dbOk, uptime: Math.round(process.uptime()) };
  });
  app.post('/api/admin/keys/rotate', async (req) => {
    requireRole(req.user, 'admin');
    const kid = await app.keys.rotate();
    await app.audit(req.user.id, 'admin.keys_rotate', kid);
    return { ok: true, signer: kid };
  });

  // ── audit log ────────────────────────────────────────────────
  app.get('/api/admin/audit', async (req) => {
    requireRole(req.user, 'admin');
    const { limit } = req.query;
    const rows = await app.db.query('SELECT al.*, u.display_name AS actor FROM audit_log al LEFT JOIN users u ON u.id = al.actor_id ORDER BY al.id DESC LIMIT $1', [Math.min(200, +limit || 50)]);
    return rows.rows;
  });

  // ── perf ─────────────────────────────────────────────────────
  app.get('/api/admin/perf', async (req) => {
    requireRole(req.user, 'support');
    const rows = await app.db.query('SELECT device_class, count(*) n, avg(fps_avg) avg, min(fps_min) min FROM perf_runs WHERE created_at > now() - interval \'7 days\' GROUP BY device_class');
    return rows.rows;
  });
}
