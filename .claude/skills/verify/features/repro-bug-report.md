# Bug report repro

`control-koe repro` turns a stored widget bug report into a replay on the local instance, and says whether the bug reproduced. It reads the `tickets` row from the throwaway DB, or a JSON export with `--from-file`. It opens a fresh browser context that matches the reporter's captured environment, loads the captured page path on the fake host page as the same reporter id, replays the reporter's recorded action trail (or agent-written steps), and records console, network and screenshots into a repro bundle. It then compares the console entries and failed requests captured at report time with the replay's, and sets `reproduced`.

## Sub-features

- `repro-load`: from the DB (`repro <ticketId>`) or from a file (`repro --from-file x.json`). The file can be a `tickets` row (snake_case), the admin API shape (camelCase), a widget response envelope `{ok,data}`, or a previous bundle's `report.json`.
- `repro-environment`: a new context with `viewport`, `screen`, `userAgent`, `locale` (from `language`), `timezoneId`, `deviceScaleFactor`, and `hasTouch`/`isMobile` (from `metadata.input`), taken from `metadata`.
- `repro-url`: `metadata.url` is re-targeted onto `http://localhost:38788` (path, query and hash kept; redacted values stay empty). `originRewritten` records a foreign origin. The referrer is replayed when it was captured.
- `repro-identity`: the host page renders as the reporter id (`koe_verify_as` cookie), so the widget shows that user's "My requests".
- `repro-auto`: without `--steps-file`, a report with `metadata.breadcrumbs` is replayed from its trail (`stepsSource: "metadata.breadcrumbs"`). It starts at the first recorded page, clicks by role and exact accessible name (or `data-testid`), follows later navigations, and skips field edits, because their values are never captured.
- `repro-steps`: `--steps-file` holds a JSON action list (`goto`, `click`, `fill`, `press`, `wait`) with a screenshot after each step. It wins over the trail. For an older report without a trail, translate `manualStepsFromReport` (the free-text `steps_to_reproduce`) into it.
- `repro-verdict`: `consoleMatch` and `networkMatch` list each captured entry with `seenInReplay` (both sides redacted the same way). `reproduced` is true when every step ran and every captured entry reappeared, false otherwise, and null when the report has no ground truth.
- `repro-bundle`: `report.json`, `plan.json`, `console.json`, `network.json`, `landed.png`, `step-N.png` and `summary.json`. The summary holds `envMatch` (touch included), `oracle` (`expected`, and `actual` = description), `screenshotUrl`, `versions`, `reporterMetadata`, `consoleErrors`, `failedRequests`, `missingFromReport` and `notCaptured`.

## How to get to it (user POV)

- An agent or developer receives a bug ticket (from the dashboard, the notification email, or a DB/API export) and wants to see it happen locally.
- The ticket id comes from the dashboard URL `/admin/tickets/<id>`, from `$C tickets --kind bug`, or from `widget bug` output (`ticketId`).

## Driving it with control-koe

Preconditions:

- A fresh `$C launch` and `$C doctor` exits 0.
- A bug ticket in the local DB. For an external report, export it as JSON first.

