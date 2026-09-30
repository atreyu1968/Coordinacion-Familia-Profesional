#!/usr/bin/env bash
# Safe, non-interactive PostgreSQL preparation used by install.sh and update.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMMAND="${1:-}"
DATABASE_URL="${DATABASE_URL:-}"
BACKUP_DIR="${DB_BACKUP_DIR:-/var/backups/coordina-adg}"
SERVICE_USER="${SERVICE_USER:-}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -n "${DATABASE_URL}" ]] || fail "DATABASE_URL is required."
case "${COMMAND}" in
  backup|prepare|apply|verify|migrate|mobile-url) ;;
  *) fail "Usage: DATABASE_URL=... bash deploy/db.sh {backup|prepare|apply|verify|migrate|mobile-url}" ;;
esac

# Keep credentials out of psql/pg_dump process arguments. libpq reads this
# short-lived, owner-only service file; only its non-secret service name appears
# on command lines.
PGSERVICE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/coordina-pg.XXXXXX")"
chmod 700 "${PGSERVICE_DIR}"
export PGSERVICEFILE="${PGSERVICE_DIR}/pg_service.conf"
export PGSERVICE="coordina_migration"
cleanup() {
  rm -rf -- "${PGSERVICE_DIR}"
}
trap cleanup EXIT

node <<'NODE'
const fs = require("node:fs");
const { URL } = require("node:url");

const raw = process.env.DATABASE_URL;
let url;
try {
  url = new URL(raw);
} catch {
  process.stderr.write("ERROR: DATABASE_URL must be a PostgreSQL URL.\n");
  process.exit(1);
}

if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
  process.stderr.write("ERROR: DATABASE_URL must use postgres:// or postgresql://.\n");
  process.exit(1);
}

const params = new Map();
const hostname = url.searchParams.get("host") || url.hostname;
const port = url.searchParams.get("port") || url.port || "5432";
const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
if (!hostname || !database) {
  process.stderr.write("ERROR: DATABASE_URL must include a host and database name.\n");
  process.exit(1);
}
params.set("host", hostname);
params.set("port", port);
params.set("dbname", database);
if (url.username) params.set("user", decodeURIComponent(url.username));
if (url.password) params.set("password", decodeURIComponent(url.password));

for (const [key, value] of url.searchParams.entries()) {
  if (["host", "port"].includes(key)) continue;
  if (/^[a-z_][a-z0-9_]*$/i.test(key)) params.set(key, value);
}

for (const [key, value] of params) {
  if (/[\r\n]/.test(value)) {
    process.stderr.write(`ERROR: DATABASE_URL contains a newline in its ${key} value.\n`);
    process.exit(1);
  }
}
const content = [
  "[coordina_migration]",
  ...[...params.entries()].map(([key, value]) => {
    if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return `${key}=${value}`;
    const escaped = value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
    return `${key}='${escaped}'`;
  }),
  "",
].join("\n");
fs.writeFileSync(process.env.PGSERVICEFILE, content, { mode: 0o600 });
fs.chmodSync(process.env.PGSERVICEFILE, 0o600);
NODE

PSQL=(psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 "service=${PGSERVICE}")

run_psql() {
  "${PSQL[@]}" "$@"
}

check_connection() {
  local result
  result="$(run_psql --tuples-only --no-align --command='SELECT 1' | tr -d '[:space:]')"
  [[ "${result}" == "1" ]] || fail "Could not verify the PostgreSQL connection."
}

backup_existing_database() {
  check_connection
  local has_tables backup_file
  has_tables="$(run_psql --tuples-only --no-align --command="
    SELECT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
        AND c.relname NOT LIKE 'pg_%'
    )
  " | tr -d '[:space:]')"

  if [[ "${has_tables}" != "t" ]]; then
    printf 'No existing public tables; initial database backup is not needed.\n'
    return 0
  fi

  mkdir -p -- "${BACKUP_DIR}" || fail "Cannot create database backup directory ${BACKUP_DIR}."
  chmod 700 "${BACKUP_DIR}" || fail "Cannot restrict permissions on ${BACKUP_DIR}."
  backup_file="$(mktemp "${BACKUP_DIR%/}/pre-schema-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.dump")" \
    || fail "Cannot create a protected database backup file."
  chmod 600 "${backup_file}"
  if ! pg_dump --no-password --format=custom --no-owner --no-acl \
    --file="${backup_file}" "service=${PGSERVICE}"; then
    rm -f -- "${backup_file}"
    fail "pg_dump failed; schema was not changed."
  fi
  if ! pg_restore --list "${backup_file}" >/dev/null; then
    rm -f -- "${backup_file}"
    fail "The database backup could not be validated; schema was not changed."
  fi
  chmod 600 "${backup_file}"
  printf 'Protected pre-migration database backup: %s\n' "${backup_file}"
}

