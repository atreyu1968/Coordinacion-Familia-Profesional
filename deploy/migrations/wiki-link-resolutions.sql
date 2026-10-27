BEGIN;
ALTER TABLE wiki_external_links
  ADD COLUMN IF NOT EXISTS incident_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_history jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMIT;
