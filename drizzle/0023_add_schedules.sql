CREATE TABLE IF NOT EXISTS "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"node_id" text,
	"name" text NOT NULL,
	"cron_expression" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"target_machine_id" text NOT NULL,
	"node_filter" text[],
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"active_hours_start" text,
	"active_hours_end" text,
	"max_concurrency" integer DEFAULT 1 NOT NULL,
	"missed_run_policy" text DEFAULT 'skip' NOT NULL,
	"retry_ttl_minutes" integer DEFAULT 60 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_scope_check" CHECK ("scope" IN ('project', 'node')),
	CONSTRAINT "schedules_missed_run_policy_check" CHECK ("missed_run_policy" IN ('skip', 'retry_on_reconnect'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"run_number" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"branch_name" text,
	"execution_ids" text[] DEFAULT '{}',
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"summary" jsonb,
	"error_message" text,
	"retry_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_runs_schedule_id_run_number_unique" UNIQUE("schedule_id","run_number"),
	CONSTRAINT "schedule_runs_status_check" CHECK ("status" IN ('pending', 'dispatched', 'running', 'success', 'failure', 'missed'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedules" ADD CONSTRAINT "schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_runs" ADD CONSTRAINT "schedule_runs_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedules_project_id_idx" ON "schedules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedules_next_run_enabled_idx" ON "schedules" USING btree ("next_run_at") WHERE enabled = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_runs_schedule_id_idx" ON "schedule_runs" USING btree ("schedule_id");
