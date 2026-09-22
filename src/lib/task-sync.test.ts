import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveTasksListName } from '../db/schema.ts'
import { parseCalendar, type ParsedEvent } from './ics.ts'
import {
	canvasUidFromNotes,
	isAssignmentEvent,
	taskDueDate,
	taskNotes,
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

const lecture = event(`UID:lecture
DTSTART:20260824T170000Z
DTEND:20260824T183000Z
SUMMARY:Lecture [CST334-01_2264]
`)

const shortMeeting = event(`UID:short-meeting
DTSTART:20260824T170000Z
DTEND:20260824T171500Z
SUMMARY:Standup [CST334-01_2264]
`)

const twentyMinutes = event(`UID:twenty-minutes
DTSTART:20260824T170000Z
DTEND:20260824T172000Z
SUMMARY:Office hours [CST334-01_2264]
`)

describe('isAssignmentEvent', () => {
	it('treats a deadline just before midnight as an assignment', () => {
		assert.equal(lateNight.start.toISOString(), '2026-08-25T06:59:00.000Z')
		assert.equal(isAssignmentEvent(lateNight), true)
	})

	it('treats a Canvas zero-length due instant as an assignment', () => {
		// parseCalendar pins these to one minute, which clears the 20-minute bar.
		assert.equal(middayDue.end.getTime() - middayDue.start.getTime(), 60_000)
		assert.equal(isAssignmentEvent(middayDue), true)
	})

	it('ignores all-day events and full-length meetings', () => {
		assert.equal(allDay.allDay, true)
		assert.equal(isAssignmentEvent(allDay), false)
		assert.equal(isAssignmentEvent(lecture), false)
	})

	it('uses 20 minutes as an exclusive bound', () => {
		assert.equal(isAssignmentEvent(shortMeeting), true)
		assert.equal(isAssignmentEvent(twentyMinutes), false)
	})
})

describe('taskDueDate', () => {
	it('keeps an 11:59 PM Pacific deadline on its own calendar day', () => {
		// The event ends at midnight Pacific the next day, and Google Tasks drops
		// the time, so a naive conversion would land the task a day late.
		assert.equal(lateNight.end.toISOString(), '2026-08-25T07:00:00.000Z')
		assert.equal(taskDueDate(lateNight), '2026-08-24T00:00:00.000Z')
	})

	it('uses the Pacific date for a midday deadline', () => {
		assert.equal(taskDueDate(middayDue), '2026-08-24T00:00:00.000Z')
	})
})

describe('taskNotes', () => {
	it('keeps the due time Google discards, plus the Canvas link', () => {
		const notes = taskNotes(lateNight)
		assert.match(notes, /Due Aug 24, 2026, 11:59 PM/)
		assert.match(notes, /assignment_1/)
	})

	it('ends with the marker that identifies the event later', () => {
		assert.match(taskNotes(lateNight), /\n\[canvas:late-night\]$/)
	})
})

describe('canvasUidFromNotes', () => {
	it('reads back the uid that taskNotes embedded', () => {
		assert.equal(canvasUidFromNotes(taskNotes(lateNight)), 'late-night')
		assert.equal(
			canvasUidFromNotes(taskNotes(middayDue)),
			'midday-due',
		)
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

describe('resolveTasksListName', () => {
	it('falls back to the calendar name when no list name is set', () => {
		assert.equal(
			resolveTasksListName({ name: 'Calendar 1', tasksListName: null }),
			'Calendar 1',
		)
	})

	it('keeps a task list name that differs from the calendar name', () => {
		assert.equal(
			resolveTasksListName({ name: 'Class', tasksListName: 'Homework' }),
			'Homework',
		)
		// Renaming the calendar must not disturb an explicit list name.
		assert.equal(
			resolveTasksListName({ name: 'Renamed', tasksListName: 'Homework' }),
			'Homework',
		)
	})
})
