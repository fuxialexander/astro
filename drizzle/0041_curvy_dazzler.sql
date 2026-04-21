CREATE TABLE IF NOT EXISTS "team_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"cite_key" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "terminal_open_in" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_team_references_team_id" ON "team_references" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_team_references_cite_key" ON "team_references" USING btree ("cite_key");