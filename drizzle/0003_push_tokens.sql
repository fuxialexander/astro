CREATE TABLE `push_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`device_token` text NOT NULL,
	`platform` text DEFAULT 'ios' NOT NULL,
	`preferences` text DEFAULT '{}',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
