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

if [[ "${1:-}" == "--invitations-only" ]]; then
  create_test_database coordina_invitation_registration
  migrate_database coordina_invitation_registration
  DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_invitation_registration?host=${SOCKET_DIR}" \
    pnpm --filter @workspace/api-server exec vitest run test/invitations.test.ts
  exit 0
fi

if [[ "${1:-}" == "--profiles-only" ]]; then
  create_test_database coordina_profiles
  migrate_database coordina_profiles
  DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_profiles?host=${SOCKET_DIR}" \
    pnpm --filter @workspace/api-server exec vitest run test/profile.test.ts test/teaching-profile-access.test.ts test/dashboard.test.ts test/dashboard-record-links.test.ts test/dashboard-cards.test.ts
  exit 0
fi

if [[ "${1:-}" == "--messaging-only" ]]; then
  create_test_database coordina_messaging
  migrate_database coordina_messaging
  DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_messaging?host=${SOCKET_DIR}" \
    pnpm --filter @workspace/api-server exec vitest run test/messaging.test.ts test/forums.test.ts test/teaching-profile-access.test.ts test/event-notifications.test.ts test/announcement-notifications.test.ts
  exit 0
fi

if [[ "${1:-}" == "--lms-preview-only" ]]; then
  create_test_database coordina_lms_preview
  migrate_database coordina_lms_preview
  DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_lms_preview?host=${SOCKET_DIR}" \
    pnpm --filter @workspace/api-server exec vitest run test/lms-preview.test.ts
  exit 0
fi

if [[ "${1:-}" == "--chat-colors-only" ]]; then
  create_test_database coordina_chat_colors
  migrate_database coordina_chat_colors
  DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_chat_colors?host=${SOCKET_DIR}" \
    pnpm --filter @workspace/api-server exec vitest run test/chat-role-colors.test.ts
  exit 0
fi

if [[ "${1:-}" == "--dashboard-only" ]]; then
  create_test_database coordina_dashboard
  migrate_database coordina_dashboard
  DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_dashboard?host=${SOCKET_DIR}" \
    pnpm --filter @workspace/api-server exec vitest run test/dashboard.test.ts test/dashboard-record-links.test.ts test/dashboard-cards.test.ts
  exit 0
fi

run_lms_course_import_tests() {
  create_test_database coordina_lms_course_import
  migrate_database coordina_lms_course_import
  mkdir -m 700 "${TEST_ROOT}/lms-storage"
  COORDINA_LMS_IMPORT_TEST_ROOT="${TEST_ROOT}" \
    DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_lms_course_import?host=${SOCKET_DIR}" \
    STORAGE_DRIVER=local \
    LOCAL_STORAGE_DIR="${TEST_ROOT}/lms-storage" \
    JWT_SECRET="isolated-lms-course-import-test-key-not-for-production" \
    pnpm --filter @workspace/api-server exec vitest run --config vitest.lms-course-import.config.ts
}
if [[ "${1:-}" == "--lms-course-import-only" ]]; then
  run_lms_course_import_tests
  exit 0
fi

run_test_teacher_cleanup_tests() {
  create_test_database coordina_test_teacher_cleanup
  migrate_database coordina_test_teacher_cleanup
  COORDINA_CLEANUP_TEST_ROOT="${TEST_ROOT}" \
    DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_test_teacher_cleanup?host=${SOCKET_DIR}" \
    pnpm --filter @workspace/api-server exec vitest run --config vitest.test-teachers.config.ts
}
if [[ "${1:-}" == "--test-teachers-only" ]]; then
  run_test_teacher_cleanup_tests
  exit 0
fi

run_academic_year_chat_cleanup_tests() {
  create_test_database coordina_chat_cleanup
  migrate_database coordina_chat_cleanup
  COORDINA_CHAT_CLEANUP_TEST_ROOT="${TEST_ROOT}" \
    DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_chat_cleanup?host=${SOCKET_DIR}" \
    pnpm --filter @workspace/api-server exec vitest run --config vitest.chat-cleanup.config.ts
}
if [[ "${1:-}" == "--chat-cleanup-only" ]]; then
  run_academic_year_chat_cleanup_tests
  exit 0
