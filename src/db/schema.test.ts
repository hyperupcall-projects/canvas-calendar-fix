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
		assert.equal(
			nextOutputPosition([1, 2, 3, 4].map((position) => ({ position }))),
			null,
		)
		assert.equal(MAX_OUTPUT_CALENDARS, 4)
		assert.equal(defaultOutputName(2), 'Calendar 2')
	})
})
