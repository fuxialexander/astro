CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`masked_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `display_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`view_key` text NOT NULL,
	`settings` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`target` text NOT NULL,
	`type` text DEFAULT 'dependency' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plan_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`parent_id` text,
	`dependencies` text DEFAULT '[]',
	`environment` text,
	`verification` text DEFAULT 'auto' NOT NULL,
	`position` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`priority` text,
	`label_ids` text,
	`due_date` text,
	`estimate` text,
	`milestone_id` text,
	`board_order` integer,
	`execution_id` text,
	`execution_output` text,
	`execution_error` text,
	`execution_started_at` integer,
	`execution_completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT 'dev-user' NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`vision_doc` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`start_date` text,
	`target_date` text,
	`lead` text,
	`health` text,
	`initiative` text,
	`progress` integer DEFAULT 0,
	`labels` text DEFAULT '[]',
	`working_directory` text,
	`repository` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_node_id` text NOT NULL,
	`session_user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_chat_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`node_id` text NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`session_date` text NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`total_input_tokens` integer DEFAULT 0 NOT NULL,
	`total_output_tokens` integer DEFAULT 0 NOT NULL,
	`tasks_completed` integer DEFAULT 0 NOT NULL,
	`tasks_failed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`avatar_url` text,
	`bio` text DEFAULT '',
	`domains` text DEFAULT '[]',
	`experience_level` text DEFAULT 'intermediate' NOT NULL,
	`preferred_environments` text DEFAULT '["local"]',
	`notifications_enabled` integer DEFAULT true NOT NULL,
	`email_notifications` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
