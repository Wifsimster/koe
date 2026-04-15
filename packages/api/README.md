# @koe/api

Backend API for Koe. Built on [Hono](https://hono.dev/) with [Drizzle ORM](https://orm.drizzle.team/) and PostgreSQL.

## Routes

- `GET /health` — liveness check
- `POST /v1/widget/bugs` — submit a bug report (widget)
- `POST /v1/widget/features` — submit a feature request (widget)
- `GET /v1/widget/features` — list feature requests for the public roadmap
- `POST /v1/widget/features/:id/vote` — toggle a user's vote on a feature

All widget routes require the `X-Koe-Project-Key` header.

## Local dev

```bash
cp .env.example .env
pnpm db:generate
pnpm db:migrate
pnpm dev
```

The server listens on `PORT` (default `8787`).
