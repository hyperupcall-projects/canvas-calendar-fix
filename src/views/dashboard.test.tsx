import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_OUTPUT_CALENDARS } from '../db/schema.ts'
import { DashboardPage, type DashboardOutput } from './dashboard.tsx'

function makeOutput(
	overrides: Partial<DashboardOutput> &
		Pick<DashboardOutput, 'id' | 'name' | 'feedUrl'>,
): DashboardOutput {
	return {
		enabledCodes: [],
		addCanvasLink: true,
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

	it(`hides add when ${MAX_OUTPUT_CALENDARS} calendars already exist`, async () => {
		const outputs = Array.from({ length: MAX_OUTPUT_CALENDARS }, (_, index) =>
			makeOutput({
				id: `out-${index + 1}`,
				name: `Calendar ${index + 1}`,
				feedUrl: `http://localhost:3000/feed/token-${index + 1}.ics`,
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

	it('hides the Google Tasks section when it is not configured', async () => {
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
		assert.doesNotMatch(html, /dueOffsetDays/)
	})

	it('hides the Google Tasks section unless the dashboard is opened with beta=true', async () => {
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
		assert.doesNotMatch(html, /beta=true/)
	})

	it('offers to connect Google when configured and not yet connected', async () => {
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
		assert.doesNotMatch(html, /action="\/dashboard\/google\/settings/)
	})

	it('shows the Google Tasks controls, list picker and due offset when connected', async () => {
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
				beta
				googleTasks={{
					enabled: true,
					listName: 'Homework',
					dueOffsetDays: 3,
					skipOlderThanDays: 2,
					lastSyncAt: new Date('2026-09-07T19:30:00.000Z'),
					lastSyncError: null,
				}}
				taskListNames={['Homework', 'TA']}
			/>
		)
		const html = await Promise.resolve(String(node))
		assert.match(html, /action="\/dashboard\/google\/settings\?beta=true"/)
		assert.match(html, /name="enabled" checked=""/)
		assert.match(html, /name="listName"[^>]*value="Homework"/)
		assert.match(html, /list="google-task-lists"/)
		assert.match(html, /<datalist id="google-task-lists">/)
		assert.match(html, /<option value="TA">TA<\/option>/)
		// The configured offset is the selected one, out of the 1-14 range.
		assert.match(html, /value="3" selected/)
		assert.doesNotMatch(html, /value="4" selected/)
		assert.match(html, /name="skipOlderThanDays"/)
		assert.match(html, /<option value="2" selected="">2 days<\/option>/)
		assert.match(html, /Last synced: Sep 7, 2026/)
		assert.match(html, /action="\/dashboard\/google\/sync\?beta=true"/)
		assert.match(html, /action="\/dashboard\/google\/refresh\?beta=true"/)
		assert.match(html, /action="\/dashboard\/google\/disconnect\?beta=true"/)
	})

	it('surfaces the last sync error and hides the details while disabled', async () => {
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
				beta
				googleTasks={{
					enabled: false,
					listName: null,
					dueOffsetDays: 7,
					skipOlderThanDays: 1,
					lastSyncAt: null,
					lastSyncError: 'Google Tasks returned HTTP 403.',
				}}
			/>
		)
		const html = await Promise.resolve(String(node))
		assert.match(html, /Last Google Tasks sync failed: Google Tasks returned/)
		assert.doesNotMatch(html, /name="enabled" checked=""/)
		assert.doesNotMatch(html, /name="listName"/)
		const syncIndex = html.indexOf('action="/dashboard/google/sync?beta=true"')
		const syncForm = html.slice(syncIndex, html.indexOf('</form>', syncIndex))
		assert.match(syncForm, /disabled=""/)
	})
})
