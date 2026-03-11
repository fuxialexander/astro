-- Standalone client_id index on plan_nodes
-- The existing composite UNIQUE (project_id, client_id) cannot serve client_id-only queries.
-- 15+ queries in dispatch.ts filter by client_id alone (task dispatch, status updates, result routing).
-- Drop the old composite index first (it duplicates the UNIQUE constraint coverage)
DROP INDEX IF EXISTS idx_plan_nodes_client_id;

-- Re-create as standalone client_id-only index
CREATE INDEX idx_plan_nodes_client_id
  ON plan_nodes (client_id);

-- Cascade delete indexes on plan_edges
-- Used in data.ts when soft-deleting edges connected to a deleted node.
CREATE INDEX IF NOT EXISTS idx_plan_edges_source_client_id
  ON plan_edges (source_client_id);

CREATE INDEX IF NOT EXISTS idx_plan_edges_target_client_id
  ON plan_edges (target_client_id);
