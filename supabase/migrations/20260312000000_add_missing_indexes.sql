-- Add missing indexes that exist in Supabase initial migration but not in Drizzle schema,
-- plus new standalone indexes for frequently-queried columns.
--
-- These indexes are critical for PGlite (local mode) which only gets indexes defined
-- in the Drizzle schema, and for the new scoped queries replacing full table scans.

-- Projects: used by teamScopeFilter on every authenticated request
CREATE INDEX IF NOT EXISTS idx_projects_team_id ON projects(team_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);

-- Plan nodes: core table, queried on every page load and dispatch
CREATE INDEX IF NOT EXISTS idx_plan_nodes_project ON plan_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_nodes_status ON plan_nodes(status);
CREATE INDEX IF NOT EXISTS idx_plan_nodes_deleted_at ON plan_nodes(deleted_at);
CREATE INDEX IF NOT EXISTS idx_plan_nodes_branch_name ON plan_nodes(branch_name);
CREATE INDEX IF NOT EXISTS idx_plan_nodes_pr_number ON plan_nodes(pr_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_nodes_project_client ON plan_nodes(project_id, client_id);

-- NEW: standalone client_id index for dispatch.ts queries that filter by client_id alone
-- (the composite (project_id, client_id) index can't serve client_id-only lookups)
CREATE INDEX IF NOT EXISTS idx_plan_nodes_client_id_standalone ON plan_nodes(client_id);

-- Plan edges: queried on page load and cascade deletes
CREATE INDEX IF NOT EXISTS idx_plan_edges_project ON plan_edges(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_edges_deleted_at ON plan_edges(deleted_at);

-- NEW: source/target indexes for cascade soft-delete and dependency lookups
CREATE INDEX IF NOT EXISTS idx_plan_edges_source ON plan_edges(source_client_id);
CREATE INDEX IF NOT EXISTS idx_plan_edges_target ON plan_edges(target_client_id);

-- Initiatives: queried by team scope
CREATE INDEX IF NOT EXISTS idx_initiatives_team_id ON initiatives(team_id);
CREATE INDEX IF NOT EXISTS idx_initiatives_owner_id ON initiatives(owner_id);

-- Sessions: queried by user, project, node, and type
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_node_id ON sessions(node_id);
CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(type);

-- Task chat sessions: queried by user and project
CREATE INDEX IF NOT EXISTS idx_task_chat_sessions_user_id ON task_chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_task_chat_sessions_project_id ON task_chat_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_task_chat_sessions_node_id ON task_chat_sessions(node_id);

-- Task chat messages: queried by session
CREATE INDEX IF NOT EXISTS idx_task_chat_messages_session_id ON task_chat_messages(session_id);

-- Node comments: queried by node and project
CREATE INDEX IF NOT EXISTS idx_node_comments_node_id ON node_comments(node_id);
CREATE INDEX IF NOT EXISTS idx_node_comments_project_id ON node_comments(project_id);

-- Registered machines: queried by user and team
CREATE INDEX IF NOT EXISTS idx_registered_machines_user_id ON registered_machines(user_id);
CREATE INDEX IF NOT EXISTS idx_registered_machines_team_id ON registered_machines(team_id);

-- Encrypted API keys: queried by user
CREATE INDEX IF NOT EXISTS idx_encrypted_api_keys_user_id ON encrypted_api_keys(user_id);

-- Audit logs: queried by user, action, resource type, and time range
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON audit_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Activity events: queried by project, user, and type
CREATE INDEX IF NOT EXISTS idx_activity_events_project_id ON activity_events(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_user_id ON activity_events(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_type ON activity_events(type);

-- Push tokens: queried by user
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);

-- Refresh tokens: queried by machine and user
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_machine_id ON refresh_tokens(machine_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- Passkey credentials: queried by user
CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user_id ON passkey_credentials(user_id);

-- Observation events: queried by trace and project
CREATE INDEX IF NOT EXISTS idx_observation_events_trace_id ON observation_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_observation_events_project_id ON observation_events(project_id);

-- Connected accounts: queried by user
CREATE INDEX IF NOT EXISTS idx_connected_accounts_user_id ON connected_accounts(user_id);

-- Dispatch queue entries: queried by project, status, and node
CREATE INDEX IF NOT EXISTS idx_dispatch_queue_project_id ON dispatch_queue_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_queue_status ON dispatch_queue_entries(status);
CREATE INDEX IF NOT EXISTS idx_dispatch_queue_node_id ON dispatch_queue_entries(node_id);

-- Machine usage logs: queried by machine, user, and project
CREATE INDEX IF NOT EXISTS idx_machine_usage_logs_machine_id ON machine_usage_logs(machine_id);
CREATE INDEX IF NOT EXISTS idx_machine_usage_logs_user_id ON machine_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_machine_usage_logs_project_id ON machine_usage_logs(project_id);

-- Blobs: queried by owner and project
CREATE INDEX IF NOT EXISTS idx_blobs_owner_id ON blobs(owner_id);
CREATE INDEX IF NOT EXISTS idx_blobs_project_id ON blobs(project_id);

-- GitHub app installations: queried by user and team
CREATE INDEX IF NOT EXISTS idx_github_app_installations_user_id ON github_app_installations(user_id);
CREATE INDEX IF NOT EXISTS idx_github_app_installations_team_id ON github_app_installations(team_id);
