# Dashboard inbox and triage

The single admin (credentials from env, argon2id hash, HMAC session cookie backed by `admin_sessions`) logs in at `/admin/login`. The admin lands on the inbox: ticket counts, the "Last ping from ..." heartbeat, search, a status filter, kind chips (All, Bugs, Ideas) and a ticket list. Opening a ticket shows its Description, Reproduction, Browser context (the raw metadata JSON), Screenshot, Notes, Activity, and side cards for State (Status and Priority selects), Visibility (public roadmap) and Reporter. Every mutation writes an `admin_ticket_events` row in the same transaction.

## Sub-features

- `admin-login`: the email and password form. 5 attempts/min per IP. A wrong password returns 401 "Invalid email or password".
- `inbox-list`: filters `?status=` (default `open`), `?kind=all|bug|feature`, `?q=` search, and `?sort=recent|votes`. Each row links to `/admin/tickets/<id>`.
- `inbox-bulk`: per-row checkboxes ("Select ticket "<title>"") or "Select all tickets on this page", then the "Mark as…" and "Priority…" selects behind a confirm dialog (POST `/v1/admin/projects/:key/tickets/bulk`).
- `ticket-detail`: the sections listed above, with metadata rendered as JSON.
- `ticket-status` / `ticket-priority`: the Radix selects in the State card. Each PATCH writes `status_changed` or `priority_changed`.
- `ticket-notes`: the private notes textarea, then "Save notes".
- `ticket-roadmap`: the Visibility toggle. It writes `roadmap_toggled` and publishes the ticket at `/r/<key>`.
- `ticket-activity`: the event timeline with per-event undo.
- `project-switcher`: the "Project <name>" button in the sidebar.

## How to get to it (user POV)

- `http://localhost:38787/admin/` redirects to `/admin/login?redirectTo=...` when logged out.
- After login: the sidebar "Inbox", the "Kōe Admin" logo link, and a row click opens the ticket.
- The URL `/admin/tickets/<id>` goes straight to a ticket.
- "Sign out" in the sidebar footer.

## Driving it with control-koe

Preconditions:

- A fresh `$C launch` and `$C doctor` exits 0.
- At least one widget ticket exists (`$C widget bug ...` prints its `ticketId`).

- **Login.** Run `$C login`. The result has `loginStatus: 200`, a `url` under `/admin/?kind=all&status=open...`, and `adminSessionsRows: 1`. `dashboard-after-login.png` shows the inbox.
- **Inbox.** Run `$C inbox --expect <ticketId>`. `api.status` is 200, and `expect.inApi` and `expect.visibleOnPage` are both true. `dashboard-inbox.png` shows the row with the bug glyph and "OPEN".
- **Detail.** Run `$C ticket <ticketId>`. `shows.title` and `shows.browserContext` are true; `shows.reproduction` is true when the report has steps (`widget bug --steps`), `null` otherwise. The full-page screenshot shows the metadata JSON.
- **Status change.** Run `$C ticket <ticketId> --set-status in_progress`. The result has `patchStatus: 200`, `statusAfter: "in_progress"`, and `auditEvents` holding `{kind: "status_changed", payload: {from: "open", to: "in_progress"}}`. Then `$C inbox --expect <ticketId>` fails under the default `--status open`, and passes with `--status all` or `--status in_progress`.
- **Bulk.** Run `$C click --role checkbox --name "Select ticket \"<title>\""`, then `$C snapshot` to find the "Mark as…" combobox and the confirm button. Read back with `$C tickets --id <id>`. This recipe is not scripted yet; prove each step with screenshots.
- **Logout.** Run `$C goto / --app dashboard`, then `$C click --role button --name "^Sign out$"`. The URL becomes `/admin/login?redirectTo=%2F`, and the `admin_sessions` count drops from 1 to 0: check `docker exec koe-verify-pg psql -U koe -d koe -Atc "select count(*) from admin_sessions"`.

## Gotchas

- The admin API mounts only when `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` are all set. If `doctor` shows `adminApiMounted: false`, the env is wrong.
- Cookies are `Secure` by default. The harness sets `ADMIN_COOKIES_SECURE=false` because it runs on plain http. A real HTTPS deploy must not.
- Mutating admin routes pass `requireSameOrigin` (`Sec-Fetch-Site`). Drive them from the dashboard page, not from the host page origin.
- The page has two nested `<main>` landmarks (`SidebarInset` and `AppShell`). Use `body` or role queries, not `locator('main')`, or Playwright's strict mode throws.
- The inbox defaults to `status=open`, so a resolved ticket disappears from the default view.
- The "Last ping from" heartbeat shows "unknown origin" under the default same-origin embed: GETs carry no `Origin` header.
