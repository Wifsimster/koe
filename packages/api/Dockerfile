# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:lts-alpine

FROM ${NODE_IMAGE} AS builder
WORKDIR /repo

RUN npm install -g corepack@latest && corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
COPY packages/dashboard/package.json packages/dashboard/

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter @koe/api... \
      --filter @koe/shared \
      --filter @koe/dashboard

COPY packages/shared packages/shared
COPY packages/api packages/api
COPY packages/dashboard packages/dashboard

RUN pnpm --filter @koe/shared run build

RUN pnpm --filter @koe/dashboard exec vite build --base=/admin/

RUN pnpm --filter @koe/api exec drizzle-kit generate --name init

RUN pnpm --filter @koe/api run build

RUN pnpm --filter @koe/api deploy --prod /app

FROM ${NODE_IMAGE} AS runtime

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["/sbin/tini", "--", "node"]
CMD ["dist/serve.js"]
