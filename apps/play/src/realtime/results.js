// Results reconciliation + Elo. The service never watches the match; each
// player in the roster posts a claim about the outcome. A match is settled when
// the whole roster agrees on a winner AND the claimed factions are consistent
// (at least one claimant on the winning side and one on the other):
//   • full roster, one winner, consistent factions -> confirmed
//   • disagreement, an inconsistent/self-serving claim, or a claim missing
//     after the window -> disputed, an operator resolves it
// Settlement applies the rating-aware Elo delta (K=24) exactly once per match;
// the winner is taken from unanimous claims, never from one player.
//
// Trust boundaries: the ticket is self-signed by the service, so a claim must
// present the ticket for THIS match (mid + room), the claimant must be on the
// ticket AND in the service's own match_players roster, and a single claim can
// no longer confirm or settle anything.

const K = 24, R0 = 1200, DELTA_CAP = 40, CLAIM_WINDOW_MS = 15 * 60 * 1000;

export function elo(expected, won) { return Math.round(K * ((won ? 1 : 0) - expected)); }
export function expectedScore(rA, rB) { return 1 / (1 + Math.pow(10, (rB - rA) / 400)); }

// players: [{uid, rating, team}]; team is the faction the player claims to have
// been on. A player wins iff their team equals the match winner. Expectation is
// taken against the opposing side's average rating (0.5 when there is no side).
export function computeDeltas(players, winner) {
  const out = {};
  for (const p of players) {
    const win = !!p.team && p.team === winner;
    const opp = players.filter((o) => o.uid !== p.uid && o.team && p.team && o.team !== p.team);
    const expected = opp.length ? opp.reduce((s, o) => s + expectedScore(p.rating, o.rating), 0) / opp.length : 0.5;
    const d = elo(expected, win);
    out[p.uid] = { delta: Math.max(-DELTA_CAP, Math.min(DELTA_CAP, d)), win };
  }
  return out;
}

export class Results {
  constructor(db, keys) { this.db = db; this.keys = keys; }

  async postClaim({ ticket, match, uid, name, result, team }) {
    // 1. the ticket must vouch for this player, be unexpired, and be for THIS match
    const pay = this.keys ? this.keys.verifyToken(ticket) : null;
    const inTicket = !!pay && Array.isArray(pay.players) && pay.players.some((p) => p.uid === uid);
    if (!pay || !inTicket) throw new Error('bad ticket');
    if (pay.exp && Date.now() > pay.exp) throw new Error('ticket expired');
    const code = String(match || '').toUpperCase();
    const matchRow = await this.db.queryOne('SELECT * FROM matches WHERE code = $1', [code]);
    if (!matchRow) throw new Error('no such match');
    if ((pay.mid && String(pay.mid) !== String(matchRow.id)) || (pay.room && String(pay.room).toUpperCase() !== code)) throw new Error('ticket is for another match');
    if (matchRow.settled_at) return { status: matchRow.status, winner: matchRow.winner_team || null, settled: true };

    // 2. the claimant must be on the service's own roster (not just the ticket)
    const rosterRows = await this.db.query('SELECT user_id FROM match_players WHERE match_id = $1', [matchRow.id]);
    const roster = rosterRows.rows.map((r) => r.user_id);
    if (!roster.includes(uid)) throw new Error('not in this match');

    // 3. record the claim (one per player)
    await this.db.query('INSERT INTO match_players (match_id, user_id, slot, result) VALUES ($1,$2,0,$3) ON CONFLICT (match_id,user_id) DO UPDATE SET result = EXCLUDED.result', [matchRow.id, uid, result || null]);
    const claims = this.loadClaims(matchRow);
    const entry = { uid, name, result: result || null, team: team || null, at: new Date().toISOString() };
    const i = claims.findIndex((c) => c.uid === uid);
    if (i >= 0) claims[i] = entry; else claims.push(entry);
    await this.db.query('UPDATE matches SET claims = $1, first_claim_at = COALESCE(first_claim_at, now()) WHERE id = $2', [JSON.stringify(claims), matchRow.id]);

    // 4. judge; only a clean, unanimous, consistent full-roster verdict confirms
    const verdict = this.judge(claims, roster, matchRow.first_claim_at, Date.now());
    if (verdict && matchRow.status !== 'void') {
      const upd = await this.db.query(
        "UPDATE matches SET status = $1, winner_team = $2, settled_at = CASE WHEN $1 = 'confirmed' THEN COALESCE(settled_at, now()) ELSE settled_at END WHERE id = $3 AND settled_at IS NULL RETURNING id",
        [verdict.status, verdict.winner || null, matchRow.id]
      );
      if (upd.rowCount > 0 && verdict.status === 'confirmed') {
        await this.settle({ ...matchRow, status: 'confirmed', winner_team: verdict.winner }, verdict.winner, claims);
      }
      return { status: verdict.status, winner: verdict.winner || null };
    }
    return { status: matchRow.status, winner: matchRow.winner_team || null };
  }

