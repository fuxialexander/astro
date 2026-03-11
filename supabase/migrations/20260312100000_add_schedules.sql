-- Schedules: cron schedule definitions for recurring task/project execution.
CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,                    -- 'project' | 'node'
  node_id TEXT,                           -- required when scope='node'
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  target_machine_id TEXT NOT NULL,
  node_filter TEXT[],                     -- project scope: subset of node IDs
  enabled BOOLEAN NOT NULL DEFAULT true,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  active_hours_start TEXT,
  active_hours_end TEXT,
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  missed_run_policy TEXT NOT NULL DEFAULT 'skip',
  retry_ttl_minutes INTEGER NOT NULL DEFAULT 60,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE schedules ADD CONSTRAINT schedules_scope_check CHECK (scope IN ('project', 'node'));
ALTER TABLE schedules ADD CONSTRAINT schedules_missed_run_policy_check CHECK (missed_run_policy IN ('skip', 'retry_on_reconnect'));

CREATE INDEX IF NOT EXISTS schedules_project_id_idx ON schedules(project_id);
CREATE INDEX IF NOT EXISTS schedules_next_run_enabled_idx ON schedules(next_run_at) WHERE enabled = true;

-- Schedule Runs: execution history per cron fire.
CREATE TABLE IF NOT EXISTS schedule_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  run_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|dispatched|running|success|failure|missed
  branch_name TEXT,
  execution_ids TEXT[] DEFAULT '{}',
  scheduled_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  summary JSONB,
  error_message TEXT,
  retry_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE schedule_runs ADD CONSTRAINT schedule_runs_status_check CHECK (status IN ('pending', 'dispatched', 'running', 'success', 'failure', 'missed'));

CREATE INDEX IF NOT EXISTS schedule_runs_schedule_id_idx ON schedule_runs(schedule_id);
CREATE INDEX IF NOT EXISTS schedule_runs_status_idx ON schedule_runs(status) WHERE status IN ('missed', 'pending', 'dispatched', 'running');
ALTER TABLE schedule_runs ADD CONSTRAINT schedule_runs_schedule_id_run_number_unique UNIQUE (schedule_id, run_number);

-- RLS policies
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_runs ENABLE ROW LEVEL SECURITY;

-- Schedules: team-scoped access via project membership
CREATE POLICY schedules_select_policy ON schedules
  FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      OR team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY schedules_insert_policy ON schedules
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY schedules_update_policy ON schedules
  FOR UPDATE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      OR team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY schedules_delete_policy ON schedules
  FOR DELETE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      OR team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY schedules_service_role_policy ON schedules
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Schedule Runs: inherit access from parent schedule
CREATE POLICY schedule_runs_select_policy ON schedule_runs
  FOR SELECT
  USING (
    schedule_id IN (
      SELECT s.id FROM schedules s
      JOIN projects p ON s.project_id = p.id
      WHERE p.owner_id = auth.uid()
      OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY schedule_runs_service_role_policy ON schedule_runs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
