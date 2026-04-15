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

When a PR merges to `main`, the release workflow runs `semantic-release`. It:

1. Walks the commits since the last `v*` tag.
2. Decides the next version from the commit types above.
3. If there's nothing releasable (only `docs`, `chore`, `test`, `build`, `ci`), it exits — **no release is cut**.
4. Otherwise: publishes `@wifsimster/koe` to npm with provenance, creates a GitHub Release, and tags the commit.

No `CHANGELOG.md` is committed back to the repo — release notes live on the GitHub Releases page.

## Required secrets (maintainers)

For releases to actually publish to npm, `NPM_TOKEN` must be set under **Settings → Secrets and variables → Actions**. The workflow fails loudly with a helpful error if the token is missing, so a missing secret won't result in a silent broken release.
