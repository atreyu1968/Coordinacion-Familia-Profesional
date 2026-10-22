#!/usr/bin/env bash
# Exercise empty-install and upgrade migrations on a private PostgreSQL cluster.
# Run as an unprivileged user; this script never contacts a configured/shared DB.
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this isolated database test as an unprivileged user, not root." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
for tool in initdb pg_ctl psql pg_restore pnpm node; do
  command -v "${tool}" >/dev/null 2>&1 || {
    echo "Required test tool not found: ${tool}" >&2
    exit 1
  }
done

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/coordina-db-test.XXXXXX")"
PGDATA="${TEST_ROOT}/data"
SOCKET_DIR="${TEST_ROOT}/socket"
BACKUP_DIR="${TEST_ROOT}/backups"
mkdir -m 700 "${SOCKET_DIR}" "${BACKUP_DIR}"
PGLOG="${TEST_ROOT}/postgres.log"
PORT=55439
DATABASE_URL=""

cleanup() {
  if [[ -d "${PGDATA}" ]]; then
    pg_ctl -D "${PGDATA}" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf -- "${TEST_ROOT}"
}
trap cleanup EXIT

initdb -D "${PGDATA}" --username=postgres --auth-local=trust --auth-host=trust >/dev/null
pg_ctl -D "${PGDATA}" -l "${PGLOG}" \
  -o "-F -k ${SOCKET_DIR} -p ${PORT} -c listen_addresses=''" \
  -w start >/dev/null

create_test_database() {
  local name="$1"
  createdb --host="${SOCKET_DIR}" --port="${PORT}" --username=postgres "${name}"
}

migrate_database() {
  local name="$1"
  DATABASE_URL="postgresql://postgres@localhost:${PORT}/${name}?host=${SOCKET_DIR}&application_name=isolated%20migration%20test"
  export DATABASE_URL DB_BACKUP_DIR="${BACKUP_DIR}"
  bash "${SCRIPT_DIR}/db.sh" migrate
}

# A fast, independently runnable security regression suite. Both the URL and
# server identity are checked by the test before it creates any fixtures.
run_ai_knowledge_tests() {
  create_test_database coordina_ai_knowledge
  migrate_database coordina_ai_knowledge
  COORDINA_AI_TEST_ROOT="${TEST_ROOT}" \
    DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_ai_knowledge?host=${SOCKET_DIR}" \
    pnpm --filter @workspace/api-server exec vitest run --config vitest.ai-knowledge.config.ts
}

if [[ "${1:-}" == "--ai-knowledge-only" ]]; then
  run_ai_knowledge_tests
  exit 0
fi

run_ai_knowledge_tests

echo "==> Testing an empty self-hosted database"
create_test_database coordina_empty
migrate_database coordina_empty
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_empty?host=${SOCKET_DIR}" \
  DB_BACKUP_DIR="${BACKUP_DIR}" bash "${SCRIPT_DIR}/db.sh" verify

echo "==> Rejecting an unrelated public table before Drizzle can push"
create_test_database coordina_unknown_public
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_unknown_public?host=${SOCKET_DIR}" \
  psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_unknown_public?host=${SOCKET_DIR}" \
  --command="CREATE TABLE public.unrelated_only (id integer PRIMARY KEY, payload text NOT NULL); INSERT INTO public.unrelated_only VALUES (9, 'preserve-me')"
if migrate_database coordina_unknown_public; then
  echo "Expected an unrelated public table to block Drizzle schema creation." >&2
  exit 1
fi
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_unknown_public?host=${SOCKET_DIR}" \
  psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_unknown_public?host=${SOCKET_DIR}" \
  --command="SELECT to_regclass('public.users') IS NULL AND EXISTS (SELECT 1 FROM public.unrelated_only WHERE id = 9 AND payload = 'preserve-me')" \
  | grep -qx t

echo "==> Rejecting a non-table public object before Drizzle can push"
create_test_database coordina_public_object
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_public_object?host=${SOCKET_DIR}" \
  psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_public_object?host=${SOCKET_DIR}" \
  --command="CREATE TYPE public.unrelated_enum AS ENUM ('unused')"
if migrate_database coordina_public_object; then
  echo "Expected an unrelated public enum to block Drizzle schema creation." >&2
  exit 1
fi
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_public_object?host=${SOCKET_DIR}" \
  psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_public_object?host=${SOCKET_DIR}" \
  --command="SELECT to_regclass('public.users') IS NULL AND to_regtype('public.unrelated_enum') IS NOT NULL" \
  | grep -qx t