fi

run_test_teacher_cleanup_tests
run_ai_knowledge_tests
run_academic_year_chat_cleanup_tests

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
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="INSERT INTO public.teacher_year_confirmations (teacher_id, school_year, status, deadline, confirmed_at) SELECT id, '2099-2100', 'confirmed', now(), now() FROM public.users WHERE email = 'upgrade-preserve@example.test'; ALTER TABLE public.teacher_year_confirmations DROP COLUMN does_not_teach"

echo "==> Reproducing the old chat visibility schema with retained history"
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="
    INSERT INTO public.chat_groups (name) VALUES ('Preserved upgrade chat');
    INSERT INTO public.chat_group_members (group_id, user_id)
      SELECT g.id, u.id FROM public.chat_groups g CROSS JOIN public.users u
      WHERE g.name = 'Preserved upgrade chat' AND u.email = 'upgrade-preserve@example.test';
    INSERT INTO public.messages (group_id, sender_id, content)
      SELECT g.id, u.id, 'Preserved upgrade message'
      FROM public.chat_groups g CROSS JOIN public.users u
      WHERE g.name = 'Preserved upgrade chat' AND u.email = 'upgrade-preserve@example.test';
    DROP TABLE public.message_user_hides;
    ALTER TABLE public.chat_group_members DROP COLUMN hidden_at;
  "

echo "==> Applying the upgrade to the existing database"
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="ALTER TABLE public.meeting_ai_settings ALTER COLUMN vision_model SET DEFAULT 'gpt-4o-mini'; INSERT INTO public.meeting_ai_settings (id, vision_model) VALUES (1, 'gpt-4o-mini'), (2, 'custom-vision-model')"
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="DROP TABLE public.coordinator_mail_outbox, public.coordinator_mail_case_notes, public.coordinator_mail_attachments, public.coordinator_mail_messages, public.coordinator_mail_case_threads, public.coordinator_mail_cases, public.coordinator_mail_accounts, public.coordinator_mail_settings, public.meeting_minutes_shared_documents, public.meeting_minutes_sources, public.meeting_minutes_messages, public.meeting_minutes, public.event_attendance_certificates, public.event_attendances, public.event_attendance_settings, public.certificate_email_verifications"
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="DROP TABLE public.collaborative_space_audit, public.collaborative_space_members, public.collaborative_spaces, public.account_audit, public.coordinator_tasks, public.coordinator_task_source_scans"
# Reproduce an earlier partial queue schema and retain a queued object path
# while the additive migration fills the missing metadata and primary key.
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="DROP TABLE public.chat_attachment_deletions; CREATE TABLE public.chat_attachment_deletions (id serial, object_path text, status text NOT NULL DEFAULT 'pending'); INSERT INTO public.chat_attachment_deletions (object_path) VALUES ('private/chat/retained-attachment.pdf')"
migrate_database coordina_upgrade
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="
    SELECT EXISTS (
      SELECT 1 FROM public.chat_group_members cm
      JOIN public.chat_groups g ON g.id = cm.group_id
      JOIN public.users u ON u.id = cm.user_id
      JOIN public.messages m ON m.group_id = g.id AND m.sender_id = u.id
      WHERE g.name = 'Preserved upgrade chat' AND u.email = 'upgrade-preserve@example.test'
        AND cm.hidden_at IS NULL AND m.content = 'Preserved upgrade message'
    ) AND NOT EXISTS (SELECT 1 FROM public.message_user_hides);
  " | grep -qx t
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="
    INSERT INTO public.message_user_hides (message_id, user_id)
      SELECT m.id, u.id FROM public.messages m
      JOIN public.users u ON u.id = m.sender_id
      WHERE m.content = 'Preserved upgrade message' AND u.email = 'upgrade-preserve@example.test';
    UPDATE public.chat_group_members SET hidden_at = '2026-01-01T00:00:00Z'
      WHERE group_id IN (SELECT id FROM public.chat_groups WHERE name = 'Preserved upgrade chat');
  "
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="SELECT (SELECT vision_model = 'gpt-5.4-mini' FROM public.meeting_ai_settings WHERE id = 1) AND (SELECT vision_model = 'custom-vision-model' FROM public.meeting_ai_settings WHERE id = 2) AND (SELECT pg_get_expr(d.adbin, d.adrelid) LIKE '%gpt-5.4-mini%' FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum WHERE n.nspname = 'public' AND c.relname = 'meeting_ai_settings' AND a.attname = 'vision_model')" \
  | grep -qx t
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="SELECT attempts = 0 AND status = 'pending' AND object_path = 'private/chat/retained-attachment.pdf' AND created_at IS NOT NULL AND updated_at IS NOT NULL FROM public.chat_attachment_deletions WHERE id = 1" \
  | grep -qx t
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.chat_attachment_deletions'::regclass AND contype = 'p' AND conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.chat_attachment_deletions'::regclass AND attname = 'id')]::smallint[])" \
  | grep -qx t
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid JOIN pg_catalog.pg_class tbl ON tbl.oid = i.indrelid WHERE tbl.oid = 'public.chat_attachment_deletions'::regclass AND idx.relname = 'chat_attachment_deletions_done_completed_at_idx' AND pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) = 'completed_at' AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) LIKE '%status = ''done''%')" \
  | grep -qx t
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="SELECT max_uses = 1 AND used_count = 1 AND status = 'used' FROM public.invitations WHERE code = 'legacy-consumed-link'" \
  | grep -qx t
