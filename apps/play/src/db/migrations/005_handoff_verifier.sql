-- Game hand-off hardening: the initiating client registers sha256(verifier),
-- the browser approves the hand-off, and only the client that holds the original
-- verifier can claim the resulting game session. Also record approval time.
ALTER TABLE login_handoffs ADD COLUMN IF NOT EXISTS verifier_hash TEXT;
ALTER TABLE login_handoffs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
