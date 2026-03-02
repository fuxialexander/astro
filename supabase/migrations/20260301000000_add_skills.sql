-- Skills table: reusable skill definitions (prompt templates, tool configs,
-- MCP tool bundles) that can be attached to plan nodes or agent sessions.

CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  icon TEXT DEFAULT '⚡',
  prompt_template TEXT NOT NULL DEFAULT '',
  tool_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  mcp_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_builtin BOOLEAN NOT NULL DEFAULT false,
  is_public BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  author_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by category
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);

-- Index for team-scoped queries
CREATE INDEX IF NOT EXISTS idx_skills_team_id ON skills(team_id);

-- Index for author queries
CREATE INDEX IF NOT EXISTS idx_skills_author_id ON skills(author_id);

-- Auto-update updated_at
CREATE TRIGGER skills_updated_at
  BEFORE UPDATE ON skills
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable Row Level Security
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;

-- RLS: team members can view skills belonging to their team
CREATE POLICY "Team members can view team skills"
  ON skills FOR SELECT
  USING (
    -- Public skills are visible to everyone
    is_public = true
    -- Built-in skills are visible to everyone
    OR is_builtin = true
    -- Team members can see their team's skills
    OR EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = skills.team_id
      AND team_members.user_id = auth.uid()
    )
    -- Authors can see their own skills
    OR author_id = auth.uid()
  );

-- RLS: authenticated users can create skills
CREATE POLICY "Authenticated users can create skills"
  ON skills FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      -- Must be team member to create team skills
      team_id IS NULL
      OR EXISTS (
        SELECT 1 FROM team_members
        WHERE team_members.team_id = skills.team_id
        AND team_members.user_id = auth.uid()
      )
    )
  );

-- RLS: authors and team admins can update skills
CREATE POLICY "Authors and team admins can update skills"
  ON skills FOR UPDATE
  USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = skills.team_id
      AND team_members.user_id = auth.uid()
      AND team_members.role IN ('owner', 'admin')
    )
  );

-- RLS: authors and team admins can delete skills
CREATE POLICY "Authors and team admins can delete skills"
  ON skills FOR DELETE
  USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = skills.team_id
      AND team_members.user_id = auth.uid()
      AND team_members.role IN ('owner', 'admin')
    )
  );

-- Service role has full access (for backend operations)
CREATE POLICY "Service role has full access to skills"
  ON skills FOR ALL
  USING (auth.role() = 'service_role');
