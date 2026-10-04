-- crash / bug reporting, grouped by fingerprint into issues
CREATE TABLE IF NOT EXISTS issues (
  id BIGSERIAL PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'crash',
  title TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ignored','regressed')),
  count INTEGER NOT NULL DEFAULT 1,
  versions JSONB NOT NULL DEFAULT '{}',
  platforms JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  issue_id BIGINT REFERENCES issues(id) ON DELETE SET NULL,
  version TEXT,
  platform TEXT,
  renderer TEXT,
  message TEXT,
  stack TEXT,
  description TEXT,
  context JSONB,
  screenshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_issue ON reports (issue_id);
CREATE INDEX IF NOT EXISTS reports_user ON reports (user_id);

CREATE TABLE IF NOT EXISTS perf_runs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  version TEXT,
  device_class TEXT,
  fps_avg NUMERIC,
  fps_min NUMERIC,
  frames BIGINT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS perf_created ON perf_runs (created_at DESC);
