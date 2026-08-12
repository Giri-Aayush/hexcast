-- 018_flags_user_id.sql
--
-- flags has never had a user_id column. web/src/app/api/flags/route.ts writes one
-- and queries on one, so every flag submission has been failing against a column
-- that does not exist — and since increment_flag_count only fires on a successful
-- INSERT, cards.flag_count has been stuck at 0 everywhere. The flag button has
-- never recorded a flag.
--
-- Nullable rather than NOT NULL: no insert path has ever succeeded so the table
-- should be empty, but a migration that hard-fails on an unexpected legacy row is
-- worse than one that tolerates it. COUNT(DISTINCT user_id) ignores NULLs, so any
-- such row simply does not count toward a distinct-flagger threshold.

ALTER TABLE flags ADD COLUMN IF NOT EXISTS user_id TEXT;

-- One flag per user per card. Replaces the read-then-write check in the API route,
-- which could let two concurrent requests both pass before either inserted.
-- Postgres treats NULLs as distinct, so pre-existing anonymous rows don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_flags_card_user ON flags (card_id, user_id);
