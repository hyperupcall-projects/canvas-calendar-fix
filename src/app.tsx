import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { asc, count, desc, eq, max, sql } from 'drizzle-orm'
import { auth } from './auth.ts'
import { getAdminSession, verifyAdminPassword } from './admin-auth.ts'
import { db } from './db/index.ts'
import { user } from './db/auth-schema.ts'
import {
	calendars,
	courses,
	defaultOutputName,
	nextOutputPosition,
	outputCalendarCourses,
	outputCalendars,
} from './db/schema.ts'
import { env } from './env.ts'
import { assertCanvasFeedUrl } from './lib/canvas-url.ts'
import {
	buildFilteredCalendar,
	collectCourseCodes,
	fetchCalendarSource,
	parseCalendar,
} from './lib/ics.ts'
import {
	asStringList,
	isCsumbEmail,
	newId,
	newPublicToken,
} from './lib/util.ts'
import {
	AdminLoginPage,
	AdminPage,
	type AdminDir,
	type AdminSort,
} from './views/admin.tsx'
import { DashboardPage } from './views/dashboard.tsx'
import { CheckEmailPage, SignInPage } from './views/sign-in.tsx'

type AppEnv = {
	Variables: {
		user: typeof auth.$Infer.Session.user | null
		session: typeof auth.$Infer.Session.session | null
	}
}

export const app = new Hono<AppEnv>()

app.use('/styles.css', serveStatic({ path: './public/styles.css' }))

app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

app.use('*', async (c, next) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (session) {
		c.set('user', session.user)
		c.set('session', session.session)
	} else {
		c.set('user', null)
		c.set('session', null)
	}
	await next()
})

function parseSort(value: string | undefined): AdminSort {
	if (value === 'email' || value === 'lastUsed' || value === 'createdAt') {
		return value
	}
	return 'createdAt'
}

function parseDir(value: string | undefined, sort: AdminSort): AdminDir {
	if (value === 'asc' || value === 'desc') {
		return value
	}
	return sort === 'email' ? 'asc' : 'desc'
}

async function copyAuthCookies(
	source: Response,
	destination: Response,
): Promise<void> {
	const headers = source.headers as Headers & { getSetCookie?: () => string[] }
	const setCookies = headers.getSetCookie?.() ?? []
	if (setCookies.length > 0) {
		for (const cookie of setCookies) {
			destination.headers.append('set-cookie', cookie)
		}
		return
	}
	const single = source.headers.get('set-cookie')
	if (single) {
		destination.headers.append('set-cookie', single)
	}
}

async function loadCalendarForUser(userId: string) {
	const [calendar] = await db
		.select()
		.from(calendars)
		.where(eq(calendars.userId, userId))
		.limit(1)
	const courseRows = calendar
		? await db
				.select()
				.from(courses)
				.where(eq(courses.calendarId, calendar.id))
				.orderBy(asc(courses.code))
		: []
	const outputRows = calendar
		? await db
				.select()
				.from(outputCalendars)
				.where(eq(outputCalendars.calendarId, calendar.id))
				.orderBy(asc(outputCalendars.position))
		: []
	const memberships = calendar
		? await db
				.select({
					outputCalendarId: outputCalendarCourses.outputCalendarId,
					courseId: outputCalendarCourses.courseId,
					code: courses.code,
				})
				.from(outputCalendarCourses)
				.innerJoin(courses, eq(courses.id, outputCalendarCourses.courseId))
				.where(eq(courses.calendarId, calendar.id))
		: []
	return { calendar, courseRows, outputRows, memberships }
}

function sanitizeOutputName(raw: string, position: number): string {
	const name = raw.trim().slice(0, 80)
	return name.length > 0 ? name : defaultOutputName(position)
}

async function includeCourseInOutputs(
	outputIds: string[],
	courseIds: string[],
) {
	for (const outputId of outputIds) {
		for (const courseId of courseIds) {
			await db
				.insert(outputCalendarCourses)
				.values({ outputCalendarId: outputId, courseId })
				.onConflictDoNothing()
		}
	}
}

