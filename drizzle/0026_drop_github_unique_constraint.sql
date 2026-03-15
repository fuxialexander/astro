-- Drop the UNIQUE constraint on (github_owner, github_repo).
-- Multiple projects can share the same GitHub repo: regular plan projects
-- use workingDirectory for the same repo, and only one projectType='github'
-- project per repo is enforced at the application level.
-- Replace with a non-unique index for query performance.
-- (Mirrors supabase/migrations/20260303000003_drop_github_unique_constraint.sql)
DROP INDEX IF EXISTS "idx_projects_github_owner_repo";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_github_owner_repo" ON "projects" ("github_owner", "github_repo") WHERE "github_owner" IS NOT NULL AND "github_repo" IS NOT NULL;
