-- References table for storing academic references in CSL-JSON format
CREATE TABLE IF NOT EXISTS references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',
  zotero_key TEXT,
  zotero_library_id TEXT,
  zotero_version INTEGER,
  csl_json JSONB NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  authors TEXT NOT NULL DEFAULT '',
  year TEXT,
  doi TEXT,
  abstract TEXT,
  item_type TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS references_user_id_idx ON references(user_id);
CREATE INDEX IF NOT EXISTS references_team_id_idx ON references(team_id);
CREATE INDEX IF NOT EXISTS references_source_idx ON references(source);
CREATE UNIQUE INDEX IF NOT EXISTS references_zotero_key_library_user_idx
  ON references(user_id, zotero_key, zotero_library_id)
  WHERE zotero_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS references_doi_idx ON references(doi);

-- Zotero sync state table for incremental sync tracking
CREATE TABLE IF NOT EXISTS zotero_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  library_type TEXT NOT NULL,
  library_id TEXT NOT NULL,
  library_name TEXT NOT NULL DEFAULT '',
  last_sync_version INTEGER NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT zotero_sync_state_user_library_unique UNIQUE (user_id, library_type, library_id)
);

CREATE INDEX IF NOT EXISTS zotero_sync_state_user_id_idx ON zotero_sync_state(user_id);

-- RLS policies for references
ALTER TABLE references ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'references_select') THEN
    CREATE POLICY references_select ON references
      FOR SELECT USING (user_id = auth.uid() OR team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'references_insert') THEN
    CREATE POLICY references_insert ON references
      FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'references_update') THEN
    CREATE POLICY references_update ON references
      FOR UPDATE USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'references_delete') THEN
    CREATE POLICY references_delete ON references
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- RLS policies for zotero_sync_state
ALTER TABLE zotero_sync_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'zotero_sync_state_select') THEN
    CREATE POLICY zotero_sync_state_select ON zotero_sync_state
      FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'zotero_sync_state_write') THEN
    CREATE POLICY zotero_sync_state_write ON zotero_sync_state
      FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;
