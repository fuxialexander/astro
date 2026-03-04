-- Add featured flag to shared_plans for curated community content
ALTER TABLE shared_plans ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;

-- Index for efficient featured plan queries (matches Drizzle schema)
CREATE INDEX IF NOT EXISTS shared_plans_featured_idx ON shared_plans USING btree (featured);
