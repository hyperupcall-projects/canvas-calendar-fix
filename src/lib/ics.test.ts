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
})
