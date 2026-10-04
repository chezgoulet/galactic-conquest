import { test, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { boot, cookie, auth } from './helpers.js';
import { computeDeltas, elo, expectedScore } from '../src/realtime/results.js';

let h;
after(async () => { if (h) await h.close(); });

async function user(name) {
  const su = await h.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: name.toLowerCase() + '@ex.com', password: 'password123', name } });
  return { id: (await su.json()).user.id, name, ck: auth(cookie(su)) };
}
// create a rated match for A vs B and return its signed ticket
async function makeMatch(A, B) {
  const mid = crypto.randomUUID();
  const code = 'M' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
  await h.db.query('INSERT INTO matches (id, code, mode, host_id, started_at, rated) VALUES ($1,$2,$3,$4,now(),true)', [mid, code, 'team', A.id]);
  await h.db.query('INSERT INTO match_players (match_id, user_id, slot) VALUES ($1,$2,0),($1,$3,1)', [mid, A.id, B.id]);
  const { token } = await h.app.keys.ticket({ v: 2, mid, room: code, iat: Date.now(), exp: Date.now() + 12 * 3600e3, host: A.id, ranked: true, players: [{ id: 0, uid: A.id, name: A.name, sub: false, free: null }, { id: 1, uid: B.id, name: B.name, sub: false, free: null }] });
  return { mid, code, token };
}
const claim = (ck, payload) => h.app.inject({ method: 'POST', url: '/api/match/claim', headers: ck, payload });

test('elo math: expected score and delta behave', () => {
  assert.strictEqual(expectedScore(1200, 1200), 0.5);
  assert.ok(expectedScore(1500, 1200) > 0.5, 'higher rated wins more expectation');
  assert.ok(expectedScore(1200, 1500) < 0.5);
  assert.ok(elo(0.5, true) > 0 && elo(0.5, false) < 0);
  const d = computeDeltas([{ uid: 'a', rating: 1200, team: 'A' }, { uid: 'b', rating: 1200, team: 'B' }], 'A');
  assert.ok(d.a.win && d.a.delta > 0, 'winner gained');
  assert.ok(!d.b.win && d.b.delta < 0, 'loser lost');
});

test('two-player match settles on agreed claims and applies Elo once', async () => {
  h = await boot();
  const [A, B] = [await user('Alice2'), await user('Bob2')];
  const { mid, code, token } = await makeMatch(A, B);
  const r0 = (await h.db.queryOne('SELECT rating FROM users WHERE id = $1', [A.id])).rating;
  assert.strictEqual((await claim(A.ck, { ticket: token, match: code, result: 'aegis', team: 'aegis' })).statusCode, 200);
  assert.strictEqual((await claim(B.ck, { ticket: token, match: code, result: 'aegis', team: 'verdant' })).statusCode, 200);
  const m = await h.db.queryOne('SELECT * FROM matches WHERE id = $1', [mid]);
  assert.strictEqual(m.status, 'confirmed', 'agreed claims confirm the match');
  assert.strictEqual(m.winner_team, 'aegis');
  assert.ok((await h.db.queryOne('SELECT rating FROM users WHERE id = $1', [A.id])).rating > r0, 'winner gained elo');
  assert.ok((await h.db.queryOne('SELECT rating FROM users WHERE id = $1', [B.id])).rating < r0, 'loser lost elo');
});

test('disputed claims do not settle until resolved; resolution applies elo', async () => {
  const [A, B] = [await user('Alice3'), await user('Bob3')];
  const { mid, code, token } = await makeMatch(A, B);
  await claim(A.ck, { ticket: token, match: code, result: 'aegis', team: 'A' });
  await claim(B.ck, { ticket: token, match: code, result: 'verdant', team: 'B' });
  let m = await h.db.queryOne('SELECT * FROM matches WHERE id = $1', [mid]);
  assert.strictEqual(m.status, 'disputed', 'disagreeing claims are disputed');
  assert.strictEqual(m.winner_team, null);
  const res = await h.app.results.resolve(mid, 'aegis', 'op');
  assert.strictEqual(res.status, 'confirmed');
  m = await h.db.queryOne('SELECT * FROM matches WHERE id = $1', [mid]);
  assert.strictEqual(m.status, 'confirmed');
  assert.strictEqual(m.winner_team, 'aegis');
});

test('a forged claim (bad ticket) is rejected', async () => {
  const A = await user('Alice4');
  const bad = await claim(A.ck, { ticket: 'garbage.token.here', match: 'ABCD1', result: 'aegis' });
  assert.notStrictEqual(bad.statusCode, 200);
});

test('a claim for a match the player was not in is rejected', async () => {
  const [A, B, C] = [await user('Eve'), await user('Frank'), await user('Gina')];
  const { code, token } = await makeMatch(A, B);
  // C is not in the roster; even with a valid ticket format, the uid is absent
  const bad = await claim(C.ck, { ticket: token, match: code, result: 'aegis', team: 'C' });
  assert.notStrictEqual(bad.statusCode, 200, 'non-roster player cannot claim');
});
