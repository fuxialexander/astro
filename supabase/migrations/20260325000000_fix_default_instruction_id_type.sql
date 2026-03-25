-- Fix default_instruction_id column type: UUID → TEXT
-- Builtin preset IDs (e.g. "builtin:local-with-k8s") are not UUIDs,
-- so the column must accept arbitrary text, not just UUID values.
ALTER TABLE registered_machines
  ALTER COLUMN default_instruction_id TYPE TEXT
  USING default_instruction_id::TEXT;
