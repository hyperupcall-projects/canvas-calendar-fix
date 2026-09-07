import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { resolve } from 'node:path'
import {
	buildFilteredCalendar,
	collectCourseCodes,
	extractCourseCode,
	parseCalendar,
} from './ics.ts'

const fixture = readFileSync(resolve('test/fixtures/sample.ics'), 'utf8')

describe('extractCourseCode', () => {
	it('reads the trailing bracketed class name', () => {
		assert.equal(
			extractCourseCode('08/24/26 [CST463-01_2264]'),
			'CST463-01_2264',
		)
		assert.equal(extractCourseCode('Office hours'), null)
	})
})

describe('parseCalendar', () => {
	it('collects Canvas course codes from SUMMARY', () => {
		const events = parseCalendar(fixture)
		assert.equal(events.length, 4)
		assert.deepEqual(collectCourseCodes(events), [
			'CST334-01_2264',
			'CST463-01_2264',
		])
	})
})

function vevent(body: string): string {
	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:icalendar-ruby',
		'BEGIN:VEVENT',
		body,
		'END:VEVENT',
		'END:VCALENDAR',
	].join('\r\n')
}

function eventBlock(ics: string, uid: string): string {
	const match = ics.match(
		new RegExp(`BEGIN:VEVENT[\\s\\S]*?UID:${uid}[\\s\\S]*?END:VEVENT`),
	)
	assert.ok(match, `missing event ${uid}`)
	return match[0].replace(/\r\n /g, '')
}

describe('buildFilteredCalendar', () => {
	it('omits disabled courses and events without a course code', () => {
		const events = parseCalendar(fixture)
		const ics = buildFilteredCalendar(
			events,
			new Set(['CST463-01_2264']),
			'Labs only',
		)
		assert.match(ics, /Labs only/)
		assert.match(ics, /CST463-01_2264/)
		assert.doesNotMatch(ics, /CST334-01_2264/)
		assert.doesNotMatch(ics, /Office hours/)
		assert.match(ics, /event-assignment-642309/)
		assert.match(ics, /event-assignment-632524/)
	})

	it('keeps Canvas all-day due dates on a single calendar day', () => {
		const events = parseCalendar(
			vevent(`UID:event-assignment-sunday
DTSTART;VALUE=DATE:20260906
SUMMARY:Weekly Study Guide 02 [CST463-01_2264]
`),
		)
		assert.equal(events.length, 1)
		assert.equal(events[0].allDay, true)
		assert.equal(events[0].start.toISOString(), '2026-09-06T00:00:00.000Z')
		assert.equal(events[0].end.toISOString(), '2026-09-07T00:00:00.000Z')

		const ics = buildFilteredCalendar(
			events,
			new Set(['CST463-01_2264']),
		)
		const block = eventBlock(ics, 'event-assignment-sunday')
		assert.match(block, /DTSTART;VALUE=DATE:20260906/)
		assert.match(block, /DTEND;VALUE=DATE:20260907/)
		assert.doesNotMatch(block, /DTSTART:20260906T000000Z/)
		assert.doesNotMatch(block, /DTEND:20260907T000000Z/)
	})

	it('does not turn UTC midnight-to-midnight due dates into two local days', () => {
		const events = parseCalendar(
			vevent(`UID:event-assignment-utc-span
DTSTART:20260906T000000Z
DTEND:20260907T000000Z
SUMMARY:Lab 01: Lab 00 Peer Review [CST463-01_2264]
`),
		)
		assert.equal(events[0].allDay, true)
		assert.equal(events[0].start.toISOString(), '2026-09-06T00:00:00.000Z')
		assert.equal(events[0].end.toISOString(), '2026-09-07T00:00:00.000Z')

		const ics = buildFilteredCalendar(
			events,
			new Set(['CST463-01_2264']),
		)
		const block = eventBlock(ics, 'event-assignment-utc-span')
		assert.match(block, /DTSTART;VALUE=DATE:20260906/)
		assert.match(block, /DTEND;VALUE=DATE:20260907/)
	})

	it('keeps a timed due instant on one day', () => {
		const events = parseCalendar(
			vevent(`UID:event-assignment-timed
DTSTART:20260907T000000Z
DTEND:20260907T000000Z
SUMMARY:Service: Project Selection [CST462S-M_80-81-82_2264]
`),
		)
		assert.equal(events[0].allDay, false)
		assert.equal(events[0].start.toISOString(), '2026-09-07T00:00:00.000Z')
		assert.equal(events[0].end.toISOString(), '2026-09-07T00:01:00.000Z')

		const ics = buildFilteredCalendar(
			events,
			new Set(['CST462S-M_80-81-82_2264']),
		)
		const block = eventBlock(ics, 'event-assignment-timed')
		assert.match(block, /DTSTART:20260907T000000Z/)
		assert.match(block, /DTEND:20260907T000100Z/)
		assert.doesNotMatch(block, /VALUE=DATE/)
	})

	it('still allows real overnight events to cross midnight', () => {
		const events = parseCalendar(
			vevent(`UID:event-lab-overnight
DTSTART:20260906T040000Z
DTEND:20260906T090000Z
SUMMARY:Overnight lab [CST334-01_2264]
`),
		)
		assert.equal(events[0].allDay, false)
		const ics = buildFilteredCalendar(
			events,
			new Set(['CST334-01_2264']),
		)
		const block = eventBlock(ics, 'event-lab-overnight')
		assert.match(block, /DTSTART:20260906T040000Z/)
		assert.match(block, /DTEND:20260906T090000Z/)
	})
})
