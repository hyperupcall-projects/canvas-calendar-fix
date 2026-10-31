CREATE TABLE `google_tasks_settings_new` (
 `output_calendar_id` text PRIMARY KEY NOT NULL REFERENCES `output_calendars`(`id`) ON DELETE cascade,
 `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
 `legacy_task_markers` integer DEFAULT false NOT NULL,
 `enabled` integer DEFAULT false NOT NULL,
 `list_name` text,
 `list_id` text,
 `due_offset_days` integer DEFAULT 7 NOT NULL,
 `skip_older_than_days` integer DEFAULT 1 NOT NULL,
 `dismissed` text DEFAULT '[]' NOT NULL,
 `last_sync_at` integer,
 `last_sync_error` text
);
--> statement-breakpoint
-- Preserve the existing list on the first output only; sharing its ownership
-- across outputs would let one calendar remove another calendar's tasks.
INSERT INTO `google_tasks_settings_new`
SELECT o.id, g.user_id, 1, g.enabled, g.list_name, g.list_id,
 g.due_offset_days, g.skip_older_than_days, g.dismissed, g.last_sync_at, g.last_sync_error
FROM google_tasks_settings g
JOIN calendars c ON c.user_id = g.user_id
JOIN output_calendars o ON o.calendar_id = c.id
WHERE o.position = (SELECT MIN(position) FROM output_calendars WHERE calendar_id = c.id);
--> statement-breakpoint
DROP TABLE `google_tasks_settings`;
--> statement-breakpoint
ALTER TABLE `google_tasks_settings_new` RENAME TO `google_tasks_settings`;
