# syntax=docker/dockerfile:1.7

# --- Base image ----------------------------------------------------------
# Pinned to a specific Node + Alpine release. Operators wiring Renovate or
# Dependabot should update this tag (and re-pin the digest) on every image
# cut. The `@sha256:...` suffix is deliberately omitted here so the repo
# stays buildable without a registry auth; CI rebuilds it against a
# digest-pinned base (see .github/workflows/docker.yml).
ARG NODE_IMAGE=node:20.18.1-alpine3.20

# --- Builder -------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /repo

# corepack ships with Node 20 and resolves the pnpm version from the
# workspace's `packageManager` field. The bundled corepack in older
# Node 20 patch releases can't verify pnpm's current signing key
# ("Cannot find matching keyid"), so pull the latest corepack first.
RUN npm install -g corepack@latest && corepack enable

# Copy workspace manifests first so layer caching holds across source
# edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
COPY packages/dashboard/package.json packages/dashboard/

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter @koe/api... \
      --filter @koe/shared \
      --filter @koe/dashboard

# Copy source.
COPY packages/shared packages/shared
COPY packages/api packages/api
COPY packages/dashboard packages/dashboard

# Build @koe/shared first (the API bundle inlines it, but its tsc output
# is still used for type resolution in dev/testing).
RUN pnpm --filter @koe/shared run build

# Build the dashboard SPA with a `/admin/` base path so asset URLs
# resolve correctly when served from the API under `/admin/*`. The
# output is copied into the runtime image and only served when the
# operator sets `ENABLE_DASHBOARD=true`.
RUN pnpm --filter @koe/dashboard exec vite build --base=/admin/

# Generate SQL migrations from the Drizzle schema. Produces
# `packages/api/drizzle/*.sql` + `drizzle/meta/_journal.json` that the
# runtime migrator applies on boot. `--name init` keeps it
# non-interactive on a clean schema; re-runs are idempotent.
RUN pnpm --filter @koe/api exec drizzle-kit generate --name init

# Bundle the API into ESM entrypoints (dist/serve.js, dist/migrate.js,
# dist/bootstrap.js). `@koe/shared` is inlined; runtime deps stay
# external and are resolved from node_modules via `pnpm deploy` below.
RUN pnpm --filter @koe/api run build

# Produce a workspace-free, prod-only deployment tree under /app.
RUN pnpm --filter @koe/api deploy --prod /app

# --- Runtime -------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

# `tini` reaps zombies and forwards signals so graceful shutdown works
# correctly. `wget` is used by the HEALTHCHECK.
RUN apk add --no-cache tini wget \
 && addgroup -S koe -g 10001 \
 && adduser -S koe -u 10001 -G koe

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    MIGRATE_ON_START=true

WORKDIR /app

COPY --from=builder --chown=koe:koe /app/package.json ./package.json
COPY --from=builder --chown=koe:koe /app/node_modules ./node_modules
COPY --from=builder --chown=koe:koe /repo/packages/api/dist ./dist
COPY --from=builder --chown=koe:koe /repo/packages/api/drizzle ./drizzle
COPY --from=builder --chown=koe:koe /repo/packages/dashboard/dist ./dashboard

USER koe

EXPOSE 8787

# Liveness probe — cheap, never touches the DB. Compose/orchestrators can
# additionally poll /health/ready for a DB-aware readiness signal.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["/sbin/tini", "--", "node"]
CMD ["dist/serve.js"]
