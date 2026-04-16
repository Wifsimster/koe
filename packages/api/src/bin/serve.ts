import { serve } from '@hono/node-server';
import { app } from '../index.js';
import { runMigrations } from './migrate.js';

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '0.0.0.0';

/**
 * Boot the HTTP server with graceful shutdown.
 *
 * When `MIGRATE_ON_START=true` (the default in the Docker image), this
 * runs pending migrations before opening the listener. Operators running
 * multiple replicas against the same database should set it to `false`
 * and invoke the `migrate` entrypoint once as a separate step.
 */
export async function startServer(): Promise<void> {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
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
      process.exit(0);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  await startServer();
}
