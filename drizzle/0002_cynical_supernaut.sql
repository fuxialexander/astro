CREATE TABLE `registered_machines` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`hostname` text NOT NULL,
	`platform` text NOT NULL,
	`environment_type` text DEFAULT 'local' NOT NULL,
	`providers` text DEFAULT '[]' NOT NULL,
	`workspace_id` text,
	`refresh_token_hash` text DEFAULT '' NOT NULL,
	`metadata` text,
	`is_connected` integer DEFAULT false NOT NULL,
	`is_revoked` integer DEFAULT false NOT NULL,
	`registered_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
