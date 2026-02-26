-- Add GitHub project linking columns to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_owner text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo_id integer;

-- Unique index: one Astro project per GitHub repo
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_github_owner_repo
  ON projects (github_owner, github_repo)
  WHERE github_owner IS NOT NULL AND github_repo IS NOT NULL;

-- Index for fast lookup by GitHub repo ID
CREATE INDEX IF NOT EXISTS idx_projects_github_repo_id
  ON projects (github_repo_id)
  WHERE github_repo_id IS NOT NULL;

-- Add GitHub issue columns to plan_nodes table
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS github_issue_number integer;
ALTER TABLE plan_nodes ADD COLUMN IF NOT EXISTS github_issue_url text;

-- Unique index: one plan node per issue per project
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_nodes_github_issue
  ON plan_nodes (project_id, github_issue_number)
  WHERE github_issue_number IS NOT NULL;
