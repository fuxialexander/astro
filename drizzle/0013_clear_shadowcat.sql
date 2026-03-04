CREATE TABLE "custom_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'custom' NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"icon" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"maturity" text DEFAULT 'stable' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"required_parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"optional_parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompts" jsonb NOT NULL,
	"execution" jsonb,
	"parallelization" jsonb,
	"plan_hints" jsonb,
	"source_project_id" uuid,
	"author_id" uuid NOT NULL,
	"team_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "custom_templates_name_author_id_unique" UNIQUE("name","author_id")
);
--> statement-breakpoint
ALTER TABLE "custom_templates" ADD CONSTRAINT "custom_templates_source_project_id_projects_id_fk" FOREIGN KEY ("source_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_templates" ADD CONSTRAINT "custom_templates_author_id_user_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_templates" ADD CONSTRAINT "custom_templates_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_templates_author_id_idx" ON "custom_templates" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "custom_templates_team_id_idx" ON "custom_templates" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "custom_templates_category_idx" ON "custom_templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "custom_templates_enabled_idx" ON "custom_templates" USING btree ("enabled");--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_builtin_null_ownership" CHECK ("skills"."source" != 'builtin' OR ("skills"."team_id" IS NULL AND "skills"."author_id" IS NULL));