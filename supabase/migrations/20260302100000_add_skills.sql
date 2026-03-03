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

-- Unique constraint: skill names must be unique within a team (or globally for builtins)
ALTER TABLE skills ADD CONSTRAINT skills_name_team_id_unique UNIQUE (name, team_id);

-- CHECK constraint: enforce valid source values
ALTER TABLE skills ADD CONSTRAINT skills_source_check
  CHECK (source IN ('builtin', 'workspace', 'clawhub', 'plugin', 'user'));

-- Index for fast lookup by team
CREATE INDEX IF NOT EXISTS skills_team_id_idx ON skills(team_id);

-- Index for fast lookup by author
CREATE INDEX IF NOT EXISTS skills_author_id_idx ON skills(author_id);

-- Index for fast lookup by category
CREATE INDEX IF NOT EXISTS skills_category_idx ON skills(category);

-- Index for fast lookup by enabled status
CREATE INDEX IF NOT EXISTS skills_enabled_idx ON skills(enabled);

-- Composite index for common query: list enabled skills for a team
CREATE INDEX IF NOT EXISTS skills_team_enabled_idx ON skills(team_id, enabled);

-- Index for bootstrap queries: lookup by name and source
CREATE INDEX IF NOT EXISTS skills_name_source_idx ON skills(name, source);

-- Partial unique index: builtin skill names must be globally unique.
-- The (name, team_id) constraint doesn't cover builtins because they have
-- team_id=NULL, and Postgres treats NULL != NULL in unique constraints.
CREATE UNIQUE INDEX IF NOT EXISTS skills_builtin_name_unique ON skills(name) WHERE source = 'builtin';

-- Enable RLS for team-based access control.
-- Note: The Hono API server connects with the service_role key, which bypasses RLS.
-- These policies are a secondary defense for direct database access (e.g., Supabase Dashboard,
-- PostgREST). The primary access control is enforced by the API middleware (requireAuth +
-- skillTeamScopeFilter in server/routes/skills.ts). auth.uid() returns the JWT `sub` claim,
-- which matches the user.id extracted by the auth middleware.
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;

-- Policy: users can view skills they authored or that belong to their team.
-- NOTE: Multi-team users can see skills from ALL their teams via direct DB access
-- (Supabase Dashboard, PostgREST). The API applies stricter filtering (active team only
-- via user.teamId). This is accepted as defense-in-depth: RLS prevents unauthorized
-- access, while API enforces active-team scoping. See docs/design/SKILLS.md.
CREATE POLICY skills_select_policy ON skills
  FOR SELECT
  USING (
    author_id = auth.uid()
    OR team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
    OR (team_id IS NULL AND source = 'builtin')  -- Only global builtins visible to all
  );

-- Policy: users can insert skills for themselves or their team (team_id must be non-null).
-- Prevents users from creating global/builtin-like skills via direct DB access.
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

-- Policy: users can update their own skills or team skills they admin (not builtins).
-- Defense-in-depth: team_id IS NOT NULL prevents modification even if source check is bypassed.
CREATE POLICY skills_update_policy ON skills
  FOR UPDATE
  USING (
    source != 'builtin' AND team_id IS NOT NULL AND (
      author_id = auth.uid()
      OR team_id IN (
        SELECT team_id FROM team_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- Policy: users can delete their own skills or team skills they admin (not builtins).
-- Defense-in-depth: team_id IS NOT NULL prevents deletion even if source check is bypassed.
CREATE POLICY skills_delete_policy ON skills
  FOR DELETE
  USING (
    source != 'builtin' AND team_id IS NOT NULL AND (
      author_id = auth.uid()
      OR team_id IN (
        SELECT team_id FROM team_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- Enforce config JSONB size limit at DB level (defense-in-depth).
-- The API validates at 80KB (JSON text size); the DB constraint uses 100KB on
-- pg_column_size (which includes storage overhead). The 20KB buffer accounts for
-- JSONB storage overhead so users get a clear API error instead of a cryptic DB violation.
ALTER TABLE skills ADD CONSTRAINT skills_config_size_limit CHECK (pg_column_size(config) <= 102400);

-- Invariant: builtin skills must have NULL team_id and NULL author_id.
-- Prevents accidental team assignment or author attribution to system-seeded skills.
-- Mirrors drizzle/0013_add_builtin_null_ownership_check.sql.
ALTER TABLE skills ADD CONSTRAINT skills_builtin_null_ownership
  CHECK (source != 'builtin' OR (team_id IS NULL AND author_id IS NULL));

-- Invariant: source field should not be changed after creation.
-- Prevents escalation from 'workspace' to 'builtin' via direct DB access.
-- The API also enforces immutability (server/routes/skills.ts), but this trigger
-- provides defense-in-depth for direct DB access (Supabase Dashboard, PostgREST).
CREATE OR REPLACE FUNCTION prevent_skills_source_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.source IS DISTINCT FROM NEW.source THEN
    RAISE EXCEPTION 'source field is immutable after creation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER skills_prevent_source_change
  BEFORE UPDATE ON skills
  FOR EACH ROW
  EXECUTE FUNCTION prevent_skills_source_change();
