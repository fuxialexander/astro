-- Add webauthn_challenges table for cross-instance WebAuthn verification
-- Stores short-lived challenges so any server instance can verify them

create table if not exists webauthn_challenges (
  key text primary key,
  challenge text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Index for cleanup of expired challenges
create index if not exists idx_webauthn_challenges_expires_at on webauthn_challenges(expires_at);