prepare_database() {
  # This stage intentionally checks connectivity only. Schema classification must
  # happen before creating even an extension on an existing, unfamiliar DB.
  check_connection
  printf 'PostgreSQL connection verified; schema changes are deferred until classification.\n'
}

ensure_uuid_function() {
  # PostgreSQL 13+ provides gen_random_uuid() in core. PostgreSQL 12 needs
  # pgcrypto; create it only after the empty/existing schema has been checked.
  if [[ "$(run_psql --tuples-only --no-align --command="SELECT to_regprocedure('gen_random_uuid()') IS NOT NULL" | tr -d '[:space:]')" != "t" ]]; then
    run_psql --command='CREATE EXTENSION IF NOT EXISTS pgcrypto' >/dev/null \
      || fail "Cannot enable pgcrypto for gen_random_uuid(); no application schema was changed."
  fi
  if [[ "$(run_psql --tuples-only --no-align --command="SELECT to_regprocedure('gen_random_uuid()') IS NOT NULL" | tr -d '[:space:]')" != "t" ]]; then
    fail "PostgreSQL pgcrypto/gen_random_uuid() is unavailable; schema was not changed."
  fi
}

verify_catalog() {
  local mode="${1:-}"
  cd "${APP_DIR}"
  if [[ -n "${mode}" ]]; then
    pnpm --filter @workspace/scripts exec tsx "${SCRIPT_DIR}/verify-schema.ts" "${mode}" \
      || fail "The existing database does not match the expected application schema; no existing application table was changed."
  else
    pnpm --filter @workspace/scripts exec tsx "${SCRIPT_DIR}/verify-schema.ts" \
      || fail "The database does not match the complete expected application schema."
  fi
}

migrate_existing_session_columns() {
  # Validate partial/pre-existing session columns before adding either field
  # in one transaction. No unrelated table is touched.
  run_psql --command="
    BEGIN;
    DO \$migration\$
    DECLARE
      has_token_version boolean;
      has_session_nonce boolean;
      invalid_rows boolean;
    BEGIN
      IF to_regclass('public.users') IS NULL THEN
        RAISE EXCEPTION 'Existing database is missing public.users';
      END IF;
      LOCK TABLE public.users IN ACCESS EXCLUSIVE MODE;

      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users'
          AND column_name = 'token_version'
      ) INTO has_token_version;
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users'
          AND column_name = 'session_nonce'
      ) INTO has_session_nonce;

      IF has_token_version AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users'
          AND column_name = 'token_version'
          AND data_type = 'integer' AND is_nullable = 'NO'
          AND column_default ~ '^0(::integer)?$'
      ) THEN
        RAISE EXCEPTION 'Existing users.token_version has an incompatible type, nullability, or default';
      END IF;
      IF has_session_nonce AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users'
          AND column_name = 'session_nonce'
          AND data_type = 'text' AND is_nullable = 'NO'
          AND column_default ~* 'gen_random_uuid'
      ) THEN
        RAISE EXCEPTION 'Existing users.session_nonce has an incompatible type, nullability, or default';
      END IF;

      IF has_token_version THEN
        EXECUTE 'SELECT EXISTS (
          SELECT 1 FROM public.users
          WHERE token_version IS NULL OR token_version < 0
        )' INTO invalid_rows;
        IF invalid_rows THEN
          RAISE EXCEPTION 'Existing users.token_version contains invalid rows';
        END IF;
      END IF;
      IF has_session_nonce THEN
        EXECUTE 'SELECT EXISTS (
          SELECT 1 FROM public.users
          WHERE session_nonce IS NULL
             OR session_nonce !~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''
        )' INTO invalid_rows;
        IF invalid_rows THEN
          RAISE EXCEPTION 'Existing users.session_nonce contains invalid rows';
        END IF;
      END IF;

      IF NOT has_token_version THEN
        ALTER TABLE public.users
          ADD COLUMN token_version integer NOT NULL DEFAULT 0;
      END IF;
      IF NOT has_session_nonce THEN
        ALTER TABLE public.users
          ADD COLUMN session_nonce text NOT NULL DEFAULT gen_random_uuid()::text;
      END IF;
    END;
    \$migration\$;
    COMMIT;
  " || fail "The reviewed additive session migration failed; PostgreSQL rolled it back."
}

