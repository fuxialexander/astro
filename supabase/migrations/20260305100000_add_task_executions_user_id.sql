-- Add userId column to task_executions for team-scoped queries
-- Nullable for backward compatibility with existing rows

ALTER TABLE task_executions
  ADD COLUMN user_id uuid REFERENCES auth.users(id);

-- Composite index for efficient team-scoped execution queries
CREATE INDEX task_executions_project_user_idx
  ON task_executions (project_id, user_id);
