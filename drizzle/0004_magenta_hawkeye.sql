CREATE TABLE "blobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"team_id" uuid,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" text NOT NULL,
	"filename" text NOT NULL,
	"node_id" text,
	"project_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"author_type" text DEFAULT 'user' NOT NULL,
	"content" text NOT NULL,
	"parent_comment_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN "content" text;--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN "links" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_comments" ADD CONSTRAINT "node_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;