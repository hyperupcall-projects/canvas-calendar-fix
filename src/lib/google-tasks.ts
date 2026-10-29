const API_BASE = 'https://tasks.googleapis.com/tasks/v1'
const FETCH_TIMEOUT_MS = 15_000
const MAX_RESULTS_PER_PAGE = 100
const LOG_PREFIX = '[google-tasks]'

export type GoogleTask = {
	id: string
	title?: string
	due?: string
	notes?: string
	status?: string
	deleted?: boolean
	hidden?: boolean
	parent?: string
}

export type GoogleTaskList = {
	id: string
	title: string
}

export type GoogleTaskInput = {
	title: string
	due?: string
	notes?: string
}

export class GoogleTasksError extends Error {
	readonly status: number

	constructor(status: number, message: string) {
		super(message)
		this.name = 'GoogleTasksError'
		this.status = status
	}
}

/**
 * Logs a failed call with the full error and response body before it travels up,
 * so the server console has enough detail to diagnose a sync failure without
 * having to reproduce it. The access token lives in a header, so it is never
 * part of the logged URL.
 */
function logFailedRequest(
	method: string,
	url: URL,
	error: unknown,
	response?: { status: number; body: string },
): void {
	const status = response ? ` with HTTP ${response.status}` : ''
	console.error(`${LOG_PREFIX} ${method} ${url.href} failed${status}:`, error)
	if (response?.body) {
		console.error(`${LOG_PREFIX} response body: ${response.body}`)
	}
}

async function request(
	accessToken: string,
	path: string,
	init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<unknown> {
	const method = init.method ?? 'GET'
	const url = new URL(`${API_BASE}${path}`)
	for (const [key, value] of Object.entries(init.query ?? {})) {
		url.searchParams.set(key, value)
	}

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
	try {
		const response = await fetch(url, {
			method,
			signal: controller.signal,
			headers: {
				authorization: `Bearer ${accessToken}`,
				accept: 'application/json',
				...(init.body ? { 'content-type': 'application/json' } : {}),
			},
			body: init.body ? JSON.stringify(init.body) : undefined,
		})

		if (!response.ok) {
			// Google puts the reason in the response body (for example "Request
			// contains an invalid argument."); keep a trimmed copy so a sync failure
			// is actionable instead of just an opaque status code.
			const detail = (await response.text().catch(() => '')).trim()
			const suffix = detail.length > 0 ? `: ${detail.slice(0, 300)}` : '.'
			const error = new GoogleTasksError(
				response.status,
				`Google Tasks returned HTTP ${response.status}${suffix}`,
			)
			logFailedRequest(method, url, error, {
				status: response.status,
				body: detail,
			})
			throw error
		}
		if (response.status === 204) {
			return null
		}
		const text = await response.text()
		return text.length > 0 ? JSON.parse(text) : null
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			console.error(
				`${LOG_PREFIX} ${method} ${url.href} timed out after ${FETCH_TIMEOUT_MS}ms:`,
				error,
			)
			throw new Error('Timed out talking to Google Tasks.')
		}
		// A GoogleTasksError was already logged where it was created; anything
		// else here is a network, DNS or JSON parsing failure.
		if (!(error instanceof GoogleTasksError)) {
			logFailedRequest(method, url, error)
		}
		throw error
	} finally {
		clearTimeout(timer)
	}
}

/** Every task list the account already has, for the picker and name lookup. */
export async function listTaskLists(
	accessToken: string,
): Promise<GoogleTaskList[]> {
	const lists: GoogleTaskList[] = []
	let pageToken: string | undefined
	do {
		const page = (await request(accessToken, '/users/@me/lists', {
			query: {
				maxResults: String(MAX_RESULTS_PER_PAGE),
				...(pageToken ? { pageToken } : {}),
			},
		})) as { items?: GoogleTaskList[]; nextPageToken?: string } | null
		for (const item of page?.items ?? []) {
			if (item.id) {
				lists.push({ id: item.id, title: item.title ?? '' })
			}
		}
		pageToken = page?.nextPageToken
	} while (pageToken)
	return lists
}

async function createTaskList(
	accessToken: string,
	title: string,
): Promise<string> {
	const created = (await request(accessToken, '/users/@me/lists', {
		method: 'POST',
		body: { title },
	})) as { id?: string } | null
	if (!created?.id) {
		throw new Error('Google did not return a task list id.')
	}
	return created.id
}

/**
 * Resolves the task list to sync into. A stored id wins so tasks keep landing in
 * the list the user picked; otherwise the list is matched by title and only
 * created when nothing matches. A stored id that Google no longer has falls back
 * to the title match, so a list deleted in Google is rebuilt rather than being
 * a permanent failure.
 */
export async function ensureTaskList(
	accessToken: string,
	options: { listId: string | null; name: string },
): Promise<{ id: string; created: boolean }> {
	if (options.listId) {
		try {
			const existing = (await request(
				accessToken,
				`/users/@me/lists/${encodeURIComponent(options.listId)}`,
			)) as { id?: string; title?: string } | null
			if (existing?.title !== options.name) {
				await request(
					accessToken,
					`/users/@me/lists/${encodeURIComponent(options.listId)}`,
					{ method: 'PATCH', body: { title: options.name } },
				)
			}
			return { id: options.listId, created: false }
		} catch (error) {
			if (!(error instanceof GoogleTasksError && error.status === 404)) {
				throw error
			}
		}
	}

	const match = (await listTaskLists(accessToken)).find(
		(list) => list.title === options.name,
	)
	if (match) {
		return { id: match.id, created: false }
	}
	return { id: await createTaskList(accessToken, options.name), created: true }
}

/**
 * Everything in the list, including tasks the user completed or deleted, so a
 * caller reconciling against it never resurrects work already dealt with.
 */
export async function listTasks(
	accessToken: string,
	listId: string,
): Promise<GoogleTask[]> {
	const tasks: GoogleTask[] = []
	let pageToken: string | undefined
	do {
		const page = (await request(
			accessToken,
			`/lists/${encodeURIComponent(listId)}/tasks`,
			{
				query: {
					maxResults: String(MAX_RESULTS_PER_PAGE),
					showCompleted: 'true',
					showHidden: 'true',
					showDeleted: 'true',
					...(pageToken ? { pageToken } : {}),
				},
			},
		)) as { items?: GoogleTask[]; nextPageToken?: string } | null
		tasks.push(...(page?.items ?? []))
		pageToken = page?.nextPageToken
	} while (pageToken)
	return tasks
}

export async function insertTask(
	accessToken: string,
	listId: string,
	task: GoogleTaskInput,
): Promise<string> {
	const created = (await request(
		accessToken,
		`/lists/${encodeURIComponent(listId)}/tasks`,
		{ method: 'POST', body: task },
	)) as { id?: string } | null
	if (!created?.id) {
		throw new Error('Google did not return a task id.')
	}
	return created.id
}

/** Used when an assignment is renamed or rescheduled and the task must follow. */
export async function patchTask(
	accessToken: string,
	listId: string,
	taskId: string,
	task: GoogleTaskInput,
): Promise<void> {
	await request(
		accessToken,
		`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
		{ method: 'PATCH', body: task },
	)
}

/** Used when an assignment disappears from the feed. */
export async function deleteTask(
	accessToken: string,
	listId: string,
	taskId: string,
): Promise<void> {
	await request(
		accessToken,
		`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
		{ method: 'DELETE' },
	)
}
