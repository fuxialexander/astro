-- GitHub Sync Log table for monitoring sync health across projects.
-- Records every sync operation (both directions) with status and error tracking.

CREATE TABLE IF NOT EXISTS github_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  node_id text,
  direction text NOT NULL,         -- 'github_to_astro' | 'astro_to_github'
  action text NOT NULL,            -- 'create' | 'update' | 'close' | 'reopen' | 'comment' | 'label' | 'assign'
  status text NOT NULL,            -- 'success' | 'error'
  error_message text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for querying sync health by project and time range
CREATE INDEX IF NOT EXISTS github_sync_log_project_id_idx ON github_sync_log(project_id);
CREATE INDEX IF NOT EXISTS github_sync_log_created_at_idx ON github_sync_log(created_at);

-- Foreign key to projects (cascade on delete to clean up orphaned rows)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'github_sync_log_project_id_fkey'
  ) THEN
    ALTER TABLE github_sync_log
      ADD CONSTRAINT github_sync_log_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END
$$;

-- RLS
ALTER TABLE github_sync_log ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read sync log for projects they can access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'github_sync_log' AND policyname = 'Users can view sync log for their team''s projects'
  ) THEN
    CREATE POLICY "Users can view sync log for their team's projects"
      ON github_sync_log FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM projects p
          JOIN team_members tm ON tm.team_id = p.team_id
          WHERE p.id = github_sync_log.project_id
            AND tm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

-- Allow service role full access for backend sync operations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'github_sync_log' AND policyname = 'Service role has full access to sync log'
  ) THEN
    CREATE POLICY "Service role has full access to sync log"
      ON github_sync_log FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

COMMENT ON TABLE github_sync_log IS 'Audit log for all GitHub sync operations, used by the sync health dashboard';
COMMENT ON COLUMN github_sync_log.direction IS 'Sync direction: github_to_astro or astro_to_github';
COMMENT ON COLUMN github_sync_log.action IS 'Sync action: create, update, close, reopen, comment, label, assign';
COMMENT ON COLUMN github_sync_log.status IS 'Operation result: success or error';
COMMENT ON COLUMN github_sync_log.metadata IS 'Extra context: issue number, field names, etc.';
