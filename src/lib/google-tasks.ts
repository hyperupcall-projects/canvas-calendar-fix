const API_BASE = 'https://tasks.googleapis.com/tasks/v1'
const FETCH_TIMEOUT_MS = 15_000
const MAX_TASKS_PER_PAGE = 100

export type GoogleTask = {
	id: string
	title?: string
	due?: string
	notes?: string
	status?: string
	deleted?: boolean
}

export type GoogleTaskInput = {
	title: string
	due: string
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

async function request(
	accessToken: string,
	path: string,
	init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<unknown> {
	const url = new URL(`${API_BASE}${path}`)
	for (const [key, value] of Object.entries(init.query ?? {})) {
		url.searchParams.set(key, value)
	}

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
	try {
		const response = await fetch(url, {
			method: init.method ?? 'GET',
			signal: controller.signal,
			headers: {
				authorization: `Bearer ${accessToken}`,
				accept: 'application/json',
				...(init.body ? { 'content-type': 'application/json' } : {}),
			},
			body: init.body ? JSON.stringify(init.body) : undefined,
		})

		if (!response.ok) {
			throw new GoogleTasksError(
				response.status,
				`Google Tasks returned HTTP ${response.status}.`,
			)
		}
		if (response.status === 204) {
			return null
		}
		const text = await response.text()
		return text.length > 0 ? JSON.parse(text) : null
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error('Timed out talking to Google Tasks.')
		}
		throw error
	} finally {
		clearTimeout(timer)
	}
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
 * Resolves the task list to sync into, creating it when there is none and
 * renaming it when the user has changed the name on our side. The remote title
 * is the comparison point so the name is not stored twice.
 */
export async function ensureTaskList(
	accessToken: string,
	listId: string | null,
	title: string,
): Promise<{ id: string; created: boolean }> {
	if (!listId) {
		return { id: await createTaskList(accessToken, title), created: true }
	}

	let existing: { id?: string; title?: string } | null
	try {
		existing = (await request(
			accessToken,
			`/users/@me/lists/${encodeURIComponent(listId)}`,
		)) as { id?: string; title?: string } | null
	} catch (error) {
		// The user can delete the list in Google at any time; rebuild it rather
		// than failing the sync forever.
		if (error instanceof GoogleTasksError && error.status === 404) {
			return { id: await createTaskList(accessToken, title), created: true }
		}
		throw error
	}

	if (existing?.title !== title) {
		await request(accessToken, `/users/@me/lists/${encodeURIComponent(listId)}`, {
			method: 'PATCH',
			body: { title },
		})
	}
	return { id: listId, created: false }
}

/**
 * Everything in the list, including the tasks the user completed or deleted.
 * A caller checking whether a task already exists has to see those too, or it
 * would recreate work the user has already dealt with.
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
					maxResults: String(MAX_TASKS_PER_PAGE),
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
