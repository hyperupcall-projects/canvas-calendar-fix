import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Hono } from 'hono'
import { getAdminSession, verifyAdminPassword } from './admin-auth.ts'

describe('admin auth', () => {
	it('accepts the configured admin password', () => {
		assert.equal(verifyAdminPassword('Xv9#kL2mQp8!nR4wT6hB'), true)
		assert.equal(verifyAdminPassword('wrong-password'), false)
	})

	it('round-trips an encrypted admin session cookie', async () => {
		const app = new Hono()
		app.get('/set', async (c) => {
			const session = await getAdminSession(c)
			session.admin = true
			await session.save()
			return c.text('ok')
		})
		app.get('/check', async (c) => {
			const session = await getAdminSession(c)
			return c.json({ admin: session.admin === true })
		})
		app.post('/clear', async (c) => {
			const session = await getAdminSession(c)
			session.destroy()
			return c.text('ok')
		})

		const set = await app.request('/set')
		const cookie = set.headers.get('set-cookie') ?? ''
		assert.match(cookie, /admin_session=/)
		assert.match(cookie, /HttpOnly/i)

		const check = await app.request('/check', {
			headers: { cookie: cookie.split(';', 1)[0] ?? '' },
		})
		assert.deepEqual(await check.json(), { admin: true })

		const denied = await app.request('/check', {
			headers: { cookie: 'admin_session=nope' },
		})
		assert.deepEqual(await denied.json(), { admin: false })

		const cleared = await app.request('/clear', {
			headers: { cookie: cookie.split(';', 1)[0] ?? '' },
		})
		const clearedCookie = cleared.headers.get('set-cookie') ?? ''
		const afterLogout = await app.request('/check', {
			headers: { cookie: clearedCookie.split(';', 1)[0] ?? '' },
		})
		assert.deepEqual(await afterLogout.json(), { admin: false })
	})
})
