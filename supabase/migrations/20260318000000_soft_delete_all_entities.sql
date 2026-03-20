-- Add deleted_at column to all user-facing entities for soft-delete support.
-- Previously these entities were hard-deleted; now they are marked with a timestamp
-- and filtered out of SELECT queries via WHERE deleted_at IS NULL.

-- initiatives
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- sessions (unified)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- task_chat_sessions (legacy)
ALTER TABLE task_chat_sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- task_executions
ALTER TABLE task_executions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- streaming_events
ALTER TABLE streaming_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- activity_events
ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- blobs
ALTER TABLE blobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- node_comments
ALTER TABLE node_comments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- environment_configs
ALTER TABLE environment_configs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- project_knowledge
ALTER TABLE project_knowledge ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- skills
ALTER TABLE skills ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- schedules
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
