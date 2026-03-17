-- Add userId column to task_executions for team-scoped queries
-- Nullable for backward compatibility with existing rows

ALTER TABLE task_executions
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Composite index for efficient team-scoped execution queries
CREATE INDEX IF NOT EXISTS task_executions_project_user_idx
  ON task_executions (project_id, user_id);
