-- Add PR-related columns to plan_nodes
ALTER TABLE "plan_nodes" ADD COLUMN "branch_name" text;
ALTER TABLE "plan_nodes" ADD COLUMN "pr_url" text;
ALTER TABLE "plan_nodes" ADD COLUMN "pr_number" integer;

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS "idx_plan_nodes_pr_number" ON "plan_nodes" ("pr_number") WHERE "pr_number" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_plan_nodes_branch_name" ON "plan_nodes" ("branch_name") WHERE "branch_name" IS NOT NULL;
