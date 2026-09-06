import { timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import {
	getIronSession,
	type CookieJar,
	type SessionOptions,
} from 'iron-session'
import { env } from './env.ts'

export const ADMIN_COOKIE = 'admin_session'
const TTL_SECONDS = 7 * 24 * 60 * 60

type AdminSessionData = {
	admin: boolean
}

const sessionOptions = {
	cookieName: ADMIN_COOKIE,
	password: env.BETTER_AUTH_SECRET,
	ttl: TTL_SECONDS,
	cookieOptions: {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		secure: env.BETTER_AUTH_URL.startsWith('https'),
	},
} satisfies SessionOptions

function cookiesFromContext(c: Context) {
	return {
		read: (name: string) => getCookie(c, name),
		write: (...[name, value, options]: Parameters<CookieJar['write']>) => {
			setCookie(c, name, value, {
				domain: options.domain,
				expires: options.expires,
				httpOnly: options.httpOnly,
				maxAge: options.maxAge,
				path: options.path,
				secure: options.secure,
				partitioned: options.partitioned,
				priority: options.priority,
				sameSite:
					options.sameSite === true
						? 'strict'
						: options.sameSite === false
							? undefined
							: options.sameSite,
			})
		},
	}
}

export function getAdminSession(c: Context) {
	return getIronSession<AdminSessionData>(cookiesFromContext(c), sessionOptions)
}

export function verifyAdminPassword(password: string): boolean {
	const left = Buffer.from(password)
	const right = Buffer.from(env.ADMIN_PASSWORD)
	if (left.length !== right.length) {
		return false
	}
	return timingSafeEqual(left, right)
}
