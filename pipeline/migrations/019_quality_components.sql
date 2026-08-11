-- 019_quality_components.sql
--
-- quality_score was a pass/fail gate wearing a score's clothes: four existence
-- checks, two of which (headline > 10 chars, summary > 40 chars) are true of every
-- card that can reach this table. 0.75 of the content component was free, 55% of
-- 216 cards scored exactly 1.0 across only four distinct values, and the floor for
-- any card was sourceWeight*0.4 + 0.45 — so the 0.25 auto-suppress cut could never
-- fire at all.
--
-- The score now also weighs how the summary was actually generated: retry count,
-- entity preservation, distance from the 55-60 word target, and whether it was
-- truncated. All of that was already computed and then thrown away.
--
-- These columns exist so a score can be explained after the fact. Picking a
-- suppression threshold without being able to see which component pushed a card
-- down is how we ended up with an unreachable one.
--
-- All additive and nullable. The existing 216 rows keep quality_score and leave
-- these NULL, which reads as "scored before components were recorded" — backfilling
-- would mean inventing retry counts nobody recorded.

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS quality_source_weight    REAL,
  ADD COLUMN IF NOT EXISTS quality_content          REAL,
  ADD COLUMN IF NOT EXISTS quality_generation       REAL,
  ADD COLUMN IF NOT EXISTS summary_attempts         SMALLINT,
  ADD COLUMN IF NOT EXISTS summary_truncated        BOOLEAN,
  ADD COLUMN IF NOT EXISTS summary_missing_entities TEXT[];

-- Answering "what does the bottom of the distribution look like" is the whole
-- point of these columns, and it is always a scan over the scored rows.
CREATE INDEX IF NOT EXISTS idx_cards_quality_generation ON cards (quality_generation)
  WHERE quality_generation IS NOT NULL;
