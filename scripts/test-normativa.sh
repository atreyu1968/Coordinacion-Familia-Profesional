#!/usr/bin/env bash
# No shared/development database is contacted by this test.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(mktemp -d /tmp/coordina-normativa.XXXXXX)"
mkdir -m 700 "$ROOT/socket"
cleanup() { pg_ctl -D "$ROOT/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$ROOT"; }
trap cleanup EXIT
initdb -D "$ROOT/data" --username=postgres --auth-local=trust >/dev/null
pg_ctl -D "$ROOT/data" -l "$ROOT/postgres.log" -o "-F -k $ROOT/socket -p 55447 -c listen_addresses=''" -w start >/dev/null
createdb -h "$ROOT/socket" -p 55447 -U postgres coordina_normativa
export DATABASE_URL="postgresql://postgres@localhost:55447/coordina_normativa?host=$ROOT/socket"
export COORDINA_NORMATIVA_ISOLATED=1
DB_BACKUP_DIR="$ROOT/backups" bash deploy/db.sh migrate
# Verify the previous release's schema can upgrade without reconciliation.
psql -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP TABLE normativa_publications, normativa_sources' >/dev/null
DB_BACKUP_DIR="$ROOT/backups" bash deploy/db.sh migrate
# Exercise the additive migration twice, as on existing installations.
psql -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -f deploy/migrations/normativa.sql >/dev/null
psql -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -f deploy/migrations/normativa.sql >/dev/null
pnpm --filter @workspace/api-server exec vitest run --config vitest.normativa.config.ts
