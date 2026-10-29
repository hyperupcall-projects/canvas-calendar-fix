import {
	DEFAULT_DUE_OFFSET_DAYS,
	DEFAULT_TASK_LIST_NAME,
	dueOffsetOptions,
	MAX_OUTPUT_CALENDARS,
} from '../db/schema.ts'
import { formatPacific } from '../lib/util.ts'
import { ErrorBanner, Layout, SuccessBanner, UserNav } from './layout.tsx'

export type DashboardCourse = {
	code: string
}

export type DashboardOutput = {
	id: string
	name: string
	feedUrl: string
	enabledCodes: string[]
	addCanvasLink: boolean
}

export type DashboardGoogleTasks = {
	enabled: boolean
	listName: string | null
	dueOffsetDays: number
	lastSyncAt: Date | null
	lastSyncError: string | null
}

const DEFAULT_GOOGLE_TASKS: DashboardGoogleTasks = {
	enabled: false,
	listName: null,
	dueOffsetDays: DEFAULT_DUE_OFFSET_DAYS,
	lastSyncAt: null,
	lastSyncError: null,
}

export function DashboardPage(props: {
	email: string
	isAdmin?: boolean
	sourceUrl: string
	courses: DashboardCourse[]
	outputs: DashboardOutput[]
	googleConfigured?: boolean
	googleConnected?: boolean
	beta?: boolean
	googleTasks?: DashboardGoogleTasks
	taskListNames?: string[]
	error?: string | null
	success?: string | null
}) {
	const canAdd =
		props.outputs.length > 0 && props.outputs.length < MAX_OUTPUT_CALENDARS
	const canRemove = props.outputs.length > 1
	// Google Tasks is a beta feature: it only appears when the dashboard is
	// opened with ?beta=true. The flag rides along on every form so it survives
	// a save or a sync.
	const beta = props.beta === true
	const betaQuery = beta ? '?beta=true' : ''
	const googleTasks = props.googleTasks ?? DEFAULT_GOOGLE_TASKS
	const taskListNames = props.taskListNames ?? []

	return (
		<Layout
			title="Dashboard"
			nav={<UserNav email={props.email} isAdmin={props.isAdmin} />}
		>
			<section>
				<h1>Canvas Calendar Fix</h1>
				<p>
					Paste the ICS feed from Canvas, then create up to{' '}
					{MAX_OUTPUT_CALENDARS} output calendars for use in Google Calendar,
					Outlook, or other calendar apps.
				</p>
				<p>
					The generated output calendar address should stay private. Anyone
					with it can read this filtered calendar.
				</p>
				<ErrorBanner message={props.error} />
				<SuccessBanner message={props.success} />

				<h2>Canvas Calendar URL</h2>
				<form
					method="post"
					action={`/dashboard/source${betaQuery}`}
					class="pure-form pure-form-stacked"
				>
					<label>
						ICS URL
						<input
							class="pure-input-1"
							type="url"
							name="sourceUrl"
							required
							value={props.sourceUrl}
							placeholder="https://csumb.instructure.com/feeds/calendars/user_....ics"
						/>
					</label>
					<div class="form-actions">
						<button type="submit" class="pure-button pure-button-primary">
							Load classes
						</button>
						{props.sourceUrl ? (
							<button
								type="submit"
								class="pure-button"
								formaction={`/dashboard/source/reset${betaQuery}`}
								formnovalidate
							>
								Remove calendar URL
							</button>
						) : null}
					</div>
				</form>
			</section>

			{props.googleConfigured && beta ? (
				<section>
					<h2>Google Tasks</h2>
					{props.googleConnected ? (
						<>
							<p>
								Connected. Every Canvas event in your enabled courses is
								mirrored into a single Google task list. Tasks follow the
								feed: they are created, moved and removed as events change,
								and any task you delete in Google Tasks is left deleted.
							</p>
							<form
								method="post"
								action={`/dashboard/google/settings${betaQuery}`}
								class="pure-form pure-form-stacked"
							>
								<label class="pure-checkbox">
									<input
										type="checkbox"
										name="enabled"
										checked={googleTasks.enabled}
									/>{' '}
									Enable Google Tasks sync
								</label>
								{googleTasks.enabled ? (
									<>
										<label style="margin-top:0.5em">
											Task list (category)
											<input
												class="pure-input-1"
												type="text"
												name="listName"
												maxlength={80}
												value={googleTasks.listName ?? ''}
												placeholder={DEFAULT_TASK_LIST_NAME}
												list="google-task-lists"
											/>
										</label>
										<datalist id="google-task-lists">
											{taskListNames.map((name) => (
												<option value={name}>{name}</option>
											))}
										</datalist>
										<label style="margin-top:0.5em">
											Due date (days before the deadline)
											<select name="dueOffsetDays" class="pure-input-1">
												{dueOffsetOptions().map((days) => (
													<option
														value={String(days)}
														selected={days === googleTasks.dueOffsetDays}
													>
														{days}
													</option>
												))}
											</select>
										</label>
										<p class="form-hint">
											Each task keeps its full deadline (time included) in its
											notes; its due date is set this many days earlier so it
											surfaces on your calendar ahead of the assignment.
										</p>
									</>
								) : null}
								<div class="form-actions">
									<button type="submit" class="pure-button pure-button-primary">
										Save Google Tasks settings
									</button>
								</div>
							</form>
							{googleTasks.lastSyncAt ? (
								<p class="form-hint">
									Last synced: {formatPacific(googleTasks.lastSyncAt)}.
								</p>
							) : null}
							{googleTasks.lastSyncError ? (
								<ErrorBanner
									message={`Last Google Tasks sync failed: ${googleTasks.lastSyncError}`}
								/>
							) : null}
							<form
								method="post"
								action={`/dashboard/google/sync${betaQuery}`}
								style="margin-top:0.5em"
							>
								<button
									type="submit"
									class="pure-button"
									disabled={!googleTasks.enabled}
								>
									Sync
								</button>
							</form>
							<form
								method="post"
								action={`/dashboard/google/refresh${betaQuery}`}
								style="margin-top:0.5em"
							>
								<button
									type="submit"
									class="pure-button"
									disabled={!googleTasks.enabled}
								>
									Refresh
								</button>
							</form>
							<p class="form-hint">
								It's not typically necessary to run sync or refresh manually. Sync is ran automatically after every request to fetch the calendar. If you complete or delete a task, it stays that way. But, refresh starts fresh, recreating all tasks from the calendar feed. Only run this if you run into issues.
							</p>
							<form
								method="post"
								action={`/dashboard/google/disconnect${betaQuery}`}
								style="margin-top:0.5em"
							>
								<button type="submit" class="pure-button">
									Disconnect Google
								</button>
							</form>
							<p class="form-hint">
								Disconnecting deletes the access this app has stored and stops
								all syncing. Task lists and tasks already created stay in your
								Google account. To also remove this app's access on Google's
								side, visit{' '}
								<a
									href="https://myaccount.google.com/permissions"
									target="_blank"
									rel="noreferrer"
								>
									your Google account permissions
								</a>
								.
							</p>
						</>
					) : (
						<>
							<p>
								Connect a Google account to mirror every Canvas event in your
								enabled courses into Google Tasks. Each task keeps its full
								deadline in its notes and is due ahead of time, and tasks are
								created, moved and removed to match your Canvas feed.
							</p>
							<form
								method="post"
								action={`/dashboard/google/connect${betaQuery}`}
							>
								<button type="submit" class="pure-button pure-button-primary">
									Connect Google
								</button>
							</form>
						</>
					)}
				</section>
			) : null}

			<section>
				<h2>Output Calendars</h2>
				{props.outputs.length === 0 ? (
					<p>
						First, load a Canvas calendar URL.
					</p>
				) : (
					<div>
						<p>
							Create an output calendar for each view that you'd like to have on your original calendar.
							For example, you can create a separate "Class" and "TA" calendar.
							The same class can appear in more than one calendar.
						</p>
						{props.outputs.map((output) => {
							const enabled = new Set(output.enabledCodes)
							return (
								<div class="output-calendar">
									<div class="output-calendar-bar">
										<h3>{output.name}</h3>
										{canRemove ? (
											<form
												method="post"
												action={`/dashboard/outputs/${output.id}/delete${betaQuery}`}
											>
												<button type="submit" class="pure-button">
													Remove calendar
												</button>
											</form>
										) : null}
									</div>
									<form
										method="post"
										action={`/dashboard/outputs/${output.id}${betaQuery}`}
										class="pure-form pure-form-stacked"
									>
										<fieldset>
											<label style="margin-bottom: 1em">
												Name
												<input
													class="pure-input-1"
													type="text"
													name="name"
													maxlength={80}
													value={output.name}
												/>
											</label>
											<span>Choose Calendars</span>
											{props.courses.length === 0 ? (
												<p>No class codes were found in that Canvas feed.</p>
											) : (
												props.courses.map((course) => (
													<label class="pure-checkbox">
														<input
															type="hidden"
															name="code"
															value={course.code}
														/>
														<input
															type="checkbox"
															name="enabled"
															value={course.code}
															checked={enabled.has(course.code)}
														/>{' '}
														{course.code}
													</label>
												))
											)}
											{props.courses.length > 0 && enabled.size === 0 ? (
												<p>
													No classes selected. This calendar will have no events
													until you check at least one class and save.
												</p>
											) : null}
											<p style="margin-bottom: 0">Other Options</p>
											<label class="pure-checkbox">
												<input
													type="checkbox"
													name="canvasLink"
													checked={output.addCanvasLink}
												/>{' '}
												Modify event description to add Canvas link
												(recommended)
											</label>
											<label style="margin-top:1em">
												Subscribe URL
												<span
													class="subscribe-url"
													style="display:flex;flex-wrap:nowrap;align-items:stretch;gap:0.5em"
												>
													<input
														type="url"
														readonly
														value={output.feedUrl}
														style="flex:1 1 0%;min-width:0;width:0;margin:0;box-sizing:border-box"
													/>
													<button
														type="button"
														class="pure-button"
														style="flex:0 0 auto;width:auto;margin:0"
														onclick="const input=this.previousElementSibling;navigator.clipboard.writeText(input.value).then(()=>{const label=this.textContent;this.textContent='Copied';setTimeout(()=>this.textContent=label,1500)})"
													>
														Copy
													</button>
												</span>
											</label>
											<div class="form-actions" style="margin-top: 0.5em">
												<button
													type="submit"
													class="pure-button pure-button-primary"
												>
													Save calendar
												</button>
											</div>
										</fieldset>
									</form>
								</div>
							)
						})}
						{canAdd ? (
							<form method="post" action={`/dashboard/outputs${betaQuery}`}>
								<button type="submit" class="pure-button button-secondary" style="margin-top: 0.5em;">
									Add another calendar
								</button>
							</form>
						) : null}
					</div>
				)}
			</section>
		</Layout>
	)
}
