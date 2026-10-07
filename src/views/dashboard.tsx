import { MAX_OUTPUT_CALENDARS } from '../db/schema.ts'
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
	tasksEnabled: boolean
	tasksListName: string | null
	tasksLastSyncAt: Date | null
	tasksLastSyncError: string | null
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

	return (
		<Layout
			title="Dashboard"
			nav={<UserNav email={props.email} isAdmin={props.isAdmin} />}
		>
			<section>
				<h1>Canvas Calendar Fix</h1>
				<p>
					Paste the ICS feed from Canvas, then create up to four output calendars for use in
					Google Calendar, Outlook, or other calendar apps.
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
								Connected. Each output calendar below can mirror its assignments
								into its own Google task list. Tasks are created once, when a
								calendar app refreshes the feed or when you use Sync now; after
								that they are yours to edit, complete or delete, and this app
								will not touch or re-add them.
							</p>
							<form
								method="post"
								action={`/dashboard/google/disconnect${betaQuery}`}
							>
								<button type="submit" class="pure-button">
									Disconnect Google
								</button>
							</form>
							<p class="form-hint">
								Disconnecting deletes the access this app has stored and stops
								all syncing. Task lists and tasks already created stay in your
								Google account, here and if you delete an output calendar. To
								also remove this app's access on Google's side, visit{' '}
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
								Connect a Google account to turn Canvas assignments into Google
								Tasks. An assignment is any event due just before midnight, or
								any event shorter than 20 minutes.
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
											{props.googleConfigured && beta ? (
												<>
													<label class="pure-checkbox">
														<input
															type="checkbox"
															name="tasksEnabled"
															checked={output.tasksEnabled}
															disabled={!props.googleConnected}
														/>{' '}
														Sync assignments in this calendar to Google Tasks
													</label>
													<label style="margin-top:0.5em">
														Google task list name
														<input
															class="pure-input-1"
															type="text"
															name="tasksListName"
															maxlength={80}
															value={output.tasksListName ?? ''}
															placeholder={output.name}
														/>
													</label>
													<p class="form-hint">
														Leave blank to use the calendar name.
														{output.tasksEnabled ? (
															<>
																{' '}
																Last synced:{' '}
																{formatPacific(output.tasksLastSyncAt)}.
															</>
														) : null}
													</p>
													{output.tasksLastSyncError ? (
														<ErrorBanner
															message={`Last Google Tasks sync failed: ${output.tasksLastSyncError}`}
														/>
													) : null}
												</>
											) : null}
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
												{props.googleConfigured && beta ? (
													<button
														type="submit"
														class="pure-button"
														formaction={`/dashboard/outputs/${output.id}/sync${betaQuery}`}
														formnovalidate
														disabled={
															!props.googleConnected || !output.tasksEnabled
														}
													>
														Sync now
													</button>
												) : null}
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
