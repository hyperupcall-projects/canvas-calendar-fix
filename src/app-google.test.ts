import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

// Google is only advertised when credentials exist; env.ts reads these once, so
// they must be set before the app and env modules are pulled in.
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'

const { makeSignature } = await import('better-auth/crypto')
const { eq } = await import('drizzle-orm')
const { app } = await import('./app.tsx')
const { auth } = await import('./auth.ts')
const { db } = await import('./db/index.ts')
const { account, session, user } = await import('./db/auth-schema.ts')
const { googleTasksSettings, calendars, outputCalendars } =
	await import('./db/schema.ts')
const { env } = await import('./env.ts')

const realFetch = globalThis.fetch
const now = new Date()

// The dashboard best-effort fetches the user's task lists for the picker; fail
// fast so the render falls back to no suggestions instead of hitting the network.
before(() => {
	globalThis.fetch = (async () =>
		new Response('{}', { status: 500 })) as typeof globalThis.fetch
})

after(() => {
	globalThis.fetch = realFetch
})

async function makeUser(
	name: string,
): Promise<{ userId: string; outputId: string; cookie: string }> {
	const userId = crypto.randomUUID()
	await db.insert(user).values({
		id: userId,
		name,
		email: `${name}-${userId}@csumb.edu`,
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	})
	const sessionToken = crypto.randomUUID()
	await db.insert(session).values({
		id: crypto.randomUUID(),
		expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
		token: sessionToken,
		createdAt: now,
		updatedAt: now,
		userId,
	})
	const calendarId = crypto.randomUUID()
	const outputId = crypto.randomUUID()
	await db.insert(calendars).values({
		id: calendarId,
		userId,
		sourceUrl: 'https://csumb.instructure.com/feeds/calendars/user_test.ics',
		createdAt: now,
		updatedAt: now,
	})
	await db.insert(outputCalendars).values({
		id: outputId,
		calendarId,
		name: 'Calendar 1',
		publicToken: crypto.randomUUID(),
		position: 1,
		createdAt: now,
	})
	const signed = `${sessionToken}.${await makeSignature(sessionToken, env.BETTER_AUTH_SECRET)}`
	return {
		userId,
		outputId,
		cookie: `better-auth.session_token=${encodeURIComponent(signed)}`,
	}
}

function postSettings(cookie: string, outputId: string, body: URLSearchParams) {
	return app.request(
		`/dashboard/outputs/${outputId}/google/settings?beta=true`,
		{
			method: 'POST',
			headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
			body,
		},
	)
}

