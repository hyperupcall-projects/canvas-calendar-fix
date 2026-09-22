import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { eq } from 'drizzle-orm'

// env.ts reads these once at import time, so they must be set before the
// modules under test are pulled in. `.env` carries no Google keys.
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'

const { db } = await import('../db/index.ts')
const { account, user } = await import('../db/auth-schema.ts')
const { calendars, courses, outputCalendarCourses, outputCalendars } =
	await import('../db/schema.ts')
const { clearSourceCache } = await import('./ics.ts')
const { syncOutputCalendar } = await import('./task-sync.ts')

const SOURCE = 'https://csumb.instructure.com/feeds/calendars/user_sync_test.ics'

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
const homework4 = vevent([
	'UID:event-assignment-2',
	'DTSTART:20260901T065900Z',
	'DTEND:20260901T065900Z',
	'SUMMARY:Homework 4 [CST463-01_2264]',
])
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
	'SUMMARY:Mystery assignment [CST463-01_2264]',
])

type FakeTask = {
	id: string
	title: string
	due: string
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

		// Individual tasks are deliberately unhandled. Syncing writes a task
		// once and never touches it again, so a PATCH or DELETE landing here
		// should fail loudly as an unexpected request.
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

const now = new Date()
const userId = crypto.randomUUID()
const calendarId = crypto.randomUUID()
const courseId = crypto.randomUUID()
const outputId = crypto.randomUUID()

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
		tasksEnabled: true,
		tasksListName: 'Homework',
	})
	await db
		.insert(outputCalendarCourses)
		.values({ outputCalendarId: outputId, courseId })
})

after(async () => {
	globalThis.fetch = realFetch
	await db.delete(user).where(eq(user.id, userId))
})

// These run in order; each builds on the state the previous one left behind.
describe('syncOutputCalendar', () => {
	it('creates the list and only mirrors identifiable assignments', async () => {
		const result = await syncOutputCalendar(outputId)
		assert.deepEqual(result, { ok: true, added: 1, skipped: 0 })
		assert.deepEqual(listTitles(), ['Homework'])
		// The 90-minute lecture is not an assignment, and the UID-less event
		// could never be recognized again.
		assert.deepEqual(taskTitles(), ['Homework 3 [CST463-01_2264]'])
	})

	it('writes the due date and the canvas marker into the new task', () => {
		const task = taskFor('event-assignment-1')
		assert.equal(task?.due, '2026-08-24T00:00:00.000Z')
		assert.match(task?.notes ?? '', /Due Aug 24, 2026, 11:59\s?PM/)
		assert.match(task?.notes ?? '', /\[canvas:event-assignment-1\]$/)
	})

	it('creates nothing on a second pass when the feed is unchanged', async () => {
		clearSourceCache()
		const result = await syncOutputCalendar(outputId)
		assert.deepEqual(result, { ok: true, added: 0, skipped: 1 })
	})

	it('renames the existing list instead of creating a second one', async () => {
		await db
			.update(outputCalendars)
			.set({ tasksListName: 'School Work' })
			.where(eq(outputCalendars.id, outputId))
		clearSourceCache()

		await syncOutputCalendar(outputId)
		assert.deepEqual(listTitles(), ['School Work'])
		assert.equal(lists.size, 1)
	})

	it('leaves a task the user rewrote completely alone', async () => {
		const task = taskFor('event-assignment-1')
		assert.ok(task)
		task.title = 'Start homework 3 early'
		task.due = '2026-08-20T00:00:00.000Z'
		task.notes = `my own plan\n\n[canvas:event-assignment-1]`
		clearSourceCache()

		const result = await syncOutputCalendar(outputId)
		assert.deepEqual(result, { ok: true, added: 0, skipped: 1 })

		const after = taskFor('event-assignment-1')
		assert.equal(after?.title, 'Start homework 3 early')
		assert.equal(after?.due, '2026-08-20T00:00:00.000Z')
		assert.equal(after?.notes, 'my own plan\n\n[canvas:event-assignment-1]')
		assert.equal(storedTasks().length, 1)
	})

	it('adds new assignments without removing ones that left the feed', async () => {
		feed = calendarFeed([homework4, lecture])
		clearSourceCache()

		const result = await syncOutputCalendar(outputId)
		assert.deepEqual(result, { ok: true, added: 1, skipped: 0 })
		assert.deepEqual(taskTitles(), [
			'Start homework 3 early',
			'Homework 4 [CST463-01_2264]',
		])
	})

	it('does not bring back a task the user deleted', async () => {
		const task = taskFor('event-assignment-2')
		assert.ok(task)
		task.deleted = true
		clearSourceCache()

		const result = await syncOutputCalendar(outputId)
		assert.deepEqual(result, { ok: true, added: 0, skipped: 1 })
		assert.equal(storedTasks().length, 2)
		assert.deepEqual(taskTitles(), ['Start homework 3 early'])
	})

	it('keeps an explicit list name when the calendar is renamed', async () => {
		await db
			.update(outputCalendars)
			.set({ name: 'Renamed Calendar' })
			.where(eq(outputCalendars.id, outputId))
		clearSourceCache()

		await syncOutputCalendar(outputId)
		assert.deepEqual(listTitles(), ['School Work'])
	})

	it('falls back to the calendar name once the list name is cleared', async () => {
		await db
			.update(outputCalendars)
			.set({ tasksListName: null })
			.where(eq(outputCalendars.id, outputId))
		clearSourceCache()

		await syncOutputCalendar(outputId)
		assert.deepEqual(listTitles(), ['Renamed Calendar'])

		const [row] = await db
			.select()
			.from(outputCalendars)
			.where(eq(outputCalendars.id, outputId))
		assert.equal(row?.tasksLastSyncError, null)
		assert.ok(row?.tasksLastSyncAt)
	})

	it('skips a feed-triggered run that follows a recent sync', async () => {
		clearSourceCache()
		const result = await syncOutputCalendar(outputId, {
			respectInterval: true,
		})
		assert.deepEqual(result, {
			ok: false,
			message: 'This calendar synced recently.',
		})
	})

	it('runs a feed-triggered sync once the interval has passed', async () => {
		await db
			.update(outputCalendars)
			.set({ tasksLastSyncAt: new Date(Date.now() - 60 * 60 * 1000) })
			.where(eq(outputCalendars.id, outputId))
		clearSourceCache()

		const result = await syncOutputCalendar(outputId, {
			respectInterval: true,
		})
		assert.deepEqual(result, { ok: true, added: 0, skipped: 1 })
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
			const result = await syncOutputCalendar(outputId)
			assert.equal(result.ok, false)

			const [row] = await db
				.select()
				.from(outputCalendars)
				.where(eq(outputCalendars.id, outputId))
			assert.match(row?.tasksLastSyncError ?? '', /HTTP 500/)
		} finally {
			globalThis.fetch = stashed
		}
	})

	it('refuses to sync a calendar with the toggle off', async () => {
		await db
			.update(outputCalendars)
			.set({ tasksEnabled: false })
			.where(eq(outputCalendars.id, outputId))

		const result = await syncOutputCalendar(outputId)
		assert.deepEqual(result, {
			ok: false,
			message: 'Google Tasks sync is off for this calendar.',
		})
	})
})
