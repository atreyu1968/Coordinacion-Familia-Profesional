CREATE TABLE IF NOT EXISTS normativa_publications (
  id serial PRIMARY KEY, source text NOT NULL, official_id text NOT NULL,
  title text NOT NULL, url text NOT NULL, published_at date,
  detected_at timestamptz NOT NULL DEFAULT now(), checked_at timestamptz NOT NULL DEFAULT now(),
  relevance text NOT NULL, reason text NOT NULL, status text NOT NULL DEFAULT 'pending',
  review_note text NOT NULL DEFAULT '', reviewed_by integer, reviewed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS normativa_publications_official_unique ON normativa_publications(source, official_id);
CREATE TABLE IF NOT EXISTS normativa_sources (
  source text PRIMARY KEY, started_from date NOT NULL, covered_through date,
  attempted_at timestamptz, succeeded_at timestamptz, error text
);
