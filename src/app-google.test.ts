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
const { googleTasksSettings } = await import('./db/schema.ts')
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

async function makeUser(name: string): Promise<{ userId: string; cookie: string }> {
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
	const signed = `${sessionToken}.${await makeSignature(sessionToken, env.BETTER_AUTH_SECRET)}`
	return {
		userId,
		cookie: `better-auth.session_token=${encodeURIComponent(signed)}`,
	}
}

function postSettings(cookie: string, body: URLSearchParams) {
	return app.request('/dashboard/google/settings?beta=true', {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
		body,
	})
}

describe('google tasks routes', () => {
	it('allows the Google address to differ from the school address', () => {
		// Without this, the OAuth callback redirects with email_does_not_match.
		assert.equal(
			auth.options.account?.accountLinking?.allowDifferentEmails,
			true,
		)
	})

	it('saves the enable flag, list name and due offset', async () => {
		const { userId, cookie } = await makeUser('gsave')
		try {
			const response = await postSettings(
				cookie,
				new URLSearchParams([
					['enabled', 'on'],
					['listName', 'Homework'],
					['dueOffsetDays', '3'],
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
			assert.equal(row?.listId, null)
		} finally {
			await db.delete(user).where(eq(user.id, userId))
		}
	})

	it('clamps an out-of-range due offset and defaults the toggle to off', async () => {
		const { userId, cookie } = await makeUser('gclamp')
		try {
			await postSettings(
				cookie,
				new URLSearchParams([['dueOffsetDays', '99']]),
			)
			const [row] = await db
				.select()
				.from(googleTasksSettings)
				.where(eq(googleTasksSettings.userId, userId))
			assert.equal(row?.dueOffsetDays, 14)
			assert.equal(row?.enabled, false)
		} finally {
			await db.delete(user).where(eq(user.id, userId))
		}
	})

	it('starts the Google link with the OAuth state cookie attached', async () => {
		const { userId, cookie } = await makeUser('gconnect')
		try {
			const response = await app.request('/dashboard/google/connect?beta=true', {
				method: 'POST',
				headers: { cookie },
			})
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
			assert.match(html, /action="\/dashboard\/google\/settings\?beta=true"/)
		} finally {
			await db.delete(user).where(eq(user.id, userId))
		}
	})

	it('disconnecting Google clears sync state but keeps the list name', async () => {
		const { userId, cookie } = await makeUser('gdisc')
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