describe('google tasks routes', () => {
	it('allows the Google address to differ from the school address', () => {
		// Without this, the OAuth callback redirects with email_does_not_match.
		assert.equal(
			auth.options.account?.accountLinking?.allowDifferentEmails,
			true,
		)
	})

	it('saves the enable flag, list name, due offset and skip threshold', async () => {
		const { userId, outputId, cookie } = await makeUser('gsave')
		try {
			const response = await postSettings(
				cookie,
				outputId,
				new URLSearchParams([
					['enabled', 'on'],
					['listName', 'Homework'],
					['dueOffsetDays', '3'],
					['skipOlderThanDays', '2'],
				]),
			)
			assert.equal(response.status, 302)
			assert.equal(
				response.headers.get('location'),
				'/dashboard?gtasks=1&beta=true',
			)

			const [row] = await db
				.select()
				.from(googleTasksSettings)
				.where(eq(googleTasksSettings.userId, userId))
			assert.equal(row?.enabled, true)
			assert.equal(row?.listName, 'Homework')
			assert.equal(row?.dueOffsetDays, 3)
			assert.equal(row?.skipOlderThanDays, 2)
			assert.equal(row?.listId, null)
		} finally {
			await db.delete(user).where(eq(user.id, userId))
		}
	})

	it('clamps out-of-range settings and defaults the toggle to off', async () => {
		const { userId, outputId, cookie } = await makeUser('gclamp')
		try {
			await postSettings(
				cookie,
				outputId,
				new URLSearchParams([
					['dueOffsetDays', '99'],
					['skipOlderThanDays', '99'],
				]),
			)
			const [row] = await db
				.select()
				.from(googleTasksSettings)
				.where(eq(googleTasksSettings.userId, userId))
			assert.equal(row?.dueOffsetDays, 14)
			assert.equal(row?.skipOlderThanDays, 30)
			assert.equal(row?.enabled, false)
		} finally {
			await db.delete(user).where(eq(user.id, userId))
		}
	})

	it('starts the Google link with the OAuth state cookie attached', async () => {
		const { userId, cookie } = await makeUser('gconnect')
		try {
			const response = await app.request(
				'/dashboard/google/connect?beta=true',
				{
					method: 'POST',
					headers: { cookie },
				},
			)
			assert.equal(response.status, 302)
			assert.match(
				response.headers.get('location') ?? '',
				/^https:\/\/accounts\.google\.com\//,
			)
			// The cookie that carries the OAuth state must reach the browser, or the
			// callback fails with state_mismatch.
			const cookies = response.headers.getSetCookie()
			assert.ok(
				cookies.some((value) => value.includes('state=')),
				`expected a state cookie, got: ${cookies.join(' | ')}`,
			)
		} finally {
			await db.delete(user).where(eq(user.id, userId))
		}
	})

	it('shows the Google section on the dashboard once connected', async () => {
		const { userId, cookie } = await makeUser('gshow')
		try {
			await db.insert(account).values({
				id: crypto.randomUUID(),
				accountId: 'google-subject',
				providerId: 'google',
				userId,
				accessToken: 'token',
				refreshToken: 'refresh',
				createdAt: now,
				updatedAt: now,
			})
			const page = await app.request('/dashboard?beta=true', {
				headers: { cookie },
			})
			assert.equal(page.status, 200)
			const html = await page.text()
			assert.match(html, /Google Tasks/)
			assert.match(
				html,
				/action="\/dashboard\/outputs\/[^/]+\/google\/settings\?beta=true"/,
			)
		} finally {
			await db.delete(user).where(eq(user.id, userId))
		}
	})

	it('disconnecting Google clears sync state but keeps the list name', async () => {
		const { userId, outputId, cookie } = await makeUser('gdisc')
		try {
			await db.insert(account).values({
				id: crypto.randomUUID(),
				accountId: 'google-subject',
				providerId: 'google',
				userId,
				accessToken: 'token',
				refreshToken: 'refresh',
				createdAt: now,
				updatedAt: now,
			})
			await db.insert(googleTasksSettings).values({
				outputCalendarId: outputId,
				userId,
				enabled: true,
				listName: 'Homework',
				listId: 'google-list-1',
				lastSyncAt: now,
				lastSyncError: 'stale failure',
			})

			const response = await app.request(
				'/dashboard/google/disconnect?beta=true',
				{ method: 'POST', headers: { cookie } },
			)
			assert.equal(response.status, 302)
			assert.equal(
				response.headers.get('location'),
				'/dashboard?disconnected=1&beta=true',
			)

			assert.equal(
				(await db.select().from(account).where(eq(account.userId, userId)))
					.length,
				0,
			)
			const [row] = await db
				.select()
				.from(googleTasksSettings)
				.where(eq(googleTasksSettings.userId, userId))
			assert.equal(row?.enabled, false)
			assert.equal(row?.listId, null)
			assert.equal(row?.lastSyncAt, null)
			assert.equal(row?.lastSyncError, null)
			// Kept so reconnecting restores the user's naming.
			assert.equal(row?.listName, 'Homework')
		} finally {
			await db.delete(user).where(eq(user.id, userId))
		}
	})
})

describe('per-output Google Tasks access', () => {
	it('saves independent settings, preserves disabled options, and rejects another user’s output', async () => {
		const first = await makeUser('first-output')
		const stranger = await makeUser('other-owner')
		try {
			const [source] = await db
				.select()
				.from(calendars)
				.where(eq(calendars.userId, first.userId))
			const secondId = crypto.randomUUID()
			await db
				.insert(outputCalendars)
				.values({
					id: secondId,
					calendarId: source.id,
					name: 'TA',
					publicToken: crypto.randomUUID(),
					position: 2,
					createdAt: now,
				})
			await postSettings(
				first.cookie,
				first.outputId,
				new URLSearchParams({
					enabled: 'on',
					listName: 'Class',
					dueOffsetDays: '3',
					skipOlderThanDays: '4',
				}),
			)
			await postSettings(
				first.cookie,
				secondId,
				new URLSearchParams({
					enabled: 'on',
					listName: 'TA',
					dueOffsetDays: '9',
				}),
			)
			await postSettings(first.cookie, first.outputId, new URLSearchParams())
			const rows = await db
				.select()
				.from(googleTasksSettings)
				.where(eq(googleTasksSettings.userId, first.userId))
			const primary = rows.find(
				(row) => row.outputCalendarId === first.outputId,
			)
			const second = rows.find((row) => row.outputCalendarId === secondId)
			assert.equal(primary?.enabled, false)
			assert.equal(primary?.listName, 'Class')
			assert.equal(primary?.dueOffsetDays, 3)
			assert.equal(primary?.skipOlderThanDays, 4)
			assert.equal(second?.enabled, true)
			assert.equal(second?.dueOffsetDays, 9)
			for (const action of ['settings', 'sync', 'refresh']) {
				const response = await app.request(
					`/dashboard/outputs/${secondId}/google/${action}?beta=true`,
					{ method: 'POST', headers: { cookie: stranger.cookie } },
				)
				assert.match(response.headers.get('location') ?? '', /not%20found/)
			}
			assert.deepEqual(
				await db
					.select()
					.from(googleTasksSettings)
					.where(eq(googleTasksSettings.userId, first.userId)),
				rows,
			)
		} finally {
			await db.delete(user).where(eq(user.id, first.userId))
			await db.delete(user).where(eq(user.id, stranger.userId))
		}
	})
})
