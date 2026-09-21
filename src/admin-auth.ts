import { env } from './env.ts'

export function isAdminEmail(email: string): boolean {
	const admin = env.ADMIN_EMAIL
	if (!admin) {
		return false
	}
	return email.trim().toLowerCase() === admin
}
