// /api/cloud: per-account save slots, backed by the cloud_items table. A slot is
// a JSON blob with a version; PUT may carry the version the client last saw, and
// a mismatch is a 409 so two devices cannot silently clobber each other.
import { badRequest, unauthorized, notFound, conflict } from '../context.js';

const MAX_SIZE = 256 * 1024;            // 256 KB per slot
const KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const sizeOf = (v) => Buffer.byteLength(JSON.stringify(v == null ? null : v), 'utf8');

export function buildCloudRoutes(app) {
  const me = async (req) => { if (!req.user) throw unauthorized(); return req.user; };
  const keyOf = (req) => { const k = String((req.params && req.params.key) || ''); if (!KEY_RE.test(k)) throw badRequest('bad key'); return k; };

  app.get('/api/cloud', async (req) => {
    const u = await me(req);
    const rows = await app.db.query('SELECT key, version, size, updated_at FROM cloud_items WHERE user_id = $1 ORDER BY key', [u.id]);
    return rows.rows.map((r) => ({ key: r.key, version: Number(r.version), size: r.size, updated: r.updated_at }));
  });

  app.get('/api/cloud/:key', async (req) => {
    const u = await me(req), key = keyOf(req);
    const row = await app.db.queryOne('SELECT value, version, size, updated_at FROM cloud_items WHERE user_id = $1 AND key = $2', [u.id, key]);
    if (!row) throw notFound('no such save');
    return { key, value: row.value, version: Number(row.version), size: row.size, updated: row.updated_at };
  });

  app.put('/api/cloud/:key', async (req) => {
    const u = await me(req), key = keyOf(req), body = req.body || {};
    if (!('value' in body)) throw badRequest('missing value');
    const size = sizeOf(body.value);
    if (size > MAX_SIZE) throw badRequest('save too large');
    const cur = await app.db.queryOne('SELECT version FROM cloud_items WHERE user_id = $1 AND key = $2', [u.id, key]);
    if (body.version != null && cur && Number(cur.version) !== Number(body.version)) throw conflict('save changed on another device');
    const next = (cur ? Number(cur.version) : 0) + 1;
    await app.db.query(
      'INSERT INTO cloud_items (user_id, key, value, version, size, updated_at) VALUES ($1,$2,$3::jsonb,$4,$5,now()) ON CONFLICT (user_id, key) DO UPDATE SET value = $3::jsonb, version = $4, size = $5, updated_at = now()',
      [u.id, key, JSON.stringify(body.value), next, size]);
    return { key, version: next, size };
  });

  app.delete('/api/cloud/:key', async (req) => {
    const u = await me(req), key = keyOf(req);
    await app.db.query('DELETE FROM cloud_items WHERE user_id = $1 AND key = $2', [u.id, key]);
    return { ok: true };
  });
}
