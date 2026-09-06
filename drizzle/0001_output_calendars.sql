CREATE TABLE `output_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`name` text NOT NULL,
	`public_token` text NOT NULL,
	`position` integer NOT NULL,
	`last_feed_access_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `output_calendars_public_token_unique` ON `output_calendars` (`public_token`);
--> statement-breakpoint
CREATE UNIQUE INDEX `output_calendars_calendar_position` ON `output_calendars` (`calendar_id`,`position`);
--> statement-breakpoint
CREATE TABLE `output_calendar_courses` (
	`output_calendar_id` text NOT NULL,
	`course_id` text NOT NULL,
	PRIMARY KEY(`output_calendar_id`, `course_id`),
	FOREIGN KEY (`output_calendar_id`) REFERENCES `output_calendars`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `output_calendars` (`id`, `calendar_id`, `name`, `public_token`, `position`, `last_feed_access_at`, `created_at`)
SELECT `id` || '-output-1', `id`, 'Calendar 1', `public_token`, 1, `last_feed_access_at`, `created_at`
FROM `calendars`;
--> statement-breakpoint
INSERT INTO `output_calendar_courses` (`output_calendar_id`, `course_id`)
SELECT `output_calendars`.`id`, `courses`.`id`
FROM `courses`
INNER JOIN `output_calendars` ON `output_calendars`.`calendar_id` = `courses`.`calendar_id`
WHERE `courses`.`enabled` = 1;
--> statement-breakpoint
DROP INDEX `calendars_public_token_unique`;
--> statement-breakpoint
ALTER TABLE `calendars` DROP COLUMN `public_token`;
--> statement-breakpoint
ALTER TABLE `calendars` DROP COLUMN `last_feed_access_at`;
--> statement-breakpoint
ALTER TABLE `courses` DROP COLUMN `enabled`;