apply_empty_schema() {
  cd "${APP_DIR}"
  printf 'Creating the application schema in an empty database.\n'
  if [[ "${EUID}" -eq 0 && -n "${SERVICE_USER}" && "${SERVICE_USER}" != "root" ]]; then
    sudo -u "${SERVICE_USER}" -H --preserve-env=DATABASE_URL -- \
      env CI=1 NODE_ENV=production timeout --foreground 180s \
      pnpm --filter @workspace/db run push </dev/null \
      || fail "Drizzle could not create the schema in the empty database."
  else
    CI=1 NODE_ENV=production timeout --foreground 180s \
      pnpm --filter @workspace/db run push </dev/null \
      || fail "Drizzle could not create the schema in the empty database."
  fi
}

verify_schema() {
  check_connection
  verify_catalog
  verify_user_session_rows
  verify_invitation_rows
  printf 'Full application columns, defaults, keys, and enums verified.\n'
}

verify_user_session_rows() {
  local invalid_rows uuid_function
  invalid_rows="$(run_psql --tuples-only --no-align --command="
    SELECT COUNT(*)
    FROM public.users
    WHERE token_version IS NULL
       OR token_version < 0
       OR session_nonce IS NULL
       OR session_nonce !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  " | tr -d '[:space:]')"
  [[ "${invalid_rows}" == "0" ]] || fail "Database schema check failed: ${invalid_rows} user row(s) have an invalid session token state."

  local definitions
  definitions="$(run_psql --tuples-only --no-align --command="
    SELECT COALESCE(bool_and(
      (column_name = 'token_version'
        AND data_type = 'integer'
        AND is_nullable = 'NO'
        AND column_default ~ '^0(::integer)?$')
      OR
      (column_name = 'session_nonce'
        AND data_type = 'text'
        AND is_nullable = 'NO'
        AND column_default ~* 'gen_random_uuid')
    ), false) AND COUNT(*) = 2
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name IN ('token_version', 'session_nonce')
  " | tr -d '[:space:]')"
  [[ "${definitions}" == "t" ]] || fail "Database schema check failed: session columns have an invalid type, nullability, or default."

  uuid_function="$(run_psql --tuples-only --no-align --command="SELECT to_regprocedure('gen_random_uuid()') IS NOT NULL" | tr -d '[:space:]')"
  [[ "${uuid_function}" == "t" ]] || fail "Database schema check failed: pgcrypto/gen_random_uuid() is unavailable."
  printf 'UUID generation and existing user session rows verified.\n'
}

migrate_existing_invitation_columns() {
  run_psql --command="
    BEGIN;
    DO \$migration\$
    DECLARE
      has_max boolean;
      has_count boolean;
    BEGIN
      LOCK TABLE public.invitations IN ACCESS EXCLUSIVE MODE;
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'invitations'
          AND column_name = 'max_uses'
      ) INTO has_max;
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'invitations'
          AND column_name = 'used_count'
      ) INTO has_count;

      IF has_max AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'invitations'
          AND column_name = 'max_uses'
          AND data_type = 'integer' AND is_nullable = 'YES'
          AND column_default ~ '^1(::integer)?$'
      ) THEN
        RAISE EXCEPTION 'Existing invitations.max_uses has an incompatible definition';
      END IF;
      IF has_count AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'invitations'
          AND column_name = 'used_count'
          AND data_type = 'integer' AND is_nullable = 'NO'
          AND column_default ~ '^0(::integer)?$'
      ) THEN
        RAISE EXCEPTION 'Existing invitations.used_count has an incompatible definition';
      END IF;

      IF NOT has_max THEN
        ALTER TABLE public.invitations
          ADD COLUMN max_uses integer DEFAULT 1;
      END IF;
      IF NOT has_count THEN
        ALTER TABLE public.invitations
          ADD COLUMN used_count integer NOT NULL DEFAULT 0;
        -- Legacy used links stay exhausted. A partially upgraded link with
        -- a custom max is also kept exhausted, never reactivated.
        UPDATE public.invitations
          SET used_count = max_uses WHERE status = 'used' AND max_uses IS NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.invitations
        WHERE max_uses < 1 OR max_uses > 1000 OR used_count < 0
           OR used_count > max_uses
           OR (status = 'pending' AND used_count = max_uses)
           OR (status = 'used' AND (max_uses IS NULL OR used_count <> max_uses))
      ) THEN
        RAISE EXCEPTION 'Existing invitations have invalid registration limits or counts';
      END IF;
    END;
    \$migration\$;
    COMMIT;
  " || fail "The additive invitation migration failed; PostgreSQL rolled it back."
}