# Run this before the API suite: its fixtures may clean year confirmations by school year.
echo "==> Verifying an already upgraded database can be upgraded again"
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="SELECT status = 'confirmed' AND does_not_teach = false AND confirmed_at IS NOT NULL FROM public.teacher_year_confirmations WHERE school_year = '2099-2100'" \
  | grep -qx t
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="UPDATE public.teacher_year_confirmations SET does_not_teach = true WHERE school_year = '2099-2100'"
migrate_database coordina_upgrade
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="SELECT status = 'confirmed' AND does_not_teach = true FROM public.teacher_year_confirmations WHERE school_year = '2099-2100'" \
  | grep -qx t
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="SELECT to_regclass('public.lms_course_import_intents') IS NOT NULL" \
  | grep -qx t

echo "==> Running the API regression suite on the upgraded isolated database"
psql --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  "postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  --command="
    SELECT EXISTS (
      SELECT 1 FROM public.message_user_hides h
      JOIN public.messages m ON m.id = h.message_id
      JOIN public.users u ON u.id = h.user_id
      JOIN public.chat_group_members cm ON cm.group_id = m.group_id AND cm.user_id = u.id
      WHERE m.content = 'Preserved upgrade message' AND u.email = 'upgrade-preserve@example.test'
        AND cm.hidden_at = '2026-01-01T00:00:00Z' AND h.created_at IS NOT NULL
    );
  " | grep -qx t
DATABASE_URL="postgresql://postgres@localhost:${PORT}/coordina_upgrade?host=${SOCKET_DIR}" \
  pnpm --filter @workspace/api-server exec vitest run
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
    DO \$drop_task_keys\$
    DECLARE item record;
    BEGIN
      FOR item IN
        SELECT conrelid::regclass AS relation, conname
        FROM pg_catalog.pg_constraint
        WHERE conrelid IN (
          'public.coordinator_tasks'::regclass,
          'public.coordinator_task_source_scans'::regclass
        ) AND contype IN ('p', 'f')
      LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.relation, item.conname);
      END LOOP;
    END
    \$drop_task_keys\$;
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