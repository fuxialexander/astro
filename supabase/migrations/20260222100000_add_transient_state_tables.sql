-- Move in-memory Maps to Postgres (Phase 3 of LOCAL_SERVER_REFACTOR)
-- Fixes production auth bug: WebAuthn challenges on Machine A now visible to Machine B

-- WebAuthn Challenges
-- Short-lived challenges for cross-instance verification
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  key TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Device Codes (OAuth2 RFC 8628)
-- Previously in-memory — now persistent for multi-instance support
CREATE TABLE IF NOT EXISTS device_codes (
  user_code TEXT PRIMARY KEY,
  device_code TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  machine_info JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  authorized_by TEXT,
  authorized_at TIMESTAMP,
  last_polled_at TIMESTAMP
);

-- Chat Sessions
-- Server-side SDK session pool for hybrid resume/fallback
CREATE TABLE IF NOT EXISTS chat_sessions (
  key TEXT PRIMARY KEY,
  sdk_session_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  last_used_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Shared Bundles
-- Stores shared plan export bundles for /api/share endpoints
CREATE TABLE IF NOT EXISTS shared_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle JSONB NOT NULL,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Dispatch Queue Entries
-- Persisted dispatch queue for multi-instance consistency
CREATE TABLE IF NOT EXISTS dispatch_queue_entries (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  priority TEXT NOT NULL DEFAULT 'normal',
  environment TEXT NOT NULL DEFAULT 'local',
  preferred_provider TEXT,
  target_machine_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  execution_id TEXT,
  session_id TEXT,
  last_dispatch_attempt TIMESTAMP,
  last_error TEXT,
  procedure_state JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
