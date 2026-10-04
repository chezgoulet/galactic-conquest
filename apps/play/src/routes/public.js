// Public routes: health, client config, announcements.
import { HttpError } from '../context.js';

export function buildRoutes(app) {
  app.get('/healthz', async () => {
    const ok = await app.db.health().catch(() => false);
    if (!ok) throw new HttpError(503, 'db_down', 'database unreachable');
    return { ok: true, db: ok, uptime: Math.round(process.uptime()), version: app.cfg.version || '0.1.0' };
  });

  app.get('/api/config', async () => {
    const keys = app.keys.publicKeys();
    return {
      version: app.cfg.version || '0.1.0',
      minClientVersion: app.cfg.MIN_CLIENT_VERSION || '0.1.0',
      maintenance: await app.configStore.get('maintenance', false),
      freeMatchesPerDay: await app.configStore.get('freeMatchesPerDay', 3),
      membershipEnabled: app.cfg.MEMBERSHIP_ENABLED === '1',
      turnUrls: app.cfg.TURN_URLS,
      ticketKeys: keys,
      turnstileSiteKey: null,
    };
  });

  app.get('/api/announcements', async () => {
    const now = new Date().toISOString();
    const rows = await app.db.query(
      "SELECT title, body, severity, audience, starts_at, ends_at FROM announcements WHERE starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) ORDER BY created_at DESC LIMIT 20"
    );
    return rows.rows.map((r) => ({ title: r.title, body: r.body, severity: r.severity, startsAt: r.starts_at, endsAt: r.ends_at }));
  });

  // Prometheus-style metrics, token-gated
  app.get('/metrics', async (req, res) => {
    if (app.cfg.METRICS_TOKEN && req.headers['x-metrics-token'] !== app.cfg.METRICS_TOKEN) return res.status(401).send('unauthorized');
    const u = await app.db.query('SELECT count(*) AS n FROM users WHERE status <> $1', ['deleted']);
    const m = await app.db.query('SELECT count(*) AS n FROM matches');
    const i = await app.db.query('SELECT count(*) AS n FROM issues WHERE status = $1', ['open']);
    res.type('text/plain').send(
      `gc_users ${u.rows[0].n}\ngc_matches ${m.rows[0].n}\ngc_open_issues ${i.rows[0].n}\ngc_uptime_seconds ${Math.round(process.uptime())}\n`
    );
  });
}
