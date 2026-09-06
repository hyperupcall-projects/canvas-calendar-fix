import icalGenerator from 'ical-generator'
import ical from 'node-ical'
import { assertCanvasFeedUrl } from './canvas-url.ts'

const MAX_ICS_BYTES = 2 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
const SOURCE_CACHE_MS = 60_000

const sourceCache = new Map<string, { body: string; expiresAt: number }>()

export type ParsedEvent = {
	uid: string
	start: Date
	end: Date
	summary: string
	description?: string
	url?: string
	courseCode: string | null
}

export function extractCourseCode(summary: string): string | null {
	const match = summary.trim().match(/\[([^\]]+)\]\s*$/)
	return match?.[1] ?? null
}

export function collectCourseCodes(events: ParsedEvent[]): string[] {
	const codes = new Set<string>()
	for (const event of events) {
		if (event.courseCode) {
			codes.add(event.courseCode)
		}
	}
	return [...codes].sort((a, b) => a.localeCompare(b))
}

function textValue(value: unknown): string {
	if (typeof value === 'string') {
		return value
	}
	if (value && typeof value === 'object' && 'val' in value) {
		const inner = (value as { val: unknown }).val
		if (typeof inner === 'string') {
			return inner
		}
	}
	return ''
}

export function parseCalendar(ics: string): ParsedEvent[] {
	const parsed = ical.sync.parseICS(ics)
	const events: ParsedEvent[] = []

	for (const value of Object.values(parsed)) {
		if (!value || typeof value !== 'object' || !('type' in value)) {
			continue
		}
		if (value.type !== 'VEVENT') {
			continue
		}

		const summary = textValue('summary' in value ? value.summary : undefined)
		const start =
			'start' in value && value.start instanceof Date ? value.start : null
		if (!start) {
			continue
		}
		const end = 'end' in value && value.end instanceof Date ? value.end : start
		const uidRaw = 'uid' in value ? textValue(value.uid) : ''
		const uid = uidRaw.length > 0 ? uidRaw : crypto.randomUUID()
		const descriptionRaw =
			'description' in value ? textValue(value.description) : ''
		const description = descriptionRaw.length > 0 ? descriptionRaw : undefined
		const urlRaw = 'url' in value ? textValue(value.url) : ''
		const url = urlRaw.length > 0 ? urlRaw : undefined

		events.push({
			uid,
			start,
			end,
			summary,
			description,
			url,
			courseCode: extractCourseCode(summary),
		})
	}

	return events
}

export function buildFilteredCalendar(
	events: ParsedEvent[],
	enabledCodes: ReadonlySet<string>,
	calendarName = 'Canvas (filtered)',
): string {
	const calendar = icalGenerator({
		name: calendarName,
		prodId: {
			company: 'CSUMB',
			product: 'Canvas Calendar Fix',
		},
	})

	for (const event of events) {
		if (!event.courseCode || !enabledCodes.has(event.courseCode)) {
			continue
		}
		calendar.createEvent({
			id: event.uid,
			start: event.start,
			end: event.end,
			summary: event.summary,
			description: event.description,
			url: event.url,
		})
	}

	return calendar.toString()
}

export async function fetchCalendarSource(
	sourceUrl: string,
	validateHost = true,
): Promise<string> {
	if (validateHost) {
		assertCanvasFeedUrl(sourceUrl)
	}

	const cached = sourceCache.get(sourceUrl)
	if (cached && cached.expiresAt > Date.now()) {
		return cached.body
	}

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
	try {
		const response = await fetch(sourceUrl, {
			signal: controller.signal,
			headers: {
				accept: 'text/calendar, text/plain, */*',
				'user-agent': 'CanvasCalendarFix/1.0',
			},
			redirect: 'follow',
		})
		if (!response.ok) {
			throw new Error(
				`Canvas returned HTTP ${response.status} for that calendar URL.`,
			)
		}

		const buffer = Buffer.from(await response.arrayBuffer())
		if (buffer.byteLength > MAX_ICS_BYTES) {
			throw new Error('The calendar file is too large to import.')
		}

		const body = buffer.toString('utf8')
		sourceCache.set(sourceUrl, {
			body,
			expiresAt: Date.now() + SOURCE_CACHE_MS,
		})
		return body
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error('Timed out fetching the Canvas calendar.')
		}
		throw error
	} finally {
		clearTimeout(timer)
	}
}

export function clearSourceCache(): void {
	sourceCache.clear()
}
