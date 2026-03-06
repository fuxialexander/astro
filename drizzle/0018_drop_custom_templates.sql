ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "compute_backends" text[] DEFAULT '{}';--> statement-breakpoint
DROP TABLE IF EXISTS "custom_templates";
