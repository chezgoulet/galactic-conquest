/* Galactic Conquest admin console — hand-rolled vanilla JS, no framework.
   Role-gated sections; talks to /api/admin/* with the session cookie. */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');

async function api(path, opts = {}) {
  const r = await fetch('/api/admin/' + path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
  });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.message) || r.status);
  return data;
}

const SECTIONS = [
  ['dashboard', 'Dashboard', 'support'],
  ['crashes', 'Crashes & bugs', 'support'],
  ['reports', 'Player reports', 'moderator'],
  ['players', 'Players', 'support'],
  ['announcements', 'Announcements', 'moderator'],
  ['matches', 'Matches', 'support'],
  ['perf', 'Performance', 'support'],
  ['config', 'Live config', 'admin'],
  ['ops', 'Operations', 'admin'],
  ['audit', 'Audit log', 'admin'],
];

const app = { role: null, user: null };

function shell() {
  $('#app').innerHTML = `
    <div class="bar"><span class="logo">GALACTIC CONQUEST · ADMIN</span><span class="user">${esc(app.user ? app.user.name + ' · ' + app.user.role : '')}</span></div>
    <div class="wrap"><nav class="nav">${SECTIONS.filter(([, , r]) => rank(app.role) >= rank(r)).map(([id, label]) => `<a href="#/${id}" class="tab" data-id="${id}">${label}</a>`).join('')}</nav><main class="main" id="main"></main></div>`;
  $$('.tab').forEach((a) => a.onclick = () => location.hash = '#/' + a.dataset.id);
}
const rank = (r) => ({ player: 0, support: 1, moderator: 2, admin: 3, owner: 4 }[r] || 0);
const main = () => $('#main');
const page = (title, body) => { main().innerHTML = `<h1>${title}</h1>` + body; };
const card = (title, inner) => `<div class="card"><h2>${title}</h2>${inner}</div>`;
const tile = (label, val) => `<div class="tile"><span>${label}</span><b>${val}</b></div>`;
const btn = (label, fn) => `<button class="btn" data-fn="${fn}">${label}</button>`;
function wire(container) {
  $$('[data-fn]', container).forEach((b) => b.onclick = () => { try { globalThis[b.dataset.fn] && globalThis[b.dataset.fn](); } catch (e) { alert(e.message); } });
}
function table(head, rows) {
  return `<div class="tbl"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const empty = (m) => `<p class="dim">${m || 'Nothing here yet.'}</p>`;

// ── sections ───────────────────────────────────────────────────
async function dashboard() {
  const d = await api('dashboard');
  page('Dashboard', `
    <div class="tiles">${tile('Users', d.users)}${tile('Matches', d.matches)}${tile('Open issues', d.openIssues)}${tile('Open reports', d.openReports)}${tile('Signups (24h)', d.dau)}</div>
    ${card('Top crashes', d.topCrashes.length ? table(['Title', 'Kind', 'Count', 'Last'], d.topCrashes.map((c) => [`<a href="#/crashes">${esc(c.title)}</a>`, esc(c.kind), c.count, fmt(c.last_at)])) : empty('No open crashes.'))}
    ${card('Signups, 30 days', d.daySeries.length ? spark(d.daySeries) : empty('No data yet.'))}`);
  wire(main());
}
function spark(series) {
  const vals = series.map((r) => +r.value);
  const max = Math.max(1, ...vals), w = 560, h = 90, step = w / Math.max(1, vals.length - 1);
  const pts = vals.map((v, i) => `${i * step},${h - (v / max) * (h - 10)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" class="line"><polyline points="${pts}" fill="none" stroke="#58a0ff" stroke-width="2"/><polyline points="${pts}" fill="url(#g)" opacity=".15"/></svg>`;
}

async function crashes() {
  const issues = await api('issues');
  page('Crashes & bugs', issues.length ? table(['Fingerprint', 'Title', 'Kind', 'Status', 'Count', 'Last'], issues.map((c) => [`<code>${c.fingerprint.slice(0, 10)}</code>`, `<a data-issue="${c.id}">${esc(c.title || 'untitled')}</a>`, esc(c.kind), `<span class="st ${c.status}">${c.status}</span>`, c.count, fmt(c.last_at)])) : empty('No issues.'));
  wire(main());
  $$('.main [data-issue]').forEach((a) => a.onclick = async () => { const d = await api('issues/' + a.dataset.issue); const el = document.createElement('div'); el.innerHTML = card('Report detail', table(['Time', 'Platform', 'Message', 'Stack'], d.reports.map((r) => [fmt(r.created_at), esc(r.platform), `<code>${esc((r.message || '').slice(0, 140))}</code>`, `<pre class="stk">${esc((r.stack || '').slice(0, 500))}</pre>`])) + `<div class="row">${btn('Resolve', () => setIssue(a.dataset.issue, 'resolved'))}${btn('Ignore', () => setIssue(a.dataset.issue, 'ignored'))}</div>`); main().appendChild(el); wire(main()); });
  async function setIssue(id, status) { await api('issues/' + id, { method: 'PATCH', body: { status } }); crashes(); }
}

async function reports() {
  const rows = await api('player-reports');
  page('Player reports', rows.length ? table(['Target', 'Reason', 'Details', 'Status', 'When'], rows.map((r) => [`<a href="#/players?id=${r.target_id}">${esc(r.target_name)}</a>`, esc(r.reason), esc((r.details || '').slice(0, 120)), `<span class="st ${r.status}">${r.status}</span>`, fmt(r.created_at)])) : empty('No player reports.'));
}

async function players() {
  const q = (location.hash.match(/[?&]id=([\w-]+)/) || [])[1];
  if (q) return playerDetail(q);
  const rows = await api('users');
  page('Players', rows.length ? table(['Name', 'Email', 'Role', 'Status', 'Rating', 'Matches', 'Created'], rows.map((u) => [`<a data-u="${u.id}">${esc(u.display_name)}</a>`, esc(u.email), `<span class="st ${u.role}">${u.role}</span>`, `<span class="st ${u.status}">${u.status}</span>`, u.rating, `${u.wins}/${u.matches}`, fmt(u.created_at)])) : empty('No users.'));
  wire(main());
  $$('.main [data-u]').forEach((a) => a.onclick = () => location.hash = '#/players?id=' + a.dataset.u);
}
async function playerDetail(id) {
  const d = await api('users/' + id); const u = d.user;
  page('Player · ' + esc(u.display_name), `
    ${card('Profile', `<div class="kv"><span>id</span><code>${u.id}</code><span>email</span><span>${esc(u.email)}</span><span>role</span><b>${u.role}</b><span>status</span><b>${u.status}</b><span>rating</span><b>${u.rating}</b><span>record</span><b>${u.wins}W / ${u.matches - u.wins}L</b></div>`)}
    ${card('Sanctions', d.sanctions.length ? table(['Kind', 'Reason', 'Until', 'When'], d.sanctions.map((s) => [esc(s.kind), esc(s.reason), fmt(s.until), fmt(s.created_at)])) : empty('None.'))}
    ${card('Recent matches', d.matches.length ? table(['Winner', 'My result', 'Δ', 'When'], d.matches.map((m) => [esc(m.winner_team), esc(m.result), m.rating_delta, fmt(m.started_at)])) : empty('None.'))}
    <div class="row">${btn('Make moderator', () => setRole(id, 'moderator'))}${btn('Make admin', () => setRole(id, 'admin'))}${btn('Ban', () => sanc(id, 'ban', 'banned by admin'))}${btn('Delete', () => delUser(id))}</div>`);
  wire(main());
  async function setRole(id, role) { await api('users/' + id + '/role', { method: 'POST', body: { role } }); playerDetail(id); }
  async function sanc(id, kind, reason) { await api('users/' + id + '/sanction', { method: 'POST', body: { kind, reason } }); playerDetail(id); }
  async function delUser(id) { if (confirm('Delete this account?')) { await api('users/' + id + '/delete', { method: 'POST' }); location.hash = '#/players'; } }
}

async function announcements() {
  const rows = await api('announcements');
  page('Announcements', `
    ${card('New', `<form id="ann" class="form"><input name="title" placeholder="Title" required /><input name="body" placeholder="Body" /><select name="severity"><option>info</option><option>warning</option><option>critical</option></select><button class="btn">Publish</button></form>`)}
    ${rows.length ? table(['Title', 'Severity', 'Audience', 'When'], rows.map((a) => [esc(a.title), `<span class="st ${a.severity}">${a.severity}</span>`, esc(a.audience), fmt(a.created_at)])) : empty('None.'))}`);
  $('#ann').onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target); await api('announcements', { method: 'POST', body: Object.fromEntries(f) }); announcements(); };
}

