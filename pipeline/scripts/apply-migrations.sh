#!/usr/bin/env bash
#
# Apply pipeline/migrations/*.sql to a Postgres database in numeric order.
#
# The Supabase CLI can't own these files: it expects a 14-digit timestamp prefix
# (20250101120000_name.sql) and rejects the 001_.. 016_ naming used here, so
# `supabase start` / `supabase db push` skip them entirely. This script fills the
# gap and records what it applied in schema_migrations, so it is safe to re-run
# (several migrations use bare CREATE TRIGGER / CREATE INDEX and would error on a
# second pass).
#
# Usage:
#   ./pipeline/scripts/apply-migrations.sh                    # local Supabase
#   DATABASE_URL=postgres://... ./pipeline/scripts/apply-migrations.sh
#
set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../migrations" && pwd)"

psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

applied=0
skipped=0

for file in "$MIGRATIONS_DIR"/*.sql; do
  version="$(basename "$file" .sql)"

  if [ -n "$(psql "$DB_URL" -tAc "SELECT 1 FROM schema_migrations WHERE version = '$version'")" ]; then
    printf '  skip    %s\n' "$version"
    skipped=$((skipped + 1))
    continue
  fi

  printf '  apply   %s' "$version"
  # Single transaction per migration: a failure leaves no partial schema and no
  # schema_migrations row, so a re-run retries it cleanly.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
    -f "$file" \
    -c "INSERT INTO schema_migrations (version) VALUES ('$version')"
  printf '  ok\n'
  applied=$((applied + 1))
done

printf '\n%d applied, %d already present\n' "$applied" "$skipped"
