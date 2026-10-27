BEGIN;

DO $migration$
DECLARE
  event_table_exists boolean := to_regclass('public.forum_moderation_events') IS NOT NULL;
BEGIN
  IF event_table_exists THEN
    IF EXISTS (
      SELECT 1
      FROM (
        VALUES
          ('id', 'integer', 'NO'),
          ('module_id', 'integer', 'NO'),
          ('actor_id', 'integer', 'NO'),
          ('actor_name', 'text', 'NO'),
          ('action', 'text', 'NO'),
          ('created_at', 'timestamp with time zone', 'NO')
      ) AS expected(column_name, data_type, is_nullable)
      LEFT JOIN information_schema.columns actual
        ON actual.table_schema = 'public'
       AND actual.table_name = 'forum_moderation_events'
       AND actual.column_name = expected.column_name
      WHERE actual.column_name IS NULL
         OR actual.data_type <> expected.data_type
         OR actual.is_nullable <> expected.is_nullable
    )
    OR (
      SELECT COUNT(*)
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'forum_moderation_events'
    ) <> 6
    OR NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'forum_moderation_events'
        AND column_name = 'id'
        AND column_default LIKE 'nextval(%'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'forum_moderation_events'
        AND column_name = 'created_at'
        AND column_default IN ('now()', 'CURRENT_TIMESTAMP')
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint constraint_row
      JOIN pg_catalog.pg_class table_row
        ON table_row.oid = constraint_row.conrelid
      JOIN pg_catalog.pg_namespace namespace_row
        ON namespace_row.oid = table_row.relnamespace
      WHERE namespace_row.nspname = 'public'
        AND table_row.relname = 'forum_moderation_events'
        AND constraint_row.contype = 'p'
        AND constraint_row.conkey = ARRAY[
          (
            SELECT attribute_row.attnum
            FROM pg_catalog.pg_attribute attribute_row
            WHERE attribute_row.attrelid = table_row.oid
              AND attribute_row.attname = 'id'
          )
        ]::smallint[]
    ) THEN
      RAISE EXCEPTION
        'Existing forum_moderation_events has an incompatible schema';
    END IF;
  ELSE
    CREATE TABLE public.forum_moderation_events (
      id serial PRIMARY KEY,
      module_id integer NOT NULL,
      actor_id integer NOT NULL,
      actor_name text NOT NULL,
      action text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END;
$migration$;

COMMIT;
