// Test helper: boots the real Fastify app in-process on an in-memory PGlite.
import { loadConfig } from '../src/config.js';
import { openAndMigrate } from '../src/db/index.js';
import { buildApp } from '../src/app.js';

export const SECRET = 'test-secret-0123456789';

export async function boot() {
  const cfg = loadConfig({ NODE_ENV: 'test', SECRET_KEY: SECRET, RATE_LIMIT: '0', TURN_SECRET: 'turn-test-secret' });
  const db = await openAndMigrate(cfg);
  const app = await buildApp(cfg, db);
  return { cfg, db, app,
    close: async () => { await app.close(); await db.close(); } };
}

export const auth = (cookies) => ({ cookie: (cookies || []).map((c) => c.name + '=' + c.value).join('; ') });
export const cookie = (res) => res.cookies || [];

// The realtime tests open real WS connections; the http server won't fully close
// until they drain. Zero its connection count so app.close() doesn't hang.
export async function close(h) {
  try {
    const s = h.app.server;
    if (s && s._connections) s._connections = 0;
  } catch {}
  try { if (h.ws && h.ws.close) h.ws.close(); } catch {}
  await h.close();
}
