-- Team Invitation System
--
-- Adds invite_tokens table for email-based team invitations.
-- Supports both new user registration and existing user acceptance flows.

-- ── Invite Tokens ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invite_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick token lookups
CREATE INDEX IF NOT EXISTS idx_invite_tokens_token ON invite_tokens(token);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_team ON invite_tokens(team_id);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_email ON invite_tokens(email);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_expires ON invite_tokens(expires_at);

-- ── Row-Level Security Policies ───────────────────────────────────────────

-- Enable RLS
ALTER TABLE invite_tokens ENABLE ROW LEVEL SECURITY;

-- Team admins/owners can create invites for their teams
CREATE POLICY invite_tokens_insert_policy ON invite_tokens
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = invite_tokens.team_id
        AND team_members.user_id = auth.uid()
        AND team_members.role IN ('owner', 'admin')
    )
  );

-- Team admins/owners can view invites for their teams
CREATE POLICY invite_tokens_select_policy ON invite_tokens
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = invite_tokens.team_id
        AND team_members.user_id = auth.uid()
        AND team_members.role IN ('owner', 'admin')
    )
  );

-- Anyone can view invites sent to their email (needed for acceptance flow)
CREATE POLICY invite_tokens_select_by_email_policy ON invite_tokens
  FOR SELECT
  USING (
    email = (SELECT email FROM user_profiles WHERE id = auth.uid())
  );

-- Team admins/owners can delete (revoke) invites for their teams
CREATE POLICY invite_tokens_delete_policy ON invite_tokens
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = invite_tokens.team_id
        AND team_members.user_id = auth.uid()
        AND team_members.role IN ('owner', 'admin')
    )
  );

-- Anyone can update invites sent to their email (to mark as used)
CREATE POLICY invite_tokens_update_policy ON invite_tokens
  FOR UPDATE
  USING (
    email = (SELECT email FROM user_profiles WHERE id = auth.uid())
  );

-- ── Update team_members RLS policies ──────────────────────────────────────

-- Allow users to join teams via invite tokens
-- (Existing policies should already handle this via INSERT, but let's be explicit)

-- Users can insert themselves into teams if they have a valid invite token
-- This policy complements existing team_members policies
CREATE POLICY team_members_insert_via_invite ON team_members
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM invite_tokens
      WHERE invite_tokens.team_id = team_members.team_id
        AND invite_tokens.email = (SELECT email FROM user_profiles WHERE id = auth.uid())
        AND invite_tokens.used_at IS NULL
        AND invite_tokens.expires_at > now()
    )
  );

-- ── Cleanup function for expired tokens ──────────────────────────────────

-- Periodic cleanup of expired, unused tokens (can be called via cron job)
CREATE OR REPLACE FUNCTION cleanup_expired_invite_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM invite_tokens
  WHERE expires_at < now()
    AND used_at IS NULL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION cleanup_expired_invite_tokens() TO authenticated;

COMMENT ON TABLE invite_tokens IS 'Email-based team invitation tokens';
COMMENT ON FUNCTION cleanup_expired_invite_tokens() IS 'Deletes expired, unused invitation tokens';
