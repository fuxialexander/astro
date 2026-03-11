-- Sync all indexes from packages/core/src/db/schema.ts to PGlite.
-- Uses IF NOT EXISTS so this migration is idempotent and won't fail
-- if indexes already exist from earlier migrations (0011-0021).

-- Plan nodes indexes
CREATE INDEX IF NOT EXISTS "idx_plan_nodes_project_id" ON "plan_nodes" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_nodes_client_id" ON "plan_nodes" ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_nodes_status" ON "plan_nodes" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_nodes_deleted_at" ON "plan_nodes" ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_nodes_branch_name" ON "plan_nodes" ("branch_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_nodes_pr_number" ON "plan_nodes" ("pr_number");--> statement-breakpoint

-- Plan edges indexes
CREATE INDEX IF NOT EXISTS "idx_plan_edges_project_id" ON "plan_edges" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_edges_source_client_id" ON "plan_edges" ("source_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_edges_target_client_id" ON "plan_edges" ("target_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_edges_client_id" ON "plan_edges" ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_edges_deleted_at" ON "plan_edges" ("deleted_at");--> statement-breakpoint

-- Projects indexes
CREATE INDEX IF NOT EXISTS "idx_projects_team_id" ON "projects" ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_owner_id" ON "projects" ("owner_id");--> statement-breakpoint

-- Initiatives indexes
CREATE INDEX IF NOT EXISTS "idx_initiatives_team_id" ON "initiatives" ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_initiatives_owner_id" ON "initiatives" ("owner_id");--> statement-breakpoint

-- Sessions indexes
CREATE INDEX IF NOT EXISTS "idx_sessions_user_id" ON "sessions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_project_id" ON "sessions" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_node_id" ON "sessions" ("node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_type" ON "sessions" ("type");--> statement-breakpoint

-- Task chat sessions indexes
CREATE INDEX IF NOT EXISTS "idx_task_chat_sessions_user_id" ON "task_chat_sessions" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_chat_sessions_node_user_unique" ON "task_chat_sessions" ("node_id", "user_id");--> statement-breakpoint

-- Task chat messages indexes
CREATE INDEX IF NOT EXISTS "idx_task_chat_messages_session_id" ON "task_chat_messages" ("session_id");--> statement-breakpoint

-- Registered machines indexes
CREATE INDEX IF NOT EXISTS "idx_registered_machines_user_id" ON "registered_machines" ("user_id");--> statement-breakpoint

-- Task executions indexes
CREATE INDEX IF NOT EXISTS "idx_executions_project" ON "task_executions" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_executions_node" ON "task_executions" ("node_client_id");--> statement-breakpoint

-- Tool traces indexes
CREATE INDEX IF NOT EXISTS "idx_tool_traces_execution" ON "tool_traces" ("execution_id");--> statement-breakpoint

-- File changes indexes
CREATE INDEX IF NOT EXISTS "idx_file_changes_execution" ON "file_changes" ("execution_id");--> statement-breakpoint

-- Audit logs indexes
CREATE INDEX IF NOT EXISTS "idx_audit_logs_user_id" ON "audit_logs" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_action" ON "audit_logs" ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_resource_type" ON "audit_logs" ("resource_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_created_at" ON "audit_logs" ("created_at");--> statement-breakpoint

-- Activity events indexes (composite with DESC)
CREATE INDEX IF NOT EXISTS "idx_activity_events_project_created" ON "activity_events" ("project_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activity_events_user_created" ON "activity_events" ("user_id", "created_at" DESC);--> statement-breakpoint

-- Node comments indexes
CREATE INDEX IF NOT EXISTS "idx_node_comments_node_id" ON "node_comments" ("node_id");--> statement-breakpoint

-- Encrypted API keys indexes
CREATE INDEX IF NOT EXISTS "idx_encrypted_api_keys_user_id" ON "encrypted_api_keys" ("user_id");--> statement-breakpoint

-- Streaming events indexes
CREATE INDEX IF NOT EXISTS "idx_streaming_events_exec_seq" ON "streaming_events" ("execution_id", "seq");--> statement-breakpoint

-- Machine instructions indexes
CREATE INDEX IF NOT EXISTS "machine_instructions_owner_id_idx" ON "machine_instructions" ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machine_instructions_team_id_idx" ON "machine_instructions" ("team_id");--> statement-breakpoint

-- Skills indexes
CREATE INDEX IF NOT EXISTS "skills_team_id_idx" ON "skills" ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skills_author_id_idx" ON "skills" ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skills_category_idx" ON "skills" ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skills_enabled_idx" ON "skills" ("enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skills_team_enabled_idx" ON "skills" ("team_id", "enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skills_name_source_idx" ON "skills" ("name", "source");--> statement-breakpoint

-- Shared plans indexes
CREATE INDEX IF NOT EXISTS "shared_plans_category_idx" ON "shared_plans" ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shared_plans_stars_count_idx" ON "shared_plans" ("stars_count" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shared_plans_created_at_idx" ON "shared_plans" ("created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shared_plans_author_id_idx" ON "shared_plans" ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shared_plans_featured_idx" ON "shared_plans" ("featured");--> statement-breakpoint

-- Shared plan comments indexes
CREATE INDEX IF NOT EXISTS "shared_plan_comments_plan_id_idx" ON "shared_plan_comments" ("plan_id");--> statement-breakpoint

-- Project knowledge indexes
CREATE INDEX IF NOT EXISTS "project_knowledge_project_id_idx" ON "project_knowledge" ("project_id");--> statement-breakpoint

-- GitHub sync log indexes
CREATE INDEX IF NOT EXISTS "github_sync_log_project_id_idx" ON "github_sync_log" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_sync_log_created_at_idx" ON "github_sync_log" ("created_at");