echo "==> Rejecting a missing users.email UNIQUE constraint before migration"
create_test_database coordina_missing_email_unique
migrate_database coordina_missing_email_unique
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_missing_email_unique?host=${SOCKET_DIR}" \
  psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_missing_email_unique?host=${SOCKET_DIR}" \
  --command="ALTER TABLE public.users DROP CONSTRAINT users_email_unique"
if migrate_database coordina_missing_email_unique; then
  echo "Expected migration to reject the missing users.email UNIQUE constraint." >&2
  exit 1
fi
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_missing_email_unique?host=${SOCKET_DIR}" \
  psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_missing_email_unique?host=${SOCKET_DIR}" \
  --command="SELECT NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND t.relname = 'users' AND c.contype = 'u' AND (SELECT array_agg(a.attname ORDER BY k.position) FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, position) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) = ARRAY['email']::name[])" \
  | grep -qx t

echo "==> Preparing an existing database with preserved user data"
create_test_database coordina_upgrade
migrate_database coordina_upgrade
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="CREATE TABLE public.custom_preserve (id integer PRIMARY KEY, payload text NOT NULL); INSERT INTO public.custom_preserve VALUES (7, 'keep-exactly'); INSERT INTO public.users (name, email, password_hash, role) VALUES ('Preserved migration user', 'upgrade-preserve@example.test', 'test-only-hash', 'teacher'); ALTER TABLE public.users DROP COLUMN token_version, DROP COLUMN session_nonce, DROP COLUMN legal_accepted_at, DROP COLUMN legal_terms_version, DROP COLUMN legal_privacy_version"
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="INSERT INTO public.invitations (code, role, status, expires_at) VALUES ('legacy-consumed-link', 'teacher', 'used', now() + interval '1 day'); ALTER TABLE public.invitations DROP COLUMN max_uses, DROP COLUMN used_count"

echo "==> Applying the upgrade to the existing database"
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="DROP TABLE public.coordinator_mail_outbox, public.coordinator_mail_case_notes, public.coordinator_mail_attachments, public.coordinator_mail_messages, public.coordinator_mail_case_threads, public.coordinator_mail_cases, public.coordinator_mail_accounts, public.coordinator_mail_settings, public.meeting_minutes_shared_documents, public.meeting_minutes_sources, public.meeting_minutes_messages, public.meeting_minutes, public.meeting_ai_settings, public.event_attendance_certificates, public.event_attendances, public.event_attendance_settings, public.certificate_email_verifications"
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="DROP TABLE public.collaborative_space_audit, public.collaborative_space_members, public.collaborative_spaces, public.account_audit"
migrate_database coordina_upgrade
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="SELECT max_uses = 1 AND used_count = 1 AND status = 'used' FROM public.invitations WHERE code = 'legacy-consumed-link'" \
  | grep -qx t
echo "==> Testing bounded and unlimited invitations on the isolated database"
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  pnpm --filter @workspace/api-server exec vitest run test/invitations.test.ts test/event-certificates.test.ts test/event-accreditations.test.ts test/meeting-minutes.test.ts test/native-wiki.test.ts test/ai-knowledge-nextcloud.unit.test.ts
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="SELECT name = 'Preserved migration user' AND token_version = 0 AND session_nonce ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND legal_accepted_at IS NULL AND legal_terms_version IS NULL AND legal_privacy_version IS NULL FROM public.users WHERE email = 'upgrade-preserve@example.test'" \
  | grep -qx t
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="SELECT id = 7 AND payload = 'keep-exactly' FROM public.custom_preserve WHERE id = 7" \
  | grep -qx t

echo "==> Verifying an already upgraded database can be upgraded again"
migrate_database coordina_upgrade
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="INSERT INTO public.collaborative_spaces (name) VALUES ('Preserved independent space'); INSERT INTO public.account_audit (actor_id, actor_name, target_id, action, changes, before_role, after_role) SELECT id, name, id, 'update', '[]'::jsonb, role::text, role::text FROM public.users WHERE email = 'upgrade-preserve@example.test'; ALTER TABLE public.collaborative_spaces DROP COLUMN provisioning_started_at"
migrate_database coordina_upgrade
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="SELECT EXISTS (SELECT 1 FROM public.collaborative_spaces WHERE name = 'Preserved independent space' AND provisioning_started_at IS NULL) AND EXISTS (SELECT 1 FROM public.account_audit WHERE actor_name = 'Preserved migration user')" \
  | grep -qx t

