ALTER TABLE "device_codes" ADD COLUMN "dispatch_public_key" jsonb;--> statement-breakpoint
ALTER TABLE "registered_machines" ADD COLUMN "dispatch_public_key" jsonb;