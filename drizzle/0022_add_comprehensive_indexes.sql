-- Add comprehensive indexes to all tables missing them.
-- Critical for PGlite (local mode) which only gets indexes defined in Drizzle schema.

CREATE INDEX IF NOT EXISTS "idx_projects_team_id" ON "projects" ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_owner_id" ON "projects" ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_nodes_project" ON "plan_nodes" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_nodes_client_id_standalone" ON "plan_nodes" ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_plan_nodes_project_client" ON "plan_nodes" ("project_id", "client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_nodes_status" ON "plan_nodes" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_nodes_deleted_at" ON "plan_nodes" ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_nodes_branch_name" ON "plan_nodes" ("branch_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_nodes_pr_number" ON "plan_nodes" ("pr_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_edges_project" ON "plan_edges" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_edges_source" ON "plan_edges" ("source_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_edges_target" ON "plan_edges" ("target_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_edges_deleted_at" ON "plan_edges" ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_initiatives_team_id" ON "initiatives" ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_initiatives_owner_id" ON "initiatives" ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_user_id" ON "sessions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_project_id" ON "sessions" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_node_id" ON "sessions" ("node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_type" ON "sessions" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_chat_sessions_user_id" ON "task_chat_sessions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_chat_sessions_project_id" ON "task_chat_sessions" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_chat_sessions_node_id" ON "task_chat_sessions" ("node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_chat_messages_session_id" ON "task_chat_messages" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_tokens_user_id" ON "push_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_registered_machines_user_id" ON "registered_machines" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_registered_machines_team_id" ON "registered_machines" ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_machine_id" ON "refresh_tokens" ("machine_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_user_id" ON "refresh_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_passkey_credentials_user_id" ON "passkey_credentials" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_observation_events_trace_id" ON "observation_events" ("trace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_observation_events_project_id" ON "observation_events" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_user_id" ON "audit_logs" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_action" ON "audit_logs" ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_resource_type" ON "audit_logs" ("resource_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_created_at" ON "audit_logs" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activity_events_project_id" ON "activity_events" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activity_events_user_id" ON "activity_events" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activity_events_type" ON "activity_events" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_connected_accounts_user_id" ON "connected_accounts" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dispatch_queue_project_id" ON "dispatch_queue_entries" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dispatch_queue_status" ON "dispatch_queue_entries" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dispatch_queue_node_id" ON "dispatch_queue_entries" ("node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_machine_usage_logs_machine_id" ON "machine_usage_logs" ("machine_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_machine_usage_logs_user_id" ON "machine_usage_logs" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_machine_usage_logs_project_id" ON "machine_usage_logs" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blobs_owner_id" ON "blobs" ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blobs_project_id" ON "blobs" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_node_comments_node_id" ON "node_comments" ("node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_node_comments_project_id" ON "node_comments" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_github_app_installations_user_id" ON "github_app_installations" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_github_app_installations_team_id" ON "github_app_installations" ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_encrypted_api_keys_user_id" ON "encrypted_api_keys" ("user_id");
