import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DashboardPage, type DashboardOutput } from './dashboard.tsx'

function makeOutput(
	overrides: Partial<DashboardOutput> &
		Pick<DashboardOutput, 'id' | 'name' | 'feedUrl'>,
): DashboardOutput {
	return {
		enabledCodes: [],
		addCanvasLink: true,
		tasksEnabled: false,
		tasksListName: null,
		tasksLastSyncAt: null,
		tasksLastSyncError: null,
		...overrides,
	}
}

describe('DashboardPage', () => {
	it('renders the Canvas URL, class toggles, and private feed links', async () => {
		const node = (
			<DashboardPage
				email="test@csumb.edu"
				sourceUrl="https://csumb.instructure.com/feeds/calendars/user_x.ics"
				courses={[{ code: 'CST463-01_2264' }, { code: 'CST334-01_2264' }]}
				outputs={[
					makeOutput({
						id: 'out-1',
						name: 'Calendar 1',
						feedUrl: 'http://localhost:3000/feed/secret-token.ics',
						enabledCodes: ['CST463-01_2264'],
					}),
					makeOutput({
						id: 'out-2',
						name: 'Labs only',
						feedUrl: 'http://localhost:3000/feed/other-token.ics',
						enabledCodes: ['CST334-01_2264'],
						addCanvasLink: false,
					}),
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
		assert.match(html, /navigator\.clipboard\.writeText/)
		assert.match(html, />\s*Copy\s*</)
		assert.match(html, /action="\/dashboard\/source"/)
		assert.match(html, /formaction="\/dashboard\/source\/reset"/)
		assert.match(html, /Remove calendar URL/)
		assert.match(html, /class="output-calendar"/)
		assert.match(html, /action="\/dashboard\/outputs\/out-1"/)
		assert.match(html, /action="\/dashboard\/outputs\/out-2"/)
		assert.match(html, /action="\/dashboard\/outputs\/out-1\/delete"/)
		assert.match(html, /action="\/dashboard\/outputs"/)
		assert.match(html, /Add another calendar/)
		assert.match(html, /checked=""/)
		assert.match(
			html,
			/Modify event description to add Canvas link\s*\(recommended\)/,
		)
		assert.doesNotMatch(html, /<script/)
		const labsIndex = html.indexOf('Labs only')
		const firstRemove = html.indexOf('action="/dashboard/outputs/out-1/delete"')
		const secondStart = html.indexOf('action="/dashboard/outputs/out-2"')
		assert.ok(firstRemove > -1 && labsIndex > -1 && secondStart > firstRemove)
		assert.ok(firstRemove < secondStart)
		assert.match(html.slice(0, secondStart), /name="canvasLink" checked=""/)
		assert.match(html.slice(secondStart), /name="canvasLink"/)
		assert.doesNotMatch(
			html.slice(secondStart),
			/name="canvasLink" checked=""/,
		)
	})

	it('lets you add a second calendar but not remove the last one', async () => {
		const node = (
			<DashboardPage
				email="test@csumb.edu"
				sourceUrl="https://csumb.instructure.com/feeds/calendars/user_x.ics"
				courses={[{ code: 'CST463-01_2264' }]}
				outputs={[
					makeOutput({
						id: 'out-1',
						name: 'Calendar 1',
						feedUrl: 'http://localhost:3000/feed/secret-token.ics',
						enabledCodes: ['CST463-01_2264'],
					}),
				]}
			/>
		)
		const html = await Promise.resolve(String(node))
		assert.match(html, /action="\/dashboard\/outputs"/)
		assert.match(html, /Add another calendar/)
		assert.doesNotMatch(html, /\/delete/)
		// The source form still offers "Remove calendar URL"; only the
		// per-calendar delete button should be gone.
		assert.doesNotMatch(html, />Remove calendar</)
	})

	it('hides add when four calendars already exist', async () => {
		const outputs = [1, 2, 3, 4].map((n) =>
			makeOutput({
				id: `out-${n}`,
				name: `Calendar ${n}`,
				feedUrl: `http://localhost:3000/feed/token-${n}.ics`,
			}),
		)
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
		assert.doesNotMatch(html, /Remove calendar URL/)
	})

	it('hides Google Tasks entirely when it is not configured', async () => {
		const node = (
			<DashboardPage
				email="test@csumb.edu"
				sourceUrl="https://csumb.instructure.com/feeds/calendars/user_x.ics"
				courses={[{ code: 'CST463-01_2264' }]}
				outputs={[
					makeOutput({
						id: 'out-1',
						name: 'Calendar 1',
						feedUrl: 'http://localhost:3000/feed/secret-token.ics',
					}),
				]}
			/>
		)
		const html = await Promise.resolve(String(node))
		assert.doesNotMatch(html, /Google Tasks/)
		assert.doesNotMatch(html, /tasksListName/)
		assert.doesNotMatch(html, /Sync now/)
	})

	it('hides Google Tasks unless the dashboard is opened with beta=true', async () => {
		const node = (
			<DashboardPage
				email="test@csumb.edu"
				sourceUrl="https://csumb.instructure.com/feeds/calendars/user_x.ics"
				courses={[{ code: 'CST463-01_2264' }]}
				outputs={[
					makeOutput({
						id: 'out-1',
						name: 'Calendar 1',
						feedUrl: 'http://localhost:3000/feed/secret-token.ics',
					}),
				]}
				googleConfigured
				googleConnected
			/>
		)
		const html = await Promise.resolve(String(node))
		assert.doesNotMatch(html, /Google Tasks/)
		assert.doesNotMatch(html, /tasksListName/)
		assert.doesNotMatch(html, /Sync now/)
		assert.doesNotMatch(html, /beta=true/)
	})

	it('offers to connect Google and keeps the per-calendar toggle disabled', async () => {
		const node = (
			<DashboardPage
				email="test@csumb.edu"
				sourceUrl="https://csumb.instructure.com/feeds/calendars/user_x.ics"
				courses={[{ code: 'CST463-01_2264' }]}
				outputs={[
					makeOutput({
						id: 'out-1',
						name: 'Calendar 1',
						feedUrl: 'http://localhost:3000/feed/secret-token.ics',
					}),
				]}
				googleConfigured
				beta
			/>
		)
		const html = await Promise.resolve(String(node))
		assert.match(html, /action="\/dashboard\/google\/connect\?beta=true"/)
		assert.doesNotMatch(html, /action="\/dashboard\/google\/disconnect/)
		assert.match(html, /name="tasksEnabled"[^>]*disabled=""/)
		assert.match(html, /Sync now/)
		const syncButton = html.slice(
			html.indexOf('formaction="/dashboard/outputs/out-1/sync?beta=true"'),
		)
		assert.match(syncButton.slice(0, syncButton.indexOf('>')), /disabled=""/)
	})

	it('shows a task list name distinct from the calendar name and enables Sync now', async () => {
		const node = (
			<DashboardPage
				email="test@csumb.edu"
				sourceUrl="https://csumb.instructure.com/feeds/calendars/user_x.ics"
				courses={[{ code: 'CST463-01_2264' }]}
				outputs={[
					makeOutput({
						id: 'out-1',
						name: 'Class',
						feedUrl: 'http://localhost:3000/feed/secret-token.ics',
						enabledCodes: ['CST463-01_2264'],
						tasksEnabled: true,
						tasksListName: 'Homework',
						tasksLastSyncAt: new Date('2026-09-07T19:30:00.000Z'),
					}),
				]}
				googleConfigured
				googleConnected
				beta
			/>
		)
		const html = await Promise.resolve(String(node))
		assert.match(html, /action="\/dashboard\/google\/disconnect\?beta=true"/)
		assert.match(html, /myaccount\.google\.com\/permissions/)
		assert.match(html, /stay in your Google\s+account/)
		assert.match(html, /name="tasksEnabled" checked=""/)
		assert.match(html, /name="tasksListName"[^>]*value="Homework"/)
		// The calendar name is only the placeholder, so the two stay independent.
		assert.match(html, /name="tasksListName"[^>]*placeholder="Class"/)
		assert.match(html, /Last synced: Sep 7, 2026/)

		const syncButton = html.slice(
			html.indexOf('formaction="/dashboard/outputs/out-1/sync?beta=true"'),
		)
		assert.doesNotMatch(syncButton.slice(0, syncButton.indexOf('>')), /disabled/)
	})

	it('surfaces the last Google Tasks sync error', async () => {
		const node = (
			<DashboardPage
				email="test@csumb.edu"
				sourceUrl="https://csumb.instructure.com/feeds/calendars/user_x.ics"
				courses={[{ code: 'CST463-01_2264' }]}
				outputs={[
					makeOutput({
						id: 'out-1',
						name: 'Calendar 1',
						feedUrl: 'http://localhost:3000/feed/secret-token.ics',
						tasksEnabled: true,
						tasksLastSyncError: 'Google Tasks returned HTTP 403.',
					}),
				]}
				googleConfigured
				googleConnected
				beta
			/>
		)
		const html = await Promise.resolve(String(node))
		assert.match(html, /Last Google Tasks sync failed: Google Tasks returned/)
	})
})
