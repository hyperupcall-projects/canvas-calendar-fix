export const SUPPORT_REQUEST_URL =
	'https://groups.google.com/g/canvas-calendar-fix-support'

// Popular universities and colleges in the Pacific time zone
// (America/Los_Angeles). An explicit list means an unrecognized .edu address is
// turned away with a pointer to the support group instead of silently accepted.
const SUPPORTED_SCHOOL_DOMAINS = new Set([
	// University of California
	'berkeley.edu',
	'ucla.edu',
	'ucsd.edu',
	'ucsf.edu',
	'ucdavis.edu',
	'uci.edu',
	'ucsb.edu',
	'ucsc.edu',
	'ucr.edu',
	'ucmerced.edu',
	// California State University
	'csumb.edu',
	'calpoly.edu',
	'cpp.edu',
	'csus.edu',
	'sacstate.edu',
	'sjsu.edu',
	'sfsu.edu',
	'csun.edu',
	'fullerton.edu',
	'csulb.edu',
	'calstatela.edu',
	'sdsu.edu',
	'csub.edu',
	'csuci.edu',
	'csudh.edu',
	'csueastbay.edu',
	'csuchico.edu',
	'csusm.edu',
	'fresnostate.edu',
	'sonoma.edu',
	'humboldt.edu',
	// Private colleges and universities
	'stanford.edu',
	'caltech.edu',
	'usc.edu',
	'scu.edu',
	'lmu.edu',
	'pepperdine.edu',
	'chapman.edu',
	'sandiego.edu',
	'pacific.edu',
	'pomona.edu',
	'hmc.edu',
	'cmc.edu',
	'pitzer.edu',
	'scrippscollege.edu',
	'occidental.edu',
	'redlands.edu',
	'laverne.edu',
	// Oregon
	'uoregon.edu',
	'oregonstate.edu',
	'pdx.edu',
	'ohsu.edu',
	'up.edu',
	'reed.edu',
	'willamette.edu',
	'lclark.edu',
	'sou.edu',
	'oit.edu',
	'wou.edu',
	'eou.edu',
	// Washington
	'uw.edu',
	'washington.edu',
	'wsu.edu',
	'seattleu.edu',
	'spu.edu',
	'wwu.edu',
	'cwu.edu',
	'ewu.edu',
	'plu.edu',
	'gonzaga.edu',
	'whitman.edu',
	'evergreen.edu',
	// Nevada (Pacific time)
	'unr.edu',
	'unlv.edu',
])

export function isSupportedSchoolEmail(email: string): boolean {
	const domain = email.trim().toLowerCase().split('@')[1] ?? ''
	return domain.length > 0 && SUPPORTED_SCHOOL_DOMAINS.has(domain)
}

// A supported school is one on the list above. Anything else gets a nudge: a
// .edu address we have not added yet points at the support group, while a
// non-school address is asked to use a school account.
export function unsupportedEmailMessage(email: string): string {
	if (email.trim().toLowerCase().endsWith('.edu')) {
		return `We don't support your school yet. Use the Google group to request that your school be added: ${SUPPORT_REQUEST_URL}`
	}
	return 'You must sign in with your school account.'
}

export function newId(): string {
	return crypto.randomUUID()
}

export function newPublicToken(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
		'base64url',
	)
}

export function asStringList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map(String)
	}
	if (typeof value === 'string' && value.length > 0) {
		return [value]
	}
	return []
}

export function formatPacific(date: Date | null | undefined): string {
	if (!date) {
		return 'Never'
	}
	return date.toLocaleString('en-US', {
		timeZone: 'America/Los_Angeles',
		dateStyle: 'medium',
		timeStyle: 'short',
	})
}
