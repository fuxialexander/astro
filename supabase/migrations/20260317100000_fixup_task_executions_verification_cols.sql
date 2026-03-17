-- Fix-up: add verified_by and verification_note columns to task_executions.
-- Migration 20260306000000 was marked as applied but the DDL did not execute.
-- Using IF NOT EXISTS so this is safe to run even if the columns somehow exist.

ALTER TABLE task_executions
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verification_note text;
