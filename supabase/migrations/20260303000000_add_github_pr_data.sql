-- Add github_pr_data JSONB column to plan_nodes table
-- Stores enriched PR data from GitHub webhooks (title, diff stats, CI checks, reviews)
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS github_pr_data jsonb;
