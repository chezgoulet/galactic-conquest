-- matches: the settlement ledger. The game runs peer to peer; the service only
-- records the match, who was in it, and reconciles the players' claims into a
-- verdict. A signed match ticket (see server_keys) vouches for the roster.
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'team' CHECK (mode IN ('team','duel','ffa','ranked:team','ranked:duel')),
  host_id UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  winner_team TEXT,
  duration_s INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','disputed','void')),
  claims JSONB NOT NULL DEFAULT '[]',
  rated BOOLEAN NOT NULL DEFAULT false,
  first_claim_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  verdict TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matches_status ON matches (status);
CREATE INDEX IF NOT EXISTS matches_started ON matches (started_at DESC);

CREATE TABLE IF NOT EXISTS match_players (
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  result TEXT,
  rating_delta INTEGER NOT NULL DEFAULT 0,
  counted_at TIMESTAMPTZ,
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX IF NOT EXISTS mp_user ON match_players (user_id);
