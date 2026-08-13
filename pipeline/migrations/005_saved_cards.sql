-- Saved cards per user. user_id held Clerk ids when this was written and holds Better
-- Auth ids now; 022_user_state_foreign_keys.sql performed the remap and added the FK.
CREATE TABLE IF NOT EXISTS saved_cards (
  user_id TEXT NOT NULL,
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_cards_user ON saved_cards(user_id);
