-- Additive and repeatable: historical notices intentionally keep a NULL target.
BEGIN;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target jsonb;
COMMIT;
