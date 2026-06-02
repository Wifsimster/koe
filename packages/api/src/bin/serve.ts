import { serve } from '@hono/node-server';
import { basename } from 'node:path';
import { app } from '../index.js';
import { runMigrations } from './migrate.js';
import { closeRedis } from '../lib/redis.js';

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '0.0.0.0';

/**
 * Parse a port from the environment, falling back to the default on a
 * missing or non-numeric value. A bare `Number(process.env.PORT)`
 * yields `NaN` for a stray value like `8787/tcp`, which then binds an
 * arbitrary port — better to fall back loudly to a known default.
 */
function resolvePort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    console.warn(`[koe/api] invalid PORT="${raw}", falling back to ${DEFAULT_PORT}`);
    return DEFAULT_PORT;
  }
  return parsed;
}

/**
 * Boot the HTTP server with graceful shutdown.
 *
 * When `MIGRATE_ON_START=true` (the default in the Docker image), this
 * runs pending migrations before opening the listener. Operators running
 * multiple replicas against the same database should set it to `false`
 * and invoke the `migrate` entrypoint once as a separate step.
 */
export async function startServer(): Promise<void> {
  const port = resolvePort();
  const host = process.env.HOST ?? DEFAULT_HOST;
  const shouldMigrate = (process.env.MIGRATE_ON_START ?? 'true').toLowerCase() === 'true';

  if (shouldMigrate) {
    try {
      await runMigrations();
    } catch (err) {
      console.error('[koe/api] migration failed on startup', err);
      process.exit(1);
    }
  }

  const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    console.log(`[koe/api] listening on http://${info.address}:${info.port}`);
  });

  const shutdown = (signal: NodeJS.Signals) => {
    console.log(`[koe/api] received ${signal}, draining connections`);
    server.close((err) => {
      if (err) {
        console.error('[koe/api] error during shutdown', err);
        process.exit(1);
      }
      // Close the Redis socket too — otherwise its open connection and
      // reconnect timers keep the event loop alive past `server.close`,
      // so the process never exits cleanly and always hits the
      // hard-deadline `exit(1)` below on every rolling deploy.
      void closeRedis().finally(() => process.exit(0));
    });
    // Hard-deadline fallback. If connections don't drain in 10 s, exit
    // anyway so the orchestrator can reschedule.
    setTimeout(() => {
      console.warn('[koe/api] shutdown deadline reached, forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Compare the running entrypoint's basename rather than `import.meta.url`.
// When a bundler inlines a sibling module into this one, `import.meta.url`
// can be rewritten to point at the containing file and misfire; the
// argv-basename check stays correct. Mirrors the guard in `migrate.ts`.
const entry = process.argv[1];
// Strip a `.js`/`.cjs`/`.mjs` (compiled image) or `.ts`/`.cts`/`.mts`
// (tsx dev: `tsx watch src/bin/serve.ts`) extension before comparing.
if (entry && basename(entry).replace(/\.[cm]?[jt]s$/, '') === 'serve') {
  await startServer();
}
