-- Project branch model: accumulative project-level branches for multi-task PRs
-- All columns are nullable — no data migration needed.

-- Projects: track the project-level accumulation branch and final PR
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_branch text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_pr_url text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_pr_number integer;

-- Plan nodes: track commit SHAs for per-task PRs merged into the project branch
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS commit_before_sha text;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS commit_after_sha text;
