-- 017_drop_stale_personalized_feed_overload.sql
--
-- Migration 008 created get_personalized_feed with five parameters. Migration
-- 010 added p_max_age_days using CREATE OR REPLACE, which does not replace a
-- function when the signature changes — it creates an overload. Both versions
-- have been live ever since.
--
-- Consequence: any five-argument call fails outright with
--   function get_personalized_feed(...) is not unique
--   HINT: Could not choose a best candidate function.
-- because p_max_age_days has a default, so both candidates match.
--
-- web/src/lib/queries.ts always passes all six arguments (p_max_age_days is a
-- hardcoded 365), so nothing resolves to the 008 version today. Dropping it
-- removes the trap for the next caller.
--
-- Argument types are listed explicitly so this targets ONLY the 5-arg version
-- and leaves the 6-arg version from 010 in place.

DROP FUNCTION IF EXISTS get_personalized_feed(TEXT, INT, TEXT, BOOLEAN, TIMESTAMPTZ);
