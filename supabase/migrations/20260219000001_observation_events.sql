CREATE TABLE IF NOT EXISTS "observation_events" (
  "id" text PRIMARY KEY,
  "trace_id" text NOT NULL,
  "parent_observation_id" text,
  "type" text NOT NULL,
  "name" text NOT NULL,
  "start_time" timestamp NOT NULL,
  "end_time" timestamp,
  "input" jsonb,
  "output" jsonb,
  "model" text,
  "input_tokens" integer,
  "output_tokens" integer,
  "estimated_cost_usd" real,
  "level" text NOT NULL DEFAULT 'default',
  "metadata" jsonb,
  "project_id" uuid NOT NULL,
  "node_id" text,
  "status_message" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_obs_trace_id" ON "observation_events" ("trace_id");
CREATE INDEX IF NOT EXISTS "idx_obs_project_id" ON "observation_events" ("project_id");
CREATE INDEX IF NOT EXISTS "idx_obs_type" ON "observation_events" ("type");
CREATE INDEX IF NOT EXISTS "idx_obs_start_time" ON "observation_events" ("start_time");
CREATE INDEX IF NOT EXISTS "idx_obs_level" ON "observation_events" ("level") WHERE "level" != 'default';
CREATE INDEX IF NOT EXISTS "idx_obs_name" ON "observation_events" ("name");

ALTER TABLE "task_executions" ADD COLUMN IF NOT EXISTS "markdown_summary" text;
