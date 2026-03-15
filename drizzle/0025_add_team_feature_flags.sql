ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "feature_flags" jsonb NOT NULL DEFAULT '{}';
