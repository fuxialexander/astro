-- Add github_comments JSONB column to plan_nodes
-- Stores the last N comments from GitHub issues/PRs linked to plan nodes
-- for quick rendering in the activity feed.

ALTER TABLE plan_nodes
ADD COLUMN IF NOT EXISTS github_comments jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN plan_nodes.github_comments IS 'Cached GitHub comments (issue + PR review) for activity feed display';
