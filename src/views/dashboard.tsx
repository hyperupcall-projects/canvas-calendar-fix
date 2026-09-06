import { MAX_OUTPUT_CALENDARS } from '../db/schema.ts'
import { ErrorBanner, Layout, SuccessBanner, UserNav } from './layout.tsx'

export type DashboardCourse = {
	code: string
}

export type DashboardOutput = {
	id: string
	name: string
	feedUrl: string
	enabledCodes: string[]
}

export function DashboardPage(props: {
	email: string
	sourceUrl: string
	courses: DashboardCourse[]
	outputs: DashboardOutput[]
	error?: string | null
	success?: string | null
}) {
	const canAdd =
		props.outputs.length > 0 && props.outputs.length < MAX_OUTPUT_CALENDARS
	const canRemove = props.outputs.length > 1

	return (
		<Layout title="Dashboard" nav={<UserNav email={props.email} />}>
			<section>
				<h1>Your Canvas calendar</h1>
				<p>
					Paste the ICS feed from Canvas, create up to four class subsets, then
					subscribe to each private link below in Apple Calendar, Google
					Calendar, or Outlook.
				</p>
				<ErrorBanner message={props.error} />
				<SuccessBanner message={props.success} />

				<h2>1. Canvas calendar URL</h2>
				<form
					method="post"
					action="/dashboard/source"
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
								formaction="/dashboard/source/reset"
								formnovalidate
							>
								Reset calendar URL
							</button>
						) : null}
					</div>
				</form>
			</section>

			<section>
				<h2>2. Output calendars</h2>
				{props.outputs.length === 0 ? (
					<p>
						Load a Canvas calendar URL to create your first private calendar.
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
												action={`/dashboard/outputs/${output.id}/delete`}
											>
												<button type="submit" class="pure-button">
													Remove calendar
												</button>
											</form>
										) : null}
									</div>
									<form
										method="post"
										action={`/dashboard/outputs/${output.id}`}
										class="pure-form pure-form-stacked"
									>
										<fieldset>
											<label>
												Name
												<input
													class="pure-input-1"
													type="text"
													name="name"
													maxlength={80}
													value={output.name}
												/>
											</label>
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
											<label>
												Subscribe URL
												<input
													class="pure-input-1"
													type="url"
													readonly
													value={output.feedUrl}
												/>
											</label>
											<p>
												This address is random and should stay private. Anyone
												with it can read this filtered calendar.
											</p>
											<button
												type="submit"
												class="pure-button pure-button-primary"
											>
												Save calendar
											</button>
										</fieldset>
									</form>
								</div>
							)
						})}
						{canAdd ? (
							<form method="post" action="/dashboard/outputs">
								<button type="submit" class="pure-button">
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
