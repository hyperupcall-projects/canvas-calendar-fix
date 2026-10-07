import { SUPPORT_REQUEST_URL } from '../lib/util.ts'
import { ErrorBanner, Layout } from './layout.tsx'

export function SignInPage(props: { error?: string | null }) {
	return (
		<Layout title="Sign in">
			<section>
				<h1>Sign in</h1>
				<p>Enter your school email to receive a sign-in link.</p>
				<ErrorBanner message={props.error} />
				<form
					method="post"
					action="/sign-in"
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
							placeholder="you@university.edu"
						/>
					</label>
					<button type="submit" class="pure-button pure-button-primary">
						Email me a sign-in link
					</button>
				</form>
				<p class="form-hint">
					Don't see your school? Request it in our{' '}
					<a href={SUPPORT_REQUEST_URL} target="_blank" rel="noreferrer">
						support group
					</a>
					.
				</p>
			</section>
		</Layout>
	)
}

export function CheckEmailPage(props: { email: string }) {
	return (
		<Layout title="Check your email">
			<section>
				<h1>Check your inbox</h1>
				<p>
					If <strong>{props.email}</strong> can receive mail, a sign-in link is
					on the way. Open it to continue to your dashboard.
				</p>
				<p>
					<a href="/sign-in">Use a different email</a>
				</p>
			</section>
		</Layout>
	)
}
