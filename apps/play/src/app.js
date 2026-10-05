// Fastify app assembly: plugins, auth hook, route registration, static admin,
// websocket signalling hub. buildApp(cfg) returns a started app so tests can
// app.inject() it in-process.
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthService } from './auth/service.js';
import { Keyring } from './ops/keys.js';
import { HttpError } from './context.js';
import { createWsServer } from './realtime/ws.js';
import { buildRoutes } from './routes/public.js';
import { buildAuthRoutes } from './auth/routes.js';
import { buildMeRoutes } from './auth/me.js';
import { buildAdminRoutes } from './admin/routes.js';
import { buildReportRoutes } from './reports/routes.js';
import { buildModerationRoutes } from './moderation/routes.js';
import { buildHub } from './realtime/hub.js';
import { Results } from './realtime/results.js';
import { buildResultsRoutes } from './realtime/routes.js';
import { buildCloudRoutes } from './cloud/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp(cfg, db) {
  const app = Fastify({
    logger: false,
    trustProxy: cfg.TRUST_PROXY === '1',
    bodyLimit: 2 * 1024 * 1024,
  });
  app.decorate('db', db);
  app.register(cookie, { secret: cfg.SECRET_KEY });
  if (cfg.RATE_LIMIT > 0) app.register(rateLimit, { max: cfg.RATE_LIMIT, timeWindow: '1 minute' });

  // services
  const auth = new AuthService(app.db, cfg);
  const keys = new Keyring(app.db, cfg.SECRET_KEY);
  await keys.load();
  const results = new Results(app.db, keys);
  app.decorate('auth', auth);
  app.decorate('keys', keys);
  app.decorate('results', results);
  app.decorate('cfg', cfg);
  app.decorate('configStore', {
    async get(k, d) { const r = await app.db.queryOne('SELECT value FROM remote_config WHERE key = $1', [k]); return r ? r.value : d; },
    async set(k, v, actor) {
      await app.db.query('INSERT INTO remote_config (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2', [k, JSON.stringify(v)]);
      if (actor) await app.audit(actor, 'config.set', k, v);
    },
  });
  app.decorate('audit', (actor, action, target, detail) => {
    app.db.query('INSERT INTO audit_log (actor_id, action, target, detail) VALUES ($1,$2,$3,$4)', [actor, action, target, JSON.stringify(detail || null)]).catch(() => {});
  });

  // error handler: map HttpError -> status, everything else -> 500 (logged)
  app.setErrorHandler((err, req, res) => {
    if (err instanceof HttpError) return res.status(err.status).send({ error: err.code, message: err.message });
    const status = err.statusCode || 500;
    if (status >= 500) req.log.error(err);
    return res.status(status).send({ error: 'error', message: err.message });
  });

  // auth hook: populate request.user from the gc_session cookie / Bearer token
  app.addHook('onRequest', async (req) => {
    const token = req.cookies.gc_session || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return;
    const v = await auth.validateSession(token);
    if (v) req.user = v.user;
  });

  buildRoutes(app);
  buildAuthRoutes(app);
  buildMeRoutes(app);
  buildReportRoutes(app);
  buildModerationRoutes(app);
  buildAdminRoutes(app);
  buildResultsRoutes(app);
  buildCloudRoutes(app);

  // admin console (vanilla JS) served at /admin
  app.register(staticPlugin, { root: path.join(__dirname, '..', 'public'), prefix: '/', decorateReply: false });

  // websocket signalling hub: a zero-dep RFC 6455 server on the raw http server.
  // @fastify/websocket's handler contract is unreliable in this environment, so
  // we handle the upgrade ourselves (same proven codec as the LAN server).
  const hub = buildHub(app);
  const ws = createWsServer({ path: '/ws', onConnection: (socket) => hub.attach(socket) });
  app.addHook('onReady', async () => { if (app.server) ws.attach(app.server); });
  app.addHook('onClose', async () => { ws.close(); });

  return app;
}
