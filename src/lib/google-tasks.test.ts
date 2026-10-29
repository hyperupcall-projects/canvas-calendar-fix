import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
	deleteTask,
	ensureTaskList,
	GoogleTasksError,
	insertTask,
	listTaskLists,
	listTasks,
	patchTask,
} from './google-tasks.ts'

type Call = { method: string; url: string; body: unknown }

const realFetch = globalThis.fetch

function stubFetch(
	handler: (call: Call) => { status?: number; body?: unknown },
): Call[] {
	const calls: Call[] = []
	globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
		const call: Call = {
			method: init?.method ?? 'GET',
			url: String(input),
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
		}
		calls.push(call)
		const { status = 200, body = {} } = handler(call)
		return new Response(body === null ? null : JSON.stringify(body), { status })
	}) as typeof globalThis.fetch
	return calls
}

afterEach(() => {
	globalThis.fetch = realFetch
})

describe('listTaskLists', () => {
	it('follows pagination and keeps the id and title', async () => {
		let page = 0
		const calls = stubFetch(() => {
			page += 1
			return page === 1
				? { body: { items: [{ id: 'a', title: 'Class' }], nextPageToken: 'next' } }
				: { body: { items: [{ id: 'b', title: 'TA' }] } }
		})
		const lists = await listTaskLists('token')
		assert.deepEqual(lists, [
			{ id: 'a', title: 'Class' },
			{ id: 'b', title: 'TA' },
		])
		assert.match(calls[1]?.url ?? '', /pageToken=next/)
	})
})

describe('ensureTaskList', () => {
	it('creates a list when nothing is stored and nothing matches', async () => {
		const calls = stubFetch((call) =>
			call.method === 'GET' ? { body: { items: [] } } : { body: { id: 'list-1' } },
		)
		const result = await ensureTaskList('token', {
			listId: null,
			name: 'Homework',
		})
		assert.deepEqual(result, { id: 'list-1', created: true })
		assert.deepEqual(
			calls.map((call) => call.method),
			['GET', 'POST'],
		)
		assert.deepEqual(calls[1]?.body, { title: 'Homework' })
	})

	it('reuses an existing list that already has the name', async () => {
		const calls = stubFetch(() => ({
			body: { items: [{ id: 'list-9', title: 'Homework' }] },
		}))
		const result = await ensureTaskList('token', {
			listId: null,
			name: 'Homework',
		})
		assert.deepEqual(result, { id: 'list-9', created: false })
		assert.deepEqual(
			calls.map((call) => call.method),
			['GET'],
		)
	})

	it('uses a stored id, renaming only when the name changed', async () => {
		const calls = stubFetch((call) =>
			call.method === 'GET'
				? { body: { id: 'list-1', title: 'Class' } }
				: { body: { id: 'list-1', title: 'Homework' } },
		)
		const result = await ensureTaskList('token', {
			listId: 'list-1',
			name: 'Homework',
		})
		assert.deepEqual(result, { id: 'list-1', created: false })
		assert.deepEqual(
			calls.map((call) => call.method),
			['GET', 'PATCH'],
		)
		assert.deepEqual(calls[1]?.body, { title: 'Homework' })
	})

	it('leaves a stored list alone when the name matches', async () => {
		const calls = stubFetch(() => ({
			body: { id: 'list-1', title: 'Homework' },
		}))
		await ensureTaskList('token', { listId: 'list-1', name: 'Homework' })
		assert.deepEqual(
			calls.map((call) => call.method),
			['GET'],
		)
	})

	it('falls back to a name match once the stored list is gone', async () => {
		const calls = stubFetch((call) =>
			call.url.endsWith('/list-1')
				? { status: 404 }
				: { body: { items: [{ id: 'list-2', title: 'Homework' }] } },
		)
		const result = await ensureTaskList('token', {
			listId: 'list-1',
			name: 'Homework',
		})
		assert.deepEqual(result, { id: 'list-2', created: false })
		assert.deepEqual(
			calls.map((call) => call.method),
			['GET', 'GET'],
		)
	})

	it('rebuilds a stored list that was deleted in Google', async () => {
		const calls = stubFetch((call) => {
			if (call.url.endsWith('/list-1')) {
				return { status: 404 }
			}
			return call.method === 'GET'
				? { body: { items: [] } }
				: { body: { id: 'list-2' } }
		})
		const result = await ensureTaskList('token', {
			listId: 'list-1',
			name: 'Homework',
		})
		assert.deepEqual(result, { id: 'list-2', created: true })
		assert.deepEqual(
			calls.map((call) => call.method),
			['GET', 'GET', 'POST'],
		)
	})
})

