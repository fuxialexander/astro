-- Add refresh token and token expiry to github_connections
-- GitHub App user-to-server tokens expire after 8 hours and need refresh
ALTER TABLE github_connections ADD COLUMN IF NOT EXISTS refresh_token text;
ALTER TABLE github_connections ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
