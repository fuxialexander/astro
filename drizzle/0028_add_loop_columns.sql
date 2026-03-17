ALTER TABLE "plan_nodes" ADD COLUMN IF NOT EXISTS "loop_config" jsonb;--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN IF NOT EXISTS "loop_current_iteration" integer;--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN IF NOT EXISTS "loop_best_metric_value" real;--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN IF NOT EXISTS "loop_best_iteration" integer;--> statement-breakpoint
ALTER TABLE "plan_nodes" ADD COLUMN IF NOT EXISTS "loop_status" text;
