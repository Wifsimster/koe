# Bug report repro

`control-koe repro` turns a stored widget bug report into a replay on the local instance. It reads the `tickets` row from the throwaway DB, or a JSON export with `--from-file`. It opens a fresh browser context that matches the reporter's captured environment, loads the captured page path on the fake host page as the same reporter id, optionally runs agent-written steps, and records console, network and screenshots into a repro bundle. Koe captures the environment, not the actions, so the replay rebuilds the starting conditions and the agent or a human judges whether the bug shows.

## Sub-features

- `repro-load`: from the DB (`repro <ticketId>`) or from a file (`repro --from-file x.json`). The file can be a `tickets` row (snake_case), the admin API shape (camelCase), a widget response envelope `{ok,data}`, or a previous bundle's `report.json`.
- `repro-environment`: a new context with `viewport`, `screen`, `userAgent`, `locale` (from `language`), `timezoneId` and `deviceScaleFactor`, taken from `metadata`.
- `repro-url`: `metadata.url` is re-targeted onto `http://localhost:38788` (path, query and hash kept). `originRewritten` records a foreign origin. The referrer is replayed when it was captured.
- `repro-identity`: the host page renders as the reporter id (`koe_verify_as` cookie), so the widget shows that user's "My requests".
- `repro-steps`: `--steps-file` holds a JSON action list (`goto`, `click`, `fill`, `press`, `wait`) with a screenshot after each step. The report only has free-text `steps_to_reproduce`, which `repro` copies into `manualStepsFromReport` for the agent to translate.
- `repro-bundle`: `report.json`, `plan.json`, `console.json`, `network.json`, `landed.png`, `step-N.png` and `summary.json`. The summary holds `envMatch`, `consoleErrors`, `failedRequests`, `missingFromReport` and `notCapturedByKoe`.

## How to get to it (user POV)

- An agent or developer receives a bug ticket (from the dashboard, the notification email, or a DB/API export) and wants to see it happen locally.
- The ticket id comes from the dashboard URL `/admin/tickets/<id>`, from `$C tickets --kind bug`, or from `widget bug` output (`ticketId`).

## Driving it with control-koe

Preconditions:

- A fresh `$C launch` and `$C doctor` exits 0.
- A bug ticket in the local DB. For an external report, export it as JSON first.

- **Create a report through the real widget.** Run `$C widget bug --title "Export CSV does nothing" --description "Clicked Export CSV on Projects, no file downloaded." --steps "1. Open Projects\n2. Click Export CSV" --trigger-error`. Note the `ticketId`.
- **Plan.** Run `$C repro <ticketId> --dry-run`. `plan.target` is `/projects?tab=export`, `plan.context` holds the captured viewport, UA, locale, timezone and DPR, and `manualSteps` holds the two free-text lines.
- **Translate the steps.** Write `steps.json` as `[{"click":{"role":"button","name":"Export CSV"}},{"wait":500}]`. Keep it in the evidence dir.
- **Replay.** Run `$C repro <ticketId> --steps-file steps.json`. The result has `envMatch` all true, `replayedUrl` ending with `/projects?tab=export`, and every `stepsReplayed[].ok` true. `consoleErrors` contains `[acme] Export CSV failed: TypeError: rows.map is not a function`. That is the reported bug, observed. `landed.png` and `step-1.png` show the page as the reporter saw it.
- **Foreign report, from a file.** Take a report captured on another device and domain, for example an iPhone UA, viewport 390x844, `fr-FR`, `Europe/Paris`, DPR 3, `url: https://app.customer.example/projects?tab=export#top`. The file can be the widget's `{ok,data}` response shape. Run `$C repro --from-file report.json --steps-file steps.json`. `originRewritten` is `{captured: "https://app.customer.example", replayedOn: "http://localhost:38788"}`, `observed` reports 390x844, `fr-FR`, `Europe/Paris` and DPR 3, and `landed.png` shows the mobile layout. On `1cbae34` the closed launcher sits flush against the bottom-left edge in that layout (see Gotchas).

## What's missing for full auto-reproduction

These are product suggestions only; nothing here changes product code. Each item names a field Koe would need to capture at report time, and what it would unlock.

1. **Action trail** (`metadata.breadcrumbs`: last N clicks, inputs (redacted), route changes, with timestamps and target role/name). It would make `--steps-file` unnecessary, because `repro` could replay the actions directly. Today `steps_to_reproduce` is free text, and the agent must translate it.
2. **Console log buffer** (`metadata.console`: last N `error`/`warn` entries plus unhandled rejections). Without it there is no ground truth: `repro` observes errors, but cannot compare them to what the reporter got.
3. **Network failures** (`metadata.network`: failed or 4xx/5xx requests, with method, URL without query values, status and timing). The failing backend call is often the bug itself.
4. **Screenshot.** The `tickets.screenshot_url` column and the dashboard "Screenshot" section exist, and the API accepts `screenshotUrl`, but the widget never captures or uploads one. That leaves no visual ground truth to diff `landed.png` against.
5. **Expected and actual behavior.** The columns and the API fields exist, but the widget form has no inputs for them. Repro cannot state a pass/fail oracle.
6. **Host app context** (`metadata.app`: host app version/release, current route name and params, feature flags, the user's plan or role). The host passes these through `reporter.metadata`, which the API accepts and then drops on insert. Storing that field is the cheapest fix.
7. **Widget version** (`metadata.widgetVersion`). Without it, a widget regression cannot be told apart from a host bug.
8. **Precise moment** (`metadata.capturedAt` exists). Add the page load time and time-on-page, so time-dependent bugs (timers, token expiry) can be replayed.
9. **Input capability** (`navigator.maxTouchPoints`, `matchMedia('(pointer: coarse)')`). Without it `repro` cannot set Playwright's `hasTouch`/`isMobile`: an iPhone report replays with the iPhone UA and viewport but mouse input, and touch-only bugs do not show.
10. **Privacy-safe URL.** `metadata.url` keeps the full query string. A replay needs the path and the parameter names, not the secret values, so redact values server-side.

## Gotchas

- The replay targets the fake host page, not the customer's real app. It proves the environment-plus-URL replay mechanics and, on the host page, the planted "Export CSV" bug. On a real integration, the same bundle shape applies once a staging host page is pointed at it.
- `repro` uses its own browser context, not the shared page, so `$C console` does not include the replay's messages. They are in the bundle's `console.json`.
- `metadata.timezone` can be empty on old mobile browsers (the API coerces it to `''`). `repro` then keeps the daemon's timezone and lists `metadata.timezoneId` under `missingFromReport`.
- A bug report from an anonymous widget user replays as reporter `anonymous`. It has no "My requests".
- `repro` refuses feature tickets (`kind=feature`).
- **Mobile launcher position (product bug on `1cbae34`).** At 480px wide or less, the `@media (max-width: 480px)` rule in `packages/widget/src/styles.css` pins `.koe-root` to `left:0; right:0; bottom:0` whether the panel is open or closed. The closed launcher therefore ignores `position` and sits flush in the bottom-left corner. The rule meant to keep it in place (`.koe-panel-shell ~ button[aria-expanded]`) never matches, because `KoeWidget` renders either the panel or the launcher, never both. Any mobile `repro` shows it in `landed.png`.
