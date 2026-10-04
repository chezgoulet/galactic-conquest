import { test, after } from 'node:test';
import assert from 'node:assert';
import { boot, cookie, auth } from './helpers.js';

let h;
after(async () => { if (h) await h.close(); });

test('crash reports collapse by fingerprint into one issue', async () => {
  h = await boot();
  const msg = 'Uncaught TypeError: cannot read property (reading \'foo\')';
  const r1 = await h.app.inject({ method: 'POST', url: '/api/reports', payload: { kind: 'crash', message: msg, stack: 'at World.update (game.js:100:5)\nat frame (game.js:80:1)', version: '0.1.0', platform: 'web' } });
  assert.strictEqual(r1.statusCode, 200);
  const issue1 = (await r1.json()).issue;
  // same crash repeating (identical message, different line numbers)
  const r2 = await h.app.inject({ method: 'POST', url: '/api/reports', payload: { kind: 'crash', message: msg, stack: 'at World.update (game.js:101:5)\nat frame (game.js:81:1)', version: '0.1.0', platform: 'web' } });
  assert.strictEqual((await r2.json()).issue, issue1, 'repeats collapse into the same issue');
  const count = (await h.db.queryOne('SELECT count FROM issues WHERE id = $1', [issue1])).count;
  assert.strictEqual(count, 2, 'issue count incremented');
  // a genuinely different crash makes a new issue
  const r3 = await h.app.inject({ method: 'POST', url: '/api/reports', payload: { kind: 'crash', message: 'Uncaught RangeError: maximum call stack', stack: 'at explode (bad.js:9:1)', version: '0.1.0', platform: 'web' } });
  assert.notStrictEqual((await r3.json()).issue, issue1, 'a different crash is a different issue');
});

test('perf runs are recorded', async () => {
  const r = await h.app.inject({ method: 'POST', url: '/api/perf', payload: { fps_avg: 58, fps_min: 22, frames: 3000, version: '0.1.0', device_class: 'desktop' } });
  assert.strictEqual(r.statusCode, 200);
  const n = (await h.db.queryOne('SELECT count(*) AS n FROM perf_runs')).n;
  assert.ok(n >= 1);
});
