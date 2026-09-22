import icalGenerator from 'ical-generator'
import ical from 'node-ical'
import { assertCanvasFeedUrl } from './canvas-url.ts'

const MAX_ICS_BYTES = 2 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
const SOURCE_CACHE_MS = 60_000

const sourceCache = new Map<string, { body: string; expiresAt: number }>()

type DateWithMeta = Date & { dateOnly?: boolean }

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_MINUTE = 60 * 1000

export type ParsedEvent = {
	/** Empty when the source feed did not supply one. */
	uid: string
	start: Date
	end: Date
	allDay: boolean
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

function isUtcMidnight(date: Date): boolean {
	return (
		date.getUTCHours() === 0 &&
		date.getUTCMinutes() === 0 &&
		date.getUTCSeconds() === 0 &&
		date.getUTCMilliseconds() === 0
	)
}

function utcMidnightFromParts(
	year: number,
	monthIndex: number,
	day: number,
): Date {
	return new Date(Date.UTC(year, monthIndex, day))
}

function asUtcMidnight(date: Date, useLocalDate: boolean): Date {
	if (useLocalDate) {
		return utcMidnightFromParts(
			date.getFullYear(),
			date.getMonth(),
			date.getDate(),
		)
	}
	return utcMidnightFromParts(
		date.getUTCFullYear(),
		date.getUTCMonth(),
		date.getUTCDate(),
	)
}

function addUtcDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * MS_PER_DAY)
}

function isCanvasDateOnly(value: object, start: Date): boolean {
	if ('datetype' in value && value.datetype === 'date') {
		return true
	}
	return (start as DateWithMeta).dateOnly === true
}

function isUtcMidnightAllDaySpan(start: Date, end: Date): boolean {
	return (
		end.getTime() - start.getTime() === MS_PER_DAY &&
		isUtcMidnight(start) &&
		isUtcMidnight(end)
	)
}

function exclusiveAllDayEnd(
	start: Date,
	end: Date,
	useLocalDate: boolean,
): Date {
	const endMidnight = asUtcMidnight(end, useLocalDate)
	if (endMidnight.getTime() <= start.getTime()) {
		return addUtcDays(start, 1)
	}
	return endMidnight
}

function pinTimedEnd(start: Date, end: Date): Date {
	if (end.getTime() > start.getTime()) {
		return end
	}
	const candidate = new Date(start.getTime() + MS_PER_MINUTE)
	if (
		candidate.getUTCFullYear() !== start.getUTCFullYear() ||
		candidate.getUTCMonth() !== start.getUTCMonth() ||
		candidate.getUTCDate() !== start.getUTCDate()
	) {
		return start
	}
	return candidate
}

function normalizeEventTimes(
	value: object,
	start: Date,
	end: Date,
): { start: Date; end: Date; allDay: boolean } {
	const dateOnly = isCanvasDateOnly(value, start)
	if (dateOnly || isUtcMidnightAllDaySpan(start, end)) {
		const allDayStart = asUtcMidnight(start, dateOnly)
		return {
			start: allDayStart,
			end: exclusiveAllDayEnd(allDayStart, end, dateOnly),
			allDay: true,
		}
	}

	return {
		start,
		end: pinTimedEnd(start, end),
		allDay: false,
	}
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
		const times = normalizeEventTimes(value, start, end)
		// Left empty when the feed omits it. Anything keyed off a synthetic id
		// would be treated as a brand new event on every parse.
		const uid = 'uid' in value ? textValue(value.uid) : ''
		const descriptionRaw =
			'description' in value ? textValue(value.description) : ''
		const description = descriptionRaw.length > 0 ? descriptionRaw : undefined
		const urlRaw = 'url' in value ? textValue(value.url) : ''
		const url = urlRaw.length > 0 ? urlRaw : undefined

		events.push({
			uid,
			start: times.start,
			end: times.end,
			allDay: times.allDay,
			summary,
			description,
			url,
			courseCode: extractCourseCode(summary),
		})
	}

	return events
}

function withCanvasLink(event: ParsedEvent): string | undefined {
	if (!event.url) {
		return event.description
	}
	return event.description ? `${event.url}\n\n${event.description}` : event.url
}

export function buildFilteredCalendar(
	events: ParsedEvent[],
	enabledCodes: ReadonlySet<string>,
	calendarName = 'Canvas (filtered)',
	addCanvasLink = false,
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
			id: event.uid.length > 0 ? event.uid : crypto.randomUUID(),
			start: event.start,
			end: event.end,
			allDay: event.allDay,
			summary: event.summary,
			description: addCanvasLink ? withCanvasLink(event) : event.description,
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
