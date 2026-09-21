import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isAdminEmail } from './admin-auth.ts'
import { env } from './env.ts'

describe('admin auth', () => {
	it('matches only the configured admin email', () => {
		assert.equal(isAdminEmail(env.ADMIN_EMAIL), Boolean(env.ADMIN_EMAIL))
		assert.equal(isAdminEmail('not-admin@csumb.edu'), false)
		assert.equal(isAdminEmail(''), false)
	})

	it('compares emails case-insensitively', () => {
		if (!env.ADMIN_EMAIL) {
			return
		}
		assert.equal(isAdminEmail(env.ADMIN_EMAIL.toUpperCase()), true)
	})
})
