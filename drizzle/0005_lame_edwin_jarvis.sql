CREATE TABLE "encrypted_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"service_name" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"iv" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"team_id" uuid,
	"machine_id" text,
	"backend_id" text NOT NULL,
	"custom_context" text DEFAULT '' NOT NULL,
	"display_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"gh_user_id" integer,
	"gh_login" text,
	"gh_name" text,
	"gh_email" text,
	"gh_avatar_url" text,
	"selected_repo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"repos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_synced_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN "acceptance_criteria" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "project_type" text DEFAULT 'default';