import { and, eq } from 'drizzle-orm'
import { auth } from '../auth.ts'
import { db } from '../db/index.ts'
import { account } from '../db/auth-schema.ts'
import {
	calendars,
	courses,
	googleTasksSettings,
	outputCalendarCourses,
	resolveTaskListName,
} from '../db/schema.ts'
import { googleConfigured } from '../env.ts'
import {
	deleteTask,
	ensureTaskList,
	insertTask,
	listTaskLists,
	listTasks,
	patchTask,
	type GoogleTask,
	type GoogleTaskList,
} from './google-tasks.ts'
import { fetchCalendarSource, parseCalendar, type ParsedEvent } from './ics.ts'

export const TASK_TIMEZONE = 'America/Los_Angeles'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Feed fetches drive syncing, and a calendar app may poll every few minutes,
 * so automatic runs are spaced out. The manual Sync now / Refresh ignore this.
 */
const MIN_SYNC_INTERVAL_MS = 15 * 60 * 1000

const localFormatter = new Intl.DateTimeFormat('en-US', {
	timeZone: TASK_TIMEZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
})

function localParts(date: Date): {
	year: string
	month: string
	day: string
} {
	const parts = localFormatter.formatToParts(date)
	const value = (type: Intl.DateTimeFormatPartTypes): string =>
		parts.find((part) => part.type === type)?.value ?? '00'
	return {
		year: value('year'),
		month: value('month'),
		day: value('day'),
	}
}

/**
 * The last instant the work is still due. Canvas emits a point deadline (an
 * assignment) or a span (a class meeting); in both cases this is the instant the
 * event stops covering, which for a Canvas deadline is 11:59 PM Pacific.
 */
function lastDueInstant(event: ParsedEvent): Date {
	if (event.end.getTime() <= event.start.getTime()) {
		return event.start
	}
	return new Date(event.end.getTime() - 1)
}

/** True when the event's deadline is more than `days` in the past. */
function isOlderThan(event: ParsedEvent, days: number, now: Date): boolean {
	return now.getTime() - lastDueInstant(event).getTime() > days * MS_PER_DAY
}

/**
 * Google Tasks stores only the date half of `due` and discards the time, so the
 * deadline is resolved to a Pacific calendar day first. The task is then due the
 * configured number of days before that deadline, so it surfaces on the calendar
 * ahead of the assignment rather than on the day it is due.
 */
export function taskDueDate(event: ParsedEvent, offsetDays: number): string {
	const { year, month, day } = localParts(lastDueInstant(event))
	const deadlineDay = Date.UTC(Number(year), Number(month) - 1, Number(day))
	const due = new Date(deadlineDay - offsetDays * MS_PER_DAY)
	const dueYear = due.getUTCFullYear()
	const dueMonth = String(due.getUTCMonth() + 1).padStart(2, '0')
	const dueDay = String(due.getUTCDate()).padStart(2, '0')
	return `${dueYear}-${dueMonth}-${dueDay}T00:00:00.000Z`
}

/** The full deadline, time included, for the task notes. */
export function taskDeadline(event: ParsedEvent): string {
	const due = lastDueInstant(event)
	if (event.allDay) {
		return `${due.toLocaleString('en-US', {
			timeZone: TASK_TIMEZONE,
			dateStyle: 'medium',
		})} (all day)`
	}
	return due.toLocaleString('en-US', {
		timeZone: TASK_TIMEZONE,
		dateStyle: 'medium',
		timeStyle: 'short',
	})
}

const UID_MARKER = /\[canvas:([^\]\s]+)\]/

/**
 * Google rejects a task whose title or notes exceed these lengths with a 400,
 * and a Canvas assignment description can easily run past the notes limit now
 * that every event is copied, so the fields are clamped. The tracking marker is
 * always kept, since without it the task could never be found again.
 */
export const MAX_TITLE_LENGTH = 1024
export const MAX_NOTES_LENGTH = 8192
export const DEFAULT_TASK_TITLE = 'Canvas event'

