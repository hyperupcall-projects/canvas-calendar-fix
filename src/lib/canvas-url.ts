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
	if (url.hostname !== 'csumb.instructure.com') {
		throw new Error(
			'Only Canvas calendar feeds from csumb.instructure.com are allowed.',
		)
	}
	return url
}
