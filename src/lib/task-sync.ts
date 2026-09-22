import { and, eq } from 'drizzle-orm'
import { auth } from '../auth.ts'
import { db } from '../db/index.ts'
import { account } from '../db/auth-schema.ts'
import {
	calendars,
	courses,
	outputCalendarCourses,
	outputCalendars,
	resolveTasksListName,
} from '../db/schema.ts'
import { googleConfigured } from '../env.ts'
import { ensureTaskList, insertTask, listTasks } from './google-tasks.ts'
import { fetchCalendarSource, parseCalendar, type ParsedEvent } from './ics.ts'

export const TASK_TIMEZONE = 'America/Los_Angeles'

const SHORT_EVENT_MAX_MINUTES = 20
const LATE_NIGHT_START_HOUR = 23
const MS_PER_MINUTE = 60 * 1000

/**
 * Feed fetches drive syncing, and a calendar app may poll every few minutes,
 * so automatic runs are spaced out. The manual button ignores this.
 */
const MIN_SYNC_INTERVAL_MS = 15 * 60 * 1000

const localFormatter = new Intl.DateTimeFormat('en-US', {
	timeZone: TASK_TIMEZONE,
	hourCycle: 'h23',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
})

function localParts(date: Date): {
	year: string
	month: string
	day: string
	hour: number
} {
	const parts = localFormatter.formatToParts(date)
	const value = (type: Intl.DateTimeFormatPartTypes): string =>
		parts.find((part) => part.type === type)?.value ?? '00'
	return {
		year: value('year'),
		month: value('month'),
		day: value('day'),
		hour: Number(value('hour')),
	}
}

/**
 * The last instant the work is still due. Canvas emits an assignment as a
 * zero-length event, which `pinTimedEnd` stretches by a minute, so an 11:59 PM
 * deadline ends at 12:00 AM the next day. Stepping back keeps it on its own
 * calendar day.
 */
function lastDueInstant(event: ParsedEvent): Date {
	if (event.end.getTime() <= event.start.getTime()) {
		return event.start
	}
	return new Date(event.end.getTime() - 1)
}

/**
 * Canvas does not mark which events are assignments, so they are recognized by
 * their timing: a deadline sits just before midnight, and anything Canvas emits
 * as a due instant is far shorter than a real class meeting.
 */
export function isAssignmentEvent(event: ParsedEvent): boolean {
	if (event.allDay) {
		return false
	}
	if (localParts(event.start).hour >= LATE_NIGHT_START_HOUR) {
		return true
	}
	const minutes = (event.end.getTime() - event.start.getTime()) / MS_PER_MINUTE
	return minutes < SHORT_EVENT_MAX_MINUTES
}

/**
 * Google Tasks stores only the date half of `due` and discards the time, so the
 * instant is resolved to a Pacific calendar day first. Sending the raw UTC
 * instant would push a late-evening deadline onto the following day.
 */
export function taskDueDate(event: ParsedEvent): string {
	const { year, month, day } = localParts(lastDueInstant(event))
	return `${year}-${month}-${day}T00:00:00.000Z`
}

const UID_MARKER = /\[canvas:([^\]\s]+)\]/

/** The trailing marker that ties a task back to its Canvas event. */
function taskMarker(uid: string): string {
	return `[canvas:${uid}]`
}

/** Reads back the marker written by {@link taskNotes}. */
export function canvasUidFromNotes(notes: string | undefined): string | null {
	return notes?.match(UID_MARKER)?.[1] ?? null
}

/**
 * The due time Google drops, kept where the user can still read it, plus the
 * marker that stands in for a local mapping table. The marker goes last so it
 * stays out of the way of anything the user writes.
 */
export function taskNotes(event: ParsedEvent): string {
	const due = lastDueInstant(event).toLocaleString('en-US', {
		timeZone: TASK_TIMEZONE,
		dateStyle: 'medium',
		timeStyle: 'short',
	})
	const lines = [`Due ${due}`]
	if (event.url) {
		lines.push(event.url)
	}
	if (event.description) {
		lines.push('', event.description)
	}
	lines.push('', taskMarker(event.uid))
	return lines.join('\n')
}

export type SyncResult =
	| { ok: true; added: number; skipped: number }
	| { ok: false; message: string }

// Every feed fetch can start a run, so overlapping runs are likely. A second
// run would insert the same tasks again before the first one shows up in
// Google's task list.
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
	const token = await auth.api.getAccessToken({
		body: { accountId: linked.id, userId },
	})
	if (!token?.accessToken) {
		throw new Error('Could not get a Google access token.')
	}
	return token.accessToken
}

