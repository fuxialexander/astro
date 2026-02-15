-- Audit Logs Table
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "action" text NOT NULL, -- e.g. 'account.create', 'api_key.create', 'machine.register', 'project.create'
  "resource_type" text NOT NULL, -- e.g. 'account', 'api_key', 'machine', 'project'
  "resource_id" text, -- ID of the affected resource
  "details" jsonb DEFAULT '{}', -- Additional context (non-sensitive)
  "ip_address" text, -- Source IP address
  "user_agent" text, -- User agent string
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs" ("user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs" ("action");
CREATE INDEX IF NOT EXISTS "audit_logs_resource_type_idx" ON "audit_logs" ("resource_type");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" ("created_at");
