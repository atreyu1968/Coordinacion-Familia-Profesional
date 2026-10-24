-- Additive storage for one-use, scope-bound course ZIP uploads.
-- Existing courses and lessons are never modified by this migration.
BEGIN;

CREATE TABLE IF NOT EXISTS public.lms_course_import_intents (
  id serial PRIMARY KEY,
  token_hash text NOT NULL,
  user_id integer NOT NULL,
  module_id integer,
  object_path text NOT NULL,
  name text NOT NULL,
  content_type text NOT NULL,
  size integer NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lms_course_import_intents_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS lms_course_import_intents_expiry_idx
  ON public.lms_course_import_intents(expires_at);

COMMIT;
