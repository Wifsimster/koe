import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

/**
 * Apply pending Drizzle migrations against `DATABASE_URL`.
 *
 * The generated SQL migrations are expected to ship alongside the binary
 * at `./drizzle/` (relative to this file). The Docker image copies the
 * `packages/api/drizzle/` directory into the same layout.
 */
export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  // In the Docker runtime, this file sits at /app/dist/migrate.js and
  // the SQL lives at /app/drizzle. Keep the relative hop in sync with
  // the Dockerfile layout.
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = process.env.MIGRATIONS_FOLDER ?? resolve(here, '../drizzle');

  console.log(`[koe/api] applying migrations from ${migrationsFolder}`);
  const client = postgres(url, { max: 1 });
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder });
    console.log('[koe/api] migrations applied');
  } finally {
    await client.end();
  }
}

// Compare the running entrypoint's basename, not `import.meta.url`. When
// bundlers inline this module into another entrypoint (e.g. `serve.js`),
// `import.meta.url` is rewritten to point at the containing file — which
// would silently fire this CLI block and exit before the real server
// starts. `process.argv[1]` still points at the actual entrypoint on disk.
const entry = process.argv[1];
if (entry && basename(entry).replace(/\.[cm]?js$/, '') === 'migrate') {
  try {
    await runMigrations();
    process.exit(0);
  } catch (err) {
    console.error('[koe/api] migration failed', err);
    process.exit(1);
  }
}
