import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { eq } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db/index.js';
import { runMigrations } from './migrate.js';

/**
 * Interactive CLI that creates a new `projects` row and prints the
 * `projectKey` + `identitySecret` to stdout. Replaces the "manual psql
 * INSERT" step in the self-host flow.
 *
 * Usage:
 *   docker compose run --rm api bootstrap
 *   # or inside a running container:
 *   docker compose exec api node dist/bootstrap.js
 *
 * Non-interactive mode (reads from env):
 *   KOE_PROJECT_NAME=Acme KOE_PROJECT_KEY=acme \
 *   KOE_ALLOWED_ORIGINS=https://app.acme.com \
 *   node dist/bootstrap.js --non-interactive
 */

type BootstrapInput = {
  name: string;
  key: string;
  allowedOrigins: string[];
  requireIdentityVerification: boolean;
};

async function promptInteractive(): Promise<BootstrapInput> {
  const rl = createInterface({ input, output });
  try {
    const name = (await rl.question('Project name (e.g. "Acme Web"): ')).trim();
    if (!name) throw new Error('name is required');

    const suggestedKey = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const keyAnswer = (await rl.question(`Project key [${suggestedKey}]: `)).trim();
    const key = keyAnswer || suggestedKey;
    if (!/^[a-z0-9-]+$/.test(key)) {
      throw new Error('key must match /^[a-z0-9-]+$/');
    }

    const originsRaw = (
      await rl.question('Allowed origins (comma-separated, empty for permissive): ')
    ).trim();
    const allowedOrigins = originsRaw
      ? originsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const enforceAnswer = (
      await rl.question('Require identity verification? [y/N]: ')
    ).trim().toLowerCase();
    const requireIdentityVerification = enforceAnswer === 'y' || enforceAnswer === 'yes';

    return { name, key, allowedOrigins, requireIdentityVerification };
  } finally {
    rl.close();
  }
}

function readFromEnv(): BootstrapInput {
  const name = process.env.KOE_PROJECT_NAME;
  const key = process.env.KOE_PROJECT_KEY;
  if (!name || !key) {
    throw new Error(
      'Non-interactive mode requires KOE_PROJECT_NAME and KOE_PROJECT_KEY env vars',
    );
  }
  const allowedOrigins = (process.env.KOE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const requireIdentityVerification =
    (process.env.KOE_REQUIRE_IDENTITY_VERIFICATION ?? '').toLowerCase() === 'true';
  return { name, key, allowedOrigins, requireIdentityVerification };
}

async function main(): Promise<void> {
  if (!dbAvailable) {
    throw new Error('DATABASE_URL must be set');
  }

  // Ensure the schema exists before we try to insert. Idempotent.
  await runMigrations();

  const nonInteractive = process.argv.includes('--non-interactive') || !input.isTTY;
  const cfg = nonInteractive ? readFromEnv() : await promptInteractive();

  const existing = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.key, cfg.key))
    .limit(1);

  if (existing.length > 0) {
    throw new Error(`A project with key "${cfg.key}" already exists`);
  }

  const identitySecret = randomBytes(32).toString('hex');

  const [row] = await db
    .insert(schema.projects)
    .values({
      name: cfg.name,
      key: cfg.key,
      allowedOrigins: cfg.allowedOrigins,
      identitySecret,
      requireIdentityVerification: cfg.requireIdentityVerification,
    })
    .returning({ id: schema.projects.id, key: schema.projects.key });

  console.log('');
  console.log('Project created:');
  console.log(`  id:            ${row!.id}`);
  console.log(`  projectKey:    ${row!.key}`);
  console.log(`  identitySecret ${identitySecret}`);
  console.log('');
  console.log('Keep `identitySecret` on your backend only. Never ship it to the browser.');
}

try {
  await main();
  process.exit(0);
} catch (err) {
  console.error('[koe/api] bootstrap failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
