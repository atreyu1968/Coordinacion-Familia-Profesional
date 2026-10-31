-- Additive stage-1 collaboration metadata only. No changes to legacy threads,
-- messages, modules, sessions or Nextcloud. Strict pre/postflight in db.sh.
BEGIN;
CREATE TABLE IF NOT EXISTS public.forum_collaborations (
  module_id integer PRIMARY KEY REFERENCES public.modules(id),
  enabled boolean NOT NULL DEFAULT false,
  official_code text NOT NULL,
  source_title text NOT NULL,
  source_url text NOT NULL,
  curriculum_version text NOT NULL,
  territory text NOT NULL,
  fingerprint text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  sections jsonb NOT NULL,
  verified_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.forum_collaboration_revisions (
  module_id integer NOT NULL REFERENCES public.forum_collaborations(module_id),
  revision integer NOT NULL,
  configuration jsonb NOT NULL,
  actor_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module_id, revision)
);
CREATE TABLE IF NOT EXISTS public.forum_thread_contexts (
  thread_id integer PRIMARY KEY REFERENCES public.forum_threads(id) ON DELETE CASCADE,
  module_id integer NOT NULL REFERENCES public.modules(id),
  kind text NOT NULL,
  stable_key text NOT NULL,
  outcome_id integer REFERENCES public.module_learning_outcomes(id),
  criterion_id integer REFERENCES public.module_evaluation_criteria(id),
  template_version integer NOT NULL,
  curriculum_version text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS forum_thread_context_module_key_uq
  ON public.forum_thread_contexts(module_id, stable_key);
COMMIT;
