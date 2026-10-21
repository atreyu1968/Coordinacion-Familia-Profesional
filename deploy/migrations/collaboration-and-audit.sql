-- Reviewed additive upgrade for existing installations.
-- db.sh validates every existing relation first; IF NOT EXISTS is NOT a
-- substitute for that validation. Never replace or truncate a table.
BEGIN;

CREATE TABLE IF NOT EXISTS public.collaborative_spaces (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  provisioning_started_at timestamptz
);
ALTER TABLE public.collaborative_spaces
  ADD COLUMN IF NOT EXISTS provisioning_started_at timestamptz;

CREATE TABLE IF NOT EXISTS public.collaborative_space_members (
  space_id integer NOT NULL REFERENCES public.collaborative_spaces(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.collaborative_space_audit (
  id serial PRIMARY KEY,
  space_id integer NOT NULL REFERENCES public.collaborative_spaces(id) ON DELETE CASCADE,
  space_name text NOT NULL,
  actor_id integer NOT NULL,
  actor_name text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collaborative_space_audit_page_idx
  ON public.collaborative_space_audit (space_id, created_at, id);

-- Independent snapshots, intentionally without account FKs or backfill.
CREATE TABLE IF NOT EXISTS public.account_audit (
  id serial PRIMARY KEY,
  actor_id integer NOT NULL,
  actor_name text NOT NULL,
  target_id integer NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  changes jsonb NOT NULL,
  before_province_id integer,
  after_province_id integer,
  before_center_id integer,
  after_center_id integer,
  before_role text NOT NULL,
  after_role text NOT NULL
);
CREATE INDEX IF NOT EXISTS account_audit_target_id_id_idx
  ON public.account_audit (target_id, id);

COMMIT;
