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

-- RLS: defense-in-depth for direct DB access (Supabase Dashboard, PostgREST).
-- The Hono API server connects with service_role key (bypasses RLS);
-- primary access control is enforced by requireAuth + scopeFilter in
-- server/routes/machine-instructions.ts.
ALTER TABLE machine_instructions ENABLE ROW LEVEL SECURITY;

-- Users can view instructions they own or that belong to their team.
CREATE POLICY machine_instructions_select_policy ON machine_instructions
  FOR SELECT
  USING (
    owner_id = auth.uid()
    OR team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Users can insert instructions owned by themselves.
CREATE POLICY machine_instructions_insert_policy ON machine_instructions
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- Users can update instructions they own or that belong to their team.
CREATE POLICY machine_instructions_update_policy ON machine_instructions
  FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Users can delete instructions they own or that belong to their team.
CREATE POLICY machine_instructions_delete_policy ON machine_instructions
  FOR DELETE
  USING (
    owner_id = auth.uid()
    OR team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Service role can manage all machine instructions (for server-side operations).
CREATE POLICY machine_instructions_service_role_policy ON machine_instructions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
