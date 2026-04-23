CREATE TABLE "remote_compute_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"project_id" uuid,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"desired_runners" integer DEFAULT 1 NOT NULL,
	"active_runners" integer DEFAULT 0 NOT NULL,
	"resource_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "remote_compute_pools" ADD CONSTRAINT "remote_compute_pools_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_compute_pools" ADD CONSTRAINT "remote_compute_pools_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_remote_compute_pools_team_id" ON "remote_compute_pools" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_remote_compute_pools_user_id" ON "remote_compute_pools" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_remote_compute_pools_status" ON "remote_compute_pools" USING btree ("status");