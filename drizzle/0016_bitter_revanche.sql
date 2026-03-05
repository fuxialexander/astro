CREATE TABLE "github_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"node_id" text,
	"direction" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "user_achievements_user_id_slug_pk" PRIMARY KEY("user_id","slug")
);
--> statement-breakpoint
ALTER TABLE "skills" DROP CONSTRAINT "skills_source_check";--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN "github_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN "github_sync_version" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN "sync_source" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_sync_settings" jsonb;--> statement-breakpoint
ALTER TABLE "github_sync_log" ADD CONSTRAINT "github_sync_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_sync_log_project_id_idx" ON "github_sync_log" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "github_sync_log_created_at_idx" ON "github_sync_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_catalog_name_unique" ON "skills" USING btree ("name") WHERE "skills"."source" = 'catalog';--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_catalog_null_ownership" CHECK ("skills"."source" != 'catalog' OR ("skills"."team_id" IS NULL AND "skills"."author_id" IS NULL));--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_source_check" CHECK ("skills"."source" IN ('builtin', 'workspace', 'clawhub', 'plugin', 'user', 'catalog'));