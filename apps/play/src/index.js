// Boot: load config, open+migrate the db, build the app, listen. SIGTERM/SIGINT
// shut down cleanly. This is the production entrypoint; tests call buildApp
// directly with an in-memory PGlite.
import { loadConfig } from './config.js';
import { openAndMigrate } from './db/index.js';
import { buildApp } from './app.js';

const cfg = loadConfig();
process.env.NODE_ENV = cfg.NODE_ENV;

let app, db;
try {
  db = await openAndMigrate(cfg);
  app = await buildApp(cfg, db);
  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  app.log = { info: (m) => process.stderr.write(m + '\n'), error: (m) => process.stderr.write('ERROR ' + m + '\n') };
  app.log.info(`play service ready on :${cfg.PORT} (db=${cfg.dbMode}, env=${cfg.NODE_ENV})`);
} catch (e) {
  process.stderr.write('boot failed: ' + (e && e.stack || e) + '\n');
  process.exit(1);
}

async function shutdown(sig) {
  process.stderr.write('\n' + sig + ' received, shutting down\n');
  try { if (app) await app.close(); } catch {}
  try { if (db) await db.close(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
