CREATE TABLE "references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"type" text DEFAULT 'document' NOT NULL,
	"title" text NOT NULL,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"year" text,
	"month" text,
	"abstract" text,
	"doi" text,
	"url" text,
	"journal" text,
	"volume" text,
	"issue" text,
	"pages" text,
	"publisher" text,
	"isbn" text,
	"issn" text,
	"keywords" text[] DEFAULT '{}',
	"language" text,
	"extra" jsonb,
	"source_format" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "references_project_id_idx" ON "references" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "references_team_id_idx" ON "references" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "references_doi_idx" ON "references" USING btree ("doi");