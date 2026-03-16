-- Add title column to sessions table
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS title text;
