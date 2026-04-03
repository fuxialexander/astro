-- References table: imported bibliographic references (BibTeX, RIS, EndNote XML)
CREATE TABLE IF NOT EXISTS references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'document',
  title TEXT NOT NULL,
  authors JSONB NOT NULL DEFAULT '[]'::jsonb,
  year TEXT,
  month TEXT,
  abstract TEXT,
  doi TEXT,
  url TEXT,
  journal TEXT,
  volume TEXT,
  issue TEXT,
  pages TEXT,
  publisher TEXT,
  isbn TEXT,
  issn TEXT,
  keywords TEXT[] DEFAULT '{}',
  language TEXT,
  extra JSONB,
  source_format TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS references_project_id_idx ON references(project_id);
CREATE INDEX IF NOT EXISTS references_team_id_idx ON references(team_id);
CREATE INDEX IF NOT EXISTS references_doi_idx ON references(doi);

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