async function createOutputCalendar(
	calendarId: string,
	position: number,
	courseIds: string[],
) {
	const id = newId()
	await db.insert(outputCalendars).values({
		id,
		calendarId,
		name: defaultOutputName(position),
		publicToken: newPublicToken(),
		position,
		createdAt: new Date(),
	})
	await includeCourseInOutputs([id], courseIds)
	return id
}

function feedUrlFor(token: string): string {
	return `${env.BETTER_AUTH_URL}/feed/${token}.ics`
}

app.get('/', (c) => {
	if (c.get('user')) {
		return c.redirect('/dashboard')
	}
	return c.redirect('/sign-in')
})

app.get('/sign-in', (c) => {
	if (c.get('user')) {
		return c.redirect('/dashboard')
	}
	return c.html(<SignInPage error={c.req.query('error')} />)
})

app.post('/sign-in', async (c) => {
	if (c.get('user')) {
		return c.redirect('/dashboard')
	}
	const body = await c.req.parseBody()
	const email = String(body.email ?? '')
		.trim()
		.toLowerCase()
	if (!isCsumbEmail(email)) {
		return c.html(
			<SignInPage error="Only @csumb.edu email addresses are allowed." />,
			400,
		)
	}

	try {
		await auth.api.signInMagicLink({
			body: {
				email,
				name: email.split('@')[0] ?? email,
				callbackURL: '/dashboard',
				errorCallbackURL: '/sign-in',
			},
			headers: c.req.raw.headers,
		})
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Could not send a sign-in link.'
		return c.html(<SignInPage error={message} />, 500)
	}

	return c.html(<CheckEmailPage email={email} />)
})

app.post('/sign-out', async (c) => {
	const authResponse = await auth.api.signOut({
		headers: c.req.raw.headers,
		asResponse: true,
	})
	const redirect = new Response(null, {
		status: 302,
		headers: { Location: '/sign-in' },
	})
	await copyAuthCookies(authResponse, redirect)
	return redirect
})

app.get('/dashboard', async (c) => {
	const currentUser = c.get('user')
	if (!currentUser) {
		return c.redirect('/sign-in')
	}
	const { calendar, courseRows, outputRows, memberships } =
		await loadCalendarForUser(currentUser.id)
	const enabledByOutput = new Map<string, string[]>()
	for (const row of memberships) {
		const codes = enabledByOutput.get(row.outputCalendarId) ?? []
		codes.push(row.code)
		enabledByOutput.set(row.outputCalendarId, codes)
	}

	return c.html(
		<DashboardPage
			email={currentUser.email}
			sourceUrl={calendar?.sourceUrl ?? ''}
			courses={courseRows.map((row) => ({ code: row.code }))}
			outputs={outputRows.map((row) => ({
				id: row.id,
				name: row.name,
				feedUrl: feedUrlFor(row.publicToken),
				enabledCodes: enabledByOutput.get(row.id) ?? [],
			}))}
			error={c.req.query('error')}
			success={
				c.req.query('saved')
					? 'Saved.'
					: c.req.query('reset')
						? 'Calendar URL removed.'
						: null
			}
		/>,
	)
})

