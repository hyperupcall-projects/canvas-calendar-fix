# Canvas Calendar Fix

See it in action: https://www.tella.tv/video/canvas-calendar-fix-9s5n.

## Google Tasks (optional)

Each output calendar can mirror its assignments into its own Google task list. Leave `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` unset and the feature stays hidden; the rest of the app is unaffected.

To enable it:

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Google Tasks API**.
2. On the OAuth consent screen, add the `https://www.googleapis.com/auth/tasks` scope.
3. Create an **OAuth client ID** of type *Web application* with this authorized redirect URI:

    `http://localhost:3000/api/auth/callback/google`

    In production use your real origin, for example `https://example.com/api/auth/callback/google`.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.

Then press **Connect Google** on `/dashboard` and tick *Sync assignments in this calendar to Google Tasks* on each output calendar you want mirrored. Every calendar gets its own list, named independently of the calendar; leave the name blank to reuse the calendar name. **Sync now** is greyed out until the toggle is saved.

### When it syncs, and what it will not touch

A sync runs whenever a calendar app fetches the feed, at most once every 15 minutes, and whenever you press **Sync now**. Generating the feed never waits on Google; the sync runs after the response goes out.

Each task is written once and then left alone. Syncing only ever creates the tasks that are missing, so anything you retitle, reschedule, complete or delete stays the way you left it, and the app will not add it back. Nothing is ever deleted on your behalf, including assignments that disappear from Canvas and the task list belonging to an output calendar you delete.

That works without a mapping table on this side: each task's notes end with a marker such as `[canvas:event-assignment-642309]`, which is how a later sync recognizes the task as already created. Editing the notes is fine as long as that marker survives. Deleting it will get you a second copy of the task on the next sync.

### How an assignment is recognized

Canvas does not mark which feed events are assignments, so they are found by their timing: anything starting at or after 11:00 PM Pacific, which is where an 11:59 PM deadline lands, or any timed event shorter than 20 minutes, which is how Canvas emits a due instant. All-day events and normal class meetings are skipped, so a genuinely short meeting on a synced calendar will be mistaken for an assignment.

Google Tasks keeps only the date of a deadline and drops the time, so each task lands on the Pacific day the work is due and the exact time goes in the task notes.

### Disconnecting

**Disconnect Google** deletes the tokens this app stored and stops all syncing. Task lists and tasks already created stay in your Google account, because they may hold your own notes and completed items. Revoking the app's access on Google's side is separate, at [your Google account permissions](https://myaccount.google.com/permissions).
