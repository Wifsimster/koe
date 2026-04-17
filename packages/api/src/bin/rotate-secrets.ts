import { parseArgs } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db/index.js';
import {
  getSecretStoreFromEnv,
  isEnvelope,
  readEnvelopeKid,
} from '../lib/secretStore.js';

/**
 * Re-encrypt identity secrets at rest.
 *
 * Two use cases:
 *
 *   1. First-time KMS rollout — an operator turned on
 *      `KOE_SECRET_KEYS` on a deployment that has existing plaintext
 *      rows. Default invocation migrates every plaintext row to an
 *      envelope under the current active kid.
 *
 *   2. Master key rotation — the active kid changed
 *      (`KOE_SECRET_ACTIVE_KID` points to a new entry in
 *      `KOE_SECRET_KEYS`). Rows encrypted under the old kid still
 *      decrypt as long as its key stays in `KOE_SECRET_KEYS`, but
 *      should be re-encrypted under the new one so we can drop the
 *      retired kid. Pass `--reencrypt-all` to cover that case.
 *
 * Safety posture:
 *   - Dry-run is the default. Passing `--apply` is the explicit
 *     "yes, change the DB" knob.
 *   - Refuses to run when the env only yields a plaintext store;
 *     there's nothing to rotate to.
 *   - Each row updates independently — a transient failure on one
 *     row doesn't poison the rest, and re-running the CLI is
 *     idempotent (envelopes under the active kid are skipped).
 *   - Read-modify-write guards via a WHERE on the original value
 *     so a concurrent rotator doesn't clobber our re-encryption.
 *
 * Usage:
 *
 *   # Show the plan without writing
 *   pnpm --filter @koe/api exec tsx src/bin/rotate-secrets.ts
 *
 *   # Actually migrate plaintext → envelope
 *   pnpm --filter @koe/api exec tsx src/bin/rotate-secrets.ts --apply
 *
 *   # Master key rotation: also re-encrypt rows under retired kids
 *   pnpm --filter @koe/api exec tsx src/bin/rotate-secrets.ts \
 *     --reencrypt-all --apply
 */

type Args = {
  apply: boolean;
  reencryptAll: boolean;
};

function parse(): Args {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      'reencrypt-all': { type: 'boolean', default: false },
    },
  });
  return {
    apply: values.apply === true,
    reencryptAll: values['reencrypt-all'] === true,
  };
}

type Verdict = 'skip-active' | 'plaintext' | 'other-kid';

function classify(value: string, activeKid: string): Verdict {
  if (!isEnvelope(value)) return 'plaintext';
  const kid = readEnvelopeKid(value);
  return kid === activeKid ? 'skip-active' : 'other-kid';
}

interface Stats {
  read: number;
  skippedActive: number;
  migrated: number;
  reencrypted: number;
  errors: number;
}

function emptyStats(): Stats {
  return { read: 0, skippedActive: 0, migrated: 0, reencrypted: 0, errors: 0 };
}

async function main(): Promise<void> {
  if (!dbAvailable) {
    throw new Error('DATABASE_URL must be set');
  }
  const args = parse();

  const activeKid = process.env.KOE_SECRET_ACTIVE_KID?.trim();
  const keysSet = process.env.KOE_SECRET_KEYS?.trim();
  if (!activeKid || !keysSet) {
    throw new Error(
      'rotate-secrets requires KOE_SECRET_KEYS and KOE_SECRET_ACTIVE_KID. ' +
        'Without them the secret store is plaintext — nothing to rotate to.',
    );
  }

  // `getSecretStoreFromEnv` will throw on a malformed KOE_SECRET_KEYS,
  // which is the behaviour we want at the CLI entry point.
  const store = getSecretStoreFromEnv();

  console.log(`rotate-secrets: active kid = ${activeKid}`);
  console.log(`mode: ${args.apply ? 'APPLY (writes)' : 'dry-run'}`);
  console.log(`reencrypt-all: ${args.reencryptAll ? 'yes' : 'no'}`);
  console.log('');

  const projectsStats = await rotateProjects(store, activeKid, args);
  const secretsStats = await rotateIdentitySecrets(store, activeKid, args);

  console.log('');
  console.log('Summary:');
  report('projects.identity_secret', projectsStats);
  report('project_identity_secrets.secret', secretsStats);

  if (!args.apply) {
    console.log('');
    console.log('Dry-run — re-run with --apply to persist the changes.');
  }
}

