-- Add unique index on (project_id, client_id) for plan_edges upserts.
-- The data route uses ON CONFLICT (project_id, client_id) DO UPDATE
-- which requires a unique constraint or unique index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_edges_project_client
  ON plan_edges (project_id, client_id);
