# Canvas Calendar Chooser

Filter a CSUMB Canvas calendar feed down to the classes you actually want, then subscribe to up to four private ICS URLs in your own calendar app.

Only `@csumb.edu` emails can sign in. There are no user passwords: you enter your email and receive a one-time sign-in link.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `BETTER_AUTH_SECRET` to a long random string.
3. Set `RESEND_API_KEY` and `RESEND_FROM` to a Resend sender that can mail `@csumb.edu` addresses.
4. Optionally change `ADMIN_PASSWORD` (default is in `.env.example`; quote it if it contains `#`).
5. Install and run:

```bash
npm install
npm test
npm run dev
```

The app listens on `http://localhost:3000` by default.

## Canvas calendar URL

In Canvas: **Calendar** → **Calendar Feed** (or **ICal** / **Calendar subscription**) → copy the `webcal`/`https` link. It should look like:

`https://csumb.instructure.com/feeds/calendars/user_....ics`

Paste that on `/dashboard`. The app reads `SUMMARY` values that end with a class code in brackets, for example `08/24/26 [CST463-01_2264]`.

Each output calendar is an independent subset of your classes and gets its own `/feed/<random-token>.ics` URL. Anyone with a URL can read that filtered calendar, so treat each one like a password.

## Admin

Open `/admin`, sign in with `ADMIN_PASSWORD`, and review accounts. Column headers and the sort form reload the page with a new order; there is no client JavaScript.
