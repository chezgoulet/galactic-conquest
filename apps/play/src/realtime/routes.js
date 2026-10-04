// Match results: players post their claim after a match; the service
// reconciles claims and applies Elo. Also a public match listing for the
// lobby browser.
import { unauthorized, badRequest } from '../context.js';

export function buildResultsRoutes(app) {
  // a player in the roster claims the outcome. ticket is the signed match ticket.
  app.post('/api/match/claim', async (req) => {
    if (!req.user) throw unauthorized();
    const { ticket, match, result, team } = req.body || {};
    if (!match) throw badRequest('match required');
    try {
      return await app.results.postClaim({ ticket, match, uid: req.user.id, name: req.user.display_name, result: result || null, team: team || null });
    } catch (e) {
      throw badRequest(e.message || 'claim failed');
    }
  });

  // a player's recent matches + their deltas
  app.get('/api/match/mine', async (req) => {
    if (!req.user) throw unauthorized();
    const rows = await app.db.query(
      'SELECT m.id, m.code, m.winner_team, m.status, m.started_at, mp.result, mp.rating_delta FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.user_id = $1 ORDER BY m.started_at DESC LIMIT 20',
      [req.user.id]
    );
    return rows.rows;
  });

  // public recent matches (lobby browser)
  app.get('/api/match/recent', async () => {
    const rows = await app.db.query('SELECT id, code, mode, status, winner_team, started_at, rated FROM matches ORDER BY started_at DESC NULLS LAST LIMIT 30');
    return rows.rows;
  });
}