app.post('/dashboard/source', async (c) => {
	const currentUser = c.get('user')
	if (!currentUser) {
		return c.redirect('/sign-in')
	}

	const body = await c.req.parseBody()
	const rawUrl = String(body.sourceUrl ?? '')

	try {
		const url = assertCanvasFeedUrl(rawUrl)
		const ics = await fetchCalendarSource(url.toString())
		const events = parseCalendar(ics)
		const codes = collectCourseCodes(events)
		const now = new Date()

		const { calendar, outputRows } = await loadCalendarForUser(currentUser.id)
		let calendarId = calendar?.id

		if (!calendar) {
			calendarId = newId()
			await db.insert(calendars).values({
				id: calendarId,
				userId: currentUser.id,
				sourceUrl: url.toString(),
				createdAt: now,
				updatedAt: now,
			})
		} else {
			await db
				.update(calendars)
				.set({ sourceUrl: url.toString(), updatedAt: now })
				.where(eq(calendars.id, calendar.id))
		}

		if (!calendarId) {
			throw new Error('Could not save calendar.')
		}

		const existing = await db
			.select()
			.from(courses)
			.where(eq(courses.calendarId, calendarId))
		const existingByCode = new Map(existing.map((row) => [row.code, row]))
		const incoming = new Set(codes)
		const outputs = calendar
			? outputRows
			: await db
					.select()
					.from(outputCalendars)
					.where(eq(outputCalendars.calendarId, calendarId))
		const outputIds = outputs.map((row) => row.id)
		const addedCourseIds: string[] = []

		for (const code of codes) {
			if (!existingByCode.has(code)) {
				const courseId = newId()
				await db.insert(courses).values({
					id: courseId,
					calendarId,
					code,
				})
				addedCourseIds.push(courseId)
			}
		}

		for (const row of existing) {
			if (!incoming.has(row.code)) {
				await db.delete(courses).where(eq(courses.id, row.id))
			}
		}

		if (outputs.length === 0) {
			const allCourses = await db
				.select()
				.from(courses)
				.where(eq(courses.calendarId, calendarId))
			await createOutputCalendar(
				calendarId,
				1,
				allCourses.map((row) => row.id),
			)
		} else if (addedCourseIds.length > 0) {
			await includeCourseInOutputs(outputIds, addedCourseIds)
		}
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Could not load that calendar.'
		return c.redirect(`/dashboard?error=${encodeURIComponent(message)}`)
	}

	return c.redirect('/dashboard?saved=1')
})

app.post('/dashboard/source/reset', async (c) => {
	const currentUser = c.get('user')
	if (!currentUser) {
		return c.redirect('/sign-in')
	}

	await db.delete(calendars).where(eq(calendars.userId, currentUser.id))
	return c.redirect('/dashboard?reset=1')
})

app.post('/dashboard/outputs', async (c) => {
	const currentUser = c.get('user')
	if (!currentUser) {
		return c.redirect('/sign-in')
	}

	const { calendar, courseRows, outputRows } = await loadCalendarForUser(
		currentUser.id,
	)
	if (!calendar) {
		return c.redirect(
			'/dashboard?error=' +
				encodeURIComponent('Save a Canvas calendar URL first.'),
		)
	}

	const position = nextOutputPosition(outputRows)
	if (position == null) {
		return c.redirect(
			'/dashboard?error=' +
				encodeURIComponent('You can create at most 4 calendars.'),
		)
	}

	await createOutputCalendar(
		calendar.id,
		position,
		courseRows.map((row) => row.id),
	)
	return c.redirect('/dashboard?saved=1')
})

app.post('/dashboard/outputs/:id/delete', async (c) => {
	const currentUser = c.get('user')
	if (!currentUser) {
		return c.redirect('/sign-in')
	}

	const outputId = c.req.param('id')
	const { outputRows } = await loadCalendarForUser(currentUser.id)
	const output = outputRows.find((row) => row.id === outputId)
	if (!output) {
		return c.redirect(
			'/dashboard?error=' + encodeURIComponent('That calendar was not found.'),
		)
	}
	if (outputRows.length <= 1) {
		return c.redirect(
			'/dashboard?error=' +
				encodeURIComponent('Keep at least one output calendar.'),
		)
	}

	await db.delete(outputCalendars).where(eq(outputCalendars.id, output.id))
	return c.redirect('/dashboard?saved=1')
})

app.post('/dashboard/outputs/:id', async (c) => {
	const currentUser = c.get('user')
	if (!currentUser) {
		return c.redirect('/sign-in')
	}

	const outputId = c.req.param('id')
	const { calendar, courseRows, outputRows } = await loadCalendarForUser(
		currentUser.id,
	)
	const output = outputRows.find((row) => row.id === outputId)
	if (!calendar || !output) {
		return c.redirect(
			'/dashboard?error=' + encodeURIComponent('That calendar was not found.'),
		)
	}

	const body = await c.req.parseBody({ all: true })
	const name = sanitizeOutputName(String(body.name ?? ''), output.position)
	const codes = asStringList(body.code)
	const enabled = new Set(asStringList(body.enabled))
	const coursesByCode = new Map(courseRows.map((row) => [row.code, row]))

	await db
		.update(outputCalendars)
		.set({ name })
		.where(eq(outputCalendars.id, output.id))
	await db
		.delete(outputCalendarCourses)
		.where(eq(outputCalendarCourses.outputCalendarId, output.id))

	for (const code of codes) {
		if (!enabled.has(code)) {
			continue
		}
		const course = coursesByCode.get(code)
		if (!course) {
			continue
		}
		await db.insert(outputCalendarCourses).values({
			outputCalendarId: output.id,
			courseId: course.id,
		})
	}

	return c.redirect('/dashboard?saved=1')
})

