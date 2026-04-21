CREATE TABLE IF NOT EXISTS team_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  cite_key TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_references_team_id ON team_references(team_id);
CREATE INDEX IF NOT EXISTS idx_team_references_cite_key ON team_references(cite_key);

ALTER TABLE team_references ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'team_references_select' AND tablename = 'team_references') THEN
    CREATE POLICY team_references_select ON team_references
      FOR SELECT USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'team_references_write' AND tablename = 'team_references') THEN
    CREATE POLICY team_references_write ON team_references
      FOR ALL USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
  END IF;
END $$;
