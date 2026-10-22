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
  vision_model TEXT NOT NULL DEFAULT 'gpt-4o-mini'
);
COMMIT;
