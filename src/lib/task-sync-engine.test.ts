import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { eq } from 'drizzle-orm'

// env.ts reads these once at import time, so they must be set before the
// modules under test are pulled in. `.env` carries no Google keys.
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'

const { db } = await import('../db/index.ts')
const { account, user } = await import('../db/auth-schema.ts')
const {
	calendars,
	courses,
	googleTasksSettings,
	outputCalendarCourses,
	outputCalendars,
} = await import('../db/schema.ts')
const { clearSourceCache } = await import('./ics.ts')
const { refreshGoogleTasks, syncGoogleTasks } = await import('./task-sync.ts')

const SOURCE = 'https://csumb.instructure.com/feeds/calendars/user_sync_test.ics'

// Pinning the sync clock keeps the age cutoffs deterministic as the real date
// moves past the fixed dates in this feed.
const TEST_NOW = new Date('2026-08-25T12:00:00.000Z')
const TWO_DAYS_LATER = new Date(TEST_NOW.getTime() + 2 * 24 * 60 * 60 * 1000)

function calendarFeed(events: string[]): string {
	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:icalendar-ruby',
		...events,
		'END:VCALENDAR',
	].join('\r\n')
}

function vevent(lines: string[]): string {
	return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n')
}

// 06:59Z is 11:59 PM Pacific the previous day, the usual Canvas deadline.
const homework3 = vevent([
	'UID:event-assignment-1',
	'DTSTART:20260825T065900Z',
	'DTEND:20260825T065900Z',
	'SUMMARY:Homework 3 [CST463-01_2264]',
])
// The same assignment rescheduled a week later.
const homework3Moved = vevent([
	'UID:event-assignment-1',
	'DTSTART:20260903T065900Z',
	'DTEND:20260903T065900Z',
	'SUMMARY:Homework 3 [CST463-01_2264]',
])
// A regular class meeting, which still copies over.
const lecture = vevent([
	'UID:event-lecture',
	'DTSTART:20260824T170000Z',
	'DTEND:20260824T183000Z',
	'SUMMARY:Lecture [CST463-01_2264]',
])
// No UID, so no marker could identify it on a later run.
const anonymous = vevent([
	'DTSTART:20260902T065900Z',
	'DTEND:20260902T065900Z',
	'SUMMARY:Mystery event [CST463-01_2264]',
])
// Two days past its deadline at TEST_NOW, so the default one-day cutoff skips
// it when it is new. A larger configured cutoff lets it through.
const recentOld = vevent([
	'UID:event-recent-old',
	'DTSTART:20260823T065900Z',
	'DTEND:20260823T065900Z',
	'SUMMARY:Recent old assignment [CST463-01_2264]',
])
// Twelve hours past its deadline, so it is inside the default one-day cutoff.
// It is added now, kept by a later Sync once it ages, and cleared by Refresh.
const justDue = vevent([
	'UID:event-just-due',
	'DTSTART:20260825T000000Z',
	'DTEND:20260825T000000Z',
	'SUMMARY:Just due assignment [CST463-01_2264]',
])

type FakeTask = {
	id: string
	title: string
	due?: string
	notes?: string
	deleted?: boolean
}

const realFetch = globalThis.fetch
const lists = new Map<string, { title: string; tasks: Map<string, FakeTask> }>()
let feed = calendarFeed([homework3, lecture, anonymous])
let nextId = 1