/** The trailing marker that ties a task back to its Canvas event. */
function taskMarker(uid: string): string {
	return `[canvas:${uid}]`
}

/** Reads back the marker written by {@link taskNotes}. */
export function canvasUidFromNotes(notes: string | undefined): string | null {
	return notes?.match(UID_MARKER)?.[1] ?? null
}

/** The task title, clamped to Google's limit and never blank. */
export function taskTitle(event: ParsedEvent): string {
	const title = event.summary.trim()
	return title.length > 0
		? title.slice(0, MAX_TITLE_LENGTH)
		: DEFAULT_TASK_TITLE
}

/**
 * The full deadline Google drops, kept where the user can still read it, plus
 * the marker that lets a later run find, move or delete this task. The marker
 * goes last so it stays out of the way of anything the user writes, and the
 * description is trimmed so the total stays within Google's notes limit.
 */
export function taskNotes(event: ParsedEvent): string {
	const marker = `\n\n${taskMarker(event.uid)}`
	const header = [`Deadline: ${taskDeadline(event)}`]
	if (event.url) {
		header.push(event.url)
	}
	const head = header.join('\n')
	const budget = MAX_NOTES_LENGTH - head.length - marker.length - 2
	const description = event.description ?? ''
	const body = budget > 0 ? description.slice(0, budget) : ''
	return body.length > 0 ? `${head}\n\n${body}${marker}` : `${head}${marker}`
}

export type SyncResult =
	| { ok: true; added: number; updated: number; removed: number; skipped: number }
	| { ok: false; message: string }

// Every feed fetch can start a run, so overlapping runs are likely. A second
// run would race the first over the same list, so they are serialized per user.
const inFlight = new Set<string>()

export async function googleAccountFor(
	userId: string,
): Promise<{ id: string } | null> {
	const [linked] = await db
		.select({ id: account.id })
		.from(account)
		.where(and(eq(account.userId, userId), eq(account.providerId, 'google')))
		.limit(1)
	return linked ?? null
}

async function googleAccessToken(userId: string): Promise<string> {
	const linked = await googleAccountFor(userId)
	if (!linked) {
		throw new Error('Connect a Google account first.')
	}
	// Called without headers so a background run, which has no request session,
	// resolves the user from `userId`. Refreshing an expired token happens here.
	try {
		const token = await auth.api.getAccessToken({
			body: { accountId: linked.id, userId },
		})
		if (!token?.accessToken) {
			throw new Error('Could not get a Google access token.')
		}
		return token.accessToken
	} catch (error) {
		console.error(
			`[google-tasks] Could not get a Google access token for user ${userId}:`,
			error,
		)
		throw error
	}
}

/** The account's task lists, for the dashboard list picker. */
export async function listGoogleTaskLists(
	userId: string,
): Promise<GoogleTaskList[]> {
	const accessToken = await googleAccessToken(userId)
	return listTaskLists(accessToken)
}

async function loadSettings(userId: string) {
	const [row] = await db
		.select()
		.from(googleTasksSettings)
		.where(eq(googleTasksSettings.userId, userId))
		.limit(1)
	return row ?? null
}

/**
 * The courses to mirror: every course the user enabled in any output calendar.
 * The app exists to drop courses (for example, ones being TA'd), and that filter
 * should carry over to tasks too.
 */
async function enabledCourseCodes(userId: string): Promise<Set<string>> {
	const rows = await db
		.select({ code: courses.code })
		.from(outputCalendarCourses)
		.innerJoin(courses, eq(courses.id, outputCalendarCourses.courseId))
		.innerJoin(calendars, eq(calendars.id, courses.calendarId))
		.where(eq(calendars.userId, userId))
	return new Set(rows.map((row) => row.code))
}

