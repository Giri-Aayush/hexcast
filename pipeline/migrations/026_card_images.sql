-- 026_card_images.sql
--
-- Generated cover art for a card, stored once and kept for the card's 90-day life.
--
-- Only SECURITY and UPGRADE cards get one. That is not a budget rule dressed up as a
-- product rule: those are already the two categories pipeline.ts pushes to
-- high_priority_queue, so "gets an image" means "we already decided this is important".
-- At a measured $0.0343 per image, every card would be ~$13.38/month against ~$2.37 for
-- these two, and the text pipeline that produces the actual news costs $0.08/month.
--
-- Three columns rather than one, because image_url IS NULL alone cannot answer the only
-- question that matters when something goes wrong: is this card worth retrying?
--
--   url NULL, attempted_at NULL              never tried (wrong category, or new card)
--   url NULL, attempted_at set, error set    tried and failed — retryable IF transient
--   url set                                  done, never regenerate
--
-- That distinction is the skip_reason lesson from 024, applied before the problem instead
-- of after it. Without it, a rate-limited afternoon and a permanently refused prompt look
-- identical, and finding the retryable ones later means re-deriving them from logs.

ALTER TABLE cards ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS image_attempted_at TIMESTAMPTZ;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS image_error TEXT;

-- A closed set, not raw provider prose. The retry script branches on the class, and
-- branching on substring matches against provider error text is how such a script quietly
-- stops working the day a provider rewords a message. The provider's own words are kept
-- in the log, not in the column that drives behaviour.
--   transient  429, 5xx, timeout        -> retry
--   refused    content policy, refusal  -> do not retry, the prompt needs changing
--   invalid    bad request, bad model   -> our bug, fix the code
--   unknown    anything unclassified    -> look before retrying
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_image_error_known;
ALTER TABLE cards ADD CONSTRAINT cards_image_error_known
  CHECK (image_error IS NULL OR image_error IN ('transient', 'refused', 'invalid', 'unknown'));

-- A URL and an error together is contradictory: either it worked or it did not. Cheap to
-- state, and it stops a half-written retry from leaving a row that reads both ways.
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_image_url_xor_error;
ALTER TABLE cards ADD CONSTRAINT cards_image_url_xor_error
  CHECK (image_url IS NULL OR image_error IS NULL);

-- Serves the retry query — "failed, and worth another go" — which is the only scan this
-- feature needs. Partial, because the rows it must find are a small minority of the table.
CREATE INDEX IF NOT EXISTS idx_cards_image_retryable
  ON cards (image_attempted_at)
  WHERE image_url IS NULL AND image_error IS NOT NULL;
