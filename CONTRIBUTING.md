# Contributing to Koe

Thanks for working on Koe. Two things to know before opening a PR:

1. How to run the project locally.
2. How to format your commit messages so the automated release pipeline picks them up.

## Local development

```bash
pnpm install
pnpm turbo run build    # build everything once so @koe/shared has dist
pnpm dev                # run all dev servers (widget sandbox, api, dashboard)
```

Tasks are wired through Turborepo:

- `pnpm turbo run build`
- `pnpm turbo run typecheck`
- `pnpm turbo run lint`
- `pnpm turbo run test`

## Commit message format — Conventional Commits

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) + [`semantic-release`](https://semantic-release.gitbook.io/) to cut releases automatically. **The commit subject drives the version bump and the changelog**, so it's not cosmetic — treat it as part of the change.

Format:

```
<type>(<optional scope>): <short summary>

<optional body>

<optional footer>
```

### Type → release impact

| Type       | Release   | Use for                                             |
|------------|-----------|-----------------------------------------------------|
| `feat`     | **minor** | A user-visible feature addition                     |
| `fix`      | **patch** | A user-visible bug fix                              |
| `perf`     | **patch** | A performance improvement                           |
| `refactor` | **patch** | Internal change with no behavior delta              |
| `docs`     | none      | Documentation only                                  |
| `test`     | none      | Tests only                                          |
| `build`    | none      | Build system / dependencies                         |
| `ci`       | none      | CI config                                           |
| `chore`    | none      | Everything else (tooling, housekeeping)             |

Add `!` after the type or a `BREAKING CHANGE:` footer to trigger a **major** release:

```
feat(widget)!: rename KoeWidget props

BREAKING CHANGE: `projectKey` is now `apiKey` to match the backend.
```

### Scopes

Use a scope when it adds clarity, especially for cross-cutting work:

- `widget` — `@wifsimster/koe`
- `api` — `@koe/api`
- `dashboard` — `@koe/dashboard`
- `shared` — `@koe/shared`
- `ci` — workflows, release, tooling

A commit without a scope is fine for repo-wide work.

### Examples

```
feat(widget): add dark mode support
fix(api): reject avatarUrls with non-http(s) schemes
perf(widget): memoize heavy expression in Panel
docs: update identity verification guide
chore(deps): bump vite to 6.4.2
feat(widget)!: drop support for React 17

BREAKING CHANGE: React 18 is now the minimum.
```

### What triggers an actual release

Two pipelines run in parallel on `main`. They don't share tags.

**Widget (`semantic-release`)** — every push to `main`:

1. Walks the commits since the last `v*` tag.
2. Decides the next version from the commit types above.
3. If there's nothing releasable (only `docs`, `chore`, `test`, `build`, `ci`), it exits — **no release is cut**.
4. Otherwise: creates a GitHub Release with auto-generated notes and tags the commit with `vX.Y.Z`.

No `CHANGELOG.md` is committed back to the repo — release notes live on the GitHub Releases page.

The widget is not published to npm. Consumers pin to a git tag (e.g. `npm install github:Wifsimster/koe#v0.1.0`) or load the IIFE bundle from a GitHub-backed CDN such as jsDelivr.

**Server image (`Server image` workflow)** — triggered by push to `main` touching `packages/api/**`, `packages/shared/**` or the lockfile:

1. Builds `packages/api/Dockerfile` as multi-arch (amd64 + arm64). The image bundles the API and the built admin dashboard SPA.
2. Pushes to `ghcr.io/wifsimster/koe-server` with rolling tags `:edge` and `:sha-<short>`.
3. Signs the image (cosign keyless, OIDC), attaches SLSA provenance + SBOM, scans with Trivy (soft-fail — findings land in the Security tab without blocking the run).

For a **stable** image tag (`:latest`, `:X.Y.Z`, `:X.Y`, `:X`), cut a server-scoped git tag:

```bash
git tag server-v0.1.0 && git push origin server-v0.1.0
```

Widget releases and server releases are independent — a `v1.2.3` tag does not rebuild the image, and a `server-v1.2.3` tag does not cut a widget release.

## Required secrets (maintainers)

None beyond the default `GITHUB_TOKEN` that GitHub Actions provides automatically.
