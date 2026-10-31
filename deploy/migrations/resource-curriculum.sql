BEGIN;
CREATE TABLE IF NOT EXISTS resource_curriculum (
  resource_id integer PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  module_id integer NOT NULL REFERENCES modules(id),
  origin_center_id integer REFERENCES centers(id) ON DELETE SET NULL,
  revision integer NOT NULL DEFAULT 1,
  canonical_key text NOT NULL,
  license text NOT NULL,
  version text NOT NULL,
  audience text NOT NULL,
  restricted boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  curriculum_version text NOT NULL,
  fingerprint text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS resource_curriculum_canonical_uq ON resource_curriculum(canonical_key);
CREATE INDEX IF NOT EXISTS resource_curriculum_module_idx ON resource_curriculum(module_id);
CREATE TABLE IF NOT EXISTS resource_learning_targets (
  id serial PRIMARY KEY,
  resource_id integer NOT NULL REFERENCES resource_curriculum(resource_id) ON DELETE CASCADE,
  outcome_id integer NOT NULL REFERENCES module_learning_outcomes(id),
  criterion_id integer REFERENCES module_evaluation_criteria(id),
  stable_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS resource_learning_targets_key_uq ON resource_learning_targets(resource_id, stable_key);
CREATE INDEX IF NOT EXISTS resource_learning_targets_outcome_idx ON resource_learning_targets(outcome_id);
CREATE INDEX IF NOT EXISTS resource_learning_targets_criterion_idx ON resource_learning_targets(criterion_id);
COMMIT;
