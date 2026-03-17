-- Add title column to sessions table for lightweight session list display
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS title text;
