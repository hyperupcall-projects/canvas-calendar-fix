export function isCsumbEmail(email: string): boolean {
	return email.trim().toLowerCase().endsWith('@csumb.edu')
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
