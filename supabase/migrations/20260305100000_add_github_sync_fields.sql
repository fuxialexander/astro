-- Add GitHub sync tracking fields to plan_nodes and projects
-- Supports bidirectional sync between Astro plan nodes and GitHub issues

-- 1. plan_nodes: sync tracking columns
ALTER TABLE plan_nodes
  ADD COLUMN IF NOT EXISTS github_synced_at  timestamptz,
  ADD COLUMN IF NOT EXISTS github_sync_version integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sync_source text;

-- sync_source constrains to known values to prevent infinite sync loops
COMMENT ON COLUMN plan_nodes.github_synced_at IS 'Last time this node was synced with GitHub';
COMMENT ON COLUMN plan_nodes.github_sync_version IS 'Monotonic version counter incremented on each sync';
COMMENT ON COLUMN plan_nodes.sync_source IS 'Origin of last mutation: user | github | sync';

-- 2. projects: per-project sync configuration
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS github_sync_settings jsonb;

COMMENT ON COLUMN projects.github_sync_settings IS 'Per-project GitHub sync config: enabledFields, autoCreateDirection, labelMapping';
