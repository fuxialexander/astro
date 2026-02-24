-- Add team_id to Initiatives table (was missing from teams migration)
ALTER TABLE initiatives ADD COLUMN team_id uuid REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX idx_initiatives_team ON initiatives(team_id);