app.get('/feed/:token', async (c) => {
	const token = c.req.param('token').replace(/\.ics$/i, '')
	const [output] = await db
		.select()
		.from(outputCalendars)
		.where(eq(outputCalendars.publicToken, token))
		.limit(1)
	if (!output) {
		return c.text('Not found', 404)
	}

	const [calendar] = await db
		.select()
		.from(calendars)
		.where(eq(calendars.id, output.calendarId))
		.limit(1)
	if (!calendar) {
		return c.text('Not found', 404)
	}

	await db
		.update(outputCalendars)
		.set({ lastFeedAccessAt: new Date() })
		.where(eq(outputCalendars.id, output.id))

	const members = await db
		.select({ code: courses.code })
		.from(outputCalendarCourses)
		.innerJoin(courses, eq(courses.id, outputCalendarCourses.courseId))
		.where(eq(outputCalendarCourses.outputCalendarId, output.id))
	const enabled = new Set(members.map((row) => row.code))

	try {
		const ics = await fetchCalendarSource(calendar.sourceUrl)
		const events = parseCalendar(ics)
		const filtered = buildFilteredCalendar(events, enabled, output.name)
		return c.body(filtered, 200, {
			'content-type': 'text/calendar; charset=utf-8',
			'cache-control': 'no-store',
		})
	} catch {
		return c.text('Failed to load the source Canvas calendar.', 502)
	}
})

app.get('/admin/login', async (c) => {
	const session = await getAdminSession(c)
	if (session.admin) {
		return c.redirect('/admin')
	}
	return c.html(<AdminLoginPage error={c.req.query('error')} />)
})

app.post('/admin/login', async (c) => {
	const body = await c.req.parseBody()
	const password = String(body.password ?? '')
	if (!verifyAdminPassword(password)) {
		return c.html(<AdminLoginPage error="Incorrect password." />, 401)
	}
	const session = await getAdminSession(c)
	session.admin = true
	await session.save()
	return c.redirect('/admin')
})

app.post('/admin/logout', async (c) => {
	const session = await getAdminSession(c)
	session.destroy()
	return c.redirect('/admin/login')
})

app.get('/admin', async (c) => {
	const session = await getAdminSession(c)
	if (!session.admin) {
		return c.redirect('/admin/login')
	}

	const sort = parseSort(c.req.query('sort'))
	const dir = parseDir(c.req.query('dir'), sort)
	const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(user)

	const lastUsedAt = max(outputCalendars.lastFeedAccessAt)
	const orderBy =
		sort === 'email'
			? dir === 'asc'
				? asc(user.email)
				: desc(user.email)
			: sort === 'lastUsed'
				? dir === 'asc'
					? sql`${lastUsedAt} is null, ${lastUsedAt} asc`
					: sql`${lastUsedAt} is null, ${lastUsedAt} desc`
				: dir === 'asc'
					? asc(user.createdAt)
					: desc(user.createdAt)

	const rows = await db
		.select({
			email: user.email,
			createdAt: user.createdAt,
			lastUsedAt,
		})
		.from(user)
		.leftJoin(calendars, eq(calendars.userId, user.id))
		.leftJoin(outputCalendars, eq(outputCalendars.calendarId, calendars.id))
		.groupBy(user.id, user.email, user.createdAt)
		.orderBy(orderBy)

	return c.html(
		<AdminPage
			totalUsers={totalUsers}
			users={rows.map((row) => ({
				email: row.email,
				createdAt: row.createdAt,
				lastUsedAt: row.lastUsedAt,
			}))}
			sort={sort}
			dir={dir}
		/>,
	)
})
