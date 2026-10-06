---
name: verify
description: Launch and drive Koe (embeddable support widget + admin dashboard, Hono API) like a user, on a throwaway local Postgres with fake data. The widget runs inside a fake customer SaaS page; the dashboard is driven as the single admin. Captures proof (screenshots, ARIA snapshots, API bodies, DB rows, console/network logs) and replays stored bug reports (`repro`). Use to prove any widget, API or dashboard change, or to reproduce a reported bug, before claiming it works.
---

# Verify Koe

Koe has three user surfaces, all covered here:

- **The widget**, embedded in a customer's SaaS page. A user reports a bug, suggests an idea, votes, or reads "My requests". The harness serves a fake host page at `http://localhost:38788` that loads the real standalone build (`packages/widget/dist/koe.iife.js`) the way the README's `<script>` snippet does. The host page's own "backend" signs the user id (HMAC `userHash`).
- **The admin dashboard**, at `http://localhost:38787/admin/`: log in, inbox, ticket detail, status changes, project creation.
- **The API** (`@koe/api`, Hono), at `http://localhost:38787`. It is driven through the two surfaces above, and read back through the DB.

Everything goes through one CLI, `control-koe`. Each call prints one JSON object (`ok`, data, and on failure `error` + `fix`). Run it from the repo root:

```bash
C=.claude/skills/verify/scripts/control-koe.mjs
$C --help              # command groups
$C <command> --help    # flags, side effects, what it proves
```

Prerequisites:

- `pnpm install` at the repo root.
- Docker.
- Node 20 or later.
- `playwright-core` plus its Chromium. Koe has no Playwright dependency, so install it as a dev tool outside the repo (`doctor` reports when it is missing):

  ```bash
  mkdir -p ~/.cache/koe-verify/tools
  npm i --prefix ~/.cache/koe-verify/tools playwright-core@1.62.1
  node ~/.cache/koe-verify/tools/node_modules/playwright-core/cli.js install chromium
  ```

  Override the location with `KOE_VERIFY_TOOLS=<dir>`.

## Launch

```bash
export KOE_EVIDENCE_DIR=/somewhere/outside/the/checkout   # recommended (see Evidence)
$C launch --dry-run    # plan only: ports, container, steps; touches nothing
$C launch              # ~10 s warm, plus a one-time `pnpm turbo run build` if dist/ is missing
```

`launch` does the following, in order:

