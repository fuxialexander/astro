ALTER TABLE "task_executions" ADD COLUMN IF NOT EXISTS "user_id" uuid;--> statement-breakpoint
ALTER TABLE "task_executions" ADD COLUMN IF NOT EXISTS "verified_by" uuid;--> statement-breakpoint
ALTER TABLE "task_executions" ADD COLUMN IF NOT EXISTS "verification_note" text;
