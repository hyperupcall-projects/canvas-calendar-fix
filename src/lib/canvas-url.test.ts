import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertCanvasFeedUrl } from './canvas-url.ts'

describe('assertCanvasFeedUrl', () => {
	it('accepts CSUMB Canvas https feeds', () => {
		const url = assertCanvasFeedUrl(
			'https://csumb.instructure.com/feeds/calendars/user_abc.ics',
		)
		assert.equal(url.hostname, 'csumb.instructure.com')
	})

	it('rejects other hosts and http', () => {
		assert.throws(() =>
			assertCanvasFeedUrl('http://csumb.instructure.com/feed.ics'),
		)
		assert.throws(() => assertCanvasFeedUrl('https://evil.example/feed.ics'))
		assert.throws(() => assertCanvasFeedUrl('not-a-url'))
	})
})
