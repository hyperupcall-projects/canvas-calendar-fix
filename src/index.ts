import { serve } from '@hono/node-server'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { app } from './app.tsx'
import { db } from './db/index.ts'
import { env } from './env.ts'

migrate(db, { migrationsFolder: './drizzle' })

serve(
	{
		fetch: app.fetch,
		port: env.PORT,
	},
	(info) => {
		console.log(
			`Canvas Calendar Fix listening on http://localhost:${info.port}`,
		)
	},
)
