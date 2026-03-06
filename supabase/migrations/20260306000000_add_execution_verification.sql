-- Add verification columns to task_executions
ALTER TABLE task_executions
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verification_note text;
