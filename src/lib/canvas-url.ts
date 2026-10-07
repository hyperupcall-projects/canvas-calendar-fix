// Canvas hosts each institution on its own subdomain, so any Instructure-hosted
// feed is accepted rather than only CSUMB's. The suffix keeps the fetch from
// being pointed at an arbitrary host.
const CANVAS_HOST_SUFFIX = '.instructure.com'

export function assertCanvasFeedUrl(raw: string): URL {
	const trimmed = raw.trim()
	let url: URL
	try {
		url = new URL(trimmed)
	} catch {
		throw new Error('Enter a valid calendar URL.')
	}
	if (url.protocol !== 'https:') {
		throw new Error('The calendar URL must use https.')
	}
	if (!url.hostname.endsWith(CANVAS_HOST_SUFFIX)) {
		throw new Error(
			`Only Canvas calendar feeds from ${CANVAS_HOST_SUFFIX} are allowed.`,
		)
	}
	return url
}