async function loadSyncTarget(outputCalendarId: string) {
	const [row] = await db
		.select({
			id: outputCalendars.id,
			name: outputCalendars.name,
			tasksEnabled: outputCalendars.tasksEnabled,
			tasksListName: outputCalendars.tasksListName,
			tasksListId: outputCalendars.tasksListId,
			tasksLastSyncAt: outputCalendars.tasksLastSyncAt,
			userId: calendars.userId,
			sourceUrl: calendars.sourceUrl,
		})
		.from(outputCalendars)
		.innerJoin(calendars, eq(calendars.id, outputCalendars.calendarId))
		.where(eq(outputCalendars.id, outputCalendarId))
		.limit(1)
	return row ?? null
}

async function enabledCourseCodes(
	outputCalendarId: string,
): Promise<Set<string>> {
	const rows = await db
		.select({ code: courses.code })
		.from(outputCalendarCourses)
		.innerJoin(courses, eq(courses.id, outputCalendarCourses.courseId))
		.where(eq(outputCalendarCourses.outputCalendarId, outputCalendarId))
	return new Set(rows.map((row) => row.code))
}

/**
 * Tasks are written once and then left alone: a task that already exists is
 * never patched, so anything the user retitled, rescheduled, completed or
 * deleted in Google stays the way they left it. Nothing is ever deleted here
 * either. That makes the only comparison the one that matters, whether a task
 * for this event exists at all, which the embedded marker answers without any
 * local bookkeeping.
 */
async function runSync(
	target: NonNullable<Awaited<ReturnType<typeof loadSyncTarget>>>,
): Promise<{ added: number; skipped: number }> {
	const accessToken = await googleAccessToken(target.userId)
	const enabled = await enabledCourseCodes(target.id)

	const ics = await fetchCalendarSource(target.sourceUrl)
	const assignments = new Map<string, ParsedEvent>()
	for (const event of parseCalendar(ics)) {
		if (!event.courseCode || !enabled.has(event.courseCode)) {
			continue
		}
		// Without a uid from the feed there is no marker to recognize later, so
		// syncing one would add a duplicate on every run.
		if (event.uid.length === 0) {
			continue
		}
		if (isAssignmentEvent(event)) {
			assignments.set(event.uid, event)
		}
	}

	const list = await ensureTaskList(
		accessToken,
		target.tasksListId,
		resolveTasksListName(target),
	)
	if (list.id !== target.tasksListId) {
		await db
			.update(outputCalendars)
			.set({ tasksListId: list.id })
			.where(eq(outputCalendars.id, target.id))
	}

	// Completed and deleted tasks count as present. Skipping them would put a
	// task the user already dealt with straight back on their list.
	const seen = new Set<string>()
	if (!list.created) {
		for (const task of await listTasks(accessToken, list.id)) {
			const uid = canvasUidFromNotes(task.notes)
			if (uid) {
				seen.add(uid)
			}
		}
	}

	let added = 0
	let skipped = 0

	for (const [uid, event] of assignments) {
		if (seen.has(uid)) {
			skipped += 1
			continue
		}
		await insertTask(accessToken, list.id, {
			title: event.summary,
			due: taskDueDate(event),
			notes: taskNotes(event),
		})
		added += 1
	}

	return { added, skipped }
}

export async function syncOutputCalendar(
	outputCalendarId: string,
	options: { respectInterval?: boolean } = {},
): Promise<SyncResult> {
	if (!googleConfigured) {
		return { ok: false, message: 'Google Tasks sync is not configured.' }
	}
	if (inFlight.has(outputCalendarId)) {
		return { ok: false, message: 'A sync is already running for this calendar.' }
	}

	const target = await loadSyncTarget(outputCalendarId)
	if (!target) {
		return { ok: false, message: 'That calendar was not found.' }
	}
	if (!target.tasksEnabled) {
		return { ok: false, message: 'Google Tasks sync is off for this calendar.' }
	}
	if (
		options.respectInterval &&
		target.tasksLastSyncAt &&
		Date.now() - target.tasksLastSyncAt.getTime() < MIN_SYNC_INTERVAL_MS
	) {
		return { ok: false, message: 'This calendar synced recently.' }
	}

	inFlight.add(outputCalendarId)
	try {
		const counts = await runSync(target)
		await db
			.update(outputCalendars)
			.set({ tasksLastSyncAt: new Date(), tasksLastSyncError: null })
			.where(eq(outputCalendars.id, outputCalendarId))
		return { ok: true, ...counts }
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Could not sync Google Tasks.'
		await db
			.update(outputCalendars)
			.set({ tasksLastSyncError: message })
			.where(eq(outputCalendars.id, outputCalendarId))
		return { ok: false, message }
	} finally {
		inFlight.delete(outputCalendarId)
	}
}

/**
 * Starts a sync without making the caller wait for Google. Used by the feed
 * route so generating the calendar never blocks on task syncing.
 */
export function syncOutputCalendarInBackground(outputCalendarId: string): void {
	void syncOutputCalendar(outputCalendarId, { respectInterval: true }).catch(
		(error: unknown) => {
			console.error('Background Google Tasks sync failed:', error)
		},
	)
}