async function rotateProjects(
  store: ReturnType<typeof getSecretStoreFromEnv>,
  activeKid: string,
  args: Args,
): Promise<Stats> {
  const stats = emptyStats();
  const rows = await db
    .select({ id: schema.projects.id, key: schema.projects.key, secret: schema.projects.identitySecret })
    .from(schema.projects);

  for (const row of rows) {
    stats.read += 1;
    const verdict = classify(row.secret, activeKid);

    if (verdict === 'skip-active') {
      stats.skippedActive += 1;
      continue;
    }
    if (verdict === 'other-kid' && !args.reencryptAll) {
      stats.skippedActive += 1;
      continue;
    }

    try {
      // Decrypt (passes through for plaintext) then encrypt under the
      // active kid. The WHERE on the original value protects against a
      // concurrent rotator clobbering our re-encryption mid-run.
      const plaintext = store.decrypt(row.secret);
      const next = store.encrypt(plaintext);

      if (args.apply) {
        // WHERE on the original value so a concurrent rotator can't
        // clobber our re-encryption — the UPDATE becomes a no-op if
        // someone else got here first.
        await db
          .update(schema.projects)
          .set({ identitySecret: next })
          .where(
            and(
              eq(schema.projects.id, row.id),
              eq(schema.projects.identitySecret, row.secret),
            ),
          );
      }

      if (verdict === 'plaintext') stats.migrated += 1;
      else stats.reencrypted += 1;
      console.log(
        `  projects[${row.key}] ${verdict}${args.apply ? ' → written' : ' (dry-run)'}`,
      );
    } catch (err) {
      stats.errors += 1;
      console.error(
        `  projects[${row.key}] FAILED: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return stats;
}

async function rotateIdentitySecrets(
  store: ReturnType<typeof getSecretStoreFromEnv>,
  activeKid: string,
  args: Args,
): Promise<Stats> {
  const stats = emptyStats();
  const rows = await db
    .select({
      projectId: schema.projectIdentitySecrets.projectId,
      kid: schema.projectIdentitySecrets.kid,
      secret: schema.projectIdentitySecrets.secret,
    })
    .from(schema.projectIdentitySecrets);

  for (const row of rows) {
    stats.read += 1;
    const verdict = classify(row.secret, activeKid);

    if (verdict === 'skip-active') {
      stats.skippedActive += 1;
      continue;
    }
    if (verdict === 'other-kid' && !args.reencryptAll) {
      stats.skippedActive += 1;
      continue;
    }

    try {
      const plaintext = store.decrypt(row.secret);
      const next = store.encrypt(plaintext);

      if (args.apply) {
        await db
          .update(schema.projectIdentitySecrets)
          .set({ secret: next })
          .where(
            and(
              eq(schema.projectIdentitySecrets.projectId, row.projectId),
              eq(schema.projectIdentitySecrets.kid, row.kid),
              eq(schema.projectIdentitySecrets.secret, row.secret),
            ),
          );
      }

      if (verdict === 'plaintext') stats.migrated += 1;
      else stats.reencrypted += 1;
      console.log(
        `  project_identity_secrets[${row.projectId}/${row.kid}] ${verdict}${args.apply ? ' → written' : ' (dry-run)'}`,
      );
    } catch (err) {
      stats.errors += 1;
      console.error(
        `  project_identity_secrets[${row.projectId}/${row.kid}] FAILED: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  return stats;
}

function report(label: string, stats: Stats): void {
  console.log(`  ${label}`);
  console.log(`    read           ${stats.read}`);
  console.log(`    skipped-active ${stats.skippedActive}`);
  console.log(`    migrated       ${stats.migrated}`);
  console.log(`    reencrypted    ${stats.reencrypted}`);
  console.log(`    errors         ${stats.errors}`);
}

try {
  await main();
  process.exit(0);
} catch (err) {
  console.error(
    '[koe/api] rotate-secrets failed:',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}
