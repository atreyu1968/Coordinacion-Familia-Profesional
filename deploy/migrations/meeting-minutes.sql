BEGIN;
CREATE TABLE IF NOT EXISTS meeting_minutes (
  event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  revision INTEGER NOT NULL DEFAULT 0,
  draft_text TEXT NOT NULL DEFAULT '',
  published_text TEXT,
  published_at TIMESTAMPTZ,
  published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  generation_status TEXT NOT NULL DEFAULT 'idle',
  generation_error TEXT,
  generation_instructions TEXT,
  generation_revision INTEGER,
  generation_requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meeting_minutes_sources (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES meeting_minutes(event_id) ON DELETE CASCADE,
  object_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'evidence',
  status TEXT NOT NULL DEFAULT 'queued',
  extracted_text TEXT NOT NULL DEFAULT '',
  error TEXT,
  consent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meeting_minutes_shared_documents (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES meeting_minutes(event_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  object_path TEXT UNIQUE,
  url TEXT,
  file_name TEXT,
  content_type TEXT,
  size INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  CONSTRAINT meeting_minutes_shared_documents_kind_check CHECK (
    (kind = 'file' AND object_path IS NOT NULL AND url IS NULL
      AND file_name IS NOT NULL AND content_type IS NOT NULL AND size > 0)
    OR (kind = 'link' AND object_path IS NULL AND url IS NOT NULL
      AND file_name IS NULL AND content_type IS NULL AND size IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS meeting_minutes_shared_documents_event_idx
  ON meeting_minutes_shared_documents (event_id, created_at);
CREATE TABLE IF NOT EXISTS meeting_minutes_messages (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES meeting_minutes(event_id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meeting_ai_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  api_key TEXT,
  transcription_model TEXT NOT NULL DEFAULT 'gpt-4o-mini-transcribe',
  vision_model TEXT NOT NULL DEFAULT 'gpt-5.4-mini'
);
ALTER TABLE meeting_ai_settings
  ALTER COLUMN vision_model SET DEFAULT 'gpt-5.4-mini';
UPDATE meeting_ai_settings
  SET vision_model = 'gpt-5.4-mini'
  WHERE vision_model = 'gpt-4o-mini';
COMMIT;
