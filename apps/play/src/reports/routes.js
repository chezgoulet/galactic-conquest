// Crash / bug + performance reports. Anonymous-friendly: the client scrubs
// identifiers before sending and we fingerprint the crash so repeats collapse
// into one issue. Screenshots are a capped data-URI.
import crypto from 'node:crypto';

const MAX_REPORT = 1.2 * 1024 * 1024;
const MAX_STACK = 8000;

function fingerprint(kind, message, stack) {
  // collapse repeated crashes: sanitize numbers and use the message + top frame names
  const clean = (s) => String(s || '').replace(/0x[0-9a-f]+/gi, '#').replace(/\d+/g, '#').trim();
  const msg = clean(String(message || '').split('\n')[0]);
  const fns = [];
  if (stack) {
    for (const line of String(stack).split('\n')) {
      const m = line.trim().match(/^at\s+([^\s(]+)\s*(\()?/);
      if (!m) continue;
      const fn = m[1];
      if (/^node:|^node_modules|internal\//.test(fn)) continue;
      fns.push(fn);
      if (fns.length >= 3) break;
    }
  }
  return crypto.createHash('sha256').update([kind, msg, fns.join(' ')].join('|')).digest('hex').slice(0, 32);
}

export function buildReportRoutes(app) {
  app.post('/api/reports', async (req) => {
    const b = req.body || {};
    if (JSON.stringify(b).length > MAX_REPORT) return { error: 'too_large' };
    const kind = b.kind === 'bug' ? 'bug' : 'crash';
    const fp = fingerprint(kind, b.message, b.stack);
    const existing = await app.db.queryOne('SELECT * FROM issues WHERE fingerprint = $1', [fp]);
    let issue;
    if (existing && existing.status !== 'ignored') {
      await app.db.query('UPDATE issues SET count = count + 1, last_at = now(), title = COALESCE($1, title) WHERE id = $2', [b.title || null, existing.id]);
      issue = existing;
    } else {
      const r = await app.db.query('INSERT INTO issues (fingerprint, kind, title, versions, platforms) VALUES ($1,$2,$3,$4,$5) RETURNING id', [fp, kind, (b.title || String(b.message || 'crash').split('\n')[0]).slice(0, 200), JSON.stringify({ [b.version || 'unknown']: true }), JSON.stringify({ [b.platform || 'web']: true })]);
      issue = { id: r.rows[0].id };
    }
    const rid = (await app.db.query(
      'INSERT INTO reports (user_id, issue_id, version, platform, renderer, message, stack, description, context, screenshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      [req.user ? req.user.id : null, issue.id, b.version || null, b.platform || null, b.renderer || null, String(b.message || '').slice(0, 2000), String(b.stack || '').slice(0, MAX_STACK), String(b.description || '').slice(0, 4000), b.context ? JSON.stringify(b.context) : null, b.screenshot ? String(b.screenshot).slice(0, 1024 * 1024) : null]
    )).rows[0].id;
    return { ok: true, issue: issue.id, report: rid };
  });

  app.post('/api/perf', async (req) => {
    const b = req.body || {};
    if (!b.fps_avg || !b.frames) return { ok: false };
    await app.db.query('INSERT INTO perf_runs (user_id, version, device_class, fps_avg, fps_min, frames, payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [req.user ? req.user.id : null, b.version || null, b.device_class || null, +b.fps_avg, +b.fps_min, +b.frames, b.payload ? JSON.stringify(b.payload) : null]);
    return { ok: true };
  });
}
