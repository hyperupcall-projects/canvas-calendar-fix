import {
	sqliteTable,
	text,
	integer,
	unique,
	primaryKey,
} from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema.ts'

export const MAX_OUTPUT_CALENDARS = 8

// How many days before an assignment's deadline the Google Task is due, so it
// surfaces on the calendar ahead of time.
export const DEFAULT_DUE_OFFSET_DAYS = 7
export const MIN_DUE_OFFSET_DAYS = 1
export const MAX_DUE_OFFSET_DAYS = 14

// A normal sync will not add a task whose Canvas deadline is older than this
// many days. Tasks already in the list are kept regardless of age, while
// Refresh removes old tasks instead of rebuilding them.
export const DEFAULT_SKIP_OLDER_THAN_DAYS = 1
export const MIN_SKIP_OLDER_THAN_DAYS = 1
export const MAX_SKIP_OLDER_THAN_DAYS = 30

export const DEFAULT_TASK_LIST_NAME = 'Canvas Assignments'

export const calendars = sqliteTable('calendars', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.unique()
		.references(() => user.id, { onDelete: 'cascade' }),
	sourceUrl: text('source_url').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const courses = sqliteTable(
	'courses',
	{
		id: text('id').primaryKey(),
		calendarId: text('calendar_id')
			.notNull()
			.references(() => calendars.id, { onDelete: 'cascade' }),
		code: text('code').notNull(),
	},
	(table) => [unique('courses_calendar_code').on(table.calendarId, table.code)],
)

export const outputCalendars = sqliteTable(
	'output_calendars',
	{
		id: text('id').primaryKey(),
		calendarId: text('calendar_id')
			.notNull()
			.references(() => calendars.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		publicToken: text('public_token').notNull().unique(),
		position: integer('position').notNull(),
		addCanvasLink: integer('add_canvas_link', { mode: 'boolean' })
			.notNull()
			.default(true),
		lastFeedAccessAt: integer('last_feed_access_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	},
	(table) => [
		unique('output_calendars_calendar_position').on(
			table.calendarId,
			table.position,
		),
	],
)

export const outputCalendarCourses = sqliteTable(
	'output_calendar_courses',
	{
		outputCalendarId: text('output_calendar_id')
			.notNull()
			.references(() => outputCalendars.id, { onDelete: 'cascade' }),
		courseId: text('course_id')
			.notNull()
			.references(() => courses.id, { onDelete: 'cascade' }),
	},
	(table) => [
		primaryKey({ columns: [table.outputCalendarId, table.courseId] }),
	],
)

/** Independent task settings and sync state for each output calendar. */
export const googleTasksSettings = sqliteTable('google_tasks_settings', {
	outputCalendarId: text('output_calendar_id')
		.primaryKey()
		.references(() => outputCalendars.id, { onDelete: 'cascade' }),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	// Only the migrated first output owns tasks created before output scoping.
	legacyTaskMarkers: integer('legacy_task_markers', { mode: 'boolean' })
		.notNull()
		.default(false),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
	listName: text('list_name'),
	listId: text('list_id'),
	dueOffsetDays: integer('due_offset_days')
		.notNull()
		.default(DEFAULT_DUE_OFFSET_DAYS),
	skipOlderThanDays: integer('skip_older_than_days')
		.notNull()
		.default(DEFAULT_SKIP_OLDER_THAN_DAYS),
	// JSON array of Canvas uids whose tasks the user deleted in Google, so they
	// are not put back. Cleared by the Refresh action.
	dismissed: text('dismissed').notNull().default('[]'),
	lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
	lastSyncError: text('last_sync_error'),
})

export function defaultOutputName(position: number): string {
	return `Calendar ${position}`
}

export function nextOutputPosition(
	existing: ReadonlyArray<{ position: number }>,
): number | null {
	const used = new Set(existing.map((row) => row.position))
	for (let position = 1; position <= MAX_OUTPUT_CALENDARS; position += 1) {
		if (!used.has(position)) {
			return position
		}
	}
	return null
}

/** Coerces a possibly-invalid form value into the allowed 1-14 day range. */
export function clampDueOffsetDays(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_DUE_OFFSET_DAYS
	}
	return Math.min(
		MAX_DUE_OFFSET_DAYS,
		Math.max(MIN_DUE_OFFSET_DAYS, Math.trunc(value)),
	)
}

export function dueOffsetOptions(): number[] {
	const options: number[] = []
	for (let days = MIN_DUE_OFFSET_DAYS; days <= MAX_DUE_OFFSET_DAYS; days += 1) {
		options.push(days)
	}
	return options
}

/** Coerces a possibly-invalid form value into the allowed 1-30 day range. */
export function clampSkipOlderThanDays(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_SKIP_OLDER_THAN_DAYS
	}
	return Math.min(
		MAX_SKIP_OLDER_THAN_DAYS,
		Math.max(MIN_SKIP_OLDER_THAN_DAYS, Math.trunc(value)),
	)
}

export function skipOlderThanOptions(): number[] {
	const options: number[] = []
	for (
		let days = MIN_SKIP_OLDER_THAN_DAYS;
		days <= MAX_SKIP_OLDER_THAN_DAYS;
		days += 1
	) {
		options.push(days)
	}
	return options
}

/** Falls back to the default list name so the Google list is never blank. */
export function resolveTaskListName(listName: string | null): string {
	const trimmed = listName?.trim() ?? ''
	return trimmed.length > 0 ? trimmed : DEFAULT_TASK_LIST_NAME
}
