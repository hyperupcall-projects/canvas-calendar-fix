import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadEnvFile } from 'node:process'

if (existsSync('.env')) {
	loadEnvFile()
}

function required(name: string): string {
	const value = process.env[name]?.trim()
	if (!value) {
		throw new Error(`Missing required environment variable ${name}`)
	}
	return value
}

const databasePath = resolve(process.env.DATABASE_PATH ?? './data/app.sqlite')
mkdirSync(dirname(databasePath), { recursive: true })

export const env = {
	BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET'),
	BETTER_AUTH_URL:
		process.env.BETTER_AUTH_URL?.replace(/\/$/, '') ?? 'http://localhost:3000',
	RESEND_API_KEY: required('RESEND_API_KEY'),
	RESEND_FROM: required('RESEND_FROM'),
	DATABASE_PATH: databasePath,
	ADMIN_EMAIL: process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? '',
	PORT: Number(process.env.PORT ?? '3000'),
}

if (!Number.isInteger(env.PORT) || env.PORT <= 0) {
	throw new Error('PORT must be a positive integer')
}
