-- Add dispatch public key columns for user-signed dispatches
ALTER TABLE registered_machines ADD COLUMN IF NOT EXISTS dispatch_public_key jsonb;
ALTER TABLE device_codes ADD COLUMN IF NOT EXISTS dispatch_public_key jsonb;
