CREATE TABLE IF NOT EXISTS "machine_instructions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"team_id" uuid,
	"name" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machine_instructions_owner_id_idx" ON "machine_instructions" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machine_instructions_team_id_idx" ON "machine_instructions" USING btree ("team_id");--> statement-breakpoint
ALTER TABLE "registered_machines" ADD COLUMN "default_instruction_id" text;--> statement-breakpoint
ALTER TABLE "machine_instructions" ADD CONSTRAINT "machine_instructions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
