ALTER TABLE team_references
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS added_by TEXT NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS source_project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_team_references_status ON team_references(status);
