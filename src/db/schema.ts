import {
	sqliteTable,
	text,
	integer,
	unique,
	primaryKey,
} from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema.ts'

export const MAX_OUTPUT_CALENDARS = 8

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
		tasksEnabled: integer('tasks_enabled', { mode: 'boolean' })
			.notNull()
			.default(false),
		tasksListName: text('tasks_list_name'),
		tasksListId: text('tasks_list_id'),
		tasksLastSyncAt: integer('tasks_last_sync_at', { mode: 'timestamp' }),
		tasksLastSyncError: text('tasks_last_sync_error'),
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

export function defaultOutputName(position: number): string {
	return `Calendar ${position}`
}

export function resolveTasksListName(output: {
	name: string
	tasksListName: string | null
}): string {
	return output.tasksListName ?? output.name
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
