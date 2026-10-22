-- Additive and repeatable: legacy users continue using their existing center.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS teaching_center_id integer;
