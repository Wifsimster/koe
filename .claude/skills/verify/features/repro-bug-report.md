# Bug report repro

`control-koe repro` turns a stored widget bug report into a replay on the local instance. It reads the `tickets` row from the throwaway DB, or a JSON export with `--from-file`. It opens a fresh browser context that matches the reporter's captured environment, loads the captured page path on the fake host page as the same reporter id, optionally runs agent-written steps, and records console, network and screenshots into a repro bundle. Koe captures the environment, not the actions, so the replay rebuilds the starting conditions and the agent or a human judges whether the bug shows.

## Sub-features

- `repro-load`: from the DB (`repro <ticketId>`) or from a file (`repro --from-file x.json`). The file can be a `tickets` row (snake_case), the admin API shape (camelCase), a widget response envelope `{ok,data}`, or a previous bundle's `report.json`.
- `repro-environment`: a new context with `viewport`, `screen`, `userAgent`, `locale` (from `language`), `timezoneId`, `deviceScaleFactor`, and `hasTouch`/`isMobile` (from `metadata.input`), taken from `metadata`.
- `repro-url`: `metadata.url` is re-targeted onto `http://localhost:38788` (path, query and hash kept; redacted values stay empty). `originRewritten` records a foreign origin. The referrer is replayed when it was captured.
- `repro-identity`: the host page renders as the reporter id (`koe_verify_as` cookie), so the widget shows that user's "My requests".
- `repro-steps`: `--steps-file` holds a JSON action list (`goto`, `click`, `fill`, `press`, `wait`) with a screenshot after each step. The report only has free-text `steps_to_reproduce`, which `repro` copies into `manualStepsFromReport` for the agent to translate.
- `repro-bundle`: `report.json`, `plan.json`, `console.json`, `network.json`, `landed.png`, `step-N.png` and `summary.json`. The summary holds `envMatch` (touch included), `oracle` (`expected`, and `actual` = description), `screenshotUrl`, `versions`, `reporterMetadata`, `consoleErrors`, `failedRequests`, `missingFromReport` and `notCaptured`.

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
- **Foreign report, from a file.** Take a report captured on another device and domain, for example an iPhone UA, viewport 390x844, `fr-FR`, `Europe/Paris`, DPR 3, `url: https://app.customer.example/projects?tab=export#top`. The file can be the widget's `{ok,data}` response shape. Run `$C repro --from-file report.json --steps-file steps.json`. `originRewritten` is `{captured: "https://app.customer.example", replayedOn: "http://localhost:38788"}`, `observed` reports 390x844, `fr-FR`, `Europe/Paris` and DPR 3, and `landed.png` shows the mobile layout, with the closed launcher in its configured bottom-right corner. Add `{"click":{"role":"button","name":"Support","exact":true}}` to the steps to see the bottom sheet.

## What's missing for full auto-reproduction

These are product suggestions only; nothing here changes product code. Each item names a field Koe would need to capture at report time, and what it would unlock.

1. **Action trail** (`metadata.breadcrumbs`: last N clicks, inputs (redacted), route changes, with timestamps and target role/name). It would make `--steps-file` unnecessary, because `repro` could replay the actions directly. Today `steps_to_reproduce` is free text, and the agent must translate it.
2. **Console log buffer** (`metadata.console`: last N `error`/`warn` entries plus unhandled rejections). Without it there is no ground truth: `repro` observes errors, but cannot compare them to what the reporter got.
3. **Network failures** (`metadata.network`: failed or 4xx/5xx requests, with method, URL without query values, status and timing). The failing backend call is often the bug itself.
4. **Screenshot.** Done: the host's `captureScreenshot` hook uploads to the host's storage and Koe stores the URL. Koe itself still has no capture or upload flow.
5. **Expected and actual behavior.** Done: "What did you expect?" fills `expected_behavior`; the description is the actual behavior. `repro` reports both as `oracle`.
6. **Host app context.** Done: `WidgetConfig.app` (`metadata.app`) and `user.metadata` (`metadata.reporterMetadata`). Route params and feature flags travel through `user.metadata` if the host adds them.
7. **Widget version.** Done: `metadata.widgetVersion` (`git describe` at build time).
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
