-- References: academic/literature references with CSL-JSON canonical data model

CREATE TABLE IF NOT EXISTS references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  csl_json JSONB NOT NULL,
  csl_type TEXT NOT NULL,
  title TEXT NOT NULL,
  doi TEXT,
  pmid TEXT,
  arxiv_id TEXT,
  pdf_path TEXT,
  pdf_url TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  zotero_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS references_team_id_idx ON references (team_id);
CREATE INDEX IF NOT EXISTS references_project_id_idx ON references (project_id);
CREATE INDEX IF NOT EXISTS references_title_idx ON references (title);
CREATE INDEX IF NOT EXISTS references_doi_idx ON references (doi);
CREATE INDEX IF NOT EXISTS references_csl_type_idx ON references (csl_type);

ALTER TABLE references ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'references_select') THEN
    CREATE POLICY references_select ON references
      FOR SELECT USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'references_write') THEN
    CREATE POLICY references_write ON references
      FOR ALL USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
  END IF;
END $$;

-- Reference Collections: hierarchical folders for organizing references

CREATE TABLE IF NOT EXISTS reference_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reference_collections_team_id_idx ON reference_collections (team_id);
CREATE INDEX IF NOT EXISTS reference_collections_parent_id_idx ON reference_collections (parent_id);

ALTER TABLE reference_collections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'reference_collections_select') THEN
    CREATE POLICY reference_collections_select ON reference_collections
      FOR SELECT USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'reference_collections_write') THEN
    CREATE POLICY reference_collections_write ON reference_collections
      FOR ALL USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
  END IF;
END $$;

-- Reference Collection Items: many-to-many join table

CREATE TABLE IF NOT EXISTS reference_collection_items (
  collection_id UUID NOT NULL REFERENCES reference_collections(id) ON DELETE CASCADE,
  reference_id UUID NOT NULL REFERENCES references(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, reference_id)
);

ALTER TABLE reference_collection_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'reference_collection_items_select') THEN
    CREATE POLICY reference_collection_items_select ON reference_collection_items
      FOR SELECT USING (
        collection_id IN (
          SELECT id FROM reference_collections
          WHERE team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'reference_collection_items_write') THEN
    CREATE POLICY reference_collection_items_write ON reference_collection_items
      FOR ALL USING (
        collection_id IN (
          SELECT id FROM reference_collections
          WHERE team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
        )
      );
  END IF;
END $$;