async function sourceUrlFor(userId: string): Promise<string | null> {
	const [row] = await db
		.select({ sourceUrl: calendars.sourceUrl })
		.from(calendars)
		.where(eq(calendars.userId, userId))
		.limit(1)
	return row?.sourceUrl ?? null
}

/** Google may echo the due date with a time; only the day is meaningful. */
function sameDue(remote: string | undefined, desired: string): boolean {
	return (remote ?? '').slice(0, 10) === desired.slice(0, 10)
}

function parseDismissed(value: string | null): Set<string> {
	if (!value) {
		return new Set()
	}
	try {
		const parsed: unknown = JSON.parse(value)
		return Array.isArray(parsed)
			? new Set(parsed.filter((item): item is string => typeof item === 'string'))
			: new Set()
	} catch {
		return new Set()
	}
}

function serializeDismissed(uids: ReadonlySet<string>): string {
	return JSON.stringify([...uids])
}

type SettingsRow = NonNullable<Awaited<ReturnType<typeof loadSettings>>>

type SyncCounts = {
	added: number
	updated: number
	removed: number
	skipped: number
}

/**
 * Mirrors the feed into the task list. Every recent event in an enabled course
 * becomes a task. The marker in each task's notes is the join key, so a task
 * that already exists is compared against the assignment it maps to and moved
 * or rewritten when the assignment changed, and removed when the assignment
 * left the feed. A task the user deleted is remembered and left deleted, unless
 * `recreate` is set (the Refresh action), which puts recent tasks back.
 *
 * Events whose deadline is older than `skipOlderThanDays` are not added. A
 * normal sync still keeps an existing task of any age, while Refresh deletes
 * old tasks instead of rebuilding them.
 */
async function runSync(
	settings: SettingsRow,
	userId: string,
	options: { recreate?: boolean; now: Date },
): Promise<SyncCounts> {
	const accessToken = await googleAccessToken(userId)
	const sourceUrl = await sourceUrlFor(userId)
	if (!sourceUrl) {
		return { added: 0, updated: 0, removed: 0, skipped: 0 }
	}

	const enabled = await enabledCourseCodes(userId)
	const assignments = new Map<string, ParsedEvent>()
	for (const event of parseCalendar(await fetchCalendarSource(sourceUrl))) {
		if (!event.courseCode || !enabled.has(event.courseCode)) {
			continue
		}
		// Without a uid from the feed there is no marker to recognize later, so
		// syncing one would add a duplicate on every run.
		if (event.uid.length === 0) {
			continue
		}
		assignments.set(event.uid, event)
	}

	const list = await ensureTaskList(accessToken, {
		listId: settings.listId,
		name: resolveTaskListName(settings.listName),
	})
	if (list.id !== settings.listId) {
		await db
			.update(googleTasksSettings)
			.set({ listId: list.id })
			.where(eq(googleTasksSettings.userId, userId))
	}

	const liveByUid = new Map<string, GoogleTask>()
	const deletedUids = new Set<string>()
	if (!list.created) {
		for (const task of await listTasks(accessToken, list.id)) {
			if (!task.id) {
				continue
			}
			const uid = canvasUidFromNotes(task.notes)
			if (!uid) {
				continue
			}
			if (task.deleted) {
				deletedUids.add(uid)
			} else {
				liveByUid.set(uid, task)
			}
		}
	}
	const liveUids = new Set(liveByUid.keys())

	// A task the user deleted is a deleted task whose assignment is still in the
	// feed. Remember those so later runs do not put them back. Refresh starts
	// from an empty set so everything is rebuilt.
	const dismissed = options.recreate ? new Set<string>() : parseDismissed(settings.dismissed)
	if (!options.recreate) {
		for (const uid of deletedUids) {
			if (assignments.has(uid) && !liveUids.has(uid)) {
				dismissed.add(uid)
			}
		}
	}

	const counts: SyncCounts = { added: 0, updated: 0, removed: 0, skipped: 0 }

	for (const [uid, event] of assignments) {
		const existing = liveByUid.get(uid)
		const old = isOlderThan(event, settings.skipOlderThanDays, options.now)
		if (options.recreate && old) {
			if (existing?.id) {
				await deleteTask(accessToken, list.id, existing.id)
				liveByUid.delete(uid)
				counts.removed += 1
			} else {
				counts.skipped += 1
			}
			continue
		}
		if (dismissed.has(uid) && !liveUids.has(uid)) {
			counts.skipped += 1
			continue
		}
		const desired = {
			title: taskTitle(event),
			due: taskDueDate(event, settings.dueOffsetDays),
			notes: taskNotes(event),
		}
		if (!existing?.id) {
			if (old) {
				counts.skipped += 1
				continue
			}
			await insertTask(accessToken, list.id, desired)
			counts.added += 1
			continue
		}
		liveByUid.delete(uid)
		const changed =
			existing.title !== desired.title ||
			!sameDue(existing.due, desired.due) ||
			existing.notes !== desired.notes
		if (changed) {
			await patchTask(accessToken, list.id, existing.id, desired)
			counts.updated += 1
		} else {
			counts.skipped += 1
		}
	}

	// Whatever live task is left maps to an assignment no longer in the feed.
	for (const task of liveByUid.values()) {
		if (!task.id) {
			continue
		}
		await deleteTask(accessToken, list.id, task.id)
		counts.removed += 1
	}

	await db
		.update(googleTasksSettings)
		.set({ dismissed: serializeDismissed(dismissed) })
		.where(eq(googleTasksSettings.userId, userId))

	return counts
}

