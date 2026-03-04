-- Add github_pr_data JSONB field to plan_nodes for PR visibility
-- Stores PR metadata: title, branch, diff stats, CI status, review status, reviewers, timestamps
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS github_pr_data jsonb;