describe('listTasks', () => {
	it('follows pagination and asks for completed and deleted tasks too', async () => {
		let page = 0
		const calls = stubFetch(() => {
			page += 1
			return page === 1
				? { body: { items: [{ id: 'a' }], nextPageToken: 'next' } }
				: { body: { items: [{ id: 'b' }] } }
		})
		const tasks = await listTasks('token', 'list-1')
		assert.deepEqual(
			tasks.map((task) => task.id),
			['a', 'b'],
		)
		assert.match(calls[0]?.url ?? '', /showCompleted=true/)
		assert.match(calls[0]?.url ?? '', /showDeleted=true/)
	})
})

describe('task mutations', () => {
	it('inserts a task and returns its id', async () => {
		const calls = stubFetch(() => ({ body: { id: 'task-1' } }))
		const id = await insertTask('token', 'list-1', {
			title: 'Homework 3',
			due: '2026-08-17T00:00:00.000Z',
			notes: 'Deadline: ...',
		})
		assert.equal(id, 'task-1')
		assert.equal(calls[0]?.method, 'POST')
		assert.deepEqual(calls[0]?.body, {
			title: 'Homework 3',
			due: '2026-08-17T00:00:00.000Z',
			notes: 'Deadline: ...',
		})
	})

	it('patches a task to move or rename it', async () => {
		const calls = stubFetch(() => ({ status: 204, body: null }))
		await patchTask('token', 'list-1', 'task-1', {
			title: 'Moved',
			due: '2026-08-24T00:00:00.000Z',
			notes: 'notes',
		})
		assert.equal(calls[0]?.method, 'PATCH')
		assert.match(calls[0]?.url ?? '', /\/lists\/list-1\/tasks\/task-1$/)
	})

	it('deletes a task', async () => {
		const calls = stubFetch(() => ({ status: 204, body: null }))
		await deleteTask('token', 'list-1', 'task-1')
		assert.equal(calls[0]?.method, 'DELETE')
		assert.match(calls[0]?.url ?? '', /\/lists\/list-1\/tasks\/task-1$/)
	})
})

describe('error handling', () => {
	it('logs the full error and response body to the server console', async () => {
		const logged: unknown[][] = []
		const originalConsoleError = console.error
		console.error = (...args: unknown[]) => {
			logged.push(args)
		}
		try {
			stubFetch(() => ({
				status: 400,
				body: { error: { message: 'Request contains an invalid argument.' } },
			}))
			await assert.rejects(() =>
				insertTask('token', 'list-1', { title: 'x', due: 'y' }),
			)
		} finally {
			console.error = originalConsoleError
		}

		const output = logged.flat().map(String).join('\n')
		assert.match(output, /\[google-tasks\] POST .* failed with HTTP 400/)
		assert.match(output, /GoogleTasksError/)
		assert.match(
			output,
			/response body: .*Request contains an invalid argument\./,
		)
	})

	it('raises GoogleTasksError carrying the status', async () => {
		stubFetch(() => ({ status: 403 }))
		await assert.rejects(
			() => insertTask('token', 'list-1', { title: 'x', due: 'y' }),
			(error: unknown) =>
				error instanceof GoogleTasksError && error.status === 403,
		)
	})

	it('includes the response body so a 400 is actionable', async () => {
		stubFetch(() => ({
			status: 400,
			body: { error: { message: 'Request contains an invalid argument.' } },
		}))
		await assert.rejects(
			() => insertTask('token', 'list-1', { title: 'x', due: 'y' }),
			(error: unknown) => {
				assert.ok(error instanceof GoogleTasksError)
				assert.equal(error.status, 400)
				assert.match(error.message, /invalid argument/)
				return true
			},
		)
	})
})
