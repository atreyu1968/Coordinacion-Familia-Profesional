BEGIN;

CREATE TABLE IF NOT EXISTS public.coordinator_mail_settings (
  id integer PRIMARY KEY DEFAULT 1,
  google_client_id text,
  google_client_secret_encrypted text,
  google_redirect_uri text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.coordinator_mail_accounts (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  email text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  access_token_expires_at timestamptz,
  oauth_state_hash text,
  oauth_cookie_hash text,
  oauth_verifier_encrypted text,
  oauth_expires_at timestamptz,
  sync_status text NOT NULL DEFAULT 'idle',
  sync_error text,
  sync_page_token text,
  sync_query text,
  sync_lease_until timestamptz,
  next_sync_at timestamptz,
  last_sync_at timestamptz,
  sync_messages_imported integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coordinator_mail_accounts_user_uq
  ON public.coordinator_mail_accounts(user_id);

CREATE TABLE IF NOT EXISTS public.coordinator_mail_case_groups (
  id serial PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coordinator_mail_case_group_owner_idx
  ON public.coordinator_mail_case_groups(owner_id);

CREATE TABLE IF NOT EXISTS public.coordinator_mail_cases (
  id serial PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  group_id integer REFERENCES public.coordinator_mail_case_groups(id) ON DELETE SET NULL,
  gmail_thread_id text,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  due_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  draft_to text NOT NULL DEFAULT '',
  draft_subject text NOT NULL DEFAULT '',
  draft_body text NOT NULL DEFAULT '',
  ai_status text NOT NULL DEFAULT 'idle',
  ai_error text,
  ai_instructions text,
  ai_consent_at timestamptz,
  ai_revision integer,
  ai_requested_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  ai_lease_token text,
  ai_lease_until timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.coordinator_mail_cases
  ADD COLUMN IF NOT EXISTS group_id integer;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.coordinator_mail_cases'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[(
        SELECT attnum FROM pg_catalog.pg_attribute
        WHERE attrelid = 'public.coordinator_mail_cases'::regclass AND attname = 'group_id'
      )]::smallint[]
      AND confrelid = 'public.coordinator_mail_case_groups'::regclass
  ) THEN
    ALTER TABLE public.coordinator_mail_cases
      ADD CONSTRAINT coordinator_mail_cases_group_fk
      FOREIGN KEY (group_id) REFERENCES public.coordinator_mail_case_groups(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS coordinator_mail_case_thread_uq
  ON public.coordinator_mail_cases(owner_id, gmail_thread_id);
CREATE INDEX IF NOT EXISTS coordinator_mail_case_owner_activity_idx
  ON public.coordinator_mail_cases(owner_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS coordinator_mail_case_group_idx
  ON public.coordinator_mail_cases(owner_id, group_id);

CREATE TABLE IF NOT EXISTS public.coordinator_mail_case_threads (
  id serial PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  case_id integer NOT NULL REFERENCES public.coordinator_mail_cases(id) ON DELETE CASCADE,
  gmail_thread_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coordinator_mail_case_thread_map_uq
  ON public.coordinator_mail_case_threads(owner_id, gmail_thread_id);
CREATE INDEX IF NOT EXISTS coordinator_mail_case_thread_case_idx
  ON public.coordinator_mail_case_threads(case_id);

CREATE TABLE IF NOT EXISTS public.coordinator_mail_messages (
  id serial PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  case_id integer NOT NULL REFERENCES public.coordinator_mail_cases(id) ON DELETE CASCADE,
  gmail_thread_id text,
  gmail_message_id text NOT NULL,
  rfc_message_id text,
  direction text NOT NULL DEFAULT 'received',
  sender_email text NOT NULL,
  sender_name text NOT NULL DEFAULT '',
  to_emails text NOT NULL DEFAULT '',
  cc_emails text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  body_text text NOT NULL DEFAULT '',
  body_truncated boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coordinator_mail_message_google_uq
  ON public.coordinator_mail_messages(owner_id, gmail_message_id);
CREATE INDEX IF NOT EXISTS coordinator_mail_message_case_received_idx
  ON public.coordinator_mail_messages(case_id, received_at DESC);

CREATE TABLE IF NOT EXISTS public.coordinator_mail_attachments (
  id serial PRIMARY KEY,
  message_id integer NOT NULL REFERENCES public.coordinator_mail_messages(id) ON DELETE CASCADE,
  provider_attachment_id text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size bigint NOT NULL,
  object_path text,
  status text NOT NULL DEFAULT 'queued',
  error text,
  lease_token text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coordinator_mail_attachment_provider_uq
  ON public.coordinator_mail_attachments(message_id, provider_attachment_id);
CREATE INDEX IF NOT EXISTS coordinator_mail_attachment_path_idx
  ON public.coordinator_mail_attachments(object_path);
CREATE INDEX IF NOT EXISTS coordinator_mail_attachment_status_lease_idx
  ON public.coordinator_mail_attachments(status, lease_until);

CREATE TABLE IF NOT EXISTS public.coordinator_mail_case_notes (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES public.coordinator_mail_cases(id) ON DELETE CASCADE,
  created_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'note',
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coordinator_mail_note_case_created_idx
  ON public.coordinator_mail_case_notes(case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.coordinator_mail_outbox (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES public.coordinator_mail_cases(id) ON DELETE CASCADE,
  gmail_message_id integer REFERENCES public.coordinator_mail_messages(id) ON DELETE SET NULL,
  revision integer NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  error text,
  attempts integer NOT NULL DEFAULT 0,
  lease_token text,
  lease_until timestamptz,
  delivery_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS coordinator_mail_outbox_status_created_idx
  ON public.coordinator_mail_outbox(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS coordinator_mail_outbox_revision_uq
  ON public.coordinator_mail_outbox(case_id, revision);
CREATE UNIQUE INDEX IF NOT EXISTS coordinator_mail_outbox_delivery_uq
  ON public.coordinator_mail_outbox(delivery_message_id);

COMMIT;
