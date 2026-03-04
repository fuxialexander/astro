-- Drop the unique constraint on (github_owner, github_repo).
-- Multiple projects can legitimately share the same GitHub repo,
-- e.g. when "Turn task to project" creates child projects from a parent.
-- Replace with a non-unique index for query performance.
DROP INDEX IF EXISTS idx_projects_github_owner_repo;
CREATE INDEX IF NOT EXISTS idx_projects_github_owner_repo
  ON projects (github_owner, github_repo)
  WHERE github_owner IS NOT NULL AND github_repo IS NOT NULL;
