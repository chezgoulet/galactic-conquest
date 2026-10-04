// Results reconciliation + Elo. The service never watches the match; each
// player in the roster posts a claim about the outcome. A match is settled when
// it has a verdict:
//   • all claims agree on a winner  -> confirmed
//   • claims disagree (or one is missing) -> disputed, an operator resolves it
// Settlement applies the Elo delta (K=24) once per player and bumps their
// lifetime stats. Tickets are verified first so a client can't claim a match
// it was never in, or grant itself the win.

const K = 24, R0 = 1200, DELTA_CAP = 40;

export function elo(expected, won) { return Math.round(K * ((won ? 1 : 0) - expected)); }
export function expectedScore(rA, rB) { return 1 / (1 + Math.pow(10, (rB - rA) / 400)); }
export function computeDeltas(players, winner) {
  // players: [{uid, rating, team}] where team is the faction the player was on.
  // A player wins iff their faction is the match winner.
  const out = {};
  for (const p of players) {
    const win = p.team === winner;
    const d = elo(0.5, win); // single-player view against the field average
    out[p.uid] = { delta: Math.max(-DELTA_CAP, Math.min(DELTA_CAP, d)), win };
  }
  return out;
}

export class Results {
  constructor(db, keys) { this.db = db; this.keys = keys; }

  async postClaim({ ticket, match, uid, name, result, team }) {
    // verify the signed ticket vouches for this player in this match
    const pay = this.keys ? this.keys.verifyToken(ticket) : null;
    const inRoster = !!pay && Array.isArray(pay.players) && pay.players.some((p) => p.uid === uid);
    if (!pay || !inRoster) throw new Error('bad ticket');
    const matchRow = await this.db.queryOne('SELECT * FROM matches WHERE code = $1', [String(match).toUpperCase()]);
    if (!matchRow) throw new Error('no such match');
    await this.db.query('INSERT INTO match_players (match_id, user_id, slot, result) VALUES ($1,$2,0,$3) ON CONFLICT (match_id,user_id) DO UPDATE SET result = EXCLUDED.result', [matchRow.id, uid, result || null]);
    // record the claim on the match and flag first claim
    const claims = await this.loadClaims(matchRow);
    const i = claims.findIndex((c) => c.uid === uid);
    if (i >= 0) claims[i] = { uid, name, result: result || null, team: team || null, at: new Date().toISOString() };
    else claims.push({ uid, name, result: result || null, team: team || null, at: new Date().toISOString() });
    await this.db.query('UPDATE matches SET claims = $1, first_claim_at = COALESCE(first_claim_at, now()), status = CASE WHEN status = $2 THEN $2 ELSE $2 END WHERE id = $3', [JSON.stringify(claims), matchRow.status, matchRow.id]);
    const verdict = this.judge(claims);
    if (verdict && matchRow.status !== 'void') {
      matchRow.status = verdict.status;
      matchRow.winner_team = verdict.winner || null;
      await this.db.query('UPDATE matches SET status = $1, winner_team = $2, settled_at = CASE WHEN $1 IN ($3,$4) THEN now() ELSE settled_at END WHERE id = $5', [matchRow.status, matchRow.winner_team, 'confirmed', 'disputed', matchRow.id]);
      if (verdict.status === 'confirmed') await this.settle(matchRow, verdict.winner, claims);
    }
    return { status: matchRow.status, winner: matchRow.winner_team || null };
  }

  judge(claims) {
    const nonNull = claims.filter((c) => c.result);
    if (nonNull.length === 0) return null;
    const winners = [...new Set(nonNull.map((c) => c.result))];
    if (winners.length === 1) return { status: 'confirmed', winner: winners[0] };
    return { status: 'disputed', winner: null };
  }

  // operator resolution: accept one player's claim as truth
  async resolve(matchId, winnerTeam, actor) {
    const m = await this.db.queryOne('SELECT * FROM matches WHERE id = $1', [matchId]);
    if (!m) throw new Error('no such match');
    const claims = await this.loadClaims(m);
    await this.db.query('UPDATE matches SET status = $1, winner_team = $2, verdict = $3, settled_at = now() WHERE id = $4', ['confirmed', winnerTeam, 'resolved:' + (actor || 'op'), m.id]);
    await this.settle({ ...m, status: 'confirmed', winner_team: winnerTeam }, winnerTeam, claims);
    return { status: 'confirmed', winner: winnerTeam };
  }

  async settle(m, winner, claims) {
    if (m._settled) return; m._settled = true;
    const rows = await this.db.query('SELECT mp.user_id, u.rating, mp.slot FROM match_players mp JOIN users u ON u.id = mp.user_id WHERE mp.match_id = $1', [m.id]);
    // each player's side is the faction they claimed to be on
    const sideOf = {};
    for (const c of claims) if (c.team) sideOf[c.uid] = c.team;
    const players = rows.rows.map((r) => ({ uid: r.user_id, rating: r.rating, team: sideOf[r.user_id] || null }));
    const deltas = computeDeltas(players, winner);
    for (const r of rows.rows) {
      const d = (deltas[r.user_id] || {}).delta || 0;
      const won = (deltas[r.user_id] || {}).win ? 1 : 0;
      await this.db.query('UPDATE users SET rating = rating + $1, matches = matches + 1, wins = wins + $2 WHERE id = $3', [d, won, r.user_id]);
      await this.db.query('UPDATE match_players SET rating_delta = $1, result = $2, counted_at = now() WHERE match_id = $3 AND user_id = $4', [d, sideOf[r.user_id] || null, m.id, r.user_id]);
    }
  }

  async loadClaims(m) {
    if (m.claims && typeof m.claims === 'object') return Array.isArray(m.claims) ? m.claims : Object.values(m.claims);
    return [];
  }
}
