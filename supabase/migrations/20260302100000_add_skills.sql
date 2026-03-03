-- Skills: reusable skill definitions for tasks/agents
-- Skills define instructions, tools, and configurations for specific capabilities.

CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version text NOT NULL DEFAULT '1.0.0',
  description text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '',
  category text,
  tags text[] NOT NULL DEFAULT '{}',
  source text,
  source_url text,
  author_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  allowed_tools text[] NOT NULL DEFAULT '{}',
  config jsonb DEFAULT '{}'::jsonb,
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Index for fast lookup by team
CREATE INDEX IF NOT EXISTS skills_team_id_idx ON skills(team_id);

-- Index for fast lookup by author
CREATE INDEX IF NOT EXISTS skills_author_id_idx ON skills(author_id);

-- Index for fast lookup by category
CREATE INDEX IF NOT EXISTS skills_category_idx ON skills(category);

-- Index for fast lookup by enabled status
CREATE INDEX IF NOT EXISTS skills_enabled_idx ON skills(enabled);

-- Enable RLS for team-based access control
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;

-- Policy: users can view skills they authored or that belong to their team
CREATE POLICY skills_select_policy ON skills
  FOR SELECT
  USING (
    author_id = auth.uid()
    OR team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
    OR team_id IS NULL  -- Global/builtin skills visible to all
  );

-- Policy: users can insert skills for themselves or their team (team_id must be non-null)
CREATE POLICY skills_insert_policy ON skills
  FOR INSERT
  WITH CHECK (
    team_id IS NOT NULL AND (
      author_id = auth.uid()
      OR team_id IN (
        SELECT team_id FROM team_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- Policy: users can update their own skills or team skills they admin
CREATE POLICY skills_update_policy ON skills
  FOR UPDATE
  USING (
    author_id = auth.uid()
    OR team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Policy: users can delete their own skills or team skills they admin
CREATE POLICY skills_delete_policy ON skills
  FOR DELETE
  USING (
    author_id = auth.uid()
    OR team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
