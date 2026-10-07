import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { magicLink } from 'better-auth/plugins'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { Resend } from 'resend'
import { db } from './db/index.ts'
import * as authSchema from './db/auth-schema.ts'
import { env, googleConfigured } from './env.ts'
import { isSupportedSchoolEmail, unsupportedEmailMessage } from './lib/util.ts'

const resend = new Resend(env.RESEND_API_KEY)

export const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'

export const auth = betterAuth({
	baseURL: env.BETTER_AUTH_URL,
	secret: env.BETTER_AUTH_SECRET,
	trustedOrigins: [env.BETTER_AUTH_URL],
	database: drizzleAdapter(db, {
		provider: 'sqlite',
		schema: authSchema,
	}),
	emailAndPassword: {
		enabled: false,
	},
	session: {
		// Unlinking Google requires a session created within `freshAge`. Sign-in
		// here costs an email round trip, so re-authenticating just to disconnect
		// would strand anyone whose session is more than a day old.
		freshAge: 0,
	},
	account: {
		accountLinking: {
			// Magic-link sign-in creates no account row, so Google is usually the
			// only one. Without this, disconnecting it always fails.
			allowUnlinkingAll: true,
		},
	},
	socialProviders: googleConfigured
		? {
				google: {
					clientId: env.GOOGLE_CLIENT_ID,
					clientSecret: env.GOOGLE_CLIENT_SECRET,
					// Needed for a refresh token, which the background sync relies on.
					accessType: 'offline',
					prompt: 'consent',
					scope: [GOOGLE_TASKS_SCOPE],
					// Google may only be linked to an existing account; it must not
					// become a way around the magic-link school-email gate.
					disableSignUp: true,
				},
			}
		: undefined,
	plugins: [
		magicLink({
			expiresIn: 60 * 5,
			sendMagicLink: async ({ email, url }) => {
				const result = await resend.emails.send({
					from: env.RESEND_FROM,
					to: email,
					subject: 'Sign in to Canvas Calendar Fix',
					html: `
            <p>Click the link below to sign in. It expires in 5 minutes.</p>
            <p><a href="${url}">Sign in to Canvas Calendar Fix</a></p>
            <p>If you did not request this, you can ignore this email.</p>
          `,
				})
				if (result.error) {
					throw new Error(result.error.message)
				}
			},
		}),
	],
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			if (ctx.path !== '/sign-in/magic-link') {
				return
			}
			const email = String(
				(ctx.body as { email?: string } | undefined)?.email ?? '',
			)
			if (!isSupportedSchoolEmail(email)) {
				throw new APIError('BAD_REQUEST', {
					message: unsupportedEmailMessage(email),
				})
			}
		}),
	},
})
