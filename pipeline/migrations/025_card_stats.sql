-- 025_card_stats.sql
--
-- The three-figure row on a card: "1.21M / ACCOUNTS", "71% / TO 4 CONTRACTS",
-- "2 / CLIENT PATCHES". Shape is Array<{value, label}> | null, at most 3 entries.
--
-- JSONB rather than three pairs of columns, because the row is variable-length: measured
-- across 300 real cards, 60% carry two or more figures and only 35% carry three, so
-- stat_1_value..stat_3_label would be six columns that are mostly NULL and would need a
-- seventh migration the day the design wants four.
--
-- Nullable, and NULL is the ordinary case rather than an error state: about 40% of cards
-- have fewer than two figures in their summary and legitimately have no row. The web side
-- has to render that as a normal card, not as a card missing something.
--
-- Not backfilled. Existing cards get NULL and stay NULL unless someone deliberately runs
-- an extraction pass over them — a backfill is ~180 more LLM calls, which is a decision
-- with a cost attached rather than a side effect of a schema change.

ALTER TABLE cards ADD COLUMN IF NOT EXISTS stats JSONB;

-- Shape guard. The values themselves are checked in the extractor, which drops any pair
-- whose value is not an exact substring of the summary; this only stops a malformed write
-- from reaching the renderer as a bare string, a 12-element list, or an object missing the
-- keys the card template indexes into.
--
-- In a function rather than inline because CHECK forbids subqueries, and every subquery-free
-- form of "every element is an object with string value and label" that I could write in
-- jsonpath silently passed elements with a missing key. A constraint that looks like it
-- validates element shape but does not is worse than none, because the next person trusts it.
CREATE OR REPLACE FUNCTION is_valid_stat_row(stats JSONB) RETURNS BOOLEAN AS $$
  SELECT jsonb_typeof(stats) = 'array'
     AND jsonb_array_length(stats) BETWEEN 2 AND 3
     AND NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(stats) AS element
       WHERE jsonb_typeof(element) IS DISTINCT FROM 'object'
          OR jsonb_typeof(element -> 'value') IS DISTINCT FROM 'string'
          OR jsonb_typeof(element -> 'label') IS DISTINCT FROM 'string'
     );
$$ LANGUAGE SQL IMMUTABLE;

ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_stats_shape;
ALTER TABLE cards ADD CONSTRAINT cards_stats_shape CHECK (stats IS NULL OR is_valid_stat_row(stats));