  // A verdict is only reached when the whole roster has claimed; a lone claim
  // (or a claim that puts everyone on the winning side) never confirms. A
  // partial roster past the window becomes disputed for an operator.
  judge(claims, roster, firstAt, now) {
    now = now || Date.now();
    const known = new Set(roster || []);
    const mine = (claims || []).filter((c) => known.has(c.uid));
    const nonNull = mine.filter((c) => c.result);
    if (nonNull.length === 0) return null;
    const winners = [...new Set(nonNull.map((c) => c.result))];
    if (winners.length !== 1) return { status: 'disputed', winner: null };
    const winner = winners[0];
    const fullRoster = roster && roster.length > 0 && mine.length >= roster.length;
    if (!fullRoster) {
      // not everyone has claimed yet: inconclusive (open) until the window lapses
      const t0 = firstAt ? Date.parse(firstAt) : now;
      return (now - t0 >= CLAIM_WINDOW_MS) ? { status: 'disputed', winner: null } : null;
    }
    // the whole roster agrees on the winner; the factions must still be consistent
    const teamsKnown = nonNull.every((c) => c.team);
    const winnerSide = nonNull.some((c) => c.team === winner);
    const otherSide = nonNull.some((c) => c.team && c.team !== winner);
    if (!teamsKnown || !winnerSide || !otherSide) return { status: 'disputed', winner: null };
    return { status: 'confirmed', winner };
  }

  // operator resolution: accept one player's claim as truth
  async resolve(matchId, winnerTeam, actor) {
    const m = await this.db.queryOne('SELECT * FROM matches WHERE id = $1', [matchId]);
    if (!m) throw new Error('no such match');
    if (m.settled_at) return { status: m.status, winner: m.winner_team || null };
    const claims = this.loadClaims(m);
    const upd = await this.db.query("UPDATE matches SET status = 'confirmed', winner_team = $1, verdict = $2, settled_at = now() WHERE id = $3 AND settled_at IS NULL RETURNING id", [winnerTeam, 'resolved:' + (actor || 'op'), m.id]);
    if (upd.rowCount > 0) await this.settle({ ...m, status: 'confirmed', winner_team: winnerTeam }, winnerTeam, claims);
    return { status: 'confirmed', winner: winnerTeam };
  }

  async settle(m, winner, claims) {
    const rows = await this.db.query('SELECT mp.user_id, u.rating, mp.slot FROM match_players mp JOIN users u ON u.id = mp.user_id WHERE mp.match_id = $1', [m.id]);
    const teamOf = {};
    for (const c of claims) if (c.team) teamOf[c.uid] = c.team;
    const players = rows.rows.map((r) => ({ uid: r.user_id, rating: r.rating, team: teamOf[r.user_id] || null }));
    const deltas = computeDeltas(players, winner);
    for (const r of rows.rows) {
      const d = deltas[r.user_id] || { delta: 0, win: false };
      await this.db.query('UPDATE users SET rating = rating + $1, matches = matches + 1, wins = wins + $2 WHERE id = $3', [d.delta, d.win ? 1 : 0, r.user_id]);
      await this.db.query('UPDATE match_players SET rating_delta = $1, result = $2, counted_at = now() WHERE match_id = $3 AND user_id = $4', [d.delta, teamOf[r.user_id] || null, m.id, r.user_id]);
    }
  }

  loadClaims(m) {
    if (m.claims && typeof m.claims === 'object') return Array.isArray(m.claims) ? m.claims : Object.values(m.claims);
    return [];
  }
}
