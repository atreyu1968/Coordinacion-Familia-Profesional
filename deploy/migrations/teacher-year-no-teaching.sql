BEGIN;
ALTER TABLE teacher_year_confirmations
  ADD COLUMN IF NOT EXISTS does_not_teach BOOLEAN NOT NULL DEFAULT false;
COMMIT;
