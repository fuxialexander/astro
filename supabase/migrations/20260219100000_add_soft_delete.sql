-- Add soft-delete columns to plan_nodes and plan_edges
-- Enables undo-able deletion: rows are marked with deleted_at instead of being removed

ALTER TABLE plan_nodes
ADD COLUMN deleted_at timestamptz,
ADD COLUMN deletion_action_id text;

ALTER TABLE plan_edges
ADD COLUMN deleted_at timestamptz,
ADD COLUMN deletion_action_id text;

-- Index for efficient filtering of non-deleted rows
CREATE INDEX idx_plan_nodes_deleted_at ON plan_nodes(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_plan_edges_deleted_at ON plan_edges(deleted_at) WHERE deleted_at IS NULL;
