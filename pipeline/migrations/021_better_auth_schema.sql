-- 021_better_auth_schema.sql
--
-- Better Auth replaces Clerk, so identity moves into our own database. Four core
-- tables per Better Auth's default Postgres schema (pg adapter, TEXT ids).
--
-- TWO TRAPS, both deliberate here and both easy to get wrong by hand:
--
-- 1. "user" is a reserved word in SQL. It must be quoted everywhere, forever —
--    an unquoted `SELECT * FROM user` returns the *current role*, not the table.
--    Better Auth quotes it; anything we write by hand has to as well.
-- 2. Better Auth's default column names are camelCase ("emailVerified", "userId").
--    Postgres folds unquoted identifiers to lowercase, so these must stay quoted or
--    the library's queries will not find them.
--
-- VALIDATE THIS AGAINST `npx @better-auth/cli generate` once better-auth is
-- installed. This is written from its documented default schema, and a mismatch
-- would surface as a runtime query error rather than anything a migration catches.

CREATE TABLE IF NOT EXISTS "user" (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  image           TEXT,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
  id          TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_user  ON "session" ("userId");
CREATE INDEX IF NOT EXISTS idx_session_token ON "session" (token);

CREATE TABLE IF NOT EXISTS "account" (
  id                      TEXT PRIMARY KEY,
  "userId"                TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accountId"             TEXT NOT NULL,
  "providerId"            TEXT NOT NULL,
  "accessToken"           TEXT,
  "refreshToken"          TEXT,
  "idToken"               TEXT,
  "accessTokenExpiresAt"  TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  scope                   TEXT,
  password                TEXT,
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_user ON "account" ("userId");
-- One row per provider identity. Prevents a duplicate link if a callback replays.
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_provider ON "account" ("providerId", "accountId");

CREATE TABLE IF NOT EXISTS "verification" (
  id          TEXT PRIMARY KEY,
  identifier  TEXT NOT NULL,
  value       TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_identifier ON "verification" (identifier);
