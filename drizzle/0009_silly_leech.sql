ALTER TABLE "plan_nodes" ADD COLUMN "commit_before_sha" text;--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN "commit_after_sha" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "project_branch" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "project_pr_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "project_pr_number" integer;