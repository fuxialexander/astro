-- Document soft-delete support on the projects status column.
-- The 'deleted' value is used by the soft-delete DELETE handler instead of
-- performing a hard delete, so that cascaded data (plan_nodes, task_executions,
-- streaming_events, sessions, etc.) is preserved for achievement/heatmap stats.
--
-- No column type change is needed: status is already TEXT (unconstrained).

COMMENT ON COLUMN projects.status IS 'active | archived | deleted  (deleted = soft-deleted, hidden from all queries but data preserved)';

-- Partial index: speeds up the common query pattern that filters out deleted
-- projects (e.g. GET /api/data/projects?status!=deleted).
CREATE INDEX IF NOT EXISTS idx_projects_active ON projects (owner_id) WHERE status != 'deleted';
