-- Add missing indexes that exist in Supabase initial migration but not in Drizzle schema,
-- plus new standalone indexes for frequently-queried columns.
--
-- These indexes are critical for PGlite (local mode) which only gets indexes defined
-- in the Drizzle schema, and for the new scoped queries replacing full table scans.

-- Projects: used by teamScopeFilter on every authenticated request
CREATE INDEX IF NOT EXISTS idx_projects_team_id ON projects(team_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);

-- Plan nodes: core table, queried on every page load and dispatch
CREATE INDEX IF NOT EXISTS idx_plan_nodes_project ON plan_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_nodes_status ON plan_nodes(status);
CREATE INDEX IF NOT EXISTS idx_plan_nodes_deleted_at ON plan_nodes(deleted_at);
CREATE INDEX IF NOT EXISTS idx_plan_nodes_branch_name ON plan_nodes(branch_name);
CREATE INDEX IF NOT EXISTS idx_plan_nodes_pr_number ON plan_nodes(pr_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_nodes_project_client ON plan_nodes(project_id, client_id);

-- NEW: standalone client_id index for dispatch.ts queries that filter by client_id alone
-- (the composite (project_id, client_id) index can't serve client_id-only lookups)
CREATE INDEX IF NOT EXISTS idx_plan_nodes_client_id_standalone ON plan_nodes(client_id);

-- Plan edges: queried on page load and cascade deletes
CREATE INDEX IF NOT EXISTS idx_plan_edges_project ON plan_edges(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_edges_deleted_at ON plan_edges(deleted_at);

-- NEW: source/target indexes for cascade soft-delete and dependency lookups
CREATE INDEX IF NOT EXISTS idx_plan_edges_source ON plan_edges(source_client_id);
CREATE INDEX IF NOT EXISTS idx_plan_edges_target ON plan_edges(target_client_id);
