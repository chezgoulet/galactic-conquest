// A thin database interface. Production uses Postgres (pg); dev/test use
// PGlite (an in-process WASM Postgres) so the whole service runs with no
// external dependency. Migrations are plain .sql files applied in order; the
// same function works for both backends.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createDb({ DATABASE_URL, PGLITE_DIR }) {
  if (DATABASE_URL) return createPg(DATABASE_URL);
  return createPglite(PGLITE_DIR);
}

// ── Postgres ─────────────────────────────────────────────────────────────
async function createPg(url) {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url, max: 10 });
  return {
    kind: 'postgres',
    async query(text, params) { const r = await pool.query(text, params); return { rows: r.rows, rowCount: r.rowCount }; },
    async queryOne(text, params) { const r = await this.query(text, params); return r.rows[0] ?? null; },
    async exec(text) { await pool.query(text); },
    async close() { await pool.end(); },
    async health() { await pool.query('select 1'); return true; },
  };
}

// ── PGlite ───────────────────────────────────────────────────────────────
async function createPglite(dir) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = dir ? new PGlite(dir) : new PGlite(); // in-memory when no dir
  return {
    kind: 'pglite',
    async query(text, params) { const r = await db.query(text, params || []); return { rows: r.rows || [], rowCount: r.affectedRows ?? (r.rows ? r.rows.length : 0) }; },
    async queryOne(text, params) { const r = await this.query(text, params); return r.rows[0] ?? null; },
    async exec(text) { await db.query(text); },
    async close() { await db.close(); },
    async health() { await db.query('select 1'); return true; },
  };
}

// Apply NNN_*.sql migrations in order, tracking applied ones in schema_migrations.
// PGlite cannot run multi-statement prepared statements, so we split the file
// into individual statements (respecting single-quoted strings and comments).
export async function migrate(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const done = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const stmts = splitStatements(fs.readFileSync(path.join(dir, f), 'utf8'));
    try {
      for (const s of stmts) await db.exec(s);
      await db.exec(`INSERT INTO schema_migrations (name) VALUES ('${f}')`);
      process.stderr.write(`  migrated ${f}\n`);
    } catch (e) {
      throw new Error(`migration ${f} failed: ${e.message}`);
    }
  }
}

// split SQL on ';' at statement boundaries, ignoring quotes and comments
function splitStatements(sql) {
  const out = [];
  let cur = '', inS = false, inC = false, inBlock = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], n = sql[i + 1];
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } cur += c; continue; }
    if (inC) { if (c === '\n') { inC = false; } cur += c; continue; }
    if (inS) { if (c === "'") { if (n === "'") { cur += "''"; i++; } else inS = false; } cur += c; continue; }
    if (c === '-' && n === '-') { inC = true; cur += c; continue; }
    if (c === '/' && n === '*') { inBlock = true; cur += c; continue; }
    if (c === "'") { inS = true; cur += c; continue; }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function openAndMigrate(cfg) {
  return createDb({ DATABASE_URL: cfg.DATABASE_URL, PGLITE_DIR: cfg.PGLITE_DIR }).then((db) => migrate(db).then(() => db));
}