verify_invitation_rows() {
  local definitions invalid_rows
  definitions="$(run_psql --tuples-only --no-align --command="
    SELECT COALESCE(bool_and(
      (column_name = 'max_uses' AND data_type = 'integer'
        AND is_nullable = 'YES' AND column_default ~ '^1(::integer)?$')
      OR (column_name = 'used_count' AND data_type = 'integer'
        AND is_nullable = 'NO' AND column_default ~ '^0(::integer)?$')
    ), false) AND COUNT(*) = 2
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invitations'
      AND column_name IN ('max_uses', 'used_count')
  " | tr -d '[:space:]')"
  [[ "${definitions}" == "t" ]] || fail "Invitation registration limit columns have invalid definitions."
  invalid_rows="$(run_psql --tuples-only --no-align --command="
    SELECT COUNT(*) FROM public.invitations
    WHERE max_uses < 1 OR max_uses > 1000 OR used_count < 0
       OR used_count > max_uses
       OR (status = 'pending' AND used_count = max_uses)
       OR (status = 'used' AND (max_uses IS NULL OR used_count <> max_uses))
  " | tr -d '[:space:]')"
  [[ "${invalid_rows}" == "0" ]] || fail "Invalid invitation registration limits or counts: ${invalid_rows} row(s)."
  printf 'Invitation registration limits and existing rows verified.\n'
}

apply_schema() {
  local has_public_objects
  has_public_objects="$(run_psql --tuples-only --no-align --command="
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind <> 't'
      UNION ALL
      SELECT 1 FROM pg_catalog.pg_type
      WHERE typnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 1 FROM pg_catalog.pg_proc
      WHERE pronamespace = 'public'::regnamespace
      UNION ALL
      SELECT 1 FROM pg_catalog.pg_operator
      WHERE oprnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 1 FROM pg_catalog.pg_opclass
      WHERE opcnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 1 FROM pg_catalog.pg_opfamily
      WHERE opfnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 1 FROM pg_catalog.pg_collation
      WHERE collnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 1 FROM pg_catalog.pg_conversion
      WHERE connamespace = 'public'::regnamespace
      UNION ALL
      SELECT 1 FROM pg_catalog.pg_ts_config
      WHERE cfgnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 1 FROM pg_catalog.pg_ts_dict
      WHERE dictnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 1 FROM pg_catalog.pg_ts_parser
      WHERE prsnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 1 FROM pg_catalog.pg_ts_template
      WHERE tmplnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 1 FROM pg_catalog.pg_statistic_ext
      WHERE stxnamespace = 'public'::regnamespace
    )
  " | tr -d '[:space:]')"

  if [[ "${has_public_objects}" == "f" ]]; then
    # Drizzle runs only when public contains no user-defined objects of any
    # supported catalog kind, so reconciliation cannot drop existing objects.
    # The exit code is not trusted: verify the entire expected schema after it.
    ensure_uuid_function
    apply_empty_schema
    verify_catalog
  elif [[ "${has_public_objects}" == "t" ]]; then
    # Existing deployments never go through Drizzle's reconciliation engine.
    # Require every current application table/column to match before applying
    # reviewed additive migrations; unrelated custom tables are ignored.
    verify_catalog --allow-missing-upgrade-columns
    ensure_uuid_function
    migrate_existing_session_columns
    migrate_existing_invitation_columns
    verify_catalog
  else
    fail "Could not classify user-defined objects in the public schema."
  fi
  verify_user_session_rows
  verify_invitation_rows
}

read_mobile_url() {
  run_psql --tuples-only --no-align --command="
    SELECT mobile_web_url
    FROM integration_settings
    WHERE mobile_web_url IS NOT NULL AND mobile_web_url <> ''
    ORDER BY id
    LIMIT 1
  " 2>/dev/null | head -n1 | tr -d '[:space:]' || true
}

case "${COMMAND}" in
  backup)
    backup_existing_database
    ;;
  prepare)
    prepare_database
    ;;
  apply)
    apply_schema
    ;;
  verify)
    verify_schema
    ;;
  migrate)
    backup_existing_database
    prepare_database
    apply_schema
    verify_schema
    ;;
  mobile-url)
    read_mobile_url
    ;;
esac