- **Create a report through the real widget.** Run `$C widget bug --search "jane.secret@acme.test confidential" --title "Export CSV does nothing" --description "Clicked Export CSV on Projects, no file downloaded." --expected "A projects.csv download starts." --trigger-error`. Note the `ticketId`. `$C tickets --id <id>` shows `metadata.breadcrumbs` (navigation, `input` on "Search projects" without its text, `click` on "Export CSV"), `metadata.console` (the `rows.map` error) and `metadata.network` (`GET /api/export?format=&token= -> 500`). Grep the row for the search text: it is absent.
- **Plan.** Run `$C repro <ticketId> --dry-run`. `stepsSource` is `metadata.breadcrumbs`, `plan.target` is `/projects?tab=export`, the steps are a skipped field edit and a click on "Export CSV", and `plan.notCaptured` is `[]`.
- **Auto-replay.** Run `$C repro <ticketId>`. The result has `reproduced: true`, `envMatch` all true, and `consoleMatch`/`networkMatch` entries all `seenInReplay: true`. `oracle` holds the expected and actual behavior. `landed.png` and `step-2.png` show the page.
- **Negative control.** Change the captured console message in the bundle's `report.json` and run `$C repro --from-file <it>`. `reproduced` is false and that `consoleMatch` entry has `seenInReplay: false`.
- **Manual steps.** For a report without a trail, write `steps.json` as `[{"click":{"role":"button","name":"Export CSV"}},{"wait":500}]` and run `$C repro <ticketId> --steps-file steps.json`.
- **Foreign report, from a file.** Take a report captured on another device and domain, for example an iPhone UA, viewport 390x844, `fr-FR`, `Europe/Paris`, DPR 3, `url: https://app.customer.example/projects?tab=export#top`. The file can be the widget's `{ok,data}` response shape. Run `$C repro --from-file report.json --steps-file steps.json`. `originRewritten` is `{captured: "https://app.customer.example", replayedOn: "http://localhost:38788"}`, `observed` reports 390x844, `fr-FR`, `Europe/Paris` and DPR 3, and `landed.png` shows the mobile layout, with the closed launcher in its configured bottom-right corner. Add `{"click":{"role":"button","name":"Support","exact":true}}` to the steps to see the bottom sheet.

## What's missing for full auto-reproduction

The original gap list, with its status. What remains: field values (never captured, by design), actions inside cross-origin iframes or before the widget mounted, app state beyond what the host passes in `user.metadata`, and a Koe-side screenshot capture and upload.

1. **Action trail.** Done: `metadata.breadcrumbs`, the last 30 clicks, field edits (field name only) and navigations. `repro` replays them.
2. **Console log buffer.** Done: `metadata.console`, the last 20 `console.error`/`console.warn` calls, uncaught errors and unhandled rejections, all redacted.
3. **Network failures.** Done: `metadata.network`, the last 20 failed or 4xx/5xx `fetch`/XHR requests, with redacted URLs. The widget's own API calls are excluded.
4. **Screenshot.** Done: the host's `captureScreenshot` hook uploads to the host's storage and Koe stores the URL. Koe itself still has no capture or upload flow.
5. **Expected and actual behavior.** Done: "What did you expect?" fills `expected_behavior`; the description is the actual behavior. `repro` reports both as `oracle`.
6. **Host app context.** Done: `WidgetConfig.app` (`metadata.app`) and `user.metadata` (`metadata.reporterMetadata`). Route params and feature flags travel through `user.metadata` if the host adds them.
7. **Widget version.** Done: `metadata.widgetVersion` (`git describe` at build time). The git tag is not a turbo input. A turbo cache hit (worktrees share the cache) replays a `dist/` with an older stamp: a run on `0265681` reported `v1.36.0-10-gc9995eb` instead of `v1.37.0`. Before you trust the version, run `pnpm turbo run build --filter=@wifsimster/koe --force`.
8. **Precise moment.** Done: `capturedAt` plus `pageLoadedAt`.
9. **Input capability.** Done: `metadata.input`; `repro` sets `hasTouch`/`isMobile` and reports `envMatch.touch`.
10. **Privacy-safe URL.** Done: query and hash values are redacted by the widget and again by the API.

## Gotchas

- The replay targets the fake host page, not the customer's real app. It proves the environment-plus-URL replay mechanics and, on the host page, the planted "Export CSV" bug. On a real integration, the same bundle shape applies once a staging host page is pointed at it.
- `repro` uses its own browser context, not the shared page, so `$C console` does not include the replay's messages. They are in the bundle's `console.json`.
- `metadata.timezone` can be empty on old mobile browsers (the API coerces it to `''`). `repro` then keeps the daemon's timezone and lists `metadata.timezoneId` under `missingFromReport`.
- A bug report from an anonymous widget user replays as reporter `anonymous`. It has no "My requests".
- `repro` refuses feature tickets (`kind=feature`).
- **Mobile launcher position.** On `1cbae34` and up to `d030aa8`, the `@media (max-width: 480px)` rule pinned `.koe-root` to `left:0; right:0; bottom:0` whether the panel was open or closed, so the closed launcher sat flush in the bottom-left corner. The rule now targets `.koe-root[data-open='true']` only (`KoeWidget` sets `data-open`). A mobile `repro` `landed.png` shows the launcher in its corner.
