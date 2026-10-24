-- Reviewed additive migration for the retryable chat-attachment deletion queue.
-- Existing rows and object paths are preserved; incompatible primary keys fail
-- closed and roll the entire migration back.
BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_attachment_deletions (
  id serial NOT NULL,
  object_path text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz,
  lease_token text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.chat_attachment_deletions
  ADD COLUMN IF NOT EXISTS id serial,
  ADD COLUMN IF NOT EXISTS object_path text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_token text,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Earlier partial versions may have had an integer id without a sequence
-- default. Repair only the missing default and position the sequence after
-- existing rows; do not rewrite ids.
DO $chat_attachment_deletion_sequence$
DECLARE
  id_type oid;
BEGIN
  SELECT a.atttypid INTO id_type
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.chat_attachment_deletions'::regclass
    AND a.attname = 'id'
    AND NOT a.attisdropped;

  IF id_type <> 'integer'::regtype THEN
    RAISE EXCEPTION 'chat_attachment_deletions.id must be integer; no rows were changed';
  END IF;

  IF pg_catalog.pg_get_serial_sequence(
    'public.chat_attachment_deletions',
    'id'
  ) IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_attrdef d
        ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'public.chat_attachment_deletions'::regclass
        AND a.attname = 'id'
        AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'chat_attachment_deletions.id has an incompatible default; no rows were changed';
    END IF;

    CREATE SEQUENCE IF NOT EXISTS public.chat_attachment_deletions_id_seq;
    ALTER SEQUENCE public.chat_attachment_deletions_id_seq
      OWNED BY public.chat_attachment_deletions.id;
    ALTER TABLE public.chat_attachment_deletions
      ALTER COLUMN id
      SET DEFAULT nextval('public.chat_attachment_deletions_id_seq'::regclass);

    PERFORM pg_catalog.setval(
      'public.chat_attachment_deletions_id_seq'::regclass,
      COALESCE((SELECT MAX(id) FROM public.chat_attachment_deletions), 1),
      EXISTS (SELECT 1 FROM public.chat_attachment_deletions)
    );
  END IF;
END
$chat_attachment_deletion_sequence$;

DO $chat_attachment_deletion_primary_key$
DECLARE
  id_attnum smallint;
BEGIN
  SELECT attnum INTO id_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.chat_attachment_deletions'::regclass
    AND attname = 'id'
    AND NOT attisdropped;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.chat_attachment_deletions'::regclass
      AND c.contype = 'p'
      AND c.conkey = ARRAY[id_attnum]::smallint[]
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'public.chat_attachment_deletions'::regclass
        AND c.contype = 'p'
    ) THEN
      RAISE EXCEPTION 'chat_attachment_deletions has an incompatible primary key; no rows were changed';
    END IF;

    ALTER TABLE public.chat_attachment_deletions
      ADD CONSTRAINT chat_attachment_deletions_pkey PRIMARY KEY (id);
  END IF;
END
$chat_attachment_deletion_primary_key$;

COMMIT;
