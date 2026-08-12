-- 023_enable_rls.sql
--
-- Every table in public had RLS off, which meant the project's publishable
-- (anon) key was a full read/write door to the whole database. That key is
-- presented as safe to share, and was shared. This closes it in the schema so a
-- fresh provision is not one manual psql away from the same exposure — the live
-- fix was applied by hand on 2026-08-12 and existed only on that database until
-- this migration.
--
-- RLS is enabled with ZERO POLICIES, deliberately. Policies are written against a
-- claim in the request JWT — normally auth.uid() from Supabase Auth — and we do not
-- have one: Better Auth owns identity in our own "user" table and issues its own
-- sessions, so PostgREST sees no per-user claim it could key on. Per-row policies
-- here would be theatre. Every legitimate reader is server-side and uses the
-- service key, which bypasses RLS by design.
--
-- No policies therefore means: anon and authenticated get nothing at all, and
-- application access is unaffected. If a browser ever needs to read Postgres
-- directly, that is the point to design real policies, not now.
--
-- A loop rather than a list so this covers every table that exists at provision
-- time, including Better Auth's, and cannot silently miss one added later by
-- someone who did not know to update a hardcoded list. ENABLE on an
-- already-enabled table is a no-op, so re-running is safe.

DO $$
DECLARE
  target regclass;
BEGIN
  FOR target IN
    SELECT c.oid::regclass
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'            -- ordinary tables only; views inherit from theirs
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
    RAISE NOTICE 'RLS enabled on %', target;
  END LOOP;
END
$$;

-- Fail the migration rather than report success if anything in public is still
-- unprotected. A partially-secured database is the state this exists to prevent,
-- and it is not something we should have to remember to check by hand.
DO $$
DECLARE
  unprotected text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO unprotected
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

  IF unprotected IS NOT NULL THEN
    RAISE EXCEPTION 'RLS still disabled on: %', unprotected;
  END IF;
END
$$;
