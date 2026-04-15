# Changesets

This directory is managed by [Changesets](https://github.com/changesets/changesets). It's the source of truth for version bumps and changelog entries on the public npm packages in this repo.

## How to add a changeset

Run `pnpm changeset` from the repo root, select the packages you changed, pick a bump type (patch / minor / major), and write a short summary. Commit the generated file with your PR.

## Cutting a release

Releases are **tag-driven**. CI does not auto-bump versions or auto-open a "Version Packages" PR — the maintainer drives it explicitly:

1. On a `release/*` branch, run:
   ```bash
   pnpm changeset version
   ```
   This consumes `.changeset/*.md`, bumps `package.json`s, and updates changelogs.
2. Open a "Release X.Y.Z" PR, get it reviewed, merge.
3. On `main`, tag the merge commit and push the tag:
   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```
4. `.github/workflows/release.yml` fires on the tag and runs `pnpm publish --provenance` for `@wifsimster/koe`. Requires the `NPM_TOKEN` secret to be configured.

## What's published

Only `@wifsimster/koe` (the widget) is published to npm. The other workspace packages (`@koe/api`, `@koe/dashboard`, `@koe/shared`) are `private: true` and explicitly ignored in `config.json`.