echo "==> Repairing missing coordinator task keys and indexes without losing rows"
create_test_database coordina_task_constraints_upgrade
migrate_database coordina_task_constraints_upgrade
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_task_constraints_upgrade?host=${SOCKET_DIR}" \
  --command="
    INSERT INTO public.users (name, email, password_hash, role)
      VALUES ('Preserved task owner', 'task-constraints@example.test', 'test-only-hash', 'teacher');
    INSERT INTO public.coordinator_tasks
      (owner_id, title, source_type, source_id, source_fingerprint)
      SELECT id, 'Preserve this task', 'minutes', 'source-1', 'fingerprint-1'
      FROM public.users WHERE email = 'task-constraints@example.test';
    INSERT INTO public.coordinator_task_source_scans
      (owner_id, source_type, source_id, content_hash)
      SELECT id, 'minutes', 'source-1', 'hash-1'
      FROM public.users WHERE email = 'task-constraints@example.test';
    ALTER TABLE public.coordinator_tasks
      DROP CONSTRAINT coordinator_tasks_pkey,
      DROP CONSTRAINT coordinator_tasks_owner_id_fkey;
    ALTER TABLE public.coordinator_task_source_scans
      DROP CONSTRAINT coordinator_task_source_scans_pkey,
      DROP CONSTRAINT coordinator_task_source_scans_owner_id_fkey;
    DROP INDEX public.coordinator_tasks_owner_status_idx;
    DROP INDEX public.coordinator_tasks_owner_review_idx;
    DROP INDEX public.coordinator_tasks_source_fingerprint_uq;
    DROP INDEX public.coordinator_task_source_scan_owner_source_uq;
  "
migrate_database coordina_task_constraints_upgrade
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_task_constraints_upgrade?host=${SOCKET_DIR}" \
  --command="
    SELECT
      EXISTS (SELECT 1 FROM public.coordinator_tasks WHERE title = 'Preserve this task')
      AND EXISTS (SELECT 1 FROM public.coordinator_task_source_scans WHERE content_hash = 'hash-1')
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.coordinator_tasks'::regclass AND conname = 'coordinator_tasks_pkey' AND contype = 'p')
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.coordinator_tasks'::regclass AND conname = 'coordinator_tasks_owner_id_users_id_fk' AND contype = 'f')
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.coordinator_task_source_scans'::regclass AND conname = 'coordinator_task_source_scans_pkey' AND contype = 'p')
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.coordinator_task_source_scans'::regclass AND conname = 'coordinator_task_source_scans_owner_id_users_id_fk' AND contype = 'f')
      AND to_regclass('public.coordinator_tasks_owner_status_idx') IS NOT NULL
      AND to_regclass('public.coordinator_tasks_owner_review_idx') IS NOT NULL
      AND to_regclass('public.coordinator_tasks_source_fingerprint_uq') IS NOT NULL
      AND to_regclass('public.coordinator_task_source_scan_owner_source_uq') IS NOT NULL
  " | grep -qx t

echo "==> Upgrading the mail grouping schema without changing existing mail records"
create_test_database coordina_mail_group_upgrade
migrate_database coordina_mail_group_upgrade
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_mail_group_upgrade?host=${SOCKET_DIR}" \
  --command="
    INSERT INTO public.users (name, email, password_hash, role)
      VALUES ('Preserved mail owner', 'mail-group-upgrade@example.test', 'test-only-hash', 'teacher');
    INSERT INTO public.coordinator_mail_cases
      (owner_id, gmail_thread_id, title, draft_to, draft_subject, draft_body)
      SELECT id, 'preserved-thread', 'Preserved mail case', 'reply@example.test', 'Re: subject', 'Keep this draft'
      FROM public.users WHERE email = 'mail-group-upgrade@example.test';
    INSERT INTO public.coordinator_mail_messages
      (owner_id, case_id, gmail_message_id, sender_email, subject, body_text, received_at)
      SELECT owner_id, id, 'preserved-message', 'sender@example.test', 'Original subject', 'Keep this message', now()
      FROM public.coordinator_mail_cases WHERE title = 'Preserved mail case';
    INSERT INTO public.coordinator_mail_attachments
      (message_id, provider_attachment_id, file_name, content_type, size)
      SELECT id, 'preserved-attachment', 'original.pdf', 'application/pdf', 12
      FROM public.coordinator_mail_messages WHERE gmail_message_id = 'preserved-message';
    INSERT INTO public.coordinator_mail_case_notes (case_id, content)
      SELECT id, 'Keep this note' FROM public.coordinator_mail_cases WHERE title = 'Preserved mail case';
    INSERT INTO public.coordinator_mail_outbox (case_id, revision, recipient, subject, body_text, status)
      SELECT id, revision, 'reply@example.test', 'Re: subject', 'Keep this sent response', 'sent'
      FROM public.coordinator_mail_cases WHERE title = 'Preserved mail case';
    ALTER TABLE public.coordinator_mail_cases DROP COLUMN group_id;
    DROP TABLE public.coordinator_mail_case_groups;
  "