function installFakeGoogle(): void {
	globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
		const url = String(input)
		const method = init?.method ?? 'GET'
		const body = init?.body ? JSON.parse(String(init.body)) : undefined

		if (url.startsWith(SOURCE)) {
			return new Response(feed, { status: 200 })
		}

		const taskItem = url.match(/\/lists\/([^/]+)\/tasks\/([^/?]+)$/)
		if (taskItem) {
			const list = lists.get(taskItem[1])
			assert.ok(list)
			const task = list.tasks.get(taskItem[2])
			if (method === 'DELETE') {
				if (task) {
					// The API soft-deletes: the row stays, flagged deleted.
					task.deleted = true
				}
				return new Response(null, { status: 204 })
			}
			assert.ok(task)
			Object.assign(task, body)
			return new Response(JSON.stringify(task), { status: 200 })
		}

		const taskCollection = url.match(/\/lists\/([^/]+)\/tasks(\?|$)/)
		if (taskCollection) {
			const list = lists.get(taskCollection[1])
			assert.ok(list)
			if (method === 'GET') {
				return new Response(JSON.stringify({ items: [...list.tasks.values()] }), {
					status: 200,
				})
			}
			const id = `task-${nextId++}`
			list.tasks.set(id, { id, ...body })
			return new Response(JSON.stringify({ id }), { status: 200 })
		}

		const listItem = url.match(/\/users\/@me\/lists\/([^/?]+)$/)
		if (listItem) {
			const list = lists.get(listItem[1])
			if (!list) {
				return new Response('{}', { status: 404 })
			}
			if (method === 'PATCH') {
				list.title = body.title
				return new Response('{}', { status: 200 })
			}
			return new Response(
				JSON.stringify({ id: listItem[1], title: list.title }),
				{ status: 200 },
			)
		}

		if (method === 'POST' && /\/users\/@me\/lists$/.test(url)) {
			const id = `list-${nextId++}`
			lists.set(id, { title: body.title, tasks: new Map() })
			return new Response(JSON.stringify({ id, title: body.title }), {
				status: 200,
			})
		}

		if (method === 'GET' && /\/users\/@me\/lists/.test(url)) {
			return new Response(
				JSON.stringify({
					items: [...lists.entries()].map(([id, list]) => ({
						id,
						title: list.title,
					})),
				}),
				{ status: 200 },
			)
		}

		throw new Error(`unexpected request: ${method} ${url}`)
	}) as typeof globalThis.fetch
}

function listTitles(): string[] {
	return [...lists.values()].map((list) => list.title)
}

function storedTasks(): FakeTask[] {
	return [...lists.values()].flatMap((list) => [...list.tasks.values()])
}

function taskTitles(): string[] {
	return storedTasks()
		.filter((task) => !task.deleted)
		.map((task) => task.title)
}

function taskFor(uid: string): FakeTask | undefined {
	return storedTasks().find((task) => task.notes?.includes(`[canvas:${uid}]`))
}

/** Simulates the user deleting a task in the Google Tasks UI. */
function userDeletes(uid: string): void {
	const task = taskFor(uid)
	assert.ok(task, `no task for ${uid}`)
	task.deleted = true
}

const now = new Date()
const userId = crypto.randomUUID()
const calendarId = crypto.randomUUID()
const courseId = crypto.randomUUID()
const outputId = crypto.randomUUID()

async function settingsRow() {
	const [row] = await db
		.select()
		.from(googleTasksSettings)
		.where(eq(googleTasksSettings.userId, userId))
	return row
}

before(async () => {
	installFakeGoogle()
	await db.insert(user).values({
		id: userId,
		name: 'sync-test',
		email: `sync-${userId}@csumb.edu`,
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	})
	await db.insert(account).values({
		id: crypto.randomUUID(),
		accountId: 'google-subject',
		providerId: 'google',
		userId,
		accessToken: 'access-token',
		refreshToken: 'refresh-token',
		createdAt: now,
		updatedAt: now,
	})
	await db.insert(calendars).values({
		id: calendarId,
		userId,
		sourceUrl: SOURCE,
		createdAt: now,
		updatedAt: now,
	})
	await db.insert(courses).values({
		id: courseId,
		calendarId,
		code: 'CST463-01_2264',
	})
	await db.insert(outputCalendars).values({
		id: outputId,
		calendarId,
		name: 'Class',
		publicToken: crypto.randomUUID(),
		position: 1,
		createdAt: now,
	})
	await db
		.insert(outputCalendarCourses)
		.values({ outputCalendarId: outputId, courseId })
	await db.insert(googleTasksSettings).values({
		userId,
		enabled: true,
		listName: 'Homework',
		dueOffsetDays: 7,
		skipOlderThanDays: 1,
	})
})

