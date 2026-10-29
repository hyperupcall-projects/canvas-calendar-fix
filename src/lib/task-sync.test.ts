import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseCalendar, type ParsedEvent } from './ics.ts'
import {
	canvasUidFromNotes,
	DEFAULT_TASK_TITLE,
	MAX_NOTES_LENGTH,
	MAX_TITLE_LENGTH,
	taskDeadline,
	taskDueDate,
	taskNotes,
	taskTitle,
} from './task-sync.ts'

function event(body: string): ParsedEvent {
	const ics = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:icalendar-ruby',
		'BEGIN:VEVENT',
		body,
		'END:VEVENT',
		'END:VCALENDAR',
	].join('\r\n')
	const [parsed] = parseCalendar(ics)
	assert.ok(parsed, 'fixture did not parse')
	return parsed
}

// Canvas emits a due instant as a zero-length event; 06:59Z is 11:59 PM Pacific
// on the previous day.
const lateNight = event(`UID:late-night
DTSTART:20260825T065900Z
DTEND:20260825T065900Z
SUMMARY:Homework 3 [CST463-01_2264]
URL;VALUE=URI:https://csumb.instructure.com/courses/1#assignment_1
`)

const middayDue = event(`UID:midday-due
DTSTART:20260824T190000Z
DTEND:20260824T190000Z
SUMMARY:Quiz 1 [CST334-01_2264]
`)

const allDay = event(`UID:all-day
DTSTART;VALUE=DATE:20260906
SUMMARY:Weekly Study Guide 02 [CST463-01_2264]
`)

describe('taskDueDate', () => {
	it('steps the due date back from the Pacific deadline day', () => {
		// The 11:59 PM deadline on Aug 24 becomes due a week earlier by default.
		assert.equal(taskDueDate(lateNight, 7), '2026-08-17T00:00:00.000Z')
		assert.equal(taskDueDate(lateNight, 1), '2026-08-23T00:00:00.000Z')
	})

	it('crosses a month boundary correctly', () => {
		const september = event(`UID:sept
DTSTART:20260903T065900Z
DTEND:20260903T065900Z
SUMMARY:Homework 4 [CST463-01_2264]
`)
		// Deadline is Sep 2 Pacific, seven days earlier is Aug 26.
		assert.equal(taskDueDate(september, 7), '2026-08-26T00:00:00.000Z')
	})

	it('keeps an all-day event on its own calendar day', () => {
		// The date-only event covers Sep 6, so its deadline resolves to that day.
		assert.equal(taskDueDate(allDay, 7), '2026-08-30T00:00:00.000Z')
	})
})

describe('taskDeadline', () => {
	it('keeps the time Google discards, in Pacific', () => {
		assert.match(taskDeadline(lateNight), /Aug 24, 2026, 11:59\s?PM/)
	})

	it('marks an all-day event as all day', () => {
		assert.match(taskDeadline(allDay), /Sep 6, 2026 \(all day\)/)
	})
})

describe('taskTitle', () => {
	it('clamps to the length Google allows', () => {
		const long = { ...lateNight, summary: 'x'.repeat(2000) }
		assert.equal(taskTitle(long).length, MAX_TITLE_LENGTH)
	})

	it('never leaves the title blank', () => {
		assert.equal(taskTitle({ ...lateNight, summary: '   ' }), DEFAULT_TASK_TITLE)
	})
})

describe('taskNotes', () => {
	it('keeps the deadline with its time, plus the Canvas link', () => {
		const notes = taskNotes(lateNight)
		assert.match(notes, /^Deadline: Aug 24, 2026, 11:59\s?PM/)
		assert.match(notes, /assignment_1/)
	})

	it('ends with the marker that identifies the event later', () => {
		assert.match(taskNotes(lateNight), /\n\[canvas:late-night\]$/)
	})

	it('trims an over-long description but keeps the tracking marker', () => {
		const huge = { ...lateNight, description: 'y'.repeat(20_000) }
		const notes = taskNotes(huge)
		assert.ok(notes.length <= MAX_NOTES_LENGTH, `notes length ${notes.length}`)
		assert.match(notes, /\n\[canvas:late-night\]$/)
		assert.equal(canvasUidFromNotes(notes), 'late-night')
	})
})

describe('canvasUidFromNotes', () => {
	it('reads back the uid that taskNotes embedded', () => {
		assert.equal(canvasUidFromNotes(taskNotes(lateNight)), 'late-night')
		assert.equal(canvasUidFromNotes(taskNotes(middayDue)), 'midday-due')
	})

	it('still finds the marker after the user edits around it', () => {
		assert.equal(
			canvasUidFromNotes('my own plan\n\n[canvas:event-assignment-642309]'),
			'event-assignment-642309',
		)
	})

	it('returns null for notes it did not write', () => {
		assert.equal(canvasUidFromNotes(undefined), null)
		assert.equal(canvasUidFromNotes('groceries'), null)
		assert.equal(canvasUidFromNotes('[canvas:]'), null)
	})
})
