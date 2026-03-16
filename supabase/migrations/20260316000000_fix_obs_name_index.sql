-- Fix: idx_obs_name btree index fails when name column exceeds 2704 bytes.
-- Replace with a hash index (supports equality lookups, no size limit)
-- and add a truncated btree index for prefix/range queries.

DROP INDEX IF EXISTS "idx_obs_name";

-- Hash index: supports = lookups with no value size limit
CREATE INDEX IF NOT EXISTS "idx_obs_name_hash" ON "observation_events" USING hash ("name");

-- Truncated btree: supports LIKE 'prefix%' queries on first 200 chars
CREATE INDEX IF NOT EXISTS "idx_obs_name_prefix" ON "observation_events" (left("name", 200));
