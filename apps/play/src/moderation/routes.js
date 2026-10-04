// Player-to-player reports + sanctions. Players report cheating/harassment;
// moderators resolve with a sanction. Sanctions are recorded and the target's
// status/limits updated accordingly.
import { unauthorized, requireRole, badRequest } from '../context.js';

const Kinds = {
  warn: { role: 'moderator' }, mute: { role: 'moderator' }, suspend: { role: 'moderator' },
  ban: { role: 'admin' }, rename: { role: 'moderator' }, reset_mfa: { role: 'admin' },
};

export function buildModerationRoutes(app) {
  // a player reports another player
  app.post('/api/player-reports', async (req) => {
    if (!req.user) throw unauthorized();
    const { target, reason, details, match_id } = req.body || {};
    if (!target) throw badRequest('target required');
    if (!['cheating', 'harassment', 'name', 'spam', 'griefing', 'other'].includes(reason)) throw badRequest('bad reason');
    await app.db.query('INSERT INTO player_reports (reporter_id, target_id, reason, details, match_id) VALUES ($1,$2,$3,$4,$5)', [req.user.id, target, reason, String(details || '').slice(0, 1000), match_id || null]);
    return { ok: true };
  });

  // admin: list reports
  app.get('/api/admin/player-reports', async (req) => {
    requireRole(req.user, 'moderator');
    const { status } = req.query;
    const rows = status
      ? await app.db.query('SELECT pr.*, u.display_name AS target_name FROM player_reports pr JOIN users u ON u.id = pr.target_id WHERE pr.status = $1 ORDER BY pr.created_at DESC LIMIT 100', [status])
      : await app.db.query('SELECT pr.*, u.display_name AS target_name FROM player_reports pr JOIN users u ON u.id = pr.target_id ORDER BY pr.created_at DESC LIMIT 100');
    return rows.rows;
  });

  // admin: resolve a report with a sanction
  app.post('/api/admin/player-reports/:id/resolve', async (req) => {
    requireRole(req.user, 'moderator');
    const { resolution, sanction, until, reason } = req.body || {};
    const row = await app.db.queryOne('SELECT * FROM player_reports WHERE id = $1', [req.params.id]);
    if (!row) throw badRequest('no such report');
    await app.db.query('UPDATE player_reports SET status = $1, resolved_by = $2, resolved_at = now(), resolution = $3 WHERE id = $4', ['actioned', req.user.id, reason || resolution, row.id]);
    if (sanction) await applySanction(app, req.user, row.target_id, sanction, until, reason, row.id);
    return { ok: true };
  });

  // admin: sanction a user directly
  app.post('/api/admin/users/:id/sanction', async (req) => {
    requireRole(req.user, Kinds[(req.body || {}).kind] ? Kinds[req.body.kind].role : 'admin');
    const { kind, until, reason } = req.body || {};
    if (!Kinds[kind]) throw badRequest('unknown sanction');
    requireRole(req.user, Kinds[kind].role);
    await applySanction(app, req.user, req.params.id, kind, until, reason, null);
    return { ok: true };
  });
}

export async function applySanction(app, actor, userId, kind, until, reason, reportId) {
  const u = await app.db.queryOne('SELECT * FROM users WHERE id = $1', [userId]);
  if (!u) throw badRequest('no such user');
  await app.db.query('INSERT INTO sanctions (user_id, kind, reason, until, by_user, report_id) VALUES ($1,$2,$3,$4,$5,$6)', [userId, kind, reason || null, until ? new Date(until) : null, actor && actor.id, reportId || null]);
  if (kind === 'ban') await app.db.query('UPDATE users SET status = $1 WHERE id = $2', ['banned', userId]);
  else if (kind === 'suspend') await app.db.query('UPDATE users SET status = $1, suspended_until = $2 WHERE id = $3', ['suspended', until ? new Date(until) : null, userId]);
  else if (kind === 'mute') await app.db.query('UPDATE users SET muted_until = $1 WHERE id = $2', [until ? new Date(until) : null, userId]);
  else if (kind === 'rename') await app.db.query('UPDATE users SET display_name = $1 WHERE id = $2', [u.display_name + '_x' + Date.now().toString().slice(-4), userId]);
  await app.audit(actor && actor.id, 'sanction.' + kind, u.name_key, { until, reason });
}
