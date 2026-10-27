BEGIN;
ALTER TABLE wiki_external_links
  ADD COLUMN IF NOT EXISTS check_status text NOT NULL DEFAULT 'unchecked',
  ADD COLUMN IF NOT EXISTS checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_check_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS http_status integer,
  ADD COLUMN IF NOT EXISTS redirect_url text,
  ADD COLUMN IF NOT EXISTS missing_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0;
COMMIT;
