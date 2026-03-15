-- Add feature_flags JSONB column to teams table for team-level feature gating.
-- Empty object = use global defaults. Per-team overrides take precedence.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}';

-- Restrict feature_flags writes to service_role only.
-- Team owners/admins can update name/description but NOT feature_flags via PostgREST.
-- Feature flags are managed exclusively by the sync-feature-flags.ts script (service_role).
DROP POLICY IF EXISTS "Owners/admins can update teams" ON teams;
CREATE POLICY "Owners/admins can update teams"
  ON teams FOR UPDATE
  USING (user_can_manage_team(id))
  WITH CHECK (
    -- Allow update only if feature_flags is unchanged (prevent self-granting)
    feature_flags IS NOT DISTINCT FROM (SELECT t.feature_flags FROM teams t WHERE t.id = teams.id)
  );

-- Service role bypasses RLS, so sync-feature-flags.ts can still write feature_flags.
