#!/usr/bin/env bash
# Runs the migration and seed against a throwaway local Postgres, then the assertions.
set -euo pipefail
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
DIR=$(mktemp -d); PORT=55432
"$PGBIN/initdb" -D "$DIR" -U postgres >/dev/null
"$PGBIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR" -l "$DIR/log" start >/dev/null
trap '"$PGBIN/pg_ctl" -D "$DIR" stop >/dev/null; rm -rf "$DIR"' EXIT
P="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
cd "$(dirname "$0")/../.."
$P -f tests/db/supabase_stub.sql
$P -f supabase/migrations/20261106000000_product_image_system.sql
$P -f supabase/seed.sql
$P -f supabase/migrations/20261106000000_product_image_system.sql   # second run must be harmless
$P -f supabase/seed.sql
$P -f tests/db/test.sql
