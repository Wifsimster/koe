import { parseArgs } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db/index.js';
import {
  getSecretStoreFromEnv,
  isEnvelope,
  readEnvelopeKid,
} from '../lib/secretStore.js';

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
  skippedOtherKid: number;
  migrated: number;
  reencrypted: number;
  errors: number;
}

function emptyStats(): Stats {
  return {
    read: 0,
    skippedActive: 0,
    skippedOtherKid: 0,
    migrated: 0,
    reencrypted: 0,
    errors: 0,
  };
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
      stats.skippedOtherKid += 1;
      continue;
    }

    try {
      const plaintext = store.decrypt(row.secret);
      const next = store.encrypt(plaintext);

      if (args.apply) {
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
      stats.skippedOtherKid += 1;
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
  console.log(`    read             ${stats.read}`);
  console.log(`    skipped-active   ${stats.skippedActive}`);
  console.log(`    skipped-other    ${stats.skippedOtherKid}`);
  console.log(`    migrated         ${stats.migrated}`);
  console.log(`    reencrypted      ${stats.reencrypted}`);
  console.log(`    errors           ${stats.errors}`);
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
