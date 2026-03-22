CREATE TABLE "delivery_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"branch_name" text NOT NULL,
	"is_singleton" boolean DEFAULT false NOT NULL,
	"node_ids" text[] DEFAULT '{}' NOT NULL,
	"pr_url" text,
	"pr_number" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN "delivery_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "delivery_branches" ADD CONSTRAINT "delivery_branches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD CONSTRAINT "plan_nodes_delivery_branch_id_delivery_branches_id_fk" FOREIGN KEY ("delivery_branch_id") REFERENCES "public"."delivery_branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_delivery_branches_project" ON "delivery_branches" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_delivery_branches_project_branch" ON "delivery_branches" USING btree ("project_id","branch_name") WHERE "delivery_branches"."deleted_at" is null;
