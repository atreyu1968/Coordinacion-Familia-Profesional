BEGIN;
CREATE TABLE IF NOT EXISTS forum_digest_events (
 id serial PRIMARY KEY,
 module_id integer NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
 thread_id integer NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
 actor_id integer REFERENCES users(id) ON DELETE SET NULL,
 event_key text NOT NULL, kind text NOT NULL,
 bucket_at timestamptz NOT NULL, next_attempt_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0, processed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS forum_digest_event_key_uq ON forum_digest_events(module_id,event_key);
CREATE INDEX IF NOT EXISTS forum_digest_pending_idx ON forum_digest_events(processed_at,next_attempt_at);
CREATE INDEX IF NOT EXISTS forum_digest_bucket_idx ON forum_digest_events(module_id,bucket_at);
CREATE TABLE IF NOT EXISTS forum_digest_deliveries (
 module_id integer NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
 bucket_at timestamptz NOT NULL,
 user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 notification_id integer REFERENCES notifications(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(module_id,bucket_at,user_id)
);
COMMIT;
