# Project setup and identity

An operator creates a project from the dashboard (onboarding on an empty install, or "New project" in the sidebar), or from the CLI (`bootstrap`). Koe returns the public `projectKey` and, exactly once, the `identitySecret`. The customer's backend signs each user id with that secret (v1: `hex(HMAC-SHA256(secret, user.id))` as `userHash`; v2: a signed identity token). The customer's page embeds the widget with `Koe.init({ projectKey, apiUrl, user, userHash })`. `allowedOrigins` restricts which origins may call the widget API; an empty list accepts any origin.

## Sub-features

- `project-create-ui`: the fields "Project name", "Project key" (auto-suggested from the name), "Allowed origins" (one per line) and "Require identity verification", then the "Create project" button.
- `project-secret-reveal`: the "Set up" screen with the key, the identity secret, the env snippet and the "Copy" buttons. "Enter the dashboard" stays disabled until "I've saved the identity secret" is checked.
- `project-create-cli`: `bootstrap.ts --non-interactive` with `KOE_PROJECT_NAME`, `KOE_PROJECT_KEY`, `KOE_ALLOWED_ORIGINS` and `KOE_REQUIRE_IDENTITY_VERIFICATION`. `launch` uses this path.
- `identity-v1`: the `X-Koe-User-Hash` header, checked against `projects.identity_secret`.
- `identity-v2`: the `X-Koe-Identity-Token` header (`kid`, `iat`, `nonce`, 600 s max age), checked against `project_identity_secrets`.
- `origin-allowlist`: `requireProject` refuses a disallowed origin with 403 on every real request; `widgetCors` reflects `Access-Control-Allow-Origin` only for an allowed origin. Same-origin GETs pass with `Sec-Fetch-Site: same-origin`.
- `heartbeat`: `projects.last_ping_at` and `last_ping_origin`, shown as "Last ping from ..." in the inbox.

## How to get to it (user POV)

- A fresh install with zero projects: after login the dashboard redirects to `/admin/onboarding`.
- With projects: the sidebar link "New project" (`/admin/onboarding`).
- CLI: `docker compose run --rm api bootstrap` (production), or `tsx src/bin/bootstrap.ts` from `packages/api`.
- The host side: the customer's backend computes `userHash`. In the harness, the host page daemon does it (`hostPageHtml` in `control-koe.mjs`).

## Driving it with control-koe

Preconditions:

- A fresh `$C launch`, `$C doctor` exits 0, and `$C login` returned ok.

- **Create.** Run `$C click --role link --name "^New project$"` (the URL becomes `/admin/onboarding`). Then run `$C fill --label "^Project name$" --value "Second App (fake)"` and `$C fill --label "^Allowed origins$" --value "http://localhost:38788"`. Then `$C click --role button --name "^Create project$"`.
- **Secret shown once.** Run `$C snapshot`. It shows "Project created", textbox `second-app-fake`, an identity secret textbox, the `KOE_IDENTITY_SECRET=` env snippet, and a disabled "Enter the dashboard". Save `$C screenshot --name project-created`.
- **Second read.** Run `docker exec koe-verify-pg psql -U koe -d koe -Atc "select key, allowed_origins, require_identity_verification from projects"`. It returns `second-app-fake|["http://localhost:38788"]|f`.
- **Identity, end to end.** Run `$C widget bug ...`. `dbRow.reporter_verified` is true, because the host signed `user-42`. A forged hash returns 401 "Identity hash mismatch". As an API-level check: `curl` the proxy with `-H 'X-Koe-User-Hash: 00'` and a valid body.
- **Allowlist.** Run `$C launch --origins allowlist`, then `$C widget vote` and `$C widget my-requests` (both pass: same-origin GETs), and `$C widget bug --host-origin http://127.0.0.1:38788 ...` (refused: that origin is not in the list).

## Gotchas

- The "Set up" screen says the secret is "encrypted at rest". That is true only when `KOE_SECRET_KEYS` and `KOE_SECRET_ACTIVE_KID` are set. Otherwise the API logs "secret-at-rest encryption is DISABLED" and stores plaintext: the harness observed a 64-hex plaintext in `projects.identity_secret`. `.env.docker.example` does not mention `KOE_SECRET_KEYS`, so a default self-host stores plaintext while the UI says otherwise.
- The secret appears in screenshots and ARIA snapshots of the "Set up" screen. In this harness it is a fake throwaway value, but never run this recipe against a real instance.
- The project key may only contain lowercase letters, digits and `-`. The UI strips other characters as you type.
- The `allowedOrigins` validation rejects `*`, `file://`, and any path, query or fragment.
- `bootstrap` with no TTY falls back to non-interactive mode and needs `KOE_PROJECT_NAME` and `KOE_PROJECT_KEY`.
