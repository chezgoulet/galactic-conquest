import { test, after } from 'node:test';
import assert from 'node:assert';
import { boot, cookie, auth } from './helpers.js';

let h;
after(async () => { if (h) await h.close(); });

async function mk(name, role) {
  const su = await h.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: name.toLowerCase() + '@ex.com', password: 'password123', name } });
  const id = (await su.json()).user.id;
  if (role) await h.db.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
  return { id, name, ck: auth(cookie(su)) };
}

test('admin routes are role-gated (player 403, support 200)', async () => {
  h = await boot();
  const [pl, sup, adm] = [await mk('P', 'player'), await mk('S', 'support'), await mk('A', 'admin')];
  // dashboard: support ok, player forbidden
  assert.strictEqual((await h.app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: sup.ck })).statusCode, 200);
  assert.strictEqual((await h.app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: pl.ck })).statusCode, 403);
  // config is admin-only
  assert.strictEqual((await h.app.inject({ method: 'GET', url: '/api/admin/config', headers: adm.ck })).statusCode, 200);
  assert.strictEqual((await h.app.inject({ method: 'GET', url: '/api/admin/config', headers: sup.ck })).statusCode, 403);
});

test('dashboard returns live counters', async () => {
  const d = await (await h.app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: (await mk('S2', 'support')).ck })).json();
  assert.ok(d.users >= 3, 'counts users');
  assert.ok(Array.isArray(d.topCrashes));
  assert.ok(Array.isArray(d.daySeries));
});

test('admin can change a user role (audited)', async () => {
  const adm = await mk('A2', 'admin');
  const tgt = await mk('T', 'player');
  await h.app.inject({ method: 'POST', url: '/api/admin/users/' + tgt.id + '/role', headers: adm.ck, payload: { role: 'moderator' } });
  const u = (await h.db.queryOne('SELECT role FROM users WHERE id = $1', [tgt.id])).role;
  assert.strictEqual(u, 'moderator');
  const audit = (await h.db.query('SELECT * FROM audit_log WHERE action = $1 ORDER BY id DESC LIMIT 1', ['admin.set_role'])).rows[0];
  assert.ok(audit, 'role change is audited');
});

test('admin can publish + list announcements', async () => {
  const adm = await mk('A3', 'admin');
  assert.strictEqual((await h.app.inject({ method: 'POST', url: '/api/admin/announcements', headers: adm.ck, payload: { title: 'Server down 10 min', severity: 'info' } })).statusCode, 200);
  const list = await (await h.app.inject({ method: 'GET', url: '/api/admin/announcements', headers: adm.ck })).json();
  assert.ok(list.some((a) => a.title === 'Server down 10 min'));
  // public endpoint sees it too
  const pub = await (await h.app.inject({ method: 'GET', url: '/api/announcements' })).json();
  assert.ok(pub.some((a) => a.title === 'Server down 10 min'));
});

test('admin live config set + get roundtrip', async () => {
  const adm = await mk('A4', 'admin');
  assert.strictEqual((await h.app.inject({ method: 'PUT', url: '/api/admin/config/maintenance', headers: adm.ck, payload: true })).statusCode, 200);
  const c = await (await h.app.inject({ method: 'GET', url: '/api/admin/config', headers: adm.ck })).json();
  assert.strictEqual(c.maintenance, true);
});

test('moderator can resolve a player report with a sanction', async () => {
  const mod = await mk('M', 'moderator');
  const reporter = await mk('R', 'player');
  const target = await mk('Bad', 'player');
  const rep = await h.app.inject({ method: 'POST', url: '/api/player-reports', headers: reporter.ck, payload: { target: target.id, reason: 'cheating', details: 'aimbot' } });
  assert.strictEqual(rep.statusCode, 200);
  const list = await (await h.app.inject({ method: 'GET', url: '/api/admin/player-reports?status=open', headers: mod.ck })).json();
  const row = list.find((r) => r.target_id === target.id);
  assert.ok(row, 'report is listed');
  await h.app.inject({ method: 'POST', url: '/api/admin/player-reports/' + row.id + '/resolve', headers: mod.ck, payload: { sanction: 'suspend', until: '2030-01-01', reason: 'cheating' } });
  const u = (await h.db.queryOne('SELECT status, suspended_until FROM users WHERE id = $1', [target.id]));
  assert.strictEqual(u.status, 'suspended', 'sanction suspended the target');
});

test('admin match dispute resolution', async () => {
  const adm = await mk('A5', 'admin');
  const [A, B] = [await mk('X', 'player'), await mk('Y', 'player')];
  const crypto = await import('node:crypto');
  const mid = crypto.randomUUID(); const code = 'DISP1';
  await h.db.query('INSERT INTO matches (id, code, mode, host_id, started_at, rated, status) VALUES ($1,$2,$3,$4,now(),true,$5)', [mid, code, 'team', A.id, 'disputed']);
  await h.db.query('INSERT INTO match_players (match_id, user_id, slot) VALUES ($1,$2,0),($1,$3,1)', [mid, A.id, B.id]);
  const list = await (await h.app.inject({ method: 'GET', url: '/api/admin/matches?status=disputed', headers: adm.ck })).json();
  assert.ok(list.some((m) => m.code === code));
  const res = await h.app.inject({ method: 'POST', url: '/api/admin/matches/' + mid + '/resolve', headers: adm.ck, payload: { winner: 'aegis' } });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual((await h.db.queryOne('SELECT status FROM matches WHERE id = $1', [mid])).status, 'confirmed');
});

test('audit log records admin actions', async () => {
  const adm = await mk('A6', 'admin');
  await h.app.inject({ method: 'PUT', url: '/api/admin/config/flag', headers: adm.ck, payload: 1 });
  const rows = (await h.app.inject({ method: 'GET', url: '/api/admin/audit', headers: adm.ck })).json();
  assert.ok(rows.some((r) => r.action === 'config.set'), 'config change audited');
});
