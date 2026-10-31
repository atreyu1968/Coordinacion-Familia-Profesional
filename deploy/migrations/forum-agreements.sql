BEGIN;
CREATE TABLE IF NOT EXISTS forum_agreements (
 id serial PRIMARY KEY, thread_id integer NOT NULL REFERENCES forum_threads(id),
 module_id integer NOT NULL REFERENCES modules(id), status text NOT NULL DEFAULT 'abierto',
 revision integer NOT NULL DEFAULT 1, version integer NOT NULL DEFAULT 1,
 summary text NOT NULL DEFAULT '', proposed_text text NOT NULL DEFAULT '',
 observations text NOT NULL DEFAULT '', closure_reason text NOT NULL DEFAULT '',
 sources jsonb NOT NULL DEFAULT '[]'::jsonb, source_post_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
 editor_ids jsonb NOT NULL DEFAULT '[]'::jsonb, electorate_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
 document_url text, fingerprint text NOT NULL, curriculum_version text NOT NULL,
 published_page_id integer REFERENCES wiki_pages(id),
 created_by integer REFERENCES users(id) ON DELETE SET NULL,
 updated_by integer REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS forum_agreements_thread_uq ON forum_agreements(thread_id);
CREATE INDEX IF NOT EXISTS forum_agreements_module_status_idx ON forum_agreements(module_id,status);
CREATE TABLE IF NOT EXISTS forum_agreement_revisions (
 id serial PRIMARY KEY, agreement_id integer NOT NULL REFERENCES forum_agreements(id) ON DELETE CASCADE,
 revision integer NOT NULL, version integer NOT NULL, snapshot jsonb NOT NULL,
 published_page_id integer REFERENCES wiki_pages(id),
 actor_id integer REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS forum_agreement_revision_uq ON forum_agreement_revisions(agreement_id,revision);
CREATE INDEX IF NOT EXISTS forum_agreement_published_page_idx ON forum_agreement_revisions(published_page_id);
CREATE TABLE IF NOT EXISTS forum_agreement_positions (
 id serial PRIMARY KEY, agreement_id integer NOT NULL REFERENCES forum_agreements(id) ON DELETE CASCADE,
 version integer NOT NULL, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 center_id integer REFERENCES centers(id) ON DELETE SET NULL, center_name text NOT NULL,
 position text NOT NULL, reason text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS forum_agreement_position_user_version_uq ON forum_agreement_positions(agreement_id,version,user_id);
CREATE TABLE IF NOT EXISTS forum_agreement_position_history (
 id serial PRIMARY KEY, agreement_id integer NOT NULL REFERENCES forum_agreements(id) ON DELETE CASCADE,
 version integer NOT NULL, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 center_id integer REFERENCES centers(id) ON DELETE SET NULL, center_name text NOT NULL,
 position text NOT NULL, reason text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forum_agreement_position_history_idx ON forum_agreement_position_history(agreement_id,version);

-- Protect snapshots even from legacy wiki writers or direct AI actions.
CREATE OR REPLACE FUNCTION protect_forum_agreement_page() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM forum_agreement_revisions WHERE published_page_id=OLD.id) THEN
   IF TG_OP='DELETE' THEN
     RAISE EXCEPTION 'Esta versión de acuerdo es inmutable; crea una nueva versión' USING ERRCODE='23514';
   END IF;
   IF (NEW.title,NEW.content,NEW.module_id,NEW.parent_id,NEW.deleted_at,NEW.tags,NEW.created_by)
      IS DISTINCT FROM (OLD.title,OLD.content,OLD.module_id,OLD.parent_id,OLD.deleted_at,OLD.tags,OLD.created_by) THEN
     RAISE EXCEPTION 'Esta versión de acuerdo es inmutable; crea una nueva versión' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS forum_agreement_page_immutable ON wiki_pages;
CREATE TRIGGER forum_agreement_page_immutable BEFORE UPDATE OR DELETE ON wiki_pages
 FOR EACH ROW EXECUTE FUNCTION protect_forum_agreement_page();
COMMIT;
