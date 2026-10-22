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

-- Existing installations may already have these relations without the
-- constraints below. Repair only absent expected keys; never drop user data or
-- replace a conflicting key. The transaction fails closed on duplicates,
-- orphaned owners, or an incompatible existing key.
DO $coordinator_task_keys$
DECLARE
  task_id_attnum smallint;
  task_owner_attnum smallint;
  scan_id_attnum smallint;
  scan_owner_attnum smallint;
  user_id_attnum smallint;
BEGIN
  SELECT attnum INTO task_id_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.coordinator_tasks'::regclass
    AND attname = 'id' AND NOT attisdropped;
  SELECT attnum INTO task_owner_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.coordinator_tasks'::regclass
    AND attname = 'owner_id' AND NOT attisdropped;
  SELECT attnum INTO scan_id_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.coordinator_task_source_scans'::regclass
    AND attname = 'id' AND NOT attisdropped;
  SELECT attnum INTO scan_owner_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.coordinator_task_source_scans'::regclass
    AND attname = 'owner_id' AND NOT attisdropped;
  SELECT attnum INTO user_id_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.users'::regclass
    AND attname = 'id' AND NOT attisdropped;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.coordinator_tasks'::regclass
      AND c.contype = 'p'
      AND c.conkey = ARRAY[task_id_attnum]::smallint[]
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'public.coordinator_tasks'::regclass
        AND c.contype = 'p'
    ) THEN
      RAISE EXCEPTION 'coordinator_tasks has an incompatible primary key; no rows were changed';
    END IF;
    ALTER TABLE public.coordinator_tasks
      ADD CONSTRAINT coordinator_tasks_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.coordinator_tasks'::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[task_owner_attnum]::smallint[]
      AND c.confrelid = 'public.users'::regclass
      AND c.confkey = ARRAY[user_id_attnum]::smallint[]
      AND c.confdeltype = 'c'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'public.coordinator_tasks'::regclass
        AND c.contype = 'f'
        AND task_owner_attnum = ANY(c.conkey)
    ) THEN
      RAISE EXCEPTION 'coordinator_tasks.owner_id has an incompatible foreign key; no rows were changed';
    END IF;
    ALTER TABLE public.coordinator_tasks
      ADD CONSTRAINT coordinator_tasks_owner_id_users_id_fk
      FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.coordinator_task_source_scans'::regclass
      AND c.contype = 'p'
      AND c.conkey = ARRAY[scan_id_attnum]::smallint[]
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'public.coordinator_task_source_scans'::regclass
        AND c.contype = 'p'
    ) THEN
      RAISE EXCEPTION 'coordinator_task_source_scans has an incompatible primary key; no rows were changed';
    END IF;
    ALTER TABLE public.coordinator_task_source_scans
      ADD CONSTRAINT coordinator_task_source_scans_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.coordinator_task_source_scans'::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[scan_owner_attnum]::smallint[]
      AND c.confrelid = 'public.users'::regclass
      AND c.confkey = ARRAY[user_id_attnum]::smallint[]
      AND c.confdeltype = 'c'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'public.coordinator_task_source_scans'::regclass
        AND c.contype = 'f'
        AND scan_owner_attnum = ANY(c.conkey)
    ) THEN
      RAISE EXCEPTION 'coordinator_task_source_scans.owner_id has an incompatible foreign key; no rows were changed';
    END IF;
    ALTER TABLE public.coordinator_task_source_scans
      ADD CONSTRAINT coordinator_task_source_scans_owner_id_users_id_fk
      FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$coordinator_task_keys$;

CREATE UNIQUE INDEX IF NOT EXISTS coordinator_task_source_scan_owner_source_uq
  ON public.coordinator_task_source_scans(owner_id, source_type, source_id);

COMMIT;
