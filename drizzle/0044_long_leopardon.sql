ALTER TABLE "passkey_credentials" ADD COLUMN "device_type" text;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD COLUMN "backed_up" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;