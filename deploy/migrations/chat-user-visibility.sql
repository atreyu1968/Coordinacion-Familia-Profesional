-- Personal message/conversation visibility, without changing existing history
-- or membership. Existing incompatible tables are rejected by schema preflight.
BEGIN;

ALTER TABLE public.chat_group_members
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

CREATE TABLE IF NOT EXISTS public.message_user_hides (
  id serial PRIMARY KEY,
  message_id integer NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_user_hides_user_message_unique UNIQUE (user_id, message_id)
);

COMMIT;
