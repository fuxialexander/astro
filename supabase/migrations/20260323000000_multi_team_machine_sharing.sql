-- Multi-Team Machine Sharing
-- Enables machines to be shared with multiple teams via a join table,
-- replacing the single team_id column on registered_machines.

-- ============================================================================
-- Create join table
-- ============================================================================
CREATE TABLE IF NOT EXISTS machine_team_shares (
  machine_id TEXT NOT NULL REFERENCES registered_machines(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (machine_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_machine_team_shares_team ON machine_team_shares(team_id);
CREATE INDEX IF NOT EXISTS idx_machine_team_shares_machine ON machine_team_shares(machine_id);

-- ============================================================================
-- Migrate existing data from registered_machines.team_id
-- ============================================================================
INSERT INTO machine_team_shares (machine_id, team_id, shared_at)
SELECT id, team_id, now()
FROM registered_machines
WHERE team_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ============================================================================
-- RLS for machine_team_shares
-- ============================================================================
ALTER TABLE machine_team_shares ENABLE ROW LEVEL SECURITY;

-- Team members can view shares for their teams
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'machine_team_shares_select') THEN
    CREATE POLICY machine_team_shares_select ON machine_team_shares
      FOR SELECT USING (
        team_id IN (SELECT tm.team_id FROM team_members tm WHERE tm.user_id = auth.uid())
      );
  END IF;
END $$;

-- Machine owners can manage shares
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'machine_team_shares_insert') THEN
    CREATE POLICY machine_team_shares_insert ON machine_team_shares
      FOR INSERT WITH CHECK (
        machine_id IN (SELECT rm.id FROM registered_machines rm WHERE rm.user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'machine_team_shares_delete') THEN
    CREATE POLICY machine_team_shares_delete ON machine_team_shares
      FOR DELETE USING (
        machine_id IN (SELECT rm.id FROM registered_machines rm WHERE rm.user_id = auth.uid())
      );
  END IF;
END $$;

-- ============================================================================
-- Update helper functions to use join table
-- ============================================================================

-- Check if user can access a machine (owner or member of a shared team)
CREATE OR REPLACE FUNCTION user_can_access_machine(p_machine_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    -- Machine owner access
    SELECT 1 FROM registered_machines
    WHERE id = p_machine_id AND user_id = auth.uid()
    UNION ALL
    -- Team machine access via join table
    SELECT 1 FROM machine_team_shares mts
    JOIN team_members tm ON tm.team_id = mts.team_id
    WHERE mts.machine_id = p_machine_id AND tm.user_id = auth.uid()
  );
$$;

-- Get available machines for a user (owned + team shared via join table)
CREATE OR REPLACE FUNCTION get_user_available_machines(p_user_id uuid)
RETURNS TABLE (
  id text,
  name text,
  hostname text,
  platform text,
  environment_type text,
  providers text[],
  is_connected boolean,
  is_team_machine boolean,
  team_id uuid,
  team_name text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  -- User's own machines
  SELECT
    rm.id,
    rm.name,
    rm.hostname,
    rm.platform,
    rm.environment_type,
    rm.providers,
    rm.is_connected,
    false AS is_team_machine,
    null::uuid AS team_id,
    null::text AS team_name
  FROM registered_machines rm
  WHERE rm.user_id = p_user_id
    AND rm.is_revoked = false
  UNION ALL
  -- Team machines via join table
  SELECT
    rm.id,
    rm.name,
    rm.hostname,
    rm.platform,
    rm.environment_type,
    rm.providers,
    rm.is_connected,
    true AS is_team_machine,
    mts.team_id,
    t.name AS team_name
  FROM registered_machines rm
  JOIN machine_team_shares mts ON mts.machine_id = rm.id
  JOIN teams t ON t.id = mts.team_id
  JOIN team_members tm ON tm.team_id = mts.team_id
  WHERE tm.user_id = p_user_id
    AND rm.is_revoked = false
    AND rm.user_id != p_user_id
  ORDER BY is_connected DESC, name;
$$;

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE machine_team_shares IS 'Many-to-many: machines can be shared with multiple teams';
COMMENT ON FUNCTION user_can_access_machine IS 'Returns true if user owns machine or is member of a team it is shared with (via machine_team_shares)';
COMMENT ON FUNCTION get_user_available_machines IS 'Returns all machines available to a user (owned + shared via machine_team_shares)';
