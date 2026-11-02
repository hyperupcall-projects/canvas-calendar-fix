ALTER TABLE `google_tasks_settings` ADD `task_statuses` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
-- Everything in the old list was a task the user deleted.
UPDATE `google_tasks_settings`
SET `task_statuses` = (
 SELECT json_group_object(value, 'deleted') FROM json_each(`dismissed`) WHERE type = 'text'
)
WHERE json_valid(`dismissed`);
--> statement-breakpoint
ALTER TABLE `google_tasks_settings` DROP COLUMN `dismissed`;
