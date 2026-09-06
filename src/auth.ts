import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { magicLink } from 'better-auth/plugins'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { Resend } from 'resend'
import { db } from './db/index.ts'
import * as authSchema from './db/auth-schema.ts'
import { env } from './env.ts'
import { isCsumbEmail } from './lib/util.ts'

const resend = new Resend(env.RESEND_API_KEY)

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
			if (!isCsumbEmail(email)) {
				throw new APIError('BAD_REQUEST', {
					message: 'Only @csumb.edu email addresses are allowed.',
				})
			}
		}),
	},
})
