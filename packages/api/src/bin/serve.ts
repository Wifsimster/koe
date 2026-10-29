import { serve } from '@hono/node-server';
import { basename } from 'node:path';
import { app } from '../index.js';
import { runMigrations } from './migrate.js';
import { closeRedis } from '../lib/redis.js';

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '0.0.0.0';

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
      void closeRedis().finally(() => process.exit(0));
    });
    setTimeout(() => {
      console.warn('[koe/api] shutdown deadline reached, forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

const entry = process.argv[1];
if (entry && basename(entry).replace(/\.[cm]?[jt]s$/, '') === 'serve') {
  await startServer();
}
