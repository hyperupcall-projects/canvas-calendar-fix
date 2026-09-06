import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { makeSignature } from 'better-auth/crypto'
import { eq } from 'drizzle-orm'
import { app } from './app.tsx'
import { db } from './db/index.ts'
import { session, user } from './db/auth-schema.ts'
import {
	calendars,
	courses,
	outputCalendarCourses,
	outputCalendars,
} from './db/schema.ts'
import { env } from './env.ts'

describe('http routes', () => {
	it('redirects anonymous dashboard visits to sign-in', async () => {
		const response = await app.request('/dashboard')
		assert.equal(response.status, 302)
		assert.equal(response.headers.get('location'), '/sign-in')
	})

	it('rejects non-csumb emails', async () => {
		const response = await app.request('/sign-in', {
			method: 'POST',
			body: new URLSearchParams({ email: 'someone@gmail.com' }),
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
		})
		assert.equal(response.status, 400)
		assert.match(await response.text(), /Only @csumb\.edu/)
	})

	it('redirects anonymous admin visits to the admin login', async () => {
		const response = await app.request('/admin')
		assert.equal(response.status, 302)
		assert.equal(response.headers.get('location'), '/admin/login')
	})

	it('rejects a wrong admin password and accepts the configured one', async () => {
		const denied = await app.request('/admin/login', {
			method: 'POST',
			body: new URLSearchParams({ password: 'wrong' }),
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
		})
		assert.equal(denied.status, 401)

		const accepted = await app.request('/admin/login', {
			method: 'POST',
			body: new URLSearchParams({ password: process.env.ADMIN_PASSWORD ?? '' }),
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
		})
		assert.equal(accepted.status, 302)
		assert.equal(accepted.headers.get('location'), '/admin')
		const cookie = accepted.headers.get('set-cookie') ?? ''
		assert.match(cookie, /admin_session=/)
		assert.match(cookie, /HttpOnly/i)

		const page = await app.request('/admin?sort=email&dir=asc', {
			headers: { cookie: cookie.split(';', 1)[0] ?? '' },
		})
		assert.equal(page.status, 200)
		const html = await page.text()
		assert.match(html, /Total users/)
		assert.match(html, /sort=email/)
		assert.doesNotMatch(html, /<script/)
	})

	it('redirects anonymous calendar URL resets to sign-in', async () => {
		const response = await app.request('/dashboard/source/reset', {
			method: 'POST',
		})
		assert.equal(response.status, 302)
		assert.equal(response.headers.get('location'), '/sign-in')
	})

	it('deletes the saved calendar URL and related rows from the database', async () => {
		const now = new Date()
		const userId = crypto.randomUUID()
		const calendarId = crypto.randomUUID()
		const courseId = crypto.randomUUID()
		const outputId = crypto.randomUUID()
		const sessionToken = crypto.randomUUID()
		const email = `reset-${userId}@csumb.edu`

		try {
			await db.insert(user).values({
				id: userId,
				name: 'reset-test',
				email,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			})
			await db.insert(session).values({
				id: crypto.randomUUID(),
				expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
				token: sessionToken,
				createdAt: now,
				updatedAt: now,
				userId,
			})
			await db.insert(calendars).values({
				id: calendarId,
				userId,
				sourceUrl:
					'https://csumb.instructure.com/feeds/calendars/user_reset.ics',
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
				name: 'Calendar 1',
				publicToken: crypto.randomUUID(),
				position: 1,
				createdAt: now,
			})
			await db.insert(outputCalendarCourses).values({
				outputCalendarId: outputId,
				courseId,
			})

			const signed = `${sessionToken}.${await makeSignature(sessionToken, env.BETTER_AUTH_SECRET)}`
			const cookie = `better-auth.session_token=${encodeURIComponent(signed)}`
			const response = await app.request('/dashboard/source/reset', {
				method: 'POST',
				headers: { cookie },
			})
			assert.equal(response.status, 302)
			assert.equal(response.headers.get('location'), '/dashboard?reset=1')

			assert.equal(
				(await db.select().from(calendars).where(eq(calendars.id, calendarId)))
					.length,
				0,
			)
			assert.equal(
				(
					await db
						.select()
						.from(courses)
						.where(eq(courses.calendarId, calendarId))
				).length,
				0,
			)
			assert.equal(
				(
					await db
						.select()
						.from(outputCalendars)
						.where(eq(outputCalendars.calendarId, calendarId))
				).length,
				0,
			)

			const page = await app.request('/dashboard?reset=1', {
				headers: { cookie },
			})
			assert.equal(page.status, 200)
			const html = await page.text()
			assert.match(html, /Calendar URL removed/)
			assert.doesNotMatch(html, /user_reset\.ics/)
			assert.doesNotMatch(html, /Reset calendar URL/)
		} finally {
			await db.delete(user).where(eq(user.id, userId))
		}
	})

	it('returns 404 for an unknown calendar token', async () => {
		const response = await app.request('/feed/not-a-real-token.ics')
		assert.equal(response.status, 404)
	})

	it('adds a second output calendar and saves a class that is not last', async () => {
		const now = new Date()
		const userId = crypto.randomUUID()
		const calendarId = crypto.randomUUID()
		const courseA = crypto.randomUUID()
		const courseB = crypto.randomUUID()
		const outputId = crypto.randomUUID()
		const sessionToken = crypto.randomUUID()
		const email = `add-${userId}@csumb.edu`

		try {
			await db.insert(user).values({
				id: userId,
				name: 'add-test',
				email,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			})
			await db.insert(session).values({
				id: crypto.randomUUID(),
				expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
				token: sessionToken,
				createdAt: now,
				updatedAt: now,
				userId,
			})
			await db.insert(calendars).values({
				id: calendarId,
				userId,
				sourceUrl:
					'https://csumb.instructure.com/feeds/calendars/user_add.ics',
				createdAt: now,
				updatedAt: now,
			})
			await db.insert(courses).values([
				{ id: courseA, calendarId, code: 'CST463-01_2264' },
				{ id: courseB, calendarId, code: 'JAPN350-02_2264' },
			])
			await db.insert(outputCalendars).values({
				id: outputId,
				calendarId,
				name: 'Classes',
				publicToken: crypto.randomUUID(),
				position: 1,
				createdAt: now,
			})
			await db.insert(outputCalendarCourses).values({
				outputCalendarId: outputId,
				courseId: courseB,
			})

			const signed = `${sessionToken}.${await makeSignature(sessionToken, env.BETTER_AUTH_SECRET)}`
			const cookie = `better-auth.session_token=${encodeURIComponent(signed)}`
			const created = await app.request('/dashboard/outputs', {
				method: 'POST',
				headers: { cookie },
			})
			assert.equal(created.status, 302)
			assert.equal(created.headers.get('location'), '/dashboard?saved=1')

			const outputs = await db
				.select()
				.from(outputCalendars)
				.where(eq(outputCalendars.calendarId, calendarId))
			assert.equal(outputs.length, 2)
			const second = outputs.find((row) => row.position === 2)
			assert.ok(second)
			const memberships = await db
				.select()
				.from(outputCalendarCourses)
				.where(eq(outputCalendarCourses.outputCalendarId, second.id))
			assert.equal(memberships.length, 2)

			const saved = await app.request(`/dashboard/outputs/${second.id}`, {
				method: 'POST',
				headers: {
					cookie,
					'content-type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams([
					['name', 'TA'],
					['code', 'CST463-01_2264'],
					['code', 'JAPN350-02_2264'],
					['enabled', 'CST463-01_2264'],
				]),
			})
			assert.equal(saved.status, 302)

			const page = await app.request('/dashboard', { headers: { cookie } })
			assert.equal(page.status, 200)
			const html = await page.text()
			assert.match(html, />TA</)
			assert.match(html, /checked=""/)
			const taBlock = html.slice(html.indexOf('>TA<'))
			assert.match(taBlock, /value="CST463-01_2264" checked=""/)
			assert.doesNotMatch(
				taBlock.slice(0, taBlock.indexOf('Save calendar')),
				/value="JAPN350-02_2264" checked=""/,
			)

			const firstMemberships = await db
				.select()
				.from(outputCalendarCourses)
				.where(eq(outputCalendarCourses.outputCalendarId, outputId))
			assert.equal(firstMemberships.length, 1)
			assert.equal(firstMemberships[0]?.courseId, courseB)
		} finally {
			await db.delete(user).where(eq(user.id, userId))
		}
	})
})
