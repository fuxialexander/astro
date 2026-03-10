-- Add indexes to match Supabase production schema.
-- These indexes already exist in supabase/migrations/00000000000000_initial_schema.sql
-- and 20260227100000_add_streaming_events.sql but were missing from Drizzle schema,
-- causing PGlite (local mode) to run without them.

CREATE INDEX IF NOT EXISTS "idx_executions_project" ON "task_executions" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_executions_node" ON "task_executions" ("node_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tool_traces_execution" ON "tool_traces" ("execution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_file_changes_execution" ON "file_changes" ("execution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_streaming_events_exec_seq" ON "streaming_events" ("execution_id", "seq");
