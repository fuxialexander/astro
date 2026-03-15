-- Add loop configuration columns to plan_nodes
ALTER TABLE plan_nodes
  ADD COLUMN IF NOT EXISTS loop_config jsonb,
  ADD COLUMN IF NOT EXISTS loop_current_iteration integer,
  ADD COLUMN IF NOT EXISTS loop_best_metric_value real,
  ADD COLUMN IF NOT EXISTS loop_best_iteration integer,
  ADD COLUMN IF NOT EXISTS loop_status text;

-- Create loop_iterations table
CREATE TABLE IF NOT EXISTS loop_iterations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  iteration integer NOT NULL,
  execution_id text,
  metric_value real,
  metric_name text,
  status text NOT NULL,
  description text,
  diff text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_loop_iterations_node_project ON loop_iterations(node_id, project_id);
CREATE INDEX IF NOT EXISTS idx_loop_iterations_iteration ON loop_iterations(node_id, iteration);
