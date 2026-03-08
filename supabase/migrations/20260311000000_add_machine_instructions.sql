-- Machine Instructions: shared pool of markdown instruction documents
-- for telling AI agents how to run computation jobs on specific environments.
CREATE TABLE IF NOT EXISTS machine_instructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS machine_instructions_owner_id_idx ON machine_instructions(owner_id);
CREATE INDEX IF NOT EXISTS machine_instructions_team_id_idx ON machine_instructions(team_id);

-- Add default_instruction_id column to registered_machines
ALTER TABLE registered_machines ADD COLUMN IF NOT EXISTS default_instruction_id UUID;
