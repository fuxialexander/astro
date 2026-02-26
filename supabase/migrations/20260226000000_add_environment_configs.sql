-- Environment Configs: custom context overlays for HPC/SSH/Docker environments.
CREATE TABLE IF NOT EXISTS environment_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  team_id UUID,
  machine_id TEXT,
  backend_id TEXT NOT NULL,
  custom_context TEXT NOT NULL DEFAULT '',
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint for upsert semantics on (user_id, machine_id, backend_id)
CREATE UNIQUE INDEX IF NOT EXISTS environment_configs_user_machine_backend_idx
  ON environment_configs (user_id, COALESCE(machine_id, ''), backend_id);

-- RLS
ALTER TABLE environment_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own environment configs"
  ON environment_configs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