migrate_database coordina_mail_group_upgrade
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_mail_group_upgrade?host=${SOCKET_DIR}" \
  --command="
    SELECT
      (SELECT group_id IS NULL AND draft_body = 'Keep this draft'
        FROM public.coordinator_mail_cases WHERE title = 'Preserved mail case')
      AND (SELECT body_text = 'Keep this message'
        FROM public.coordinator_mail_messages WHERE gmail_message_id = 'preserved-message')
      AND (SELECT file_name = 'original.pdf'
        FROM public.coordinator_mail_attachments WHERE provider_attachment_id = 'preserved-attachment')
      AND (SELECT content = 'Keep this note'
        FROM public.coordinator_mail_case_notes WHERE content = 'Keep this note')
      AND (SELECT body_text = 'Keep this sent response' AND status = 'sent'
        FROM public.coordinator_mail_outbox WHERE body_text = 'Keep this sent response')
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.conrelid = 'public.coordinator_mail_cases'::regclass
          AND c.contype = 'f' AND a.attname = 'group_id'
          AND c.confrelid = 'public.coordinator_mail_case_groups'::regclass
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public' AND tablename = 'coordinator_mail_cases'
          AND indexname = 'coordinator_mail_case_group_idx'
      )
  " | grep -qx t
echo "==> Verifying the mail grouping upgrade is idempotent"
migrate_database coordina_mail_group_upgrade
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_mail_group_upgrade?host=${SOCKET_DIR}" \
  --command="SELECT group_id IS NULL AND draft_body = 'Keep this draft' FROM public.coordinator_mail_cases WHERE title = 'Preserved mail case'" \
  | grep -qx t

echo "==> Rejecting an incompatible existing additive table before touching other tables"
create_test_database coordina_invalid_addition
migrate_database coordina_invalid_addition
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_invalid_addition?host=${SOCKET_DIR}" \
  --command="ALTER TABLE public.collaborative_spaces ALTER COLUMN name TYPE varchar(160); ALTER TABLE public.users DROP COLUMN token_version"
if migrate_database coordina_invalid_addition; then
  echo "Expected rejection of the incompatible collaborative_spaces definition." >&2
  exit 1
fi
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_invalid_addition?host=${SOCKET_DIR}" \
  --command="SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='token_version')" \
  | grep -qx t

echo "==> Rejecting a name collision with an empty table"
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_invalid_addition?host=${SOCKET_DIR}" \
  --command="ALTER TABLE public.collaborative_spaces ALTER COLUMN name TYPE text; DROP TABLE public.account_audit; CREATE TABLE public.account_audit ()"
if migrate_database coordina_invalid_addition; then
  echo "Expected rejection of an existing empty account_audit relation." >&2
  exit 1
fi

psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_invalid_addition?host=${SOCKET_DIR}" \
  --command="SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='token_version') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='account_audit')" \
  | grep -qx t

echo "==> Rejecting an incompatible pre-existing session nonce without data changes"
create_test_database coordina_invalid_nonce
migrate_database coordina_invalid_nonce
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_invalid_nonce?host=${SOCKET_DIR}" \
  psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_invalid_nonce?host=${SOCKET_DIR}" \
  --command="INSERT INTO public.users (name, email, password_hash, role) VALUES ('Invalid schema user', 'invalid-nonce@example.test', 'test-only-hash', 'teacher'); ALTER TABLE public.users ALTER COLUMN session_nonce TYPE varchar(36)"
if DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_invalid_nonce?host=${SOCKET_DIR}" \
  DB_BACKUP_DIR="${BACKUP_DIR}" bash "${SCRIPT_DIR}/db.sh" migrate; then
  echo "Expected migration to reject the incompatible session_nonce column." >&2
  exit 1
fi
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_invalid_nonce?host=${SOCKET_DIR}" \
  psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_invalid_nonce?host=${SOCKET_DIR}" \
  --command="SELECT data_type = 'character varying' AND EXISTS (SELECT 1 FROM public.users WHERE email = 'invalid-nonce@example.test') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'session_nonce'" \
  | grep -qx t

shopt -s nullglob
BACKUPS=("${BACKUP_DIR}"/pre-schema-*.dump)
(( ${#BACKUPS[@]} > 0 )) || {
  echo "Expected a protected pre-migration database backup for the upgrade test." >&2
  exit 1
}
[[ "$(stat -c '%a' "${BACKUP_DIR}")" == "700" ]] || {
  echo "Backup directory permissions are not restricted: ${BACKUP_DIR}" >&2
  exit 1
}
for backup in "${BACKUPS[@]}"; do
  [[ "$(stat -c '%a' "${backup}")" == "600" ]] || {
    echo "Backup file permissions are not restricted: ${backup}" >&2
    exit 1
  }
  pg_restore --list "${backup}" >/dev/null
done

echo "Isolated empty-install and upgrade migration tests passed."