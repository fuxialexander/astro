ALTER TABLE "projects" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "delivery_mode" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "references" jsonb DEFAULT '[]'::jsonb;