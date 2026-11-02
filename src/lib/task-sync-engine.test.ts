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
const { syncGoogleTasks } = await import('./task-sync.ts')

const SOURCE =
	'https://csumb.instructure.com/feeds/calendars/user_sync_test.ics'

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
// It is added now, kept by a later automatic sync once it ages, and cleared by
// Save & Sync.
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
	status?: string
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
				return new Response(
					JSON.stringify({ items: [...list.tasks.values()] }),
					{
						status: 200,
					},
				)
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

/** The sync the Save & Sync button runs. */
function saveAndSync(id: string, syncNow: Date) {
	return syncGoogleTasks(userId, id, {
		enforceSkipThreshold: true,
		now: syncNow,
	})
}

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
		outputCalendarId: outputId,
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
		const result = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
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
		const result = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
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

		const result = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
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

		const result = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
		assert.deepEqual(result, {
			ok: true,
			added: 0,
			updated: 0,
			removed: 0,
			skipped: 2,
		})
		assert.deepEqual(taskTitles(), ['Homework 3 [CST463-01_2264]'])

		const row = await settingsRow()
		assert.deepEqual(JSON.parse(row?.taskStatuses ?? ''), {
			'event-lecture': 'deleted',
		})
	})

	it('still keeps it deleted on the next run', async () => {
		clearSourceCache()
		const result = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
		assert.deepEqual(result, {
			ok: true,
			added: 0,
			updated: 0,
			removed: 0,
			skipped: 2,
		})
		assert.deepEqual(taskTitles(), ['Homework 3 [CST463-01_2264]'])
	})

	it('keeps a user-deleted task deleted through Save & Sync', async () => {
		clearSourceCache()
		const result = await saveAndSync(outputId, TEST_NOW)
		assert.deepEqual(result, {
			ok: true,
			added: 0,
			updated: 0,
			removed: 0,
			skipped: 2,
		})
		assert.deepEqual(taskTitles(), ['Homework 3 [CST463-01_2264]'])
	})

	it('removes a task once its event leaves the feed', async () => {
		feed = calendarFeed([homework3Moved])
		// The lecture came back so that it can leave again.
		await db
			.update(googleTasksSettings)
			.set({ taskStatuses: '{}' })
			.where(eq(googleTasksSettings.userId, userId))
		for (const task of storedTasks()) {
			delete task.deleted
		}
		clearSourceCache()

		const result = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
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
			const result = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
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

		const result = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
		assert.deepEqual(result, {
			ok: false,
			message: 'Google Tasks sync is off.',
		})
	})

	it('skips new tasks older than the one-day cutoff but adds recent ones', async () => {
		await db
			.update(googleTasksSettings)
			.set({ enabled: true, skipOlderThanDays: 1 })
			.where(eq(googleTasksSettings.userId, userId))
		feed = calendarFeed([homework3Moved, recentOld, justDue])
		clearSourceCache()

		const result = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
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

	it('keeps an existing old task during an automatic sync', async () => {
		clearSourceCache()
		const result = await syncGoogleTasks(userId, outputId, {
			now: TWO_DAYS_LATER,
		})
		assert.deepEqual(result, {
			ok: true,
			added: 0,
			updated: 0,
			removed: 0,
			skipped: 3,
		})
		assert.equal(taskFor('event-just-due')?.deleted, undefined)
	})

	it('deletes tasks past the threshold on Save & Sync', async () => {
		clearSourceCache()
		const result = await saveAndSync(outputId, TWO_DAYS_LATER)
		assert.deepEqual(result, {
			ok: true,
			added: 0,
			updated: 0,
			removed: 1,
			skipped: 2,
		})
		assert.equal(taskFor('event-just-due')?.deleted, true)
		assert.equal(taskFor('event-recent-old'), undefined)
		// A removal by the sync is not a deletion by the user.
		clearSourceCache()
		await saveAndSync(outputId, TWO_DAYS_LATER)
		const row = await settingsRow()
		assert.deepEqual(JSON.parse(row?.taskStatuses ?? ''), {})
	})

	it('honours a larger skip threshold when adding tasks', async () => {
		await db
			.update(googleTasksSettings)
			.set({ skipOlderThanDays: 3 })
			.where(eq(googleTasksSettings.userId, userId))
		feed = calendarFeed([homework3Moved, recentOld])
		clearSourceCache()

		const result = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
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

describe('output calendar isolation', () => {
	it('keeps filters, due dates, saves and sync intervals independent in a shared list', async () => {
		const otherId = crypto.randomUUID()
		await db
			.insert(outputCalendars)
			.values({
				id: otherId,
				calendarId,
				name: 'Other',
				publicToken: crypto.randomUUID(),
				position: 2,
				createdAt: now,
			})
		const primary = await settingsRow()
		assert.ok(primary?.listId)
		await db
			.update(googleTasksSettings)
			.set({ enabled: true, dueOffsetDays: 7 })
			.where(eq(googleTasksSettings.outputCalendarId, outputId))
		await db
			.insert(googleTasksSettings)
			.values({
				outputCalendarId: otherId,
				userId,
				enabled: true,
				listName: primary.listName,
				listId: primary.listId,
				dueOffsetDays: 2,
			})
		feed = calendarFeed([homework3Moved])
		clearSourceCache()
		try {
			// No courses selected in the other output: it must not mirror the first.
			const empty = await syncGoogleTasks(userId, otherId, { now: TEST_NOW })
			assert.ok(empty.ok && empty.added === 0)
			await db
				.insert(outputCalendarCourses)
				.values({ outputCalendarId: otherId, courseId })
			await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
			await syncGoogleTasks(userId, otherId, { now: TEST_NOW })
			const owned = (id: string) =>
				storedTasks().filter(
					(task) =>
						!task.deleted && task.notes?.includes(`[canvas-output:${id}]`),
				)
			assert.equal(owned(outputId).length, 1)
			assert.equal(owned(otherId).length, 1)
			assert.notEqual(owned(outputId)[0].due, owned(otherId)[0].due)
			const primaryTasks = structuredClone(owned(outputId))
			owned(otherId)[0].deleted = true
			await saveAndSync(otherId, TEST_NOW)
			assert.deepEqual(owned(outputId), primaryTasks)
			// A deletion in one calendar stays that calendar's.
			assert.equal(owned(otherId).length, 0)
			await db
				.delete(outputCalendarCourses)
				.where(eq(outputCalendarCourses.outputCalendarId, otherId))
			await saveAndSync(otherId, TEST_NOW)
			assert.equal(owned(otherId).length, 0)
			assert.deepEqual(owned(outputId), primaryTasks)
			await db
				.update(googleTasksSettings)
				.set({ lastSyncAt: null, enabled: false })
				.where(eq(googleTasksSettings.outputCalendarId, outputId))
			const off = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
			assert.deepEqual(off, { ok: false, message: 'Google Tasks sync is off.' })
			const recent = await syncGoogleTasks(userId, otherId, {
				now: TEST_NOW,
				respectInterval: true,
			})
			assert.deepEqual(recent, {
				ok: false,
				message: 'This calendar synced recently.',
			})
		} finally {
			await db.delete(outputCalendars).where(eq(outputCalendars.id, otherId))
		}
	})
})

function manyEvents(count: number, start = 0, prefix = 'Assignment'): string[] {
	return Array.from({ length: count }, (_, index) =>
		vevent([
			`UID:parallel-${start + index}`,
			'DTSTART:20260903T065900Z',
			'DTEND:20260903T065900Z',
			`SUMMARY:${prefix} ${start + index} [CST463-01_2264]`,
		]),
	)
}

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

function isTaskWrite(input: unknown, init?: RequestInit): boolean {
	return (
		/\/lists\/[^/]+\/tasks(?:\/[^/?]+)?$/.test(String(input)) &&
		['POST', 'PATCH', 'DELETE'].includes(init?.method ?? 'GET')
	)
}

describe('concurrent task writes', () => {
	it('limits inserts, updates and deletes to ten concurrent requests across multiple batches', async () => {
		await db
			.update(googleTasksSettings)
			.set({ enabled: true, listId: null, taskStatuses: '{}' })
			.where(eq(googleTasksSettings.outputCalendarId, outputId))
		lists.clear()
		feed = calendarFeed(manyEvents(20))
		clearSourceCache()
		const fakeFetch = globalThis.fetch
		let active = 0
		let peak = 0
		const methods: string[] = []
		globalThis.fetch = (async (input, init) => {
			if (!isTaskWrite(input, init)) return fakeFetch(input, init)
			active += 1
			peak = Math.max(peak, active)
			methods.push(init!.method!)
			try {
				await new Promise<void>((resolve) => setImmediate(resolve))
				return await fakeFetch(input, init)
			} finally {
				active -= 1
			}
		}) as typeof fetch
		try {
			const initial = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
			assert.ok(initial.ok && initial.added === 20)
			assert.equal(peak, 10)
			methods.length = 0
			peak = 0
			// Update ten, insert fifteen, and delete the ten absent from this feed.
			feed = calendarFeed([...manyEvents(10, 0, 'Renamed'), ...manyEvents(15, 20)])
			clearSourceCache()
			const result = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
			assert.deepEqual(result, {
				ok: true,
				added: 15,
				updated: 10,
				removed: 10,
				skipped: 0,
			})
			assert.equal(peak, 10)
			assert.equal(active, 0)
			assert.equal(methods.filter((method) => method === 'POST').length, 15)
			// Ten updates, plus a stamp on each of the ten removed tasks.
			assert.equal(methods.filter((method) => method === 'PATCH').length, 20)
			assert.equal(methods.filter((method) => method === 'DELETE').length, 10)
			assert.equal(taskTitles().length, 25)
		} finally {
			globalThis.fetch = fakeFetch
		}
	})

	it('drains a failed batch, keeps the lock, records all errors and reconciles on retry', async () => {
		await db
			.update(googleTasksSettings)
			.set({ listId: null, taskStatuses: '{}', lastSyncAt: TWO_DAYS_LATER })
			.where(eq(googleTasksSettings.outputCalendarId, outputId))
		lists.clear()
		feed = calendarFeed(manyEvents(25))
		clearSourceCache()
		const fakeFetch = globalThis.fetch
		const started = deferred()
		const release = deferred()
		let writes = 0
		let finished = false
		globalThis.fetch = (async (input, init) => {
			if (!isTaskWrite(input, init)) return fakeFetch(input, init)
			writes += 1
			if (writes === 10) started.resolve()
			if (writes === 1) return new Response('server error', { status: 500 })
			if (writes === 2) {
				// Google committed this insert, but its response never reached us.
				await fakeFetch(input, init)
				throw new Error('Network disconnected')
			}
			await release.promise
			return fakeFetch(input, init)
		}) as typeof fetch
		const pending = syncGoogleTasks(userId, outputId, { now: TEST_NOW }).then(
			(result) => {
				finished = true
				return result
			},
		)
		try {
			await started.promise
			// Let both failures propagate while the other eight writes are held.
			await new Promise<void>((resolve) => setImmediate(resolve))
			assert.equal(finished, false)
			const overlapping = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
			assert.deepEqual(overlapping, { ok: false, message: 'A sync is already running.' })
			release.resolve()
			const result = await pending
			assert.equal(result.ok, false)
			if (result.ok) assert.fail('expected failed sync')
			assert.match(result.message, /2 Google Tasks request\(s\) failed/)
			assert.match(result.message, /HTTP 500/)
			assert.match(result.message, /Network disconnected/)
			assert.equal(writes, 10, 'later batches must not start after failure')
			assert.equal(taskTitles().length, 9)
			const row = await settingsRow()
			assert.equal(row?.lastSyncError, result.message)
			assert.equal(row?.lastSyncAt?.getTime(), TWO_DAYS_LATER.getTime())
			globalThis.fetch = fakeFetch
			const retry = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
			assert.deepEqual(retry, { ok: true, added: 16, updated: 0, removed: 0, skipped: 9 })
			assert.equal(taskTitles().length, 25)
			assert.equal((await settingsRow())?.lastSyncError, null)
		} finally {
			release.resolve()
			await pending
			globalThis.fetch = fakeFetch
		}
	})
})

// These run in order; each builds on the state the previous one left behind.
describe('Save & Sync', () => {
	/** Fresh list holding only the two in-threshold tasks at TEST_NOW. */
	async function resetSaveAndSyncState(): Promise<void> {
		await db
			.update(googleTasksSettings)
			.set({
				enabled: true,
				listId: null,
				taskStatuses: '{}',
				dueOffsetDays: 7,
				skipOlderThanDays: 1,
			})
			.where(eq(googleTasksSettings.outputCalendarId, outputId))
		lists.clear()
		feed = calendarFeed([homework3Moved, recentOld, justDue])
		clearSourceCache()
		const seeded = await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
		assert.ok(seeded.ok && seeded.added === 2)
	}

	before(async () => {
		await resetSaveAndSyncState()
		clearSourceCache()
		const removed = await saveAndSync(outputId, TWO_DAYS_LATER)
		assert.ok(removed.ok && removed.removed === 1)
	})

	it('creates a removed task again once the threshold is widened', async () => {
		await db
			.update(googleTasksSettings)
			.set({ skipOlderThanDays: 5 })
			.where(eq(googleTasksSettings.userId, userId))
		clearSourceCache()
		const result = await saveAndSync(outputId, TWO_DAYS_LATER)
		assert.equal(result.ok && result.added, 2)
		const live = storedTasks().filter(
			(task) => task.notes?.includes('[canvas:event-just-due]') && !task.deleted,
		)
		assert.equal(live.length, 1)
		assert.equal(live[0].status, undefined)
	})

	it('restores a completed task as completed after it was removed', async () => {
		const liveTask = (uid: string) =>
			storedTasks().find(
				(task) => task.notes?.includes(`[canvas:${uid}]`) && !task.deleted,
			)
		const done = liveTask('event-just-due')
		assert.ok(done)
		done.status = 'completed'
		await db
			.update(googleTasksSettings)
			.set({ skipOlderThanDays: 1 })
			.where(eq(googleTasksSettings.userId, userId))
		clearSourceCache()
		await saveAndSync(outputId, TWO_DAYS_LATER)
		assert.equal(liveTask('event-just-due'), undefined)
		assert.match((await settingsRow())?.taskStatuses ?? '', /"event-just-due":"completed"/)

		await db
			.update(googleTasksSettings)
			.set({ skipOlderThanDays: 5 })
			.where(eq(googleTasksSettings.userId, userId))
		clearSourceCache()
		await saveAndSync(outputId, TWO_DAYS_LATER)
		assert.equal(liveTask('event-just-due')?.status, 'completed')
	})

	it('keeps a completed task completed when its due date moves', async () => {
		const done = storedTasks().find(
			(task) =>
				task.notes?.includes('[canvas:event-just-due]') && !task.deleted,
		)
		assert.ok(done)
		const before = done.due
		await db
			.update(googleTasksSettings)
			.set({ dueOffsetDays: 3 })
			.where(eq(googleTasksSettings.userId, userId))
		clearSourceCache()
		await saveAndSync(outputId, TWO_DAYS_LATER)
		assert.notEqual(done.due, before)
		assert.equal(done.status, 'completed')
		await db
			.update(googleTasksSettings)
			.set({ dueOffsetDays: 7, skipOlderThanDays: 1 })
			.where(eq(googleTasksSettings.userId, userId))
	})

	it('reopening a completed task clears its status', async () => {
		const done = storedTasks().find(
			(task) =>
				task.notes?.includes('[canvas:event-just-due]') && !task.deleted,
		)
		assert.ok(done)
		done.status = 'needsAction'
		clearSourceCache()
		await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
		assert.doesNotMatch((await settingsRow())?.taskStatuses ?? '', /event-just-due/)
	})

	it('records a deleted status when a completed task is then deleted', async () => {
		const done = storedTasks().find(
			(task) =>
				task.notes?.includes('[canvas:event-just-due]') && !task.deleted,
		)
		assert.ok(done)
		done.status = 'completed'
		clearSourceCache()
		await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
		done.deleted = true
		clearSourceCache()
		await syncGoogleTasks(userId, outputId, { now: TEST_NOW })
		assert.match((await settingsRow())?.taskStatuses ?? '', /"event-just-due":"deleted"/)
	})

	it('keeps a removed task status when a later write in the run fails', async () => {
		await resetSaveAndSyncState()
		const done = taskFor('event-just-due')
		assert.ok(done)
		done.status = 'completed'
		clearSourceCache()
		const fakeFetch = globalThis.fetch
		globalThis.fetch = (async (input, init) => {
			if (init?.method === 'DELETE' || init?.method === 'PATCH') {
				return new Response('{}', { status: 500 })
			}
			return fakeFetch(input, init)
		}) as typeof fetch
		try {
			const result = await saveAndSync(outputId, TWO_DAYS_LATER)
			assert.equal(result.ok, false)
		} finally {
			globalThis.fetch = fakeFetch
		}
		assert.match(
			(await settingsRow())?.taskStatuses ?? '',
			/"event-just-due":"completed"/,
		)
	})
})
