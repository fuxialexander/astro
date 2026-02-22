CREATE TABLE "chat_sessions" (
	"key" text PRIMARY KEY NOT NULL,
	"sdk_session_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_codes" (
	"user_code" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"machine_info" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"authorized_by" text,
	"authorized_at" timestamp,
	"last_polled_at" timestamp,
	CONSTRAINT "device_codes_device_code_unique" UNIQUE("device_code")
);
--> statement-breakpoint
CREATE TABLE "dispatch_queue_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"environment" text DEFAULT 'local' NOT NULL,
	"preferred_provider" text,
	"target_machine_id" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 2 NOT NULL,
	"execution_id" text,
	"session_id" text,
	"last_dispatch_attempt" timestamp,
	"last_error" text,
	"procedure_state" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bundle" jsonb NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"key" text PRIMARY KEY NOT NULL,
	"challenge" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
