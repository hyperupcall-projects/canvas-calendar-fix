import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
	ensureTaskList,
	GoogleTasksError,
	insertTask,
	listTasks,
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
		return new Response(body === null ? '' : JSON.stringify(body), { status })
	}) as typeof globalThis.fetch
	return calls
}

afterEach(() => {
	globalThis.fetch = realFetch
})

describe('ensureTaskList', () => {
	it('creates a list when none is stored yet', async () => {
		const calls = stubFetch(() => ({ body: { id: 'list-1' } }))
		const result = await ensureTaskList('token', null, 'Homework')
		assert.deepEqual(result, { id: 'list-1', created: true })
		assert.equal(calls.length, 1)
		assert.equal(calls[0]?.method, 'POST')
		assert.match(calls[0]?.url ?? '', /\/users\/@me\/lists$/)
		assert.deepEqual(calls[0]?.body, { title: 'Homework' })
	})

	it('renames the list when the stored name no longer matches', async () => {
		const calls = stubFetch((call) =>
			call.method === 'GET'
				? { body: { id: 'list-1', title: 'Class' } }
				: { body: { id: 'list-1', title: 'Homework' } },
		)
		const result = await ensureTaskList('token', 'list-1', 'Homework')
		assert.deepEqual(result, { id: 'list-1', created: false })
		assert.deepEqual(
			calls.map((call) => call.method),
			['GET', 'PATCH'],
		)
		assert.deepEqual(calls[1]?.body, { title: 'Homework' })
	})

	it('leaves the list alone when the name already matches', async () => {
		const calls = stubFetch(() => ({ body: { id: 'list-1', title: 'Homework' } }))
		await ensureTaskList('token', 'list-1', 'Homework')
		assert.deepEqual(
			calls.map((call) => call.method),
			['GET'],
		)
	})

	it('rebuilds a list the user deleted inside Google', async () => {
		const calls = stubFetch((call) =>
			call.method === 'GET' ? { status: 404 } : { body: { id: 'list-2' } },
		)
		const result = await ensureTaskList('token', 'stale-list', 'Homework')
		assert.deepEqual(result, { id: 'list-2', created: true })
		assert.deepEqual(
			calls.map((call) => call.method),
			['GET', 'POST'],
		)
	})
})

describe('listTasks', () => {
	it('follows pagination until the last page', async () => {
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
		assert.match(calls[1]?.url ?? '', /pageToken=next/)
	})

	it('includes completed and deleted tasks so they are not resurrected', async () => {
		const calls = stubFetch(() => ({ body: { items: [] } }))
		await listTasks('token', 'list-1')
		assert.match(calls[0]?.url ?? '', /showCompleted=true/)
		assert.match(calls[0]?.url ?? '', /showHidden=true/)
		assert.match(calls[0]?.url ?? '', /showDeleted=true/)
	})
})

describe('error handling', () => {
	it('raises GoogleTasksError carrying the status', async () => {
		stubFetch(() => ({ status: 403 }))
		await assert.rejects(
			() => insertTask('token', 'list-1', { title: 'x', due: 'y' }),
			(error: unknown) =>
				error instanceof GoogleTasksError && error.status === 403,
		)
	})
})
