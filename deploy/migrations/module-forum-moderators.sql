BEGIN;

DO $migration$
BEGIN
  IF to_regclass('public.module_memberships') IS NULL THEN
    RAISE EXCEPTION 'Existing database is missing public.module_memberships';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'module_memberships'
      AND column_name = 'forum_moderator'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'module_memberships'
        AND column_name = 'forum_moderator'
        AND data_type = 'boolean'
        AND is_nullable = 'NO'
        AND column_default IN ('false', 'false::boolean')
    ) THEN
      RAISE EXCEPTION
        'Existing module_memberships.forum_moderator has an incompatible type, nullability, or default';
    END IF;
  ELSE
    ALTER TABLE public.module_memberships
      ADD COLUMN forum_moderator boolean NOT NULL DEFAULT false;
  END IF;
END;
$migration$;

COMMIT;