async function matches() {
  const rows = await api('matches');
  page('Matches', rows.length ? table(['Code', 'Mode', 'Status', 'Winner', 'Rated', 'When'], rows.map((m) => [esc(m.code), esc(m.mode), `<span class="st ${m.status}">${m.status}</span>`, esc(m.winner_team), m.rated ? 'yes' : '', fmt(m.started_at)])) : empty('No matches.'));
}
async function perf() {
  const rows = await api('perf');
  page('Performance', rows.length ? table(['Device class', 'Runs', 'Avg FPS', 'Min FPS'], rows.map((r) => [esc(r.device_class || 'unknown'), r.n, Math.round(+r.avg), Math.round(+r.min)])) : empty('No perf runs yet.'));
}
async function config() {
  const c = await api('config');
  page('Live config', card('Values', `<pre class="cfg">${esc(JSON.stringify(c, null, 2))}</pre><div class="row"><input id="ck" placeholder="key" /><input id="cv" placeholder="JSON value" /><button class="btn" id="cs">Save</button></div>`));
  $('#cs').onclick = async () => { await api('config/' + encodeURIComponent($('#ck').value), { method: 'PUT', body: JSON.parse($('#cv').value || 'null') }); config(); };
}
async function ops() {
  const o = await api('ops');
  page('Operations', `
    ${card('Ticket keys', `<div class="kv">${o.signers.map((k) => `<span>key</span><code>${k}</code>`).join('')}</div><div class="row">${btn('Rotate key', () => rotate())}</div>`)}
    ${card('Heartbeats', o.heartbeats.length ? table(['Job', 'Last'], o.heartbeats.map((h) => [esc(h.job), fmt(h.last)])) : empty('None.'))}
    ${card('Alerts', o.alerts.length ? table(['Kind', 'Message', 'When'], o.alerts.map((a) => [esc(a.kind), esc(a.message), fmt(a.at)])) : empty('No active alerts.'))}`);
  wire(main());
  async function rotate() { await api('keys/rotate', { method: 'POST' }); ops(); }
}
async function audit() {
  const rows = await api('audit');
  page('Audit log', rows.length ? table(['When', 'Actor', 'Action', 'Target', 'Detail'], rows.map((r) => [fmt(r.at), esc(r.actor), esc(r.action), esc(r.target), `<code>${esc(JSON.stringify(r.detail))}</code>`])) : empty('No entries.'));
}

const ROUTES = { dashboard, crashes, reports, players, announcements, matches, perf, config, ops, audit };

async function boot() {
  try {
    const me = await (await fetch('/api/me', { credentials: 'include' })).json();
    if (me.error) throw new Error(me.message);
    app.user = me; app.role = me.role;
    if (rank(app.role) < 1) { $('#app').innerHTML = '<div class="boot">This console requires a staff account.</div>'; return; }
    shell();
    const route = () => { const id = (location.hash.replace('#/', '') || 'dashboard').split('?')[0]; (ROUTES[id] || dashboard)().catch((e) => main().innerHTML = `<h1>${id}</h1><p class="dim">${esc(e.message)}</p>`); };
    window.addEventListener('hashchange', route); route();
  } catch (e) {
    $('#app').innerHTML = `<div class="boot"><p>${esc(e.message)}</p><p class="dim">Sign in with a staff account to open the console.</p></div>`;
  }
}
boot();
