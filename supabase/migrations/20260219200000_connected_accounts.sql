-- Connected Accounts table for per-user channel configurations
CREATE TABLE connected_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  credentials JSONB NOT NULL,
  mappings JSONB NOT NULL DEFAULT '{}',
  settings JSONB NOT NULL DEFAULT '{}',
  external_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_connected_accounts_lookup ON connected_accounts (channel, external_id) WHERE enabled = true;
CREATE INDEX idx_connected_accounts_user ON connected_accounts (user_id);

ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own accounts" ON connected_accounts
  FOR ALL USING (auth.uid() = user_id);