after(async () => {
	globalThis.fetch = realFetch
	await db.delete(user).where(eq(user.id, userId))
})

// These run in order; each builds on the state the previous one left behind.
describe('syncGoogleTasks', () => {
	it('creates the list and mirrors every event that has a uid', async () => {
		const result = await syncGoogleTasks(userId, { now: TEST_NOW })
		assert.deepEqual(result, {
			ok: true,
			added: 2,
			updated: 0,
			removed: 0,
			skipped: 0,
		})
		assert.deepEqual(listTitles(), ['Homework'])
		// The lecture copies over too; only the UID-less event is skipped.
		assert.deepEqual(taskTitles(), [
			'Homework 3 [CST463-01_2264]',
			'Lecture [CST463-01_2264]',
		])
	})

	it('writes the offset due date and the deadline marker into the task', () => {
		const task = taskFor('event-assignment-1')
		assert.equal(task?.due, '2026-08-17T00:00:00.000Z')
		assert.match(task?.notes ?? '', /Deadline: Aug 24, 2026, 11:59\s?PM/)
		assert.match(task?.notes ?? '', /\[canvas:event-assignment-1\]$/)
	})

	it('changes nothing on a second pass when the feed is unchanged', async () => {
		clearSourceCache()
		const result = await syncGoogleTasks(userId, { now: TEST_NOW })
		assert.deepEqual(result, {
			ok: true,
			added: 0,
			updated: 0,
			removed: 0,
			skipped: 2,
		})
	})

	it('moves the task when the assignment is rescheduled', async () => {
		feed = calendarFeed([homework3Moved, lecture])
		clearSourceCache()

		const result = await syncGoogleTasks(userId, { now: TEST_NOW })
		assert.deepEqual(result, {
			ok: true,
			added: 0,
			updated: 1,
			removed: 0,
			skipped: 1,
		})
		assert.equal(taskFor('event-assignment-1')?.due, '2026-08-26T00:00:00.000Z')
	})

	it('keeps a task the user deleted instead of re-adding it', async () => {
		// Delete the lecture task as the user would, leaving the feed alone.
		userDeletes('event-lecture')
		clearSourceCache()

		const result = await syncGoogleTasks(userId, { now: TEST_NOW })
		assert.deepEqual(result, {
			ok: true,
			added: 0,
			updated: 0,
			removed: 0,
			skipped: 2,
		})
		assert.deepEqual(taskTitles(), ['Homework 3 [CST463-01_2264]'])

		const row = await settingsRow()
		assert.match(row?.dismissed ?? '', /event-lecture/)
	})

	it('still keeps it deleted on the next run', async () => {
		clearSourceCache()
		const result = await syncGoogleTasks(userId, { now: TEST_NOW })
		assert.deepEqual(result, {
			ok: true,
			added: 0,
			updated: 0,
			removed: 0,
			skipped: 2,
		})
		assert.deepEqual(taskTitles(), ['Homework 3 [CST463-01_2264]'])
	})

	it('recreates deleted tasks on Refresh and clears the memory', async () => {
		clearSourceCache()
		const result = await refreshGoogleTasks(userId, { now: TEST_NOW })
		assert.deepEqual(result, {
			ok: true,
			added: 1,
			updated: 0,
			removed: 0,
			skipped: 1,
		})
		assert.deepEqual(taskTitles(), [
			'Homework 3 [CST463-01_2264]',
			'Lecture [CST463-01_2264]',
		])

		const row = await settingsRow()
		assert.equal(row?.dismissed, '[]')
		// A normal run afterwards leaves the rebuilt task alone.
		clearSourceCache()
		const next = await syncGoogleTasks(userId, { now: TEST_NOW })
		assert.deepEqual(next, {
			ok: true,
			added: 0,
			updated: 0,
			removed: 0,
			skipped: 2,
		})
	})

	it('removes a task once its event leaves the feed', async () => {
		feed = calendarFeed([homework3Moved])
		clearSourceCache()

		const result = await syncGoogleTasks(userId, { now: TEST_NOW })
		assert.deepEqual(result, {
			ok: true,
			added: 0,
			updated: 0,
			removed: 1,
			skipped: 1,
		})
		assert.deepEqual(taskTitles(), ['Homework 3 [CST463-01_2264]'])
	})

	it('records the failure instead of throwing when Google is unreachable', async () => {
		const stashed = globalThis.fetch
		globalThis.fetch = (async (input: unknown) => {
			if (String(input).startsWith(SOURCE)) {
				return new Response(feed, { status: 200 })
			}
			return new Response('{}', { status: 500 })
		}) as typeof globalThis.fetch
		clearSourceCache()

		try {
			const result = await syncGoogleTasks(userId, { now: TEST_NOW })
			assert.equal(result.ok, false)

			const row = await settingsRow()
			assert.match(row?.lastSyncError ?? '', /HTTP 500/)
		} finally {
			globalThis.fetch = stashed
		}
	})

	it('refuses to sync while the toggle is off', async () => {
		await db
			.update(googleTasksSettings)
			.set({ enabled: false })
			.where(eq(googleTasksSettings.userId, userId))

		const result = await syncGoogleTasks(userId, { now: TEST_NOW })
		assert.deepEqual(result, { ok: false, message: 'Google Tasks sync is off.' })
	})

	it('skips new tasks older than the one-day cutoff but adds recent ones', async () => {
		await db
			.update(googleTasksSettings)
			.set({ enabled: true, skipOlderThanDays: 1 })
			.where(eq(googleTasksSettings.userId, userId))
		feed = calendarFeed([homework3Moved, recentOld, justDue])
		clearSourceCache()

		const result = await syncGoogleTasks(userId, { now: TEST_NOW })
		assert.deepEqual(result, {
			ok: true,
			added: 1,
			updated: 0,
			removed: 0,
			skipped: 2,
		})
		assert.equal(taskFor('event-recent-old'), undefined)
		assert.ok(taskFor('event-just-due'))
	})

	it('keeps an existing old task during Sync', async () => {
		clearSourceCache()
		const result = await syncGoogleTasks(userId, { now: TWO_DAYS_LATER })
		assert.deepEqual(result, {
			ok: true,
			added: 0,
			updated: 0,
			removed: 0,
			skipped: 3,
		})
		assert.equal(taskFor('event-just-due')?.deleted, undefined)
	})

	it('clears old tasks on Refresh instead of recreating them', async () => {
		clearSourceCache()
		const result = await refreshGoogleTasks(userId, { now: TWO_DAYS_LATER })
		assert.deepEqual(result, {
			ok: true,
			added: 0,
			updated: 0,
			removed: 1,
			skipped: 2,
		})
		assert.equal(taskFor('event-just-due')?.deleted, true)
		assert.equal(taskFor('event-recent-old'), undefined)
	})

	it('honours a larger skip threshold when adding tasks', async () => {
		await db
			.update(googleTasksSettings)
			.set({ skipOlderThanDays: 3 })
			.where(eq(googleTasksSettings.userId, userId))
		feed = calendarFeed([homework3Moved, recentOld])
		clearSourceCache()

		const result = await syncGoogleTasks(userId, { now: TEST_NOW })
		assert.deepEqual(result, {
			ok: true,
			added: 1,
			updated: 0,
			removed: 0,
			skipped: 1,
		})
		assert.equal(taskFor('event-recent-old')?.deleted, undefined)
	})
})