export async function syncGoogleTasks(
	userId: string,
	options: { respectInterval?: boolean; recreate?: boolean; now?: Date } = {},
): Promise<SyncResult> {
	if (!googleConfigured) {
		return { ok: false, message: 'Google Tasks sync is not configured.' }
	}
	if (inFlight.has(userId)) {
		return { ok: false, message: 'A sync is already running.' }
	}

	const now = options.now ?? new Date()
	const settings = await loadSettings(userId)
	if (!settings?.enabled) {
		return { ok: false, message: 'Google Tasks sync is off.' }
	}
	if (
		options.respectInterval &&
		settings.lastSyncAt &&
		now.getTime() - settings.lastSyncAt.getTime() < MIN_SYNC_INTERVAL_MS
	) {
		return { ok: false, message: 'This account synced recently.' }
	}

	inFlight.add(userId)
	try {
		const counts = await runSync(settings, userId, {
			recreate: options.recreate,
			now,
		})
		await db
			.update(googleTasksSettings)
			.set({ lastSyncAt: now, lastSyncError: null })
			.where(eq(googleTasksSettings.userId, userId))
		return { ok: true, ...counts }
	} catch (error) {
		console.error(`[google-tasks] Sync failed for user ${userId}:`, error)
		const message =
			error instanceof Error ? error.message : 'Could not sync Google Tasks.'
		await db
			.update(googleTasksSettings)
			.set({ lastSyncError: message })
			.where(eq(googleTasksSettings.userId, userId))
		return { ok: false, message }
	} finally {
		inFlight.delete(userId)
	}
}

/**
 * Rebuilds every recent task from the feed, including ones the user deleted.
 * It clears the remembered deletions first, so the next sync treats them as
 * new, and removes synced tasks that are older than the skip threshold.
 */
export function refreshGoogleTasks(
	userId: string,
	options: { now?: Date } = {},
): Promise<SyncResult> {
	return syncGoogleTasks(userId, { recreate: true, now: options.now })
}

/**
 * Starts a sync without making the caller wait for Google. Used by the feed
 * route so generating the calendar never blocks on task syncing.
 */
export function syncGoogleTasksInBackground(userId: string): void {
	void syncGoogleTasks(userId, { respectInterval: true }).catch(
		(error: unknown) => {
			console.error('Background Google Tasks sync failed:', error)
		},
	)
}
