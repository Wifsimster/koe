# Widget bug report

A user of a customer's SaaS app opens the Koe launcher (bottom-right "Support" button), picks "Report a bug", and fills in a title, "What happened?", optionally "How to reproduce", and (only when the host did not pass `user.email`) an email. On submit, the widget attaches browser metadata from `captureBrowserMetadata()` (`packages/shared/src/metadata.ts`) and POSTs to `/v1/widget/bugs`. The API checks the host-signed identity, inserts a `tickets` row (`kind=bug`, `status=open`, `priority=medium`), and the panel shows "Thanks — your report has been received.".

## Sub-features

- `bug-launcher`: the "Support" button opens the panel (`dialog "How can we help?"`); Escape or "Close" closes it.
- `bug-form`: fields "Title" and "What happened?" (required), "How to reproduce", and "Email · optional" (hidden when the host passed `user.email`).
- `bug-validation`: an empty title or description shows "Please fill this out" under the field, and nothing is sent.
- `bug-metadata`: the row's `metadata` jsonb holds `userAgent`, `url` (full href including the query), `referrer`, `viewport`, `screen`, `language`, `timezone`, `devicePixelRatio` and `capturedAt`.
- `bug-identity`: `X-Koe-User-Hash` (v1 HMAC) or `X-Koe-Identity-Token` (v2) sets `reporter_verified=true`. With `requireIdentityVerification=true`, an unsigned call returns 401.
- `bug-success`: the success state, with a "My requests" call to action for identified users.
- `bug-errors`: network errors, 429 and 401 map to inline `role=alert` messages.

## How to get to it (user POV)

- Any host page path that embeds the widget: the "Support" launcher, then the "Report a bug" card.
- A host that enables only `features: { bugs: true }` skips the picker and lands on the form (`soloEnabledIntent`).
- The React package (`<KoeWidget>`) renders the same component. The harness uses the standalone IIFE build.

## Driving it with control-koe

Preconditions:

- A fresh `$C launch` (default `--embed same-origin`) and `$C doctor` exits 0.

- **Open.** Run `$C widget open --path /projects`. The ARIA output shows `dialog "How can we help?"` with the buttons "Report a bug", "Suggest an idea", "Browse ideas" and "My requests".
- **Submit.** Run `$C widget bug --title "Export CSV does nothing" --description "Clicked Export CSV on Projects, no file downloaded." --steps "1. Open Projects\n2. Click Export CSV" --trigger-error`. The result has `response.status: 201`, `successShown: true`, `ticketId`, and `dbRow.reporter_verified: true`. `dbRow.metadata.url` ends with `/projects?tab=export`. `widget-bug-filled.png` shows the filled form; `widget-bug-result.png` shows the success text.
- **Second read.** Run `$C tickets --id <ticketId>` for the stored row. Then run `$C login` and `$C inbox --expect <ticketId>`: `expect.inApi` and `expect.visibleOnPage` must both be true.
- **Validation.** Run `$C widget open`, then `$C click --role button --name "^Report a bug"`, then `$C click --role button --name "^Send bug report$"`. The intent cards' accessible names include their hint text, so anchor only the start. `$C snapshot --selector dialog` shows `textbox "Title Please fill this out"` and `textbox "What happened? Please fill this out"`. `$C network-log --filter /v1/widget/bugs` has no new POST.
- **Identity rejection (API-level, not UI proof).** POST to `localhost:38788/v1/widget/bugs` with `X-Koe-Project-Key: acme-verify`, `Origin: http://localhost:38788` and a valid body, using `curl`. Without a hash it returns 401 "Missing X-Koe-Identity-Token or X-Koe-User-Hash header". With `X-Koe-User-Hash: 00` it returns 401 "Identity hash mismatch". With `-d '{}'` it returns 422 `validation_failed`.
- **Cross-origin.** Run `$C launch --embed cross-origin --origins allowlist`, then the same `widget bug`. It returns `response.status: 201` and a `dbRow`, and `doctor` reports `widgetPreflightAllowsHost: true`.
- **Disallowed origin.** On the same instance, run `$C widget bug --host-origin http://127.0.0.1:38788 --title "x" --description "y"`. It returns `ok: false` with `widgetAlert: "Network error — check your connection"`, `$C console --level error` shows "blocked by CORS policy", and `$C tickets --kind bug` has no new row. A `curl` POST with `Origin: http://127.0.0.1:38788` and `X-Koe-Project-Key: acme-verify` returns 403 `origin_not_allowed`.

## Gotchas

- Before the CORS fix (`1cbae34`), cross-origin embeds could not submit at all: `widgetCors` answered a preflight only when it carried the `X-Koe-Project-Key` value, which browsers never send on `OPTIONS`. Verify CORS changes with `--embed cross-origin`, `--host-origin` and `doctor`'s `widgetPreflightAllowsHost`.
- The widget never sends `screenshotUrl`, `expectedBehavior` or `actualBehavior`. The API accepts them and the dashboard renders a Screenshot section, but the form has no such fields. Do not expect them in the row.
- `reporter.metadata` and `reporter.avatarUrl` pass the Zod schema but are not stored: the insert keeps only id, name and email.
- `metadata.url` stores the full URL, query string included. If a host app puts tokens in URLs, they land in Koe.
- The response body echoes the full row (reporter email, metadata) back to the browser.
- The email field disappears when the host passes `user.email`, which the harness does. To test the field, it needs a host user without an email. The harness has no flag for that yet.
- Rate limit: a burst of 30, then 10/min per project and IP. After a 429, relaunch rather than wait.
