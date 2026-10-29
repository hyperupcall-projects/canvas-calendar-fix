ALTER TABLE `output_calendars` DROP COLUMN `tasks_enabled`;
--> statement-breakpoint
ALTER TABLE `output_calendars` DROP COLUMN `tasks_list_name`;
--> statement-breakpoint
ALTER TABLE `output_calendars` DROP COLUMN `tasks_list_id`;
--> statement-breakpoint
ALTER TABLE `output_calendars` DROP COLUMN `tasks_last_sync_at`;
--> statement-breakpoint
ALTER TABLE `output_calendars` DROP COLUMN `tasks_last_sync_error`;
--> statement-breakpoint
CREATE TABLE `google_tasks_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`list_name` text,
	`list_id` text,
	`due_offset_days` integer DEFAULT 7 NOT NULL,
	`last_sync_at` integer,
	`last_sync_error` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
