CREATE TABLE IF NOT EXISTS remote_compute_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  provider TEXT NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'provisioning',
  desired_runners INTEGER NOT NULL DEFAULT 1,
  active_runners INTEGER NOT NULL DEFAULT 0,
  resource_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_remote_compute_pools_team_id ON remote_compute_pools(team_id);
CREATE INDEX IF NOT EXISTS idx_remote_compute_pools_user_id ON remote_compute_pools(user_id);
CREATE INDEX IF NOT EXISTS idx_remote_compute_pools_status ON remote_compute_pools(status);

ALTER TABLE remote_compute_pools ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'remote_compute_pools_select') THEN
    CREATE POLICY remote_compute_pools_select ON remote_compute_pools
      FOR SELECT USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'remote_compute_pools_write') THEN
    CREATE POLICY remote_compute_pools_write ON remote_compute_pools
      FOR ALL USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
  END IF;
END $$;
