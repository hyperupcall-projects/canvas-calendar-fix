import { ErrorBanner, Layout, UserNav } from './layout.tsx'
import { formatPacific } from '../lib/util.ts'

export type AdminUserRow = {
	email: string
	createdAt: Date
	lastUsedAt: Date | null
}

export type AdminSort = 'email' | 'createdAt' | 'lastUsed'
export type AdminDir = 'asc' | 'desc'

function sortHref(
	current: AdminSort,
	dir: AdminDir,
	column: AdminSort,
): string {
	const nextDir = current === column && dir === 'asc' ? 'desc' : 'asc'
	const usedDir =
		current === column ? nextDir : column === 'email' ? 'asc' : 'desc'
	return `/admin?sort=${column}&dir=${usedDir}`
}

function sortMarker(
	current: AdminSort,
	dir: AdminDir,
	column: AdminSort,
): string {
	if (current !== column) {
		return ''
	}
	return dir === 'asc' ? ' (ascending)' : ' (descending)'
}

export function AdminLoginPage(props: { error?: string | null }) {
	return (
		<Layout title="Admin sign in">
			<section class="narrow">
				<h1>Admin</h1>
				<p>Enter the admin email to receive a sign-in link.</p>
				<ErrorBanner message={props.error} />
				<form
					method="post"
					action="/admin/login"
					class="pure-form pure-form-stacked"
				>
					<label>
						Email
						<input
							class="pure-input-1"
							type="email"
							name="email"
							required
							autocomplete="email"
							placeholder="you@csumb.edu"
						/>
					</label>
					<button type="submit" class="pure-button pure-button-primary">
						Email me a sign-in link
					</button>
				</form>
			</section>
		</Layout>
	)
}

export function AdminCheckEmailPage(props: { email: string }) {
	return (
		<Layout title="Check your email">
			<section class="narrow">
				<h1>Check your inbox</h1>
				<p>
					If <strong>{props.email}</strong> can receive mail, a sign-in link is
					on the way. Open it to continue to the admin page.
				</p>
				<p>
					<a href="/admin/login">Use a different email</a>
				</p>
			</section>
		</Layout>
	)
}

export function AdminPage(props: {
	email: string
	totalUsers: number
	users: AdminUserRow[]
	sort: AdminSort
	dir: AdminDir
}) {
	return (
		<Layout
			title="Admin"
			nav={<UserNav email={props.email} isAdmin />}
		>
			<section>
				<h1>Users</h1>
				<p>
					Total users: <strong>{props.totalUsers}</strong>
				</p>

				<form method="get" action="/admin" class="pure-form admin-controls">
					<label>
						Sort by
						<select name="sort">
							<option value="createdAt" selected={props.sort === 'createdAt'}>
								Signed up
							</option>
							<option value="email" selected={props.sort === 'email'}>
								Email
							</option>
							<option value="lastUsed" selected={props.sort === 'lastUsed'}>
								Calendar last used
							</option>
						</select>
					</label>
					<label>
						Direction
						<select name="dir">
							<option value="asc" selected={props.dir === 'asc'}>
								Ascending
							</option>
							<option value="desc" selected={props.dir === 'desc'}>
								Descending
							</option>
						</select>
					</label>
					<button type="submit" class="pure-button">
						Apply
					</button>
				</form>

				<div class="table-wrap">
					<table class="pure-table admin-table">
						<thead>
							<tr>
								<th>
									<a href={sortHref(props.sort, props.dir, 'email')}>
										Email{sortMarker(props.sort, props.dir, 'email')}
									</a>
								</th>
								<th>
									<a href={sortHref(props.sort, props.dir, 'createdAt')}>
										Signed up{sortMarker(props.sort, props.dir, 'createdAt')}
									</a>
								</th>
								<th>
									<a href={sortHref(props.sort, props.dir, 'lastUsed')}>
										Calendar last used
										{sortMarker(props.sort, props.dir, 'lastUsed')}
									</a>
								</th>
							</tr>
						</thead>
						<tbody>
							{props.users.length === 0 ? (
								<tr>
									<td colspan={3}>No accounts yet.</td>
								</tr>
							) : (
								props.users.map((row) => (
									<tr>
										<td>{row.email}</td>
										<td>{formatPacific(row.createdAt)}</td>
										<td>{formatPacific(row.lastUsedAt)}</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
			</section>
		</Layout>
	)
}
