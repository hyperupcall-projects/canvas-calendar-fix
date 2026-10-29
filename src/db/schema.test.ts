import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	clampDueOffsetDays,
	DEFAULT_DUE_OFFSET_DAYS,
	defaultOutputName,
	DEFAULT_TASK_LIST_NAME,
	dueOffsetOptions,
	MAX_DUE_OFFSET_DAYS,
	MAX_OUTPUT_CALENDARS,
	MIN_DUE_OFFSET_DAYS,
	nextOutputPosition,
	resolveTaskListName,
} from './schema.ts'

describe('nextOutputPosition', () => {
	it('fills the lowest unused position up to the cap', () => {
		assert.equal(nextOutputPosition([]), 1)
		assert.equal(nextOutputPosition([{ position: 1 }]), 2)
		assert.equal(nextOutputPosition([{ position: 1 }, { position: 3 }]), 2)
		const full = Array.from({ length: MAX_OUTPUT_CALENDARS }, (_, index) => ({
			position: index + 1,
		}))
		assert.equal(nextOutputPosition(full), null)
		assert.equal(MAX_OUTPUT_CALENDARS, 8)
		assert.equal(defaultOutputName(2), 'Calendar 2')
	})
})

describe('clampDueOffsetDays', () => {
	it('keeps whole values inside the 1-14 range', () => {
		assert.equal(clampDueOffsetDays(1), MIN_DUE_OFFSET_DAYS)
		assert.equal(clampDueOffsetDays(7), 7)
		assert.equal(clampDueOffsetDays(14), MAX_DUE_OFFSET_DAYS)
	})

	it('clamps out-of-range values and rounds down', () => {
		assert.equal(clampDueOffsetDays(0), MIN_DUE_OFFSET_DAYS)
		assert.equal(clampDueOffsetDays(30), MAX_DUE_OFFSET_DAYS)
		assert.equal(clampDueOffsetDays(4.9), 4)
	})

	it('falls back to the default for a missing or non-numeric value', () => {
		assert.equal(clampDueOffsetDays(Number.NaN), DEFAULT_DUE_OFFSET_DAYS)
		assert.equal(
			clampDueOffsetDays(Number.POSITIVE_INFINITY),
			DEFAULT_DUE_OFFSET_DAYS,
		)
	})
})

describe('dueOffsetOptions', () => {
	it('offers every whole day from 1 to 14', () => {
		const options = dueOffsetOptions()
		assert.equal(options.length, 14)
		assert.equal(options[0], MIN_DUE_OFFSET_DAYS)
		assert.equal(options.at(-1), MAX_DUE_OFFSET_DAYS)
	})
})

describe('resolveTaskListName', () => {
	it('falls back to the default name when none is set', () => {
		assert.equal(resolveTaskListName(null), DEFAULT_TASK_LIST_NAME)
		assert.equal(resolveTaskListName('   '), DEFAULT_TASK_LIST_NAME)
	})

	it('keeps a name the user typed', () => {
		assert.equal(resolveTaskListName('Homework'), 'Homework')
	})
})
