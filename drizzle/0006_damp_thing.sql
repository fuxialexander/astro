ALTER TABLE "plan_nodes" ADD COLUMN "github_issue_number" integer;--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN "github_issue_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_owner" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_repo" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_repo_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_projects_github_owner_repo" ON "projects" ("github_owner", "github_repo") WHERE "github_owner" IS NOT NULL AND "github_repo" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_github_repo_id" ON "projects" ("github_repo_id") WHERE "github_repo_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_plan_nodes_github_issue" ON "plan_nodes" ("project_id", "github_issue_number") WHERE "github_issue_number" IS NOT NULL;