CREATE TABLE IF NOT EXISTS "github_issue_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"issue_number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"state" text NOT NULL,
	"url" text NOT NULL,
	"author_login" text,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "github_pr_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"pr_number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"state" text NOT NULL,
	"url" text NOT NULL,
	"author_login" text,
	"head_branch" text,
	"base_branch" text,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ci_status" text,
	"review_decision" text,
	"mergeable_state" text,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"changed_files" integer DEFAULT 0 NOT NULL,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"merged_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_issue_cache" ADD CONSTRAINT "github_issue_cache_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pr_cache" ADD CONSTRAINT "github_pr_cache_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "github_issue_cache_project_issue_idx" ON "github_issue_cache" USING btree ("project_id","issue_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_issue_cache_project_state_idx" ON "github_issue_cache" USING btree ("project_id","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_issue_cache_project_updated_idx" ON "github_issue_cache" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "github_pr_cache_project_pr_idx" ON "github_pr_cache" USING btree ("project_id","pr_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_pr_cache_project_state_idx" ON "github_pr_cache" USING btree ("project_id","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_pr_cache_project_review_idx" ON "github_pr_cache" USING btree ("project_id","review_decision");
