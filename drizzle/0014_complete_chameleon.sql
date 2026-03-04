CREATE TABLE "github_app_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"team_id" uuid,
	"account_login" text NOT NULL,
	"account_type" text DEFAULT 'Organization' NOT NULL,
	"account_avatar_url" text,
	"app_id" integer,
	"repository_selection" text DEFAULT 'all' NOT NULL,
	"repos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_app_installations_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
CREATE TABLE "shared_plan_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"author_id" uuid,
	"author_name" text NOT NULL,
	"content" text NOT NULL,
	"parent_comment_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "shared_plan_forks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_plan_id" uuid NOT NULL,
	"forked_by" uuid NOT NULL,
	"project_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_plan_stars" (
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shared_plan_stars_user_id_plan_id_pk" PRIMARY KEY("user_id","plan_id")
);
--> statement-breakpoint
CREATE TABLE "shared_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"author_id" uuid,
	"author_name" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"vision_doc" text,
	"plan_data" jsonb NOT NULL,
	"template_id" text,
	"template_parameters" jsonb,
	"customization_notes" text,
	"customizable_fields" jsonb,
	"execution_summary" jsonb,
	"execution_results" text,
	"category" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"stars_count" integer DEFAULT 0 NOT NULL,
	"forks_count" integer DEFAULT 0 NOT NULL,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"team_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN "github_pr_data" jsonb;--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN "github_comments" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "shared_plan_comments" ADD CONSTRAINT "shared_plan_comments_plan_id_shared_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."shared_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_plan_comments" ADD CONSTRAINT "shared_plan_comments_author_id_user_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_plan_forks" ADD CONSTRAINT "shared_plan_forks_source_plan_id_shared_plans_id_fk" FOREIGN KEY ("source_plan_id") REFERENCES "public"."shared_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_plan_forks" ADD CONSTRAINT "shared_plan_forks_forked_by_user_profiles_id_fk" FOREIGN KEY ("forked_by") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_plan_forks" ADD CONSTRAINT "shared_plan_forks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_plan_stars" ADD CONSTRAINT "shared_plan_stars_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_plan_stars" ADD CONSTRAINT "shared_plan_stars_plan_id_shared_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."shared_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_plans" ADD CONSTRAINT "shared_plans_author_id_user_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_plans" ADD CONSTRAINT "shared_plans_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shared_plan_comments_plan_id_idx" ON "shared_plan_comments" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "shared_plans_category_idx" ON "shared_plans" USING btree ("category");--> statement-breakpoint
CREATE INDEX "shared_plans_stars_count_idx" ON "shared_plans" USING btree ("stars_count" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "shared_plans_created_at_idx" ON "shared_plans" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "shared_plans_author_id_idx" ON "shared_plans" USING btree ("author_id");