1. If `packages/{shared,widget,dashboard}/dist` is missing, it runs `pnpm turbo run build`. A turbo cache hit restores `dist/` without a rebuild, so `metadata.widgetVersion` can be stale (see `features/repro-bug-report.md`, item 7).
2. It starts the Docker container `koe-verify-pg`: `postgres:16-alpine` with its data dir on tmpfs, on `127.0.0.1:38432`, labelled `koe-verify=1`. The data dies with the container.
3. It starts the API from source (`tsx src/bin/serve.ts`) on `:38787` with `MIGRATE_ON_START=true` and `ENABLE_DASHBOARD=true`. The dashboard is served from `packages/dashboard/dist` at `/admin/`. The env is a whitelist, so nothing from your shell leaks in:
   - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NOTIFY_OWNER_EMAIL`, `DASHBOARD_PUBLIC_URL`, `REDIS_URL` and `KOE_SECRET_KEYS` are forced empty.
   - The fake admin is `admin@koe-verify.test` / `verify-admin-pass-123`. Its argon2id hash is generated at launch.
4. It creates the project `acme-verify` with the repo's own `bootstrap.ts --non-interactive`, with `requireIdentityVerification=true`. It then inserts two fake feature requests (one with three fake votes), so "Browse ideas" has content.
5. It starts the host page daemon (`__hostd`, `:38788`). This is verification scaffolding: the page is rendered in memory and disappears at teardown. The signed-in host user is `user-42` "Jane Fake".
6. It starts a headless Chromium daemon (`__browserd`, CDP `:38222`). Every later command attaches to it. It records console messages and HTTP traffic to JSONL.

`launch` is ready when it returns `"ok": true`. By then it has already waited for `/health/ready`, the host page and the CDP port.

Two launch flags choose how the widget reaches the API:

- `--embed same-origin` (default): the host page reverse-proxies `/v1/*` to the API, and the widget's `apiUrl` is the host's own origin. `--embed cross-origin` points the widget straight at `:38787`, the way a SaaS on another domain would. Use it to prove any CORS change.
- `--origins any` (default): `allowedOrigins=[]`. `--origins allowlist` sets `allowedOrigins=["http://localhost:38788"]`. Every `widget` action accepts `--host-origin http://127.0.0.1:38788`: the same host page from an origin outside that allowlist, to prove a refusal.

Isolation: one instance per host. The ports 38787, 38788, 38432 and 38222 are fixed. Do not use 8787 or 5432: on the shared host they belong to other projects. `launch` refuses to start when any port is busy, when the `koe-verify-pg` container exists, or when `.verify-run/state.json` exists. Never point the CLI at an instance you did not launch, and never run `docker compose up` from this repo alongside it.

## Doctor

```bash
$C doctor   # read-only; exit 0 only when every required check passes
```

`doctor` checks:

- the recorded PIDs are alive
- the container is running and carries the label
- `/health/ready` answers
- the admin API is mounted (`/v1/admin/me` returns 401, not 404)
- the dashboard index is served
- the host page embeds the widget
- the CDP port is open and the Playwright Chromium is installed
- the project is seeded
- the third-party env of the API process is empty (it reads `/proc/<pid>/environ` and prints names only)
- the git SHA of the checkout

It also reports `widgetPreflightAllowsHost`: whether the API answers a browser CORS preflight from the host origin. It is `true` since the CORS fix, and was `false` on `1cbae34`. It is informational and not required. Run `doctor` first whenever anything looks off, and read its `hints`.

## Drive

Drive by role and accessible name. The widget's names come from `DEFAULT_LOCALE` in `packages/shared/src/types/widget.ts`. Use `$C snapshot` (or `--selector dialog` for the widget panel) instead of guessing CSS.

| Goal | Command |
|---|---|
| Open the widget on a host page | `$C widget open [--path /projects]` |
| Report a bug through the widget, then read the row back | `$C widget bug --title "..." --description "..." [--steps "1. ...\n2. ..."] [--trigger-error]` |
| Suggest an idea | `$C widget feature --title "..." --description "..."` |
| Upvote an idea (toggle) | `$C widget vote [--title "<regex>"]` |
| "My requests" list for the host user | `$C widget my-requests` |
| Dashboard login through the real form | `$C login` |
| Inbox, checked against the admin API | `$C inbox --expect <ticketId\|title regex> [--status all]` |
| Ticket detail; change status through the Status select | `$C ticket <id> [--set-status resolved]` |
| DB view (second read) | `$C tickets [--kind bug]`, `$C tickets --id <id>` |
| Replay a stored bug report from its action trail, with a `reproduced` verdict | `$C repro <ticketId> [--steps-file steps.json]`, `$C repro --from-file report.json` |
| Navigate | `$C goto /projects?tab=export` (host), `$C goto /onboarding --app dashboard` |
| Generic click, fill and keyboard | `$C click --role button --name "^Support$"`, `$C fill --label "^Title$" --value "x"`, `$C key Escape` |
| ARIA tree and PNG | `$C snapshot [--selector dialog]`, `$C screenshot --name x [--full-page]` |
| Browser console and HTTP log | `$C console --level error`, `$C network-log --filter /v1/widget --status-min 400` |
| Run, URLs, fake credentials, evidence dir | `$C info` |

Commands with side effects accept `--dry-run`: `launch`, `teardown`, `login`, `widget bug|feature|vote`, `ticket --set-status`, `click`, `fill` and `repro`. `widget bug --trigger-error` first clicks the host page's deliberately broken "Export CSV" button, which logs a console error. That gives the report and a later `repro` something concrete to observe.

The feature map in [`features/README.md`](features/README.md) has one recipe per feature. A proof that drives one entry point does not cover the others listed there.

## Evidence

- Location: `$KOE_EVIDENCE_DIR/<runId>/`. The default is `.verify-evidence/<runId>/` at the repo root (gitignored). Each screenshot and snapshot is named `<timestamp>_<label>`. `widget bug|feature` also writes a `.json` next to its result screenshot, with the API response and the DB row.
- `transcript.txt` in the run dir gets the command line and full JSON output of every CLI call, teardown included.
- `repro` writes a bundle dir, `repro-<id8>-<ts>/`. It holds `report.json`, `plan.json`, `console.json`, `network.json`, `landed.png`, `step-N.png` and `summary.json`.
- Teardown copies `.verify-run/logs/*.log` (api, hostd, browserd, bootstrap), `console.jsonl` and `network.jsonl` into `<runId>/run-logs/`.
- Proof standards:
  - Drive the real user path: the launcher, the intent card, the form fields and the submit button in the host page, and the dashboard forms. Never POST to `/v1/widget/*` or PATCH the admin API directly to "prove" a UI change.
  - Capture the action and the resulting state. Take before and after screenshots, plus the HTTP response.
  - Check every mutation with a second read: the `tickets`, `ticket_votes` or `admin_ticket_events` rows (`$C tickets --id`), and the dashboard showing the ticket (`$C inbox --expect`).
  - For a bug, reproduce it on the same surface first, then show it gone.
- In a git worktree, the default evidence dir dies with `git worktree remove`. Set `KOE_EVIDENCE_DIR` outside the checkout.

## Cleanup

```bash
$C teardown --dry-run   # lists PIDs, the labelled container, paths to remove
$C teardown
```

`teardown` does the following:

- kills only the process groups recorded in `state.json`, never by process name
- removes `koe-verify-pg` only if it carries `koe-verify=1`
- deletes `.verify-run/`
- reports `portsStillOpen`, which must be `[]`
- never deletes the evidence

Run it after every failed iteration too. Afterwards, `docker ps --filter label=koe-verify=1` must be empty.

## Helpers

- `scripts/control-koe.mjs` is the only helper. It is a Node ESM script with no dependencies of its own. It loads `playwright-core` (from the repo, then `KOE_VERIFY_TOOLS`) and `@node-rs/argon2` (from `packages/api`), and runs `psql` inside the container. It also hosts the two internal daemons, `__hostd` and `__browserd`, that `launch` spawns. Every subcommand has `--help`.

## Gotchas

- **CORS model.** A browser preflight carries no `X-Koe-Project-Key` value, so the API answers it from the `Origin` and the requested headers, and only for an origin that at least one project accepts (`lib/widgetOrigin.ts`). The per-project check runs on the real request: `requireProject` refuses a disallowed origin with 403 before any handler, and the response carries no `Access-Control-Allow-Origin`. A disallowed origin therefore shows "Network error — check your connection" in the widget. Same-origin GETs carry no `Origin`; they pass an allowlist through `Sec-Fetch-Site: same-origin`. The heartbeat still shows "Last ping from unknown origin" for them.
- **Mobile posture.** At 480px wide or less, only the opened panel becomes a bottom sheet (`.koe-root[data-open='true']`). The closed launcher keeps its configured corner. Before the fix it dropped to the bottom-left corner; see `features/repro-bug-report.md` Gotchas.
- **The live chat is not wired.** It has no widget screen and no API route; only the `conversations` and `messages` tables exist. See `features/live-chat.md`. Do not report it as verified.
- **What a report carries.** The widget sends `expected_behavior`, `screenshot_url` (through the host's `captureScreenshot` hook), versions, touch capability and `reporterMetadata`. `repro` lists what a report still lacks under `notCaptured`.
- **Rate limits:** the widget allows 30 requests in a burst, then 10/min per project key and IP. Admin login allows 5/min per IP. A tight loop of `widget` or `login` calls returns 429. Relaunch to reset (the limiter is in memory, because `REDIS_URL` is empty).
- **The identity secret is stored in plaintext** because `KOE_SECRET_KEYS` is empty. The onboarding screen still says "encrypted at rest" (see `features/project-setup.md`).
- **Ports are fixed** (see Isolation). If `launch` reports a busy port, find the owner with `ss -ltnp` and `docker ps`. Never kill what you did not start.
