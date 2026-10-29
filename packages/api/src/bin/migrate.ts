import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

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
