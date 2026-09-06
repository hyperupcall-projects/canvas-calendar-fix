import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { env } from '../env.ts'
import * as authSchema from './auth-schema.ts'
import * as appSchema from './schema.ts'

const sqlite = new Database(env.DATABASE_PATH)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, {
	schema: { ...authSchema, ...appSchema },
})

export const sqliteClient = sqlite
