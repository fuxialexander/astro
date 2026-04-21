ALTER TABLE "team_references" ADD COLUMN "status" text DEFAULT 'accepted' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_references" ADD COLUMN "added_by" text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_references" ADD COLUMN "source_project_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_team_references_status" ON "team_references" USING btree ("status");