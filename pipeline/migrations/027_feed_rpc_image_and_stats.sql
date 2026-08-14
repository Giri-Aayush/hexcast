-- 027_feed_rpc_image_and_stats.sql
--
-- get_personalized_feed does not return image_url or stats, so the feed renders the dither
-- fallback on every card and never shows a stat row — while the permalink page, which uses
-- getCardById with SELECT *, shows both. The data has been there the whole time; the feed's
-- own query drops the columns on the way out.
--
-- That is the same invisible-failure shape as the CSP block: a card with no image_url is
-- indistinguishable from a card whose image failed, because both render the dither. Fixing
-- the CSP made the images reachable and this made them unreachable again one layer up, so
-- verifying an image URL loads proves nothing about whether the FEED shows it.
--
-- DROP then CREATE rather than CREATE OR REPLACE: Postgres refuses to change the return type
-- of an existing function, so a replace fails with "cannot change return type". The signature
-- is unchanged, which is what matters for callers.
--
-- Takes effect immediately on the deployed site — it is a database function, so no rebuild is
-- required. That matters right now because the Netlify build minutes are exhausted.

DROP FUNCTION IF EXISTS get_personalized_feed(TEXT, INT, TEXT, BOOLEAN, TIMESTAMPTZ, INT);

CREATE FUNCTION get_personalized_feed(
  p_user_id          TEXT,
  p_limit            INT DEFAULT 20,
  p_category         TEXT DEFAULT NULL,
  p_cursor_seen      BOOLEAN DEFAULT NULL,
  p_cursor_published TIMESTAMPTZ DEFAULT NULL,
  p_max_age_days     INT DEFAULT 7
)
RETURNS TABLE (
  id                  UUID,
  source_id           TEXT,
  canonical_url       TEXT,
  url_hash            CHAR(64),
  category            TEXT,
  headline            TEXT,
  summary             TEXT,
  author              TEXT,
  published_at        TIMESTAMPTZ,
  fetched_at          TIMESTAMPTZ,
  engagement          JSONB,
  flag_count          INTEGER,
  is_suspended        BOOLEAN,
  pipeline_version    TEXT,
  reaction_up_count   INTEGER,
  reaction_down_count INTEGER,
  seen                BOOLEAN,
  -- Both added here. stats was missing for the same reason and would have surfaced as
  -- "the stat row never appears in the feed" the moment anyone looked for it.
  image_url           TEXT,
  stats               JSONB
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id, c.source_id, c.canonical_url, c.url_hash,
    c.category, c.headline, c.summary, c.author,
    c.published_at, c.fetched_at, c.engagement,
    c.flag_count, c.is_suspended, c.pipeline_version,
    c.reaction_up_count, c.reaction_down_count,
    (cv.user_id IS NOT NULL) AS seen,
    c.image_url, c.stats
  FROM cards c
  LEFT JOIN card_views cv ON cv.card_id = c.id AND cv.user_id = p_user_id
  WHERE c.is_suspended = false
    AND c.published_at > NOW() - (p_max_age_days || ' days')::INTERVAL
    AND (p_category IS NULL OR c.category = p_category)
    AND (
      p_cursor_seen IS NULL
      OR ((cv.user_id IS NOT NULL) > p_cursor_seen)
      OR (
        (cv.user_id IS NOT NULL) = p_cursor_seen
        AND c.published_at < p_cursor_published
      )
    )
  ORDER BY
    (cv.user_id IS NOT NULL) ASC,
    c.published_at DESC,
    c.fetched_at DESC
  LIMIT p_limit;
$$;
