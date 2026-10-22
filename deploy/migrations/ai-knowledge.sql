BEGIN;
CREATE TABLE IF NOT EXISTS public.ai_knowledge_accounts (
  user_id integer PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  consent_at timestamptz,
  scanned_at timestamptz,
  scan_error text
);
CREATE TABLE IF NOT EXISTS public.ai_knowledge_entries (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  version text NOT NULL,
  text text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  warning text,
  lease_token text,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_knowledge_entries_user_source_uq ON public.ai_knowledge_entries(user_id, source_key);
CREATE INDEX IF NOT EXISTS ai_knowledge_entries_status_idx ON public.ai_knowledge_entries(status, id);
COMMIT;
