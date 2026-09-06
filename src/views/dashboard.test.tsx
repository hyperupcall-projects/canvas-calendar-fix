import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DashboardPage } from './dashboard.tsx'

describe('DashboardPage', () => {
	it('renders the Canvas URL, class toggles, and private feed links', async () => {
		const node = (
			<DashboardPage
				email="test@csumb.edu"
				sourceUrl="https://csumb.instructure.com/feeds/calendars/user_x.ics"
				courses={[{ code: 'CST463-01_2264' }, { code: 'CST334-01_2264' }]}
				outputs={[
					{
						id: 'out-1',
						name: 'Calendar 1',
						feedUrl: 'http://localhost:3000/feed/secret-token.ics',
						enabledCodes: ['CST463-01_2264'],
					},
					{
						id: 'out-2',
						name: 'Labs only',
						feedUrl: 'http://localhost:3000/feed/other-token.ics',
						enabledCodes: ['CST334-01_2264'],
					},
				]}
			/>
		)
		const html = await Promise.resolve(String(node))
		assert.match(html, /test@csumb\.edu/)
		assert.match(html, /csumb\.instructure\.com\/feeds\/calendars\/user_x\.ics/)
		assert.match(html, /CST463-01_2264/)
		assert.match(html, /CST334-01_2264/)
		assert.match(html, /Calendar 1/)
		assert.match(html, /Labs only/)
		assert.match(html, /secret-token\.ics/)
		assert.match(html, /other-token\.ics/)
		assert.match(html, /action="\/dashboard\/source"/)
		assert.match(html, /formaction="\/dashboard\/source\/reset"/)
		assert.match(html, /Reset calendar URL/)
		assert.match(html, /class="output-calendar"/)
		assert.match(html, /action="\/dashboard\/outputs\/out-1"/)
		assert.match(html, /action="\/dashboard\/outputs\/out-2"/)
		assert.match(html, /action="\/dashboard\/outputs\/out-1\/delete"/)
		assert.match(html, /action="\/dashboard\/outputs"/)
		assert.match(html, /Add another calendar/)
		assert.match(html, /checked=""/)
		assert.doesNotMatch(html, /<script/)
		const labsIndex = html.indexOf('Labs only')
		const firstRemove = html.indexOf('action="/dashboard/outputs/out-1/delete"')
		const secondStart = html.indexOf('action="/dashboard/outputs/out-2"')
		assert.ok(firstRemove > -1 && labsIndex > -1 && secondStart > firstRemove)
		assert.ok(firstRemove < secondStart)
	})

	it('lets you add a second calendar but not remove the last one', async () => {
		const node = (
			<DashboardPage
				email="test@csumb.edu"
				sourceUrl="https://csumb.instructure.com/feeds/calendars/user_x.ics"
				courses={[{ code: 'CST463-01_2264' }]}
				outputs={[
					{
						id: 'out-1',
						name: 'Calendar 1',
						feedUrl: 'http://localhost:3000/feed/secret-token.ics',
						enabledCodes: ['CST463-01_2264'],
					},
				]}
			/>
		)
		const html = await Promise.resolve(String(node))
		assert.match(html, /action="\/dashboard\/outputs"/)
		assert.match(html, /Add another calendar/)
		assert.doesNotMatch(html, /\/delete/)
		assert.doesNotMatch(html, /Remove calendar/)
	})

	it('hides add when four calendars already exist', async () => {
		const outputs = [1, 2, 3, 4].map((n) => ({
			id: `out-${n}`,
			name: `Calendar ${n}`,
			feedUrl: `http://localhost:3000/feed/token-${n}.ics`,
			enabledCodes: [] as string[],
		}))
		const node = (
			<DashboardPage
				email="test@csumb.edu"
				sourceUrl="https://csumb.instructure.com/feeds/calendars/user_x.ics"
				courses={[{ code: 'CST463-01_2264' }]}
				outputs={outputs}
			/>
		)
		const html = await Promise.resolve(String(node))
		assert.doesNotMatch(html, /Add another calendar/)
		assert.match(html, /Remove calendar/)
		assert.match(html, /No classes selected/)
	})

	it('hides reset until a Canvas calendar URL is saved', async () => {
		const node = (
			<DashboardPage
				email="test@csumb.edu"
				sourceUrl=""
				courses={[]}
				outputs={[]}
			/>
		)
		const html = await Promise.resolve(String(node))
		assert.match(html, /action="\/dashboard\/source"/)
		assert.doesNotMatch(html, /formaction="\/dashboard\/source\/reset"/)
		assert.doesNotMatch(html, /Reset calendar URL/)
	})
})
