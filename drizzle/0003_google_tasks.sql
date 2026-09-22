ALTER TABLE `output_calendars` ADD `tasks_enabled` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `output_calendars` ADD `tasks_list_name` text;
--> statement-breakpoint
ALTER TABLE `output_calendars` ADD `tasks_list_id` text;
--> statement-breakpoint
ALTER TABLE `output_calendars` ADD `tasks_last_sync_at` integer;
--> statement-breakpoint
ALTER TABLE `output_calendars` ADD `tasks_last_sync_error` text;
