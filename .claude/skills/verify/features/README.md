# Koe verification map

This directory is the maintained source for verifying the user-visible behavior of Koe. Read this index before you drive the app, then use the matching feature file as the recipe. `C=.claude/skills/verify/scripts/control-koe.mjs` throughout.

## Baseline preconditions

- `$C launch` returned `"ok": true` and `$C doctor` exits 0.
- The database is the throwaway `koe-verify-pg` container. It holds:
  - the project `acme-verify` (`requireIdentityVerification=true`)
  - two fake feature requests: "Dark mode for the reports page (fake seed)" with 3 votes, and "Export projects to CSV (fake seed)" with 0 votes
  - no bug reports
- The host page `http://localhost:38788` embeds the widget as `user-42` "Jane Fake" (`jane@acme-verify.test`), with a server-side HMAC `userHash`.
- The dashboard admin is `admin@koe-verify.test` / `verify-admin-pass-123`.
- Resend, Redis and secret-at-rest keys are empty. No third party is reachable from this instance.
- Never drive an instance that this run did not start.

## Driving conventions

- Start every recipe from a fresh `launch` unless its preconditions say otherwise. Votes toggle, so a second `widget vote` on the same row removes the vote.
- Prefer ARIA roles and accessible names over CSS. Widget strings come from `DEFAULT_LOCALE` (`packages/shared/src/types/widget.ts`). Dashboard strings are hard-coded English in `packages/dashboard/src/pages/*`. `$C snapshot --selector dialog` shows the widget panel only.
- Every command is literal: keep quoted names and flags unchanged.
- Use `--dry-run` first on anything that writes, when you only need to know what would happen.

## Proof and skip reporting

- Capture the user action and the resulting state: a before/after screenshot plus the HTTP response, not just the final screen.
- Every mutation needs a second, read-only view: `$C tickets --id <id>` (DB) and/or `$C inbox --expect <id>` (dashboard + admin API).
- Record the feature ID and entry point with every artifact. Evidence lives in `$KOE_EVIDENCE_DIR/<runId>/`, and `transcript.txt` has every command's JSON.
- Report an entry point you could not reach with the command you attempted and the unmet precondition. Never report it as verified through another path.

## Feature entry contract

Each feature file has an H1 and one paragraph, then exactly four H2s in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with control-koe` (opens with `Preconditions:`), `Gotchas`.

## Features

- [Widget bug report](./widget-bug-report.md) covers the launcher, the bug form, the captured browser metadata, identity verification, and the success state. Driven end to end on `1cbae34` (run `2026-10-03T21-35-28-340Z`), and the cross-origin failure reproduced in run `2026-10-03T21-38-02-734Z`.
- [Feature requests, voting and My requests](./widget-feature-voting.md) covers the idea form, "Browse ideas" with upvote toggling, and the "My requests" tab. Driven on `1cbae34`.
- [Dashboard inbox and triage](./dashboard-inbox-triage.md) covers admin login, the inbox list and filters, ticket detail, status and priority changes with the audit trail, and bulk actions. Login, inbox, ticket detail and a status change (with its audit event) driven on `1cbae34`.
- [Project setup and identity](./project-setup.md) covers onboarding and "New project", the one-time identity secret, allowed origins, and the HMAC `userHash` the host signs.
- [Bug report repro](./repro-bug-report.md) covers `control-koe repro`: replaying a stored bug report against the local instance, and what Koe does not capture for full auto-reproduction. Driven on `1cbae34`, from the DB and from a JSON file.
- [Live chat](./live-chat.md) is **not drivable**: it is not wired in the widget or the API. The file documents what exists.
