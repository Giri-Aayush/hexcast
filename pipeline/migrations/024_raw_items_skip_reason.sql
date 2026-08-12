-- 024_raw_items_skip_reason.sql
--
-- Record WHY an item was skipped, so a gate change can re-evaluate the items that
-- gate rejected.
--
-- Every skip path marks the item processed = true, which is right — otherwise a
-- genuinely thin item is re-drained forever. But it means a gate fix cannot rescue
-- what an earlier gate already rejected: when the thin-source gate was corrected to
-- accept short-but-dense sources, the 18 DefiLlama items it had already skipped
-- stayed invisible, because processed = true removes them from the queue for good.
-- The whole METRICS category was missing for that reason and it took a database
-- forensics session to work out why.
--
-- Recovering them meant reverse-engineering the gate from lengths and regexes:
--
--   WHERE processed AND NOT EXISTS (card) AND published_at > now() - interval '90 days'
--     AND length(title || text) < 600
--     AND (SELECT count(*) FROM regexp_matches(..., '(EIP-[0-9]+|ERC-...)', 'g')) >= 3
--
-- With the reason persisted that becomes `WHERE skip_reason = 'tooThin'`. The six call
-- sites already compute the reason for the run's log breakdown, so this only stores what
-- is already known.
--
-- Nullable: existing rows keep NULL, which reads as "skipped before reasons were
-- recorded, or never skipped at all". Not backfillable — the reason was not written down,
-- which is the entire problem.

ALTER TABLE raw_items ADD COLUMN IF NOT EXISTS skip_reason TEXT;

-- The query this exists to serve is always "find everything skipped for reason X",
-- and only skipped rows carry a reason.
CREATE INDEX IF NOT EXISTS idx_raw_items_skip_reason ON raw_items (skip_reason)
  WHERE skip_reason IS NOT NULL;
