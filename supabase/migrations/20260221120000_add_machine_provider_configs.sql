-- Add provider_configs column to registered_machines table
ALTER TABLE registered_machines
ADD COLUMN provider_configs JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN registered_machines.provider_configs IS 'Per-machine provider configurations (API keys, models, settings)';
