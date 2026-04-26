ALTER TABLE remote_compute_pools
  ADD COLUMN IF NOT EXISTS provisioner_type TEXT NOT NULL DEFAULT 'server';
