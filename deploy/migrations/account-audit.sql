-- Additive migration for existing installations. Run against a backed-up
-- database before starting the updated application. No historical backfill.
-- Deliberately fail if the table already exists: inspect its definition rather
-- than silently accepting a potentially incompatible table.
BEGIN;
CREATE TABLE public.account_audit (
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
CREATE INDEX account_audit_target_id_id_idx ON public.account_audit (target_id, id);
COMMIT;
