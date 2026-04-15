# Changesets

This directory is managed by [Changesets](https://github.com/changesets/changesets). It is the source of truth for versioning and publishing the public npm packages in this repo.

## How to add a changeset

Run `pnpm changeset` from the repo root, select the packages you changed, pick a bump type (patch / minor / major), and write a short summary. Commit the generated file with your PR.

## What's published

Only `@wifsimster/koe` (the widget) is published to npm. The other workspace packages (`@koe/api`, `@koe/dashboard`, `@koe/shared`) are `private: true` and explicitly ignored in `config.json`.
