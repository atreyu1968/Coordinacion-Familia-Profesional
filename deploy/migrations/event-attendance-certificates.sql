-- Reviewed additive migration. Existing definitions are validated by db.sh
-- before running this file; never drop or replace live tables or records.
BEGIN;
CREATE TABLE IF NOT EXISTS public.event_attendance_settings (
  event_id integer PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  signer_name text NOT NULL,
  signer_role text NOT NULL,
  issue_place text NOT NULL DEFAULT 'Canarias',
  issue_date date,
  modality text NOT NULL DEFAULT 'presencial',
  duration_minutes integer,
  additional_text text NOT NULL DEFAULT '',
  registration_open boolean NOT NULL DEFAULT false,
  registration_token text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS public.event_attendances (
  id serial PRIMARY KEY,
  event_id integer NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  source text NOT NULL DEFAULT 'app',
  status text NOT NULL DEFAULT 'pending',
  registered_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  confirmed_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (event_id, email)
);
CREATE TABLE IF NOT EXISTS public.event_attendance_certificates (
  id serial PRIMARY KEY,
  event_id integer NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  attendance_id integer NOT NULL REFERENCES public.event_attendances(id) ON DELETE CASCADE,
  verification_token text NOT NULL UNIQUE,
  snapshot jsonb NOT NULL,
  issued_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  revocation_reason text,
  notified_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS event_attendance_certificates_active_idx
  ON public.event_attendance_certificates (attendance_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS public.certificate_email_verifications (
  user_id integer PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  code_hash text,
  sent_at timestamptz,
  expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  verified_at timestamptz
);
COMMIT;
