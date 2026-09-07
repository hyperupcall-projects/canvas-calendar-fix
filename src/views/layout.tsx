import { raw } from 'hono/html'

export function Layout(props: {
	title: string
	nav?: unknown
	children?: unknown
}) {
	return (
		<>
			{raw('<!DOCTYPE html>')}
			<html lang="en">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<title>{props.title}</title>
					<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
					<link
						rel="stylesheet"
						href="https://cdn.jsdelivr.net/npm/purecss@3.0.0/build/pure-min.css"
						integrity="sha384-X38yfunGUhNzHpBaEBsWLO+A0HDYOQi8ufWDkZ0k9e0eXz/tH3II7uKZ9msv++Ls"
						crossorigin="anonymous"
					/>
					<link rel="stylesheet" href="/styles.css" />
				</head>
				<body>
					<header class="pure-menu pure-menu-horizontal">
						<a class="pure-menu-heading pure-menu-link" href="/">
							Canvas Calendar Fix
						</a>
						{props.nav}
					</header>
					<main class="site-main">{props.children}</main>
				</body>
			</html>
		</>
	)
}

export function UserNav(props: { email: string }) {
	return (
		<ul class="pure-menu-list">
			<li class="pure-menu-item">
				<span class="pure-menu-link">{props.email}</span>
			</li>
			<li class="pure-menu-item">
				<form method="post" action="/sign-out">
					<button type="submit" class="pure-button">
						Sign out
					</button>
				</form>
			</li>
		</ul>
	)
}

export function ErrorBanner(props: { message?: string | null }) {
	if (!props.message) {
		return null
	}
	return (
		<p class="banner error" role="alert">
			{props.message}
		</p>
	)
}

export function SuccessBanner(props: { message?: string | null }) {
	if (!props.message) {
		return null
	}
	return (
		<p class="banner success" role="status">
			{props.message}
		</p>
	)
}
