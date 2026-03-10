CREATE TABLE IF NOT EXISTS "project_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"source_node_id" text,
	"source_task_title" text,
	"milestone_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_knowledge_project_id_key_unique" UNIQUE("project_id","key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_knowledge_project_id_idx" ON "project_knowledge" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "project_knowledge" ADD CONSTRAINT "project_knowledge_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
