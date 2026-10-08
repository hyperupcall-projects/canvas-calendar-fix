import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	defaultOutputName,
	MAX_OUTPUT_CALENDARS,
	nextOutputPosition,
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
