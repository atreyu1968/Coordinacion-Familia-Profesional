BEGIN;

CREATE TABLE IF NOT EXISTS public.coordinator_tasks (
  id serial PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  review_status text NOT NULL DEFAULT 'accepted',
  source_type text NOT NULL DEFAULT 'manual',
  source_id text,
  source_fingerprint text NOT NULL DEFAULT '',
  source_label text,
  source_date timestamptz,
  resolution text,
  revision integer NOT NULL DEFAULT 1,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coordinator_tasks_status_check CHECK (status IN ('pending', 'in_progress', 'resolved')),
  CONSTRAINT coordinator_tasks_review_status_check CHECK (review_status IN ('suggested', 'accepted', 'dismissed')),
  CONSTRAINT coordinator_tasks_source_type_check CHECK (source_type IN ('manual', 'minutes', 'message', 'email'))
);

CREATE INDEX IF NOT EXISTS coordinator_tasks_owner_status_idx
  ON public.coordinator_tasks(owner_id, status, updated_at);
CREATE INDEX IF NOT EXISTS coordinator_tasks_owner_review_idx
  ON public.coordinator_tasks(owner_id, review_status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS coordinator_tasks_source_fingerprint_uq
  ON public.coordinator_tasks(owner_id, source_type, source_id, source_fingerprint);

CREATE TABLE IF NOT EXISTS public.coordinator_task_source_scans (
  id serial PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id text NOT NULL,
  content_hash text NOT NULL,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coordinator_task_source_scans_type_check CHECK (source_type IN ('minutes', 'message', 'email'))
);
CREATE UNIQUE INDEX IF NOT EXISTS coordinator_task_source_scan_owner_source_uq
  ON public.coordinator_task_source_scans(owner_id, source_type, source_id);

COMMIT;
