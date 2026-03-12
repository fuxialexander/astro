-- Add structured summary JSONB column to task_executions.
-- Stores the ExecutionSummary object (workCompleted, keyFindings, filesChanged,
-- status, followUps) so it survives page refresh.
ALTER TABLE task_executions ADD COLUMN IF NOT EXISTS summary jsonb;
