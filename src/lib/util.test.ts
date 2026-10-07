import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	isSupportedSchoolEmail,
	SUPPORT_REQUEST_URL,
	unsupportedEmailMessage,
} from './util.ts'

describe('isSupportedSchoolEmail', () => {
	it('accepts supported Pacific time zone schools', () => {
		assert.equal(isSupportedSchoolEmail('student@csumb.edu'), true)
		assert.equal(isSupportedSchoolEmail('student@ucla.edu'), true)
		assert.equal(isSupportedSchoolEmail('student@uw.edu'), true)
		assert.equal(isSupportedSchoolEmail('STUDENT@Berkeley.edu'), true)
	})

	it('rejects unsupported schools and non-school addresses', () => {
		assert.equal(isSupportedSchoolEmail('student@harvard.edu'), false)
		assert.equal(isSupportedSchoolEmail('someone@gmail.com'), false)
		assert.equal(isSupportedSchoolEmail(''), false)
		assert.equal(isSupportedSchoolEmail('not-an-email'), false)
	})

	it('does not match lookalike domains', () => {
		assert.equal(isSupportedSchoolEmail('student@xcsumb.edu'), false)
		assert.equal(isSupportedSchoolEmail('student@csumb.edu.evil.com'), false)
	})
})

describe('unsupportedEmailMessage', () => {
	it('sends .edu addresses to the support group', () => {
		const message = unsupportedEmailMessage('student@harvard.edu')
		assert.match(message, /don't support your school yet/)
		assert.match(message, /request that your school be added/)
		assert.equal(message.includes(SUPPORT_REQUEST_URL), true)
	})

	it('tells other addresses to use a school account', () => {
		assert.equal(
			unsupportedEmailMessage('someone@gmail.com'),
			'You must sign in with your school account.',
		)
	})
})
